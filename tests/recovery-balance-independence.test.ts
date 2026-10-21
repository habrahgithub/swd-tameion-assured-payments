import {afterEach,expect,it,vi} from 'vitest';
import {controlledHarness,preparedApproval,cleanupSyntheticFinancialFixture} from './test-support/financial-fixture';
vi.unmock('../src/server/source-records');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();cleanupSyntheticFinancialFixture();});
it.each(['saved','lost'])('WAL-17: real route and Circle adapter recover %s reference while balance service fails',async reference=>{
  const h=controlledHarness({lostResponse:true}),p=await preparedApproval(h);
  expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(202);
  const record=h.snapshot().execution_ledger[0]!;
  if(reference==='saved')record.provider_ref='synthetic-provider-tx-1';
  vi.mocked(h.client.getWalletTokenBalance).mockClear().mockRejectedValue(new Error('Synthetic balance outage'));
  vi.mocked(h.client.estimateTransferFee).mockClear().mockRejectedValue(new Error('Synthetic fee outage'));
  const result=await h.handler('reconcile',h.request({idempotency_key:record.idempotency_key,pae_instruction_hash:p.a.pae_instruction_hash}),p.id);
  expect(result.status).toBe(200);
  expect(await result.json()).toMatchObject({execution:{status:'SETTLED'}});
  expect(h.client.getWalletTokenBalance).not.toHaveBeenCalled();
  expect(h.client.estimateTransferFee).not.toHaveBeenCalled();
  expect(h.client.createTransaction).toHaveBeenCalledOnce();
});
