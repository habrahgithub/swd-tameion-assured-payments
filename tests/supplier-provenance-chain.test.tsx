/** @vitest-environment jsdom */
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor,fireEvent} from '@testing-library/react';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import {syntheticSourceRecords} from './test-support/synthetic-source-records';
import {parseOperatorSource} from '../src/server/operator-source-records';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
import {DemoState} from '../src/server/demo-state';
import {CommandCenter,SourceObligationLineage} from '../app/command-center';
import type {AuthContext} from '../src/server/operator-auth';
const hash=(v:unknown)=>createHash('sha256').update(canonicalize(v)).digest('hex');
const fetchMock=vi.fn<typeof fetch>();
// Synthetic public fixtures: invented supplier and evidence identifiers only.
function fixture(supplier?:Record<string,unknown>){
 const records:any[]=syntheticSourceRecords().map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...r}:any)=>({...r,source_evidence:r.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));
 if(supplier)Object.assign(records[0],supplier);
 const snapshot:any=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot();
 const {assessments,...base}=snapshot.authority;
 const packet={schema_version:3,record_count:5,provenance:'GENUINE_COMPANY_OBLIGATIONS',purpose:'GENUINE_ADVISORY_SOURCE',organization_id:'ORG-DEMO-001',state_binding:{namespace:'FICTIONAL-GENUINE',revision:7,authority_sha256:hash(snapshot.authority),workflow_base_sha256:hash(base)},records};
 const bytes=Buffer.from(JSON.stringify(packet));
 return {records,snapshot,bytes,digest:createHash('sha256').update(bytes).digest('hex')};
}
const supplierFields=(records:any[])=>({beneficiary_name:'Synthetic Supplier Ltd',beneficiary_provenance:{provenance_class:'SOURCE_EVIDENCE',evidence_id:records[0].source_evidence[0].evidence_id}});
function readers(f:ReturnType<typeof fixture>){
 const view=parseOperatorSource(f.bytes,f.digest);
 const guard=async()=>({session:{operator_key:'fictional',credential_version:1},revalidate:async()=>{}} as unknown as AuthContext);
 return {view,readers:createObligationReaders(guard,async(records,binding)=>loadExistingDemoState({call:async()=>({revision:8,snapshot:structuredClone(f.snapshot)})},view.state_binding.namespace,records,binding),()=>view,()=>undefined)};
}

describe('supplier identity: strict source parser',()=>{
 it('keeps legacy records byte-compatible and accepts supplier identity only with provenance anchored to cited evidence',()=>{
  const legacy=fixture();expect(parseOperatorSource(legacy.bytes,legacy.digest).records[0]).not.toHaveProperty('beneficiary_name');
  const probe=fixture();const ok=fixture(supplierFields(probe.records));
  expect(parseOperatorSource(ok.bytes,ok.digest).records[0]).toMatchObject({beneficiary_name:'Synthetic Supplier Ltd',beneficiary_provenance:{provenance_class:'SOURCE_EVIDENCE'}});
  const bad:Array<Record<string,unknown>>=[{beneficiary_name:'Synthetic Supplier Ltd'},{beneficiary_provenance:{provenance_class:'SOURCE_EVIDENCE',evidence_id:'EVID-SYNTHETIC-001'}},{beneficiary_name:'Synthetic Supplier Ltd',beneficiary_provenance:{provenance_class:'SOURCE_EVIDENCE',evidence_id:'EVID-NOT-CITED'}},{beneficiary_name:'',beneficiary_provenance:{provenance_class:'SOURCE_EVIDENCE',evidence_id:'EVID-SYNTHETIC-001'}},{beneficiary_name:'X',beneficiary_provenance:{provenance_class:'SELF_ASSERTED',evidence_id:'EVID-SYNTHETIC-001'}}];
  for(const extra of bad){const f=fixture(extra);expect(()=>parseOperatorSource(f.bytes,f.digest)).toThrow('OPERATOR_SOURCE_UNAVAILABLE');}
 });
 it('adding supplier identity changes the record digest, so prior receipts bound to the old record cannot silently carry over',()=>{
  const legacy=fixture(),probe=fixture(),withSupplier=fixture(supplierFields(probe.records));
  expect(hash(parseOperatorSource(legacy.bytes,legacy.digest).records[0])).not.toBe(hash(parseOperatorSource(withSupplier.bytes,withSupplier.digest).records[0]));
 });
});

