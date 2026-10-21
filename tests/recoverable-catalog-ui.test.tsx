/** @vitest-environment jsdom */
import {webcrypto} from 'node:crypto';
import {manualRequest,preparedHumanApproval} from './test-support/manual-payment-fixture';
import {POST as reviewPOST} from '../app/api/obligations/[id]/review/route';
import {POST as executePOST} from '../app/api/obligations/[id]/execute/route';
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,act} from '@testing-library/react';
import {CommandCenter} from '../app/command-center';
import {SourceWorkflowPanel} from '../app/source-workflow-panel';
import {sourceHarness,invoice} from './test-support/source-workflow-fixture';
import {controlledHarness,cleanupSyntheticFinancialFixture} from './test-support/financial-fixture';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {GET as listGET,POST as sourcePOST} from '../app/api/obligations/route';
import {GET as detailGET,PATCH as sourcePATCH} from '../app/api/obligations/[id]/route';
import {loadFinancialSourceAdmission} from '../src/server/financial-source-admission';
const runtime=vi.hoisted(()=>({financial:null as ReturnType<typeof import('../src/server/operator-financial-routes').createFinancialHandlers>|null,source:null as ReturnType<typeof import('../src/server/source-workflow').createSourceWorkflowHandlers>|null,readers:null as ReturnType<typeof import('../src/server/operator-obligation-routes').createObligationReaders>|null}));
vi.mock('../src/server/operator-financial-routes',async original=>({...await original<typeof import('../src/server/operator-financial-routes')>(),financialHandlers:(...args:Parameters<typeof import('../src/server/operator-financial-routes').financialHandlers>)=>runtime.financial!(...args)}));
vi.mock('../src/server/source-workflow',async original=>({...await original<typeof import('../src/server/source-workflow')>(),sourceWorkflowHandlers:(...args:Parameters<typeof import('../src/server/source-workflow').sourceWorkflowHandlers>)=>runtime.source!(...args)}));
vi.mock('../src/server/operator-obligation-routes',async original=>({...await original<typeof import('../src/server/operator-obligation-routes')>(),obligationReaders:{list:(r:Request)=>runtime.readers!.list(r),detail:(r:Request,id:string)=>runtime.readers!.detail(r,id)}}));
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();cleanupSyntheticFinancialFixture();});
it('public catalog and detail routes retain V4 parents and independently admitted children',async()=>{
 const parent=sourceHarness(),child=controlledHarness();
 const saved=await(await parent.handler('save',parent.request({expected_revision:0,fields:invoice,reason:'Synthetic catalog entry'}))).json();
 runtime.readers=createObligationReaders(async()=>child.auth,async()=>child.load(loadFinancialSourceAdmission(),async()=>{}),()=>parent.source,loadFinancialSourceAdmission,parent.handler);
 const catalog=await listGET(new Request('https://synthetic.invalid/api/obligations'));
 expect(catalog.status).toBe(200);const data=await catalog.json();
 expect(data.obligations.map((r:{obligation_id:string})=>r.obligation_id)).toEqual(expect.arrayContaining([saved.obligation.obligation_id,child.source.source.obligation_id]));
 expect(data.allowed_actions).toContain('CREATE_SOURCE');
 for(const id of [saved.obligation.obligation_id,child.source.source.obligation_id])expect((await detailGET(new Request('https://synthetic.invalid/api/obligations/'+id),{params:Promise.resolve({id})})).status).toBe(200);
});
function panelFixture(){
 let pending:((r:Response)=>void)|undefined;
 const body={record:{source_evidence:[]},allowed_actions:['PREPARE_SUCCESSOR'],aggregate:{aggregate_version:4},execution:{idempotency_key:'SYNTHETIC-ORIGINAL-KEY'}};
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='POST')return new Promise<Response>(resolve=>{pending=resolve;});
  return Response.json(String(url)==='/api/obligations'?{allowed_actions:[]}:{...body});
 });vi.stubGlobal('fetch',fetcher);
 return {fetcher,finish:()=>pending?.(Response.json({committed:true}))};
}
it('after reload, existing-payment successor has a usable rationale input without manual-review capability',async()=>{
 const h=panelFixture();const mounted=render(<SourceWorkflowPanel selectedId="SYNTHETIC-CHILD" csrfToken="SYNTHETIC-CSRF" onChanged={()=>{}}/>);
 await screen.findByText('Recovery rationale');mounted.unmount();render(<SourceWorkflowPanel selectedId="SYNTHETIC-CHILD" csrfToken="SYNTHETIC-CSRF" onChanged={()=>{}}/>);
 const reason=await screen.findByLabelText('Recovery rationale');fireEvent.change(reason,{target:{value:'Authoritative synthetic no-dispatch receipt reviewed'}});
 const button=screen.getByText('Prepare evidence-supported successor') as HTMLButtonElement;expect(button.disabled).toBe(false);fireEvent.click(button);
 await waitFor(()=>expect(h.fetcher.mock.calls.some(([,init])=>init?.method==='POST'&&JSON.parse(String(init.body)).reason==='Authoritative synthetic no-dispatch receipt reviewed')).toBe(true));
 await act(async()=>h.finish());
});
it('selection change releases the old command busy state and ignores its late acknowledgement',async()=>{
 const h=panelFixture(),changed=vi.fn();const mounted=render(<SourceWorkflowPanel selectedId="SYNTHETIC-FIRST" csrfToken="SYNTHETIC-CSRF" onChanged={changed}/>);
 fireEvent.change(await screen.findByLabelText('Recovery rationale'),{target:{value:'Synthetic reason'}});fireEvent.click(screen.getByText('Prepare evidence-supported successor'));
 mounted.rerender(<SourceWorkflowPanel selectedId="SYNTHETIC-SECOND" csrfToken="SYNTHETIC-CSRF" onChanged={changed}/>);
 fireEvent.change(await screen.findByLabelText('Recovery rationale'),{target:{value:'Second synthetic reason'}});
 await waitFor(()=>expect((screen.getByText('Prepare evidence-supported successor') as HTMLButtonElement).disabled).toBe(false));
 await act(async()=>h.finish());expect(changed).not.toHaveBeenCalled();
});
it('public PATCH lost acknowledgement survives full panel reload with the original body/key and all evidence',async()=>{
 const h=sourceHarness();runtime.source=h.handler;
 const saved=await(await sourcePOST(h.request({expected_revision:0,fields:{...invoice,evidence:[...invoice.evidence,{evidence_id:'SYNTHETIC-SECOND-EVIDENCE',content_sha256:'b'.repeat(64)}]},reason:'Synthetic multi-evidence source'}))).json(),id=saved.obligation.obligation_id;
 runtime.readers=createObligationReaders(h.guard,async()=>{throw new Error('V4 parent must use canonical source reader');},()=>h.source,()=>undefined,h.handler);
 const submissions:{body:unknown;key:string|null}[]=[];let lose=true;
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  const req=new Request('https://synthetic.invalid'+String(url),init);
  if(init?.method==='PATCH'){
   submissions.push({body:JSON.parse(String(init.body)),key:req.headers.get('Idempotency-Key')});const response=await sourcePATCH(req,{params:Promise.resolve({id})});if(lose){lose=false;throw new Error('Synthetic acknowledgement lost after durable commit');}return response;
  }
  return String(url)==='/api/obligations'?listGET(req):detailGET(req,{params:Promise.resolve({id})});
 }));
 const mount=()=>render(<SourceWorkflowPanel selectedId={id} csrfToken="SYNTHETIC-CSRF" onChanged={()=>{}}/>);
 const first=mount();fireEvent.click(await screen.findByText('Edit payable / Save correction'));
 fireEvent.change(screen.getByLabelText('Exact amount'),{target:{value:'2.00'}});fireEvent.change(screen.getByLabelText('Correction or entry reason'),{target:{value:'Correct synthetic amount only'}});fireEvent.click(screen.getByText('Save correction'));
 await screen.findByText(/Acknowledgement unavailable/);expect(h.snapshot().source_revisions).toHaveLength(2);expect(h.snapshot().source_revisions?.[1].fields.evidence).toHaveLength(2);
 const review=await h.handler('review',h.request({expected_version:2,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Committed corrected source reviewed in another current read',evidence_ids:['SYNTHETIC-EVIDENCE','SYNTHETIC-SECOND-EVIDENCE'],finding_dispositions:[]}),id);expect(review.status).toBe(201);const reviewHash=(await review.json()).review_decision_hash;
 first.unmount();mount();fireEvent.click(await screen.findByText('Edit payable / Save correction'));fireEvent.click(screen.getByText('Save correction'));
 await screen.findByText('Command recorded. Refreshing committed status.');expect(submissions).toHaveLength(2);expect(submissions[1]).toEqual(submissions[0]);expect(h.snapshot().source_revisions).toHaveLength(2);expect(h.snapshot().authority.review_decisions?.at(-1)?.hash).toBe(reviewHash);
});
it('the existing command-center stage and primary navigation recognize HUMAN review without inventing AI advice',async()=>{
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic full command-center source'}))).json(),id=saved.obligation.obligation_id;
 const review=await h.handler('review',h.request({expected_version:1,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Current synthetic source reviewed without AI',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]}),id);expect(review.status).toBe(201);
 runtime.readers=createObligationReaders(h.guard,async()=>{throw new Error('Unexpected controlled state');},()=>h.source,()=>undefined,h.handler);
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{expect(init?.method??'GET').toBe('GET');const req=new Request('https://synthetic.invalid'+String(url),init);return String(url)==='/api/obligations'?listGET(req):detailGET(req,{params:Promise.resolve({id})});});vi.stubGlobal('fetch',fetcher);
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);const row=await waitFor(()=>{const r=document.querySelector<HTMLButtonElement>(`button[data-obligation-id="${id}"]`);expect(r).toBeTruthy();return r!;});fireEvent.click(row);
 const catalog=await(await listGET(new Request('https://synthetic.invalid'))).json();expect(catalog.assessed_count).toBe(0);expect(catalog.obligations[0].assessed).toBe(false);
 await screen.findAllByText('Human review recorded');expect(screen.queryByRole('heading',{name:/^Assessment required$/})).toBeNull();expect(screen.getByLabelText('Current assessment outcome').textContent).toContain('Human review');expect(screen.getAllByRole('button',{name:'Review human decision'}).length).toBeGreaterThan(0);expect(h.snapshot().authority.assessments).toEqual([]);expect(h.snapshot().execution_ledger).toEqual([]);
});
it('manual-only approved intent reaches the existing Payment UI and actual execute route with one transfer and posting',async()=>{
 vi.stubEnv('NVIDIA_API_KEY',undefined);vi.stubGlobal('crypto',webcrypto);
 const h=controlledHarness();h.snapshot().authority.aggregates.push({...structuredClone(h.snapshot().authority.aggregates[0]),obligation_id:'SYNTHETIC-UNRELATED-UNASSESSED'});
 const prepared=await preparedHumanApproval(h),id=prepared.id;runtime.financial=h.handler;
 runtime.readers=createObligationReaders(async()=>h.auth,async()=>h.load(loadFinancialSourceAdmission(),async()=>{}),()=>[],loadFinancialSourceAdmission);
 const projected=await(await runtime.readers.detail(new Request('https://synthetic.invalid'),id)).json();expect(projected.selected_financial_scope.status).toBe('PASS');expect(projected.execution_gate,JSON.stringify({gate:projected.execution_gate,authority:projected.truth?.tameion_control_truth?.execution_release_authority,bindings:projected.payment_release_approval})).toBe('PORTAL_APPROVED_EXACT_PACKET');
 let forbidden=0;const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(!String(url).startsWith('/api/')){forbidden++;throw new Error('Synthetic UI application network fenced');}
  const req=new Request('https://synthetic.invalid'+String(url),init);
  if(init?.method==='POST'){expect(req.headers.get('X-Tameion-CSRF')).toBe('SYNTHETIC-CSRF');expect(String(url)).toBe(`/api/obligations/${id}/execute`);return executePOST(req,{params:Promise.resolve({id})});}
  return String(url)==='/api/obligations'?listGET(req):detailGET(req,{params:Promise.resolve({id})});
 });vi.stubGlobal('fetch',fetcher);render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);
 const row=await waitFor(()=>{const r=document.querySelector<HTMLButtonElement>(`button[data-obligation-id="${id}"]`);expect(r).toBeTruthy();return r!;});fireEvent.click(row);
 const currentStage=await screen.findAllByRole('button',{name:'View current stage · Assurance'});fireEvent.click(currentStage[0]);
 const continueButtons=await screen.findAllByRole('button',{name:'Continue to Payment'});fireEvent.click(continueButtons[0]);
 const confirmations=await screen.findAllByRole('checkbox',{name:/^I have reviewed the exact testnet amount, recipient and estimated fees/});fireEvent.click(confirmations[0]);
 const pay=await screen.findByRole('button',{name:'Pay testnet USDC'});await waitFor(()=>expect((pay as HTMLButtonElement).disabled).toBe(false));fireEvent.click(pay);
 await waitFor(()=>expect(h.client.createTransaction).toHaveBeenCalledOnce());await waitFor(()=>expect(h.snapshot().authority.settlement_postings).toHaveLength(1));
 expect(h.snapshot().authority.assessments).toEqual([]);expect(forbidden).toBe(0);expect(fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});
