// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import {SourceWorkflowPanel} from '../app/source-workflow-panel';
import {sourceHarness,invoice} from './test-support/source-workflow-fixture';
import {DemoStateConflictError} from '../src/server/supabase-demo-state-repository';
afterEach(()=>{cleanup();sessionStorage.clear();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.restoreAllMocks();});
async function setup(){
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:{...invoice,evidence:[...invoice.evidence,{evidence_id:'SYNTHETIC-SECOND',content_sha256:'b'.repeat(64)}]},reason:'Synthetic source error baseline'}))).json(),id=saved.obligation.obligation_id;
 const detail=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();
 vi.stubGlobal('crypto',webcrypto);return{h,id,detail};
}
function submit(){fireEvent.submit(screen.getByRole('button',{name:/^Save correction$|^Save payable$/}).closest('form')!);}
function retained(){const key=sessionStorage.key(0)!;return JSON.parse(sessionStorage.getItem(key)!);}
for(const kind of ['validation','revision','duplicate','imported','CAS']as const)it(`canonical handler to source UI: ${kind} has factual guidance without assessment uncertainty`,async()=>{
 const t=await setup(),before=structuredClone(t.h.snapshot());let target=t.id;let create=false;
 if(kind==='duplicate'||kind==='imported'){create=true;target='';}
 if(kind==='imported'){
  t.h.source.records=[...t.h.source.records,{...t.detail.record,beneficiary_name:'Synthetic imported supplier',issue_date:invoice.invoice_issue_date}];
  // Re-anchor the disposable fixture as a prepared imported catalog, before any command.
  const {contentHash}=await import('../src/domain/linked-instruction');t.h.snapshot().source_ingress_anchor=contentHash({binding:t.h.source.state_binding,records:t.h.source.records});
 }
 let rejection:{status:number;code:string}|undefined;
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{expect(init?.method).toBe(create?'POST':'PATCH');const req=new Request('https://synthetic.invalid'+url,init),response=await t.h.handler('save',req,create?undefined:t.id);rejection={status:response.status,code:(await response.clone().json()).code};return response;});vi.stubGlobal('fetch',fetcher);
 render(<SourceWorkflowPanel selectedId={target} csrfToken="SYNTHETIC-SOURCE-ERROR" onChanged={()=>{}} readModel={{detail:create?null:t.detail,createAllowed:create}}/>);
 fireEvent.click(await screen.findByText(create?'Create payable':'Edit payable / Save correction'));
 if(create){for(const[label,value]of Object.entries({'Supplier name':kind==='imported'?'Synthetic imported supplier':invoice.supplier_name,'Invoice number':kind==='imported'?'SYNTHETIC-IMPORTED-NEW':invoice.invoice_number,'Invoice issue date':invoice.invoice_issue_date,'Payment terms':invoice.payment_terms,'Due date':invoice.due_date,'Description':invoice.description,'Exact amount':invoice.amount,'Source currency':invoice.currency,'Payer Circle Wallet ID':invoice.payer_circle_wallet_id,'Evidence reference':invoice.evidence[0].evidence_id,'Evidence SHA256':invoice.evidence[0].content_sha256}))fireEvent.change(screen.getByLabelText(label),{target:{value}});}
 fireEvent.change(screen.getByLabelText('Correction or entry reason'),{target:{value:'Synthetic explicit source correction'}});
 if(kind==='validation')fireEvent.change(screen.getByLabelText('Exact amount'),{target:{value:'-1.00'}});
 if(kind==='revision')t.detail.source_revision.revision=0; // Request an actually stale revision through the real handler.
 if(kind==='CAS')t.h.repository.compareAndSet.mockRejectedValueOnce(new DemoStateConflictError());
 const writes=t.h.repository.compareAndSet.mock.calls.length;submit();await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));await waitFor(()=>expect(screen.getByRole('button',{name:create?'Save payable':'Save correction'}).hasAttribute('disabled')).toBe(false));
 expect(rejection).toEqual({status:kind==='validation'?400:409,code:{validation:'SOURCE_FIELDS_INVALID',revision:'SOURCE_REVISION_CONFLICT',duplicate:'DUPLICATE_SOURCE_IDENTITY',imported:'IMPORTED_SOURCE_REQUIRES_CORRECTION',CAS:'SOURCE_CONFLICT'}[kind]});
 const expected={validation:'Source details need correction',revision:'Source revision changed',duplicate:'Source already recorded',imported:'Imported source needs a correction',CAS:'Source changed while saving'}[kind];
 expect(document.body.textContent).toContain(expected);expect(document.body.textContent).not.toContain('Assessment completion unconfirmed');expect(document.body.textContent).not.toContain('original request remains unresolved; transport failure');
 if(kind==='validation')expect(document.body.textContent).toContain('Check: Exact amount');
 expect(retained().request).not.toBeNull();expect(JSON.parse(retained().request.signature).body.reason).toBe('Synthetic explicit source correction');
 expect(t.h.snapshot().source_revisions).toEqual(before.source_revisions);expect(t.h.snapshot().assessment_operations).toEqual([]);expect(t.h.snapshot().execution_ledger).toEqual([]);expect(t.h.repository.compareAndSet.mock.calls.length-writes).toBe(kind==='CAS'?1:0);
});
it('invalid corrected source retains all evidence/draft/key, then explicit fixed input saves with a new key and committed readback',async()=>{
 const t=await setup(),calls:{body:string;key:string|null}[]=[],changed=vi.fn();
 const unknown={idempotency_key:'11111111-1111-4111-8111-111111111111',obligation_id:t.id,aggregate_version:1,status:'UNKNOWN' as const,reserved_at:Date.now()-100000};t.h.snapshot().assessment_operations.push(structuredClone(unknown));
 vi.stubGlobal('fetch',vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{calls.push({body:String(init?.body),key:new Headers(init?.headers).get('Idempotency-Key')});return t.h.handler('save',new Request('https://synthetic.invalid'+url,init),t.id);}));
 render(<SourceWorkflowPanel selectedId={t.id} csrfToken="SYNTHETIC-SOURCE-ERROR" onChanged={changed} readModel={{detail:t.detail,createAllowed:false}}/>);fireEvent.click(await screen.findByText('Edit payable / Save correction'));
 fireEvent.change(screen.getByLabelText('Exact amount'),{target:{value:'-1.00'}});fireEvent.change(screen.getByLabelText('Correction or entry reason'),{target:{value:'Synthetic corrected exact amount'}});submit();await screen.findByText(/Source details need correction/);
 const original=retained();expect(original.retainedEvidence).toHaveLength(2);expect(original.request.key).toBe(calls[0].key);expect(JSON.parse(original.request.signature).body.fields.evidence).toHaveLength(2);expect((screen.getByLabelText('Exact amount')as HTMLInputElement).value).toBe('-1.00');
 fireEvent.change(screen.getByLabelText('Exact amount'),{target:{value:'2.00'}});submit();await screen.findByText('Source revision saved and read back.');expect(calls).toHaveLength(2);expect(calls[1].key).not.toBe(calls[0].key);expect(t.h.snapshot().source_revisions).toHaveLength(2);expect(t.h.snapshot().source_revisions![1].fields.evidence).toHaveLength(2);expect(sessionStorage.length).toBe(0);expect(changed).toHaveBeenCalledOnce();expect(t.h.snapshot().assessment_operations).toEqual([unknown]);
});
function fillNew(){for(const[label,value]of Object.entries({'Supplier name':invoice.supplier_name,'Invoice number':'SYNTHETIC-NEW-LOSTACK','Invoice issue date':invoice.invoice_issue_date,'Payment terms':invoice.payment_terms,'Due date':invoice.due_date,'Description':invoice.description,'Exact amount':invoice.amount,'Source currency':invoice.currency,'Payer Circle Wallet ID':invoice.payer_circle_wallet_id,'Evidence reference':invoice.evidence[0].evidence_id,'Evidence SHA256':invoice.evidence[0].content_sha256,'Correction or entry reason':'Synthetic new source with uncertain acknowledgement'}))fireEvent.change(screen.getByLabelText(label),{target:{value}});}
for(const commit of [false,true])it(`new source lost ACK (commit ${commit}) recovers exact body/key after reload without a duplicate`,async()=>{
 const t=await setup(),calls:{body:string;key:string|null}[]=[];let lose=true;
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{expect(String(url)).toBe('/api/obligations');expect(init?.method).toBe('POST');calls.push({body:String(init?.body),key:new Headers(init?.headers).get('Idempotency-Key')});const req=new Request('https://synthetic.invalid'+url,init);if(lose){lose=false;if(commit)await t.h.handler('save',req);throw new Error('Synthetic lost source acknowledgement');}return t.h.handler('save',req);});vi.stubGlobal('fetch',fetcher);
 const props={selectedId:'',csrfToken:'SYNTHETIC-LOSTACK',onChanged:vi.fn(),readModel:{detail:null,createAllowed:true}};
 const first=render(<SourceWorkflowPanel {...props}/>);fireEvent.click(screen.getByText('Create payable'));fillNew();submit();await screen.findByText(/Acknowledgement unavailable/);const original=retained();expect(t.h.snapshot().source_revisions).toHaveLength(commit?2:1);
 first.unmount();render(<SourceWorkflowPanel {...props}/>);fireEvent.click(screen.getByText('Create payable'));expect((screen.getByLabelText('Invoice number')as HTMLInputElement).value).toBe('SYNTHETIC-NEW-LOSTACK');expect(retained()).toEqual(original);submit();await screen.findByText(commit?'Command recorded. Refreshing committed status.':'Source revision saved and read back.');expect(calls).toHaveLength(2);expect(calls[1]).toEqual(calls[0]);expect(t.h.snapshot().source_revisions).toHaveLength(2);expect(sessionStorage.length).toBe(0);expect(t.h.snapshot().execution_ledger).toEqual([]);
});
for(const kind of ['unknown','mismatched','conflicting','commit503','null','malformed']as const)it(`source ${kind} reply retains uncertainty and pending original facts`,async()=>{
 const t=await setup();let status=400,data:unknown={code:'SYNTHETIC_PRIVATE_SQL_ERROR',remedy:'SYNTHETIC_PRIVATE_RESPONSE'};
 if(kind==='mismatched'){status=409;data={code:'SOURCE_FIELDS_INVALID',fields:[{field:'fields.amount',message:'private'}]};}
 if(kind==='conflicting')data={code:'SOURCE_FIELDS_INVALID',fields:[{field:'fields.amount',message:'private'}],committed:true};
 if(kind==='commit503'){status=503;data={code:'COMMIT_OUTCOME_UNVERIFIED',remedy:'SYNTHETIC_PRIVATE_RESPONSE'};}
 if(kind==='null')data=null;
 const fetcher=vi.fn(async()=>kind==='malformed'?new Response('{',{status:400}):Response.json(data,{status}));vi.stubGlobal('fetch',fetcher);
 render(<SourceWorkflowPanel selectedId={t.id} csrfToken="SYNTHETIC-UNCERTAIN" onChanged={()=>{}} readModel={{detail:t.detail,createAllowed:false}}/>);fireEvent.click(await screen.findByText('Edit payable / Save correction'));fireEvent.change(screen.getByLabelText('Exact amount'),{target:{value:'2.00'}});submit();await screen.findByText(kind==='malformed'?/Acknowledgement unavailable/:/Source save completion not confirmed/);
 expect(document.body.textContent).not.toMatch(/SYNTHETIC_PRIVATE|Source details need correction|Assessment completion unconfirmed|not processed|safe to retry/);expect(retained().request.key).toBeTruthy();expect(JSON.parse(retained().request.signature).body.fields.amount).toBe('2.00');expect(retained().retainedEvidence).toHaveLength(2);expect(fetcher).toHaveBeenCalledTimes(1);
});
for(const change of ['selection','session','unmount','newer']as const)it(`late source rejection cannot mutate ${change} ownership`,async()=>{
 const t=await setup(),other=await setup();let finish!:(r:Response)=>void;let n=0;
 const fetcher=vi.fn(()=>new Promise<Response>(resolve=>{if(++n===1)finish=resolve;}));vi.stubGlobal('fetch',fetcher);
 const props={selectedId:t.id,csrfToken:'SYNTHETIC-OWNER',onChanged:vi.fn(),readModel:{detail:t.detail,createAllowed:false}},ui=render(<SourceWorkflowPanel {...props}/>);
 fireEvent.click(await screen.findByText('Edit payable / Save correction'));fireEvent.change(screen.getByLabelText('Exact amount'),{target:{value:'-1.00'}});submit();await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));const old=retained(),scope=sessionStorage.key(0)!,original=sessionStorage.getItem(scope);
 if(change==='unmount')ui.unmount();else if(change==='session')ui.rerender(<SourceWorkflowPanel {...props} csrfToken="SYNTHETIC-NEW-SESSION"/>);else ui.rerender(<SourceWorkflowPanel {...props} selectedId={other.id} readModel={{detail:other.detail,createAllowed:false}}/>);
 if(change==='newer'){
  ui.rerender(<SourceWorkflowPanel {...props}/>);fireEvent.click(await screen.findByText('Edit payable / Save correction'));fireEvent.change(screen.getByLabelText('Exact amount'),{target:{value:'-2.00'}});submit();await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(2));expect(retained().request.key).not.toBe(old.request.key);
 }
 const expected=sessionStorage.getItem(scope);const rejection=await t.h.handler('save',t.h.request(JSON.parse(old.request.signature).body,old.request.key),t.id);expect(rejection.status).toBe(400);await act(async()=>{finish(rejection);});
 expect(sessionStorage.getItem(scope)).toBe(change==='newer'?expected:original);expect(document.body.textContent).not.toContain('Source details need correction');expect(props.onChanged).not.toHaveBeenCalled();if(change==='newer')expect((screen.getByText('Save correction')as HTMLButtonElement).disabled).toBe(true);
});

