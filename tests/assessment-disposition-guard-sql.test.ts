import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {canonicalize} from 'json-canonicalize';
import {assertDispositionLineage,assertDispositionPreservation} from '../src/server/genuine-disposition';
const migrations=resolve(import.meta.dirname,'../supabase/migrations');
const sql=readFileSync(resolve(migrations,'20261019190000_assessment_disposition_guard.sql'),'utf8');
const bootstrapMigration=readFileSync(resolve(migrations,'20261019120000_assessment_bootstrap_guard.sql'),'utf8');
const linkedMigration=readFileSync(resolve(migrations,'20261014200005_linked_instruction_history_guard.sql'),'utf8');
const hash=(v:unknown)=>createHash('sha256').update(canonicalize(v)).digest('hex');
const guardStart=sql.indexOf('create or replace function tameion_private.assessment_disposition_guard'),guardEnd=sql.indexOf('revoke all on function tameion_private.assessment_disposition_guard');
const guardSql=sql.slice(guardStart,guardEnd);
const casSql=sql.slice(sql.indexOf('create or replace function public.tameion_state_compare_and_set'));

describe('assessment disposition guard migration source contract',()=>{
 it('is additive and keeps every earlier compare-and-set protection and grant byte-for-byte',()=>{
  expect(sql.replace(/^\s*--.*$/gm,'')).not.toMatch(/\b(drop|truncate|alter table|delete from|create table)\b/i);
  const keep=(text:string)=>text.slice(text.indexOf('-- Once linked history exists'),text.indexOf('update tameion_private.demo_state'));
  expect(keep(casSql)).toBe(keep(linkedMigration));
  expect(keep(casSql)).toBe(keep(bootstrapMigration.slice(bootstrapMigration.indexOf('create or replace function public.tameion_state_compare_and_set'))));
  expect(casSql).toContain('grant execute on function public.tameion_state_compare_and_set(text, bigint, jsonb) to service_role;');
  expect(casSql).toContain('revoke all on function public.tameion_state_compare_and_set(text, bigint, jsonb) from public, anon, authenticated;');
  expect(sql).toContain('revoke all on function tameion_private.assessment_disposition_guard(jsonb, jsonb) from public, anon, authenticated;');
  // The bootstrap guard it supersedes is re-created unchanged, not weakened.
  const bootstrapGuard=(text:string)=>text.slice(text.indexOf('create or replace function tameion_private.assessment_bootstrap_guard'),text.indexOf('revoke all on function tameion_private.assessment_bootstrap_guard'));
  expect(bootstrapGuard(sql)).toBe(bootstrapGuard(bootstrapMigration));
 });
 it('runs both guards under the row lock and before any history insert or snapshot update',()=>{
  const bootstrap=casSql.indexOf('assessment_bootstrap_guard(v_current.snapshot, p_next_snapshot)'),disposition=casSql.indexOf('assessment_disposition_guard(v_current.snapshot, p_next_snapshot)');
  for(const call of [bootstrap,disposition]){expect(call).toBeGreaterThan(casSql.indexOf('for update'));expect(call).toBeLessThan(casSql.indexOf('insert into tameion_private.assessment_history'));expect(call).toBeLessThan(casSql.indexOf('update tameion_private.demo_state'));}
 });
 it('names the late-receipt, graft, duplicate and predecessor protections explicitly',()=>{
  for(const fragment of ["'ASM-' || v_pred_key",'v_prior is not null and not (v_prior ? \'legacy_disposition\')','v_pred_new is distinct from v_pred_old',"'PENDING'"])expect(guardSql).toContain(fragment);
 });
});

