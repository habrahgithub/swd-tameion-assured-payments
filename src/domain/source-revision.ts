import {z} from 'zod';
import {contentHash} from './linked-instruction';
import type {LiveUsageObligationRecord} from '../agent/context-builder';
import {convertSourceToSettlement} from './currency-conversion';

const text=(max=128)=>z.string().trim().min(1).max(max);
const evidence=z.object({evidence_id:text().regex(/^[\x20-\x7E]+$/,'Evidence identifiers must be printable ASCII'),content_sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const common={supplier_name:text(256),description:text(2048),amount:z.string().regex(/^(0|[1-9][0-9]{0,11})\.[0-9]{2}$/).refine(v=>BigInt(v.replace('.',''))>0n),currency:z.enum(['USD','AED']),payer_circle_wallet_id:text(),evidence:z.array(evidence).min(1).max(16)};
export const sourceFieldsSchema=z.discriminatedUnion('kind',[
  z.object({...common,kind:z.literal('INVOICE'),invoice_number:text(),invoice_issue_date:z.iso.date(),payment_terms:text(256),due_date:z.iso.date()}).strict(),
  z.object({...common,kind:z.literal('PREPAID_RECHARGE'),service_reference:text(),purpose:text(1024),service_date:z.iso.date()}).strict(),
]).superRefine((v,ctx)=>{
  if(v.kind==='INVOICE'&&v.due_date<v.invoice_issue_date)ctx.addIssue({code:'custom',path:['due_date'],message:'Due date precedes invoice issue date'});
  if(new Set(v.evidence.map(e=>e.evidence_id)).size!==v.evidence.length)ctx.addIssue({code:'custom',path:['evidence'],message:'Duplicate evidence identity'});
});
export type SourceFields=z.infer<typeof sourceFieldsSchema>;
export const sourceRevisionSchema=z.object({
  schema_version:z.literal('SOURCE-REVISION-1'),organization_id:text(),obligation_id:text(),revision:z.number().int().positive(),
  fields:sourceFieldsSchema,identity_sha256:z.string().regex(/^[a-f0-9]{64}$/),
  parent_sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),imported_source_sha256:z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  actor_id:text(),operator_key:text(),credential_version:z.number().int().positive(),
  reason:text(1024),request_id:z.uuid(),request_sha256:z.string().regex(/^[a-f0-9]{64}$/),created_at:z.iso.datetime({precision:3}),
  activation:z.enum(['CURRENT','DRAFT_PENDING_FINANCIAL_RECOVERY']),
}).strict();
export type SourceRevision=z.infer<typeof sourceRevisionSchema>;
export function sourceIdentity(fields:SourceFields):string {
  return contentHash([fields.supplier_name.trim().toLocaleLowerCase('en'),fields.kind,fields.kind==='INVOICE'?fields.invoice_number:fields.service_reference,fields.kind==='INVOICE'?'INVOICE_IDENTITY':fields.service_date]);
}
export function parseSourceRevisions(value:unknown):SourceRevision[] {
  const rows=z.array(sourceRevisionSchema).max(1000).parse(value??[]);
  const latest=new Map<string,SourceRevision>();const requests=new Set<string>();
  for(const row of rows){
    const prior=latest.get(row.obligation_id);
    if(requests.has(row.request_id)||row.identity_sha256!==sourceIdentity(row.fields)||row.revision!==(prior?.revision??0)+1||row.parent_sha256!==(prior?contentHash(prior):row.imported_source_sha256))throw new Error('SOURCE_HISTORY_INVALID');
    latest.set(row.obligation_id,row);requests.add(row.request_id);
  }
  return structuredClone(rows);
}
/** Entered payer text and source references never establish wallet or invoice verification. */
export function sourceRevisionRecord(row:SourceRevision):LiveUsageObligationRecord {
  const f=row.fields,invoice=f.kind==='INVOICE';
  convertSourceToSettlement(f.amount,f.currency);
  return {current_source_basis:{kind:f.kind,revision:row.revision,business_date:invoice?f.due_date:f.service_date,source_revision_sha256:contentHash(row)},obligation_id:row.obligation_id,beneficiary_name:f.supplier_name,beneficiary_provenance:{provenance_class:'SOURCE_EVIDENCE',evidence_id:f.evidence[0].evidence_id},service_category:f.description,recurrence:'ONE_TIME',issue_date:invoice?f.invoice_issue_date:null,due_date:invoice?f.due_date:null,due_date_status:invoice?'STATED_ON_SOURCE':'NOT_STATED_ON_SOURCE',effective_due_date:invoice?f.due_date:null,amount:f.amount,currency:f.currency,state_at_event_baseline:'OUTSTANDING',business_purpose_confirmed:true,commercial_terms:invoice?f.payment_terms:f.purpose,source_evidence:f.evidence,candidate_readiness:{arc_product_destination_status:'PENDING_VERIFICATION'}};
}
export function effectiveSourceRecords(original:readonly LiveUsageObligationRecord[],rows:SourceRevision[]):LiveUsageObligationRecord[]{
  const records=new Map(original.map(r=>[r.obligation_id,structuredClone(r)]));
  for(const row of rows)if(row.activation==='CURRENT')records.set(row.obligation_id,sourceRevisionRecord(row));
  return [...records.values()];
}