// AXIS correction1: final independent authority/capability probe; shared imports/cleanup reused.
import {createSourceWorkflowHandlers} from '../src/server/source-workflow';
for(const kind of ['permission403','capability503']as const)it(`INTENDED FACTUAL: canonical source ${kind} keeps existing actionable authority/capability guidance`,async()=>{
 const h=sourceHarness(),saved=await(await h.handler('save',h.request({expected_revision:0,fields:invoice,reason:'Synthetic authority boundary'}))).json(),id=saved.obligation.obligation_id;
 const detail=await(await h.handler('detail',new Request('https://synthetic.invalid'),id)).json();vi.stubGlobal('crypto',webcrypto);
 const before=structuredClone(h.snapshot()),writes=h.repository.compareAndSet.mock.calls.length,changed=vi.fn();
 if(kind==='permission403')h.source.source_ingress!.permissions=['REVIEW_SOURCE'];
 const handler=kind==='capability503'?createSourceWorkflowHandlers({guard:h.guard,source:()=>h.source,repository:()=>({...h.repository,assertRecoveryWorkflowCapability:async()=>{throw Error('Synthetic unavailable capability');}})}):h.handler;
 let result:{status:number;code:string}|undefined;
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{const r=await handler('save',new Request('https://synthetic.invalid'+url,init),id);result={status:r.status,code:(await r.clone().json()).code};return r;});vi.stubGlobal('fetch',fetcher);
 render(<SourceWorkflowPanel selectedId={id} csrfToken="SYNTHETIC-SOURCE-AUTHORITY" onChanged={changed} readModel={{detail,createAllowed:false}}/>);
 fireEvent.click(screen.getByText('Edit payable / Save correction'));fireEvent.change(screen.getByLabelText('Exact amount'),{target:{value:'2.00'}});fireEvent.change(screen.getByLabelText('Correction or entry reason'),{target:{value:'Synthetic explicit corrected facts'}});fireEvent.submit(screen.getByRole('button',{name:'Save correction'}).closest('form')!);
 await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));await waitFor(()=>expect((screen.getByRole('button',{name:'Save correction'})as HTMLButtonElement).disabled).toBe(false));
 const code=kind==='permission403'?'SOURCE_PERMISSION_REQUIRED':'RECOVERY_MIGRATION_REQUIRED';expect(result).toEqual({status:kind==='permission403'?403:503,code});
 expect(h.snapshot()).toEqual(before);expect(h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(changed).not.toHaveBeenCalled();expect(sessionStorage.length).toBe(1);
 console.log('SENTINEL_CANONICAL_AUTHORITY',JSON.stringify({kind,...result,new_CAS:h.repository.compareAndSet.mock.calls.length-writes,state_unchanged:true,key_retained:!!JSON.parse(sessionStorage.getItem(sessionStorage.key(0)!)!).request.key,text:document.body.textContent}));
 expect(document.body.textContent).toContain(code);
 expect(document.body.textContent).not.toContain('Source save completion not confirmed');
 expect(document.body.textContent).toContain(kind==='permission403'?'Current review authority unavailable':'Workflow capability unavailable');
});

