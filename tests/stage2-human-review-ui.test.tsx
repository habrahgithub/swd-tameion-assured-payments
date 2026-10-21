// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {CommandCenter,payableBlockers} from '../app/command-center';
import {sourceHarness,invoice} from './test-support/source-workflow-fixture';
afterEach(()=>{cleanup();localStorage.clear();sessionStorage.clear();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
const unknown={status:'UNKNOWN',recovery_eligible:false,recovery_reason:'LEGACY_EVIDENCE_MISSING'};
async function fixture(accepted=false,reason='LEGACY_EVIDENCE_MISSING'){
 const h=sourceHarness();const saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic Stage2 operator edge case'}))).json();const id=saved.obligation.obligation_id;
 if(accepted){const result=await h.handler('review',h.request({expected_version:1,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Authoritative synthetic facts explicitly reviewed',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]}),id);expect(result.status).toBe(201);}
 const detail=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();
 detail.genuine_assessment={...unknown,recovery_reason:reason};
 const list=await(await h.handler('list',new Request('https://synthetic.invalid'))).json();
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{if(init?.method&&init.method!=='GET')throw new Error('Mutation forbidden in navigation probes');return Response.json(String(input)==='/api/obligations'?list:detail);});
 vi.stubGlobal('fetch',fetcher);vi.stubGlobal('crypto',webcrypto);
 const mount=async()=>{render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);const row=await waitFor(()=>{const b=document.querySelector<HTMLButtonElement>(`button[data-obligation-id="${id}"]`);expect(b).toBeTruthy();return b!;});fireEvent.click(row);await screen.findByRole('region',{name:'Current control status'});};
 return {h,id,detail,fetcher,mount};
}
function blockers(detail:any,id:string){return payableBlockers({detail,state:'loaded',selectedId:id,stage:'Assessment'});}
it('CONTROL: UNKNOWN does not fabricate payment authority or another AI attempt',async()=>{
 const t=await fixture();await t.mount();expect(screen.queryByRole('button',{name:'Run AI Assessment'})).toBeNull();expect(screen.queryByRole('button',{name:'Request one new assessment'})).toBeNull();expect(screen.queryByRole('button',{name:'Authorize exact payment'})).toBeNull();expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).toContain('Assessment completion not confirmed');expect(t.fetcher.mock.calls.every(([,i])=>!i?.method||i.method==='GET')).toBe(true);
});
it('CONTROL: manual review panel is available only with server capability despite UNKNOWN',async()=>{
 const t=await fixture();expect(t.detail.allowed_actions).toContain('MANUAL_REVIEW');await t.mount();expect(screen.getByRole('region',{name:'Payable source and human review'})).toBeTruthy();expect((await screen.findByRole('button',{name:'Continue with manual review'})).hasAttribute('disabled')).toBe(true);
});
it('CONTROL: withholding manual capability cannot be bypassed by an UNKNOWN payload',async()=>{
 const t=await fixture();t.detail.allowed_actions=[];t.detail.source_revision=null;t.detail.current_review_decision=null;await t.mount();expect(screen.queryByRole('button',{name:'Continue with manual review'})).toBeNull();expect(screen.queryByRole('button',{name:'Authorize exact payment'})).toBeNull();
});
it('CONTROL: uncertain financial movement retains the independent reconciliation blocker',async()=>{
 const t=await fixture(true);t.detail.execution={status:'UNKNOWN',idempotency_key:'SYNTHETIC-ORIGINAL-PAYMENT',provider_ref:null};const list=blockers(t.detail,t.id);expect(list[0].kind).toBe('execution-unknown');expect(list[0].nextAction).toMatch(/existing submission/);
});
it('RED S2-UX-01: source-change and financial-history denials expose different actionable remedies',async()=>{
 const t=await fixture();const source=blockers({...t.detail,genuine_assessment:{...unknown,recovery_reason:'SOURCE_CHANGED'}},t.id).find(b=>b.kind==='assessment-unknown')!;const financial=blockers({...t.detail,genuine_assessment:{...unknown,recovery_reason:'FINANCIAL_HISTORY'}},t.id).find(b=>b.kind==='assessment-unknown')!;
 expect(source.nextAction).not.toBe(financial.nextAction);
});
it('RED S2-UX-02: contextual footer directs an eligible UNKNOWN user to human review',async()=>{
 const t=await fixture();await t.mount();const footer=screen.getByRole('region',{name:'Current payable action'});expect(within(footer).getByRole('button').textContent).toMatch(/manual|human|source.*review/i);
});
it('RED S2-UX-03 CONDITIONAL: current accepted HUMAN review is not blocked by historical AI UNKNOWN copy',async()=>{
 const t=await fixture(true);await t.mount();expect(screen.getAllByText(/Human review · ACCEPT_FOR_AUTHORIZATION/).length).toBeGreaterThan(0);expect(screen.queryByRole('region',{name:'Hold reason and next action'})?.textContent??'').not.toContain('Owner review is required; another assessment is not admitted.');
});

it('V4 source-panel unbound pending reply retains exact command through reload and observational capability',async()=>{
 const{SourceWorkflowPanel}=await import('../app/source-workflow-panel');
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic reserved panel'}))).json(),id=saved.obligation.obligation_id;
 const d=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json(),calls:string[]=[];
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{calls.push(new Headers(init?.headers).get('Idempotency-Key')!);return Response.json({status:'IN_PROGRESS'},{status:202});});vi.stubGlobal('fetch',fetcher);vi.stubGlobal('crypto',webcrypto);
 const first=render(<SourceWorkflowPanel selectedId={id} csrfToken="SYNTHETIC-RELOAD" onChanged={()=>{}} readModel={{detail:d,createAllowed:false}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Request AI advice'}));await screen.findByText(/Assessment completion unconfirmed/);expect(sessionStorage.length).toBe(1);expect(document.body.textContent).not.toMatch(/provider received|data sent/i);
 first.unmount();render(<SourceWorkflowPanel selectedId={id} csrfToken="SYNTHETIC-RELOAD" onChanged={()=>{}} readModel={{detail:{...d,allowed_actions:['OBSERVE_AI_REQUEST']},createAllowed:false}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Recover original pending command'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));expect(calls[0]).toBe(calls[1]);expect(sessionStorage.length).toBe(1);expect(screen.queryByRole('button',{name:'Request AI advice'})).toBeNull();
});
it('V4 replacement explicitly sends observed stale review hash; human receipt remains history',async()=>{
 const{SourceWorkflowPanel}=await import('../app/source-workflow-panel'),h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic stale actor review'}))).json(),id=saved.obligation.obligation_id;
 const accepted=await(await h.handler('review',h.request({expected_version:1,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Original explicit human review',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]}),id)).json();
 h.snapshot().actor_authorities[0].authority_version='2';const d=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();expect(d.current_review_decision).toBeNull();const old=structuredClone(h.snapshot().authority.review_decisions?.[0]);let body:any;
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{body=JSON.parse(String(init?.body));return h.handler('review',h.request(body,new Headers(init?.headers).get('Idempotency-Key')!),id);});vi.stubGlobal('fetch',fetcher);vi.stubGlobal('crypto',webcrypto);
 render(<SourceWorkflowPanel selectedId={id} csrfToken="SYNTHETIC-STALE-REVIEW" onChanged={()=>{}} readModel={{detail:d,createAllowed:false}}/>);
 fireEvent.change(await screen.findByRole('textbox',{name:'Review rationale'}),{target:{value:'Current actor explicitly reviews original facts again'}});fireEvent.click(screen.getByRole('button',{name:'Continue with manual review'}));await screen.findByText(/Command recorded/);
 expect(body.expected_review_hash).toBe(accepted.review_decision_hash);expect(h.snapshot().authority.review_decisions?.[0]).toEqual(old);expect(h.snapshot().authority.review_decisions).toHaveLength(2);
});

// AXIS return1: exact independent provider-boundary probes; shared imports/cleanup reused.
import {SourceWorkflowPanel} from '../app/source-workflow-panel';
async function prepared(){const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic independent metadata boundary'}))).json(),id=saved.obligation.obligation_id,d=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();return{h,id,d};}
function mount(t:Awaited<ReturnType<typeof prepared>>){vi.stubGlobal('crypto',webcrypto);render(<SourceWorkflowPanel selectedId={t.id} csrfToken="SYNTHETIC-METADATA" onChanged={()=>{}} readModel={{detail:t.d,createAllowed:false}}/>);}
it('valid actual committed source/receipt category remains visible',async()=>{
 const t=await prepared();vi.stubEnv('NVIDIA_API_KEY','SYNTHETIC-OFFLINE');
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
  if(String(url).startsWith('/api/obligations/')){const network=globalThis.fetch;vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'synthetic'},{status:401})));try{return await t.h.handler('assess',t.h.request({},new Headers(init?.headers).get('Idempotency-Key')!),t.id);}finally{vi.stubGlobal('fetch',network);}}
  throw Error('Unexpected real-network route');
 }));mount(t);fireEvent.click(await screen.findByRole('button',{name:'Request AI advice'}));await screen.findByText(/AI service configuration rejected/);expect(sessionStorage.length).toBe(0);
});
it('INTENDED UNCONFIRMED:202 without committed receipt cannot turn arbitrary category into committed provider evidence',async()=>{
 const t=await prepared(),fetcher=vi.fn(async()=>Response.json({status:'IN_PROGRESS',stage2_provider_outcome:'CONFIGURATION_REJECTED'},{status:202}));vi.stubGlobal('fetch',fetcher);mount(t);
 fireEvent.click(await screen.findByRole('button',{name:'Request AI advice'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));await screen.findByText(/Responsible:/);
 console.log('SENTINEL_UNBOUND202_TEXT',document.body.textContent);
 expect(document.body.textContent).not.toContain('AI service configuration rejected');expect(document.body.textContent).not.toContain('committed outcome records a configuration category');expect(sessionStorage.length).toBe(1);
});
it('INTENDED UNCONFIRMED: foreign actual receipt cannot supply selected payable provider category',async()=>{
 const t=await prepared(),other=await prepared();vi.stubEnv('NVIDIA_API_KEY','SYNTHETIC-OFFLINE');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'synthetic'},{status:401})));
 const result=await other.h.handler('assess',other.h.request({}),other.id);expect(result.status).toBe(200);const foreign=await result.json();expect(foreign.stage2_provider_outcome).toBe('CONFIGURATION_REJECTED');
 const fetcher=vi.fn(async()=>Response.json(foreign));vi.stubGlobal('fetch',fetcher);mount(t);fireEvent.click(await screen.findByRole('button',{name:'Request AI advice'}));await screen.findByText(/Responsible:/);
 console.log('SENTINEL_FOREIGN200_TEXT',document.body.textContent);
 expect(document.body.textContent).not.toContain('AI service configuration rejected');expect(sessionStorage.length).toBe(1);
});

