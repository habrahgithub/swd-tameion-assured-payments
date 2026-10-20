import {afterEach,expect,it,vi} from 'vitest';
import {controlledHarness,cleanupSyntheticFinancialFixture} from './test-support/financial-fixture';
import {preparedHumanApproval,manualRequest} from './test-support/manual-payment-fixture';
import {loadFinancialSourceAdmission} from '../src/server/financial-source-admission';
import {getCurrentSettlementProxyPacket,getSettlementEvidenceBinding} from '../src/server/settlement-proxy-packet';
vi.unmock('../src/server/source-records');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();cleanupSyntheticFinancialFixture();vi.useRealTimers();});
it.each(['FAILED','DENIED','CANCELLED'])('enriches %s fee proof and completes a linked successor without deleting history',async terminal=>{
 const h=controlledHarness(),p=await preparedHumanApproval(h),read=vi.mocked(h.client.getTransaction).getMockImplementation()!;
 let fee:string|undefined;
 vi.mocked(h.client.getTransaction).mockImplementation(async input=>{const response=await read(input) as {data:{transaction:Record<string,unknown>}};return {data:{transaction:{...response.data.transaction,state:terminal,networkFee:fee,transactionType:'OUTBOUND'}}};});
 await h.handler('execute',h.request(p.body),p.id);expect(h.snapshot().execution_ledger[0].status).toBe('FAILED');expect(h.snapshot().authority.wallet_reservations![0].state).toBe('EXPOSURE_UNKNOWN');
 expect((await h.handler('renew',manualRequest(h,{expected_version:p.a.aggregate.aggregate_version,predecessor_key:p.identity.idempotency_key,reason:'Not yet proven'}),p.id)).status).toBe(409);
 fee='0';expect((await h.handler('reconcile',h.request(p.identity),p.id)).status).toBe(200);
 expect(h.snapshot().authority.wallet_reservations![0].state).toBe('RELEASED');const predecessor=structuredClone(h.snapshot().execution_ledger[0]);
 const originalList=vi.mocked(h.client.listTransactions).getMockImplementation()!;
 vi.mocked(h.client.listTransactions).mockImplementation(async input=>{const response=await originalList(input) as {data:{transactions:Record<string,unknown>[]}};return {data:{...response.data,transactions:response.data.transactions.map(t=>({...t,state:terminal,networkFee:'0',transactionType:'OUTBOUND'}))}};});
 expect((await h.handler('renew',manualRequest(h,{expected_version:p.a.aggregate.aggregate_version,predecessor_key:p.identity.idempotency_key,reason:'Exact zero principal and fee effect proof reviewed'}),p.id)).status).toBe(201);
 await h.load(loadFinancialSourceAdmission(),async()=>{});const next=await preparedHumanApproval(h);
 vi.mocked(h.client.getTransaction).mockImplementation(read);
 expect((await h.handler('execute',h.request(next.body),next.id)).status).toBe(200);
 expect((await h.handler('reconcile',h.request(next.identity),next.id)).status).toBe(200);
 expect(h.snapshot().execution_ledger[0]).toEqual(predecessor);expect(h.client.createTransaction).toHaveBeenCalledTimes(2);expect(h.snapshot().authority.settlement_postings).toHaveLength(1);
});
it('retains a reference discovered in pending idempotency lookup through reload and collection outage',async()=>{
 const h=controlledHarness({lostResponse:true}),p=await preparedHumanApproval(h);await h.handler('execute',h.request(p.body),p.id);
 const list=vi.mocked(h.client.listTransactions).getMockImplementation()!,point=vi.mocked(h.client.getTransaction).getMockImplementation()!;
 vi.mocked(h.client.getTransaction).mockImplementation(async input=>{const r=await point(input) as {data:{transaction:Record<string,unknown>}};return {data:{transaction:{...r.data.transaction,state:'PENDING'}}};});
 vi.mocked(h.client.listTransactions).mockImplementation(async input=>{const r=await list(input) as {data:{transactions:Record<string,unknown>[]}};return {data:{...r.data,transactions:r.data.transactions.map(t=>({...t,state:'PENDING'}))}};});
 expect((await h.handler('reconcile',h.request(p.identity),p.id)).status).toBe(202);expect(h.snapshot().execution_ledger[0].provider_ref).toBe('synthetic-provider-tx-1');
 await h.load(loadFinancialSourceAdmission(),async()=>{});vi.mocked(h.client.getTransaction).mockImplementation(point);vi.mocked(h.client.listTransactions).mockRejectedValue(new Error('Synthetic collection outage'));
 expect((await h.handler('reconcile',h.request(p.identity),p.id)).status).toBe(200);expect(h.client.createTransaction).toHaveBeenCalledOnce();expect(h.snapshot().authority.settlement_postings).toHaveLength(1);
});
it('retires only proven unused expired authority then reviews, prepares and executes a fresh successor',async()=>{
 const h=controlledHarness({sourceWindowMs:3500000}),p=await preparedHumanApproval(h),expiry=Date.parse(h.snapshot().sealed_paes[0][1].payload.expiry);
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(expiry+1);
 const renewal=await h.handler('renew',manualRequest(h,{expected_version:p.a.aggregate.aggregate_version,predecessor_key:p.identity.idempotency_key,reason:'Unused expired exact authority; no dispatch ever recorded'}),p.id);expect(renewal.status,await renewal.clone().text()).toBe(201);
 expect(h.client.createTransaction).not.toHaveBeenCalled();expect(h.snapshot().execution_ledger[0]).toMatchObject({status:'BLOCKED',dispatch_evidence:'PROVEN_NOT_DISPATCHED'});
 const next=await preparedHumanApproval(h);expect((await h.handler('execute',h.request(next.body),p.id)).status).toBe(200);expect(h.client.createTransaction).toHaveBeenCalledOnce();
});
it('retains settled HUMAN provenance after all send authority expires',async()=>{
 const h=controlledHarness(),p=await preparedHumanApproval(h);expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(200);
 const expiry=Date.parse(h.snapshot().sealed_paes[0][1].payload.expiry);vi.spyOn(Date,'now').mockReturnValue(expiry+3600001);
 const restored=await h.load(h.source as ReturnType<typeof loadFinancialSourceAdmission>,async()=>{});expect(getCurrentSettlementProxyPacket(restored,p.id)).toBeNull();
 const retained=getSettlementEvidenceBinding(restored,p.id,null);expect(retained.state).toBe('AVAILABLE_HISTORICAL');if('packet'in retained){expect(retained.packet.packet.assessment).toBeNull();expect(retained.packet.packet.review_decision).toBeTruthy();}
 expect(h.snapshot().authority.assessments).toEqual([]);expect(h.snapshot().authority.settlement_postings).toHaveLength(1);
});
it('an UNKNOWN claim cannot become an unused or failed successor',async()=>{
 const h=controlledHarness({lostResponse:true}),p=await preparedHumanApproval(h);await h.handler('execute',h.request(p.body),p.id);
 expect((await h.handler('renew',manualRequest(h,{expected_version:p.a.aggregate.aggregate_version,predecessor_key:p.identity.idempotency_key,reason:'Synthetic timeout is not proof'}),p.id)).status).toBe(409);expect(h.snapshot().recovery_events??[]).toEqual([]);expect(h.client.createTransaction).toHaveBeenCalledOnce();
});
it('retires a proven no-dispatch child despite stale parent advice, but grants no fresh send/review from that stale link',async()=>{
 let stale=false;const h=controlledHarness({linkedChangedOnFinalRead:false,linkedDraft:{instruction_id:'TESTNET-CONTROLLED-LINKED-'+'e'.repeat(32),source_obligation_id:'SYNTHETIC-PARENT',instruction_content_sha256:'a'.repeat(64)},verifyLink:async()=>{if(stale)throw new Error('Synthetic parent review expired');}}),p=await preparedHumanApproval(h);
 vi.mocked(h.client.getWalletTokenBalance).mockRejectedValue(new Error('Synthetic pre-dispatch failure'));await h.handler('execute',h.request(p.body),p.id);expect(h.snapshot().execution_ledger[0].dispatch_evidence).toBe('PROVEN_NOT_DISPATCHED');stale=true;
 const retired=await h.handler('renew',manualRequest(h,{expected_version:p.a.aggregate.aggregate_version,predecessor_key:p.identity.idempotency_key,reason:'Retire original proven no-send; parent review needs renewal'}),p.id);expect(retired.status).toBe(201);expect(h.snapshot().recovery_events).toHaveLength(1);
 const nextReview=await h.handler('review',manualRequest(h,{expected_version:p.a.aggregate.aggregate_version+1,mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Stale link cannot grant new payment authority',evidence_ids:['CONTROLLED-TESTNET-001'],finding_dispositions:[]}),p.id);expect(nextReview.status).toBeGreaterThanOrEqual(400);expect(h.client.createTransaction).not.toHaveBeenCalled();
});
