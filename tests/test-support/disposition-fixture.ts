import {expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import {sealTestAssessment} from './seal-assessment';
import {syntheticSourceRecords} from './synthetic-source-records';
import {createObligationReaders} from '../../src/server/operator-obligation-routes';
import {DemoState} from '../../src/server/demo-state';
import {parseOperatorSource} from '../../src/server/operator-source-records';
import {DemoStateConflictError} from '../../src/server/supabase-demo-state-repository';
import {loadExistingDemoState} from '../../src/server/load-existing-demo-state';
import {createGenuineWorkflowHandlers} from '../../src/server/genuine-workflow';
import {createGenuineAssessmentStatusHandler} from '../../src/server/genuine-assessment-status';
import type {AuthContext} from '../../src/server/operator-auth';
export const hash=(v:unknown)=>createHash('sha256').update(canonicalize(v)).digest('hex');
export const LEGACY='11111111-1111-4111-8111-111111111111';export const CHILD='77777777-7777-4777-8777-777777777777';export const OTHER='88888888-8888-4888-8888-888888888888';export const HOLD_KEY='bbbbbbbb-bbbb-4bbb-8bbb-000000000000';
export const APPROVAL='SYNTHETIC-APPROVAL-001';
export const MINUTE=60_000;
// Synthetic public fixtures only: invented IDs, hashes, amounts and dates.
export function harness(options:{basis?:boolean}={}){
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
export type H=ReturnType<typeof harness>;
export const attest=(value='APPLIED_DISPOSITION_V1')=>vi.stubEnv('TAMEION_ASSESSMENT_BOOTSTRAP_GUARD',value);
/** Historical source-matched HOLD (completed, with its operation) plus one unbound legacy UNKNOWN: the representative current record. */
export function seedRepresentative(h:H,extra:{unknown?:boolean}={}){
 const state=new DemoState(h.snapshot(),undefined,undefined,undefined,{},h.records);
 const sealed=sealTestAssessment(state.store,'ORG-DEMO-001',h.id,1,{assessment_id:`ASM-${HOLD_KEY}`,decision:'HOLD',source_record_sha256:hash(h.records[0])});
 h.snapshot().authority=state.store.exportSnapshot();
 h.snapshot().assessment_operations.push({idempotency_key:HOLD_KEY,obligation_id:h.id,aggregate_version:1,status:'COMPLETED',reserved_at:1,assessment_hash:sealed.assessment_hash,recovery:{generation:0,source_record_sha256:hash(h.records[0]),binding_sha256:hash(h.state_binding)}});
 if(extra.unknown!==false)h.snapshot().assessment_operations.push({idempotency_key:LEGACY,obligation_id:h.id,aggregate_version:1,status:'UNKNOWN',reserved_at:Date.now()-500_000});
}
export const predecessor=(h:H)=>h.snapshot().assessment_operations.find((o:any)=>o.idempotency_key===LEGACY);
export const admissionFor=(h:H,over:Record<string,unknown>={},now=Date.now())=>({kind:'CURRENT_SOURCE_REASSESSMENT_ADMISSION',approval_id:APPROVAL,obligation_id:h.id,aggregate_version:1,source_record_sha256:hash(h.records[0]),binding_sha256:hash(h.state_binding),predecessor_key:LEGACY,predecessor_sha256:hash(predecessor(h)),valid_from:new Date(now-MINUTE).toISOString(),expires_at:new Date(now+30*MINUTE).toISOString(),...over});
export const bodyFor=(h:H,over:Record<string,unknown>={})=>({disposition:'CURRENT_SOURCE_REASSESSMENT',expected_version:1,source_record_sha256:hash(h.records[0]),approval_id:APPROVAL,predecessor_key:LEGACY,predecessor_sha256:hash(predecessor(h)),...over});
export const dispose=(h:H,key=CHILD,over:Record<string,unknown>={},handler=h.handler)=>handler('assess',h.request(bodyFor(h,over),key),h.id);
export const providerBody=(h:H,decision:'PAY'|'HOLD'='PAY')=>JSON.stringify({choices:[{message:{content:JSON.stringify({obligation_id:h.id,decision,finding_codes:[],evidence_ids:h.records[0].source_evidence.map((e:any)=>e.evidence_id),uncertainty_signal:decision!=='PAY',explanation:'Synthetic model output'})}}]});
export function mockProvider(h:H,decision:'PAY'|'HOLD'='PAY'){vi.stubEnv('NVIDIA_API_KEY','OFFLINE_MOCK_ONLY');const fetcher=vi.fn(async()=>new Response(providerBody(h,decision),{status:200}));vi.stubGlobal('fetch',fetcher);return fetcher;}
export async function genuineGet(h:H){
 const readers=createObligationReaders(h.guard,async(records,binding,_namespace,admission)=>loadExistingDemoState({call:async()=>({revision:h.revision(),snapshot:structuredClone(h.snapshot())})},h.source().state_binding.namespace,records,binding,admission),h.source,()=>undefined);
 return readers.detail(new Request('https://fixture.invalid'),h.id);
}
export const statusOf=(h:H)=>{const status=createGenuineAssessmentStatusHandler({guard:h.guard,source:h.source,repository:{loadExisting:h.repository.loadExisting}});return async(key:string)=>(await status(new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idempotency_key:key})}),h.id)).json();};
export const link=(h:H,assessment:any,key='c23a9d3a-39a1-4f36-9556-04f523969abc')=>h.handler('draft',h.request({expected_version:1,assessment_id:assessment.assessment_id,assessment_hash:assessment.assessment_hash},key),h.id);
/** Nothing may be written and no provider may be reached. */
export async function expectRefusedBeforeEffects(h:H,fetcher:ReturnType<typeof mockProvider>,run:()=>Promise<Response>,codePattern?:RegExp){
 const before=JSON.stringify(h.snapshot()),calls=fetcher.mock.calls.length;h.repository.compareAndSet.mockClear();
 const response=await run(),data=await response.json();
 expect(response.status).toBeGreaterThanOrEqual(400);if(codePattern)expect(data.code).toMatch(codePattern);
 expect(fetcher.mock.calls.length).toBe(calls);expect(h.repository.compareAndSet).not.toHaveBeenCalled();expect(JSON.stringify(h.snapshot())).toBe(before);
}

