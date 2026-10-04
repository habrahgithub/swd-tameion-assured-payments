import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { NvidiaProvider } from "../../../../../../src/agent/ai-provider";
import { assessObligation, wasProviderCallFailure } from "../../../../../../src/agent/finance-agent";
import { buildFinanceAgentContext, type LiveUsageObligationRecord } from "../../../../../../src/agent/context-builder";
import type { DurableAssessmentRecord } from "../../../../../../src/domain/schemas";
import { getJ2aRealTestnetDemoState } from "../../../../../../src/server/demo-state";
import { buildJ2aDemoObligation } from "../../../../../../src/demo/real-testnet-payment";

export const maxDuration = 65;

export async function POST(request: Request) {
  const state = await getJ2aRealTestnetDemoState();
  const preflight = state.lastPreflight;
  if (!preflight || preflight.readiness !== "READY") {
    return NextResponse.json({ error: "A fresh READY read-only Circle preflight is required before assessment." }, { status: 409 });
  }
  const body = await request.json().catch(() => ({})) as { expected_version?: unknown };
  const current = state.store.get(preflight.organization_id, preflight.obligation_id);
  if (!Number.isSafeInteger(body.expected_version) || body.expected_version !== current.aggregate_version || current.evidence_hashes[0] !== preflight.evidence_sha256) {
    return NextResponse.json({ error: "The demo aggregate or provider evidence changed; refresh and retry assessment." }, { status: 409 });
  }
  const provider = new NvidiaProvider();
  const demoObligation = buildJ2aDemoObligation(preflight);
  const record: LiveUsageObligationRecord = {
    obligation_id: preflight.obligation_id,
    service_category: demoObligation.classification,
    recurrence: "ONE_TIME",
    due_date: demoObligation.effective_due_date,
    due_date_status: "STATED_ON_SOURCE",
    amount: "5.00",
    currency: "USD",
    state_at_event_baseline: "OUTSTANDING",
    business_purpose_confirmed: true,
    commercial_terms: `Synthetic invoice date ${demoObligation.invoice_date}; effective due date ${demoObligation.effective_due_date}; payment basis ${demoObligation.payment_basis}. Non-economic Arc Testnet demonstration to the controlled Tameion Test Counterparty; this is not a vendor payment.`,
    source_evidence: [{ evidence_id: demoObligation.source_evidence_id }],
    candidate_readiness: { arc_product_destination_status: "CURRENT_TESTNET_DEMO_EVIDENCE" },
  };
  const decision = await assessObligation(buildFinanceAgentContext(record, current.aggregate_version, preflight.captured_at.slice(0, 10), {
    destination_status: "READY",
    source: "CURRENT_PRODUCT_TRUST_EVIDENCE",
  }), provider);
  if (wasProviderCallFailure(decision)) {
    return NextResponse.json({ error: "LIVE NVIDIA assessment is unavailable; no assessment was sealed.", decision: "HOLD" }, { status: 503 });
  }
  const runtime = provider.runtimeIdentity;
  if (!runtime) return NextResponse.json({ error: "LIVE NVIDIA runtime identity is unavailable." }, { status: 503 });
  const assessmentIdempotencyKey = randomUUID();
  const assessment: DurableAssessmentRecord = {
    assessment_id: `ASM-${assessmentIdempotencyKey}`,
    organization_id: preflight.organization_id,
    obligation_id: preflight.obligation_id,
    aggregate_version: String(current.aggregate_version),
    decision: decision.decision,
    reasons: decision.reasons,
    evidence_ids: decision.evidence_ids,
    missing_evidence: decision.missing_evidence,
    uncertainty_signal: decision.uncertainty_signal,
    race: decision.race,
    provider_name: runtime.provider_name,
    model_id: runtime.model_id,
    model_config_version: runtime.model_config_version,
    runtime_config_sha256: runtime.runtime_config_sha256,
    provider_mode: "LIVE_AI",
    assessed_at: new Date().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z"),
  };
  const sealed = state.store.sealAssessment(assessment);
  await state.flush();
  return NextResponse.json({
    assessment_id: assessment.assessment_id,
    aggregate_version: assessment.aggregate_version,
    decision: assessment.decision,
    reasons: assessment.reasons,
    validated_findings: assessment.race?.result.validated_findings ?? [],
    missing_evidence: assessment.missing_evidence,
    provider_mode: assessment.provider_mode,
    provider_name: assessment.provider_name,
    model_id: assessment.model_id,
    assessment_hash: sealed.assessment_hash,
    classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
  });
}
