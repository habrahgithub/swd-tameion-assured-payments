import {z} from 'zod';
import {contentHash} from '../domain/linked-instruction';
import type {AssessmentOperation,DemoStateSnapshot} from './demo-state';
import type {OperatorSourceView} from './operator-source-records';
import {genuineHasFinancialHistory} from './genuine-authority-boundary';
import {classifyGenuineAdmission,evaluateDispositionAdmission,MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION,type DispositionDenial,type GenuineAdmission} from './genuine-admission';
import {assertDispositionLineage,dispositionReceiptCurrent,isUnboundLegacyUnknown,resolveDisposition,unresolvedAssessmentOperations} from './genuine-disposition';
export const RECOVERY_GRACE_MS=60_000;
const keyPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Durable provenance for one explicit current-source bootstrap. The reference is preserved, unverified and never relabeled. */
export const assessmentBootstrapSchema=z.object({
 kind:z.literal('CURRENT_SOURCE_BOOTSTRAP'),
 source_record_sha256:z.string().regex(/^[a-f0-9]{64}$/),binding_sha256:z.string().regex(/^[a-f0-9]{64}$/),
 aggregate_version:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
 unmatched_reference_key:z.string().regex(keyPattern),unmatched_reference_status:z.literal('UNVERIFIED_ABSENT_FROM_RECORDED_OPERATIONS'),
}).strict();
export type AssessmentBootstrap=z.infer<typeof assessmentBootstrapSchema>;
export const assessmentRecoverySchema=z.object({
 generation:z.union([z.literal(0),z.literal(1)]),source_record_sha256:z.string().regex(/^[a-f0-9]{64}$/),
 binding_sha256:z.string().regex(/^[a-f0-9]{64}$/),unknown_at:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
 predecessor_key:z.uuid().optional(),predecessor_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((r,c)=>{if(r.generation===0&&(r.predecessor_key||r.predecessor_sha256)||r.generation===1&&(!r.predecessor_key||!r.predecessor_sha256))c.addIssue({code:'custom',message:'Invalid recovery generation'});});
export type AssessmentRecovery=z.infer<typeof assessmentRecoverySchema>;
export function assertAssessmentLineage(operations:readonly AssessmentOperation[]){
 for(const o of operations){
  if(o.bootstrap&&!o.recovery)throw new Error('ASSESSMENT_BOOTSTRAP_INVALID');
  if(!o.recovery)continue;
  const r=assessmentRecoverySchema.parse(o.recovery);
  if(o.bootstrap&&(r.generation!==0||o.bootstrap.source_record_sha256!==r.source_record_sha256||o.bootstrap.binding_sha256!==r.binding_sha256||o.bootstrap.aggregate_version!==o.aggregate_version||
   o.bootstrap.unmatched_reference_key===o.idempotency_key||operations.some(c=>c.idempotency_key===o.bootstrap!.unmatched_reference_key)||
   operations.filter(c=>c.bootstrap&&c.obligation_id===o.obligation_id).length!==1))throw new Error('ASSESSMENT_BOOTSTRAP_INVALID');
  if(!Number.isSafeInteger(o.reserved_at)||o.reserved_at!<0||r.unknown_at!==undefined&&(o.status!=='UNKNOWN'||r.unknown_at<o.reserved_at!))throw new Error('ASSESSMENT_TIMING_INVALID');
  if(o.status==='UNKNOWN'&&r.unknown_at===undefined)throw new Error('ASSESSMENT_UNKNOWN_TIMING_MISSING');
  if(r.generation===1){const p=operations.find(p=>p.idempotency_key===r.predecessor_key);
   if(!p||p.legacy_disposition!==undefined||p.status!=='UNKNOWN'||p.recovery?.generation!==0||p.recovery.unknown_at===undefined||
    p.obligation_id!==o.obligation_id||p.aggregate_version!==o.aggregate_version||p.recovery.source_record_sha256!==r.source_record_sha256||p.recovery.binding_sha256!==r.binding_sha256||
    contentHash(p)!==r.predecessor_sha256||o.reserved_at!<Math.max(p.recovery.unknown_at,p.reserved_at!+45_000)+RECOVERY_GRACE_MS||
    operations.filter(c=>c.recovery?.predecessor_key===p.idempotency_key).length!==1)throw new Error('ASSESSMENT_LINEAGE_INVALID');
  }
 }
}
/** Read-only projection of the separate current-source disposition. The predecessor stays historical; its UUID keeps reporting UNKNOWN. */
export interface DispositionVisibility {
 state:'NONE'|'AVAILABLE'|'USED'|'UNAVAILABLE';reason?:DispositionDenial|'NO_UNBOUND_UNKNOWN';
 /** No request identifiers are projected: readers must never learn an unresolved request's key. */
 approval_id?:string;expires_at?:string;predecessor_sha256?:string;
 /** Public assessment hash of the child's seal (never an operation key) and whether that receipt is current for the source/version/binding. */
 child_status?:AssessmentOperation['status'];child_seal_hash?:string;child_current?:boolean;prior_binding_status?:'UNVERIFIED';
}
export interface GenuineAssessmentVisibility {admission?:GenuineAdmission;status:'NONE'|'UNKNOWN'|'IN_PROGRESS'|'COMPLETED';recovery_eligible:boolean;recovery_reason:'NO_UNKNOWN'|'LEGACY_EVIDENCE_MISSING'|'SOURCE_CHANGED'|'FINANCIAL_HISTORY'|'ACTIVE_OR_SUCCESSOR'|'DISPOSITION_CLOSED'|'HISTORY_LIMIT'|'GRACE'|'ELIGIBLE';eligible_at?:string;disposition?:DispositionVisibility;/** Annotation only: the earlier UNKNOWN is historical and superseded; no operation identifier is projected. */historical_unresolved?:{status:'UNKNOWN';superseded:true}}
export function genuineAssessmentVisibility(snapshot:DemoStateSnapshot,view:OperatorSourceView,id:string,version:number,now=Date.now()):GenuineAssessmentVisibility {
 assertAssessmentLineage(snapshot.assessment_operations);
 assertDispositionLineage(snapshot.assessment_operations,snapshot.authority.assessments.map(a=>a.record.assessment_id));
 const ops=snapshot.assessment_operations.filter(o=>o.obligation_id===id);
 const relation=resolveDisposition(snapshot.assessment_operations,id);
 const unresolved=unresolvedAssessmentOperations(snapshot.assessment_operations,id);
 const status=unresolved.some(o=>o.status==='UNKNOWN')?'UNKNOWN':unresolved.length?'IN_PROGRESS':ops.some(o=>o.status==='COMPLETED')?'COMPLETED':'NONE';
 const disposition=dispositionVisibility(snapshot,view,id,version,now,relation);
 const historical=relation?{historical_unresolved:{status:'UNKNOWN' as const,superseded:true as const}}:{};
 const deny=(recovery_reason:GenuineAssessmentVisibility['recovery_reason'],eligible_at?:string):GenuineAssessmentVisibility=>({status,recovery_eligible:false,recovery_reason,...(eligible_at?{eligible_at}:{}),disposition,...historical});
 // A disposition child never opens generation-1 recovery or another disposition, whatever its status.
 if(relation)return deny('DISPOSITION_CLOSED');
 const roots=ops.filter(o=>o.status==='UNKNOWN'&&o.recovery?.generation!==1);
 if(roots.length!==1)return deny(roots.length?'ACTIVE_OR_SUCCESSOR':'NO_UNKNOWN');
 const p=roots[0],r=p.recovery;
 if(!r||r.unknown_at===undefined||p.reserved_at===undefined)return deny('LEGACY_EVIDENCE_MISSING');
 const source=view.records.find(s=>s.obligation_id===id);
 if(!source||p.aggregate_version!==version||r.source_record_sha256!==contentHash(source)||r.binding_sha256!==contentHash(view.state_binding))return deny('SOURCE_CHANGED');
 if(genuineHasFinancialHistory(snapshot,id))return deny('FINANCIAL_HISTORY');
 if(ops.some(o=>o!==p&&['RESERVED','PROVIDER_RESULT_DURABLE','UNKNOWN'].includes(o.status))||ops.some(o=>o.recovery?.generation===1))return deny('ACTIVE_OR_SUCCESSOR');
 if(classifyGenuineAdmission(snapshot,id).counted_history>=MAX_GENUINE_ASSESSMENTS_PER_OBLIGATION)return deny('HISTORY_LIMIT');
 const eligibleAt=Math.max(r.unknown_at,p.reserved_at+45_000)+RECOVERY_GRACE_MS;
 if(!Number.isSafeInteger(now)||now<r.unknown_at||now<eligibleAt)return deny('GRACE',new Date(eligibleAt).toISOString());
 return {status,recovery_eligible:true,recovery_reason:'ELIGIBLE',eligible_at:new Date(eligibleAt).toISOString(),disposition};
}
function dispositionVisibility(snapshot:DemoStateSnapshot,view:OperatorSourceView,id:string,version:number,now:number,relation:ReturnType<typeof resolveDisposition>):DispositionVisibility{
 const ops=snapshot.assessment_operations;
 if(relation){
  const {child}=relation,source=view.records.find(s=>s.obligation_id===id),sealed=snapshot.authority.assessments.find(a=>a.hash===child.assessment_hash);
  const current=Boolean(source&&child.status==='COMPLETED'&&sealed&&child.aggregate_version===version&&dispositionReceiptCurrent(ops,id,sealed,contentHash(source),contentHash(view.state_binding),version));
  return {state:'USED',child_status:child.status,...(child.assessment_hash?{child_seal_hash:child.assessment_hash}:{}),child_current:current,prior_binding_status:'UNVERIFIED'};
 }
 const candidates=ops.filter(o=>o.obligation_id===id&&isUnboundLegacyUnknown(o));
 if(candidates.length!==1)return {state:'NONE',reason:'NO_UNBOUND_UNKNOWN'};
 const evaluation=evaluateDispositionAdmission(snapshot,view,id,version,now);
 return evaluation.ok?{state:'AVAILABLE',approval_id:evaluation.admission.approval_id,expires_at:evaluation.admission.expires_at,predecessor_sha256:evaluation.admission.predecessor_sha256}:{state:'UNAVAILABLE',reason:evaluation.reason};
}
