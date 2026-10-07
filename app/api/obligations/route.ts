import { NextResponse } from "next/server";

import { DEMO_ARC_TRUST_SIMULATED, DEMO_ORGANIZATION_ID, getDemoState } from "../../../src/server/demo-state";

export async function GET() {
  const state = await getDemoState();
  const obligations = state.listObligations().map((o) => {
    const sealed = state.store.getSealedAssessment(DEMO_ORGANIZATION_ID, o.obligation_id);
    const current = state.store.get(DEMO_ORGANIZATION_ID, o.obligation_id);
    const sealedPae = state.getSealedPae(o.obligation_id);
    const execution = sealedPae ? state.worker.getExecutionRecord(sealedPae.payload.idempotency_key) : undefined;
    const routeAssuranceReady = !DEMO_ARC_TRUST_SIMULATED &&
      current.product_trust_provenance === "CURRENT_PRODUCT_EVIDENCE" &&
      current.destination_verification_status === "VERIFIED" &&
      current.destination_operational_status === "ACTIVE" &&
      current.source_wallet_status === "ACTIVE";
    // A sealed assessment only counts toward coverage while it is still
    // bound to the obligation's current version — the same staleness rule
    // approve() itself enforces (AUT-009); a stale assessment must not be
    // shown as "assessed" here either.
    const isCurrent = sealed?.record.aggregate_version === String(current.aggregate_version);
    return {
      ...o,
      assessed: isCurrent,
      decision: isCurrent ? sealed?.record.decision : null,
      provider_mode: isCurrent ? sealed?.record.provider_mode : null,
      aggregate_state: current.state,
      pae_sealed: Boolean(sealedPae),
      execution_status: execution?.status ?? null,
      route_assurance_status: routeAssuranceReady ? "Route assurance ready" : "Route assurance not ready",
    };
  });
  return NextResponse.json({
    obligations,
    assessed_count: obligations.filter((o) => o.assessed).length,
    total_count: obligations.length,
    // This is the existing deterministic gate result, including its due-date
    // and obligation-ID tie-breaks. The client uses it only to mirror the
    // server's selected identity; preflight and approval revalidate it.
    sole_pay_candidate_id: state.getSolePayCandidateId(),
  });
}
