import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
// Source-contract checks only. This suite never parses or executes SQL.
const sql=readFileSync(resolve(import.meta.dirname,'../supabase/migrations/20261013085427_operator_read_only_access.sql'),'utf8');
const finish=sql.split('CREATE FUNCTION public.tameion_operator_login_finish(')[1].split('CREATE FUNCTION public.tameion_operator_session_validate')[0];
const deny=finish.match(/IF p_verified IS NOT TRUE[\s\S]*?END IF;/)?.[0]??'';
describe('login finish SQL source contract (not SQL runtime proof)',()=>{
 it('explicitly denies NULL expected credential version before any session insert',()=>{
  expect(deny).toContain('p_expected_credential_version IS NULL');
  expect(deny).toContain("RETURN jsonb_build_object('accepted',false)");
 });
 it('explicitly denies zero and negative expected credential versions',()=>{
  expect(deny).toMatch(/p_expected_credential_version\s*<=\s*0/);
 });
 it('denies mismatched positive versions with a NULL-safe comparison',()=>{
  expect(deny).toContain('v.credential_version IS DISTINCT FROM p_expected_credential_version');
  expect(deny).not.toContain('v.credential_version<>p_expected_credential_version');
 });
 it('retains typed versions, consume-before-denial order and valid session mint behavior',()=>{
  expect(finish).toContain('p_expected_credential_version bigint');
  expect(finish.indexOf('UPDATE tameion_private.login_attempts SET consumed_at=')).toBeLessThan(finish.indexOf('IF p_verified IS NOT TRUE'));
  expect(finish.indexOf('IF p_verified IS NOT TRUE')).toBeLessThan(finish.indexOf('INSERT INTO tameion_private.operator_sessions'));
  expect(deny).toContain('a.credential_version<>v.credential_version');
  expect(finish).toContain("n+interval '60 minutes'");
  expect(finish).toContain("RETURN jsonb_build_object('accepted',true,'expires_at',n+interval '60 minutes')");
 });
});
