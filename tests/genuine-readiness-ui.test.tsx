/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {CommandCenter} from '../app/command-center';
import {harness,hash} from './test-support/disposition-fixture';
import {sealTestAssessment} from './test-support/seal-assessment';
import {DemoState} from '../src/server/demo-state';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
afterEach(()=>{cleanup();localStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();});
function setup(basis=false){
 const h=harness({basis}),readers=createObligationReaders(h.guard,(records,binding)=>loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:structuredClone(h.snapshot())})},h.state_binding.namespace,records,binding),h.source,()=>undefined);
 let projectList=(body:any)=>body,projectDetail=(body:any)=>body,delay:((id:string)=>Promise<Response>|null)|null=null;
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  if(init?.method==='POST')throw new Error('No effects admitted by readiness render');
  const url=String(input),r=new Request('https://fixture.invalid'+url);
  const id=url.split('/').at(-1)!;const deferred=url!=='/api/obligations'?delay?.(id):null;if(deferred)return deferred;
  const response=url==='/api/obligations'?await readers.list(r):await readers.detail(r,id);
  const body=await response.json();return Response.json(url==='/api/obligations'?projectList(body):projectDetail(body),{status:response.status});
 });vi.stubGlobal('fetch',fetcher);vi.stubGlobal('crypto',webcrypto);
 const row=()=>waitFor(()=>{const row=document.querySelector<HTMLButtonElement>(`button[data-obligation-id="${h.id}"]`);expect(row).toBeTruthy();return row!;});
 return {h,readers,fetcher,row,projectList:(fn:(body:any)=>any)=>projectList=fn,projectDetail:(fn:(body:any)=>any)=>projectDetail=fn,defer:(fn:((id:string)=>Promise<Response>|null)|null)=>delay=fn};
}
it('real V3 reader prevents doomed fresh assessment before click and explains source context owner/remedy',async()=>{
 const t=setup(),before=JSON.stringify(t.h.snapshot());render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());
 await screen.findByRole('status',{name:'Source assessment context'});
 expect(screen.getByRole('main').textContent).toContain('Source assessment context needs review');
 expect(screen.getByRole('main').textContent).toContain('Workspace owner');
 expect(screen.getByRole('main').textContent).not.toContain('Assessment request rejected');
 expect(screen.queryByRole('button',{name:'Run AI Assessment'})).toBeNull();
 expect(t.fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
 expect(localStorage.getItem(`tameion.assessment-request.${t.h.id}`)).toBeNull();expect(JSON.stringify(t.h.snapshot())).toBe(before);
 expect(t.h.repository.compareAndSet).not.toHaveBeenCalled();
});
it('one dashboard CTA precedes long overview and preserves keyboard-click navigation/focus semantics',async()=>{
 const t=setup(true);render(<CommandCenter csrfToken="SYNTHETIC-CSRF" initialView="dashboard"/>);await screen.findByRole('region',{name:'Payables overview'});
 const heading=screen.getByRole('heading',{name:'Dashboard'}),button=screen.getByRole('button',{name:'Review payables'}),overview=screen.getByRole('region',{name:'Payables overview'});
 expect(screen.getAllByRole('button',{name:'Review payables'})).toHaveLength(1);
 expect(heading.compareDocumentPosition(button)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(button.compareDocumentPosition(overview)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
 expect(button.tagName).toBe('BUTTON');expect(button.tabIndex).toBe(0);expect(button.className).toContain('min-h-11');
 button.focus();expect(document.activeElement).toBe(button);
 // Native keyboard activation dispatches a detail=0 click. jsdom cannot prove browser geometry/default key dispatch.
 fireEvent.click(button,{detail:0});await waitFor(()=>expect(screen.queryByRole('heading',{name:'Dashboard'})).toBeNull());
 expect(t.fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
 expect(document.activeElement?.getAttribute('tabindex')).toBe('-1');
});


it('successful nonstale legacy view explains unadvertised controls without guessing cause or activation',async()=>{
 const t=setup();render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);await t.row();
 expect(screen.queryByRole('status',{name:'Source controls availability'})).toBeNull();
 fireEvent.click(await t.row());const notice=await screen.findByRole('status',{name:'Source controls availability'});
 expect(notice.textContent).toContain('not advertised in this view');expect(notice.textContent).toContain('exact cause is unverified');
 expect(notice.textContent).not.toMatch(/V[1-4]|schema|credential|migration|secret/i);expect(within(notice).queryByRole('button')).toBeNull();
});

it.each(['create','manual','correct'])('advertised %s controls remain available without an absence notice',async capability=>{
 const t=setup(true);
 if(capability==='create')t.projectList(d=>({...d,allowed_actions:['CREATE_SOURCE']}));
 else t.projectDetail(d=>({...d,allowed_actions:[capability==='manual'?'MANUAL_REVIEW':'EDIT_SOURCE']}));
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());await screen.findByRole('button',{name:capability==='manual'?'Review source manually':'Run AI Assessment'});
 expect(screen.queryByRole('status',{name:'Source controls availability'})).toBeNull();
 if(capability==='manual')expect(await screen.findByLabelText('Review rationale')).toBeTruthy();
 if(capability==='correct')expect(await screen.findByRole('button',{name:'Edit payable / Save correction'})).toBeTruthy();
});

it.each(['missing','false-no-cause','true-no-authority'])('explicit %s metadata does not invent capability or source cause',async kind=>{
 const t=setup(true);t.projectDetail(d=>{
  if(kind==='missing'){const {fresh_assessment_readiness,...old}=d;return old;}
  return {...d,...(kind==='true-no-authority'?{advisory_action_eligible:false,financial_action_eligible:false}:{}),fresh_assessment_readiness:{ready:kind==='true-no-authority'}};
 });render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());
 if(kind==='missing')await screen.findByRole('button',{name:'Run AI Assessment'});
 else{if(kind==='true-no-authority')await screen.findByText('Review-only payable');else await screen.findByRole('status',{name:'Source assessment context'});expect(screen.queryByRole('button',{name:'Run AI Assessment'})).toBeNull();}
 expect(screen.getByRole('main').textContent).not.toContain('Source assessment context needs review');
 expect(t.fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
});

it.each(['UNKNOWN','HISTORY_LIMIT','FINANCIAL_HISTORY'])('existing %s is not replaced by source precondition guidance',async kind=>{
 const t=setup();
 if(kind==='UNKNOWN')t.h.snapshot().assessment_operations.push({idempotency_key:'11111111-1111-4111-8111-111111111111',obligation_id:t.h.id,aggregate_version:1,status:'UNKNOWN',reserved_at:1});
 if(kind==='HISTORY_LIMIT')for(let n=0;n<4;n++)t.h.snapshot().assessment_operations.push({idempotency_key:`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`,obligation_id:t.h.id,aggregate_version:1,status:'STALE',reserved_at:1});
 if(kind==='FINANCIAL_HISTORY'){t.h.snapshot().authority.aggregates[0].state='CANCELLED';const {assessments,...base}=t.h.snapshot().authority;t.h.state_binding.workflow_base_sha256=hash(base);t.h.publish();}
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());
 await screen.findByRole('status',{name:'Source controls availability'});
 expect(screen.queryByRole('status',{name:'Source assessment context'})).toBeNull();expect(screen.queryByRole('button',{name:'Run AI Assessment'})).toBeNull();
 if(kind==='UNKNOWN')expect(screen.getByRole('main').textContent).toContain('Assessment completion not confirmed');
 if(kind==='HISTORY_LIMIT')expect(screen.getByRole('main').textContent).toContain('history limit');
 expect(t.fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
});

it('pending retained identity takes precedence over a fresh-source blocker',async()=>{
 const t=setup();localStorage.setItem(`tameion.assessment-request.${t.h.id}`,'11111111-1111-4111-8111-111111111111');
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());await screen.findByRole('button',{name:'Check assessment request'});
 expect(screen.queryByRole('status',{name:'Source assessment context'})).toBeNull();expect(t.fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
});

it.each(['PAY','HOLD'] as const)('current %s result actions survive the fresh source precondition',async decision=>{
 const t=setup(),state=new DemoState(t.h.snapshot(),undefined,undefined,undefined,{},t.h.records);
 sealTestAssessment(state.store,'ORG-DEMO-001',t.h.id,1,{decision,source_record_sha256:hash(t.h.records[0])});t.h.snapshot().authority=state.store.exportSnapshot();
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());
 if(decision==='PAY'){fireEvent.click(await screen.findByRole('button',{name:'View Assessment'}));await screen.findByRole('button',{name:'Create linked testnet instruction'});}
 else await screen.findByRole('button',{name:'View HOLD findings'});
 expect(screen.queryByRole('status',{name:'Source assessment context'})).toBeNull();expect(t.fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
});

it.each(['error','deferred','late-selection'])('capability and source notices are suppressed for %s detail',async fault=>{
 const t=setup();let finish!:(r:Response)=>void;
 t.defer(id=>id===t.h.id?fault==='error'?Promise.resolve(Response.json({code:'STATE_UNAVAILABLE'},{status:503})):new Promise(r=>finish=r):null);
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());
 if(fault==='error')await screen.findByText('Payable details are unavailable.');
 else await waitFor(()=>expect(finish).toBeTypeOf('function'));
 expect(screen.queryByRole('status',{name:'Source controls availability'})).toBeNull();expect(screen.queryByRole('status',{name:'Source assessment context'})).toBeNull();
 if(fault==='late-selection'){
  const next=document.querySelector<HTMLButtonElement>(`button[data-obligation-id="${t.h.records[1].obligation_id}"]`)!;fireEvent.click(next);await screen.findByRole('button',{name:'Run AI Assessment'});
  const old=await t.readers.detail(new Request('https://fixture.invalid'),t.h.id);await act(async()=>finish(old));
  expect(screen.queryByRole('status',{name:'Source assessment context'})).toBeNull();expect(screen.getByRole('button',{name:'Run AI Assessment'})).toBeTruthy();
 }
});

