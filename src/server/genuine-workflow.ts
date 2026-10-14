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
const org='ORG-DEMO-001';
export const MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION=4;
export const MAX_GENUINE_SNAPSHOT_BYTES=1_750_000;
export const GENUINE_REQUEST_BUDGET_MS=45_000;
export const GENUINE_PROVIDER_BUDGET_MS=20_000;
export function assertGenuineSnapshotSize(snapshot:unknown){if(Buffer.byteLength(JSON.stringify(snapshot,null,1),'utf8')>MAX_GENUINE_SNAPSHOT_BYTES)throw new AccessError('GENUINE_STATE_SIZE_LIMIT',409);}
type Repository=Pick<SupabaseDemoStateRepository,'loadExisting'|'compareAndSet'>;
class GenuineAssessmentState extends AssessmentState {
 constructor(private readonly snapshot:DemoStateSnapshot,private readonly view:OperatorSourceView,private revision:number,private readonly repository:Repository,private readonly revalidate:()=>Promise<void>,private readonly beforeSave:()=>void){super(AuthorityStore.fromSnapshot(snapshot.authority),new Map(snapshot.assessment_operations.map(o=>[o.idempotency_key,structuredClone(o)])));}
 reserveAssessmentOperation(key:string,id:string,version:number,at=Date.now()){
  if(!this.getAssessmentOperation(key)&&(this.store.getAssessmentHistory(org,id).length>=MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION||[...this.assessmentOperations.values()].filter(o=>o.obligation_id===id).length>=MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION))throw new AccessError('GENUINE_ASSESSMENT_HISTORY_LIMIT',409);
  return super.reserveAssessmentOperation(key,id,version,at);
 }
 sourceRecordHash(id:string){const record=this.getRecord(id);return record?contentHash(record):undefined;}
 getRecord(id:string){return this.view.records.find(r=>r.obligation_id===id);}
 hasLivePaeAuthority(id:string){return genuineHasFinancialHistory(this.snapshot,id); }
 async flush(){await this.revalidate();const next={...this.snapshot,authority:this.store.exportSnapshot(),assessment_operations:[...this.assessmentOperations.values()].map(o=>structuredClone(o))};assertGenuineSnapshotSize(next);this.beforeSave();this.revision=await this.repository.compareAndSet(this.view.state_binding.namespace,this.revision,next as unknown as Record<string,unknown>);Object.assign(this.snapshot,next);await this.revalidate();}
}
interface Dependencies {guard:(r:Request,post:boolean)=>Promise<AuthContext>;source:()=>OperatorSourceView|undefined;repository:Repository}
export function createGenuineWorkflowHandlers(deps:Dependencies){return async(kind:'assess'|'draft',request:Request,id:string):Promise<Response>=>{
 if(request.method!=='POST')return methodNotAllowed();let saving=false;const deadline=Date.now()+GENUINE_REQUEST_BUDGET_MS;
 const checkBudget=()=>{if(Date.now()+5000>deadline)throw new AccessError('GENUINE_ASSESSMENT_TIME_BUDGET',503);};
 try{
  const auth=await deps.guard(request,true);checkBudget();requireJson(request);const raw=await readBoundedJson(request,4096);
  const parsed=kind==='assess'?z.object({}).strict().safeParse(raw):z.object({expected_version:z.number().int().positive(),assessment_id:z.string().min(1).max(128),assessment_hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict().safeParse(raw);if(!parsed.success)throw new AccessError('BODY_REJECTED',400);const input=parsed.data;
  const view=deps.source();if(!view?.state_binding.workflow_base_sha256)throw new AccessError('GENUINE_ADVISORY_AUTHORITY_REQUIRED',403);
  const source=view.records.find(r=>r.obligation_id===id);if(!source)throw new AccessError('SOURCE_NOT_FOUND',404);
  const fingerprint=JSON.stringify(view);const revalidate=async()=>{checkBudget();await auth.revalidate();checkBudget();if(JSON.stringify(deps.source())!==fingerprint)throw new AccessError('SOURCE_BINDING_CHANGED',409);};
  const load=async()=>{await revalidate();checkBudget();const stored=await deps.repository.loadExisting(view.state_binding.namespace);const snapshot=parseDemoStateSnapshot(stored.snapshot);validateOperatorBinding(snapshot,stored.revision,view.state_binding.namespace,view.state_binding);const aggregate=AuthorityStore.fromSnapshot(snapshot.authority).get(org,id);if(aggregate.source_amount!==source.amount||aggregate.source_currency!==source.currency)throw new AccessError('SOURCE_BINDING_CHANGED',409);await revalidate();return {stored,snapshot};};
  if(kind==='assess')return await createAssessmentHandler(async()=>{const {stored,snapshot}=await load();return new GenuineAssessmentState(snapshot,view,stored.revision,deps.repository,revalidate,()=>{saving=true;});},revalidate,{reservationTimeoutMs:45_000,maxPersistenceAttempts:2,providerSignal:()=>{
   const remaining=deadline-Date.now()-15_000;if(remaining<=0)throw new AccessError('GENUINE_ASSESSMENT_TIME_BUDGET',503);return AbortSignal.timeout(Math.min(GENUINE_PROVIDER_BUDGET_MS,remaining));
  }})(request,{params:Promise.resolve({id})});
  const parsedKey=z.uuid().safeParse(request.headers.get('Idempotency-Key'));if(!parsedKey.success)throw new AccessError('BODY_REJECTED',400);const key=parsedKey.data;const body=input as {expected_version:number;assessment_id:string;assessment_hash:string};
  for(let attempt=0;attempt<4;attempt++){
   const {stored,snapshot}=await load();const state=new GenuineAssessmentState(snapshot,view,stored.revision,deps.repository,revalidate,()=>{saving=true;}),aggregate=state.store.get(org,id),assessment=state.store.getCurrentAssessment(org,id);
   if(state.hasLivePaeAuthority(id)||aggregate.aggregate_version!==body.expected_version||!assessment||assessment.record.assessment_id!==body.assessment_id||assessment.hash!==body.assessment_hash||assessment.record.source_record_sha256!==contentHash(source))throw new AccessError('CURRENT_GENUINE_ASSESSMENT_REQUIRED',409);
   if(assessment.record.decision!=='PAY')throw new AccessError('CURRENT_GENUINE_PAY_REQUIRED',409);
   const links=parseLinkedInstructions(snapshot.linked_settlement_instructions);const sourceHash=contentHash(source);
   const existing=links.find(r=>r.attempt_id===key||r.source_obligation_id===id&&r.source_aggregate_version===aggregate.aggregate_version&&r.assessment_hash===assessment.hash);
   if(existing){if(existing.source_obligation_id!==id||existing.source_record_sha256!==sourceHash||existing.assessment_hash!==body.assessment_hash)throw new AccessError('LINK_IDENTITY_MISMATCH',409);return privateJson({instruction:existing,financial_action_eligible:false},200);}
   if(links.length>=1000)throw new AccessError('LINK_HISTORY_LIMIT',409);
   const instruction=sealLinkedInstruction({schema_version:1,kind:'ARC_TESTNET_SETTLEMENT_INSTRUCTION',status:'DRAFT_AUTHORITY_REQUIRED',organization_id:org,source_obligation_id:id,source_record_sha256:sourceHash,source_aggregate_version:aggregate.aggregate_version,assessment_id:assessment.record.assessment_id,assessment_hash:assessment.hash,instruction_id:`TESTNET-CONTROLLED-LINKED-${contentHash({org,id,sourceHash,assessment:assessment.hash}).slice(0,32)}`,attempt_id:key,source_amount:source.amount,source_currency:source.currency,network:'ARC_TESTNET',classification:'TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT',created_at:new Date().toISOString()});
   const next={...snapshot,linked_settlement_instructions:[...links,instruction]};assertGenuineSnapshotSize(next);await revalidate();saving=true;
   try{await deps.repository.compareAndSet(view.state_binding.namespace,stored.revision,next as unknown as Record<string,unknown>);await revalidate();return privateJson({instruction,financial_action_eligible:false},201);}catch(e){if(!(e instanceof DemoStateConflictError))throw e;saving=false;}
  }
  throw new AccessError('LINK_CONFLICT_REFRESH_REQUIRED',409);
 }catch(e){if(saving)return privateJson({code:'OUTCOME_UNVERIFIED',retry_submission:false},503);if(e instanceof AccessError)return privateJson({code:e.code},e.status);return privateJson({code:saving?'OUTCOME_UNVERIFIED':'GENUINE_WORKFLOW_UNAVAILABLE',retry_submission:false},503);}
};}
export const genuineWorkflowHandlers=createGenuineWorkflowHandlers({guard:operatorHandlers.guard,source:()=>loadOperatorSourceRecords(),repository:{loadExisting:async n=>runtimeRepository().loadExisting(n),compareAndSet:async(n,r,s)=>runtimeRepository().compareAndSet(n,r,s)}});
function runtimeRepository(){const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new AccessError('STATE_UNAVAILABLE',503);return new SupabaseDemoStateRepository(url,key);}
