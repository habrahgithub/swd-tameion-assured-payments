import {describe,it,expect,vi,afterEach} from 'vitest';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import {sealTestAssessment} from './test-support/seal-assessment';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {DemoState,parseDemoStateSnapshot} from '../src/server/demo-state';
import {parseOperatorSource} from '../src/server/operator-source-records';
import {DemoStateConflictError} from '../src/server/supabase-demo-state-repository';
import {projectObligationDetail,projectObligationListData} from '../src/server/obligation-read-model';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
import {assertLinkedHistoryAppend,parseLinkedInstructions} from '../src/domain/linked-instruction';
import {validateLinkedActivation} from '../src/server/linked-instruction-activation';
import {createGenuineWorkflowHandlers,assertGenuineSnapshotSize,GENUINE_REQUEST_BUDGET_MS,MAX_GENUINE_SNAPSHOT_BYTES} from '../src/server/genuine-workflow';
import {syntheticSourceRecords} from './test-support/synthetic-source-records';
import type {AuthContext} from '../src/server/operator-auth';
const hash=(v:unknown)=>createHash('sha256').update(canonicalize(v)).digest('hex');
function harness(){
 const records=syntheticSourceRecords().map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...r}:any)=>({...r,source_evidence:r.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));for(const r of records){const evidence=r.source_evidence[0];r.assessment_basis={transaction_type:'INVOICE',classification_evidence:evidence,timing:{basis:'INVOICE_CASH_TERM',date:r.effective_due_date,evidence},simulation:{mode:'HISTORICAL_AS_OF',as_of_date:'2020-01-05',evidence,owner_authority_reference:'SYNTHETIC-READMISSION'}};}let snapshot=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot(),revision=7;
 const {assessments,...base}=snapshot.authority;
 const packet={schema_version:3,record_count:5,provenance:'GENUINE_COMPANY_OBLIGATIONS',purpose:'GENUINE_ADVISORY_SOURCE',organization_id:'ORG-DEMO-001',state_binding:{namespace:'FICTIONAL-GENUINE',revision:7,authority_sha256:hash(snapshot.authority),workflow_base_sha256:hash(base)},records};
 const bytes=Buffer.from(JSON.stringify(packet)); const source=vi.fn(()=>parseOperatorSource(bytes,createHash('sha256').update(bytes).digest('hex')));
 const repository={loadExisting:vi.fn(async()=>({revision,snapshot:structuredClone(snapshot) as any})),compareAndSet:vi.fn(async(_n:string,r:number,next:any)=>{if(r!==revision)throw new DemoStateConflictError();snapshot=structuredClone(next);return ++revision;})};
 const guard=vi.fn(async()=>({session:{operator_key:'fictional',credential_version:1},revalidate:vi.fn(async()=>{})} as unknown as AuthContext));
 const handler=createGenuineWorkflowHandlers({guard,source,repository});
 const request=(body:unknown,key='c23a9d3a-39a1-4f36-9556-04f523969abb')=>new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
 return {records,source,repository,guard,handler,request,snapshot:()=>snapshot,revision:()=>revision};
}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();vi.unstubAllEnvs();vi.unstubAllGlobals();});
describe('genuine advisory and separate linked instruction',()=>{
 it('assesses genuine source durably without payment authority and survives source-bound reload',async()=>{
  vi.stubEnv('NVIDIA_API_KEY',undefined);const h=harness(),id=h.records[0].obligation_id;const before=structuredClone(h.snapshot());
  const response=await h.handler('assess',h.request({}),id);expect(response.status).toBe(200);expect(h.snapshot().authority.assessments).toHaveLength(1);
  expect(h.snapshot().authority.aggregates).toEqual(before.authority.aggregates);expect(h.snapshot().authorization_history).toEqual([]);expect(h.snapshot().execution_ledger).toEqual([]);
  const view=h.source();const restored=await loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:h.snapshot()})},view.state_binding.namespace,view.records,view.state_binding);expect(restored.store.getCurrentAssessment('ORG-DEMO-001',id)).toBeTruthy();
  const replay=await h.handler('assess',h.request({}),id);expect(replay.status).toBe(200);expect(h.snapshot().authority.assessments).toHaveLength(1);
  expect(parseDemoStateSnapshot(h.snapshot()).authority.assessments).toHaveLength(1);
 });
 it('creates one CAS-protected linked draft, preserving genuine source and all attempts on restart',async()=>{
  vi.stubEnv('NVIDIA_API_KEY',undefined);const h=harness(),id=h.records[0].obligation_id;const a=await(await h.handler('assess',h.request({}),id)).json();
  const body={expected_version:1,assessment_id:a.assessment_id,assessment_hash:a.assessment_hash};const before=structuredClone(h.snapshot());
  const result=await h.handler('draft',h.request(body,'c23a9d3a-39a1-4f36-9556-04f523969abc'),id);expect(result.status).toBe(201);const d=await result.json();
  expect(d.instruction).toMatchObject({kind:'ARC_TESTNET_SETTLEMENT_INSTRUCTION',status:'DRAFT_AUTHORITY_REQUIRED',source_obligation_id:id,assessment_id:a.assessment_id,source_record_sha256:hash(h.records[0])});
  expect(h.snapshot().authority).toEqual(before.authority);expect(h.snapshot().execution_ledger).toEqual(before.execution_ledger);
  const replay=await h.handler('draft',h.request(body,'c23a9d3a-39a1-4f36-9556-04f523969abc'),id);expect(replay.status).toBe(200);
  const parsed=parseDemoStateSnapshot(h.snapshot());expect((parsed as any).linked_settlement_instructions).toHaveLength(1);
  expect((new DemoState(parsed).exportSnapshot() as any).linked_settlement_instructions).toEqual((h.snapshot() as any).linked_settlement_instructions);
 });
 it('rejects client authority, wrong version, missing assessment and unknown source before any write',async()=>{
  const h=harness(),id=h.records[0].obligation_id;
  for(const body of [{financial_action_eligible:true},{amount:'1.00'}])expect((await h.handler('assess',h.request(body),id)).status).toBe(400);
  expect((await h.handler('assess',h.request({}),'UNKNOWN')).status).toBe(404);
  expect((await h.handler('draft',h.request({expected_version:1,assessment_id:'missing',assessment_hash:'a'.repeat(64)}),id)).status).toBe(409);
  expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });
 it('concurrent draft requests converge to one immutable instruction without a provider call',async()=>{
  vi.stubEnv('NVIDIA_API_KEY',undefined);const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const h=harness(),id=h.records[0].obligation_id;
  const a=await(await h.handler('assess',h.request({}),id)).json(),body={expected_version:1,assessment_id:a.assessment_id,assessment_hash:a.assessment_hash};
  const outcomes=await Promise.all([h.handler('draft',h.request(body,'c23a9d3a-39a1-4f36-9556-04f523969ab1'),id),h.handler('draft',h.request(body,'c23a9d3a-39a1-4f36-9556-04f523969ab2'),id)]);
  expect(outcomes.map(r=>r.status).sort()).toEqual([200,201]);expect(h.snapshot().linked_settlement_instructions).toHaveLength(1);expect(fetcher).not.toHaveBeenCalled();
  const links=h.snapshot().linked_settlement_instructions!;expect(()=>assertLinkedHistoryAppend(links,undefined)).toThrow();expect(()=>assertLinkedHistoryAppend(links,[])).toThrow();expect(()=>parseLinkedInstructions([{...links[0],source_amount:'99.00'}])).toThrow();
 });
 it('rejects source/version drift and fake linked activation while preserving genuine OUTSTANDING',async()=>{
  vi.stubEnv('NVIDIA_API_KEY',undefined);const h=harness(),id=h.records[0].obligation_id,a=await(await h.handler('assess',h.request({}),id)).json();
  const d=await(await h.handler('draft',h.request({expected_version:1,assessment_id:a.assessment_id,assessment_hash:a.assessment_hash},'c23a9d3a-39a1-4f36-9556-04f523969abc'),id)).json();
  const activation:any={organization_id:'ORG-DEMO-001',namespace:'FICTIONAL-SEPARATE-CONTROLLED',source:{obligation_id:d.instruction.instruction_id,amount:h.records[0].amount,currency:h.records[0].currency},linked_instruction:{source_obligation_id:id,instruction_content_sha256:d.instruction.instruction_content_sha256}};
  expect(()=>validateLinkedActivation(activation,h.source(),h.snapshot(),h.revision())).not.toThrow();
  expect(()=>validateLinkedActivation({...activation,namespace:h.source().state_binding.namespace},h.source(),h.snapshot(),h.revision())).toThrow();
  expect(()=>validateLinkedActivation({...activation,linked_instruction:{...activation.linked_instruction,instruction_content_sha256:'0'.repeat(64)}},h.source(),h.snapshot(),h.revision())).toThrow();
  h.snapshot().authority.aggregates[0].aggregate_version++;
  expect(()=>validateLinkedActivation(activation,h.source(),h.snapshot(),h.revision())).toThrow();
  expect((await h.handler('assess',h.request({}),id)).status).toBe(503);
  expect(h.source().records[0].state_at_event_baseline).toBe('OUTSTANDING');
 });
 it('keeps V1/V2 read-only and never loads state for withdrawn advisory permission',async()=>{
  const h=harness(),view=h.source();h.source.mockReturnValue({...view,state_binding:{namespace:view.state_binding.namespace,revision:view.state_binding.revision,authority_sha256:view.state_binding.authority_sha256}});
  expect((await h.handler('assess',h.request({}),h.records[0].obligation_id)).status).toBe(403);expect(h.repository.loadExisting).not.toHaveBeenCalled();
 });

 it('retains UNKNOWN assessment reservations and existing execution history without retry or reopening',async()=>{
  const h=harness(),id=h.records[0].obligation_id;
  h.snapshot().assessment_operations.push({idempotency_key:'c23a9d3a-39a1-4f36-9556-04f523969abb',obligation_id:id,aggregate_version:1,status:'UNKNOWN'});
  expect((await h.handler('assess',h.request({}),id)).status).toBe(409);expect(h.repository.compareAndSet).not.toHaveBeenCalled();
  h.snapshot().execution_ledger.push({obligation_id:id,idempotency_key:'FICTIONAL-UNKNOWN',status:'UNKNOWN',atomic_amount:'1',destination_address:'0x'+'1'.repeat(40),provider_ref:null});
  expect((await h.handler('assess',h.request({},'c23a9d3a-39a1-4f36-9556-04f523969ab2'),id)).status).toBe(409);expect(h.snapshot().execution_ledger[0].status).toBe('UNKNOWN');expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });

 it('does not link an old assessment to reapproved changed source bytes at the same aggregate version',async()=>{
  vi.stubEnv('NVIDIA_API_KEY',undefined);const h=harness(),id=h.records[0].obligation_id,a=await(await h.handler('assess',h.request({}),id)).json();
  const view=structuredClone(h.source());view.records[0].commercial_terms='Changed fictional source facts';h.source.mockReturnValue(view);
  expect((await h.handler('draft',h.request({expected_version:1,assessment_id:a.assessment_id,assessment_hash:a.assessment_hash},'c23a9d3a-39a1-4f36-9556-04f523969abc'),id)).status).toBe(409);
  expect(h.snapshot().linked_settlement_instructions).toBeUndefined();
  const state=await loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:h.snapshot()})},view.state_binding.namespace,view.records,view.state_binding);
  expect(projectObligationListData(state,'GENUINE_COMPANY',true).obligations[0].assessed).toBe(false);
  const projected=await projectObligationDetail(state,id,false,undefined,'GENUINE_COMPANY',hash(view.records[0])).json();expect(projected.current_assessment).toBeNull();
 });

 it.each(['HOLD','ESCALATE'] as const)('refuses a linked draft for current %s without writing',async decision=>{
  const h=harness(),id=h.records[0].obligation_id,state=new DemoState(h.snapshot(),undefined,undefined,undefined,{},h.records);
  const a=sealTestAssessment(state.store,'ORG-DEMO-001',id,1,{decision,source_record_sha256:hash(h.records[0])});h.snapshot().authority=state.store.exportSnapshot();
  await h.repository.compareAndSet(h.source().state_binding.namespace,h.revision(),h.snapshot());h.repository.compareAndSet.mockClear();
  expect(()=>parseDemoStateSnapshot(h.snapshot())).not.toThrow();
  const result=await h.handler('draft',h.request({expected_version:1,assessment_id:a.record.assessment_id,assessment_hash:a.assessment_hash}),id);
  expect(result.status).toBe(409);expect(await result.json()).toMatchObject({code:'CURRENT_GENUINE_PAY_REQUIRED'});expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });
 it('bounds assessment history but still replays the original completed receipt',async()=>{
  vi.stubEnv('NVIDIA_API_KEY',undefined);const h=harness(),id=h.records[0].obligation_id;
  for(let i=1;i<=4;i++)expect((await h.handler('assess',h.request({},`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`),id)).status).toBe(200);
  const blocked=await h.handler('assess',h.request({},'00000000-0000-4000-8000-000000000005'),id);expect(blocked.status).toBe(409);expect(await blocked.json()).toMatchObject({code:'GENUINE_ASSESSMENT_HISTORY_LIMIT'});
  expect((await h.handler('assess',h.request({},'00000000-0000-4000-8000-000000000001'),id)).status).toBe(200);expect(h.snapshot().authority.assessments).toHaveLength(4);
 });
 it('expires a genuine reservation at45seconds without sending another provider request',async()=>{
  const h=harness(),id=h.records[0].obligation_id;h.snapshot().assessment_operations.push({idempotency_key:'c23a9d3a-39a1-4f36-9556-04f523969abb',obligation_id:id,aggregate_version:1,status:'RESERVED',reserved_at:Date.now()-45001});
  const result=await h.handler('assess',h.request({}),id);expect(result.status).toBe(409);expect(await result.json()).toMatchObject({status:'UNKNOWN',code:'ASM-UNKNOWN'});expect(h.snapshot().assessment_operations[0].status).toBe('UNKNOWN');
 });
 it('preserves non-success projection status when attaching genuine capabilities',async()=>{
  const h=harness(),view=h.source(),state=await loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:h.snapshot()})},view.state_binding.namespace,view.records,view.state_binding);
  const readers=createObligationReaders(h.guard,async()=>({...state,getRecord:()=>undefined}),h.source,()=>undefined);
  expect((await readers.detail(new Request('https://fixture.invalid'),h.records[0].obligation_id)).status).toBe(404);
 });

 it('bounds encoded snapshot size with margin below the2MiB repository response cap',()=>{
  expect(MAX_GENUINE_SNAPSHOT_BYTES).toBeLessThan(2_097_152-200_000);
  expect(()=>assertGenuineSnapshotSize({payload:'a'.repeat(MAX_GENUINE_SNAPSHOT_BYTES)})).toThrowError(expect.objectContaining({code:'GENUINE_STATE_SIZE_LIMIT'}));
  expect(()=>assertGenuineSnapshotSize({payload:'😀'.repeat(MAX_GENUINE_SNAPSHOT_BYTES/4)})).toThrow();
  expect(()=>assertGenuineSnapshotSize({payload:'a'.repeat(1000)})).not.toThrow();
 });
 it('aborts the entire genuine provider retry sequence at20seconds and records UNKNOWN without a second call',async()=>{
  vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const c=new AbortController();setTimeout(()=>c.abort(),ms);return c.signal;});vi.stubEnv('NVIDIA_API_KEY','NETWORK_DENIED_FIXTURE');const h=harness(),id=h.records[0].obligation_id;
  let signal:AbortSignal|undefined,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
  const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{signal=init!.signal!;signal!.addEventListener('abort',()=>reject(new Error('fixture aborted')),{once:true});started();}));vi.stubGlobal('fetch',fetcher);
  const response=h.handler('assess',h.request({}),id);await ready;
  await vi.advanceTimersByTimeAsync(20_001);expect(signal!.aborted).toBe(true);
  const result=await response;expect(result.status).toBe(409);expect(await result.json()).toMatchObject({status:'UNKNOWN',code:'ASM-UNKNOWN'});expect(h.snapshot().assessment_operations[0].status).toBe('UNKNOWN');expect(fetcher).toHaveBeenCalledOnce();
 });
 it('refuses another slow authority read once request budget is exhausted without a provider call',async()=>{
  const h=harness(),id=h.records[0].obligation_id,start=Date.now();let now=start;
  vi.spyOn(Date,'now').mockImplementation(()=>now);h.guard.mockImplementation(async()=>{now=start+45001;return {revalidate:async()=>{}} as AuthContext;});
  const result=await h.handler('assess',h.request({}),id);expect(result.status).toBe(503);expect(await result.json()).toMatchObject({code:'GENUINE_ASSESSMENT_TIME_BUDGET'});expect(h.repository.loadExisting).not.toHaveBeenCalled();expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });
 it.each(['authentication','repository load'] as const)('ends a hung %s inside the request budget without provider dispatch or persistence',async boundary=>{
  vi.useFakeTimers();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const h=harness(),id=h.records[0].obligation_id;
  const never=new Promise<never>(()=>{});
  if(boundary==='authentication')h.guard.mockImplementation(()=>never);
  else h.repository.loadExisting.mockImplementation(()=>never);
  const pending=h.handler('assess',h.request({}),id);
  const observed=Promise.race([pending,new Promise<'STALLED'>(resolve=>setTimeout(()=>resolve('STALLED'),GENUINE_REQUEST_BUDGET_MS+1))]);
  await vi.advanceTimersByTimeAsync(GENUINE_REQUEST_BUDGET_MS+1);
  const result=await observed;expect(result).not.toBe('STALLED');expect((result as Response).status).toBe(503);expect(await (result as Response).json()).toMatchObject({code:'GENUINE_ASSESSMENT_TIME_BUDGET'});
  expect(fetcher).not.toHaveBeenCalled();expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });

 it('bounds a hung request body before any repository or provider work',async()=>{
  vi.useFakeTimers();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const h=harness(),id=h.records[0].obligation_id;
  const body=new ReadableStream<Uint8Array>({start(){}});
  const request=new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'c23a9d3a-39a1-4f36-9556-04f523969abb'},body,duplex:'half'} as RequestInit);
  const pending=h.handler('assess',request,id);await vi.advanceTimersByTimeAsync(2_001);const response=await pending;
  expect(response.status).toBe(408);expect(await response.json()).toMatchObject({code:'BODY_REJECTED'});
  expect(h.repository.loadExisting).not.toHaveBeenCalled();expect(h.repository.compareAndSet).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });

 it('ends a hung authority revalidation inside the request budget without provider dispatch or persistence',async()=>{
  vi.useFakeTimers();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const h=harness(),id=h.records[0].obligation_id;
  h.guard.mockResolvedValue({revalidate:()=>new Promise<never>(()=>{})} as unknown as AuthContext);
  const pending=h.handler('assess',h.request({}),id);await vi.advanceTimersByTimeAsync(GENUINE_REQUEST_BUDGET_MS+1);const response=await pending;
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'GENUINE_ASSESSMENT_TIME_BUDGET'});
  expect(h.repository.loadExisting).not.toHaveBeenCalled();expect(h.repository.compareAndSet).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });

 it('aborts an in-flight reservation CAS at the request deadline and fences its late write',async()=>{
  vi.useFakeTimers();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const h=harness(),id=h.records[0].obligation_id;
  let operationSignal:AbortSignal|undefined,lateWrite=false,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
  h.repository.compareAndSet.mockImplementation(async(_namespace:string,_revision:number,_next:any,signal?:AbortSignal)=>{
   operationSignal=signal;started();return new Promise<number>((resolve,reject)=>{
    signal?.addEventListener('abort',()=>reject(signal.reason),{once:true});
    setTimeout(()=>{if(!signal?.aborted){lateWrite=true;resolve(8);}},GENUINE_REQUEST_BUDGET_MS+1);
   });
  });
  const pending=h.handler('assess',h.request({}),id);await ready;await vi.advanceTimersByTimeAsync(GENUINE_REQUEST_BUDGET_MS+1);const response=await pending;
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'OUTCOME_UNVERIFIED',retry_submission:false});
  expect(operationSignal).toBeDefined();expect(operationSignal?.aborted).toBe(true);expect(fetcher).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(GENUINE_REQUEST_BUDGET_MS+2);expect(lateWrite).toBe(false);
 });

 it('does not continue a repository load that resolves after the request deadline',async()=>{
  vi.useFakeTimers();const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const h=harness(),id=h.records[0].obligation_id;
  let finish!:(value:any)=>void,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
  h.repository.loadExisting.mockImplementation(()=>new Promise(resolve=>{finish=resolve;started();}));
  const pending=h.handler('assess',h.request({}),id);await ready;await vi.advanceTimersByTimeAsync(GENUINE_REQUEST_BUDGET_MS+1);const response=await pending;
  expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'GENUINE_ASSESSMENT_TIME_BUDGET'});
  finish({revision:h.revision(),snapshot:structuredClone(h.snapshot())});await Promise.resolve();await Promise.resolve();
  expect(h.repository.compareAndSet).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled();
 });

 it('does not classify malformed server-owned linkage as a client body error',async()=>{
  const h=harness();h.snapshot().linked_settlement_instructions=[{schema_version:99}] as any;
  const result=await h.handler('assess',h.request({}),h.records[0].obligation_id);expect(result.status).toBe(503);expect(await result.json()).toMatchObject({code:'GENUINE_WORKFLOW_UNAVAILABLE'});expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });

});

