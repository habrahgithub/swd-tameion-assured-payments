import type {AssessmentOperation,DemoStateSnapshot} from './demo-state';
import {contentHash} from '../domain/linked-instruction';
import {genuineHasFinancialHistory} from './genuine-authority-boundary';
import {admissionWindow,dispositionChildren,isSupersededOperation,isUnboundLegacyUnknown,type OwnerAdmission} from './genuine-disposition';
import {deterministicHistoricalContextValid} from '../agent/context-builder';
import type {OperatorSourceView} from './operator-source-records';
const ORG='ORG-DEMO-001';
export const MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION=4;
export type GenuineAdmissionReason='ELIGIBLE'|'LEGACY_HISTORY_ONLY'|'HISTORY_LIMIT'|'UNRESOLVED_OPERATION'|'FINANCIAL_HISTORY';
export const BOOTSTRAP_GATE_CODES=['BOOTSTRAP_AVAILABLE','BOOTSTRAP_PROTECTION_NOT_ATTESTED','BOOTSTRAP_FINANCIAL_HISTORY','BOOTSTRAP_UNRESOLVED_OPERATION','BOOTSTRAP_HISTORY_LIMIT','BOOTSTRAP_HISTORY_NOT_ESTABLISHED','NOT_APPLICABLE','UNAVAILABLE'] as const;
export type BootstrapGateCode=typeof BOOTSTRAP_GATE_CODES[number];
export interface GenuineAdmission {
 can_assess:boolean;reason:GenuineAdmissionReason;
 /** Server would accept one explicit current-source bootstrap (all other gates, incl. protection attestation, checked by caller). */
 can_bootstrap:boolean;
 legacy_history_count:number;
 /** Entries that consume the limit: genuine or unclassifiable, never legacy-matched pairs. */
 counted_history:number;
 genuine_admissions:number;
 unclassifiable_history:number;
}
export type ProjectedGenuineAdmission=GenuineAdmission&{bootstrap_gate_code:BootstrapGateCode};
/** Controller attestation values for the one existing guard variable. 'APPLIED' attests only migration 20261019120000 (bootstrap);
 * the distinct versioned value attests the superseding migration 20261019190000 that also guards current-source dispositions. */
