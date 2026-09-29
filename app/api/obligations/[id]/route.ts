import { NextResponse } from "next/server";

import { AuthorityError } from "../../../../src/authority/aggregate";
import { DEMO_ARC_TRUST_SEEDED, DEMO_ORGANIZATION_ID, getDemoState } from "../../../../src/server/demo-state";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = await getDemoState();
  try {
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, id);
    const record = state.getRecord(id);
    const currentAssessment = state.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, id);
    const sealed = state.getSealedPae(id);
    const execution = sealed ? state.worker.getExecutionRecord(sealed.payload.idempotency_key) : undefined;
    return NextResponse.json({
      aggregate,
      record,
      current_assessment: currentAssessment ? {
        obligation_id: currentAssessment.record.obligation_id,
        assessment_id: currentAssessment.record.assessment_id,
        assessment_hash: currentAssessment.hash,
        aggregate_version: currentAssessment.record.aggregate_version,
        decision: currentAssessment.record.decision,
        reasons: currentAssessment.record.reasons,
        ...(currentAssessment.record.race ? { race: currentAssessment.record.race } : {}),
      } : null,
      demo_arc_trust_seeded: DEMO_ARC_TRUST_SEEDED,
      pae_sealed: Boolean(sealed),
      execution: execution ?? null,
      execution_kill_switched: state.store.isExecutionKillSwitched(DEMO_ORGANIZATION_ID, id),
    });
  } catch (error) {
    if (error instanceof AuthorityError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    throw error;
  }
}
