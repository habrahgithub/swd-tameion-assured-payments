import {z} from 'zod';

import {historicalBasisValid} from '../agent/assessment-context';
import {AuthorityStore} from '../authority/aggregate';
import {contentHash} from '../domain/linked-instruction';
import {genuineHasFinancialHistory} from './genuine-authority-boundary';
import {MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION,MAX_GENUINE_SNAPSHOT_BYTES} from './genuine-workflow';
import {parseDemoStateSnapshot,type AssessmentOperation,type DemoStateSnapshot} from './demo-state';
import {validateOperatorBinding} from './load-existing-demo-state';
import {accessFailure,operatorHandlers,privateJson,type AuthContext} from './operator-auth';
import {loadOperatorSourceRecords,MAX_OPERATOR_SOURCE_BYTES,type OperatorSourceView} from './operator-source-records';
import {AccessError,methodNotAllowed,readBoundedJson,requireJson} from './route-access-policy';
import {SupabaseDemoStateRepository} from './supabase-demo-state-repository';

const organization='ORG-DEMO-001';
const bodySchema=z.object({}).strict();
const unresolvedStatuses=new Set<AssessmentOperation['status']>(['UNKNOWN','RESERVED','PROVIDER_RESULT_DURABLE']);

// The reservation contains bounded identifiers, two SHA-256 bindings and
// timestamps. 8 KiB is above that complete serialized envelope. Completion
// additionally budgets the entire maximum approved source packet, the maximum
// persisted provider-derived text (10 x 1,000-char reasons, 1,000-char model
// explanation and up to 16 bounded evidence IDs, at four UTF-8 bytes/char),
// and a separate 64 KiB allowance for the fixed RACE/remediation envelope.
// This derives a conservative persisted-state bound without creating a key or
// constructing an effect-producing record.
export const MAX_GENUINE_RESERVATION_GROWTH_BYTES=8_192;
export const MAX_GENUINE_PROVIDER_DERIVED_BYTES=65_536;
export const MAX_GENUINE_COMPLETION_SCHEMA_OVERHEAD_BYTES=65_536;
export const MAX_GENUINE_COMPLETION_GROWTH_BYTES=MAX_GENUINE_RESERVATION_GROWTH_BYTES+MAX_OPERATOR_SOURCE_BYTES+MAX_GENUINE_PROVIDER_DERIVED_BYTES+MAX_GENUINE_COMPLETION_SCHEMA_OVERHEAD_BYTES;

type Truth='TRUE'|'FALSE'|'UNVERIFIED';
type Presence='NONE'|'PRESENT'|'UNVERIFIED';
type Basis='PRESENT'|'MISSING'|'UNVERIFIED';
type Headroom='READY'|'INSUFFICIENT'|'UNVERIFIED';

export interface GenuineAssessmentEligibility {
 target_bound:Truth;
 source_state_stable:Truth;
 unresolved_operation:Presence;
 generation_one_operation:Presence;
 assessment_history_below_limit:Truth;
 operation_history_below_limit:Truth;
 financial_history:Presence;
 historical_basis:Basis;
 reservation_size_headroom:Headroom;
 completion_size_headroom:Headroom;
 eligible_for_one_fresh_assessment:boolean;
}

const unavailable=():GenuineAssessmentEligibility=>({
 target_bound:'UNVERIFIED',source_state_stable:'UNVERIFIED',unresolved_operation:'UNVERIFIED',generation_one_operation:'UNVERIFIED',
 assessment_history_below_limit:'UNVERIFIED',operation_history_below_limit:'UNVERIFIED',financial_history:'UNVERIFIED',historical_basis:'UNVERIFIED',
 reservation_size_headroom:'UNVERIFIED',completion_size_headroom:'UNVERIFIED',eligible_for_one_fresh_assessment:false,
});

