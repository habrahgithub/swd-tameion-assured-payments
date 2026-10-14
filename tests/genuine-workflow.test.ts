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
import {createGenuineWorkflowHandlers,assertGenuineSnapshotSize,MAX_GENUINE_SNAPSHOT_BYTES} from '../src/server/genuine-workflow';
import {syntheticSourceRecords} from './test-support/synthetic-source-records';
import type {AuthContext} from '../src/server/operator-auth';
const hash=(v:unknown)=>createHash('sha256').update(canonicalize(v)).digest('hex');
function harness(){
 const records=syntheticSourceRecords().map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...r}:any)=>({...r,source_evidence:r.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));let snapshot=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot(),revision=7;
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

 it('does not classify malformed server-owned linkage as a client body error',async()=>{
  const h=harness();h.snapshot().linked_settlement_instructions=[{schema_version:99}] as any;
  const result=await h.handler('assess',h.request({}),h.records[0].obligation_id);expect(result.status).toBe(503);expect(await result.json()).toMatchObject({code:'GENUINE_WORKFLOW_UNAVAILABLE'});expect(h.repository.compareAndSet).not.toHaveBeenCalled();
 });

});
