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
import { hasCurrentProductTrustEvidence } from "../../../../../src/authority/aggregate";
import type { DurableAssessmentRecord } from "../../../../../src/domain/schemas";

export const maxDuration = 65;

const MAX_PERSISTENCE_ATTEMPTS = 4;
const RESERVED_OPERATION_TIMEOUT_MS = 70_000;
const ASSESSMENT_CONFLICT_MESSAGE =
  "Assessment state changed while this request was running. The assessment was not made current; reload the obligation before starting a new assessment.";

function reservationExpired(operation: AssessmentOperation): boolean {
  return operation.status === "RESERVED" && Date.now() - (operation.reserved_at ?? 0) > RESERVED_OPERATION_TIMEOUT_MS;
}

type AssessmentResponse = {
  assessment_id: string;
  aggregate_version: string;
  decision: {
    obligation_id: string;
    decision: DurableAssessmentRecord["decision"];
    reasons: string[];
    evidence_ids: string[];
    missing_evidence: string[];
    uncertainty_signal: boolean;
  };
  race?: DurableAssessmentRecord["race"];
  provider_used: string;
  provider_mode: DurableAssessmentRecord["provider_mode"];
  model_id?: string;
  model_config_version?: string;
  runtime_config_sha256?: string;
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
    assessment_id: record.assessment_id,
    aggregate_version: record.aggregate_version,
    decision: {
      obligation_id: record.obligation_id,
      decision: record.decision,
      reasons: record.reasons,
      evidence_ids: record.evidence_ids,
      missing_evidence: record.missing_evidence,
      uncertainty_signal: record.uncertainty_signal,
    },
    ...(record.race ? { race: record.race } : {}),
    provider_used: record.provider_name,
    provider_mode: record.provider_mode,
    ...(record.model_id ? { model_id: record.model_id } : {}),
    ...(record.model_config_version ? { model_config_version: record.model_config_version } : {}),
    ...(record.runtime_config_sha256 ? { runtime_config_sha256: record.runtime_config_sha256 } : {}),
    assessment_hash: sealed.hash,
  };
}

function existingOperationResponse(state: DemoState, operation: AssessmentOperation) {
  if (operation.status === "UNKNOWN") {
    return NextResponse.json(
      { status: "UNKNOWN", idempotency_key: operation.idempotency_key, error: "Provider completion is ambiguous. This operation will not be retried automatically.", code: "ASM-UNKNOWN" },
      { status: 409 },
    );
  }
  const current = state.store.get(DEMO_ORGANIZATION_ID, operation.obligation_id);
  if (operation.status === "STALE" || current.aggregate_version !== operation.aggregate_version) {
    return NextResponse.json({ error: ASSESSMENT_CONFLICT_MESSAGE, code: "ASM-001" }, { status: 409 });
  }
  if (operation.status === "COMPLETED") {
    const response = responseFor(state, operation);
    if (!response) throw new Error("Completed assessment operation has no response.");
    return NextResponse.json(response);
  }
  if (operation.status === "PROVIDER_RESULT_DURABLE") {
    return NextResponse.json({ status: "RECOVERY_PENDING", idempotency_key: operation.idempotency_key, message: "The durable provider result is being sealed; retry this same Idempotency-Key to recover it." }, { status: 202 });
  }
  return NextResponse.json(
    { status: "IN_PROGRESS", idempotency_key: operation.idempotency_key, message: "This assessment is reserved. Replays will not submit a second provider request." },
    { status: 202 },
  );
}

function persistenceUnknownResponse(idempotencyKey: string) {
  return NextResponse.json(
    {
      status: "UNKNOWN",
      idempotency_key: idempotencyKey,
      error: "The assessment result was not made current, and its terminal persistence state could not be established. Do not start a new provider request; replaying this same key will never submit a second provider request.",
      code: "ASM-PERSISTENCE-UNKNOWN",
    },
    { status: 503 },
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
    if (operation.status !== "PROVIDER_RESULT_DURABLE" && operation.status !== "STALE") return existingOperationResponse(state, operation);
    const completed = operation.status === "STALE" ? operation : state.completeAssessmentOperation(idempotencyKey);
    try {
      await state.flush();
      if (completed.status === "STALE") return existingOperationResponse(state, completed);
      const persisted = state.getAssessmentOperation(idempotencyKey)!;
      const response = responseFor(state, persisted);
      if (!response) throw new Error("Assessment persistence completed without a sealed result.");
      return NextResponse.json(response);
    } catch (error) {
      if (!(error instanceof DemoStateConflictError)) throw error;
      state = await getDemoState();
    }
  }
  const latest = await getDemoState();
  const latestOperation = latest.getAssessmentOperation(idempotencyKey);
  if (latestOperation?.status === "PROVIDER_RESULT_DURABLE" &&
      latest.store.get(DEMO_ORGANIZATION_ID, latestOperation.obligation_id).aggregate_version === latestOperation.aggregate_version) {
    return existingOperationResponse(latest, latestOperation);
  }
  return persistenceUnknownResponse(idempotencyKey);
}

