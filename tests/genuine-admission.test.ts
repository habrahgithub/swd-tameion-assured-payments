import {describe,it,expect,vi,afterEach} from 'vitest';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import {sealTestAssessment} from './test-support/seal-assessment';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {DemoState,parseDemoStateSnapshot} from '../src/server/demo-state';
import {parseOperatorSource} from '../src/server/operator-source-records';
import {DemoStateConflictError} from '../src/server/supabase-demo-state-repository';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
import {createGenuineWorkflowHandlers} from '../src/server/genuine-workflow';
import {createGenuineAssessmentStatusHandler} from '../src/server/genuine-assessment-status';
import {classifyGenuineAdmission,assertBootstrapOperationPreservation} from '../src/server/genuine-admission';
import {AccessError} from '../src/server/route-access-policy';
import {syntheticSourceRecords} from './test-support/synthetic-source-records';
import type {AuthContext} from '../src/server/operator-auth';
const hash=(v:unknown)=>createHash('sha256').update(canonicalize(v)).digest('hex');
// Synthetic durable state only; mirrors the genuine-workflow harness.
function harness(){
 const records=syntheticSourceRecords().map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...r}:any)=>({...r,source_evidence:r.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));for(const r of records){const evidence=r.source_evidence[0];r.assessment_basis={transaction_type:'INVOICE',classification_evidence:evidence,timing:{basis:'INVOICE_CASH_TERM',date:r.effective_due_date,evidence},simulation:{mode:'HISTORICAL_AS_OF',as_of_date:'2020-01-05',evidence,owner_authority_reference:'SYNTHETIC-READMISSION'}};}let snapshot=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot(),revision=8;// above the bound revision: seeded advisory history needs no initial CAS
 const {assessments,...base}=snapshot.authority;
 const packet={schema_version:3,record_count:5,provenance:'GENUINE_COMPANY_OBLIGATIONS',purpose:'GENUINE_ADVISORY_SOURCE',organization_id:'ORG-DEMO-001',state_binding:{namespace:'FICTIONAL-GENUINE',revision:7,authority_sha256:hash(snapshot.authority),workflow_base_sha256:hash(base)},records};
 const bytes=Buffer.from(JSON.stringify(packet)); const source=vi.fn(()=>parseOperatorSource(bytes,createHash('sha256').update(bytes).digest('hex')));
 const repository={loadExisting:vi.fn(async()=>({revision,snapshot:structuredClone(snapshot) as any})),compareAndSet:vi.fn(async(_n:string,r:number,next:any)=>{if(r!==revision)throw new DemoStateConflictError();snapshot=structuredClone(next);return ++revision;})};
 const guard=vi.fn(async()=>({session:{operator_key:'fictional',credential_version:1},revalidate:vi.fn(async()=>{})} as unknown as AuthContext));
 const handler=createGenuineWorkflowHandlers({guard,source,repository});
 const request=(body:unknown,key='c23a9d3a-39a1-4f36-9556-04f523969abb')=>new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
 return {records,source,repository,guard,handler,request,snapshot:()=>snapshot,revision:()=>revision};
}
type H=ReturnType<typeof harness>;
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});
const legacyKey=(i:number,p='aaaaaaaa-aaaa-4aaa-8aaa-')=>`${p}${String(i).padStart(12,'0')}`;
function seedLegacy(h:H,count:number,version=1){
 const id=h.records[0].obligation_id,state=new DemoState(h.snapshot(),undefined,undefined,undefined,{},h.records);
 for(let i=0;i<count;i++){const key=legacyKey(i);const sealed=sealTestAssessment(state.store,'ORG-DEMO-001',id,version,{assessment_id:`ASM-${key}`});h.snapshot().assessment_operations.push({idempotency_key:key,obligation_id:id,aggregate_version:version,status:'COMPLETED',assessment_hash:sealed.assessment_hash});}
 h.snapshot().authority=state.store.exportSnapshot();
}
function seedGenuine(h:H,count:number,version=1){
 const id=h.records[0].obligation_id,state=new DemoState(h.snapshot(),undefined,undefined,undefined,{},h.records);
 for(let i=0;i<count;i++){const key=legacyKey(i,'bbbbbbbb-bbbb-4bbb-8bbb-'),src='c'.repeat(63)+String(i);const sealed=sealTestAssessment(state.store,'ORG-DEMO-001',id,1,{assessment_id:`ASM-${key}`,source_record_sha256:src});h.snapshot().assessment_operations.push({idempotency_key:key,obligation_id:id,aggregate_version:version,status:'COMPLETED',reserved_at:1,assessment_hash:sealed.assessment_hash,recovery:{generation:0,source_record_sha256:src,binding_sha256:'d'.repeat(64)}});}
 h.snapshot().authority=state.store.exportSnapshot();
}
function seedUnknown(h:H){
 const id=h.records[0].obligation_id,reserved_at=Date.now()-106_000;
 h.snapshot().assessment_operations.push({idempotency_key:'11111111-1111-4111-8111-111111111111',obligation_id:id,aggregate_version:1,status:'UNKNOWN',reserved_at,recovery:{generation:0,source_record_sha256:hash(h.records[0]),binding_sha256:hash(h.source().state_binding),unknown_at:reserved_at+20_000}});
}
const recover=(h:H,key='22222222-2222-4222-8222-222222222222')=>h.handler('assess',h.request({recovery:true,expected_version:1,source_record_sha256:hash(h.source().records[0])},key),h.records[0].obligation_id);
async function genuineGet(h:H){
 const readers=createObligationReaders(h.guard,async(records,binding)=>loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:structuredClone(h.snapshot())})},h.source().state_binding.namespace,records,binding),h.source,()=>undefined);
 return readers.detail(new Request('https://fixture.invalid'),h.records[0].obligation_id);
}
const REF='99999999-9999-4999-8999-999999999999',NEW_KEY='77777777-7777-4777-8777-777777777777',OTHER_KEY='88888888-8888-4888-8888-888888888888';
const providerBody=(h:H)=>JSON.stringify({choices:[{message:{content:JSON.stringify({obligation_id:h.records[0].obligation_id,decision:'HOLD',finding_codes:[],evidence_ids:h.records[0].source_evidence.map((e:any)=>e.evidence_id),uncertainty_signal:true,explanation:'Mock model declines'})}}]});
function mockProvider(h:H){vi.stubEnv('NVIDIA_API_KEY','OFFLINE_MOCK_ONLY');const fetcher=vi.fn(async()=>new Response(providerBody(h),{status:200}));vi.stubGlobal('fetch',fetcher);return fetcher;}
const attest=()=>vi.stubEnv('TAMEION_ASSESSMENT_BOOTSTRAP_GUARD','APPLIED');
const bootstrap=(h:H,key=NEW_KEY,reference=REF,handler=h.handler)=>handler('assess',h.request({bootstrap:true,expected_version:1,source_record_sha256:hash(h.source().records[0]),unmatched_reference_key:reference},key),h.records[0].obligation_id);