// Real SQL semantics. Runs only against an isolated local PostgreSQL provided by the controller:
//   TAMEION_TEST_PG_URL=postgresql://... (a scratch database; only a scratch schema/function is created, never a live one).
const url=process.env.TAMEION_TEST_PG_URL;
const LEGACY='11111111-1111-4111-8111-111111111111',CHILD='77777777-7777-4777-8777-777777777777',OTHER='88888888-8888-4888-8888-888888888888';
const pred=():any=>({idempotency_key:LEGACY,obligation_id:'OBL',aggregate_version:1,status:'UNKNOWN',reserved_at:1});
const child=():any=>{const p=pred();const admission:any={kind:'CURRENT_SOURCE_REASSESSMENT_ADMISSION',approval_id:'SYNTHETIC-APPROVAL-001',obligation_id:'OBL',aggregate_version:1,source_record_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64),predecessor_key:LEGACY,predecessor_sha256:hash(p),valid_from:'2026-10-19T12:00:00.000Z',expires_at:'2026-10-19T12:30:00.000Z'};
 return {idempotency_key:CHILD,obligation_id:'OBL',aggregate_version:1,status:'RESERVED',reserved_at:Date.parse('2026-10-19T12:10:00.000Z'),recovery:{generation:0,source_record_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64)},legacy_disposition:{kind:'CURRENT_SOURCE_REASSESSMENT',predecessor_key:LEGACY,predecessor_sha256:admission.predecessor_sha256,prior_binding_status:'UNVERIFIED',admission,admission_sha256:hash(admission)}};};
