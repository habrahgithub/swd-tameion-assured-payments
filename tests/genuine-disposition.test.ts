import {describe,it,expect,vi,afterEach} from 'vitest';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import {sealTestAssessment} from './test-support/seal-assessment';
import {syntheticSourceRecords} from './test-support/synthetic-source-records';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {DemoState,parseDemoStateSnapshot} from '../src/server/demo-state';
import {parseOperatorSource} from '../src/server/operator-source-records';
import {DemoStateConflictError} from '../src/server/supabase-demo-state-repository';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
import {createGenuineWorkflowHandlers} from '../src/server/genuine-workflow';
import {createGenuineAssessmentStatusHandler} from '../src/server/genuine-assessment-status';
import {validateLinkedActivation} from '../src/server/linked-instruction-activation';
import {bootstrapProtectionAttested,dispositionProtectionAttested} from '../src/server/genuine-admission';
import {assertDispositionPreservation,assertDispositionLineage} from '../src/server/genuine-disposition';
import type {AuthContext} from '../src/server/operator-auth';
const hash=(v:unknown)=>createHash('sha256').update(canonicalize(v)).digest('hex');
const LEGACY='11111111-1111-4111-8111-111111111111',CHILD='77777777-7777-4777-8777-777777777777',OTHER='88888888-8888-4888-8888-888888888888',HOLD_KEY='bbbbbbbb-bbbb-4bbb-8bbb-000000000000';
const APPROVAL='SYNTHETIC-APPROVAL-001';
const MINUTE=60_000;
// Synthetic public fixtures only: invented IDs, hashes, amounts and dates.
function harness(options:{basis?:boolean}={}){
 const records:any[]=syntheticSourceRecords().map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...r}:any)=>({...r,source_evidence:r.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));
 for(const r of records){const evidence=r.source_evidence[0];r.assessment_basis={transaction_type:'INVOICE',classification_evidence:evidence,timing:{basis:'INVOICE_CASH_TERM',date:r.effective_due_date,evidence},simulation:{mode:'HISTORICAL_AS_OF',as_of_date:'2020-01-05',evidence,owner_authority_reference:'SYNTHETIC-READMISSION'}};}
 if(options.basis===false)delete records[0].assessment_basis;
 let snapshot:any=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot(),revision=8;
 const {assessments,...base}=snapshot.authority;
 const state_binding={namespace:'FICTIONAL-GENUINE',revision:7,authority_sha256:hash(snapshot.authority),workflow_base_sha256:hash(base)};
 let bytes=Buffer.alloc(0);
 const source=vi.fn(()=>parseOperatorSource(bytes,createHash('sha256').update(bytes).digest('hex')));
 const publish=(admission?:unknown,mutate?:(records:any[])=>void)=>{const published=structuredClone(records);mutate?.(published);const packet:any={schema_version:3,record_count:5,provenance:'GENUINE_COMPANY_OBLIGATIONS',purpose:'GENUINE_ADVISORY_SOURCE',organization_id:'ORG-DEMO-001',state_binding,records:published,...(admission!==undefined?{owner_admission:admission}:{})};bytes=Buffer.from(JSON.stringify(packet));};
 publish();
 const repository={loadExisting:vi.fn(async()=>({revision,snapshot:structuredClone(snapshot) as any})),compareAndSet:vi.fn(async(_n:string,r:number,next:any)=>{if(r!==revision)throw new DemoStateConflictError();snapshot=structuredClone(next);return ++revision;})};
 const guard=vi.fn(async()=>({session:{operator_key:'fictional',credential_version:1},revalidate:vi.fn(async()=>{})} as unknown as AuthContext));
 const handler=createGenuineWorkflowHandlers({guard,source,repository});
 const request=(body:unknown,key=CHILD)=>new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
 return {records,state_binding,publish,source,repository,guard,handler,request,snapshot:()=>snapshot,revision:()=>revision,id:records[0].obligation_id as string};
}
type H=ReturnType<typeof harness>;
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});
const attest=(value='APPLIED_DISPOSITION_V1')=>vi.stubEnv('TAMEION_ASSESSMENT_BOOTSTRAP_GUARD',value);
/** Historical source-matched HOLD (completed, with its operation) plus one unbound legacy UNKNOWN: the representative current record. */
function seedRepresentative(h:H,extra:{unknown?:boolean}={}){
 const state=new DemoState(h.snapshot(),undefined,undefined,undefined,{},h.records);
 const sealed=sealTestAssessment(state.store,'ORG-DEMO-001',h.id,1,{assessment_id:`ASM-${HOLD_KEY}`,decision:'HOLD',source_record_sha256:hash(h.records[0])});
 h.snapshot().authority=state.store.exportSnapshot();
 h.snapshot().assessment_operations.push({idempotency_key:HOLD_KEY,obligation_id:h.id,aggregate_version:1,status:'COMPLETED',reserved_at:1,assessment_hash:sealed.assessment_hash,recovery:{generation:0,source_record_sha256:hash(h.records[0]),binding_sha256:hash(h.state_binding)}});
 if(extra.unknown!==false)h.snapshot().assessment_operations.push({idempotency_key:LEGACY,obligation_id:h.id,aggregate_version:1,status:'UNKNOWN',reserved_at:Date.now()-500_000});
}
const predecessor=(h:H)=>h.snapshot().assessment_operations.find((o:any)=>o.idempotency_key===LEGACY);
const admissionFor=(h:H,over:Record<string,unknown>={},now=Date.now())=>({kind:'CURRENT_SOURCE_REASSESSMENT_ADMISSION',approval_id:APPROVAL,obligation_id:h.id,aggregate_version:1,source_record_sha256:hash(h.records[0]),binding_sha256:hash(h.state_binding),predecessor_key:LEGACY,predecessor_sha256:hash(predecessor(h)),valid_from:new Date(now-MINUTE).toISOString(),expires_at:new Date(now+30*MINUTE).toISOString(),...over});
const bodyFor=(h:H,over:Record<string,unknown>={})=>({disposition:'CURRENT_SOURCE_REASSESSMENT',expected_version:1,source_record_sha256:hash(h.records[0]),approval_id:APPROVAL,predecessor_key:LEGACY,predecessor_sha256:hash(predecessor(h)),...over});
const dispose=(h:H,key=CHILD,over:Record<string,unknown>={},handler=h.handler)=>handler('assess',h.request(bodyFor(h,over),key),h.id);
const providerBody=(h:H,decision:'PAY'|'HOLD'='PAY')=>JSON.stringify({choices:[{message:{content:JSON.stringify({obligation_id:h.id,decision,finding_codes:[],evidence_ids:h.records[0].source_evidence.map((e:any)=>e.evidence_id),uncertainty_signal:decision!=='PAY',explanation:'Synthetic model output'})}}]});
function mockProvider(h:H,decision:'PAY'|'HOLD'='PAY'){vi.stubEnv('NVIDIA_API_KEY','OFFLINE_MOCK_ONLY');const fetcher=vi.fn(async()=>new Response(providerBody(h,decision),{status:200}));vi.stubGlobal('fetch',fetcher);return fetcher;}
async function genuineGet(h:H){
 const readers=createObligationReaders(h.guard,async(records,binding,_namespace,admission)=>loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:structuredClone(h.snapshot())})},h.source().state_binding.namespace,records,binding,admission),h.source,()=>undefined);
 return readers.detail(new Request('https://fixture.invalid'),h.id);
}
const statusOf=(h:H)=>{const status=createGenuineAssessmentStatusHandler({guard:h.guard,source:h.source,repository:{loadExisting:h.repository.loadExisting}});return async(key:string)=>(await status(new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idempotency_key:key})}),h.id)).json();};
const link=(h:H,assessment:any,key='c23a9d3a-39a1-4f36-9556-04f523969abc')=>h.handler('draft',h.request({expected_version:1,assessment_id:assessment.assessment_id,assessment_hash:assessment.assessment_hash},key),h.id);
/** Nothing may be written and no provider may be reached. */
async function expectRefusedBeforeEffects(h:H,fetcher:ReturnType<typeof mockProvider>,run:()=>Promise<Response>,codePattern?:RegExp){
 const before=JSON.stringify(h.snapshot()),calls=fetcher.mock.calls.length;h.repository.compareAndSet.mockClear();
 const response=await run(),data=await response.json();
 expect(response.status).toBeGreaterThanOrEqual(400);if(codePattern)expect(data.code).toMatch(codePattern);
 expect(fetcher.mock.calls.length).toBe(calls);expect(h.repository.compareAndSet).not.toHaveBeenCalled();expect(JSON.stringify(h.snapshot())).toBe(before);
}

