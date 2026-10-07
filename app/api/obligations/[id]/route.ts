import { NextResponse } from "next/server";

import { AuthorityError } from "../../../../src/authority/aggregate";
import { DEMO_ORGANIZATION_ID, getDemoState } from "../../../../src/server/demo-state";
import { buildPaymentTruthLayers } from "../../../../src/domain/payment-control-boundary";
import { getCurrentSettlementProxyPacket } from "../../../../src/server/settlement-proxy-packet";
import { DemoStateConflictError, DemoStatePersistenceError } from "../../../../src/server/supabase-demo-state-repository";
import { projectAssuranceEvidence } from "../../../../src/server/assurance-evidence-projection";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  let state = await getDemoState();
  try {
    let aggregate = state.store.get(DEMO_ORGANIZATION_ID, id);
    let record = state.getRecord(id);
    let canonicalObligation = state.getCanonicalObligation(id);
    if (!record || !canonicalObligation) {
      return NextResponse.json({ error: "Obligation source record not found" }, { status: 404 });
    }
    let currentAssessment = state.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, id);
    let sealed = state.getSealedPae(id);
    let execution = sealed ? state.worker.getExecutionRecord(sealed.payload.idempotency_key) : undefined;
    let executionKillSwitched = state.store.isExecutionKillSwitched(DEMO_ORGANIZATION_ID, id);
    let executionPacket: ReturnType<typeof getCurrentSettlementProxyPacket> = null;
    let providerStatus = "NOT_SUBMITTED";
    if (execution) {
      try {
        if (execution.status === "SUBMITTING" || execution.status === "UNKNOWN") {
          if (execution.status === "SUBMITTING") {
            execution = await state.worker.recoverSubmittingByIdempotencyKey(execution.idempotency_key, DEMO_ORGANIZATION_ID) ?? execution;
          }
          execution = await state.worker.reconcilePendingByIdempotencyKey(execution.idempotency_key, DEMO_ORGANIZATION_ID);
          providerStatus = execution.status;
        } else if (execution.provider_ref) {
          providerStatus = (await state.providerAdapter.getStatus(execution.provider_ref, execution.idempotency_key)).status;
        }
      } catch (error) {
        if (error instanceof DemoStatePersistenceError) {
          const locallyObserved = state.worker.getExecutionRecord(sealed!.payload.idempotency_key);
          const evidence = locallyObserved?.provider_evidence;
          const providerObservation = evidence && typeof evidence === "object" && "status" in evidence
            ? { idempotency_key: sealed!.payload.idempotency_key, status: evidence.status, durably_recorded: false }
            : null;
          try {
            const authoritativeState = await getDemoState();
            if (authoritativeState === state) throw new Error("Authoritative reload returned the failed writer instance.");
            const authoritativeSealed = authoritativeState.getSealedPae(id);
            const authoritativeExecution = authoritativeSealed
              ? authoritativeState.worker.getExecutionRecord(authoritativeSealed.payload.idempotency_key)
              : undefined;
            const authoritativeAggregate = authoritativeState.store.get(DEMO_ORGANIZATION_ID, id);
            const authoritativeRecord = authoritativeState.getRecord(id);
            return NextResponse.json({
              error: providerObservation?.status === "CONFIRMED"
                ? "Provider confirmation was observed, but the durable reconciliation write failed. Settlement may have occurred; no persisted success is claimed."
                : "Durable reconciliation state could not be saved. The outcome remains unresolved.",
              code: error instanceof DemoStateConflictError ? "OPS-002" : "OPS-003",
              provider_observation: providerObservation,
              authoritative_state: {
                execution_status: authoritativeExecution?.status ?? "NOT_RECORDED",
                aggregate_state: authoritativeAggregate.state,
                execution_state: authoritativeAggregate.execution_state,
                pae_state: authoritativeAggregate.pae_state,
                source_payable_state: authoritativeRecord?.state_at_event_baseline ?? "UNKNOWN",
              },
              execution_gate: "RECONCILIATION_ONLY",
              next_action: "Retry this read-only reconciliation for the same identity. Do not resubmit.",
            }, { status: error instanceof DemoStateConflictError ? 409 : 503 });
          } catch {
            return NextResponse.json({
              error: providerObservation?.status === "CONFIRMED"
                ? "Provider confirmation was observed, but both durable reconciliation and authoritative reload failed. Settlement may have occurred; do not resubmit."
                : "Durable reconciliation and authoritative reload failed. Outcome is unresolved; do not resubmit.",
              code: error instanceof DemoStateConflictError ? "OPS-002" : "OPS-003",
              provider_observation: providerObservation,
              authoritative_state: "UNAVAILABLE",
              execution_gate: "RECONCILIATION_ONLY",
              next_action: "Retry this read-only reconciliation for the same identity. Do not resubmit.",
            }, { status: 503 });
          }
        }
        providerStatus = "PROVIDER_QUERY_FAILED";
      }
    }
    // Reconciliation may have durably advanced execution and aggregate state.
    // Build every response layer from one post-reconciliation authority read.
    aggregate = state.store.get(DEMO_ORGANIZATION_ID, id);
    record = state.getRecord(id);
    canonicalObligation = state.getCanonicalObligation(id);
    currentAssessment = state.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, id);
    sealed = state.getSealedPae(id);
    execution = sealed ? state.worker.getExecutionRecord(sealed.payload.idempotency_key) : undefined;
    executionKillSwitched = state.store.isExecutionKillSwitched(DEMO_ORGANIZATION_ID, id);
    executionPacket = getCurrentSettlementProxyPacket(state, id);
    if (!record || !canonicalObligation) {
      return NextResponse.json({ error: "Obligation source record not found" }, { status: 404 });
    }
    const settlementRuntime = state.providerAdapter.name === "fake-testnet" ? "SIMULATED" as const : "LIVE" as const;
    const truth = buildPaymentTruthLayers({
      obligation: canonicalObligation,
      source_obligation_state: record.state_at_event_baseline,
      aggregate_version: aggregate.aggregate_version,
      aggregate_state: aggregate.state,
      pae_state: aggregate.pae_state,
      execution_state: aggregate.execution_state,
      current_assessment_present: Boolean(currentAssessment),
      pae_sealed: Boolean(sealed),
      execution_kill_switched: executionKillSwitched,
      network: aggregate.network,
      settlement_status: providerStatus,
      provider_ref: execution?.provider_ref ?? null,
      settlement_runtime: settlementRuntime,
      settlement_amount: aggregate.amount,
      settlement_atomic_amount: (() => {
        const [whole, fractional] = aggregate.amount.split(".");
        return (BigInt(whole) * 1_000_000n + BigInt(fractional)).toString(10);
      })(),
      source_amount: aggregate.source_amount ?? "UNKNOWN",
      source_currency: aggregate.source_currency ?? "UNKNOWN",
      settlement_conversion_rate: aggregate.settlement_conversion_rate ?? null,
    });
    const assuranceEvidence = projectAssuranceEvidence({
      organizationId: DEMO_ORGANIZATION_ID,
      obligationId: id,
      aggregate,
      executionReleaseAuthority: truth.tameion_control_truth.execution_release_authority,
      executionKillSwitched,
      execution: execution ?? null,
      sealedPae: sealed ?? null,
      authorizationArtifacts: state.getAuthorizationArtifacts(id) ?? null,
      trustedKeys: state.trustedKeys.export(),
      now: new Date(),
    });
    return NextResponse.json({
      truth,
      aggregate,
      record,
            current_assessment: currentAssessment ? {
        obligation_id: currentAssessment.record.obligation_id,
        assessment_id: currentAssessment.record.assessment_id,
        assessment_hash: currentAssessment.hash,
        aggregate_version: currentAssessment.record.aggregate_version,
        decision: currentAssessment.record.decision,
        reasons: currentAssessment.record.reasons,
        provider_used: currentAssessment.record.provider_name,
        provider_mode: currentAssessment.record.provider_mode,
        ...(currentAssessment.record.race ? { race: currentAssessment.record.race } : {}),
      } : null,
      demo_arc_trust_simulated: aggregate.product_trust_provenance === "SIMULATED_DEMO_FIXTURE",
      pae_sealed: Boolean(sealed),
      execution: execution ?? null,
      settlement_proxy: state.getSettlementProxy(id) ?? null,
      source_settlement_disclosure: "Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.",
      source_payable_state: record.state_at_event_baseline,
      execution_packet: executionPacket,
      sealed_pae_instruction_hash: sealed?.instruction_hash ?? null,
      execution_gate: execution
        ? execution.status === "UNKNOWN" || execution.status === "SUBMITTING" ? "RECONCILIATION_ONLY" : "EXECUTION_ALREADY_RECORDED"
        : executionPacket && state.providerAdapter.name === "arc-circle-live" &&
          process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 === executionPacket.packet_sha256
          ? "PRIME_AUTHORIZED_EXACT_PACKET"
          : executionPacket ? "LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION" : "LOCKED_UNTIL_CURRENT_AUTHORIZATION",
      execution_kill_switched: executionKillSwitched,
      assurance_evidence: assuranceEvidence,
    });
  } catch (error) {
    if (error instanceof AuthorityError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    throw error;
  }
}
