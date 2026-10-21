import {stage2Status,providerCategory} from '../domain/assessment-status';
import {humanFindingDispositionsValid,HUMAN_ADVISORY_CODES} from '../domain/review-findings';
import {AssessmentState} from './assessment-state';
import {createAssessmentHandler} from './legacy-routes/obligations/[id]/assess/route';
import {loadExistingDemoState} from './load-existing-demo-state';
import {projectObligationDetail} from './obligation-read-model';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AuthorityStore,AuthorityError} from '../authority/aggregate';
import {ActorAuthorityRegistry} from '../authority/actor-authority';
import {sourceFieldsSchema,sourceIdentity,parseSourceRevisions,sourceRevisionRecord,effectiveSourceRecords,type SourceRevision} from '../domain/source-revision';
import {reviewInputSchema} from '../domain/review-decision';
import {contentHash} from '../domain/linked-instruction';
import {convertSourceToSettlement} from '../domain/currency-conversion';
import {parseDemoStateSnapshot,type DemoStateSnapshot} from './demo-state';
import {loadOperatorSourceRecords,type OperatorSourceView} from './operator-source-records';
import {operatorHandlers,privateJson,accessFailure,type AuthContext} from './operator-auth';
import {AccessError,readBoundedJson,requireJson} from './route-access-policy';
import {SupabaseDemoStateRepository,DemoStateConflictError} from './supabase-demo-state-repository';
import {sealLinkedInstruction,parseLinkedInstructions} from '../domain/linked-instruction';

const org='ORG-DEMO-001';
type Repository=Pick<SupabaseDemoStateRepository,'loadExisting'|'compareAndSet'>&Partial<Pick<SupabaseDemoStateRepository,'assertRecoveryWorkflowCapability'>>;
const saveSchema=z.object({expected_revision:z.number().int().min(0),expected_version:z.number().int().positive().optional(),fields:sourceFieldsSchema,reason:z.string().trim().min(1).max(1024)}).strict();
type SourceSnapshot=DemoStateSnapshot&{source_ingress_anchor?:string};
interface Dependencies {guard:(r:Request,post:boolean)=>Promise<AuthContext>;source:()=>OperatorSourceView|undefined;repository:()=>Repository}
/** The owner-approved V4 ingress grants source/review commands only. Financial
 * activation still requires the independently admitted exact controlled child. */