describe('current-source assessment disposition: representative flow',()=>{
 it('HOLD + unbound legacy UNKNOWN → one admitted attempt → durable current receipt → actual linked draft; predecessor and HOLD unchanged',async()=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));
  const holdBefore=JSON.stringify(h.snapshot().assessment_operations.find((o:any)=>o.idempotency_key===HOLD_KEY)),predBefore=JSON.stringify(predecessor(h)),sealedBefore=JSON.stringify(h.snapshot().authority.assessments);
  const read=await(await genuineGet(h)).json();
  expect(read.genuine_assessment).toMatchObject({status:'UNKNOWN',recovery_eligible:false,disposition:{state:'AVAILABLE',approval_id:APPROVAL}});
  expect(JSON.stringify(read)).not.toContain(LEGACY);
  let reservedBeforeProvider=false;fetcher.mockImplementationOnce(async()=>{reservedBeforeProvider=h.snapshot().assessment_operations.some((o:any)=>o.idempotency_key===CHILD&&o.status==='RESERVED'&&o.legacy_disposition);return new Response(providerBody(h),{status:200});});
  const response=await dispose(h);expect(response.status).toBe(200);const receipt=await response.json();
  expect(fetcher).toHaveBeenCalledOnce();expect(reservedBeforeProvider).toBe(true);expect(receipt.assessment_id).toBe(`ASM-${CHILD}`);
  const ops=h.snapshot().assessment_operations,child=ops.find((o:any)=>o.idempotency_key===CHILD);
  expect(child).toMatchObject({status:'COMPLETED',aggregate_version:1,recovery:{generation:0,source_record_sha256:hash(h.records[0]),binding_sha256:hash(h.state_binding)},legacy_disposition:{kind:'CURRENT_SOURCE_REASSESSMENT',predecessor_key:LEGACY,predecessor_sha256:hash(predecessor(h)),prior_binding_status:'UNVERIFIED',admission:{approval_id:APPROVAL},admission_sha256:hash(child.legacy_disposition.admission)}});
  expect(child.recovery.predecessor_key).toBeUndefined();
  expect(JSON.stringify(predecessor(h))).toBe(predBefore);expect(JSON.stringify(ops.find((o:any)=>o.idempotency_key===HOLD_KEY))).toBe(holdBefore);
  expect(JSON.stringify(h.snapshot().authority.assessments.slice(0,1))).toBe(sealedBefore);
  expect(parseDemoStateSnapshot(h.snapshot()).assessment_operations.find(o=>o.idempotency_key===CHILD)?.legacy_disposition?.admission.approval_id).toBe(APPROVAL);
  // Exact status: the old UUID keeps reporting UNKNOWN; only the new key is a current receipt.
  const ask=statusOf(h);expect(await ask(LEGACY)).toMatchObject({status:'UNKNOWN',historically_superseded:true});expect((await ask(LEGACY)).receipt).toBeUndefined();
  expect(await ask(CHILD)).toMatchObject({status:'COMPLETED_CURRENT',receipt:{assessment_id:`ASM-${CHILD}`,assessment_hash:receipt.assessment_hash}});
  // Real read projection: separate current receipt, historical predecessor annotated, no identifiers leaked.
  const after=await(await genuineGet(h)).json();
  expect(after).toMatchObject({current_assessment:{assessment_id:`ASM-${CHILD}`},genuine_assessment:{status:'COMPLETED',recovery_eligible:false,recovery_reason:'DISPOSITION_CLOSED',historical_unresolved:{status:'UNKNOWN',superseded:true},disposition:{state:'USED',child_status:'COMPLETED',child_current:true,prior_binding_status:'UNVERIFIED'}}});
  // The unresolved request's identifier is never projected (the child's receipt id is the public current receipt).
  expect(JSON.stringify(after)).not.toContain(LEGACY);
  // The actual linked-draft route succeeds on the new receipt.
  const drafted=await link(h,receipt);expect(drafted.status).toBe(201);
  expect((await drafted.json()).instruction).toMatchObject({assessment_id:`ASM-${CHILD}`,source_record_sha256:hash(h.records[0]),status:'DRAFT_AUTHORITY_REQUIRED'});
  expect(h.snapshot().linked_settlement_instructions).toHaveLength(1);
  // Replay of the same key is a read of the stored result, never a second dispatch.
  expect((await dispose(h)).status).toBe(200);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('keeps working after the admission block is removed or expires: lawful historical proof, status and linked use survive',async()=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));
  const receipt=await(await dispose(h)).json();h.publish();// admission removed; source bytes (and so the env digest) are re-approved without it
  expect(await statusOf(h)(CHILD)).toMatchObject({status:'COMPLETED_CURRENT'});
  expect((await link(h,receipt)).status).toBe(201);expect(fetcher).toHaveBeenCalledOnce();
  // The stored key replays its stored result only; with the admission gone no new attempt can be started.
  expect((await dispose(h,CHILD)).status).toBe(200);expect(fetcher).toHaveBeenCalledOnce();
  const second=harness(),fetcher2=mockProvider(second);seedRepresentative(second);second.publish();
  await expectRefusedBeforeEffects(second,fetcher2,()=>dispose(second),/ADMISSION_MISSING/);
 });
});

