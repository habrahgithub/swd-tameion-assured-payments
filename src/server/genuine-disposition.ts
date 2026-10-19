import {z} from 'zod';
import {contentHash} from '../domain/linked-instruction';
import type {AssessmentOperation} from './demo-state';
import {ownerAdmissionSchema,parseOwnerAdmission,MAX_ADMISSION_WINDOW_MS,type OwnerAdmission,type OwnerAdmissionState} from './operator-source-records';
const keyPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hash=z.string().regex(/^[a-f0-9]{64}$/);
export {ownerAdmissionSchema,parseOwnerAdmission,MAX_ADMISSION_WINDOW_MS,type OwnerAdmission,type OwnerAdmissionState};
export const admissionWindow=(admission:Pick<OwnerAdmission,'valid_from'|'expires_at'>,now:number):'FUTURE'|'ACTIVE'|'EXPIRED'=>
 !Number.isSafeInteger(now)||now<Date.parse(admission.valid_from)?'FUTURE':now<Date.parse(admission.expires_at)?'ACTIVE':'EXPIRED';

/** Immutable evidence persisted on the new operation. The prior binding is never relabeled as verified. */
export const assessmentDispositionSchema=z.object({
 kind:z.literal('CURRENT_SOURCE_REASSESSMENT'),
 predecessor_key:z.string().regex(keyPattern),predecessor_sha256:hash,
 prior_binding_status:z.literal('UNVERIFIED'),
 admission:ownerAdmissionSchema,admission_sha256:hash,
}).strict().superRefine((d,c)=>{if(contentHash(d.admission)!==d.admission_sha256||d.admission.predecessor_key!==d.predecessor_key||d.admission.predecessor_sha256!==d.predecessor_sha256)c.addIssue({code:'custom',message:'Disposition evidence mismatch'});});
export type AssessmentDisposition=z.infer<typeof assessmentDispositionSchema>;

