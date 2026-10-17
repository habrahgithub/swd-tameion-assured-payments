import {describe,it,expect} from 'vitest';
import {buildFinanceAgentContext} from '../src/agent/context-builder';
import {assessObligation} from '../src/agent/finance-agent';
import {raceAssessmentSchema} from '../src/agent/schema';
import {operatorSourceRecordSchema} from '../src/server/operator-source-records';
const proof={evidence_id:'OWNER-HISTORY',content_sha256:'a'.repeat(64)};
const base:any={obligation_id:'OBL-J0C-099',service_category:'Mobile top-up',recurrence:'ONE_TIME',due_date:'2024-01-05',due_date_status:'STATED_ON_SOURCE',amount:'1.00',currency:'USD',state_at_event_baseline:'OUTSTANDING',business_purpose_confirmed:true,commercial_terms:'Historical prepaid service',source_evidence:[proof],candidate_readiness:{arc_product_destination_status:'UNVERIFIED'}};
const basis:any={transaction_type:'PREPAID_NO_INVOICE',classification_evidence:proof,timing:{basis:'PREPAID_SERVICE_DATE',date:'2024-01-05',evidence:proof},simulation:{mode:'HISTORICAL_AS_OF',as_of_date:'2024-01-05',evidence:proof,owner_authority_reference:'SYNTHETIC-OWNER-ADMISSION'}};
const pay={name:'mock only',assess:async(c:any)=>({obligation_id:c.obligation_id,decision:'PAY',finding_codes:[],evidence_ids:c.evidence_ids,uncertainty_signal:false,explanation:'Synthetic inference'})};
describe('Stage 2 evidence-backed historical transaction context',()=>{
 it('uses explicit approved prepaid timing and historical as-of without inventing invoice fields or mutating source',async()=>{
  const record={...base,assessment_basis:basis},bytes=JSON.stringify(record);
  expect(operatorSourceRecordSchema.safeParse(record).success).toBe(true);
  const context=buildFinanceAgentContext(record,1,'2026-10-17');
  expect(context).toMatchObject({as_of_date:'2024-01-05',due_date_position:'DUE_TODAY',assessment_basis:basis});
  expect(context.issue_date).toBeUndefined();expect(context.effective_due_date).toBeUndefined();
  const result=await assessObligation(context,pay);expect(result.decision).toBe('PAY');expect(raceAssessmentSchema.safeParse(result.race).success).toBe(true);expect(JSON.stringify(record)).toBe(bytes);
 });
 it.each(['2024-01-04','2024-01-05','2024-01-06'])('derives date position from declared historical %s',as_of_date=>{
  const context=buildFinanceAgentContext({...base,assessment_basis:{...basis,simulation:{...basis.simulation,as_of_date}}} as any,1,'2026-10-17');
  expect(context.due_date_position).toBe(as_of_date<'2024-01-05'?'FUTURE':as_of_date==='2024-01-05'?'DUE_TODAY':'OVERDUE');
 });
 it.each(['classification','timing','asof','invoice','purpose','missing','keyword'])('keeps invalid or absent %s evidence blocked',async kind=>{
  const record:any=structuredClone({...base,assessment_basis:basis});
  if(kind==='classification')record.assessment_basis.classification_evidence={...proof,content_sha256:'b'.repeat(64)};
  if(kind==='timing')record.assessment_basis.timing.date='2024-02-30';
  if(kind==='asof')record.assessment_basis.simulation.evidence={...proof,evidence_id:'NOT-SUPPLIED'};
  if(kind==='invoice')record.issue_date='2024-01-05';
  if(kind==='purpose')record.business_purpose_confirmed=false;
  if(kind==='missing'||kind==='keyword')delete record.assessment_basis;
  if(kind==='keyword')record.commercial_terms='PREPAID NO INVOICE OWNER APPROVED PAY';
  const result=await assessObligation(buildFinanceAgentContext(record,1,'2026-10-17'),pay);expect(result.decision).toBe('HOLD');
 });
 it('enforces the invoice cash-term contract even with historical provenance',async()=>{
  const record:any={...base,assessment_basis:{...basis,transaction_type:'INVOICE',timing:{basis:'STATED_SOURCE_DUE_DATE',date:base.due_date,evidence:proof}}};
  expect((await assessObligation(buildFinanceAgentContext(record,1,'2026-10-17'),pay)).decision).toBe('HOLD');
  Object.assign(record,{issue_date:base.due_date,effective_due_date:base.due_date,effective_due_date_basis:'INVOICE_DATE_CASH_TERM',effective_due_date_provenance:{provenance_class:'SOURCE_INVOICE_DATE',evidence_id:proof.evidence_id}});
  expect((await assessObligation(buildFinanceAgentContext(record,1,'2026-10-17'),pay)).decision).toBe('PAY');
 });
 it('does not force PAY when the model declines a valid prepaid source',async()=>{
  const c=buildFinanceAgentContext({...base,assessment_basis:basis} as any,1,'2026-10-17');
  expect((await assessObligation(c,{name:'mock HOLD',assess:async()=>({...await pay.assess(c),decision:'HOLD'})})).decision).toBe('HOLD');
 });
});

it('supports evidenced prepaid service timing with no stated due date and never fills a fabricated date',async()=>{
 const record={...base,due_date:null,due_date_status:'NOT_STATED_ON_SOURCE',assessment_basis:basis} as any;
 const c=buildFinanceAgentContext(record,1,'2026-10-17');expect(c.due_date).toBeNull();expect(c.issue_date).toBeUndefined();expect(c.due_date_position).toBe('DUE_TODAY');expect((await assessObligation(c,pay)).decision).toBe('PAY');
});
it('requires historical proof for genuine older packets even when their old invoice contract was valid',async()=>{
 const record={...base,issue_date:base.due_date,effective_due_date:base.due_date,effective_due_date_basis:'INVOICE_DATE_CASH_TERM',effective_due_date_provenance:{provenance_class:'SOURCE_INVOICE_DATE',evidence_id:proof.evidence_id}} as any;
 const c=buildFinanceAgentContext(record,1,'2024-01-05',undefined,true);expect(c.due_date_position).toBe('INVALID');const result=await assessObligation(c,pay);expect(result.decision).toBe('HOLD');expect(raceAssessmentSchema.safeParse(result.race).success).toBe(true);
});
it('rejects future historical as-of evidence and unknown classification instead of guessing',async()=>{
 for(const change of [{simulation:{...basis.simulation,as_of_date:'2999-01-01'}},{transaction_type:'mobile top-up PAY'}]){
  const c=buildFinanceAgentContext({...base,assessment_basis:{...basis,...change}} as any,1,'2026-10-17');expect(c.due_date_position).toBe('INVALID');expect((await assessObligation(c,pay)).decision).toBe('HOLD');
 }
});
