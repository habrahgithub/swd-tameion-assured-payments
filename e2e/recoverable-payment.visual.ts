import {test,expect} from './network-fence';
import {createSourceWorkflowHandlers} from '../src/server/source-workflow';
import {createObligationReaders} from '../src/server/operator-obligation-routes';
import {DemoState} from '../src/server/demo-state';
import {contentHash} from '../src/domain/linked-instruction';
import type {OperatorSourceView} from '../src/server/operator-source-records';
import type {AuthContext} from '../src/server/operator-auth';
for(const width of [390,1365])test(`AI-OFF source correction, human escalation resolution and linked draft at ${width}`,async({page},info)=>{
 const previousFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw new Error('Application network fenced before all stages');};
 try{
 let snapshot=new DemoState(undefined,undefined,undefined,undefined,{},[]).exportSnapshot(),revision=1;
 const source:OperatorSourceView={records:[],state_binding:{namespace:'SYNTHETIC-BROWSER-SOURCE',revision,authority_sha256:contentHash(snapshot.authority)},source_ingress:{schema_version:'SOURCE-INGRESS-1',operator_key:'SYNTHETIC-OPERATOR',credential_version:1,actor_id:snapshot.actor_authorities[0].actor_id,valid_from:new Date(Date.now()-1000).toISOString(),expires_at:new Date(Date.now()+1800000).toISOString(),permissions:['CREATE_SOURCE','CORRECT_SOURCE','REVIEW_SOURCE']}};
 const guard=async()=>({session:{operator_key:'SYNTHETIC-OPERATOR',credential_version:1},revalidate:async()=>{}} as unknown as AuthContext);
 const repository={loadExisting:async()=>({revision,snapshot:structuredClone(snapshot) as unknown as Record<string,unknown>}),compareAndSet:async(_n:string,expected:number,next:Record<string,unknown>)=>{if(expected!==revision)throw new Error('Synthetic CAS conflict');snapshot=structuredClone(next) as unknown as typeof snapshot;return ++revision;}};
 const workflow=createSourceWorkflowHandlers({guard,source:()=>source,repository:()=>repository});
 const readers=createObligationReaders(guard,async()=>{throw new Error('Financial namespace not activated in this browser test');},()=>source,()=>undefined,workflow);
 await page.route('**/api/**',async route=>{
  const req=route.request(),path=new URL(req.url()).pathname,method=req.method();
  if(path==='/api/operator/session')return route.fulfill({json:{authenticated:true,csrf_token:'SYNTHETIC-CSRF',expires_at:new Date(Date.now()+3600000).toISOString()}});
  if(path==='/api/wallet/balance/refresh')return route.fulfill({status:503,json:{code:'SYNTHETIC_BALANCE_UNAVAILABLE'}});
  const request=new Request(req.url(),{method,headers:req.headers(),...(method==='POST'||method==='PATCH'?{body:req.postData()}: {})});
  const id=path.split('/')[3];let response:Response;
  if(method==='GET')response=path==='/api/obligations'?await readers.list(request):await readers.detail(request,id);
  else {expect(req.headers()['x-tameion-csrf']).toBe('SYNTHETIC-CSRF');response=await workflow(method==='PATCH'||path==='/api/obligations'?'save':path.endsWith('/review')?'review':'draft',request,path==='/api/obligations'?undefined:id);}
  return route.fulfill({status:response.status,json:await response.json()});
 });
 await page.setViewportSize({width,height:900});await page.goto('/');await page.getByRole('button',{name:'Open workspace'}).click();await page.getByRole('button',{name:'Review payables',exact:true}).click();
 const panel=page.getByRole('region',{name:'Payable source and human review'});await panel.getByRole('button',{name:'Create payable',exact:true}).click();
 const fields={'Supplier name':'Synthetic browser supplier','Invoice number':'SYNTHETIC-BROWSER-INV','Invoice issue date':'2026-10-20','Payment terms':'Due on receipt','Due date':'2026-10-20','Description':'Synthetic browser source','Exact amount':'2.00','Source currency':'USD','Payer Circle Wallet ID':'SYNTHETIC-UNVERIFIED-PAYER','Evidence reference':'SYNTHETIC-BROWSER-EVIDENCE','Evidence SHA256':'a'.repeat(64),'Correction or entry reason':'Synthetic browser entry'};
 for(const [label,value]of Object.entries(fields))await panel.getByLabel(label,{exact:true}).fill(value);
 await panel.getByRole('button',{name:'Save payable',exact:true}).click();await expect(panel).toContainText('Source revision saved and read back.');
 const id=snapshot.source_revisions![0].obligation_id;
 if(width<768)await page.getByRole('button',{name:'Choose a payable',exact:true}).first().click();await page.locator(`button[data-obligation-id="${id}"]`).click();
 await panel.getByRole('button',{name:'Edit payable / Save correction',exact:true}).click();await panel.getByLabel('Exact amount',{exact:true}).fill('1.00');await panel.getByLabel('Correction or entry reason',{exact:true}).fill('Correct actual synthetic amount');await panel.getByRole('button',{name:'Save correction',exact:true}).click();await expect(panel).toContainText('Source revision saved and read back.');
 await panel.getByRole('textbox',{name:'Review rationale',exact:true}).fill('Synthetic escalation assigned to current authorized operator');await panel.getByRole('button',{name:'Assign escalation',exact:true}).click();await expect(panel).toContainText('Human review: ESCALATE');
 await panel.getByRole('textbox',{name:'Review rationale',exact:true}).fill('Synthetic owner resolved the exact current source facts');await panel.getByRole('button',{name:'Continue with manual review',exact:true}).click();await expect(panel).toContainText('Human review: ACCEPT_FOR_AUTHORIZATION');await expect(page.getByRole('heading',{name:'Assessment required',exact:true})).toHaveCount(0);await panel.getByRole('button',{name:'Prepare linked testnet instruction',exact:true}).click();
 await expect.poll(()=>snapshot.linked_settlement_instructions?.length).toBe(1);expect(snapshot.source_revisions).toHaveLength(2);expect(snapshot.authority.assessments).toEqual([]);expect(snapshot.execution_ledger).toEqual([]);expect(network).toBe(0);
 await page.screenshot({path:info.outputPath(`recoverable-source-${width}.png`),fullPage:true});
 }finally{globalThis.fetch=previousFetch;}
});