it('adds and removes evidence only through explicit edits while retaining source/authority history',async()=>{
 const h=sourceHarness();runtime.source=h.handler;const saved=await(await sourcePOST(h.request({expected_revision:0,fields:invoice,reason:'Synthetic evidence management'}))).json(),id=saved.obligation.obligation_id;
 runtime.readers=createObligationReaders(h.guard,async()=>{throw new Error('Unexpected financial state');},()=>h.source,()=>undefined,h.handler);
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{const req=new Request('https://synthetic.invalid'+String(url),init);if(init?.method==='PATCH')return sourcePATCH(req,{params:Promise.resolve({id})});return String(url)==='/api/obligations'?listGET(req):detailGET(req,{params:Promise.resolve({id})});}));
 render(<SourceWorkflowPanel selectedId={id} csrfToken="SYNTHETIC-CSRF" onChanged={()=>{}}/>);fireEvent.click(await screen.findByText('Edit payable / Save correction'));fireEvent.click(screen.getByText('Add evidence reference'));
 fireEvent.change(screen.getByLabelText('Evidence reference 2'),{target:{value:'SYNTHETIC-EXPLICIT-ADDITION'}});fireEvent.change(screen.getByLabelText('Evidence SHA256 2'),{target:{value:'b'.repeat(64)}});fireEvent.change(screen.getByLabelText('Correction or entry reason'),{target:{value:'Explicitly add second evidence reference'}});fireEvent.click(screen.getByText('Save correction'));
 await waitFor(()=>expect(h.snapshot().source_revisions).toHaveLength(2));await screen.findByText(/Revision 2 ·/);expect(h.snapshot().source_revisions![1].fields.evidence).toHaveLength(2);expect(h.snapshot().authority.aggregates[0].evidence_hashes).toEqual(['a'.repeat(64),'b'.repeat(64)]);
 fireEvent.click(screen.getByText('Edit payable / Save correction'));fireEvent.click(screen.getByText('Remove evidence reference 2'));fireEvent.change(screen.getByLabelText('Correction or entry reason'),{target:{value:'Explicitly remove superseded evidence reference'}});fireEvent.click(screen.getByText('Save correction'));
 await waitFor(()=>expect(h.snapshot().source_revisions).toHaveLength(3));expect(h.snapshot().source_revisions![1].fields.evidence).toHaveLength(2);expect(h.snapshot().source_revisions![2].fields.evidence).toHaveLength(1);expect(h.snapshot().authority.aggregates[0].evidence_hashes).toEqual(['a'.repeat(64)]);
});


