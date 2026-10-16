import {z} from 'zod';
import {AuthorityStore} from '../authority/aggregate';
import type {LiveUsageObligationRecord} from '../agent/context-builder';
import {contentHash} from '../domain/linked-instruction';
import {genuineHasFinancialHistory} from './genuine-authority-boundary';
import {parseDemoStateSnapshot,type AssessmentOperation,type DemoStateSnapshot} from './demo-state';
import {validateOperatorBinding} from './load-existing-demo-state';
import {operatorHandlers,privateJson,accessFailure,type AuthContext} from './operator-auth';
import {loadOperatorSourceRecords,type OperatorSourceView} from './operator-source-records';
import {AccessError,methodNotAllowed,readBoundedJson,requireJson} from './route-access-policy';
import {SupabaseDemoStateRepository} from './supabase-demo-state-repository';

const organization='ORG-DEMO-001';
const unresolvedStatuses=new Set<AssessmentOperation['status']>(['RESERVED','PROVIDER_RESULT_DURABLE','UNKNOWN']);
const bodySchema=z.object({idempotency_key:z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)}).strict();
type EvidenceTruth='TRUE'|'FALSE'|'UNVERIFIED'|'UNAVAILABLE';
type OperationEvidence=AssessmentOperation['status']|'UNVERIFIED'|'UNAVAILABLE';

export interface GenuineAssessmentObservation {
 attempted_key_state:'FOUND'|'NOT_FOUND'|'UNVERIFIED'|'UNAVAILABLE';
 blocker_relation:'SAME'|'DIFFERENT_VERIFIED'|'DIFFERENT_UNVERIFIED'|'NONE'|'AMBIGUOUS'|'UNVERIFIED'|'UNAVAILABLE';
 blocker_operation_status:OperationEvidence;
 current_receipt_match:EvidenceTruth;
 current_source_match:EvidenceTruth;
 current_version_match:EvidenceTruth;
 genuine_payable_history:'PRESENT'|'NONE'|'UNVERIFIED'|'UNAVAILABLE';
 observed_at:string;
}

interface Dependencies {
 guard:(request:Request,post:boolean)=>Promise<AuthContext>;
 source:()=>OperatorSourceView|undefined;
 repository:Pick<SupabaseDemoStateRepository,'loadExisting'>;
 environment:()=>string|undefined;
 now:()=>Date;
}

function evidenceForOperation(store:AuthorityStore,operation:AssessmentOperation,aggregateVersion:number,sourceRecordSha256:string){
 const exactHistory=store.getAssessmentHistory(organization,operation.obligation_id).filter(item=>item.record.assessment_id===`ASM-${operation.idempotency_key}`);
 if(exactHistory.length>1||unresolvedStatuses.has(operation.status)&&exactHistory.length!==0)throw new Error('ASSESSMENT_OPERATION_CONTRADICTION');
 const version:EvidenceTruth=operation.aggregate_version===aggregateVersion?'TRUE':'FALSE';
 let source:EvidenceTruth='UNVERIFIED',receipt:EvidenceTruth=exactHistory.length===0?'FALSE':'UNVERIFIED';
 if(operation.status==='PROVIDER_RESULT_DURABLE')source=operation.provider_result?.source_record_sha256===sourceRecordSha256?'TRUE':'FALSE';
 if(operation.status==='COMPLETED'){
  const sealed=exactHistory.find(item=>item.hash===operation.assessment_hash);
  source=sealed?sealed.record.source_record_sha256===sourceRecordSha256?'TRUE':'FALSE':'UNVERIFIED';
  const current=store.getCurrentAssessment(organization,operation.obligation_id);
  receipt=sealed&&current&&current.hash===sealed.hash&&current.record.aggregate_version===String(aggregateVersion)?'TRUE':'FALSE';
 }
 return {source,receipt,version};
}

/** Deterministic projection over one already-validated, stable genuine snapshot.
 * It emits only categorical evidence and never returns durable identifiers. */
