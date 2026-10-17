import {z} from 'zod';
import {contentHash} from '../domain/linked-instruction';
import type {AssessmentOperation,DemoStateSnapshot} from './demo-state';
import type {OperatorSourceView} from './operator-source-records';
import {genuineHasFinancialHistory} from './genuine-authority-boundary';
export const RECOVERY_GRACE_MS=60_000;
export const assessmentRecoverySchema=z.object({
 generation:z.union([z.literal(0),z.literal(1)]),source_record_sha256:z.string().regex(/^[a-f0-9]{64}$/),
 binding_sha256:z.string().regex(/^[a-f0-9]{64}$/),unknown_at:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
 predecessor_key:z.uuid().optional(),predecessor_sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict().superRefine((r,c)=>{if(r.generation===0&&(r.predecessor_key||r.predecessor_sha256)||r.generation===1&&(!r.predecessor_key||!r.predecessor_sha256))c.addIssue({code:'custom',message:'Invalid recovery generation'});});
export type AssessmentRecovery=z.infer<typeof assessmentRecoverySchema>;
export function assertAssessmentLineage(operations:readonly AssessmentOperation[]){
 for(const o of operations){
  if(!o.recovery)continue;
  const r=assessmentRecoverySchema.parse(o.recovery);
  if(!Number.isSafeInteger(o.reserved_at)||o.reserved_at!<0||r.unknown_at!==undefined&&(o.status!=='UNKNOWN'||r.unknown_at<o.reserved_at!))throw new Error('ASSESSMENT_TIMING_INVALID');
  if(o.status==='UNKNOWN'&&r.unknown_at===undefined)throw new Error('ASSESSMENT_UNKNOWN_TIMING_MISSING');
  if(r.generation===1){const p=operations.find(p=>p.idempotency_key===r.predecessor_key);
   if(!p||p.status!=='UNKNOWN'||p.recovery?.generation!==0||p.recovery.unknown_at===undefined||
    p.obligation_id!==o.obligation_id||p.aggregate_version!==o.aggregate_version||p.recovery.source_record_sha256!==r.source_record_sha256||p.recovery.binding_sha256!==r.binding_sha256||
    contentHash(p)!==r.predecessor_sha256||o.reserved_at!<Math.max(p.recovery.unknown_at,p.reserved_at!+45_000)+RECOVERY_GRACE_MS||
    operations.filter(c=>c.recovery?.predecessor_key===p.idempotency_key).length!==1)throw new Error('ASSESSMENT_LINEAGE_INVALID');
  }
 }
}
export interface GenuineAssessmentVisibility {status:'NONE'|'UNKNOWN'|'IN_PROGRESS'|'COMPLETED';recovery_eligible:boolean;recovery_reason:'NO_UNKNOWN'|'LEGACY_EVIDENCE_MISSING'|'SOURCE_CHANGED'|'FINANCIAL_HISTORY'|'ACTIVE_OR_SUCCESSOR'|'HISTORY_LIMIT'|'GRACE'|'ELIGIBLE';eligible_at?:string}
export function genuineAssessmentVisibility(snapshot:DemoStateSnapshot,view:OperatorSourceView,id:string,version:number,now=Date.now()):GenuineAssessmentVisibility {
 assertAssessmentLineage(snapshot.assessment_operations);
 const ops=snapshot.assessment_operations.filter(o=>o.obligation_id===id);
 const unresolved=ops.filter(o=>['UNKNOWN','RESERVED','PROVIDER_RESULT_DURABLE'].includes(o.status)&&!ops.some(c=>c.recovery?.predecessor_key===o.idempotency_key));
 const status=unresolved.some(o=>o.status==='UNKNOWN')?'UNKNOWN':unresolved.length?'IN_PROGRESS':ops.some(o=>o.status==='COMPLETED')?'COMPLETED':'NONE';
 const deny=(recovery_reason:GenuineAssessmentVisibility['recovery_reason'],eligible_at?:string):GenuineAssessmentVisibility=>({status,recovery_eligible:false,recovery_reason,...(eligible_at?{eligible_at}:{})});
 const roots=ops.filter(o=>o.status==='UNKNOWN'&&o.recovery?.generation!==1);
 if(roots.length!==1)return deny(roots.length?'ACTIVE_OR_SUCCESSOR':'NO_UNKNOWN');
 const p=roots[0],r=p.recovery;
 if(!r||r.unknown_at===undefined||p.reserved_at===undefined)return deny('LEGACY_EVIDENCE_MISSING');
 const source=view.records.find(s=>s.obligation_id===id);
 if(!source||p.aggregate_version!==version||r.source_record_sha256!==contentHash(source)||r.binding_sha256!==contentHash(view.state_binding))return deny('SOURCE_CHANGED');
 if(genuineHasFinancialHistory(snapshot,id))return deny('FINANCIAL_HISTORY');
 if(ops.some(o=>o!==p&&['RESERVED','PROVIDER_RESULT_DURABLE','UNKNOWN'].includes(o.status))||ops.some(o=>o.recovery?.generation===1))return deny('ACTIVE_OR_SUCCESSOR');
 if(ops.length>=4||snapshot.authority.assessments.filter(a=>a.record.obligation_id===id).length>=4)return deny('HISTORY_LIMIT');
 const eligibleAt=Math.max(r.unknown_at,p.reserved_at+45_000)+RECOVERY_GRACE_MS;
 if(!Number.isSafeInteger(now)||now<r.unknown_at||now<eligibleAt)return deny('GRACE',new Date(eligibleAt).toISOString());
 return {status,recovery_eligible:true,recovery_reason:'ELIGIBLE',eligible_at:new Date(eligibleAt).toISOString()};
}