it.each([false,true])('C1 retains exact pending review through full reload (commit before lost ack: %s)',async(commit)=>{
 const h=sourceHarness();runtime.source=h.handler;
 const saved=await(await sourcePOST(h.request({expected_revision:0,fields:invoice,reason:'C1 source'}))).json(),id=saved.obligation.obligation_id;
 runtime.readers=createObligationReaders(h.guard,async()=>{throw new Error('Financial path fenced');},()=>h.source,()=>undefined,h.handler);
 const submissions:{body:string;key:string|null}[]=[];let lose=true;
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  expect(String(url).startsWith('/api/')).toBe(true);const req=new Request('https://synthetic.invalid'+String(url),init);
  if(init?.method==='POST'){
   expect(String(url)).toBe(`/api/obligations/${id}/review`);submissions.push({body:String(init.body),key:req.headers.get('Idempotency-Key')});
   if(lose){lose=false;if(commit)expect((await reviewPOST(req,{params:Promise.resolve({id})})).status).toBe(201);throw new Error('Synthetic lost acknowledgement');}
   return reviewPOST(req,{params:Promise.resolve({id})});
  }
  return String(url)==='/api/obligations'?listGET(req):detailGET(req,{params:Promise.resolve({id})});
 }));
 const mount=()=>render(<SourceWorkflowPanel selectedId={id} csrfToken="SYNTHETIC-C1-SESSION" onChanged={()=>{}}/>);
 const first=mount();fireEvent.change(await screen.findByLabelText('Review rationale'),{target:{value:'C1 original manual facts reviewed'}});fireEvent.change(screen.getByLabelText('Review mode'),{target:{value:'AI_EXCEPTION_REVIEW'}});fireEvent.click(screen.getByText('Request correction'));
 await screen.findByText(/Acknowledgement unavailable/);first.unmount();mount();
 expect((await screen.findByLabelText('Review rationale') as HTMLTextAreaElement).value).toBe('C1 original manual facts reviewed');expect((screen.getByLabelText('Review mode') as HTMLSelectElement).value).toBe('AI_EXCEPTION_REVIEW');
 fireEvent.click(screen.getByText('Request correction'));await screen.findByText(/Command recorded|Original review receipt recovered/);
 expect(submissions).toHaveLength(2);expect(submissions[1]).toEqual(submissions[0]);expect(h.snapshot().authority.review_decisions).toHaveLength(1);
});