// Synthetic durable state only. These records do not reproduce private K2.
function seedUnknown(h:ReturnType<typeof harness>,options:{legacy?:boolean;age?:number;status?:'UNKNOWN'|'RESERVED'}={}){
 const id=h.records[0].obligation_id,now=Date.now(),reserved_at=now-(options.age??106_000);
 const original:any={idempotency_key:'11111111-1111-4111-8111-111111111111',obligation_id:id,aggregate_version:1,status:options.status??'UNKNOWN',reserved_at};
 if(!options.legacy)original.recovery={generation:0,source_record_sha256:hash(h.records[0]),binding_sha256:hash(h.source().state_binding),...(original.status==='UNKNOWN'?{unknown_at:reserved_at+20_000}:{})};
 h.snapshot().assessment_operations.push(original);return structuredClone(original);
}
function recover(h:ReturnType<typeof harness>,key='22222222-2222-4222-8222-222222222222'){
 return h.handler('assess',h.request({recovery:true,expected_version:1,source_record_sha256:hash(h.source().records[0])},key),h.records[0].obligation_id);
}
async function genuineGet(h:ReturnType<typeof harness>){
 const readers=createObligationReaders(h.guard,async(records,binding)=>loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:structuredClone(h.snapshot())})},h.source().state_binding.namespace,records,binding),h.source,()=>undefined);
 return readers.detail(new Request('https://fixture.invalid'),h.records[0].obligation_id);
}
describe('Stage 2 durable visibility and controlled successor',()=>{
 it('shows historical HOLD separately from categorical UNKNOWN to two independent authenticated readers without a local key',async()=>{
  vi.stubEnv('NVIDIA_API_KEY',undefined);const h=harness(),id=h.records[0].obligation_id;
  const state=new DemoState(h.snapshot(),undefined,undefined,undefined,{},h.records);
  sealTestAssessment(state.store,'ORG-DEMO-001',id,1,{decision:'HOLD',source_record_sha256:hash(h.records[0])});h.snapshot().authority=state.store.exportSnapshot();
  await h.repository.compareAndSet(h.source().state_binding.namespace,h.revision(),h.snapshot());
  const original=seedUnknown(h,{legacy:true}),before=JSON.stringify(h.snapshot());h.repository.compareAndSet.mockClear();
  const responses=await Promise.all([genuineGet(h),genuineGet(h)]);
  for(const r of responses){expect(r.status).toBe(200);const d=await r.json();expect(d).toMatchObject({current_assessment:null,historical_assessment:{decision:'HOLD'},advisory_action_eligible:false,financial_action_eligible:false,genuine_assessment:{status:'UNKNOWN',recovery_eligible:false,recovery_reason:'LEGACY_EVIDENCE_MISSING'}});expect(JSON.stringify(d)).not.toContain(original.idempotency_key);}
  expect(JSON.stringify(h.snapshot())).toBe(before);expect(h.repository.compareAndSet).not.toHaveBeenCalled();
  const changed=structuredClone(h.source()),originalSourceHash=hash(changed.records[0]);changed.records[0].commercial_terms='SYNTHETIC OWNER READMISSION';h.source.mockReturnValue(changed);
  const reread=await(await genuineGet(h)).json();expect(reread.current_assessment).toBeNull();expect(reread.historical_assessment).toMatchObject({decision:'HOLD',source_record_sha256:originalSourceHash});expect(JSON.stringify(h.snapshot())).toBe(before);
 });
 it('admits one successor across ten clicks, independent handler instances and CAS races; preserves original bytes',async()=>{
  vi.stubEnv('NVIDIA_API_KEY','OFFLINE_MOCK_ONLY');const h=harness(),original=seedUnknown(h),before=JSON.stringify(original);
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({obligation_id:h.records[0].obligation_id,decision:'HOLD',finding_codes:[],evidence_ids:h.records[0].source_evidence.map((e:any)=>e.evidence_id),uncertainty_signal:true,explanation:'Mock model declines'})}}]}),{status:200}));vi.stubGlobal('fetch',fetcher);
  const instances=Array.from({length:10},()=>createGenuineWorkflowHandlers({guard:h.guard,source:h.source,repository:h.repository}));
  const responses=await Promise.all(instances.map((handler,i)=>handler('assess',h.request({recovery:true,expected_version:1,source_record_sha256:hash(h.records[0])},`22222222-2222-4222-8222-${String(i).padStart(12,'0')}`),h.records[0].obligation_id)));
  expect(responses.filter(r=>r.status===200)).toHaveLength(1);expect(fetcher).toHaveBeenCalledOnce();
  expect(h.snapshot().assessment_operations).toHaveLength(2);expect(JSON.stringify(h.snapshot().assessment_operations[0])).toBe(before);
  const successor=h.snapshot().assessment_operations[1];expect(successor).toMatchObject({status:'COMPLETED',recovery:{generation:1,predecessor_key:original.idempotency_key,predecessor_sha256:hash(original)}});expect(parseDemoStateSnapshot(h.snapshot()).assessment_operations).toHaveLength(2);
  const projected=await(await genuineGet(h)).json();expect(projected).toMatchObject({genuine_assessment:{status:'COMPLETED',recovery_eligible:false,recovery_reason:'ACTIVE_OR_SUCCESSOR'},advisory_action_eligible:false});
  expect((await recover(h,'33333333-3333-4333-8333-333333333333')).status).toBe(409);expect(fetcher).toHaveBeenCalledOnce();
  const normal=await h.handler('assess',h.request({},'44444444-4444-4444-8444-444444444444'),h.records[0].obligation_id);expect(normal.status).toBe(409);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('never replays K2 and never seals it when deliberately submitted as the successor key',async()=>{
  const h=harness(),original=seedUnknown(h),before=JSON.stringify(h.snapshot());
  const response=await recover(h,original.idempotency_key);expect(response.status).toBe(409);expect(JSON.stringify(h.snapshot())).toBe(before);expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });
 it.each([20_000,44_999,45_000,60_000,104_999])('denies successor at reservation age %i until request-window plus grace',async age=>{
  const h=harness();vi.spyOn(Date,'now').mockReturnValue(Date.now());seedUnknown(h,{age});const before=JSON.stringify(h.snapshot());const result=await recover(h);expect(result.status).toBe(409);expect(JSON.stringify(h.snapshot())).toBe(before);expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });
 it('admits at the exact verified grace boundary',async()=>{
  vi.stubEnv('NVIDIA_API_KEY',undefined);const h=harness();const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);seedUnknown(h,{age:105_000});expect((await recover(h)).status).toBe(200);
 });
 it.each(['legacy','reserved','source','binding','version','financial','cap','malformed','timing','second-active'])('denies %s without a successor provider dispatch',async kind=>{
  vi.stubEnv('NVIDIA_API_KEY','OFFLINE_MOCK_ONLY');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const h=harness(),original=seedUnknown(h,{legacy:kind==='legacy',status:kind==='reserved'?'RESERVED':'UNKNOWN'});
  const op=h.snapshot().assessment_operations[0];
  if(kind==='source')op.recovery!.source_record_sha256='f'.repeat(64);
  if(kind==='binding')op.recovery!.binding_sha256='f'.repeat(64);
  if(kind==='version')op.aggregate_version=2;
  if(kind==='financial')h.snapshot().execution_ledger.push({obligation_id:h.records[0].obligation_id,idempotency_key:'FICTIONAL-FINANCIAL-UNKNOWN',status:'UNKNOWN',atomic_amount:'1',destination_address:'0x'+'1'.repeat(40),provider_ref:null});
  if(kind==='cap')for(let i=0;i<3;i++)h.snapshot().assessment_operations.push({idempotency_key:`33333333-3333-4333-8333-${String(i).padStart(12,'0')}`,obligation_id:original.obligation_id,aggregate_version:1,status:'STALE'});
  if(kind==='malformed')op.recovery!.generation=99 as any;
  if(kind==='timing')op.recovery!.unknown_at=op.reserved_at!-1;
  if(kind==='second-active')h.snapshot().assessment_operations.push({idempotency_key:'33333333-3333-4333-8333-333333333333',obligation_id:original.obligation_id,aggregate_version:1,status:'RESERVED',reserved_at:Date.now()});
  const before=JSON.stringify(h.snapshot()),result=await recover(h);expect(result.status).toBeGreaterThanOrEqual(400);expect(fetcher).not.toHaveBeenCalled();expect(JSON.stringify(h.snapshot())).toBe(before);expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });
 it('makes one transport attempt for A2 failure and never dispatches A3, including reload and repeat click',async()=>{
  vi.stubEnv('NVIDIA_API_KEY','OFFLINE_MOCK_ONLY');const fetcher=vi.fn(async()=>new Response('{}',{status:503}));vi.stubGlobal('fetch',fetcher);const h=harness(),original=seedUnknown(h);
  const result=await recover(h);expect(result.status).toBe(409);expect(await result.json()).toMatchObject({status:'UNKNOWN'});expect(fetcher).toHaveBeenCalledOnce();
  expect(h.snapshot().assessment_operations[0]).toEqual(original);expect(h.snapshot().assessment_operations[1].status).toBe('UNKNOWN');
  expect((await recover(h)).status).toBe(409);expect((await recover(h,'33333333-3333-4333-8333-333333333333')).status).toBe(409);expect(fetcher).toHaveBeenCalledOnce();
  const d=await(await genuineGet(h)).json();expect(d.genuine_assessment).toMatchObject({status:'UNKNOWN',recovery_eligible:false});
 });
 it('never uses timeout alone as recovery authority or mutates a RESERVED original on a recovery click',async()=>{
  const h=harness();seedUnknown(h,{status:'RESERVED',age:900_000});const before=JSON.stringify(h.snapshot());expect((await recover(h)).status).toBe(409);expect(JSON.stringify(h.snapshot())).toBe(before);
 });
 it('loses admission when session or source changes during reservation rechecks',async()=>{
  for(const kind of ['session','source']){const h=harness();seedUnknown(h);let checks=0;
   h.guard.mockResolvedValue({revalidate:async()=>{if(++checks===3){if(kind==='session')throw new Error('SYNTHETIC_SESSION_REVOKED');const view=structuredClone(h.source());view.records[0].commercial_terms='Synthetic drift';h.source.mockReturnValue(view);}}} as AuthContext);
   expect((await recover(h)).status).toBeGreaterThanOrEqual(400);expect(h.repository.compareAndSet).not.toHaveBeenCalled();
  }
 });
 it('prevents a late original response from replacing the successor or altering its predecessor',async()=>{
  vi.stubEnv('NVIDIA_API_KEY','OFFLINE_MOCK_ONLY');const h=harness(),start=Date.now();let clock=start;vi.spyOn(Date,'now').mockImplementation(()=>clock);
  let finish!:(r:Response)=>void,started!:()=>void;const ready=new Promise<void>(r=>{started=r;});
  const output=()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({obligation_id:h.records[0].obligation_id,decision:'PAY',finding_codes:[],evidence_ids:h.records[0].source_evidence.map((e:any)=>e.evidence_id),uncertainty_signal:false,explanation:'Mock only'})}}]}));
  const fetcher=vi.fn().mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;started();})).mockImplementation(async()=>output());vi.stubGlobal('fetch',fetcher);
  const originalRequest=h.handler('assess',h.request({},'11111111-1111-4111-8111-111111111111'),h.records[0].obligation_id);await ready;
  clock=start+45_001;expect((await h.handler('assess',h.request({},'11111111-1111-4111-8111-111111111111'),h.records[0].obligation_id)).status).toBe(409);
  const original=structuredClone(h.snapshot().assessment_operations[0]);clock=start+105_002;expect((await recover(h)).status).toBe(200);const after=JSON.stringify(h.snapshot());
  finish(output());expect((await originalRequest).status).toBe(503);expect(JSON.stringify(h.snapshot())).toBe(after);expect(h.snapshot().assessment_operations[0]).toEqual(original);expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('rejects mutated predecessor identity, duplicate lineage and malformed generation on reload',()=>{
  const h=harness(),original=seedUnknown(h);
  const child:any={idempotency_key:'22222222-2222-4222-8222-222222222222',obligation_id:original.obligation_id,aggregate_version:1,status:'RESERVED',reserved_at:Date.now(),recovery:{...original.recovery,generation:1,unknown_at:undefined,predecessor_key:original.idempotency_key,predecessor_sha256:hash(original)}};
  h.snapshot().assessment_operations.push(child);expect(()=>parseDemoStateSnapshot(h.snapshot())).not.toThrow();
  h.snapshot().assessment_operations[0].reserved_at=original.reserved_at!-1;expect(()=>parseDemoStateSnapshot(h.snapshot())).toThrow();
  h.snapshot().assessment_operations[0]=original;h.snapshot().assessment_operations.push({...child,idempotency_key:'33333333-3333-4333-8333-333333333333'});expect(()=>parseDemoStateSnapshot(h.snapshot())).toThrow();
 });
});

