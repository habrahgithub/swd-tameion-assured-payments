import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {canonicalize} from 'json-canonicalize';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {AuthorityStore} from '../src/authority/aggregate';
import {DemoState,type AssessmentOperation,type DemoStateSnapshot} from '../src/server/demo-state';
import {createGenuineAssessmentObservationHandler,projectGenuineAssessmentObservation} from '../src/server/genuine-assessment-observation';
import {createOperatorHandlers,csrfForBearer,type AuthContext} from '../src/server/operator-auth';
import {parseOperatorSource,type OperatorSourceView} from '../src/server/operator-source-records';
import {AccessError,digest,parseOperatorPolicy} from '../src/server/route-access-policy';
import {SupabaseDemoStateRepository} from '../src/server/supabase-demo-state-repository';
import * as route from '../app/api/obligations/[id]/advisory/diagnostic/route';
import {sealTestAssessment} from './test-support/seal-assessment';
import {syntheticSourceRecords} from './test-support/synthetic-source-records';

const gates=vi.hoisted(()=>({guard:vi.fn(),source:vi.fn()}));
vi.mock('../src/server/operator-auth',async original=>({...await original<typeof import('../src/server/operator-auth')>(),operatorHandlers:{guard:(...args:unknown[])=>gates.guard(...args)}}));
vi.mock('../src/server/operator-source-records',async original=>({...await original<typeof import('../src/server/operator-source-records')>(),loadOperatorSourceRecords:()=>gates.source()}));
vi.mock('@circle-fin/developer-controlled-wallets',()=>({initiateDeveloperControlledWalletsClient:()=>{throw new Error('Provider forbidden');}}));

const hash=(value:unknown)=>createHash('sha256').update(canonicalize(value)).digest('hex');
const key='00000000-0000-4000-8000-000000000091';
const otherKey='00000000-0000-4000-8000-000000000092';
const thirdKey='00000000-0000-4000-8000-000000000093';
const origin='https://operator.example.invalid';
const bearer=Buffer.alloc(32,4).toString('base64url');
const observedAt='2026-10-16T12:00:00.000Z';

