/** @vitest-environment jsdom */
import {afterEach,expect,it,vi} from 'vitest';
import {cleanup,render,screen,fireEvent,waitFor,act} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {CommandCenter} from '../app/command-center';
import {controlledHarness,preparedApproval,cleanupSyntheticFinancialFixture} from './test-support/financial-fixture';
import {harness as genuineFixture} from './test-support/disposition-fixture';
import {loadFinancialSourceAdmission,loadFinancialRequesterBinding,loadFinancialSourceAdmissionForReconcile,loadFinancialRequesterBindingForReconcile,loadOptionalFinancialSourceAdmission} from '../src/server/financial-source-admission';
import {createFinancialHandlers} from '../src/server/operator-financial-routes';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
import {POST as reconcilePOST} from '../app/api/obligations/[id]/reconcile/route';
import {AccessError} from '../src/server/route-access-policy';
const runtime=vi.hoisted(()=>({handler:null as any}));
vi.mock('../src/server/operator-financial-routes',async original=>({...await original<typeof import('../src/server/operator-financial-routes')>(),financialHandlers:(...args:any[])=>runtime.handler(...args)}));
vi.unmock('../src/server/source-records');
afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();localStorage.clear();cleanupSyntheticFinancialFixture();});

async function uncertain(status:'UNKNOWN'|'SUBMITTING'='UNKNOWN',production=false){
 vi.stubEnv('CIRCLE_API_KEY','SYNTHETIC-NETWORK-DENIED');vi.stubEnv('CIRCLE_ENTITY_SECRET','SYNTHETIC-NETWORK-DENIED');
 const parent=genuineFixture();
 const h=controlledHarness({production,lostResponse:true,linkedDraft:{instruction_id:'TESTNET-CONTROLLED-LINKED-'+'c'.repeat(32),source_obligation_id:parent.id,instruction_content_sha256:'d'.repeat(64)}}),p=await preparedApproval(h);
 const sent=await h.handler('execute',h.request(p.body),p.id);expect(sent.status).toBe(202);expect(h.client.createTransaction).toHaveBeenCalledOnce();
 if(status==='SUBMITTING')h.snapshot().execution_ledger[0]!.status='SUBMITTING';
 const identity={idempotency_key:h.snapshot().execution_ledger[0]!.idempotency_key,pae_instruction_hash:p.a.pae_instruction_hash};
 const funding=vi.fn(async()=>{throw new Error('New funding forbidden');});
 const action=createFinancialHandlers({guard:async(req)=>{if(req.headers.get('X-Tameion-CSRF')!=='SYNTHETIC-CSRF')throw new AccessError('CSRF_REJECTED',403);return h.auth;},source:loadFinancialSourceAdmission,requester:loadFinancialRequesterBinding,reconcileSource:loadFinancialSourceAdmissionForReconcile,reconcileRequester:loadFinancialRequesterBindingForReconcile,load:h.load,providerBoundary:funding});
 const request=(body=identity)=>{const req=h.request(body);req.headers.set('X-Tameion-CSRF','SYNTHETIC-CSRF');return req;};
 const readers=createObligationReaders(async()=>h.auth,async(records,binding,namespace,admission)=>{
  const isControlled=namespace===h.source.namespace;
  return loadExistingDemoState({call:async()=>({revision:isControlled?h.revision():parent.revision(),snapshot:structuredClone(isControlled?h.snapshot():parent.snapshot())})},namespace??parent.state_binding.namespace,records,binding,admission);
 },parent.source,loadOptionalFinancialSourceAdmission);
 return {h,p,parent,identity,action,request,readers,funding};
}

