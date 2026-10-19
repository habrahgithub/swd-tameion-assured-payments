import {test,expect} from './network-fence';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import {DemoState} from '../src/server/demo-state';
import {syntheticSourceRecords} from '../tests/test-support/synthetic-source-records';
import {parseOperatorSource} from '../src/server/operator-source-records';
import {createGenuineWorkflowHandlers} from '../src/server/genuine-workflow';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
import type {AuthContext} from '../src/server/operator-auth';

const originalFetch=globalThis.fetch;
test.afterEach(()=>{globalThis.fetch=originalFetch;});
for(const width of [390,1365])for(const mode of ['rejected','review-only','stale'] as const)test(`bounded recovery ${mode} at ${width}`,async({page},info)=>{
 globalThis.fetch=async()=>{throw new Error('External provider network forbidden in synthetic browser verification');};
 const records=syntheticSourceRecords().map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...r}:any)=>({...r,source_evidence:r.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));
 for(const r of records){const evidence=r.source_evidence[0];r.assessment_basis={transaction_type:'INVOICE',classification_evidence:evidence,timing:{basis:'INVOICE_CASH_TERM',date:r.effective_due_date,evidence},simulation:{mode:'HISTORICAL_AS_OF',as_of_date:'2020-01-05',evidence,owner_authority_reference:'SYNTHETIC-REVIEW-FIXTURE'}};}
 let snapshot=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot(),revision=8;
 const hash=(v:unknown)=>createHash('sha256').update(canonicalize(v)).digest('hex'),{assessments,...base}=snapshot.authority;
 const bytes=Buffer.from(JSON.stringify({schema_version:3,record_count:5,provenance:'GENUINE_COMPANY_OBLIGATIONS',purpose:'GENUINE_ADVISORY_SOURCE',organization_id:'ORG-DEMO-001',state_binding:{namespace:'SYNTHETIC-REVIEW',revision:7,authority_sha256:hash(snapshot.authority),workflow_base_sha256:hash(base)},records}));
 const source=()=>parseOperatorSource(bytes,createHash('sha256').update(bytes).digest('hex'));
 const guard=async()=>({session:{operator_key:'synthetic',credential_version:1},revalidate:async()=>{}} as unknown as AuthContext);
 let writes=0;const repository={loadExisting:async()=>({revision,snapshot:structuredClone(snapshot) as any}),compareAndSet:async(_n:string,_r:number,next:any)=>{writes++;snapshot=next;return ++revision;}};
 const workflow=createGenuineWorkflowHandlers({guard,source,repository});
 const readers=createObligationReaders(guard,(records,binding)=>loadExistingDemoState({call:async()=>({revision,snapshot})},'SYNTHETIC-REVIEW',records,binding),source,()=>undefined);
 const cap=()=>{for(let n=0;n<4;n++)snapshot.assessment_operations.push({idempotency_key:`aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12,'0')}`,obligation_id:records[0].obligation_id,aggregate_version:1,status:'STALE'});};
 if(mode==='review-only')cap();
 let attempted=false;const posts:string[]=[];
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/operator/session')return route.fulfill({json:{authenticated:true,csrf_token:'SYNTHETIC-CSRF',expires_at:new Date(Date.now()+3600000).toISOString()}});
  if(path==='/api/wallet/balance/refresh')return route.fulfill({status:503,json:{code:'SYNTHETIC_BALANCE_UNAVAILABLE'}});
  const request=new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.method()==='POST'?{body:req.postData()}: {})});
  if(req.method()==='POST'){
   posts.push(path);expect(req.headers()['x-tameion-csrf']).toBe('SYNTHETIC-CSRF');expect(path).toBe(`/api/obligations/${records[0].obligation_id}/advisory`);
   cap();attempted=true;const before=JSON.stringify(snapshot),response=await workflow('assess',request,records[0].obligation_id);
   expect(response.status).toBe(409);expect(JSON.stringify(snapshot)).toBe(before);expect(writes).toBe(0);
   return route.fulfill({status:response.status,json:await response.json()});
  }
  if(path==='/api/obligations')return route.fulfill({json:await(await readers.list(request)).json()});
  if(mode==='stale'&&attempted)return route.fulfill({status:409,json:{code:'SOURCE_BINDING_CHANGED',error:'PRIVATE_BODY_MUST_NOT_RENDER'}});
  const response=await readers.detail(request,path.split('/').at(-1)!);let detail=await response.json();
  if(mode==='review-only'&&path.endsWith(records[0].obligation_id))detail={...detail,pae_sealed:true,settlement_proxy:{source_aggregate_version:1,mapped_aggregate_version:1,preflight:{obligation_id:records[0].obligation_id}},aggregate:{...detail.aggregate,pae_state:'REVOKED'},truth:{...detail.truth,tameion_control_truth:{...detail.truth.tameion_control_truth,pae_state:'REVOKED',execution_release_authority:'REVOKED'}}};
  return route.fulfill({status:response.status,json:detail});
 });
 await page.setViewportSize({width,height:900});await page.goto('/');await page.getByRole('button',{name:'Open workspace'}).click();await page.getByRole('button',{name:'Review payables',exact:true}).click();
 if(width<768)await page.getByRole('button',{name:'Choose a payable',exact:true}).first().click();
 const a=page.locator(`button[data-obligation-id="${records[0].obligation_id}"]`);await a.click();
 if(mode!=='review-only')await page.getByRole('button',{name:'Run AI Assessment',exact:true}).click();
 if(mode==='stale'){
  await expect(page.getByText('Last-known payable details are out of date.')).toBeVisible();await expect(page.getByText('Obligations unavailable (HTTP 409; SOURCE_BINDING_CHANGED).')).toBeVisible();await expect(page.getByText('PRIVATE_BODY_MUST_NOT_RENDER')).toHaveCount(0);
 }else{
  if(mode==='rejected')await expect(page.getByRole('heading',{name:'Assessment request rejected'})).toBeVisible();
  await page.getByRole('button',{name:'View assessment status',exact:true}).last().click();await expect(page.getByRole('region',{name:'Assessment result'})).toContainText('history limit');
  await expect(page.getByRole('main')).not.toContainText('run a fresh assessment');
  if(width<768)await page.getByRole('button',{name:/Switch payable/}).click();
  await page.locator(`button[data-obligation-id="${records[1].obligation_id}"]`).click();await expect(a).toContainText('Last checked');await expect(a).toContainText(records[0].effective_due_date);
 }
 await expect(page.getByRole('button',{name:/Run AI Assessment|Authorize payment|Pay testnet/})).toHaveCount(mode==='stale'?0:1); // B may be assessed; no POST is made for it.
 expect(posts.length).toBe(mode==='review-only'?0:1);expect(writes).toBe(0);
 await page.screenshot({path:info.outputPath(`bounded-recovery-${mode}-${width}.png`),fullPage:true});
});
