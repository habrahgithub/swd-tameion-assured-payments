import {parseDemoStateSnapshot} from '../src/server/demo-state';
import {loadFinancialSourceAdmission} from '../src/server/financial-source-admission';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {controlledHarness,cleanupSyntheticFinancialFixture} from './test-support/financial-fixture';
import {manualRequest,preparedHumanApproval} from './test-support/manual-payment-fixture';
import {createExistingPaymentStatusHandler} from '../src/server/existing-payment-status';
import {ArcCircleProviderAdapter} from '../src/execution/provider-adapter';
import {loadFinancialSourceAdmissionForReconcile} from '../src/server/financial-source-admission';
import {AuthorityStore} from '../src/authority/aggregate';
vi.unmock('../src/server/source-records');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();cleanupSyntheticFinancialFixture();});
describe('synthetic R1 effect and posting boundaries',()=>{
 it.each(['before-reservation','after-reservation','after-acceptance','after-posting'])('fault at %s retains the original identity',async boundary=>{
  const h=controlledHarness(),p=await preparedHumanApproval(h),persist=vi.mocked(h.repo.compareAndSet).getMockImplementation()!;
  let fired=false;
  vi.mocked(h.repo.compareAndSet).mockImplementation(async(...args)=>{
   const next=args[2] as unknown as ReturnType<typeof h.snapshot>,record=next.execution_ledger[0];
   if(!fired&&record&&((boundary==='before-reservation'||boundary==='after-reservation')&&record.status==='SUBMITTING'||boundary==='after-acceptance'&&record.provider_ref!==null||boundary==='after-posting'&&record.status==='SETTLED')){
    fired=true;if(boundary==='after-reservation'||boundary==='after-posting')await persist(...args);throw new Error('Synthetic persistence/acknowledgement fault');
   }
   return persist(...args);
  });
  const result=await h.handler('execute',h.request(p.body),p.id);expect(result.status).toBe(503);expect(fired).toBe(true);
  const sent=boundary==='after-acceptance'||boundary==='after-posting';expect(h.client.createTransaction).toHaveBeenCalledTimes(sent?1:0);
  vi.mocked(h.repo.compareAndSet).mockImplementation(persist);
  if(boundary==='before-reservation'){
   expect(h.snapshot().execution_ledger).toEqual([]);expect(h.snapshot().authority.settlement_postings??[]).toEqual([]);
  }else{
   expect(h.snapshot().execution_ledger[0].idempotency_key).toBe(p.identity.idempotency_key);
   const recovered=await h.handler('reconcile',h.request(p.identity),p.id);expect(recovered.status).toBe(sent?200:202);
   expect(h.snapshot().authority.settlement_postings??[]).toHaveLength(sent?1:0);
   expect(h.client.createTransaction).toHaveBeenCalledTimes(sent?1:0);
   if(sent){await h.handler('reconcile',h.request(p.identity),p.id);expect(h.snapshot().authority.settlement_postings).toHaveLength(1);}
  }
 });
 it.each(['MANUAL_REVIEW','AI_ASSISTED_REVIEW'] as const)('same deterministic controls for %s',async mode=>{
  const h=controlledHarness(),p=await preparedHumanApproval(h,mode),aggregate=h.snapshot().authority.aggregates[0];
  aggregate.destination_address='0x'+'9'.repeat(40);
  expect((await h.handler('execute',h.request(p.body),p.id)).status).toBeGreaterThanOrEqual(400);
  expect(h.client.createTransaction).not.toHaveBeenCalled();expect(h.snapshot().authority.settlement_postings??[]).toEqual([]);
 });
 it('revocation during the real adapter awaited fee read prevents the financial effect',async()=>{
  const h=controlledHarness(),p=await preparedHumanApproval(h),fee=vi.mocked(h.client.estimateTransferFee).getMockImplementation()!;
  vi.mocked(h.client.estimateTransferFee).mockImplementation(async input=>{const response=await fee(input);h.revoke();return response;});
  expect((await h.handler('execute',h.request(p.body),p.id)).status).toBeGreaterThanOrEqual(400);expect(h.client.createTransaction).not.toHaveBeenCalled();
 });
 it('permits scoped provider observation without any settlement mutation',async()=>{
  const h=controlledHarness({lostResponse:true}),p=await preparedHumanApproval(h);expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(202);
  const before=structuredClone(h.snapshot()),writes=vi.mocked(h.repo.compareAndSet).mock.calls.length;
  vi.mocked(h.client.getWalletTokenBalance).mockRejectedValue(new Error('Synthetic balance outage'));
  const read=createExistingPaymentStatusHandler({guard:async()=>h.auth,source:loadFinancialSourceAdmissionForReconcile,load:async()=>structuredClone(h.snapshot()),adapter:snapshot=>new ArcCircleProviderAdapter(h.client,()=>snapshot.settlement_proxies![0].preflight)});
  const response=await read(new Request('https://synthetic.invalid'),p.id);expect(response.status).toBe(200);expect(await response.json()).toMatchObject({observation:{status:'CONFIRMED'},posting_status:'NOT_COMMITTED_BY_THIS_READ',durable_execution_status:'UNKNOWN'});
  expect(h.snapshot()).toEqual(before);expect(vi.mocked(h.repo.compareAndSet).mock.calls.length).toBe(writes);expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
 it('only a proven no-dispatch refusal admits a linked successor; UNKNOWN never does',async()=>{
  const h=controlledHarness(),p=await preparedHumanApproval(h),balance=vi.mocked(h.client.getWalletTokenBalance).getMockImplementation()!;
  vi.mocked(h.client.getWalletTokenBalance).mockRejectedValue(new Error('Synthetic pre-dispatch outage'));
  await h.handler('execute',h.request(p.body),p.id);
  expect(h.snapshot().execution_ledger[0]).toMatchObject({status:'BLOCKED',dispatch_evidence:'PROVEN_NOT_DISPATCHED'});
  const predecessor=structuredClone(h.snapshot().execution_ledger[0]);
  const renewed=await h.handler('renew',manualRequest(h,{expected_version:p.a.aggregate.aggregate_version,predecessor_key:p.identity.idempotency_key,reason:'Restore synthetic funding service; retain the predecessor.'}),p.id);expect(()=>parseDemoStateSnapshot(h.snapshot())).not.toThrow();await h.load(loadFinancialSourceAdmission(),async()=>{});expect(renewed.status).toBe(201);
  expect(h.snapshot().execution_ledger[0]).toEqual(predecessor);expect(h.snapshot().recovery_events).toHaveLength(1);
  vi.mocked(h.client.getWalletTokenBalance).mockImplementation(balance);
  const next=await preparedHumanApproval(h);expect(next.identity.idempotency_key).not.toBe(p.identity.idempotency_key);
  expect((await h.handler('execute',h.request(next.body),next.id)).status).toBe(200);expect(h.client.createTransaction).toHaveBeenCalledOnce();expect(h.snapshot().authority.settlement_postings).toHaveLength(1);
 });
 it('normalizes reservations to 18 places and never allocates one budget twice',()=>{
  const store=new AuthorityStore(),now=new Date().toISOString();
  const model={available:200000000000000002n,reserved:0n};
  for(let n=0;n<10;n++){
   const cost=100000000000000001n,affordable=model.reserved+cost<=model.available;
   const reserve=()=>store.reserveWalletBudget(`synthetic-${n}`,`key-${n}`,'SYNTHETIC-WALLET','0.200000000000000002','0.100000000000000001',now);
   if(affordable){reserve();model.reserved+=cost;}else expect(reserve).toThrow(/reserved/);
  }
  expect(store.exportSnapshot().wallet_reservations).toHaveLength(2);
  expect(store.exportSnapshot().wallet_reservations!.reduce((n,r)=>n+BigInt(r.total_atomic_18),0n)).toBe(model.reserved);
 });
});

it('funds refresh preserves exact authority after a below-ceiling observation and funding increase',async()=>{
 const h=controlledHarness(),p=await preparedHumanApproval(h),before=structuredClone(h.snapshot().sealed_paes[0]);
 const balance=vi.mocked(h.client.getWalletTokenBalance).getMockImplementation()!;
 let amount='1.001000';vi.mocked(h.client.getWalletTokenBalance).mockImplementation(async input=>{const r=await balance(input) as {data:{tokenBalances:{amount:string}[]}};return {data:{...r.data,tokenBalances:r.data.tokenBalances.map(t=>({...t,amount}))}};});
 vi.mocked(h.client.estimateTransferFee).mockResolvedValue({data:{medium:{networkFee:'0.000500'}}});
 expect((await h.handler('preflight',h.request({obligation_id:p.id,expected_version:p.a.aggregate.aggregate_version}))).status).toBe(409);
 expect(h.snapshot().sealed_paes[0]).toEqual(before);expect(h.client.createTransaction).not.toHaveBeenCalled();
 amount='2.000000';expect((await h.handler('preflight',h.request({obligation_id:p.id,expected_version:p.a.aggregate.aggregate_version}))).status).toBe(200);expect(h.snapshot().sealed_paes[0]).toEqual(before);
 expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(200);expect(h.client.createTransaction).toHaveBeenCalledOnce();expect(h.snapshot().authority.settlement_postings).toHaveLength(1);
});
it.each((['MANUAL_REVIEW','AI_ASSISTED_REVIEW'] as const).flatMap(mode=>['amount','payer','version','business_hold','security_freeze','revoked_actor','expired_release'].map(control=>({mode,control}))))('enforces $control in $mode before any synthetic transfer',async({mode,control})=>{
 const h=controlledHarness(),p=await preparedHumanApproval(h,mode),aggregate=h.snapshot().authority.aggregates[0];
 if(control==='amount')aggregate.amount='2.000000';
 if(control==='payer')aggregate.source_wallet_ref='SYNTHETIC-WRONG-PAYER';
 if(control==='version')aggregate.aggregate_version++;
 if(control==='business_hold')aggregate.business_hold=true;
 if(control==='security_freeze')aggregate.security_freeze=true;
 if(control==='revoked_actor')h.snapshot().actor_authorities[0].status='REVOKED';
 if(control==='expired_release')vi.spyOn(Date,'now').mockReturnValue(Date.parse(h.snapshot().payment_release_approvals![0].record.expires_at)+1);
 expect((await h.handler('execute',h.request(p.body),p.id)).status).toBeGreaterThanOrEqual(400);expect(h.client.createTransaction).not.toHaveBeenCalled();expect(h.snapshot().authority.settlement_postings??[]).toEqual([]);
});
