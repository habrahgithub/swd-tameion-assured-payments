import {humanFindingDispositionsValid} from '../domain/review-findings';
import {reviewInputSchema} from '../domain/review-decision';
import {contentHash} from '../domain/linked-instruction';
import {verifyLinkedActivation} from './linked-instruction-activation';
import {sealPaymentRelease,matchesPaymentRelease,paymentReleaseBindings,type PaymentReleaseRecord,type PaymentReleaseBinding,type PaymentReleaseApproval} from '../domain/payment-release-approval';
import {buildFinanceAgentContext,hasCurrentControlledInstruction} from "../agent/context-builder";
import {z} from 'zod';
import {operatorHandlers,type AuthContext} from './operator-auth';
import {AccessError,readBoundedJson,requireJson,methodNotAllowed} from './route-access-policy';
import {loadFinancialSourceAdmission,loadFinancialRequesterBinding,loadFinancialSourceAdmissionForReconcile,loadFinancialRequesterBindingForReconcile,controlledProvenanceMatchesAdmission,sameFinancialBinding,type FinancialSourceAdmission,type FinancialRequesterBinding} from './financial-source-admission';
import {DEMO_ORGANIZATION_ID,DEMO_SIGNING_KEY_ID,loadExistingFinancialState,type DemoState} from './demo-state';
import {SupabaseDemoStateRepository,DemoStatePersistenceError} from './supabase-demo-state-repository';
import {createAssessmentHandler} from './legacy-routes/obligations/[id]/assess/route';
import {createSelectedPreflightHandler} from './legacy-routes/internal/demo/real-testnet-payment/preflight/route';
import {approveAndSealPae,AssuranceFailedError} from '../pipeline/authorize-and-seal';
import {AuthorityError} from '../authority/aggregate';
import {ExecutionBlockedError} from '../execution/worker';
import {sameEvmAddressIdentity} from '../execution/evm-address';
import {getCurrentSettlementProxyPacket} from './settlement-proxy-packet';
import type {runJ2aReadOnlyPreflight} from '../demo/real-testnet-payment';