/** Deterministic categorical projection over one validated stable snapshot. */
export function projectGenuineAssessmentEligibility(snapshot:DemoStateSnapshot,view:OperatorSourceView,id:string,rawSnapshotBytes:number,machineDate:string):GenuineAssessmentEligibility {
 const record=view.records.find(item=>item.obligation_id===id);
 if(!record)return unavailable();
 const store=AuthorityStore.fromSnapshot(snapshot.authority),aggregate=store.get(organization,id);
 const operations=snapshot.assessment_operations.filter(item=>item.obligation_id===id);
 const targetBound=aggregate.source_amount===record.amount&&aggregate.source_currency===record.currency;
 const unresolved=operations.some(item=>unresolvedStatuses.has(item.status));
 const generationOne=operations.some(item=>item.recovery?.generation===1);
 const assessmentBelow=store.getAssessmentHistory(organization,id).length<MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION;
 const operationBelow=operations.length<MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION;
 const financial=genuineHasFinancialHistory(snapshot,id);
 const basis=historicalBasisValid(record,machineDate);
 const reservationReady=rawSnapshotBytes+MAX_GENUINE_RESERVATION_GROWTH_BYTES<MAX_GENUINE_SNAPSHOT_BYTES;
 const completionReady=rawSnapshotBytes+MAX_GENUINE_COMPLETION_GROWTH_BYTES<MAX_GENUINE_SNAPSHOT_BYTES;
 const result:GenuineAssessmentEligibility={
  target_bound:targetBound?'TRUE':'FALSE',source_state_stable:'TRUE',unresolved_operation:unresolved?'PRESENT':'NONE',generation_one_operation:generationOne?'PRESENT':'NONE',
  assessment_history_below_limit:assessmentBelow?'TRUE':'FALSE',operation_history_below_limit:operationBelow?'TRUE':'FALSE',financial_history:financial?'PRESENT':'NONE',historical_basis:basis?'PRESENT':'MISSING',
  reservation_size_headroom:reservationReady?'READY':'INSUFFICIENT',completion_size_headroom:completionReady?'READY':'INSUFFICIENT',
  eligible_for_one_fresh_assessment:targetBound&&!unresolved&&!generationOne&&assessmentBelow&&operationBelow&&!financial&&basis&&reservationReady&&completionReady,
 };
 return result;
}

interface Dependencies {
 guard:(request:Request,post:boolean)=>Promise<AuthContext>;
 source:()=>OperatorSourceView|undefined;
 repository:Pick<SupabaseDemoStateRepository,'loadExisting'>;
 environment:()=>string|undefined;
 now:()=>Date;
}

class EligibilityObservationUnavailable extends Error {
 constructor(readonly status:409|503){super('ELIGIBILITY_OBSERVATION_UNAVAILABLE');}
}

/** Temporary Preview-only observation. It performs two stable reads and has no mutation or provider capability. */
export function createGenuineAssessmentEligibilityHandler(deps:Dependencies){
 return async(request:Request,id:string):Promise<Response>=>{
  if(request.method!=='POST')return methodNotAllowed();
  try{
   if(deps.environment()!=='preview')throw new AccessError('HOLD_ACCESS_PATH',403);
   const auth=await deps.guard(request,true);
   requireJson(request);
   const body=bodySchema.safeParse(await readBoundedJson(request,256));
   if(!body.success)throw new AccessError('BODY_REJECTED',400);
   const view=deps.source();
   if(!view?.state_binding.workflow_base_sha256)throw new AccessError('GENUINE_ADVISORY_AUTHORITY_REQUIRED',403);
   const record=view.records.find(item=>item.obligation_id===id);
   if(!record)throw new AccessError('SOURCE_NOT_FOUND',404);
   const namespace=view.state_binding.namespace,sourceFingerprint=contentHash(view);
   const revalidate=async()=>{
    if(deps.environment()!=='preview')throw new EligibilityObservationUnavailable(409);
    await auth.revalidate();
    const current=deps.source();
    if(!current||contentHash(current)!==sourceFingerprint)throw new EligibilityObservationUnavailable(409);
   };
   const parse=(stored:Awaited<ReturnType<Dependencies['repository']['loadExisting']>>)=>{
    const raw=structuredClone(stored.snapshot);
    if(raw.schema_version!==2||raw.actor_authority_registry_initialized!==true)throw new Error('STATE_SCHEMA_UNAVAILABLE');
    const snapshot=parseDemoStateSnapshot(raw);
    validateOperatorBinding(snapshot,stored.revision,namespace,view.state_binding);
    return {snapshot,rawBytes:Buffer.byteLength(JSON.stringify(raw,null,1),'utf8')};
   };
   await revalidate();
   const first=await deps.repository.loadExisting(namespace),firstHash=contentHash(first.snapshot),firstParsed=parse(first);
   projectGenuineAssessmentEligibility(firstParsed.snapshot,view,id,firstParsed.rawBytes,deps.now().toISOString().slice(0,10));
   await revalidate();
   await revalidate();
   const second=await deps.repository.loadExisting(namespace),secondHash=contentHash(second.snapshot),secondParsed=parse(second);
   await revalidate();
   if(first.revision!==second.revision||firstHash!==secondHash)throw new EligibilityObservationUnavailable(409);
   const now=deps.now();
   if(!Number.isFinite(now.getTime()))throw new Error('CLOCK_UNAVAILABLE');
   return privateJson(projectGenuineAssessmentEligibility(secondParsed.snapshot,view,id,secondParsed.rawBytes,now.toISOString().slice(0,10)));
  }catch(error){
   if(error instanceof EligibilityObservationUnavailable)return privateJson(unavailable(),error.status);
   if(error instanceof AccessError)return accessFailure(error);
   return privateJson(unavailable(),503);
  }
 };
}

export const genuineAssessmentEligibilityHandler=createGenuineAssessmentEligibilityHandler({
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
