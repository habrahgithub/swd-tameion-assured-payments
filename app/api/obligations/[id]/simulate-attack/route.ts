import { NextResponse } from "next/server";

import { ExecutionBlockedError } from "../../../../../src/execution/worker";
import { DEMO_ORGANIZATION_ID, getDemoState } from "../../../../../src/server/demo-state";

/**
 * P0 Demo Scenario: "attack path — destination changed after authorization
 * -> independent execution verification BLOCK -> zero unauthorized USDC."
 * This mutates the destination on the current aggregate (as if a compromised
 * session or malicious operator changed it after the PAE was sealed), then
 * attempts execution with the *already-sealed* PAE, proving the pre-submit
 * BLOCK fires before any provider call.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = getDemoState();
  const sealed = state.getSealedPae(id);
  if (!sealed) {
    return NextResponse.json({ error: "No sealed PAE for this obligation; approve first." }, { status: 409 });
  }

  const aggregate = state.store.get(DEMO_ORGANIZATION_ID, id);
  state.store.applyMaterialChange(DEMO_ORGANIZATION_ID, id, aggregate.aggregate_version, {
    destination_ref: `DEST-${id}-ATTACKER`,
    destination_version: aggregate.destination_version + 1,
    destination_address: `0x${"e".repeat(40)}`,
    destination_verification_status: "PENDING_VERIFICATION",
  });

  const submissionsBefore = state.adapter.getSubmissionCount();
  try {
    await state.worker.execute(sealed);
    return NextResponse.json({ blocked: false, message: "Unexpected: execution was not blocked." }, { status: 500 });
  } catch (error) {
    const submissionsAfter = state.adapter.getSubmissionCount();
    if (error instanceof ExecutionBlockedError) {
      return NextResponse.json({
        blocked: true,
        reason: error.message,
        code: error.code,
        provider_submissions_attempted: submissionsAfter - submissionsBefore,
      });
    }
    throw error;
  }
}