it('dashboard and queue show the current original-record precondition without new dispatch',async()=>{
 const t=setup();render(<CommandCenter csrfToken="SYNTHETIC-CSRF" initialView="dashboard"/>);
 const overview=await screen.findByRole('region',{name:'Payables overview'});expect(overview.textContent).toContain('Source assessment context needs review');
 fireEvent.click(screen.getByRole('button',{name:'Review payables'}));expect((await t.row()).textContent).toContain('Source assessment context needs review');
 fireEvent.click(await t.row());await screen.findByRole('status',{name:'Source assessment context'});expect((await t.row()).textContent).toContain('Source assessment context needs review');
 expect(t.fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
});


it('legitimate HOLD-compatible commercial input retains fresh assessment capability',async()=>{
 const t=setup(true);t.h.records[0].business_purpose_confirmed=false;t.h.publish();
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());await screen.findByRole('button',{name:'Run AI Assessment'});
 expect(screen.queryByRole('status',{name:'Source assessment context'})).toBeNull();expect(t.fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
});

it('fresh-only metadata cannot disable independently advertised UNKNOWN recovery',async()=>{
 const t=setup();t.projectDetail(d=>({...d,advisory_action_eligible:false,genuine_assessment:{...d.genuine_assessment,status:'UNKNOWN',recovery_eligible:true}}));
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());await screen.findByRole('button',{name:'Request one new assessment'});
 expect(screen.queryByRole('status',{name:'Source assessment context'})).toBeNull();expect(t.fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
});

it('new successful source read replaces obsolete queue guidance; selected loading never borrows old precondition',async()=>{
 const t=setup();render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());await screen.findByRole('status',{name:'Source assessment context'});
 fireEvent.click(document.querySelector<HTMLButtonElement>(`button[data-obligation-id="${t.h.records[1].obligation_id}"]`)!);await screen.findByRole('button',{name:'Run AI Assessment'});
 const valid=harness().records[0].assessment_basis;t.h.publish(undefined,records=>{records[0].assessment_basis=valid;});
 let finish!:(r:Response)=>void;t.defer(id=>id===t.h.id?new Promise(r=>finish=r):null);fireEvent.click(await t.row());await waitFor(()=>expect(finish).toBeTypeOf('function'));
 expect(screen.queryByRole('status',{name:'Source assessment context'})).toBeNull();expect((await t.row()).textContent).not.toContain('Source assessment context needs review');
 const next=await t.readers.detail(new Request('https://fixture.invalid'),t.h.id);await act(async()=>finish(next));await screen.findByRole('button',{name:'Run AI Assessment'});
 expect(screen.queryByRole('status',{name:'Source assessment context'})).toBeNull();expect((await t.row()).textContent).not.toContain('Source assessment context needs review');
});

