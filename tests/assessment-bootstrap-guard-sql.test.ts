import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {assertBootstrapOperationPreservation} from '../src/server/genuine-admission';
const sql=readFileSync(resolve(import.meta.dirname,'../supabase/migrations/20261019120000_assessment_bootstrap_guard.sql'),'utf8');
const previous=readFileSync(resolve(import.meta.dirname,'../supabase/migrations/20261014200005_linked_instruction_history_guard.sql'),'utf8');
const guardStart=sql.indexOf('create or replace function tameion_private.assessment_bootstrap_guard'),guardEnd=sql.indexOf('revoke all on function tameion_private.assessment_bootstrap_guard');
const guardSql=sql.slice(guardStart,guardEnd),casSql=sql.slice(guardEnd);

describe('assessment bootstrap guard migration source contract',()=>{
 it('is additive: replaces only the compare-and-set function and keeps every previous protection and grant',()=>{
  expect(sql.replace(/^\s*--.*$/gm,'')).not.toMatch(/\b(drop|truncate|alter table|delete from|create table)\b/i);
  const keep=(text:string)=>text.slice(text.indexOf("-- Once linked history exists"),text.indexOf('update tameion_private.demo_state'));
  expect(keep(casSql)).toBe(keep(previous));
  expect(casSql).toContain("grant execute on function public.tameion_state_compare_and_set(text, bigint, jsonb) to service_role;");
  expect(casSql).toContain("revoke all on function public.tameion_state_compare_and_set(text, bigint, jsonb) from public, anon, authenticated;");
 });
 it('invokes the guard under the row lock and before any history insert or snapshot update',()=>{
  const call=casSql.indexOf('assessment_bootstrap_guard(v_current.snapshot, p_next_snapshot)');
  expect(call).toBeGreaterThan(casSql.indexOf('for update'));
  expect(call).toBeLessThan(casSql.indexOf('insert into tameion_private.assessment_history'));
  expect(call).toBeLessThan(casSql.indexOf('update tameion_private.demo_state'));
 });
});

// Real SQL semantics. Runs only against an isolated local PostgreSQL provided by the controller:
//   TAMEION_TEST_PG_URL=postgresql://... (a scratch database; a scratch schema is created, never a live one).
const url=process.env.TAMEION_TEST_PG_URL;
const REF='99999999-9999-4999-8999-999999999999',KEY='77777777-7777-4777-8777-777777777777';
const base=():any=>({idempotency_key:KEY,obligation_id:'OBL',aggregate_version:1,status:'RESERVED',reserved_at:5,recovery:{generation:0,source_record_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64)},bootstrap:{kind:'CURRENT_SOURCE_BOOTSTRAP',source_record_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64),aggregate_version:1,unmatched_reference_key:REF,unmatched_reference_status:'UNVERIFIED_ABSENT_FROM_RECORDED_OPERATIONS'}});
const plain:any={idempotency_key:'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',obligation_id:'OBL',aggregate_version:1,status:'COMPLETED',assessment_hash:'e'.repeat(64)};
const scenarios=():Array<[string,any[],any[]]>=>{
 const p=base(),mut=(f:(o:any)=>void,status?:string)=>{const o=base();f(o);if(status)o.status=status;return o;};
 return [
  ['create',[plain],[plain,p]],
  ['progress durable',[plain,p],[plain,{...p,status:'PROVIDER_RESULT_DURABLE'}]],
  ['progress unknown',[plain,p],[plain,{...p,status:'UNKNOWN',recovery:{...p.recovery,unknown_at:9}}]],
  ['progress complete',[plain,p],[plain,{...p,status:'COMPLETED',assessment_hash:'e'.repeat(64)}]],
  ['unrelated change',[plain],[{...plain,status:'STALE'}]],
  ['drop',[plain,p],[plain]],
  ['reference',[p],[mut(o=>{o.bootstrap.unmatched_reference_key='88888888-8888-4888-8888-888888888888';})]],
  ['binding',[p],[mut(o=>{o.recovery.binding_sha256='c'.repeat(64);})]],
  ['source',[p],[mut(o=>{o.bootstrap.source_record_sha256='c'.repeat(64);})]],
  ['version',[p],[mut(o=>{o.aggregate_version=2;})]],
  ['strip',[p],[(()=>{const o=base();delete o.bootstrap;return o;})()]],
  ['regress completed',[{...p,status:'COMPLETED',assessment_hash:'e'.repeat(64)}],[p]],
  ['regress unknown',[{...p,status:'UNKNOWN',recovery:{...p.recovery,unknown_at:9}}],[p]],
  ['lineage',[p],[mut(o=>{o.recovery={...o.recovery,generation:1,predecessor_key:'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',predecessor_sha256:'a'.repeat(64)};})]],
  ['second',[],[p,{...base(),idempotency_key:'aaaaaaaa-aaaa-4aaa-8aaa-000000000007'}]],
  ['retrofit',[(()=>{const o=base();delete o.bootstrap;return o;})()],[p]],
 ];
};
describe.skipIf(!url)('assessment bootstrap guard — executed against isolated PostgreSQL',()=>{
 it('matches the TypeScript preservation rules for every scenario',()=>{
  const cases=scenarios(),literal=(v:unknown)=>`$j$${JSON.stringify({assessment_operations:v,authority:{assessments:[]}})}$j$::jsonb`;
  const script=['create schema if not exists tameion_private;',guardSql,...cases.map(([,o,n])=>`select tameion_private.assessment_bootstrap_guard(${literal(o)},${literal(n)});`)].join('\n');
  const run=spawnSync('psql',[url!,'-X','-At','-v','ON_ERROR_STOP=1'],{input:script,encoding:'utf8'});
  expect(run.status,run.stderr).toBe(0);
  const answers=run.stdout.split('\n').filter(line=>line==='t'||line==='f');
  expect(answers).toHaveLength(cases.length);
  cases.forEach(([name,o,n],i)=>{let ts=true;try{assertBootstrapOperationPreservation(o,n);}catch{ts=false;}expect(answers[i]==='t',name).toBe(ts);});
 });
});
