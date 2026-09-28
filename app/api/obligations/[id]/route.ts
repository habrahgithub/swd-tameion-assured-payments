import { NextResponse } from "next/server";

import { AuthorityError } from "../../../../src/authority/aggregate";
import { DEMO_ARC_TRUST_SEEDED, DEMO_ORGANIZATION_ID, getDemoState } from "../../../../src/server/demo-state";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = getDemoState();
  try {
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, id);
    const record = state.getRecord(id);
    const sealed = state.getSealedPae(id);
    const execution = sealed ? state.worker.getExecutionRecord(sealed.payload.idempotency_key) : undefined;
    return NextResponse.json({
      aggregate,
      record,
      demo_arc_trust_seeded: DEMO_ARC_TRUST_SEEDED,
      pae_sealed: Boolean(sealed),
      execution: execution ?? null,
    });
  } catch (error) {
    if (error instanceof AuthorityError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    throw error;
  }
}
