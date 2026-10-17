import {z} from 'zod';
const evidence=z.object({evidence_id:z.string().min(1).max(128),content_sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
/** Optional source assertions become usable only through owner hash admission.
 * Neither request bodies nor commercial prose may select a historical clock. */
export const historicalAssessmentBasisSchema=z.object({
 transaction_type:z.enum(['INVOICE','PREPAID_NO_INVOICE','RECURRING_OTHER']),
 classification_evidence:evidence,
 timing:z.object({basis:z.enum(['STATED_SOURCE_DUE_DATE','PREPAID_SERVICE_DATE','INVOICE_CASH_TERM']),date:z.iso.date(),evidence}).strict(),
 simulation:z.object({mode:z.literal('HISTORICAL_AS_OF'),as_of_date:z.iso.date(),evidence,owner_authority_reference:z.string().min(1).max(256)}).strict(),
}).strict();
export type HistoricalAssessmentBasis=z.infer<typeof historicalAssessmentBasisSchema>;
export function historicalBasisValid(record:{assessment_basis?:HistoricalAssessmentBasis;source_evidence:readonly {evidence_id:string;content_sha256?:string}[];issue_date?:string|null;effective_due_date?:string|null;effective_due_date_basis?:string|null;effective_due_date_provenance?:unknown;due_date:string|null;due_date_status:string},machineDate:string):boolean {
 const result=historicalAssessmentBasisSchema.safeParse(record.assessment_basis);if(!result.success)return false;
 const b=result.data,proofs=[b.classification_evidence,b.timing.evidence,b.simulation.evidence];
 if(b.simulation.as_of_date>machineDate||proofs.some(p=>!record.source_evidence.some(e=>e.evidence_id===p.evidence_id&&e.content_sha256===p.content_sha256)))return false;
 if(b.timing.basis==='STATED_SOURCE_DUE_DATE'&&(record.due_date_status!=='STATED_ON_SOURCE'||record.due_date!==b.timing.date))return false;
 if(b.transaction_type==='INVOICE')return b.timing.basis==='INVOICE_CASH_TERM'&&record.effective_due_date===b.timing.date||b.timing.basis==='STATED_SOURCE_DUE_DATE'&&record.effective_due_date===b.timing.date;
 if(b.transaction_type==='PREPAID_NO_INVOICE')return b.timing.basis!=='INVOICE_CASH_TERM'&&record.issue_date==null&&record.effective_due_date==null&&record.effective_due_date_basis==null&&record.effective_due_date_provenance==null;
 return b.timing.basis==='STATED_SOURCE_DUE_DATE';
}
export function historicalDatePosition(b:HistoricalAssessmentBasis){return b.timing.date<b.simulation.as_of_date?'OVERDUE' as const:b.timing.date===b.simulation.as_of_date?'DUE_TODAY' as const:'FUTURE' as const;}