const integer=z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),hash=z.string().regex(/^[a-f0-9]{64}$/);
const bodies={renew:z.object({expected_version:integer,predecessor_key:z.string().min(1).max(256),reason:z.string().trim().min(1).max(1024)}).strict(),review:reviewInputSchema,assess:z.object({}).strict(),preflight:z.object({obligation_id:z.string().min(1).max(128),expected_version:integer}).strict(),approve:z.object({expected_version:integer,reviewed_assessment_id:z.string().min(1).max(128).optional(),reviewed_assessment_hash:hash.optional(),reviewed_decision_id:z.string().min(1).max(128).optional(),reviewed_decision_hash:hash.optional(),reason_text:z.string().min(1).max(1024)}).strict().refine(b=>Boolean(b.reviewed_assessment_id&&b.reviewed_assessment_hash&&!b.reviewed_decision_id&&!b.reviewed_decision_hash)||Boolean(b.reviewed_decision_id&&b.reviewed_decision_hash&&!b.reviewed_assessment_id&&!b.reviewed_assessment_hash)),release:z.object({expected_version:integer,packet_sha256:hash,pae_instruction_hash:hash,confirmation:z.literal('APPROVE EXACT TESTNET SETTLEMENT PROXY')}).strict(),execute:z.object({expected_version:integer,packet_sha256:hash,pae_instruction_hash:hash,confirmation:z.literal('SUBMIT EXACT TESTNET SETTLEMENT PROXY')}).strict(),reconcile:z.object({idempotency_key:z.string().min(1).max(256).regex(/^[\x20-\x7e]+$/),pae_instruction_hash:hash}).strict()};
type Action=keyof typeof bodies;
export interface FinancialDependencies {
 guard:(request:Request,post:boolean)=>Promise<AuthContext>;
 source:()=>FinancialSourceAdmission;
 requester:()=>FinancialRequesterBinding;
 /** Trusted reconcile-only context (ACTIVE or actually EXPIRED, never FUTURE). Chosen by the action kind, never by the request. */
 reconcileSource?:()=>FinancialSourceAdmission;
 reconcileRequester?:()=>FinancialRequesterBinding;
 load:(source:FinancialSourceAdmission,revalidate:()=>Promise<void>,assertAtSend?:(approval:PaymentReleaseApproval|undefined)=>void,revalidateLinkAtSend?:()=>Promise<void>)=>Promise<DemoState>;
 preflight?:typeof runJ2aReadOnlyPreflight;
 /** Trusted capability boundary; never selected by HTTP or environment flags. */
 verifyLink?:(source:FinancialSourceAdmission)=>Promise<void>;
 providerBoundary?:(revalidate:()=>Promise<void>)=>Promise<void>;
}
function reply(code:string,status:number,extra:Record<string,unknown>={}){return Response.json({code,...extra},{status,headers:{'Cache-Control':'no-store',Pragma:'no-cache'}});}
function releaseReply(approval:PaymentReleaseApproval){
 const {approved_at,expires_at,actor_id}=approval.record;
 return reply('PAYMENT_RELEASE_APPROVED',200,{payment_release_approval:{approved_at,expires_at,actor_id}});
}
/** One capability adapter; no hosted switch and no body-supplied actor identity. */
export function createFinancialHandlers(deps:FinancialDependencies){
 return async function action(kind:Action,request:Request,id?:string):Promise<Response>{
  if(request.method!=='POST')return methodNotAllowed();
  let effectsStarted=false,releaseSaveStarted=false;
  try{
   const auth=await deps.guard(request,true);
   requireJson(request);const raw=await readBoundedJson(request,4096);const parsed=bodies[kind].safeParse(raw);if(!parsed.success)throw new AccessError('BODY_REJECTED',400);const body=parsed.data;
   const selected=kind==='preflight'?(body as z.infer<typeof bodies.preflight>).obligation_id:id;
   if(!selected||!/^TESTNET-CONTROLLED-[A-Za-z0-9_.:-]+$/.test(selected)||selected.length>128)throw new AccessError('CONTROLLED_SOURCE_REQUIRED',403);
   // Only reconciliation of an already recorded execution may use the expired-tolerant loaders; every other action stays ACTIVE-only.
   const readSource=kind==='reconcile'?(deps.reconcileSource??deps.source):deps.source,readRequester=kind==='reconcile'?(deps.reconcileRequester??deps.requester):deps.requester;
   const source=readSource(),requester=readRequester();
   const sourceIdentity=JSON.stringify(source),requesterIdentity=JSON.stringify(requester);
   if(source.source.obligation_id!==selected||source.organization_id!==requester.organization_id||source.namespace!==requester.namespace||!sameFinancialBinding(source,requester)||source.intent_id!==requester.intent_id||(kind==='reconcile'&&(source.valid_from!==requester.valid_from||source.expires_at!==requester.expires_at))||requester.operator_key!==auth.session.operator_key||requester.credential_version!==auth.session.credential_version)throw new AccessError('REQUESTER_UNVERIFIED',403);
   // Reconciliation reads an existing exact execution; mutable genuine advisory
   // currentness gates new actions, never status recovery of an UNKNOWN send.
   const checkContext=async()=>{await auth.revalidate();if(kind!=='reconcile'&&kind!=='renew'&&source.linked_instruction){if(!deps.verifyLink)throw new AccessError('LINK_SOURCE_UNVERIFIED',403);await deps.verifyLink(source);}if(JSON.stringify(readSource())!==sourceIdentity||JSON.stringify(readRequester())!==requesterIdentity)throw new AccessError('FINANCIAL_AUTHORITY_CHANGED',403);};
   let requiredRelease: {record_sha256:string; expected:Partial<PaymentReleaseRecord> & Partial<PaymentReleaseBinding>} | undefined;
   let load!:()=>Promise<DemoState>;
   const resolveCurrentRequester=async()=>{await checkContext();const current=await load();const actor=current.resolveDesignatedApprover(DEMO_ORGANIZATION_ID);if(actor.actor_id!==requester.actor_id)throw new AccessError('REQUESTER_UNVERIFIED',403);
    if(current.getSealedPae(selected)){
     const authorization=current.getAuthorizationArtifacts(selected);
     const humanReview=current.store.exportSnapshot().review_decisions?.find(r=>r.hash===authorization?.approval_record.review_decision_hash&&r.record.decision_id===authorization?.approval_record.review_decision_id);
     const assessment=current.store.getAssessmentHistory(DEMO_ORGANIZATION_ID,selected).find(a=>a.hash===authorization?.approval_record.assessment_hash);
     if(humanReview){if(humanReview.record.source_record_sha256!==contentHash(source.source)||kind!=='reconcile'&&(humanReview.record.operator_key!==auth.session.operator_key||humanReview.record.credential_version!==auth.session.credential_version))throw new AccessError('CURRENT_REVIEW_REQUIRED',409);}
     else if(!assessment?.record.race||!authorization||authorization.approval_record.assessment_hash!==assessment.hash||!(kind==='reconcile'?controlledProvenanceMatchesAdmission(assessment.record.race.evidence.authoritative_facts.controlled_instruction,source):hasCurrentControlledInstruction({...buildFinanceAgentContext(source.source,assessment.record.aggregate_version),...assessment.record.race.evidence.authoritative_facts})))throw new AccessError('CONTROLLED_ASSESSMENT_PROVENANCE_REQUIRED',409);
    }
    if(requiredRelease && (!matchesPaymentRelease(current.getPaymentReleaseApproval(selected),requiredRelease.expected)||current.getPaymentReleaseApproval(selected)?.record_sha256!==requiredRelease.record_sha256))throw new AccessError("PAYMENT_RELEASE_CHANGED",403);
    await checkContext();return actor;};
   const checkRequester=async()=>{await resolveCurrentRequester();};
   const assertAtSend=(approval:PaymentReleaseApproval|undefined)=>{
    if(!requiredRelease)throw new AccessError('PAYMENT_RELEASE_REQUIRED',403);
    if(JSON.stringify(readSource())!==sourceIdentity||JSON.stringify(readRequester())!==requesterIdentity||!matchesPaymentRelease(approval,requiredRelease.expected)||approval?.record_sha256!==requiredRelease.record_sha256)throw new AccessError('PAYMENT_RELEASE_CHANGED',403);
   };
   load=()=>deps.load(source,checkRequester,assertAtSend,source.linked_instruction&&kind!=='reconcile'&&kind!=='renew'?checkContext:undefined);
   const state=await load();const actor=state.resolveDesignatedApprover(DEMO_ORGANIZATION_ID);
   if(actor.actor_id!==requester.actor_id)throw new AccessError('REQUESTER_UNVERIFIED',403);
   await checkContext();
   if(kind==='preflight')await deps.providerBoundary?.(checkContext);
   if(kind==='renew'){
    const input=body as z.infer<typeof bodies.renew>,key=z.uuid().safeParse(request.headers.get('Idempotency-Key'));
    if(!key.success)throw new AccessError('BODY_REJECTED',400);
    const pae=state.getSealedPae(selected),previousEvent=state.getRecoveryEvents().find(e=>e.request_id===key.data);
    if(!previousEvent&&(!pae||pae.payload.idempotency_key!==input.predecessor_key))throw new AccessError('SUCCESSOR_IDENTITY_MISMATCH',409);
    await checkRequester();
    let event;try{event=state.prepareExecutionSuccessor(selected,input.expected_version,key.data,contentHash({selected,input}),actor.actor_id,input.reason);}catch{throw new AccessError('ORIGINAL_EFFECTS_UNVERIFIED',409);}
    effectsStarted=true;await state.flush();const committed=await load();if(!committed.getRecoveryEvents().some(e=>e.request_id===key.data&&e.predecessor_sha256===event.predecessor_sha256))throw new Error('Successor unverified');
    return reply('PAYMENT_SUCCESSOR_PREPARED',201,{predecessor_key:event.predecessor_key,aggregate:committed.store.get(DEMO_ORGANIZATION_ID,selected),next_action:'CURRENT_REVIEW_AND_READINESS_REQUIRED'});
   }
   if(kind==='review'){
    const input=body as z.infer<typeof bodies.review>,aggregate=state.store.get(DEMO_ORGANIZATION_ID,selected);
    const requestId=z.uuid().safeParse(request.headers.get('Idempotency-Key'));
    if(!requestId.success)throw new AccessError('BODY_REJECTED',400);
    const previous=state.store.exportSnapshot().review_decisions?.find(r=>r.record.request_id===requestId.data);
    const requestHash=contentHash({selected,input});
    if(previous){if(previous.record.request_sha256!==requestHash)throw new AccessError('REVIEW_REQUEST_CONFLICT',409);return reply('HUMAN_REVIEW_RECORDED',200,{review_decision:previous.record,review_decision_hash:previous.hash});}
    if(aggregate.aggregate_version!==input.expected_version)throw new AccessError('STALE_STATE',409);
    const evidence=new Set(source.source.source_evidence.map(e=>e.evidence_id));
    if(input.evidence_ids.some(e=>!evidence.has(e))||input.finding_dispositions.some(d=>d.evidence_ids.some(e=>!evidence.has(e))))throw new AccessError('REVIEW_EVIDENCE_MISMATCH',409);
    const assessment=state.store.getCurrentAssessment(DEMO_ORGANIZATION_ID,selected);
    const findings=assessment?.record.race?.result.validated_findings??[];
    // A factual finding needs a new corrected source, never an advisory dismissal.
    if(!humanFindingDispositionsValid(input,findings,evidence))throw new AccessError('FINDING_RESOLUTION_REQUIRED',409);
    if(input.mode==='AI_ASSISTED_REVIEW'&&assessment?.record.provider_mode!=='LIVE_AI')throw new AccessError('AI_ADVICE_UNAVAILABLE',409);
    await checkRequester();
    if(input.escalation_owner_actor_id&&input.decision!=='ESCALATE')throw new AccessError('ESCALATION_OWNER_INVALID',400);
    if(input.escalation_owner_actor_id&&input.escalation_owner_actor_id!==actor.actor_id)throw new AccessError('ESCALATION_OWNER_UNAVAILABLE',409);
    const {expected_version:ignoredVersion,expected_review_hash,...decisionInput}=input;if(input.decision==='ESCALATE')decisionInput.escalation_owner_actor_id=actor.actor_id;
    const now=Date.now(),sealed=state.store.recordReviewDecision({...decisionInput,...(expected_review_hash?{supersedes_review_hash:expected_review_hash}:{}),schema_version:'HUMAN-REVIEW-1',provenance:'HUMAN',decision_id:`REV-${requestId.data}`,request_id:requestId.data,request_sha256:requestHash,organization_id:source.organization_id,obligation_id:selected,aggregate_version:aggregate.aggregate_version,source_record_sha256:contentHash(source.source),actor_id:actor.actor_id,actor_role:actor.actor_role,authority_version:actor.authority_version,operator_key:auth.session.operator_key,credential_version:auth.session.credential_version,policy_version:aggregate.policy_version,created_at:new Date(now).toISOString(),expires_at:new Date(Math.min(now+1800000,Date.parse(source.expires_at),Date.parse(requester.expires_at))).toISOString()} as never);
    effectsStarted=true;await state.flush();
    const readback=await load();if(!readback.store.exportSnapshot().review_decisions?.some(r=>r.hash===sealed.hash))throw new Error('Review readback unverified');
    return reply('HUMAN_REVIEW_RECORDED',201,{review_decision:sealed.record,review_decision_hash:sealed.hash});
   }
   if(kind==='assess'){
    effectsStarted=true;
    return await createAssessmentHandler(load,checkRequester)(new Request(request.url,{method:"POST",headers:request.headers,body:JSON.stringify(body)}),{params:Promise.resolve({id:selected})});
   }
   if(kind==='preflight'){
    effectsStarted=true;
    return await createSelectedPreflightHandler(load,checkRequester,deps.preflight)(new Request(request.url,{method:"POST",headers:request.headers,body:JSON.stringify(body)}));
   }
   if(kind==='approve'){
    const input=body as z.infer<typeof bodies.approve>,humanReview=state.store.getCurrentReviewDecision(DEMO_ORGANIZATION_ID,selected),aggregate=state.store.get(DEMO_ORGANIZATION_ID,selected),proxy=state.getSettlementProxy(selected),assessment=state.store.getCurrentAssessment(DEMO_ORGANIZATION_ID,selected);
    if(!proxy||proxy.mapped_aggregate_version!==aggregate.aggregate_version||proxy.preflight.amount!==source.principal||proxy.preflight.organization_id!==DEMO_ORGANIZATION_ID||proxy.preflight.obligation_id!==selected||proxy.preflight.source_amount!==source.source.amount||proxy.preflight.source_currency!==source.source.currency||!aggregate.evidence_hashes.includes(proxy.preflight.evidence_sha256)||aggregate.destination_ref!==`ARC-TESTNET-SETTLEMENT-PROXY:${proxy.preflight.destination_wallet.id}`||aggregate.destination_address.toLowerCase()!==proxy.preflight.destination_wallet.address.toLowerCase())throw new AccessError('CURRENT_PROXY_REQUIRED',409);
    if(!humanReview&&(!assessment||assessment.record.aggregate_version!==String(aggregate.aggregate_version)||assessment.record.provider_mode!=='LIVE_AI'||assessment.record.decision!=='PAY'||assessment.record.missing_evidence.length||!assessment.record.race||assessment.record.race.result.decision!=='PAY'||assessment.record.race.result.validated_findings.length||assessment.record.race.remediation.length||assessment.record.race.evidence.authoritative_facts.obligation_id!==selected||assessment.record.race.evidence.authoritative_facts.aggregate_version!==String(aggregate.aggregate_version)))throw new AccessError('CURRENT_LIVE_ASSESSMENT_REQUIRED',409);
    if(!humanReview&&(state.store.findUnassessedObligation(DEMO_ORGANIZATION_ID)||state.store.findCommittedCandidateExcluding(DEMO_ORGANIZATION_ID,selected)))throw new AccessError('COMPETING_OR_UNASSESSED_INTENT',409);
    if(!humanReview&&!hasCurrentControlledInstruction({...buildFinanceAgentContext(source.source,aggregate.aggregate_version),...assessment!.record.race!.evidence.authoritative_facts}))throw new AccessError("CONTROLLED_ASSESSMENT_PROVENANCE_REQUIRED",409);
    const currentActor=await resolveCurrentRequester();
    const result=approveAndSealPae(state.store,DEMO_SIGNING_KEY_ID,{organizationId:DEMO_ORGANIZATION_ID,obligationId:selected,expectedVersion:input.expected_version,reviewedAssessmentId:(input.reviewed_decision_id??input.reviewed_assessment_id)!,reviewedAssessmentHash:(input.reviewed_decision_hash??input.reviewed_assessment_hash)!,actorId:currentActor.actor_id,actorRole:currentActor.actor_role,authorityVersion:currentActor.authority_version,policyVersion:aggregate.policy_version,reasonText:input.reason_text},state.trustedKeys);
    state.recordAuthorization({approval_record:result.approvalRecord.record,approval_record_hash:result.approvalRecord.approval_record_hash,assurance_record:result.assuranceRecord.record,assurance_hash:result.assuranceRecord.assurance_hash,sealed_pae:result.sealed});
    effectsStarted=true;await state.flush();
    const packet=getCurrentSettlementProxyPacket(state,selected);if(!packet)throw new Error();
    return reply('EXACT_PACKET_REVIEW_REQUIRED',200,{aggregate:result.aggregate,pae_instruction_hash:result.sealed.instruction_hash,packet_sha256:packet.packet_sha256,packet:packet.packet});
   }
   const sealed=state.getSealedPae(selected);if(!sealed)throw new AccessError('CURRENT_PAE_REQUIRED',409);
   const releaseIdentity = {
    ...paymentReleaseBindings(source,requester),organization_id:source.organization_id,obligation_id:selected,namespace:source.namespace,
    pae_instruction_hash:sealed.instruction_hash,idempotency_key:sealed.payload.idempotency_key,
    actor_id:actor.actor_id,actor_role:actor.actor_role,authority_version:actor.authority_version,
    operator_key:auth.session.operator_key,credential_version:auth.session.credential_version,
   };
   if(kind==='release'){
    const aggregate=state.store.get(DEMO_ORGANIZATION_ID,selected);
    if(aggregate.state!=='AUTHORIZED'||aggregate.pae_state!=='UNUSED'||aggregate.execution_state!=='NONE')throw new AccessError('PAYMENT_RELEASE_UNAVAILABLE',409);
    const approvedActor=sealed.payload.approval_evidence[0];
    if(approvedActor.actor_id!==actor.actor_id||approvedActor.actor_role!==actor.actor_role||approvedActor.authority_version!==actor.authority_version)throw new AccessError('PAYMENT_AUTHORITY_CHANGED',409);
    const input=body as z.infer<typeof bodies.release>,packet=getCurrentSettlementProxyPacket(state,selected);
    if(state.worker.getExecutionRecord(sealed.payload.idempotency_key))throw new AccessError('EXECUTION_ALREADY_RECORDED',409);
    if(state.store.isExecutionKillSwitched(DEMO_ORGANIZATION_ID,selected)||!packet||packet.packet_sha256!==input.packet_sha256||sealed.instruction_hash!==input.pae_instruction_hash||state.store.get(DEMO_ORGANIZATION_ID,selected).aggregate_version!==input.expected_version)throw new AccessError('EXACT_PACKET_NOT_APPROVED',403);
    const expected={...releaseIdentity,aggregate_version:input.expected_version,packet_sha256:input.packet_sha256};
    const previous=state.getPaymentReleaseApproval(selected);
    if(previous){
     if(!matchesPaymentRelease(previous,expected))throw new AccessError('PAYMENT_RELEASE_RENEWAL_REQUIRED',409);
     await checkRequester();return releaseReply(previous);
    }
    await checkRequester();
    const expiry=Math.min(Date.parse(sealed.payload.expiry),Date.parse(source.expires_at),Date.parse(requester.expires_at),actor.expires_at?Date.parse(actor.expires_at):Infinity);
    const now=Date.now();if(!Number.isFinite(expiry)||expiry<=now)throw new AccessError('PAYMENT_RELEASE_EXPIRED',409);
    const approval=sealPaymentRelease({...expected,schema_version:'PORTAL-RELEASE-2',approved_at:new Date(now).toISOString(),expires_at:new Date(expiry).toISOString()});
    state.recordPaymentReleaseApproval(approval);effectsStarted=true;releaseSaveStarted=true;await state.flush();
    requiredRelease={record_sha256:approval.record_sha256,expected};await checkRequester();
    return releaseReply(approval);
   }
   if(kind==='reconcile'){
    const input=body as z.infer<typeof bodies.reconcile>;
    if(input.idempotency_key!==sealed.payload.idempotency_key||input.pae_instruction_hash!==sealed.instruction_hash)throw new AccessError('IDENTITY_MISMATCH',409);
    const previous=state.worker.getExecutionRecord(input.idempotency_key);if(!previous)throw new AccessError('NO_RECORDED_EXECUTION',409);
    if(sealed.payload.organization_id!==source.organization_id||
       sealed.payload.obligation_ids.length!==1||sealed.payload.obligation_ids[0]!==selected||
       previous.obligation_id!==selected||previous.idempotency_key!==sealed.payload.idempotency_key||
       previous.atomic_amount!==sealed.payload.atomic_amount||
       !sameEvmAddressIdentity(previous.destination_address,sealed.payload.destination_address))throw new AccessError('IDENTITY_MISMATCH',409);
    // Only exact uncertain executions recover without a fresh operator funding
    // observation. Existing provider token identity and authority checks remain.
    const uncertain=previous.status==='UNKNOWN'||previous.status==='SUBMITTING'||previous.status==='FAILED';

    await checkRequester();effectsStarted=true;
    if(previous.status==='SUBMITTING')await state.worker.recoverSubmittingByIdempotencyKey(input.idempotency_key,DEMO_ORGANIZATION_ID);
    const execution=uncertain?await state.worker.reconcilePendingByIdempotencyKey(input.idempotency_key,DEMO_ORGANIZATION_ID):previous;
    return reply(execution.status==='SETTLED'?'RECONCILED':'RECONCILIATION_ONLY',execution.status==='UNKNOWN'?202:200,{execution});
   }
   const input=body as z.infer<typeof bodies.execute>,packet=getCurrentSettlementProxyPacket(state,selected);
   const prior=state.worker.getExecutionRecord(sealed.payload.idempotency_key);
   if(prior)return reply('EXECUTION_ALREADY_RECORDED',409,{execution:prior,execution_gate:'RECONCILIATION_ONLY'});
   if(!packet||packet.packet_sha256!==input.packet_sha256||sealed.instruction_hash!==input.pae_instruction_hash||state.store.get(DEMO_ORGANIZATION_ID,selected).aggregate_version!==input.expected_version)throw new AccessError('EXACT_PACKET_NOT_APPROVED',403);
   const expected={...releaseIdentity,aggregate_version:input.expected_version,packet_sha256:input.packet_sha256};
   const release=state.getPaymentReleaseApproval(selected);
   if(!matchesPaymentRelease(release,expected))throw new AccessError('EXACT_PACKET_NOT_APPROVED',403);
   requiredRelease={record_sha256:release!.record_sha256,expected};
   await checkRequester();await deps.providerBoundary?.(checkRequester);await checkRequester();effectsStarted=true;const execution=await state.worker.execute(sealed);
   return reply(execution.status==='SETTLED'?'RECONCILED':'RECONCILIATION_ONLY',execution.status==='UNKNOWN'?202:execution.status==='BLOCKED'?409:200,{execution});
  }catch(error){
   if(releaseSaveStarted)return reply('OUTCOME_UNVERIFIED',503,{retry_submission:false,release_gate:'READ_ONLY_CONFIRMATION_REQUIRED',error:'Release approval may have been recorded. Refresh current status before taking another action.'});
   if(error instanceof AccessError){if(effectsStarted)return reply('OUTCOME_UNVERIFIED',503,{execution_gate:'RECONCILIATION_ONLY',retry_submission:false});return reply(error.code,error.status);}
   if(error instanceof DemoStatePersistenceError||effectsStarted)return reply('OUTCOME_UNVERIFIED',503,{execution_gate:'RECONCILIATION_ONLY',retry_submission:false});
   if(error instanceof AuthorityError||error instanceof ExecutionBlockedError)return reply(error.code,409);
   if(error instanceof AssuranceFailedError)return reply('ASSURANCE_NOT_PASS',422);
   return reply('FINANCIAL_AUTHORITY_UNAVAILABLE',503);
  }
 };
}
export const financialHandlers=createFinancialHandlers({verifyLink:verifyLinkedActivation,providerBoundary:async(revalidate)=>{const {readOperatorBalance}=await import('./operator-wallet-balance');await readOperatorBalance(revalidate);},guard:operatorHandlers.guard,source:loadFinancialSourceAdmission,requester:loadFinancialRequesterBinding,reconcileSource:loadFinancialSourceAdmissionForReconcile,reconcileRequester:loadFinancialRequesterBindingForReconcile,load:async(source,revalidate,assertAtSend,revalidateLinkAtSend)=>{
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new AccessError('STATE_UNAVAILABLE',503);
 const repository=new SupabaseDemoStateRepository(url,key);try{await repository.assertRecoveryWorkflowCapability();}catch{throw new AccessError('RECOVERY_MIGRATION_REQUIRED',503);}
 return loadExistingFinancialState(repository,source.namespace,[source.source],{revalidateRequester:revalidate,assertRequesterAtProviderSend:assertAtSend,revalidateLinkedInstructionAtProviderSend:revalidateLinkAtSend});
}});