const plain:any={idempotency_key:'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',obligation_id:'OBL',aggregate_version:1,status:'COMPLETED',assessment_hash:'e'.repeat(64)};
const mut=(f:(o:any)=>void,base:any=child())=>{f(base);return base;};
type Scenario=[name:string,old:any[],next:any[],sealed:string[],expected:boolean];
const scenarios=():Scenario[]=>{
 const p=pred(),c=child();
 return [
  ['create from unbound legacy UNKNOWN',[p],[p,c],[],true],
  ['create alongside unrelated completed history',[plain,p],[plain,p,c],[],true],
  ['progress durable',[p,c],[p,{...c,status:'PROVIDER_RESULT_DURABLE'}],[],true],
  ['progress unknown',[p,c],[p,{...c,status:'UNKNOWN',recovery:{...c.recovery,unknown_at:9}}],[],true],
  ['progress complete',[p,c],[p,{...c,status:'COMPLETED',assessment_hash:'e'.repeat(64)}],[`ASM-${CHILD}`],true],
  ['unrelated change',[plain,p,c],[{...plain,status:'STALE'},p,c],[],true],
  ['drop child',[p,c],[p],[],false],
  ['drop predecessor',[p,c],[c],[],false],
  ['mutate predecessor',[p,c],[{...p,reserved_at:2},c],[],false],
  ['mutate evidence',[p,c],[p,mut(o=>{o.legacy_disposition.admission.approval_id='OTHER';})],[],false],
  ['change window',[p,c],[p,mut(o=>{o.legacy_disposition.admission.expires_at='2026-10-19T14:00:00.000Z';})],[],false],
  ['strip disposition',[p,c],[p,mut(o=>{delete o.legacy_disposition;})],[],false],
  ['retrofit onto existing operation',[p,mut(o=>{delete o.legacy_disposition;})],[p,c],[],false],
  ['status regression',[p,{...c,status:'COMPLETED',assessment_hash:'e'.repeat(64)}],[p,c],[],false],
  ['unknown regression',[p,{...c,status:'UNKNOWN',recovery:{...c.recovery,unknown_at:9}}],[p,c],[],false],
  ['second disposition',[p],[p,c,mut(o=>{o.idempotency_key=OTHER;})],[],false],
  ['late receipt sealed under predecessor identity (existing child)',[p,c],[p,c],[`ASM-${LEGACY}`],false],
  ['late receipt sealed in the same write as creation',[p],[p,c],[`ASM-${LEGACY}`],false],
  ['predecessor must be UNKNOWN',[{...p,status:'STALE'}],[{...p,status:'STALE'},c],[],false],
  ['predecessor with recovery metadata',[{...p,recovery:{generation:0,source_record_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64),unknown_at:5}}],[{...p,recovery:{generation:0,source_record_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64),unknown_at:5}},c],[],false],
  ['predecessor absent',[],[c],[],false],
  ['other unresolved operation at creation',[p,{...plain,idempotency_key:OTHER,status:'UNKNOWN',assessment_hash:undefined}],[p,{...plain,idempotency_key:OTHER,status:'UNKNOWN',assessment_hash:undefined},c],[],false],
  ['bootstrap marker grafted on child',[p],[p,mut(o=>{o.bootstrap={kind:'CURRENT_SOURCE_BOOTSTRAP'};})],[],false],
  ['child recovery generation 1',[p],[p,mut(o=>{o.recovery={...o.recovery,generation:1,predecessor_key:LEGACY,predecessor_sha256:'a'.repeat(64)};})],[],false],
  ['duplicate predecessor at creation',[p],[p,p,c],[],false],
  ['duplicate child key at creation',[p],[p,c,{...plain,idempotency_key:CHILD}],[],false],
  ['predecessor version ahead of child',[{...p,aggregate_version:2}],[{...p,aggregate_version:2},c],[],false],
  ['extra recovery predecessor hash',[p],[p,mut(o=>{o.recovery.predecessor_sha256='f'.repeat(64);})],[],false],
  ['malformed binding hashes',[p],[p,mut(o=>{o.recovery.binding_sha256='malformed';o.legacy_disposition.admission.binding_sha256='malformed';})],[],false],
  ['reservation outside admitted window',[p],[p,mut(o=>{o.reserved_at=Date.parse('2026-10-19T12:30:00.000Z');})],[],false],
  ['malformed admission timestamp',[p],[p,mut(o=>{o.legacy_disposition.admission.valid_from='2026-10-19';})],[],false],
  ['ordinary successor claiming existing UNKNOWN child',[p,{...c,status:'UNKNOWN',recovery:{...c.recovery,unknown_at:c.reserved_at+1}}],[p,{...c,status:'UNKNOWN',recovery:{...c.recovery,unknown_at:c.reserved_at+1}},{...plain,idempotency_key:OTHER,status:'RESERVED',reserved_at:c.reserved_at+120000,recovery:{generation:1,source_record_sha256:'a'.repeat(64),binding_sha256:'b'.repeat(64),predecessor_key:CHILD,predecessor_sha256:'f'.repeat(64)}}],[],false],
  ['successor claiming child across source/version changes',[p,{...c,status:'UNKNOWN',recovery:{...c.recovery,unknown_at:c.reserved_at+1}}],[p,{...c,status:'UNKNOWN',recovery:{...c.recovery,unknown_at:c.reserved_at+1}},{...plain,idempotency_key:OTHER,aggregate_version:2,status:'RESERVED',reserved_at:c.reserved_at+120000,recovery:{generation:1,source_record_sha256:'c'.repeat(64),binding_sha256:'d'.repeat(64),predecessor_key:CHILD,predecessor_sha256:'f'.repeat(64)}}],[],false],
  ['admission bound to another source',[p],[p,mut(o=>{o.legacy_disposition.admission.source_record_sha256='c'.repeat(64);})],[],false],
 ];
};
/** Application-side verdict: the preservation mirror plus the structural lineage proof (SQL cannot verify the canonical sha256; it checks window-vs-reservation arithmetic directly). */
const tsVerdict=(o:any[],n:any[],s:string[])=>{try{assertDispositionPreservation(o,n,s);assertDispositionLineage(n,s);return true;}catch{return false;}};
describe('assessment disposition guard — TypeScript mirror (always runs)',()=>{
 it.each(scenarios().map(s=>[s[0],s] as const))('mirror verdict: %s',(_name,[name,o,n,s,expected])=>{expect(tsVerdict(o,n,s),name).toBe(expected);});
});
describe.skipIf(!url)('assessment disposition guard — executed against isolated PostgreSQL',()=>{
 it('matches the expected semantics, and the TypeScript preservation mirror, for every scenario',()=>{
  const cases=scenarios(),literal=(ops:unknown,sealed:string[])=>`$j$${JSON.stringify({assessment_operations:ops,authority:{assessments:sealed.map(id=>({record:{assessment_id:id}}))}})}$j$::jsonb`;
  const script=['create schema if not exists tameion_private;',guardSql,...cases.map(([,o,n,s])=>`select tameion_private.assessment_disposition_guard(${literal(o,[])},${literal(n,s)});`)].join('\n');
  const run=spawnSync('psql',[url!,'-X','-At','-v','ON_ERROR_STOP=1'],{input:script,encoding:'utf8'});
  expect(run.status,run.stderr).toBe(0);
  const answers=run.stdout.split('\n').filter(line=>line==='t'||line==='f');
  expect(answers).toHaveLength(cases.length);
  cases.forEach(([name,o,n,s,expected],i)=>{
   expect(answers[i]==='t',`sql: ${name}`).toBe(expected);
   expect(tsVerdict(o,n,s),`ts mirror: ${name}`).toBe(answers[i]==='t');
  });
 });
});
