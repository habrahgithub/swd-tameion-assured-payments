import { DEMO_ORGANIZATION_ID, type DemoState } from "./demo-state";
import { getAuthorizedReviewedAssessment } from "../demo/authorized-assessment-lineage";
import { buildJ2aExecutionPacket, hashJ2aPreflightEvidence } from "../demo/real-testnet-payment";
import { verifySealedPae } from "../pae/sign-verify";

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
