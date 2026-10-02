import { NextResponse } from "next/server";

import { AuthorityError } from "../../../../src/authority/aggregate";
import { DEMO_ARC_TRUST_SIMULATED, DEMO_ORGANIZATION_ID, getDemoState } from "../../../../src/server/demo-state";
import { buildPaymentTruthLayers } from "../../../../src/domain/payment-control-boundary";

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
    const execution = sealed ? state.worker.getExecutionRecord(sealed.payload.idempotency_key) : undefined;
    const executionKillSwitched = state.store.isExecutionKillSwitched(DEMO_ORGANIZATION_ID, id);
    let providerStatus = "NOT_SUBMITTED";
    if (execution) {
      try {
        if (execution.provider_ref) {
          providerStatus = (await state.adapter.getStatus(execution.provider_ref)).status;
        } else if (execution.status === "SUBMITTING" || execution.status === "UNKNOWN") {
          providerStatus = state.adapter.getStatusByIdempotencyKey
            ? (await state.adapter.getStatusByIdempotencyKey(execution.idempotency_key)).status
            : "IN_DOUBT";
        }
      } catch {
        providerStatus = "PROVIDER_QUERY_FAILED";
      }
    }
    const settlementRuntime = state.adapter.name === "fake-testnet" ? "SIMULATED" as const : "LIVE" as const;
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
      source_amount: aggregate.source_amount ?? aggregate.amount,
      source_currency: aggregate.source_currency ?? "USDC",
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
      demo_arc_trust_simulated: DEMO_ARC_TRUST_SIMULATED,
      pae_sealed: Boolean(sealed),
      execution: execution ?? null,
      execution_kill_switched: executionKillSwitched,
    });
  } catch (error) {
    if (error instanceof AuthorityError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    throw error;
  }
}