async function persistProviderResult(idempotencyKey: string, assessment: DurableAssessmentRecord, initialState: DemoState) {
  let state = initialState;
  for (let attempt = 0; attempt < MAX_PERSISTENCE_ATTEMPTS; attempt += 1) {
    const operation = state.getAssessmentOperation(idempotencyKey);
    if (!operation) break;
    if (operation.status === "STALE") {
      try {
        await state.flush();
        return existingOperationResponse(state, operation);
      } catch (error) {
        if (!(error instanceof DemoStateConflictError)) throw error;
        state = await getDemoState();
        continue;
      }
    }
    if (operation.status === "PROVIDER_RESULT_DURABLE") return sealDurableProviderResult(idempotencyKey, state);
    if (operation.status !== "RESERVED") return existingOperationResponse(state, operation);
    state.checkpointAssessmentResult(idempotencyKey, assessment);
    const checkpointed = state.getAssessmentOperation(idempotencyKey)!;
    try {
      await state.flush();
      if (checkpointed.status === "STALE") return existingOperationResponse(state, checkpointed);
      return sealDurableProviderResult(idempotencyKey, state);
    } catch (error) {
      if (!(error instanceof DemoStateConflictError)) throw error;
      state = await getDemoState();
    }
  }
  return persistenceUnknownResponse(idempotencyKey);
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
      if (reservationExpired(existing)) {
        return markUnknownAndReply(state, idempotencyKey);
      }
      if (existing.status === "PROVIDER_RESULT_DURABLE") return sealDurableProviderResult(idempotencyKey, state);
      return existingOperationResponse(state, existing);
    }

    aggregateVersion = state.store.get(DEMO_ORGANIZATION_ID, id).aggregate_version;
    const expiredReservation = state.findUnresolvedAssessmentOperations(id).find(reservationExpired);
    if (expiredReservation) return markUnknownAndReply(state, expiredReservation.idempotency_key);
    const unresolved = state.findUnresolvedAssessmentOperation(id, aggregateVersion);
    if (unresolved) {
      if (reservationExpired(unresolved)) return markUnknownAndReply(state, unresolved.idempotency_key);
      return NextResponse.json(
        { error: "An assessment operation for this obligation and aggregate version is unresolved. Use its original Idempotency-Key; a new provider request is blocked.", code: "ASM-OPERATION-UNRESOLVED", operation_status: unresolved.status, idempotency_key: unresolved.idempotency_key },
        { status: 409 },
      );
    }
    if (state.hasLivePaeAuthority(id)) {
      return NextResponse.json({ error: "Assessment is closed after authorization or PAE creation.", code: "ASM-CLOSED-AUTHORITY" }, { status: 409 });
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
    const expiredReservation = latestState.findUnresolvedAssessmentOperations(id).find(reservationExpired);
    if (expiredReservation) return markUnknownAndReply(latestState, expiredReservation.idempotency_key);
    const unresolved = latestState.findUnresolvedAssessmentOperation(id, latestState.store.get(DEMO_ORGANIZATION_ID, id).aggregate_version);
    if (unresolved) return NextResponse.json({ error: "Another assessment operation is unresolved for this obligation and aggregate version.", code: "ASM-OPERATION-UNRESOLVED", idempotency_key: unresolved.idempotency_key }, { status: 409 });
    return NextResponse.json(
      { error: "The assessment could not be reserved because durable state kept changing. No provider call was made; retry with the same Idempotency-Key.", code: "ASM-RESERVATION-RETRY" },
      { status: 503 },
    );
  }

  const record = state.getRecord(id)!;
  const isLiveNvidia = Boolean(process.env.NVIDIA_API_KEY);
  const provider = isLiveNvidia ? new NvidiaProvider() : new DeterministicFallbackProvider();
  const aggregate = state.store.get(DEMO_ORGANIZATION_ID, id);
  const productTrustEvidence = hasCurrentProductTrustEvidence(aggregate);
  const destinationReady = productTrustEvidence && aggregate.destination_verification_status === "VERIFIED" &&
    aggregate.destination_operational_status === "ACTIVE" && aggregate.source_wallet_status === "ACTIVE";
  const readinessOverlay = {
    destination_status: destinationReady ? "READY" : productTrustEvidence
      ? `${aggregate.destination_verification_status}/${aggregate.destination_operational_status}/${aggregate.source_wallet_status}`
      : aggregate.product_trust_provenance === "SIMULATED_DEMO_FIXTURE"
        ? "NOT_READY_SIMULATED_FIXTURE"
        : "NOT_READY_TRUST_EVIDENCE_REQUIRED",
    source: destinationReady ? "CURRENT_PRODUCT_TRUST_EVIDENCE" as const
      : aggregate.product_trust_provenance === "SIMULATED_DEMO_FIXTURE" ? "SIMULATED_DEMO_FIXTURE" as const
        : "UNVERIFIED_CURRENT_TRUST" as const,
  };
  const decision = await assessObligation(buildFinanceAgentContext(record, aggregateVersion, new Date().toISOString().slice(0, 10), readinessOverlay), provider);
  if (isLiveNvidia && wasProviderCallFailure(decision)) return markUnknownAndReply(state, idempotencyKey);

  const runtimeIdentity = provider.runtimeIdentity;
  if (!runtimeIdentity) throw new Error("Assessment provider did not expose a durable runtime identity.");

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
    race: decision.race,
    provider_name: runtimeIdentity.provider_name,
    model_id: runtimeIdentity.model_id,
    model_config_version: runtimeIdentity.model_config_version,
    runtime_config_sha256: runtimeIdentity.runtime_config_sha256,
    provider_mode: !isLiveNvidia ? "NOT_LIVE_AI" : "LIVE_AI",
    assessed_at: new Date().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z"),
  };

  return persistProviderResult(idempotencyKey, assessmentRecord, state);
}
