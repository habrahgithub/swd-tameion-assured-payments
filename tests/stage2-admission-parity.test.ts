import {afterEach,expect,it,vi} from 'vitest';
import {sourceHarness,invoice} from './test-support/source-workflow-fixture';
const unknown='11111111-1111-4111-8111-111111111111';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
async function prepared(){const h=sourceHarness(),r=await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic Stage2 boundary'}));expect(r.status).toBe(201);return{h,id:(await r.json()).obligation.obligation_id as string};}
const review=()=>({expected_version:1,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Current source evidence reviewed',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[]});
async function detail(h:ReturnType<typeof sourceHarness>,id:string){const r=await h.handler('detail',new Request('https://synthetic.invalid'),id);expect(r.status).toBe(200);return r.json();}
for(const mutation of ['REVOKED','SUSPENDED','VERSION','EXPIRED','PERMISSION','ROLE']as const)it(`recorded HUMAN actor ${mutation} stays history but grants no current draft/action`,async()=>{
 const{h,id}=await prepared(),accepted=await h.handler('review',h.request(review()),id);expect(accepted.status).toBe(201);const before=structuredClone(h.snapshot().authority.review_decisions),original=(await accepted.json());
 const actor=h.snapshot().actor_authorities[0];actor.authority_version='2';
 if(mutation==='REVOKED'||mutation==='SUSPENDED')actor.status=mutation;
 if(mutation==='EXPIRED')actor.expires_at=new Date(Date.now()-1).toISOString();
 if(mutation==='PERMISSION')actor.permissions=[];
 if(mutation==='ROLE')actor.actor_role='OTHER';
 // A different current requester cannot renew the recorded actor's old review.
 const requester={...structuredClone(actor),actor_id:'SYNTHETIC-CURRENT-REQUESTER',actor_role:'FINANCE_APPROVER',status:'ACTIVE' as const,permissions:['T1_SINGLE_APPROVAL'],valid_from:new Date(Date.now()-1000).toISOString(),expires_at:null};
 h.snapshot().actor_authorities.push(requester);h.source.source_ingress!.actor_id=requester.actor_id;
 const d=await detail(h,id);expect(d.current_review_decision).toBeNull();expect(d.allowed_actions).not.toContain('PREPARE_CONTROLLED_INSTRUCTION');expect(d.allowed_actions).toContain('MANUAL_REVIEW');expect(d.superseded_review_hash).toBe(original.review_decision_hash);
 const writes=h.repository.compareAndSet.mock.calls.length;
 const r=await h.handler('draft',h.request({expected_version:1,review_decision_id:original.review_decision.decision_id,review_decision_hash:original.review_decision_hash}),id);expect(r.status).toBe(409);expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(h.snapshot().authority.review_decisions).toEqual(before);
 const replacement=await h.handler('review',h.request({...review(),expected_review_hash:d.superseded_review_hash}),id);expect(replacement.status).toBe(201);expect(h.snapshot().authority.review_decisions?.[0]).toEqual(before?.[0]);
});
it('replacing stale recorded actor review still requires explicit observed hash; replay remains receipt-only',async()=>{
 const{h,id}=await prepared(),key='22222222-2222-4222-8222-222222222222',body=review();expect((await h.handler('review',h.request(body,key),id)).status).toBe(201);
 h.snapshot().actor_authorities[0].authority_version='2';const before=structuredClone(h.snapshot().authority.review_decisions);
 expect((await h.handler('review',h.request(body),id)).status).toBe(409);
 const count=h.repository.compareAndSet.mock.calls.length,r=await h.handler('review',h.request(body,key),id),receipt=await r.json();expect(r.status).toBe(200);expect(receipt.receipt_only).toBe(true);expect(receipt.current_authorization).toBe(false);expect(h.repository.compareAndSet).toHaveBeenCalledTimes(count);expect(h.snapshot().authority.review_decisions).toEqual(before);
});
for(const offset of [-1,0,1])it(`HUMAN expiry is half-open at final auth await offset${offset}`,async()=>{
 vi.useFakeTimers({toFake:['Date']});const t=Date.now(),{h,id}=await prepared();h.snapshot().actor_authorities[0].expires_at=new Date(t+1000).toISOString();h.snapshot().actor_authorities[0].authority_version='2';let n=0;
 h.guard.mockResolvedValue({session:{operator_key:h.source.source_ingress!.operator_key,credential_version:1},revalidate:async()=>{if(++n===2)vi.setSystemTime(t+1000+offset);}}as never);
 const writes=h.repository.compareAndSet.mock.calls.length,r=await h.handler('review',h.request(review()),id);expect(r.status).toBe(offset<0?201:403);if(offset>=0)expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);else expect(Date.parse((await r.json()).review_decision.expires_at)).toBe(t+1000);
});
for(const field of ['status','permission','version','credential','source','session']as const)it(`current boundary refuses ${field} change at awaited authority check`,async()=>{
 const{h,id}=await prepared();let n=0;
 h.guard.mockResolvedValue({session:{operator_key:h.source.source_ingress!.operator_key,credential_version:1},revalidate:async()=>{if(++n===2){if(field==='status')h.snapshot().actor_authorities[0].status='REVOKED';if(field==='permission'){h.snapshot().actor_authorities[0].permissions=[];h.snapshot().actor_authorities[0].authority_version='2';}if(field==='version')h.snapshot().actor_authorities[0].authority_version='2';if(field==='credential')h.source.source_ingress!.credential_version=2;if(field==='source')h.source.source_ingress!.permissions=[];if(field==='session')throw Error('Synthetic revoked session');}}}as never);
 const count=h.repository.compareAndSet.mock.calls.length,r=await h.handler('review',h.request(review()),id);expect(r.status).toBeGreaterThanOrEqual(400);expect(h.repository.compareAndSet).toHaveBeenCalledTimes(count);
});
it('ANYversion UNKNOWN rejects new key; exact retained key observes without provider and preserves original',async()=>{
 const{h,id}=await prepared(),op={idempotency_key:unknown,obligation_id:id,aggregate_version:1,status:'UNKNOWN'as const,reserved_at:Date.now()-1000};h.snapshot().assessment_operations.push(op);const before=structuredClone(op);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 const r=await h.handler('assess',h.request({},unknown),id);expect(r.status).toBe(409);expect((await r.json()).code).toBe('ASM-UNKNOWN');const count=h.repository.compareAndSet.mock.calls.length;
 expect((await h.handler('assess',h.request({}),id)).status).toBe(409);expect(fetcher).not.toHaveBeenCalled();expect(h.repository.compareAndSet).toHaveBeenCalledTimes(count);expect(h.snapshot().assessment_operations[0]).toEqual(before);
});
it('another payable key remains bound and cannot become fresh authority',async()=>{
 const{h,id}=await prepared();h.snapshot().assessment_operations.push({idempotency_key:unknown,obligation_id:id,aggregate_version:1,status:'UNKNOWN',reserved_at:Date.now()});
 const saved=await(await h.handler('save',h.request({expected_revision:0,fields:{...invoice,invoice_number:'SYNTHETIC-SECOND'},reason:'Other payable'}))).json();const other=saved.obligation.obligation_id;const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 expect((await h.handler('assess',h.request({},unknown),other)).status).toBe(400);expect(fetcher).not.toHaveBeenCalled();
});
it('revocation after durable reservation denies provider and preserves the consumed original key',async()=>{
 const{h,id}=await prepared(),cas=h.repository.compareAndSet.getMockImplementation()!,fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);let revoked=false;
 h.repository.compareAndSet.mockImplementation(async(n,revision,next)=>{const saved=await cas(n,revision,next);if(!revoked&&h.snapshot().assessment_operations.some(o=>o.status==='RESERVED')){revoked=true;h.snapshot().actor_authorities[0].status='REVOKED';}return saved;});
 const key='33333333-3333-4333-8333-333333333333',r=await h.handler('assess',h.request({},key),id);expect(r.status).toBeGreaterThanOrEqual(400);expect(fetcher).not.toHaveBeenCalled();expect(h.snapshot().assessment_operations).toHaveLength(1);expect(h.snapshot().assessment_operations[0].idempotency_key).toBe(key);expect(h.snapshot().assessment_operations[0].status).toBe('RESERVED');
});