function request(body:unknown={idempotency_key:key},headers:Record<string,string>={},method='POST'){
 return new Request(origin+'/api/obligations/FICTIONAL/advisory/diagnostic',{method,headers:{host:'operator.example.invalid','x-forwarded-host':'operator.example.invalid','x-forwarded-proto':'https',origin,'sec-fetch-site':'same-origin','sec-fetch-dest':'empty','x-vercel-forwarded-for':'192.0.2.1',cookie:`__Host-tameion-session=${bearer}`,'x-tameion-csrf':csrfForBearer(bearer),'content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
}

function harness(){
 const records=syntheticSourceRecords().map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...r}:any)=>({...r,source_evidence:r.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));
 let snapshot=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot(),revision=8,environment='preview';
 const {assessments,...base}=snapshot.authority;
 const packet={schema_version:3,record_count:records.length,provenance:'GENUINE_COMPANY_OBLIGATIONS',purpose:'GENUINE_ADVISORY_SOURCE',organization_id:'ORG-DEMO-001',state_binding:{namespace:'FICTIONAL-OBSERVATION',revision:7,authority_sha256:hash(snapshot.authority),workflow_base_sha256:hash(base)},records};
 const bytes=Buffer.from(JSON.stringify(packet));let view=parseOperatorSource(bytes,createHash('sha256').update(bytes).digest('hex'))!;
 const source=vi.fn(()=>view),revalidate=vi.fn(async()=>{}),guard=vi.fn(async()=>({revalidate} as unknown as AuthContext));
 const repository={loadExisting:vi.fn(async(_namespace:string)=>({revision,snapshot:structuredClone(snapshot) as unknown as Record<string,unknown>}))};
 const now=vi.fn(()=>new Date(observedAt));
 const handler=createGenuineAssessmentObservationHandler({guard,source,repository,environment:()=>environment,now});
 const id=records[0].obligation_id;
 const complete=(k=key,selected=id,version=1,sourceHash=hash(records.find(r=>r.obligation_id===selected)))=>{
  const store=AuthorityStore.fromSnapshot(snapshot.authority);
  const sealed=sealTestAssessment(store,'ORG-DEMO-001',selected,version,{assessment_id:`ASM-${k}`,source_record_sha256:sourceHash,decision:'HOLD'});
  snapshot.authority=store.exportSnapshot();snapshot.assessment_operations.push({idempotency_key:k,obligation_id:selected,aggregate_version:version,status:'COMPLETED',assessment_hash:sealed.assessment_hash});return sealed;
 };
 const unresolved=(status:AssessmentOperation['status'],k=otherKey,selected=id,version=1,sourceHash=hash(records.find(r=>r.obligation_id===selected)))=>{
  if(status==='PROVIDER_RESULT_DURABLE'){
   const sealed=complete(k,selected,version,sourceHash);snapshot.authority.assessments=[];snapshot.assessment_operations=[];
   snapshot.assessment_operations.push({idempotency_key:k,obligation_id:selected,aggregate_version:version,status,provider_result:sealed.record});return;
  }
  snapshot.assessment_operations.push({idempotency_key:k,obligation_id:selected,aggregate_version:version,status,...(status==='RESERVED'?{reserved_at:1}:{})});
 };
 return {records,id,source,revalidate,guard,repository,handler,complete,unresolved,snapshot:()=>snapshot,view:()=>view,setView:(next:OperatorSourceView|undefined)=>{view=next!;source.mockImplementation(()=>view);},setSnapshot:(next:DemoStateSnapshot)=>snapshot=next,setRevision:(next:number)=>revision=next,setEnvironment:(next:string)=>environment=next};
}

function guarded(){
 const expires_at=new Date(Date.now()+3600000).toISOString(),session={valid:true,operator_key:'FICTIONAL-OPERATOR',credential_version:1,expires_at,csrf_digest:digest(Buffer.from(csrfForBearer(bearer),'base64url'))};
 const authRepository={validateSession:vi.fn(async()=>session)};
 const policy=parseOperatorPolicy({TAMEION_ALLOWED_ORIGINS:JSON.stringify([origin]),TAMEION_INGRESS_MODE:'vercel-direct-v1',TAMEION_INGRESS_RECORD:JSON.stringify({approval_id:'FICTIONAL',project_id:'P',deployment_id:'D',environment:'preview',direct_edge:true,trusted_proxy_override:false,origins:[origin]}),TAMEION_THROTTLE_HMAC_KEY:'a'.repeat(64),VERCEL:'1',VERCEL_ENV:'preview',VERCEL_PROJECT_ID:'P',VERCEL_DEPLOYMENT_ID:'D'});
 const handlers=createOperatorHandlers({policy:()=>policy,repository:()=>authRepository as any,operatorKey:()=>session.operator_key,verifyPassword:async()=>{throw new Error('Password forbidden');},balance:async()=>{throw new Error('Wallet forbidden');}});
 return {guard:handlers.guard,authRepository,session};
}

let effects:Array<ReturnType<typeof vi.fn<()=>never>>>;
beforeEach(()=>{
 effects=[vi.fn(()=>{throw new Error('Network forbidden');}),vi.fn(()=>{throw new Error('CAS forbidden');}),vi.fn(()=>{throw new Error('Seed forbidden');})];
 vi.stubGlobal('fetch',effects[0]);vi.spyOn(SupabaseDemoStateRepository.prototype,'compareAndSet').mockImplementation(async()=>effects[1]() as never);vi.spyOn(SupabaseDemoStateRepository.prototype,'loadOrSeed').mockImplementation(async()=>effects[2]() as never);
});
afterEach(()=>{for(const effect of effects)expect(effect).not.toHaveBeenCalled();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe('temporary genuine assessment observation',()=>{
 it('keeps the diagnostic isolated from assessment, provider, payment, signing and mutation capabilities',()=>{
  const source=readFileSync(resolve(import.meta.dirname,'../src/server/genuine-assessment-observation.ts'),'utf8');
  expect(source).not.toMatch(/NvidiaProvider|Circle|wallet|compareAndSet|loadOrSeed|reconcile|sign|createTransaction|legacy-routes/);
 });

 it('reports exact K2 FOUND and a current unresolved SAME operation without exposing private identity',async()=>{
  const h=harness();h.unresolved('UNKNOWN',key);const before=structuredClone(h.snapshot());
  const response=await h.handler(request(),h.id),body=await response.json();
  expect(response.status).toBe(200);expect(body).toEqual({attempted_key_state:'FOUND',blocker_relation:'SAME',blocker_operation_status:'UNKNOWN',current_receipt_match:'FALSE',current_source_match:'UNVERIFIED',current_version_match:'TRUE',genuine_payable_history:'NONE',observed_at:observedAt});
  expect(JSON.stringify(body)).not.toContain(key);expect(JSON.stringify(body)).not.toContain(h.id);expect(h.repository.loadExisting).toHaveBeenCalledTimes(2);expect(h.snapshot()).toEqual(before);
 });

 it('reports exactly one source-bound current K1 as DIFFERENT_VERIFIED when K2 is absent',async()=>{
  const h=harness();h.unresolved('PROVIDER_RESULT_DURABLE');
  const body=await(await h.handler(request(),h.id)).json();
  expect(body).toEqual({attempted_key_state:'NOT_FOUND',blocker_relation:'DIFFERENT_VERIFIED',blocker_operation_status:'PROVIDER_RESULT_DURABLE',current_receipt_match:'FALSE',current_source_match:'TRUE',current_version_match:'TRUE',genuine_payable_history:'NONE',observed_at:observedAt});
 });

 it.each([
  ['unbound UNKNOWN','UNKNOWN',otherKey,1,undefined,'DIFFERENT_UNVERIFIED','UNVERIFIED','TRUE'],
  ['foreign source checkpoint','PROVIDER_RESULT_DURABLE',otherKey,1,'b'.repeat(64),'DIFFERENT_UNVERIFIED','FALSE','TRUE'],
  ['old aggregate UNKNOWN','UNKNOWN',otherKey,2,undefined,'DIFFERENT_UNVERIFIED','UNVERIFIED','FALSE'],
 ] as const)('does not forge DIFFERENT_VERIFIED for %s',async(_label,status,k,version,sourceHash,relation,sourceMatch,versionMatch)=>{
  const h=harness();h.unresolved(status,k,h.id,version,sourceHash);
  const body=await(await h.handler(request(),h.id)).json();expect(body).toMatchObject({attempted_key_state:'NOT_FOUND',blocker_relation:relation,current_source_match:sourceMatch,current_version_match:versionMatch});
 });

 it('ignores a foreign-payable operation and proves NONE only from the complete stable selected-payable snapshot',async()=>{
  const h=harness();h.unresolved('UNKNOWN',otherKey,h.records[1].obligation_id);
  expect(await(await h.handler(request(),h.id)).json()).toMatchObject({attempted_key_state:'NOT_FOUND',blocker_relation:'NONE',blocker_operation_status:'UNVERIFIED'});
 });

 it('returns AMBIGUOUS rather than selecting among multiple possible blockers',async()=>{
  const h=harness();h.unresolved('UNKNOWN');h.unresolved('RESERVED',thirdKey);
  expect(await(await h.handler(request(),h.id)).json()).toMatchObject({blocker_relation:'AMBIGUOUS',blocker_operation_status:'UNVERIFIED',current_source_match:'UNVERIFIED',current_version_match:'UNVERIFIED'});
 });

 it('distinguishes a current completed historical HOLD from a current unresolved operation',async()=>{
  const h=harness();h.complete(otherKey);h.unresolved('UNKNOWN',thirdKey);
  expect(await(await h.handler(request(),h.id)).json()).toMatchObject({attempted_key_state:'NOT_FOUND',blocker_relation:'DIFFERENT_UNVERIFIED',blocker_operation_status:'UNKNOWN'});
 });

 it('reports a current completed K2 receipt but never turns it into payment authority',async()=>{
  const h=harness();h.complete();
  expect(await(await h.handler(request(),h.id)).json()).toEqual({attempted_key_state:'FOUND',blocker_relation:'NONE',blocker_operation_status:'UNVERIFIED',current_receipt_match:'TRUE',current_source_match:'TRUE',current_version_match:'TRUE',genuine_payable_history:'NONE',observed_at:observedAt});
 });

 it('reports local genuine-payable financial-history presence without returning its records',async()=>{
  const h=harness();h.snapshot().authority.aggregates[0].state='AUTHORIZED';
  const body=projectGenuineAssessmentObservation(h.snapshot(),h.records[0],h.id,key,observedAt);
  expect(body.genuine_payable_history).toBe('PRESENT');expect(JSON.stringify(body)).not.toContain(h.id);
 });

 it('treats an exact key bound to another payable as unverified and ambiguous',async()=>{
  const h=harness();h.unresolved('UNKNOWN',key,h.records[1].obligation_id);
  expect(await(await h.handler(request(),h.id)).json()).toMatchObject({attempted_key_state:'UNVERIFIED',blocker_relation:'AMBIGUOUS'});
 });

 it.each([
  ['duplicate operations',(h:ReturnType<typeof harness>)=>{h.unresolved('UNKNOWN',key);h.snapshot().assessment_operations.push({...h.snapshot().assessment_operations[0]});}],
  ['uninitialized registry',(h:ReturnType<typeof harness>)=>{h.snapshot().actor_authority_registry_initialized=false;}],
  ['incomplete schema',(h:ReturnType<typeof harness>)=>{delete (h.snapshot() as any).trusted_keys;}],
  ['unresolved with a forged sealed receipt',(h:ReturnType<typeof harness>)=>{h.complete(key);h.snapshot().assessment_operations[0].status='UNKNOWN';delete h.snapshot().assessment_operations[0].assessment_hash;}],
 ] as const)('fails closed for malformed durable state: %s',async(_label,mutate)=>{
  const h=harness();mutate(h);const response=await h.handler(request(),h.id);expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'ASSESSMENT_OBSERVATION_UNAVAILABLE'});expect(h.repository.loadExisting).toHaveBeenCalledOnce();
 });

 it.each([{}, {idempotency_key:'bad'}, {idempotency_key:key,namespace:'foreign'}, {idempotency_key:key,actor:'owner'}, [], [key]])('rejects malformed or expanded input before source/state: %j',async body=>{
  const h=harness(),response=await h.handler(request(body),h.id);expect(response.status).toBe(400);expect(h.source).not.toHaveBeenCalled();expect(h.repository.loadExisting).not.toHaveBeenCalled();
 });

 it.each([
  ['oversized stream',request({idempotency_key:key,padding:'x'.repeat(300)}),413],
  ['oversized declaration',request({idempotency_key:key},{'content-length':'300'}),413],
  ['wrong content type',request({}, {'content-type':'text/plain'}),415],
 ] as const)('bounds %s before private source/state',async(_label,input,status)=>{
  const h=harness(),response=await h.handler(input,h.id);expect(response.status).toBe(status);expect(h.source).not.toHaveBeenCalled();expect(h.repository.loadExisting).not.toHaveBeenCalled();
 });

 it.each(['production','development',''])('refuses non-Preview identity before auth, source or state: %s',async environment=>{
  const h=harness();h.setEnvironment(environment);const response=await h.handler(request(),h.id);expect(response.status).toBe(403);expect(await response.json()).toEqual({code:'HOLD_ACCESS_PATH'});expect(h.guard).not.toHaveBeenCalled();expect(h.source).not.toHaveBeenCalled();expect(h.repository.loadExisting).not.toHaveBeenCalled();
 });

 it.each(['absent-source','legacy-source','withdrawn-payable'])('refuses %s authority before state',async variant=>{
  const h=harness();if(variant==='absent-source')h.setView(undefined);if(variant==='legacy-source'){const view=structuredClone(h.view());delete view.state_binding.workflow_base_sha256;h.setView(view);}
  const response=await h.handler(request(),variant==='withdrawn-payable'?'WITHDRAWN':h.id);expect([403,404]).toContain(response.status);expect(h.repository.loadExisting).not.toHaveBeenCalled();
 });

 it.each(['revision','authority','workflow-base','amount','currency'])('fails closed for %s source/state binding mismatch',async variant=>{
  const h=harness();
  if(variant==='revision')h.repository.loadExisting.mockResolvedValue({revision:6,snapshot:h.snapshot() as unknown as Record<string,unknown>});
  if(variant==='authority'){h.complete();h.repository.loadExisting.mockResolvedValue({revision:7,snapshot:h.snapshot() as unknown as Record<string,unknown>});}
  if(variant==='workflow-base'){const view=structuredClone(h.view());view.state_binding.workflow_base_sha256='b'.repeat(64);h.setView(view);}
  if(variant==='amount'||variant==='currency'){const view=structuredClone(h.view()),records=[...view.records];records[0]={...records[0],[variant]:variant==='amount'?'999.00':'EUR'};h.setView({...view,records});}
  const response=await h.handler(request(),h.id);expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'ASSESSMENT_OBSERVATION_UNAVAILABLE'});expect(h.repository.loadExisting).toHaveBeenCalledOnce();
 });

 it.each(['revision','snapshot','source-after-first','source-after-second','session-before-first','session-between','session-after-second','preview-drift'])('fails closed on %s drift with no retry',async variant=>{
  const h=harness();let reads=0,revalidations=0;
  h.repository.loadExisting.mockImplementation(async()=>{reads++;const result={revision:8,snapshot:structuredClone(h.snapshot()) as unknown as Record<string,any>};if(reads===2){if(variant==='revision')result.revision=9;if(variant==='snapshot')result.snapshot.assessment_operations.push({idempotency_key:otherKey,obligation_id:h.id,aggregate_version:1,status:'UNKNOWN'});}return result;});
  h.revalidate.mockImplementation(async()=>{revalidations++;if(variant==='session-before-first'&&revalidations===2||variant==='session-between'&&revalidations===3||variant==='session-after-second'&&revalidations===4)throw new AccessError('SESSION_REQUIRED',401);});
  const original=h.view();h.source.mockImplementation(()=>{if(variant==='source-after-first'&&reads===1||variant==='source-after-second'&&reads===2){const changed=structuredClone(original);changed.records[0].commercial_terms='Changed';return changed;}return original;});
  h.repository.loadExisting.mockImplementation(h.repository.loadExisting.getMockImplementation()!);
  if(variant==='preview-drift')h.repository.loadExisting.mockImplementation(async namespace=>{const result={revision:8,snapshot:structuredClone(h.snapshot()) as unknown as Record<string,unknown>};if(++reads===1)h.setEnvironment('production');return result;});
  const response=await h.handler(request(),h.id);expect([401,409]).toContain(response.status);expect(h.repository.loadExisting.mock.calls.length).toBeLessThanOrEqual(2);expect(await response.json()).not.toHaveProperty('blocker_relation');
 });

 it('masks an unavailable first read and never retries it',async()=>{
  const h=harness();h.repository.loadExisting.mockRejectedValue(new Error('PRIVATE BACKEND DETAILS'));const response=await h.handler(request(),h.id),text=await response.text();expect(response.status).toBe(503);expect(JSON.parse(text)).toEqual({code:'ASSESSMENT_OBSERVATION_UNAVAILABLE'});expect(h.repository.loadExisting).toHaveBeenCalledOnce();expect(text).not.toContain('PRIVATE');
 });

 it('uses the real repository adapter for exactly two allowed read-only RPCs',async()=>{
  const h=harness(),calls:Array<{url:string;init:RequestInit}> = [];
  const fetcher=vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{calls.push({url:String(input),init:init!});return new Response(JSON.stringify({revision:8,snapshot:structuredClone(h.snapshot())}),{status:200,headers:{'content-type':'application/json'}});});
  const repository=new SupabaseDemoStateRepository('https://fixture.invalid/','FICTIONAL-SECRET',fetcher as typeof fetch);
  const handler=createGenuineAssessmentObservationHandler({guard:h.guard,source:h.source,repository,environment:()=> 'preview',now:()=>new Date(observedAt)});
  expect((await handler(request(),h.id)).status).toBe(200);expect(fetcher).toHaveBeenCalledTimes(2);
  for(const call of calls){expect(call.url).toBe('https://fixture.invalid/rest/v1/rpc/tameion_state_load_existing');expect(call.init).toMatchObject({method:'POST',cache:'no-store',redirect:'error',body:JSON.stringify({p_namespace:h.view().state_binding.namespace,p_expected_schema_version:2})});}
 });

 it.each(['incomplete','oversized','hanging'] as const)('fails closed after one %s real-adapter response without another RPC',async variant=>{
  const h=harness(),controller=new AbortController();vi.spyOn(AbortSignal,'timeout').mockReturnValue(controller.signal);
  const fetcher=vi.fn(async(_input:string|URL|Request,init?:RequestInit)=>{
   if(variant==='incomplete')return new Response(JSON.stringify({revision:8,snapshot:{}}),{status:200});
   if(variant==='oversized')return new Response('x'.repeat(2_097_153),{status:200});
   return await new Promise<Response>((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true}));
  });
  const repository=new SupabaseDemoStateRepository('https://fixture.invalid','FICTIONAL-SECRET',fetcher as typeof fetch),handler=createGenuineAssessmentObservationHandler({guard:h.guard,source:h.source,repository,environment:()=> 'preview',now:()=>new Date(observedAt)});
  const pending=handler(request(),h.id);if(variant==='hanging'){for(let i=0;i<20&&fetcher.mock.calls.length===0;i++)await Promise.resolve();expect(fetcher).toHaveBeenCalledOnce();controller.abort();}
  const response=await pending;expect(response.status).toBe(503);expect(await response.json()).toEqual({code:'ASSESSMENT_OBSERVATION_UNAVAILABLE'});expect(fetcher).toHaveBeenCalledOnce();
 });

 it('runs through the production route guard, revalidates around both reads and returns only the finite schema',async()=>{
  const h=harness(),g=guarded();h.unresolved('PROVIDER_RESULT_DURABLE');gates.guard.mockImplementation(g.guard);gates.source.mockImplementation(h.source);
  vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('SUPABASE_URL','https://fixture.invalid');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','FICTIONAL-ONLY');
  const reads=vi.spyOn(SupabaseDemoStateRepository.prototype,'loadExisting').mockImplementation(h.repository.loadExisting);
  const response=await route.POST(request(),{params:Promise.resolve({id:h.id})}),body=await response.json();expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('pragma')).toBe('no-cache');
  expect(Object.keys(body).sort()).toEqual(['attempted_key_state','blocker_operation_status','blocker_relation','current_receipt_match','current_source_match','current_version_match','genuine_payable_history','observed_at']);expect(reads).toHaveBeenCalledTimes(2);expect(g.authRepository.validateSession).toHaveBeenCalledTimes(5);
 });

 it.each(['no-cookie','revoked','csrf','origin','deployment'])('production route denies %s before source/state',async variant=>{
  const h=harness(),g=guarded(),headers:Record<string,string>={};vi.stubEnv('VERCEL_ENV','preview');
  if(variant==='no-cookie')headers.cookie='';if(variant==='revoked')g.authRepository.validateSession.mockResolvedValue({...g.session,valid:false});if(variant==='csrf')headers['x-tameion-csrf']='bad';if(variant==='origin')headers.origin='https://foreign.invalid';
  gates.guard.mockImplementation(variant==='deployment'?async()=>{throw new AccessError('AUTH_UNAVAILABLE',503);}:g.guard);gates.source.mockImplementation(h.source);
  const read=vi.spyOn(SupabaseDemoStateRepository.prototype,'loadExisting'),response=await route.POST(request(undefined,headers),{params:Promise.resolve({id:h.id})});expect([401,403,503]).toContain(response.status);expect(h.source).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
 });

 it.each(['GET','HEAD','OPTIONS','PUT','PATCH','DELETE'] as const)('explicitly denies %s without auth, source or state',async method=>{
  gates.guard.mockClear();gates.source.mockClear();const read=vi.spyOn(SupabaseDemoStateRepository.prototype,'loadExisting'),response=await route[method]();expect(response.status).toBe(405);expect(response.headers.get('cache-control')).toContain('no-store');expect(gates.guard).not.toHaveBeenCalled();expect(gates.source).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
 });

 it('contains a negative oracle that rejects a forged NONE or DIFFERENT_VERIFIED projection',async()=>{
  const h=harness();h.unresolved('UNKNOWN');const actual=await(await h.handler(request(),h.id)).json();
  const oracle=(value:Record<string,unknown>)=>expect(value).toMatchObject({attempted_key_state:'NOT_FOUND',blocker_relation:'DIFFERENT_UNVERIFIED',blocker_operation_status:'UNKNOWN',current_source_match:'UNVERIFIED',current_version_match:'TRUE'});
  oracle(actual);expect(()=>oracle({...actual,blocker_relation:'NONE'})).toThrow();expect(()=>oracle({...actual,blocker_relation:'DIFFERENT_VERIFIED'})).toThrow();
 });
});