describe('current-source assessment disposition: admission gates (all refuse before any write or provider call)',()=>{
 it('is off without the NEW guard attestation; the older bootstrap value never authorizes it',async()=>{
  const h=harness(),fetcher=mockProvider(h);seedRepresentative(h);h.publish(admissionFor(h));
  for(const value of [undefined,'APPLIED','applied_disposition_v1','APPLIED_DISPOSITION_V2','']){
   if(value===undefined)vi.unstubAllEnvs();else attest(value);mockProvider(h);
   await expectRefusedBeforeEffects(h,fetcher,()=>dispose(h),/GUARD_UNATTESTED|PROVIDER|UNATTESTED/);
   expect(dispositionProtectionAttested()).toBe(false);
  }
  attest('APPLIED');expect(bootstrapProtectionAttested()).toBe(true);expect(dispositionProtectionAttested()).toBe(false);
  attest('APPLIED_DISPOSITION_V1');expect(dispositionProtectionAttested()).toBe(true);expect(bootstrapProtectionAttested()).toBe(true);
  expect((await(await genuineGet(h)).json()).genuine_assessment.disposition).toMatchObject({state:'AVAILABLE'});
  vi.unstubAllEnvs();attest('APPLIED');expect((await(await genuineGet(h)).json()).genuine_assessment.disposition).toMatchObject({state:'UNAVAILABLE',reason:'GUARD_UNATTESTED'});
 });
 it.each([
  ['absent admission',(h:H)=>h.publish(),/ADMISSION_MISSING/],
  ['malformed admission',(h:H)=>h.publish({kind:'CURRENT_SOURCE_REASSESSMENT_ADMISSION',approval_id:APPROVAL}),/ADMISSION_INVALID/],
  ['extra-key admission',(h:H)=>h.publish({...admissionFor(h),generic_flag:true}),/ADMISSION_INVALID/],
  ['window over one hour',(h:H)=>h.publish(admissionFor(h,{expires_at:new Date(Date.now()+61*MINUTE).toISOString()})),/ADMISSION_INVALID/],
  ['expired admission',(h:H)=>h.publish(admissionFor(h,{valid_from:new Date(Date.now()-20*MINUTE).toISOString(),expires_at:new Date(Date.now()-MINUTE).toISOString()})),/ADMISSION_EXPIRED/],
  ['future admission',(h:H)=>h.publish(admissionFor(h,{valid_from:new Date(Date.now()+MINUTE).toISOString(),expires_at:new Date(Date.now()+20*MINUTE).toISOString()})),/NOT_YET_VALID/],
  ['wrong predecessor hash',(h:H)=>h.publish(admissionFor(h,{predecessor_sha256:'f'.repeat(64)})),/MISMATCH|PREDECESSOR/],
  ['wrong predecessor key',(h:H)=>h.publish(admissionFor(h,{predecessor_key:OTHER})),/MISMATCH|PREDECESSOR/],
  ['wrong source record hash',(h:H)=>h.publish(admissionFor(h,{source_record_sha256:'e'.repeat(64)})),/SOURCE_CHANGED/],
  ['wrong binding hash',(h:H)=>h.publish(admissionFor(h,{binding_sha256:'e'.repeat(64)})),/SOURCE_CHANGED/],
  ['wrong version',(h:H)=>h.publish(admissionFor(h,{aggregate_version:2})),/VERSION_MISMATCH/],
  ['wrong target',(h:H)=>h.publish(admissionFor(h,{obligation_id:h.records[1].obligation_id})),/ADMISSION_MISMATCH/],
 ])('refuses %s',async(_name,arrange,pattern)=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedRepresentative(h);arrange(h);
  await expectRefusedBeforeEffects(h,fetcher,()=>dispose(h),pattern);
  // A bad admission disables only this capability: the underlying source stays readable and read-only.
  expect((await genuineGet(h)).status).toBe(200);
 });
 it.each([
  ['request names another approval',{approval_id:'OTHER-APPROVAL'}],
  ['request names another predecessor hash',{predecessor_sha256:'d'.repeat(64)}],
  ['request names another predecessor',{predecessor_key:OTHER}],
  ['request source hash drift',{source_record_sha256:'c'.repeat(64)}],
  ['request version drift',{expected_version:2}],
 ])('refuses when the %s',async(_name,over)=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));
  await expectRefusedBeforeEffects(h,fetcher,()=>dispose(h,CHILD,over));
 });
 it.each(['unrelated-unknown','unrelated-reserved','financial-history','cap-reached','predecessor-with-recovery','predecessor-with-sealed-receipt','predecessor-not-unknown'])('refuses %s',async variant=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedRepresentative(h);
  const ops=h.snapshot().assessment_operations;
  if(variant==='unrelated-unknown')ops.push({idempotency_key:OTHER,obligation_id:h.id,aggregate_version:1,status:'UNKNOWN',reserved_at:1});
  if(variant==='unrelated-reserved')ops.push({idempotency_key:OTHER,obligation_id:h.id,aggregate_version:1,status:'RESERVED',reserved_at:Date.now()});
  if(variant==='financial-history')h.snapshot().execution_ledger.push({obligation_id:h.id,idempotency_key:'SYNTHETIC-FIN',status:'UNKNOWN',atomic_amount:'1',destination_address:'0x'+'1'.repeat(40),provider_ref:null});
  if(variant==='cap-reached')for(let i=1;i<=3;i++)ops.push({idempotency_key:`cccccccc-cccc-4ccc-8ccc-00000000000${i}`,obligation_id:h.id,aggregate_version:1,status:'STALE'});
  if(variant==='predecessor-with-recovery')predecessor(h).recovery={generation:0,source_record_sha256:hash(h.records[0]),binding_sha256:hash(h.state_binding),unknown_at:5};
  if(variant==='predecessor-with-sealed-receipt'){const s=new DemoState(h.snapshot(),undefined,undefined,undefined,{},h.records);sealTestAssessment(s.store,'ORG-DEMO-001',h.id,1,{assessment_id:`ASM-${LEGACY}`});h.snapshot().authority=s.store.exportSnapshot();}
  if(variant==='predecessor-not-unknown')predecessor(h).status='STALE';
  h.publish(admissionFor(h));
  await expectRefusedBeforeEffects(h,fetcher,()=>dispose(h));
 });
 it('refuses a second disposition for the obligation across versions and keys',async()=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));
  expect((await dispose(h)).status).toBe(200);const calls=fetcher.mock.calls.length;
  await expectRefusedBeforeEffects(h,fetcher,()=>dispose(h,OTHER),/ALREADY_USED/);
  expect(fetcher.mock.calls.length).toBe(calls);
 });
 it('denies a missing or invalid deterministic timing basis before the attempt is spent, for the disposition and ordinary assessment alike',async()=>{
  const h=harness({basis:false}),fetcher=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));
  await expectRefusedBeforeEffects(h,fetcher,()=>dispose(h),/BASIS_INVALID|TIMING_BASIS/);
  await expectRefusedBeforeEffects(h,fetcher,()=>h.handler('assess',h.request({},OTHER),h.id),/BASIS_INVALID/);
  // An as-of date in the future is a bypass attempt of the same contract.
  const bad=harness();mockProvider(bad);attest();seedRepresentative(bad);
  bad.publish(admissionFor(bad,{source_record_sha256:hash({...bad.records[0],assessment_basis:{...bad.records[0].assessment_basis,simulation:{...bad.records[0].assessment_basis.simulation,as_of_date:'2999-01-01'}}})}),records=>{records[0].assessment_basis.simulation.as_of_date='2999-01-01';});
  const refused=await dispose(bad,CHILD,{source_record_sha256:hash(bad.source().records[0])});expect(refused.status).toBeGreaterThanOrEqual(409);expect(bad.snapshot().assessment_operations.some((o:any)=>o.idempotency_key===CHILD)).toBe(false);
 });
 it('uses exact window boundaries: valid_from <= reserved_at < expires_at',async()=>{
  vi.useFakeTimers();const start=Date.parse('2026-10-19T12:00:00.000Z');
  for(const [offset,allowed] of [[-1,false],[0,true],[30*MINUTE-1,true],[30*MINUTE,false]] as const){
   vi.setSystemTime(start+offset);const h=harness(),fetcher=mockProvider(h);attest();seedRepresentative(h);
   h.publish(admissionFor(h,{valid_from:new Date(start).toISOString(),expires_at:new Date(start+30*MINUTE).toISOString()},start));
   const response=await dispose(h);expect(response.status===200,`offset ${offset}`).toBe(allowed);expect(fetcher.mock.calls.length).toBe(allowed?1:0);
   if(!allowed)expect(h.snapshot().assessment_operations.some((o:any)=>o.legacy_disposition)).toBe(false);
  }
 });
 it('refuses dispatch and keeps the consumed attempt when the window closes during the reservation save',async()=>{
  vi.useFakeTimers();const start=Date.parse('2026-10-19T12:00:00.000Z');vi.setSystemTime(start);
  const h=harness(),fetcher=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h,{valid_from:new Date(start-MINUTE).toISOString(),expires_at:new Date(start+10_000).toISOString()},start));
  const original=h.repository.compareAndSet.getMockImplementation()!;
  // The window closes while the reservation is being saved (kept inside the 45 s request budget).
  h.repository.compareAndSet.mockImplementation(async(n:string,r:number,next:any)=>{const out=await original(n,r,next);vi.setSystemTime(start+10_000);return out;});
  const response=await dispose(h);expect(response.status).toBe(409);expect(await response.json()).toMatchObject({code:'GENUINE_DISPOSITION_WINDOW_CLOSED'});
  expect(fetcher).not.toHaveBeenCalled();
  const child=h.snapshot().assessment_operations.find((o:any)=>o.idempotency_key===CHILD);expect(child).toMatchObject({status:'RESERVED',legacy_disposition:{kind:'CURRENT_SOURCE_REASSESSMENT'}});
  // No replacement UUID and no second dispatch, even with a fresh window.
  h.repository.compareAndSet.mockImplementation(original);h.publish(admissionFor(h,{},start+10_000));
  await expectRefusedBeforeEffects(h,fetcher,()=>dispose(h,OTHER),/ALREADY_USED/);
  expect((await dispose(h)).status).toBe(202);expect(fetcher).not.toHaveBeenCalled();
 });
});

