/** @vitest-environment jsdom */
import {webcrypto} from 'node:crypto';
import {preparedHumanApproval} from './test-support/manual-payment-fixture';
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
