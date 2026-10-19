import {test,expect} from './network-fence';
import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import {DemoState} from '../src/server/demo-state';
import {syntheticSourceRecords} from '../tests/test-support/synthetic-source-records';
import {parseOperatorSource} from '../src/server/operator-source-records';
import {createGenuineAssessmentStatusHandler} from '../src/server/genuine-assessment-status';
import {createGenuineWorkflowHandlers} from '../src/server/genuine-workflow';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
import {DemoStateConflictError} from '../src/server/supabase-demo-state-repository';
import type {AuthContext} from '../src/server/operator-auth';
import {sealTestAssessment} from '../tests/test-support/seal-assessment';
const originalNvidiaKey=process.env.NVIDIA_API_KEY,originalGuard=process.env.TAMEION_ASSESSMENT_BOOTSTRAP_GUARD,originalNodeFetch=globalThis.fetch;
test.afterEach(()=>{if(originalGuard===undefined)delete process.env.TAMEION_ASSESSMENT_BOOTSTRAP_GUARD;else process.env.TAMEION_ASSESSMENT_BOOTSTRAP_GUARD=originalGuard;globalThis.fetch=originalNodeFetch;if(originalNvidiaKey===undefined)delete process.env.NVIDIA_API_KEY;else process.env.NVIDIA_API_KEY=originalNvidiaKey;});
for(const width of [1365,390,320])for(const transactionType of ['INVOICE','PREPAID_NO_INVOICE'] as const)for(const expected of ["PAY","HOLD"] as const)for(const disposition of expected==='PAY'&&transactionType==='INVOICE'?[false,true]:[false])test(`genuine ${transactionType} ${expected} disposition=${disposition} advisory stays separate and locked at ${width}`,async({page},info)=>{
 const records=syntheticSourceRecords().map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...r}:any)=>({...r,source_evidence:r.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));
 for(const record of records){const evidence=record.source_evidence[0];record.assessment_basis={transaction_type:'INVOICE',classification_evidence:evidence,timing:{basis:'INVOICE_CASH_TERM',date:record.effective_due_date,evidence},simulation:{mode:'HISTORICAL_AS_OF',as_of_date:'2020-01-05',evidence,owner_authority_reference:'SYNTHETIC-BROWSER-OWNER-ADMISSION'}};}
 if(transactionType==='PREPAID_NO_INVOICE'){
  const record=records[0],evidence=record.source_evidence[0],serviceDate=record.issue_date;Object.assign(record,{issue_date:null,effective_due_date:null,effective_due_date_basis:null,effective_due_date_provenance:null,assessment_basis:{transaction_type:transactionType,classification_evidence:evidence,timing:{basis:'PREPAID_SERVICE_DATE',date:serviceDate,evidence},simulation:{mode:'HISTORICAL_AS_OF',as_of_date:serviceDate,evidence,owner_authority_reference:'SYNTHETIC-BROWSER-OWNER-ADMISSION'}}});
 }
 // A legitimate model HOLD uses valid deterministic source context; malformed source must be denied before reservation/provider.
 process.env.NVIDIA_API_KEY='NETWORK_DENIED_SYNTHETIC_NOT_A_CREDENTIAL';let providerCalls=0;
 globalThis.fetch=async(input)=>{if(String(input)!=='https://integrate.api.nvidia.com/v1/chat/completions')throw new Error(`External Node request forbidden: ${String(input)}`);providerCalls++;return Response.json({choices:[{message:{content:JSON.stringify({obligation_id:records[0].obligation_id,decision:expected,finding_codes:[],evidence_ids:records[0].source_evidence.map((e:any)=>e.evidence_id),uncertainty_signal:expected==='HOLD',explanation:'Offline browser provider fixture; no live inference.'})}}]});};
 let snapshot=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot(),revision=7;
 const legacyKey='11111111-1111-4111-8111-111111111111';
 if(disposition){snapshot.assessment_operations.push({idempotency_key:legacyKey,obligation_id:records[0].obligation_id,aggregate_version:1,status:'UNKNOWN',reserved_at:Date.now()-500_000});process.env.TAMEION_ASSESSMENT_BOOTSTRAP_GUARD='APPLIED_DISPOSITION_V1';}
 const digest=(v:unknown)=>createHash('sha256').update(canonicalize(v)).digest('hex'),{assessments,...base}=snapshot.authority;
 const stateBinding={namespace:'FICTIONAL-VIEW',revision,authority_sha256:digest(snapshot.authority),workflow_base_sha256:digest(base)};
 const ownerAdmission=disposition?{kind:'CURRENT_SOURCE_REASSESSMENT_ADMISSION',approval_id:'SYNTHETIC-BROWSER-ADMISSION',obligation_id:records[0].obligation_id,aggregate_version:1,source_record_sha256:digest(records[0]),binding_sha256:digest(stateBinding),predecessor_key:legacyKey,predecessor_sha256:digest(snapshot.assessment_operations[0]),valid_from:new Date(Date.now()-60_000).toISOString(),expires_at:new Date(Date.now()+600_000).toISOString()}:undefined;
 const bytes=Buffer.from(JSON.stringify({...(ownerAdmission?{owner_admission:ownerAdmission}:{}),schema_version:3,record_count:5,provenance:'GENUINE_COMPANY_OBLIGATIONS',purpose:'GENUINE_ADVISORY_SOURCE',organization_id:'ORG-DEMO-001',state_binding:{namespace:'FICTIONAL-VIEW',revision,authority_sha256:digest(snapshot.authority),workflow_base_sha256:digest(base)},records}));
 const source=()=>parseOperatorSource(bytes,createHash('sha256').update(bytes).digest('hex'));
 const guard=async()=>({session:{operator_key:'fictional',credential_version:1},revalidate:async()=>{}} as unknown as AuthContext);
 const repository={loadExisting:async()=>({snapshot:structuredClone(snapshot) as any,revision}),compareAndSet:async(_n:string,r:number,next:any)=>{if(r!==revision)throw new DemoStateConflictError();snapshot=structuredClone(next);return ++revision;}};
 const handlers=createGenuineWorkflowHandlers({guard,source,repository});
 const readers=createObligationReaders(guard,(records,binding,_namespace,admission)=>loadExistingDemoState({call:async()=>({revision,snapshot})},'FICTIONAL-VIEW',records,binding,admission),source,()=>undefined);
 const exactStatus=createGenuineAssessmentStatusHandler({guard,source,repository});
 if(disposition)await page.addInitScript(({id,key})=>localStorage.setItem(`tameion.assessment-request.${id}`,key),{id:records[0].obligation_id,key:legacyKey});
 const posts:string[]=[];
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/operator/session')return route.fulfill({json:{authenticated:true,csrf_token:'MOCK-CSRF',expires_at:new Date(Date.now()+3600000).toISOString()}});
  if(path==='/api/wallet/balance/refresh')return route.fulfill({status:503,json:{code:'MOCK_BALANCE_UNAVAILABLE'}});
  const request=new Request(req.url(),{method:req.method(),headers:req.headers(),...(req.method()==='POST'?{body:req.postData()}: {})});
  let response:Response;
  if(path==='/api/obligations')response=await readers.list(request);
  else if(req.method()==='POST'){
   posts.push(path);expect(req.headers()['x-tameion-csrf']).toBe('MOCK-CSRF');
   const match=/^\/api\/obligations\/([^/]+)\/(advisory(?:\/disposition|\/status)?|testnet-instruction)$/.exec(path);if(!match)throw new Error('Unexpected financial route');
   response=match[2]==='advisory/status'?await exactStatus(request,match[1]):await handlers(match[2]==='advisory/disposition'?'disposition':match[2]==='advisory'?'assess':'draft',request,match[1]);
  }else response=await readers.detail(request,path.split('/').pop()!);
  return route.fulfill({status:response.status,json:await response.json()});
 });
 await page.setViewportSize({width,height:900});await page.goto('/');await page.getByRole('button',{name:'Open workspace'}).click();await page.getByRole('button',{name:'Review payables',exact:true}).click();
 if(width<768)await page.getByRole('button',{name:'Choose a payable',exact:true}).first().click();
 await page.locator(`button[data-obligation-id="${records[0].obligation_id}"]`).click();
 await page.getByRole('button',{name:disposition?'Request admitted current-source disposition':'Run AI Assessment',exact:true}).click();
 if(disposition){await page.getByRole('button',{name:'Check assessment request',exact:true}).click();await page.getByRole('button',{name:'Review assessment',exact:true}).click();}
 if(expected==='HOLD'){
  await expect(page.getByRole('heading',{name:'Assessment result — HOLD',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Create linked testnet instruction',exact:true})).toHaveCount(0);
  expect(posts).toEqual([`/api/obligations/${records[0].obligation_id}/advisory`]);expect(providerCalls).toBe(1);expect(snapshot.authority.assessments[0]?.record).toMatchObject({provider_mode:'LIVE_AI',decision:'HOLD'});expect(snapshot.linked_settlement_instructions).toBeUndefined();expect(snapshot.authorization_history).toEqual([]);expect(snapshot.execution_ledger).toEqual([]);
  await page.screenshot({path:info.outputPath(`genuine-${transactionType.toLowerCase()}-hold-${width}.png`),fullPage:true});return;
 }
 await expect(page.getByRole('button',{name:'Create linked testnet instruction',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Assessment result'})).toContainText('AI-assisted payment review · advisory.');
 await page.getByRole('button',{name:'Create linked testnet instruction',exact:true}).click();
 await expect(page.getByRole('region',{name:'Linked Arc Testnet instructions'})).toContainText('Draft · payment authority required');
 expect(posts).toEqual(disposition?[`/api/obligations/${records[0].obligation_id}/advisory/disposition`,`/api/obligations/${records[0].obligation_id}/advisory/status`,`/api/obligations/${records[0].obligation_id}/advisory/status`,`/api/obligations/${records[0].obligation_id}/testnet-instruction`]:[`/api/obligations/${records[0].obligation_id}/advisory`,`/api/obligations/${records[0].obligation_id}/testnet-instruction`]);
 if(disposition){expect(snapshot.assessment_operations[0].status).toBe('UNKNOWN');expect(await page.evaluate(id=>localStorage.getItem(`tameion.assessment-request.${id}`),records[0].obligation_id)).toBe(legacyKey);}
 expect(providerCalls).toBe(1);expect(snapshot.authority.assessments[0]?.record.provider_mode).toBe('LIVE_AI');
 expect(snapshot.authorization_history).toEqual([]);expect(snapshot.execution_ledger).toEqual([]);expect(snapshot.linked_settlement_instructions).toHaveLength(1);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`genuine-${transactionType.toLowerCase()}-linked-draft-${width}.png`),fullPage:true});
 // All transport/auth and advisory provider output here are local test fixtures; no live calls.
});

for(const width of [1365,390,320])test(`selected controlled scope ignores unrelated genuine assessment coverage at ${width}`,async({page},info)=>{
 const genuine=syntheticSourceRecords().slice(0,1).map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...r}:any)=>({...r,source_evidence:r.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));
 const controlled={obligation_id:'TESTNET-CONTROLLED-VISUAL-001',service_category:'Controlled Arc Testnet settlement validation',recurrence:'ONE_TIME' as const,issue_date:null,due_date:null,due_date_status:'NOT_STATED_ON_SOURCE' as const,effective_due_date:null,effective_due_date_basis:null,effective_due_date_provenance:null,amount:'1.00',currency:'USD',state_at_event_baseline:'OUTSTANDING' as const,business_purpose_confirmed:false,commercial_terms:'TESTNET_ONLY NON_ECONOMIC NOT_VENDOR_PAYMENT',source_evidence:[{evidence_id:'CONTROLLED-VISUAL-001',content_sha256:'a'.repeat(64)}],candidate_readiness:{arc_product_destination_status:'NOT_VERIFIED'}};
 const genuineState=new DemoState(undefined,undefined,undefined,undefined,{},genuine),controlledState=new DemoState(undefined,undefined,undefined,undefined,{},[controlled]);
 sealTestAssessment(controlledState.store,'ORG-DEMO-001',controlled.obligation_id,1,{provider_mode:'LIVE_AI',provider_name:'local-browser-fixture'});
 const genuineSnapshot=genuineState.exportSnapshot(),controlledSnapshot=controlledState.exportSnapshot(),namespace='CONTROLLED-VISUAL-NAMESPACE';
 const sourceAdmission={purpose:'TESTNET_FINANCIAL_SOURCE' as const,approval_id:'CONTROLLED-VISUAL-APPROVAL',organization_id:'ORG-DEMO-001' as const,deployment_id:'dpl_visual',namespace,valid_from:new Date(Date.now()-60_000).toISOString(),expires_at:new Date(Date.now()+10*60_000).toISOString(),intent_id:'CONTROLLED-VISUAL-INTENT',classification:'TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT' as const,principal:'1.000000' as const,estimated_fee_ceiling:'0.002000' as const,estimated_total_ceiling:'1.002000' as const,source:controlled};
 const guard=async()=>({session:{operator_key:'visual',credential_version:1},revalidate:async()=>{}} as unknown as AuthContext);
 const readers=createObligationReaders(guard,async(records,_binding,requestedNamespace)=>loadExistingDemoState({call:async()=>requestedNamespace===namespace?{revision:1,snapshot:controlledSnapshot}:{revision:1,snapshot:genuineSnapshot}},requestedNamespace??'GENUINE-VISUAL',records),()=>genuine,()=>sourceAdmission);
 const posts:string[]=[];
 await page.route('**/api/**',async route=>{const req=route.request(),path=new URL(req.url()).pathname;
  if(path==='/api/operator/session')return route.fulfill({json:{authenticated:true,csrf_token:'MOCK-CSRF',expires_at:new Date(Date.now()+3600000).toISOString()}});
  if(path==='/api/wallet/balance/refresh')return route.fulfill({status:503,json:{code:'MOCK_BALANCE_UNAVAILABLE'}});
  if(req.method()==='POST'){posts.push(path);return route.fulfill({status:500,json:{error:'Unexpected POST'}});}
  const request=new Request(req.url(),{method:req.method(),headers:req.headers()});
  const response=path==='/api/obligations'?await readers.list(request):await readers.detail(request,path.split('/').pop()!);
  return route.fulfill({status:response.status,json:await response.json()});
 });
 await page.setViewportSize({width,height:900});await page.goto('/');await page.getByRole('button',{name:'Open workspace'}).click();await page.getByRole('button',{name:'Review payables',exact:true}).click();
 if(width<768)await page.getByRole('button',{name:'Choose a payable',exact:true}).first().click();
 await page.locator(`button[data-obligation-id="${controlled.obligation_id}"]`).click();await page.getByRole('button',{name:'View Assessment',exact:true}).click();
 await expect(page.getByRole('button',{name:'Prepare testnet payment details',exact:true})).toBeVisible();
 await expect(page.locator(`button[data-obligation-id="${genuine[0].obligation_id}"]`)).toHaveCount(1);expect(posts).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath(`selected-controlled-scope-${width}.png`),fullPage:true});
});
