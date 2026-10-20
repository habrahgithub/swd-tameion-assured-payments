import {describe,it,expect,vi} from 'vitest';
import {createSourceWorkflowHandlers} from '../src/server/source-workflow';
import {AuthorityStore} from '../src/authority/aggregate';
import {DemoState,parseDemoStateSnapshot} from '../src/server/demo-state';
import {contentHash} from '../src/domain/linked-instruction';
import {DemoStateConflictError} from '../src/server/supabase-demo-state-repository';
import type {AuthContext} from '../src/server/operator-auth';
import type {OperatorSourceView} from '../src/server/operator-source-records';

import {sourceFieldsSchema,sourceIdentity} from '../src/domain/source-revision';
import {sourceHarness,invoice} from './test-support/source-workflow-fixture';
describe('server-owned source creation and correction',()=>{
 it('commits complete invoice, reads back and corrects its original lineage without AI/provider access',async()=>{
  const h=sourceHarness(),network=vi.fn(()=>{throw new Error('No network');});vi.stubGlobal('fetch',network);
  const created=await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic invoice entry'}));expect(created.status).toBe(201);
  const first=await created.json(),id=first.obligation.obligation_id;
  expect(first).toMatchObject({committed:true,source_revision:{revision:1,activation:'CURRENT'}});
  const read=await h.handler('detail',new Request('https://synthetic.invalid'),id);expect(read.status).toBe(200);
  expect(await read.json()).toMatchObject({source_revision:{fields:invoice},aggregate:{source_wallet_status:'INACTIVE',destination_verification_status:'PENDING_VERIFICATION'},financial_action_eligible:false});
  const saved=await h.handler('save',h.request({expected_revision:1,expected_version:1,fields:{...invoice,amount:'2.00'},reason:'Correct synthetic amount'}),id);expect(saved.status).toBe(201);
  expect(h.snapshot().source_revisions).toHaveLength(2);expect(h.snapshot().authority.aggregates[0]).toMatchObject({aggregate_version:2,source_amount:'2.00'});
  expect(parseDemoStateSnapshot(h.snapshot()).source_revisions).toHaveLength(2);expect(network).not.toHaveBeenCalled();
 });
 it.each(['invoice_number','supplier_name','invoice_issue_date','payment_terms','due_date','description','amount','currency','payer_circle_wallet_id'])('requires invoice field %s without an incomplete durable draft',async field=>{
  const h=sourceHarness(),fields={...invoice} as Record<string,unknown>;delete fields[field];expect((await h.handler('save',h.request({expected_revision:0,fields,reason:'Synthetic entry'}))).status).toBe(400);expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });
 it('supports legitimate prepaid facts without invoice fields and rejects invented invoice fields',async()=>{
  const h=sourceHarness(),{invoice_number,invoice_issue_date,payment_terms,due_date,...common}=invoice;
  const fields={...common,kind:'PREPAID_RECHARGE',service_reference:'SYNTHETIC-SERVICE-01',purpose:'Synthetic prepaid recharge',service_date:'2026-10-20'};
  const result=await h.handler('save',h.request({expected_revision:0,fields,reason:'Synthetic prepaid entry'}));expect(result.status).toBe(201);const saved=await result.json();expect(saved.obligation.issue_date).toBeNull();expect(saved.obligation.due_date).toBeNull();expect(saved.source_revision.fields).not.toHaveProperty('invoice_number');
  expect((await h.handler('save',h.request({expected_revision:0,fields:{...fields,invoice_number:'invented'},reason:'Invalid synthetic entry'}))).status).toBe(400);
 });
 it('rejects duplicate scope, stale corrections, idempotency conflicts and a read-only actor',async()=>{
  const h=sourceHarness(),body={expected_revision:0,fields:invoice,reason:'Synthetic entry'},key='00000000-0000-4000-8000-000000000099';
  const a=await(await h.handler('save',h.request(body,key))).json(),id=a.obligation.obligation_id;
  expect((await h.handler('save',h.request(body,key))).status).toBe(200);
  expect((await h.handler('save',h.request({...body,reason:'Different request'},key))).status).toBe(409);
  expect((await h.handler('save',h.request(body))).status).toBe(409);
  expect((await h.handler('save',h.request({...body,expected_version:1}),id)).status).toBe(409);
  h.source.source_ingress!.permissions=[];
  expect((await h.handler('save',h.request({...body,fields:{...invoice,invoice_number:'OTHER'}}))).status).toBe(403);
 });
});

