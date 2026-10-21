import {expect,it} from 'vitest';
import {harness} from './test-support/disposition-fixture';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';

it('V3 original missing-basis record reports descriptive fresh precondition in real list and detail without effects',async()=>{
 const h=harness({basis:false}),before=JSON.stringify(h.snapshot());
 const readers=createObligationReaders(h.guard,(records,binding)=>loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:structuredClone(h.snapshot())})},h.state_binding.namespace,records,binding),h.source,()=>undefined);
 const list=await(await readers.list(new Request('https://fixture.invalid'))).json();
 const detail=await(await readers.detail(new Request('https://fixture.invalid'),h.id)).json();
 expect(detail.advisory_action_eligible).toBe(true);
 expect(detail.fresh_assessment_readiness).toEqual({ready:false,blocker:'SOURCE_ASSESSMENT_CONTEXT_REQUIRED'});
 expect(list.obligations.find((r:any)=>r.obligation_id===h.id).fresh_assessment_readiness).toEqual(detail.fresh_assessment_readiness);
 expect(JSON.stringify(h.snapshot())).toBe(before);expect(h.repository.compareAndSet).not.toHaveBeenCalled();
});

it.each(['valid','legitimate-hold','invalid-date','missing-evidence'])('canonical validator parity from original source: %s',async kind=>{
 const h=harness();
 if(kind==='legitimate-hold')h.records[0].business_purpose_confirmed=false;
 if(kind==='invalid-date')h.records[0].assessment_basis.simulation.as_of_date='2099-01-01';
 if(kind==='missing-evidence')h.records[0].assessment_basis.classification_evidence={...h.records[0].assessment_basis.classification_evidence,evidence_id:'SYNTHETIC-NOT-ON-SOURCE'};
 h.publish();const before=JSON.stringify(h.snapshot());
 const {deterministicHistoricalContextValid}=await import('../src/agent/context-builder');
 const valid=deterministicHistoricalContextValid(h.records[0]);expect(valid).toBe(kind==='valid'||kind==='legitimate-hold');
 const readers=createObligationReaders(h.guard,(records,binding)=>loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:structuredClone(h.snapshot())})},h.state_binding.namespace,records,binding),h.source,()=>undefined);
 const list=await(await readers.list(new Request('https://fixture.invalid'))).json(),detail=await(await readers.detail(new Request('https://fixture.invalid'),h.id)).json();
 const row=list.obligations.find((r:any)=>r.obligation_id===h.id);expect(row.assessment_basis).toBeUndefined();
 expect(row.fresh_assessment_readiness).toEqual(detail.fresh_assessment_readiness);expect(detail.fresh_assessment_readiness.ready).toBe(valid);
 expect(detail.advisory_action_eligible).toBe(true);expect(h.repository.compareAndSet).not.toHaveBeenCalled();expect(JSON.stringify(h.snapshot())).toBe(before);
});

it.each(['UNKNOWN','HISTORY_LIMIT','FINANCIAL_HISTORY'])('existing %s admission remains stronger than a missing source precondition',async kind=>{
 const h=harness({basis:false});
 if(kind==='UNKNOWN')h.snapshot().assessment_operations.push({idempotency_key:'11111111-1111-4111-8111-111111111111',obligation_id:h.id,aggregate_version:1,status:'UNKNOWN',reserved_at:1});
 if(kind==='HISTORY_LIMIT')for(let n=0;n<4;n++)h.snapshot().assessment_operations.push({idempotency_key:`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`,obligation_id:h.id,aggregate_version:1,status:'STALE',reserved_at:1});
 if(kind==='FINANCIAL_HISTORY'){h.snapshot().authority.aggregates[0].state='CANCELLED';const {assessments,...base}=h.snapshot().authority;h.state_binding.workflow_base_sha256=(await import('./test-support/disposition-fixture')).hash(base);h.publish();}
 const before=JSON.stringify(h.snapshot());
 const readers=createObligationReaders(h.guard,(records,binding)=>loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:structuredClone(h.snapshot())})},h.state_binding.namespace,records,binding),h.source,()=>undefined);
 const list=await(await readers.list(new Request('https://fixture.invalid'))).json(),detail=await(await readers.detail(new Request('https://fixture.invalid'),h.id)).json();
 expect(detail.advisory_action_eligible).toBe(false);expect(detail.fresh_assessment_readiness).toEqual({ready:false,blocker:'EXISTING_ASSESSMENT_ADMISSION_REQUIRED'});
 expect(list.obligations.find((r:any)=>r.obligation_id===h.id).fresh_assessment_readiness).toEqual(detail.fresh_assessment_readiness);
 expect(JSON.stringify(h.snapshot())).toBe(before);expect(h.repository.compareAndSet).not.toHaveBeenCalled();
});

it('V4 source workflow response stays byte-shaped by its existing producer',async()=>{
 const h=harness();const source=()=>({...h.source(),source_ingress:{}} as any);
 const {vi}=await import('vitest');const read=vi.fn(async(kind:string)=>Response.json(kind==='list'?{allowed_actions:['CREATE_SOURCE'],obligations:[],assessed_count:0,total_count:0}:{record:{obligation_id:h.id},allowed_actions:['MANUAL_REVIEW']}));
 const load=vi.fn();const readers=createObligationReaders(h.guard,load,source,()=>undefined,read as any);
 expect(await(await readers.list(new Request('https://fixture.invalid'))).json()).toEqual({allowed_actions:['CREATE_SOURCE'],obligations:[],assessed_count:0,total_count:0});
 expect(await(await readers.detail(new Request('https://fixture.invalid'),h.id)).json()).toEqual({record:{obligation_id:h.id},allowed_actions:['MANUAL_REVIEW']});expect(load).not.toHaveBeenCalled();
});

it('source fingerprint changes during GET fail closed without projecting obsolete readiness',async()=>{
 const h=harness({basis:false}),view=h.source(),changed=structuredClone(view);changed.records[0].commercial_terms='SYNTHETIC NEW TERMS';h.source.mockReturnValueOnce(view).mockReturnValueOnce(changed);
 const before=JSON.stringify(h.snapshot());const readers=createObligationReaders(h.guard,(records,binding)=>loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:structuredClone(h.snapshot())})},h.state_binding.namespace,records,binding),h.source,()=>undefined);
 const response=await readers.detail(new Request('https://fixture.invalid'),h.id);expect(response.status).toBe(503);expect((await response.json()).fresh_assessment_readiness).toBeUndefined();expect(JSON.stringify(h.snapshot())).toBe(before);expect(h.repository.compareAndSet).not.toHaveBeenCalled();
});
