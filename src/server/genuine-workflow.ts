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
import {MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION,assertBootstrapOperationPreservation,bootstrapProtectionAttested,bootstrapReferenceAbsent,classifyGenuineAdmission} from './genuine-admission';
const org='ORG-DEMO-001';
const keyPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export {MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION};
type AdmissionMode='ordinary'|'recovery'|'bootstrap';
export const MAX_GENUINE_SNAPSHOT_BYTES=1_750_000;
export const GENUINE_REQUEST_BUDGET_MS=45_000;
export const GENUINE_PROVIDER_BUDGET_MS=20_000;
export function assertGenuineSnapshotSize(snapshot:unknown){if(Buffer.byteLength(JSON.stringify(snapshot,null,1),'utf8')>MAX_GENUINE_SNAPSHOT_BYTES)throw new AccessError('GENUINE_STATE_SIZE_LIMIT',409);}
type Repository=Pick<SupabaseDemoStateRepository,'loadExisting'|'compareAndSet'>;
class GenuineAssessmentState extends AssessmentState {
 constructor(private readonly snapshot:DemoStateSnapshot,private readonly view:OperatorSourceView,private revision:number,private readonly repository:Repository,private readonly revalidate:()=>Promise<void>,private readonly beforeSave:()=>void,private readonly mode:AdmissionMode='ordinary',private readonly bootstrapReference?:string){super(AuthorityStore.fromSnapshot(snapshot.authority),new Map(snapshot.assessment_operations.map(o=>[o.idempotency_key,structuredClone(o)])));}
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
  if(ops.some(o=>o.obligation_id===id&&['UNKNOWN','RESERVED','PROVIDER_RESULT_DURABLE'].includes(o.status)))throw new AccessError('GENUINE_OPERATION_UNRESOLVED',409);
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
 findUnresolvedAssessmentOperations(id:string){const ops=[...this.assessmentOperations.values()];return super.findUnresolvedAssessmentOperations(id).filter(o=>!ops.some(c=>c.recovery?.predecessor_key===o.idempotency_key));}
 sourceRecordHash(id:string){const record=this.getRecord(id);return record?contentHash(record):undefined;}
 getRecord(id:string){return this.view.records.find(r=>r.obligation_id===id);}
 hasLivePaeAuthority(id:string){return genuineHasFinancialHistory(this.snapshot,id); }
 async flush(){await this.revalidate();const next={...this.snapshot,authority:this.store.exportSnapshot(),assessment_operations:[...this.assessmentOperations.values()].map(o=>structuredClone(o))};assertGenuineSnapshotSize(next);parseDemoStateSnapshot(next);for(const old of this.snapshot.assessment_operations){if(old.status==='UNKNOWN'&&contentHash(old)!==contentHash(next.assessment_operations.find(o=>o.idempotency_key===old.idempotency_key)))throw new AccessError('GENUINE_UNKNOWN_IMMUTABLE',409);}try{assertBootstrapOperationPreservation(this.snapshot.assessment_operations,next.assessment_operations);}catch{throw new AccessError('GENUINE_BOOTSTRAP_IMMUTABLE',409);}this.beforeSave();this.revision=await this.repository.compareAndSet(this.view.state_binding.namespace,this.revision,next as unknown as Record<string,unknown>);Object.assign(this.snapshot,next);await this.revalidate();}
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
  const parsed=kind==='assess'?z.union([z.object({}).strict(),z.object({recovery:z.literal(true),expected_version:z.number().int().positive(),source_record_sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),z.object({bootstrap:z.literal(true),expected_version:z.number().int().positive(),source_record_sha256:z.string().regex(/^[a-f0-9]{64}$/),unmatched_reference_key:z.string().regex(keyPattern)}).strict()]).safeParse(raw):z.object({expected_version:z.number().int().positive(),assessment_id:z.string().min(1).max(128),assessment_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(raw);if(!parsed.success)throw new AccessError('BODY_REJECTED',400);const input=parsed.data;const recoveryRequest=kind==='assess'&&'recovery' in input,bootstrapRequest=kind==='assess'&&'bootstrap' in input;const mode:AdmissionMode=recoveryRequest?'recovery':bootstrapRequest?'bootstrap':'ordinary';const bootstrapReference=bootstrapRequest&&'unmatched_reference_key' in input?input.unmatched_reference_key:undefined;
  const view=deps.source();if(!view?.state_binding.workflow_base_sha256)throw new AccessError('GENUINE_ADVISORY_AUTHORITY_REQUIRED',403);
  const source=view.records.find(r=>r.obligation_id===id);if(!source)throw new AccessError('SOURCE_NOT_FOUND',404);
  const fingerprint=JSON.stringify(view);const revalidate=async()=>{checkBudget();await withinBudget(()=>auth.revalidate());checkBudget();if(JSON.stringify(deps.source())!==fingerprint)throw new AccessError('SOURCE_BINDING_CHANGED',409);};
  const load=async()=>{await revalidate();checkBudget();const stored=await repository.loadExisting(view.state_binding.namespace);const snapshot=parseDemoStateSnapshot(stored.snapshot);validateOperatorBinding(snapshot,stored.revision,view.state_binding.namespace,view.state_binding);const aggregate=AuthorityStore.fromSnapshot(snapshot.authority).get(org,id);if(aggregate.source_amount!==source.amount||aggregate.source_currency!==source.currency)throw new AccessError('SOURCE_BINDING_CHANGED',409);await revalidate();return {stored,snapshot};};
  if((recoveryRequest||bootstrapRequest)&&('source_record_sha256' in input&&input.source_record_sha256!==contentHash(source)))throw new AccessError('SOURCE_BINDING_CHANGED',409);
  if(bootstrapRequest){const parsedKey=z.string().regex(keyPattern).safeParse(request.headers.get('Idempotency-Key'));if(!parsedKey.success)throw new AccessError('BODY_REJECTED',400);}
  if(kind==='assess')return await createAssessmentHandler(async()=>{const {stored,snapshot}=await load();if((recoveryRequest||bootstrapRequest)&&'expected_version' in input&&AuthorityStore.fromSnapshot(snapshot.authority).get(org,id).aggregate_version!==input.expected_version)throw new AccessError('SOURCE_BINDING_CHANGED',409);
   if(bootstrapRequest){const existing=snapshot.assessment_operations.find(o=>o.idempotency_key===request.headers.get('Idempotency-Key'));if(existing&&(existing.bootstrap?.unmatched_reference_key!==bootstrapReference||existing.obligation_id!==id))throw new AccessError('GENUINE_BOOTSTRAP_IDENTITY_MISMATCH',409);}
   return new GenuineAssessmentState(snapshot,view,stored.revision,repository,revalidate,()=>{saving=true;},mode,bootstrapReference);},revalidate,{controlledRecovery:recoveryRequest,recheckReservationBeforeProvider:true,requireHistoricalBasis:true,reservationTimeoutMs:45_000,maxPersistenceAttempts:2,maxTransportAttempts:1,providerSignal:()=>{
   const remaining=deadline-Date.now()-15_000;if(remaining<=0)throw new AccessError('GENUINE_ASSESSMENT_TIME_BUDGET',503);return AbortSignal.timeout(Math.min(GENUINE_PROVIDER_BUDGET_MS,remaining));
  }})(request,{params:Promise.resolve({id})});
  const parsedKey=z.uuid().safeParse(request.headers.get('Idempotency-Key'));if(!parsedKey.success)throw new AccessError('BODY_REJECTED',400);const key=parsedKey.data;const body=input as {expected_version:number;assessment_id:string;assessment_hash:string};
  for(let attempt=0;attempt<4;attempt++){
   const {stored,snapshot}=await load();const state=new GenuineAssessmentState(snapshot,view,stored.revision,repository,revalidate,()=>{saving=true;}),aggregate=state.store.get(org,id),assessment=state.store.getCurrentAssessment(org,id);
   if(state.findUnresolvedAssessmentOperations(id).length||state.hasLivePaeAuthority(id)||aggregate.aggregate_version!==body.expected_version||!assessment||assessment.record.assessment_id!==body.assessment_id||assessment.hash!==body.assessment_hash||assessment.record.source_record_sha256!==contentHash(source))throw new AccessError('CURRENT_GENUINE_ASSESSMENT_REQUIRED',409);
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
 }catch(e){if(saving)return privateJson({code:'OUTCOME_UNVERIFIED',retry_submission:false},503);if(e instanceof AccessError)return privateJson({code:e.code},e.status);return privateJson({code:saving?'OUTCOME_UNVERIFIED':'GENUINE_WORKFLOW_UNAVAILABLE',retry_submission:false},503);}
};}
export const genuineWorkflowHandlers=createGenuineWorkflowHandlers({guard:operatorHandlers.guard,source:()=>loadOperatorSourceRecords(),repository:{loadExisting:async(n,signal)=>runtimeRepository().loadExisting(n,signal),compareAndSet:async(n,r,s,signal)=>runtimeRepository().compareAndSet(n,r,s,signal)}});
function runtimeRepository(){const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new AccessError('STATE_UNAVAILABLE',503);return new SupabaseDemoStateRepository(url,key);}