export function createSourceWorkflowHandlers(deps:Dependencies){
 return async function handle(kind:'list'|'detail'|'save'|'review'|'draft'|'assess',request:Request,id?:string):Promise<Response>{
  let writing=false;
  try{
   const mutate=['save','review','draft','assess'].includes(kind),auth=await deps.guard(request,mutate),view=deps.source(),ingress=view?.source_ingress;
   if(!view||!ingress)throw new AccessError('SOURCE_INGRESS_NOT_ADMITTED',403);
   const fingerprint=contentHash(view),repository=deps.repository();
   let authoritySnapshot:DemoStateSnapshot|undefined,boundActorVersion:string|undefined,boundActorHash:string|undefined;
   let claimedTargets=new Set<string>();
   const requester=(state:DemoStateSnapshot)=>new ActorAuthorityRegistry(state.actor_authorities).resolve(org,ingress.actor_id);
   const activeActor=(actor:ReturnType<typeof requester>)=>actor?.status==='ACTIVE'&&actor.permissions.includes('T1_SINGLE_APPROVAL')&&Date.parse(actor.valid_from)<=Date.now()&&(actor.expires_at===null||Date.now()<Date.parse(actor.expires_at));
   const canWrite=()=>Boolean(authoritySnapshot?.actor_authority_registry_initialized&&activeActor(requester(authoritySnapshot))&&Date.parse(ingress.valid_from)<=Date.now()&&Date.now()<Date.parse(ingress.expires_at)&&ingress.operator_key===auth.session.operator_key&&ingress.credential_version===auth.session.credential_version&&(!auth.session.expires_at||Date.now()<Date.parse(auth.session.expires_at)));
   const boundary=()=>{if(contentHash(deps.source())!==fingerprint||(mutate&&(Date.now()<Date.parse(ingress.valid_from)||Date.now()>=Date.parse(ingress.expires_at))))throw new AccessError('SOURCE_INGRESS_EXPIRED_OR_CHANGED',403);
    if(mutate&&authoritySnapshot&&(!canWrite()||requester(authoritySnapshot)?.authority_version!==boundActorVersion||contentHash(requester(authoritySnapshot)??null)!==boundActorHash))throw new AccessError('SOURCE_PERMISSION_REQUIRED',403);};
   const claims=async(state:DemoStateSnapshot,retiredChecks?:Array<{instruction_id:string;namespace:string;revision:number}>)=>{
    const targets=new Set<string>();
    for(const receipt of state.linked_activation_receipts??[]){try{
     const childStored=await repository.loadExisting(receipt.namespace),child=parseDemoStateSnapshot(childStored.snapshot),ledger=child.execution_ledger.filter(e=>e.obligation_id===receipt.instruction_id);
     const retired=ledger.length>0&&ledger.every(e=>child.recovery_events?.some(event=>event.obligation_id===receipt.instruction_id&&event.predecessor_key===e.idempotency_key&&event.predecessor_sha256===contentHash(e))&&((e.status==='BLOCKED'&&e.dispatch_evidence==='PROVEN_NOT_DISPATCHED'&&e.provider_ref===null)||(e.status==='FAILED'&&e.provider_evidence?.status==='FAILED'&&typeof e.provider_evidence.network_fee==='string')))&&!child.sealed_paes.some(([target])=>target===receipt.instruction_id);
     if(!retired)targets.add(receipt.source_obligation_id);else if(receipt.source_obligation_id===id)retiredChecks?.push({instruction_id:receipt.instruction_id,namespace:receipt.namespace,revision:childStored.revision});
    }catch{targets.add(receipt.source_obligation_id);}}
    return targets;
   };
   const revalidate=async()=>{
    await auth.revalidate();boundary();
    if(authoritySnapshot){const latest=await repository.loadExisting(view.state_binding.namespace);authoritySnapshot=parseDemoStateSnapshot(latest.snapshot);claimedTargets=await claims(authoritySnapshot);const observedLinks=contentHash(authoritySnapshot.linked_activation_receipts??[]);await auth.revalidate();const final=await repository.loadExisting(view.state_binding.namespace);authoritySnapshot=parseDemoStateSnapshot(final.snapshot);if(mutate&&observedLinks!==contentHash(authoritySnapshot.linked_activation_receipts??[]))throw new AccessError('EXISTING_FINANCIAL_CLAIM',409);boundary();}
   };
   await revalidate();if(mutate){try{await repository.assertRecoveryWorkflowCapability?.();}catch{throw new AccessError('RECOVERY_MIGRATION_REQUIRED',503);}}
   const stored=await repository.loadExisting(view.state_binding.namespace),snapshot=parseDemoStateSnapshot(stored.snapshot) as SourceSnapshot;
   const anchor=contentHash({binding:view.state_binding,records:view.records});
   if(snapshot.source_ingress_anchor!==undefined){if(snapshot.source_ingress_anchor!==anchor)throw new AccessError('SOURCE_BINDING_CHANGED',409);}
   else if(stored.revision!==view.state_binding.revision||contentHash(snapshot.authority)!==view.state_binding.authority_sha256)throw new AccessError('SOURCE_BINDING_CHANGED',409);
   const store=AuthorityStore.fromSnapshot(snapshot.authority),rows=parseSourceRevisions(snapshot.source_revisions);
   const records=effectiveSourceRecords(view.records,rows),record=records.find(r=>r.obligation_id===id);
   authoritySnapshot=snapshot;
   const actor=requester(snapshot);boundActorVersion=actor?.authority_version;boundActorHash=contentHash(actor??null);
   const requirePermission=(permission:typeof ingress.permissions[number])=>{boundary();if(!canWrite()||!ingress.permissions.includes(permission))throw new AccessError('SOURCE_PERMISSION_REQUIRED',403);};
   const currentRows=(target:string)=>rows.filter(r=>r.obligation_id===target);
   const active=(target:string)=>currentRows(target).findLast(r=>r.activation==='CURRENT');
   // An immutable link is a proposal. Before any child financial command, the
   // activation gate CAS-appends a receipt here. Once present it cannot vanish
   // when an owner packet is withdrawn or the process restarts.
   const retiredChecks:Array<{instruction_id:string;namespace:string;revision:number}>=[];claimedTargets=await claims(snapshot,retiredChecks);
   const financialClaim=(target:string)=>claimedTargets.has(target)||(authoritySnapshot??snapshot).execution_ledger.some(e=>e.obligation_id===target);
   const validReview=(target:string,review=store.getCurrentReviewDecision(org,target))=>{
    if(!review||!authoritySnapshot)return undefined;
    const r=review.record,owner=new ActorAuthorityRegistry(authoritySnapshot.actor_authorities).resolve(org,r.actor_id),facts=effectiveSourceRecords(view.records,parseSourceRevisions(authoritySnapshot.source_revisions)).find(v=>v.obligation_id===target),aggregate=AuthorityStore.fromSnapshot(authoritySnapshot.authority).get(org,target);
    return activeActor(owner)&&owner?.actor_role===r.actor_role&&owner.authority_version===r.authority_version&&r.operator_key===ingress.operator_key&&r.credential_version===ingress.credential_version&&r.aggregate_version===aggregate.aggregate_version&&r.policy_version===aggregate.policy_version&&facts&&r.source_record_sha256===contentHash(facts)&&Date.parse(r.created_at)<=Date.now()&&Date.now()<Date.parse(r.expires_at)?review:undefined;
   };
   const aiDenial=(state:DemoStateSnapshot,target:string,retained=false)=>{
    if(retained)return null;
    if(financialClaim(target)||state.sealed_paes.some(([id])=>id===target))return 'EXISTING_FINANCIAL_CLAIM';
    if(AuthorityStore.fromSnapshot(state.authority).getCurrentReviewDecision(org,target))return 'CURRENT_HUMAN_REVIEW_REQUIRED';
    if(state.assessment_operations.some(o=>o.obligation_id===target&&['RESERVED','UNKNOWN','PROVIDER_RESULT_DURABLE'].includes(o.status)))return 'UNRESOLVED_OPERATION';
    if(state.assessment_operations.filter(o=>o.obligation_id===target).length>=4)return 'GENUINE_ASSESSMENT_HISTORY_LIMIT';
    return null;
   };
   const projection=(target:string)=>{
    const aggregate=store.get(org,target),source=records.find(r=>r.obligation_id===target)!,review=validReview(target),revision=currentRows(target).at(-1);
    const assessed=store.getCurrentAssessment(org,target)?.record;
    const outcome=assessed?.source_record_sha256===contentHash(source)&&assessed.aggregate_version===String(aggregate.aggregate_version)?providerCategory(assessed.provider_outcome):undefined;
    const allowed_actions=[] as string[];
    if(canWrite()&&ingress.permissions.includes('REVIEW_SOURCE')&&(authoritySnapshot??snapshot).assessment_operations.some(o=>o.obligation_id===target))allowed_actions.push('OBSERVE_AI_REQUEST');
    if(canWrite()&&ingress.permissions.includes('CORRECT_SOURCE'))allowed_actions.push('EDIT_SOURCE');
    if(canWrite()&&ingress.permissions.includes('REVIEW_SOURCE')&&!aiDenial(authoritySnapshot??snapshot,target))allowed_actions.push('REQUEST_AI_ADVICE');
    if(canWrite()&&ingress.permissions.includes('REVIEW_SOURCE')&&(!review||['ESCALATE','NEEDS_CORRECTION'].includes(review.record.decision))&&!financialClaim(target))allowed_actions.push('MANUAL_REVIEW');
    if(canWrite()&&ingress.permissions.includes('REVIEW_SOURCE')&&review?.record.decision==='ACCEPT_FOR_AUTHORIZATION'&&!financialClaim(target))allowed_actions.push('PREPARE_CONTROLLED_INSTRUCTION');
    const blockers=financialClaim(target)?[{code:'EXISTING_FINANCIAL_CLAIM',stage:'RECONCILIATION',scope:target,owner:'Treasury Operations',remedy:'Recover the existing controlled instruction; proposed source changes remain draft.',resume_predicate:'Authoritative original-operation reconciliation',observed_at:new Date().toISOString()}]:[];
    return {...(outcome?{stage2_provider_outcome:outcome}:{}),source_verification:'AUTHENTICATED_OPERATOR_ASSERTION_NOT_INDEPENDENT_VERIFICATION',payer_verification:'UNVERIFIED',obligation:source,aggregate,source_revision:revision??null,active_source_revision:active(target)??null,superseded_review_hash:store.getCurrentReviewDecision(org,target)?.hash??null,stage2_status:stage2Status(!canWrite()?'SOURCE_PERMISSION_REQUIRED':review?.record.decision==='ACCEPT_FOR_AUTHORIZATION'?'HUMAN_REVIEW_CURRENT':(aiDenial(authoritySnapshot??snapshot,target)==='UNRESOLVED_OPERATION'?(authoritySnapshot??snapshot).assessment_operations.find(o=>o.obligation_id===target&&['RESERVED','UNKNOWN','PROVIDER_RESULT_DURABLE'].includes(o.status))?.status:aiDenial(authoritySnapshot??snapshot,target))??'READY_FOR_REVIEW'),current_review_decision:review??null,advisory_action_eligible:allowed_actions.includes('REQUEST_AI_ADVICE'),review_findings:(store.getCurrentAssessment(org,target)?.record.race?.result.validated_findings??[]).map(f=>({...f,advisory:HUMAN_ADVISORY_CODES.has(f.code)})),allowed_actions,blockers,financial_action_eligible:false,genuine_business_status:'OUTSTANDING',service_fulfillment:'UNVERIFIED'};
   };
   if(kind==='list'){await revalidate();return privateJson({obligations:records.map(r=>({...r,...projection(r.obligation_id),source_group:'GENUINE_COMPANY',assessed:Boolean(store.getCurrentAssessment(org,r.obligation_id)),decision:store.getCurrentAssessment(org,r.obligation_id)?.record.decision??null,provider_mode:store.getCurrentAssessment(org,r.obligation_id)?.record.provider_mode??null})),assessed_count:records.filter(r=>store.getCurrentAssessment(org,r.obligation_id)).length,total_count:records.length,allowed_actions:canWrite()&&ingress.permissions.includes('CREATE_SOURCE')?['CREATE_SOURCE']:[]});}
   if(kind==='detail'){
    if(!record)throw new AccessError('SOURCE_NOT_FOUND',404);
    const state=await loadExistingDemoState({call:async()=>({revision:stored.revision,snapshot})},view.state_binding.namespace,records);
    const response=projectObligationDetail(state,id!,false,undefined,'GENUINE_COMPANY');
    if(!response.ok)return response;
    await revalidate();return privateJson({...await response.json(),...projection(id!),source_revision_history:currentRows(id!),review_decision_history:store.exportSnapshot().review_decisions?.filter(r=>r.record.obligation_id===id)??[]});
   }
   if(kind==='assess'){
    requirePermission('REVIEW_SOURCE');if(!record||!id)throw new AccessError('SOURCE_NOT_FOUND',404);
    class CurrentSourceAssessmentState extends AssessmentState {
      constructor(private current:DemoStateSnapshot,private revision:number){super(AuthorityStore.fromSnapshot(current.authority),new Map(current.assessment_operations.map(o=>[o.idempotency_key,structuredClone(o)])),current.late_assessment_results??[]);}
      getRecord(target:string){return effectiveSourceRecords(view!.records,parseSourceRevisions(this.current.source_revisions)).find(r=>r.obligation_id===target);}
      sourceRecordHash(target:string){const r=this.getRecord(target);return r?contentHash(r):undefined;}
      hasLivePaeAuthority(target:string){return this.current.sealed_paes.some(([id])=>id===target)||this.store.getCurrentReviewDecision(org,target)!==undefined||this.current.execution_ledger.some(e=>e.obligation_id===target);}
      admission(target:string,retained=false){requirePermission('REVIEW_SOURCE');const denial=aiDenial(this.current,target,retained);if(denial)throw new AccessError(denial==='UNRESOLVED_OPERATION'?'ASM-OPERATION-UNRESOLVED':denial,409);}
      reserveAssessmentOperation(key:string,target:string,version:number,at=Date.now()){
        this.admission(target,Boolean(this.getAssessmentOperation(key)));
        if(!this.getAssessmentOperation(key)&&this.current.assessment_operations.filter(o=>o.obligation_id===target).length>=4)throw new AccessError('GENUINE_ASSESSMENT_HISTORY_LIMIT',409);
        return super.reserveAssessmentOperation(key,target,version,at);
      }
      async flush(){await revalidate();this.current={...this.current,source_ingress_anchor:anchor,authority:this.store.exportSnapshot(),...(this.getLateAssessmentResults().length?{late_assessment_results:this.getLateAssessmentResults()}:{}),assessment_operations:[...this.assessmentOperations.values()].map(o=>structuredClone(o))};parseDemoStateSnapshot(this.current);writing=true;this.revision=await repository.compareAndSet(view!.state_binding.namespace,this.revision,this.current as unknown as Record<string,unknown>);await revalidate();}
    }
    const load=async()=>{await revalidate();const latest=await repository.loadExisting(view.state_binding.namespace);const current=parseDemoStateSnapshot(latest.snapshot);await revalidate();return new CurrentSourceAssessmentState(current,latest.revision);};
    const key=request.headers.get('Idempotency-Key');
    // Fresh commands share the projection rule. Retained keys retain shared
    // authenticated receipt/sealing behavior and can never dispatch again.
    if(!key||!snapshot.assessment_operations.some(o=>o.idempotency_key===key)){
     const denial=aiDenial(authoritySnapshot??snapshot,id);if(denial)throw new AccessError(denial==='UNRESOLVED_OPERATION'?'ASM-OPERATION-UNRESOLVED':denial,409);
    }
    const response=await createAssessmentHandler(load,revalidate,{maxTransportAttempts:1,recheckReservationBeforeProvider:true,maxPersistenceAttempts:1,beforeProviderDispatch:(state)=>{
     requirePermission('REVIEW_SOURCE');const current=authoritySnapshot!;
     if(state.sourceRecordHash(id)!==contentHash(effectiveSourceRecords(view.records,parseSourceRevisions(current.source_revisions)).find(r=>r.obligation_id===id)))throw new AccessError('SOURCE_BINDING_CHANGED',409);
     const denial=aiDenial({...current,assessment_operations:current.assessment_operations.filter(o=>o.idempotency_key!==key)},id);if(denial)throw new AccessError(denial,409);
    }})(request,{params:Promise.resolve({id})});
    if(response.status===200){const body=await response.json();await revalidate();const committed=AuthorityStore.fromSnapshot(authoritySnapshot!.authority).getAssessmentHistory(org,id).find(a=>a.hash===body.assessment_hash&&a.record.assessment_id===`ASM-${key}`&&a.record.source_record_sha256===contentHash(record)&&a.record.aggregate_version===String(store.get(org,id).aggregate_version));
     return privateJson({...body,...(committed?.record.provider_outcome?{stage2_provider_outcome:providerCategory(committed.record.provider_outcome)}:{})},200);}
    return response;
   }
   requireJson(request);const body=await readBoundedJson(request,16384),requestId=z.uuid().safeParse(request.headers.get('Idempotency-Key'));
   if(!requestId.success)throw new AccessError('BODY_REJECTED',400);
   const requestHash=contentHash({kind,id:id??null,body});
   // SQL validates these child revisions under row locks in the same CAS. A
   // child cannot acquire fresh authority between the retirement observation
   // and this parent transition without making this command conflict.
   if(retiredChecks.length)snapshot.linked_retirement_checks=[...(snapshot.linked_retirement_checks??[]),...retiredChecks.map(check=>({...check,request_id:requestId.data}))];
   if(kind==='save'){
    requirePermission(id?'CORRECT_SOURCE':'CREATE_SOURCE');
    const parsed=saveSchema.safeParse(body);if(!parsed.success)return privateJson({code:'SOURCE_FIELDS_INVALID',fields:parsed.error.issues.map(i=>({field:i.path.join('.'),message:i.message}))},400);
    const input=parsed.data,priorRequest=rows.find(r=>r.request_id===requestId.data);
    if(priorRequest){if(priorRequest.request_sha256!==requestHash)throw new AccessError('SOURCE_REQUEST_CONFLICT',409);return privateJson({...projection(priorRequest.obligation_id),source_revision:priorRequest},200);}
    if(rows.length>=1000)throw new AccessError('SOURCE_HISTORY_LIMIT',409);
    if(id&&!record)throw new AccessError('SOURCE_NOT_FOUND',404);
    const prior=id?currentRows(id).at(-1):undefined;
    if(input.expected_revision!==(prior?.revision??0))throw new AccessError('SOURCE_REVISION_CONFLICT',409);
    if(id&&store.get(org,id).aggregate_version!==input.expected_version)throw new AccessError('STALE_STATE',409);
    const identity=sourceIdentity(input.fields);
    if(rows.some(r=>r.obligation_id!==id&&r.identity_sha256===identity))throw new AccessError('DUPLICATE_SOURCE_IDENTITY',409);
    // An existing immutable catalog identity must be corrected in its own lineage.
    if(!id&&view.records.some(r=>r.beneficiary_name?.trim().toLowerCase()===input.fields.supplier_name.toLowerCase()&&r.issue_date===(input.fields.kind==='INVOICE'?input.fields.invoice_issue_date:input.fields.service_date)))throw new AccessError('IMPORTED_SOURCE_REQUIRES_CORRECTION',409);
    const target=id??`PAYABLE-${randomUUID()}`,pending=Boolean(id&&financialClaim(id));
    const row:SourceRevision={schema_version:'SOURCE-REVISION-1',organization_id:org,obligation_id:target,revision:(prior?.revision??0)+1,fields:input.fields,identity_sha256:identity,parent_sha256:prior?contentHash(prior):record?contentHash(record):null,imported_source_sha256:prior?.imported_source_sha256??(record?contentHash(record):null),actor_id:actor!.actor_id,operator_key:auth.session.operator_key!,credential_version:auth.session.credential_version!,reason:input.reason,request_id:requestId.data,request_sha256:requestHash,created_at:new Date().toISOString(),activation:pending?'DRAFT_PENDING_FINANCIAL_RECOVERY':'CURRENT'};
    rows.push(row);parseSourceRevisions(rows);
    if(!pending){
     const conversion=convertSourceToSettlement(input.fields.amount,input.fields.currency);
     if(id){const previous=store.get(org,id);store.applyMaterialChange(org,id,previous.aggregate_version,{source_amount:input.fields.amount,source_currency:input.fields.currency,evidence_hashes:input.fields.evidence.map(e=>e.content_sha256),source_wallet_ref:input.fields.payer_circle_wallet_id,source_wallet_version:previous.source_wallet_version+1,source_wallet_status:'INACTIVE',destination_verification_status:'PENDING_VERIFICATION'});}
     else store.seed({organization_id:org,obligation_id:target,aggregate_version:1,state:'APPROVAL_PENDING',amount:conversion.settlementAmount,asset:'USDC',network:'ARC_TESTNET',counterparty_id:`CP-${target}`,counterparty_version:1,counterparty_status:'ON_HOLD',destination_ref:'UNVERIFIED',destination_version:1,destination_address:'0x'+'0'.repeat(40),destination_verification_status:'PENDING_VERIFICATION',destination_operational_status:'ON_HOLD',source_wallet_ref:input.fields.payer_circle_wallet_id,source_wallet_version:1,source_wallet_status:'INACTIVE',evidence_hashes:input.fields.evidence.map(e=>e.content_sha256),policy_version:'POLICY-P0-1',business_hold:false,security_freeze:false,external_settlement_state:'NONE',pae_state:'UNUSED',execution_state:'NONE',execution_idempotency_key:null,reviewed_aggregate_version:null,source_amount:input.fields.amount,source_currency:input.fields.currency,settlement_conversion_rate:conversion.conversionRate});
    }
    snapshot.source_revisions=rows;snapshot.authority=store.exportSnapshot();snapshot.source_ingress_anchor=anchor;
    if(Buffer.byteLength(JSON.stringify(snapshot))>1_750_000)throw new AccessError("SOURCE_HISTORY_CAPACITY",409);
    await revalidate();writing=true;await repository.compareAndSet(view.state_binding.namespace,stored.revision,snapshot as unknown as Record<string,unknown>);
    const readback=await repository.loadExisting(view.state_binding.namespace);const committed=parseSourceRevisions(readback.snapshot.source_revisions).find(r=>r.request_id===requestId.data);
    await revalidate();if(!committed||contentHash(committed)!==contentHash(row))throw new Error('Committed source unverified');
    return privateJson({source_revision:committed,committed:true,obligation:sourceRevisionRecord(committed),financial_action_eligible:false},201);
   }
   requirePermission('REVIEW_SOURCE');if(!record||!id)throw new AccessError('SOURCE_NOT_FOUND',404);
   if(kind==='review'){
    const input=reviewInputSchema.safeParse(body);if(!input.success)throw new AccessError('BODY_REJECTED',400);
    // Access/ownership/permission checks above still apply. Receipt recovery
    // precedes new-command currentness and performs no CAS or authority change.
    const receipt=store.getReviewDecisionReceipt(org,id,requestId.data,requestHash);
    if(receipt){await revalidate();return privateJson({review_decision:receipt.record,review_decision_hash:receipt.hash,replayed:true,historical:true,receipt_only:true,current_authorization:false},200);}
    const aggregate=store.get(org,id),sourceHash=contentHash(record);
    if(input.data.mode==='AI_ASSISTED_REVIEW'&&store.getCurrentAssessment(org,id)?.record.provider_mode!=='LIVE_AI')throw new AccessError('AI_ADVICE_UNAVAILABLE',409);
    if(financialClaim(id))throw new AccessError('EXISTING_FINANCIAL_CLAIM',409);
    const evidence=new Set(record.source_evidence.map(e=>e.evidence_id));
    if(!humanFindingDispositionsValid(input.data,store.getCurrentAssessment(org,id)?.record.race?.result.validated_findings??[],evidence))throw new AccessError("FINDING_RESOLUTION_REQUIRED",409);
    if(input.data.evidence_ids.some(e=>!evidence.has(e)))throw new AccessError('REVIEW_EVIDENCE_MISMATCH',409);
    if(input.data.escalation_owner_actor_id&&input.data.decision!=='ESCALATE')throw new AccessError('ESCALATION_OWNER_INVALID',400);
    const assigned=input.data.escalation_owner_actor_id??actor!.actor_id;
    if(input.data.decision==='ESCALATE'){const owner=new ActorAuthorityRegistry(snapshot.actor_authorities).resolve(org,assigned);if(!owner||owner.status!=='ACTIVE'||!owner.permissions.includes('T1_SINGLE_APPROVAL')||Date.parse(owner.valid_from)>Date.now()||(owner.expires_at!==null&&Date.now()>=Date.parse(owner.expires_at)))throw new AccessError('ESCALATION_OWNER_UNAVAILABLE',409);}
    const {expected_version,expected_review_hash,...decision}=input.data;if(decision.decision==='ESCALATE')decision.escalation_owner_actor_id=assigned;if(aggregate.aggregate_version!==expected_version)throw new AccessError('STALE_STATE',409);
    const sealed=store.recordReviewDecision({...decision,...(expected_review_hash?{supersedes_review_hash:expected_review_hash}:{}),schema_version:'HUMAN-REVIEW-1',provenance:'HUMAN',decision_id:`REV-${requestId.data}`,request_id:requestId.data,request_sha256:requestHash,organization_id:org,obligation_id:id,aggregate_version:expected_version,source_record_sha256:sourceHash,actor_id:actor!.actor_id,actor_role:actor!.actor_role,authority_version:actor!.authority_version,operator_key:auth.session.operator_key!,credential_version:auth.session.credential_version!,policy_version:aggregate.policy_version,created_at:new Date().toISOString(),expires_at:new Date(Math.min(Date.now()+1800000,Date.parse(ingress.expires_at),actor!.expires_at===null?Infinity:Date.parse(actor!.expires_at))).toISOString()});
    snapshot.authority=store.exportSnapshot();snapshot.source_ingress_anchor=anchor;await revalidate();if(Date.now()>=Date.parse(sealed.record.expires_at)||financialClaim(id))throw new AccessError('CURRENT_HUMAN_REVIEW_REQUIRED',409);writing=true;await repository.compareAndSet(view.state_binding.namespace,stored.revision,snapshot as unknown as Record<string,unknown>);
    const committed=await repository.loadExisting(view.state_binding.namespace);if(!AuthorityStore.fromSnapshot(parseDemoStateSnapshot(committed.snapshot).authority).exportSnapshot().review_decisions?.some(r=>r.hash===sealed.hash))throw new Error('Review unverified');await revalidate();
    return privateJson({review_decision:sealed.record,review_decision_hash:sealed.hash},201);
   }
   const input=z.object({expected_version:z.number().int().positive(),review_decision_id:z.string(),review_decision_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(body);
   if(!input.success)throw new AccessError('BODY_REJECTED',400);
   if(financialClaim(id))throw new AccessError('EXISTING_FINANCIAL_CLAIM',409);
   const review=validReview(id),aggregate=store.get(org,id);
   if(!review||review.record.decision!=='ACCEPT_FOR_AUTHORIZATION'||review.record.decision_id!==input.data.review_decision_id||review.hash!==input.data.review_decision_hash||review.record.source_record_sha256!==contentHash(record)||aggregate.aggregate_version!==input.data.expected_version)throw new AccessError('CURRENT_HUMAN_REVIEW_REQUIRED',409);
   const links=parseLinkedInstructions(snapshot.linked_settlement_instructions);
   const existing=links.find(l=>l.source_obligation_id===id&&l.source_aggregate_version===aggregate.aggregate_version&&l.source_record_sha256===contentHash(record)&&l.review_decision_hash===review.hash);if(existing)return privateJson({instruction:existing,financial_action_eligible:false},200);
   const instruction=sealLinkedInstruction({schema_version:1,kind:'ARC_TESTNET_SETTLEMENT_INSTRUCTION',status:'DRAFT_AUTHORITY_REQUIRED',organization_id:org,source_obligation_id:id,source_record_sha256:contentHash(record),source_aggregate_version:aggregate.aggregate_version,review_decision_id:review.record.decision_id,review_decision_hash:review.hash,instruction_id:`TESTNET-CONTROLLED-LINKED-${contentHash({id,review:review.hash}).slice(0,32)}`,attempt_id:requestId.data,source_amount:record.amount,source_currency:record.currency,network:'ARC_TESTNET',classification:'TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT',created_at:new Date().toISOString()});
   snapshot.linked_settlement_instructions=[...links,instruction];snapshot.source_ingress_anchor=anchor;await revalidate();if(!validReview(id,review)||financialClaim(id))throw new AccessError('CURRENT_HUMAN_REVIEW_REQUIRED',409);writing=true;await repository.compareAndSet(view.state_binding.namespace,stored.revision,snapshot as unknown as Record<string,unknown>);await revalidate();return privateJson({instruction,financial_action_eligible:false},201);
  }catch(error){if(error instanceof DemoStateConflictError)return privateJson({code:'SOURCE_CONFLICT',remedy:'Reload the committed revision and reconcile your draft.'},409);if(writing)return privateJson({code:'COMMIT_OUTCOME_UNVERIFIED',remedy:'Read back the original request identity before another command.'},503);if(error instanceof AuthorityError)return privateJson({code:error.code},409);if(error instanceof AccessError)return privateJson(error.code==='GENUINE_ASSESSMENT_HISTORY_LIMIT'?{code:error.code}:{code:error.code,stage2_status:stage2Status(error.code)},error.status);return accessFailure(error);}
 };
}
export const sourceWorkflowHandlers=createSourceWorkflowHandlers({guard:operatorHandlers.guard,source:loadOperatorSourceRecords,repository:()=>{const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new AccessError('STATE_UNAVAILABLE',503);return new SupabaseDemoStateRepository(url,key);}});
