import {z} from 'zod';
import {AuthorityStore} from '../authority/aggregate';
import {contentHash} from '../domain/linked-instruction';
import {parseDemoStateSnapshot} from './demo-state';
import {dispositionReceiptCurrent,resolveDisposition,unresolvedAssessmentOperations} from './genuine-disposition';
import {validateOperatorBinding} from './load-existing-demo-state';
import {loadOperatorSourceRecords,type OperatorSourceView} from './operator-source-records';
import {operatorHandlers,privateJson,accessFailure,type AuthContext} from './operator-auth';
import {AccessError,methodNotAllowed,requireJson,readBoundedJson} from './route-access-policy';
import {SupabaseDemoStateRepository} from './supabase-demo-state-repository';

const organization='ORG-DEMO-001';
const bodySchema=z.object({idempotency_key:z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)}).strict();
export interface GenuineAssessmentStatus {
 status:'NOT_FOUND'|'RESERVED'|'PROVIDER_RESULT_DURABLE'|'UNKNOWN'|'STALE'|'COMPLETED_CURRENT';
 obligation_id:string;
 idempotency_key:string;
 aggregate_version:string;
 source_record_sha256:string;
 financial_action_eligible:false;
 receipt?:{assessment_id:string;assessment_hash:string;aggregate_version:string};
 /** Present only on a historical unbound UNKNOWN that a separate admitted current-source attempt now accompanies. */
 historically_superseded?:true;
}
interface Dependencies {
 guard:(request:Request,post:boolean)=>Promise<AuthContext>;
 source:()=>OperatorSourceView|undefined;
 repository:Pick<SupabaseDemoStateRepository,'loadExisting'>;
}

/** Two stable, existing-state observations only. No assessment handler, timeout
 * recovery, signing or provider capability is used. Status is point-in-time
 * evidence under current source access, not original-submitter attribution. */
export function createGenuineAssessmentStatusHandler(deps:Dependencies){
 return async(request:Request,id:string):Promise<Response>=>{
  if(request.method!=='POST')return methodNotAllowed();
  try{
   const auth=await deps.guard(request,true);
   requireJson(request);
   const body=bodySchema.safeParse(await readBoundedJson(request,256));
   if(!body.success)throw new AccessError('BODY_REJECTED',400);
   await auth.revalidate();
   const view=deps.source();
   if(!view?.state_binding.workflow_base_sha256)throw new AccessError('GENUINE_ADVISORY_AUTHORITY_REQUIRED',403);
   const record=view.records.find(item=>item.obligation_id===id);
   if(!record)throw new AccessError('SOURCE_NOT_FOUND',404);
   const namespace=view.state_binding.namespace,sourceFingerprint=JSON.stringify(view),sourceHash=contentHash(record);
   const revalidate=async()=>{
    await auth.revalidate();
    if(JSON.stringify(deps.source())!==sourceFingerprint)throw new AccessError('SOURCE_BINDING_CHANGED',409);
   };
   const parse=(stored:Awaited<ReturnType<Dependencies['repository']['loadExisting']>>)=>{
    if(stored.snapshot.schema_version!==2||stored.snapshot.actor_authority_registry_initialized!==true)throw new Error();
    const snapshot=parseDemoStateSnapshot(stored.snapshot);
    validateOperatorBinding(snapshot,stored.revision,namespace,view.state_binding);
    const store=AuthorityStore.fromSnapshot(snapshot.authority),aggregate=store.get(organization,id);
    if(aggregate.source_amount!==record.amount||aggregate.source_currency!==record.currency)throw new AccessError('SOURCE_BINDING_CHANGED',409);
    return {snapshot,store,aggregate};
   };
   await revalidate();
   const first=await deps.repository.loadExisting(namespace);
   const firstRevision=first.revision,firstHash=contentHash(first.snapshot);
   parse(first);
   await revalidate();
   const second=await deps.repository.loadExisting(namespace);
   const secondHash=contentHash(second.snapshot);
   const {snapshot,store,aggregate}=parse(second);
   await revalidate();
   if(second.revision!==firstRevision||secondHash!==firstHash)throw new AccessError('ASSESSMENT_STATUS_CHANGED',409);
   const key=body.data.idempotency_key;
   const result:GenuineAssessmentStatus={status:'NOT_FOUND',obligation_id:id,idempotency_key:key,aggregate_version:String(aggregate.aggregate_version),source_record_sha256:sourceHash,financial_action_eligible:false};
   const operation=snapshot.assessment_operations.find(item=>item.idempotency_key===key&&item.obligation_id===id);
   if(operation){
    const relation=resolveDisposition(snapshot.assessment_operations,id);
    if(relation?.predecessor.idempotency_key===key){result.status='UNKNOWN';result.historically_superseded=true;}
    else if(operation.aggregate_version!==aggregate.aggregate_version||operation.status==='STALE')result.status='STALE';
    else if(operation.status==='COMPLETED'){
     const current=store.getCurrentAssessment(organization,id);
     // One shared relation helper: a superseded historical predecessor never hides or blocks its child's receipt; any separate unknown still does.
     const otherUnresolved=unresolvedAssessmentOperations(snapshot.assessment_operations,id).some(item=>item.idempotency_key!==key);
     const bindingCurrent=operation.legacy_disposition===undefined||operation.recovery?.binding_sha256===contentHash(view.state_binding)&&operation.recovery.source_record_sha256===sourceHash;
     if(!otherUnresolved&&bindingCurrent&&current&&dispositionReceiptCurrent(snapshot.assessment_operations,id,current,sourceHash,contentHash(view.state_binding),aggregate.aggregate_version)&&current.hash===operation.assessment_hash&&current.record.assessment_id===`ASM-${key}`&&current.record.organization_id===organization&&current.record.obligation_id===id&&current.record.aggregate_version===String(aggregate.aggregate_version)&&current.record.source_record_sha256===sourceHash){
      result.status='COMPLETED_CURRENT';
      result.receipt={assessment_id:current.record.assessment_id,assessment_hash:current.hash,aggregate_version:current.record.aggregate_version};
     }else result.status='STALE';
    }else if(operation.status==='PROVIDER_RESULT_DURABLE'&&operation.provider_result?.source_record_sha256!==sourceHash)result.status='STALE';
    else result.status=operation.status;
   }
   return privateJson(result);
  }catch(error){
   if(error instanceof AccessError)return accessFailure(error);
   return privateJson({code:'ASSESSMENT_STATUS_UNAVAILABLE'},503);
  }
 };
}

export const genuineAssessmentStatusHandler=createGenuineAssessmentStatusHandler({
 guard:operatorHandlers.guard,
 source:()=>loadOperatorSourceRecords(),
 repository:{loadExisting:async namespace=>{
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new AccessError('STATE_UNAVAILABLE',503);
  return new SupabaseDemoStateRepository(url,key).loadExisting(namespace);
 }},
});