it('C1 recovers a committed ACCEPT receipt with explicit historical status when new-review capability disappeared',async()=>{
 const h=sourceHarness();runtime.source=h.handler;const made=await(await sourcePOST(h.request({expected_revision:0,fields:invoice,reason:'C1 accepted source'}))).json(),id=made.obligation.obligation_id;
 runtime.readers=createObligationReaders(h.guard,async()=>{throw new Error('Financial path fenced');},()=>h.source,()=>undefined,h.handler);
 let lose=true;const sent:{body:string;key:string|null}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  expect(String(url).startsWith('/api/')).toBe(true);const req=new Request('https://synthetic.invalid'+String(url),init);
  if(init?.method==='POST'){expect(String(url)).toBe(`/api/obligations/${id}/review`);sent.push({body:String(init.body),key:req.headers.get('Idempotency-Key')});const r=await reviewPOST(req,{params:Promise.resolve({id})});if(lose){lose=false;throw new Error('C1 commit then lost ack');}return r;}
  return String(url)==='/api/obligations'?listGET(req):detailGET(req,{params:Promise.resolve({id})});
 }));
 const mount=()=>render(<SourceWorkflowPanel selectedId={id} csrfToken="SYNTHETIC-C1-ACCEPT" onChanged={()=>{}}/>),first=mount();
 fireEvent.change(await screen.findByLabelText('Review rationale'),{target:{value:'C1 exact accepted facts'}});fireEvent.click(screen.getByText('Continue with manual review'));await screen.findByText(/Acknowledgement unavailable/);
 const before=structuredClone(h.snapshot()),writes=h.repository.compareAndSet.mock.calls.length;first.unmount();mount();
 expect(screen.queryByText('Continue with manual review')).toBeNull();fireEvent.click(await screen.findByText('Recover original pending command'));
 await screen.findByText('Original review receipt recovered (historical only; no current authorization restored).');expect(sent[1]).toEqual(sent[0]);expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(h.snapshot()).toEqual(before);
});
function c1View(id='SYNTHETIC-C1-REVIEW'){
 return {record:{obligation_id:id,source_evidence:[{evidence_id:'SYNTHETIC-EVIDENCE'}]},aggregate:{aggregate_version:1},allowed_actions:['MANUAL_REVIEW']};
}
it('C1 restores escalation, mode and advisory dispositions; changed input receives a different key',async()=>{
 const detail={...c1View(),review_findings:[{code:'OTHER_REQUIRES_HUMAN_REVIEW',reason:'Synthetic advisory',advisory:true}]},sent:{body:string;key:string|null}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{expect(String(url)).toBe('/api/obligations/SYNTHETIC-C1-REVIEW/review');sent.push({body:String(init?.body),key:new Headers(init?.headers).get('Idempotency-Key')});throw new Error('C1 pre-commit uncertainty');}));
 const mount=()=>render(<SourceWorkflowPanel selectedId={detail.record.obligation_id} csrfToken="SYNTHETIC-C1-INPUTS" onChanged={()=>{}} readModel={{detail,createAllowed:false}}/>),first=mount();
 fireEvent.change(await screen.findByLabelText('Review rationale'),{target:{value:'C1 retained review rationale'}});fireEvent.change(screen.getByLabelText('Review mode'),{target:{value:'AI_EXCEPTION_REVIEW'}});fireEvent.change(screen.getByLabelText(/Escalation owner/),{target:{value:'SYNTHETIC-C1-ASSIGNEE'}});fireEvent.click(screen.getByLabelText(/Accept this advisory/));fireEvent.click(screen.getByText('Assign escalation'));await screen.findByText(/Acknowledgement unavailable/);first.unmount();mount();
 expect((await screen.findByLabelText(/Escalation owner/) as HTMLInputElement).value).toBe('SYNTHETIC-C1-ASSIGNEE');expect((screen.getByLabelText(/Accept this advisory/) as HTMLInputElement).checked).toBe(true);
 fireEvent.click(screen.getByText('Assign escalation'));await screen.findByText(/Acknowledgement unavailable/);expect(sent[1]).toEqual(sent[0]);
 fireEvent.change(screen.getByLabelText('Review rationale'),{target:{value:'C1 deliberately changed rationale'}});fireEvent.click(screen.getByText('Assign escalation'));await screen.findByText(/Acknowledgement unavailable/);
 expect(sent).toHaveLength(3);expect(sent[2].key).not.toBe(sent[0].key);expect(JSON.parse(sent[2].body).rationale).toBe('C1 deliberately changed rationale');
});
it.each(['successor','reconcile'] as const)('C1 restores original %s transport outside edit mode after version advances',async(action)=>{
 const detail={...c1View('SYNTHETIC-C1-CHILD'),allowed_actions:[action==='successor'?'PREPARE_SUCCESSOR':'RECOVER_EXISTING_PAYMENT'],execution:{idempotency_key:'SYNTHETIC-C1-ORIGINAL'},sealed_pae_instruction_hash:'a'.repeat(64)};
 const sent:{body:string;key:string|null}[]=[];vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{expect(String(url)).toBe(`/api/obligations/${detail.record.obligation_id}/${action}`);sent.push({body:String(init?.body),key:new Headers(init?.headers).get('Idempotency-Key')});throw new Error('C1 pre-commit uncertainty');}));
 const mount=()=>render(<SourceWorkflowPanel selectedId={detail.record.obligation_id} csrfToken="SYNTHETIC-C1-RECOVERY" onChanged={()=>{}} readModel={{detail,createAllowed:false}}/>),first=mount();
 if(action==='successor')fireEvent.change(await screen.findByLabelText('Recovery rationale'),{target:{value:'C1 exact no-dispatch evidence'}});
 fireEvent.click(await screen.findByText(action==='successor'?'Prepare evidence-supported successor':'Recover existing payment'));await screen.findByText(/Acknowledgement unavailable/);first.unmount();detail.aggregate.aggregate_version=2;mount();
 if(action==='successor')expect((await screen.findByLabelText('Recovery rationale') as HTMLTextAreaElement).value).toBe('C1 exact no-dispatch evidence');
 fireEvent.click(await screen.findByText('Recover original pending command'));await screen.findByText(/Acknowledgement unavailable/);expect(sent[1]).toEqual(sent[0]);
});
it.each(['selection','session'] as const)('C1 %s boundary clears input, refuses old identity and ignores late ACK',async(boundary)=>{
 const changed=vi.fn();let finish!:(r:Response)=>void;const sent:{key:string|null;body:string}[]=[];
 vi.stubGlobal('fetch',vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{sent.push({key:new Headers(init?.headers).get('Idempotency-Key'),body:String(init?.body)});return new Promise<Response>(r=>finish=r);}));
 const props={selectedId:'SYNTHETIC-C1-FIRST',csrfToken:'SYNTHETIC-SAME-PREFIX-SESSION-A',onChanged:changed,readModel:{detail:c1View('SYNTHETIC-C1-FIRST'),createAllowed:false}},mounted=render(<SourceWorkflowPanel {...props}/>);
 fireEvent.change(await screen.findByLabelText('Review rationale'),{target:{value:'C1 first session draft'}});fireEvent.click(screen.getByText('Request correction'));
 const next={...props,...(boundary==='session'?{csrfToken:'SYNTHETIC-SAME-PREFIX-SESSION-B'}:{selectedId:'SYNTHETIC-C1-SECOND',readModel:{detail:c1View('SYNTHETIC-C1-SECOND'),createAllowed:false}})};mounted.rerender(<SourceWorkflowPanel {...next}/>);
 expect((await screen.findByLabelText('Review rationale') as HTMLTextAreaElement).value).toBe('');expect(screen.queryByText('Recover original pending command')).toBeNull();
 await act(async()=>finish(Response.json({committed:true})));expect(changed).not.toHaveBeenCalled();expect(screen.queryByText(/Command recorded/)).toBeNull();
 fireEvent.change(screen.getByLabelText('Review rationale'),{target:{value:'C1 second session draft'}});fireEvent.click(screen.getByText('Request correction'));expect(sent[1].key).not.toBe(sent[0].key);await act(async()=>finish(Response.json({committed:true})));expect(changed).toHaveBeenCalledOnce();
});
it.each(['invalid_json','wrong_scope','wrong_path','invalid_key','oversize','missing_input'] as const)('C1 rejects malformed retained storage: %s',async(fault)=>{
 const detail=c1View();vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('C1 network fenced');}));
 const mount=()=>render(<SourceWorkflowPanel selectedId={detail.record.obligation_id} csrfToken="SYNTHETIC-C1-STORAGE" onChanged={()=>{}} readModel={{detail,createAllowed:false}}/>),first=mount();
 fireEvent.change(await screen.findByLabelText('Review rationale'),{target:{value:'C1 storage origin'}});fireEvent.click(screen.getByText('Request correction'));await screen.findByText(/Acknowledgement unavailable/);first.unmount();
 const key=sessionStorage.key(0)!,saved=JSON.parse(sessionStorage.getItem(key)!);
 if(fault==='wrong_scope')saved.scope='OTHER';if(fault==='wrong_path'){const t=JSON.parse(saved.request.signature);t.path='https://forbidden.invalid/payment';saved.request.signature=JSON.stringify(t);}if(fault==='invalid_key')saved.request.key='not-a-request-id';if(fault==='missing_input')delete saved.rationale;
 sessionStorage.setItem(key,fault==='invalid_json'?'{':fault==='oversize'?'x'.repeat(100001):JSON.stringify(saved));mount();
 expect((await screen.findByLabelText('Review rationale') as HTMLTextAreaElement).value).toBe('');expect(screen.queryByText('Recover original pending command')).toBeNull();expect(fetch).toHaveBeenCalledOnce();
});
it('C1 retained state cannot enable a command after server capabilities are withdrawn',async()=>{
 const detail=c1View();vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('C1 network fenced');}));const mount=()=>render(<SourceWorkflowPanel selectedId={detail.record.obligation_id} csrfToken="SYNTHETIC-C1-CAP" onChanged={()=>{}} readModel={{detail,createAllowed:false}}/>),first=mount();
 fireEvent.change(await screen.findByLabelText('Review rationale'),{target:{value:'C1 pending review'}});fireEvent.click(screen.getByText('Request correction'));await screen.findByText(/Acknowledgement unavailable/);first.unmount();detail.allowed_actions=[];mount();expect(screen.queryByText('Recover original pending command')).toBeNull();expect(screen.queryByText('Request correction')).toBeNull();expect(fetch).toHaveBeenCalledOnce();
});
it('C1 storage failure blocks dispatch rather than claiming reload continuity',async()=>{
 const detail=c1View();vi.stubGlobal('fetch',vi.fn(async()=>{throw new Error('C1 network fenced');}));vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Synthetic unavailable tab storage');});
 render(<SourceWorkflowPanel selectedId={detail.record.obligation_id} csrfToken="SYNTHETIC-C1-NOSTORAGE" onChanged={()=>{}} readModel={{detail,createAllowed:false}}/>);
 fireEvent.change(await screen.findByLabelText('Review rationale'),{target:{value:'C1 unsaved review'}});fireEvent.click(screen.getByText('Request correction'));await screen.findByText('Pending command could not be retained. Enable tab storage before submitting.');expect(fetch).not.toHaveBeenCalled();
});
it('C1 a retained review draft cannot replace the current source edit fields',async()=>{
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'C1 source edit boundary'}))).json(),id=saved.obligation.obligation_id;
 const detail=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('C1 network fenced');}));
 render(<SourceWorkflowPanel selectedId={id} csrfToken="SYNTHETIC-C1-SOURCE-DRAFT" onChanged={()=>{}} readModel={{detail,createAllowed:false}}/>);
 fireEvent.change(await screen.findByLabelText('Review rationale'),{target:{value:'C1 unsent manual input'}});fireEvent.click(screen.getByText('Edit payable / Save correction'));
 expect((screen.getByLabelText('Supplier name') as HTMLInputElement).value).toBe(invoice.supplier_name);expect((screen.getByLabelText('Exact amount') as HTMLInputElement).value).toBe(invoice.amount);expect(fetch).not.toHaveBeenCalled();
});

