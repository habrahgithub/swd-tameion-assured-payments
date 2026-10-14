import {matchesPaymentRelease,type PaymentReleaseBinding} from '../domain/payment-release-approval';
import { NextResponse } from "next/server";
import { AuthorityError } from "../authority/aggregate";
import { DEMO_ARC_TRUST_SIMULATED, DEMO_ORGANIZATION_ID, type ExistingState } from "./load-existing-demo-state";
import { buildPaymentTruthLayers } from "../domain/payment-control-boundary";
import { getCurrentSettlementProxyPacket, getSettlementEvidenceBinding } from "./settlement-proxy-packet";
import { projectAssuranceEvidence } from "./assurance-evidence-projection";

/** Pure projections of an already loaded state. No hydration, provider I/O,
 * recovery or persistence. Source admission belongs to the calling GET boundary.
 * Browser fixtures use these same projections with independently invented data.
 */
export function projectObligationListData(state: ExistingState) {
  const obligations = state.listObligations().map((o) => {
    const sealed = state.store.getSealedAssessment(DEMO_ORGANIZATION_ID, o.obligation_id);
    const current = state.store.get(DEMO_ORGANIZATION_ID, o.obligation_id);
    const sealedPae = state.getSealedPae(o.obligation_id);
    const execution = sealedPae ? state.worker.getExecutionRecord(sealedPae.payload.idempotency_key) : undefined;
    const routeAssuranceReady = !DEMO_ARC_TRUST_SIMULATED &&
      current.product_trust_provenance === "CURRENT_PRODUCT_EVIDENCE" &&
      current.destination_verification_status === "VERIFIED" &&
      current.destination_operational_status === "ACTIVE" &&
      current.source_wallet_status === "ACTIVE";
    // A sealed assessment only counts toward coverage while it is still
    // bound to the obligation's current version — the same staleness rule
    // approve() itself enforces (AUT-009); a stale assessment must not be
    // shown as "assessed" here either.
    const isCurrent = sealed?.record.aggregate_version === String(current.aggregate_version);
    return {
      ...o,
      assessed: isCurrent,
      decision: isCurrent ? sealed?.record.decision : null,
      provider_mode: isCurrent ? sealed?.record.provider_mode : null,
      aggregate_state: current.state,
      pae_sealed: Boolean(sealedPae),
      execution_status: execution?.status ?? null,
      route_assurance_status: routeAssuranceReady ? "Route assurance ready" : "Route assurance not ready",
    };
  });
  return {
    obligations,
    assessed_count: obligations.filter((o) => o.assessed).length,
    total_count: obligations.length,
  };
}

export function projectObligationList(state: ExistingState) {
  return NextResponse.json(projectObligationListData(state));
}