it('INTENDED RETAIN ORIGINAL: same payable/version receipt for another key cannot clear pending identity',async()=>{
 const t=await prepared(),olderKey='99999999-9999-4999-8999-999999999999';vi.stubEnv('NVIDIA_API_KEY','SYNTHETIC-OFFLINE');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'synthetic'},{status:401})));
 const oldResponse=await t.h.handler('assess',t.h.request({},olderKey),t.id);expect(oldResponse.status).toBe(200);const older=await oldResponse.json();expect(older.assessment_id).toBe('ASM-'+olderKey);let dispatchedKey:string|null=null;
 const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{dispatchedKey=new Headers(init?.headers).get('Idempotency-Key');return Response.json(older);});vi.stubGlobal('fetch',fetcher);mount(t);fireEvent.click(await screen.findByRole('button',{name:'Request AI advice'}));await screen.findByText(/Responsible:/);
 expect(dispatchedKey).not.toBe(olderKey);console.log('SENTINEL_WRONGKEY_RETENTION',JSON.stringify({different_request_key:dispatchedKey!==olderKey,receipt_same_payable:true,receipt_same_version:true,retained_entries:sessionStorage.length}));
 expect(sessionStorage.length).toBe(1);expect(screen.queryByText('Recover original pending command')).not.toBeNull();
});

