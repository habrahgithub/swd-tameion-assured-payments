import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {sealLinkedInstruction,parseLinkedInstructions,assertLinkedHistoryAppend} from '../src/domain/linked-instruction';
import {DemoState,parseDemoStateSnapshot} from '../src/server/demo-state';
function draft(suffix:string,key:string){return sealLinkedInstruction({schema_version:1,kind:'ARC_TESTNET_SETTLEMENT_INSTRUCTION',status:'DRAFT_AUTHORITY_REQUIRED',organization_id:'ORG-DEMO-001',source_obligation_id:'FICTIONAL-SOURCE',source_record_sha256:'a'.repeat(64),source_aggregate_version:1,assessment_id:'FICTIONAL-ASM',assessment_hash:'b'.repeat(64),instruction_id:`TESTNET-CONTROLLED-LINKED-${suffix.repeat(32)}`,attempt_id:key,source_amount:'1.00',source_currency:'USD',network:'ARC_TESTNET',classification:'TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT',created_at:'2026-10-14T00:00:00.000Z'});}
describe('append-only linked instruction persistence',()=>{
 const a=draft('a','c23a9d3a-39a1-4f36-9556-04f523969ab1'),b=draft('b','c23a9d3a-39a1-4f36-9556-04f523969ab2');
 it('preserves pre-link compatibility and accepts only append or identical replay',()=>{expect(()=>assertLinkedHistoryAppend(undefined,undefined)).not.toThrow();expect(()=>assertLinkedHistoryAppend(undefined,[a])).not.toThrow();expect(()=>assertLinkedHistoryAppend([a],[a,b])).not.toThrow();expect(()=>assertLinkedHistoryAppend([a],[a])).not.toThrow();});
 it('rejects old-writer removal, truncation, rewritten prefix, reordering and duplicate identities',()=>{for(const value of [undefined,[],[b],[b,a],[a,a]])expect(()=>assertLinkedHistoryAppend([a,b],value)).toThrow();expect(()=>parseLinkedInstructions([{...a,schema_version:2}])).toThrow();expect(()=>parseLinkedInstructions([{...a,amount:'100'}])).toThrow();});
 it('roundtrips exact linked history through production parse, restore and unrelated export',()=>{const incoming={...new DemoState().exportSnapshot(),linked_settlement_instructions:[a,b]};const parsed=parseDemoStateSnapshot(incoming);expect(parsed.linked_settlement_instructions).toEqual([a,b]);const restored=new DemoState(parsed);expect(restored.exportSnapshot().linked_settlement_instructions).toEqual([a,b]);expect(()=>parseDemoStateSnapshot({...incoming,schema_version:3})).toThrow();});
 it('adds only the new CAS guard and retains prior assessment/authorization/execution SQL byte-for-byte',()=>{
  const old=readFileSync('supabase/migrations/20260928174320_tameion_authorization_execution_history.sql','utf8');const migration=readFileSync('supabase/migrations/20261014230000_linked_instruction_history_guard.sql','utf8');
  const previous=old.slice(old.indexOf('create or replace function public.tameion_state_compare_and_set('));
  const restored=migration.slice(migration.indexOf('create or replace function')).replace('  v_old_links jsonb;\n  v_new_links jsonb;\n  v_link_count integer;\n  v_field text;\n','');
  const start=restored.indexOf('  -- Once linked history exists'),end=restored.indexOf('  v_old_assessments :=',start);
  expect(restored.slice(0,start)+restored.slice(end)).toBe(previous);
  expect(migration).toContain('where ordinal<=v_link_count');expect(migration).toContain('v_prefix is distinct from v_old_links');expect(migration).toContain("'linked_settlement_instructions','[]'::jsonb");
  expect(migration).not.toMatch(/create\s+table|drop\s+|delete\s+from|truncate\s+/i);
 });
});
