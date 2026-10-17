import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {canonicalize} from 'json-canonicalize';
import {afterEach,describe,expect,it,vi} from 'vitest';

import {AuthorityStore} from '../src/authority/aggregate';
import {DemoState,type DemoStateSnapshot} from '../src/server/demo-state';
import {
 createGenuineAssessmentEligibilityHandler,
 MAX_GENUINE_COMPLETION_GROWTH_BYTES,
 MAX_GENUINE_COMPLETION_SCHEMA_OVERHEAD_BYTES,
 MAX_GENUINE_PROVIDER_DERIVED_BYTES,
 MAX_GENUINE_RESERVATION_GROWTH_BYTES,
 projectGenuineAssessmentEligibility,
} from '../src/server/genuine-assessment-eligibility';
import {MAX_GENUINE_SNAPSHOT_BYTES} from '../src/server/genuine-workflow';
import type {AuthContext} from '../src/server/operator-auth';
import {MAX_OPERATOR_SOURCE_BYTES,parseOperatorSource,type OperatorSourceView} from '../src/server/operator-source-records';
import {syntheticSourceRecords} from './test-support/synthetic-source-records';
import {sealTestAssessment} from './test-support/seal-assessment';

const hash=(value:unknown)=>createHash('sha256').update(canonicalize(value)).digest('hex');
const unavailable={target_bound:'UNVERIFIED',source_state_stable:'UNVERIFIED',unresolved_operation:'UNVERIFIED',generation_one_operation:'UNVERIFIED',assessment_history_below_limit:'UNVERIFIED',operation_history_below_limit:'UNVERIFIED',financial_history:'UNVERIFIED',historical_basis:'UNVERIFIED',reservation_size_headroom:'UNVERIFIED',completion_size_headroom:'UNVERIFIED',eligible_for_one_fresh_assessment:false};

function harness(){
 const records=syntheticSourceRecords().map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...item}:any)=>({...item,source_evidence:item.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));
 for(const record of records){const evidence=record.source_evidence[0];record.assessment_basis={transaction_type:'INVOICE',classification_evidence:evidence,timing:{basis:'INVOICE_CASH_TERM',date:record.effective_due_date,evidence},simulation:{mode:'HISTORICAL_AS_OF',as_of_date:'2020-01-05',evidence,owner_authority_reference:'SYNTHETIC-READMISSION'}};}
 let snapshot=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot(),revision=7,environment='preview';
 const {assessments,...base}=snapshot.authority;
 const packet={schema_version:3,record_count:5,provenance:'GENUINE_COMPANY_OBLIGATIONS',purpose:'GENUINE_ADVISORY_SOURCE',organization_id:'ORG-DEMO-001',state_binding:{namespace:'FICTIONAL-GENUINE',revision,authority_sha256:hash(snapshot.authority),workflow_base_sha256:hash(base)},records};
 const bytes=Buffer.from(JSON.stringify(packet));let view:OperatorSourceView|undefined=parseOperatorSource(bytes,createHash('sha256').update(bytes).digest('hex'));
 const source=vi.fn(()=>view),revalidate=vi.fn(async()=>{}),guard=vi.fn(async()=>({session:{operator_key:'fictional',credential_version:1},revalidate} as unknown as AuthContext));
 const repository={loadExisting:vi.fn(async()=>({revision,snapshot:structuredClone(snapshot) as any}))};
 const handler=createGenuineAssessmentEligibilityHandler({guard,source,repository,environment:()=>environment,now:()=>new Date('2026-10-17T00:00:00.000Z')});
 const request=(body:unknown={})=>new Request('https://fixture.invalid',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 return {records,id:records[0].obligation_id,request,handler,guard,revalidate,source,repository,snapshot:()=>snapshot,setSnapshot:(next:DemoStateSnapshot)=>snapshot=next,setRevision:(next:number)=>revision=next,setEnvironment:(next:string)=>environment=next,view:()=>view!,setView:(next:OperatorSourceView|undefined)=>view=next};
}

afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