it('failed detail refresh after uncertainty never presents retained source/capability observations as current',async()=>{
 const t=setup(true),base=t.fetcher.getMockImplementation()!;
 t.fetcher.mockImplementation(async(input,init)=>{
  if(init?.method==='POST'){t.defer(()=>Promise.resolve(Response.json({code:'STATE_UNAVAILABLE'},{status:503})));throw new Error('SYNTHETIC TRANSPORT UNCERTAINTY');}
  return base(input,init);
 });
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());await screen.findByRole('status',{name:'Source controls availability'});
 fireEvent.click(await screen.findByRole('button',{name:'Run AI Assessment'}));await screen.findByText('Last-known payable details are out of date.');
 expect(screen.queryByRole('status',{name:'Source controls availability'})).toBeNull();expect(screen.queryByRole('status',{name:'Source assessment context'})).toBeNull();
 expect(localStorage.getItem(`tameion.assessment-request.${t.h.id}`)).not.toBeNull();expect(t.fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});

// Independent canonical capability parity regression; not part of product candidate.
it('independent canonical EDIT_SOURCE remains advertised without contradictory absence notice',async()=>{
 const t=setup(true);t.projectDetail(d=>({...d,allowed_actions:['EDIT_SOURCE']}));
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());
 expect(await screen.findByRole('button',{name:'Edit payable / Save correction'})).toBeTruthy();
 expect(screen.queryByRole('status',{name:'Source controls availability'})).toBeNull();
 expect(t.fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
});


