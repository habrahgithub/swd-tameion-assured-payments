import { NextResponse } from "next/server";

import { AuthorityError, StaleStateError } from "../../../../../../src/authority/aggregate";
import { approveAndSealPae, AssuranceFailedError } from "../../../../../../src/pipeline/authorize-and-seal";
import { signingKeyEnvironmentVariableName } from "../../../../../../src/pae/keys";
import { J2A_DEMO_OBLIGATION_ID, J2A_DEMO_ORGANIZATION_ID, J2A_PAE_SIGNING_KEY_ID } from "../../../../../../src/demo/real-testnet-payment";
import { getJ2aRealTestnetDemoState } from "../../../../../../src/server/demo-state";
import { DemoStateConflictError } from "../../../../../../src/server/supabase-demo-state-repository";

export async function POST(request: Request) {
  const state = await getJ2aRealTestnetDemoState();
  const body = await request.json().catch(() => ({})) as {
    expected_version?: unknown; reviewed_assessment_id?: unknown; reviewed_assessment_hash?: unknown;
    confirmation?: unknown; actor_id?: unknown; reason_text?: unknown;
  };
  if (!Number.isSafeInteger(body.expected_version) || typeof body.reviewed_assessment_id !== "string" ||
      typeof body.reviewed_assessment_hash !== "string" || !/^[0-9a-f]{64}$/.test(body.reviewed_assessment_hash) ||
      body.confirmation !== "AUTHORIZE EXACT CURRENT TESTNET DEMO INTENT" ||
      typeof body.actor_id !== "string" || !/^USR-[A-Z0-9-]{3,64}$/.test(body.actor_id) ||
      typeof body.reason_text !== "string" || body.reason_text.trim().length < 12 || body.reason_text.length > 500) {
    return NextResponse.json({ error: "Exact reviewed assessment, aggregate version, Prime confirmation, actor identity, and reason are required." }, { status: 400 });
  }
  const preflight = state.lastPreflight;
  if (!preflight || preflight.readiness !== "READY" || preflight.obligation_id !== J2A_DEMO_OBLIGATION_ID) {
    return NextResponse.json({ error: "A current READY testnet demo preflight is required before authorization." }, { status: 409 });
  }
  const aggregate = state.store.get(J2A_DEMO_ORGANIZATION_ID, J2A_DEMO_OBLIGATION_ID);
  if (aggregate.evidence_hashes[0] !== preflight.evidence_sha256 || body.expected_version !== aggregate.aggregate_version) {
    return NextResponse.json({ error: "The testnet demo provider evidence or aggregate is stale; reassess before authorization." }, { status: 409 });
  }
  const assessment = state.store.getCurrentAssessment(J2A_DEMO_ORGANIZATION_ID, J2A_DEMO_OBLIGATION_ID);
  if (!assessment || assessment.hash !== body.reviewed_assessment_hash || assessment.record.assessment_id !== body.reviewed_assessment_id ||
      assessment.record.aggregate_version !== String(aggregate.aggregate_version) || assessment.record.provider_mode !== "LIVE_AI" ||
      assessment.record.decision !== "PAY" || assessment.record.missing_evidence.length !== 0 ||
      (assessment.record.race?.result.validated_findings.length ?? 0) !== 0) {
    return NextResponse.json({ error: "Only a current LIVE_AI PAY assessment with zero findings and zero missing evidence is eligible for Prime authorization." }, { status: 409 });
  }
  const keyId = J2A_PAE_SIGNING_KEY_ID;
  if (!process.env[signingKeyEnvironmentVariableName(keyId)]) {
    return NextResponse.json({ error: "A provisioned server-side J2A PAE signing key is required; ephemeral development keys are not accepted." }, { status: 503 });
  }
  try {
    const authorized = approveAndSealPae(state.store, keyId, {
      organizationId: J2A_DEMO_ORGANIZATION_ID,
      obligationId: J2A_DEMO_OBLIGATION_ID,
      expectedVersion: aggregate.aggregate_version,
      reviewedAssessmentId: assessment.record.assessment_id,
      reviewedAssessmentHash: assessment.hash,
      actorId: body.actor_id,
      actorRole: "PRIME",
      policyVersion: aggregate.policy_version,
      reasonText: body.reason_text,
    });
    state.recordAuthorization({
      approval_record: authorized.approvalRecord.record,
      approval_record_hash: authorized.approvalRecord.approval_record_hash,
      assurance_record: authorized.assuranceRecord.record,
      assurance_hash: authorized.assuranceRecord.assurance_hash,
      sealed_pae: authorized.sealed,
    });
    await state.flush();
    return NextResponse.json({
      aggregate: authorized.aggregate,
      assessment_id: assessment.record.assessment_id,
      assessment_hash: assessment.hash,
      sealed_pae: { instruction_hash: authorized.sealed.instruction_hash, signature: authorized.sealed.signature, payload: authorized.sealed.payload },
      safety_kernel: { overall: authorized.safetyKernel.overall, control_results: authorized.safetyKernel.controlResults },
      classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
      execution_authority: "NOT_GRANTED",
    });
  } catch (error) {
    if (error instanceof StaleStateError || error instanceof AuthorityError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    if (error instanceof AssuranceFailedError) return NextResponse.json({ error: error.message, safety_kernel: { overall: error.overall, control_results: error.controlResults } }, { status: 422 });
    if (error instanceof DemoStateConflictError) return NextResponse.json({ error: error.message, code: "OPS-002" }, { status: 409 });
    throw error;
  }
}
