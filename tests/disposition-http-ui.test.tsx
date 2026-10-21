/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor} from '@testing-library/react';
import {webcrypto,createHash} from 'node:crypto';
import {CommandCenter} from '../app/command-center';
import {harness,seedRepresentative,admissionFor,attest,dispose,mockProvider,LEGACY,CHILD,OTHER,hash} from './test-support/disposition-fixture';
import {createGenuineAssessmentStatusHandler} from '../src/server/genuine-assessment-status';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
import {AccessError} from '../src/server/route-access-policy';
import {POST as dispositionPOST,GET as dispositionGET} from '../app/api/obligations/[id]/advisory/disposition/route';
import {POST as draftPOST} from '../app/api/obligations/[id]/testnet-instruction/route';
import {createOperatorHandlers,csrfForBearer} from '../src/server/operator-auth';
import {parseOperatorPolicy} from '../src/server/route-access-policy';
import {createGenuineWorkflowHandlers} from '../src/server/genuine-workflow';
import {bodyFor} from './test-support/disposition-fixture';
const runtime=vi.hoisted(()=>({handler:null as any}));
vi.mock('../src/server/genuine-workflow',async original=>({...await original<typeof import('../src/server/genuine-workflow')>(),genuineWorkflowHandlers:(...args:any[])=>runtime.handler(...args)}));
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();localStorage.clear();});

it('the concrete disposition route requires authentication/CSRF and an explicit admission selector',async()=>{
 const h=harness();attest();seedRepresentative(h);h.publish(admissionFor(h));runtime.handler=h.handler;
 for(const [code,status] of [['SESSION_REQUIRED',401],['CSRF_REJECTED',403]] as const){
  h.guard.mockRejectedValueOnce(new AccessError(code,status));
  const response=await dispositionPOST(h.request({}),{params:Promise.resolve({id:h.id})});expect(response.status).toBe(status);
  expect(h.guard).toHaveBeenLastCalledWith(expect.any(Request),true);expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 }
 expect((await dispositionPOST(h.request({}),{params:Promise.resolve({id:h.id})})).status).toBe(400);
 expect(dispositionGET().status).toBe(405);
});

it('production HTTP disposition uses the real session/CSRF guard before any reservation or provider',async()=>{
 const h=harness(),provider=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));
 const bearer=Buffer.alloc(32,1).toString('base64url'),csrf=csrfForBearer(bearer);
 const policy=parseOperatorPolicy({TAMEION_ALLOWED_ORIGINS:'["https://fixture.invalid"]',TAMEION_INGRESS_MODE:'vercel-direct-v1',TAMEION_INGRESS_RECORD:JSON.stringify({approval_id:'SYNTHETIC',project_id:'SYNTHETIC-PROJECT',deployment_id:'SYNTHETIC-DEPLOYMENT',environment:'preview',direct_edge:true,trusted_proxy_override:false,origins:['https://fixture.invalid']}),TAMEION_THROTTLE_HMAC_KEY:'a'.repeat(64),VERCEL:'1',VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'SYNTHETIC-PROJECT',VERCEL_DEPLOYMENT_ID:'SYNTHETIC-DEPLOYMENT'});
 const session={valid:true,operator_key:'fictional',credential_version:1,expires_at:new Date(Date.now()+3_600_000).toISOString(),csrf_digest:createHash('sha256').update(Buffer.from(csrf,'base64url')).digest('hex')};
 const auth=createOperatorHandlers({policy:()=>policy,repository:()=>({validateSession:async()=>session}) as any,operatorKey:()=>session.operator_key,verifyPassword:async()=>false,balance:async()=>{throw new Error('Forbidden');}});
 runtime.handler=createGenuineWorkflowHandlers({guard:auth.guard,source:h.source,repository:h.repository});
 const headers={host:'fixture.invalid','x-forwarded-host':'fixture.invalid','x-forwarded-proto':'https',origin:'https://fixture.invalid','sec-fetch-site':'same-origin','sec-fetch-dest':'empty','x-vercel-forwarded-for':'192.0.2.1','Content-Type':'application/json','Idempotency-Key':CHILD};
 const context={params:Promise.resolve({id:h.id})};
 const call=(extra:Record<string,string>)=>dispositionPOST(new Request('https://fixture.invalid/api/disposition',{method:'POST',headers:{...headers,...extra},body:JSON.stringify(bodyFor(h))}),context);
 expect((await call({})).status).toBe(401);
 expect((await call({cookie:`__Host-tameion-session=${bearer}`,'X-Tameion-CSRF':Buffer.alloc(32,2).toString('base64url')})).status).toBe(403);
 expect(h.repository.compareAndSet).not.toHaveBeenCalled();expect(provider).not.toHaveBeenCalled();
 expect((await call({cookie:`__Host-tameion-session=${bearer}`,'X-Tameion-CSRF':csrf})).status).toBe(200);expect(provider).toHaveBeenCalledOnce();
});

