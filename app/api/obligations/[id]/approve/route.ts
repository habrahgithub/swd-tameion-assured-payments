import { NextResponse } from "next/server";

import { AssuranceFailedError, approveAndSealPae } from "../../../../../src/pipeline/authorize-and-seal";
import { AuthorityError, StaleStateError } from "../../../../../src/authority/aggregate";
import { DEMO_ORGANIZATION_ID, DEMO_SIGNING_KEY_ID, getDemoState } from "../../../../../src/server/demo-state";
import { DemoStateConflictError } from "../../../../../src/server/supabase-demo-state-repository";

interface ApproveRequestBody {
  expected_version: number;
  reviewed_assessment_id: string;
  reviewed_assessment_hash: string;
  actor_id?: string;
  reason_text?: string;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = await getDemoState();
  const body = (await request.json().catch(() => ({}))) as Partial<ApproveRequestBody>;

  if (typeof body.expected_version !== "number" || typeof body.reviewed_assessment_id !== "string" ||
      typeof body.reviewed_assessment_hash !== "string" || !/^[0-9a-f]{64}$/.test(body.reviewed_assessment_hash)) {
    return NextResponse.json({ error: "expected_version, reviewed_assessment_id, and reviewed_assessment_hash are required" }, { status: 400 });
  }

  try {
    const aggregateBeforeApproval = state.store.get(DEMO_ORGANIZATION_ID, id);
    const proxy = state.getSettlementProxy(id);
    if (!proxy || proxy.mapped_aggregate_version !== aggregateBeforeApproval.aggregate_version ||
        proxy.preflight.organization_id !== DEMO_ORGANIZATION_ID || proxy.preflight.obligation_id !== id ||
        proxy.preflight.amount !== aggregateBeforeApproval.amount ||
        proxy.preflight.source_amount !== aggregateBeforeApproval.source_amount ||
        proxy.preflight.source_currency !== aggregateBeforeApproval.source_currency ||
        !aggregateBeforeApproval.evidence_hashes.includes(proxy.preflight.evidence_sha256) ||
        aggregateBeforeApproval.destination_ref !== `ARC-TESTNET-SETTLEMENT-PROXY:${proxy.preflight.destination_wallet.id}` ||
        aggregateBeforeApproval.destination_address.toLowerCase() !== proxy.preflight.destination_wallet.address.toLowerCase()) {
      return NextResponse.json({ error: "A current selected-source Arc Testnet settlement proxy is required before authorization." }, { status: 409 });
    }
    const { aggregate, sealed, safetyKernel, approvalRecord, assuranceRecord } = approveAndSealPae(state.store, DEMO_SIGNING_KEY_ID, {
      organizationId: DEMO_ORGANIZATION_ID,
      obligationId: id,
      expectedVersion: body.expected_version,
      reviewedAssessmentId: body.reviewed_assessment_id,
      reviewedAssessmentHash: body.reviewed_assessment_hash,
      actorId: body.actor_id ?? "USR-DEMO-OPERATOR",
      actorRole: "FINANCE_APPROVER",
      policyVersion: "POLICY-P0-1",
      reasonText: body.reason_text ?? `Reviewed genuine source obligation ${id} for a distinct Arc Testnet settlement proxy; the real-world payable remains outstanding.`,
    }, state.trustedKeys);
    state.recordAuthorization({
      approval_record: approvalRecord.record,
      approval_record_hash: approvalRecord.approval_record_hash,
      assurance_record: assuranceRecord.record,
      assurance_hash: assuranceRecord.assurance_hash,
      sealed_pae: sealed,
    });
    await state.flush();
    return NextResponse.json({
      aggregate,
      sealed_pae: {
        instruction_hash: sealed.instruction_hash,
        signature: sealed.signature,
        payload: sealed.payload,
      },
      safety_kernel: { overall: safetyKernel.overall, control_results: safetyKernel.controlResults },
    });
  } catch (error) {
    if (error instanceof StaleStateError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof AssuranceFailedError) {
      return NextResponse.json(
        {
          error: error.message,
          overall: error.overall,
          safety_kernel: { overall: error.overall, control_results: error.controlResults },
        },
        { status: 422 },
      );
    }
    if (error instanceof AuthorityError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof DemoStateConflictError) {
      return NextResponse.json({ error: error.message, code: "OPS-002" }, { status: 409 });
    }
    throw error;
  }
}