export const BOOTSTRAP_GUARD_ATTESTATION='APPLIED';
export const DISPOSITION_GUARD_ATTESTATION='APPLIED_DISPOSITION_V1';
/** Without attestation no bootstrap is offered or accepted. The newer guard is a superset, so it also covers bootstrap. */
export const bootstrapProtectionAttested=()=>[BOOTSTRAP_GUARD_ATTESTATION,DISPOSITION_GUARD_ATTESTATION].includes(process.env.TAMEION_ASSESSMENT_BOOTSTRAP_GUARD??'');
/** Only the new guard value authorizes a current-source disposition; old, unknown or missing values never do. */
export const dispositionProtectionAttested=()=>process.env.TAMEION_ASSESSMENT_BOOTSTRAP_GUARD===DISPOSITION_GUARD_ATTESTATION;
type Snapshot=Pick<DemoStateSnapshot,'authority'|'assessment_operations'|'sealed_paes'|'authorization_history'|'execution_ledger'>;
const CLOSED=['COMPLETED','STALE'];
const isGenuineOperation=(o:AssessmentOperation)=>o.recovery!==undefined||o.bootstrap!==undefined;
/** Terminal legacy COMPLETED operation/sealed pairs, matched positively and uniquely. Never mutates. */
export function legacyAssessmentPairs(snapshot:Pick<DemoStateSnapshot,'authority'|'assessment_operations'>,id:string){
 const all=snapshot.authority.assessments;
 const mine=all.filter(a=>a.organization_id===ORG&&a.obligation_id===id);
 const pairs=new Map<string,string>();
 for(const o of snapshot.assessment_operations){
  if(o.obligation_id!==id||o.status!=='COMPLETED'||isGenuineOperation(o)||o.provider_result!==undefined||typeof o.assessment_hash!=='string')continue;
  const assessmentId=`ASM-${o.idempotency_key}`;
  const claimed=all.filter(a=>a.hash===o.assessment_hash||a.record.assessment_id===assessmentId);
  if(claimed.length!==1)continue;
  const sealed=claimed[0];
  if(!mine.includes(sealed)||sealed.hash!==o.assessment_hash||sealed.record.assessment_id!==assessmentId||sealed.record.organization_id!==ORG||sealed.record.obligation_id!==id||
   sealed.record.aggregate_version!==String(o.aggregate_version)||sealed.record.source_record_sha256!==undefined)continue;
  pairs.set(o.idempotency_key,sealed.hash);
 }
 // A sealed entry claimed by two operations exempts neither.
 const hashes=[...pairs.values()];
 return new Map([...pairs].filter(([,hash])=>hashes.filter(h=>h===hash).length===1));
}
/** One classifier for read projection, reservation, bootstrap and UNKNOWN recovery. */
export function classifyGenuineAdmission(snapshot:Snapshot,id:string):GenuineAdmission{
 const ops=snapshot.assessment_operations.filter(o=>o.obligation_id===id);
 const sealed=snapshot.authority.assessments.filter(a=>a.organization_id===ORG&&a.obligation_id===id);
 const pairs=legacyAssessmentPairs(snapshot,id),pairedHashes=new Set(pairs.values());
 const countedOps=ops.filter(o=>!pairs.has(o.idempotency_key));
 const countedSealed=sealed.filter(a=>!pairedHashes.has(a.hash));
 const genuine=countedOps.filter(isGenuineOperation).length+countedSealed.filter(a=>a.record.source_record_sha256!==undefined).length;
 const unclassifiable=countedOps.filter(o=>!isGenuineOperation(o)).length+countedSealed.filter(a=>a.record.source_record_sha256===undefined).length;
 // Existing limit semantics: operations and sealed history are each bounded across all versions.
 const counted=Math.max(countedOps.length,countedSealed.length);
 const financial=genuineHasFinancialHistory(snapshot as DemoStateSnapshot,id);
 // Any non-terminal operation of any age/version (parser-normalized PENDING included) denies.
 // A validated disposition child takes over the blocking role of its historical predecessor; everything else stays closed.
 const unresolved=ops.some(o=>!CLOSED.includes(o.status)&&!isSupersededOperation(ops,o))||ops.some(o=>o.recovery?.generation===1);
 const reason:GenuineAdmissionReason=financial?'FINANCIAL_HISTORY':unresolved?'UNRESOLVED_OPERATION':counted>=MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION?'HISTORY_LIMIT':pairs.size>0&&counted===0?'LEGACY_HISTORY_ONLY':'ELIGIBLE';
 const can_assess=reason==='ELIGIBLE'||reason==='LEGACY_HISTORY_ONLY';
 return {can_assess,reason,can_bootstrap:can_assess&&pairs.size>0&&genuine===0&&unclassifiable===0,legacy_history_count:pairs.size,counted_history:counted,genuine_admissions:genuine,unclassifiable_history:unclassifiable};
}
/** Adds an explanatory projection only; the existing classifier remains the sole eligibility oracle. */
export function projectGenuineAdmission(snapshot:Snapshot,id:string,protectionAttested=bootstrapProtectionAttested()):ProjectedGenuineAdmission{
 const classified=classifyGenuineAdmission(snapshot,id);
 const classifierAllows=classified.can_bootstrap;
 const bootstrap_gate_code:BootstrapGateCode=classifierAllows
  ?protectionAttested?'BOOTSTRAP_AVAILABLE':'BOOTSTRAP_PROTECTION_NOT_ATTESTED'
  :classified.reason==='FINANCIAL_HISTORY'?'BOOTSTRAP_FINANCIAL_HISTORY'
  :classified.reason==='UNRESOLVED_OPERATION'?'BOOTSTRAP_UNRESOLVED_OPERATION'
  :classified.reason==='HISTORY_LIMIT'?'BOOTSTRAP_HISTORY_LIMIT'
  :'BOOTSTRAP_HISTORY_NOT_ESTABLISHED';
 return {...classified,can_bootstrap:classifierAllows&&protectionAttested,bootstrap_gate_code};
}
const TRANSITIONS:Record<string,string[]>={RESERVED:['RESERVED','PROVIDER_RESULT_DURABLE','UNKNOWN','STALE','COMPLETED'],PROVIDER_RESULT_DURABLE:['PROVIDER_RESULT_DURABLE','COMPLETED','STALE'],UNKNOWN:['UNKNOWN'],COMPLETED:['COMPLETED'],STALE:['STALE']};
/** Mirrors the SQL guard in migration 20261019120000: bootstrap identity/binding/reference is immutable; only status progression is allowed. */
export function assertBootstrapOperationPreservation(previous:readonly AssessmentOperation[],next:readonly AssessmentOperation[]){
 const same=(a:unknown,b:unknown)=>contentHash(a)===contentHash(b);
 const fail=()=>{throw new Error('ASSESSMENT_BOOTSTRAP_IMMUTABLE');};
 for(const old of previous){
  if(!old.bootstrap)continue;
  const matches=next.filter(o=>o.idempotency_key===old.idempotency_key);
  if(matches.length!==1)fail();
  const now=matches[0],{unknown_at:oldUnknown,...oldRecovery}=old.recovery??{} as Record<string,unknown>,{unknown_at:newUnknown,...newRecovery}=now.recovery??{} as Record<string,unknown>;
  if(now.obligation_id!==old.obligation_id||now.aggregate_version!==old.aggregate_version||now.reserved_at!==old.reserved_at||!same(now.bootstrap,old.bootstrap)||!old.recovery||!now.recovery||!same(newRecovery,oldRecovery))fail();
  if(!(TRANSITIONS[old.status]??[]).includes(now.status)||oldUnknown!==undefined&&oldUnknown!==newUnknown||now.status==='UNKNOWN'&&newUnknown===undefined||old.assessment_hash!==undefined&&old.assessment_hash!==now.assessment_hash)fail();
 }
 for(const now of next){
  if(!now.bootstrap)continue;
  const old=previous.find(o=>o.idempotency_key===now.idempotency_key);
  if(old&&!old.bootstrap)fail();
  if(!old&&(now.status!=='RESERVED'||now.recovery?.generation!==0))fail();
  if(next.filter(o=>o.bootstrap&&o.obligation_id===now.obligation_id).length!==1)fail();
 }
}
export type DispositionDenial='GUARD_UNATTESTED'|'ADMISSION_MISSING'|'ADMISSION_INVALID'|'ADMISSION_NOT_YET_VALID'|'ADMISSION_EXPIRED'|'ADMISSION_MISMATCH'|'VERSION_MISMATCH'|'SOURCE_CHANGED'|'TIMING_BASIS_INVALID'|'ALREADY_USED'|'FINANCIAL_HISTORY'|'PREDECESSOR_INVALID'|'UNRESOLVED_OPERATION'|'HISTORY_LIMIT';
export type DispositionEvaluation={ok:true;predecessor:AssessmentOperation;admission:OwnerAdmission;admission_sha256:string;source_record_sha256:string;binding_sha256:string}|{ok:false;reason:DispositionDenial};
export interface DispositionRequest {approval_id?:string;predecessor_key?:string;predecessor_sha256?:string}
/** Everything that must hold before a separate current-source disposition may spend its attempt. Pure and side-effect free. */
export function evaluateDispositionAdmission(snapshot:Snapshot,view:OperatorSourceView,id:string,version:number,now:number,request:DispositionRequest={}):DispositionEvaluation{
 const deny=(reason:DispositionDenial):DispositionEvaluation=>({ok:false,reason});
 if(!dispositionProtectionAttested())return deny('GUARD_UNATTESTED');
 const state=view.owner_admission;
 if(!state)return deny('ADMISSION_MISSING');
 if(state.status!=='VALID')return deny('ADMISSION_INVALID');
 const a=state.admission,window=admissionWindow(a,now);
 if(window==='FUTURE')return deny('ADMISSION_NOT_YET_VALID');
 if(window==='EXPIRED')return deny('ADMISSION_EXPIRED');
 const record=view.records.find(r=>r.obligation_id===id);
 if(!record||a.obligation_id!==id)return deny('ADMISSION_MISMATCH');
 const sourceHash=contentHash(record),bindingHash=contentHash(view.state_binding);
 if(a.source_record_sha256!==sourceHash||a.binding_sha256!==bindingHash)return deny('SOURCE_CHANGED');
 if(a.aggregate_version!==version)return deny('VERSION_MISMATCH');
 if(request.approval_id!==undefined&&request.approval_id!==a.approval_id||request.predecessor_key!==undefined&&request.predecessor_key!==a.predecessor_key||request.predecessor_sha256!==undefined&&request.predecessor_sha256!==a.predecessor_sha256)return deny('ADMISSION_MISMATCH');
 // Existing deterministic timing-basis contract; never a current-clock or historical-date substitute.
 if(!record.assessment_basis||!deterministicHistoricalContextValid(record))return deny('TIMING_BASIS_INVALID');
 const ops=snapshot.assessment_operations.filter(o=>o.obligation_id===id);
 if(dispositionChildren(snapshot.assessment_operations,id).length)return deny('ALREADY_USED');
 if(genuineHasFinancialHistory(snapshot as DemoStateSnapshot,id))return deny('FINANCIAL_HISTORY');
 const matches=ops.filter(o=>o.idempotency_key===a.predecessor_key),predecessor=matches[0];
 if(matches.length!==1||!isUnboundLegacyUnknown(predecessor)||predecessor.aggregate_version>version||contentHash(predecessor)!==a.predecessor_sha256||snapshot.authority.assessments.some(s=>s.record.assessment_id===`ASM-${predecessor.idempotency_key}`))return deny('PREDECESSOR_INVALID');
 if(ops.some(o=>o!==predecessor&&(!CLOSED.includes(o.status)||o.recovery?.generation===1)))return deny('UNRESOLVED_OPERATION');
 if(classifyGenuineAdmission(snapshot,id).counted_history>=MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION)return deny('HISTORY_LIMIT');
 return {ok:true,predecessor,admission:a,admission_sha256:contentHash(a),source_record_sha256:sourceHash,binding_sha256:bindingHash};
}
/** The retained unmatched reference must be absent from every operation and sealed receipt. */
export function bootstrapReferenceAbsent(snapshot:Pick<DemoStateSnapshot,'authority'|'assessment_operations'>,reference:string){
 return !snapshot.assessment_operations.some(o=>o.idempotency_key===reference||o.bootstrap?.unmatched_reference_key===reference)&&!snapshot.authority.assessments.some(a=>a.record.assessment_id===`ASM-${reference}`);
}
