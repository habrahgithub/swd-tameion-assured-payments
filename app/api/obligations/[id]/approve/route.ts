import { NextResponse } from "next/server";

import { AssuranceFailedError } from "../../../../../src/pipeline/authorize-and-seal";
import { approveAndSealPae } from "../../../../../src/pipeline/authorize-and-seal";
import { StaleStateError } from "../../../../../src/authority/aggregate";
import { DEMO_ORGANIZATION_ID, DEMO_SIGNING_KEY_ID, getDemoState } from "../../../../../src/server/demo-state";

interface ApproveRequestBody {
  expected_version: number;
  actor_id?: string;
  reason_text?: string;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = getDemoState();
  const body = (await request.json().catch(() => ({}))) as Partial<ApproveRequestBody>;

  if (typeof body.expected_version !== "number") {
    return NextResponse.json({ error: "expected_version is required" }, { status: 400 });
  }

  try {
    const { aggregate, sealed } = approveAndSealPae(state.store, DEMO_SIGNING_KEY_ID, {
      organizationId: DEMO_ORGANIZATION_ID,
      obligationId: id,
      expectedVersion: body.expected_version,
      actorId: body.actor_id ?? "USR-DEMO-OPERATOR",
      actorRole: "FINANCE_APPROVER",
      policyVersion: "POLICY-P0-1",
      reasonText: body.reason_text ?? `Reviewed and approved ${id} for a testnet-fixture Arc payment.`,
    });
    state.setSealedPae(id, sealed);
    return NextResponse.json({
      aggregate,
      sealed_pae: {
        instruction_hash: sealed.instruction_hash,
        signature: sealed.signature,
        payload: sealed.payload,
      },
    });
  } catch (error) {
    if (error instanceof StaleStateError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof AssuranceFailedError) {
      return NextResponse.json({ error: error.message, overall: error.overall }, { status: 422 });
    }
    throw error;
  }
}