it.each(['UNKNOWN','SUBMITTING'] as const)('real expired loaders -> read projection -> UI exact CSRF POST -> durable reconciliation for %s',async status=>{
 const {h,p,parent,identity,action,readers,funding}=await uncertain(status),parentBefore=structuredClone(parent.snapshot());
 vi.spyOn(Date,'now').mockReturnValue(Date.parse(h.source.expires_at));
 expect(()=>loadFinancialSourceAdmission()).toThrow();expect(()=>loadFinancialRequesterBinding()).toThrow();
 expect(loadFinancialSourceAdmissionForReconcile().source.obligation_id).toBe(p.id);expect(loadFinancialRequesterBindingForReconcile().actor_id).toBe(h.requester.actor_id);
 const providerReads=vi.mocked(h.client.getTransaction).mock.calls.length+vi.mocked(h.client.listTransactions).mock.calls.length,writes=vi.mocked(h.repo.compareAndSet).mock.calls.length;
 const projected=await readers.detail(new Request('https://fixture.invalid'),p.id);expect(projected.status).toBe(200);expect(await projected.json()).toMatchObject({financial_action_eligible:false,execution:{status}});
 expect(vi.mocked(h.client.getTransaction).mock.calls.length+vi.mocked(h.client.listTransactions).mock.calls.length).toBe(providerReads);expect(vi.mocked(h.repo.compareAndSet).mock.calls.length).toBe(writes);
 runtime.handler=action;vi.stubGlobal('crypto',webcrypto);
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),req=new Request('https://fixture.invalid'+url,init);
  if(url.endsWith('/reconcile'))return reconcilePOST(req,{params:Promise.resolve({id:p.id})});
  if(init?.method==='POST')throw new Error('New action forbidden');
  return url==='/api/obligations'?readers.list(req):readers.detail(req,decodeURIComponent(url.split('/').at(-1)!));
 });vi.stubGlobal('fetch',fetcher);
 render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);
 const row=await waitFor(()=>{const r=document.querySelector<HTMLButtonElement>(`button[data-obligation-id="${p.id}"]`);expect(r).toBeTruthy();return r!;});fireEvent.click(row);
 const reconcile=await screen.findByRole('button',{name:'Reconcile this same intent'});expect((reconcile as HTMLButtonElement).disabled).toBe(false);fireEvent.click(reconcile);
 await waitFor(()=>expect(screen.getByRole('main').textContent).toContain('Durable readback confirms this same instruction is reconciled'));
 const posts=fetcher.mock.calls.filter(([,init])=>init?.method==='POST');expect(posts).toHaveLength(1);expect(String(posts[0][0])).toBe(`/api/obligations/${p.id}/reconcile`);expect(JSON.parse(String(posts[0][1]?.body))).toEqual(identity);expect((posts[0][1]!.headers as Record<string,string>)['X-Tameion-CSRF']).toBe('SYNTHETIC-CSRF');
 expect(h.snapshot().authority.aggregates[0]).toMatchObject({state:'RECONCILED'});expect(h.client.createTransaction).toHaveBeenCalledOnce();expect(funding).not.toHaveBeenCalled();expect(parent.snapshot()).toEqual(parentBefore);
 const genuine=await(await readers.detail(new Request('https://fixture.invalid'),parent.id)).json();expect(genuine.source_payable_state).toBe('OUTSTANDING');
});

it('permits ACTIVE -> EXPIRED during final provider status await for the same existing execution',async()=>{
 const {h,p,action,request,identity}=await uncertain();
 const get=vi.mocked(h.client.getTransaction).getMockImplementation()!;
 let release!:()=>void,entered!:()=>void;const waiting=new Promise<void>(r=>entered=r);
 vi.mocked(h.client.getTransaction).mockImplementation(async args=>{entered();await new Promise<void>(r=>release=r);return get(args);});
 const pending=action('reconcile',request(),p.id);await waiting;vi.spyOn(Date,'now').mockReturnValue(Date.parse(h.source.expires_at));release();
 expect(await(await pending).json()).toMatchObject({code:'RECONCILED',execution:{status:'SETTLED',idempotency_key:identity.idempotency_key}});expect(h.client.createTransaction).toHaveBeenCalledOnce();
});

it('denies FUTURE before provider and preserves the existing UNKNOWN',async()=>{
 const {h,p,action,request}=await uncertain(),before=structuredClone(h.snapshot());
 vi.spyOn(Date,'now').mockReturnValue(Date.parse(h.source.valid_from)-1);vi.mocked(h.client.getTransaction).mockClear();vi.mocked(h.client.listTransactions).mockClear();
 expect((await action('reconcile',request(),p.id)).status).toBe(503);expect(h.client.getTransaction).not.toHaveBeenCalled();expect(h.client.listTransactions).not.toHaveBeenCalled();expect(h.snapshot()).toEqual(before);expect(h.client.createTransaction).toHaveBeenCalledOnce();
});

