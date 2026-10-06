import { NextResponse } from "next/server";

import { AuthorityError } from "../../../../src/authority/aggregate";
import { DEMO_ORGANIZATION_ID, getDemoState } from "../../../../src/server/demo-state";
import { buildPaymentTruthLayers } from "../../../../src/domain/payment-control-boundary";
import { getCurrentSettlementProxyPacket } from "../../../../src/server/settlement-proxy-packet";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = await getDemoState();
  try {
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, id);
    const record = state.getRecord(id);
    const canonicalObligation = state.getCanonicalObligation(id);
    if (!record || !canonicalObligation) {
      return NextResponse.json({ error: "Obligation source record not found" }, { status: 404 });
    }
    const currentAssessment = state.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, id);
    const sealed = state.getSealedPae(id);
    let execution = sealed ? state.worker.getExecutionRecord(sealed.payload.idempotency_key) : undefined;
    const executionKillSwitched = state.store.isExecutionKillSwitched(DEMO_ORGANIZATION_ID, id);
    const executionPacket = getCurrentSettlementProxyPacket(state, id);
    let providerStatus = "NOT_SUBMITTED";
    if (execution) {
      try {
        if (execution.status === "SUBMITTING" || execution.status === "UNKNOWN") {
          if (execution.status === "SUBMITTING") {
            execution = await state.worker.recoverSubmittingByIdempotencyKey(execution.idempotency_key, DEMO_ORGANIZATION_ID) ?? execution;
          }
          execution = await state.worker.reconcilePendingByIdempotencyKey(execution.idempotency_key, DEMO_ORGANIZATION_ID);
          providerStatus = execution.status;
          await state.flush();
        } else if (execution.provider_ref) {
          providerStatus = (await state.providerAdapter.getStatus(execution.provider_ref, execution.idempotency_key)).status;
        }
      } catch {
        providerStatus = "PROVIDER_QUERY_FAILED";
      }
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
      execution_gate: executionPacket && state.providerAdapter.name === "arc-circle-live" &&
        process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 === executionPacket.packet_sha256
        ? "PRIME_AUTHORIZED_EXACT_PACKET"
        : executionPacket ? "LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION" : "LOCKED_UNTIL_CURRENT_AUTHORIZATION",
      execution_kill_switched: executionKillSwitched,
    });
  } catch (error) {
    if (error instanceof AuthorityError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    throw error;
  }
}
