import { DEMO_ORGANIZATION_ID, type DemoState } from "./demo-state";
import { getAuthorizedReviewedAssessment } from "../demo/authorized-assessment-lineage";
import { buildJ2aExecutionPacket, hashJ2aPreflightEvidence } from "../demo/real-testnet-payment";
import { decimalToAtomicAtScale } from "../j0d-spike/intent";
import { verifyHistoricalPaeSignature, verifySealedPae } from "../pae/sign-verify";
import { verifyDurableApprovalRecordHash, verifyDurableAssuranceRecordHash } from "../pae/durable-records";

export type SettlementEvidenceBinding =
  | { state: "AVAILABLE_CURRENT_BINDING" | "AVAILABLE_HISTORICAL"; packet: ReturnType<typeof buildJ2aExecutionPacket> }
  | { state: "UNAVAILABLE" | "INVALID" };

/** Resolve the already-authorized exact packet from persisted source and proxy
 * facts. This is read-only and is shared by detail rendering and execution. */
export function getCurrentSettlementProxyPacket(state: DemoState, obligationId: string) {
  const proxy = state.getSettlementProxy(obligationId);
  const sealedPae = state.getSealedPae(obligationId);
  const authorization = state.getAuthorizationArtifacts(obligationId);
  if (!proxy || !sealedPae || !authorization) return null;
  const aggregate = state.store.get(DEMO_ORGANIZATION_ID, obligationId);
  // Human approval advances the aggregate exactly once; the stored proxy is
  // bound to the preceding (prepared) version and the sealed PAE to this one.
  const expectedAtomic = (() => {
    const [whole, fractional] = aggregate.amount.split(".");
    return (BigInt(whole) * 1_000_000n + BigInt(fractional)).toString(10);
  })();
  if (proxy.mapped_aggregate_version + 1 !== aggregate.aggregate_version ||
      proxy.preflight.organization_id !== DEMO_ORGANIZATION_ID || proxy.preflight.obligation_id !== obligationId ||
      proxy.preflight.amount !== aggregate.amount || proxy.preflight.source_amount !== aggregate.source_amount ||
      proxy.preflight.source_currency !== aggregate.source_currency ||
      proxy.preflight.business_payment_instruction.payer.organization_id !== DEMO_ORGANIZATION_ID ||
      proxy.preflight.business_payment_instruction.commercial.obligation_id !== obligationId ||
      proxy.preflight.business_payment_instruction.commercial.source_amount !== aggregate.source_amount ||
      proxy.preflight.business_payment_instruction.commercial.source_currency !== aggregate.source_currency ||
      proxy.preflight.business_payment_instruction.commercial.settlement_amount !== aggregate.amount ||
      hashJ2aPreflightEvidence(proxy.preflight as unknown as Record<string, unknown>) !== proxy.preflight.evidence_sha256 ||
      !aggregate.evidence_hashes.includes(proxy.preflight.evidence_sha256) ||
      aggregate.destination_ref !== `ARC-TESTNET-SETTLEMENT-PROXY:${proxy.preflight.destination_wallet.id}` ||
      aggregate.destination_address.toLowerCase() !== proxy.preflight.destination_wallet.address.toLowerCase() ||
      sealedPae.payload.organization_id !== DEMO_ORGANIZATION_ID || sealedPae.payload.obligation_ids.length !== 1 ||
      sealedPae.payload.obligation_ids[0] !== obligationId || sealedPae.payload.aggregate_version !== String(aggregate.aggregate_version) ||
      sealedPae.payload.amount !== aggregate.amount || sealedPae.payload.asset !== "USDC" || sealedPae.payload.network !== "ARC_TESTNET" ||
      sealedPae.payload.atomic_amount !== expectedAtomic || sealedPae.payload.source_wallet_ref !== proxy.preflight.source_wallet.id ||
      sealedPae.payload.source_wallet_version !== String(aggregate.source_wallet_version) ||
      sealedPae.payload.counterparty_id !== aggregate.counterparty_id ||
      sealedPae.payload.counterparty_version !== String(aggregate.counterparty_version) ||
      sealedPae.payload.destination_ref !== aggregate.destination_ref ||
      sealedPae.payload.destination_version !== String(aggregate.destination_version) ||
      sealedPae.payload.destination_address.toLowerCase() !== proxy.preflight.destination_wallet.address.toLowerCase() ||
      sealedPae.payload.evidence_hashes.length !== aggregate.evidence_hashes.length ||
      sealedPae.payload.evidence_hashes.some((hash, index) => hash !== [...aggregate.evidence_hashes].sort()[index]) ||
      !sealedPae.payload.idempotency_key ||
      !sealedPae.payload.evidence_hashes.includes(proxy.preflight.evidence_sha256)) return null;

  try {
    verifySealedPae(sealedPae, state.trustedKeys);
  } catch {
    return null;
  }
  const assessment = getAuthorizedReviewedAssessment(
    state.store,
    DEMO_ORGANIZATION_ID,
    obligationId,
    aggregate.aggregate_version,
    authorization,
    sealedPae,
  );
  if (!assessment || assessment.record.provider_mode !== "LIVE_AI" || assessment.record.decision !== "PAY" ||
      assessment.record.missing_evidence.length || (assessment.record.race?.result.validated_findings.length ?? 0) ||
      (assessment.record.race?.remediation.length ?? 0) || authorization.assurance_record.result !== "PASS" ||
      Date.parse(sealedPae.payload.expiry) <= Date.now()) return null;
  try {
    return buildJ2aExecutionPacket({
      preflight: proxy.preflight,
      aggregate,
      assessment: assessment.record,
      assessmentHash: assessment.hash,
      sealedPae,
    });
  } catch {
    return null;
  }
}

