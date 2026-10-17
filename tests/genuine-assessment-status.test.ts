import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {DemoState,type DemoStateSnapshot} from '../src/server/demo-state';
import {AuthorityStore} from '../src/authority/aggregate';
import {parseOperatorSource,type OperatorSourceView} from '../src/server/operator-source-records';
import {AccessError,parseOperatorPolicy,digest} from '../src/server/route-access-policy';
import {createOperatorHandlers,csrfForBearer,type AuthContext} from '../src/server/operator-auth';
import {SupabaseDemoStateRepository} from '../src/server/supabase-demo-state-repository';
import {createGenuineAssessmentStatusHandler} from '../src/server/genuine-assessment-status';
import * as route from '../app/api/obligations/[id]/advisory/status/route';
import {syntheticSourceRecords} from './test-support/synthetic-source-records';
import {sealTestAssessment} from './test-support/seal-assessment';

const gates=vi.hoisted(()=>({guard:vi.fn(),source:vi.fn()}));
vi.mock('../src/server/operator-auth',async original=>({...await original<typeof import('../src/server/operator-auth')>(),operatorHandlers:{guard:(...args:unknown[])=>gates.guard(...args)}}));
vi.mock('../src/server/operator-source-records',async original=>({...await original<typeof import('../src/server/operator-source-records')>(),loadOperatorSourceRecords:()=>gates.source()}));
vi.mock('@circle-fin/developer-controlled-wallets',()=>({initiateDeveloperControlledWalletsClient:()=>{throw new Error('Provider forbidden');}}));
const hash=(value:unknown)=>createHash('sha256').update(canonicalize(value)).digest('hex');
const key='00000000-0000-4000-8000-000000000091',otherKey='00000000-0000-4000-8000-000000000092';
const origin='https://operator.example.invalid',bearer=Buffer.alloc(32,4).toString('base64url');
function request(body:unknown={idempotency_key:key},headers:Record<string,string>={},method='POST'){
 return new Request(origin+'/api/obligations/FICTIONAL/advisory/status',{method,headers:{host:'operator.example.invalid','x-forwarded-host':'operator.example.invalid','x-forwarded-proto':'https',origin,'sec-fetch-site':'same-origin','sec-fetch-dest':'empty','x-vercel-forwarded-for':'192.0.2.1',cookie:`__Host-tameion-session=${bearer}`,'x-tameion-csrf':csrfForBearer(bearer),'content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
}
function harness(){
 const records=syntheticSourceRecords().map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...r}:any)=>({...r,source_evidence:r.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));
 let snapshot=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot(),revision=8;
 const {assessments,...base}=snapshot.authority;
 const packet={schema_version:3,record_count:records.length,provenance:'GENUINE_COMPANY_OBLIGATIONS',purpose:'GENUINE_ADVISORY_SOURCE',organization_id:'ORG-DEMO-001',state_binding:{namespace:'FICTIONAL-EXACT-STATUS',revision:7,authority_sha256:hash(snapshot.authority),workflow_base_sha256:hash(base)},records};
 const bytes=Buffer.from(JSON.stringify(packet));let view=parseOperatorSource(bytes,createHash('sha256').update(bytes).digest('hex'))!;
 const source=vi.fn(()=>view),revalidate=vi.fn(async()=>{}),guard=vi.fn(async()=>({revalidate} as unknown as AuthContext));
 const repository={loadExisting:vi.fn(async(_namespace:string)=>({revision,snapshot:structuredClone(snapshot) as unknown as Record<string,unknown>}))};
 const handler=createGenuineAssessmentStatusHandler({guard,source,repository}),id=records[0].obligation_id;
 const complete=(k=key,selected=id,version=1,sourceHash=hash(records.find(r=>r.obligation_id===selected)))=>{
  const store=AuthorityStore.fromSnapshot(snapshot.authority);
  const sealed=sealTestAssessment(store,'ORG-DEMO-001',selected,version,{assessment_id:`ASM-${k}`,source_record_sha256:sourceHash,decision:'HOLD'});
  snapshot.authority=store.exportSnapshot();snapshot.assessment_operations.push({idempotency_key:k,obligation_id:selected,aggregate_version:version,status:'COMPLETED',assessment_hash:sealed.assessment_hash});return sealed;
 };
 return {records,id,source,guard,revalidate,repository,handler,complete,snapshot:()=>snapshot,view:()=>view,setView:(v:OperatorSourceView|undefined)=>{view=v!;source.mockImplementation(()=>view);},setSnapshot:(s:DemoStateSnapshot)=>snapshot=s,setRevision:(r:number)=>revision=r};
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
describe('genuine assessment exact status',()=>{
 it('exposes the dedicated private status route rather than replaying advisory assessment',()=>expect(existsSync(resolve(import.meta.dirname,'../app/api/obligations/[id]/advisory/status/route.ts'))).toBe(true));
 it('returns the exact sealed current receipt through the production route and real guard with only existing-state reads',async()=>{
  const h=harness(),g=guarded(),sealed=h.complete(),before=structuredClone(h.snapshot());
  gates.guard.mockImplementation(g.guard);gates.source.mockImplementation(h.source);
  vi.stubEnv('SUPABASE_URL','https://fixture.invalid');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','FICTIONAL-ONLY');
  const reads=vi.spyOn(SupabaseDemoStateRepository.prototype,'loadExisting').mockImplementation(h.repository.loadExisting);
  const r=await route.POST(request(),{params:Promise.resolve({id:h.id})});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toContain('no-store');
  expect(await r.json()).toEqual({status:'COMPLETED_CURRENT',obligation_id:h.id,idempotency_key:key,aggregate_version:'1',source_record_sha256:hash(h.records[0]),financial_action_eligible:false,receipt:{assessment_id:`ASM-${key}`,assessment_hash:sealed.assessment_hash,aggregate_version:'1'}});
  expect(reads).toHaveBeenCalledTimes(2);expect(reads.mock.calls).toEqual([[h.view().state_binding.namespace],[h.view().state_binding.namespace]]);expect(g.authRepository.validateSession).toHaveBeenCalledTimes(5);expect(h.snapshot()).toEqual(before);
 });
 it.each(['RESERVED','PROVIDER_RESULT_DURABLE','UNKNOWN','STALE'] as const)('reports %s without sealing, timeout recovery or private result disclosure',async status=>{
  const h=harness();let provider_result:any;
  if(status==='PROVIDER_RESULT_DURABLE'){provider_result=h.complete().record;h.snapshot().authority.assessments=[];h.snapshot().assessment_operations=[];}
  h.snapshot().assessment_operations.push({idempotency_key:key,obligation_id:h.id,aggregate_version:1,status,...(status==='RESERVED'?{reserved_at:0}:{}),...(provider_result?{provider_result}: {})});
  const before=structuredClone(h.snapshot()),r=await h.handler(request(),h.id),body=await r.json();expect(r.status).toBe(200);expect(body.status).toBe(status);expect(body.receipt).toBeUndefined();expect(body.provider_result).toBeUndefined();expect(Object.keys(body).sort()).toEqual(['aggregate_version','financial_action_eligible','idempotency_key','obligation_id','source_record_sha256','status']);expect(h.snapshot()).toEqual(before);
 });
 it('normalizes legacy PENDING to UNKNOWN in memory without changing stored history',async()=>{
  const h=harness();h.snapshot().assessment_operations.push({idempotency_key:key,obligation_id:h.id,aggregate_version:1,status:'PENDING'} as any);
  expect(await(await h.handler(request(),h.id)).json()).toMatchObject({status:'UNKNOWN'});expect(h.snapshot().assessment_operations[0].status).toBe('PENDING');
 });
 it.each(['missing','foreign-payable','foreign-key'])('never borrows a receipt for %s identity',async variant=>{
  const h=harness();if(variant==='foreign-payable')h.complete(key,h.records[1].obligation_id);if(variant==='foreign-key')h.complete(otherKey);
  expect(await(await h.handler(request(),h.id)).json()).toMatchObject({status:'NOT_FOUND'});
 });
 it.each(['RESERVED','PROVIDER_RESULT_DURABLE','UNKNOWN'] as const)('a completed request shadowed by another %s remains STALE',async status=>{
  const h=harness(),sealed=h.complete();h.snapshot().assessment_operations.push({idempotency_key:otherKey,obligation_id:h.id,aggregate_version:1,status,...(status==='RESERVED'?{reserved_at:0}:{}),...(status==='PROVIDER_RESULT_DURABLE'?{provider_result:{...sealed.record,assessment_id:`ASM-${otherKey}`}}:{})});
  const body=await(await h.handler(request(),h.id)).json();expect(body.status).toBe('STALE');expect(body.receipt).toBeUndefined();
 });
 it('does not treat another payable UNKNOWN as the selected original request outcome',async()=>{
  const h=harness();h.complete();h.snapshot().assessment_operations.unshift({idempotency_key:otherKey,obligation_id:h.records[1].obligation_id,aggregate_version:1,status:'UNKNOWN'});
  expect(await(await h.handler(request(),h.id)).json()).toMatchObject({status:'COMPLETED_CURRENT'});
 });
 it('rejects a superseded sealed receipt even at the same aggregate version',async()=>{
  const h=harness();h.complete();h.complete(otherKey);expect(await(await h.handler(request(),h.id)).json()).toMatchObject({status:'STALE'});
 });
 it('rejects a historical operation after a separately reapproved aggregate version',async()=>{
  const h=harness();h.complete();h.snapshot().authority.aggregates[0].aggregate_version=2;
  const {assessments,...base}=h.snapshot().authority;const v=structuredClone(h.view());v.state_binding.workflow_base_sha256=hash(base);h.setView(v);
  expect(await(await h.handler(request(),h.id)).json()).toMatchObject({status:'STALE',aggregate_version:'2'});
 });
 it.each(['source','checkpoint-source'])('withholds a result when %s identity differs',async variant=>{
  const h=harness();const sealed=h.complete(key,h.id,1,'b'.repeat(64));
  if(variant==='checkpoint-source'){h.snapshot().authority.assessments=[];h.snapshot().assessment_operations=[{idempotency_key:key,obligation_id:h.id,aggregate_version:1,status:'PROVIDER_RESULT_DURABLE',provider_result:sealed.record}];}
  expect(await(await h.handler(request(),h.id)).json()).toMatchObject({status:'STALE'});
 });
 it.each(['missing-seal','tampered-hash','corrupt-snapshot','uninitialized','V1','marker-absent'])('masks malformed server state: %s',async variant=>{
  const h=harness();h.complete();if(variant==='missing-seal')h.snapshot().authority.assessments=[];if(variant==='tampered-hash')h.snapshot().assessment_operations[0].assessment_hash='b'.repeat(64);if(variant==='corrupt-snapshot')(h.snapshot() as any).schema_version=99;if(variant==='uninitialized')h.snapshot().actor_authority_registry_initialized=false;if(variant==='V1')(h.snapshot() as any).schema_version=1;if(variant==='marker-absent')delete (h.snapshot() as any).actor_authority_registry_initialized;
  const r=await h.handler(request(),h.id);expect(r.status).toBe(503);expect(await r.json()).toEqual({code:'ASSESSMENT_STATUS_UNAVAILABLE'});
 });
 it.each([{}, {idempotency_key:'bad'}, {idempotency_key:key.toUpperCase().replace('00000000','ABCDEF00')},{idempotency_key:key,namespace:'foreign'},{idempotency_key:key,financial_action_eligible:true},[]])('rejects malformed/expanded body before source/state: %j',async body=>{
  const h=harness(),r=await h.handler(request(body),h.id);expect(r.status).toBe(400);expect(h.source).not.toHaveBeenCalled();expect(h.repository.loadExisting).not.toHaveBeenCalled();
 });
 it.each([['stream',request({idempotency_key:key,padding:'a'.repeat(256)}),413],['length',request({idempotency_key:key},{'content-length':'257'}),413],['type',request({}, {'content-type':'text/plain'}),415]])('bounds %s before private source/state',async(_name,req,status)=>{
  const h=harness();expect((await h.handler(req,h.id)).status).toBe(status);expect(h.source).not.toHaveBeenCalled();expect(h.repository.loadExisting).not.toHaveBeenCalled();
 });
 it.each(['absent','V2','withdrawn-id'])('denies %s authority before state',async variant=>{
  const h=harness();if(variant==='absent')h.setView(undefined);if(variant==='V2'){const view=structuredClone(h.view());delete view.state_binding.workflow_base_sha256;h.setView(view);}
  expect((await h.handler(request(),variant==='withdrawn-id'?'UNKNOWN':h.id)).status).toBe(variant==='withdrawn-id'?404:403);expect(h.repository.loadExisting).not.toHaveBeenCalled();
 });
 it.each(['revision','same-revision-bytes','source','session'])('refuses %s drift between awaited reads without retry',async variant=>{
  const h=harness();h.complete();let calls=0;
  h.repository.loadExisting.mockImplementation(async()=>{calls++;const result={revision:8,snapshot:structuredClone(h.snapshot()) as unknown as Record<string,any>};if(calls===2){if(variant==='revision')result.revision=9;if(variant==='same-revision-bytes')result.snapshot.assessment_operations.push({idempotency_key:otherKey,obligation_id:h.id,aggregate_version:1,status:'UNKNOWN'});if(variant==='source'){const view=structuredClone(h.view());view.records[0].commercial_terms='Changed';h.setView(view);}if(variant==='session')h.revalidate.mockRejectedValue(new AccessError('SESSION_REQUIRED',401));}return result;});
  const r=await h.handler(request(),h.id);expect(r.status).toBe(variant==='session'?401:409);expect(h.repository.loadExisting).toHaveBeenCalledTimes(2);expect((await r.json()).receipt).toBeUndefined();
 });
 it('captures first raw fingerprint before a shared mutable object changes on the next await',async()=>{
  const h=harness();h.complete();let reads=0;h.repository.loadExisting.mockImplementation(async()=>{if(++reads===2)h.snapshot().assessment_operations.push({idempotency_key:otherKey,obligation_id:h.id,aggregate_version:1,status:'UNKNOWN'});return {revision:8,snapshot:h.snapshot() as unknown as Record<string,any>};});
  expect((await h.handler(request(),h.id)).status).toBe(409);
 });
 it.each(['base','namespace','amount','currency'])('refuses mismatched %s binding',async variant=>{
  const h=harness(),v=structuredClone(h.view());if(variant==='base')v.state_binding.workflow_base_sha256='b'.repeat(64);if(variant==='namespace')h.repository.loadExisting.mockResolvedValue({revision:6,snapshot:h.snapshot() as unknown as Record<string,any>});if(variant==='amount')v.records[0].amount='999.00';if(variant==='currency')v.records[0].currency='EUR' as any;h.setView(v);
  expect([409,503]).toContain((await h.handler(request(),h.id)).status);
 });
 it('masks backend errors and makes no second attempt',async()=>{
  const h=harness();h.repository.loadExisting.mockRejectedValue(new Error('PRIVATE BACKEND DETAILS'));const r=await h.handler(request(),h.id);expect(r.status).toBe(503);expect(await r.text()).not.toContain('PRIVATE');expect(h.repository.loadExisting).toHaveBeenCalledOnce();
 });
 it.each(['no-cookie','revoked','expired','csrf','origin'])('production guard denies %s before private source/state',async variant=>{
  const h=harness(),g=guarded();const headers:Record<string,string>={};if(variant==='no-cookie')headers.cookie='';if(variant==='revoked')g.authRepository.validateSession.mockResolvedValue({...g.session,valid:false});if(variant==='expired')g.authRepository.validateSession.mockResolvedValue({...g.session,expires_at:'2000-01-01T00:00:00Z'});if(variant==='csrf')headers['x-tameion-csrf']='bad';if(variant==='origin')headers.origin='https://foreign.invalid';
  gates.guard.mockImplementation(g.guard);gates.source.mockImplementation(h.source);const read=vi.spyOn(SupabaseDemoStateRepository.prototype,'loadExisting');const r=await route.POST(request(undefined,headers),{params:Promise.resolve({id:h.id})});
  expect([401,403]).toContain(r.status);expect(r.headers.get('cache-control')).toContain('no-store');expect(h.source).not.toHaveBeenCalled();expect(read).not.toHaveBeenCalled();
 });
 it.each([2,3,4,5])('production guard revalidates revoked identity at check %s without another private read',async phase=>{
  const h=harness(),g=guarded();let checks=0;g.authRepository.validateSession.mockImplementation(async()=>++checks===phase?{...g.session,valid:false}:g.session);
  gates.guard.mockImplementation(g.guard);gates.source.mockImplementation(h.source);vi.stubEnv('SUPABASE_URL','https://fixture.invalid');vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY','FICTIONAL-ONLY');
  const read=vi.spyOn(SupabaseDemoStateRepository.prototype,'loadExisting').mockImplementation(h.repository.loadExisting);
  const r=await route.POST(request(),{params:Promise.resolve({id:h.id})});expect(r.status).toBe(401);expect(await r.json()).toEqual({code:'SESSION_REQUIRED'});expect(read).toHaveBeenCalledTimes(phase<=3?0:phase===4?1:2);
 });
 it.each(['GET','HEAD','OPTIONS','PUT','PATCH','DELETE'] as const)('explicitly denies %s with no guard or state access',async method=>{
  gates.guard.mockClear();gates.source.mockClear();const r=await route[method]();expect(r.status).toBe(405);expect(r.headers.get('cache-control')).toContain('no-store');expect(gates.guard).not.toHaveBeenCalled();expect(gates.source).not.toHaveBeenCalled();
 });
});