it('rechecks durable financial absence after successor CAS and before provider dispatch',async()=>{
 vi.stubEnv('NVIDIA_API_KEY','OFFLINE_MOCK_ONLY');const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);const h=harness(),original=seedUnknown(h);
 h.repository.loadExisting.mockImplementation(async()=>{if(h.snapshot().assessment_operations.length===2)h.snapshot().execution_ledger.push({obligation_id:original.obligation_id,idempotency_key:'FICTIONAL-CONCURRENT-FINANCIAL',status:'UNKNOWN',atomic_amount:'1',destination_address:'0x'+'1'.repeat(40),provider_ref:null});return {revision:h.revision(),snapshot:structuredClone(h.snapshot()) as any};});
 expect((await recover(h)).status).toBeGreaterThanOrEqual(400);expect(fetcher).not.toHaveBeenCalled();expect(h.snapshot().assessment_operations[0]).toEqual(original);expect(h.snapshot().assessment_operations[1].status).toBe('RESERVED');
});

it('enforces the A2 provider budget even when a transport body ignores abort, and discards its late result',async()=>{
 vi.useFakeTimers();vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const c=new AbortController();setTimeout(()=>c.abort(),ms);return c.signal;});vi.stubEnv('NVIDIA_API_KEY','OFFLINE_MOCK_ONLY');const h=harness(),original=seedUnknown(h);
 let finish!:(value:unknown)=>void,started!:()=>void;const ready=new Promise<void>(r=>{started=r;});const body=new Promise<unknown>(r=>{finish=r;});
 const fetcher=vi.fn(async()=>{const response=new Response('{}');response.json=async()=>{started();return body;};return response;});vi.stubGlobal('fetch',fetcher);
 const pending=recover(h);await ready;await vi.advanceTimersByTimeAsync(20_001);const result=await pending;expect(result.status).toBe(409);expect(await result.json()).toMatchObject({status:'UNKNOWN'});expect(fetcher).toHaveBeenCalledOnce();
 const before=JSON.stringify(h.snapshot());finish({choices:[{message:{content:JSON.stringify({obligation_id:original.obligation_id,decision:'PAY',finding_codes:[],evidence_ids:h.records[0].source_evidence.map((e:any)=>e.evidence_id),uncertainty_signal:false,explanation:'Mock late body'})}}]});await Promise.resolve();await Promise.resolve();expect(JSON.stringify(h.snapshot())).toBe(before);expect(h.snapshot().assessment_operations[0]).toEqual(original);
});