it.each(['session','credential','actor','source','requester','namespace','deployment'])('refuses %s drift during final getTransaction, then allows a same-identity retry without submit',async fault=>{
 const {h,p,action,request}=await uncertain();
 const before=structuredClone(h.snapshot()),get=vi.mocked(h.client.getTransaction).getMockImplementation()!;
 const {writeFileSync}=await import('node:fs'),{join}=await import('node:path'),{directory}=await import('./test-support/financial-fixture'),{createHash}=await import('node:crypto');
 const sourceBytes=JSON.stringify(h.source),requesterBytes=JSON.stringify(h.requester),sourceHash=process.env.TAMEION_FINANCIAL_SOURCE_SHA256!,requesterHash=process.env.TAMEION_FINANCIAL_REQUESTER_SHA256!;
 const revalidate=h.auth.revalidate;
 vi.mocked(h.client.getTransaction).mockImplementationOnce(async args=>{
  const result=await get(args);
  if(fault==='session'||fault==='credential')vi.mocked(h.auth.revalidate).mockRejectedValue(new AccessError('SESSION_REQUIRED',401));
  else if(fault==='actor')h.snapshot().actor_authorities[0].status='REVOKED';
  else if(fault==='deployment')vi.stubEnv('VERCEL_DEPLOYMENT_ID','SYNTHETIC-DRIFT');
  else{
   const requester=fault==='requester',packet:any=structuredClone(requester?h.requester:h.source);
   if(fault==='namespace')packet.namespace='SYNTHETIC-OTHER';else packet.approval_id='SYNTHETIC-CHANGED';
   const bytes=JSON.stringify(packet);writeFileSync(join(directory!,`.tameion/financial-${requester?'requester':'source'}.json`),bytes);vi.stubEnv(requester?'TAMEION_FINANCIAL_REQUESTER_SHA256':'TAMEION_FINANCIAL_SOURCE_SHA256',createHash('sha256').update(bytes).digest('hex'));
  }return result;
 });
 expect((await action('reconcile',request(),p.id)).status).toBe(503);expect(h.snapshot().execution_ledger).toEqual(before.execution_ledger);expect(h.snapshot().authority).toEqual(before.authority);expect(h.client.createTransaction).toHaveBeenCalledOnce();
 // Restore synthetic authority to prove a retry of the exact recorded identity is status-only.
 vi.mocked(revalidate).mockResolvedValue();h.snapshot().actor_authorities=before.actor_authorities;vi.stubEnv('VERCEL_DEPLOYMENT_ID',h.source.deployment_id!);writeFileSync(join(directory!,'.tameion/financial-source.json'),sourceBytes);writeFileSync(join(directory!,'.tameion/financial-requester.json'),requesterBytes);vi.stubEnv('TAMEION_FINANCIAL_SOURCE_SHA256',sourceHash);vi.stubEnv('TAMEION_FINANCIAL_REQUESTER_SHA256',requesterHash);
 expect((await action('reconcile',request(),p.id)).status).toBe(200);expect(h.snapshot().execution_ledger[0]!.status).toBe('SETTLED');expect(h.client.createTransaction).toHaveBeenCalledOnce();
});

it.each(['missing-evidence','contradiction','wrong-key','wrong-hash','wrong-record','wrong-aggregate'])('UI refuses settlement success from a %s durable readback',async fault=>{
 const {h,p,action,readers}=await uncertain();vi.spyOn(Date,'now').mockReturnValue(Date.parse(h.source.expires_at));runtime.handler=action;vi.stubGlobal('crypto',webcrypto);
 let posted=false;
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),req=new Request('https://fixture.invalid'+url,init);
  if(url.endsWith('/reconcile')){const response=await reconcilePOST(req,{params:Promise.resolve({id:p.id})});posted=true;return response;}
  const response=url==='/api/obligations'?await readers.list(req):await readers.detail(req,decodeURIComponent(url.split('/').at(-1)!));
  if(posted&&url.endsWith(p.id)&&response.ok){
   const d=await response.json();
   if(fault==='missing-evidence')d.execution.provider_evidence=null;
   if(fault==='contradiction')d.execution.provider_evidence.atomic_amount='999999';
   if(fault==='wrong-key')d.execution.idempotency_key='SYNTHETIC-WRONG-KEY';
   if(fault==='wrong-hash')d.sealed_pae_instruction_hash='f'.repeat(64);
   if(fault==='wrong-record')d.execution.obligation_id='SYNTHETIC-OTHER';
   if(fault==='wrong-aggregate')d.aggregate.state='AUTHORIZED';
   return Response.json(d);
  }return response;
 });vi.stubGlobal('fetch',fetcher);render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);
 const row=await waitFor(()=>{const r=document.querySelector<HTMLButtonElement>(`button[data-obligation-id="${p.id}"]`);expect(r).toBeTruthy();return r!;});fireEvent.click(row);
 fireEvent.click(await screen.findByRole('button',{name:'Reconcile this same intent'}));
 await waitFor(()=>expect(screen.getByRole('main').textContent).toContain('Durable readback shows the settlement outcome is still not confirmed'));
 expect(screen.getByRole('main').textContent).not.toContain('Durable readback confirms this same instruction is reconciled');expect(h.client.createTransaction).toHaveBeenCalledOnce();
});

