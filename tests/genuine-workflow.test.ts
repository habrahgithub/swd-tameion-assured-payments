import {describe,it,expect,vi,afterEach} from 'vitest';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import {DemoState,parseDemoStateSnapshot} from '../src/server/demo-state';
import {parseOperatorSource} from '../src/server/operator-source-records';
import {DemoStateConflictError} from '../src/server/supabase-demo-state-repository';
import {projectObligationDetail,projectObligationListData} from '../src/server/obligation-read-model';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
import {assertLinkedHistoryAppend,parseLinkedInstructions} from '../src/domain/linked-instruction';
import {validateLinkedActivation} from '../src/server/linked-instruction-activation';
import {createGenuineWorkflowHandlers} from '../src/server/genuine-workflow';
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
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();});
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

});