describe('R1 advisory recovery regressions',()=>{
 it('retains scoped readback after mutation admission expires and exposes no write actions',async()=>{
  const h=sourceHarness();const saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic entry'}))).json();
  h.source.source_ingress!.expires_at=new Date(Date.now()-1).toISOString();
  const detail=await h.handler('detail',new Request('https://synthetic.invalid'),saved.obligation.obligation_id);
  expect(detail.status).toBe(200);expect((await detail.json()).allowed_actions).toEqual([]);
  expect((await h.handler('save',h.request({expected_revision:1,expected_version:1,fields:invoice,reason:'Expired write'}),saved.obligation.obligation_id)).status).toBe(403);
 });
 it('corrects a never-activated draft and creates a new exact link while preserving its historical predecessor',async()=>{
  const h=sourceHarness();const saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic entry'}))).json(),id=saved.obligation.obligation_id;
  const review=async(version:number)=>{const r=await h.handler('review',h.request({expected_version:version,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Synthetic facts reviewed',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]}),id);expect(r.status).toBe(201);return r.json();};
  const draft=async(version:number,r:any)=>h.handler('draft',h.request({expected_version:version,review_decision_id:r.review_decision.decision_id,review_decision_hash:r.review_decision_hash}),id);
  expect((await draft(1,await review(1))).status).toBe(201);
  const corrected=await h.handler('save',h.request({expected_revision:1,expected_version:1,fields:{...invoice,description:'Corrected synthetic service'},reason:'Correct before activation'}),id);
  expect((await corrected.json()).source_revision.activation).toBe('CURRENT');
  expect((await draft(2,await review(2))).status).toBe(201);
  expect(h.snapshot().linked_settlement_instructions).toHaveLength(2);
 });
});

it.each(['FACTURE-é-1','BAD\nREFERENCE'])('rejects unsupported evidence identifier %s before persistence',async evidence_id=>{
 const h=sourceHarness();expect((await h.handler('save',h.request({expected_revision:0,fields:{...invoice,evidence:[{evidence_id,content_sha256:'a'.repeat(64)}]},reason:'Synthetic invalid identifier'}))).status).toBe(400);expect(h.repository.compareAndSet).not.toHaveBeenCalled();
});
it.each([{evidence_ids:[]},{evidence_ids:['INVENTED-MODEL-CITATION']}])('invalid model citations admit explicit scoped exception review without a spurious source revision: %j',async({evidence_ids})=>{
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic source'}))).json(),id=saved.obligation.obligation_id;
 vi.stubEnv('NVIDIA_API_KEY','SYNTHETIC-NETWORK-FENCED');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({choices:[{message:{content:JSON.stringify({obligation_id:id,decision:'PAY',finding_codes:[],evidence_ids,uncertainty_signal:false,explanation:'Synthetic bad citations'})}}]})));
 const assessed=await h.handler('assess',h.request({}),id);expect(assessed.status).toBe(200);
 const detail=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();expect(detail.review_findings.map((f:{code:string})=>f.code)).toEqual(['MODEL_OUTPUT_INVALID']);
 const response=await h.handler('review',h.request({expected_version:1,mode:'AI_EXCEPTION_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Stored authoritative evidence reviewed; invalid model citation rejected',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[{finding_code:'MODEL_OUTPUT_INVALID',disposition:'ACCEPT_ADVISORY',rationale:'Model citation error only; stored source is intact',evidence_ids:['SYNTHETIC-EVIDENCE']}]}),id);
 expect(response.status).toBe(201);expect(h.snapshot().source_revisions).toHaveLength(1);expect(h.snapshot().authority.review_decisions?.at(-1)?.record.provenance).toBe('HUMAN');
});
it('retains an original late AI attempt without replacing a current human decision after refresh',async()=>{
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic late-AI source'}))).json(),id=saved.obligation.obligation_id;
 let release!:()=>void,started!:()=>void;const wait=new Promise<void>(r=>release=r),dispatched=new Promise<void>(r=>started=r);
 vi.stubEnv('NVIDIA_API_KEY','SYNTHETIC-NETWORK-FENCED');vi.stubGlobal('fetch',vi.fn(async()=>{started();await wait;return Response.json({choices:[{message:{content:JSON.stringify({obligation_id:id,decision:'HOLD',finding_codes:['OTHER_REQUIRES_HUMAN_REVIEW'],evidence_ids:['SYNTHETIC-EVIDENCE'],uncertainty_signal:true,explanation:'Late synthetic advice'})}}]});}));
 const attempt=h.handler('assess',h.request({}),id);await dispatched;
 const review=await h.handler('review',h.request({expected_version:1,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Current facts reviewed despite unresolved AI',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]}),id);expect(review.status).toBe(201);const hash=(await review.json()).review_decision_hash;
 release();await attempt;
 const detail=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();expect(detail.current_review_decision.hash).toBe(hash);expect(h.snapshot().late_assessment_results).toHaveLength(1);expect(h.snapshot().authority.assessments).toEqual([]);expect(h.snapshot().execution_ledger).toEqual([]);
});
it('assigns, reassigns and resolves escalation through immutable linked human decisions',async()=>{
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic escalation source'}))).json(),id=saved.obligation.obligation_id;
 const original=h.snapshot().actor_authorities[0];h.snapshot().actor_authorities.push({...original,actor_id:'SYNTHETIC-ALTERNATE-REVIEWER'});
 const body={expected_version:1,mode:'MANUAL_REVIEW',decision:'ESCALATE',rationale:'Assign scoped synthetic escalation',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]};
 const first=await(await h.handler('review',h.request(body),id)).json();expect(first.review_decision.escalation_owner_actor_id).toBe(original.actor_id);
 const reassigned=await h.handler('review',h.request({...body,expected_review_hash:first.review_decision_hash,escalation_owner_actor_id:'SYNTHETIC-ALTERNATE-REVIEWER'}),id);expect(reassigned.status).toBe(201);const second=await reassigned.json();
 expect((await h.handler('review',h.request({...body,decision:'ACCEPT_FOR_AUTHORIZATION',expected_review_hash:second.review_decision_hash}),id)).status).toBe(201);
 expect(h.snapshot().authority.review_decisions).toHaveLength(3);expect(h.snapshot().authority.review_decisions?.at(-1)?.record.supersedes_review_hash).toBe(second.review_decision_hash);
});
it('missing R1 migration capability blocks mutation before state effects while scoped history remains readable',async()=>{
 const h=sourceHarness();Object.assign(h.repository,{assertRecoveryWorkflowCapability:async()=>{throw new Error('Synthetic missing migration capability');}});
 const response=await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic unavailable migration'}));expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'RECOVERY_MIGRATION_REQUIRED'});expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 expect((await h.handler('list',new Request('https://synthetic.invalid'))).status).toBe(200);
});
it('retains parent history and its financial lock when an activated child namespace cannot be read',async()=>{
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic activated-parent source'}))).json(),id=saved.obligation.obligation_id;
 h.snapshot().linked_activation_receipts=[{instruction_id:'SYNTHETIC-ACTIVATED-CHILD',source_obligation_id:id,namespace:'SYNTHETIC-UNAVAILABLE-CHILD',source_sha256:'a'.repeat(64),activated_at:new Date().toISOString()}];
 const read=h.repository.loadExisting.getMockImplementation()!;h.repository.loadExisting.mockImplementationOnce(read).mockRejectedValueOnce(new Error('Synthetic child history unavailable'));
 const response=await h.handler('detail',new Request('https://synthetic.invalid'),id);expect(response.status).toBe(200);const detail=await response.json();expect(detail.source_revision.revision).toBe(1);expect(detail.blockers[0].code).toBe('EXISTING_FINANCIAL_CLAIM');expect(detail.allowed_actions).not.toContain('MANUAL_REVIEW');expect(h.snapshot().execution_ledger).toEqual([]);
});
it('a legacy FAILED execution with unresolved fee effects retains its original financial claim through source correction',async()=>{
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic legacy claim'}))).json(),id=saved.obligation.obligation_id;
 h.snapshot().execution_ledger.push({obligation_id:id,idempotency_key:'SYNTHETIC-LEGACY-FAILED',provider_ref:'SYNTHETIC-RECORDED-TRANSACTION',status:'FAILED',atomic_amount:'1000000',destination_address:'0x'+'9'.repeat(40),provider_evidence:{status:'FAILED',transaction_state:'FAILED',network_fee:null}});
 const result=await h.handler('save',h.request({expected_revision:1,expected_version:1,fields:{...invoice,amount:'2.00'},reason:'Prepare draft while original failed fee effects are unresolved'}),id);
 expect(result.status).toBe(201);expect((await result.json()).source_revision.activation).toBe('DRAFT_PENDING_FINANCIAL_RECOVERY');expect(h.snapshot().authority.aggregates[0].source_amount).toBe('1.00');expect(h.snapshot().execution_ledger[0].provider_ref).toBe('SYNTHETIC-RECORDED-TRANSACTION');
});
it.each([{kind:'unauthorized',status:401,outcome:'CONFIGURATION_REJECTED'},{kind:'rate limited',status:429,outcome:'RATE_LIMITED'},{kind:'refused',status:200,outcome:'REFUSED'},{kind:'malformed',status:200,outcome:'INVALID_OUTPUT'},{kind:'server unavailable',status:503,outcome:'TRANSPORT_UNCERTAIN'}])('retains typed $kind outcome and admits current exception review without resetting its attempt',async({kind,status,outcome})=>{
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic operational AI outcome'}))).json(),id=saved.obligation.obligation_id;
 vi.stubEnv('NVIDIA_API_KEY','SYNTHETIC-NETWORK-FENCED');const network=vi.fn(async()=>kind==='refused'?Response.json({choices:[{message:{refusal:'Synthetic refusal',content:null}}]}):kind==='malformed'?Response.json({choices:[{message:{content:'invalid synthetic json'}}]}):new Response('Synthetic unavailable',{status}));vi.stubGlobal('fetch',network);
 await h.handler('assess',h.request({}),id);expect(network).toHaveBeenCalledOnce();
 const original=structuredClone(h.snapshot().assessment_operations),detail=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();
 if(outcome==='TRANSPORT_UNCERTAIN')expect(original[0].status).toBe('UNKNOWN');else{expect(original[0].status).toBe('COMPLETED');expect(h.snapshot().authority.assessments[0].record.provider_outcome).toBe(outcome);expect(h.snapshot().authority.assessments[0].record.provider_mode).not.toBe('LIVE_AI');}
 const accepted=await h.handler('review',h.request({expected_version:1,mode:'AI_EXCEPTION_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Current facts reviewed despite synthetic model outage',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:detail.review_findings.map((f:{code:string})=>({finding_code:f.code,disposition:'ACCEPT_ADVISORY',rationale:'Operational model failure does not alter valid source facts',evidence_ids:['SYNTHETIC-EVIDENCE']}))}),id);
 expect(accepted.status).toBe(201);expect(h.snapshot().assessment_operations).toEqual(original);expect(h.snapshot().authority.review_decisions?.at(-1)?.record.provenance).toBe('HUMAN');expect(h.snapshot().execution_ledger).toEqual([]);
});
it('history cap does not exhaust or reset the independent human decision path',async()=>{
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic capped source'}))).json(),id=saved.obligation.obligation_id;
 for(let n=0;n<4;n++)h.snapshot().assessment_operations.push({idempotency_key:`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`,obligation_id:id,aggregate_version:1,status:'STALE'});
 const original=structuredClone(h.snapshot().assessment_operations),network=vi.fn(()=>{throw new Error('No AI after cap');});vi.stubGlobal('fetch',network);expect((await h.handler('assess',h.request({}),id)).status).toBe(409);
 expect((await h.handler('review',h.request({expected_version:1,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Explicit current facts reviewed after cap',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]}),id)).status).toBe(201);expect(h.snapshot().assessment_operations).toEqual(original);expect(network).not.toHaveBeenCalled();
});


describe('C1 immutable review receipt recovery',()=>{
 it('reads the exact original receipt after correction, replacement and a financial claim without CAS or restoring authority',async()=>{
  const h=sourceHarness();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('C1 network fenced');}));
  const made=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'C1 synthetic source'}))).json(),id=made.obligation.obligation_id;
  const body={expected_version:1,mode:'MANUAL_REVIEW',decision:'NEEDS_CORRECTION',rationale:'Correct original synthetic amount',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]},key='00000000-0000-4000-8000-000000000901';
  const original=await(await h.handler('review',h.request(body,key),id)).json();
  expect((await h.handler('save',h.request({expected_revision:1,expected_version:1,fields:{...invoice,amount:'2.00'},reason:'C1 correction'}),id)).status).toBe(201);
  const replacement=await(await h.handler('review',h.request({...body,expected_version:2,decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Corrected facts reviewed'}),id)).json();
  h.snapshot().execution_ledger.push({obligation_id:id,idempotency_key:'SYNTHETIC-C1-UNKNOWN',provider_ref:null,status:'UNKNOWN',atomic_amount:'1000000',destination_address:'0x'+'9'.repeat(40)});
  const before=structuredClone(h.snapshot()),writes=h.repository.compareAndSet.mock.calls.length;
  const replay=await h.handler('review',h.request(body,key),id);expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({...original,replayed:true,historical:true,receipt_only:true,current_authorization:false});
  expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(h.snapshot()).toEqual(before);
  expect(AuthorityStore.fromSnapshot(h.snapshot().authority).getCurrentReviewDecision('ORG-DEMO-001',id)?.hash).toBe(replacement.review_decision_hash);
  const store=AuthorityStore.fromSnapshot(h.snapshot().authority);expect(store.recordReviewDecision(original.review_decision).hash).toBe(original.review_decision_hash);expect(store.exportSnapshot()).toEqual(h.snapshot().authority);
 });
});

it('C1 rejects changed-key/body stale commands and cross-payable receipt lookup without any write',async()=>{
 const h=sourceHarness();const made=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'C1 identity source'}))).json(),id=made.obligation.obligation_id;
 const body={expected_version:1,mode:'MANUAL_REVIEW',decision:'NEEDS_CORRECTION',rationale:'C1 original rationale',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]},key='00000000-0000-4000-8000-000000000902';
 const original=await(await h.handler('review',h.request(body,key),id)).json();
 await h.handler('save',h.request({expected_revision:1,expected_version:1,fields:{...invoice,amount:'2.00'},reason:'C1 corrected amount'}),id);
 const second=await(await h.handler('save',h.request({expected_revision:0,fields:{...invoice,invoice_number:'SYNTHETIC-C1-OTHER'},reason:'C1 other payable'}))).json(),other=second.obligation.obligation_id;
 const before=structuredClone(h.snapshot()),writes=h.repository.compareAndSet.mock.calls.length;
 const conflict=await h.handler('review',h.request({...body,rationale:'Different body'},key),id);expect(conflict.status).toBe(409);expect(await conflict.json()).toMatchObject({code:'REV-002'});
 const stale=await h.handler('review',h.request(body),id);expect(stale.status).toBe(409);expect(await stale.json()).toMatchObject({code:'STALE_STATE'});
 expect((await h.handler('review',h.request(body,key),other)).status).toBe(409);
 expect((await h.handler('review',h.request(body,key),'SYNTHETIC-NONEXISTENT')).status).toBe(404);
 const store=AuthorityStore.fromSnapshot(before.authority);
 expect(()=>store.recordReviewDecision({...original.review_decision,request_id:'00000000-0000-4000-8000-000000000903'})).toThrow();
 expect(()=>store.recordReviewDecision({...original.review_decision,request_sha256:'0'.repeat(64)})).toThrow('Review request conflict');
 expect(()=>store.getReviewDecisionReceipt('SYNTHETIC-WRONG-TENANT',id,key,original.review_decision.request_sha256)).toThrow();
 expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(h.snapshot()).toEqual(before);expect(store.exportSnapshot()).toEqual(before.authority);
});
it.each(['permission','actor','credential','session','late_session','ingress','binding'] as const)('C1 historical replay retains current %s access gate',async gate=>{
 const {AccessError}=await import('../src/server/route-access-policy');
 const h=sourceHarness(),made=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'C1 access source'}))).json(),id=made.obligation.obligation_id;
 const body={expected_version:1,mode:'MANUAL_REVIEW',decision:'NEEDS_CORRECTION',rationale:'C1 access reviewed',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]},key='00000000-0000-4000-8000-000000000904';
 expect((await h.handler('review',h.request(body,key),id)).status).toBe(201);
 if(gate==='permission')h.source.source_ingress!.permissions=[];
 if(gate==='actor')h.snapshot().actor_authorities[0].status='REVOKED';
 if(gate==='credential')h.source.source_ingress!.credential_version=2;
 if(gate==='session')h.guard.mockRejectedValue(new AccessError('SESSION_REQUIRED',401));
 if(gate==='late_session'){const auth=await h.guard();let checks=0;auth.revalidate=async()=>{if(++checks>=2)throw new AccessError('SESSION_REQUIRED',401);};h.guard.mockResolvedValue(auth);}
 if(gate==='ingress')h.source.source_ingress!.expires_at=new Date(Date.now()-1).toISOString();
 if(gate==='binding')h.source.state_binding.namespace='SYNTHETIC-WRONG-NAMESPACE';
 const before=structuredClone(h.snapshot()),writes=h.repository.compareAndSet.mock.calls.length,response=await h.handler('review',h.request(body,key),id);
 expect(response.status).toBe(gate==='session'||gate==='late_session'?401:gate==='binding'?409:403);expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(h.snapshot()).toEqual(before);
});


