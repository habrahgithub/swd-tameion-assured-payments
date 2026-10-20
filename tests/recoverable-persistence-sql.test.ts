import {describe,it,expect} from 'vitest';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {DemoState} from '../src/server/demo-state';
const directory=resolve(import.meta.dirname,'../supabase/migrations');
const migration=readFileSync(resolve(directory,'20261020062018_recoverable_payment_workflow.sql'),'utf8');
describe('R1 migration source contract (static evidence only)',()=>{
 it('guards actual nested settlement receipts and append-only source/review/recovery/late evidence',()=>{
  for(const fragment of ["'{authority,settlement_postings}'","'{authority,review_decisions}'","'source_revisions'","'recovery_events'","'late_assessment_results'","'linked_activation_receipts'","'provider_observations'"])expect(migration).toContain(fragment);
  expect(migration).not.toContain("array['source_revisions','recovery_events','settlement_postings']");
 });
 it('retains previous row locks and guards and serializes new cross-namespace wallet admission',()=>{
  for(const name of ['assessment_bootstrap_guard','assessment_disposition_guard','recovery_workflow_guard'])expect(migration).toContain(`${name}(v_current.snapshot`);
  expect(migration).toContain('wallet_financial_namespace where wallet_id=v_wallet for update');expect(migration).toContain('WALLET_NAMESPACE_CONFLICT');
  expect(migration.indexOf('wallet_financial_namespace(wallet_id,namespace) values')).toBeLessThan(migration.indexOf('insert into tameion_private.assessment_history'));
  expect(migration).toContain("next_reservation.value->>'state' in ('RESERVED','EXPOSURE_UNKNOWN')");expect(migration).toContain('prior_reservation.value');expect(migration).not.toMatch(/\b(drop|truncate|delete from)\b/i);
 });
});
// This gate deliberately cannot select an inherited hosted URL. An operator
// must explicitly name an empty database in an independently disposable local
// cluster. No test connection is opened when these values are absent.
const url=process.env.TAMEION_RECOVERY_DISPOSABLE_PG_URL;
const confirmed=process.env.TAMEION_RECOVERY_DISPOSABLE_PG_CONFIRMED==='1';
function localDisposable(){if(!url||!confirmed)throw new Error('Explicit disposable local database not supplied');const u=new URL(url);if(!['postgres:','postgresql:'].includes(u.protocol)||!['localhost','127.0.0.1','[::1]'].includes(u.hostname)||!u.port||!/^\/tameion_recovery_disposable_[A-Za-z0-9_]+$/.test(u.pathname))throw new Error('Database gate rejects non-disposable/non-local target');return url;}
const executable='/usr/lib/postgresql/17/bin/psql';
const args=()=>['-X','--dbname',localDisposable(),'-v','ON_ERROR_STOP=1','-At'];
function query(sql:string){const r=spawnSync(executable,args(),{input:sql,encoding:'utf8',timeout:15000});if(r.error||r.status!==0)throw new Error(`Disposable SQL command failed: ${r.error?.message??r.stderr.replaceAll(url??'','[LOCAL_DISPOSABLE]')}`);return r.stdout.trim();}
const quote=(v:unknown)=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
describe.skipIf(!url||!confirmed)('R1 executed disposable PostgreSQL gate (two independent connections)',()=>{
 it('applies actual additive migrations, rejects receipt deletion/mutation, enforces permissions and cross-namespace contention',async()=>{
  expect(query("select count(*) from pg_tables where schemaname in ('public','tameion_private');")).toBe('0');
  query("do $$begin if not exists(select 1 from pg_roles where rolname='anon')then create role anon;end if;if not exists(select 1 from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select 1 from pg_roles where rolname='service_role')then create role service_role;end if;end$$;");
  for(const name of readdirSync(directory).filter(name=>name.endsWith('.sql')).sort())query(readFileSync(resolve(directory,name),'utf8'));
  expect(query("select public.tameion_recovery_capabilities()->>'shared_wallet_namespace_lock';")).toBe('true');
  const receipt={idempotency_key:'SYNTHETIC-POSTING',evidence_sha256:'a'.repeat(64)},old={authority:{settlement_postings:[receipt]}};
  expect(query(`select tameion_private.recovery_workflow_guard(${quote(old)},${quote({authority:{settlement_postings:[]}})});`)).toBe('f');
  expect(query(`select tameion_private.recovery_workflow_guard(${quote(old)},${quote({authority:{settlement_postings:[{...receipt,evidence_sha256:'b'.repeat(64)}]}})});`)).toBe('f');
  expect(query(`select tameion_private.recovery_workflow_guard(${quote(old)},${quote(old)});`)).toBe('t');
  expect(query("select has_table_privilege('service_role','tameion_private.wallet_financial_namespace','INSERT') or has_table_privilege('anon','tameion_private.human_authorization_history','SELECT');")).toBe('f');
  const base=new DemoState(undefined,undefined,undefined,undefined,{},[]).exportSnapshot();
  for(const namespace of ['SYNTHETIC-CONNECTION-A','SYNTHETIC-CONNECTION-B'])query(`insert into tameion_private.demo_state(namespace,revision,snapshot) values('${namespace}',1,${quote(base)});`);
  const reserved=(suffix:string)=>({...base,authority:{...base.authority,wallet_reservations:[{idempotency_key:`SYNTHETIC-OP-${suffix}`,obligation_id:`SYNTHETIC-PAYABLE-${suffix}`,wallet_id:'SYNTHETIC-SHARED-WALLET',total_atomic_18:'1002000000000000000',state:'EXPOSURE_UNKNOWN',observed_at:new Date().toISOString(),updated_at:new Date().toISOString()}]}});
  const child=(sql:string,onOutput?:(text:string)=>void)=>{const p=spawn(executable,args(),{stdio:['pipe','pipe','pipe']});let output='',error='';p.stdout.on('data',chunk=>{output+=String(chunk);onOutput?.(output);});p.stderr.on('data',chunk=>error+=String(chunk));const done=new Promise<{status:number|null;output:string;error:string}>((resolve,reject)=>{p.on('error',reject);p.on('close',status=>resolve({status,output,error}));});p.stdin.end(sql);return done;};
  let announce!:()=>void;const locked=new Promise<void>(resolve=>announce=resolve);
  const first=child(`begin;set local role service_role;select public.tameion_state_compare_and_set('SYNTHETIC-CONNECTION-A',1,${quote(reserved('A'))});select 'WALLET_LOCK_HELD';select pg_sleep(0.5);commit;`,output=>{if(output.includes('WALLET_LOCK_HELD'))announce();});
  await locked;
  const second=child(`set role service_role;select public.tameion_state_compare_and_set('SYNTHETIC-CONNECTION-B',1,${quote(reserved('B'))});`);
  const [a,b]=await Promise.all([first,second]);expect(a.status,a.error).toBe(0);expect(b.status).not.toBe(0);expect(b.error).toContain('WALLET_NAMESPACE_CONFLICT');
  expect(query("select namespace from tameion_private.wallet_financial_namespace where wallet_id='SYNTHETIC-SHARED-WALLET';")).toBe('SYNTHETIC-CONNECTION-A');
  expect(query("select revision from tameion_private.demo_state where namespace='SYNTHETIC-CONNECTION-B';")).toBe('1');
 },30000);
});
