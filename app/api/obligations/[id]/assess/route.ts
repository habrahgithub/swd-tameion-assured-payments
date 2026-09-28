import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { buildFinanceAgentContext } from "../../../../../src/agent/context-builder";
import { DeterministicFallbackProvider, NvidiaProvider } from "../../../../../src/agent/ai-provider";
import { assessObligation } from "../../../../../src/agent/finance-agent";
import { DEMO_ORGANIZATION_ID, getDemoState } from "../../../../../src/server/demo-state";
import type { DurableAssessmentRecord } from "../../../../../src/domain/schemas";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = getDemoState();
  const record = state.getRecord(id);
  if (!record) {
    return NextResponse.json({ error: `Unknown obligation ${id}` }, { status: 404 });
  }

  const isLiveNvidia = Boolean(process.env.NVIDIA_API_KEY);
  const provider = isLiveNvidia ? new NvidiaProvider() : new DeterministicFallbackProvider();
  const context_ = buildFinanceAgentContext(record);
  const decision = await assessObligation(context_, provider);

  // Seal the decision as an immutable, hash-addressable artifact bound to
  // the obligation's current aggregate_version — this, not any mutable
  // in-memory flag, is what POST /approve gates on. Deterministic/fallback
  // reasoning is always recorded NOT_LIVE_AI so a sealed assessment can
  // never later be mistaken for real model output, even if NVIDIA_API_KEY
  // is present but the call itself failed closed to the fallback path.
  const aggregate = state.store.get(DEMO_ORGANIZATION_ID, id);
  const assessmentRecord: DurableAssessmentRecord = {
    assessment_id: `ASM-${randomUUID()}`,
    organization_id: DEMO_ORGANIZATION_ID,
    obligation_id: id,
    aggregate_version: String(aggregate.aggregate_version),
    decision: decision.decision,
    reasons: decision.reasons,
    evidence_ids: decision.evidence_ids,
    missing_evidence: decision.missing_evidence,
    uncertainty_signal: decision.uncertainty_signal,
    provider_name: provider.name,
    provider_mode: isLiveNvidia ? "LIVE_AI" : "NOT_LIVE_AI",
    assessed_at: new Date().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z"),
  };
  const { assessment_hash } = state.store.sealAssessment(assessmentRecord);

  return NextResponse.json({ decision, provider_used: provider.name, assessment_hash });
}