type Ops=readonly AssessmentOperation[];
/** The only legacy shape a disposition may supersede: no recovery metadata, bootstrap, provider result, seal or prior disposition. */
export const isUnboundLegacyUnknown=(o:AssessmentOperation)=>o.status==='UNKNOWN'&&o.recovery===undefined&&o.bootstrap===undefined&&o.legacy_disposition===undefined&&o.provider_result===undefined&&o.assessment_hash===undefined;
export const dispositionChildren=(ops:Ops,id?:string)=>ops.filter(o=>o.legacy_disposition!==undefined&&(id===undefined||o.obligation_id===id));
/** Structural proof for one disposition child; throws on any malformed or ambiguous relation. Used by parsing and by every consumer. */
export function validateDispositionChild(child:AssessmentOperation,ops:Ops):AssessmentOperation{
 const fail=()=>{throw new Error('ASSESSMENT_DISPOSITION_INVALID');};
 const d=child.legacy_disposition;if(!d)return fail();
 const parsed=assessmentDispositionSchema.safeParse(d);if(!parsed.success)return fail();
 const r=child.recovery;
 if(!r||r.generation!==0||r.predecessor_key!==undefined||r.predecessor_sha256!==undefined||child.bootstrap!==undefined||child.provider_result!==undefined&&child.status!=='PROVIDER_RESULT_DURABLE')return fail();
 if(!Number.isSafeInteger(child.reserved_at)||child.reserved_at!<0)return fail();
 const a=parsed.data.admission;
 if(a.obligation_id!==child.obligation_id||a.aggregate_version!==child.aggregate_version||a.source_record_sha256!==r.source_record_sha256||a.binding_sha256!==r.binding_sha256)return fail();
 // valid_from <= reserved_at < expires_at, proven from the persisted evidence rather than the current clock.
 if(child.reserved_at!<Date.parse(a.valid_from)||child.reserved_at!>=Date.parse(a.expires_at))return fail();
 if(ops.filter(o=>o.idempotency_key===child.idempotency_key).length!==1)return fail();
 const pred=ops.filter(o=>o.idempotency_key===d.predecessor_key);
 if(pred.length!==1||d.predecessor_key===child.idempotency_key)return fail();
 const p=pred[0];
 if(!isUnboundLegacyUnknown(p)||p.obligation_id!==child.obligation_id||p.aggregate_version>child.aggregate_version||contentHash(p)!==d.predecessor_sha256)return fail();
 if(dispositionChildren(ops,child.obligation_id).length!==1||ops.some(o=>o.recovery?.predecessor_key===p.idempotency_key||o.recovery?.predecessor_key===child.idempotency_key))return fail();
 return p;
}
/** Validates every disposition (predecessor, evidence, one-per-obligation) and that no receipt was ever sealed under a predecessor identity. */
export function assertDispositionLineage(ops:Ops,sealedAssessmentIds:readonly string[]=[]){
 for(const child of dispositionChildren(ops)){
  const p=validateDispositionChild(child,ops);
  if(sealedAssessmentIds.includes(`ASM-${p.idempotency_key}`))throw new Error('ASSESSMENT_DISPOSITION_INVALID');
 }
}
/** ONE relation helper: the validated disposition (child + historical predecessor) for an obligation, if any. */
export function resolveDisposition(ops:Ops,id:string):{child:AssessmentOperation;predecessor:AssessmentOperation}|undefined{
 const children=dispositionChildren(ops,id);
 if(!children.length)return undefined;
 if(children.length!==1)throw new Error('ASSESSMENT_DISPOSITION_INVALID');
 return {child:children[0],predecessor:validateDispositionChild(children[0],ops)};
}
/** An operation whose blocking role has been lawfully taken over: by its generation-1 recovery successor or by a validated disposition child. */
export function isSupersededOperation(ops:Ops,o:AssessmentOperation){
 if(ops.some(c=>c.recovery?.predecessor_key===o.idempotency_key))return true;
 const relation=resolveDisposition(ops,o.obligation_id);
 return relation?.predecessor.idempotency_key===o.idempotency_key;
}
export const UNRESOLVED_STATUSES=['UNKNOWN','RESERVED','PROVIDER_RESULT_DURABLE'];
/** Shared unresolved set for one obligation: historical superseded predecessors never block, any other unresolved operation does. */
export function unresolvedAssessmentOperations(ops:Ops,id:string){
 return ops.filter(o=>o.obligation_id===id&&UNRESOLVED_STATUSES.includes(o.status)&&!isSupersededOperation(ops,o));
}
/** The child receipt is current only for its own seal and the matching current source/version/binding. */
export function dispositionReceiptCurrent(ops:Ops,id:string,sealed:{hash:string;record:{assessment_id:string;source_record_sha256?:string;aggregate_version:string}}|undefined,sourceHash:string,bindingHash:string,version:number){
 const relation=resolveDisposition(ops,id);
 if(!relation||!sealed)return true;
 const {child,predecessor}=relation;
 if(sealed.record.assessment_id===`ASM-${predecessor.idempotency_key}`)return false;
 if(sealed.record.assessment_id!==`ASM-${child.idempotency_key}`)return true;
 return child.status==='COMPLETED'&&child.assessment_hash===sealed.hash&&child.aggregate_version===version&&child.recovery?.source_record_sha256===sourceHash&&child.recovery.binding_sha256===bindingHash&&sealed.record.source_record_sha256===sourceHash&&sealed.record.aggregate_version===String(version);
}
/** Mirrors the SQL guard in migration 20261019190000: disposition identity, evidence and predecessor are immutable; only status progression is allowed. */
export function assertDispositionPreservation(previous:Ops,next:Ops,nextSealedIds:readonly string[]=[]){
 const fail=()=>{throw new Error('ASSESSMENT_DISPOSITION_IMMUTABLE');};
 const same=(a:unknown,b:unknown)=>contentHash(a)===contentHash(b);
 const TRANSITIONS:Record<string,string[]>={RESERVED:['RESERVED','PROVIDER_RESULT_DURABLE','UNKNOWN','STALE','COMPLETED'],PROVIDER_RESULT_DURABLE:['PROVIDER_RESULT_DURABLE','COMPLETED','STALE'],UNKNOWN:['UNKNOWN'],COMPLETED:['COMPLETED'],STALE:['STALE']};
 for(const old of previous){
  if(!old.legacy_disposition)continue;
  const matches=next.filter(o=>o.idempotency_key===old.idempotency_key);
  if(matches.length!==1)fail();
  const now=matches[0],{unknown_at:oldUnknown,...oldRecovery}=old.recovery??{} as Record<string,unknown>,{unknown_at:newUnknown,...newRecovery}=now.recovery??{} as Record<string,unknown>;
  if(now.obligation_id!==old.obligation_id||now.aggregate_version!==old.aggregate_version||now.reserved_at!==old.reserved_at||!same(now.legacy_disposition,old.legacy_disposition)||!old.recovery||!now.recovery||!same(newRecovery,oldRecovery))fail();
  if(!(TRANSITIONS[old.status]??[]).includes(now.status)||oldUnknown!==undefined&&oldUnknown!==newUnknown||now.status==='UNKNOWN'&&newUnknown===undefined||old.assessment_hash!==undefined&&old.assessment_hash!==now.assessment_hash)fail();
 }
 for(const now of next){
  if(!now.legacy_disposition)continue;
  const old=previous.find(o=>o.idempotency_key===now.idempotency_key);
  if(old&&!old.legacy_disposition)fail();
  if(!old&&(now.status!=='RESERVED'||now.recovery?.generation!==0))fail();
  const predecessorKey=now.legacy_disposition.predecessor_key,before=previous.find(o=>o.idempotency_key===predecessorKey),after=next.find(o=>o.idempotency_key===predecessorKey);
  if(!before||!after||!same(before,after))fail();
  if(next.filter(o=>o.legacy_disposition&&o.obligation_id===now.obligation_id).length!==1)fail();
  if(nextSealedIds.includes(`ASM-${predecessorKey}`))fail();
  if(next.some(o=>o.recovery?.predecessor_key===now.idempotency_key||o.recovery?.predecessor_key===predecessorKey))fail();
  if(!old&&next.some(o=>o.obligation_id===now.obligation_id&&o.idempotency_key!==predecessorKey&&o.idempotency_key!==now.idempotency_key&&(UNRESOLVED_STATUSES.includes(o.status)||(o.status as string)==='PENDING')))fail();
 }
}
