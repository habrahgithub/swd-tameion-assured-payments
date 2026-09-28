import { NextResponse } from "next/server";

import { DEMO_ORGANIZATION_ID, getDemoState } from "../../../src/server/demo-state";

export async function GET() {
  const state = await getDemoState();
  const obligations = state.listObligations().map((o) => {
    const sealed = state.store.getSealedAssessment(DEMO_ORGANIZATION_ID, o.obligation_id);
    const current = state.store.get(DEMO_ORGANIZATION_ID, o.obligation_id);
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
    };
  });
  return NextResponse.json({
    obligations,
    assessed_count: obligations.filter((o) => o.assessed).length,
    total_count: obligations.length,
  });
}