describe('current-source assessment disposition: concurrency, replay and failure',()=>{
 it('admits at most one reservation and one provider dispatch across tabs and different keys; losers fail before dispatch and mutation',async()=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));
  const tabs=Array.from({length:5},()=>createGenuineWorkflowHandlers({guard:h.guard,source:h.source,repository:h.repository}));
  const responses=await Promise.all(tabs.map((tab,i)=>dispose(h,`7777777${i}-7777-4777-8777-777777777777`,{},tab)));
  expect(responses.filter(r=>r.status===200)).toHaveLength(1);expect(fetcher).toHaveBeenCalledOnce();
  expect(h.snapshot().assessment_operations.filter((o:any)=>o.legacy_disposition)).toHaveLength(1);
  const winner=(h.snapshot().assessment_operations.find((o:any)=>o.legacy_disposition) as any).idempotency_key;
  expect((await dispose(h,winner)).status).toBe(200);expect(fetcher).toHaveBeenCalledOnce();
  expect((await dispose(h,'99999999-9999-4999-8999-999999999999')).status).toBe(409);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('seals a same-key durable provider result without dispatching the provider again',async()=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));
  const original=h.repository.compareAndSet.getMockImplementation()!;let failed=false;
  h.repository.compareAndSet.mockImplementation(async(n:string,r:number,next:any)=>{const child=next.assessment_operations.find((o:any)=>o.idempotency_key===CHILD);if(child?.status==='COMPLETED'&&!failed){failed=true;throw new Error('PERSISTENCE_FAULT');}return original(n,r,next);});
  const first=await dispose(h);expect(first.status).toBe(503);expect(fetcher).toHaveBeenCalledOnce();
  expect(h.snapshot().assessment_operations.find((o:any)=>o.idempotency_key===CHILD)).toMatchObject({status:'PROVIDER_RESULT_DURABLE',provider_result:{assessment_id:`ASM-${CHILD}`}});
  const replay=await dispose(h);expect(replay.status).toBe(200);expect(fetcher).toHaveBeenCalledOnce();
  expect(h.snapshot().assessment_operations.find((o:any)=>o.idempotency_key===CHILD)).toMatchObject({status:'COMPLETED'});
  expect(h.snapshot().authority.assessments.filter((a:any)=>a.record.assessment_id===`ASM-${CHILD}`)).toHaveLength(1);
 });
 it('a replay with a different identity, or after source/version drift, is refused without mutation',async()=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));
  expect((await dispose(h)).status).toBe(200);
  await expectRefusedBeforeEffects(h,fetcher,()=>dispose(h,CHILD,{approval_id:'OTHER-APPROVAL'}),/IDENTITY_MISMATCH/);
  await expectRefusedBeforeEffects(h,fetcher,()=>dispose(h,CHILD,{predecessor_sha256:'d'.repeat(64)}),/IDENTITY_MISMATCH/);
  await expectRefusedBeforeEffects(h,fetcher,()=>dispose(h,LEGACY),/IDENTITY_MISMATCH/);
  h.publish(admissionFor(h),records=>{records[0].commercial_terms='SYNTHETIC OWNER READMISSION';});
  await expectRefusedBeforeEffects(h,fetcher,()=>h.handler('assess',h.request({disposition:'CURRENT_SOURCE_REASSESSMENT',expected_version:1,source_record_sha256:hash(h.source().records[0]),approval_id:APPROVAL,predecessor_key:LEGACY,predecessor_sha256:hash(predecessor(h))},CHILD),h.id),/SOURCE_BINDING_CHANGED|MISMATCH/);
 });
 it('a child that becomes UNKNOWN stops: no generation-1 recovery, no second disposition, no ordinary assessment, no linked draft',async()=>{
  const h=harness();attest();seedRepresentative(h);h.publish(admissionFor(h));vi.stubEnv('NVIDIA_API_KEY','OFFLINE_MOCK_ONLY');
  const failing=vi.fn(async()=>{throw new Error('timeout');});vi.stubGlobal('fetch',failing);
  const first=await dispose(h);expect(first.status).toBe(409);expect(await first.json()).toMatchObject({status:'UNKNOWN'});
  const child=h.snapshot().assessment_operations.find((o:any)=>o.idempotency_key===CHILD);expect(child).toMatchObject({status:'UNKNOWN',recovery:{generation:0,unknown_at:expect.any(Number)}});
  const calls=failing.mock.calls.length,fetcher=mockProvider(h);
  const read=await(await genuineGet(h)).json();expect(read.genuine_assessment).toMatchObject({status:'UNKNOWN',recovery_eligible:false,recovery_reason:'DISPOSITION_CLOSED'});
  vi.useFakeTimers();vi.setSystemTime(Date.now()+10*MINUTE);
  await expectRefusedBeforeEffects(h,fetcher,()=>h.handler('assess',h.request({recovery:true,expected_version:1,source_record_sha256:hash(h.records[0])},OTHER),h.id));
  await expectRefusedBeforeEffects(h,fetcher,()=>dispose(h,OTHER),/ALREADY_USED|ADMISSION/);
  await expectRefusedBeforeEffects(h,fetcher,()=>h.handler('assess',h.request({},OTHER),h.id),/UNRESOLVED|ASM-|GENUINE_/);
  await expectRefusedBeforeEffects(h,fetcher,()=>link(h,{assessment_id:`ASM-${HOLD_KEY}`,assessment_hash:h.snapshot().authority.assessments[0].hash}));
  expect(failing.mock.calls.length).toBe(calls);
 });
 it('source, version or binding drift invalidates current use of the child receipt without resetting the one-child budget',async()=>{
  const h=harness(),fetcher=mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));
  const receipt=await(await dispose(h)).json();
  h.publish(undefined,records=>{records[0].commercial_terms='SYNTHETIC OWNER READMISSION';});
  const ask=statusOf(h);expect((await ask(CHILD)).status).toBe('STALE');
  expect((await(await genuineGet(h)).json()).current_assessment).toBeNull();
  await expectRefusedBeforeEffects(h,fetcher,()=>link(h,receipt),/CURRENT_GENUINE_ASSESSMENT_REQUIRED/);
  // A fresh admission for the new source cannot reuse the budget: a disposition already exists for this obligation.
  const changed=h.source().records[0];h.publish(admissionFor(h,{source_record_sha256:hash(changed)}),records=>{records[0].commercial_terms='SYNTHETIC OWNER READMISSION';});
  await expectRefusedBeforeEffects(h,fetcher,()=>dispose(h,OTHER,{source_record_sha256:hash(h.source().records[0])}),/ALREADY_USED/);
 });
 it('a late old-identity receipt or mutated predecessor is rejected by parsing and by the preservation mirror of the SQL guard',async()=>{
  const h=harness();mockProvider(h);attest();seedRepresentative(h);h.publish(admissionFor(h));await dispose(h);
  const good=h.snapshot();expect(()=>parseDemoStateSnapshot(good)).not.toThrow();
  const late=structuredClone(good);const s=new DemoState(good,undefined,undefined,undefined,{},h.records);sealTestAssessment(s.store,'ORG-DEMO-001',h.id,1,{assessment_id:`ASM-${LEGACY}`});late.authority=s.store.exportSnapshot();
  expect(()=>parseDemoStateSnapshot(late)).toThrow();
  expect(()=>assertDispositionPreservation(good.assessment_operations,late.assessment_operations,late.authority.assessments.map((a:any)=>a.record.assessment_id))).toThrow();
  const mutated=structuredClone(good);mutated.assessment_operations.find((o:any)=>o.idempotency_key===LEGACY).reserved_at=1;
  expect(()=>parseDemoStateSnapshot(mutated)).toThrow();expect(()=>assertDispositionPreservation(good.assessment_operations,mutated.assessment_operations)).toThrow();
 });
});