export function projectObligationDetail(state: ExistingState, id: string, financialActionEligible = true, releaseContext?: {namespace:string;operator_key:string;credential_version:number} & Partial<PaymentReleaseBinding>) {
  try {
    let aggregate = state.store.get(DEMO_ORGANIZATION_ID, id);
    let record = state.getRecord(id);
    let canonicalObligation = state.getCanonicalObligation(id);
    if (!record || !canonicalObligation) {
      return NextResponse.json({ error: "Obligation source record not found" }, { status: 404 });
    }
    let currentAssessment = state.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, id);
    let sealed = state.getSealedPae(id);
    let execution = sealed ? state.worker.getExecutionRecord(sealed.payload.idempotency_key) : undefined;
    let executionKillSwitched = state.store.isExecutionKillSwitched(DEMO_ORGANIZATION_ID, id);
    let executionPacket: ReturnType<typeof getCurrentSettlementProxyPacket> = null;
    let providerStatus = "NOT_SUBMITTED";
    // Observational only: this GET must not recover, reconcile, persist or query
    // a provider. Historical evidence remains exactly as durably recorded.
    providerStatus = execution?.status ?? "NOT_SUBMITTED";
    aggregate = state.store.get(DEMO_ORGANIZATION_ID, id);
    record = state.getRecord(id);
    canonicalObligation = state.getCanonicalObligation(id);
    currentAssessment = state.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, id);
    sealed = state.getSealedPae(id);
    execution = sealed ? state.worker.getExecutionRecord(sealed.payload.idempotency_key) : undefined;
    executionKillSwitched = state.store.isExecutionKillSwitched(DEMO_ORGANIZATION_ID, id);
    executionPacket = getCurrentSettlementProxyPacket(state, id);
    const release=state.getPaymentReleaseApproval?.(id);
    let actor;try {actor=state.resolveDesignatedApprover?.();}catch { /* unavailable authority stays locked */ }
    const releaseContextReady=Boolean(releaseContext?.source_binding_sha256&&releaseContext?.requester_binding_sha256&&actor&&state.providerAdapter.name==='arc-circle-live');
    const releaseCurrent=Boolean(releaseContextReady&&executionPacket&&matchesPaymentRelease(release,{
      ...releaseContext,packet_sha256:executionPacket?.packet_sha256,pae_instruction_hash:sealed?.instruction_hash,
      organization_id:DEMO_ORGANIZATION_ID,obligation_id:id,aggregate_version:aggregate.aggregate_version,
      actor_id:actor?.actor_id,actor_role:actor?.actor_role,authority_version:actor?.authority_version,
    }));
    const releaseActionable=aggregate.state==='AUTHORIZED'&&aggregate.pae_state==='UNUSED'&&aggregate.execution_state==='NONE'&&!executionKillSwitched;
    const releaseGate=execution
      ? ['UNKNOWN','SUBMITTING'].includes(execution.status)?'RECONCILIATION_ONLY':'EXECUTION_ALREADY_RECORDED'
      : !executionPacket||!releaseActionable?'LOCKED_UNTIL_CURRENT_AUTHORIZATION'
      : !releaseContextReady?'PORTAL_RELEASE_UNAVAILABLE'
      : releaseCurrent?'PORTAL_APPROVED_EXACT_PACKET'
      : release?'PORTAL_RELEASE_RENEWAL_REQUIRED':'PORTAL_RELEASE_APPROVAL_REQUIRED';
    const settlementEvidenceBinding = getSettlementEvidenceBinding(state, id, executionPacket);
    if (!record || !canonicalObligation) {
      return NextResponse.json({ error: "Obligation source record not found" }, { status: 404 });
    }
    const settlementRuntime = state.providerAdapter.name === "fake-testnet" ? "SIMULATED" as const : "LIVE" as const;
    const truth = buildPaymentTruthLayers({
      obligation: canonicalObligation,
      source_obligation_state: record.state_at_event_baseline,
      aggregate_version: aggregate.aggregate_version,
      aggregate_state: aggregate.state,
      pae_state: aggregate.pae_state,
      execution_state: aggregate.execution_state,
      current_assessment_present: Boolean(currentAssessment),
      pae_sealed: Boolean(sealed),
      execution_kill_switched: executionKillSwitched,
      network: aggregate.network,
      settlement_status: providerStatus,
      provider_ref: execution?.provider_ref ?? null,
      settlement_runtime: settlementRuntime,
      settlement_amount: aggregate.amount,
      settlement_atomic_amount: (() => {
        const [whole, fractional] = aggregate.amount.split(".");
        return (BigInt(whole) * 1_000_000n + BigInt(fractional)).toString(10);
      })(),
      source_amount: aggregate.source_amount ?? "UNKNOWN",
      source_currency: aggregate.source_currency ?? "UNKNOWN",
      settlement_conversion_rate: aggregate.settlement_conversion_rate ?? null,
    });
    const assuranceEvidence = projectAssuranceEvidence({
      organizationId: DEMO_ORGANIZATION_ID,
      obligationId: id,
      aggregate,
      executionReleaseAuthority: truth.tameion_control_truth.execution_release_authority,
      executionKillSwitched,
      execution: execution ?? null,
      sealedPae: sealed ?? null,
      authorizationArtifacts: state.getAuthorizationArtifacts(id) ?? null,
      trustedKeys: state.trustedKeys.export(),
      now: new Date(),
    });
    return NextResponse.json({
      financial_action_eligible: financialActionEligible,
      truth,
      aggregate,
      record,
            current_assessment: currentAssessment ? {
        obligation_id: currentAssessment.record.obligation_id,
        assessment_id: currentAssessment.record.assessment_id,
        assessment_hash: currentAssessment.hash,
        aggregate_version: currentAssessment.record.aggregate_version,
        decision: currentAssessment.record.decision,
        reasons: currentAssessment.record.reasons,
        provider_used: currentAssessment.record.provider_name,
        provider_mode: currentAssessment.record.provider_mode,
        ...(currentAssessment.record.race ? { race: currentAssessment.record.race } : {}),
      } : null,
      demo_arc_trust_simulated: aggregate.product_trust_provenance === "SIMULATED_DEMO_FIXTURE",
      pae_sealed: Boolean(sealed),
      execution: execution ?? null,
      settlement_proxy: state.getSettlementProxy(id) ?? null,
      source_settlement_disclosure: "Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.",
      source_payable_state: record.state_at_event_baseline,
      execution_packet: executionPacket,
      settlement_evidence_binding: settlementEvidenceBinding,
      sealed_pae_instruction_hash: sealed?.instruction_hash ?? null,
      payment_release_approval: release ? {approved_at:release.record.approved_at,expires_at:release.record.expires_at,actor_id:release.record.actor_id} : null,
      payment_release_current: releaseCurrent && releaseActionable && !execution,
      execution_gate: releaseGate,
      execution_kill_switched: executionKillSwitched,
      assurance_evidence: assuranceEvidence,
    });
  } catch (error) {
    if (error instanceof AuthorityError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 404 });
    }
    throw error;
  }
}