describe('Stage 2 shared admission classifier',()=>{
 it.each([9,5,7,6])('exempts exactly %i positively matched terminal legacy pairs without touching their bytes',n=>{
  const h=harness(),id=h.records[0].obligation_id;seedLegacy(h,n);const before=JSON.stringify(h.snapshot());
  expect(classifyGenuineAdmission(h.snapshot(),id)).toMatchObject({can_assess:true,reason:'LEGACY_HISTORY_ONLY',can_bootstrap:true,legacy_history_count:n,counted_history:0,genuine_admissions:0,unclassifiable_history:0});
  expect(JSON.stringify(h.snapshot())).toBe(before);
 });
 it('denies four genuine admissions across versions/source hashes, and four unclassifiable ones',()=>{
  const h=harness(),id=h.records[0].obligation_id;seedLegacy(h,6);seedGenuine(h,4,2);
  expect(classifyGenuineAdmission(h.snapshot(),id)).toMatchObject({can_assess:false,reason:'HISTORY_LIMIT',can_bootstrap:false,counted_history:4});
  const u=harness();for(let i=0;i<4;i++)u.snapshot().assessment_operations.push({idempotency_key:legacyKey(i,'eeeeeeee-eeee-4eee-8eee-'),obligation_id:id,aggregate_version:1,status:'STALE'});
  expect(classifyGenuineAdmission(u.snapshot(),id)).toMatchObject({can_assess:false,reason:'HISTORY_LIMIT',unclassifiable_history:4});
 });
 it.each(['hash','id','missing-sealed','sealed-source','recovery','version','provider-result','duplicate-claim','missing-hash'])('never exempts a malformed or ambiguous pair (%s)',variant=>{
  const h=harness(),id=h.records[0].obligation_id;seedLegacy(h,1);const op=h.snapshot().assessment_operations[0] as any;const sealed=h.snapshot().authority.assessments[0] as any;
  if(variant==='hash')op.assessment_hash='f'.repeat(64);
  if(variant==='id')sealed.record.assessment_id='ASM-other';
  if(variant==='missing-sealed')h.snapshot().authority.assessments.length=0;
  if(variant==='sealed-source')sealed.record.source_record_sha256='f'.repeat(64);
  if(variant==='recovery')op.recovery={generation:0,source_record_sha256:'f'.repeat(64),binding_sha256:'f'.repeat(64)};
  if(variant==='version')op.aggregate_version=2;
  if(variant==='provider-result')op.provider_result=sealed.record;
  if(variant==='duplicate-claim')h.snapshot().authority.assessments.push({...structuredClone(sealed),hash:'f'.repeat(64)});
  if(variant==='missing-hash')delete op.assessment_hash;
  const result=classifyGenuineAdmission(h.snapshot(),id);expect(result.legacy_history_count).toBe(0);expect(result.can_bootstrap).toBe(false);
 });
 it.each(['UNKNOWN','RESERVED','PROVIDER_RESULT_DURABLE','PENDING'])('denies unresolved %s of another version after nine legacy pairs (PENDING parser-normalised)',status=>{
  const h=harness(),id=h.records[0].obligation_id;seedLegacy(h,9);h.snapshot().assessment_operations.push({idempotency_key:legacyKey(1,'12121212-1212-4212-8212-'),obligation_id:id,aggregate_version:3,status:status as any,reserved_at:1});
  expect(classifyGenuineAdmission(h.snapshot(),id)).toMatchObject({can_assess:false,reason:'UNRESOLVED_OPERATION',can_bootstrap:false});
 });
 it('denies financial history before any provider work, with UI/server reasons in agreement',async()=>{
  const h=harness(),id=h.records[0].obligation_id,fetcher=mockProvider(h);attest();seedLegacy(h,7);h.snapshot().execution_ledger.push({obligation_id:id,idempotency_key:'FICTIONAL-FIN',status:'UNKNOWN',atomic_amount:'1',destination_address:'0x'+'1'.repeat(40),provider_ref:null} as any);
  expect(classifyGenuineAdmission(h.snapshot(),id)).toMatchObject({can_assess:false,reason:'FINANCIAL_HISTORY',can_bootstrap:false});
  const detail=await(await genuineGet(h)).json();expect(detail).toMatchObject({advisory_action_eligible:false,genuine_assessment:{admission:{reason:'FINANCIAL_HISTORY',can_assess:false,can_bootstrap:false}}});
  expect((await h.handler('assess',h.request({}),id)).status).toBeGreaterThanOrEqual(400);expect((await bootstrap(h)).status).toBeGreaterThanOrEqual(400);expect(fetcher).not.toHaveBeenCalled();expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });
 it('read projection and ordinary reservation agree for legacy-only history; the four-admission budget is not renewed',async()=>{
  vi.stubEnv('NVIDIA_API_KEY',undefined);const h=harness(),id=h.records[0].obligation_id;seedLegacy(h,9);
  expect(await(await genuineGet(h)).json()).toMatchObject({advisory_action_eligible:true,genuine_assessment:{admission:{reason:'LEGACY_HISTORY_ONLY',can_assess:true}}});
  for(let i=0;i<4;i++)expect((await h.handler('assess',h.request({},legacyKey(50+i,'13131313-1313-4313-8313-')),id)).status).toBe(200);
  const blocked=await h.handler('assess',h.request({},legacyKey(60,'13131313-1313-4313-8313-')),id);expect(blocked.status).toBe(409);expect(await blocked.json()).toMatchObject({code:'GENUINE_ASSESSMENT_HISTORY_LIMIT'});
  expect(await(await genuineGet(h)).json()).toMatchObject({advisory_action_eligible:false,genuine_assessment:{admission:{reason:'HISTORY_LIMIT'}}});
 });
 it('uses the shared limit for UNKNOWN recovery: legacy pairs are exempt, genuine history is not',async()=>{
  vi.stubEnv('NVIDIA_API_KEY',undefined);const h=harness();seedLegacy(h,9);seedUnknown(h);expect((await recover(h)).status).toBe(200);
  const c=harness();seedGenuine(c,3);seedUnknown(c);expect((await recover(c)).status).toBe(409);
 });
});

