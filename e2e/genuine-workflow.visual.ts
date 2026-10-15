import {test,expect} from './network-fence';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import {DemoState} from '../src/server/demo-state';
import {syntheticSourceRecords} from '../tests/test-support/synthetic-source-records';
import {parseOperatorSource} from '../src/server/operator-source-records';
import {createGenuineWorkflowHandlers} from '../src/server/genuine-workflow';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
import {DemoStateConflictError} from '../src/server/supabase-demo-state-repository';
import type {AuthContext} from '../src/server/operator-auth';
const originalNvidiaKey=process.env.NVIDIA_API_KEY;
test.beforeEach(()=>{delete process.env.NVIDIA_API_KEY;});
test.afterEach(()=>{if(originalNvidiaKey===undefined)delete process.env.NVIDIA_API_KEY;else process.env.NVIDIA_API_KEY=originalNvidiaKey;});
for(const width of [1365,390])for(const expected of ["PAY","HOLD"])test(`genuine ${expected} advisory stays separate and locked at ${width}`,async({page},info)=>{
 const records=syntheticSourceRecords().map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...r}:any)=>({...r,source_evidence:r.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));
 if(expected==='HOLD'){Object.assign(records[0],{issue_date:null,effective_due_date:null,effective_due_date_basis:null,effective_due_date_provenance:null});}
 let snapshot=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot(),revision=7;
 const digest=(v:unknown)=>createHash('sha256').update(canonicalize(v)).digest('hex'),{assessments,...base}=snapshot.authority;
 const bytes=Buffer.from(JSON.stringify({schema_version:3,record_count:5,provenance:'GENUINE_COMPANY_OBLIGATIONS',purpose:'GENUINE_ADVISORY_SOURCE',organization_id:'ORG-DEMO-001',state_binding:{namespace:'FICTIONAL-VIEW',revision,authority_sha256:digest(snapshot.authority),workflow_base_sha256:digest(base)},records}));
 const source=()=>parseOperatorSource(bytes,createHash('sha256').update(bytes).digest('hex'));
 const guard=async()=>({session:{operator_key:'fictional',credential_version:1},revalidate:async()=>{}} as unknown as AuthContext);
 const repository={loadExisting:async()=>({snapshot:structuredClone(snapshot) as any,revision}),compareAndSet:async(_n:string,r:number,next:any)=>{if(r!==revision)throw new DemoStateConflictError();snapshot=structuredClone(next);return ++revision;}};
 const handlers=createGenuineWorkflowHandlers({guard,source,repository});
 const readers=createObligationReaders(guard,(records,binding)=>loadExistingDemoState({call:async()=>({revision,snapshot})},'FICTIONAL-VIEW',records,binding),source,()=>undefined);
 const posts:string[]=[];
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/operator/session')return route.fulfill({json:{authenticated:true,csrf_token:'MOCK-CSRF',expires_at:new Date(Date.now()+3600000).toISOString()}});
  if(path==='/api/wallet/balance/refresh')return route.fulfill({status:503,json:{code:'MOCK_BALANCE_UNAVAILABLE'}});
  const request=new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.method()==='POST'?{body:req.postData()}: {})});
  let response:Response;
  if(path==='/api/obligations')response=await readers.list(request);
  else if(req.method()==='POST'){
   posts.push(path);expect(req.headers()['x-tameion-csrf']).toBe('MOCK-CSRF');
   const match=/^\/api\/obligations\/([^/]+)\/(advisory|testnet-instruction)$/.exec(path);if(!match)throw new Error('Unexpected financial route');
   response=await handlers(match[2]==='advisory'?'assess':'draft',request,match[1]);
  }else response=await readers.detail(request,path.split('/').pop()!);
  return route.fulfill({status:response.status,json:await response.json()});
 });
 await page.setViewportSize({width,height:900});await page.goto('/');await page.getByRole('button',{name:'Open workspace'}).click();await page.getByRole('button',{name:'Review payables',exact:true}).click();
 if(width<768)await page.getByRole('button',{name:'Choose an obligation',exact:true}).first().click();
 await page.locator(`button[data-obligation-id="${records[0].obligation_id}"]`).click();
 await page.getByRole('button',{name:'Run AI Assessment',exact:true}).click();
 if(expected==='HOLD'){
  await expect(page.getByRole('heading',{name:'Assessment result — HOLD',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Create linked testnet instruction',exact:true})).toHaveCount(0);
  expect(posts).toEqual([`/api/obligations/${records[0].obligation_id}/advisory`]);expect(snapshot.linked_settlement_instructions).toBeUndefined();expect(snapshot.authorization_history).toEqual([]);expect(snapshot.execution_ledger).toEqual([]);
  await page.screenshot({path:info.outputPath(`genuine-hold-${width}.png`),fullPage:true});return;
 }
 await expect(page.getByRole('button',{name:'Create linked testnet instruction',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Create linked testnet instruction',exact:true}).click();
 await expect(page.getByRole('region',{name:'Linked Arc Testnet instructions'})).toContainText('Draft · payment authority required');
 expect(posts).toEqual([`/api/obligations/${records[0].obligation_id}/advisory`,`/api/obligations/${records[0].obligation_id}/testnet-instruction`]);
 expect(snapshot.authorization_history).toEqual([]);expect(snapshot.execution_ledger).toEqual([]);expect(snapshot.linked_settlement_instructions).toHaveLength(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`genuine-linked-draft-${width}.png`),fullPage:true});
 // All transport/auth and advisory provider output here are local test fixtures; no live calls.
});
