// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
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

it('V4 source-panel reserved reply retains exact command through reload and observational capability',async()=>{
 const{SourceWorkflowPanel}=await import('../app/source-workflow-panel');
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic reserved panel'}))).json(),id=saved.obligation.obligation_id;
 const d=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json(),calls:string[]=[];
 const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{calls.push(new Headers(init?.headers).get('Idempotency-Key')!);return Response.json({status:'IN_PROGRESS'},{status:202});});vi.stubGlobal('fetch',fetcher);vi.stubGlobal('crypto',webcrypto);
 const first=render(<SourceWorkflowPanel selectedId={id} csrfToken="SYNTHETIC-RELOAD" onChanged={()=>{}} readModel={{detail:d,createAllowed:false}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Request AI advice'}));await screen.findByText(/server reserved the request/);expect(sessionStorage.length).toBe(1);expect(document.body.textContent).not.toMatch(/provider received|data sent/i);
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