describe('Stage 2 explicit current-source bootstrap',()=>{
 it('stays disabled until the persistence guard is attested, with no write and no provider',async()=>{
  const h=harness(),fetcher=mockProvider(h);seedLegacy(h,7);expect((await bootstrap(h)).status).toBe(409);
  expect(fetcher).not.toHaveBeenCalled();expect(h.repository.compareAndSet).not.toHaveBeenCalled();
  expect((await(await genuineGet(h)).json()).genuine_assessment.admission.can_bootstrap).toBe(false);
 });
 it('durably binds one bootstrap before the provider, preserving legacy bytes and the unmatched reference as unresolved provenance',async()=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedLegacy(h,7);const legacyBytes=JSON.stringify(h.snapshot().assessment_operations);
  let reservedBeforeProvider=false;fetcher.mockImplementationOnce(async()=>{reservedBeforeProvider=h.snapshot().assessment_operations.some((o:any)=>o.idempotency_key===NEW_KEY&&o.status==='RESERVED'&&o.bootstrap);return new Response(providerBody(h),{status:200});});
  expect((await(await genuineGet(h)).json()).genuine_assessment.admission).toMatchObject({can_bootstrap:true});
  const response=await bootstrap(h);expect(response.status).toBe(200);expect(fetcher).toHaveBeenCalledOnce();expect(reservedBeforeProvider).toBe(true);
  const ops=h.snapshot().assessment_operations;expect(JSON.stringify(ops.slice(0,7))).toBe(legacyBytes);
  expect(ops[7]).toMatchObject({idempotency_key:NEW_KEY,status:'COMPLETED',aggregate_version:1,recovery:{generation:0,source_record_sha256:hash(h.records[0]),binding_sha256:hash(h.source().state_binding)},bootstrap:{kind:'CURRENT_SOURCE_BOOTSTRAP',unmatched_reference_key:REF,unmatched_reference_status:'UNVERIFIED_ABSENT_FROM_RECORDED_OPERATIONS',source_record_sha256:hash(h.records[0]),aggregate_version:1}});
  expect(ops.some((o:any)=>o.idempotency_key===REF)).toBe(false);expect(h.snapshot().authority.assessments.some((a:any)=>a.record.assessment_id===`ASM-${REF}`)).toBe(false);
  expect(parseDemoStateSnapshot(h.snapshot()).assessment_operations[7].bootstrap?.unmatched_reference_key).toBe(REF);
  expect((await bootstrap(h,OTHER_KEY)).status).toBe(409);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('admits at most one reservation/provider submission across replays and concurrent tabs with different UUIDs',async()=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedLegacy(h,5);
  const tabs=Array.from({length:4},()=>createGenuineWorkflowHandlers({guard:h.guard,source:h.source,repository:h.repository}));
  const responses=await Promise.all(tabs.map((tab,i)=>bootstrap(h,`7777777${i}-7777-4777-8777-777777777777`,REF,tab.bind(null))));
  expect(responses.filter(r=>r.status===200)).toHaveLength(1);expect(fetcher).toHaveBeenCalledOnce();
  expect(h.snapshot().assessment_operations.filter((o:any)=>o.bootstrap)).toHaveLength(1);
  const winner=(h.snapshot().assessment_operations.find((o:any)=>o.bootstrap) as any).idempotency_key;
  expect((await bootstrap(h,winner)).status).toBe(200);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('retains the reservation as UNKNOWN after a provider failure and never reuses it to fake an absent predecessor',async()=>{
  const h=harness();vi.stubEnv('NVIDIA_API_KEY','OFFLINE_MOCK_ONLY');attest();const fetcher=vi.fn(async()=>{throw new Error('timeout');});vi.stubGlobal('fetch',fetcher);seedLegacy(h,6);
  const first=await bootstrap(h);expect(first.status).toBe(409);expect(await first.json()).toMatchObject({status:'UNKNOWN'});
  expect(h.snapshot().assessment_operations.at(-1)).toMatchObject({idempotency_key:NEW_KEY,status:'UNKNOWN',bootstrap:{unmatched_reference_key:REF},recovery:{generation:0,unknown_at:expect.any(Number)}});
  const calls=fetcher.mock.calls.length;expect((await bootstrap(h,OTHER_KEY)).status).toBe(409);expect(fetcher.mock.calls.length).toBe(calls);
  expect((await recover(h,'66666666-6666-4666-8666-666666666666')).status).toBe(409);
  expect(h.snapshot().assessment_operations.filter((o:any)=>o.bootstrap)).toHaveLength(1);
 });
 it.each(['same-key','recorded-other-obligation','sealed-receipt','another-bootstrap-reference'])('refuses a reference that is not provably absent (%s) before any write',async variant=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedLegacy(h,3);let ref=REF;
  if(variant==='same-key')ref=NEW_KEY;
  if(variant==='recorded-other-obligation')h.snapshot().assessment_operations.push({idempotency_key:REF,obligation_id:h.records[1].obligation_id,aggregate_version:1,status:'STALE'});
  if(variant==='sealed-receipt'){const s=new DemoState(h.snapshot(),undefined,undefined,undefined,{},h.records);sealTestAssessment(s.store,'ORG-DEMO-001',h.records[1].obligation_id,1,{assessment_id:`ASM-${REF}`});h.snapshot().authority=s.store.exportSnapshot();}
  if(variant==='another-bootstrap-reference')h.snapshot().assessment_operations.push({idempotency_key:legacyKey(9,'abababab-abab-4bab-8bab-'),obligation_id:h.records[1].obligation_id,aggregate_version:1,status:'COMPLETED',reserved_at:1,assessment_hash:'a'.repeat(64),recovery:{generation:0,source_record_sha256:'a'.repeat(64),binding_sha256:'a'.repeat(64)},bootstrap:{kind:'CURRENT_SOURCE_BOOTSTRAP',source_record_sha256:'a'.repeat(64),binding_sha256:'a'.repeat(64),aggregate_version:1,unmatched_reference_key:REF,unmatched_reference_status:'UNVERIFIED_ABSENT_FROM_RECORDED_OPERATIONS'}} as any);
  h.repository.compareAndSet.mockClear();const r=await bootstrap(h,NEW_KEY,ref);expect(r.status).toBeGreaterThanOrEqual(400);expect(fetcher).not.toHaveBeenCalled();expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });
 it.each(['genuine','unclassifiable','unresolved','history-limit'])('rejects bootstrap over %s history before any provider work',async variant=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedLegacy(h,4);const id=h.records[0].obligation_id;
  if(variant==='genuine')seedGenuine(h,1);
  if(variant==='unclassifiable')h.snapshot().assessment_operations.push({idempotency_key:legacyKey(3,'edededed-eded-4ded-8ded-'),obligation_id:id,aggregate_version:1,status:'STALE'});
  if(variant==='unresolved')h.snapshot().assessment_operations.push({idempotency_key:legacyKey(3,'edededed-eded-4ded-8ded-'),obligation_id:id,aggregate_version:2,status:'UNKNOWN'});
  if(variant==='history-limit')seedGenuine(h,4);
  h.repository.compareAndSet.mockClear();expect((await bootstrap(h)).status).toBe(409);expect(fetcher).not.toHaveBeenCalled();expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });
 it.each(['source','version','auth'])('does not reserve when %s has drifted',async variant=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedLegacy(h,3);const id=h.records[0].obligation_id;
  if(variant==='version')expect((await h.handler('assess',h.request({bootstrap:true,expected_version:2,source_record_sha256:hash(h.records[0]),unmatched_reference_key:REF},NEW_KEY),id)).status).toBe(409);
  if(variant==='source')expect((await h.handler('assess',h.request({bootstrap:true,expected_version:1,source_record_sha256:'f'.repeat(64),unmatched_reference_key:REF},NEW_KEY),id)).status).toBe(409);
  if(variant==='auth'){h.guard.mockImplementationOnce(async()=>({session:{operator_key:'f',credential_version:1},revalidate:vi.fn(async()=>{throw new AccessError('AUTH_REQUIRED',401);})} as any));expect((await bootstrap(h)).status).toBe(401);}
  expect(fetcher).not.toHaveBeenCalled();expect(h.snapshot().assessment_operations.some((o:any)=>o.bootstrap)).toBe(false);
 });
 it('verifies only the new operation and receipt through exact status; the old reference is never completed',async()=>{
  const h=harness();mockProvider(h);attest();seedLegacy(h,2);expect((await bootstrap(h)).status).toBe(200);
  const status=createGenuineAssessmentStatusHandler({guard:h.guard,source:h.source,repository:{loadExisting:h.repository.loadExisting}});
  const ask=async(k:string)=>(await status(new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idempotency_key:k})}),h.records[0].obligation_id)).json();
  expect(await ask(NEW_KEY)).toMatchObject({status:'COMPLETED_CURRENT',receipt:{assessment_id:`ASM-${NEW_KEY}`}});
  const old=await ask(REF);expect(old.status).toBe('NOT_FOUND');expect(old.receipt).toBeUndefined();
 });
});