for(const kind of ['absent','expired']as const)it(`canonical ${kind} ingress alias keeps code/owner/remedy and pending facts without new authority`,async()=>{
 const t=await setup();const before=structuredClone(t.h.snapshot()),writes=t.h.repository.compareAndSet.mock.calls.length,changed=vi.fn();
 if(kind==='expired')t.h.source.source_ingress!.expires_at=new Date(Date.now()-1).toISOString();
 const handler=kind==='absent'?createSourceWorkflowHandlers({guard:t.h.guard,source:()=>undefined,repository:()=>t.h.repository}):t.h.handler;let result:{status:number;code:string}|undefined;
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{const response=await handler('save',new Request('https://synthetic.invalid'+url,init),t.id);result={status:response.status,code:(await response.clone().json()).code};return response;});vi.stubGlobal('fetch',fetcher);
 render(<SourceWorkflowPanel selectedId={t.id} csrfToken="SYNTHETIC-INGRESS-ALIAS" onChanged={changed} readModel={{detail:t.detail,createAllowed:false}}/>);fireEvent.click(await screen.findByText('Edit payable / Save correction'));fireEvent.change(screen.getByLabelText('Exact amount'),{target:{value:'2.00'}});submit();
 const code=kind==='absent'?'SOURCE_INGRESS_NOT_ADMITTED':'SOURCE_INGRESS_EXPIRED_OR_CHANGED';await screen.findByText(new RegExp(`Code: ${code}`));expect(result).toEqual({status:403,code});expect(document.body.textContent).toContain('Current review authority unavailable');expect(document.body.textContent).toContain('Responsible: Workspace owner · access authority');expect(document.body.textContent).toContain('verify the current actor and session');expect(document.body.textContent).not.toContain('Source save completion not confirmed');
 expect(retained().request.key).toBeTruthy();expect(JSON.parse(retained().request.signature).body.fields.amount).toBe('2.00');expect(retained().retainedEvidence).toHaveLength(2);expect(t.h.snapshot()).toEqual(before);expect(t.h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect(changed).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(1);
});
for(const kind of ['permission','capability']as const)it(`canonical ${kind} guidance uses only static responsible owner and preserves draft without resend`,async()=>{
 const t=await setup();if(kind==='permission')t.h.source.source_ingress!.permissions=['REVIEW_SOURCE'];
 const handler=kind==='capability'?createSourceWorkflowHandlers({guard:t.h.guard,source:()=>t.h.source,repository:()=>({...t.h.repository,assertRecoveryWorkflowCapability:async()=>{throw Error('SYNTHETIC_PRIVATE_CAPABILITY_FAILURE');}})}):t.h.handler;
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>handler('save',new Request('https://synthetic.invalid'+url,init),t.id));vi.stubGlobal('fetch',fetcher);
 render(<SourceWorkflowPanel selectedId={t.id} csrfToken="SYNTHETIC-DENIED-OWNER" onChanged={()=>{}} readModel={{detail:t.detail,createAllowed:false}}/>);fireEvent.click(await screen.findByText('Edit payable / Save correction'));fireEvent.change(screen.getByLabelText('Exact amount'),{target:{value:'2.00'}});submit();await screen.findByText(/Responsible:/);
 expect(document.body.textContent).toContain(kind==='permission'?'Responsible: Workspace owner · access authority':'Responsible: Deployment owner');expect(document.body.textContent).toContain(kind==='permission'?'verify the current actor and session':'approved operational process');expect(document.body.textContent).not.toMatch(/SYNTHETIC_PRIVATE|apply migrations|automatically resend/i);expect(retained().request.key).toBeTruthy();expect((screen.getByLabelText('Exact amount')as HTMLInputElement).value).toBe('2.00');expect(fetcher).toHaveBeenCalledTimes(1);
});

