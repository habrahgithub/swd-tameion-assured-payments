import {sourceHarness,invoice} from './test-support/source-workflow-fixture';
import {validateLinkedActivation} from '../src/server/linked-instruction-activation';
import {afterEach, describe, expect, it, vi} from 'vitest';
import {controlledHarness, cleanupSyntheticFinancialFixture} from './test-support/financial-fixture';
import {loadFinancialSourceAdmission} from '../src/server/financial-source-admission';
import {projectObligationDetail} from '../src/server/obligation-read-model';

vi.unmock('../src/server/source-records');
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); cleanupSyntheticFinancialFixture(); });

describe('R1 synthetic AI-OFF route → durable snapshot → assurance → adapter → read model', () => {
  it.each(['normal', 'corrected-HOLD', 'resolved-ESCALATE','prepaid-corrected-HOLD'])('%s completes without model calls and posts once', async journey => {
    vi.stubEnv('NVIDIA_API_KEY', undefined);
    const network = vi.fn(async () => { throw new Error('Network fenced: application AI and live providers forbidden'); });
    vi.stubGlobal('fetch', network);
    const parent=sourceHarness();
    const {invoice_number,invoice_issue_date,payment_terms,due_date,...common}=invoice;
    const fields=journey.startsWith('prepaid')?{...common,kind:'PREPAID_RECHARGE',service_reference:'SYNTHETIC-RECHARGE',purpose:'Synthetic prepaid test',service_date:'2026-10-20'}:invoice;
    const entered=await parent.handler('save',parent.request({expected_revision:0,fields:{...fields,amount:journey.includes('corrected-HOLD')?'2.00':'1.00'},reason:'Synthetic R1 integrated source entry'}));
    expect(entered.status).toBe(201);
    const parentId=(await entered.json()).obligation.obligation_id;
    const humanBody=(decision:string,version:number,hash?:string)=>({expected_version:version,mode:'MANUAL_REVIEW',decision,rationale:'Synthetic current facts and scoped findings reviewed.',evidence_ids:['SYNTHETIC-EVIDENCE'],finding_dispositions:[],...(hash?{expected_review_hash:hash}:{})});
    let parentVersion=1,priorReviewHash:string|undefined;
    if(journey.includes('corrected-HOLD')){
      expect((await parent.handler('review',parent.request(humanBody('NEEDS_CORRECTION',1)),parentId)).status).toBe(201);
      expect((await parent.handler('save',parent.request({expected_revision:1,expected_version:1,fields,reason:'Correct the actual synthetic HOLD amount'}),parentId)).status).toBe(201);
      parentVersion=2;
    }
    if(journey==='resolved-ESCALATE'){
      const escalated=await parent.handler('review',parent.request(humanBody('ESCALATE',1)),parentId);expect(escalated.status).toBe(201);
      priorReviewHash=(await escalated.json()).review_decision_hash;
    }
    const parentReview=await parent.handler('review',parent.request(humanBody('ACCEPT_FOR_AUTHORIZATION',parentVersion,priorReviewHash)),parentId);expect(parentReview.status).toBe(201);
    const acceptedParent=await parentReview.json();
    const linked=await parent.handler('draft',parent.request({expected_version:parentVersion,review_decision_id:acceptedParent.review_decision.decision_id,review_decision_hash:acceptedParent.review_decision_hash}),parentId);expect(linked.status).toBe(201);
    const {instruction}=await linked.json();
    const h = controlledHarness({linkedDraft:instruction,verifyLink:async source=>validateLinkedActivation(source,parent.source,parent.snapshot(),(await parent.repository.loadExisting()).revision)});

    const id = h.source.source.obligation_id;
    // This is an authenticated production financial command factory backed by
    // the real CAS snapshot loader and real Circle adapter with an injected
    // network-fenced client. No fabricated model assessment is admitted.
    const review = () => h.handler('review' as never, h.request({expected_version: 1,
      mode: 'MANUAL_REVIEW', decision: 'ACCEPT_FOR_AUTHORIZATION',
      rationale: `Synthetic ${journey}: exact source and evidence reviewed.`,
      evidence_ids: h.source.source.source_evidence.map(e => e.evidence_id),
      finding_dispositions: [],
    }), id);
    const reviewed = await review();
    expect(reviewed.status, 'Manual review must be available before the first AI attempt').toBe(201);
    const first = await reviewed.json();
    expect(first.review_decision).toMatchObject({provenance: 'HUMAN', decision: 'ACCEPT_FOR_AUTHORIZATION'});
    expect(h.snapshot().authority.assessments).toEqual([]);
    const preflight = await h.handler('preflight', h.request({obligation_id:id, expected_version:1}));
    expect(preflight.status).toBe(200);
    const state = await h.load(loadFinancialSourceAdmission(), async()=>{});
    const aggregate = state.store.get('ORG-DEMO-001', id);
    const currentReview = await h.handler('review' as never, new Request(h.request({expected_version:aggregate.aggregate_version,
      mode:'MANUAL_REVIEW',decision:'ACCEPT_FOR_AUTHORIZATION',rationale:'Exact prepared synthetic payment reviewed.',
      evidence_ids:h.source.source.source_evidence.map(e=>e.evidence_id),finding_dispositions:[]}),{headers:{'Content-Type':'application/json','Idempotency-Key':'00000000-0000-4000-8000-000000000002'}}),id);
    expect(currentReview.status).toBe(201);
    const {review_decision:decision, review_decision_hash:hash} = await currentReview.json();
    const approved = await h.handler('approve',h.request({expected_version:aggregate.aggregate_version,
      reviewed_decision_id:decision.decision_id,reviewed_decision_hash:hash,reason_text:'Authorize the exact synthetic controlled instruction.'}),id);
    expect(approved.status).toBe(200);
    const a = await approved.json();
    vi.stubEnv('J2A_EXECUTION_AUTHORIZED_PACKET_SHA256',a.packet_sha256);
    const body={expected_version:a.aggregate.aggregate_version,packet_sha256:a.packet_sha256,pae_instruction_hash:a.pae_instruction_hash};
    expect((await h.handler('release',h.request({...body,confirmation:'APPROVE EXACT TESTNET SETTLEMENT PROXY'}),id)).status).toBe(200);
    expect((await h.handler('execute',h.request({...body,confirmation:'SUBMIT EXACT TESTNET SETTLEMENT PROXY'}),id)).status).toBe(200);
    const record=h.snapshot().execution_ledger[0]!;
    expect((await h.handler('reconcile',h.request({idempotency_key:record.idempotency_key,pae_instruction_hash:a.pae_instruction_hash}),id)).status).toBe(200);
    const restored=await h.load(loadFinancialSourceAdmission(),async()=>{});
    const projection=await projectObligationDetail(restored,id,true).json();
    expect(projection.aggregate.state).toBe('RECONCILED');
    expect(h.snapshot().execution_ledger.filter(r=>r.status==='SETTLED')).toHaveLength(1);
    expect(h.snapshot().authority.settlement_postings).toHaveLength(1);
    expect((await h.handler('reconcile',h.request({idempotency_key:record.idempotency_key,pae_instruction_hash:a.pae_instruction_hash}),id)).status).toBe(200);
    expect((await h.load(loadFinancialSourceAdmission(),async()=>{})).exportSnapshot().authority.settlement_postings).toHaveLength(1);
    expect(h.client.createTransaction).toHaveBeenCalledOnce();
    expect(network).not.toHaveBeenCalled();
    expect(h.snapshot().authority.assessments).toEqual([]);
    expect(parent.snapshot().execution_ledger).toEqual([]);
    expect(parent.snapshot().authority.aggregates[0].state).toBe('APPROVAL_PENDING');
    expect(parent.snapshot().source_revisions?.at(-1)?.fields.amount).toBe('1.00');
    expect(parent.snapshot().authority.assessments).toEqual([]);
  });
});