describe('Stage 2 bootstrap persistence immutability',()=>{
 const base=():any=>({idempotency_key:NEW_KEY,obligation_id:'OBL',aggregate_version:1,status:'RESERVED',reserved_at:5,recovery:{generation:0,source_record_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64)},bootstrap:{kind:'CURRENT_SOURCE_BOOTSTRAP',source_record_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64),aggregate_version:1,unmatched_reference_key:REF,unmatched_reference_status:'UNVERIFIED_ABSENT_FROM_RECORDED_OPERATIONS'}});
 const other:any={idempotency_key:legacyKey(1),obligation_id:'OBL',aggregate_version:1,status:'COMPLETED',assessment_hash:'e'.repeat(64)};
 it('permits intended status progression and leaves unrelated records alone',()=>{
  const prior=base();
  expect(()=>assertBootstrapOperationPreservation([other],[other,prior])).not.toThrow();
  for(const next of [{...prior,status:'PROVIDER_RESULT_DURABLE'},{...prior,status:'UNKNOWN',recovery:{...prior.recovery,unknown_at:9}},{...prior,status:'STALE'},{...prior,status:'COMPLETED',assessment_hash:'e'.repeat(64)}])expect(()=>assertBootstrapOperationPreservation([other,prior],[other,next])).not.toThrow();
  expect(()=>assertBootstrapOperationPreservation([other],[{...other,status:'STALE'}])).not.toThrow();
 });
 it.each(['drop','reference','binding','source','version','strip','status-regression','unknown-regression','lineage','second','retrofit'])('rejects %s',variant=>{
  const prior=base();let next:any[]=[base()],old:any[]=[prior];
  if(variant==='drop')next=[];
  if(variant==='reference')next[0].bootstrap.unmatched_reference_key=OTHER_KEY;
  if(variant==='binding')next[0].recovery.binding_sha256='c'.repeat(64);
  if(variant==='source')next[0].bootstrap.source_record_sha256='c'.repeat(64);
  if(variant==='version')next[0].aggregate_version=2;
  if(variant==='strip')delete next[0].bootstrap;
  if(variant==='status-regression'){old=[{...prior,status:'COMPLETED',assessment_hash:'e'.repeat(64)}];next=[{...prior,status:'RESERVED'}];}
  if(variant==='unknown-regression'){old=[{...prior,status:'UNKNOWN',recovery:{...prior.recovery,unknown_at:9}}];next=[{...prior,status:'RESERVED'}];}
  if(variant==='lineage')next[0].recovery={...next[0].recovery,generation:1,predecessor_key:legacyKey(2),predecessor_sha256:'a'.repeat(64)};
  if(variant==='second'){old=[];next=[base(),{...base(),idempotency_key:legacyKey(7)}];}
  if(variant==='retrofit'){const plain=base();delete plain.bootstrap;old=[plain];}
  expect(()=>assertBootstrapOperationPreservation(old,next)).toThrow();
 });
 it('parser retains valid metadata and rejects malformed lineage, reference and binding',()=>{
  const h=harness(),id=h.records[0].obligation_id;const valid={...base(),obligation_id:id};h.snapshot().assessment_operations.push(structuredClone(valid));
  expect(parseDemoStateSnapshot(h.snapshot()).assessment_operations[0].bootstrap).toEqual(valid.bootstrap);
  const mutations:Array<(o:any)=>void>=[o=>{o.bootstrap.unmatched_reference_key='not-a-uuid';},o=>{o.bootstrap.binding_sha256='x';},o=>{o.bootstrap.extra=1;},o=>{o.bootstrap.unmatched_reference_key=o.idempotency_key;},o=>{delete o.recovery;},o=>{o.recovery.generation=1;o.recovery.predecessor_key=legacyKey(3);o.recovery.predecessor_sha256='a'.repeat(64);},o=>{o.recovery.source_record_sha256='c'.repeat(64);}];
  for(const mutate of mutations){const bad=structuredClone(h.snapshot());mutate(bad.assessment_operations[0]);expect(()=>parseDemoStateSnapshot(bad)).toThrow();}
 });
});

