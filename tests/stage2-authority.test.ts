import {afterEach,expect,it,vi} from 'vitest';
import {sourceHarness,invoice} from './test-support/source-workflow-fixture';
import {contentHash} from '../src/domain/linked-instruction';
const UNKNOWN='11111111-1111-4111-8111-111111111111';
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function prepared(){const h=sourceHarness();const response=await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic SENTINEL Stage2 source'}));expect(response.status).toBe(201);const saved=await response.json();return{h,id:saved.obligation.obligation_id};}
function review(){return{expected_version:1,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Synthetic current-source evidence reviewed independently of AI',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]};}
function provider(){vi.stubEnv('NVIDIA_API_KEY','SYNTHETIC-NETWORK-OFF');const fetcher=vi.fn(async()=>Response.json({choices:[{message:{content:'not valid model JSON'}}]}));vi.stubGlobal('fetch',fetcher);return fetcher;}
async function detail(h:ReturnType<typeof sourceHarness>,id:string){const r=await h.handler('detail',new Request('https://synthetic.invalid'),id);expect(r.status).toBe(200);return r.json();}
function seedUnknown(h:ReturnType<typeof sourceHarness>,id:string){const op={idempotency_key:UNKNOWN,obligation_id:id,aggregate_version:1,status:'UNKNOWN' as const,reserved_at:Date.now()-100000};h.snapshot().assessment_operations.push(op);return structuredClone(op);}
it('GREEN control: current manual review can proceed while legacy UNKNOWN remains byte-identical; zero AI',async()=>{
 const{h,id}=await prepared(),op=seedUnknown(h,id),fetcher=provider();
 expect((await detail(h,id)).allowed_actions).toContain('MANUAL_REVIEW');
 const r=await h.handler('review',h.request(review()),id);expect(r.status).toBe(201);
 expect(h.snapshot().assessment_operations.find(o=>o.idempotency_key===UNKNOWN)).toEqual(op);
 expect(h.snapshot().authority.review_decisions?.at(-1)?.record.provenance).toBe('HUMAN');expect(fetcher).not.toHaveBeenCalled();expect(h.snapshot().execution_ledger).toEqual([]);
});
it('INTENDED DENIAL: earlier UNKNOWN across source version cannot bypass current REQUEST_AI_ADVICE refusal',async()=>{
 const{h,id}=await prepared();seedUnknown(h,id);
 const correction=await h.handler('save',h.request({expected_revision:1,expected_version:1,fields:{...invoice,description:'Corrected synthetic factual description'},reason:'New current source revision'}),id);expect(correction.status).toBe(201);
 const current=await detail(h,id);expect(current.allowed_actions).not.toContain('REQUEST_AI_ADVICE');expect(current.aggregate.aggregate_version).toBe(2);
 const before=structuredClone(h.snapshot()),writes=h.repository.compareAndSet.mock.calls.length,fetcher=provider();
 const r=await h.handler('assess',h.request({}),id);
 console.log('SENTINEL_CROSS_VERSION',JSON.stringify({status:r.status,provider_calls:fetcher.mock.calls.length,new_writes:h.repository.compareAndSet.mock.calls.length-writes,body:await r.json()}));
 expect(fetcher).not.toHaveBeenCalled();expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(h.snapshot()).toEqual(before);
});
it('INTENDED DENIAL: known unreadable activated-child claim blocks direct advisory as well as projection',async()=>{
 const{h,id}=await prepared();h.snapshot().linked_activation_receipts=[{instruction_id:'SYNTHETIC-ACTIVATED-CHILD',source_obligation_id:id,namespace:'SYNTHETIC-UNAVAILABLE-CHILD',source_sha256:'a'.repeat(64),activated_at:new Date().toISOString()}];
 const load=h.repository.loadExisting.getMockImplementation()!;h.repository.loadExisting.mockImplementation(async namespace=>{if(namespace==='SYNTHETIC-UNAVAILABLE-CHILD')throw Error('Synthetic unavailable child');return load();});
 const current=await detail(h,id);expect(current.blockers[0].code).toBe('EXISTING_FINANCIAL_CLAIM');expect(current.allowed_actions).not.toContain('REQUEST_AI_ADVICE');
 const before=structuredClone(h.snapshot()),writes=h.repository.compareAndSet.mock.calls.length,fetcher=provider();const r=await h.handler('assess',h.request({}),id);
 console.log('SENTINEL_FINANCIAL_CLAIM',JSON.stringify({status:r.status,provider_calls:fetcher.mock.calls.length,new_writes:h.repository.compareAndSet.mock.calls.length-writes,body:await r.json()}));
 expect(fetcher).not.toHaveBeenCalled();expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(h.snapshot()).toEqual(before);
});
it('INTENDED DENIAL: actor expiry before final review CAS must prevent new HUMAN authority',async()=>{
 vi.useFakeTimers({toFake:['Date']});const t=Date.now();vi.setSystemTime(t);const{h,id}=await prepared();
 h.snapshot().actor_authorities[0].expires_at=new Date(t+1000).toISOString();h.snapshot().actor_authorities[0].authority_version='2';
 let checks=0;h.guard.mockResolvedValue({session:{operator_key:h.source.source_ingress!.operator_key,credential_version:1},revalidate:async()=>{checks++;if(checks===2)vi.setSystemTime(t+2000);}} as never);
 const before=structuredClone(h.snapshot()),writes=h.repository.compareAndSet.mock.calls.length;
 const r=await h.handler('review',h.request(review()),id);
 console.log('SENTINEL_ACTOR_EXPIRY',JSON.stringify({status:r.status,checks,now:Date.now(),actor_expires:t+1000,new_writes:h.repository.compareAndSet.mock.calls.length-writes,body:await r.json()}));
 expect(r.status).toBeGreaterThanOrEqual(400);expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(h.snapshot()).toEqual(before);
});
// WITHDRAWN permissive-mock diagnostic: retained, never an acceptance oracle.
it.skip('INTENDED DENIAL: fresh assessment load must reject concurrent foreign ingress anchor instead of overwriting it',async()=>{
 const{h,id}=await prepared(),load=h.repository.loadExisting.getMockImplementation()!,cas=h.repository.compareAndSet.getMockImplementation()!;
 let n=0,foreign:any;h.repository.loadExisting.mockImplementation(async()=>{const first=await load();n++;if(n===1){foreign={...structuredClone(first.snapshot),source_ingress_anchor:'f'.repeat(64)};await cas(h.source.state_binding.namespace,first.revision,foreign);}return first;});
 const fetcher=provider(),r=await h.handler('assess',h.request({}),id);
 console.log('SENTINEL_FOREIGN_ANCHOR',JSON.stringify({status:r.status,loads:n,provider_calls:fetcher.mock.calls.length,anchor:h.snapshot().source_ingress_anchor,body:await r.json()}));
 expect(fetcher).not.toHaveBeenCalled();expect(h.snapshot()).toEqual(foreign);
});

it('GREEN SQL-guard parity control: valid absent-to-foreign anchor winner prevents reanchor/provider on reservation flush',async()=>{
 const{h,id}=await prepared();
 // Seed an unanchored historical baseline, not an illegal established-anchor mutation.
 delete h.snapshot().source_ingress_anchor;
 const initial=await h.repository.loadExisting(h.source.state_binding.namespace);
 h.source.state_binding.revision=initial.revision;h.source.state_binding.authority_sha256=contentHash(h.snapshot().authority);
 const load=h.repository.loadExisting.getMockImplementation()!,cas=h.repository.compareAndSet.getMockImplementation()!;
 let calls=0,foreign:any,rejected=0;
 h.repository.compareAndSet.mockImplementation(async(n,rev,next)=>{
  // Exact immutable-anchor predicate from recovery_workflow_guard SQL:35.
  const current=h.snapshot() as any;
  if(Object.hasOwn(current,'source_ingress_anchor')&&current.source_ingress_anchor!==(next as any).source_ingress_anchor){rejected++;throw Error('SYNTHETIC_RECOVERY_WORKFLOW_GUARD_REJECTION');}
  return cas(n,rev,next);
 });
 h.repository.loadExisting.mockImplementation(async()=>{const first=await load();calls++;if(calls===1){foreign={...structuredClone(first.snapshot),source_ingress_anchor:'f'.repeat(64)};await h.repository.compareAndSet(h.source.state_binding.namespace,first.revision,foreign);}return first;});
 const fetcher=provider(),r=await h.handler('assess',h.request({}),id);
 console.log('SENTINEL_SQL_ANCHOR_CONTROL',JSON.stringify({status:r.status,provider_calls:fetcher.mock.calls.length,rejected_reanchor:rejected}));
 expect(r.status).toBeGreaterThanOrEqual(400);expect(rejected).toBe(1);expect(fetcher).not.toHaveBeenCalled();expect(h.snapshot()).toEqual(foreign);
});
it('INTENDED DENIAL: cached actor permission cannot dispatch advisory after actor expires during fresh load',async()=>{
 vi.useFakeTimers({toFake:['Date']});const t=Date.now();vi.setSystemTime(t);const{h,id}=await prepared();h.snapshot().actor_authorities[0].expires_at=new Date(t+1000).toISOString();h.snapshot().actor_authorities[0].authority_version='2';
 let checks=0;h.guard.mockResolvedValue({session:{operator_key:h.source.source_ingress!.operator_key,credential_version:1},revalidate:async()=>{checks++;if(checks===2)vi.setSystemTime(t+2000);}} as never);
 const before=structuredClone(h.snapshot()),writes=h.repository.compareAndSet.mock.calls.length,fetcher=provider(),r=await h.handler('assess',h.request({}),id);
 console.log('SENTINEL_ACTOR_EXPIRED_ADVISORY',JSON.stringify({status:r.status,checks,provider_calls:fetcher.mock.calls.length,new_writes:h.repository.compareAndSet.mock.calls.length-writes,now:Date.now(),actor_expires:t+1000}));
 expect(fetcher).not.toHaveBeenCalled();expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(h.snapshot()).toEqual(before);
});