it.each([LEGACY,OTHER])('real read/status UI confirms only the exact lawful child and preserves retained original %s',async retained=>{
 const h=harness(),provider=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));
 expect((await dispose(h)).status).toBe(200);expect(provider).toHaveBeenCalledOnce();
 runtime.handler=h.handler;
 const readers=createObligationReaders(h.guard,async(records,binding,_namespace,admission)=>loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:structuredClone(h.snapshot())})},h.state_binding.namespace,records,binding,admission),h.source,()=>undefined);
 const status=createGenuineAssessmentStatusHandler({guard:h.guard,source:h.source,repository:h.repository});
 vi.stubGlobal('crypto',webcrypto);localStorage.setItem(`tameion.assessment-request.${h.id}`,retained);
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),req=new Request('https://fixture.invalid'+url,init);
  if(url.endsWith('/advisory/status'))return status(req,h.id);
  if(url.endsWith('/testnet-instruction'))return draftPOST(req,{params:Promise.resolve({id:h.id})});
  if(init?.method==='POST')throw new Error('Unexpected mutation');
  return url==='/api/obligations'?readers.list(req):readers.detail(req,h.id);
 });vi.stubGlobal('fetch',fetcher);
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);
 const row=await waitFor(()=>{const row=document.querySelector<HTMLButtonElement>(`button[data-obligation-id="${h.id}"]`);expect(row).toBeTruthy();return row!;});fireEvent.click(row);
 fireEvent.click(await screen.findByRole('button',{name:'Confirm current disposition assessment'}));
 if(retained===OTHER){await waitFor(()=>expect(screen.getByRole('main').textContent).toMatch(/does not confirm|could not be verified|not confirm|not be checked/));expect(localStorage.getItem(`tameion.assessment-successor-ack.${h.id}`)).toBeNull();}
 else{
  await waitFor(()=>expect(localStorage.getItem(`tameion.assessment-successor-ack.${h.id}`)).toBe(CHILD));
  fireEvent.click(await screen.findByRole('button',{name:'Review assessment'}));
  const create=await screen.findByRole('button',{name:'Create linked testnet instruction'});fireEvent.click(create);
  await waitFor(()=>expect(h.snapshot().linked_settlement_instructions).toHaveLength(1));
  expect(h.snapshot().linked_settlement_instructions[0]).toMatchObject({assessment_id:`ASM-${CHILD}`,source_record_sha256:hash(h.records[0])});
 }
 expect(localStorage.getItem(`tameion.assessment-request.${h.id}`)).toBe(retained);
 const posts=fetcher.mock.calls.filter(([,init])=>init?.method==='POST');expect(posts.length).toBeGreaterThan(0);
 for(const [,init] of posts)expect((init!.headers as Record<string,string>)['X-Tameion-CSRF']).toBe('SYNTHETIC-CSRF');
 expect(h.snapshot().assessment_operations.find((o:any)=>o.idempotency_key===LEGACY).status).toBe('UNKNOWN');
 expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/advisory/status')).map(([,init])=>JSON.parse(String(init?.body)).idempotency_key)).toContain(retained);
});

it('UI explicitly dispatches the admitted disposition through its production route with a distinct stored key',async()=>{
 const h=harness(),provider=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));runtime.handler=h.handler;
 const readers=createObligationReaders(h.guard,async(records,binding,_namespace,admission)=>loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:structuredClone(h.snapshot())})},h.state_binding.namespace,records,binding,admission),h.source,()=>undefined);
 vi.stubGlobal('crypto',webcrypto);localStorage.setItem(`tameion.assessment-request.${h.id}`,LEGACY);
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input);if(url.startsWith('https://integrate.'))return provider();
  const req=new Request('https://fixture.invalid'+url,init);
  if(url.endsWith('/advisory/disposition'))return dispositionPOST(req,{params:Promise.resolve({id:h.id})});
  return url==='/api/obligations'?readers.list(req):readers.detail(req,h.id);
 });vi.stubGlobal('fetch',fetcher);
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);
 const row=await waitFor(()=>{const row=document.querySelector<HTMLButtonElement>(`button[data-obligation-id="${h.id}"]`);expect(row).toBeTruthy();return row!;});fireEvent.click(row);
 fireEvent.click(await screen.findByRole('button',{name:'Request admitted current-source disposition'}));
 await waitFor(()=>expect(h.snapshot().assessment_operations.some((o:any)=>o.legacy_disposition&&o.status==='COMPLETED')).toBe(true));
 const [,init]=fetcher.mock.calls.find(([url])=>String(url).endsWith('/advisory/disposition'))!;
 expect(JSON.parse(String(init?.body))).toMatchObject({disposition:'CURRENT_SOURCE_REASSESSMENT',predecessor_key:LEGACY});
 const key=(init!.headers as Record<string,string>)['Idempotency-Key'];expect(key).not.toBe(LEGACY);
 expect(localStorage.getItem(`tameion.assessment-successor.${h.id}`)).toBe(key);
 expect(localStorage.getItem(`tameion.assessment-request.${h.id}`)).toBe(LEGACY);expect(provider).toHaveBeenCalledOnce();
});
