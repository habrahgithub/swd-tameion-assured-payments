import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {canonicalize} from 'json-canonicalize';
import {describe,it,expect,vi} from 'vitest';
import {parseOperatorSource,operatorSourceRecordSchema} from '../src/server/operator-source-records';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
import {parseFinancialSource} from '../src/server/financial-source-admission';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {DemoState} from '../src/server/demo-state';
import {syntheticSourceRecords} from './test-support/synthetic-source-records';
import type {AuthContext} from '../src/server/operator-auth';
function fixture(){
 const records=syntheticSourceRecords().map(r=>operatorSourceRecordSchema.parse({obligation_id:r.obligation_id,service_category:r.service_category,recurrence:r.recurrence,issue_date:r.issue_date,due_date:r.due_date,due_date_status:r.due_date_status,effective_due_date:r.effective_due_date,effective_due_date_basis:r.effective_due_date_basis,effective_due_date_provenance:r.effective_due_date_provenance,amount:r.amount,currency:r.currency,state_at_event_baseline:r.state_at_event_baseline,business_purpose_confirmed:r.business_purpose_confirmed,commercial_terms:r.commercial_terms,source_evidence:r.source_evidence.map(e=>({evidence_id:e.evidence_id,content_sha256:e.content_sha256})),candidate_readiness:r.candidate_readiness}));
 records.push({...records[1],obligation_id:'FICTIONAL-OWNER-ENTRY',service_category:'Fictional service',amount:'1.00',issue_date:null,due_date:null,due_date_status:'NOT_STATED_ON_SOURCE',effective_due_date:null,effective_due_date_basis:null,effective_due_date_provenance:null,commercial_terms:'Fictional owner attestation; bill not independently verified.',source_evidence:[{evidence_id:'FICTIONAL-ATTESTATION'}]});
 const snapshot=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot();
 const state_binding={namespace:'FICTIONAL-VIEW',revision:7,authority_sha256:createHash('sha256').update(canonicalize(snapshot.authority)).digest('hex')};
 return {records,snapshot,packet:{schema_version:2,record_count:6,provenance:'GENUINE_COMPANY_OBLIGATIONS',purpose:'OPERATOR_VIEW_ONLY',organization_id:'ORG-DEMO-001',state_binding,records}};
}
function parse(value:unknown){const bytes=Buffer.from(JSON.stringify(value));return parseOperatorSource(bytes,createHash('sha256').update(bytes).digest('hex'));}
describe('versioned private genuine view catalog',()=>{
 it('accepts explicit six-record v2 while preserving legacy five-record v1',()=>{const f=fixture();expect(parse(f.packet).records).toHaveLength(6);const {schema_version,record_count,provenance,...v1}=f.packet;expect(parse({...v1,records:f.records.slice(0,5)}).records).toHaveLength(5);expect(()=>parse({...v1,records:f.records})).toThrow(/UNAVAILABLE/);});
 it.each(['count','duplicate','provenance','version','extra','empty','oversized'])('rejects %s instead of widening source authority',kind=>{const f=fixture();const p:any=structuredClone(f.packet);if(kind==='count')p.record_count=5;if(kind==='duplicate')p.records[5]=p.records[0];if(kind==='provenance')p.provenance='DEMO_ARC_TESTNET';if(kind==='version')p.schema_version=3;if(kind==='extra')p.financial_action_eligible=true;if(kind==='empty'){p.record_count=0;p.records=[];}if(kind==='oversized')p.record_count=51;expect(()=>parse(p)).toThrow(/UNAVAILABLE/);});
 it('legacy V1 list/detail omit fresh-only V3 metadata',async()=>{
  const f=fixture(),{schema_version,record_count,provenance,...legacy}=f.packet,view=parse({...legacy,records:f.records.slice(0,5)});
  const readers=createObligationReaders(async()=>({revalidate:async()=>{}} as AuthContext),(records,binding)=>loadExistingDemoState({call:async()=>({revision:7,snapshot:f.snapshot})},'FICTIONAL-VIEW',records,binding),()=>view,()=>undefined);
  const list=await(await readers.list(new Request('https://fixture.invalid'))).json();expect(list.total_count).toBe(5);expect(list.obligations.every((r:any)=>r.fresh_assessment_readiness===undefined)).toBe(true);
  const detail=await(await readers.detail(new Request('https://fixture.invalid'),f.records[0].obligation_id)).json();expect(detail.record.obligation_id).toBe(f.records[0].obligation_id);expect(detail.fresh_assessment_readiness).toBeUndefined();
 });
 it('packages the exact v2 bytes and reports six without creating any state',()=>{
  const f=fixture(),directory=mkdtempSync(join(tmpdir(),'catalog-v2-package-'));
  try{const bytes=Buffer.from(JSON.stringify(f.packet)),approved=join(directory,'approved.json');writeFileSync(approved,bytes);
   const result=JSON.parse(execFileSync(process.execPath,[join(import.meta.dirname,'../scripts/package-operator-source.mjs'),'--approved-source',approved,'--sha256',createHash('sha256').update(bytes).digest('hex')],{cwd:directory,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
   expect(result).toMatchObject({record_count:6,financial_eligibility:'UNCHANGED_NOT_GRANTED',provisioning:'LOCAL_BYTES_ONLY_NOT_HOSTED_APPROVAL'});expect(readFileSync(join(directory,'.tameion/operator-source.json'))).toEqual(bytes);
  }finally{rmSync(directory,{recursive:true,force:true});}
 });
 it('loads six only with matching existing aggregates and emits server-owned genuine provenance',async()=>{
  const f=fixture(),view=parse(f.packet),rpc={call:vi.fn(async(_name:string,_params:Record<string,unknown>)=>({revision:7,snapshot:f.snapshot}))};
  const readers=createObligationReaders(async()=>({revalidate:async()=>{}} as AuthContext),(records,binding)=>loadExistingDemoState(rpc,'FICTIONAL-VIEW',records,binding),()=>view,()=>undefined);
  const list=await (await readers.list(new Request('https://fixture.invalid'))).json();expect(list.total_count).toBe(6);expect(list.obligations.every((r:any)=>!('fresh_assessment_readiness' in r))).toBe(true);expect(list.obligations.every((r:any)=>r.source_group==='GENUINE_COMPANY')).toBe(true);
  for(const r of f.records){const d=await(await readers.detail(new Request('https://fixture.invalid'),r.obligation_id)).json();expect(d).toMatchObject({financial_action_eligible:false,source_group:'GENUINE_COMPANY'});expect(d.fresh_assessment_readiness).toBeUndefined();}
  const added=list.obligations.find((r:any)=>r.obligation_id==='FICTIONAL-OWNER-ENTRY');expect(added).toMatchObject({assessed:false,decision:null});
  expect(rpc.call.mock.calls.every(c=>c[0]==='tameion_state_load_existing')).toBe(true);
  const missing=structuredClone(f.snapshot);missing.authority.aggregates.pop();rpc.call.mockResolvedValue({revision:7,snapshot:missing});
  expect((await readers.list(new Request('https://fixture.invalid'))).status).toBe(503);
 });
 it('keeps independently admitted demo membership separate and rejects cross-namespace ID collision',async()=>{
  const f=fixture(),view=parse(f.packet),source={...f.records[5],obligation_id:'TESTNET-CONTROLLED-FICTIONAL',business_purpose_confirmed:false,source_evidence:[{evidence_id:'FICTIONAL-TESTNET',content_sha256:'a'.repeat(64)}],commercial_terms:'TESTNET_ONLY NON_ECONOMIC NOT_VENDOR_PAYMENT'};
  const now=Date.now(),packet={purpose:'TESTNET_FINANCIAL_SOURCE',approval_id:'FICTIONAL-DEMO-ADMISSION',organization_id:'ORG-DEMO-001',deployment_id:'dpl_fixture',namespace:'FICTIONAL-DEMO',valid_from:new Date(now-1000).toISOString(),expires_at:new Date(now+60000).toISOString(),intent_id:'FICTIONAL-DEMO-INTENT',classification:'TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT',principal:'1.000000',estimated_fee_ceiling:'0.002000',estimated_total_ceiling:'1.002000',source};
  const bytes=Buffer.from(JSON.stringify(packet)),controlled=()=>parseFinancialSource(bytes,createHash('sha256').update(bytes).digest('hex'),{VERCEL_DEPLOYMENT_ID:'dpl_fixture',TAMEION_STATE_NAMESPACE:'FICTIONAL-DEMO'},now);
  const demo=new DemoState(undefined,undefined,undefined,undefined,{},[source]);
  const load=vi.fn(async(records:Parameters<typeof loadExistingDemoState>[2],binding?:Parameters<typeof loadExistingDemoState>[3],namespace?:string)=>namespace==='FICTIONAL-DEMO'?demo:loadExistingDemoState({call:async()=>({revision:7,snapshot:f.snapshot})},'FICTIONAL-VIEW',records,binding));
  const guard=async()=>({revalidate:async()=>{}} as AuthContext);
  const readers=createObligationReaders(guard,load,()=>view,controlled);
  const list=await(await readers.list(new Request('https://fixture.invalid'))).json();expect(list.obligations.filter((r:any)=>r.source_group==='GENUINE_COMPANY')).toHaveLength(6);expect(list.obligations.every((r:any)=>!('fresh_assessment_readiness' in r))).toBe(true);expect(list.obligations.filter((r:any)=>r.source_group==='DEMO_ARC_TESTNET')).toMatchObject([{obligation_id:source.obligation_id}]);
  const collision=parse({...f.packet,records:[...f.records.slice(0,5),{...f.records[5],obligation_id:source.obligation_id}]});load.mockClear();
  expect((await createObligationReaders(guard,load,()=>collision,controlled).list(new Request('https://fixture.invalid'))).status).toBe(503);expect(load).not.toHaveBeenCalled();
 });
 it('does not seed or accept mismatched binding/amount even for an approved v2 catalog',async()=>{const f=fixture();const rpc={call:vi.fn(async(_name:string,_params:Record<string,unknown>)=>({revision:7,snapshot:f.snapshot}))};for(const state_binding of [{...f.packet.state_binding,revision:8},{...f.packet.state_binding,namespace:'OTHER'},{...f.packet.state_binding,authority_sha256:'0'.repeat(64)}])await expect(loadExistingDemoState(rpc,'FICTIONAL-VIEW',f.records,state_binding)).rejects.toMatchObject({code:'STATE_UNAVAILABLE'});const wrong=structuredClone(f.records);wrong[5].amount='2.00';await expect(loadExistingDemoState(rpc,'FICTIONAL-VIEW',wrong,f.packet.state_binding)).rejects.toMatchObject({code:'STATE_UNAVAILABLE'});});
});