for(const kind of ['binding','claim']as const)it(`canonical source ${kind}409 retains existing typed guidance on the actual save boundary`,async()=>{
 const t=await setup(),changed=vi.fn();
 const claim={instruction_id:'SYNTHETIC-CONCURRENT-LINK',source_obligation_id:t.id,namespace:'SYNTHETIC-CHILD',source_sha256:'a'.repeat(64),activated_at:new Date().toISOString()};
 if(kind==='binding')t.h.snapshot().source_ingress_anchor='f'.repeat(64);
 if(kind==='claim'){
  // A concurrent valid receipt is observed between the two final parent reads;
  // the actual handler, not this mock, decides whether the save may proceed.
  const auth=await t.h.guard();let checks=0;auth.revalidate=vi.fn(async()=>{if(++checks===3)t.h.snapshot().linked_activation_receipts=[structuredClone(claim)];});t.h.guard.mockResolvedValue(auth);
 }
 const before=structuredClone(t.h.snapshot()),writes=t.h.repository.compareAndSet.mock.calls.length;let result:{status:number;code:string}|undefined;
 const fetcher=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{const r=await t.h.handler('save',new Request('https://synthetic.invalid'+url,init),t.id);result={status:r.status,code:(await r.clone().json()).code};return r;});vi.stubGlobal('fetch',fetcher);
 render(<SourceWorkflowPanel selectedId={t.id} csrfToken="SYNTHETIC-BINDING-CLAIM" onChanged={changed} readModel={{detail:t.detail,createAllowed:false}}/>);fireEvent.click(await screen.findByText('Edit payable / Save correction'));fireEvent.change(screen.getByLabelText('Exact amount'),{target:{value:'2.00'}});fireEvent.change(screen.getByLabelText('Correction or entry reason'),{target:{value:'Synthetic concurrent-claim guarded correction'}});submit();await waitFor(()=>expect(fetcher).toHaveBeenCalledTimes(1));await waitFor(()=>expect((screen.getByText('Save correction')as HTMLButtonElement).disabled).toBe(false));
 const code=kind==='binding'?'SOURCE_BINDING_CHANGED':'EXISTING_FINANCIAL_CLAIM';expect(result).toEqual({status:409,code});expect(t.h.repository.compareAndSet).toHaveBeenCalledTimes(writes);expect({...t.h.snapshot(),linked_activation_receipts:undefined}).toEqual({...before,linked_activation_receipts:undefined});if(kind==='claim')expect(t.h.snapshot().linked_activation_receipts).toEqual([claim]);
 expect(document.body.textContent).toContain(`Code: ${code}`);expect(document.body.textContent).toContain(kind==='binding'?'Responsible: Finance reviewer · source review':'Responsible: Treasury Operations');expect(document.body.textContent).toContain(kind==='binding'?'Review the corrected source and original request history':'Reconcile the original payment identity');expect(document.body.textContent).not.toContain('Source save completion not confirmed');
 expect(retained().request.key).toBeTruthy();expect(JSON.parse(retained().request.signature).body.fields.amount).toBe('2.00');expect(retained().retainedEvidence).toHaveLength(2);expect(changed).not.toHaveBeenCalled();expect(screen.queryByText('Authorize exact payment')).toBeNull();expect(fetcher).toHaveBeenCalledTimes(1);
});
