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

export const maxDuration = 30;

const MAX_PERSISTENCE_ATTEMPTS = 4;
const RESERVED_OPERATION_TIMEOUT_MS = 25_000;
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
  if (operation.status === "UNKNOWN") {
    return NextResponse.json(
      { status: "UNKNOWN", error: "Provider completion is ambiguous. This operation will not be retried automatically.", code: "ASM-UNKNOWN" },
      { status: 409 },
    );
  }
  if (operation.status === "PROVIDER_RESULT_DURABLE") {
    return NextResponse.json({ status: "RECOVERY_PENDING", message: "The durable provider result is being sealed; retry this same Idempotency-Key to recover it." }, { status: 202 });
  }
  return NextResponse.json(
    { status: "IN_PROGRESS", message: "This assessment is reserved. Replays will not submit a second provider request." },
    { status: 202 },
  );
}

async function markUnknownAndReply(state: DemoState, idempotencyKey: string) {
  for (let attempt = 0; attempt < MAX_PERSISTENCE_ATTEMPTS; attempt += 1) {
    const operation = state.getAssessmentOperation(idempotencyKey);
    if (!operation || operation.status !== "RESERVED") break;
    state.markAssessmentUnknown(idempotencyKey);
    try {
      await state.flush();
      break;
    } catch (error) {
      if (!(error instanceof DemoStateConflictError)) throw error;
      state = await getDemoState();
    }
  }
  const latest = await getDemoState();
  const operation = latest.getAssessmentOperation(idempotencyKey);
  if (!operation) return NextResponse.json({ error: "Assessment reservation could not be resolved durably.", code: "ASM-PERSISTENCE-UNKNOWN" }, { status: 503 });
  return existingOperationResponse(latest, operation);
}

async function sealDurableProviderResult(idempotencyKey: string, initialState: DemoState) {
  let state = initialState;
  for (let attempt = 0; attempt < MAX_PERSISTENCE_ATTEMPTS; attempt += 1) {
    const operation = state.getAssessmentOperation(idempotencyKey);
    if (!operation) break;
    if (operation.status !== "PROVIDER_RESULT_DURABLE") return existingOperationResponse(state, operation);
    state.completeAssessmentOperation(idempotencyKey);
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
  const latest = await getDemoState();
  const operation = latest.getAssessmentOperation(idempotencyKey);
  return operation
    ? existingOperationResponse(latest, operation)
    : NextResponse.json({ error: "Durable assessment operation disappeared during recovery.", code: "ASM-RECOVERY-FAILED" }, { status: 503 });
}

async function persistProviderResult(idempotencyKey: string, assessment: DurableAssessmentRecord, initialState: DemoState) {
  let state = initialState;
  for (let attempt = 0; attempt < MAX_PERSISTENCE_ATTEMPTS; attempt += 1) {
    const operation = state.getAssessmentOperation(idempotencyKey);
    if (!operation) break;
    if (operation.status === "STALE") return existingOperationResponse(state, operation);
    if (operation.status === "PROVIDER_RESULT_DURABLE") return sealDurableProviderResult(idempotencyKey, state);
    if (operation.status !== "RESERVED") return existingOperationResponse(state, operation);
    state.checkpointAssessmentResult(idempotencyKey, assessment);
    const checkpointed = state.getAssessmentOperation(idempotencyKey)!;
    if (checkpointed.status === "STALE") return existingOperationResponse(state, checkpointed);
    try {
      await state.flush();
      return sealDurableProviderResult(idempotencyKey, state);
    } catch (error) {
      if (!(error instanceof DemoStateConflictError)) throw error;
      state = await getDemoState();
    }
  }
  return markUnknownAndReply(state, idempotencyKey);
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
      if (existing.status === "RESERVED" && Date.now() - (existing.reserved_at ?? 0) > RESERVED_OPERATION_TIMEOUT_MS) {
        return markUnknownAndReply(state, idempotencyKey);
      }
      if (existing.status === "PROVIDER_RESULT_DURABLE") return sealDurableProviderResult(idempotencyKey, state);
      return existingOperationResponse(state, existing);
    }

    aggregateVersion = state.store.get(DEMO_ORGANIZATION_ID, id).aggregate_version;
    const unresolved = state.findUnresolvedAssessmentOperation(id, aggregateVersion);
    if (unresolved) {
      return NextResponse.json(
        { error: "An assessment operation for this obligation and aggregate version is unresolved. Use its original Idempotency-Key; a new provider request is blocked.", code: "ASM-OPERATION-UNRESOLVED", operation_status: unresolved.status },
        { status: 409 },
      );
    }
    try {
      state.reserveAssessmentOperation(idempotencyKey, id, aggregateVersion);
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
      return latestOperation.status === "PROVIDER_RESULT_DURABLE"
        ? sealDurableProviderResult(idempotencyKey, latestState)
        : existingOperationResponse(latestState, latestOperation);
    }
    const unresolved = latestState.findUnresolvedAssessmentOperation(id, latestState.store.get(DEMO_ORGANIZATION_ID, id).aggregate_version);
    if (unresolved) return NextResponse.json({ error: "Another assessment operation is unresolved for this obligation and aggregate version.", code: "ASM-OPERATION-UNRESOLVED" }, { status: 409 });
    return NextResponse.json(
      { error: "The assessment could not be reserved because durable state kept changing. No provider call was made; retry with the same Idempotency-Key.", code: "ASM-RESERVATION-RETRY" },
      { status: 503 },
    );
  }

  const record = state.getRecord(id)!;
  const isLiveNvidia = Boolean(process.env.NVIDIA_API_KEY);
  const provider = isLiveNvidia ? new NvidiaProvider() : new DeterministicFallbackProvider();
  const decision = await assessObligation(buildFinanceAgentContext(record), provider);
  if (isLiveNvidia && wasProviderCallFailure(decision)) return markUnknownAndReply(state, idempotencyKey);

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
    provider_mode: !isLiveNvidia ? "NOT_LIVE_AI" : "LIVE_AI",
    assessed_at: new Date().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z"),
  };

  return persistProviderResult(idempotencyKey, assessmentRecord, state);
}
