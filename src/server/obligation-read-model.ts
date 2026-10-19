import {contentHash} from '../domain/linked-instruction';
import {matchesPaymentRelease,type PaymentReleaseBinding} from '../domain/payment-release-approval';
import { NextResponse } from "next/server";
import { AuthorityError } from "../authority/aggregate";
import { DEMO_ARC_TRUST_SIMULATED, DEMO_ORGANIZATION_ID, type ExistingState } from "./load-existing-demo-state";
import { buildPaymentTruthLayers } from "../domain/payment-control-boundary";
import { getCurrentSettlementProxyPacket, getSettlementEvidenceBinding } from "./settlement-proxy-packet";
import { projectAssuranceEvidence } from "./assurance-evidence-projection";
import { sameEvmAddressIdentity } from "../execution/evm-address";

/** Pure projections of an already loaded state. No hydration, provider I/O,
 * recovery or persistence. Source admission belongs to the calling GET boundary.
 * Browser fixtures use these same projections with independently invented data.
 */
export type ObligationSourceGroup = "GENUINE_COMPANY" | "DEMO_ARC_TESTNET" | "UNVERIFIED";
export type SelectedFinancialScopeBinding = {
  namespace: string;
  selected_obligation_id: string;
  selected_source_record_sha256: string;
  source_valid_until: string;
};

export type SelectedFinancialScopeObservation = {
  schema_version: "SELECTED-FINANCIAL-SCOPE-1";
  status: "PASS" | "BLOCKED" | "UNAVAILABLE";
  scope: "CONTROLLED_FINANCIAL_NAMESPACE";
  namespace: string;
  selected_obligation_id: string;
  selected_aggregate_version: number;
  selected_source_record_sha256: string;
  source_valid_until: string;
  observed_at: string;
  membership: "COMPLETE" | "UNAVAILABLE";
  assessment_coverage: { status: "PASS" | "BLOCKED" | "UNAVAILABLE" };
  competing_candidate: { status: "NONE" | "PRESENT" | "UNAVAILABLE" };
  uncertain_execution: { status: "NONE" | "PRESENT" | "UNAVAILABLE" };
  reason: string;
};

/** Read-only parity projection for the selected controlled instruction. The
 * canonical AUT-012/AUT-008 predicates remain owned by AuthorityStore; this
 * function only reports their result for the complete restored namespace. */