describe('genuine assessment eligibility',()=>{
 it('contains no mutation, provider, key-generation, payment or reconciliation capability',()=>{
  const source=readFileSync(resolve(import.meta.dirname,'../src/server/genuine-assessment-eligibility.ts'),'utf8');
  expect(source).not.toMatch(/compareAndSet|loadOrSeed|NvidiaProvider|randomUUID|Idempotency-Key|createTransaction|reconcile|wallet|payment_release/i);
 });

 it('proves one fresh assessment from two stable reads and returns only categorical evidence',async()=>{
  const h=harness(),before=structuredClone(h.snapshot());vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('network forbidden');}));
  const response=await h.handler(h.request(),h.id),body=await response.json();
  expect(response.status).toBe(200);
  expect(body).toEqual({target_bound:'TRUE',source_state_stable:'TRUE',unresolved_operation:'NONE',generation_one_operation:'NONE',assessment_history_below_limit:'TRUE',operation_history_below_limit:'TRUE',financial_history:'NONE',historical_basis:'PRESENT',reservation_size_headroom:'READY',completion_size_headroom:'READY',eligible_for_one_fresh_assessment:true});
  expect(Object.keys(body)).toHaveLength(11);expect(JSON.stringify(body)).not.toContain(h.id);
  expect(h.guard).toHaveBeenCalledOnce();expect(h.revalidate).toHaveBeenCalledTimes(4);expect(h.source).toHaveBeenCalledTimes(5);expect(h.repository.loadExisting).toHaveBeenCalledTimes(2);expect(h.snapshot()).toEqual(before);
 });

 it.each(['UNKNOWN','RESERVED','PROVIDER_RESULT_DURABLE'] as const)('blocks unresolved %s without changing it',async status=>{
  const h=harness(),operation:any={idempotency_key:'11111111-1111-4111-8111-111111111111',obligation_id:h.id,aggregate_version:1,status,...(status==='RESERVED'?{reserved_at:1}:{})};
  if(status==='PROVIDER_RESULT_DURABLE'){const store=AuthorityStore.fromSnapshot(h.snapshot().authority),sealed=sealTestAssessment(store,'ORG-DEMO-001',h.id,1,{assessment_id:`ASM-${operation.idempotency_key}`,source_record_sha256:hash(h.records[0]),decision:'HOLD'});operation.provider_result=sealed.record;}
  h.snapshot().assessment_operations.push(operation);
  const before=structuredClone(h.snapshot()),body=await(await h.handler(h.request(),h.id)).json();
  expect(body).toMatchObject({unresolved_operation:'PRESENT',eligible_for_one_fresh_assessment:false});expect(h.snapshot()).toEqual(before);
 });

 it('blocks any generation-one operation independently of current status',()=>{
  const h=harness(),snapshot=h.snapshot();
  snapshot.assessment_operations.push({idempotency_key:'22222222-2222-4222-8222-222222222222',obligation_id:h.id,aggregate_version:1,status:'STALE',recovery:{generation:1,source_record_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64),predecessor_key:'11111111-1111-4111-8111-111111111111',predecessor_sha256:'c'.repeat(64)}});
  expect(projectGenuineAssessmentEligibility(snapshot,h.view(),h.id,1000,'2026-10-17')).toMatchObject({unresolved_operation:'NONE',generation_one_operation:'PRESENT',eligible_for_one_fresh_assessment:false});
 });

 it('enforces both history limits independently',()=>{
  const h=harness(),snapshot=h.snapshot(),store=AuthorityStore.fromSnapshot(snapshot.authority);
  for(let index=0;index<4;index++)sealTestAssessment(store,'ORG-DEMO-001',h.id,1,{assessment_id:`ASM-${index}`,source_record_sha256:hash(h.records[0]),decision:'HOLD'});
  snapshot.authority=store.exportSnapshot();
  expect(projectGenuineAssessmentEligibility(snapshot,h.view(),h.id,1000,'2026-10-17')).toMatchObject({assessment_history_below_limit:'FALSE',operation_history_below_limit:'TRUE',eligible_for_one_fresh_assessment:false});
  snapshot.authority.assessments=[];
  for(let index=0;index<4;index++)snapshot.assessment_operations.push({idempotency_key:`00000000-0000-4000-8000-${String(index).padStart(12,'0')}`,obligation_id:h.id,aggregate_version:1,status:'STALE'});
  expect(projectGenuineAssessmentEligibility(snapshot,h.view(),h.id,1000,'2026-10-17')).toMatchObject({assessment_history_below_limit:'TRUE',operation_history_below_limit:'FALSE',eligible_for_one_fresh_assessment:false});
 });

 it('blocks financial history, missing historical basis and source mismatch',()=>{
  const h=harness(),snapshot=h.snapshot(),originalState=snapshot.authority.aggregates[0].state;snapshot.authority.aggregates[0].state='AUTHORIZED';
  expect(projectGenuineAssessmentEligibility(snapshot,h.view(),h.id,1000,'2026-10-17')).toMatchObject({financial_history:'PRESENT',eligible_for_one_fresh_assessment:false});
  snapshot.authority.aggregates[0].state=originalState;delete (h.records[0] as any).assessment_basis;
  const changed=structuredClone(h.view());delete (changed.records[0] as any).assessment_basis;
  expect(projectGenuineAssessmentEligibility(snapshot,changed,h.id,1000,'2026-10-17')).toMatchObject({historical_basis:'MISSING',eligible_for_one_fresh_assessment:false});
  changed.records[0].amount='999.00';
  expect(projectGenuineAssessmentEligibility(snapshot,changed,h.id,1000,'2026-10-17')).toMatchObject({target_bound:'FALSE',eligible_for_one_fresh_assessment:false});
 });

 it('uses conservative independent reservation and completion headroom',()=>{
  const h=harness();
  expect(MAX_GENUINE_COMPLETION_GROWTH_BYTES).toBe(MAX_GENUINE_RESERVATION_GROWTH_BYTES+MAX_OPERATOR_SOURCE_BYTES+MAX_GENUINE_PROVIDER_DERIVED_BYTES+MAX_GENUINE_COMPLETION_SCHEMA_OVERHEAD_BYTES);
  expect(MAX_GENUINE_PROVIDER_DERIVED_BYTES).toBeGreaterThanOrEqual(10*1000*4+1000*4+16*128*4);
  const maximumReservationEnvelope={idempotency_key:'f'.repeat(36),obligation_id:'x'.repeat(128),aggregate_version:Number.MAX_SAFE_INTEGER,status:'RESERVED',reserved_at:Number.MAX_SAFE_INTEGER,recovery:{generation:1,source_record_sha256:'f'.repeat(64),binding_sha256:'f'.repeat(64),unknown_at:Number.MAX_SAFE_INTEGER,predecessor_key:'f'.repeat(36),predecessor_sha256:'f'.repeat(64)}};
  expect(Buffer.byteLength(JSON.stringify(maximumReservationEnvelope,null,1),'utf8')).toBeLessThan(MAX_GENUINE_RESERVATION_GROWTH_BYTES);
  expect(projectGenuineAssessmentEligibility(h.snapshot(),h.view(),h.id,MAX_GENUINE_SNAPSHOT_BYTES-MAX_GENUINE_RESERVATION_GROWTH_BYTES,'2026-10-17')).toMatchObject({reservation_size_headroom:'INSUFFICIENT',completion_size_headroom:'INSUFFICIENT',eligible_for_one_fresh_assessment:false});
  expect(projectGenuineAssessmentEligibility(h.snapshot(),h.view(),h.id,MAX_GENUINE_SNAPSHOT_BYTES-MAX_GENUINE_COMPLETION_GROWTH_BYTES,'2026-10-17')).toMatchObject({reservation_size_headroom:'READY',completion_size_headroom:'INSUFFICIENT',eligible_for_one_fresh_assessment:false});
 });

 it('returns categorical UNVERIFIED on an unstable two-read observation',async()=>{
  const h=harness();let calls=0;h.repository.loadExisting.mockImplementation(async()=>({revision:++calls===1?7:8,snapshot:structuredClone(h.snapshot()) as any}));
  const response=await h.handler(h.request(),h.id);expect(response.status).toBe(409);expect(await response.json()).toEqual(unavailable);expect(h.repository.loadExisting).toHaveBeenCalledTimes(2);
 });

 it('returns categorical UNVERIFIED when snapshot content or approved source drifts',async()=>{
  const snapshotDrift=harness();let reads=0;snapshotDrift.repository.loadExisting.mockImplementation(async()=>{const snapshot=structuredClone(snapshotDrift.snapshot()) as any;if(++reads===2)snapshot.assessment_operations.push({idempotency_key:'11111111-1111-4111-8111-111111111111',obligation_id:snapshotDrift.id,aggregate_version:1,status:'UNKNOWN'});return {revision:7,snapshot};});
  const snapshotResponse=await snapshotDrift.handler(snapshotDrift.request(),snapshotDrift.id);expect(snapshotResponse.status).toBe(409);expect(await snapshotResponse.json()).toEqual(unavailable);
  const sourceDrift=harness(),approved=sourceDrift.view();let sources=0;sourceDrift.source.mockImplementation(()=>{if(++sources===4){const changed=structuredClone(approved);changed.records[0].commercial_terms='Changed after first read';return changed;}return approved;});
  const sourceResponse=await sourceDrift.handler(sourceDrift.request(),sourceDrift.id);expect(sourceResponse.status).toBe(409);expect(await sourceResponse.json()).toEqual(unavailable);expect(sourceDrift.repository.loadExisting).toHaveBeenCalledOnce();
 });

 it('returns categorical UNVERIFIED on malformed private state without exposing it',async()=>{
  const h=harness();h.repository.loadExisting.mockResolvedValue({revision:7,snapshot:{private:'SECRET'}} as any);
  const response=await h.handler(h.request(),h.id),text=await response.text();expect(response.status).toBe(503);expect(JSON.parse(text)).toEqual(unavailable);expect(text).not.toContain('SECRET');expect(h.repository.loadExisting).toHaveBeenCalledOnce();
 });

 it.each([[{extra:true},400],[[ ],400]] as const)('rejects expanded body before source or state',async(body,status)=>{
  const h=harness(),response=await h.handler(h.request(body),h.id);expect(response.status).toBe(status);expect(h.source).not.toHaveBeenCalled();expect(h.repository.loadExisting).not.toHaveBeenCalled();
 });

 it.each(['production','development',''])('denies non-Preview use before authentication: %s',async environment=>{
  const h=harness();h.setEnvironment(environment);const response=await h.handler(h.request(),h.id);expect(response.status).toBe(403);expect(h.guard).not.toHaveBeenCalled();expect(h.source).not.toHaveBeenCalled();expect(h.repository.loadExisting).not.toHaveBeenCalled();
 });
});
