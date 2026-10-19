import {genuineAssessmentVisibility} from "./genuine-assessment-recovery";
import {genuineHasFinancialHistory} from './genuine-authority-boundary';
import {z} from 'zod';
import {AssessmentState} from './assessment-state';
import {AuthorityStore} from '../authority/aggregate';
import {contentHash,sealLinkedInstruction,parseLinkedInstructions} from '../domain/linked-instruction';
import {parseDemoStateSnapshot,type DemoStateSnapshot} from './demo-state';
import {loadOperatorSourceRecords,type OperatorSourceView} from './operator-source-records';
import {validateOperatorBinding} from './load-existing-demo-state';
import {operatorHandlers,privateJson,type AuthContext} from './operator-auth';
import {AccessError,methodNotAllowed,requireJson,readBoundedJson} from './route-access-policy';
import {SupabaseDemoStateRepository,DemoStateConflictError} from './supabase-demo-state-repository';
import {createAssessmentHandler} from './legacy-routes/obligations/[id]/assess/route';
import {MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION,assertBootstrapOperationPreservation,bootstrapProtectionAttested,bootstrapReferenceAbsent,classifyGenuineAdmission,dispositionProtectionAttested,evaluateDispositionAdmission,type DispositionRequest} from './genuine-admission';
import {admissionWindow,assertDispositionPreservation,dispositionReceiptCurrent,unresolvedAssessmentOperations,type AssessmentDisposition} from './genuine-disposition';
import {historicalBasisValid} from '../agent/assessment-context';
const org='ORG-DEMO-001';
const keyPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export {MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION};
type AdmissionMode='ordinary'|'recovery'|'bootstrap'|'disposition';
const dispositionDenialStatus=(reason:string)=>reason==='GUARD_UNATTESTED'||reason==='ADMISSION_MISSING'||reason==='ADMISSION_INVALID'?403:409;
export const MAX_GENUINE_SNAPSHOT_BYTES=1_750_000;
export const GENUINE_REQUEST_BUDGET_MS=45_000;
export const GENUINE_PROVIDER_BUDGET_MS=20_000;
export function assertGenuineSnapshotSize(snapshot:unknown){if(Buffer.byteLength(JSON.stringify(snapshot,null,1),'utf8')>MAX_GENUINE_SNAPSHOT_BYTES)throw new AccessError('GENUINE_STATE_SIZE_LIMIT',409);}
type Repository=Pick<SupabaseDemoStateRepository,'loadExisting'|'compareAndSet'>;
class GenuineAssessmentState extends AssessmentState {
 constructor(private readonly snapshot:DemoStateSnapshot,private readonly view:OperatorSourceView,private revision:number,private readonly repository:Repository,private readonly revalidate:()=>Promise<void>,private readonly beforeSave:()=>void,private readonly mode:AdmissionMode='ordinary',private readonly bootstrapReference?:string,private readonly dispositionRequest?:DispositionRequest){super(AuthorityStore.fromSnapshot(snapshot.authority),new Map(snapshot.assessment_operations.map(o=>[o.idempotency_key,structuredClone(o)])));}
 reserveAssessmentOperation(key:string,id:string,version:number,at=Date.now()){
  if(this.getAssessmentOperation(key))return super.reserveAssessmentOperation(key,id,version,at);
  const ops=[...this.assessmentOperations.values()];
  const admission=classifyGenuineAdmission({...this.snapshot,assessment_operations:ops},id);
  if(admission.counted_history>=MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION)throw new AccessError('GENUINE_ASSESSMENT_HISTORY_LIMIT',409);
  if(ops.some(o=>o.obligation_id===id&&o.recovery?.generation===1))throw new AccessError('GENUINE_SUCCESSOR_ALREADY_USED',409);
  const proof={source_record_sha256:this.sourceRecordHash(id)!,binding_sha256:contentHash(this.view.state_binding)};
  if(this.mode==='recovery'){
   const visibility=genuineAssessmentVisibility({...this.snapshot,assessment_operations:ops},this.view,id,version,at);
   if(!visibility.recovery_eligible)throw new AccessError('GENUINE_RECOVERY_'+visibility.recovery_reason,409);
   const predecessor=ops.find(o=>o.obligation_id===id&&o.status==='UNKNOWN')!;
   if(this.store.get(org,id).aggregate_version!==version||this.hasLivePaeAuthority(id))throw new AccessError('GENUINE_RECOVERY_CLOSED',409);
   const operation={idempotency_key:key,obligation_id:id,aggregate_version:version,status:'RESERVED' as const,reserved_at:at,recovery:{...proof,generation:1 as const,predecessor_key:predecessor.idempotency_key,predecessor_sha256:contentHash(predecessor)}};
   this.assessmentOperations.set(key,operation);return structuredClone(operation);
  }
  if(this.mode==='disposition'){
   // Separate from bootstrap and recovery: every proof is re-derived from this exact state, so a concurrent loser fails before any mutation.
   const evaluation=evaluateDispositionAdmission({...this.snapshot,assessment_operations:ops},this.view,id,version,at,this.dispositionRequest);
   if(!evaluation.ok)throw new AccessError('GENUINE_DISPOSITION_'+evaluation.reason,dispositionDenialStatus(evaluation.reason));
   if(this.store.get(org,id).aggregate_version!==version||this.hasLivePaeAuthority(id))throw new AccessError('GENUINE_DISPOSITION_FINANCIAL_HISTORY',409);
   const disposition:AssessmentDisposition={kind:'CURRENT_SOURCE_REASSESSMENT',predecessor_key:evaluation.predecessor.idempotency_key,predecessor_sha256:evaluation.admission.predecessor_sha256,prior_binding_status:'UNVERIFIED',admission:evaluation.admission,admission_sha256:evaluation.admission_sha256};
   // Verified generation-0 metadata for the CURRENT source/binding; the predecessor is never retrofitted.
   const operation={idempotency_key:key,obligation_id:id,aggregate_version:version,status:'RESERVED' as const,reserved_at:at,recovery:{...proof,generation:0 as const},legacy_disposition:disposition};
   this.assessmentOperations.set(key,operation);return structuredClone(operation);
  }
  if(unresolvedAssessmentOperations(ops,id).length)throw new AccessError('GENUINE_OPERATION_UNRESOLVED',409);
  if(this.mode==='bootstrap'){
   // Protection, strict legacy-only history and reference absence are all proven before the one reservation.
   if(!bootstrapProtectionAttested())throw new AccessError('GENUINE_BOOTSTRAP_PROTECTION_UNCONFIRMED',409);
   if(!admission.can_bootstrap)throw new AccessError('GENUINE_BOOTSTRAP_NOT_ELIGIBLE',409);
   const reference=this.bootstrapReference;
   if(!reference||reference===key||!bootstrapReferenceAbsent({...this.snapshot,assessment_operations:ops},reference))throw new AccessError('GENUINE_BOOTSTRAP_REFERENCE_CONFLICT',409);
   const operation=super.reserveAssessmentOperation(key,id,version,at);
   operation.recovery={...proof,generation:0};
   operation.bootstrap={kind:'CURRENT_SOURCE_BOOTSTRAP',source_record_sha256:proof.source_record_sha256,binding_sha256:proof.binding_sha256,aggregate_version:version,unmatched_reference_key:reference,unmatched_reference_status:'UNVERIFIED_ABSENT_FROM_RECORDED_OPERATIONS'};
   this.assessmentOperations.set(key,operation);return structuredClone(operation);
  }
  const operation=super.reserveAssessmentOperation(key,id,version,at);
  operation.recovery={...proof,generation:0};this.assessmentOperations.set(key,operation);return structuredClone(operation);
 }
 markAssessmentUnknown(key:string){const operation=super.markAssessmentUnknown(key);if(operation.recovery){operation.recovery={...operation.recovery,unknown_at:Date.now()};this.assessmentOperations.set(key,operation);}return structuredClone(operation);}
 findUnresolvedAssessmentOperations(id:string){return unresolvedAssessmentOperations([...this.assessmentOperations.values()],id).map(o=>({...o}));}
 sourceRecordHash(id:string){const record=this.getRecord(id);return record?contentHash(record):undefined;}
 getRecord(id:string){return this.view.records.find(r=>r.obligation_id===id);}
 hasLivePaeAuthority(id:string){return genuineHasFinancialHistory(this.snapshot,id); }
 async flush(){await this.revalidate();const next={...this.snapshot,authority:this.store.exportSnapshot(),assessment_operations:[...this.assessmentOperations.values()].map(o=>structuredClone(o))};assertGenuineSnapshotSize(next);parseDemoStateSnapshot(next);for(const old of this.snapshot.assessment_operations){if(old.status==='UNKNOWN'&&contentHash(old)!==contentHash(next.assessment_operations.find(o=>o.idempotency_key===old.idempotency_key)))throw new AccessError('GENUINE_UNKNOWN_IMMUTABLE',409);}try{assertBootstrapOperationPreservation(this.snapshot.assessment_operations,next.assessment_operations);}catch{throw new AccessError('GENUINE_BOOTSTRAP_IMMUTABLE',409);}try{assertDispositionPreservation(this.snapshot.assessment_operations,next.assessment_operations,next.authority.assessments.map(a=>a.record.assessment_id));}catch{throw new AccessError('GENUINE_DISPOSITION_IMMUTABLE',409);}this.beforeSave();this.revision=await this.repository.compareAndSet(this.view.state_binding.namespace,this.revision,next as unknown as Record<string,unknown>);Object.assign(this.snapshot,next);await this.revalidate();}
}
interface Dependencies {guard:(r:Request,post:boolean)=>Promise<AuthContext>;source:()=>OperatorSourceView|undefined;repository:Repository}
export function createGenuineWorkflowHandlers(deps:Dependencies){return async(kind:'assess'|'draft',request:Request,id:string):Promise<Response>=>{
 if(request.method!=='POST')return methodNotAllowed();let saving=false;const deadline=Date.now()+GENUINE_REQUEST_BUDGET_MS;
 const checkBudget=()=>{if(Date.now()+5000>deadline)throw new AccessError('GENUINE_ASSESSMENT_TIME_BUDGET',503);};
 const withinBudget=async<T>(run:(signal:AbortSignal)=>Promise<T>):Promise<T>=>{
  checkBudget();const remaining=deadline-Date.now()-5000,controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const expired=new AccessError('GENUINE_ASSESSMENT_TIME_BUDGET',503);
  try{return await Promise.race([run(controller.signal),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort(expired);reject(expired);},remaining);})]);}
  catch(error){if(controller.signal.aborted&&controller.signal.reason===expired)throw expired;throw error;}
  finally{if(timer)clearTimeout(timer);}
 };
 const repository:Repository={loadExisting:namespace=>withinBudget(signal=>deps.repository.loadExisting(namespace,signal)),compareAndSet:(namespace,revision,snapshot)=>withinBudget(signal=>deps.repository.compareAndSet(namespace,revision,snapshot,signal))};
 try{
  const auth=await withinBudget(()=>deps.guard(request,true));checkBudget();requireJson(request);const raw=await readBoundedJson(request,4096);
  const parsed=kind==='assess'?z.union([z.object({}).strict(),z.object({recovery:z.literal(true),expected_version:z.number().int().positive(),source_record_sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),z.object({bootstrap:z.literal(true),expected_version:z.number().int().positive(),source_record_sha256:z.string().regex(/^[a-f0-9]{64}$/),unmatched_reference_key:z.string().regex(keyPattern)}).strict(),
   // Names the separate disposition and the exact owner-admitted evidence. It is a selector, not authority: the admission block in the approved source packet authorizes.
   z.object({disposition:z.literal('CURRENT_SOURCE_REASSESSMENT'),expected_version:z.number().int().positive(),source_record_sha256:z.string().regex(/^[a-f0-9]{64}$/),approval_id:z.string().min(1).max(128),predecessor_key:z.string().regex(keyPattern),predecessor_sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict()]).safeParse(raw):z.object({expected_version:z.number().int().positive(),assessment_id:z.string().min(1).max(128),assessment_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(raw);if(!parsed.success)throw new AccessError('BODY_REJECTED',400);const input=parsed.data;const recoveryRequest=kind==='assess'&&'recovery' in input,bootstrapRequest=kind==='assess'&&'bootstrap' in input;const dispositionRequest=kind==='assess'&&'disposition' in input;const mode:AdmissionMode=recoveryRequest?'recovery':bootstrapRequest?'bootstrap':dispositionRequest?'disposition':'ordinary';const dispositionIdentity:DispositionRequest|undefined=dispositionRequest&&'approval_id' in input?{approval_id:input.approval_id,predecessor_key:input.predecessor_key,predecessor_sha256:input.predecessor_sha256}:undefined;const bootstrapReference=bootstrapRequest&&'unmatched_reference_key' in input?input.unmatched_reference_key:undefined;
  const view=deps.source();if(!view?.state_binding.workflow_base_sha256)throw new AccessError('GENUINE_ADVISORY_AUTHORITY_REQUIRED',403);
  const source=view.records.find(r=>r.obligation_id===id);if(!source)throw new AccessError('SOURCE_NOT_FOUND',404);
  const fingerprint=JSON.stringify(view);const revalidate=async()=>{checkBudget();await withinBudget(()=>auth.revalidate());checkBudget();if(JSON.stringify(deps.source())!==fingerprint)throw new AccessError('SOURCE_BINDING_CHANGED',409);};
  const load=async()=>{await revalidate();checkBudget();const stored=await repository.loadExisting(view.state_binding.namespace);const snapshot=parseDemoStateSnapshot(stored.snapshot);validateOperatorBinding(snapshot,stored.revision,view.state_binding.namespace,view.state_binding);const aggregate=AuthorityStore.fromSnapshot(snapshot.authority).get(org,id);if(aggregate.source_amount!==source.amount||aggregate.source_currency!==source.currency)throw new AccessError('SOURCE_BINDING_CHANGED',409);await revalidate();return {stored,snapshot};};
  if((recoveryRequest||bootstrapRequest||dispositionRequest)&&('source_record_sha256' in input&&input.source_record_sha256!==contentHash(source)))throw new AccessError('SOURCE_BINDING_CHANGED',409);
  if(bootstrapRequest||dispositionRequest){const parsedKey=z.string().regex(keyPattern).safeParse(request.headers.get('Idempotency-Key'));if(!parsedKey.success)throw new AccessError('BODY_REJECTED',400);}
  if(kind==='assess')return await createAssessmentHandler(async()=>{const {stored,snapshot}=await load();if((recoveryRequest||bootstrapRequest||dispositionRequest)&&'expected_version' in input&&AuthorityStore.fromSnapshot(snapshot.authority).get(org,id).aggregate_version!==input.expected_version)throw new AccessError('SOURCE_BINDING_CHANGED',409);
   {
    // Deterministic source context is validated BEFORE any new attempt is consumed: no reservation, no provider, no current-clock substitute.
    const headerKey=request.headers.get('Idempotency-Key');
    if(headerKey!==null&&keyPattern.test(headerKey)&&!snapshot.assessment_operations.some(o=>o.idempotency_key===headerKey)&&(!source.assessment_basis||!historicalBasisValid(source,new Date().toISOString().slice(0,10))))throw new AccessError('GENUINE_ASSESSMENT_BASIS_INVALID',409);
   }
   if(dispositionRequest){
    // Decide before the shared route can touch any operation. Replays prove the stored evidence still equals this request and the CURRENT approved source.
    const dispositionKey=request.headers.get('Idempotency-Key'),existing=snapshot.assessment_operations.find(o=>o.idempotency_key===dispositionKey);
    if(!dispositionProtectionAttested())throw new AccessError('GENUINE_DISPOSITION_GUARD_UNATTESTED',403);
    if(existing){
     const current=AuthorityStore.fromSnapshot(snapshot.authority).get(org,id).aggregate_version,sourceHash=contentHash(source),bindingHash=contentHash(view.state_binding),d=existing.legacy_disposition,r=existing.recovery;
     if(!d||!r||!dispositionIdentity||existing.obligation_id!==id||d.predecessor_key!==dispositionIdentity.predecessor_key||d.predecessor_sha256!==dispositionIdentity.predecessor_sha256||d.admission.approval_id!==dispositionIdentity.approval_id)throw new AccessError('GENUINE_DISPOSITION_IDENTITY_MISMATCH',409);
     if(existing.aggregate_version!==current||!('expected_version' in input)||input.expected_version!==current||r.source_record_sha256!==sourceHash||r.binding_sha256!==bindingHash)throw new AccessError('SOURCE_BINDING_CHANGED',409);
    }else{
     const evaluation=evaluateDispositionAdmission(snapshot,view,id,AuthorityStore.fromSnapshot(snapshot.authority).get(org,id).aggregate_version,Date.now(),dispositionIdentity);
     if(!evaluation.ok)throw new AccessError('GENUINE_DISPOSITION_'+evaluation.reason,dispositionDenialStatus(evaluation.reason));
    }
   }
   if(bootstrapRequest){
    // Decide a new bootstrap before the shared route can touch (e.g. expire) any other operation.
    const bootstrapKey=request.headers.get('Idempotency-Key'),existing=snapshot.assessment_operations.find(o=>o.idempotency_key===bootstrapKey);
    if(existing){
     // Replay is allowed only while the stored proof still equals the current approved view and this request.
     const current=AuthorityStore.fromSnapshot(snapshot.authority).get(org,id).aggregate_version,sourceHash=contentHash(source),bindingHash=contentHash(view.state_binding),b=existing.bootstrap,r=existing.recovery;
     if(!b||!r||b.unmatched_reference_key!==bootstrapReference||existing.obligation_id!==id||r.generation!==0)throw new AccessError('GENUINE_BOOTSTRAP_IDENTITY_MISMATCH',409);
     if(existing.aggregate_version!==current||b.aggregate_version!==current||!('expected_version' in input)||input.expected_version!==current||b.source_record_sha256!==sourceHash||r.source_record_sha256!==sourceHash||b.binding_sha256!==bindingHash||r.binding_sha256!==bindingHash)throw new AccessError('SOURCE_BINDING_CHANGED',409);
    }
    else{
     if(!bootstrapProtectionAttested())throw new AccessError('GENUINE_BOOTSTRAP_PROTECTION_UNCONFIRMED',409);
     if(!classifyGenuineAdmission(snapshot,id).can_bootstrap)throw new AccessError('GENUINE_BOOTSTRAP_NOT_ELIGIBLE',409);
     if(!bootstrapReference||bootstrapReference===bootstrapKey||!bootstrapReferenceAbsent(snapshot,bootstrapReference))throw new AccessError('GENUINE_BOOTSTRAP_REFERENCE_CONFLICT',409);
    }
   }
   return new GenuineAssessmentState(snapshot,view,stored.revision,repository,revalidate,()=>{saving=true;},mode,bootstrapReference,dispositionIdentity);},revalidate,{controlledRecovery:recoveryRequest,admittedDisposition:dispositionRequest,
   // Re-prove the persisted admission window immediately before the first dispatch; a window that closed during the reservation save refuses dispatch and keeps the consumed attempt.
   beforeProviderDispatch:dispositionRequest?fresh=>{const operation=fresh.getAssessmentOperation(request.headers.get('Idempotency-Key')??''),evidence=operation?.legacy_disposition;if(!evidence||admissionWindow(evidence.admission,Date.now())!=='ACTIVE')throw new AccessError('GENUINE_DISPOSITION_WINDOW_CLOSED',409);}:undefined,
   recheckReservationBeforeProvider:true,requireHistoricalBasis:true,reservationTimeoutMs:45_000,maxPersistenceAttempts:2,maxTransportAttempts:1,providerSignal:()=>{
   const remaining=deadline-Date.now()-15_000;if(remaining<=0)throw new AccessError('GENUINE_ASSESSMENT_TIME_BUDGET',503);return AbortSignal.timeout(Math.min(GENUINE_PROVIDER_BUDGET_MS,remaining));
  }})(request,{params:Promise.resolve({id})});
  const parsedKey=z.uuid().safeParse(request.headers.get('Idempotency-Key'));if(!parsedKey.success)throw new AccessError('BODY_REJECTED',400);const key=parsedKey.data;const body=input as {expected_version:number;assessment_id:string;assessment_hash:string};
  for(let attempt=0;attempt<4;attempt++){
   const {stored,snapshot}=await load();const state=new GenuineAssessmentState(snapshot,view,stored.revision,repository,revalidate,()=>{saving=true;}),aggregate=state.store.get(org,id),assessment=state.store.getCurrentAssessment(org,id);
   if(state.findUnresolvedAssessmentOperations(id).length||state.hasLivePaeAuthority(id)||aggregate.aggregate_version!==body.expected_version||!assessment||assessment.record.assessment_id!==body.assessment_id||assessment.hash!==body.assessment_hash||assessment.record.source_record_sha256!==contentHash(source)||!dispositionReceiptCurrent(snapshot.assessment_operations,id,assessment,contentHash(source),contentHash(view.state_binding),aggregate.aggregate_version))throw new AccessError('CURRENT_GENUINE_ASSESSMENT_REQUIRED',409);
   if(assessment.record.decision!=='PAY')throw new AccessError('CURRENT_GENUINE_PAY_REQUIRED',409);
   const links=parseLinkedInstructions(snapshot.linked_settlement_instructions);const sourceHash=contentHash(source);
   const existing=links.find(r=>r.attempt_id===key||r.source_obligation_id===id&&r.source_aggregate_version===aggregate.aggregate_version&&r.assessment_hash===assessment.hash);
   if(existing){if(existing.source_obligation_id!==id||existing.source_record_sha256!==sourceHash||existing.assessment_hash!==body.assessment_hash)throw new AccessError('LINK_IDENTITY_MISMATCH',409);return privateJson({instruction:existing,financial_action_eligible:false},200);}
   if(links.length>=1000)throw new AccessError('LINK_HISTORY_LIMIT',409);
   const instruction=sealLinkedInstruction({schema_version:1,kind:'ARC_TESTNET_SETTLEMENT_INSTRUCTION',status:'DRAFT_AUTHORITY_REQUIRED',organization_id:org,source_obligation_id:id,source_record_sha256:sourceHash,source_aggregate_version:aggregate.aggregate_version,assessment_id:assessment.record.assessment_id,assessment_hash:assessment.hash,instruction_id:`TESTNET-CONTROLLED-LINKED-${contentHash({org,id,sourceHash,assessment:assessment.hash}).slice(0,32)}`,attempt_id:key,source_amount:source.amount,source_currency:source.currency,network:'ARC_TESTNET',classification:'TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT',created_at:new Date().toISOString()});
   const next={...snapshot,linked_settlement_instructions:[...links,instruction]};assertGenuineSnapshotSize(next);await revalidate();saving=true;
   try{await repository.compareAndSet(view.state_binding.namespace,stored.revision,next as unknown as Record<string,unknown>);await revalidate();return privateJson({instruction,financial_action_eligible:false},201);}catch(e){if(!(e instanceof DemoStateConflictError))throw e;saving=false;}
  }
  throw new AccessError('LINK_CONFLICT_REFRESH_REQUIRED',409);
 }catch(e){
  // The reservation is durable but dispatch was refused: state the exact outcome instead of an ambiguous one. The attempt stays consumed.
  if(e instanceof AccessError&&e.code==='GENUINE_DISPOSITION_WINDOW_CLOSED')return privateJson({code:e.code,attempt_consumed:true,provider_dispatched:false,retry_submission:false},e.status);
  if(saving)return privateJson({code:'OUTCOME_UNVERIFIED',retry_submission:false},503);if(e instanceof AccessError)return privateJson({code:e.code},e.status);return privateJson({code:saving?'OUTCOME_UNVERIFIED':'GENUINE_WORKFLOW_UNAVAILABLE',retry_submission:false},503);}
};}
export const genuineWorkflowHandlers=createGenuineWorkflowHandlers({guard:operatorHandlers.guard,source:()=>loadOperatorSourceRecords(),repository:{loadExisting:async(n,signal)=>runtimeRepository().loadExisting(n,signal),compareAndSet:async(n,r,s,signal)=>runtimeRepository().compareAndSet(n,r,s,signal)}});
function runtimeRepository(){const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new AccessError('STATE_UNAVAILABLE',503);return new SupabaseDemoStateRepository(url,key);}
