import {afterEach,describe,expect,it,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {syntheticSourceRecords} from './test-support/synthetic-source-records';
import {isCurrentSourceEligible,loadPublicSourceRecords} from '../src/server/source-records';
vi.unmock('../src/server/source-records');
let directory:string|undefined;
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(directory)rmSync(directory,{recursive:true,force:true});directory=undefined;});
function sourceFixture(linked=false,linkedDraft?:{instruction_id:string,source_obligation_id:string,instruction_content_sha256:string}){
 const sample=syntheticSourceRecords()[0];const {counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...commercial}=sample as typeof sample & Record<string,unknown>;const source={...commercial,obligation_id:linkedDraft?.instruction_id??'TESTNET-CONTROLLED-FRESH-001',amount:'1.00',currency:'USD',business_purpose_confirmed:false,issue_date:null,due_date:null,effective_due_date:null,effective_due_date_basis:null,effective_due_date_provenance:null,service_category:'TESTNET_ONLY controlled test obligation',commercial_terms:'TESTNET_ONLY NON_ECONOMIC NOT_VENDOR_PAYMENT',source_evidence:[{evidence_id:'CONTROLLED-TESTNET-001',content_sha256:'a'.repeat(64)}]};
 const now=Date.now();const packet={...(linked?{linked_instruction:{source_obligation_id:linkedDraft?.source_obligation_id??'FICTIONAL-GENUINE',instruction_content_sha256:linkedDraft?.instruction_content_sha256??'b'.repeat(64)}}:{}),purpose:'TESTNET_FINANCIAL_SOURCE',approval_id:'SYNTHETIC-INDEPENDENT-SOURCE-APPROVAL',organization_id:'ORG-DEMO-001',deployment_id:'dpl_synthetic',namespace:'synthetic-financial',valid_from:new Date(now-1000).toISOString(),expires_at:new Date(now+600000).toISOString(),intent_id:'SYNTHETIC-FRESH-INTENT-001',classification:'TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT',principal:'1.000000',estimated_fee_ceiling:'0.002000',estimated_total_ceiling:'1.002000',source};
 directory=mkdtempSync(join(tmpdir(),'tameion-financial-'));mkdirSync(join(directory,'.tameion'));const bytes=JSON.stringify(packet);writeFileSync(join(directory,'.tameion/financial-source.json'),bytes);vi.spyOn(process,'cwd').mockReturnValue(directory);vi.stubEnv('TAMEION_FINANCIAL_SOURCE_SHA256',createHash('sha256').update(bytes).digest('hex'));vi.stubEnv('VERCEL_DEPLOYMENT_ID',packet.deployment_id);vi.stubEnv('TAMEION_STATE_NAMESPACE',packet.namespace);return packet;
}
describe('independent controlled testnet source admission',()=>{
 it('admits exactly the independently approved fresh source without restoring public data',()=>{const p=sourceFixture();expect(isCurrentSourceEligible(p.organization_id,p.source.obligation_id)).toBe(true);expect(loadPublicSourceRecords()).toEqual([]);expect(isCurrentSourceEligible(p.organization_id,'OBL-J0C-003')).toBe(false);});
});
import {loadFinancialSourceAdmission,loadFinancialRequesterBinding} from '../src/server/financial-source-admission';
import {createFinancialHandlers,type FinancialDependencies} from '../src/server/operator-financial-routes';
import {DemoState,DEMO_ORGANIZATION_ID,DEMO_SIGNING_KEY_ID,loadExistingFinancialState} from '../src/server/demo-state';
import {ArcCircleProviderAdapter,type J2aCircleClient} from '../src/execution/provider-adapter';
import {J2A_DEMO_SOURCE,J2A_DEMO_DESTINATION,J2A_DEMO_WALLET_SET_ID,runJ2aReadOnlyPreflight} from '../src/demo/real-testnet-payment';
import {SupabaseDemoStateRepository,DemoStateConflictError} from '../src/server/supabase-demo-state-repository';
import type {AuthContext} from '../src/server/operator-auth';
import {AccessError} from '../src/server/route-access-policy';
import {sealTestAssessment,currentAssessmentReview} from './test-support/seal-assessment';
function controlledHarness(options:{lostResponse?:boolean,sessionRevokedOnSend?:boolean,releaseRemovedOnSend?:boolean,revokeAfterReleaseSave?:boolean,finalExpiryOffset?:number,linkedChangedOnFinalRead?:boolean,omitFinalLinkHook?:boolean,linkedDraft?:{instruction_id:string,source_obligation_id:string,instruction_content_sha256:string},verifyLink?:(source:ReturnType<typeof loadFinancialSourceAdmission>)=>Promise<void>}={}){
 const source=sourceFixture(Boolean(options.linkedChangedOnFinalRead||options.linkedDraft),options.linkedDraft);const initial=new DemoState(undefined,undefined,undefined,undefined,{},[source.source]);
 initial.trustedKeys.loadServerSigningKey(DEMO_SIGNING_KEY_ID);
 let snapshot=initial.exportSnapshot(),revision=1,tx:Record<string,unknown>|undefined;
 const requester={purpose:'FINANCIAL_REQUESTER_ACTOR_BINDING',approval_id:'INDEPENDENT-REQUESTER-APPROVAL',organization_id:source.organization_id,deployment_id:source.deployment_id,namespace:source.namespace,valid_from:source.valid_from,expires_at:source.expires_at,operator_key:'SYNTHETIC-OWNER',credential_version:1,actor_id:initial.resolveDesignatedApprover().actor_id,source_sha256:process.env.TAMEION_FINANCIAL_SOURCE_SHA256,intent_id:source.intent_id};
 const bytes=JSON.stringify(requester);writeFileSync(join(directory!,'.tameion/financial-requester.json'),bytes);vi.stubEnv('TAMEION_FINANCIAL_REQUESTER_SHA256',createHash('sha256').update(bytes).digest('hex'));
 let advanceOnNextRead=false;let linkDriftOnNextRead=false;let linkChanged=false;let revoked=false;const auth={session:{valid:true,operator_key:requester.operator_key,credential_version:1},revalidate:vi.fn(async()=>{if(revoked)throw new AccessError('SESSION_REQUIRED',401);})} as unknown as AuthContext;
 const client:J2aCircleClient={
 getWallet:vi.fn(async({id})=>({data:{wallet:{id,address:id===J2A_DEMO_SOURCE.id?J2A_DEMO_SOURCE.address:J2A_DEMO_DESTINATION.address,blockchain:'ARC-TESTNET',walletSetId:J2A_DEMO_WALLET_SET_ID,state:'LIVE'}}})),
 getWalletTokenBalance:vi.fn(async()=>({data:{tokenBalances:[{amount:'100.000000',token:{id:'TEST-NATIVE-USDC',symbol:'USDC',blockchain:'ARC-TESTNET',decimals:6,isNative:true}}],pagination:{nextPageAfter:null}}})),
 estimateTransferFee:vi.fn(async()=>({data:{medium:{networkFee:'0.002000'}}})),listTransactions:vi.fn(async()=>({data:{transactions:tx?[tx]:[],pagination:{nextPageAfter:null}}})),
 getTransaction:vi.fn(async()=>({data:{transaction:tx}})),
 createTransaction:vi.fn(async(input)=>{tx={id:'synthetic-provider-tx-1',state:'COMPLETE',walletId:input.walletId,destinationAddress:input.destinationAddress,amounts:input.amount,tokenId:input.tokenId,refId:input.refId,blockchain:'ARC-TESTNET',networkFee:'0.002000',txHash:'0x'+'a'.repeat(64)};if(options.lostResponse)throw new Error('synthetic lost response');return {data:{id:tx.id}};})};
 const repo={loadExisting:vi.fn(async()=>{if(linkDriftOnNextRead){linkDriftOnNextRead=false;linkChanged=true;}if(advanceOnNextRead){advanceOnNextRead=false;vi.spyOn(Date,'now').mockReturnValue(Date.parse(snapshot.payment_release_approvals![0].record.expires_at)+options.finalExpiryOffset!);}return {revision,snapshot:structuredClone(snapshot) as unknown as Record<string,unknown>};}),loadOrSeed:vi.fn(()=>{throw new Error('SEED FORBIDDEN');}),compareAndSet:vi.fn(async(_n:string,r:number,next:Record<string,unknown>)=>{if(r!==revision)throw new DemoStateConflictError();snapshot=structuredClone(next) as unknown as typeof snapshot;if(options.revokeAfterReleaseSave&&snapshot.payment_release_approvals?.length)revoked=true;return ++revision;})} as unknown as SupabaseDemoStateRepository;
 const load=vi.fn(async(s:ReturnType<typeof loadFinancialSourceAdmission>,revalidate:()=>Promise<void>,assertAtSend?:import("../src/execution/worker").ExecutionWorkerOptions["assertRequesterAtProviderSend"],revalidateLinkAtSend?:()=>Promise<void>)=>{
 let validations=0;let state:DemoState;const adapter=new ArcCircleProviderAdapter(client,k=>state?.getSettlementProxyByIdempotencyKey(k)?.preflight??null);
 state=await loadExistingFinancialState(repo,s.namespace,[s.source],{revalidateLinkedInstructionAtProviderSend:options.omitFinalLinkHook?undefined:revalidateLinkAtSend,assertRequesterAtProviderSend:assertAtSend,revalidateRequester:async()=>{if(options.sessionRevokedOnSend)revoked=true;if(options.releaseRemovedOnSend)snapshot.payment_release_approvals=[];await revalidate();validations++;if(options.finalExpiryOffset!==undefined&&validations===2)advanceOnNextRead=true;if(options.linkedChangedOnFinalRead&&validations===2)linkDriftOnNextRead=true;}},adapter);return state;
 });
 const handler=createFinancialHandlers({verifyLink:async(source)=>{await options.verifyLink?.(source);if(linkChanged)throw new AccessError('LINK_SOURCE_STALE',409);},guard:async()=>auth,source:loadFinancialSourceAdmission,requester:loadFinancialRequesterBinding,load,preflight:(_c,now,intent)=>runJ2aReadOnlyPreflight(client,now,intent)});
 const request=(body:unknown)=>new Request('https://synthetic.invalid/api/action',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'00000000-0000-4000-8000-000000000001'},body:JSON.stringify(body)});
 let assessmentKey=10;
 const sealCurrent=async()=>{
 vi.stubEnv('NVIDIA_API_KEY','NETWORK_DENIED_SYNTHETIC_NOT_A_CREDENTIAL');
 vi.stubGlobal('fetch',vi.fn(async(input:RequestInfo|URL)=>{if(String(input)!=='https://integrate.api.nvidia.com/v1/chat/completions')throw new Error('External network forbidden');return Response.json({choices:[{message:{content:JSON.stringify({obligation_id:source.source.obligation_id,decision:'PAY',finding_codes:[],evidence_ids:source.source.source_evidence.map(e=>e.evidence_id),uncertainty_signal:false,explanation:'Network-denied synthetic recommendation, no live proof.'})}}]});}));
 const req=request({});req.headers.set('Idempotency-Key','00000000-0000-4000-8000-'+String(++assessmentKey).padStart(12,'0'));
 const response=await handler('assess',req,source.source.obligation_id);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({decision:{decision:'PAY'},provider_mode:'LIVE_AI'});
 };
 return {source,requester,handler,request,load,client,repo,auth,sealCurrent,snapshot:()=>snapshot,revision:()=>revision,revoke:()=>{revoked=true;}};
}
describe('guarded canonical controlled testnet financial lifecycle',()=>{
 it('prepares exact1USDC/0.002fee/1.002total, authorizes canonical PAE and submits once then reconciles',async()=>{
  const h=controlledHarness();await h.sealCurrent();const id=h.source.source.obligation_id;
  const prepared=await h.handler('preflight',h.request({obligation_id:id,expected_version:1}));expect(prepared.status).toBe(200);const p=await prepared.json();expect(p).toMatchObject({amount:'1.000000',estimated_network_fee:'0.002000',max_total_debit:'1.002000',classification:'TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT'});expect(p.business_payment_instruction.commercial).toMatchObject({invoice_reference:null,invoice_date:null,effective_due_date:null});
  await h.sealCurrent();const state=await h.load(loadFinancialSourceAdmission(),async()=>{}),aggregate=state.store.get(DEMO_ORGANIZATION_ID,id),review=currentAssessmentReview(state.store,DEMO_ORGANIZATION_ID,id);
  const approved=await h.handler('approve',h.request({expected_version:aggregate.aggregate_version,reviewed_assessment_id:review.reviewedAssessmentId,reviewed_assessment_hash:review.reviewedAssessmentHash,reason_text:'Exact independently reviewed controlled test-only source.'}),id);expect(approved.status).toBe(200);const a=await approved.json();
  vi.stubEnv('J2A_EXECUTION_AUTHORIZED_PACKET_SHA256',a.packet_sha256);
  const body={expected_version:a.aggregate.aggregate_version,packet_sha256:a.packet_sha256,pae_instruction_hash:a.pae_instruction_hash,confirmation:'SUBMIT EXACT TESTNET SETTLEMENT PROXY'};
  expect((await h.handler('release',h.request({...body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'}),id)).status).toBe(200);
  const executed=await h.handler('execute',h.request(body),id);expect(executed.status).toBe(200);expect(await executed.json()).toMatchObject({code:'RECONCILED',execution:{status:'SETTLED'}});expect(h.client.createTransaction).toHaveBeenCalledOnce();
  expect((await h.handler('execute',h.request(body),id)).status).toBe(409);expect(h.client.createTransaction).toHaveBeenCalledOnce();expect(h.repo.loadOrSeed).not.toHaveBeenCalled();
  expect(h.snapshot().authority.aggregates[0]).toMatchObject({state:'RECONCILED'});
 });
 it('rejects every genuine private-view identity even when caller claims financial eligibility',async()=>{
  const h=controlledHarness();const ids=[...syntheticSourceRecords().map(r=>r.obligation_id),'FICTIONAL-OWNER-ENTRY'];
  for(const id of ids)for(const action of ['assess','preflight','approve','release','execute','reconcile'] as const){
    const base={expected_version:1,packet_sha256:'a'.repeat(64),pae_instruction_hash:'b'.repeat(64)};
    const bodies={assess:{},preflight:{obligation_id:id,expected_version:1},approve:{expected_version:1,reviewed_assessment_id:'fictional',reviewed_assessment_hash:'a'.repeat(64),reason_text:'fictional'},release:{...base,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'},execute:{...base,confirmation:'SUBMIT EXACT TESTNET SETTLEMENT PROXY'},reconcile:{idempotency_key:'fictional',pae_instruction_hash:'b'.repeat(64)}};
    const response=await h.handler(action,h.request(bodies[action]),id);
    expect(response.status).toBe(403);expect(await response.json()).toMatchObject({code:'CONTROLLED_SOURCE_REQUIRED'});
    const forged=await h.handler(action,h.request({...bodies[action],financial_action_eligible:true,source_group:'DEMO_ARC_TESTNET'}),id);
    expect(forged.status).toBe(400);expect(await forged.json()).toMatchObject({code:'BODY_REJECTED'});
  }
  expect(h.client.createTransaction).not.toHaveBeenCalled();expect(h.load).not.toHaveBeenCalled();
 });
 it('denies before source/state/provider work when unauthenticated',async()=>{const source=vi.fn(),requester=vi.fn(),load=vi.fn();const action=createFinancialHandlers({guard:async()=>{throw new AccessError('SESSION_REQUIRED',401);},source,requester,load});expect((await action('approve',new Request('https://test.invalid',{method:'POST'}),'TESTNET-CONTROLLED-1')).status).toBe(401);expect(source).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled();});
 it.each([null,[],{actor_id:'FORGED'},{expected_version:-1}])('rejects malformed/body-supplied authority before state: %s',async body=>{const h=controlledHarness();expect((await h.handler('approve',h.request(body),h.source.source.obligation_id)).status).toBe(400);expect(h.load).not.toHaveBeenCalled();expect(h.client.createTransaction).not.toHaveBeenCalled();});
 it('never accepts historical003 even with a valid viewer',async()=>{const h=controlledHarness();expect((await h.handler('approve',h.request({expected_version:1,reviewed_assessment_id:'x',reviewed_assessment_hash:'a'.repeat(64),reason_text:'not authority'}),'OBL-J0C-003')).status).toBe(403);expect(h.load).not.toHaveBeenCalled();});
 it('rejects missing/exact-context/expired/oversize/malformed approval without public fallback',()=>{const h=controlledHarness();const path=join(directory!,'.tameion/financial-source.json');for(const patch of [{principal:'2.000000'},{estimated_total_ceiling:'1.012000'},{expires_at:new Date(0).toISOString()},{namespace:'OTHER'},{source:{...h.source.source,amount:'2.00'}},{extra:true}]){const bytes=JSON.stringify({...h.source,...patch});writeFileSync(path,bytes);vi.stubEnv('TAMEION_FINANCIAL_SOURCE_SHA256',createHash('sha256').update(bytes).digest('hex'));expect(()=>loadFinancialSourceAdmission()).toThrow(/UNAVAILABLE/);}writeFileSync(path,Buffer.alloc(65537));expect(()=>loadFinancialSourceAdmission()).toThrow(/UNAVAILABLE/);expect(isCurrentSourceEligible('ORG-DEMO-001',h.source.source.obligation_id)).toBe(false);});
});
import {buildFinanceAgentContext,toFinanceAgentModelContext} from '../src/agent/context-builder';
import {assessObligation} from '../src/agent/finance-agent';
import {raceAssessmentSchema} from '../src/agent/schema';
describe('truthful canonical controlled assessment',()=>{
 it('reaches validated PAY from independent owner window with no invoice or business-purpose fabrication',async()=>{const p=sourceFixture();const context=buildFinanceAgentContext(p.source,1,'2000-01-01');const output=await assessObligation(context,{name:'NETWORK_DENIED_SYNTHETIC',assess:async()=>({obligation_id:p.source.obligation_id,decision:'PAY',finding_codes:[],evidence_ids:p.source.source_evidence.map(e=>e.evidence_id),uncertainty_signal:false,explanation:'Synthetic provider recommendation only.'})});expect(output.decision).toBe('PAY');expect(output.race.evidence.authoritative_facts.business_purpose_confirmed).toBe(false);expect(raceAssessmentSchema.safeParse(output.race).success).toBe(true);});
});
import * as contextModule from '../src/agent/context-builder';
function recommendation(context:ReturnType<typeof buildFinanceAgentContext>,decision:'PAY'|'HOLD'='PAY',finding_codes:string[]=[]){return {name:'NETWORK_DENIED_SYNTHETIC',assess:vi.fn(async()=>({obligation_id:context.obligation_id,decision,finding_codes,evidence_ids:context.evidence_ids,uncertainty_signal:false,explanation:'Synthetic recommendation.'}))};}
async function preparedApproval(h:ReturnType<typeof controlledHarness>,release=true){
 await h.sealCurrent();const id=h.source.source.obligation_id;
 expect((await h.handler('preflight',h.request({obligation_id:id,expected_version:1}))).status).toBe(200);
 await h.sealCurrent();const state=await h.load(loadFinancialSourceAdmission(),async()=>{}),aggregate=state.store.get(DEMO_ORGANIZATION_ID,id),review=currentAssessmentReview(state.store,DEMO_ORGANIZATION_ID,id);
 const response=await h.handler('approve',h.request({expected_version:aggregate.aggregate_version,reviewed_assessment_id:review.reviewedAssessmentId,reviewed_assessment_hash:review.reviewedAssessmentHash,reason_text:'Explicit controlled test-only approval.'}),id);expect(response.status).toBe(200);const a=await response.json();vi.stubEnv('J2A_EXECUTION_AUTHORIZED_PACKET_SHA256',a.packet_sha256);
 if(release)expect((await h.handler('release',h.request({expected_version:a.aggregate.aggregate_version,packet_sha256:a.packet_sha256,pae_instruction_hash:a.pae_instruction_hash,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'}),id)).status).toBe(200);
 return {a,id,body:{expected_version:a.aggregate.aggregate_version,packet_sha256:a.packet_sha256,pae_instruction_hash:a.pae_instruction_hash,confirmation:'SUBMIT EXACT TESTNET SETTLEMENT PROXY'}};
}
describe('controlled authority negative and fault sensitivity',()=>{
 it('enforces half-open exact UTC millisecond window independently of calendar as-of',()=>{const p=sourceFixture();expect(()=>loadFinancialSourceAdmission(process.env,Date.parse(p.valid_from))).not.toThrow();for(const now of [Date.parse(p.valid_from)-1,Date.parse(p.expires_at),NaN,Infinity])expect(()=>loadFinancialSourceAdmission(process.env,now)).toThrow();expect(buildFinanceAgentContext(p.source,1,'1900-01-01').due_date_position).toBe('CONTROLLED_WINDOW_OPEN');const path=join(directory!,'.tameion/financial-source.json');const bytes=JSON.stringify({...p,valid_from:p.valid_from.replace('Z','1Z')});writeFileSync(path,bytes);vi.stubEnv('TAMEION_FINANCIAL_SOURCE_SHA256',createHash('sha256').update(bytes).digest('hex'));expect(()=>loadFinancialSourceAdmission()).toThrow();});
 it.each(['source_sha256','intent_id','organization_id','aggregate_version','approval_id'] as const)('rejects forged controlled proof %s before provider',async field=>{const p=sourceFixture(),context=buildFinanceAgentContext(p.source,1);const bad={...context,controlled_instruction:{...context.controlled_instruction!,[field]:'FORGED'}};const provider=recommendation(bad);expect((await assessObligation(bad,provider)).decision).not.toBe('PAY');expect(provider.assess).not.toHaveBeenCalled();});
 it('detects guard removal: adversarial proof becomes PAY only when trusted guard is deliberately faulted',async()=>{const p=sourceFixture(),context=buildFinanceAgentContext(p.source,1);const bad={...context,controlled_instruction:{...context.controlled_instruction!,source_sha256:'0'.repeat(64)}};expect((await assessObligation(bad,recommendation(bad))).decision).toBe('HOLD');const fault=vi.spyOn(contextModule,'hasCurrentControlledInstruction').mockReturnValue(true);expect((await assessObligation(bad,recommendation(bad))).decision).toBe('PAY');fault.mockRestore();expect((await assessObligation(bad,recommendation(bad))).decision).toBe('HOLD');});
 it('retains model HOLD/failure/unsupported-finding semantics and model projection parity',async()=>{const p=sourceFixture(),context=buildFinanceAgentContext(p.source,1);expect(toFinanceAgentModelContext(context).controlled_instruction).toEqual(context.controlled_instruction);expect((await assessObligation(context,recommendation(context,'HOLD'))).decision).toBe('HOLD');expect((await assessObligation(context,recommendation(context,'PAY',['POTENTIAL_DUPLICATE']))).decision).toBe('HOLD');expect((await assessObligation(context,{name:'FAILED',assess:async()=>{throw new Error('offline failure');}})).decision).not.toBe('PAY');});
 it('checks requester hash, exact operator/version and actor independently before authority mutation',async()=>{const h=controlledHarness();for(const patch of [{operator_key:'OTHER'},{credential_version:2},{actor_id:'FORGED'},{intent_id:'OTHER'},{source_sha256:'0'.repeat(64)}]){const bytes=JSON.stringify({...h.requester,...patch});writeFileSync(join(directory!,'.tameion/financial-requester.json'),bytes);vi.stubEnv('TAMEION_FINANCIAL_REQUESTER_SHA256',createHash('sha256').update(bytes).digest('hex'));expect((await h.handler('assess',h.request({}),h.source.source.obligation_id)).status).not.toBe(200);expect(h.client.createTransaction).not.toHaveBeenCalled();}expect(h.snapshot().authorization_history).toHaveLength(0);});
 it('recovers a lost create response through explicit exact-identity reconciliation without a second submit',async()=>{const h=controlledHarness({lostResponse:true}),p=await preparedApproval(h);const first=await h.handler('execute',h.request(p.body),p.id);expect(first.status).toBe(202);const body=await first.json();expect(body.execution.status).toBe('UNKNOWN');expect(h.client.createTransaction).toHaveBeenCalledOnce();const reconciled=await h.handler('reconcile',h.request({idempotency_key:body.execution.idempotency_key,pae_instruction_hash:p.a.pae_instruction_hash}),p.id);expect(reconciled.status).toBe(200);expect(await reconciled.json()).toMatchObject({code:'RECONCILED'});expect(h.client.createTransaction).toHaveBeenCalledOnce();});
 it('revocation at final send prevents provider submission after durable claim',async()=>{const h=controlledHarness({sessionRevokedOnSend:true}),p=await preparedApproval(h);const response=await h.handler('execute',h.request(p.body),p.id);expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'OUTCOME_UNVERIFIED',retry_submission:false});expect(h.client.createTransaction).not.toHaveBeenCalled();expect(h.snapshot().execution_ledger[0]?.status).toBe('BLOCKED');});
 it('concurrent identical guarded execution submits once through CAS',async()=>{const h=controlledHarness(),p=await preparedApproval(h);await Promise.all([h.handler('execute',h.request(p.body),p.id),h.handler('execute',h.request(p.body),p.id)]);expect(h.client.createTransaction).toHaveBeenCalledOnce();});
 it('does not seed missing or incompatible namespace/key state',async()=>{const h=controlledHarness();vi.mocked(h.repo.loadExisting).mockResolvedValueOnce({revision:1,snapshot:{schema_version:1}});expect((await h.handler('assess',h.request({}),h.source.source.obligation_id)).status).toBe(503);expect(h.repo.loadOrSeed).not.toHaveBeenCalled();expect(h.client.getWallet).not.toHaveBeenCalled();});
 it('rejects above-ceiling provider fee and independently widened total before submit',async()=>{const h=controlledHarness();await h.sealCurrent();vi.mocked(h.client.estimateTransferFee).mockResolvedValueOnce({data:{medium:{networkFee:'0.002001'}}});const response=await h.handler('preflight',h.request({obligation_id:h.source.source.obligation_id,expected_version:1}));expect(response.status).toBe(409);expect(await response.json()).toMatchObject({blocker:'FEE_CAP_EXCEEDED'});expect(h.client.createTransaction).not.toHaveBeenCalled();});
});
it('keeps execution locked without final exact packet approval and rejects identity substitutions',async()=>{const h=controlledHarness(),p=await preparedApproval(h,false);vi.stubEnv('J2A_EXECUTION_AUTHORIZED_PACKET_SHA256',p.a.packet_sha256);expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(403);vi.stubEnv('J2A_EXECUTION_AUTHORIZED_PACKET_SHA256',p.a.packet_sha256);for(const patch of [{packet_sha256:'0'.repeat(64)},{pae_instruction_hash:'0'.repeat(64)},{expected_version:p.body.expected_version+1}])expect((await h.handler('execute',h.request({...p.body,...patch}),p.id)).status).toBe(403);expect(h.client.createTransaction).not.toHaveBeenCalled();});
it('bounded existing-state RPC rejects redirects/oversize without seed or credential disclosure',async()=>{const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>new Response('x'.repeat(2_097_153)));const repo=new SupabaseDemoStateRepository('https://synthetic.invalid','SYNTHETIC_NOT_SECRET',fetcher);await expect(repo.loadExisting('SYNTHETIC')).rejects.toThrow(/bound/);expect(fetcher).toHaveBeenCalledOnce();expect(fetcher.mock.calls[0]?.[1]).toMatchObject({redirect:'error',cache:'no-store'});});
it('provider-completeness boundary refuses hosted-style preflight before state/provider construction',async()=>{const h=controlledHarness();const action=createFinancialHandlers({guard:async()=>h.auth,source:loadFinancialSourceAdmission,requester:loadFinancialRequesterBinding,load:h.load,providerBoundary:async()=>{throw new AccessError('PROVIDER_BALANCE_NOT_VERIFIED',503);}});const response=await action('preflight',h.request({obligation_id:h.source.source.obligation_id,expected_version:1}));expect(response.status).toBe(503);expect(await response.json()).toMatchObject({code:'PROVIDER_BALANCE_NOT_VERIFIED'});expect(h.load).not.toHaveBeenCalled();expect(h.client.getWallet).not.toHaveBeenCalled();});
it('passes authenticated revalidation into an admitted provider-completeness boundary before preflight',async()=>{
 const h=controlledHarness();await h.sealCurrent();
 const providerBoundary=vi.fn(async(revalidate:()=>Promise<void>,assertAtSend?:import("../src/execution/worker").ExecutionWorkerOptions["assertRequesterAtProviderSend"])=>{await revalidate();});
 const action=createFinancialHandlers({guard:async()=>h.auth,source:loadFinancialSourceAdmission,requester:loadFinancialRequesterBinding,load:h.load,providerBoundary,preflight:(_client,now,intent)=>runJ2aReadOnlyPreflight(h.client,now,intent)});
 const response=await action('preflight',h.request({obligation_id:h.source.source.obligation_id,expected_version:1}));
 expect(response.status).toBe(200);expect(providerBoundary).toHaveBeenCalledOnce();expect(h.auth.revalidate).toHaveBeenCalled();expect(h.client.createTransaction).not.toHaveBeenCalled();
});


describe('portal final release approval',()=>{
 it('records exact release durably without provider calls and then permits one submission',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h,false);
  const before=JSON.stringify(h.snapshot());
  expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(403);
  expect(JSON.stringify(h.snapshot())).toBe(before);
  const reads=vi.mocked(h.client.getWallet).mock.calls.length;
  const result=await h.handler('release',h.request({...p.body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'}),p.id);
  expect(result.status).toBe(200);expect(await result.json()).toMatchObject({code:'PAYMENT_RELEASE_APPROVED'});
  expect(h.client.getWallet).toHaveBeenCalledTimes(reads);expect(h.client.createTransaction).not.toHaveBeenCalled();
  expect(h.snapshot()).toHaveProperty('payment_release_approvals');
  expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(200);
  expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
});

import {sealPaymentRelease,parsePaymentReleases} from '../src/domain/payment-release-approval';
describe('portal release fail-closed boundaries',()=>{
 it.each([{packet_sha256:'0'.repeat(64)},{pae_instruction_hash:'0'.repeat(64)},{expected_version:999},{actor_id:'FORGED'},{confirmation:'SUBMIT EXACT TESTNET SETTLEMENT PROXY'}])('refuses substituted release input %j',async patch=>{
  const h=controlledHarness(),p=await preparedApproval(h,false);
  const result=await h.handler('release',h.request({...p.body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY',...patch}),p.id);
  expect([400,403]).toContain(result.status);expect(h.snapshot().payment_release_approvals).toBeUndefined();expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it('persists one approval across duplicate and concurrent release requests',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h,false),body={...p.body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'};
  const results=await Promise.all([h.handler('release',h.request(body),p.id),h.handler('release',h.request(body),p.id)]);
  expect(results.some(r=>r.status===200)).toBe(true);expect(h.snapshot().payment_release_approvals).toHaveLength(1);
  const revision=h.revision(),retry=await h.handler('release',h.request(body),p.id);expect(retry.status).toBe(200);expect(h.revision()).toBe(revision);expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it('uncertain persistence never grants release or submits payment',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h,false);vi.mocked(h.repo.compareAndSet).mockRejectedValueOnce(new DemoStateConflictError());
  const result=await h.handler('release',h.request({...p.body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'}),p.id);
  expect(result.status).toBe(503);expect(await result.json()).toMatchObject({code:'OUTCOME_UNVERIFIED',retry_submission:false});
  expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(403);expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it('rechecks durable release after the execution claim before provider send',async()=>{
  const h=controlledHarness({releaseRemovedOnSend:true}),p=await preparedApproval(h);
  const result=await h.handler('execute',h.request(p.body),p.id);expect(result.status).toBe(503);expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it('rejects release archive tampering, foreign PAE versions and duplicate approval identities',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h),snapshot=h.snapshot(),approval=snapshot.payment_release_approvals![0],paes=snapshot.authorization_history.map(a=>a.sealed_pae);
  expect(parsePaymentReleases(undefined,paes)).toEqual([]);
  expect(()=>parsePaymentReleases([{...approval,record:{...approval.record,operator_key:'FORGED'}}],paes)).toThrow();
  expect(()=>parsePaymentReleases([sealPaymentRelease({...approval.record,aggregate_version:999})],paes)).toThrow();
  expect(()=>parsePaymentReleases([approval,approval],paes)).toThrow();
  const expired=sealPaymentRelease({...approval.record,expires_at:new Date(Date.parse(approval.record.approved_at)+1).toISOString()});
  h.snapshot().payment_release_approvals=[expired];vi.spyOn(Date,'now').mockReturnValue(Date.parse(expired.record.expires_at));
  expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(403);expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
});

describe('release authority must remain current',()=>{
 it.each(['revoked instruction','changed actor version','changed credential'] as const)('cannot approve %s or persist unusable authority',async fault=>{
  const h=controlledHarness(),p=await preparedApproval(h,false);
  if(fault==='revoked instruction')h.snapshot().authority.aggregates[0].pae_state='REVOKED';
  if(fault==='changed actor version')h.snapshot().actor_authorities[0].authority_version='2';
  if(fault==='changed credential')h.auth.session.credential_version=2;
  const result=await h.handler('release',h.request({...p.body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'}),p.id);
  expect([403,409]).toContain(result.status);expect(h.snapshot().payment_release_approvals).toBeUndefined();expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
});

describe('R1 durable release feedback',()=>{
 it('reports uncertainty when approval commits but readback loses authentication',async()=>{
  const h=controlledHarness({revokeAfterReleaseSave:true}),p=await preparedApproval(h,false);
  const result=await h.handler('release',h.request({...p.body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'}),p.id);
  expect(result.status).toBe(503);expect(await result.json()).toMatchObject({code:'OUTCOME_UNVERIFIED',retry_submission:false});
  expect(h.snapshot().payment_release_approvals).toHaveLength(1);expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
});

import {projectObligationDetail} from '../src/server/obligation-read-model';
import {paymentReleaseBindings} from '../src/domain/payment-release-approval';
describe('R1 release capability and projection',()=>{
 it('approval never calls any provider method',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h,false);
  for(const fn of Object.values(h.client))vi.mocked(fn).mockReset().mockRejectedValue(new Error('PROVIDER FORBIDDEN DURING RELEASE'));
  expect((await h.handler('release',h.request({...p.body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'}),p.id)).status).toBe(200);
  for(const fn of Object.values(h.client))expect(fn).not.toHaveBeenCalled();
 });
 it.each(['credential','actor','binding','expired','legacy','runtime','context'] as const)('projects %s as non-actionable without leaking release authority',async fault=>{
  const h=controlledHarness(),p=await preparedApproval(h);
  let context={namespace:h.source.namespace,operator_key:h.requester.operator_key,credential_version:1,...paymentReleaseBindings(h.source,h.requester)};
  if(fault==='credential')context.credential_version++;
  if(fault==='actor')h.snapshot().actor_authorities[0].authority_version='2';
  if(fault==='binding')context.source_binding_sha256='0'.repeat(64);
  const old=h.snapshot().payment_release_approvals![0];
  if(fault==='expired'){h.snapshot().payment_release_approvals=[sealPaymentRelease({...old.record,expires_at:new Date(Date.parse(old.record.approved_at)+1).toISOString()})];vi.spyOn(Date,'now').mockReturnValue(Date.parse(old.record.approved_at)+2);}
  if(fault==='legacy'){const {source_binding_sha256,requester_binding_sha256,...fields}=old.record as typeof old.record & {source_binding_sha256:string;requester_binding_sha256:string};h.snapshot().payment_release_approvals=[sealPaymentRelease({...fields,schema_version:'PORTAL-RELEASE-1'})];}
  const state=await h.load(loadFinancialSourceAdmission(),async()=>{});
  if(fault==='runtime')Object.defineProperty(state,'providerAdapter',{value:{name:'fake-testnet'}});
  const response=projectObligationDetail(state,p.id,true,fault==='context'?undefined:context),view=await response.json();
  expect(view.payment_release_current).toBe(false);expect(view.execution_gate).toBe(['runtime','context'].includes(fault)?'PORTAL_RELEASE_UNAVAILABLE':'PORTAL_RELEASE_RENEWAL_REQUIRED');
  expect(Object.keys(view.payment_release_approval).sort()).toEqual(['actor_id','approved_at','expires_at']);
  expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it('returns renewal-required instead of replacing stale consent for the same instruction',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h),old=h.snapshot().payment_release_approvals![0];
  h.snapshot().payment_release_approvals=[sealPaymentRelease({...old.record,expires_at:new Date(Date.parse(old.record.approved_at)+1).toISOString()})];vi.spyOn(Date,'now').mockReturnValue(Date.parse(old.record.approved_at)+2);
  const revision=h.revision(),r=await h.handler('release',h.request({...p.body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'}),p.id);
  expect(r.status).toBe(409);expect(await r.json()).toMatchObject({code:'PAYMENT_RELEASE_RENEWAL_REQUIRED'});expect(h.revision()).toBe(revision);
  expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(403);expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it.each(['credential','actor','operator','binding'] as const)('rejects %s substituted after approval before any provider call',async fault=>{
  const h=controlledHarness(),p=await preparedApproval(h);
  if(fault==='credential')h.auth.session.credential_version=2;
  if(fault==='operator')h.auth.session.operator_key='OTHER-OWNER';
  if(fault==='actor')h.snapshot().actor_authorities[0].authority_version='2';
  if(fault==='binding'){const r=h.snapshot().payment_release_approvals![0].record;h.snapshot().payment_release_approvals=[sealPaymentRelease({...r,source_binding_sha256:'0'.repeat(64),schema_version:'PORTAL-RELEASE-2',requester_binding_sha256:paymentReleaseBindings(h.source,h.requester).requester_binding_sha256})];}
  for(const fn of Object.values(h.client))vi.mocked(fn).mockClear();
  expect([403,409]).toContain((await h.handler('execute',h.request(p.body),p.id)).status);
  for(const fn of Object.values(h.client))expect(fn).not.toHaveBeenCalled();
 });
 it('restores old snapshots without consent and persists V2 approval across cold load/flush',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h,false),old=await h.load(loadFinancialSourceAdmission(),async()=>{});
  expect(old.getPaymentReleaseApproval(p.id)).toBeUndefined();await old.flush();
  expect((await h.handler('release',h.request({...p.body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'}),p.id)).status).toBe(200);
  const loaded=await h.load(loadFinancialSourceAdmission(),async()=>{}),approval=loaded.getPaymentReleaseApproval(p.id);
  expect(approval?.record).toMatchObject({schema_version:'PORTAL-RELEASE-2',...paymentReleaseBindings(h.source,h.requester)});await loaded.flush();
  expect((await h.load(loadFinancialSourceAdmission(),async()=>{})).getPaymentReleaseApproval(p.id)).toEqual(approval);
 });
 it('release racing execute never bypasses durable consent or submits twice',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h,false);
  await Promise.all([h.handler('release',h.request({...p.body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'}),p.id),h.handler('execute',h.request(p.body),p.id)]);
  expect(h.snapshot().payment_release_approvals).toHaveLength(1);expect(vi.mocked(h.client.createTransaction).mock.calls.length).toBeLessThanOrEqual(1);
  if(!h.snapshot().execution_ledger.length)expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(200);
  expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
});

describe('review F2 release reply minimization',()=>{
 it('returns only approval timestamps and actor on fresh and duplicate responses',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h,false),body={...p.body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'};
  for(let i=0;i<2;i++){
   const response=await h.handler('release',h.request(body),p.id);expect(response.status).toBe(200);
   expect(Object.keys((await response.json()).payment_release_approval).sort()).toEqual(['actor_id','approved_at','expires_at']);
  }
 });
});

import {createObligationReaders} from '../src/server/operator-obligation-routes';
describe('review F3 production boundary proofs',()=>{
 it('real GET reader derives the same envelope bindings as the release handler',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h);
  const reader=createObligationReaders(async()=>h.auth,async(_records,_binding,namespace)=>{expect(namespace).toBe(h.source.namespace);return h.load(loadFinancialSourceAdmission(),async()=>{});},()=>[],loadFinancialSourceAdmission);
  const response=await reader.detail(new Request('https://synthetic.invalid/api/obligations/'+p.id),p.id);
  expect(response.status).toBe(200);const data=await response.json();expect(data.execution_gate).toBe('PORTAL_APPROVED_EXACT_PACKET');expect(data.payment_release_current).toBe(true);
  expect(Object.keys(data.payment_release_approval).sort()).toEqual(['actor_id','approved_at','expires_at']);expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it.each([-1,0])('actual final durable read crosses release expiry offset%s',async offset=>{
  const h=controlledHarness({finalExpiryOffset:offset}),p=await preparedApproval(h);
  const r=h.snapshot().payment_release_approvals![0].record;h.snapshot().payment_release_approvals=[sealPaymentRelease({...r,expires_at:new Date(Date.now()+5000).toISOString()})];
  const result=await h.handler('execute',h.request(p.body),p.id);
  if(offset===0){expect(result.status).toBe(503);expect(h.client.createTransaction).not.toHaveBeenCalled();expect(h.snapshot().execution_ledger[0]?.status).toBe('BLOCKED');}
  else {expect(result.status).toBe(200);expect(h.client.createTransaction).toHaveBeenCalledOnce();}
 });
});

import {loadExistingDemoState} from '../src/server/load-existing-demo-state';
describe('Job65 production existing-state restoration',()=>{
 it.each(['matching','operator','credential','source-binding','requester-binding','expired','namespace','runtime','actor','tampered'] as const)('restores real V2 RPC snapshot through production reader: %s',async fault=>{
  const h=controlledHarness(),p=await preparedApproval(h);
  vi.stubEnv('CIRCLE_API_KEY','SYNTHETIC_NOT_A_CREDENTIAL');vi.stubEnv('CIRCLE_ENTITY_SECRET','SYNTHETIC_NOT_A_CREDENTIAL');
  const snapshot=structuredClone(h.snapshot()),old=snapshot.payment_release_approvals![0];
  if(fault==='source-binding'||fault==='requester-binding')snapshot.payment_release_approvals=[sealPaymentRelease({...old.record,[fault==='source-binding'?'source_binding_sha256':'requester_binding_sha256']:'0'.repeat(64)})];
  if(fault==='namespace')snapshot.payment_release_approvals=[sealPaymentRelease({...old.record,namespace:'foreign-namespace'})];
  if(fault==='expired'){
   snapshot.payment_release_approvals=[sealPaymentRelease({...old.record,expires_at:new Date(Date.parse(old.record.approved_at)+1).toISOString()})];
   vi.spyOn(Date,'now').mockReturnValue(Date.parse(old.record.approved_at)+2);
  }
  if(fault==='actor')snapshot.actor_authorities[0].authority_version='2';
  if(fault==='tampered')snapshot.payment_release_approvals![0].record_sha256='0'.repeat(64);
  if(fault==='runtime')vi.stubEnv('CIRCLE_ENTITY_SECRET','');
  const auth={...h.auth,session:{...h.auth.session,...(fault==='operator'?{operator_key:'OTHER'}:fault==='credential'?{credential_version:2}:{})}};
  const rpc={call:vi.fn(async()=>({revision:h.revision(),snapshot:structuredClone(snapshot)}))};
  const reader=createObligationReaders(async()=>auth,async(records,binding,namespace)=>loadExistingDemoState(rpc,namespace,records,binding),()=>[],loadFinancialSourceAdmission);
  const result=await reader.detail(new Request('https://synthetic.invalid/api/obligations/'+p.id),p.id);
  if(fault==='tampered'){expect(result.status).toBe(503);}else{
   expect(result.status).toBe(200);const data=await result.json();
   expect(data.payment_release_current).toBe(fault==='matching');
   expect(data.execution_gate).toBe(fault==='matching'?'PORTAL_APPROVED_EXACT_PACKET':fault==='runtime'?'PORTAL_RELEASE_UNAVAILABLE':fault==='namespace'?'PORTAL_RELEASE_APPROVAL_REQUIRED':'PORTAL_RELEASE_RENEWAL_REQUIRED');
   if(fault==='namespace')expect(data.payment_release_approval).toBeNull();
   else expect(Object.keys(data.payment_release_approval).sort()).toEqual(['actor_id','approved_at','expires_at']);
  }
  expect(rpc.call).toHaveBeenCalledExactlyOnceWith('tameion_state_load_existing',{namespace:h.source.namespace,expected_schema_version:2});
  expect(h.repo.loadOrSeed).not.toHaveBeenCalled();expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it('an expired controlled source disappears from active reads without any durable deletion',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h),snapshot=structuredClone(h.snapshot());
  const rpc={call:vi.fn(async()=>({revision:h.revision(),snapshot}))};
  const reader=createObligationReaders(async()=>h.auth,(records,binding,namespace)=>loadExistingDemoState(rpc,namespace,records,binding),()=>[]);
  vi.spyOn(Date,'now').mockReturnValue(Date.parse(h.source.expires_at));
  const list=await reader.list(new Request('https://synthetic.invalid/api/obligations'));
  expect(await list.json()).toMatchObject({obligations:[],total_count:0});
  expect((await reader.detail(new Request('https://synthetic.invalid/api/obligations/'+p.id),p.id)).status).toBe(404);
  expect(rpc.call).not.toHaveBeenCalled();expect(h.snapshot()).toEqual(snapshot);expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it('production route callback refuses provider-send without the required release context',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h,false);
  const guarded=createFinancialHandlers({guard:async()=>h.auth,source:loadFinancialSourceAdmission,requester:loadFinancialRequesterBinding,load:async(_source,_revalidate,assertAtSend)=>{
   expect(assertAtSend).toBeTypeOf('function');assertAtSend!(undefined);throw new Error('UNREACHABLE');
  }});
  const revision=h.revision();
  const result=await guarded('execute',h.request(p.body),p.id);
  expect(result.status).toBe(403);expect(await result.json()).toEqual({code:'PAYMENT_RELEASE_REQUIRED'});
  expect(h.revision()).toBe(revision);expect(h.snapshot().execution_ledger).toEqual([]);expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
});

describe('post-effect response classification',()=>{
 it('returns uncertainty when an AccessError interrupts durable execution claim',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h);vi.mocked(h.repo.compareAndSet).mockRejectedValueOnce(new AccessError('SESSION_REQUIRED',401));
  const result=await h.handler('execute',h.request(p.body),p.id);expect(result.status).toBe(503);expect(await result.json()).toMatchObject({code:'OUTCOME_UNVERIFIED',retry_submission:false});expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it('preserves exact AccessError before effects',async()=>{const h=controlledHarness(),p=await preparedApproval(h);h.revoke();const result=await h.handler('execute',h.request(p.body),p.id);expect(result.status).toBe(401);expect(await result.json()).toMatchObject({code:'SESSION_REQUIRED'});expect(h.client.createTransaction).not.toHaveBeenCalled();});
});

describe('linked source at final provider send',()=>{
 it('rejects drift during final controlled reload before Circle create',async()=>{
  const h=controlledHarness({linkedChangedOnFinalRead:true}),p=await preparedApproval(h);const result=await h.handler('execute',h.request(p.body),p.id);
  expect(result.status).toBe(503);expect(await result.json()).toMatchObject({code:'OUTCOME_UNVERIFIED',retry_submission:false});expect(h.client.createTransaction).not.toHaveBeenCalled();expect(h.snapshot().execution_ledger[0].status).toBe('BLOCKED');
 });
 it('detects the missing-final-hook fault that permits provider send and settlement',async()=>{
  const h=controlledHarness({linkedChangedOnFinalRead:true,omitFinalLinkHook:true}),p=await preparedApproval(h);const result=await h.handler('execute',h.request(p.body),p.id);
  expect(h.client.createTransaction).toHaveBeenCalledOnce();expect(result.status).toBe(200);
 });
});


import {canonicalize} from 'json-canonicalize';
import {parseOperatorSource} from '../src/server/operator-source-records';
import {createGenuineWorkflowHandlers} from '../src/server/genuine-workflow';
import {validateLinkedActivation} from '../src/server/linked-instruction-activation';
describe('linked UNKNOWN execution reconciliation after genuine reassessment',()=>{
 it('reads the exact existing provider transaction without resubmitting after the genuine assessment changes',async()=>{
  const records=syntheticSourceRecords().map(({counterparty_id,synthetic,classification,source_destination_evidence,source_destination_reference_token,arc_product_destination_status,...r}:any)=>({...r,amount:'1.00',currency:'USD',source_evidence:r.source_evidence.map(({evidence_id,content_sha256}:any)=>({evidence_id,content_sha256}))}));
  const hash=(value:unknown)=>createHash('sha256').update(canonicalize(value)).digest('hex');
  let snapshot=new DemoState(undefined,undefined,undefined,undefined,{},records).exportSnapshot(),revision=7;
  const {assessments,...base}=snapshot.authority;
  const bytes=Buffer.from(JSON.stringify({schema_version:3,record_count:5,provenance:'GENUINE_COMPANY_OBLIGATIONS',purpose:'GENUINE_ADVISORY_SOURCE',organization_id:DEMO_ORGANIZATION_ID,state_binding:{namespace:'FICTIONAL-GENUINE',revision,authority_sha256:hash(snapshot.authority),workflow_base_sha256:hash(base)},records}));
  const view=parseOperatorSource(bytes,createHash('sha256').update(bytes).digest('hex'));
  const genuine=createGenuineWorkflowHandlers({guard:async()=>({session:{operator_key:'fictional',credential_version:1},revalidate:async()=>{}} as unknown as AuthContext),source:()=>view,repository:{loadExisting:async()=>({revision,snapshot:structuredClone(snapshot) as any}),compareAndSet:async(_n:string,r:number,next:any)=>{if(r!==revision)throw new DemoStateConflictError();snapshot=structuredClone(next);return ++revision;}}});
  const request=(body:unknown,key:string)=>new Request('https://fixture.invalid',{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':key},body:JSON.stringify(body)});
  vi.stubEnv('NVIDIA_API_KEY',undefined);
  const id=records[0].obligation_id,first=await genuine('assess',request({},'c23a9d3a-39a1-4f36-9556-04f523969ab1'),id);expect(first.status).toBe(200);const assessment=await first.json();
  const drafted=await genuine('draft',request({expected_version:1,assessment_id:assessment.assessment_id,assessment_hash:assessment.assessment_hash},'c23a9d3a-39a1-4f36-9556-04f523969ab2'),id);expect(drafted.status).toBe(201);const {instruction}=await drafted.json();const genuineAggregates=structuredClone(snapshot.authority.aggregates);
  const verifyLink=vi.fn(async(source:ReturnType<typeof loadFinancialSourceAdmission>)=>validateLinkedActivation(source,view,snapshot,revision));
  const h=controlledHarness({lostResponse:true,linkedDraft:instruction,verifyLink}),p=await preparedApproval(h);
  const executed=await h.handler('execute',h.request(p.body),p.id);expect(executed.status).toBe(202);const unknown=await executed.json();expect(unknown.execution.status).toBe('UNKNOWN');expect(h.client.createTransaction).toHaveBeenCalledOnce();
  vi.stubEnv('NVIDIA_API_KEY',undefined);
  const reassessed=await genuine('assess',request({},'c23a9d3a-39a1-4f36-9556-04f523969ab3'),id);expect(reassessed.status).toBe(200);expect((await reassessed.json()).assessment_hash).not.toBe(assessment.assessment_hash);
  expect(()=>validateLinkedActivation(loadFinancialSourceAdmission(),view,snapshot,revision)).toThrow('LINK_SOURCE_STALE');
  const blocked=await h.handler('execute',h.request(p.body),p.id);expect(blocked.status).toBe(409);expect(await blocked.json()).toMatchObject({code:'LINK_SOURCE_STALE'});
  const reads=vi.mocked(h.client.listTransactions).mock.calls.length,checks=verifyLink.mock.calls.length;
  const identity={idempotency_key:unknown.execution.idempotency_key,pae_instruction_hash:p.a.pae_instruction_hash};
  const mismatched=await h.handler('reconcile',h.request({...identity,pae_instruction_hash:'0'.repeat(64)}),p.id);expect(mismatched.status).toBe(409);expect(await mismatched.json()).toMatchObject({code:'IDENTITY_MISMATCH'});
  vi.mocked(h.auth.revalidate).mockRejectedValueOnce(new AccessError('SESSION_REQUIRED',401));
  const signedOut=await h.handler('reconcile',h.request(identity),p.id);expect(signedOut.status).toBe(401);expect(await signedOut.json()).toMatchObject({code:'SESSION_REQUIRED'});
  expect(vi.mocked(h.client.listTransactions).mock.calls.length).toBe(reads);
  const reconciled=await h.handler('reconcile',h.request({idempotency_key:unknown.execution.idempotency_key,pae_instruction_hash:p.a.pae_instruction_hash}),p.id);
  expect(reconciled.status).toBe(200);expect(await reconciled.json()).toMatchObject({code:'RECONCILED',execution:{status:'SETTLED'}});
  expect(vi.mocked(h.client.listTransactions).mock.calls.length).toBeGreaterThan(reads);expect(verifyLink).toHaveBeenCalledTimes(checks);expect(h.client.createTransaction).toHaveBeenCalledOnce();
  expect(snapshot.authorization_history).toEqual([]);expect(snapshot.execution_ledger).toEqual([]);expect(snapshot.authority.aggregates).toEqual(genuineAggregates);
 });
});

describe('exact uncertain execution recovery without fresh operator funding',()=>{
 const rejectedBalance=()=>vi.fn(async(revalidate:()=>Promise<void>)=>{await revalidate();throw new AccessError('BALANCE_NOT_VERIFIED',503);});
 const admittedBalance=()=>vi.fn(async(revalidate:()=>Promise<void>)=>{await revalidate();});
 function guarded(h:ReturnType<typeof controlledHarness>,providerBoundary:NonNullable<FinancialDependencies['providerBoundary']>,overrides:Partial<FinancialDependencies>={}){
  return createFinancialHandlers({guard:async()=>h.auth,source:loadFinancialSourceAdmission,requester:loadFinancialRequesterBinding,load:h.load,providerBoundary,preflight:(_client,now,intent)=>runJ2aReadOnlyPreflight(h.client,now,intent),...overrides});
 }
 async function recordedUnknown(){
  const h=controlledHarness({lostResponse:true}),p=await preparedApproval(h);
  const sent=await h.handler('execute',h.request(p.body),p.id);expect(sent.status).toBe(202);
  const body=await sent.json();expect(body.execution.status).toBe('UNKNOWN');expect(h.client.createTransaction).toHaveBeenCalledOnce();
  return {h,p,identity:{idempotency_key:body.execution.idempotency_key as string,pae_instruction_hash:p.a.pae_instruction_hash as string}};
 }
 const statusReads=(h:ReturnType<typeof controlledHarness>)=>vi.mocked(h.client.listTransactions).mock.calls.length+vi.mocked(h.client.getTransaction).mock.calls.length;

 it.each(['100.000000','0'])('cold-restores exact UNKNOWN with current token amount %s without a new operator balance check',async amount=>{
  const {h,p,identity}=await recordedUnknown(),boundary=rejectedBalance();
  // Keep the existing fixture's native token identity; change only current funds.
  const balances:any=structuredClone(await h.client.getWalletTokenBalance({id:J2A_DEMO_SOURCE.id}));
  balances.data.tokenBalances[0].amount=amount;vi.mocked(h.client.getWalletTokenBalance).mockResolvedValue(balances);
  const loads=h.load.mock.calls.length,result=await guarded(h,boundary)('reconcile',h.request(identity),p.id);
  expect(result.status).toBe(200);expect(await result.json()).toMatchObject({code:'RECONCILED',execution:{status:'SETTLED',idempotency_key:identity.idempotency_key}});
  expect(h.load.mock.calls.length).toBeGreaterThan(loads);expect(boundary).not.toHaveBeenCalled();expect(h.client.createTransaction).toHaveBeenCalledOnce();
  expect(h.snapshot().execution_ledger[0]?.status).toBe('SETTLED');
 });
 it.each(['unavailable','wrong token'])('retains UNKNOWN when native token identity is %s without resending',async fault=>{
  const {h,p,identity}=await recordedUnknown(),boundary=rejectedBalance();
  if(fault==='unavailable')vi.mocked(h.client.getWalletTokenBalance).mockRejectedValue(new Error('Synthetic token identity unavailable'));
  else{const balances:any=structuredClone(await h.client.getWalletTokenBalance({id:J2A_DEMO_SOURCE.id}));balances.data.tokenBalances[0].token.id='SYNTHETIC-WRONG-TOKEN';vi.mocked(h.client.getWalletTokenBalance).mockResolvedValue(balances);}
  const reads=statusReads(h),result=await guarded(h,boundary)('reconcile',h.request(identity),p.id);
  expect(result.status).toBe(202);expect(await result.json()).toMatchObject({code:'RECONCILIATION_ONLY',execution:{status:'UNKNOWN'}});
  expect(statusReads(h)).toBeGreaterThan(reads);expect(boundary).not.toHaveBeenCalled();expect(h.client.createTransaction).toHaveBeenCalledOnce();expect(h.snapshot().execution_ledger[0]?.status).toBe('UNKNOWN');
 });
 it.each(['obligation','amount','destination','malformed destination'])('rejects a cold-restored %s mismatch before status or persistence',async fault=>{
  const {h,p,identity}=await recordedUnknown(),boundary=admittedBalance(),record=h.snapshot().execution_ledger[0]!;
  if(fault==='obligation')record.obligation_id=p.id+'-OTHER';
  if(fault==='amount')record.atomic_amount=(BigInt(record.atomic_amount)+1n).toString();
  if(fault==='destination')record.destination_address='0x'+'9'.repeat(40);
  if(fault==='malformed destination')record.destination_address='not-an-address';
  const before=structuredClone(h.snapshot()),reads=statusReads(h),writes=vi.mocked(h.repo.compareAndSet).mock.calls.length,loads=h.load.mock.calls.length;
  const result=await guarded(h,boundary)('reconcile',h.request(identity),p.id);
  expect(h.load.mock.calls.length).toBeGreaterThan(loads);expect(result.status).toBe(409);expect(await result.json()).toMatchObject({code:'IDENTITY_MISMATCH'});
  expect(statusReads(h)).toBe(reads);expect(vi.mocked(h.repo.compareAndSet).mock.calls.length).toBe(writes);expect(h.snapshot()).toEqual(before);expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
 it('accepts an equivalent canonical lowercase destination in the restored row',async()=>{
  const {h,p,identity}=await recordedUnknown();h.snapshot().execution_ledger[0]!.destination_address=h.snapshot().execution_ledger[0]!.destination_address.toLowerCase();
  const result=await guarded(h,rejectedBalance())('reconcile',h.request(identity),p.id);expect(result.status).toBe(200);expect(await result.json()).toMatchObject({execution:{status:'SETTLED'}});expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
 it.each(['foreign key','empty key','malformed key','oversize key','wrong hash','wrong selected source','no recorded execution'])('denies %s without provider status or durable changes',async fault=>{
  const {h,p,identity}=await recordedUnknown(),boundary=rejectedBalance(),input={...identity};let id=p.id;
  if(fault==='foreign key')input.idempotency_key+='-OTHER';if(fault==='empty key')input.idempotency_key='';if(fault==='malformed key')input.idempotency_key+='\n';if(fault==='oversize key')input.idempotency_key='x'.repeat(257);if(fault==='wrong hash')input.pae_instruction_hash='0'.repeat(64);if(fault==='wrong selected source')id+='-OTHER';if(fault==='no recorded execution')h.snapshot().execution_ledger=[];
  const before=structuredClone(h.snapshot()),reads=statusReads(h),writes=vi.mocked(h.repo.compareAndSet).mock.calls.length;
  const result=await guarded(h,boundary)('reconcile',h.request(input),id);
  expect(result.status).toBe(['empty key','malformed key','oversize key'].includes(fault)?400:fault==='wrong selected source'?403:409);
  expect(statusReads(h)).toBe(reads);expect(vi.mocked(h.repo.compareAndSet).mock.calls.length).toBe(writes);expect(h.snapshot()).toEqual(before);expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
 it('denies recovery without a sealed PAE before operator balance or provider reads',async()=>{
  const h=controlledHarness();await h.sealCurrent();const before=structuredClone(h.snapshot()),boundary=rejectedBalance();
  const result=await guarded(h,boundary)('reconcile',h.request({idempotency_key:'SYNTHETIC-NO-INSTRUCTION',pae_instruction_hash:'0'.repeat(64)}),h.source.source.obligation_id);
  expect(result.status).toBe(409);expect(await result.json()).toMatchObject({code:'CURRENT_PAE_REQUIRED'});expect(statusReads(h)).toBe(0);expect(boundary).not.toHaveBeenCalled();expect(h.snapshot()).toEqual(before);expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it.each([401,403])('preserves initial guard denial %s before state or provider access',async status=>{
  const {h,p,identity}=await recordedUnknown(),boundary=rejectedBalance(),loads=h.load.mock.calls.length,reads=statusReads(h);
  const result=await guarded(h,boundary,{guard:async()=>{throw new AccessError(status===401?'SESSION_REQUIRED':'CSRF_REJECTED',status);}})('reconcile',h.request(identity),p.id);
  expect(result.status).toBe(status);expect(h.load.mock.calls.length).toBe(loads);expect(statusReads(h)).toBe(reads);expect(boundary).not.toHaveBeenCalled();expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
 it.each(['revoked session','changed requester'])('%s during provider status work prevents a durable status commit or resend',async fault=>{
  const {h,p,identity}=await recordedUnknown(),before=structuredClone(h.snapshot()),writes=vi.mocked(h.repo.compareAndSet).mock.calls.length;
  const original=vi.mocked(h.client.listTransactions).getMockImplementation()!;
  vi.mocked(h.client.listTransactions).mockImplementation(async input=>{const value=await original(input);if(fault==='revoked session')h.revoke();else{const bytes=JSON.stringify({...h.requester,credential_version:2});writeFileSync(join(directory!,'.tameion/financial-requester.json'),bytes);vi.stubEnv('TAMEION_FINANCIAL_REQUESTER_SHA256',createHash('sha256').update(bytes).digest('hex'));}return value;});
  const result=await guarded(h,rejectedBalance())('reconcile',h.request(identity),p.id);
  expect(result.status).toBe(503);expect(await result.json()).toMatchObject({code:'OUTCOME_UNVERIFIED',retry_submission:false,execution_gate:'RECONCILIATION_ONLY'});
  expect(vi.mocked(h.repo.compareAndSet).mock.calls.length).toBe(writes);expect(h.snapshot()).toEqual(before);expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
 it('keeps the durable UNKNOWN on reconciliation CAS conflict',async()=>{
  const {h,p,identity}=await recordedUnknown(),before=structuredClone(h.snapshot());vi.mocked(h.repo.compareAndSet).mockRejectedValueOnce(new DemoStateConflictError());
  const result=await guarded(h,rejectedBalance())('reconcile',h.request(identity),p.id);
  expect(result.status).toBe(503);expect(await result.json()).toMatchObject({code:'OUTCOME_UNVERIFIED',retry_submission:false});expect(h.snapshot()).toEqual(before);expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
 it('concurrent exact recovery commits once through CAS and never submits again',async()=>{
  const {h,p,identity}=await recordedUnknown(),revision=h.revision(),boundary=rejectedBalance(),action=guarded(h,boundary);
  const original=vi.mocked(h.client.listTransactions).getMockImplementation()!;let entered=0;let release!:()=>void;const ready=new Promise<void>(resolve=>{release=resolve;});
  vi.mocked(h.client.listTransactions).mockImplementation(async input=>{if(++entered===2)release();await ready;return original(input);});
  const results=await Promise.all([action('reconcile',h.request(identity),p.id),action('reconcile',h.request(identity),p.id)]);
  expect(results.map(r=>r.status).sort()).toEqual([200,503]);expect(h.revision()).toBe(revision+1);expect(h.snapshot().execution_ledger[0]?.status).toBe('SETTLED');expect(boundary).not.toHaveBeenCalled();expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
 it('recovers an actual durable SUBMITTING claim with lost acknowledgment without creating a transfer',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h),persist=vi.mocked(h.repo.compareAndSet).getMockImplementation()!;
  vi.mocked(h.repo.compareAndSet).mockImplementation(async(...args)=>{const revision=await persist(...args);if(h.snapshot().execution_ledger.some(row=>row.status==='SUBMITTING'))throw new Error('Synthetic lost durable claim acknowledgment');return revision;});
  const sent=await h.handler('execute',h.request(p.body),p.id);expect(sent.status).toBe(503);expect(h.snapshot().execution_ledger[0]?.status).toBe('SUBMITTING');expect(h.client.createTransaction).not.toHaveBeenCalled();
  vi.mocked(h.repo.compareAndSet).mockImplementation(persist);const key=h.snapshot().execution_ledger[0]!.idempotency_key,boundary=rejectedBalance();
  const result=await guarded(h,boundary)('reconcile',h.request({idempotency_key:key,pae_instruction_hash:p.a.pae_instruction_hash}),p.id);
  expect(result.status).toBe(202);expect(await result.json()).toMatchObject({execution:{status:'UNKNOWN',idempotency_key:key}});expect(h.snapshot().execution_ledger[0]?.status).toBe('UNKNOWN');expect(boundary).not.toHaveBeenCalled();expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it.each(['SETTLED','FAILED','BLOCKED'] as const)('retains the fresh operator gate for an already-terminal %s record',async status=>{
  const {h,p,identity}=await recordedUnknown();h.snapshot().execution_ledger[0]!.status=status;
  const before=structuredClone(h.snapshot()),boundary=rejectedBalance(),reads=statusReads(h),writes=vi.mocked(h.repo.compareAndSet).mock.calls.length;
  const result=await guarded(h,boundary)('reconcile',h.request(identity),p.id);
  expect(result.status).toBe(503);expect(await result.json()).toMatchObject({code:'BALANCE_NOT_VERIFIED'});expect(boundary).toHaveBeenCalledOnce();expect(statusReads(h)).toBe(reads);expect(vi.mocked(h.repo.compareAndSet).mock.calls.length).toBe(writes);expect(h.snapshot()).toEqual(before);expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
 it.each(['preflight','execute'] as const)('still requires current operator balance before new %s effects',async kind=>{
  const h=controlledHarness(),p=await preparedApproval(h),before=structuredClone(h.snapshot()),boundary=rejectedBalance(),writes=vi.mocked(h.repo.compareAndSet).mock.calls.length;
  const body=kind==='preflight'?{obligation_id:p.id,expected_version:p.body.expected_version}:p.body;
  const result=await guarded(h,boundary)(kind,h.request(body),p.id);
  expect(result.status).toBe(503);expect(await result.json()).toMatchObject({code:'BALANCE_NOT_VERIFIED'});expect(boundary).toHaveBeenCalledOnce();expect(vi.mocked(h.repo.compareAndSet).mock.calls.length).toBe(writes);expect(h.snapshot()).toEqual(before);expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it('keeps a positive execute funding gate and authenticated revalidation before the single send',async()=>{
  const h=controlledHarness(),p=await preparedApproval(h),boundary=admittedBalance(),checks=vi.mocked(h.auth.revalidate).mock.calls.length;
  const result=await guarded(h,boundary)('execute',h.request(p.body),p.id);
  expect(result.status).toBe(200);expect(await result.json()).toMatchObject({execution:{status:'SETTLED'}});expect(boundary).toHaveBeenCalledOnce();expect(vi.mocked(h.auth.revalidate).mock.calls.length).toBeGreaterThan(checks);expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
 it.each(['source','requester'])('keeps expired %s admission denied and preserves the historical UNKNOWN',async fault=>{
  const {h,p,identity}=await recordedUnknown(),before=structuredClone(h.snapshot()),reads=statusReads(h);
  if(fault==='source')vi.spyOn(Date,'now').mockReturnValue(Date.parse(h.source.expires_at));
  else{const bytes=JSON.stringify({...h.requester,expires_at:new Date(Date.now()-1).toISOString()});writeFileSync(join(directory!,'.tameion/financial-requester.json'),bytes);vi.stubEnv('TAMEION_FINANCIAL_REQUESTER_SHA256',createHash('sha256').update(bytes).digest('hex'));}
  const result=await guarded(h,rejectedBalance())('reconcile',h.request(identity),p.id);
  expect(result.status).toBe(503);expect(await result.json()).toMatchObject({code:'FINANCIAL_AUTHORITY_UNAVAILABLE'});expect(statusReads(h)).toBe(reads);expect(h.snapshot()).toEqual(before);expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
});
