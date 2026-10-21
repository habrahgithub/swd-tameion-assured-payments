import {randomUUID} from 'node:crypto';
import {expect} from 'vitest';
import {controlledHarness} from './financial-fixture';
import {loadFinancialSourceAdmission} from '../../src/server/financial-source-admission';

export const manualRequest=(h:ReturnType<typeof controlledHarness>,body:unknown)=>new Request(h.request(body),{headers:{'Content-Type':'application/json','Idempotency-Key':randomUUID()}});
export async function preparedHumanApproval(h:ReturnType<typeof controlledHarness>,mode:'MANUAL_REVIEW'|'AI_ASSISTED_REVIEW'='MANUAL_REVIEW'){
 const id=h.source.source.obligation_id;
 async function review(){
  if(mode==='AI_ASSISTED_REVIEW')await h.sealCurrent();
  const state=await h.load(loadFinancialSourceAdmission(),async()=>{}),version=state.store.get('ORG-DEMO-001',id).aggregate_version;
  const response=await h.handler('review',manualRequest(h,{expected_version:version,mode,decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Synthetic exact source and intent reviewed.',evidence_ids:h.source.source.source_evidence.map(e=>e.evidence_id),finding_dispositions:[]}),id);
  expect(response.status).toBe(201);return {version,...await response.json()};
 }
 const first=await review();expect((await h.handler('preflight',h.request({obligation_id:id,expected_version:first.version}))).status).toBe(200);
 const current=await review(),approved=await h.handler('approve',h.request({expected_version:current.version,reviewed_decision_id:current.review_decision.decision_id,reviewed_decision_hash:current.review_decision_hash,reason_text:'Explicit exact synthetic intent approval.'}),id);
 expect(approved.status).toBe(200);const a=await approved.json();
 expect((await h.handler('release',h.request({expected_version:a.aggregate.aggregate_version,packet_sha256:a.packet_sha256,pae_instruction_hash:a.pae_instruction_hash,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'}),id)).status).toBe(200);
 return {id,a,body:{expected_version:a.aggregate.aggregate_version,packet_sha256:a.packet_sha256,pae_instruction_hash:a.pae_instruction_hash,confirmation:'SUBMIT EXACT TESTNET SETTLEMENT PROXY'},identity:{idempotency_key:`idem-ORG-DEMO-001-${id}-${a.aggregate.aggregate_version}`,pae_instruction_hash:a.pae_instruction_hash}};
}