const s06PreflightPath='/api/internal/demo/real-testnet-payment/preflight';
const s06FundsReason='The current balance does not cover the approved payment total and network fee.';
const s06FeeReason='The current network fee quote exceeds the approved fee cap.';
function s06View(id='SYNTHETIC-S06-CHILD'){return {...c1View(id),allowed_actions:['REFRESH_READINESS']};}
it.each([['INSUFFICIENT_BALANCE','initial'],['INSUFFICIENT_BALANCE','repeated'],['FEE_CAP_EXCEEDED','initial'],['FEE_CAP_EXCEEDED','repeated']] as const)('S06-F01 shows canonical %s cause and safe remedy for %s check',async(blocker,shape)=>{
 const h=controlledHarness(),id=h.source.source.obligation_id;
 const review=await h.handler('review',manualRequest(h,{expected_version:1,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Synthetic S06 source reviewed',evidence_ids:h.source.source.source_evidence.map(e=>e.evidence_id),finding_dispositions:[]}),id);expect(review.status).toBe(201);
 const balance=vi.mocked(h.client.getWalletTokenBalance),fee=vi.mocked(h.client.estimateTransferFee);
 const originalBalance=balance.getMockImplementation()!;
 if(blocker==='INSUFFICIENT_BALANCE')balance.mockResolvedValue({data:{tokenBalances:[{amount:'1.001999',token:{id:'TEST-NATIVE-USDC',symbol:'USDC',blockchain:'ARC-TESTNET',decimals:6,isNative:true}}],pagination:{nextPageAfter:null}}});
 else fee.mockResolvedValue({data:{medium:{networkFee:'0.002001'}}});
 const first=await h.handler('preflight',h.request({obligation_id:id,expected_version:1}));expect(first.status).toBe(409);const initial=await first.json();expect(initial).toMatchObject({readiness:'BLOCKED',blocker});expect(initial.code).toBeUndefined();
 balance.mockImplementation(originalBalance);fee.mockResolvedValue({data:{medium:{networkFee:h.source.estimated_fee_ceiling}}});
 expect((await h.handler('preflight',h.request({obligation_id:id,expected_version:1}))).status).toBe(200);
 if(blocker==='INSUFFICIENT_BALANCE')balance.mockResolvedValue({data:{tokenBalances:[{amount:'1.001999',token:{id:'TEST-NATIVE-USDC',symbol:'USDC',blockchain:'ARC-TESTNET',decimals:6,isNative:true}}],pagination:{nextPageAfter:null}}});
 else fee.mockResolvedValue({data:{medium:{networkFee:'0.002001'}}});
 const repeatedResponse=await h.handler('preflight',h.request({obligation_id:id,expected_version:2}));expect(repeatedResponse.status).toBe(409);const repeated=await repeatedResponse.json();expect(repeated).toMatchObject({readiness:'BLOCKED',blocker,code:'READINESS_REFRESHED',authority_preserved:true});
 const changed=vi.fn(),sent:{key:string|null;body:string}[]=[];let responseBody=shape==='initial'?initial:repeated;
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{expect(String(url)).toBe(s06PreflightPath);sent.push({key:new Headers(init?.headers).get('Idempotency-Key'),body:String(init?.body)});return Response.json(responseBody,{status:409});});vi.stubGlobal('fetch',fetcher);
 const detail={...s06View(id),aggregate:{aggregate_version:2}},mount=()=>render(<SourceWorkflowPanel selectedId={id} csrfToken="SYNTHETIC-S06-SESSION" onChanged={changed} readModel={{detail,createAllowed:false}}/>),mounted=mount();
 const reason=blocker==='INSUFFICIENT_BALANCE'?s06FundsReason:s06FeeReason;
 fireEvent.click(await screen.findByText('Refresh payment readiness'));await screen.findByText(new RegExp(reason.replace('.','\\.')));
 const message=screen.getByText(new RegExp(reason.replace('.','\\.'))).textContent!;expect(message).toContain(blocker);expect(message).toContain(blocker==='INSUFFICIENT_BALANCE'?'Use the approved funding process':'Obtain a compliant current quote or renewed approved terms');expect(message).toContain('refresh current payment readiness');
 expect(message).not.toContain('COMMAND_UNVERIFIED');expect(changed).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce();
 const retained=sessionStorage.getItem(sessionStorage.key(0)!)!;responseBody=repeated;
 fireEvent.click(screen.getByText('Recover original pending command'));await waitFor(()=>expect(sent).toHaveLength(2));await screen.findByText(new RegExp(reason.replace('.','\\.')));expect(sent[1]).toEqual(sent[0]);expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(retained);
 mounted.unmount();mount();expect(fetcher).toHaveBeenCalledTimes(2);fireEvent.click(await screen.findByText('Recover original pending command'));await waitFor(()=>expect(sent).toHaveLength(3));await screen.findByText(new RegExp(reason.replace('.','\\.')));expect(sent[2]).toEqual(sent[0]);expect(changed).not.toHaveBeenCalled();expect(h.client.createTransaction).not.toHaveBeenCalled();expect(h.snapshot().execution_ledger).toEqual([]);expect(h.snapshot().authority.settlement_postings??[]).toEqual([]);
});
const s06Blocked={readiness:'BLOCKED',blocker:'INSUFFICIENT_BALANCE',captured_at:'2026-10-20T12:00:00.000Z'};
it.each([
 ['explicit outcome',409,{...s06Blocked,code:'OUTCOME_UNVERIFIED'}],['other code',409,{...s06Blocked,code:'SESSION_REQUIRED'}],['null code',409,{...s06Blocked,code:null}],
 ['retry forbidden',409,{...s06Blocked,retry_submission:false}],['retry hint',409,{...s06Blocked,retry_submission:true}],['execution gate',409,{...s06Blocked,execution_gate:'RECONCILE_ORIGINAL_INTENT'}],['null execution gate',409,{...s06Blocked,execution_gate:null}],
 ['execution',409,{...s06Blocked,execution:{status:'UNKNOWN'}}],['null execution',409,{...s06Blocked,execution:null}],['outcome',409,{...s06Blocked,outcome:'UNKNOWN'}],['status field',409,{...s06Blocked,status:'SUBMITTING'}],['extra field',409,{...s06Blocked,unknown:true}],
 ['wrong readiness',409,{...s06Blocked,readiness:'READY'}],['unknown blocker',409,{...s06Blocked,blocker:'PROVIDER_QUERY_FAILED'}],['missing blocker',409,{readiness:'BLOCKED'}],['wrong blocker type',409,{...s06Blocked,blocker:['INSUFFICIENT_BALANCE']}],
 ['wrong status',503,s06Blocked],['wrong success status',200,s06Blocked],['array',409,[s06Blocked]],['null',409,null],['primitive',409,'INSUFFICIENT_BALANCE'],
 ['bad timestamp',409,{...s06Blocked,captured_at:false}],['bad version',409,{...s06Blocked,aggregate_version:'2'}],['contradictory preservation',409,{...s06Blocked,code:'READINESS_REFRESHED',authority_preserved:false}],
 ['arbitrary backend remedy',409,{...s06Blocked,remedy:'SYNTHETIC untrusted automatic send instruction'}],['transport',0,s06Blocked],
] as const)('S06-F01 remains conservative for %s',async(_name,status,payload)=>{
 const fetcher=vi.fn(async()=>{if(status===0)throw Error('Synthetic lost response');return Response.json(payload,{status});});vi.stubGlobal('fetch',fetcher);const changed=vi.fn(),detail=s06View();
 render(<SourceWorkflowPanel selectedId={detail.record.obligation_id} csrfToken="SYNTHETIC-S06-NEGATIVE" onChanged={changed} readModel={{detail,createAllowed:false}}/>);fireEvent.click(await screen.findByText('Refresh payment readiness'));
 await waitFor(()=>expect((screen.getByText('Refresh payment readiness') as HTMLButtonElement).disabled).toBe(false));expect(screen.queryByText(new RegExp(s06FundsReason))).toBeNull();expect(screen.queryByText(new RegExp(s06FeeReason))).toBeNull();expect(fetcher).toHaveBeenCalledOnce();
 if(status!==200){expect(changed).not.toHaveBeenCalled();expect(screen.getByText('Recover original pending command')).toBeTruthy();expect(sessionStorage.length).toBe(1);}
 if(payload&&typeof payload==='object'&&!Array.isArray(payload)&&'code' in payload&&typeof payload.code==='string')expect(screen.getByText(new RegExp(payload.code))).toBeTruthy();
});
it('S06-F01 known funding-shaped data on another command path never receives readiness guidance',async()=>{
 const detail={...c1View(),allowed_actions:['PREPARE_SUCCESSOR'],execution:{idempotency_key:'SYNTHETIC-ORIGINAL'}},fetcher=vi.fn(async()=>Response.json(s06Blocked,{status:409}));vi.stubGlobal('fetch',fetcher);
 render(<SourceWorkflowPanel selectedId={detail.record.obligation_id} csrfToken="SYNTHETIC-S06-PATH" onChanged={()=>{}} readModel={{detail,createAllowed:false}}/>);fireEvent.change(await screen.findByLabelText('Recovery rationale'),{target:{value:'Explicit evidence only'}});fireEvent.click(screen.getByText('Prepare evidence-supported successor'));await screen.findByText(/COMMAND_UNVERIFIED/);expect(screen.queryByText(new RegExp(s06FundsReason))).toBeNull();expect(fetcher).toHaveBeenCalledOnce();
});
it.each(['selection','session'] as const)('S06-F01 late preflight refusal cannot mutate a new %s context',async(boundary)=>{
 let finish!:(r:Response)=>void;const fetcher=vi.fn(async()=>new Promise<Response>(resolve=>finish=resolve));vi.stubGlobal('fetch',fetcher);const changed=vi.fn(),detail=s06View();
 const props={selectedId:detail.record.obligation_id,csrfToken:'SYNTHETIC-S06-A',onChanged:changed,readModel:{detail,createAllowed:false}},mounted=render(<SourceWorkflowPanel {...props}/>);fireEvent.click(await screen.findByText('Refresh payment readiness'));
 const next=boundary==='session'?{...props,csrfToken:'SYNTHETIC-S06-B'}:{...props,selectedId:'SYNTHETIC-S06-OTHER',readModel:{detail:s06View('SYNTHETIC-S06-OTHER'),createAllowed:false}};mounted.rerender(<SourceWorkflowPanel {...next}/>);await act(async()=>finish(Response.json(s06Blocked,{status:409})));
 expect(screen.queryByText(new RegExp(s06FundsReason))).toBeNull();expect(screen.queryByText('Recover original pending command')).toBeNull();expect((screen.getByText('Refresh payment readiness') as HTMLButtonElement).disabled).toBe(false);expect(changed).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledOnce();
});
