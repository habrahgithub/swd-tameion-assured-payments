import { NextResponse } from "next/server";

import { J2A_DEMO_OBLIGATION_ID, J2A_DEMO_ORGANIZATION_ID, buildJ2aDemoObligation, buildJ2aExecutionPacket, buildJ2aIntentIdentity } from "../../../../../../src/demo/real-testnet-payment";
import { getJ2aRealTestnetDemoState } from "../../../../../../src/server/demo-state";
import { PaeVerificationError } from "../../../../../../src/pae/sign-verify";
import { getAuthorizedReviewedAssessment } from "../../../../../../src/demo/authorized-assessment-lineage";
import { verifyJ2aSealedPae } from "../../../../../../src/demo/verify-j2a-pae";

export const dynamic = "force-dynamic";

/** Read-only provider reconciliation plus a server-derived snapshot of the isolated J2A lane. */
export async function GET() {
  const state = await getJ2aRealTestnetDemoState();
  const preflight = state.lastPreflight;
  let aggregate = null;
  let assessment: ReturnType<typeof state.store.getCurrentAssessment> | null = null;
  let sealedPae = state.getSealedPae(J2A_DEMO_OBLIGATION_ID) ?? null;
  let execution = null;
  let authorization = state.getAuthorizationArtifacts(J2A_DEMO_OBLIGATION_ID) ?? null;
  let paeVerificationStatus: "NOT_PRESENT" | "NOT_CHECKED" | "VERIFIED" | "FAILED" = sealedPae ? "NOT_CHECKED" : "NOT_PRESENT";
  let paeVerificationErrorCode: string | null = null;
  let packetErrorCode: string | null = null;

  if (preflight?.readiness === "READY") {
    aggregate = state.store.get(J2A_DEMO_ORGANIZATION_ID, J2A_DEMO_OBLIGATION_ID);
    const authorizationClaimsCurrentVersion = authorization?.approval_record.authorized_aggregate_version === String(aggregate.aggregate_version);
    assessment = authorizationClaimsCurrentVersion
      ? getAuthorizedReviewedAssessment(state.store, J2A_DEMO_ORGANIZATION_ID, J2A_DEMO_OBLIGATION_ID, aggregate.aggregate_version, authorization, sealedPae) ?? null
      : state.store.getCurrentAssessment(J2A_DEMO_ORGANIZATION_ID, J2A_DEMO_OBLIGATION_ID) ?? null;
    if (sealedPae) {
      try {
        verifyJ2aSealedPae(sealedPae, state.trustedKeys);
        paeVerificationStatus = "VERIFIED";
        execution = state.worker.getExecutionRecord(sealedPae.payload.idempotency_key) ?? null;
        if (execution?.status === "SUBMITTING") {
          execution = await state.worker.recoverSubmittingByIdempotencyKey(
            sealedPae.payload.idempotency_key,
            J2A_DEMO_ORGANIZATION_ID,
          ) ?? null;
        }
        if (execution?.status === "UNKNOWN") {
          const before = execution.status;
          execution = await state.worker.reconcilePendingByIdempotencyKey(sealedPae.payload.idempotency_key, J2A_DEMO_ORGANIZATION_ID);
          if (execution.status !== before) await state.flush();
        }
      } catch (error) {
        paeVerificationStatus = "FAILED";
        paeVerificationErrorCode = error instanceof PaeVerificationError ? error.code : "PAE-016";
        execution = state.worker.getExecutionRecord(sealedPae.payload.idempotency_key) ?? null;
      }
    }
  }

  let packet = null as ReturnType<typeof buildJ2aExecutionPacket> | null;
  if (paeVerificationStatus === "VERIFIED" && preflight?.readiness === "READY" && aggregate && assessment && sealedPae &&
      assessment.record.decision === "PAY" && assessment.record.provider_mode === "LIVE_AI" &&
      assessment.record.missing_evidence.length === 0 &&
      (assessment.record.race?.result.validated_findings.length ?? 0) === 0 &&
      assessment.record.aggregate_version === sealedPae.payload.approval_evidence[0]?.reviewed_aggregate_version &&
      sealedPae.payload.aggregate_version === String(aggregate.aggregate_version) &&
      sealedPae.payload.evidence_hashes.length === 1 && sealedPae.payload.evidence_hashes[0] === preflight.evidence_sha256 &&
      sealedPae.payload.expiry && Date.parse(sealedPae.payload.expiry) > Date.now() &&
      authorization?.assurance_record.result === "PASS" &&
      authorization.sealed_pae.instruction_hash === sealedPae.instruction_hash) {
    try {
      packet = buildJ2aExecutionPacket({
        preflight,
        aggregate,
        assessment: assessment.record,
        assessmentHash: assessment.hash,
        sealedPae,
      });
    } catch {
      packetErrorCode = "J2A-PACKET-001";
    }
  }
  const executionGate = packet && process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 === packet.packet_sha256
    ? "PRIME_AUTHORIZED_EXACT_PACKET"
    : "LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION";
  const authorizationCurrent = Boolean(authorization && aggregate && sealedPae && assessment &&
    paeVerificationStatus === "VERIFIED" &&
    authorization.approval_record.authorized_aggregate_version === String(aggregate.aggregate_version) &&
    authorization.sealed_pae.instruction_hash === sealedPae.instruction_hash);
  const lifecycle = [
    { stage: "Obligation", status: preflight?.readiness === "READY" ? "READY" : preflight?.readiness ?? "NOT_CREATED" },
    { stage: "AI Assessment", status: assessment?.record.decision ? `${assessment.record.decision} · ${assessment.record.provider_mode}` : "NOT_ASSESSED" },
    { stage: "Assurance & Authorization", status: authorizationCurrent ? authorization!.assurance_record.result : paeVerificationStatus === "FAILED" ? "PAE_INVALID" : authorization ? "STALE" : "NOT_AUTHORIZED" },
    { stage: "Execution", status: execution?.status ?? "NOT_SUBMITTED" },
    { stage: "Reconciliation & Evidence", status: execution?.status === "SETTLED" ? "RECONCILED" : execution?.status ?? "NOT_SUBMITTED" },
  ];

  return NextResponse.json({
    classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
    profile: "J2A_REAL_TESTNET_DEMO",
    organization_id: J2A_DEMO_ORGANIZATION_ID,
    obligation_id: J2A_DEMO_OBLIGATION_ID,
    source_amount: "5.00",
    settlement_amount: "5.000000",
    asset: "USDC",
    network: "ARC_TESTNET",
    demo_obligation: preflight?.readiness === "READY" ? buildJ2aDemoObligation(preflight) : null,
    intent_identity: preflight?.readiness === "READY" && aggregate ? buildJ2aIntentIdentity(preflight, aggregate) : null,
    lifecycle,
    preflight,
    aggregate_version: aggregate?.aggregate_version ?? null,
    current_assessment: assessment ? {
      assessment_id: assessment.record.assessment_id,
      assessment_hash: assessment.hash,
      decision: assessment.record.decision,
      reasons: assessment.record.reasons,
      validated_findings: assessment.record.race?.result.validated_findings ?? [],
      missing_evidence: assessment.record.missing_evidence,
      provider_mode: assessment.record.provider_mode,
      provider_name: assessment.record.provider_name,
      model_id: assessment.record.model_id,
    } : null,
    authorization_current: authorizationCurrent,
    pae_verification: { status: paeVerificationStatus, error_code: paeVerificationErrorCode },
    packet_error_code: packetErrorCode,
    authorization: authorization ? {
      actor_role: authorization.approval_record.actor_role,
      approval_id: authorization.approval_record.approval_id,
      assurance_result: authorization.assurance_record.result,
      pae_instruction_hash: authorization.sealed_pae.instruction_hash,
      pae_expiry: authorization.sealed_pae.payload.expiry,
    } : null,
    execution,
    execution_gate: executionGate,
    execution_packet: packet,
  });
}
