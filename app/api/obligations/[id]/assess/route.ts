import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { buildFinanceAgentContext } from "../../../../../src/agent/context-builder";
import { DeterministicFallbackProvider, NvidiaProvider } from "../../../../../src/agent/ai-provider";
import { assessObligation, wasProviderCallFailure } from "../../../../../src/agent/finance-agent";
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

  // Three real, distinguishable runtime states — never presented as a
  // confidence score, since the real schema has no such field:
  //   NOT_LIVE_AI     — no NVIDIA_API_KEY; DeterministicFallbackProvider ran.
  //   BLOCKED_EXTERNAL — NVIDIA_API_KEY present, but the live call itself
  //                      failed (e.g. auth) before any model reasoning
  //                      happened; the HOLD below is a fail-closed default,
  //                      not a model decision.
  //   LIVE_AI         — NVIDIA_API_KEY present and the call actually
  //                      returned parseable model output.
  let providerMode: "LIVE_AI" | "NOT_LIVE_AI" | "BLOCKED_EXTERNAL";
  if (!isLiveNvidia) {
    providerMode = "NOT_LIVE_AI";
  } else if (wasProviderCallFailure(decision)) {
    providerMode = "BLOCKED_EXTERNAL";
  } else {
    providerMode = "LIVE_AI";
  }

  // Seal the decision as an immutable, hash-addressable artifact bound to
  // the obligation's current aggregate_version — this, not any mutable
  // in-memory flag, is what POST /approve gates on.
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
    provider_mode: providerMode,
    assessed_at: new Date().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z"),
  };
  const { assessment_hash } = state.store.sealAssessment(assessmentRecord);

  return NextResponse.json({ decision, provider_used: provider.name, provider_mode: providerMode, assessment_hash });
}