it('A -> B -> A cannot accept an old reconciliation response for a new selection generation',async()=>{
 const {h,p,parent,action,readers}=await uncertain();vi.spyOn(Date,'now').mockReturnValue(Date.parse(h.source.expires_at));runtime.handler=action;vi.stubGlobal('crypto',webcrypto);
 let release!:()=>void;let pending:Promise<Response>|undefined;
 const fetcher=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
  const url=String(input),req=new Request('https://fixture.invalid'+url,init);
  if(url.endsWith('/reconcile')){await new Promise<void>(r=>release=r);pending=reconcilePOST(req,{params:Promise.resolve({id:p.id})});return pending;}
  return url==='/api/obligations'?readers.list(req):readers.detail(req,decodeURIComponent(url.split('/').at(-1)!));
 });vi.stubGlobal('fetch',fetcher);render(<CommandCenter csrfToken="SYNTHETIC-CSRF"/>);
 const row=async(id:string)=>waitFor(()=>{const r=document.querySelector<HTMLButtonElement>(`button[data-obligation-id="${id}"]`);expect(r).toBeTruthy();return r!;});
 fireEvent.click(await row(p.id));fireEvent.click(await screen.findByRole('button',{name:'Reconcile this same intent'}));await waitFor(()=>expect(release).toBeTypeOf('function'));
 fireEvent.click(await row(parent.id));fireEvent.click(await row(p.id));
 await screen.findByRole('button',{name:'Reconcile this same intent'});
 await act(async()=>{release();for(let i=0;i<5;i++)await Promise.resolve();await pending;});
 expect(h.snapshot().execution_ledger[0]!.status).toBe('SETTLED');expect(screen.getByRole('main').textContent).not.toContain('Durable readback confirms this same instruction is reconciled');expect(h.client.createTransaction).toHaveBeenCalledOnce();
});

it.each(['runtime-config','ingress'])('real production authority refuses %s drift during getTransaction without durable finalization',async fault=>{
 const {h,p,action,request}=await uncertain('UNKNOWN',true),before=structuredClone(h.snapshot()),get=vi.mocked(h.client.getTransaction).getMockImplementation()!;
 const old=process.env[fault==='runtime-config'?'SUPABASE_URL':'TAMEION_INGRESS_RECORD']!;
 vi.mocked(h.client.getTransaction).mockImplementationOnce(async args=>{const result=await get(args);vi.stubEnv(fault==='runtime-config'?'SUPABASE_URL':'TAMEION_INGRESS_RECORD',fault==='runtime-config'?'https://drift.example.invalid':JSON.stringify({...JSON.parse(old),approval_id:'SYNTHETIC-DRIFT'}));return result;});
 expect((await action('reconcile',request(),p.id)).status).toBe(503);expect(h.snapshot().execution_ledger).toEqual(before.execution_ledger);expect(h.snapshot().authority).toEqual(before.authority);expect(h.client.createTransaction).toHaveBeenCalledOnce();
 vi.stubEnv(fault==='runtime-config'?'SUPABASE_URL':'TAMEION_INGRESS_RECORD',old);expect((await action('reconcile',request(),p.id)).status).toBe(200);expect(h.client.createTransaction).toHaveBeenCalledOnce();
});

