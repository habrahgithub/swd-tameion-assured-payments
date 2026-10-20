// C2 accepted S-01 retention oracles, adapted from immutable SENTINEL C1
// probes. C1 diagnostics that asserted corruption are deliberately not reused.
import {afterEach,describe,it,expect,vi} from 'vitest';
import {controlledHarness,cleanupSyntheticFinancialFixture} from './test-support/financial-fixture';
import {preparedHumanApproval,manualRequest} from './test-support/manual-payment-fixture';
import {parseDemoStateSnapshot} from '../src/server/demo-state';
import {contentHash} from '../src/domain/linked-instruction';
import {enabled,newDatabase,seed,repository,query,literal} from './test-support/recoverable-disposable-pg';
vi.unmock('../src/server/source-records');
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();cleanupSyntheticFinancialFixture();});
function durable(){const h=controlledHarness(),url=newDatabase();seed(url,h.source.namespace,h.snapshot());const repo=repository(url,h.source.namespace);vi.mocked(h.repo.loadExisting).mockImplementation(repo.loadExisting);vi.mocked(h.repo.compareAndSet).mockImplementation(repo.compareAndSet);return {h,url,repo};}
function cas(url:string,namespace:string,revision:number,next:unknown){return JSON.parse(query(`set role service_role;select public.tameion_state_compare_and_set('${namespace}',${revision},${literal(next)});`,url).split('\n').at(-1)!);}
describe.skipIf(!enabled)('C2 real local SQL financial retention',()=>{
 it('keeps private tables and financial RPCs isolated from direct API-role access',()=>{
  const url=newDatabase();
  for(const role of ['anon','authenticated','service_role'])expect(query(`select bool_or(has_table_privilege('${role}',quote_ident(schemaname)||'.'||quote_ident(tablename),'SELECT,INSERT,UPDATE,DELETE')) from pg_tables where schemaname='tameion_private';`,url)).toBe('f');
  for(const role of ['anon','authenticated'])expect(query(`select has_function_privilege('${role}','public.tameion_state_compare_and_set(text,bigint,jsonb)','EXECUTE') or has_function_privilege('${role}','public.tameion_recovery_capabilities()','EXECUTE');`,url)).toBe('f');
  expect(query("select has_function_privilege('service_role','public.tameion_state_compare_and_set(text,bigint,jsonb)','EXECUTE');",url)).toBe('t');
 });

 it.each(['delete','mutate'] as const)('rejects %s of established SETTLED proof, retaining revision and full state',async mutation=>{
  const {h,url,repo}=durable(),p=await preparedHumanApproval(h);expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(200);
  const before=await repo.loadExisting(),next=structuredClone(before.snapshot);expect(next.authority.settlement_postings[0].evidence_sha256).toBe(contentHash(next.execution_ledger[0].provider_evidence));
  if(mutation==='delete')delete next.execution_ledger[0].provider_evidence;else next.execution_ledger[0].provider_evidence.tx_hash='0x'+'b'.repeat(64);
  expect(cas(url,h.source.namespace,before.revision,next).accepted).toBe(false);expect(await repo.loadExisting()).toEqual(before);expect(()=>parseDemoStateSnapshot(before.snapshot)).not.toThrow();
  expect(cas(url,h.source.namespace,before.revision,before.snapshot).accepted).toBe(true);expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
 it.each(['BLOCKED','FAILED'] as const)('retired %s predecessor cannot change/delete any retained field',async terminal=>{
  const {h,url,repo}=durable(),p=await preparedHumanApproval(h),read=vi.mocked(h.client.getTransaction).getMockImplementation()!;
  if(terminal==='BLOCKED')vi.mocked(h.client.getWalletTokenBalance).mockRejectedValueOnce(Error('C2 no dispatch'));
  else vi.mocked(h.client.getTransaction).mockImplementation(async input=>{const r=await read(input) as {data:{transaction:Record<string,unknown>}};return {data:{transaction:{...r.data.transaction,state:'FAILED',networkFee:'0',transactionType:'OUTBOUND'}}};});
  await h.handler('execute',h.request(p.body),p.id);const row=(await repo.loadExisting()).snapshot.execution_ledger[0];expect(row.status).toBe(terminal);
  expect((await h.handler('renew',manualRequest(h,{expected_version:p.a.aggregate.aggregate_version,predecessor_key:row.idempotency_key,reason:'C2 exact safe effects retained'}),p.id)).status).toBe(201);
  const before=await repo.loadExisting();expect(contentHash(before.snapshot.execution_ledger[0])).toBe(before.snapshot.recovery_events[0].predecessor_sha256);
  for(const mutation of ['ref','field','delete']){const next=structuredClone(before.snapshot);if(mutation==='ref')next.execution_ledger[0].provider_ref='SYNTHETIC-C2-NEW-REF';if(mutation==='field')next.execution_ledger[0].reason='Changed archived reason';if(mutation==='delete')next.execution_ledger=[];
   expect(cas(url,h.source.namespace,before.revision,next).accepted,mutation).toBe(false);expect(await repo.loadExisting()).toEqual(before);}
  expect(()=>parseDemoStateSnapshot((before).snapshot)).not.toThrow();expect(cas(url,h.source.namespace,before.revision,before.snapshot).accepted).toBe(true);
 });
 it('rejects rewriting a predecessor in the very CAS that first retires it',async()=>{
  const {h,url,repo}=durable(),p=await preparedHumanApproval(h);vi.mocked(h.client.getWalletTokenBalance).mockRejectedValueOnce(Error('C2 no dispatch'));await h.handler('execute',h.request(p.body),p.id);const before=await repo.loadExisting();
  let proposed:unknown;vi.mocked(h.repo.compareAndSet).mockImplementationOnce(async(_ns,revision,next)=>{const poisoned=structuredClone(next) as typeof before.snapshot;poisoned.execution_ledger[0].provider_ref='SYNTHETIC-C2-SAME-CAS';proposed=poisoned;return repo.compareAndSet(_ns,revision,poisoned);});
  const response=await h.handler('renew',manualRequest(h,{expected_version:p.a.aggregate.aggregate_version,predecessor_key:before.snapshot.execution_ledger[0].idempotency_key,reason:'C2 retirement admission cannot rewrite original'}),p.id);
  expect(proposed).toBeDefined();expect(response.status).toBeGreaterThanOrEqual(400);expect(await repo.loadExisting()).toEqual(before);
 });
 it('permits UNKNOWN/pending progression, observation append and FAILED fee enrichment before immutable retirement',async()=>{
  const {h,repo}=durable(),p=await preparedHumanApproval(h),read=vi.mocked(h.client.getTransaction).getMockImplementation()!;let state='PENDING',fee:string|undefined;
  vi.mocked(h.client.getTransaction).mockImplementation(async input=>{const r=await read(input) as {data:{transaction:Record<string,unknown>}};return {data:{transaction:{...r.data.transaction,state,networkFee:fee,transactionType:'OUTBOUND'}}};});
  expect((await h.handler('execute',h.request(p.body),p.id)).status).toBe(202);const key=(await repo.loadExisting()).snapshot.execution_ledger[0].idempotency_key;
  state='FAILED';expect((await h.handler('reconcile',h.request(p.identity),p.id)).status).toBe(200);expect((await repo.loadExisting()).snapshot.authority.wallet_reservations[0].state).toBe('EXPOSURE_UNKNOWN');
  fee='0';expect((await h.handler('reconcile',h.request(p.identity),p.id)).status).toBe(200);const final=(await repo.loadExisting()).snapshot;expect(final.execution_ledger[0].provider_observations.length).toBeGreaterThan(0);expect(final.execution_ledger[0].provider_evidence.network_fee).toBe('0');expect(final.execution_ledger[0].idempotency_key).toBe(key);
  expect((await h.handler('renew',manualRequest(h,{expected_version:p.a.aggregate.aggregate_version,predecessor_key:key,reason:'C2 authoritative zero fee failure'}),p.id)).status).toBe(201);const retired=await repo.loadExisting();expect(()=>parseDemoStateSnapshot(retired.snapshot)).not.toThrow();expect(h.client.createTransaction).toHaveBeenCalledOnce();
 });
});