it('an ingress permission name alone is not a canonical advertised edit action',async()=>{
 const t=setup(true);t.projectDetail(d=>({...d,allowed_actions:['CORRECT_SOURCE']}));
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());
 await screen.findByRole('status',{name:'Source controls availability'});
 expect(screen.queryByRole('button',{name:'Edit payable / Save correction'})).toBeNull();
 expect(t.fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);
});

async function seedRetainedPayLink(t:ReturnType<typeof setup>){
 const state=new DemoState(t.h.snapshot(),undefined,undefined,undefined,{},t.h.records);
 const review=sealTestAssessment(state.store,'ORG-DEMO-001',t.h.id,1,{decision:'PAY',source_record_sha256:hash(t.h.records[0])});t.h.snapshot().authority=state.store.exportSnapshot();
 const {sealLinkedInstruction}=await import('../src/domain/linked-instruction');
 t.h.snapshot().linked_settlement_instructions=[sealLinkedInstruction({schema_version:1,kind:'ARC_TESTNET_SETTLEMENT_INSTRUCTION',status:'DRAFT_AUTHORITY_REQUIRED',organization_id:'ORG-DEMO-001',source_obligation_id:t.h.id,source_record_sha256:hash(t.h.records[0]),source_aggregate_version:1,assessment_id:review.record.assessment_id,assessment_hash:review.assessment_hash,instruction_id:`TESTNET-CONTROLLED-LINKED-${'a'.repeat(32)}`,attempt_id:'11111111-1111-4111-8111-111111111111',source_amount:t.h.records[0].amount,source_currency:t.h.records[0].currency,network:'ARC_TESTNET',classification:'TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT',created_at:'2026-01-01T00:00:00.000Z'})];
}