describe('supplier identity: real parser → real API producer → real UI',()=>{
 beforeEach(()=>{localStorage.clear();fetchMock.mockReset();vi.stubGlobal('fetch',fetchMock);});
 afterEach(()=>{cleanup();vi.unstubAllGlobals();});
 it('emits the supplier and its provenance in the real list and detail projections; legacy rows emit neither',async()=>{
  const probe=fixture(),f=fixture(supplierFields(probe.records)),{readers:r}=readers(f);
  const list=await(await r.list(new Request('https://fixture.invalid'))).json();
  const withSupplier=list.obligations.find((o:any)=>o.obligation_id===f.records[0].obligation_id),legacy=list.obligations.find((o:any)=>o.obligation_id===f.records[1].obligation_id);
  expect(withSupplier).toMatchObject({beneficiary_name:'Synthetic Supplier Ltd',beneficiary_provenance:{provenance_class:'SOURCE_EVIDENCE',evidence_id:f.records[0].source_evidence[0].evidence_id}});
  expect(legacy).not.toHaveProperty('beneficiary_name');
  const detail=await(await r.detail(new Request('https://fixture.invalid'),f.records[0].obligation_id)).json();
  expect(detail.record).toMatchObject({beneficiary_name:'Synthetic Supplier Ltd',beneficiary_provenance:{provenance_class:'SOURCE_EVIDENCE'}});
  // The supplier never enters the model-facing context.
  const {buildFinanceAgentContext}=await import('../src/agent/context-builder');
  expect(JSON.stringify(buildFinanceAgentContext(f.records[0],1))).not.toContain('Synthetic Supplier Ltd');
 });
 it('renders the supplier and explicit provenance in the real UI from the real producer output, with an honest legacy fallback',async()=>{
  const probe=fixture(),f=fixture(supplierFields(probe.records)),{readers:r}=readers(f);
  fetchMock.mockImplementation(async(input,init)=>{
   const url=String(input);if(init?.method==='POST')return new Response('{}',{status:200});
   const request=new Request('https://fixture.invalid'+url);
   return url==='/api/obligations'?r.list(request):r.detail(request,decodeURIComponent(url.split('/').at(-1)!));
  });
  render(<CommandCenter/>);
  const main=await waitFor(()=>{const m=screen.getByRole('main');expect(m.querySelectorAll('button[data-obligation-id]').length).toBeGreaterThan(1);return m;});
  const row=(id:string)=>main.querySelector<HTMLButtonElement>(`button[data-obligation-id="${id}"]`)!;
  expect(row(f.records[0].obligation_id).textContent).toContain('Synthetic Supplier Ltd');
  expect(row(f.records[0].obligation_id).textContent).not.toMatch(/Not recorded|Supplier not recorded/);
  expect(row(f.records[1].obligation_id).textContent).toMatch(/Supplier · Not recorded|Supplier not recorded/);
  fireEvent.click(row(f.records[0].obligation_id));
  await waitFor(()=>expect(screen.getByRole('main').textContent).toContain(`${f.records[0].obligation_id} · Synthetic Supplier Ltd`));
  const detail=await(await r.detail(new Request('https://fixture.invalid'),f.records[0].obligation_id)).json();
  render(<SourceObligationLineage record={detail.record} payableState="OUTSTANDING" selectedObligationId={f.records[0].obligation_id}/>);
  const lineage=screen.getAllByRole('region',{name:'Source obligation lineage'}).at(-1)!;
  expect(lineage.textContent).toContain('Synthetic Supplier Ltd');expect(lineage.textContent).toContain(`Source evidence ${f.records[0].source_evidence[0].evidence_id}`);
  expect(lineage.textContent).not.toContain('Supplier name is not included');
  const legacyDetail=await(await r.detail(new Request('https://fixture.invalid'),f.records[1].obligation_id)).json();
  render(<SourceObligationLineage record={legacyDetail.record} payableState="OUTSTANDING" selectedObligationId={f.records[1].obligation_id}/>);
  expect(screen.getAllByRole('region',{name:'Source obligation lineage'}).at(-1)!.textContent).toContain('Supplier name is not included');
 });
});
