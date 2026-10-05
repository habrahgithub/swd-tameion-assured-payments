import { NextResponse } from "next/server";

import { J2A_DEMO_DESTINATION, J2A_DEMO_OBLIGATION_ID, J2A_DEMO_ORGANIZATION_ID, J2A_DEMO_SOURCE, J2A_TRANSFER_AMOUNT, buildJ2aExecutionPacket } from "../../../../../../src/demo/real-testnet-payment";
import { ExecutionBlockedError } from "../../../../../../src/execution/worker";
import { getJ2aRealTestnetDemoState } from "../../../../../../src/server/demo-state";
import { DemoStateConflictError } from "../../../../../../src/server/supabase-demo-state-repository";
import { PaeVerificationError } from "../../../../../../src/pae/sign-verify";
import { getAuthorizedReviewedAssessment } from "../../../../../../src/demo/authorized-assessment-lineage";
import { verifyJ2aSealedPae } from "../../../../../../src/demo/verify-j2a-pae";

const EXECUTION_CONFIRMATION = "SUBMIT EXACT TESTNET DEMO TRANSFER";

/**
 * Submits only after a separate Prime packet authorization has been provisioned
 * server-side as J2A_EXECUTION_AUTHORIZED_PACKET_SHA256. The variable must bind
 * to the exact packet currently returned by the status route. It is deliberately
 * absent during build/review, so this route cannot submit in that phase.
 */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    expected_version?: unknown;
    packet_sha256?: unknown;
    pae_instruction_hash?: unknown;
    confirmation?: unknown;
  };
  if (!Number.isSafeInteger(body.expected_version) || typeof body.packet_sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(body.packet_sha256) || typeof body.pae_instruction_hash !== "string" ||
      !/^[0-9a-f]{64}$/.test(body.pae_instruction_hash) || body.confirmation !== EXECUTION_CONFIRMATION) {
    return NextResponse.json({ error: "Exact packet hash, current aggregate version, PAE hash, and explicit execution confirmation are required." }, { status: 400 });
  }

  const state = await getJ2aRealTestnetDemoState();
  const preflight = state.lastPreflight;
  if (!preflight || preflight.readiness !== "READY") {
    return NextResponse.json({ error: "A current READY read-only Circle preflight is required before execution." }, { status: 409 });
  }
  const aggregate = state.store.get(J2A_DEMO_ORGANIZATION_ID, J2A_DEMO_OBLIGATION_ID);
  const sealedPae = state.getSealedPae(J2A_DEMO_OBLIGATION_ID);
  const authorization = state.getAuthorizationArtifacts(J2A_DEMO_OBLIGATION_ID);
  if (!sealedPae || !authorization) {
    return NextResponse.json({ error: "A current LIVE_AI PAY assessment, PASS assurance, and sealed PAE are required." }, { status: 409 });
  }
  const assessment = getAuthorizedReviewedAssessment(
    state.store, J2A_DEMO_ORGANIZATION_ID, J2A_DEMO_OBLIGATION_ID, aggregate.aggregate_version, authorization, sealedPae,
  );
  if (!assessment) {
    return NextResponse.json({ error: "A current LIVE_AI PAY assessment, PASS assurance, and sealed PAE are required." }, { status: 409 });
  }
  if (body.expected_version !== aggregate.aggregate_version || preflight.evidence_sha256 !== aggregate.evidence_hashes[0] ||
      assessment.record.aggregate_version !== sealedPae.payload.approval_evidence[0]?.reviewed_aggregate_version || assessment.record.provider_mode !== "LIVE_AI" ||
      assessment.record.decision !== "PAY" || assessment.record.missing_evidence.length !== 0 ||
      (assessment.record.race?.result.validated_findings.length ?? 0) !== 0 ||
      authorization.assurance_record.result !== "PASS" ||
      authorization.sealed_pae.instruction_hash !== sealedPae.instruction_hash ||
      sealedPae.instruction_hash !== body.pae_instruction_hash ||
      sealedPae.payload.organization_id !== J2A_DEMO_ORGANIZATION_ID ||
      sealedPae.payload.obligation_ids[0] !== J2A_DEMO_OBLIGATION_ID ||
      sealedPae.payload.aggregate_version !== String(aggregate.aggregate_version) ||
      sealedPae.payload.evidence_hashes.length !== 1 || sealedPae.payload.evidence_hashes[0] !== preflight.evidence_sha256 ||
      sealedPae.payload.source_wallet_ref !== J2A_DEMO_SOURCE.id ||
      sealedPae.payload.destination_address.toLowerCase() !== J2A_DEMO_DESTINATION.address.toLowerCase() ||
      sealedPae.payload.amount !== J2A_TRANSFER_AMOUNT || sealedPae.payload.asset !== "USDC" || sealedPae.payload.network !== "ARC_TESTNET" ||
      assessment.record.assessment_id !== sealedPae.payload.approval_evidence[0].assessment_id ||
      assessment.hash !== sealedPae.payload.approval_evidence[0].assessment_hash ||
      Date.parse(sealedPae.payload.expiry) <= Date.now()) {
    return NextResponse.json({ error: "The testnet intent, provider evidence, assessment, assurance, or PAE is stale or mismatched." }, { status: 409 });
  }

  let packet: ReturnType<typeof buildJ2aExecutionPacket>;
  try {
    verifyJ2aSealedPae(sealedPae);
  } catch (error) {
    return NextResponse.json({
      error: "The sealed PAE could not be verified against configured server trust.",
      code: error instanceof PaeVerificationError ? error.code : "PAE-016",
    }, { status: 409 });
  }
  try {
    packet = buildJ2aExecutionPacket({
      preflight,
      aggregate,
      assessment: assessment.record,
      assessmentHash: assessment.hash,
      sealedPae,
    });
  } catch {
    return NextResponse.json({ error: "The exact provider packet could not be built.", code: "J2A-PACKET-001" }, { status: 409 });
  }
  if (body.packet_sha256 !== packet.packet_sha256 ||
      process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 !== packet.packet_sha256) {
    return NextResponse.json({ error: "Execution is locked until Prime separately authorizes this exact packet after review." }, { status: 403 });
  }

  try {
    const execution = await state.worker.execute(sealedPae);
    await state.flush();
    return NextResponse.json({
      execution,
      classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
      execution_authority: "ONE_EXACT_PACKET_PRIME_AUTHORIZED",
    }, { status: execution.status === "UNKNOWN" ? 202 : execution.status === "BLOCKED" ? 409 : 200 });
  } catch (error) {
    if (error instanceof ExecutionBlockedError) return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    if (error instanceof DemoStateConflictError) return NextResponse.json({ error: error.message, code: "OPS-002" }, { status: 409 });
    throw error;
  }
}