it('reviewed current PAY with blocked source has no dead-end optional rerun and keeps retained link/result',async()=>{
 const t=setup();await seedRetainedPayLink(t);
 const before=JSON.stringify(t.h.snapshot()),detail=await(await t.readers.detail(new Request('https://fixture.invalid'),t.h.id)).json();
 expect(detail.fresh_assessment_readiness).toEqual({ready:false,blocker:'SOURCE_ASSESSMENT_CONTEXT_REQUIRED'});expect(detail.advisory_action_eligible).toBe(true);
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());fireEvent.click(await screen.findByRole('button',{name:'View Assessment'}));
 fireEvent.click(await screen.findByRole('button',{name:'Review current PAY assessment'}));fireEvent.click(screen.getByText('Findings and supporting detail'));
 expect(screen.getByRole('region',{name:'Assessment result'}).textContent).toContain('PAY');expect(screen.getByRole('region',{name:'Linked Arc Testnet instructions'}).textContent).toContain('TESTNET-CONTROLLED-LINKED-');
 expect(screen.queryByRole('button',{name:'Run AI Assessment again'})).toBeNull();
 expect(t.fetcher.mock.calls.every(([,init])=>init?.method!=='POST')).toBe(true);expect(t.h.repository.compareAndSet).not.toHaveBeenCalled();expect(JSON.stringify(t.h.snapshot())).toBe(before);expect(localStorage.length).toBe(0);
});


it.each(['ready','legacy-missing'])('current reviewed PAY rerun remains functional for %s context',async kind=>{
 const t=setup(true);await seedRetainedPayLink(t);
 if(kind==='legacy-missing')t.projectDetail(d=>{const {fresh_assessment_readiness,...olderRead}=d;return olderRead;});
 const canonical=await(await t.readers.detail(new Request('https://fixture.invalid'),t.h.id)).json();expect(canonical.fresh_assessment_readiness.ready).toBe(true);
 const before=JSON.stringify(t.h.snapshot());render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);fireEvent.click(await t.row());fireEvent.click(await screen.findByRole('button',{name:'View Assessment'}));fireEvent.click(await screen.findByRole('button',{name:'Review current PAY assessment'}));fireEvent.click(screen.getByText('Findings and supporting detail'));
 const rerun=screen.getByRole('button',{name:'Run AI Assessment again'}) as HTMLButtonElement;expect(rerun.disabled).toBe(false);expect(screen.getByRole('region',{name:'Linked Arc Testnet instructions'})).toBeTruthy();
 // This counted fake transport throws without invoking a server/provider. Only the existing UI request path is exercised.
 fireEvent.click(rerun);await waitFor(()=>expect(t.fetcher.mock.calls.filter(([url,init])=>init?.method==='POST'&&String(url).endsWith('/advisory'))).toHaveLength(1));
 const request=t.fetcher.mock.calls.find(([,init])=>init?.method==='POST')![1]!;const key=(request.headers as Record<string,string>)['Idempotency-Key'];
 expect(localStorage.getItem(`tameion.assessment-request.${t.h.id}`)).toBe(key);expect(JSON.stringify(t.h.snapshot())).toBe(before);expect(t.h.repository.compareAndSet).not.toHaveBeenCalled();
 await screen.findByRole('button',{name:'Check assessment request'});expect(t.fetcher.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
});