export function projectSelectedFinancialScope(
  state: ExistingState,
  id: string,
  aggregateVersion: number,
  binding?: SelectedFinancialScopeBinding,
): SelectedFinancialScopeObservation | null {
  if (!binding) return null;
  const observedAt = new Date().toISOString();
  const unavailable = (reason: string): SelectedFinancialScopeObservation => ({
    schema_version: "SELECTED-FINANCIAL-SCOPE-1",
    status: "UNAVAILABLE",
    scope: "CONTROLLED_FINANCIAL_NAMESPACE",
    namespace: binding.namespace,
    selected_obligation_id: id,
    selected_aggregate_version: aggregateVersion,
    selected_source_record_sha256: binding.selected_source_record_sha256,
    source_valid_until: binding.source_valid_until,
    observed_at: observedAt,
    membership: "UNAVAILABLE",
    assessment_coverage: { status: "UNAVAILABLE" },
    competing_candidate: { status: "UNAVAILABLE" },
    uncertain_execution: { status: "UNAVAILABLE" },
    reason,
  });
  try {
    if (
      binding.selected_obligation_id !== id ||
      !binding.namespace || binding.namespace.length > 128 ||
      !/^[a-f0-9]{64}$/.test(binding.selected_source_record_sha256) ||
      !Number.isFinite(Date.parse(binding.source_valid_until)) ||
      Date.parse(binding.source_valid_until) <= Date.now()
    ) return unavailable("The selected controlled source binding is unavailable or no longer current.");

    const restoredAggregates = state.store.exportSnapshot().aggregates;
    const aggregates = restoredAggregates.filter((item) => item.organization_id === DEMO_ORGANIZATION_ID);
    const unclassifiedOrganizationPresent = restoredAggregates.some((item) => item.organization_id !== DEMO_ORGANIZATION_ID);
    const selected = aggregates.filter((item) => item.obligation_id === id);
    if (selected.length !== 1 || selected[0].aggregate_version !== aggregateVersion) {
      return unavailable("The selected controlled instruction does not match the current financial state.");
    }

    const executionRecords = state.getCompleteExecutionRecords?.();
    if (!Array.isArray(executionRecords)) {
      return unavailable("Complete controlled payment history is unavailable.");
    }
    const aggregateById = new Map<string, (typeof aggregates)[number]>();
    let ledgerIntegrity = true;
    for (const aggregate of aggregates) {
      if (aggregateById.has(aggregate.obligation_id)) ledgerIntegrity = false;
      aggregateById.set(aggregate.obligation_id, aggregate);
    }
    const executionByKey = new Map<string, (typeof executionRecords)[number]>();
    let uncertainExecutionPresent = false;
    const validExecutionStatuses = new Set(["SUBMITTING", "SETTLED", "FAILED", "UNKNOWN", "BLOCKED"]);
    for (const record of executionRecords) {
      const providerReferenceValid = record?.provider_ref === null || (
        typeof record?.provider_ref === "string" &&
        record.provider_ref.length > 0 &&
        record.provider_ref.length <= 256 &&
        /^[\x20-\x7e]+$/.test(record.provider_ref)
      );
      const structurallyValid = Boolean(
        record && typeof record === "object" &&
        typeof record.obligation_id === "string" && record.obligation_id.length > 0 &&
        typeof record.idempotency_key === "string" && record.idempotency_key.length > 0 &&
        typeof record.atomic_amount === "string" && /^(0|[1-9][0-9]*)$/.test(record.atomic_amount) &&
        typeof record.destination_address === "string" &&
        validExecutionStatuses.has(record.status) &&
        providerReferenceValid &&
        (record.status !== "SUBMITTING" || record.provider_ref === null) &&
        (!["SETTLED", "FAILED"].includes(record.status) || record.provider_ref !== null),
      );
      if (!structurallyValid) {
        ledgerIntegrity = false;
        continue;
      }
      if (record.status === "SUBMITTING" || record.status === "UNKNOWN") uncertainExecutionPresent = true;
      if (executionByKey.has(record.idempotency_key)) ledgerIntegrity = false;
      executionByKey.set(record.idempotency_key, record);
      const owner = aggregateById.get(record.obligation_id);
      const sealedPae = owner ? state.getSealedPae(owner.obligation_id) : undefined;
      if (
        !owner || owner.execution_idempotency_key !== record.idempotency_key ||
        !sealedPae || sealedPae.payload.organization_id !== DEMO_ORGANIZATION_ID ||
        sealedPae.payload.obligation_ids.length !== 1 || sealedPae.payload.obligation_ids[0] !== record.obligation_id ||
        sealedPae.payload.idempotency_key !== record.idempotency_key ||
        sealedPae.payload.atomic_amount !== record.atomic_amount ||
        !sameEvmAddressIdentity(sealedPae.payload.destination_address, record.destination_address)
      ) ledgerIntegrity = false;
    }
    for (const aggregate of aggregates) {
      const aggregateUncertain = ["RESERVED", "SUBMITTING", "SUBMITTED", "CONFIRMING", "UNKNOWN"].includes(aggregate.execution_state);
      if (aggregateUncertain) uncertainExecutionPresent = true;
      if ((aggregate.execution_state === "NONE") !== (aggregate.execution_idempotency_key === null)) ledgerIntegrity = false;
      if (aggregate.execution_idempotency_key) {
        const record = executionByKey.get(aggregate.execution_idempotency_key);
        if (!record || record.obligation_id !== aggregate.obligation_id) ledgerIntegrity = false;
      }
    }
    // An unresolved submission is the highest-priority safety fact even when
    // its identity evidence is incomplete. Other malformed/asymmetric ledger
    // evidence cannot support a PASS observation.
    if (!ledgerIntegrity && !uncertainExecutionPresent) {
      return unavailable("Complete controlled payment history could not be verified.");
    }

    const coverageBlocker = state.store.findUnassessedObligation(DEMO_ORGANIZATION_ID);
    const competingId = state.store.findCommittedCandidateExcluding(DEMO_ORGANIZATION_ID, id);
    const assessmentCoverage = coverageBlocker
      ? { status: "BLOCKED" as const }
      : { status: "PASS" as const };
    const competingCandidate = competingId
      ? { status: "PRESENT" as const }
      : { status: "NONE" as const };
    const uncertainExecution = uncertainExecutionPresent
      ? { status: "PRESENT" as const }
      : { status: "NONE" as const };
    const membership = aggregates.length === 1 && !unclassifiedOrganizationPresent && ledgerIntegrity
      ? "COMPLETE" as const
      : "UNAVAILABLE" as const;

    let status: SelectedFinancialScopeObservation["status"] = "PASS";
    let reason = "Selected controlled instruction is current in the complete controlled financial namespace.";
    if (uncertainExecutionPresent) {
      status = "BLOCKED";
      reason = "An existing controlled payment is submitting or has an unknown outcome and must be reconciled first.";
    } else if (coverageBlocker) {
      status = "BLOCKED";
      reason = "The controlled financial namespace contains an instruction without a current assessment.";
    } else if (competingId) {
      status = "BLOCKED";
      reason = "Another controlled instruction is already committed for payment.";
    } else if (selected[0].state === "CANCELLED") {
      status = "BLOCKED";
      reason = "The selected controlled instruction is cancelled.";
    } else if (membership === "UNAVAILABLE") {
      status = "UNAVAILABLE";
      reason = "Complete approved membership of the controlled financial namespace is unavailable.";
    }

    return {
      schema_version: "SELECTED-FINANCIAL-SCOPE-1",
      status,
      scope: "CONTROLLED_FINANCIAL_NAMESPACE",
      namespace: binding.namespace,
      selected_obligation_id: id,
      selected_aggregate_version: aggregateVersion,
      selected_source_record_sha256: binding.selected_source_record_sha256,
      source_valid_until: binding.source_valid_until,
      observed_at: observedAt,
      membership,
      assessment_coverage: assessmentCoverage,
      competing_candidate: competingCandidate,
      uncertain_execution: uncertainExecution,
      reason,
    };
  } catch {
    return unavailable("The controlled financial namespace could not be verified.");
  }
}
export function projectObligationListData(state: ExistingState, sourceGroup: ObligationSourceGroup = "UNVERIFIED", bindAdvisorySource=false) {
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
    const unresolvedAssessment=["UNKNOWN","IN_PROGRESS"].includes(state.getGenuineAssessmentVisibility?.(o.obligation_id).status??"");
    // A disposition child's receipt is current only for its own seal and the matching current source/version/binding.
    const disposition = state.getGenuineAssessmentVisibility?.(o.obligation_id).disposition;
    const dispositionReceiptStale = disposition?.state === "USED" && sealed !== undefined && sealed.hash === disposition.child_seal_hash && !disposition.child_current;
    const isCurrent = !unresolvedAssessment && !dispositionReceiptStale && sealed?.record.aggregate_version === String(current.aggregate_version) && (!bindAdvisorySource||sealed?.record.source_record_sha256===contentHash(state.getRecord(o.obligation_id)));
    return {
      ...o,
      source_group: sourceGroup,
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

export function projectObligationDetail(state: ExistingState, id: string, financialActionEligible = true, releaseContext?: {namespace:string;operator_key:string;credential_version:number} & Partial<PaymentReleaseBinding>, sourceGroup: ObligationSourceGroup = "UNVERIFIED", advisorySourceHash?:string, selectedFinancialScopeBinding?:SelectedFinancialScopeBinding) {
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
    if(advisorySourceHash&&currentAssessment?.record.source_record_sha256!==advisorySourceHash)currentAssessment=undefined;
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
      source_group: sourceGroup,
      selected_financial_scope: financialActionEligible && sourceGroup === "DEMO_ARC_TESTNET"
        ? projectSelectedFinancialScope(state, id, aggregate.aggregate_version, selectedFinancialScopeBinding)
        : null,
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