describe('Stage 2 refused bootstrap never mutates another operation',()=>{
 const expiredKey='55555555-5555-4555-8555-555555555555';
 function seedExpired(h:H,version:number){
  h.snapshot().assessment_operations.push({idempotency_key:expiredKey,obligation_id:h.records[0].obligation_id,aggregate_version:version,status:'RESERVED',reserved_at:Date.now()-500_000,recovery:{generation:0,source_record_sha256:hash(h.records[0]),binding_sha256:hash(h.source().state_binding)}});
  expect(()=>parseDemoStateSnapshot(h.snapshot())).not.toThrow();
 }
 it.each([['guard-disabled',1],['guard-disabled',2],['foreign-reference',1],['foreign-reference',2],['unresolved',1],['unresolved',2],['financial',1],['financial',2]] as const)('denies %s (older reservation at version %i) with unchanged bytes, no CAS and no provider',async(variant,version)=>{
  const h=harness(),fetcher=mockProvider(h);if(variant!=='guard-disabled')attest();seedLegacy(h,4);seedExpired(h,version);
  let ref=REF;if(variant==='foreign-reference'){h.snapshot().assessment_operations.push({idempotency_key:REF,obligation_id:h.records[1].obligation_id,aggregate_version:1,status:'STALE'});}
  if(variant==='financial')h.snapshot().execution_ledger.push({obligation_id:h.records[0].obligation_id,idempotency_key:'FICTIONAL-FIN',status:'UNKNOWN',atomic_amount:'1',destination_address:'0x'+'1'.repeat(40),provider_ref:null} as any);
  const before=JSON.stringify(h.snapshot());h.repository.compareAndSet.mockClear();
  const r=await bootstrap(h,NEW_KEY,ref);expect(r.status).toBeGreaterThanOrEqual(400);
  expect(JSON.stringify(h.snapshot())).toBe(before);expect(h.repository.compareAndSet).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it.each([['source','RESERVED'],['binding','RESERVED'],['version','RESERVED'],['source','COMPLETED'],['binding','COMPLETED']] as const)('refuses replay of a stored bootstrap whose %s proof is obsolete (%s): bytes unchanged, CAS 0, provider 0',async(field,status)=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedLegacy(h,4);
  const src=field==='source'?'1'.repeat(64):hash(h.records[0]),bind=field==='binding'?'2'.repeat(64):hash(h.source().state_binding),version=field==='version'?2:1;
  let sealedHash='';
  if(status==='COMPLETED'){const s=new DemoState(h.snapshot(),undefined,undefined,undefined,{},h.records);sealedHash=sealTestAssessment(s.store,'ORG-DEMO-001',h.records[0].obligation_id,1,{assessment_id:`ASM-${NEW_KEY}`,source_record_sha256:src}).assessment_hash;h.snapshot().authority=s.store.exportSnapshot();}
  h.snapshot().assessment_operations.push({idempotency_key:NEW_KEY,obligation_id:h.records[0].obligation_id,aggregate_version:version,status,reserved_at:status==='RESERVED'?Date.now()-500_000:1,...(status==='COMPLETED'?{assessment_hash:sealedHash}:{}),recovery:{generation:0,source_record_sha256:src,binding_sha256:bind},bootstrap:{kind:'CURRENT_SOURCE_BOOTSTRAP',source_record_sha256:src,binding_sha256:bind,aggregate_version:version,unmatched_reference_key:REF,unmatched_reference_status:'UNVERIFIED_ABSENT_FROM_RECORDED_OPERATIONS'}} as any);
  expect(()=>parseDemoStateSnapshot(h.snapshot())).not.toThrow();
  const before=JSON.stringify(h.snapshot());h.repository.compareAndSet.mockClear();
  const r=await bootstrap(h);expect(r.status).toBe(409);expect(JSON.stringify(h.snapshot())).toBe(before);expect(h.repository.compareAndSet).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });
 it('still permits own-bound replay and a normal eligible bootstrap',async()=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedLegacy(h,4);expect((await bootstrap(h)).status).toBe(200);expect(fetcher).toHaveBeenCalledOnce();
  expect((await bootstrap(h)).status).toBe(200);expect(fetcher).toHaveBeenCalledOnce();
  expect((await bootstrap(h,NEW_KEY,OTHER_KEY)).status).toBe(409);
  expect((await bootstrap(h,legacyKey(0),REF)).status).toBe(409);expect(fetcher).toHaveBeenCalledOnce();
 });
});