describe('S02-F01 nonthrowing exact amount validation',()=>{
 const invalidAmounts=[
  {name:'scientific',amount:'1e0'},{name:'upper scientific',amount:'1E2'},
  {name:'alphabetic',amount:'abc'},{name:'comma separator',amount:'1,00'},
  {name:'multiple separators',amount:'1.2.3'},{name:'hexadecimal',amount:'0x10'},
  {name:'empty',amount:''},{name:'negative',amount:'-1.00'},{name:'zero',amount:'0.00'},
  {name:'integer text',amount:'1'},{name:'one decimal',amount:'1.0'},{name:'three decimals',amount:'1.000'},
  {name:'leading zero',amount:'01.00'},{name:'leading space',amount:' 1.00'},{name:'trailing space',amount:'1.00 '},
  {name:'oversize',amount:'1000000000000.00'},{name:'long bounded text',amount:'9'.repeat(100)+'.00'},
  {name:'null',amount:null},{name:'number',amount:1},{name:'boolean',amount:true},
  {name:'object',amount:{}},{name:'array',amount:[]},{name:'missing',amount:undefined},
 ];
 it.each(invalidAmounts)('safeParse reports the $name amount issue without throwing',({amount})=>{
  let result:ReturnType<typeof sourceFieldsSchema.safeParse>|undefined;
  expect(()=>{result=sourceFieldsSchema.safeParse({...invoice,amount});}).not.toThrow();
  expect(result?.success).toBe(false);
  if(result&&!result.success)expect(result.error.issues.some(issue=>issue.path.join('.')==='amount')).toBe(true);
 });
 for(const operation of ['create','correction'] as const){
  it.each(invalidAmounts)(`${operation} returns typed400 for $name without CAS, state change or send`,async({amount})=>{
   const h=sourceHarness(),network=vi.fn(()=>{throw new Error('S02-F01 external network forbidden');});vi.stubGlobal('fetch',network);
   let id:string|undefined;
   if(operation==='correction'){
    const made=await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Valid synthetic source before malformed correction'}));expect(made.status).toBe(201);id=(await made.json()).obligation.obligation_id;
    const reviewed=await h.handler('review',h.request({expected_version:1,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Current synthetic source reviewed before invalid edit',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]}),id);expect(reviewed.status).toBe(201);const review=await reviewed.json();
    expect((await h.handler('draft',h.request({expected_version:1,review_decision_id:review.review_decision.decision_id,review_decision_hash:review.review_decision_hash}),id)).status).toBe(201);
   }
   const before=structuredClone(await h.repository.loadExisting()),writes=h.repository.compareAndSet.mock.calls.length;
   const body={expected_revision:id?1:0,...(id?{expected_version:1}:{}),fields:{...invoice,amount},reason:'Reject malformed amount as an actionable source field error'};
   const keyed=h.request(body),request=new Request('https://synthetic.invalid/api/obligations'+(id?'/'+id:''),{method:id?'PATCH':'POST',headers:keyed.headers,body:JSON.stringify(body)});
   const response=await h.handler('save',request,id),reply=await response.json();
   expect(await h.repository.loadExisting()).toEqual(before);expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(network).not.toHaveBeenCalled();
   expect(response.status).toBe(400);expect(reply).toMatchObject({code:'SOURCE_FIELDS_INVALID'});expect(reply.fields).toEqual(expect.arrayContaining([expect.objectContaining({field:'fields.amount'})]));
  });
 }
 for(const currency of ['USD','AED'] as const)for(const kind of ['INVOICE','PREPAID_RECHARGE'] as const){
  it.each(['0.01','1.00','12.34','999999999999.99'])(`preserves exact positive %s ${currency} ${kind}`,async amount=>{
   const {invoice_number,invoice_issue_date,payment_terms,due_date,...common}=invoice;
   const fields=kind==='INVOICE'?{...invoice,amount,currency}:{...common,kind,amount,currency,service_reference:'SYNTHETIC-S02-SERVICE',purpose:'Legitimate synthetic prepaid facts',service_date:'2026-10-20'};
   const parsed=sourceFieldsSchema.safeParse(fields);expect(parsed.success).toBe(true);if(parsed.success){expect(parsed.data.amount).toBe(amount);expect(parsed.data.currency).toBe(currency);}
   const h=sourceHarness(),saved=await h.handler('save',h.request({expected_revision:0,fields,reason:'Supported exact amount must remain valid'}));expect(saved.status).toBe(201);const data=await saved.json();expect(data.source_revision.fields).toEqual(fields);expect(data.source_revision.identity_sha256).toBe(sourceIdentity(sourceFieldsSchema.parse(fields)));expect(h.snapshot().execution_ledger).toEqual([]);
  });
 }
 it('recovers after scientific correction rejection with a new valid source, fresh review and new draft',async()=>{
  const h=sourceHarness(),made=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic source recovery'}))).json(),id=made.obligation.obligation_id;
  const reviewBody={expected_version:1,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Review synthetic source',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]};
  const original=await(await h.handler('review',h.request(reviewBody),id)).json();await h.handler('draft',h.request({expected_version:1,review_decision_id:original.review_decision.decision_id,review_decision_hash:original.review_decision_hash}),id);
  const before=structuredClone(await h.repository.loadExisting()),writes=h.repository.compareAndSet.mock.calls.length;
  const denied=await h.handler('save',h.request({expected_revision:1,expected_version:1,fields:{...invoice,amount:'1e0'},reason:'Malformed correction'}),id);
  expect(await h.repository.loadExisting()).toEqual(before);expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(denied.status).toBe(400);expect((await denied.json()).code).toBe('SOURCE_FIELDS_INVALID');
  const fixed=await h.handler('save',h.request({expected_revision:1,expected_version:1,fields:{...invoice,description:'Corrected actual synthetic service facts'},reason:'Replace invalid edit with valid exact source facts'}),id);expect(fixed.status).toBe(201);
  const current=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();expect(current.current_review_decision).toBeNull();
  const fresh=await(await h.handler('review',h.request({...reviewBody,expected_version:2,rationale:'Fresh corrected source reviewed'}),id)).json();expect(fresh.review_decision_hash).not.toBe(original.review_decision_hash);
  expect((await h.handler('draft',h.request({expected_version:2,review_decision_id:fresh.review_decision.decision_id,review_decision_hash:fresh.review_decision_hash}),id)).status).toBe(201);
  expect(h.snapshot().source_revisions).toHaveLength(2);expect(h.snapshot().authority.review_decisions).toHaveLength(2);expect(h.snapshot().linked_settlement_instructions).toHaveLength(2);expect(h.snapshot().execution_ledger).toEqual([]);expect(h.snapshot().authority.settlement_postings??[]).toEqual([]);
 });
});