export function projectGenuineAssessmentObservation(snapshot:DemoStateSnapshot,record:LiveUsageObligationRecord,id:string,attemptedKey:string,observedAt:string):GenuineAssessmentObservation {
 const store=AuthorityStore.fromSnapshot(snapshot.authority),aggregate=store.get(organization,id),sourceRecordSha256=contentHash(record);
 const allExact=snapshot.assessment_operations.filter(item=>item.idempotency_key===attemptedKey);
 if(allExact.length>1)throw new Error('DUPLICATE_ASSESSMENT_OPERATION');
 const exact=allExact[0];
 const selectedUnresolved=snapshot.assessment_operations.filter(item=>item.obligation_id===id&&unresolvedStatuses.has(item.status));
 const attempted:GenuineAssessmentObservation['attempted_key_state']=exact?.obligation_id===id?'FOUND':exact?'UNVERIFIED':'NOT_FOUND';
 let relation:GenuineAssessmentObservation['blocker_relation']='NONE';
 let subject:AssessmentOperation|undefined;
 if(exact&&exact.obligation_id!==id){
  relation='AMBIGUOUS';
 }else if(selectedUnresolved.length>1){
  relation='AMBIGUOUS';
 }else if(exact&&unresolvedStatuses.has(exact.status)){
  relation='SAME';subject=exact;
 }else if(selectedUnresolved.length===1){
  subject=selectedUnresolved[0];
  const evidence=evidenceForOperation(store,subject,aggregate.aggregate_version,sourceRecordSha256);
  relation=evidence.version==='TRUE'&&evidence.source==='TRUE'?'DIFFERENT_VERIFIED':'DIFFERENT_UNVERIFIED';
 }else if(exact){
  subject=exact;
 }
 const evidence=subject?evidenceForOperation(store,subject,aggregate.aggregate_version,sourceRecordSha256):{source:'UNVERIFIED',receipt:'UNVERIFIED',version:'UNVERIFIED'} as const;
 return {
  attempted_key_state:attempted,
  blocker_relation:relation,
  blocker_operation_status:relation==='NONE'||relation==='AMBIGUOUS'?'UNVERIFIED':subject?.status??'UNVERIFIED',
  current_receipt_match:evidence.receipt,
  current_source_match:evidence.source,
  current_version_match:evidence.version,
  genuine_payable_history:genuineHasFinancialHistory(snapshot,id)?'PRESENT':'NONE',
  observed_at:observedAt,
 };
}

/** Temporary Preview-only observation. The handler performs two stable reads
 * of one source-bound namespace and never repairs, retries or writes state. */
export function createGenuineAssessmentObservationHandler(deps:Dependencies){
 return async(request:Request,id:string):Promise<Response>=>{
  if(request.method!=='POST')return methodNotAllowed();
  try{
   if(deps.environment()!=='preview')throw new AccessError('HOLD_ACCESS_PATH',403);
   const auth=await deps.guard(request,true);
   requireJson(request);
   const body=bodySchema.safeParse(await readBoundedJson(request,256));
   if(!body.success)throw new AccessError('BODY_REJECTED',400);
   await auth.revalidate();
   const view=deps.source();
   if(!view?.state_binding.workflow_base_sha256)throw new AccessError('GENUINE_ADVISORY_AUTHORITY_REQUIRED',403);
   const record=view.records.find(item=>item.obligation_id===id);
   if(!record)throw new AccessError('SOURCE_NOT_FOUND',404);
   const namespace=view.state_binding.namespace,sourceFingerprint=contentHash(view);
   const revalidate=async()=>{
    if(deps.environment()!=='preview')throw new AccessError('HOLD_ACCESS_PATH',409);
    await auth.revalidate();
    const current=deps.source();
    if(!current||contentHash(current)!==sourceFingerprint)throw new AccessError('HOLD_ACCESS_PATH',409);
   };
   const parse=(stored:Awaited<ReturnType<Dependencies['repository']['loadExisting']>>)=>{
    const raw=structuredClone(stored.snapshot);
    if(raw.schema_version!==2||raw.actor_authority_registry_initialized!==true)throw new Error('STATE_SCHEMA_UNAVAILABLE');
    const snapshot=parseDemoStateSnapshot(raw);
    validateOperatorBinding(snapshot,stored.revision,namespace,view.state_binding);
    const aggregate=AuthorityStore.fromSnapshot(snapshot.authority).get(organization,id);
    if(aggregate.source_amount!==record.amount||aggregate.source_currency!==record.currency)throw new Error('SOURCE_BINDING_CHANGED');
    return snapshot;
   };
   await revalidate();
   const first=await deps.repository.loadExisting(namespace),firstHash=contentHash(first.snapshot);
   const firstSnapshot=parse(first);
   projectGenuineAssessmentObservation(firstSnapshot,record,id,body.data.idempotency_key,'1970-01-01T00:00:00.000Z');
   await revalidate();
   const second=await deps.repository.loadExisting(namespace),secondHash=contentHash(second.snapshot);
   const snapshot=parse(second);
   await revalidate();
   if(first.revision!==second.revision||firstHash!==secondHash)throw new AccessError('HOLD_ACCESS_PATH',409);
   const now=deps.now();
   if(!Number.isFinite(now.getTime()))throw new Error('CLOCK_UNAVAILABLE');
   return privateJson(projectGenuineAssessmentObservation(snapshot,record,id,body.data.idempotency_key,now.toISOString()));
  }catch(error){
   if(error instanceof AccessError)return accessFailure(error);
   return privateJson({code:'ASSESSMENT_OBSERVATION_UNAVAILABLE'},503);
  }
 };
}

export const genuineAssessmentObservationHandler=createGenuineAssessmentObservationHandler({
 guard:operatorHandlers.guard,
 source:()=>loadOperatorSourceRecords(),
 environment:()=>process.env.VERCEL_ENV,
 now:()=>new Date(),
 repository:{loadExisting:async namespace=>{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new AccessError('STATE_UNAVAILABLE',503);
  return new SupabaseDemoStateRepository(url,key).loadExisting(namespace);
 }},
});