it.each(['session','credential','actor','source','requester','namespace','deployment','runtime-config','ingress'])('refuses %s drift at the final pre-persist validation and rolls back in-memory settlement',async fault=>{
 const {h,p,action,request,identity}=await uncertain('UNKNOWN',fault==='runtime-config'||fault==='ingress'),before=structuredClone(h.snapshot()),original=vi.mocked(h.auth.revalidate).getMockImplementation()!;
 const {writeFileSync}=await import('node:fs'),{join}=await import('node:path'),{directory}=await import('./test-support/financial-fixture'),{createHash}=await import('node:crypto');
 const originalLoad=h.load.getMockImplementation()!;let executionState:Awaited<ReturnType<typeof originalLoad>>|undefined;
 h.load.mockImplementation(async(...args)=>{const loaded=await originalLoad(...args);executionState??=loaded;return loaded;});
 let injected=false;
 vi.mocked(h.auth.revalidate).mockImplementation(async()=>{
  // This condition becomes true only after finalizeFromStatus has computed SETTLED,
  // inside the worker's final awaited validation BEFORE its durable state callback.
  if(!injected&&executionState?.worker.getExecutionRecord(identity.idempotency_key)?.status==='SETTLED'){
   injected=true;
   if(fault==='session'||fault==='credential')throw new AccessError('SESSION_REQUIRED',401);
   if(fault==='actor')h.snapshot().actor_authorities[0].status='REVOKED';
   else if(fault==='deployment')vi.stubEnv('VERCEL_DEPLOYMENT_ID','SYNTHETIC-DRIFT');
   else if(fault==='runtime-config')vi.stubEnv('SUPABASE_URL','https://drift.example.invalid');
   else if(fault==='ingress')vi.stubEnv('TAMEION_INGRESS_RECORD',JSON.stringify({...JSON.parse(process.env.TAMEION_INGRESS_RECORD!),approval_id:'SYNTHETIC-DRIFT'}));
   else{
    const requester=fault==='requester',packet:any=structuredClone(requester?h.requester:h.source);
    if(fault==='namespace')packet.namespace='SYNTHETIC-OTHER';else packet.approval_id='SYNTHETIC-CHANGED';
    const bytes=JSON.stringify(packet);writeFileSync(join(directory!,`.tameion/financial-${requester?'requester':'source'}.json`),bytes);vi.stubEnv(requester?'TAMEION_FINANCIAL_REQUESTER_SHA256':'TAMEION_FINANCIAL_SOURCE_SHA256',createHash('sha256').update(bytes).digest('hex'));
   }
  }await original();
 });
 const writes=vi.mocked(h.repo.compareAndSet).mock.calls.length;
 expect((await action('reconcile',request(),p.id)).status).toBe(503);expect(injected).toBe(true);
 expect(vi.mocked(h.repo.compareAndSet).mock.calls.length).toBe(writes);expect(h.snapshot().execution_ledger).toEqual(before.execution_ledger);expect(h.snapshot().authority).toEqual(before.authority);
 expect(executionState!.worker.getExecutionRecord(identity.idempotency_key)?.status).toBe('UNKNOWN');expect(executionState!.store.get('ORG-DEMO-001',p.id).state).toBe(before.authority.aggregates[0].state);expect(h.client.createTransaction).toHaveBeenCalledOnce();
});

it.each(['wrong-key','wrong-hash','wrong-obligation','missing-execution'])('actual expired recovery refuses %s before provider',async fault=>{
 const {h,p,action,request,identity}=await uncertain();vi.spyOn(Date,'now').mockReturnValue(Date.parse(h.source.expires_at));
 if(fault==='missing-execution')h.snapshot().execution_ledger=[];
 const before=structuredClone(h.snapshot());vi.mocked(h.client.getTransaction).mockClear();vi.mocked(h.client.listTransactions).mockClear();
 const input={...identity,...(fault==='wrong-key'?{idempotency_key:'SYNTHETIC-WRONG'}:fault==='wrong-hash'?{pae_instruction_hash:'f'.repeat(64)}:{})};
 expect((await action('reconcile',request(input),fault==='wrong-obligation'?'TESTNET-CONTROLLED-OTHER':p.id)).status).toBeGreaterThanOrEqual(400);
 expect(h.client.getTransaction).not.toHaveBeenCalled();expect(h.client.listTransactions).not.toHaveBeenCalled();expect(h.snapshot()).toEqual(before);expect(h.client.createTransaction).toHaveBeenCalledOnce();
});

it('expired provider-confirmed CAS conflict stays UNKNOWN, then same-identity retry reconciles with zero extra submit',async()=>{
 const {h,p,action,request}=await uncertain();vi.spyOn(Date,'now').mockReturnValue(Date.parse(h.source.expires_at));
 const before=structuredClone(h.snapshot()),{DemoStateConflictError}=await import('../src/server/supabase-demo-state-repository');
 vi.mocked(h.repo.compareAndSet).mockRejectedValueOnce(new DemoStateConflictError());
 expect((await action('reconcile',request(),p.id)).status).toBe(503);expect(h.snapshot()).toEqual(before);expect(h.client.getTransaction).toHaveBeenCalled();expect(h.client.createTransaction).toHaveBeenCalledOnce();
 expect(await(await action('reconcile',request(),p.id)).json()).toMatchObject({code:'RECONCILED',execution:{status:'SETTLED'}});expect(h.client.createTransaction).toHaveBeenCalledOnce();
});