/**
 * A display-only binding for an already SETTLED record when current release
 * authority no longer resolves. It verifies the archived PAE signature and
 * durable approval/assurance/preflight chain, then binds CONFIRMED provider
 * evidence to that exact instruction. It never feeds execute or release gates.
 */
export function getSettlementEvidenceBinding(
  state: DemoState,
  obligationId: string,
  currentPacket: ReturnType<typeof getCurrentSettlementProxyPacket>,
): SettlementEvidenceBinding {
  if (currentPacket) return { state: "AVAILABLE_CURRENT_BINDING", packet: currentPacket };
  const sealedPae = state.getSealedPae(obligationId);
  const authorization = state.getAuthorizationArtifacts(obligationId);
  const proxy = state.getSettlementProxy(obligationId);
  if (!sealedPae || !authorization || !proxy) return { state: "UNAVAILABLE" };
  const execution = state.worker.getExecutionRecord(sealedPae.payload.idempotency_key);
  if (!execution || execution.status !== "SETTLED") return { state: "UNAVAILABLE" };
  const providerEvidence = execution.provider_evidence;
  if (!providerEvidence || providerEvidence.status !== "CONFIRMED") return { state: "UNAVAILABLE" };

  try {
    const payload = sealedPae.payload;
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, obligationId);
    const source = state.getRecord(obligationId);
    const preflight = proxy.preflight;
    const key = state.trustedKeys.export().find((entry) =>
      entry.signing_key_id === payload.signing_key_id && entry.signing_algorithm === payload.signing_algorithm,
    );
    const evidence = payload.approval_evidence[0];
    const providerAmount = providerEvidence.atomic_amount ?? providerEvidence.atomicAmount;
    const providerDestination = providerEvidence.destination_address ?? providerEvidence.destinationAddress;
    const expectedProviderAtomic = decimalToAtomicAtScale(preflight.amount, preflight.provider_token.decimals);
    const sixDecimalAtomic = decimalToAtomicAtScale(preflight.amount, 6);
    const archivedAssessment = getAuthorizedReviewedAssessment(
      state.store,
      DEMO_ORGANIZATION_ID,
      obligationId,
      Number(payload.aggregate_version),
      authorization,
      sealedPae,
    );

    if (!key || !source || !evidence || payload.organization_id !== DEMO_ORGANIZATION_ID ||
        payload.obligation_ids.length !== 1 || payload.obligation_ids[0] !== obligationId ||
        payload.aggregate_version !== String(aggregate.aggregate_version) ||
        payload.aggregate_version !== String(proxy.mapped_aggregate_version + 1) ||
        authorization.sealed_pae.instruction_hash !== sealedPae.instruction_hash ||
        authorization.sealed_pae.signature !== sealedPae.signature ||
        !verifyDurableApprovalRecordHash(authorization.approval_record, authorization.approval_record_hash) ||
        !verifyDurableAssuranceRecordHash(authorization.assurance_record, authorization.assurance_hash) ||
        authorization.assurance_record.result !== "PASS" ||
        authorization.assurance_hash !== payload.assurance_hash ||
        authorization.assurance_record.organization_id !== payload.organization_id ||
        authorization.assurance_record.obligation_id !== obligationId ||
        authorization.assurance_record.aggregate_version !== payload.aggregate_version ||
        authorization.assurance_record.policy_version !== payload.policy_version ||
        authorization.approval_record_hash !== evidence.approval_record_hash ||
        authorization.approval_record.approval_id !== evidence.approval_id ||
        authorization.approval_record.organization_id !== evidence.organization_id ||
        authorization.approval_record.obligation_id !== evidence.obligation_id ||
        authorization.approval_record.actor_id !== evidence.actor_id ||
        authorization.approval_record.actor_role !== evidence.actor_role ||
        authorization.approval_record.authority_version !== evidence.authority_version ||
        authorization.approval_record.assessment_hash !== evidence.assessment_hash ||
        !archivedAssessment || archivedAssessment.record.provider_mode !== "LIVE_AI" || archivedAssessment.record.decision !== "PAY" ||
        archivedAssessment.record.missing_evidence.length !== 0 || archivedAssessment.record.race?.result.validated_findings.length !== 0 ||
        archivedAssessment.record.race?.remediation.length !== 0 ||
        hashJ2aPreflightEvidence(preflight as unknown as Record<string, unknown>) !== preflight.evidence_sha256 ||
        !aggregate.evidence_hashes.includes(preflight.evidence_sha256) ||
        source.obligation_id !== obligationId || source.amount !== preflight.source_amount || source.currency !== preflight.source_currency ||
        source.source_evidence.map((item) => item.evidence_id).join("\0") !== preflight.source_evidence_ids.join("\0") ||
        preflight.organization_id !== payload.organization_id || preflight.obligation_id !== obligationId ||
        preflight.amount !== payload.amount || preflight.amount !== aggregate.amount ||
        preflight.source_amount !== aggregate.source_amount || preflight.source_currency !== aggregate.source_currency ||
        preflight.business_payment_instruction.payer.organization_id !== payload.organization_id ||
        preflight.business_payment_instruction.commercial.obligation_id !== obligationId ||
        preflight.business_payment_instruction.commercial.source_amount !== source.amount ||
        preflight.business_payment_instruction.commercial.source_currency !== source.currency ||
        preflight.business_payment_instruction.commercial.settlement_amount !== payload.amount ||
        payload.asset !== "USDC" || payload.network !== "ARC_TESTNET" ||
        sixDecimalAtomic === null || expectedProviderAtomic === null ||
        payload.atomic_amount !== sixDecimalAtomic.toString(10) ||
        payload.source_wallet_ref !== preflight.source_wallet.id ||
        payload.source_wallet_ref !== aggregate.source_wallet_ref ||
        payload.destination_address.toLowerCase() !== preflight.destination_wallet.address.toLowerCase() ||
        payload.destination_address.toLowerCase() !== aggregate.destination_address.toLowerCase() ||
        payload.destination_ref !== aggregate.destination_ref ||
        payload.destination_ref !== `ARC-TESTNET-SETTLEMENT-PROXY:${preflight.destination_wallet.id}` ||
        payload.counterparty_id !== preflight.beneficiary_id || payload.counterparty_id !== aggregate.counterparty_id ||
        !payload.evidence_hashes.includes(preflight.evidence_sha256) ||
        execution.obligation_id !== obligationId || execution.idempotency_key !== payload.idempotency_key ||
        execution.atomic_amount !== payload.atomic_amount || execution.destination_address.toLowerCase() !== payload.destination_address.toLowerCase() ||
        providerAmount !== payload.atomic_amount || providerDestination?.toLowerCase() !== payload.destination_address.toLowerCase() ||
        (providerEvidence.provider_token_decimals !== undefined && providerEvidence.provider_token_decimals !== preflight.provider_token.decimals) ||
        (preflight.provider_token.decimals > 6 && providerEvidence.provider_atomic_amount !== expectedProviderAtomic.toString(10))) {
      return { state: "INVALID" };
    }

    verifyHistoricalPaeSignature(sealedPae, key.public_key_spki_base64url);
    const packet = buildJ2aExecutionPacket({
      preflight,
      aggregate,
      assessment: archivedAssessment.record,
      assessmentHash: archivedAssessment.hash,
      sealedPae,
    });
    return { state: "AVAILABLE_HISTORICAL", packet };
  } catch {
    return { state: "INVALID" };
  }
}
