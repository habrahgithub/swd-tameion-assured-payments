import { NextResponse } from "next/server";

import { buildFinanceAgentContext } from "../../../../../src/agent/context-builder";
import { DeterministicFallbackProvider, NvidiaProvider } from "../../../../../src/agent/ai-provider";
import { assessObligation, wasProviderCallFailure } from "../../../../../src/agent/finance-agent";
import {
  DEMO_ORGANIZATION_ID,
  getDemoState,
  type AssessmentOperation,
  type DemoState,
} from "../../../../../src/server/demo-state";
import { DemoStateConflictError } from "../../../../../src/server/supabase-demo-state-repository";
import type { DurableAssessmentRecord } from "../../../../../src/domain/schemas";

const MAX_PERSISTENCE_ATTEMPTS = 4;
const ASSESSMENT_CONFLICT_MESSAGE =
  "Assessment state changed while this request was running. The assessment was not made current; reload the obligation before starting a new assessment.";

type AssessmentResponse = {
  decision: {
    obligation_id: string;
    decision: DurableAssessmentRecord["decision"];
    reasons: string[];
    evidence_ids: string[];
    missing_evidence: string[];
    uncertainty_signal: boolean;
  };
  provider_used: string;
  provider_mode: DurableAssessmentRecord["provider_mode"];
  assessment_hash: string;
};

function isIdempotencyKey(value: string | null): value is string {
  return value !== null && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
}

function responseFor(state: DemoState, operation: AssessmentOperation): AssessmentResponse | null {
  if (!operation.assessment_hash) return null;
  const sealed = state.store.getAssessmentHistory(DEMO_ORGANIZATION_ID, operation.obligation_id)
    .find((assessment) => assessment.hash === operation.assessment_hash);
  if (!sealed) throw new Error("Completed assessment operation is missing its sealed assessment.");
  const { record } = sealed;
  return {
    decision: {
      obligation_id: record.obligation_id,
      decision: record.decision,
      reasons: record.reasons,
      evidence_ids: record.evidence_ids,
      missing_evidence: record.missing_evidence,
      uncertainty_signal: record.uncertainty_signal,
    },
    provider_used: record.provider_name,
    provider_mode: record.provider_mode,
    assessment_hash: sealed.hash,
  };
}

function existingOperationResponse(state: DemoState, operation: AssessmentOperation) {
  const current = state.store.get(DEMO_ORGANIZATION_ID, operation.obligation_id);
  if (operation.status === "STALE" || current.aggregate_version !== operation.aggregate_version) {
    return NextResponse.json({ error: ASSESSMENT_CONFLICT_MESSAGE, code: "ASM-001" }, { status: 409 });
  }
  if (operation.status === "COMPLETED") {
    const response = responseFor(state, operation);
    if (!response) throw new Error("Completed assessment operation has no response.");
    return NextResponse.json(response);
  }
  return NextResponse.json(
    { status: "IN_PROGRESS", message: "This assessment request is already reserved. Its provider result will not be requested again." },
    { status: 202 },
  );
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!isIdempotencyKey(idempotencyKey)) {
    return NextResponse.json({ error: "A valid Idempotency-Key UUID is required for assessment." }, { status: 400 });
  }

  let state: DemoState | undefined;
  let aggregateVersion: number | undefined;
  let reserved = false;
  for (let attempt = 0; attempt < MAX_PERSISTENCE_ATTEMPTS; attempt += 1) {
    state = await getDemoState();
    const record = state.getRecord(id);
    if (!record) return NextResponse.json({ error: `Unknown obligation ${id}` }, { status: 404 });

    const existing = state.getAssessmentOperation(idempotencyKey);
    if (existing) {
      if (existing.obligation_id !== id) {
        return NextResponse.json({ error: "Idempotency key is already bound to a different assessment request.", code: "ASM-002" }, { status: 400 });
      }
      return existingOperationResponse(state, existing);
    }

    aggregateVersion = state.store.get(DEMO_ORGANIZATION_ID, id).aggregate_version;
    state.reserveAssessmentOperation(idempotencyKey, id, aggregateVersion);
    try {
      await state.flush();
      reserved = true;
      break;
    } catch (error) {
      if (!(error instanceof DemoStateConflictError)) throw error;
    }
  }
  if (!reserved || !state || aggregateVersion === undefined) {
    const latestState = await getDemoState();
    const latestOperation = latestState.getAssessmentOperation(idempotencyKey);
    if (latestOperation) {
      if (latestOperation.obligation_id !== id) {
        return NextResponse.json({ error: "Idempotency key is already bound to a different assessment request.", code: "ASM-002" }, { status: 400 });
      }
      return existingOperationResponse(latestState, latestOperation);
    }
    return NextResponse.json(
      { error: "The assessment could not be reserved because durable state kept changing. No provider call was made; retry with the same Idempotency-Key.", code: "ASM-RESERVATION-RETRY" },
      { status: 503 },
    );
  }

  const record = state.getRecord(id)!;
  const isLiveNvidia = Boolean(process.env.NVIDIA_API_KEY);
  const provider = isLiveNvidia ? new NvidiaProvider() : new DeterministicFallbackProvider();
  const decision = await assessObligation(buildFinanceAgentContext(record), provider);
  const providerMode: DurableAssessmentRecord["provider_mode"] = !isLiveNvidia
    ? "NOT_LIVE_AI"
    : wasProviderCallFailure(decision)
      ? "BLOCKED_EXTERNAL"
      : "LIVE_AI";
  const assessmentRecord: DurableAssessmentRecord = {
    assessment_id: `ASM-${idempotencyKey}`,
    organization_id: DEMO_ORGANIZATION_ID,
    obligation_id: id,
    aggregate_version: String(aggregateVersion),
    decision: decision.decision,
    reasons: decision.reasons,
    evidence_ids: decision.evidence_ids,
    missing_evidence: decision.missing_evidence,
    uncertainty_signal: decision.uncertainty_signal,
    provider_name: provider.name,
    provider_mode: providerMode,
    assessed_at: new Date().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z"),
  };

  for (let attempt = 0; attempt < MAX_PERSISTENCE_ATTEMPTS; attempt += 1) {
    const operation = state.getAssessmentOperation(idempotencyKey);
    if (!operation) throw new Error("Reserved assessment operation disappeared before persistence.");
    if (operation.status === "COMPLETED") return existingOperationResponse(state, operation);
    if (operation.status === "STALE") return existingOperationResponse(state, operation);

    state.completeAssessmentOperation(idempotencyKey, assessmentRecord);
    try {
      await state.flush();
      const completed = state.getAssessmentOperation(idempotencyKey)!;
      if (completed.status === "STALE") return existingOperationResponse(state, completed);
      const response = responseFor(state, completed);
      if (!response) throw new Error("Assessment persistence completed without a sealed result.");
      return NextResponse.json(response);
    } catch (error) {
      if (!(error instanceof DemoStateConflictError)) throw error;
      state = await getDemoState();
    }
  }
  const latestState = await getDemoState();
  const latestOperation = latestState.getAssessmentOperation(idempotencyKey);
  if (latestOperation) return existingOperationResponse(latestState, latestOperation);
  return NextResponse.json(
    { error: "The provider result was obtained, but durable persistence is still pending. This operation remains reserved and will not call the provider again; resolve its pending status before starting a new assessment.", code: "ASM-PERSISTENCE-PENDING" },
    { status: 202 },
  );
}
