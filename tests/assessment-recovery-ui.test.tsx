/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {CommandCenter} from '../app/command-center';
import {harness,hash,OTHER} from './test-support/disposition-fixture';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
import {POST as advisoryPOST} from '../app/api/obligations/[id]/advisory/route';
const runtime=vi.hoisted(()=>({handler:null as any}));
vi.mock('../src/server/genuine-workflow',async original=>({...await original<typeof import('../src/server/genuine-workflow')>(),genuineWorkflowHandlers:(...args:any[])=>runtime.handler(...args)}));
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
function setup(){
 const h=harness();runtime.handler=h.handler;
 const readers=createObligationReaders(h.guard,async(records,binding,_namespace,admission)=>loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:structuredClone(h.snapshot())})},h.state_binding.namespace,records,binding,admission),h.source,()=>undefined);
 const provider=vi.fn(()=>{throw new Error('Provider must not dispatch');});
 let postResponse:(()=>Promise<Response>)|undefined;
 let onPost=()=>{},afterDetail:(body:any)=>any=body=>body,detailFault:Response|null=null;
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);if(url.startsWith('https://integrate.'))return provider();
  const request=new Request('https://fixture.invalid'+url,init);
  if(init?.method==='POST'){
   if(url.endsWith('/advisory')){if(postResponse)return postResponse();onPost();return advisoryPOST(request,{params:Promise.resolve({id:h.id})});}
   if(url.endsWith('/advisory/status'))return Response.json({status:'NOT_FOUND',obligation_id:h.id,idempotency_key:JSON.parse(String(init.body)).idempotency_key,aggregate_version:String(h.snapshot().authority.aggregates[0].aggregate_version),source_record_sha256:hash(h.records[0]),financial_action_eligible:false});
   throw new Error('Unexpected mutation');
  }
  if(url==='/api/obligations')return readers.list(request);
  if(detailFault)return detailFault.clone();
  const response=await readers.detail(request,url.split('/').at(-1)!);return Response.json(afterDetail(await response.json()),{status:response.status});
 });vi.stubGlobal('fetch',fetcher);vi.stubGlobal('crypto',webcrypto);
 const mount=()=>render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);
 const row=async(id=h.id)=>waitFor(()=>{const r=document.querySelector<HTMLButtonElement>(`button[data-obligation-id="${id}"]`);expect(r).toBeTruthy();return r!;});
 return {h,readers,provider,fetcher,mount,row,postResponse:(fn:()=>Promise<Response>)=>postResponse=fn,onPost:(fn:()=>void)=>onPost=fn,project:(fn:(body:any)=>any)=>afterDetail=fn,fault:(response:Response|null)=>detailFault=response};
}
function cap(h:ReturnType<typeof harness>,unknown=false){
 for(let n=0;n<4;n++)h.snapshot().assessment_operations.push({idempotency_key:`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`,obligation_id:h.id,aggregate_version:1,status:unknown&&n===0?'UNKNOWN':'STALE',reserved_at:1});
}