describe('disposition lineage and preservation rules',()=>{
 const key=(n:number)=>`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`;
 function lineage(){
  const pred:any={idempotency_key:LEGACY,obligation_id:'OBL',aggregate_version:1,status:'UNKNOWN',reserved_at:1};
  const admission:any={kind:'CURRENT_SOURCE_REASSESSMENT_ADMISSION',approval_id:APPROVAL,obligation_id:'OBL',aggregate_version:1,source_record_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64),predecessor_key:LEGACY,predecessor_sha256:hash(pred),valid_from:'2026-10-19T12:00:00.000Z',expires_at:'2026-10-19T12:30:00.000Z'};
  const child:any={idempotency_key:CHILD,obligation_id:'OBL',aggregate_version:1,status:'RESERVED',reserved_at:Date.parse('2026-10-19T12:10:00.000Z'),recovery:{generation:0,source_record_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64)},legacy_disposition:{kind:'CURRENT_SOURCE_REASSESSMENT',predecessor_key:LEGACY,predecessor_sha256:admission.predecessor_sha256,prior_binding_status:'UNVERIFIED',admission,admission_sha256:hash(admission)}};
  return {pred,child,admission};
 }
 it('accepts a coherent pair and permits only status progression',()=>{
  const {pred,child}=lineage();expect(()=>assertDispositionLineage([pred,child])).not.toThrow();
  expect(()=>assertDispositionPreservation([pred],[pred,child])).not.toThrow();
  for(const next of [{...child,status:'PROVIDER_RESULT_DURABLE'},{...child,status:'UNKNOWN',recovery:{...child.recovery,unknown_at:9}},{...child,status:'STALE'},{...child,status:'COMPLETED',assessment_hash:'e'.repeat(64)}])expect(()=>assertDispositionPreservation([pred,child],[pred,next])).not.toThrow();
 });
 it.each(['drop-child','drop-predecessor','mutate-predecessor','mutate-evidence','change-window','strip-disposition','status-regression','retrofit','second-disposition','sealed-predecessor-receipt','other-unresolved-at-creation','hash-mismatch','window-excludes-reservation','bootstrap-graft'])('rejects %s',variant=>{
  const {pred,child,admission}=lineage();let old:any[]=[pred,child],next:any[]=[structuredClone(pred),structuredClone(child)],sealed:string[]=[],creation=false;
  if(variant==='drop-child')next=[pred];
  if(variant==='drop-predecessor')next=[child];
  if(variant==='mutate-predecessor')next[0].reserved_at=2;
  if(variant==='mutate-evidence')next[1].legacy_disposition.admission.approval_id='OTHER';
  if(variant==='change-window')next[1].legacy_disposition.admission.expires_at='2026-10-19T14:00:00.000Z';
  if(variant==='strip-disposition')delete next[1].legacy_disposition;
  if(variant==='status-regression'){old=[pred,{...child,status:'COMPLETED',assessment_hash:'e'.repeat(64)}];next=[pred,{...child,status:'RESERVED'}];}
  if(variant==='retrofit'){const plain=structuredClone(child);delete plain.legacy_disposition;old=[pred,plain];}
  if(variant==='second-disposition'){old=[pred];creation=true;next=[pred,child,{...structuredClone(child),idempotency_key:OTHER}];}
  if(variant==='sealed-predecessor-receipt')sealed=[`ASM-${LEGACY}`];
  if(variant==='other-unresolved-at-creation'){old=[pred,{idempotency_key:OTHER,obligation_id:'OBL',aggregate_version:1,status:'UNKNOWN',reserved_at:1}];next=[...old,child];creation=true;}
  if(variant==='hash-mismatch'){next[1].legacy_disposition.predecessor_sha256='c'.repeat(64);}
  if(variant==='window-excludes-reservation'){const bad=structuredClone(child);bad.reserved_at=Date.parse('2026-10-19T12:40:00.000Z');expect(()=>assertDispositionLineage([pred,bad])).toThrow();return;}
  if(variant==='bootstrap-graft')next[1].bootstrap={};
  void admission;void creation;
  const check=()=>{assertDispositionPreservation(old,next,sealed);if(variant==='hash-mismatch'||variant==='mutate-evidence'||variant==='change-window'||variant==='bootstrap-graft')assertDispositionLineage(next,sealed);};
  expect(check).toThrow();
 });
});