// Return1 acceptance extension: real committed receipts with controlled response boundaries.
const boundaryKey='77777777-7777-4777-8777-777777777777';
async function boundaryReceipt(){
 const t=await prepared();vi.stubEnv('NVIDIA_API_KEY','SYNTHETIC-OFFLINE');vi.stubGlobal('fetch',vi.fn(async()=>Response.json({error:'synthetic'},{status:401})));
 const r=await t.h.handler('assess',t.h.request({},boundaryKey),t.id);expect(r.status).toBe(200);const data=await r.json();
 vi.stubGlobal('crypto',{randomUUID:()=>boundaryKey});return{...t,data};
}
for(const defect of ['missing','null','array','hash','version','category','pending202','unknown202']as const)it(`return1 boundary ${defect} preserves exact command unless valid current completion`,async()=>{
 const t=await boundaryReceipt();let data=structuredClone(t.data),status=200;
 if(defect==='missing'){delete data.assessment_id;delete data.decision;}
 if(defect==='null')data=null;
 if(defect==='array')data=[];
 if(defect==='hash')data.assessment_hash='not-a-sealed-hash';
 if(defect==='version')data.aggregate_version='2';
 if(defect==='category')data.stage2_provider_outcome='SYNTHETIC_PRIVATE_UNKNOWN_CATEGORY';
 if(defect==='pending202'){status=202;data.status='IN_PROGRESS';}
 if(defect==='unknown202'){status=202;data.status='SYNTHETIC_UNRECOGNIZED';}
 const fetcher=vi.fn(async()=>Response.json(data,{status}));vi.stubGlobal('fetch',fetcher);render(<SourceWorkflowPanel selectedId={t.id} csrfToken="SYNTHETIC-METADATA" onChanged={()=>{}} readModel={{detail:t.d,createAllowed:false}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Request AI advice'}));await screen.findByText(/Responsible:/);
 expect(document.body.textContent).not.toContain('AI service configuration rejected');expect(document.body.textContent).not.toContain('SYNTHETIC_PRIVATE_UNKNOWN_CATEGORY');
 if(defect==='category'){expect(sessionStorage.length).toBe(0);expect(document.body.textContent).toContain('Assessment results available');}
 else{expect(sessionStorage.length).toBe(1);const retained=JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!);expect(retained.request.key).toBe(boundaryKey);expect(JSON.parse(retained.request.signature).body).toEqual({});expect(screen.queryByText('Recover original pending command')).not.toBeNull();expect(document.body.textContent).toContain('completion unconfirmed');expect(document.body.textContent).not.toMatch(/Assessment request saved|server reserved the request/);}
 expect(fetcher).toHaveBeenCalledTimes(1);
});
for(const change of ['version','record','revision','selection','session','unmount']as const)it(`return1 awaiting receipt cannot apply after live ${change} change`,async()=>{
 const t=await boundaryReceipt();let finish!:(response:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{finish=resolve;}));vi.stubGlobal('fetch',fetcher);
 const props={selectedId:t.id,csrfToken:'SYNTHETIC-METADATA',onChanged:vi.fn(),readModel:{detail:t.d,createAllowed:false}};const ui=render(<SourceWorkflowPanel {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Request AI advice'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));const storage=Array.from({length:sessionStorage.length},(_,i)=>[sessionStorage.key(i)!,sessionStorage.getItem(sessionStorage.key(i)!)!]as const);
 const detail=structuredClone(t.d);
 if(change==='version')detail.aggregate.aggregate_version++;
 if(change==='record')detail.record.description='Synthetic newly corrected source';
 if(change==='revision')detail.source_revision={...detail.source_revision,revision:detail.source_revision.revision+1};
 if(change==='unmount')ui.unmount();else ui.rerender(<SourceWorkflowPanel {...props} selectedId={change==='selection'?'SYNTHETIC-OTHER':t.id} csrfToken={change==='session'?'SYNTHETIC-NEW-SESSION':props.csrfToken} readModel={{detail,createAllowed:false}}/>);
 await act(async()=>{finish(Response.json(t.data));});
 if(change!=='unmount')await waitFor(()=>expect(screen.queryByText(/Submitting assessment request; submission/)).toBeNull());
 for(const[k,v]of storage)expect(sessionStorage.getItem(k)).toBe(v);
 expect(document.body.textContent).not.toContain('AI service configuration rejected');expect(props.onChanged).not.toHaveBeenCalled();
});
it('return1 exact original receipt recovery after reload clears only the recovered command without provider redispatch',async()=>{
 const t=await boundaryReceipt(),calls:string[]=[];
 const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{calls.push(new Headers(init?.headers).get('Idempotency-Key')!);return calls.length===1?Response.json({status:'IN_PROGRESS'},{status:202}):t.h.handler('assess',t.h.request({},calls.at(-1)!),t.id);});vi.stubGlobal('fetch',fetcher);
 const props={selectedId:t.id,csrfToken:'SYNTHETIC-METADATA',onChanged:vi.fn(),readModel:{detail:t.d,createAllowed:false}},first=render(<SourceWorkflowPanel {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Request AI advice'}));await screen.findByText(/Assessment completion unconfirmed/);const before=sessionStorage.getItem(sessionStorage.key(0)!)!;first.unmount();
 render(<SourceWorkflowPanel {...props} readModel={{detail:{...t.d,allowed_actions:['OBSERVE_AI_REQUEST']},createAllowed:false}}/>);
 expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(before);fireEvent.click(await screen.findByRole('button',{name:'Recover original pending command'}));await screen.findByText(/AI service configuration rejected/);
 expect(calls).toEqual([boundaryKey,boundaryKey]);expect(fetcher).toHaveBeenCalledTimes(2);expect(sessionStorage.length).toBe(0);expect(t.h.snapshot().assessment_operations).toHaveLength(1);expect(props.onChanged).toHaveBeenCalledTimes(1);
});
it('return1 late receipt after A to B to A cannot erase a newer manual command',async()=>{
 const t=await boundaryReceipt();let finish!:(response:Response)=>void;const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{if(fetcher.mock.calls.length===1)finish=resolve;}));vi.stubGlobal('fetch',fetcher);let n=0;vi.stubGlobal('crypto',{randomUUID:()=>++n===1?boundaryKey:'88888888-8888-4888-8888-888888888888'});
 const props={selectedId:t.id,csrfToken:'SYNTHETIC-METADATA',onChanged:vi.fn(),readModel:{detail:t.d,createAllowed:false}},ui=render(<SourceWorkflowPanel {...props}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Request AI advice'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));
 ui.rerender(<SourceWorkflowPanel {...props} selectedId="SYNTHETIC-OTHER"/>);ui.rerender(<SourceWorkflowPanel {...props}/>);
 fireEvent.change(await screen.findByRole('textbox',{name:'Review rationale'}),{target:{value:'Synthetic current explicit manual review'}});fireEvent.click(screen.getByRole('button',{name:'Continue with manual review'}));await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));const retained=sessionStorage.getItem(sessionStorage.key(0)!)!;
 expect(JSON.parse(retained).request.key).not.toBe(boundaryKey);expect(JSON.parse(JSON.parse(retained).request.signature).path).toMatch(/\/review$/);
 await act(async()=>{finish(Response.json(t.data));});
 expect(sessionStorage.getItem(sessionStorage.key(0)!)).toBe(retained);expect(document.body.textContent).not.toContain('AI service configuration rejected');expect(props.onChanged).not.toHaveBeenCalled();ui.unmount();
});

for(const status of ['IN_PROGRESS','RECOVERY_PENDING'])it(`return1 unbound202 ${status} cannot prove a saved reservation`,async()=>{
 const t=await prepared();vi.stubGlobal('fetch',vi.fn(async()=>Response.json({status},{status:202})));mount(t);fireEvent.click(await screen.findByRole('button',{name:'Request AI advice'}));await screen.findByText(/Responsible:/);
 expect(document.body.textContent).not.toMatch(/Assessment request saved|server reserved the request|provider received|data sent/i);expect(document.body.textContent).toContain('completion unconfirmed');expect(sessionStorage.length).toBe(1);expect(screen.queryByText('Recover original pending command')).not.toBeNull();
});