it.each([false,true])('real history-limit route rejection has zero effects and accurate UI review; separate UNKNOWN=%s',async unknown=>{
 const t=setup(),{h}=t;
 if(unknown){h.snapshot().authority.aggregates[0].aggregate_version=2;const {assessments,...base}=h.snapshot().authority;h.state_binding.workflow_base_sha256=hash(base);h.publish();}
 let before='';t.onPost(()=>{cap(h,unknown);before=JSON.stringify(h.snapshot());});
 t.mount();fireEvent.click(await t.row());fireEvent.click(await screen.findByRole('button',{name:'Run AI Assessment'}));
 await waitFor(()=>expect(t.fetcher.mock.calls.some(([,init])=>init?.method==='POST')).toBe(true));
 await waitFor(()=>expect(screen.getByRole('main').textContent).toContain('Assessment request rejected'));
 expect(h.repository.compareAndSet).not.toHaveBeenCalled();expect(t.provider).not.toHaveBeenCalled();expect(JSON.stringify(h.snapshot())).toBe(before);
 expect(h.snapshot().assessment_operations).toHaveLength(4);
 expect(localStorage.getItem(`tameion.assessment-request.${h.id}`)).toMatch(/^[a-f0-9-]{36}$/);
 expect(screen.getByRole('main').textContent).toContain('GENUINE_ASSESSMENT_HISTORY_LIMIT');
 if(unknown){expect(screen.getByRole('main').textContent).toContain('Latest assessment UNKNOWN');}
 else{
  expect(screen.getByRole('main').textContent).not.toContain('Assessment outcome unverified');
  const action=screen.getAllByRole('button',{name:'View assessment status'}).at(-1)!;fireEvent.click(action);
  expect(screen.getByRole('region',{name:'Assessment result'}).textContent).toContain('history limit');
  fireEvent.click(await t.row(h.records[1].obligation_id));await waitFor(()=>expect(t.fetcher.mock.calls.some(([url])=>String(url).endsWith(h.records[1].obligation_id))).toBe(true));fireEvent.click(await t.row());
  await waitFor(()=>expect(screen.getByRole('main').textContent).toContain('Assessment request rejected'));
 }
 expect(t.fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
 expect(screen.queryByRole('button',{name:/Run AI Assessment|Request one new assessment|Authorize payment|Pay testnet/})).toBeNull();
});

it('review-only legacy proxy/revoked record has consistent guidance and a concrete read-only action',async()=>{
 const t=setup();cap(t.h);
 t.project(d=>({...d,pae_sealed:true,aggregate:{...d.aggregate,pae_state:'REVOKED'},truth:{...d.truth,tameion_control_truth:{...d.truth.tameion_control_truth,pae_state:'REVOKED',execution_release_authority:'REVOKED'}},settlement_proxy:{source_aggregate_version:1,mapped_aggregate_version:1,preflight:{obligation_id:t.h.id}}}));
 t.mount();fireEvent.click(await t.row());await screen.findByRole('status',{name:'Review-only payable'});
 expect(screen.getByRole('main').textContent).not.toMatch(/run a fresh assessment|needs an assessment before it can proceed|Run AI Assessment from/i);
 const actions=screen.getAllByRole('button',{name:'View assessment status'});fireEvent.click(actions.at(-1)!);
 const result=await screen.findByRole('region',{name:'Assessment result'});expect(result.textContent).toContain('history limit');expect(screen.getByRole('main').textContent).toContain('Workspace owner');
 expect(screen.queryByRole('button',{name:/Run AI Assessment|Authorize payment|Pay testnet/})).toBeNull();expect(t.fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
});

it('selection preserves the exact last-checked review status and effective date without claiming fresh currentness',async()=>{
 const t=setup();cap(t.h);t.mount();const a=await t.row();
 expect(a.textContent).toContain('Due date unavailable');fireEvent.click(a);await screen.findByRole('status',{name:'Review-only payable'});
 expect(a.textContent).toContain('Assessment review required');expect(a.textContent).toContain(String(t.h.records[0].effective_due_date));
 fireEvent.click(await t.row(t.h.records[1].obligation_id));await screen.findByRole('button',{name:'Run AI Assessment'});
 expect(a.textContent).toContain('Assessment review required');expect(a.textContent).toContain(String(t.h.records[0].effective_due_date));expect(a.textContent).toContain('Last checked');
 fireEvent.click(a);await screen.findByRole('status',{name:'Review-only payable'});expect(a.textContent).not.toContain('Assessment required');
 fireEvent(window,new Event('pagehide'));fireEvent.click(await t.row(t.h.records[1].obligation_id));
 expect(a.textContent).not.toContain('Last checked');
});

it.each(['SOURCE_BINDING_CHANGED','UNRECOGNIZED_PRIVATE_DIAGNOSTIC'])('stale detail displays safe observed code %s only and remains blocked',async code=>{
 const t=setup();t.mount();fireEvent.click(await t.row());await screen.findByRole('button',{name:'Run AI Assessment'});
 t.onPost(()=>{cap(t.h);t.fault(Response.json({code,error:'PRIVATE_PROVIDER_BODY_SHOULD_NOT_RENDER'},{status:409}));});
 fireEvent.click(screen.getByRole('button',{name:'Run AI Assessment'}));
 const stale=await screen.findByText('Last-known payable details are out of date.');
 expect(stale.parentElement!.textContent).toContain('HTTP 409');if(code==='SOURCE_BINDING_CHANGED')expect(stale.parentElement!.textContent).toContain(code);else expect(screen.getByRole('main').textContent).not.toContain(code);
 expect(screen.getByRole('main').textContent).not.toContain('PRIVATE_PROVIDER_BODY_SHOULD_NOT_RENDER');expect(screen.queryByRole('button',{name:'Run AI Assessment'})).toBeNull();
 expect(screen.getByRole('button',{name:'Refresh current status'})).toBeTruthy();
});

it.each(['transport','generic409','not-found'])('uncertainty %s retains its request and never becomes a rejected-attempt retry',async fault=>{
 const t=setup();t.postResponse(()=>fault==='generic409'?Promise.resolve(Response.json({code:'ASM-001'},{status:409})):Promise.reject(new Error('Network uncertainty')));
 t.mount();fireEvent.click(await t.row());fireEvent.click(await screen.findByRole('button',{name:'Run AI Assessment'}));
 const check=await screen.findByRole('button',{name:'Check assessment request'});
 if(fault==='not-found'){fireEvent.click(check);await waitFor(()=>expect(screen.getByRole('main').textContent).toContain('could not be verified'));}
 expect(localStorage.getItem(`tameion.assessment-request.${t.h.id}`)).toMatch(/^[a-f0-9-]{36}$/);expect(screen.getByRole('main').textContent).not.toContain('Assessment request rejected');
 expect(screen.queryByRole('button',{name:/Run AI Assessment|Request one assessment|Request one new assessment/})).toBeNull();expect(t.fetcher.mock.calls.filter(([url,init])=>init?.method==='POST'&&String(url).endsWith('/advisory'))).toHaveLength(1);
});

it('a new retained key cannot inherit the prior exact rejection',async()=>{
 const t=setup();t.onPost(()=>cap(t.h));t.mount();fireEvent.click(await t.row());fireEvent.click(await screen.findByRole('button',{name:'Run AI Assessment'}));await screen.findAllByText('Assessment request rejected');
 localStorage.setItem(`tameion.assessment-request.${t.h.id}`,OTHER);
 fireEvent.click(await t.row(t.h.records[1].obligation_id));await screen.findByRole('button',{name:'Run AI Assessment'});fireEvent.click(await t.row());await screen.findByRole('button',{name:'Check assessment request'});
 expect(screen.getByRole('main').textContent).not.toContain('Assessment request rejected');
 expect(localStorage.getItem(`tameion.assessment-request.${t.h.id}`)).toBe(OTHER);
});

it('a transport detail failure keeps the cause unknown and never renders the thrown error body',async()=>{
 const t=setup();t.mount();fireEvent.click(await t.row());await screen.findByRole('button',{name:'Run AI Assessment'});
 t.onPost(()=>{cap(t.h);t.project(()=>{throw new Error('PRIVATE_TRANSPORT_BODY');});});
 fireEvent.click(screen.getByRole('button',{name:'Run AI Assessment'}));await screen.findByText('Last-known payable details are out of date.');
 expect(screen.getByRole('main').textContent).toContain('cause is unknown');expect(screen.getByRole('main').textContent).not.toContain('PRIVATE_TRANSPORT_BODY');
});

it.each(['source','version'])('a changed %s cannot inherit a rejected attempt as current evidence',async fault=>{
 const t=setup();t.onPost(()=>cap(t.h));t.mount();fireEvent.click(await t.row());fireEvent.click(await screen.findByRole('button',{name:'Run AI Assessment'}));await screen.findAllByText('Assessment request rejected');
 if(fault==='source')t.h.publish(undefined,records=>{records[0].commercial_terms='SYNTHETIC SOURCE CHANGE';});
 else{t.h.snapshot().authority.aggregates[0].aggregate_version=2;const {assessments,...base}=t.h.snapshot().authority;t.h.state_binding.workflow_base_sha256=hash(base);t.h.publish();}
 fireEvent.click(await t.row(t.h.records[1].obligation_id));await screen.findByRole('button',{name:'Run AI Assessment'});fireEvent.click(await t.row());await screen.findByRole('button',{name:'Check assessment request'});
 expect(screen.getByRole('main').textContent).not.toContain('Assessment request rejected');expect(localStorage.getItem(`tameion.assessment-request.${t.h.id}`)).not.toBeNull();
});

it('a deferred old rejection cannot be applied after A -> B -> A selection',async()=>{
 const t=setup();let finish!:(response:Response)=>void;t.postResponse(()=>new Promise<Response>(r=>finish=r));
 t.mount();fireEvent.click(await t.row());fireEvent.click(await screen.findByRole('button',{name:'Run AI Assessment'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
 fireEvent.click(await t.row(t.h.records[1].obligation_id));await waitFor(()=>expect(t.fetcher.mock.calls.some(([url])=>String(url).endsWith(t.h.records[1].obligation_id))).toBe(true));fireEvent.click(await t.row());
 await act(async()=>{finish(Response.json({code:'GENUINE_ASSESSMENT_HISTORY_LIMIT'},{status:409}));});
 await screen.findByRole('button',{name:'Check assessment request'});expect(screen.getByRole('main').textContent).not.toContain('Assessment request rejected');expect(t.fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});
