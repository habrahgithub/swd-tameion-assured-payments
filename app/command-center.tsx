"use client";
import type {LinkedInstruction} from "../src/domain/linked-instruction";
import type {GenuineAssessmentStatus} from "../src/server/genuine-assessment-status";
import {canonicalize} from "json-canonicalize";
import {TameionBrand} from "./tameion-brand";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { decimalToAtomic, USDC_DECIMALS } from "../src/domain/numeric";
import type { RaceAssessment } from "../src/agent/schema";
import type { PaymentTruthLayers } from "../src/domain/payment-control-boundary";
import {
  assessmentReviewSnapshot,
  currentReviewedAssessment,
  type AssessmentReviewSnapshot,
  type ProviderRuntimeTruth,
} from "../src/client/assessment-review-snapshot";
import { executionResponseNeedsReconciliation, assessmentEarlierReference, assessmentReceiptIdentity, assessmentReceiptSnapshot, interpretPostResponse, isCurrentGeneration, isCurrentRequest, isSameIdentity, parseJsonBody } from "../src/client/command-center-requests";
import { assessmentNextAction, buildAssessmentTrace, hasExpectedObligationIdentity, hasSimulatedTrustFixture, judgeReadableState, settlementDisplay } from "../src/client/command-center-state";
interface ObligationSummary {
  source_group?: "GENUINE_COMPANY" | "DEMO_ARC_TESTNET" | "UNVERIFIED";
  obligation_id: string;
  service_category: string;
  amount: string;
  currency: "AED" | "USD";
  recurrence: string;
  due_date: string | null;
  commercial_terms: string;
  beneficiary_name?: string | null;
  assessed: boolean;
  decision: string | null;
  provider_mode: "LIVE_AI" | "NOT_LIVE_AI" | "BLOCKED_EXTERNAL" | null;
  aggregate_state?: string;
  pae_sealed?: boolean;
  execution_status?: string | null;
  route_assurance_status?: "Route assurance ready" | "Route assurance not ready";
}

export interface ObservedWalletBalance {
  amount: string;
  asset: "USDC";
  captured_at: string;
  network: string;
}

export function selectedObligationInitialStage(decision: string | null | undefined): "Obligation" | "Assessment" {
  return decision === "HOLD" || decision === "ESCALATE" ? "Assessment" : "Obligation";
}

type AssuranceEvidenceView =
  | { state: "NOT_CREATED" | "UNAVAILABLE" | "INVALID"; message: string; control_results: [] }
  | { state: "AVAILABLE_CURRENT_BINDING" | "AVAILABLE_HISTORICAL"; message: string; control_results: ControlResultView[]; overall: "PASS"; assurance_id: string; recorded_at: string; aggregate_version: string; policy_version: string };

interface AggregateView {
  aggregate_version: number;
  state: string;
  amount: string;
  asset: string;
  network: string;
  destination_address: string;
  counterparty_id?: string;
  destination_verification_status: string;
  destination_operational_status: string;
  source_wallet_ref: string;
  source_wallet_status: string;
  product_trust_provenance?: string;
  execution_state: string;
  pae_state: string;
}

interface ObligationDetail {
  advisory_action_eligible?: boolean;
  linked_testnet_instructions?: LinkedInstruction[];
  source_group?: "GENUINE_COMPANY" | "DEMO_ARC_TESTNET" | "UNVERIFIED";
  financial_action_eligible: boolean;
  selected_financial_scope?: {
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
  } | null;
  truth: PaymentTruthLayers;
  aggregate: AggregateView;
  record: Record<string, unknown> & { obligation_id: string; amount: string; currency: string };
    current_assessment: {
    obligation_id: string;
    assessment_id: string;
    assessment_hash: string;
    aggregate_version: string;
    decision: "PAY" | "HOLD" | "ESCALATE";
    reasons: string[];
    provider_used?: string;
    provider_mode?: "LIVE_AI" | "NOT_LIVE_AI" | "BLOCKED_EXTERNAL";
    race?: RaceAssessment;
  } | null;
  demo_arc_trust_simulated: boolean;
  pae_sealed: boolean;
  execution: {
    obligation_id?: string;
    status: string;
    provider_ref: string | null;
    idempotency_key?: string;
    atomic_amount?: string;
    destination_address?: string;
    provider_evidence?: {
      status?: string;
      atomic_amount?: string;
      atomicAmount?: string;
      destination_address?: string;
      destinationAddress?: string;
      reconciled_at?: string;
      [key: string]: unknown;
    } | null;
  } | null;
  settlement_proxy?: {
    source_aggregate_version: number;
    mapped_aggregate_version: number;
    preflight: {
      profile: string;
      organization_id: string;
      obligation_id: string;
      source_amount: string;
      source_currency: string;
      source_evidence_ids?: string[];
      amount: string;
      asset: string;
      network: string;
      beneficiary_id?: string;
      business_payment_instruction?: {
        payer?: { organization_id?: string };
        beneficiary?: { beneficiary_id?: string; destination_wallet_id?: string };
        commercial?: {
          obligation_id?: string;
          source_amount?: string;
          source_currency?: string;
          settlement_amount?: string;
          settlement_asset?: string;
          source_evidence_id?: string;
          source_evidence_ids?: string[];
        };
      };
      source_wallet: { id: string; address: string };
      destination_wallet: { id: string; address: string; name?: string };
      captured_at: string;
      evidence_sha256: string;
      max_network_fee: string;
      estimated_network_fee: string;
      max_total_debit: string;
    };
  } | null;
  source_settlement_disclosure?: string;
  source_payable_state?: string;
  execution_packet?: { packet_sha256: string; packet?: Record<string, unknown> } | null;
  settlement_evidence_binding?: {
    state: "AVAILABLE_CURRENT_BINDING" | "AVAILABLE_HISTORICAL" | "UNAVAILABLE" | "INVALID";
    packet?: { packet_sha256: string; packet?: Record<string, unknown> };
  };
  sealed_pae_instruction_hash?: string | null;
  execution_gate?: string;
  payment_release_approval?: {approved_at:string;expires_at:string;actor_id:string} | null;
  payment_release_current?: boolean;
  execution_kill_switched: boolean;
  assurance_evidence?: AssuranceEvidenceView;
}

async function canonicalRecordSha256(record: Record<string, unknown>): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalize(record)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function selectedFinancialScopeReadiness(
  detail: ObligationDetail | null,
  selectedId: string,
  selectedSourceGroup: ObligationSummary["source_group"],
  lifetimeCurrent: boolean,
  now = Date.now(),
) {
  const controlledSelection = selectedSourceGroup === "DEMO_ARC_TESTNET" || detail?.source_group === "DEMO_ARC_TESTNET";
  if (!controlledSelection) {
    return { applies: false, ready: false, reason: "" };
  }
  if (!lifetimeCurrent || selectedSourceGroup !== "DEMO_ARC_TESTNET" || !detail || detail.financial_action_eligible !== true || detail.source_group !== "DEMO_ARC_TESTNET") {
    return { applies: true, ready: false, reason: "The selected controlled payment scope is unavailable. Refresh before continuing." };
  }
  const value = detail.selected_financial_scope;
  const observedAt = Date.parse(value?.observed_at ?? "");
  const validUntil = Date.parse(value?.source_valid_until ?? "");
  const identityCurrent = Boolean(
    value &&
    value.schema_version === "SELECTED-FINANCIAL-SCOPE-1" &&
    value.scope === "CONTROLLED_FINANCIAL_NAMESPACE" &&
    value.selected_obligation_id === selectedId &&
    value.selected_obligation_id === detail.record.obligation_id &&
    value.selected_aggregate_version === detail.aggregate.aggregate_version &&
    /^[a-f0-9]{64}$/.test(value.selected_source_record_sha256) &&
    Number.isFinite(observedAt) && observedAt <= now + 30_000 && now - observedAt <= 5 * 60_000 &&
    Number.isFinite(validUntil) && now < validUntil
  );
  const valid = Boolean(
    identityCurrent && value &&
    value.status === "PASS" &&
    value.membership === "COMPLETE" &&
    value.assessment_coverage?.status === "PASS" &&
    value.competing_candidate?.status === "NONE" &&
    value.uncertain_execution?.status === "NONE"
  );
  const reason = identityCurrent && value?.status !== "PASS" && typeof value?.reason === "string" && value.reason
    ? value.reason
    : "The selected controlled payment scope is unavailable. Refresh before continuing.";
  return { applies: true, ready: valid, reason };
}

function isRouteAssuranceReady(detail: ObligationDetail | null): boolean {
  if (!detail) return false;
  const simulatedTrustFixture = hasSimulatedTrustFixture(
    detail.demo_arc_trust_simulated,
    detail.aggregate.source_wallet_ref,
  );
  return !simulatedTrustFixture &&
    detail.aggregate.product_trust_provenance === "CURRENT_PRODUCT_EVIDENCE" &&
    detail.aggregate.destination_verification_status === "VERIFIED" &&
    detail.aggregate.destination_operational_status === "ACTIVE" &&
    detail.aggregate.source_wallet_status === "ACTIVE";
}

function sourceText(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  return typeof value === "string" && value.trim() ? value : "Not captured";
}

function businessTitle(value: string): string {
  const words = value.replaceAll("_", " ").toLowerCase().replace(/\b(ai|api|usdc)\b/g, word => word.toUpperCase());
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function sourceServiceContext(record: Record<string, unknown>): string | null {
  const commercialTerms = typeof record.commercial_terms === "string" ? record.commercial_terms.trim() : "";
  const evidence = Array.isArray(record.source_evidence) ? record.source_evidence : [];
  const sourceType = evidence.find((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown> | undefined;
  const sourceLabels: Record<string, string> = {
    PDF_PROFORMA_INVOICE: "proforma invoice",
    PDF_INVOICE: "invoice",
    PDF_TAX_INVOICE: "tax invoice",
    USER_SUPPLIED_EMAIL_INVOICE_EXCERPT: "user-supplied email invoice excerpt",
    AUTHORIZED_OPERATOR_ATTESTATION: "user attestation",
  };
  const sourceLabel = typeof sourceType?.source_type === "string" ? sourceLabels[sourceType.source_type] : undefined;
  const includesSource = sourceLabel && commercialTerms.toLocaleLowerCase().includes(sourceLabel.toLocaleLowerCase());
  const sourceContext = sourceLabel && !includesSource ? `Source: ${sourceLabel}` : "";
  const line = [commercialTerms, sourceContext].filter(Boolean).join(" · ");
  return line || null;
}

function sourcePayableState(detail: ObligationDetail): string {
  const state = detail.source_payable_state ?? detail.truth.source_truth.obligation_state;
  return typeof state === "string" && state.trim() ? state : "Not reported";
}

type SourceEvidenceReference = {
  evidence_id: string;
  source_type?: string;
  provenance_class?: string;
  content_sha256?: string;
};

function sourceEvidenceReferences(record: ObligationDetail["record"]): SourceEvidenceReference[] {
  if (!Array.isArray(record.source_evidence)) return [];
  return record.source_evidence.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const value = item as Record<string, unknown>;
    if (typeof value.evidence_id !== "string" || !value.evidence_id.trim()) return [];
    return [{
      evidence_id: value.evidence_id,
      ...(typeof value.source_type === "string" ? { source_type: value.source_type } : {}),
      ...(typeof value.provenance_class === "string" ? { provenance_class: value.provenance_class } : {}),
      ...(typeof value.content_sha256 === "string" ? { content_sha256: value.content_sha256 } : {}),
    }];
  });
}

function isPreparedInstructionBoundToSource(
  record: ObligationDetail["record"],
  selectedObligationId: string,
  preflight: NonNullable<ObligationDetail["settlement_proxy"]>["preflight"] | undefined,
): boolean {
  if (!preflight) return false;
  const evidenceIds = sourceEvidenceReferences(record).map((item) => item.evidence_id);
  const instruction = preflight.business_payment_instruction;
  const commercial = instruction?.commercial;
  return Boolean(instruction && commercial &&
    record.obligation_id === selectedObligationId &&
    preflight.obligation_id === record.obligation_id &&
    preflight.source_amount === record.amount &&
    preflight.source_currency === record.currency &&
    JSON.stringify(preflight.source_evidence_ids ?? []) === JSON.stringify(evidenceIds) &&
    instruction.payer?.organization_id === preflight.organization_id &&
    commercial.obligation_id === record.obligation_id &&
    commercial.source_amount === record.amount &&
    commercial.source_currency === record.currency &&
    commercial.settlement_amount === preflight.amount &&
    commercial.settlement_asset === preflight.asset &&
    JSON.stringify(commercial.source_evidence_ids ?? []) === JSON.stringify(evidenceIds) &&
    commercial.source_evidence_id === evidenceIds[0] &&
    instruction.beneficiary?.beneficiary_id === preflight.beneficiary_id &&
    instruction.beneficiary?.destination_wallet_id === preflight.destination_wallet.id);
}

export function SourceObligationLineage({
  record,
  payableState,
  selectedObligationId,
  preflight,
}: {
  record: ObligationDetail["record"];
  payableState: string;
  selectedObligationId: string;
  preflight?: NonNullable<ObligationDetail["settlement_proxy"]>["preflight"];
}) {
  const evidence = sourceEvidenceReferences(record);
  const sourceEvidenceIds = evidence.map((item) => item.evidence_id);
  const boundToSource = isPreparedInstructionBoundToSource(record, selectedObligationId, preflight);
  const terms = sourceText(record, "commercial_terms");

  return (
    <section aria-label="Source obligation lineage" className="space-y-2 rounded border border-[var(--color-border)] px-3 py-2">
      <h4 className="text-[12px] font-semibold text-[var(--color-ink)]">Source business obligation</h4>
      <dl className="grid gap-x-5 sm:grid-cols-2">
        <Field label="Source obligation" value={record.obligation_id === selectedObligationId ? record.obligation_id : "Source identity reference unavailable / not established"} />
        <Field label="Original amount · payable status" value={`${record.amount} ${record.currency} · ${payableState}`} />
        <Field label="Privacy-safe source counterparty reference" value={sourceText(record, "counterparty_id") === "Not captured" ? "Source identity reference unavailable / not established" : sourceText(record, "counterparty_id")} />
      </dl>
      <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]">Supplier name is not included in this public demo record; the recorded counterparty ID is used. This does not verify legal name or ownership.</p>
      {terms !== "Not captured" && <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]">Source particulars: {terms}</p>}
      {evidence.length ? (
        <ul aria-label="Original source evidence references" className="space-y-1 text-[12px] text-[var(--color-ink-muted)]">
          {evidence.map((item) => <li key={item.evidence_id}>
            Original source evidence: <bdi dir="ltr" className="font-medium text-[var(--color-ink)]">{item.evidence_id}</bdi>
            {item.source_type ? ` · ${item.source_type}` : ""}{item.provenance_class ? ` · ${item.provenance_class}` : ""}
          </li>)}
        </ul>
      ) : <p className="text-[12px] text-[var(--color-warning)]">Source identity reference unavailable / not established.</p>}
      {evidence.some((item) => item.content_sha256) && <details className="rounded border border-[var(--color-border)] px-2 py-1.5">
        <summary className="min-h-11 cursor-pointer py-2 text-[12px] text-[var(--color-ink-muted)]">Private-source catalog metadata</summary>
        <ul className="space-y-1 pb-2 text-[11px] text-[var(--color-ink-muted)]">
          {evidence.filter((item) => item.content_sha256).map((item) => <li key={item.evidence_id}>{item.evidence_id} · private-source catalog content hash: <bdi dir="ltr" className="break-all">{item.content_sha256}</bdi></li>)}
        </ul>
      </details>}
      {preflight && !boundToSource && <p role="status" className="text-[12px] text-[var(--color-warning)]">Source identity reference unavailable / not established for the prepared instruction.</p>}
    </section>
  );
}

function ControlledProxyLineage({
  record,
  selectedObligationId,
  preflight,
  payableState,
}: {
  record: ObligationDetail["record"];
  selectedObligationId: string;
  preflight: NonNullable<ObligationDetail["settlement_proxy"]>["preflight"];
  payableState: string;
}) {
  const sourceEvidenceIds = sourceEvidenceReferences(record).map((item) => item.evidence_id);
  const boundToSource = isPreparedInstructionBoundToSource(record, selectedObligationId, preflight);

  return (
    <section aria-label="Controlled Arc Testnet proxy" className="space-y-2 rounded border border-[var(--color-border)] px-3 py-2">
      <h4 className="text-[12px] font-semibold text-[var(--color-ink)]">Controlled Arc Testnet proxy, not the source supplier.</h4>
      <dl className="grid gap-x-5 sm:grid-cols-2">
        <Field label="Recorded testnet organization reference" value={preflight.organization_id || "Source identity reference unavailable / not established"} />
        <Field label="Recorded testnet instruction obligation" value={preflight.obligation_id || "Source identity reference unavailable / not established"} />
        <Field label="Recorded proxy settlement amount" value={`${preflight.amount} ${preflight.asset}`} />
        <Field label="Testnet network" value={preflight.network} />
        <Field label="Controlled source wallet" value={compactProxyDestination("Arc Testnet controlled source", preflight.source_wallet.address)} />
        <Field label="Proxy beneficiary reference" value={preflight.beneficiary_id ?? "Source identity reference unavailable / not established"} />
        <Field label="Proxy destination wallet" value={compactProxyDestination(preflight.destination_wallet.name ?? "Arc Testnet settlement proxy", preflight.destination_wallet.address)} />
      </dl>
      {boundToSource
        ? <>
          <p className="text-[12px] text-[var(--color-ink-muted)]">Prepared source obligation and evidence: <bdi dir="ltr">{record.obligation_id} · {sourceEvidenceIds.join(", ")}</bdi></p>
          <p className="text-[12px] font-medium text-[var(--color-ink)]">Exact source → settlement amount: <bdi dir="ltr" className="tabular">{record.amount} {record.currency} → {preflight.amount} {preflight.asset}</bdi></p>
        </>
        : <p role="status" className="text-[12px] text-[var(--color-warning)]">Source identity reference unavailable / not established for this prepared testnet instruction. No source-to-proxy binding is asserted.</p>}
      <p className="text-[12px] text-[var(--color-warning)]">Testnet settlement does not discharge the real-world source payable; its recorded state remains {payableState}.</p>
    </section>
  );
}

function sourceDateProvenance(record: Record<string, unknown>): string {
  const value = record.effective_due_date_provenance;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Not captured";
  const provenance = value as Record<string, unknown>;
  if (provenance.provenance_class === "SOURCE_INVOICE_DATE" && typeof provenance.evidence_id === "string") {
    return `Source invoice date · evidence ${provenance.evidence_id}`;
  }
  if (provenance.provenance_class === "AUTHORIZED_OPERATOR_ATTESTATION" && typeof provenance.authority_reference === "string") {
    return `Authorized user attestation · ${provenance.authority_reference}`;
  }
  return "Not captured";
}

type PanelKey = "obligations" | "assessment" | "authorization" | "assurance" | "reconciliation";
type LifecycleStage = (typeof PAYMENT_LIFECYCLE_STAGES)[number];
type LifecycleStageState = "COMPLETED" | "CURRENT" | "AVAILABLE" | "UPCOMING" | "BLOCKED";
type ObligationListStatus = "loading" | "error" | "ready";
type ObligationListPresentation = "loading" | "error" | "empty" | "ready";

export function obligationListState(
  status: ObligationListStatus,
  error: string | null,
  count: number,
): ObligationListPresentation {
  if (status === "loading") return "loading";
  if (status === "error" || error) return "error";
  return count === 0 ? "empty" : "ready";
}

/** Deterministic error text for a failed /api/obligations fetch. Never
 * derived from a thrown parse exception: an upstream 500 with an empty body
 * makes `response.json()` throw a native, engine-specific message ("The
 * string did not match the expected pattern." on WebKit, "Unexpected end of
 * JSON input" on V8) that is not a usable operator-facing explanation. */
export function obligationsFetchErrorMessage(status: number, body: unknown | null): string {
  if (body && typeof body === "object" && "error" in body && typeof (body as { error: unknown }).error === "string") {
    return (body as { error: string }).error;
  }
  return `Obligations unavailable (HTTP ${status}).`;
}

/** Best-effort JSON parse of a response body that may be empty or malformed
 * (e.g. an upstream 500 with no body). Never throws. */
function tryParseJson(text: string): unknown | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Coverage copy for the Assessment panel header. Distinguishes an
 * unavailable or still-loading genuine list from a verified-empty one so
 * neither is ever reported as a false "0/0 obligations assessed". */
export function assessmentCoverageLabel(
  presentation: ObligationListPresentation,
  assessedCount: number,
  total: number,
): string {
  if (presentation === "loading") return "Payables are loading — assessment coverage is not yet known.";
  if (presentation === "error") return "Payables are unavailable — assessment coverage cannot be determined.";
  if (presentation === "empty") return "No payables are currently available to assess.";
  return `${assessedCount}/${total} payables assessed`;
}

/** The "assess all N" authorization-gate reminder. Only meaningful once the
 * genuine list is actually populated — otherwise it previously degraded to
 * the nonsensical "assess all 0". */
export function assessmentGateCopy(
  presentation: ObligationListPresentation,
  allAssessed: boolean,
  total: number,
): string | null {
  if (presentation !== "ready" || allAssessed) return null;
  return `Authorization is refused for every payable until all ${total} have been assessed.`;
}

export type KillSwitchPresentation = "no-selection" | "inactive" | "engaged";

/** An inactive kill switch is one control fact only. It never grants release:
 * payment authority remains separately NOT_GRANTED until human authorization,
 * assessment and the Safety Kernel complete. */
export type DetailState = "none" | "loading" | "failed" | "loaded" | "stale";

export type AssessmentPrimaryAction = "none" | "assess" | "review" | "continue";

export function isRetryableProviderValidationFailure(assessment: AssessmentReviewSnapshot | null): boolean {
  return Boolean(
    assessment?.decision === "HOLD" &&
    assessment.race?.result.validated_findings.some((finding) => finding.code === "MODEL_OUTPUT_INVALID"),
  );
}

export function authorizationPanelCopy(state: DetailState, hasSelection: boolean, paeSealed = false, hasSettlementProxy = false, authorizationRecordedBlocked = false): string {
  if (!hasSelection || state === "none") return "Select a payable to review its approval and payment-instruction status.";
  if (state === "loading") return "Loading the current payable; approval status is not yet available.";
  if (state === "failed") return "The selected payable is unavailable, so approval and payment-instruction status cannot be confirmed.";
  if (state === "stale") return "The payable record is out of date. Refresh it before relying on the approval or payment position.";
  if (authorizationRecordedBlocked) return "Approval was recorded, but required payment controls did not complete. No payment can be released from this state.";
  if (paeSealed && hasSettlementProxy) return "The approved Arc Testnet payment instruction is sealed. Final release and pre-payment checks still apply.";
  if (paeSealed) return "An approved payment instruction is already sealed for this payable. Sending the payment remains a separate step.";
  if (hasSettlementProxy) return "The Arc Testnet settlement instruction is prepared. The payment review and controls determine whether approval is available.";
  return "No payment instruction exists. If all payment controls pass, Tameion can prepare a signed instruction for human approval; no payment is sent here.";
}

/** Actionable authorization prerequisites are meaningful only for current,
 * selected detail that has not already sealed its authorization envelope. */
export function authorizationPrerequisitesVisible(state: DetailState, hasSelection: boolean, paeSealed: boolean, authorizationRecordedBlocked = false): boolean {
  return state === "loaded" && hasSelection && !paeSealed && !authorizationRecordedBlocked;
}

export function assessmentPrimaryAction(state: {
  detailState: DetailState;
  hasSelection: boolean;
  paeSealed: boolean;
  authorizationRecordedBlocked: boolean;
  hasCurrentAssessment: boolean;
  decision: string | undefined;
  assessmentReviewAvailable: boolean;
  reviewed: boolean;
  allAssessed: boolean;
  routeAssuranceReady: boolean;
  retryableProviderFailure: boolean;
  remediableHold: boolean;
}): AssessmentPrimaryAction {
  if (state.detailState !== "loaded" || !state.hasSelection || state.paeSealed) return "none";
  if (state.authorizationRecordedBlocked) return "none";
  if (!state.hasCurrentAssessment) return "assess";
  if (state.retryableProviderFailure) return "assess";
  if (state.remediableHold) return "assess";
  if (state.decision !== "PAY") return "none";
  if (!state.assessmentReviewAvailable) return "none";
  if (!state.reviewed) return "review";
  if (!state.allAssessed || !state.routeAssuranceReady) return "none";
  return "continue";
}

export type KillSwitchView = KillSwitchPresentation | "unknown" | "loading" | "failed" | "stale";

export function killSwitchPresentation(state: DetailState, value: unknown): KillSwitchView {
  if (state === "none") return "no-selection";
  if (state === "loading") return "loading";
  if (state === "failed") return "failed";
  if (state === "stale") return "stale";
  if (typeof value !== "boolean") return "unknown";
  return value ? "engaged" : "inactive";
}

export function killSwitchLabel(presentation: KillSwitchView): string {
  if (presentation === "no-selection") return "No payable selected";
  if (presentation === "loading") return "Payment-stop status is loading — not verified";
  if (presentation === "failed") return "Payment-stop status is unavailable — not verified";
  if (presentation === "stale") return "Payment-stop status is out of date — refresh before relying on it";
  if (presentation === "unknown") return "Payment-stop status is unknown — not verified";
  if (presentation === "engaged") return "Payments disabled";
  return "Payment stop inactive — separate approval is still required";
}

export function lifecycleStopLabel(args: { presentation: ObligationListPresentation; total: number; assessed: number; pay: number }): string {
  if (args.presentation === "loading") return "Payables are loading — workflow status is not yet known.";
  if (args.presentation === "error") return "Payables are unavailable — workflow status cannot be determined.";
  if (args.presentation === "empty") return "No payables — nothing to assess or authorize.";
  if (args.assessed < args.total) return `STOP — ${args.assessed} of ${args.total} assessed. Authorization is blocked until all are assessed.`;
  if (args.pay > 0) return `Assessed — ${args.pay} PAY assessment result(s); advisory, still requires human authorization.`;
  return "Assessment complete — all assessed; no PAY candidate.";
}

/** Decision-aware lifecycle label for the selected obligation's current
 * assessment. Only PAY may move to human authorization review. */
export function pendingPrerequisiteLabel(decision: "PAY" | "HOLD" | "ESCALATE" | null): string {
  if (decision === "HOLD") return "Requires attention";
  if (decision === "ESCALATE") return "Escalation required";
  if (decision === "PAY") return "Eligible for human authorization review";
  return "Assessment required before authorization";
}

/** Settlement display that keeps source truth and derived settlement separate.
 * AED sources are settled through the fixed policy conversion; they are never
 * reported as "Not applicable" when server settlement truth exists. */
/** The aggregate-version fragment shown in the Authorization panel's intent
 * sentence. Never the bare "v?" placeholder when nothing is selected. */
export function aggregateVersionLabel(aggregateVersion: number | undefined, hasSelection: boolean): string {
  if (!hasSelection) return "no payable selected";
  if (aggregateVersion === undefined) return "loading";
  return String(aggregateVersion);
}

/** When the genuine list is unavailable or still loading, the HOLD/ESCALATE
 * operational-report summary must say so instead of rendering an all-zero
 * table that looks like a verified, reportable empty state. */
type AssessmentQueueSummary = { total: number; pay: number; hold: number; escalate: number; unassessed: number };

function summarizeAssessmentQueue(obligations: ObligationSummary[]): AssessmentQueueSummary {
  return obligations.reduce<AssessmentQueueSummary>((summary, obligation) => {
    summary.total += 1;
    if (!obligation.assessed) summary.unassessed += 1;
    else {
      if (obligation.decision === "PAY") summary.pay += 1;
      if (obligation.decision === "HOLD") summary.hold += 1;
      if (obligation.decision === "ESCALATE") summary.escalate += 1;
    }
    return summary;
  }, { total: 0, pay: 0, hold: 0, escalate: 0, unassessed: 0 });
}

export function queueCompletionLabel(summary: AssessmentQueueSummary): string {
  if (summary.unassessed > 0) {
    return `Incomplete assessment — ${summary.total - summary.unassessed} of ${summary.total} assessed. No candidate determination yet.`;
  }
  if (summary.pay > 0) {
    return `Assessment complete — ${summary.pay} PAY result${summary.pay === 1 ? "" : "s"}. Payment still requires separate assurance and human authorization.`;
  }
  return "Assessment complete — no PAY candidate; all payables assessed as HOLD or ESCALATE.";
}

/** Ordered first-unmet prerequisites for authorization. Only the first is the
 * next action, but all unmet items are named so the operator sees the full gate. */
export function authorizationBlockers(state: {
  hasSelection: boolean;
  allAssessed: boolean;
  hasCurrentPayAssessment: boolean;
  routeAssuranceReady?: boolean;
  destinationVerification?: string;
  destinationOperational?: string;
  sourceWallet?: string;
  productTrustProvenance?: string;
  proxyPreparationAvailable?: boolean;
  reviewed: boolean;
  killSwitchEngaged: boolean;
}): string[] {
  const blockers: string[] = [];
  if (!state.hasSelection) blockers.push("Select a payable.");
  if (!state.allAssessed) blockers.push("Assess all payables before authorization.");
  if (state.hasSelection && !state.hasCurrentPayAssessment) blockers.push("A current PAY assessment is required before authorization review.");
  if (state.hasCurrentPayAssessment && state.routeAssuranceReady === false) {
    const facts = [
      state.destinationVerification && `Destination verification is ${judgeReadableState(state.destinationVerification).toLowerCase()}`,
      state.destinationOperational && `destination operations are ${judgeReadableState(state.destinationOperational).toLowerCase()}`,
      state.sourceWallet && `source wallet is ${judgeReadableState(state.sourceWallet).toLowerCase()}`,
      `product-trust provenance is ${state.productTrustProvenance ? judgeReadableState(state.productTrustProvenance).toLowerCase() : "unavailable"}`,
    ].filter(Boolean);
    blockers.push(`Payment-route assurance is not ready${facts.length ? `: ${facts.join("; ")}.` : ". Current route evidence is unavailable."} External-evidence step: obtain current product trust, verified destination, and active destination/source-wallet evidence. Owner: unavailable.${state.proxyPreparationAvailable ? " The selected candidate may be prepared as an Arc Testnet proxy; this does not satisfy assurance. Obtain a fresh assessment after preparation, before authorization." : " This external evidence is unavailable in this product flow."}`);
  }
  if (state.hasCurrentPayAssessment && !state.reviewed) blockers.push("Review the current PAY assessment before authorization.");
  if (state.killSwitchEngaged) blockers.push("Emergency payment stop is active for this payable.");
  return blockers;
}

export function reconciliationLeadLine(state: DetailState, execution: unknown, hasSettlementProxy = false, sourceState = "OUTSTANDING"): string {
  if (state === "stale") return "Last-known submission state is stale — refresh before relying on it.";
  if (state !== "loaded") return "Submission state unknown — authoritative detail is not loaded.";
  if (execution === null) return "No Arc settlement to reconcile.";
  if (execution && typeof execution === "object" && typeof (execution as { status?: unknown }).status === "string") {
    const record = execution as { status: string; provider_ref?: unknown; provider_evidence?: unknown };
    const status = record.status;
    if (hasSettlementProxy && status === "SETTLED") return `Recorded as settled — reconciliation evidence is unavailable. The exact settlement amount and destination cannot be verified from the stored record. Source payable remains ${sourceState}.`;
    if (hasSettlementProxy && (status === "UNKNOWN" || status === "SUBMITTING")) return "TESTNET outcome is UNKNOWN — perform read-only reconciliation for this same intent; resubmission is blocked.";
    if (hasSettlementProxy && status === "FAILED") return `The Arc Testnet settlement attempt failed; source payable remains ${sourceState}.`;
    if (hasSettlementProxy && status === "BLOCKED" && !record.provider_ref && !record.provider_evidence) return `Arc Testnet payment release is blocked. No settlement-network reference is recorded, so the external settlement status is unconfirmed. Source payable remains ${sourceState}.`;
    if (hasSettlementProxy && status === "BLOCKED") return `Arc Testnet payment release is blocked. Review the recorded settlement outcome. Source payable remains ${sourceState}.`;
    if (hasSettlementProxy) return `Arc Testnet payment status: ${status}; source payable remains ${sourceState}.`;
    return `Illustrative payment status: ${status}; no Arc settlement to reconcile.`;
  }
  return "Submission state unknown — authoritative execution field is absent.";
}

type AvailableEvidenceItem = { occurredAt: string; label: string; result: string };

function validStoredTimestamp(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}

/** The user-facing evidence chronology includes only durable fields that
 * actually carry a stored timestamp. Other lifecycle artifacts are shown as
 * current state below, never ordered as invented events. */
export function availableEvidenceItems(detail: ObligationDetail): AvailableEvidenceItem[] {
  const items: AvailableEvidenceItem[] = [];
  const preflightTime = detail.settlement_proxy?.preflight.captured_at;
  if (validStoredTimestamp(preflightTime)) {
    items.push({ occurredAt: preflightTime, label: "Read-only Arc Testnet preflight evidence", result: "Captured for the testnet payment destination." });
  }
  const assurance = detail.assurance_evidence;
  if (assurance && (assurance.state === "AVAILABLE_CURRENT_BINDING" || assurance.state === "AVAILABLE_HISTORICAL") && validStoredTimestamp(assurance.recorded_at)) {
    items.push({
      occurredAt: assurance.recorded_at,
      label: "Stored assurance evidence",
      result: assurance.state === "AVAILABLE_CURRENT_BINDING" ? "Stored PASS evidence · current binding" : "Stored PASS evidence · historical binding",
    });
  }
  const reconciledAt = detail.execution?.provider_evidence?.reconciled_at;
  if (validStoredTimestamp(reconciledAt)) {
    items.push({
      occurredAt: reconciledAt,
      label: "Settlement status record",
      result: typeof detail.execution?.provider_evidence?.status === "string"
        ? detail.execution.provider_evidence.status
        : "Status recorded",
    });
  }
  return items.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
}

export function submissionEvidenceCopy(detail: ObligationDetail): string {
  const execution = detail.execution;
  if (execution?.provider_ref) return "A settlement-network reference is recorded for this instruction.";
  if (execution) return "No settlement-network reference is recorded for this instruction. External settlement status is not established by this record.";
  return "No Tameion payment record is recorded for this instruction. This does not establish external settlement status.";
}

export function currentAuthorityGuidance(detail: ObligationDetail): string | null {
  const authority = detail.truth.tameion_control_truth.execution_release_authority;
  const paeState = detail.truth.tameion_control_truth.pae_state;
  if (["BLOCKED", "REVOKED", "EXPIRED"].includes(authority) || ["REVOKED", "EXPIRED"].includes(paeState)) {
    return "The previous instruction cannot be submitted. Renew payment authority before preparing another release record.";
  }
  if (detail.pae_sealed && (!detail.execution_packet || !detail.sealed_pae_instruction_hash || detail.execution_gate === "LOCKED_UNTIL_CURRENT_AUTHORIZATION")) {
    return "Current payment authority is unavailable. Complete a current payment review and approval before preparing another release record.";
  }
  return null;
}

export function queueHeaderLabel(presentation: ObligationListPresentation, summary: AssessmentQueueSummary): string {
  if (presentation === "loading") return "Loading payment queue — completion is not yet known.";
  if (presentation === "error") return "Payment queue unavailable — completion cannot be determined.";
  if (presentation === "empty") return "No payables are in the queue.";
  return queueCompletionLabel(summary);
}

const PAYMENT_LIFECYCLE_STAGES = [
  "Obligation",
  "Assessment",
  "Authorization",
  "Assurance",
  "Payment",
  "Reconciliation",
] as const;

const STAGE_BUSINESS_CONTEXT: Partial<Record<LifecycleStage, string>> = {
  Assurance: "Payment controls",
  Reconciliation: "Settlement confirmation",
};

function stageBusinessLabel(stage: LifecycleStage): string {
  const context = STAGE_BUSINESS_CONTEXT[stage];
  return context ? `${stage} · ${context}` : stage;
}

function stageSpokenLabel(stage: LifecycleStage): string {
  const context = STAGE_BUSINESS_CONTEXT[stage];
  return context ? `${stage}, ${context}` : stage;
}

function businessAmount(value: string): string {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return value;
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return `${match[1]}.${fraction.padEnd(2, "0")}`;
}

const STAGE_PANEL: Record<LifecycleStage, PanelKey> = {
  Obligation: "obligations",
  Assessment: "assessment",
  Authorization: "authorization",
  Assurance: "assurance",
  Payment: "assurance",
  Reconciliation: "reconciliation",
};

function authoritativeLifecyclePosition(selectedId: string, detailState: DetailState, detail: ObligationDetail | null): LifecycleStage {
  if (!selectedId || detailState !== "loaded" || !detail || !hasExpectedObligationIdentity(detail, selectedId)) return "Obligation";
  if (detail.execution) return "Reconciliation";
  if (detail.aggregate.state === "AUTHORIZED" && detail.pae_sealed &&
      (detail.execution_kill_switched === true || ["BLOCKED", "REVOKED", "EXPIRED"].includes(detail.truth.tameion_control_truth.execution_release_authority))) {
    return "Payment";
  }
  if (detail.aggregate.state === "AUTHORIZED") return "Assurance";
  if (detail.pae_sealed) return "Payment";
  if (detail.settlement_proxy || detail.current_assessment) return "Assessment";
  return "Obligation";
}

async function postJson(url: string, body?: unknown, headers: Record<string, string> = {}) {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const interpreted = interpretPostResponse(response.status, await response.text());
    return { ok: interpreted.ok, status: interpreted.status, data: interpreted.data ?? { error: interpreted.message } };
  } catch {
    return { ok: false, status: 0, data: { error: "Network request failed; no response was received. Retry after reloading current state." } };
  }
}

type Tone = "neutral" | "info" | "success" | "warning" | "danger";
type ExecutionConfirmation = { identity: string; value: string } | null;

type SettledEvidenceClassification = {
  state: "verified" | "unavailable" | "mismatch";
  historical: boolean;
  summary: string;
  explanation: string;
  amountMatch: string;
  providerAmountMatch: string;
  destinationMatch: string;
};

/** Read-only presentation classification. A recorded ledger status is not
 * provider proof: success requires CONFIRMED evidence bound to the exact
 * selected, sealed instruction and its exact amount/destination. */
function classifySettledEvidence(detail: ObligationDetail): SettledEvidenceClassification {
  const historical = detail.settlement_evidence_binding?.state === "AVAILABLE_HISTORICAL";
  const unavailable = (amountMatch = "not established from the settlement record", destinationMatch = "not established from the settlement record", providerAmountMatch = "not established from the settlement record"): SettledEvidenceClassification => ({
    state: "unavailable",
    historical,
    summary: historical ? "Historical SETTLED record — reconciliation evidence unavailable" : "Recorded as SETTLED — reconciliation evidence unavailable",
    explanation: "The recorded settlement amount and destination cannot be verified. Review the settlement record and do not send the instruction again.",
    amountMatch,
    providerAmountMatch,
    destinationMatch,
  });
  const mismatch = (amountMatch = "review required", destinationMatch = "review required", providerAmountMatch = "review required"): SettledEvidenceClassification => ({
    state: "mismatch",
    historical,
    summary: historical ? "Historical reconciliation evidence mismatch — review required" : "Settlement record mismatch — review required",
    explanation: "The settlement record does not match the approved payment instruction. The payment remains recorded as settled; review the evidence and do not send it again.",
    amountMatch,
    providerAmountMatch,
    destinationMatch,
  });
  const record = detail.execution;
  if (!record || record.status !== "SETTLED") return unavailable();
  if (detail.truth.settlement_truth.runtime === "SIMULATED") return unavailable();
  const evidence = record.provider_evidence;
  if (!evidence) return unavailable();
  if (typeof evidence.status === "string" && evidence.status !== "CONFIRMED") return mismatch();
  if (!evidence.status) return unavailable();

  const packet = detail.execution_packet?.packet ??
    (historical ? detail.settlement_evidence_binding?.packet?.packet : undefined);
  const pae = packet?.pae as Record<string, unknown> | undefined;
  const token = packet?.provider_token as Record<string, unknown> | undefined;
  const instruction = packet?.circle_arc_execution_instruction as Record<string, unknown> | undefined;
  const proxy = detail.settlement_proxy?.preflight;
  if (!packet || !detail.pae_sealed || !detail.sealed_pae_instruction_hash ||
      packet.obligation_id !== detail.record.obligation_id ||
      pae?.instruction_hash !== detail.sealed_pae_instruction_hash ||
      pae?.idempotency_key !== record.idempotency_key ||
      (record.obligation_id !== undefined && record.obligation_id !== detail.record.obligation_id) ||
      !proxy || proxy.obligation_id !== detail.record.obligation_id ||
      packet.organization_id !== proxy.organization_id ||
      packet.aggregate_version !== detail.aggregate.aggregate_version ||
      packet.settlement_amount !== proxy.amount || packet.settlement_amount !== detail.aggregate.amount) {
    return unavailable();
  }

  const amount = packet.settlement_amount;
  const decimals = token?.decimals;
  const destination = instruction?.destination_address;
  if (typeof amount !== "string" || !Number.isSafeInteger(decimals) || (decimals as number) < USDC_DECIMALS || (decimals as number) > 36 ||
      typeof destination !== "string" || !destination ||
      typeof instruction.amount !== "string" || !Number.isSafeInteger(instruction.decimals) ||
      typeof packet.asset !== "string" || typeof packet.network !== "string") return unavailable();
  if (destination.toLowerCase() !== proxy.destination_wallet.address.toLowerCase() ||
      instruction.amount !== amount || instruction.decimals !== decimals ||
      packet.asset !== "USDC" || packet.network !== "ARC_TESTNET") return mismatch();
  let expectedAtomic: string;
  try {
    // The instruction/ledger amount is canonical USDC at six decimals.
    // Circle-native token units are verified separately below.
    expectedAtomic = decimalToAtomic(amount, USDC_DECIMALS);
  } catch {
    return unavailable();
  }

  const evidenceAtomic = evidence.atomic_amount ?? evidence.atomicAmount;
  const evidenceDestination = evidence.destination_address ?? evidence.destinationAddress;
  const amountMatch = typeof evidenceAtomic !== "string"
    ? "not established from the settlement record"
    : evidenceAtomic === expectedAtomic ? "confirmed" : "mismatch recorded";
  const evidenceProviderDecimals = evidence.provider_token_decimals;
  const providerAtomic = evidence.provider_atomic_amount;
  let providerAmountMatch = "not established from the settlement record";
  if (evidenceProviderDecimals !== undefined && evidenceProviderDecimals !== decimals) {
    providerAmountMatch = "mismatch recorded";
  } else if (typeof evidenceProviderDecimals === "number" && typeof providerAtomic === "string") {
    const expectedProviderAtomic = evidenceProviderDecimals >= USDC_DECIMALS && evidenceProviderDecimals <= 36
      ? (BigInt(expectedAtomic) * 10n ** BigInt(evidenceProviderDecimals - USDC_DECIMALS)).toString(10)
      : null;
    providerAmountMatch = expectedProviderAtomic === null
      ? "not established from the settlement record"
      : providerAtomic === expectedProviderAtomic ? "confirmed" : "mismatch recorded";
  } else if ((decimals as number) === USDC_DECIMALS && evidenceProviderDecimals === undefined && providerAtomic === undefined) {
    // Older canonical six-decimal adapters recorded only the ledger scale.
    providerAmountMatch = "confirmed";
  }
  const destinationMatch = typeof evidenceDestination !== "string"
    ? "not established from the settlement record"
    : evidenceDestination.toLowerCase() === destination.toLowerCase() ? "confirmed" : "mismatch recorded";
  if (amountMatch === "mismatch recorded" || providerAmountMatch === "mismatch recorded" || destinationMatch === "mismatch recorded" ||
      (typeof record.atomic_amount === "string" && record.atomic_amount !== expectedAtomic) ||
      (typeof record.destination_address === "string" && record.destination_address.toLowerCase() !== destination.toLowerCase())) {
    return mismatch(amountMatch, destinationMatch, providerAmountMatch);
  }
  if (amountMatch !== "confirmed" || providerAmountMatch !== "confirmed" || destinationMatch !== "confirmed" || detail.aggregate.state !== "RECONCILED") {
    return unavailable(amountMatch, destinationMatch, providerAmountMatch);
  }
  return {
    state: "verified",
    historical,
    summary: historical ? "Historical testnet execution — exact settlement evidence verified" : "TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION",
    explanation: historical
      ? `Archived settlement evidence confirms the exact prior testnet instruction. Current release authority is not restored; source payable remains ${sourcePayableState(detail)}.`
      : `Stored settlement evidence confirms the exact testnet amount and destination; source payable remains ${sourcePayableState(detail)}.`,
    amountMatch,
    providerAmountMatch,
    destinationMatch,
  };
}

function settledEvidenceSummary(detail: ObligationDetail): string {
  if (detail.truth.settlement_truth.runtime === "SIMULATED") return "Simulated record — no Arc settlement";
  return classifySettledEvidence(detail).summary;
}

function settledEvidenceExplanation(detail: ObligationDetail): string {
  if (detail.truth.settlement_truth.runtime === "SIMULATED") {
    return `This illustrative payment record does not establish an Arc settlement. The exact settlement amount and destination cannot be verified from the stored record. Source payable remains ${sourcePayableState(detail)}.`;
  }
  return classifySettledEvidence(detail).explanation;
}

export function useExecutionConfirmation(identity: string | null) {
  const [confirmation, setConfirmation] = useState<ExecutionConfirmation>(null);
  useLayoutEffect(() => {
    setConfirmation((current) => current?.identity === identity ? current : null);
  }, [identity]);
  const isBound = Boolean(identity && confirmation?.identity === identity);
  return {
    value: isBound ? confirmation!.value : "",
    isBound,
    matchesExact: Boolean(isBound && confirmation?.value === "SUBMIT EXACT TESTNET SETTLEMENT PROXY"),
    setValue: (value: string) => {
      if (identity) setConfirmation({ identity, value });
    },
  };
}

const TONE_STYLE: Record<Tone, { border: string; text: string }> = {
  neutral: { border: "border-s-[3px] border-s-[var(--color-border)]", text: "text-[var(--color-ink-muted)]" },
  info: { border: "border-s-[3px] border-s-[var(--color-ink)]", text: "text-[var(--color-ink)]" },
  success: { border: "border-s-[3px] border-s-[var(--color-success)]", text: "text-[var(--color-success)]" },
  warning: { border: "border-s-[3px] border-s-[var(--color-warning)]", text: "text-[var(--color-warning)]" },
  danger: { border: "border-s-[3px] border-s-[var(--color-danger)]", text: "text-[var(--color-danger)]" },
};

/** Explicit workflow state, never expressed by colour alone. Authority-bearing
 * labels consume the server-derived truth layer rather than recomputing release
 * authority in the browser. */
export function workflowState(detail: ObligationDetail | null, routeAssuranceReady?: boolean): { label: string; tone: Tone; explanation: string } {
  if (!detail) return { label: "Loading", tone: "neutral", explanation: "" };
  const { aggregate, execution, truth } = detail;
  const releaseAuthority = truth.tameion_control_truth.execution_release_authority;

  if (execution?.status === "SETTLED") {
    if (detail.truth.settlement_truth.runtime === "SIMULATED") {
      return { label: "Simulated record — no Arc settlement", tone: "neutral", explanation: "The stored execution result used a simulated adapter and does not represent a vendor payment." };
    }
    const evidence = classifySettledEvidence(detail);
    if (evidence.state === "verified") {
      return { label: evidence.historical ? "Historical settlement evidence verified" : "Reconciled", tone: "success", explanation: evidence.explanation };
    }
    return {
      label: evidence.summary,
      tone: evidence.state === "mismatch" ? "warning" : "neutral",
      explanation: evidence.explanation,
    };
  }
  if (execution?.status === "UNKNOWN") {
    return {
      label: "Settlement outcome pending",
      tone: "warning",
      explanation: "The settlement network outcome is not yet confirmed. Tameion will reconcile the same instruction without sending it again.",
    };
  }
  if (execution?.status === "FAILED") {
    return { label: "Payment attempt failed", tone: "danger", explanation: "The settlement network confirmed that the attempt failed." };
  }
  if ((releaseAuthority === "BLOCKED" || releaseAuthority === "REVOKED") && (detail.pae_sealed || execution)) {
    return {
      label: "Blocked",
      tone: "danger",
      explanation: "Execution authority is no longer usable. Review the control and evidence state before any new attempt.",
    };
  }
  if (releaseAuthority === "EXPIRED" && (detail.pae_sealed || execution)) {
    return { label: "Payment authority expired", tone: "warning", explanation: "The approved payment instruction expired and cannot be sent." };
  }
  if (releaseAuthority === "SUBMITTED_TO_PROVIDER") {
    return { label: "Submitted for settlement", tone: "info", explanation: "Settlement confirmation is pending or being reconciled." };
  }
  if (releaseAuthority === "IN_DOUBT_PROVIDER_SUBMISSION") {
    return { label: "Submission confirmation pending", tone: "warning", explanation: "The settlement network may have received the instruction. Tameion will reconcile the outcome without sending it again." };
  }
  if (releaseAuthority === "RESERVED_FOR_EXECUTION") {
    return { label: "Payment release reserved", tone: "info", explanation: "The approved instruction is reserved for one protected payment attempt." };
  }
  if (releaseAuthority === "SUSPENDED_KILL_SWITCH") {
    return { label: "Payment release suspended", tone: "warning", explanation: "An emergency payment stop prevents release of the approved instruction." };
  }
  if (detail.pae_sealed && detail.settlement_proxy && !execution &&
      (!detail.execution_packet || !detail.sealed_pae_instruction_hash || detail.execution_gate === "LOCKED_UNTIL_CURRENT_AUTHORIZATION")) {
    return {
      label: "Approved instruction needs renewal",
      tone: "warning",
      explanation: "An approved instruction exists, but its current release record is unavailable. Payment authority must be renewed before submission.",
    };
  }
  if (releaseAuthority === "TAMEION_PAE_REVERIFY_REQUIRED") {
    return {
      label: "Payment instruction approved",
      tone: "success",
      explanation: "Human approval and payment controls are complete. The settlement service must still re-verify the current payment position before release.",
    };
  }
  if (releaseAuthority === "CONSUMED") {
    return { label: "Payment authority already used", tone: "neutral", explanation: "This payment authority has already been used and cannot be reused." };
  }
  if (aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !execution) {
    return {
      label: "Approval recorded · payment controls incomplete",
      tone: "warning",
      explanation: "Required payment controls did not complete, so no payment can be released from this state.",
    };
  }
  if (aggregate.state === "APPROVAL_PENDING") {
    const assessment = detail.current_assessment &&
      detail.current_assessment.obligation_id === detail.record.obligation_id &&
      detail.current_assessment.aggregate_version === String(aggregate.aggregate_version)
      ? detail.current_assessment
      : null;
    const decision = assessment?.decision ?? null;
    const payNeedsAssurance = decision === "PAY" && routeAssuranceReady === false;
    return {
      label: payNeedsAssurance
        ? "PAY assessment — assurance not ready; authorization locked"
        : pendingPrerequisiteLabel(decision),
      tone: decision === "HOLD" || decision === "ESCALATE" || payNeedsAssurance ? "warning" : decision === "PAY" ? "info" : "neutral",
      explanation: decision === "HOLD"
        ? "Resolve the HOLD findings before reassessing. Human authorization is locked."
        : decision === "ESCALATE"
          ? "Escalate the findings for human review. Human authorization is locked."
          : decision === "PAY"
            ? payNeedsAssurance
              ? "The current PAY assessment is advisory. Payment-route assurance is not ready; human authorization remains locked. No execution authority is granted."
              : "The current PAY assessment is advisory. Review it before authorization; no execution authority is granted."
            : "No current assessment or Tameion execution authority has been granted.",
    };
  }
  return { label: aggregate.state, tone: "neutral", explanation: "" };
}

function StateLine({ tone, label, explanation }: { tone: Tone; label: string; explanation?: string }) {
  const style = TONE_STYLE[tone];
  return (
    <div className={`${style.border} ps-3 py-1`}>
      <p className={`text-[13px] font-semibold uppercase tracking-wide ${style.text}`}>{label}</p>
      {explanation && <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{explanation}</p>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 border-b border-[var(--color-border)] py-1.5 sm:gap-4">
      <dt className="min-w-0 flex-1 break-words text-[13px] text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="min-w-0 max-w-[60%] break-words text-end tabular text-[13px] font-medium text-[var(--color-ink)]"><bdi dir="auto">{value}</bdi></dd>
    </div>
  );
}

function EvidencePanel({ value }: { value: unknown }) {
  return (
    <details className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-xs">
      <summary className="cursor-pointer select-none text-[var(--color-ink-muted)]">Raw evidence / response</summary>
      <pre className="tabular mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--color-ink)]">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function RacePanel({ race }: { race?: RaceAssessment }) {
  if (!race) return <p className="text-[12px] text-[var(--color-warning)]">Legacy assessment has no validated RACE data; reassess before authorization.</p>;
  return (
    <section className="space-y-2 rounded border border-[var(--color-border)] p-3" data-testid="race-remediation">
      <p className="text-[12px] font-semibold uppercase tracking-wide">RACE — {race.result.decision_summary}</p>
      <div className="text-[11px] text-[var(--color-ink-muted)]">
        <p><strong>Action taken:</strong> {race.action_taken.summary}</p>
        <ul className="list-disc ps-5">{race.action_taken.checks.map((check, index) => <li key={index}>{check}</li>)}</ul>
        <p><strong>Caveats:</strong> {race.caveats.missing_context.length ? race.caveats.missing_context.join(", ") : "No typed missing context"}; uncertainty {race.caveats.uncertainty_signal ? "flagged" : "not flagged"}.</p>
        <p><strong>Validated evidence IDs:</strong> {race.evidence.evidence_ids.join(", ") || "None"}</p>
        <p><strong>Raw source due date:</strong> <bdi dir="ltr">{race.evidence.authoritative_facts.due_date ?? "Not captured on source"}</bdi> · <strong>Effective date:</strong> <bdi dir="ltr">{race.evidence.authoritative_facts.effective_due_date ?? "Not derived"}</bdi> · <strong>Basis:</strong> <bdi dir="ltr">{race.evidence.authoritative_facts.effective_due_date_basis ?? "None recorded"}</bdi> · <strong>Assessment as of:</strong> <bdi dir="ltr">{race.evidence.authoritative_facts.as_of_date}</bdi>.</p>
      </div>
      {race.result.validated_findings.length > 0 && (
        <ul className="space-y-2 text-[12px]">
          {race.remediation.map((item) => (
            <li key={item.finding_code} className="border-s-2 border-[var(--color-warning)] ps-2">
              <p><strong>{item.finding_code}:</strong> {item.reason}</p>
              <p><strong>Required action:</strong> {item.required_action}</p>
              <p><strong>Required evidence/context:</strong> {item.required_evidence.join("; ") || "None specified"}</p>
              <p><strong>Owner:</strong> {item.owner_role}; reassessment {item.reassess_after_resolution ? "allowed after resolution" : "not allowed"}.</p>
              {item.escalation_target && <p><strong>Escalate to:</strong> {item.escalation_target}</p>}
            </li>
          ))}
        </ul>
      )}
            <p className="text-[11px] text-[var(--color-ink-muted)]">Model explanation (non-authoritative): {race.caveats.model_explanation || "None returned."}</p>
    </section>
  );
}

/** Maps an advisory decision to its presentation tone. PAY is never shown
 * as a green "go" — it is an advisory proposal that still requires human
 * authorization and Safety Kernel PASS before any release authority. */
function decisionTone(decision: "PAY" | "HOLD" | "ESCALATE"): Tone {
  if (decision === "ESCALATE") return "warning";
  if (decision === "HOLD") return "warning";
  // PAY is advisory-only — never styled as a green "go" success signal.
  return "neutral";
}

/** Provider/runtime truth display — advisory-only provenance, never
 * authority-bearing. Surfaces model/runtime identity so the operator can
 * see how the decision was produced, in a clearly non-authoritative way. */
function ProviderTruthRow({ truth }: { truth?: ProviderRuntimeTruth }) {
  if (!truth) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <RuntimeBadge mode={truth.provider_mode} />
      <span className="text-[11px] text-[var(--color-ink-muted)]">
        Assessment source recorded · advisory only
      </span>
    </div>
  );
}

/** Progressive disclosure for immutable audit fields (assessment identity,
 * version, provider runtime configuration, evidence IDs) so they support
 * review without crowding the dominant advisory status. */
function EvidenceAndRuntimeDetail({ assessment }: { assessment: AssessmentReviewSnapshot }) {
  const { provider_truth: providerTruth, race } = assessment;
  return (
    <details className="rounded border border-[var(--color-border)] px-3 py-2 text-xs">
      <summary className="min-h-11 cursor-pointer select-none py-2 text-[var(--color-ink-muted)]">Payment review record details</summary>
      <div className="mt-2 space-y-1">
        <Field label="Review reference" value={assessment.assessment_id} />
        <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border)] py-1.5">
          <dt className="text-[13px] text-[var(--color-ink-muted)]">Review fingerprint</dt>
          <dd className="mono text-[13px] font-medium break-all text-[var(--color-ink)]">{assessment.assessment_hash}</dd>
        </div>
        <Field label="Obligation version" value={assessment.aggregate_version} />
        {providerTruth?.model_id && <Field label="Review method" value={providerTruth.model_id} />}
        {providerTruth?.model_config_version && <Field label="Review policy version" value={providerTruth.model_config_version} />}
        {providerTruth?.runtime_config_sha256 && <Field label="Review configuration fingerprint" value={providerTruth.runtime_config_sha256} />}
        {race?.evidence.evidence_ids.length ? (
          <p className="text-[11px] text-[var(--color-ink-muted)]">Source references: {race.evidence.evidence_ids.join(", ")}</p>
        ) : null}
        {race?.evidence.authoritative_facts && (
          <p className="text-[11px] text-[var(--color-ink-muted)]">
            Raw source due date: {race.evidence.authoritative_facts.due_date ?? "Not captured on source"} · Effective due date: {race.evidence.authoritative_facts.effective_due_date ?? "Not derived"} · Basis: {race.evidence.authoritative_facts.effective_due_date_basis ?? "None recorded"} · Assessment as of: {race.evidence.authoritative_facts.as_of_date}
          </p>
        )}
            </div>
    </details>
  );
}

function AssessmentTraceView({ race }: { race: RaceAssessment }) {
  const steps = buildAssessmentTrace(race);
  return (
    <details className="rounded border border-[var(--color-border)] px-3 py-2 text-xs" data-testid="assessment-trace">
      <summary className="min-h-11 cursor-pointer select-none py-2 text-[var(--color-ink-muted)]">
        Assessment trace — evidence, facts, model proposal, validated findings, remediation
      </summary>
      <ol className="mt-2 space-y-2">
        {steps.map((step) => (
          <li key={step.step} className="border-s-2 border-[var(--color-border)] ps-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
              {step.label} · {step.authority.replaceAll("_", " ").toLowerCase()}
            </p>
            {step.items.length > 0 ? (
              <ul className="list-disc ps-5 text-[12px] text-[var(--color-ink)]">
                {step.items.map((item, index) => <li key={index}>{item.replace("authorized operator attestation", "authorized user attestation")}</li>)}
              </ul>
            ) : (
              <p className="text-[12px] text-[var(--color-ink-muted)]">{step.empty_reason}</p>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}

/** Finance-facing advisory summary. Detailed control records remain in one
 * collapsed disclosure so they do not crowd the payment decision. */
function AdvisoryAssessmentCard({
  assessment,
  label,
  stale,
  allAssessed,
  action,
}: {
  assessment: AssessmentReviewSnapshot;
  label: string;
  stale?: boolean;
  allAssessed?: boolean;
  action?: React.ReactNode;
}) {
  const tone = stale ? "danger" : decisionTone(assessment.decision);
  const { border, text } = TONE_STYLE[tone];
  const race = assessment.race;
  const findings = race?.result.validated_findings ?? [];
    const decisionLabelClass =
    stale
      ? "text-[var(--color-danger)]"
      : tone === "warning"
        ? "text-[var(--status-hold-text)]"
        : tone === "danger"
          ? "text-[var(--status-blocked-text)]"
          : "text-[var(--color-ink-muted)]";

  return (
    <div
      className={`space-y-2 border-s-2 ps-3 ${stale ? "border-[var(--color-danger)] bg-[var(--color-warning-bg)]" : border}`}
      data-testid={stale ? "superseded-assessment-snapshot" : "reviewed-assessment-snapshot"}
    >
      <div className="flex items-baseline justify-between gap-2">
        <p className={`text-[12px] font-semibold uppercase tracking-wide ${stale ? "text-[var(--color-danger)]" : text}`}>
          {label}
          {stale && " — superseded"}
        </p>
        <span className={`text-[11px] font-semibold uppercase ${decisionLabelClass}`} aria-label={`Advisory decision: ${assessment.decision}`}>
          Advisory — {assessment.decision}
        </span>
      </div>

      {/* Concise rationale from the RACE decision summary */}
      {race?.result.decision_summary && (
        <p className={`text-[13px] ${stale ? "text-[var(--color-danger)] line-through" : "text-[var(--color-ink)]"}`}>
          {financeFacingAssessmentText(race.result.decision_summary)}
        </p>
      )}

      {/* Reasons (application-owned summaries) */}
      <ul className="list-disc ps-5 text-[12px] text-[var(--color-ink-muted)]">
        {assessment.reasons.map((reason, index) => (
          <li key={index}>{financeFacingAssessmentText(reason)}</li>
        ))}
      </ul>
      <p className="border-s-2 border-[var(--color-accent)] ps-2 text-[12px] font-medium text-[var(--color-ink)]">
        {assessmentNextAction(assessment.decision, allAssessed ?? false)}
      </p>

      {/* Deterministic findings — the application-owned blockers */}
      {findings.length > 0 && (
        <div className="space-y-1 border-s-[3px] border-s-[var(--color-warning)] ps-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            Review findings ({findings.length})
          </p>
          <ul className="space-y-0.5">
            {findings.map((finding) => (
              <li key={finding.code} className="flex items-baseline justify-between gap-2">
                <span className="text-[12px]">{finding.reason}</span>
                <span
                  className="text-[11px] font-semibold text-[var(--status-hold-text)]"
                  aria-label={`Severity: ${finding.severity}`}
                >
                  {finding.severity}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Catalog-derived remediation */}
      {race && findings.length > 0 && (
        <div className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            Remediation
          </p>
          {race.remediation.map((item) => (
            <div key={item.finding_code} className="border-s-2 border-[var(--color-warning)] ps-2">
              <p className="text-[12px]">{item.reason}</p>
              <p className="text-[11px] text-[var(--color-ink-muted)]">
                <strong>Action:</strong> {item.required_action} · <strong>Owner:</strong> {item.owner_role} · reassess {item.reassess_after_resolution ? "permitted" : "not permitted"}
              </p>
              <p className="text-[11px] text-[var(--color-ink-muted)]">
                <strong>Evidence required:</strong> {item.required_evidence.join("; ")}
              </p>
              {item.escalation_target && (
                <p className="text-[11px] text-[var(--color-danger)]">Escalate to: {item.escalation_target}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Stale state explanation */}
      {stale && (
        <p className="text-[12px] text-[var(--color-danger)]">
          This assessment is no longer current. Review the latest assessment before authorization.
        </p>
      )}

      {action}
    </div>
  );
}

function assessmentProvenanceCopy(assessment: AssessmentReviewSnapshot): string {
  const mode = assessment.provider_truth?.provider_mode;
  if (mode === "LIVE_AI") return "AI-assisted payment review · advisory.";
  if (mode === "NOT_LIVE_AI") return "Rules-based payment review · advisory.";
  if (mode === "BLOCKED_EXTERNAL") return "AI review was unavailable; the assessment source is unconfirmed.";
  return "The assessment source is unavailable.";
}

/** Keep durable assessment records unchanged while presenting their narrative
 * in language a finance user can act on. */
function financeFacingAssessmentText(value: string): string {
  return value
    .replaceAll("Safety Kernel gates", "payment controls")
    .replaceAll("Safety Kernel", "payment controls")
    .replaceAll("Execution Worker", "settlement service")
    .replaceAll("execution packet", "payment release record")
    .replaceAll("provider submission", "settlement submission")
    .replaceAll("provider outcome", "settlement outcome");
}


function AssessmentResultCard({
  assessment,
  nextAction,
  nextOwner,
  paymentEligibility,
  primaryAction,
  stageDescriptionId,
  stageHeadingRef,
  holdFindingsRef,
  holdReviewActive,
  canReassess,
  reassessmentIsPrimary,
  onReassess,
  busy,
}: {
  assessment: AssessmentReviewSnapshot;
  nextAction: string;
  nextOwner: string | null;
  paymentEligibility: { summary: string; candidate?: string; reason?: string; selectionDetail?: string; routeNote?: string } | null;
  primaryAction: { label: string; onClick: () => void } | null;
  stageDescriptionId: string;
  stageHeadingRef: React.RefObject<HTMLHeadingElement | null>;
  holdFindingsRef: React.RefObject<HTMLDetailsElement | null>;
  holdReviewActive: boolean;
  canReassess: boolean;
  reassessmentIsPrimary: boolean;
  onReassess: () => void;
  busy: boolean;
}) {
  const race = assessment.race;
  const findings = race?.result.validated_findings ?? [];
  const checks = race?.action_taken.checks ?? [];
  const summary = race?.result.decision_summary ?? assessment.reasons[0];
  const additionalReasons = assessment.reasons.filter((reason) => reason !== summary && !findings.some((finding) => finding.reason === reason));
  const meaning = assessment.decision === "PAY"
    ? "Advice only; it does not approve or move payment."
    : assessment.decision === "HOLD"
      ? "Authorization review remains locked until the reported findings are addressed."
      : "The returned escalation finding requires human review; authorization remains locked.";
  const decisionToneClass = assessment.decision === "HOLD"
    ? "text-[var(--status-hold-text)]"
    : assessment.decision === "ESCALATE"
      ? "text-[var(--status-hold-text)]"
      : "text-[var(--color-ink)]";

  return (
    <section aria-label="Assessment result" className="space-y-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 sm:space-y-3 sm:p-4" data-testid="assessment-result-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border)] pb-1 sm:pb-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Payment review · advisory</p>
          <h3 ref={stageHeadingRef} tabIndex={-1} aria-describedby={stageDescriptionId} className={`mt-0.5 text-[21px] font-semibold ${decisionToneClass}`}>Assessment result — {assessment.decision}</h3>
          <p aria-label="Assessment provenance" className="mt-0.5 text-[12px] leading-4 text-[var(--color-ink-muted)]" data-testid="assessment-provenance">
            {assessmentProvenanceCopy(assessment)}
          </p>
        </div>
      </header>

      <p className="text-[14px] leading-5 text-[var(--color-ink)]">{financeFacingAssessmentText(summary)}</p>

      <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]"><strong className="text-[var(--color-ink)]">What this means:</strong> {meaning}</p>

      {paymentEligibility && (
        <section aria-label="Payment eligibility" className="border-t border-[var(--color-border)] pt-1" data-testid="payment-eligibility">
          <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]">
            <strong className="text-[var(--color-ink)]">Payment eligibility:</strong> {paymentEligibility.candidate
              ? <>Not the selected payment candidate. Selected: <strong className="text-[var(--color-ink)]">{paymentEligibility.candidate}</strong>. Rule: {paymentEligibility.reason}</>
              : paymentEligibility.summary}
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-1" data-testid="assessment-action-area">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-[var(--color-ink)]">What to do next</p>
          {!primaryAction && <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]">{assessment.decision === "HOLD" && race?.remediation.length
            ? "Review the recorded correction above. Reassessment requires confirmed eligibility."
            : nextAction}</p>}
          {!primaryAction && nextOwner && <p className="text-[12px] text-[var(--color-ink-muted)]">Next owner/role: <strong className="text-[var(--color-ink)]">{nextOwner}</strong></p>}
        </div>
        {primaryAction && <PrimaryButton onClick={primaryAction.onClick} disabled={busy}>{primaryAction.label}</PrimaryButton>}
      </div>

      <details ref={holdFindingsRef} className="scroll-mt-4 rounded border border-[var(--color-border)] px-3 py-2" data-testid="assessment-supporting-detail">
        <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">Findings and supporting detail</summary>
        <div className="space-y-3 break-words border-t border-[var(--color-border)] pt-3 [overflow-wrap:anywhere]">
          {holdReviewActive && assessment.decision === "HOLD" && <>
            {findings.some(f => f.code === "NORMALIZATION_REVIEW_REQUIRED") && <p className="text-[13px] leading-5">Source correction required. The recorded owner must verify and correct the source record outside this screen. HOLD remains until the finding is resolved.</p>}
            {findings.some(f => f.code === "SOURCE_EVIDENCE_MISSING") && <p className="text-[13px] leading-5">The recorded owner must supply and validate the required source evidence outside this screen. HOLD remains.</p>}
            {!findings.length && <p className="text-[13px] leading-5">{financeFacingAssessmentText(summary)}</p>}
            {!race?.remediation.length && <p className="text-[13px] leading-5">Required evidence and correction owner are not recorded. Ask the workspace owner to review the source. HOLD remains.</p>}
          </>}
          {additionalReasons.length > 0 && (
            <section aria-label="Assessment reasons" className="space-y-1">
              <h4 className="text-[12px] font-semibold text-[var(--color-ink)]">Assessment reasons</h4>
              <ul className="list-disc space-y-1 ps-5 text-[13px] leading-5 text-[var(--color-ink-muted)]">
                {additionalReasons.map((reason, index) => <li key={`${index}-${reason}`}>{financeFacingAssessmentText(reason)}</li>)}
              </ul>
            </section>
          )}
          {findings.length > 0 ? (
            <section aria-label="Assessment findings" className="space-y-1">
              <h4 className="text-[12px] font-semibold text-[var(--color-ink)]">Returned findings</h4>
              <ul className="list-disc space-y-1 ps-5 text-[13px] leading-5 text-[var(--color-ink-muted)]">
                {findings.map((finding) => <li key={finding.code}>{finding.reason}</li>)}
              </ul>
            </section>
          ) : (
            <p className="text-[13px] text-[var(--color-ink-muted)]">No validated findings are recorded in this assessment.</p>
          )}
          {race?.remediation.map(item => <section key={item.finding_code} aria-label="Recorded remediation" className="space-y-1 text-[13px] text-[var(--color-ink-muted)]"><p>{financeFacingAssessmentText(item.required_action)}</p><p>{item.required_evidence.join("; ")}</p><p>Responsible: {item.owner_role}</p></section>)}
          <section aria-label="Assessment checks recorded" className="space-y-1">
            <h4 className="text-[12px] font-semibold text-[var(--color-ink)]">Checks recorded by the assessment</h4>
            {checks.length > 0 ? (
              <ul className="list-disc space-y-1 ps-5 text-[13px] leading-5 text-[var(--color-ink-muted)]">
                {checks.map((check, index) => <li key={`${index}-${check}`}>{check}</li>)}
              </ul>
            ) : (
              <p className="text-[13px] text-[var(--color-ink-muted)]">No structured check list is present in this assessment record.</p>
            )}
          </section>
          <section aria-label="Assessment capability boundary" className="space-y-1 border-t border-[var(--color-border)] pt-3">
            <h4 className="text-[12px] font-semibold text-[var(--color-ink)]">Capability boundary</h4>
            <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]">This assessment does not verify invoice contents, match purchase orders or receipts, validate supplier tax, or provide enterprise fraud or duplicate assurance.</p>
          </section>
          {(paymentEligibility?.selectionDetail || paymentEligibility?.routeNote) && (
            <section aria-label="Payment candidate selection detail" className="space-y-1 border-t border-[var(--color-border)] pt-3">
              <h4 className="text-[12px] font-semibold text-[var(--color-ink)]">Payment candidate detail</h4>
              {paymentEligibility.selectionDetail && <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]">{paymentEligibility.selectionDetail}</p>}
              {paymentEligibility.routeNote && <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]">{paymentEligibility.routeNote}</p>}
            </section>
          )}
          {canReassess && assessment.decision !== "HOLD" && (
            <div className="border-t border-[var(--color-border)] pt-3">
              {reassessmentIsPrimary ? (
                <div data-testid="assessment-rerun"><PrimaryButton onClick={onReassess} disabled={busy}>Run AI Assessment again</PrimaryButton></div>
              ) : (
                <button type="button" data-testid="assessment-rerun" disabled={busy} onClick={onReassess}
                  className="min-h-[44px] rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 text-[13px] font-semibold text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)] disabled:opacity-50">
                  Run AI Assessment again
                </button>
              )}
              <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">A rerun is advisory only and cannot authorize or execute payment.</p>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
  danger,
  ariaLabel,
  busy,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  danger?: boolean;
  ariaLabel?: string;
  busy?: boolean;
}) {
  return (
    <button
      data-primary-action="true"
      aria-label={ariaLabel}
      aria-busy={busy}
      onClick={onClick}
      disabled={disabled}
      className={`min-h-[44px] w-fit rounded px-4 py-2 text-[13px] font-semibold tracking-wide text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "bg-[var(--color-danger-action-bg)] hover:opacity-90" : "bg-[var(--color-primary-action)] hover:opacity-90"
      }`}
    >
      {children}
    </button>
  );
}

type FinancialReceiptBinding = { instructionHash: string; packetHash: string; aggregateVersion: number };
type ActionResult = { label: string; data: unknown; ok: boolean; status: number; obligationId: string | null; financialBinding?: FinancialReceiptBinding; readConfirmed?: boolean; aggregateVersion?: number };

function requiresSubmissionReconciliation(result: ActionResult | null): boolean {
  if (!result || result.label !== "execute" || result.readConfirmed) return false;
  return executionResponseNeedsReconciliation(result);
}

function confirmedFinancialReceipt(result: ActionResult, detail: ObligationDetail): string | null {
  const expected = result.financialBinding;
  if (!expected || result.obligationId !== detail.record.obligation_id ||
      expected.instructionHash !== detail.sealed_pae_instruction_hash) return null;
  if (result.label === "release" && detail.payment_release_current === true && detail.payment_release_approval &&
      detail.execution_gate === "PORTAL_APPROVED_EXACT_PACKET" && !detail.execution &&
      expected.packetHash === detail.execution_packet?.packet_sha256 &&
      expected.aggregateVersion === detail.aggregate.aggregate_version) {
    return "Refreshed status confirms release approval for this same instruction. Review the exact details before choosing Pay testnet USDC; no payment is submitted automatically.";
  }
  // Historical packet validation binds the recorded execution to its sealed PAE.
  // UNKNOWN and SUBMITTING remain unresolved even when durably recorded.
  if (result.label === "execute" && detail.execution?.obligation_id === result.obligationId &&
      ["SETTLED", "FAILED", "BLOCKED", "SUBMITTED"].includes(detail.execution.status) &&
      detail.settlement_evidence_binding?.state === "AVAILABLE_HISTORICAL" &&
      detail.settlement_evidence_binding.packet?.packet_sha256 === expected.packetHash) {
    return "Refreshed status confirms an execution record for this same instruction. Review its reconciliation evidence; do not retry or resubmit. This receipt alone does not establish successful settlement.";
  }
  return null;
}
type StageCompletionReceipt = { obligationId: string; message: string };
const assessmentRequestUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function exactAssessmentStatus(value:unknown,id:string,key:string,version:string):GenuineAssessmentStatus|null {
 if(!value||typeof value!=="object"||Array.isArray(value)||(value as {code?:unknown}).code==="ASM-001")return null;
 const v=value as GenuineAssessmentStatus;
 if(v.obligation_id!==id||v.idempotency_key!==key||v.aggregate_version!==version||v.financial_action_eligible!==false||typeof v.source_record_sha256!=="string"||!/^[a-f0-9]{64}$/.test(v.source_record_sha256)||!["NOT_FOUND","RESERVED","PROVIDER_RESULT_DURABLE","UNKNOWN","STALE","COMPLETED_CURRENT"].includes(v.status))return null;
 if(v.status==="COMPLETED_CURRENT"&&(!v.receipt||v.receipt.assessment_id!==`ASM-${key}`||v.receipt.aggregate_version!==version||typeof v.receipt.assessment_hash!=="string"||!/^[a-f0-9]{64}$/.test(v.receipt.assessment_hash)))return null;
 if(v.status!=="COMPLETED_CURRENT"&&v.receipt!==undefined)return null;
 return v;
}
/** Confirmation uses an independent current-detail read, including genuine
 * source bytes. A status response alone never injects or releases a result. */
export async function assessmentStatusMatchesDetail(status:GenuineAssessmentStatus,detail:ObligationDetail|null):Promise<boolean> {
 const receipt=status.receipt,current=assessmentReviewSnapshot(detail?.current_assessment);
 if(status.status!=="COMPLETED_CURRENT"||!receipt||!detail||detail.source_group!=="GENUINE_COMPANY"||!hasExpectedObligationIdentity(detail,status.obligation_id)||String(detail.aggregate.aggregate_version)!==status.aggregate_version||!current||current.obligation_id!==status.obligation_id||current.assessment_id!==receipt.assessment_id||current.assessment_hash!==receipt.assessment_hash||current.aggregate_version!==status.aggregate_version||!globalThis.crypto?.subtle)return false;
 const digest=await globalThis.crypto.subtle.digest("SHA-256",new TextEncoder().encode(canonicalize(detail.record)));
 return Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,"0")).join("")===status.source_record_sha256;
}
type AssessmentFeedback = {
  obligationId: string;
  expectedVersion: string;
  selectionGeneration: number;
  kind: "in-flight" | "pending" | "unconfirmed" | "stale" | "identity-mismatch" | "awaiting-refresh" | "durable";
  title: string;
  message: string;
  durability: string;
  nextStep: string;
  owner: string;
  assessmentId?: string;
  assessmentHash?: string;
  statusCode?: string;
};

type AssessmentConflict = {
  obligationId:string;attemptedKey:string;earlierKey:string;version:string;sourceFingerprint:string;
  selection:number;detailRequest:number;epoch:number;
};

type PayableBlocker = {
  kind: string;
  title: string;
  reason: string;
  impact: string;
  nextAction: string;
  responsible: string;
  evidence: string[];
  action: "assessment-status" | "evidence" | "funding" | "authority" | "reconcile" | "refresh" | null;
  lastVerified?: string;
};

function retainedAssessmentRequestKey(id: string): string | null {
  if (!id || typeof window === "undefined") return null;
  try { return localStorage.getItem(`tameion.assessment-request.${id}`); }
  catch { return "Request identity unavailable"; }
}

/** Presentation only. This never supplies action eligibility or releases an intent. */
export function payableBlockers({ detail, state, selectedId, feedback, requestKey, conflict, stage, response, executionResponse }: {
  detail: ObligationDetail | null; state: DetailState; selectedId: string;
  feedback?: AssessmentFeedback | null; requestKey?: string | null; conflict?: AssessmentConflict | null;
  stage: string; response?: ActionResult | null; executionResponse?: ActionResult | null;
}): PayableBlocker[] {
  if (!selectedId || state === "none") return [];
  const blockers: PayableBlocker[] = [];
  const exactDetail = detail && hasExpectedObligationIdentity(detail, selectedId);
  const unresolvedExecution = executionResponse?.obligationId === selectedId && requiresSubmissionReconciliation(executionResponse);
  if (unresolvedExecution || exactDetail && ["UNKNOWN", "SUBMITTING", "SUBMITTED"].includes(detail.execution?.status ?? "")) blockers.push({
    kind: "execution-unknown", title: "Payment outcome unverified", reason: "The existing submission has no confirmed final outcome. Do not retry or submit another payment.",
    impact: "Payment completion and reconciliation are unconfirmed.", nextAction: "Reconcile the existing submission using read-only status review.",
    responsible: "Unassigned · reconciliation owner not recorded", action: "reconcile",
    evidence: unresolvedExecution ? ["Payment request completion unverified.", ...(executionResponse?.financialBinding ? [`Release reference: ${executionResponse.financialBinding.packetHash}`] : [])]
      : [`Execution status: ${detail!.execution!.status}`, ...(detail!.execution!.idempotency_key ? [`Submission reference: ${detail!.execution!.idempotency_key}`] : []), ...(detail!.execution!.provider_ref ? [`Provider reference: ${detail!.execution!.provider_ref}`] : [])],
  });
  if (state === "loading") return blockers;
  if (state !== "loaded" || !detail || !exactDetail) return [...blockers, {
    kind: "unavailable", title: "Current status unavailable", reason: "Reason not yet verified. Current payable details could not be confirmed.",
    impact: "Assessment and payment actions are unavailable.", nextAction: "Refresh the selected payable's current status.",
    responsible: "User · status review", evidence: [], action: "refresh" as const,
  }];
  const unresolved = Boolean(requestKey || feedback && feedback.kind !== "durable");
  if (unresolved) {
    const exactStatus=feedback?.statusCode?.startsWith("ASM_STATUS_")===true;
    const storageUnavailable = feedback?.statusCode === "REQUEST_IDENTITY_UNAVAILABLE";
    const unavailable = ["ASSESSMENT_UNAVAILABLE", "AUTH_UNAVAILABLE", "GENUINE_WORKFLOW_UNAVAILABLE", "REQUEST_IDENTITY_UNAVAILABLE"].includes(feedback?.statusCode ?? "");
    const pending = feedback?.kind === "in-flight" || feedback?.kind === "pending" || feedback?.kind === "awaiting-refresh";
    blockers.push({
      kind: conflict ? "assessment-earlier" : unavailable ? "system-unavailable" : pending ? "assessment-pending" : "assessment-unverified",
      title: conflict ? "Earlier assessment needs review" : unavailable ? "Assessment unavailable" : pending ? "Assessment pending" : "Assessment outcome unverified",
      reason: conflict ? "The service reported an earlier unresolved assessment. Its link to this payable’s current source and version is unverified." : exactStatus ? feedback!.message : storageUnavailable ? "Assessment was not sent because its request identity could not be stored in this browser." : unavailable ? "The assessment service is unavailable. A final result has not been confirmed." : pending ? "The assessment is still processing or awaiting confirmation." : "Reason not yet verified. The assessment request has no confirmed durable result.",
      impact: storageUnavailable ? "Assessment has not started. Payment remains unavailable." : "Assessment completion is unconfirmed. Payment remains unavailable.",
      nextAction: conflict ? "Ask the workspace owner to reconcile the earlier request before another assessment can be accepted. Do not submit another assessment." : exactStatus ? feedback!.nextStep : storageUnavailable ? "Allow browser storage, then reload before starting an assessment." : detail.source_group==="GENUINE_COMPANY" ? "Check the original assessment request. Do not submit another assessment while it is unresolved." : "Refresh the payable list to check for newer records. The exact assessment outcome remains unverified. Do not reassess or retry while unresolved.",
      responsible: conflict ? "Workspace owner · request review" : exactStatus ? feedback!.owner : storageUnavailable ? "User · status review" : "Unassigned · assessment reconciliation owner not recorded", action: pending && feedback?.kind === "in-flight" ? null : "assessment-status",
      evidence: [requestKey ? `Request reference: ${requestKey}` : "Request reference unavailable.", ...(conflict ? [`Server-reported earlier reference (source/version unverified): ${conflict.earlierKey}`] : []), "Confirmed assessment receipt unavailable.", ...(feedback?.statusCode ? [`Status code: ${feedback.statusCode}`] : [])],
    });
  } else {
    const assessment = assessmentReviewSnapshot(detail.current_assessment);
    if (assessment?.obligation_id === selectedId && assessment.aggregate_version === String(detail.aggregate.aggregate_version) && ["HOLD", "ESCALATE"].includes(assessment.decision)) {
      const findings = assessment.race?.result.validated_findings ?? [];
      const remediation = assessment.race?.remediation ?? [];
      const reasons = findings.length ? findings.map(f => f.reason) : assessment.reasons;
      const owners = [...new Set(remediation.map(r => assessment.decision === "ESCALATE" ? r.escalation_target ?? r.owner_role : r.owner_role))];
      const missing = findings.some(f => f.code === "SOURCE_EVIDENCE_MISSING" || f.code === "DUE_DATE_NOT_STATED");
      blockers.push({
        kind: missing ? "source-evidence" : "assessment-hold", title: missing ? "Source evidence required" : "Assessment needs review",
        reason: financeFacingAssessmentText(reasons[0] || "Reason not yet verified"), impact: "Authorization and payment remain unavailable.",
        nextAction: remediation[0] ? financeFacingAssessmentText(remediation[0].required_action) : "Review the recorded assessment evidence before any further action.",
        responsible: owners.length ? owners.join("; ") : "Unassigned · responsible party not recorded", action: "evidence",
        evidence: [`Assessment reference: ${assessment.assessment_id}`, `Assessment hash: ${assessment.assessment_hash}`, ...findings.map(f => `Finding: ${f.code}`), ...remediation.flatMap(r => r.required_evidence)],
      });
      for (const reason of reasons.slice(1)) blockers.push({kind: "assessment-finding", title: "Additional assessment finding", reason: financeFacingAssessmentText(reason), impact: "Authorization remains unavailable.", nextAction: "Review the recorded evidence.", responsible: owners.join("; ") || "Unassigned", evidence: [], action: "evidence"});
    }
  }
  // Funding/destination controls are relevant after assessment. A missing
  // balance never becomes an invented shortfall or prevents advisory review.
  if (["Authorization", "Assurance", "Payment"].includes(stage) && !detail.execution) {
    const matchingResponse = response?.obligationId === selectedId && response.aggregateVersion === detail.aggregate.aggregate_version && response.label === "proxy preflight";
    const payload = matchingResponse && response.data && typeof response.data === "object" ? response.data as {blocker?:unknown;code?:unknown;readiness?:unknown;captured_at?:unknown} : null;
    // The displayed wallet observation has no source-wallet identity. It cannot
    // prove this instruction's funding. Use an actual bound provider refusal.
    const shortfall = response?.status === 409 && payload?.blocker === "INSUFFICIENT_BALANCE" && payload?.readiness === "BLOCKED";
    const fundingUnverified = response?.status === 409 && payload?.readiness === "BLOCKED" && payload.blocker === "PROVIDER_QUERY_FAILED" ||
      response?.status === 503 && ["PROVIDER_BALANCE_NOT_VERIFIED", "BALANCE_NOT_VERIFIED"].includes(String(payload?.code));
    if (shortfall || fundingUnverified) blockers.push({
      kind: shortfall ? "funding-shortfall" : "funding-unverified", title: shortfall ? "Funding shortfall" : "Funding not verified",
      reason: shortfall ? "The provider check reported insufficient funds for this instruction and its fee." : "Funding for this instruction has not been verified.",
      impact: "Funding readiness is not established.", nextAction: "Review the wallet balance before payment.", responsible: "Unassigned · funding owner not recorded",
      action: "funding", evidence: [`Provider status: ${shortfall ? "INSUFFICIENT_BALANCE" : String(payload?.blocker ?? payload?.code)}`],
      ...(shortfall && typeof payload?.captured_at === "string" && Number.isFinite(Date.parse(payload.captured_at)) ? {lastVerified:payload.captured_at} : {}),
    });
    if (detail.aggregate.destination_verification_status !== "VERIFIED") blockers.push({
      kind: "beneficiary-unverified", title: "Recipient not verified", reason: "The payment destination is not verified.", impact: "Payment remains unavailable.",
      nextAction: "Review the recorded recipient and destination evidence.", responsible: "Unassigned · recipient verification owner not recorded", action: "authority",
      evidence: [`Destination status: ${detail.aggregate.destination_verification_status}`],
    });
  }
  const assessment = assessmentReviewSnapshot(detail.current_assessment);
  const boundPay = assessment?.obligation_id === selectedId && assessment.aggregate_version === String(detail.aggregate.aggregate_version) && assessment.decision === "PAY";
  const linkedDraftAvailable = !unresolved && !unresolvedExecution && boundPay && detail.advisory_action_eligible === true && !detail.linked_testnet_instructions?.some(row => row.assessment_hash === assessment?.assessment_hash);
  if (detail.financial_action_eligible !== true && (boundPay || ["Authorization", "Assurance", "Payment"].includes(stage))) blockers.push({
    kind: "authority-absent", title: "Payment authority required", reason: "This payable has no admitted payment authority.", impact: "Payment preparation and execution are unavailable.",
    nextAction: linkedDraftAvailable ? "Create a separate linked testnet instruction for approval." : "Review payment authority for the separate linked instruction.", responsible: "Unassigned · authorized approver not recorded", action: "authority", evidence: ["Financial action eligibility: false"],
  });
  return blockers;
}

function HoldReasonCard({blockers, feedback, requestKey}: {blockers: PayableBlocker[]; feedback: AssessmentFeedback | null; requestKey: string | null}) {
  const primary = blockers[0];
  if (!primary) return null;
  const requestStatus = (primary.kind.startsWith("assessment-") || primary.kind === "system-unavailable") && primary.kind !== "assessment-hold" && Boolean(feedback || requestKey);
  return <section aria-label="Hold reason and next action" className="mt-3 space-y-2 rounded border-s-4 border-[var(--color-warning)] bg-[var(--color-bg)] p-3" data-testid="hold-reason">
    <div role={requestStatus ? "status" : undefined} aria-label={requestStatus ? "Assessment request status" : undefined} aria-live={feedback && ["unconfirmed", "stale", "identity-mismatch"].includes(feedback.kind) ? "assertive" : "polite"} aria-atomic="true" data-testid={requestStatus ? "assessment-request-feedback" : undefined} data-feedback-kind={requestStatus ? feedback?.kind ?? "unconfirmed" : undefined}>
      {feedback?.kind === "in-flight" && <p role="status" aria-label="AI assessment in progress" className="text-sm">Reviewing payable details</p>}
      <h3 className="text-sm font-semibold">{primary.title}</h3>
      <p className="mt-1 text-sm leading-5">{primary.reason}</p>
      <dl className="mt-2 grid gap-1 text-[13px] leading-5 text-[var(--color-ink-muted)]">
        <div><dt className="inline font-semibold text-[var(--color-ink)]">Impact: </dt><dd className="inline">{primary.impact}</dd></div>
        <div><dt className="inline font-semibold text-[var(--color-ink)]">Next action: </dt><dd className="inline">{primary.nextAction}</dd></div>
        <div><dt className="inline font-semibold text-[var(--color-ink)]">Responsible: </dt><dd className="inline">{primary.responsible}</dd></div>
      </dl>
      <details id="hold-technical-details" className="mt-1 text-xs text-[var(--color-ink-muted)]">
        <summary className="min-h-11 cursor-pointer py-3 font-semibold">Technical details</summary>
        <ul className="space-y-1 break-all">{primary.evidence.map((e,i) => <li key={i}>{e}</li>)}</ul>
        {primary.lastVerified && <p>Last verified: <time dateTime={primary.lastVerified}>{primary.lastVerified}</time></p>}
        {feedback && <div className="mt-2 space-y-1"><p>{feedback.message}</p><p>{feedback.durability}</p><p>{feedback.nextStep}</p></div>}
      </details>
    </div>
    {blockers.length > 1 && <details className="text-[13px] text-[var(--color-ink-muted)]"><summary className="min-h-11 cursor-pointer py-3 font-semibold">{blockers.length - 1} additional {blockers.length === 2 ? "blocker" : "blockers"}</summary>{blockers.slice(1).map((b,i) => <div key={i} className="border-t border-[var(--color-border)] py-2"><p className="font-semibold">{b.title}</p><p>{b.reason}</p><p>{b.nextAction}</p><p>Responsible: {b.responsible}</p></div>)}</details>}
  </section>;
}

function assessmentFeedbackForResponse(
  result: { status: number; data: unknown },
  obligationId: string,
  expectedVersion: string,
  selectionGeneration: number,
): AssessmentFeedback {
  const code = result.data && typeof result.data === "object" && "code" in result.data
    ? String((result.data as { code: unknown }).code)
    : "";
  const serverStatus = result.data && typeof result.data === "object" && "status" in result.data
    ? String((result.data as { status: unknown }).status)
    : "";
  const statusCode = code || serverStatus || (result.status ? `HTTP ${result.status}` : "NO_RESPONSE");
  if (result.status === 200) {
    const identity = assessmentReceiptIdentity(result.data);
    const receipt = assessmentReceiptSnapshot(result.data);
    if (identity.obligation_id && identity.obligation_id !== obligationId) {
      return {
        obligationId, expectedVersion, selectionGeneration, statusCode, kind: "identity-mismatch", title: "Assessment response identity did not match.",
        message: "The returned assessment belongs to a different payable, so it was not applied to this selection.",
        durability: "No current assessment is confirmed for the selected payable.",
        nextStep: "Refresh the selected payable's current status before taking another assessment action.",
        owner: "You · read-only status review",
      };
    }
    if (identity.aggregate_version && identity.aggregate_version !== expectedVersion) {
      return {
        obligationId, expectedVersion, selectionGeneration, statusCode, kind: "stale", title: "Assessment response is for a different version.",
        message: "The selected payable changed while this assessment was being processed; this response is not presented as current.",
        durability: "The response does not confirm an assessment for the current selected version.",
        nextStep: "Refresh the selected payable's current status before taking another assessment action.",
        owner: "You · read-only status review",
      };
    }
    if (!receipt) {
      return {
        obligationId, expectedVersion, selectionGeneration, statusCode, kind: "unconfirmed", title: "Assessment receipt could not be verified.",
        message: "The server response did not contain a complete assessment receipt for the selected payable.",
        durability: "A current assessment is not confirmed.",
        nextStep: "Refresh the selected payable's current status; do not send another request while the outcome is unclear.",
        owner: "Unassigned · no recovery owner is recorded",
      };
    }
    return {
      obligationId, expectedVersion, selectionGeneration, statusCode, kind: "awaiting-refresh", title: "Assessment response received.",
      message: "Checking refreshed payable details before presenting this assessment as current.",
      durability: "A complete receipt was returned; current selected-detail confirmation is pending.",
      nextStep: "Wait for the read-only detail refresh. The assessment remains advisory.",
      owner: "Finance Agent · current-detail confirmation",
      assessmentId: receipt.assessment_id,
      assessmentHash: receipt.assessment_hash,
    };
  }
  if (result.status === 202) {
    const recoveryPending = serverStatus === "RECOVERY_PENDING";
    return {
      obligationId, expectedVersion, selectionGeneration, statusCode, kind: "pending",
      title: recoveryPending ? "Assessment recovery is pending." : "Assessment is still in progress.",
      message: recoveryPending
        ? "The payment review is still being finalized; the recorded result is available but is not yet current."
        : "HTTP 202: the operation is still running; this is not a current assessment result.",
      durability: recoveryPending ? "Assessment result recorded; the current payment review is not yet final." : "Completion not confirmed; request key remains bound.",
      nextStep: "Refresh the read-only queue summary for any newer record; it does not confirm this operation's exact receipt or completion.",
      owner: "Unassigned · no individual recovery owner is recorded",
    };
  }
  if (result.status === 0 || code === "ASM-UNKNOWN" || code === "ASM-OPERATION-UNRESOLVED") {
    return {
      obligationId, expectedVersion, selectionGeneration, statusCode, kind: "unconfirmed", title: "Assessment outcome is not confirmed.",
      message: result.status === 0
        ? "No response was received, so the assessment outcome is unknown."
        : actionErrorMessage(result.data),
      durability: "No current receipt; existing request key retained.",
      nextStep: "Refresh the read-only queue summary for any newer record; this does not confirm the operation. No automatic retry was sent.",
      owner: "Unassigned · assessment outcome is unresolved",
    };
  }
  if (result.status === 409 && code === "ASM-001") {
    return {
      obligationId, expectedVersion, selectionGeneration, statusCode, kind: "unconfirmed", title: "Assessment outcome is not confirmed.",
      message: "The result could not be confirmed for the current payable. Keep the original request reference for review.",
      durability: "Request reference retained; prior provider work is not ruled out.",
      nextStep: "Refresh the read-only queue summary for any newer record; it does not confirm this operation's exact receipt or completion.",
      owner: "You · read-only status review",
    };
  }
  return {
    obligationId, expectedVersion, selectionGeneration, statusCode, kind: "unconfirmed",
    title: "Assessment result is unavailable.",
    message: actionErrorMessage(result.data),
    durability: "No current receipt; existing request key retained.",
    nextStep: "Refresh the read-only queue summary for any newer record; this does not confirm the operation. No automatic retry was sent.",
    owner: "Finance Agent · individual recovery owner is not recorded",
  };
}

function AssessmentFeedbackBanner({ feedback, onRefreshQueue }: { feedback: AssessmentFeedback; onRefreshQueue?: () => void }) {
  const tone = feedback.kind === "durable" ? "border-[var(--color-success)]" :
    feedback.kind === "stale" || feedback.kind === "identity-mismatch" || feedback.kind === "unconfirmed"
      ? "border-[var(--color-warning)]" : "border-[var(--color-border-strong)]";
  const announcement = feedback.kind === "stale" || feedback.kind === "identity-mismatch" || feedback.kind === "unconfirmed";
  return (
    <section role="status" aria-live={announcement ? "assertive" : "polite"} aria-atomic="true" aria-label="Assessment request status"
      data-testid="assessment-request-feedback" data-feedback-kind={feedback.kind}
      className={`space-y-1 rounded border-s-4 ${tone} bg-[var(--color-surface)] px-3 py-2`}>
      {feedback.kind === "in-flight" && <div role="status" aria-label="AI assessment in progress" className="mb-2 flex items-center gap-3 rounded-lg bg-[var(--color-bg)] px-3 py-2 text-[12px] font-semibold text-[var(--color-ink)]"><span aria-hidden="true" className="flex items-center gap-1"><span className="ai-pulse-dot"/><span className="ai-pulse-dot"/><span className="ai-pulse-dot"/></span><span>Reviewing payable details</span></div>}
      <h3 className="text-[13px] font-semibold text-[var(--color-ink)]">{feedback.title}</h3>
      {onRefreshQueue && <button type="button" onClick={onRefreshQueue} className="min-h-11 rounded border border-[var(--color-border-strong)] px-3 py-2 text-start text-[12px] font-semibold underline">Refresh queue summary (read-only)</button>}
      <p className="text-[12px] leading-4 text-[var(--color-ink-muted)]">{feedback.message}</p>
      <p className="text-[12px] leading-4 text-[var(--color-ink-muted)]"><strong className="text-[var(--color-ink)]">Durability:</strong> {feedback.durability}</p>
      <p className="text-[12px] leading-4 text-[var(--color-ink-muted)]"><strong className="text-[var(--color-ink)]">Next step:</strong> {feedback.nextStep}</p>
      <p className="text-[12px] leading-4 text-[var(--color-ink-muted)]"><strong className="text-[var(--color-ink)]">Owner:</strong> {feedback.owner}</p>
    </section>
  );
}

function actionErrorMessage(data: unknown, label?: string): string {
  if (data && typeof data === "object" && "code" in data) {
    const reply = data as { code?: unknown; release_gate?: unknown };
    if (reply.code === "OUTCOME_UNVERIFIED" && label === "execute" && reply.release_gate !== "READ_ONLY_CONFIRMATION_REQUIRED") {
      return "Payment may have been submitted. No automatic retry was made; do not retry or resubmit. Refresh current status and use read-only reconciliation for this same instruction.";
    }
    if (label === "execute" && (reply.code === "RECONCILIATION_ONLY" || reply.code === "EXECUTION_ALREADY_RECORDED")) {
      return "An execution attempt is recorded or its outcome remains unresolved. Do not retry or resubmit. Refresh current status and review read-only reconciliation evidence for this same instruction.";
    }
  }
  if (data && typeof data === "object" && "blocker" in data && typeof (data as { blocker: unknown }).blocker === "string") {
    const blockerMessages: Record<string, string> = {
      FEE_CAP_EXCEEDED: "The current estimated network fee exceeds the approved network-fee limit. No payment was submitted.",
      TOTAL_DEBIT_CAP_EXCEEDED: "The estimated total debit exceeds the approved total-debit limit. No payment was submitted.",
      INSUFFICIENT_BALANCE: "The verified testnet USDC balance is not sufficient for this payment and its network fee. No payment was submitted.",
      PRIOR_MATCHING_OUTBOUND: "A matching outbound testnet transaction already exists. The payment was not submitted again.",
      PROVIDER_QUERY_FAILED: "Settlement readiness could not be confirmed with Circle. No payment was submitted.",
    };
    return blockerMessages[(data as { blocker: string }).blocker] ??
      "Settlement readiness could not be verified. No payment was submitted.";
  }
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  if (data && typeof data === "object" && "code" in data && typeof (data as { code: unknown }).code === "string") {
    return `The request did not succeed (${(data as { code: string }).code}).`;
  }
  return "The request did not succeed.";
}

function ActionResultBanner({ result, title, focusOnMount = false }: { result: ActionResult; title?: string; focusOnMount?: boolean }) {
  const alertRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (result.readConfirmed || (result.ok && !requiresSubmissionReconciliation(result)) || !focusOnMount) return;
    const alert = alertRef.current;
    alert?.focus({ preventScroll: true });
    if (typeof alert?.scrollIntoView === "function") alert.scrollIntoView({ block: "nearest" });
  }, [focusOnMount, result]);
  if (result.readConfirmed || (result.ok && !requiresSubmissionReconciliation(result))) return null;
  const replyCode = result.data && typeof result.data === "object" && "code" in result.data ? result.data.code : null;
  const message = requiresSubmissionReconciliation(result)
    ? actionErrorMessage({code: ["RECONCILIATION_ONLY", "EXECUTION_ALREADY_RECORDED"].includes(String(replyCode)) ? replyCode : "OUTCOME_UNVERIFIED"}, "execute")
    : actionErrorMessage(result.data, result.label);
  return (
    <div ref={alertRef} role="alert" aria-live="assertive" tabIndex={focusOnMount ? -1 : undefined} className="border-s-[3px] border-s-[var(--color-danger)] bg-[var(--color-surface)] px-3 py-2">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-danger)]">
        {title ?? `Refused (HTTP ${result.status})`}
      </p>
      <p className="mt-0.5 text-[13px] text-[var(--color-ink)]">{message}</p>
    </div>
  );
}

type ProviderMode = "LIVE_AI" | "NOT_LIVE_AI" | "BLOCKED_EXTERNAL";

const RUNTIME_BADGE: Record<ProviderMode, { label: string; textVar: string; surfaceVar: string; borderVar: string }> = {
  LIVE_AI: {
    label: "AI-assisted review",
    textVar: "var(--status-pass-text)",
    surfaceVar: "var(--status-pass-surface)",
    borderVar: "var(--status-pass-border)",
  },
  NOT_LIVE_AI: {
    label: "Rules-based review",
    textVar: "var(--status-advisory-text)",
    surfaceVar: "var(--status-advisory-surface)",
    borderVar: "var(--status-advisory-border)",
  },
  BLOCKED_EXTERNAL: {
    label: "AI review unavailable",
    textVar: "var(--status-hold-text)",
    surfaceVar: "var(--status-hold-surface)",
    borderVar: "var(--status-hold-border)",
  },
};

/** Explicit, non-color-only runtime provenance for an assessment — never a
 * confidence score, since the real Finance Agent output schema has none. */
function RuntimeBadge({ mode }: { mode: ProviderMode | null }) {
  if (!mode) return null;
  const style = RUNTIME_BADGE[mode];
  return (
    <span
      className="inline-flex w-fit items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide"
      style={{ color: style.textVar, background: style.surfaceVar, border: `1px solid ${style.borderVar}` }}
    >
      {style.label}
    </span>
  );
}

interface ControlResultView {
  control_id: string;
  result: "PASS" | "HOLD" | "BLOCK" | "NOT_ASSESSED";
  finding_code: string;
}

/** The real per-control Safety Kernel breakdown — actual control IDs and
 * finding codes from SafetyKernelResult.controlResults, never invented
 * telemetry. */
function SafetyKernelBreakdown({ overall, controlResults }: { overall: string; controlResults: ControlResultView[] }) {
  const resultStyle: Record<ControlResultView["result"], { text: string; surface: string; border: string }> = {
    PASS: { text: "var(--status-pass-text)", surface: "var(--status-pass-surface)", border: "var(--status-pass-border)" },
    HOLD: { text: "var(--status-hold-text)", surface: "var(--status-hold-surface)", border: "var(--status-hold-border)" },
    BLOCK: {
      text: "var(--status-blocked-text)",
      surface: "var(--status-blocked-surface)",
      border: "var(--status-blocked-border)",
    },
    NOT_ASSESSED: { text: "var(--color-ink-muted)", surface: "var(--color-surface)", border: "var(--color-border)" },
  };
  return (
    <div className="max-w-xl space-y-2 border border-[var(--color-border)] rounded-[var(--radius-md)] p-3">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
        Stored assurance evidence — {overall} ({controlResults.filter((c) => c.result === "PASS").length}/{controlResults.length} PASS)
      </p>
      <ul className="space-y-1">
        {controlResults.map((c) => {
          const style = resultStyle[c.result];
          return (
            <li key={c.control_id} className="mono flex items-center justify-between gap-2 text-[12px]">
              <span className="text-[var(--color-ink)]">{c.control_id}</span>
              <span
                className="rounded px-1.5 py-0.5 font-semibold"
                style={{ color: style.text, background: style.surface, border: `1px solid ${style.border}` }}
              >
                {c.result}
                {c.result !== "PASS" && c.finding_code !== "NONE" ? ` · ${c.finding_code}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const ASSURANCE_CONTROL_LABELS: Record<ControlResultView["control_id"], string> = {
  "SK-IDENTITY-ORG": "Organization identity is bound",
  "SK-FINANCIAL-AUTHORITY": "Human financial authorization is recorded",
  "SK-COUNTERPARTY-TRUST": "Payee status is current and eligible",
  "SK-DESTINATION-TRUST": "Payment destination is verified and active",
  "SK-SOURCE-WALLET-AUTHORITY": "Settlement source wallet is active",
  "SK-AMOUNT-ATOMIC-EXACT": "Payment amount matches the approved instruction",
  "SK-ASSET-NETWORK": "Settlement asset and network are allowed",
  "SK-STATE-CURRENTNESS": "No business or security hold blocks payment",
  "SK-DUPLICATE-EXTERNAL-SETTLEMENT": "No prior settlement is recorded",
  "SK-KILL-SWITCH": "No payment stop is active",
};

function plainPaeState(state: string): string {
  const labels: Record<string, string> = {
    UNUSED: "No instruction is sealed",
    SEALED: "Sealed · single use",
    REVOKED: "Revoked",
    EXPIRED: "Expired",
    CONSUMED: "Used",
    SUBMITTED: "Submitted · reconcile only",
  };
  return labels[state] ?? state.toLowerCase().replaceAll("_", " ");
}

function currentPaeDisplay(detail: ObligationDetail): string {
  const state = detail.truth.tameion_control_truth.pae_state;
  if (detail.pae_sealed && state === "UNUSED") return "Sealed · single use";
  return plainPaeState(state);
}

function assuranceStateSummary(evidence: AssuranceEvidenceView | undefined): string {
  const available = evidence?.state === "AVAILABLE_CURRENT_BINDING" || evidence?.state === "AVAILABLE_HISTORICAL";
  const current = evidence?.state === "AVAILABLE_CURRENT_BINDING";
  const controls = available ? evidence.control_results : [];
  const allPass = available && controls.length > 0 && controls.every((control) => control.result === "PASS");
  const passedCount = controls.filter((control) => control.result === "PASS").length;
  const failedControls = current ? controls.filter((control) => control.result !== "PASS") : [];
  return current && allPass
    ? `ASSURANCE PASSED · ${passedCount}/${controls.length} controls passed for the current binding.`
    : current
      ? `ASSURANCE BLOCKED · ${passedCount}/${controls.length} controls passed; ${failedControls.length} require attention.`
    : evidence?.state === "AVAILABLE_HISTORICAL" && allPass
      ? `Historical assurance PASS · ${passedCount}/${controls.length} controls passed then; this is not current execution authority.`
      : evidence?.state === "INVALID"
        ? "Assurance evidence could not be integrity-verified. No PASS is shown and execution remains blocked."
        : evidence?.state === "UNAVAILABLE"
          ? "Assurance evidence is unavailable. No current PASS is established."
          : "No PASS assurance is recorded. Execution remains blocked until current assurance succeeds.";
}

function DeterministicAssuranceSummary({ detail }: { detail: ObligationDetail }) {
  const evidence = detail.assurance_evidence;
  const available = evidence?.state === "AVAILABLE_CURRENT_BINDING" || evidence?.state === "AVAILABLE_HISTORICAL";
  const current = evidence?.state === "AVAILABLE_CURRENT_BINDING";
  const controls = available ? evidence.control_results : [];
  const failedControls = current ? controls.filter((control) => control.result !== "PASS") : [];
  const assuranceRecordedBlocked = detail.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution;
  const status = assuranceRecordedBlocked
    ? "Approval recorded · payment controls incomplete; no payment can be released."
    : assuranceStateSummary(evidence);

  return (
    <section aria-label="Deterministic assurance result" className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="assurance-result-card">
      <div>
        <h3 className="text-[16px] font-semibold text-[var(--color-ink)]">Assurance · Payment controls</h3>
        <p className="mt-1 text-[14px] font-semibold text-[var(--color-ink)]">{status}</p>
        {assuranceRecordedBlocked && <p data-testid="assurance-no-action-guidance" className="mt-1 text-sm font-semibold text-[var(--color-ink-muted)]">No further payment action is available in this state.</p>}
      </div>
      <p className="text-sm text-[var(--color-ink-muted)]">Payment controls, not AI, grant or deny release authority.</p>
      <p className="text-[13px] text-[var(--color-ink-muted)]">Payment instruction state: {currentPaeDisplay(detail)}{detail.pae_sealed ? ". Current release checks still apply." : "."}</p>
      {currentAuthorityGuidance(detail) && <p className="text-[12px] text-[var(--color-warning)]">{currentAuthorityGuidance(detail)}</p>}
      {failedControls.length > 0 && (
        <ul aria-label="Current failed assurance controls" className="space-y-1 border-s-2 border-s-[var(--color-danger)] ps-3 text-[12px]">
          {failedControls.map((control) => <li key={control.control_id}><strong>{ASSURANCE_CONTROL_LABELS[control.control_id]}:</strong> {control.result === "NOT_ASSESSED" ? "Not assessed" : control.result === "BLOCK" ? "Blocked" : control.result}</li>)}
        </ul>
      )}
      {available && controls.length > 0 && (
        <details aria-label="Assurance control details" className="rounded border border-[var(--color-border)] px-3 py-2">
          <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">View the recorded control results</summary>
          <ul aria-label="Recorded assurance controls" className="grid gap-2 border-t border-[var(--color-border)] pt-3 sm:grid-cols-2">
            {controls.map((control) => (
              <li key={control.control_id} className="flex min-h-11 items-center justify-between gap-3 rounded border border-[var(--color-border)] px-3 py-2 text-[12px]">
                <span>{ASSURANCE_CONTROL_LABELS[control.control_id]}</span>
                <strong className="shrink-0">{control.result === "NOT_ASSESSED" ? "Not assessed" : control.result === "BLOCK" ? "Blocked" : control.result}</strong>
              </li>
            ))}
          </ul>
        </details>
      )}
      {detail.execution_kill_switched && <p role="alert" className="rounded border-s-4 border-s-[var(--color-danger)] px-3 py-2 text-[13px] font-semibold text-[var(--color-danger)]">A payment stop is active. Execution is unavailable.</p>}
    </section>
  );
}

function compactProxyDestination(name: string | undefined, address: string): string {
  const compact = address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
  return `${name || "Arc Testnet settlement proxy"} · ${compact}`;
}

function paymentStageStatus(detail: ObligationDetail, exactPacketSubmissionReady: boolean, detailState: DetailState): string {
  if (detail.execution?.status === "UNKNOWN") return "Outcome unknown. Reconcile this same instruction read-only; do not retry or resubmit.";
  if (detail.execution?.status === "SUBMITTING") return "Submission is in progress. Wait for read-only reconciliation; do not resubmit.";
  if (detail.execution?.status === "SUBMITTED") return "Submission is recorded and awaiting reconciliation. Do not resubmit.";
  if (detail.execution?.status === "SETTLED") return detail.truth.settlement_truth.runtime === "SIMULATED"
    ? "Simulated record — no Arc settlement. The real-world payable remains outstanding in the source record."
    : `${settledEvidenceSummary(detail)}. The real-world payable remains outstanding in the source record.`;
  if (detail.execution?.status === "FAILED") return "The settlement attempt failed. Review the current payment record; this instruction cannot be sent again.";
  if (detail.execution?.status === "BLOCKED") return "Execution is blocked. No successful settlement is established by this record.";
  if (detail.execution_kill_switched) return "A payment stop is active. No execution is permitted.";
  const authority = detail.truth.tameion_control_truth.execution_release_authority;
  const paeState = detail.truth.tameion_control_truth.pae_state;
  if (["BLOCKED", "REVOKED", "EXPIRED"].includes(authority) || ["REVOKED", "EXPIRED"].includes(paeState)) {
    const reason = paeState === "REVOKED" || authority === "REVOKED" ? "revoked"
      : paeState === "EXPIRED" || authority === "EXPIRED" ? "expired" : "blocked";
    return `Payment authority is ${reason}. This instruction cannot be submitted; renew payment authority before preparing another release record.`;
  }
  if (detailState === "stale") return "Payment details are stale. Refresh current status before relying on or acting on this instruction.";
  if (!detail.pae_sealed) return "No sealed payment instruction is available. Complete the existing authorization and assurance steps before execution.";
  if (exactPacketSubmissionReady) return "The exact testnet instruction is ready for confirmation. Final pre-send checks still apply.";
  if (detail.execution_gate === "PORTAL_RELEASE_RENEWAL_REQUIRED") return "Release consent is no longer current. This instruction cannot be submitted. Renew payment authority through the authorized recovery process; do not retry this instruction.";
  if (detail.execution_gate === "PORTAL_RELEASE_UNAVAILABLE") return "Payment release is unavailable. Current user authority or the payment service could not be verified. Refresh current status; no payment can be submitted.";
  if (detail.execution_gate === "PORTAL_RELEASE_APPROVAL_REQUIRED") return "Review the exact payment details below and approve payment release. Approval records your consent; you will submit the payment separately.";
  return currentAuthorityGuidance(detail) ?? "The instruction is sealed, but current execution checks are not satisfied. Refresh and re-establish current payment authority before submission.";
}

export function CommandCenter({operatorControls,walletSummary,csrfToken,initialView="workflow"}:{operatorControls?:ReactNode;walletSummary?:ReactNode;walletBalance?:ObservedWalletBalance;csrfToken?:string;initialView?:"dashboard"|"workflow"}={}) {
  const [dashboardVisible, setDashboardVisible] = useState(initialView === "dashboard");
  const dashboardHeadingRef = useRef<HTMLHeadingElement>(null);
  const workflowContainerRef = useRef<HTMLDivElement>(null);
  const commandCenterRef = useRef<HTMLElement>(null);
  const actionStripRef = useRef<HTMLElement>(null);
  const pendingViewFocus = useRef(false);
  const [obligations, setObligations] = useState<ObligationSummary[]>([]);
  const [obligationsStatus, setObligationsStatus] = useState<ObligationListStatus>("loading");
  const [obligationsError, setObligationsError] = useState<string | null>(null);
  const [mobileQueueOpen, setMobileQueueOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [panel, setPanel] = useState<PanelKey>("obligations");
  const [viewedStage, setViewedStage] = useState<LifecycleStage>("Obligation");
  const [mobileStagesOpen, setMobileStagesOpen] = useState(false);
  const [detail, setDetail] = useState<ObligationDetail | null>(null);
  const [detailIsStale, setDetailIsStale] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const financialResults = useRef(new Map<string, ActionResult>());
  const [assessmentFeedback, setAssessmentFeedback] = useState<AssessmentFeedback | null>(null);
  const [assessmentConflict,setAssessmentConflict]=useState<AssessmentConflict|null>(null);
  const cancelExactAssessmentWait=useRef<(()=>void)|null>(null);
  const [payableListCheck, setPayableListCheck] = useState<{
    obligationId: string; generation: number; requestKey: string | null;
    token: number; status: "checking" | "checked" | "failed" | "identity-unavailable";
  } | null>(null);
  const activePayableListCheck = useRef<number | null>(null);
  const payableListCheckSequence = useRef(0);
  const [exactAssessmentCheck,setExactAssessmentCheck]=useState<{
    obligationId:string;key:string;generation:number;epoch:number;token:number;detailRequest:number;
    status:"checking"|"pending"|"unknown"|"stale"|"failed"|"identity-unavailable"|"confirmed";
    message:string;receipt?:GenuineAssessmentStatus["receipt"];
  }|null>(null);
  const exactAssessmentLifetime=useRef({mounted:false,epoch:0});
  const activeExactAssessmentCheck=useRef<number|null>(null),exactAssessmentSequence=useRef(0);
  const holdFindingsRef=useRef<HTMLDetailsElement|null>(null);
  const holdReviewSequence=useRef(0);
  const [holdReview,setHoldReview]=useState<{
    obligationId:string;assessmentId:string;assessmentHash:string;version:string;sourceFingerprint:string;
    selection:number;detailRequest:number;epoch:number;token:number;status:"pending"|"opened"|"unavailable";
  }|null>(null);
  const [stageCompletionReceipt, setStageCompletionReceipt] = useState<StageCompletionReceipt | null>(null);
  const [displayedAssessment, setDisplayedAssessment] = useState<AssessmentReviewSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [activeActionLabel, setActiveActionLabel] = useState<string | null>(null);
  const activeRunCount = useRef(0);
  const obligationsRequestGeneration = useRef(0);
  const assessmentRequestKey = useRef<{ obligationId: string; key: string } | null>(null);
  const detailGeneration = useRef(0);
  const selectedRef = useRef("");
  const selectionGeneration = useRef(0);
  const [detailLifetimeEpoch,setDetailLifetimeEpoch]=useState(-1);
  useEffect(()=>{
    exactAssessmentLifetime.current.mounted=true;
    const invalidate=()=>{exactAssessmentLifetime.current.epoch++;setDetailLifetimeEpoch(-1);activeExactAssessmentCheck.current=null;cancelExactAssessmentWait.current?.();cancelExactAssessmentWait.current=null;setExactAssessmentCheck(null);setAssessmentConflict(null);setHoldReview(null);};
    const restore=(event:PageTransitionEvent)=>{if(event.persisted)invalidate();};
    window.addEventListener("pagehide",invalidate);window.addEventListener("pageshow",restore);
    return()=>{exactAssessmentLifetime.current.mounted=false;exactAssessmentLifetime.current.epoch++;activeExactAssessmentCheck.current=null;cancelExactAssessmentWait.current?.();cancelExactAssessmentWait.current=null;window.removeEventListener("pagehide",invalidate);window.removeEventListener("pageshow",restore);};
  },[]);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusConfirmedStageRef = useRef(false);
  const postCommand = (url: string, body?: unknown, headers: Record<string, string> = {}) =>
    postJson(url, body, { ...headers, ...(csrfToken ? { "X-Tameion-CSRF": csrfToken } : {}) });

  const showStage = (stage: LifecycleStage) => {
    setViewedStage(stage);
    setPanel(STAGE_PANEL[stage]);
  };

  const showCurrentStageAfterRefresh = (refreshed: ObligationDetail) => {
    const confirmedPosition = authoritativeLifecyclePosition(selectedRef.current, "loaded", refreshed);
    focusConfirmedStageRef.current = true;
    showStage(confirmedPosition);
  };

  useLayoutEffect(() => {
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    if (!focusConfirmedStageRef.current) return;
    focusConfirmedStageRef.current = false;
    stageHeadingRef.current?.focus({preventScroll:true});
  }, [viewedStage, panel]);

  useLayoutEffect(() => {
    if (!pendingViewFocus.current) return;
    pendingViewFocus.current = false;
    if (dashboardVisible) dashboardHeadingRef.current?.focus({ preventScroll: true });
    else (stageHeadingRef.current ?? workflowContainerRef.current)?.focus({ preventScroll: true });
  }, [dashboardVisible]);

  const refreshObligations = async (showLoading = false, preserveLastKnown = false, expectedSelectionGeneration?: number): Promise<
    | { status: "ready"; obligations: ObligationSummary[] }
    | { status: "error"; error: string }
    | { status: "superseded" }
  > => {
    if (expectedSelectionGeneration !== undefined && expectedSelectionGeneration !== selectionGeneration.current) return { status: "superseded" };
    const requestId = ++obligationsRequestGeneration.current;
    const isCurrent = () => requestId === obligationsRequestGeneration.current &&
      (expectedSelectionGeneration === undefined || expectedSelectionGeneration === selectionGeneration.current);
    if (showLoading) setObligationsStatus("loading");
    setObligationsError(null);
    try {
      const response = await fetch("/api/obligations");
      // Read as text first: an upstream failure (e.g. HTTP 500 with an
      // empty body) must never reach response.json() directly, since a
      // malformed or empty body makes JSON parsing throw a native,
      // engine-specific exception instead of a usable error message.
      const text = await response.text();
      const data = tryParseJson(text);
      if (!response.ok || !data || typeof data !== "object" || !Array.isArray((data as { obligations?: unknown }).obligations)) {
        throw new Error(obligationsFetchErrorMessage(response.status, data));
      }
      const list = data as { obligations: ObligationSummary[] };
      const fetched = list.obligations;
      if (!isCurrent()) return { status: "superseded" };
      setObligations(fetched);
      setObligationsStatus("ready");
      if (fetched.length === 0) {
        setSelectedId("");
        setMobileQueueOpen(false);
      } else if (!selectedRef.current) {
        setMobileQueueOpen(true);
      }
      return { status: "ready", obligations: fetched };
    } catch (error) {
      if (!isCurrent()) return { status: "superseded" };
      const message = error instanceof Error ? error.message : "Obligations could not be loaded.";
      if (!preserveLastKnown) {
        setObligations([]);
        setSelectedId("");
      }
      setObligationsStatus("error");
      setObligationsError(message);
      return { status: "error", error: message };
    }
  };

  useEffect(() => {
    void refreshObligations(true);
  }, []);

  const refreshDetail = async (id: string, preserveLastKnown = false, expectedSelectionGeneration?: number, acceptResult:()=>boolean=()=>true): Promise<ObligationDetail | null> => {
    const requestId = ++detailGeneration.current;
    const requestEpoch = exactAssessmentLifetime.current.epoch;
    const isCurrent = () => acceptResult() && exactAssessmentLifetime.current.mounted && requestEpoch === exactAssessmentLifetime.current.epoch &&
      (expectedSelectionGeneration === undefined || expectedSelectionGeneration === selectionGeneration.current) &&
      isCurrentRequest({
        requestId,
        currentRequestId: detailGeneration.current,
        requestedSelection: id,
        currentSelection: selectedRef.current,
      });
    if (preserveLastKnown && detail?.record.obligation_id === id) setDetailIsStale(true);
    try {
      const response = await fetch(`/api/obligations/${id}`);
      const text = await response.text();
      const data = parseJsonBody(text);
      if (!isCurrent()) return null;
      if (!response.ok || !data || typeof data !== "object") {
        throw new Error(obligationsFetchErrorMessage(response.status, data));
      }
      if (!hasExpectedObligationIdentity(data, id)) {
        throw new Error("Selected obligation detail identity could not be confirmed.");
      }
      let accepted = data as ObligationDetail;
      if (accepted.source_group === "DEMO_ARC_TESTNET") {
        const sourceHash = await canonicalRecordSha256(accepted.record);
        if (!isCurrent()) return null;
        if (!sourceHash || accepted.selected_financial_scope?.selected_source_record_sha256 !== sourceHash) {
          accepted = { ...accepted, selected_financial_scope: null };
        }
      }
      setDetail(accepted);
      setDetailLifetimeEpoch(requestEpoch);
      setDetailIsStale(false);
      setDetailError(null);
      return accepted;
    } catch (error) {
      if (!isCurrent()) return null;
      if (!preserveLastKnown) {
        setDetail(null);
        setDetailLifetimeEpoch(-1);
        setDetailIsStale(false);
      } else if (detail?.record.obligation_id !== id) {
        setDetailIsStale(false);
      }
      setDetailError(error instanceof Error ? error.message : "Obligation detail could not be loaded.");
      return null;
    }
  };

  useEffect(() => {
    selectedRef.current = selectedId;
    selectionGeneration.current += 1;
    detailGeneration.current += 1;
    setDisplayedAssessment(null);
    setDetail(null);
    setDetailLifetimeEpoch(-1);
    setDetailIsStale(false);
    setDetailError(null);
    setStageCompletionReceipt(null);
    setLastResult(financialResults.current.get(selectedId) ?? null);
    setAssessmentFeedback(null);
    setAssessmentConflict(null);
    cancelExactAssessmentWait.current?.();
    cancelExactAssessmentWait.current=null;
    setPayableListCheck(null);
    activePayableListCheck.current = null;
    setExactAssessmentCheck(null);
    activeExactAssessmentCheck.current=null;
    setHoldReview(null);
    if (selectedId) void refreshDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!displayedAssessment || !detail) return;
    const current = assessmentReviewSnapshot(detail?.current_assessment);
    if (!currentReviewedAssessment(displayedAssessment, current, selectedId, detail?.aggregate.aggregate_version)) {
      setDisplayedAssessment(null);
    }
  }, [displayedAssessment, detail, selectedId]);

  const selectedFinancialResult = financialResults.current.get(selectedId) ?? null;
  useEffect(() => {
    if (!selectedFinancialResult || selectedFinancialResult.readConfirmed || !detail || detailIsStale || detailError) return;
    const message = confirmedFinancialReceipt(selectedFinancialResult, detail);
    if (!message) return;
    const confirmed = {...selectedFinancialResult, readConfirmed: true};
    financialResults.current.set(selectedId, confirmed);
    if (lastResult === selectedFinancialResult) setLastResult(confirmed);
    setStageCompletionReceipt({obligationId: selectedId, message});
  }, [lastResult, selectedFinancialResult, detail, detailIsStale, detailError, selectedId]);

  const run = async (label: string, action: () => Promise<{ ok: boolean; status: number; data: unknown }>, assessmentExpectedVersion?: string, assessmentRequestIdentity?: string) => {
    const targetId = selectedRef.current;
    if (detailIsStale || !detail || !hasExpectedObligationIdentity(detail, targetId)) return;
    const financialBinding = ["release", "execute"].includes(label) && detail.sealed_pae_instruction_hash && detail.execution_packet?.packet_sha256
      ? {instructionHash: detail.sealed_pae_instruction_hash, packetHash: detail.execution_packet.packet_sha256, aggregateVersion: detail.aggregate.aggregate_version}
      : undefined;
    const saveResult = (result: ActionResult) => {
      result = {...result, aggregateVersion: detail.aggregate.aggregate_version};
      if (financialBinding) financialResults.current.set(targetId, result);
      if (stillCurrent() || (financialBinding && selectedRef.current === targetId)) setLastResult(result);
    };
    const priorPosition = authoritativeLifecyclePosition(targetId, detailState, detail);
    const assessmentEpoch=exactAssessmentLifetime.current.epoch;
    const generation = selectionGeneration.current;
    const stillCurrent = () => isCurrentGeneration(generation, selectionGeneration.current) && isSameIdentity(selectedRef.current, targetId);
    activeRunCount.current += 1;
    setBusy(true);
    setActiveActionLabel(label);
    setStageCompletionReceipt(null);
    let actionSucceeded = false;
    let assessmentResponse: { ok: boolean; status: number; data: unknown } | null = null;
    let assessmentReceiptConfirmed = false;
    try {
      const result = await action();
      saveResult({ label, data: result.data, ok: result.ok, status: result.status, obligationId: targetId, financialBinding });
      if (!stillCurrent()) return;
      if (label === "assess") {
        assessmentResponse = result;
        const receipt = assessmentReceiptSnapshot(result.data);
        const identity = assessmentReceiptIdentity(result.data);
        const exactResponse = result.ok && result.status === 200 && Boolean(receipt) &&
          identity.obligation_id === targetId && identity.aggregate_version === assessmentExpectedVersion;
        actionSucceeded = exactResponse;
        setAssessmentFeedback(assessmentFeedbackForResponse(result, targetId, assessmentExpectedVersion ?? "", generation));
      } else {
        actionSucceeded = result.ok;
      }
      if (label === "approve" && !result.ok && result.status === 409) setDisplayedAssessment(null);
    } catch {
      saveResult({label, data: label === "execute"
        ? {code: "OUTCOME_UNVERIFIED"}
        : {error: "The action could not be confirmed. No automatic retry was made; reload current state before acting again."},
        ok: false, status: 0, obligationId: targetId, financialBinding});
      if (!stillCurrent()) return;
      if (label === "assess") {
        setAssessmentFeedback(assessmentFeedbackForResponse({ status: 0, data: { error: "No response was received." } }, targetId, assessmentExpectedVersion ?? "", generation));
      }
    } finally {
      if (stillCurrent()) {
        const refreshing=refreshDetail(targetId,true,generation);
        const ownedDetailGeneration=detailGeneration.current;
        const refreshed = await refreshing;
        if(stillCurrent()&&exactAssessmentLifetime.current.mounted&&exactAssessmentLifetime.current.epoch===assessmentEpoch&&detailGeneration.current===ownedDetailGeneration&&label==="assess"&&assessmentResponse&&assessmentRequestIdentity&&csrfToken&&detail.source_group==="GENUINE_COMPANY"&&refreshed?.source_group==="GENUINE_COMPANY"&&
          String(refreshed.aggregate.aggregate_version)===assessmentExpectedVersion&&canonicalize(refreshed.record)===canonicalize(detail.record)){
          const earlierKey=assessmentEarlierReference(assessmentResponse,assessmentRequestIdentity);
          if(earlierKey&&retainedAssessmentRequestKey(targetId)===assessmentRequestIdentity)setAssessmentConflict({obligationId:targetId,attemptedKey:assessmentRequestIdentity,earlierKey,version:assessmentExpectedVersion!,sourceFingerprint:canonicalize(refreshed.record),selection:generation,detailRequest:ownedDetailGeneration,epoch:assessmentEpoch});
        }
        if (stillCurrent() && label === "assess" && assessmentResponse?.status === 200 && assessmentResponse.ok && assessmentExpectedVersion) {
          const responseReceipt = assessmentReceiptSnapshot(assessmentResponse.data);
          const responseIdentity = assessmentReceiptIdentity(assessmentResponse.data);
          const refreshedReceipt = assessmentReviewSnapshot(refreshed?.current_assessment);
          const exactCompleteResponse = Boolean(responseReceipt && responseIdentity.obligation_id === targetId &&
            responseIdentity.aggregate_version === assessmentExpectedVersion);
          assessmentReceiptConfirmed = Boolean(exactCompleteResponse && refreshed && refreshedReceipt &&
            responseIdentity.obligation_id === targetId && responseIdentity.aggregate_version === assessmentExpectedVersion &&
            refreshedReceipt.obligation_id === responseReceipt?.obligation_id &&
            refreshedReceipt.assessment_id === responseReceipt?.assessment_id &&
            refreshedReceipt.assessment_hash === responseReceipt?.assessment_hash &&
            refreshedReceipt.aggregate_version === assessmentExpectedVersion &&
            String(refreshed.aggregate.aggregate_version) === assessmentExpectedVersion);
          if (assessmentReceiptConfirmed && responseReceipt) {
            const storageKey = `tameion.assessment-request.${targetId}`;
            if (assessmentRequestIdentity && localStorage.getItem(storageKey) === assessmentRequestIdentity) localStorage.removeItem(storageKey);
            if (assessmentRequestKey.current?.key === assessmentRequestIdentity) assessmentRequestKey.current = null;
            setAssessmentFeedback({
              obligationId: targetId, expectedVersion: assessmentExpectedVersion, selectionGeneration: generation, kind: "durable",
              title: "Assessment is recorded for the current selected obligation.",
              message: "Refreshed obligation detail confirms this assessment receipt and version. The assessment remains advisory.",
              durability: "Confirmed in refreshed selected-obligation detail.",
              nextStep: "Review the advisory assessment; it does not approve or execute payment.",
              owner: "You · read-only assessment review",
              assessmentId: responseReceipt?.assessment_id,
              assessmentHash: responseReceipt?.assessment_hash,
            });
          } else if (exactCompleteResponse && refreshed) {
            const currentReceipt = assessmentReviewSnapshot(refreshed.current_assessment);
            const currentIdentity = { obligation_id: currentReceipt?.obligation_id ?? null, aggregate_version: currentReceipt?.aggregate_version ?? null };
            const responseIdentity = assessmentReceiptIdentity(assessmentResponse.data);
            const identityMismatch = Boolean(
              (responseIdentity.obligation_id && responseIdentity.obligation_id !== targetId) ||
              (currentIdentity.obligation_id && currentIdentity.obligation_id !== targetId),
            );
            setAssessmentFeedback({
              obligationId: targetId, expectedVersion: assessmentExpectedVersion, selectionGeneration: generation,
              kind: identityMismatch ? "identity-mismatch" : "stale",
              title: identityMismatch ? "Refreshed assessment identity did not match." : "Assessment currentness was not confirmed.",
              message: identityMismatch
                ? "The response or refreshed detail is bound to a different obligation; it was not presented as this selection's result."
                : "The exact response receipt is not the current assessment in refreshed detail, so it is not presented as current.",
              durability: "A current assessment matching this response is not confirmed.",
              nextStep: "Use refreshed selected-obligation status before taking another assessment action.",
              owner: "You · read-only status review",
            });
          } else if (exactCompleteResponse) {
            setAssessmentFeedback({
              obligationId: targetId, expectedVersion: assessmentExpectedVersion, selectionGeneration: generation, kind: "unconfirmed",
              title: "Assessment response received; current status is unavailable.",
              message: "The response cannot be treated as current until selected-obligation detail confirms the same receipt.",
              durability: "Current selected-detail confirmation is unavailable.",
              nextStep: "Refresh current status before any further assessment action. Do not submit another request while unresolved.",
              owner: "Unassigned · current status is unavailable",
            });
          }
        }
        if (stillCurrent() && actionSucceeded && (label !== "assess" || assessmentReceiptConfirmed) && refreshed) {
          const confirmedPosition = authoritativeLifecyclePosition(targetId, "loaded", refreshed);
          if (confirmedPosition !== priorPosition) showCurrentStageAfterRefresh(refreshed);
          const receiptMessage = label === "assess"
            ? null
            : label === "proxy preflight" && refreshed.settlement_proxy?.preflight.obligation_id === targetId
              ? "Arc Testnet settlement proxy preparation is recorded. A fresh assessment is required before authorization."
              : label === "approve" && refreshed.aggregate.state === "AUTHORIZED"
                ? "Authorization is recorded. Assurance remains a separate release control."
                : label === "release" && refreshed.execution_gate === "PORTAL_APPROVED_EXACT_PACKET"
                  ? "Payment release approval is recorded. Review and choose Pay testnet USDC to submit once."
                : label === "execute" && refreshed.execution
                  ? "An execution record is available. Continue with read-only reconciliation for this same instruction."
                  : null;
          if (receiptMessage) setStageCompletionReceipt({ obligationId: targetId, message: receiptMessage });
        }
      }
      await refreshObligations(false, true, generation);
      activeRunCount.current = Math.max(0, activeRunCount.current - 1);
      setBusy(activeRunCount.current > 0);
      if(activeRunCount.current===0)setActiveActionLabel(null);
    }
  };

  const assessmentCallbackGeneration = selectionGeneration.current;
  const assessmentCallbackDetailGeneration = detailGeneration.current;
  const runAssessment = () => {
    const obligationId = selectedId;
    if (assessmentCallbackGeneration !== selectionGeneration.current || assessmentCallbackDetailGeneration !== detailGeneration.current || selectedRef.current !== obligationId ||
        !obligationId || !detail || detailIsStale || !hasExpectedObligationIdentity(detail, obligationId)) return;
    // Contain the callback as well as its affordance, including stale handlers
    // and requests retained across reload or A -> B -> A navigation.
    if (detail.execution || requiresSubmissionReconciliation(financialResults.current.get(obligationId) ?? null) || retainedAssessmentRequestKey(obligationId) || assessmentRequestUnresolved ||
        (assessmentAction !== "assess" && !optionalReassessmentAvailable)) return;
    const generation = selectionGeneration.current;
    const expectedVersion = String(detail.aggregate.aggregate_version);
    setDisplayedAssessment(null);
    setAssessmentConflict(null);
    setAssessmentFeedback({
      obligationId, expectedVersion, selectionGeneration: generation, kind: "in-flight", title: "Assessment request sent.",
      message: "Waiting for a response for the selected obligation. No duplicate request has been sent.",
      durability: "No assessment receipt has been confirmed yet.",
      nextStep: "Wait for this request to resolve; the result remains advisory.",
      owner: "Finance Agent · waiting for assessment response",
    });
    const storageKey = `tameion.assessment-request.${obligationId}`;
    const requestIdentity = crypto.randomUUID();
    return run("assess", async () => {
      try {
        localStorage.setItem(storageKey, requestIdentity);
        assessmentRequestKey.current = {obligationId, key: requestIdentity};
      } catch {
        return {ok:false, status:503, data:{code:"REQUEST_IDENTITY_UNAVAILABLE", error:"Assessment was not sent because its request identity could not be stored."}};
      }
      const result = await postCommand(`/api/obligations/${obligationId}/${detail.advisory_action_eligible===true?"advisory":"assess"}`, {}, {
        "Idempotency-Key": requestIdentity,
      });
      // No refusal code proves non-submission. Keep the attempted identity;
      // only exact complete success and its independent readback can release it.
      if (!isCurrentGeneration(generation, selectionGeneration.current) || !isSameIdentity(selectedRef.current, obligationId)) return result;
      const snapshot = result.status === 200 && result.ok ? assessmentReceiptSnapshot(result.data) : null;
      if (snapshot && snapshot.obligation_id === obligationId && snapshot.aggregate_version === expectedVersion) {
        setDisplayedAssessment(snapshot);
        setDetail((current) => {
          if (!current || current.aggregate.aggregate_version !== Number(snapshot.aggregate_version)) return current;
          const truth = snapshot.provider_truth;
          return {
            ...current,
            current_assessment: truth
              ? {
                  obligation_id: snapshot.obligation_id,
                  assessment_id: snapshot.assessment_id,
                  assessment_hash: snapshot.assessment_hash,
                  aggregate_version: snapshot.aggregate_version,
                  decision: snapshot.decision,
                  reasons: snapshot.reasons,
                  provider_used: truth.provider_used,
                  provider_mode: truth.provider_mode,
                  ...(snapshot.race ? { race: snapshot.race } : {}),
                }
              : {
                  obligation_id: snapshot.obligation_id,
                  assessment_id: snapshot.assessment_id,
                  assessment_hash: snapshot.assessment_hash,
                  aggregate_version: snapshot.aggregate_version,
                  decision: snapshot.decision,
                  reasons: snapshot.reasons,
                  ...(snapshot.race ? { race: snapshot.race } : {}),
                },
          };
        });
      }
      return result;
    }, expectedVersion, requestIdentity);
  };

  const selected = obligations.find((o) => o.obligation_id === selectedId);
  const selectObligation = (obligationId: string) => {
    if (selectedRef.current === obligationId) {
      setMobileQueueOpen(false);
      return;
    }
    // Invalidate in-flight detail/action results synchronously with the
    // operator's selection so a fast A→B→A change cannot repaint stale data.
    selectedRef.current = obligationId;
    selectionGeneration.current += 1;
    detailGeneration.current += 1;
    setDetail(null);
    setDetailLifetimeEpoch(-1);
    setDetailIsStale(false);
    setDetailError(null);
    setSelectedId(obligationId);
    setViewedStage(selectedObligationInitialStage(obligations.find((obligation) => obligation.obligation_id === obligationId)?.decision));
    setLastResult(null);
    setAssessmentFeedback(null);
    setDisplayedAssessment(null);
    setExactAssessmentCheck(null);
    activeExactAssessmentCheck.current=null;
    setHoldReview(null);
    setStageCompletionReceipt(null);
    setMobileQueueOpen(false);
  };
  const queueDueDate = (obligation: ObligationSummary) => {
    if (obligation.obligation_id === selectedId && detail?.record.obligation_id === selectedId) {
      return sourceText(detail.record, "effective_due_date") !== "Not captured"
        ? sourceText(detail.record, "effective_due_date")
        : sourceText(detail.record, "due_date");
    }
    return obligation.due_date ?? "Due date unavailable";
  };
  const assessedCount = obligations.filter((o) => o.assessed).length;
  const allAssessed = obligations.length > 0 && assessedCount === obligations.length;
  const listPresentation = obligationListState(obligationsStatus, obligationsError, obligations.length);
  const detailState: DetailState = detail && detailIsStale ? "stale" : detail ? "loaded" : detailError ? "failed" : selectedId ? "loading" : "none";
  const killSwitchView = killSwitchPresentation(detailState, detail?.execution_kill_switched);
  const routeAssuranceReady = isRouteAssuranceReady(detail);
  const unresolvedSubmission = requiresSubmissionReconciliation(selectedFinancialResult);
  const exactPacketSubmissionReady = Boolean(!unresolvedSubmission && detailState === "loaded" && !detailIsStale && selectedId && detail &&
    detail.record.obligation_id === selectedId && detail.pae_sealed === true &&
    detail.settlement_proxy?.preflight.obligation_id === selectedId &&
    detail.execution_packet?.packet && detail.execution_packet.packet_sha256 && detail.sealed_pae_instruction_hash &&
    detail.execution === null && detail.execution_gate === "PORTAL_APPROVED_EXACT_PACKET" &&
    detail.truth.tameion_control_truth.execution_release_authority === "TAMEION_PAE_REVERIFY_REQUIRED" &&
    detail.execution_kill_switched === false);
  const currentPacketNeedsRelease = Boolean(!unresolvedSubmission && detailState === "loaded" && !detailIsStale && selectedId && detail &&
    detail.record.obligation_id === selectedId && detail.pae_sealed === true &&
    detail.settlement_proxy?.preflight.obligation_id === selectedId &&
    detail.execution_packet?.packet && detail.execution_packet.packet_sha256 && detail.sealed_pae_instruction_hash &&
    detail.execution === null && detail.execution_gate === "PORTAL_RELEASE_APPROVAL_REQUIRED" &&
    detail.truth.tameion_control_truth.execution_release_authority === "TAMEION_PAE_REVERIFY_REQUIRED" &&
    detail.execution_kill_switched === false);
  const exactPacketConfirmationIdentity = (exactPacketSubmissionReady || currentPacketNeedsRelease) && detail && selectedId
    ? JSON.stringify([selectedId, detail.execution_packet!.packet_sha256, detail.sealed_pae_instruction_hash, detail.execution_gate])
    : null;
  const executionConfirmation = useExecutionConfirmation(exactPacketConfirmationIdentity);
  const noCurrentExactExecutionPacket = Boolean(detailState === "loaded" && detail?.pae_sealed && detail.settlement_proxy &&
    !detail.execution && (!detail.execution_packet || !detail.sealed_pae_instruction_hash ||
      detail.execution_gate === "LOCKED_UNTIL_CURRENT_AUTHORIZATION"));
  const state = useMemo(() => detailState === "stale"
    ? { label: "Last-known state — stale", tone: "warning" as const, explanation: "Control and execution truth is not freshly verified. Retry detail before relying on it." }
    : detailState === "failed"
      ? { label: "Unavailable", tone: "danger" as const, explanation: "Current obligation detail could not be loaded; its state is not verified." }
      : workflowState(detailState === "loaded" ? detail : null, routeAssuranceReady), [detail, detailState, routeAssuranceReady]);
  const aggregateVersion = detail?.aggregate?.aggregate_version;
  const currentAssessment = assessmentReviewSnapshot(detail?.current_assessment);
  const simulatedTrustFixture = detail ? hasSimulatedTrustFixture(detail.demo_arc_trust_simulated, detail.aggregate.source_wallet_ref) : false;
  const hasCurrentAssessment = Boolean(detailState === "loaded" &&
    currentAssessment && currentAssessment.obligation_id === selectedId && currentAssessment.aggregate_version === String(aggregateVersion),
  );
  const retryableProviderFailure = hasCurrentAssessment && isRetryableProviderValidationFailure(currentAssessment);
  // Remediation says when reassessment may become possible, not that the
  // correction has occurred. The current read model has no such eligibility.
  const hasCurrentPayAssessment = hasCurrentAssessment && currentAssessment?.decision === "PAY";
  const selectedFinancialScope = selectedFinancialScopeReadiness(
    detailState === "loaded" ? detail : null,
    selectedId,
    selected?.source_group,
    detailLifetimeEpoch === exactAssessmentLifetime.current.epoch,
  );
  const authorizationCoverageReady = selectedFinancialScope.applies ? selectedFinancialScope.ready : allAssessed;
  const assessmentPaymentEligibility = hasCurrentPayAssessment
    ? {
        summary: `PAY is advisory.${routeAssuranceReady ? " Business eligibility, funds and payment authority remain separate checks." : " Route checks pending; authorization locked."}`,
      }
    : null;
  const proxyPreparationReady = Boolean(detailState === "loaded" && detail && selectedId && !detail.settlement_proxy && !detail.pae_sealed &&
    hasCurrentPayAssessment && currentAssessment?.provider_truth?.provider_mode === "LIVE_AI" && authorizationCoverageReady &&
    currentAssessment?.race && currentAssessment.race.result.validated_findings.length === 0 && currentAssessment.race.remediation.length === 0 &&
    currentAssessment.race.evidence.authoritative_facts.obligation_id === selectedId);
  const authorizationAssessment = detailState === "loaded" && hasCurrentPayAssessment
    ? currentReviewedAssessment(displayedAssessment, currentAssessment, selectedId, aggregateVersion)
    : null;
  const assessmentAction = assessmentPrimaryAction({
    detailState,
    hasSelection: Boolean(selectedId),
    paeSealed: Boolean(detail?.pae_sealed),
    authorizationRecordedBlocked: Boolean(detailState === "loaded" && detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution),
    hasCurrentAssessment,
    decision: currentAssessment?.decision,
    assessmentReviewAvailable: Boolean(currentAssessment?.race),
    reviewed: Boolean(authorizationAssessment),
    allAssessed: authorizationCoverageReady,
    routeAssuranceReady,
    retryableProviderFailure: false,
    remediableHold: false,
  });
  const lifecycleStatus = (stage: (typeof PAYMENT_LIFECYCLE_STAGES)[number]): string => {
    if (detailState === "none") return stage === "Obligation" ? "No payable selected" : "Waiting for selection";
    if (detailState === "loading") return "Loading current detail";
    if (detailState === "failed") return "Unavailable";
    if (detailState === "stale") return "Last-known — stale";
    if (!detail) return "Unavailable";
    const releaseAuthority = detail.truth.tameion_control_truth.execution_release_authority;
    const invalidReleaseAuthority = ["BLOCKED", "REVOKED", "EXPIRED"].includes(releaseAuthority);
    const invalidPaeState = ["REVOKED", "EXPIRED"].includes(detail.truth.tameion_control_truth.pae_state)
      ? detail.truth.tameion_control_truth.pae_state.toLowerCase()
      : releaseAuthority.toLowerCase();

    switch (stage) {
      case "Obligation":
        return judgeReadableState(detail.truth.source_truth.obligation_state);
      case "Assessment":
        if (!hasCurrentAssessment || !currentAssessment) return "Not current for this version";
        if (currentAssessment.decision === "HOLD") return "Requires attention";
        if (currentAssessment.decision === "ESCALATE") return "Escalation required";
        return "PAY — advisory";
      case "Authorization":
        if (detail.pae_sealed) return "Approved payment instruction is sealed";
        if (detail.aggregate.state === "AUTHORIZED") return "Authorization recorded — assurance failed or blocked";
        if (currentAssessment?.decision === "HOLD") return "Locked — assessment requires attention";
        if (currentAssessment?.decision === "ESCALATE") return "Locked — escalation required";
        if (!hasCurrentPayAssessment) return "Locked — current PAY assessment required";
        if (!routeAssuranceReady) return "Approval locked — route assurance not ready";
        return authorizationAssessment ? "Awaiting human approval" : "Review the current PAY assessment";
      case "Assurance": {
        const releaseGuidance = detail.pae_sealed && !detail.execution && !detail.execution_kill_switched &&
          !invalidReleaseAuthority && !["REVOKED", "EXPIRED"].includes(detail.truth.tameion_control_truth.pae_state) &&
          ["PORTAL_RELEASE_RENEWAL_REQUIRED", "PORTAL_RELEASE_UNAVAILABLE"].includes(detail.execution_gate ?? "")
          ? ` ${paymentStageStatus(detail, false, detailState)}` : "";
        if (detail.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution) return "Approval recorded · payment controls incomplete; no payment can be released.";
        if (detail.assurance_evidence?.state === "AVAILABLE_CURRENT_BINDING" || detail.assurance_evidence?.state === "AVAILABLE_HISTORICAL" || detail.assurance_evidence?.state === "INVALID" || detail.assurance_evidence?.state === "UNAVAILABLE") {
          return assuranceStateSummary(detail.assurance_evidence) + releaseGuidance;
        }
        if (detail.pae_sealed) return "An approved instruction is sealed, but current payment-control evidence is unavailable." + releaseGuidance;
        if (hasCurrentPayAssessment && routeAssuranceReady) return "Final assurance runs after human approval";
        return "Final assurance not run";
      }
      case "Payment":
        if (detail.settlement_proxy && detail.execution?.status === "SETTLED") return `${settledEvidenceSummary(detail)}; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "UNKNOWN") return "Outcome unknown — reconcile this same intent; resubmission blocked";
        if (detail.settlement_proxy && ["SUBMITTING", "SUBMITTED"].includes(detail.execution?.status ?? "")) return "Submitted to Arc Testnet; reconciliation is pending";
        if (detail.settlement_proxy && detail.execution?.status === "FAILED") return `Arc Testnet settlement attempt failed; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "BLOCKED") return reconciliationLeadLine("loaded", detail.execution, true, sourcePayableState(detail));
        if (detail.settlement_proxy && detail.execution_kill_switched) return "Payment release suspended by an active emergency stop";
        if (detail.settlement_proxy && invalidReleaseAuthority && (detail.pae_sealed || detail.execution)) return `Payment record unavailable; approved instruction is ${invalidPaeState}. Payment history unavailable; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.pae_sealed && !detail.execution &&
            (!detail.execution_packet || !detail.sealed_pae_instruction_hash || detail.execution_gate === "LOCKED_UNTIL_CURRENT_AUTHORIZATION")) {
          return "The current payment release record is unavailable. Payment authority must be renewed before submission.";
        }
        if (detail.settlement_proxy && detail.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution) return "Approval recorded; payment controls incomplete; no payment can be released";
        if (["PORTAL_RELEASE_RENEWAL_REQUIRED", "PORTAL_RELEASE_UNAVAILABLE"].includes(detail.execution_gate ?? "")) return paymentStageStatus(detail, false, detailState);
        if (detail.settlement_proxy && detail.pae_sealed) return "Arc Testnet instruction prepared; final payment approval is pending";
        if (detail.settlement_proxy && (!hasCurrentAssessment || !currentAssessment)) return "Arc Testnet proxy prepared; fresh assessment required before authorization";
        if (detail.settlement_proxy) return "Arc Testnet proxy prepared; final assessment and human authorization required";
        if (detail.execution && detail.truth.settlement_truth.runtime === "SIMULATED") {
          return `Simulated execution ${judgeReadableState(detail.execution.status)}; no Arc payment binding`;
        }
        return "Arc Testnet proxy not prepared for this obligation";
      case "Reconciliation":
        if (detail.settlement_proxy && detail.execution?.status === "SETTLED") return `${settledEvidenceSummary(detail)}; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "UNKNOWN") return "Read-only reconciliation pending; no resubmission";
        if (detail.settlement_proxy && ["SUBMITTING", "SUBMITTED"].includes(detail.execution?.status ?? "")) return `Submission recorded; reconcile this same intent; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "FAILED") return `Arc Testnet settlement attempt failed; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "BLOCKED") return reconciliationLeadLine("loaded", detail.execution, true, sourcePayableState(detail));
        if (detail.settlement_proxy && invalidReleaseAuthority && (detail.pae_sealed || detail.execution)) return `Payment record unavailable; approved instruction is ${invalidPaeState}. Payment history unavailable; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.truth.tameion_control_truth.execution_state === "NONE") return `No execution record is present; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy) return `Execution history is unavailable; source payable remains ${sourcePayableState(detail)}`;
        if (detail.execution && detail.truth.settlement_truth.runtime === "SIMULATED") {
          return "Simulated evidence only; no Arc settlement to reconcile";
        }
        return "No Arc settlement to reconcile";
    }
  };

  const currentLifecycleStage = authoritativeLifecyclePosition(selectedId, detailState, detail);

  const isInitialObligationScreen = !selectedId || (viewedStage === "Obligation" && currentLifecycleStage === "Obligation" &&
    !hasCurrentAssessment && !detail?.settlement_proxy && !detail?.pae_sealed && !detail?.execution && detail?.aggregate.state !== "AUTHORIZED");

  const currentStageIndex = PAYMENT_LIFECYCLE_STAGES.indexOf(currentLifecycleStage);
  const viewedStageIndex = PAYMENT_LIFECYCLE_STAGES.indexOf(viewedStage);
  const stageAccessibilityLabel = viewedStage === currentLifecycleStage
    ? `Workflow now: ${stageSpokenLabel(currentLifecycleStage)}. Step ${currentStageIndex + 1} of 6.`
    : `Reviewing: ${stageSpokenLabel(viewedStage)}. Workflow now: ${stageSpokenLabel(currentLifecycleStage)}. Reviewing step ${viewedStageIndex + 1} of 6; workflow is at step ${currentStageIndex + 1} of 6.`;
  const stageDescriptionId = "focused-stage-position-description";
  const stagePositionLabel = viewedStage === currentLifecycleStage
    ? `Workflow now: ${stageBusinessLabel(currentLifecycleStage)}`
    : `Reviewing: ${viewedStage} · Workflow now: ${stageBusinessLabel(currentLifecycleStage)}`;
  const currentPositionBlocked = detailState !== "loaded" || detailIsStale || !detail ||
    (currentLifecycleStage === "Assurance" && (!detail.pae_sealed ||
      ["PORTAL_RELEASE_RENEWAL_REQUIRED", "PORTAL_RELEASE_UNAVAILABLE"].includes(detail.execution_gate ?? ""))) ||
    (currentLifecycleStage === "Payment" && (
      ["PORTAL_RELEASE_RENEWAL_REQUIRED", "PORTAL_RELEASE_UNAVAILABLE"].includes(detail.execution_gate ?? "") ||
      detail.execution_kill_switched === true ||
      ["BLOCKED", "REVOKED", "EXPIRED"].includes(detail.truth.tameion_control_truth.execution_release_authority)
    )) ||
    (currentLifecycleStage === "Reconciliation" && ["FAILED", "BLOCKED"].includes(detail?.execution?.status ?? ""));
  const canContinueToAssessment = currentLifecycleStage === "Obligation" && detailState === "loaded" &&
    Boolean(detail && hasExpectedObligationIdentity(detail, selectedId));
  const canContinueToAuthorization = currentLifecycleStage === "Assessment" && detailState === "loaded" && !detailIsStale &&
    hasCurrentPayAssessment && Boolean(authorizationAssessment) && authorizationCoverageReady &&
    routeAssuranceReady && Boolean(detail?.settlement_proxy) && assessmentAction === "continue";
  const showContinueToAuthorization = viewedStage === "Assessment" && canContinueToAuthorization;
  const canContinueToPayment = currentLifecycleStage === "Assurance" && detailState === "loaded" && Boolean(detail?.pae_sealed) &&
    Boolean(detail?.execution_packet?.packet && detail?.sealed_pae_instruction_hash) &&
    detail?.execution_gate !== "LOCKED_UNTIL_CURRENT_AUTHORIZATION" &&
    detail?.truth.tameion_control_truth.execution_release_authority === "TAMEION_PAE_REVERIFY_REQUIRED" &&
    detail?.execution_kill_switched === false && !detail.execution;
  const showContinueToPayment = viewedStage === "Assurance" && canContinueToPayment;
  const nextAvailableStage: LifecycleStage | null = canContinueToAssessment ? "Assessment"
    : canContinueToAuthorization ? "Authorization"
    : canContinueToPayment ? "Payment"
    : null;
  const stageState = (stage: LifecycleStage): LifecycleStageState => {
    const index = PAYMENT_LIFECYCLE_STAGES.indexOf(stage);
    if (index < currentStageIndex) return "COMPLETED";
    if (index === currentStageIndex) return currentPositionBlocked ? "BLOCKED" : "CURRENT";
    if (index === currentStageIndex + 1 && nextAvailableStage === stage) return "AVAILABLE";
    return "UPCOMING";
  };
  const stageLockReason = (stage: LifecycleStage): string => {
    if (stage === "Authorization") return detailState === "loaded" ? lifecycleStatus(stage) : "Requires a current selected-obligation PAY review, proxy, and route checks.";
    if (stage === "Assurance") return "Requires exact human authorization.";
    if (stage === "Payment") return "Requires completed payment controls and a valid approved instruction.";
    if (stage === "Reconciliation") return "Requires a recorded settlement attempt or payment record.";
    return "Requires the selected source obligation to be current.";
  };
  const currentBlockedReason = currentLifecycleStage === "Assessment"
    ? currentAssessment?.decision === "PAY"
      ? `${lifecycleStatus("Assessment")} · ${!routeAssuranceReady ? "Payment-route evidence is not ready; authorization remains locked." : "Current selected-obligation PAY review and proxy prerequisites are incomplete."}`
      : lifecycleStatus("Assessment")
    : lifecycleStatus(currentLifecycleStage);

  const currentWorkspaceGuidance = detailState === "loaded" && detail?.aggregate.state === "CANCELLED"
    ? "This obligation was cancelled. No authorization or execution action is available."
    : !selectedId
    ? listPresentation === "loading"
      ? "Loading payables. Selection is not available yet."
      : listPresentation === "error"
        ? "The payable list could not be loaded. Retry before selecting a payable."
        : listPresentation === "empty"
          ? "No payables are currently available. Refresh the list to check again."
          : "Choose a payable to review its current status."
    : detailState === "loading"
      ? "Loading current payable status."
      : detailState === "failed"
        ? "Selected payable status is unavailable; retry before taking action."
      : detailState === "stale"
        ? "Selected payable status is stale; refresh before taking action."
      : detail?.settlement_proxy && detail.execution?.status === "UNKNOWN"
        ? `The Arc Testnet outcome is unknown. Reconcile this same intent read-only; do not resubmit. The source payable remains ${sourcePayableState(detail)}.`
      : detail?.settlement_proxy && ["SUBMITTING", "SUBMITTED"].includes(detail.execution?.status ?? "")
        ? `The Arc Testnet submission is recorded. Reconcile this same intent; do not resubmit. The source payable remains ${sourcePayableState(detail)}.`
      : detail?.settlement_proxy && detail.execution?.status === "SETTLED"
        ? detail.truth.settlement_truth.runtime === "SIMULATED"
          ? `Simulated record — no Arc settlement. The source payable remains ${sourcePayableState(detail)}.`
          : `${settledEvidenceSummary(detail)}. ${settledEvidenceExplanation(detail)} Source payable remains ${sourcePayableState(detail)}.`
      : detail?.settlement_proxy && detail.execution?.status === "FAILED"
        ? `The Arc Testnet settlement attempt failed. No successful reconciliation is recorded; the source payable remains ${sourcePayableState(detail)}.`
      : detail?.settlement_proxy && detail.execution?.status === "BLOCKED"
        ? reconciliationLeadLine("loaded", detail.execution, true, sourcePayableState(detail))
      : detail?.settlement_proxy && detail.execution_kill_switched === true
        ? "Payment release is suspended while an emergency stop is active."
      : detail?.aggregate.state === "CANCELLED"
        ? "This obligation was cancelled. No authorization or execution action is available."
      : detail?.settlement_proxy && (detail.pae_sealed || detail.execution) && ["BLOCKED", "REVOKED", "EXPIRED"].includes(detail.truth.tameion_control_truth.execution_release_authority)
        ? `Execution record is unavailable. The sealed Arc Testnet payment authority is ${["REVOKED", "EXPIRED"].includes(detail.truth.tameion_control_truth.pae_state) ? detail.truth.tameion_control_truth.pae_state.toLowerCase() : detail.truth.tameion_control_truth.execution_release_authority.toLowerCase()}; execution history is unavailable. The source payable remains ${sourcePayableState(detail)}.`
      : detail && ["PORTAL_RELEASE_RENEWAL_REQUIRED", "PORTAL_RELEASE_UNAVAILABLE"].includes(detail.execution_gate ?? "")
        ? paymentStageStatus(detail, false, detailState)
      : noCurrentExactExecutionPacket
        ? "The current payment release record is unavailable. Payment authority must be renewed before submission."
      : detail?.settlement_proxy && currentAssessment && !hasCurrentAssessment
        ? "The previous assessment is stale for this version. Run a fresh assessment for the prepared Arc Testnet proxy before authorization review."
      : detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution
          ? "Approval is recorded, but required payment controls did not complete. No payment can be released from this state."
        : detail?.pae_sealed
          ? detail.settlement_proxy
            ? "The Arc Testnet payment instruction is approved. Final payment authorization and pre-release checks still apply."
            : "Blocker: this payable has no Arc payment binding. The separate testnet instruction does not represent it."
          : detail?.settlement_proxy && (!hasCurrentAssessment || !currentAssessment)
              ? "Next step: run a fresh assessment for the prepared Arc Testnet proxy; a PAY assessment is advisory."
          : proxyPreparationReady
            ? "Current PAY is eligible for read-only proxy preparation; fresh assessment and review follow, with route assurance still required."
            : !hasCurrentAssessment || !currentAssessment
              ? "This payable has no current advisory assessment."
              : !authorizationCoverageReady
                ? selectedFinancialScope.applies
                  ? selectedFinancialScope.reason
                  : "Other obligations still need assessment before authorization review."
                : currentAssessment.decision !== "PAY"
                  ? `Blocked: current assessment is ${currentAssessment.decision}; resolve its findings before reassessment.`
                  : !authorizationAssessment
                    ? routeAssuranceReady
                      ? "Next step: review the current PAY assessment before authorization."
                      : "Next step: review the current PAY assessment; payment-route assurance is not ready and authorization remains locked."
                    : !routeAssuranceReady
                      ? "Blocker: payment-route assurance is not ready; authorization remains locked."
                      : "Next step: an authorized user may approve this reviewed payable.";

  const selectedWorkspaceGuidance = viewedStage === "Obligation"
    ? currentLifecycleStage === "Obligation"
      ? currentWorkspaceGuidance
      : currentLifecycleStage === "Assessment" && !hasCurrentAssessment
        ? currentWorkspaceGuidance
      : currentLifecycleStage === "Assessment" && hasCurrentAssessment && currentAssessment
        ? `A current ${currentAssessment.decision} advisory assessment is already recorded. View Assessment to review it.`
        : `This obligation has advanced to ${currentLifecycleStage}. View the current stage to resume.`
    : viewedStage === "Assessment"
      ? currentWorkspaceGuidance
      : viewedStage === "Authorization"
        ? currentWorkspaceGuidance
        : viewedStage === "Assurance"
          ? lifecycleStatus("Assurance")
          : viewedStage === "Payment"
            ? detailState === "loaded" && detail
              ? paymentStageStatus(detail, exactPacketSubmissionReady, detailState)
              : "Current payment status is unavailable until detail refresh succeeds."
            : viewedStage === "Reconciliation"
              ? lifecycleStatus("Reconciliation")
              : currentWorkspaceGuidance;

  const assessmentActionStatus = !selectedId || detailState === "none"
    ? "Choose a payable before assessing."
    : detailState === "loading"
      ? "Loading current obligation detail; assessment actions are unavailable."
      : detailState === "failed"
        ? "Current obligation detail is unavailable; retry before taking an assessment action."
        : detailState === "stale"
          ? "Current obligation detail is stale; refresh before taking an assessment action."
          : detail?.pae_sealed
            ? detail.settlement_proxy
              ? "The Arc Testnet payment instruction is approved. Final payment authorization and pre-release checks still apply."
              : "A payment authorization envelope is already sealed. Reassessment is unavailable here; payment remains blocked without an Arc binding."
            : detail?.aggregate.state === "AUTHORIZED" && !detail.execution
              ? "Approval is recorded, but required payment controls did not complete. No payment can be released from this state."
            : currentAssessment?.decision === "PAY" && !currentAssessment.race
              ? "The current PAY assessment has no review evidence in this detail; authorization remains locked."
              : currentAssessment?.decision === "PAY" && authorizationAssessment && !routeAssuranceReady
                ? "The PAY assessment has been reviewed, but payment-route assurance is not ready. Authorization remains locked."
              : retryableProviderFailure
                ? "The prior assessment output failed validation. Review the recorded provider finding."
                : currentAssessment?.decision === "HOLD" || currentAssessment?.decision === "ESCALATE"
                  ? `Resolve the current ${currentAssessment.decision} findings before reassessment.`
                  : "No assessment action is available for the current obligation state.";
  const optionalReassessmentAvailable = !unresolvedSubmission && !retainedAssessmentRequestKey(selectedId) && detailState === "loaded" && !detail?.pae_sealed &&
    hasCurrentPayAssessment && Boolean(authorizationAssessment) && !routeAssuranceReady;
  const reviewCurrentAssessment = () => {
    if (detailState !== "loaded" || currentAssessment?.obligation_id !== selectedId || !currentAssessment?.race) return;
    setDisplayedAssessment(currentAssessment);
  };

  const reportSummary = useMemo(() => summarizeAssessmentQueue(obligations), [obligations]);

  const firstUnmetPrerequisite = authorizationBlockers({
    hasSelection: Boolean(selectedId),
    allAssessed: authorizationCoverageReady,
    hasCurrentPayAssessment,
    routeAssuranceReady,
    destinationVerification: detail?.aggregate.destination_verification_status,
    destinationOperational: detail?.aggregate.destination_operational_status,
    sourceWallet: detail?.aggregate.source_wallet_status,
    productTrustProvenance: detail?.aggregate.product_trust_provenance,
    proxyPreparationAvailable: proxyPreparationReady,
    reviewed: Boolean(authorizationAssessment),
    killSwitchEngaged: killSwitchView === "engaged",
  })[0] ?? null;
  const terminalExecutionNoAction = Boolean(detail && (
    detail.execution?.status === "FAILED" || detail.execution?.status === "BLOCKED" ||
    ["BLOCKED", "REVOKED", "EXPIRED"].includes(detail.truth.tameion_control_truth.execution_release_authority)
  ));

  const currentResult = lastResult && lastResult.obligationId === selectedId ? lastResult : null;
  const feedbackMatchesKnownSelection = Boolean(assessmentFeedback &&
    assessmentFeedback.obligationId === selectedId &&
    assessmentFeedback.selectionGeneration === selectionGeneration.current &&
    (!detail || detail.record.obligation_id !== selectedId ||
      String(detail.aggregate.aggregate_version) === assessmentFeedback.expectedVersion));
  const durableFeedbackMatchesCurrentAssessment = assessmentFeedback?.kind !== "durable" || Boolean(
    detailState === "loaded" && !detailIsStale && currentAssessment &&
    currentAssessment.obligation_id === selectedId &&
    currentAssessment.aggregate_version === assessmentFeedback.expectedVersion &&
    currentAssessment.assessment_id === assessmentFeedback.assessmentId &&
    currentAssessment.assessment_hash === assessmentFeedback.assessmentHash,
  );
  const assessmentFeedbackIsCurrent = feedbackMatchesKnownSelection && durableFeedbackMatchesCurrentAssessment;
  const selectedRequestKey = retainedAssessmentRequestKey(selectedId);
  const exactCheckRenderGeneration=selectionGeneration.current,exactCheckRenderDetail=detailGeneration.current,exactCheckRenderEpoch=exactAssessmentLifetime.current.epoch;
  const checkAssessmentRequest=async()=>{
    if(!selectedId||selectedRef.current!==selectedId||selectionGeneration.current!==exactCheckRenderGeneration||detailGeneration.current!==exactCheckRenderDetail||exactAssessmentLifetime.current.epoch!==exactCheckRenderEpoch||!exactAssessmentLifetime.current.mounted||activeExactAssessmentCheck.current!==null||busy||!detail||detailIsStale||detail.source_group!=="GENUINE_COMPANY")return;
    const key=retainedAssessmentRequestKey(selectedId),version=String(detail.aggregate.aggregate_version);
    if(key!==selectedRequestKey&&key!=="Request identity unavailable")return;
    const token=++exactAssessmentSequence.current,generation=exactCheckRenderGeneration,epoch=exactCheckRenderEpoch;
    let expectedDetail=exactCheckRenderDetail;
    const bound={obligationId:selectedId,key:key??"",generation,epoch,token,detailRequest:expectedDetail};
    const feedback=(kind:AssessmentFeedback["kind"],message:string,code:string)=>setAssessmentFeedback({obligationId:selectedId,expectedVersion:version,selectionGeneration:generation,kind,title:"Assessment request status",message,durability:"Read-only observation; no assessment was resubmitted.",nextStep:"Ask the workspace owner to review the original request. Do not submit another assessment.",owner:"Workspace owner · request review",statusCode:`ASM_STATUS_${code}`});
    if(!key||!assessmentRequestUuid.test(key)){
      setExactAssessmentCheck({...bound,status:key==="Request identity unavailable"?"identity-unavailable":"unknown",message:"The original request reference could not be verified. Restore browser storage or ask the workspace owner to investigate."});
      feedback("unconfirmed","The original request reference could not be verified.","IDENTITY_UNAVAILABLE");return;
    }
    activeExactAssessmentCheck.current=token;
    let expired=false;
    const deadline=performance.now()+15_000;
    const currentContext=()=>exactAssessmentLifetime.current.mounted&&exactAssessmentLifetime.current.epoch===epoch&&selectionGeneration.current===generation&&selectedRef.current===selectedId&&detailGeneration.current===expectedDetail&&activeExactAssessmentCheck.current===token;
    const current=()=>{if(performance.now()>=deadline)expired=true;return !expired&&currentContext();};
    const identityCurrent=()=>{
      if(!currentContext())return false;
      const live=retainedAssessmentRequestKey(selectedId);
      if(live!==key){
        setAssessmentConflict(null);
        if(live==="Request identity unavailable")setExactAssessmentCheck({...bound,key:live,detailRequest:expectedDetail,status:"identity-unavailable",message:"Request storage is unavailable. Restore browser storage and ask the workspace owner to review the original request."});
        else setExactAssessmentCheck(null);
        feedback("unconfirmed","The original request reference changed or is unavailable; completion was not confirmed.","IDENTITY_UNAVAILABLE");return false;
      }
      if(!current()){if(expired)unresolved("TIMEOUT");return false;}
      return true;
    };
    const unresolved=(status:GenuineAssessmentStatus["status"]|"FAILED"|"TIMEOUT")=>{
      const message=status==="RESERVED"?"Assessment is pending; completion is not confirmed."
        :status==="PROVIDER_RESULT_DURABLE"?"An assessment result is saved but has not been confirmed."
        :status==="UNKNOWN"?"The original assessment outcome is unknown."
        :status==="STALE"?"This request does not confirm a current result for this payable."
        :status==="NOT_FOUND"?"The original request could not be verified. This does not mean it was never sent."
        :status==="TIMEOUT"?"Assessment status check timed out. The outcome remains unverified; no assessment was resubmitted.":"Assessment status could not be checked. No assessment was resubmitted.";
      setExactAssessmentCheck({...bound,detailRequest:expectedDetail,status:status==="RESERVED"||status==="PROVIDER_RESULT_DURABLE"?"pending":status==="STALE"?"stale":status==="FAILED"||status==="TIMEOUT"?"failed":"unknown",message});
      feedback(status==="RESERVED"||status==="PROVIDER_RESULT_DURABLE"?"pending":status==="STALE"?"stale":"unconfirmed",message,status);
    };
    setDisplayedAssessment(null);
    setExactAssessmentCheck({...bound,status:"checking",message:"Checking the original assessment request…"});
    feedback("unconfirmed","Checking the original assessment request; no new assessment will be sent.","CHECKING");
    // Settle only this UI wait; never cancel or replay a submitted operation.
    let rejectWait!:(reason:Error)=>void;
    const interrupted=new Promise<never>((_,reject)=>{rejectWait=reject;});
    const cancelWait=()=>rejectWait(new Error("Status wait invalidated"));
    cancelExactAssessmentWait.current=cancelWait;
    const timer=setTimeout(()=>{expired=true;rejectWait(new Error("Status wait timed out"));},15_000);
    const waitForStatus=<T,>(pending:Promise<T>)=>Promise.race([pending,interrupted]);
    try{
      const firstResponse=await waitForStatus(postCommand(`/api/obligations/${selectedId}/advisory/status`,{idempotency_key:key}));
      if(!identityCurrent())return;
      if(firstResponse.status===401||firstResponse.status===403)setAssessmentConflict(null);
      const first=firstResponse.ok&&firstResponse.status===200?exactAssessmentStatus(firstResponse.data,selectedId,key,version):null;
      if(!first){unresolved("FAILED");return;}
      if(first.status!=="COMPLETED_CURRENT"){unresolved(first.status);return;}
      const pendingDetail=refreshDetail(selectedId,true,generation,()=>current()&&retainedAssessmentRequestKey(selectedId)===key);
      expectedDetail=detailGeneration.current;
      setExactAssessmentCheck({...bound,detailRequest:expectedDetail,status:"checking",message:"Confirming the recorded assessment…"});
      const refreshed=await waitForStatus(pendingDetail);
      if(!identityCurrent())return;
      const matches=await waitForStatus(assessmentStatusMatchesDetail(first,refreshed));
      if(!identityCurrent())return;
      if(!matches){unresolved("STALE");return;}
      // A second bounded observation closes the status-to-detail gap; it is
      // confirmation only, never polling, timeout recovery or an AI retry.
      const finalResponse=await waitForStatus(postCommand(`/api/obligations/${selectedId}/advisory/status`,{idempotency_key:key}));
      if(!identityCurrent())return;
      if(finalResponse.status===401||finalResponse.status===403)setAssessmentConflict(null);
      const final=finalResponse.ok&&finalResponse.status===200?exactAssessmentStatus(finalResponse.data,selectedId,key,version):null;
      if(!final){unresolved("FAILED");return;}
      if(final.status!=="COMPLETED_CURRENT"){unresolved(final.status);return;}
      if(final.source_record_sha256!==first.source_record_sha256||final.receipt?.assessment_id!==first.receipt?.assessment_id||final.receipt?.assessment_hash!==first.receipt?.assessment_hash){unresolved("STALE");return;}
      if(!identityCurrent())return;
      const storageKey=`tameion.assessment-request.${selectedId}`;
      if(localStorage.getItem(storageKey)!==key)return;
      localStorage.removeItem(storageKey);
      if(localStorage.getItem(storageKey)!==null)throw new Error("Request storage update unverified");
      if(assessmentRequestKey.current?.obligationId===selectedId&&assessmentRequestKey.current.key===key)assessmentRequestKey.current=null;
      setExactAssessmentCheck({...bound,detailRequest:expectedDetail,status:"confirmed",message:"Assessment confirmed. Review the recorded result.",receipt:final.receipt});
      setAssessmentFeedback({obligationId:selectedId,expectedVersion:version,selectionGeneration:generation,kind:"durable",title:"Assessment confirmed",message:"The original request matches the current recorded assessment.",durability:"Confirmed by exact-request status and independent payable details.",nextStep:"Review the advisory result. Payment approval remains separate.",owner:"User · assessment review",assessmentId:final.receipt!.assessment_id,assessmentHash:final.receipt!.assessment_hash});
    }catch{
      if(identityCurrent())unresolved("FAILED");
    }finally{
      clearTimeout(timer);
      if(cancelExactAssessmentWait.current===cancelWait)cancelExactAssessmentWait.current=null;
      if(activeExactAssessmentCheck.current===token)activeExactAssessmentCheck.current=null;
    }
  };
  const currentExactAssessmentCheck=exactAssessmentCheck?.obligationId===selectedId&&exactAssessmentCheck.generation===selectionGeneration.current&&exactAssessmentCheck.epoch===exactAssessmentLifetime.current.epoch&&exactAssessmentCheck.detailRequest===detailGeneration.current&&(
    exactAssessmentCheck.key===selectedRequestKey||exactAssessmentCheck.status==="confirmed"&&selectedRequestKey===null&&detailState==="loaded"&&currentAssessment?.assessment_id===exactAssessmentCheck.receipt?.assessment_id&&currentAssessment?.assessment_hash===exactAssessmentCheck.receipt?.assessment_hash
  )?exactAssessmentCheck:null;
  const checkingExactAssessment=currentExactAssessmentCheck?.status==="checking";
  // Bind the callback to this render's selection, including A → B → A.
  // A queue observation is never an exact-request receipt or retry authority.
  const listCheckGeneration = selectionGeneration.current;
  const refreshAssessmentQueueSummary = async () => {
    if (!selectedId || selectedRef.current !== selectedId ||
        selectionGeneration.current !== listCheckGeneration || activePayableListCheck.current !== null) return;
    const liveRequestKey = retainedAssessmentRequestKey(selectedId);
    if (liveRequestKey === "Request identity unavailable") {
      setPayableListCheck({obligationId: selectedId, generation: listCheckGeneration,
        requestKey: liveRequestKey, token: ++payableListCheckSequence.current, status: "identity-unavailable"});
      return;
    }
    if (liveRequestKey !== selectedRequestKey) return;
    const token = ++payableListCheckSequence.current;
    activePayableListCheck.current = token;
    const check = {obligationId: selectedId, generation: listCheckGeneration, requestKey: selectedRequestKey, token};
    setPayableListCheck({...check, status: "checking"});
    const feedback = assessmentFeedback;
    const refreshedQueue = await refreshObligations(false, true, listCheckGeneration);
    if (activePayableListCheck.current !== token) return;
    activePayableListCheck.current = null;
    if (selectedRef.current !== selectedId || selectionGeneration.current !== listCheckGeneration) return;
    const completedRequestKey = retainedAssessmentRequestKey(selectedId);
    if (completedRequestKey === "Request identity unavailable") {
      setPayableListCheck({...check, requestKey: completedRequestKey, status: "identity-unavailable"});
      return;
    }
    if (completedRequestKey !== selectedRequestKey) {
      setPayableListCheck(current => current?.token === token ? null : current);
      return;
    }
    setPayableListCheck({...check, status: refreshedQueue.status === "ready" ? "checked" : "failed"});
    if (feedback) setAssessmentFeedback(current => current !== feedback ? current : {
      ...current,
      message: refreshedQueue.status === "ready"
        ? "The read-only queue summary was refreshed. It shows current assessment coverage, but does not confirm this request's exact receipt or completion."
        : "The read-only queue summary could not be refreshed. This request remains unresolved.",
    });
  };
  const currentPayableListCheck = payableListCheck?.obligationId === selectedId &&
    payableListCheck.generation === selectionGeneration.current && payableListCheck.requestKey === selectedRequestKey
    ? payableListCheck : null;
  const checkingPayableList = currentPayableListCheck?.status === "checking";
  // Fixed actions have variable height when status text wraps or the user zooms.
  // Reserve their measured height; this changes layout only, never workflow state.
  useLayoutEffect(() => {
    const root = commandCenterRef.current, strip = actionStripRef.current;
    if (!root || !strip) return;
    const updateClearance = () => {
      const height = strip.getBoundingClientRect().height;
      if (height > 0) root.style.setProperty("--payable-action-clearance", `${Math.ceil(height) + 16}px`);
    };
    updateClearance();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(updateClearance);
    if (observer) observer.observe(strip);
    else window.addEventListener("resize", updateClearance);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateClearance);
      root.style.removeProperty("--payable-action-clearance");
    };
  }, [dashboardVisible, currentPayableListCheck?.status, currentExactAssessmentCheck?.status, holdReview?.status]);
  const currentFeedback = assessmentFeedbackIsCurrent ? assessmentFeedback : null;
  const assessmentRequestUnresolved = Boolean(selectedRequestKey || currentFeedback && currentFeedback.kind !== "durable");
  const currentAssessmentConflict=assessmentConflict&&detailState==="loaded"&&!detailIsStale&&detail?.source_group==="GENUINE_COMPANY"&&
    assessmentConflict.obligationId===selectedId&&assessmentConflict.attemptedKey===selectedRequestKey&&assessmentConflict.selection===selectionGeneration.current&&
    assessmentConflict.detailRequest===detailGeneration.current&&assessmentConflict.epoch===exactAssessmentLifetime.current.epoch&&exactAssessmentLifetime.current.mounted&&
    assessmentConflict.version===String(detail.aggregate.aggregate_version)&&assessmentConflict.sourceFingerprint===canonicalize(detail.record)?assessmentConflict:null;
  const selectedBlockers = payableBlockers({detail, state: detailState, selectedId, feedback: currentFeedback,
    conflict:currentAssessmentConflict,requestKey: selectedRequestKey, stage: viewedStage, response: currentResult, executionResponse: selectedFinancialResult});
  const holdRenderSelection=selectionGeneration.current,holdRenderDetail=detailGeneration.current,holdRenderEpoch=exactAssessmentLifetime.current.epoch;
  const holdReviewBlocked=unresolvedSubmission||Boolean(detail?.execution)||Boolean(detail?.pae_sealed)||detail?.aggregate.state==="CANCELLED";
  const currentHoldReview=!holdReviewBlocked&&holdReview&&detailState==="loaded"&&!detailIsStale&&detail&&hasCurrentAssessment&&currentAssessment?.decision==="HOLD"&&!assessmentRequestUnresolved&&
    holdReview.obligationId===selectedId&&holdReview.selection===holdRenderSelection&&holdReview.detailRequest===holdRenderDetail&&holdReview.epoch===holdRenderEpoch&&exactAssessmentLifetime.current.mounted&&
    holdReview.assessmentId===currentAssessment.assessment_id&&holdReview.assessmentHash===currentAssessment.assessment_hash&&holdReview.version===currentAssessment.aggregate_version&&holdReview.sourceFingerprint===canonicalize(detail.record)
    ?holdReview:null;
  const reviewHoldFindings=()=>{
    if(busy||holdReviewBlocked||requiresSubmissionReconciliation(financialResults.current.get(selectedId)??null)||!detail||detailState!=="loaded"||detailIsStale||!hasCurrentAssessment||currentAssessment?.decision!=="HOLD"||assessmentRequestUnresolved||retainedAssessmentRequestKey(selectedId)||
      !exactAssessmentLifetime.current.mounted||selectedRef.current!==selectedId||selectionGeneration.current!==holdRenderSelection||detailGeneration.current!==holdRenderDetail||exactAssessmentLifetime.current.epoch!==holdRenderEpoch)return;
    setHoldReview({obligationId:selectedId,assessmentId:currentAssessment.assessment_id,assessmentHash:currentAssessment.assessment_hash,version:currentAssessment.aggregate_version,
      sourceFingerprint:canonicalize(detail.record),selection:holdRenderSelection,detailRequest:holdRenderDetail,epoch:holdRenderEpoch,token:++holdReviewSequence.current,status:"pending"});
    showStage("Assessment");
  };
  // Run after the existing stage scroll reset and after the selected card mounts.
  // Each tap has a new token, including when this disclosure is already open.
  useLayoutEffect(()=>{
    if(!currentHoldReview||currentHoldReview.status!=="pending"||viewedStage!=="Assessment"||panel!=="assessment")return;
    const target=holdFindingsRef.current,summary=target?.querySelector("summary");
    let status:"opened"|"unavailable"="unavailable";
    if(target?.isConnected&&summary?.isConnected){
      try{target.open=true;target.scrollIntoView?.({block:"start",behavior:"instant"});summary.focus({preventScroll:true});if(document.activeElement===summary)status="opened";}catch{/* Keep HOLD and report unavailable presentation. */}
    }
    setHoldReview(current=>current?.token===currentHoldReview.token?{...current,status}:current);
  },[currentHoldReview?.token,currentHoldReview?.status,viewedStage,panel]);
  const canRefreshAssessmentQueue = Boolean(assessmentFeedbackIsCurrent && assessmentFeedback &&
    ["pending", "unconfirmed", "stale"].includes(assessmentFeedback.kind));
  const selectedAssessmentFeedbackView = assessmentFeedbackIsCurrent && (!selectedBlockers.length || currentFeedback?.kind === "durable") &&
    (viewedStage === "Obligation" || viewedStage === "Assessment")
    ? <AssessmentFeedbackBanner feedback={assessmentFeedback!} onRefreshQueue={canRefreshAssessmentQueue ? () => { void refreshAssessmentQueueSummary(); } : undefined} />
    : null;
  // This affects Recovery copy only. A current PAY assessment can establish
  // that the aggregate's preauthorization REVOKED marker is not a current
  // exception before the human's local Review acknowledgement; action and
  // authorization eligibility continue to use their existing predicates.
  const preauthorizationRevocationIsNotCurrentException = Boolean(detailState === "loaded" && detail &&
    detail.aggregate.state === "APPROVAL_PENDING" && detail.settlement_proxy && hasCurrentPayAssessment && routeAssuranceReady &&
    detail.pae_sealed === false && detail.execution === null &&
    detail.truth.tameion_control_truth.pae_state === "REVOKED" &&
    detail.truth.tameion_control_truth.execution_release_authority === "REVOKED" &&
    detail.execution_gate === "LOCKED_UNTIL_CURRENT_AUTHORIZATION" &&
    detail.execution_packet == null && detail.sealed_pae_instruction_hash == null);
  const releaseRecoveryRequired = Boolean(detailState === "loaded" && detail && !detail.execution &&
    !detail.execution_kill_switched && detail.aggregate.state !== "CANCELLED" &&
    ["PORTAL_RELEASE_RENEWAL_REQUIRED", "PORTAL_RELEASE_UNAVAILABLE"].includes(detail.execution_gate ?? ""));
  const currentException = Boolean(selectedId && (
    releaseRecoveryRequired ||
    detailState === "failed" || detailState === "stale" ||
    (Boolean(currentAssessment) && !hasCurrentAssessment) ||
    detail?.aggregate.state === "CANCELLED" ||
    detail?.execution?.status === "BLOCKED" || detail?.execution?.status === "FAILED" || detail?.execution?.status === "UNKNOWN" ||
    ["HOLD", "ESCALATE"].includes(currentAssessment?.decision ?? "") ||
    detail?.execution_kill_switched === true ||
    (["BLOCKED", "REVOKED", "EXPIRED"].includes(detail?.truth.tameion_control_truth.execution_release_authority ?? "") && !preauthorizationRevocationIsNotCurrentException) ||
    noCurrentExactExecutionPacket ||
    (detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution) ||
    (detail?.settlement_proxy && !routeAssuranceReady && !detail.pae_sealed && !detail.execution)
  ));
  const exceptionStageVisible = detailState === "failed" || detailState === "stale" ||
    (Boolean(detail?.execution?.status && ["FAILED", "BLOCKED", "UNKNOWN", "SUBMITTING", "SUBMITTED"].includes(detail.execution.status)) &&
      (viewedStage === "Payment" || viewedStage === "Reconciliation")) ||
    (Boolean(detail?.execution?.status === "SETTLED") && viewedStage === "Reconciliation") ||
    (viewedStage === "Payment" && Boolean(
      releaseRecoveryRequired || noCurrentExactExecutionPacket || detail?.execution_kill_switched ||
      ["BLOCKED", "REVOKED", "EXPIRED"].includes(detail?.truth.tameion_control_truth.execution_release_authority ?? ""),
    )) ||
    (viewedStage === "Assurance" && (releaseRecoveryRequired || Boolean(detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution))) ||
    (viewedStage === "Assessment" && Boolean(
      (Boolean(currentAssessment) && !hasCurrentAssessment) ||
      detail?.aggregate.state === "CANCELLED" ||
      ["HOLD", "ESCALATE"].includes(currentAssessment?.decision ?? "") ||
      (detail?.settlement_proxy && !routeAssuranceReady && !detail.pae_sealed && !detail.execution),
    ));
  const assessmentFeedbackOwnsRecoveryCopy = Boolean(assessmentFeedbackIsCurrent &&
    (viewedStage === "Obligation" || viewedStage === "Assessment"));
  const showExceptionRecovery = currentException && exceptionStageVisible && !assessmentFeedbackOwnsRecoveryCopy;
  const activityItems = detail && detailState === "loaded" ? availableEvidenceItems(detail) : [];
  const assessmentCurrentState = assessmentRequestUnresolved
    ? "Assessment completion is unverified. An earlier recorded assessment does not resolve the existing request."
    : !detail || detailState !== "loaded"
    ? "Assessment state is not currently verified."
    : currentAssessment && currentAssessment.obligation_id === selectedId && currentAssessment.aggregate_version === String(detail.aggregate.aggregate_version)
      ? `${currentAssessment.decision} advisory assessment is current for the selected obligation.`
      : "No current assessment is recorded for the selected obligation.";
  const authorizationCurrentState = detail?.aggregate.state === "AUTHORIZED"
    ? detail.pae_sealed ? "Authorization is recorded; a sealed instruction is present." : "Authorization is recorded; no usable sealed instruction is available."
    : "No current authorization is recorded for this obligation.";
  const paeCurrentState = detail?.pae_sealed ? "A sealed payment instruction is present; current release checks still apply." : "No sealed payment instruction is recorded.";
  const executionCurrentState = detail ? submissionEvidenceCopy(detail) : "Execution state is unavailable.";

  type WorkspaceAction = { label: string; actor: string; run: () => void; exactConfirmation?: boolean };
  const financialScopeRenderSelection = selectionGeneration.current;
  const financialScopeRenderDetail = detailGeneration.current;
  const financialScopeRenderEpoch = exactAssessmentLifetime.current.epoch;
  const financialScopeContextCurrent = () => Boolean(
    exactAssessmentLifetime.current.mounted &&
    financialScopeRenderSelection === selectionGeneration.current &&
    financialScopeRenderDetail === detailGeneration.current &&
    financialScopeRenderEpoch === exactAssessmentLifetime.current.epoch &&
    detailLifetimeEpoch === exactAssessmentLifetime.current.epoch &&
    selectedRef.current === selectedId,
  );
  let workspaceAction: WorkspaceAction | null = null;
  if (!selectedId && listPresentation === "ready" && obligations.length > 0) {
    workspaceAction = { label: "Choose a payable", actor: "You", run: () => setMobileQueueOpen(true) };
  } else if (!selectedId && listPresentation === "empty") {
    workspaceAction = { label: "Refresh payables", actor: "You · refresh", run: () => { void refreshObligations(true); } };
  } else if (selectedId && (detailState === "stale" || detailState === "failed")) {
    workspaceAction = { label: "Refresh current status", actor: "You · read-only refresh", run: () => void refreshDetail(selectedId, true) };
  } else if (detailState === "loaded" && ["UNKNOWN", "SUBMITTING", "SUBMITTED"].includes(detail?.execution?.status ?? "")) {
    workspaceAction = {label: "Reconcile this same intent", actor: "Unassigned · read-only reconciliation", run: () => { showStage("Reconciliation"); void refreshDetail(selectedId, true); }};
  } else if (unresolvedSubmission && !detail?.execution) {
    workspaceAction = { label: "Refresh current status", actor: "You · read-only refresh", run: () => void refreshDetail(selectedId, true) };
  } else if (assessmentRequestUnresolved && !detail?.execution) {
    workspaceAction = detail?.source_group==="GENUINE_COMPANY"&&selectedRequestKey
      ?{label:"Check assessment request",actor:"User · original request status",run:()=>{void checkAssessmentRequest();}}
      :{ label: "Refresh payable list", actor: "User · read-only status review", run: () => { void refreshAssessmentQueueSummary(); } };
  } else if (currentExactAssessmentCheck?.status==="confirmed"&&hasCurrentAssessment&&currentAssessment) {
    workspaceAction={label:"Review assessment",actor:"User · advisory review",run:()=>{setDisplayedAssessment(currentAssessment);showStage("Assessment");setExactAssessmentCheck(null);}};
  } else if (!holdReviewBlocked && hasCurrentAssessment && currentAssessment?.decision === "HOLD" && (viewedStage === "Obligation" || viewedStage === "Assessment")) {
    workspaceAction={label:"View HOLD findings",actor:"User · findings review",run:reviewHoldFindings};
  } else if (viewedStage === "Obligation" && hasCurrentAssessment && currentAssessment && !detail?.pae_sealed && !detail?.execution) {
    workspaceAction = { label: "View Assessment", actor: "You · read-only navigation", run: () => showStage("Assessment") };
  } else if (viewedStage === "Obligation" && currentLifecycleStage !== "Obligation" && !(currentLifecycleStage === "Assessment" && !hasCurrentAssessment)) {
    workspaceAction = { label: `View current stage · ${currentLifecycleStage}`, actor: "You · read-only navigation", run: () => showStage(currentLifecycleStage) };
  } else if ((viewedStage === "Payment" || viewedStage === "Reconciliation") && detailState === "loaded" && detail?.settlement_proxy && ["UNKNOWN", "SUBMITTING", "SUBMITTED"].includes(detail.execution?.status ?? "")) {
    workspaceAction = { label: "Reconcile this same intent", actor: "Unassigned · read-only reconciliation", run: () => { showStage("Reconciliation"); void refreshDetail(selectedId, true); } };
  } else if (viewedStage !== "Reconciliation" && detailState === "loaded" && detail?.execution?.status === "SETTLED") {
    workspaceAction = { label: "View reconciliation receipt", actor: "Reconciliation record", run: () => showStage("Reconciliation") };
  } else if (viewedStage === "Payment" && currentPacketNeedsRelease && detail?.financial_action_eligible === true) {
    workspaceAction = { label: "Approve payment release", actor: "Authorized user", exactConfirmation: true, run: () => {
      if (!currentPacketNeedsRelease || !executionConfirmation.isBound || !executionConfirmation.matchesExact || !detail?.execution_packet || !detail.sealed_pae_instruction_hash) return;
      void run("release", () => postCommand(`/api/obligations/${selectedId}/release`, {
        expected_version: detail.aggregate.aggregate_version,
        packet_sha256: detail.execution_packet!.packet_sha256,
        pae_instruction_hash: detail.sealed_pae_instruction_hash,
        confirmation: "APPROVE EXACT TESTNET SETTLEMENT PROXY",
      }));
    } };
  } else if (viewedStage === "Payment" && detailState === "loaded" && detail?.pae_sealed && detail.settlement_proxy && detail.execution === null && !exactPacketSubmissionReady) {
    workspaceAction = null;
  } else if (viewedStage === "Payment" && detailState === "loaded" && detail?.financial_action_eligible === true && detail.pae_sealed && detail.settlement_proxy && exactPacketSubmissionReady) {
    workspaceAction = { label: "Pay testnet USDC", actor: "Authorized user · final payment approval recorded", exactConfirmation: true, run: () => {
      if (!exactPacketSubmissionReady || !exactPacketConfirmationIdentity || !executionConfirmation.isBound || !executionConfirmation.matchesExact ||
          !selectedId || detail.record.obligation_id !== selectedId || detail.settlement_proxy?.preflight.obligation_id !== selectedId ||
          !detail.sealed_pae_instruction_hash || !detail.execution_packet?.packet_sha256) return;
      void run("execute", () => postCommand(`/api/obligations/${selectedId}/execute`, {
        expected_version: detail.aggregate.aggregate_version,
        packet_sha256: detail.execution_packet!.packet_sha256,
        pae_instruction_hash: detail.sealed_pae_instruction_hash,
        confirmation: executionConfirmation.value,
      }));
    } };
  } else if (viewedStage === "Assessment" && proxyPreparationReady && detail?.financial_action_eligible === true) {
    workspaceAction = { label: "Prepare testnet payment details", actor: "Authorized user", run: () => {
      if (!financialScopeContextCurrent()) return;
      const scope = selectedFinancialScopeReadiness(detail, selectedId, selected?.source_group, true);if (scope.applies && !scope.ready) return;
      void run("proxy preflight", () => postCommand("/api/internal/demo/real-testnet-payment/preflight", {
        obligation_id: selectedId,
        expected_version: detail.aggregate.aggregate_version,
      }));
    } };
  } else if ((detail?.financial_action_eligible === true || detail?.advisory_action_eligible === true) && assessmentAction === "assess" && (viewedStage === "Obligation" || viewedStage === "Assessment")) {
    workspaceAction = {
      label: "Run AI Assessment",
      actor: "Finance Agent · advisory review",
      run: () => { void runAssessment(); },
    };
  } else if (detailState === "loaded" && detail?.advisory_action_eligible === true && hasCurrentPayAssessment && !(detail.linked_testnet_instructions?.some(r=>r.assessment_hash===detail.current_assessment?.assessment_hash))) {
    workspaceAction={label:"Create linked testnet instruction",actor:"You · draft only, payment authority required",run:()=>{
      const assessment=detail.current_assessment!;
      const storageKey=`tameion.link-request.${selectedId}.${assessment.assessment_hash}`;
      let key=localStorage.getItem(storageKey);if(!key){key=crypto.randomUUID();localStorage.setItem(storageKey,key);}
      void run("linked instruction",()=>postCommand(`/api/obligations/${selectedId}/testnet-instruction`,{expected_version:detail.aggregate.aggregate_version,assessment_id:assessment.assessment_id,assessment_hash:assessment.assessment_hash},{"Idempotency-Key":key!}));
    }};
  } else if (viewedStage === "Assessment" && assessmentAction === "review") {
    workspaceAction = { label: "Review current PAY assessment", actor: "Human reviewer · unassigned", run: () => { reviewCurrentAssessment(); showStage("Assessment"); } };
  } else if (viewedStage === "Authorization" && detailState === "loaded" && detail?.financial_action_eligible === true && detail.settlement_proxy && authorizationAssessment?.decision === "PAY" && authorizationCoverageReady && routeAssuranceReady && killSwitchView === "inactive" && !detail.pae_sealed && !detail.execution) {
    workspaceAction = { label: "Authorize payment", actor: "Authorized user · identity not shown", run: () => {
      if (!financialScopeContextCurrent()) return;
      const scope = selectedFinancialScopeReadiness(detail, selectedId, selected?.source_group, true);if (detailState !== "loaded" || !detail?.settlement_proxy || authorizationAssessment?.decision !== "PAY" || (scope.applies && !scope.ready) || !routeAssuranceReady || killSwitchView !== "inactive") return;
      void run("approve", () => postCommand(`/api/obligations/${selectedId}/approve`, {
        expected_version: Number(authorizationAssessment.aggregate_version),
        reviewed_assessment_id: authorizationAssessment.assessment_id,
        reviewed_assessment_hash: authorizationAssessment.assessment_hash,
        reason_text: "Authorized after reviewing the current PAY assessment and exact Arc Testnet payment instruction.",
      }));
    } };
  }
  const recoveryOwner = workspaceAction?.actor ?? (detail?.execution?.status === "UNKNOWN"
    ? "Unassigned · read-only reconciliation"
    : firstUnmetPrerequisite?.startsWith("Payment-route assurance")
      ? "External-evidence owner unavailable"
      : "Unassigned · no permitted product action is available");
  const recoveryNextAction = workspaceAction?.label ?? (releaseRecoveryRequired && detail
    ? paymentStageStatus(detail, false, detailState)
    : detail?.execution?.status === "FAILED"
    ? "No repeat payment is available here. Review the settlement record and payment authority before preparing a new instruction."
    : detail?.execution?.status === "BLOCKED" || noCurrentExactExecutionPacket
      ? "No payment can be submitted. Renew payment authority before preparing a new release record."
      : "No product action is available from the currently recorded state.");
  const exceptionRecoveryCard = showExceptionRecovery ? (
    <section aria-label="Exception recovery" className="space-y-2 rounded border-s-4 border-s-[var(--color-warning)] bg-[var(--color-surface)] px-3 py-3">
      <h4 className="text-[13px] font-semibold text-[var(--color-ink)]">Recovery guidance</h4>
      {(detailState === "failed" || detailState === "stale") && <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]"><strong>Current issue:</strong> {detailState === "stale" ? "Selected payable status is stale; refresh before taking action." : "Selected payable status is unavailable; retry before taking action."}</p>}
      <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]"><strong>Submission evidence:</strong> {detail ? submissionEvidenceCopy(detail) : "Submission and settlement status are unavailable until the current record is refreshed."}</p>
      {detail && currentAuthorityGuidance(detail) && <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]">{currentAuthorityGuidance(detail)}</p>}
      <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]"><strong>Next action:</strong> {recoveryNextAction}</p>
      <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]"><strong>Next owner:</strong> {recoveryOwner}</p>
    </section>
  ) : null;
  const historicalAssessmentRecoveryIsSecondary = Boolean(detailState === "loaded" && viewedStage === "Assessment" &&
    currentLifecycleStage === "Assurance" && detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution);
  const stageCompletionReceiptView = stageCompletionReceipt?.obligationId === selectedId ? (
    <p role="status" aria-label="Stage completion receipt" aria-live="polite" className="rounded border border-[var(--color-success)] px-3 py-2 text-[12px] text-[var(--color-success)]">
      {stageCompletionReceipt.message}
    </p>
  ) : null;
  const assessmentResult = !assessmentRequestUnresolved && detailState === "loaded" && hasCurrentAssessment && detail?.aggregate.state !== "CANCELLED" ? currentAssessment : null;
  const assessmentRemediation = assessmentResult?.race?.remediation ?? [];
  const assessmentNextStep = showContinueToAuthorization
    ? "Continue to Authorization to review this exact instruction; navigation does not approve or submit it."
    : assessmentResult?.decision === "PAY"
    ? !assessmentResult.race
      ? "This recorded PAY assessment has no review evidence in this detail; authorization remains locked."
      : proxyPreparationReady
      ? "Prepare the testnet payment details; a fresh assessment is required afterward, before authorization review."
      : workspaceAction?.label === "Review current PAY assessment"
        ? "Review this advisory assessment before any separate human authorization decision."
        : workspaceAction?.label === "Authorize payment"
          ? "An authorized approver may review this payable."
          : !authorizationCoverageReady
            ? selectedFinancialScope.applies
              ? selectedFinancialScope.reason
              : "Assess the remaining payables before authorization review."
            : !routeAssuranceReady
              ? "Complete current payment-route assurance before authorization review."
              : assessmentNextAction("PAY", authorizationCoverageReady).replace(/^Next action:\s*/, "")
    : assessmentRemediation.length > 0
      ? [...new Set(assessmentRemediation.map((item) => item.required_action))].join(" ")
      : assessmentResult
        ? assessmentNextAction(assessmentResult.decision, authorizationCoverageReady).replace(/^Next action:\s*/, "")
        : "Run AI Assessment from the permanent action strip.";
  const assessmentOwnerRoles = assessmentResult?.decision === "ESCALATE"
    ? assessmentRemediation.map((item) => item.escalation_target).filter((role): role is string => Boolean(role))
    : assessmentResult?.decision === "HOLD"
      ? assessmentRemediation.map((item) => item.owner_role)
      : workspaceAction ? [workspaceAction.actor] : [];
  const uniqueAssessmentOwnerRoles = [...new Set(assessmentOwnerRoles)];
  const assessmentNextOwner = uniqueAssessmentOwnerRoles.length === 1 ? uniqueAssessmentOwnerRoles[0] : null;

  const previousViewedStage = viewedStageIndex > 0 ? PAYMENT_LIFECYCLE_STAGES[viewedStageIndex - 1] : null;
  const canGoBack = Boolean(previousViewedStage && stageState(previousViewedStage) !== "UPCOMING");
  const continueTarget = viewedStage === currentLifecycleStage && !showContinueToAuthorization && !showContinueToPayment ? nextAvailableStage : null;
  const visibleWorkspaceAction = showContinueToAuthorization ? null : workspaceAction;
  const assessmentOwnsCurrentStage = !assessmentRequestUnresolved && panel === "assessment" && currentLifecycleStage === "Assessment" && Boolean(assessmentResult) && detail?.aggregate.state !== "CANCELLED";
  const stageOwnsCurrentBusinessCard = detailState === "loaded" && Boolean(detail) && (
    (panel === "authorization" && viewedStage === "Authorization") ||
    (panel === "assurance" && (viewedStage === "Assurance" || viewedStage === "Payment")) ||
    (panel === "reconciliation" && viewedStage === "Reconciliation")
  );
  const contextualAction: WorkspaceAction | null = unresolvedSubmission || assessmentRequestUnresolved || detail?.execution?.status === "UNKNOWN" ? workspaceAction : showContinueToAuthorization
      ? {label: "Continue to Authorization", actor: "You · read-only navigation", run: () => showStage("Authorization")}
      : showContinueToPayment
        ? {label: "Continue to Payment", actor: "You · read-only navigation", run: () => showStage("Payment")}
        : workspaceAction;
  const stageButton = (stage: LifecycleStage, mobile = false) => {
    const status = stageState(stage);
    const upcoming = status === "UPCOMING";
    const reason = upcoming ? stageLockReason(stage) : status === "BLOCKED" ? currentBlockedReason : null;
    const statusId = `${mobile ? "mobile-" : ""}lifecycle-${stage.toLowerCase()}`;
    const reasonId = `${mobile ? "mobile-" : ""}lifecycle-reason-${stage.toLowerCase()}`;
    const selectedView = viewedStage === stage;
    const shortStatus = status === "CURRENT" ? "Current" : status === "COMPLETED" ? "Done" :
      status === "AVAILABLE" ? "Next" : status === "BLOCKED" ? "Blocked" : "Upcoming";
    const content = (
      <>
        <span className="mono me-1 text-[10px] font-semibold text-[var(--color-ink-muted)]">{PAYMENT_LIFECYCLE_STAGES.indexOf(stage) + 1}.</span>
        <span className="min-w-0 break-words font-semibold">{stage}</span>
        <span id={statusId} className="mt-0.5 block text-[10px] font-semibold uppercase tracking-wide">{shortStatus}</span>
        {reason && <span id={reasonId} className="sr-only">{reason}</span>}
      </>
    );
    return (
      <li key={`${mobile ? "mobile-" : ""}${stage}`} className="min-w-0">
        {upcoming ? (
          <button type="button" disabled aria-label={stage} aria-describedby={reason ? `${statusId} ${reasonId}` : statusId} data-stage-state={status} className="min-h-11 w-full cursor-not-allowed rounded-sm border border-[var(--color-border)] px-2 py-2 text-start text-[12px] text-[var(--color-ink-muted)] opacity-75" title={stageLockReason(stage)}>
            {content}
          </button>
        ) : (
          <button
            type="button"
            aria-label={stage}
            aria-current={currentLifecycleStage === stage ? "step" : undefined}
            aria-pressed={selectedView}
            aria-describedby={reason ? `${statusId} ${reasonId}` : statusId}
            data-stage-state={status}
            onClick={() => showStage(stage)}
            className={`min-h-11 w-full rounded-sm border px-2 py-2 text-start text-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)] ${
              selectedView ? "border-[var(--color-accent)] bg-[var(--color-surface)] text-[var(--color-ink)]" :
                currentLifecycleStage === stage ? "border-[var(--color-accent)] text-[var(--color-ink)]" :
                  status === "AVAILABLE" ? "border-[var(--color-border-strong)] text-[var(--color-ink)]" : "border-[var(--color-border)] text-[var(--color-ink)]"
            }`}
          >
            {content}
          </button>
        )}
      </li>
    );
  };

  return (
    <main ref={commandCenterRef} dir="ltr" className="command-center mx-auto flex min-h-screen max-w-[1440px] flex-col gap-3 px-4 py-3 md:gap-4 md:px-6 md:py-4">
      <header className="relative -mx-4 flex flex-wrap items-center justify-between gap-3 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2.5 md:-mx-6 md:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          <TameionBrand compact/>
          <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
            Tameion
          </p>
          <h1 aria-label="Assured Payment — Command Center" className="truncate text-lg font-semibold tracking-[-0.02em] text-[var(--color-ink)] sm:text-xl">Assured Payment{operatorControls?<span className="hidden sm:inline"> — Command Center</span>:" — Command Center"}</h1>
          </div>
        </div>
        <div className="ms-auto flex items-center gap-0 sm:gap-2">
          {!dashboardVisible && initialView === "dashboard" && <button type="button" onClick={()=>{pendingViewFocus.current=true;setDashboardVisible(true);}} className="min-h-11 rounded-lg border border-[var(--color-border-strong)] px-1 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 sm:px-3 sm:text-sm">Dashboard</button>}
          {operatorControls}
        </div>
      </header>
      {walletSummary}

      {dashboardVisible ? (
        <section aria-label="Dashboard" className="flex min-w-0 flex-1 flex-col gap-4 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-[var(--shadow-soft)] md:p-6">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">Circle · Arc · USDC</p>
            <h2 ref={dashboardHeadingRef} tabIndex={-1} className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-ink)]">Dashboard</h2>
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
            <section aria-label="Total payables" className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Total payables</p>
              <p className="mt-2 tabular text-2xl font-semibold text-[var(--color-ink)]">
                {listPresentation === "loading" ? "Loading" : listPresentation === "error" ? "Unavailable" : obligations.filter((o)=>o.source_group === "GENUINE_COMPANY").length}
              </p>
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">{listPresentation === "loading" ? "Loading queue" : listPresentation === "error" ? "Queue could not be loaded" : "From the current payment queue"}</p>
            </section>
            <section aria-label="Test payments" className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Test payments</p>
              <p className="mt-2 tabular text-2xl font-semibold text-[var(--color-ink)]">
                {listPresentation === "loading" ? "Loading" : listPresentation === "error" ? "Unavailable" : obligations.filter((o)=>o.source_group === "DEMO_ARC_TESTNET").length}
              </p>
              <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Separate from company payables</p>
            </section>
          </div>
          {listPresentation === "ready" && obligations.some(o => o.source_group === "GENUINE_COMPANY") && <section aria-label="Payables overview">
            <h3 className="text-sm font-semibold">Payables overview</h3>
            <p className="mt-1 text-xs text-[var(--color-ink-muted)]">Current queue summary</p>
            <ul className="mt-2 divide-y divide-[var(--color-border)]">
              {obligations.filter(o => o.source_group === "GENUINE_COMPANY").slice(0,6).map(o => <li key={o.obligation_id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1 py-3 text-sm">
                <p className="break-words font-semibold">{businessTitle(o.service_category)}</p><p className="tabular min-w-0 break-all text-end font-semibold"><bdi>{businessAmount(o.amount)} {o.currency}</bdi></p>
                <p className="col-span-2 break-words text-xs text-[var(--color-ink-muted)]">{o.beneficiary_name?.trim() && o.beneficiary_name !== "Not captured" ? o.beneficiary_name : "Supplier not recorded"} · {o.due_date ? `Due ${o.due_date}` : "Due date not recorded"}</p>
                <p className="col-span-2 text-xs text-[var(--color-ink-muted)]">{retainedAssessmentRequestKey(o.obligation_id) ? "Assessment outcome unverified" : o.assessed ? `Recorded assessment · ${o.decision ?? "Unavailable"}` : "Assessment required"}</p>
              </li>)}
            </ul>
            {obligations.filter(o => o.source_group === "GENUINE_COMPANY").length > 6 && <p className="text-xs text-[var(--color-ink-muted)]">Showing 6 payables. Open the list to review all.</p>}
          </section>}
          {listPresentation === "empty" && <p role="status" className="text-sm text-[var(--color-ink-muted)]">No items in the payment queue.</p>}
          {listPresentation === "error" && <p role="alert" className="text-sm text-[var(--color-danger)]">Payment queue unavailable. Review payables to retry.</p>}
          <div className="mt-auto flex justify-end border-t border-[var(--color-border)] pt-4">
            <button type="button" onClick={()=>{pendingViewFocus.current=true;setDashboardVisible(false);}} className="min-h-11 rounded-lg bg-[var(--color-primary-action)] px-5 py-2 text-sm font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2">Review payables</button>
          </div>
        </section>
      ) : (
      <div ref={workflowContainerRef} tabIndex={-1} className="grid grid-cols-1 gap-2 md:grid-cols-[300px_minmax(0,1fr)] md:gap-3">
        <aside className="order-1 min-w-0 md:order-1 md:border-e md:pe-4">
          <button
            type="button"
            disabled={listPresentation === "loading"}
            aria-expanded={mobileQueueOpen}
            aria-controls="genuine-obligation-queue"
            onClick={() => setMobileQueueOpen((open) => !open)}
            className="mb-3 min-h-11 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-start text-[13px] font-semibold text-[var(--color-ink)] md:hidden"
          >
            {mobileQueueOpen ? "Close payables list" : listPresentation === "loading"
              ? "Loading payables…"
              : listPresentation === "error"
                ? "Open queue to retry"
                : listPresentation === "empty"
                  ? "No payables"
                  : selected
                    ? `Switch payable${viewedStage !== "Assessment" ? ` · ${selected.service_category.replaceAll("_", " ").toLowerCase()}` : ""}`
                    : "Choose a payable"}
          </button>
          <div id="genuine-obligation-queue" className={mobileQueueOpen ? "block" : "hidden md:block"}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            Payables
          </p>
          <p className="mb-2 text-[12px] text-[var(--color-ink)]">{listPresentation === "ready" ? `${obligations.length} payables` : queueHeaderLabel(listPresentation, reportSummary)}</p>
          {([
            {key:"GENUINE_COMPANY",label:"Company payables",empty:"No company payables are available."},
            {key:"DEMO_ARC_TESTNET",label:"Demo · Arc Testnet",empty:"No approved demo entries are available. Testnet entries are separate from company payables."},
            {key:"UNVERIFIED",label:"Other review records",empty:""},
          ] as const).map(group => {
            const members=obligations.filter(o => (o.source_group??"UNVERIFIED")===group.key);
            if((group.key==="UNVERIFIED"||group.key==="DEMO_ARC_TESTNET")&&!members.length)return null;
            return <section key={group.key} aria-label={group.label} className="mb-3">
            <h2 className="mb-2 text-xs font-semibold">{group.label}</h2>
            {listPresentation==="ready"&&!members.length&&<p className="mb-2 text-xs leading-5 text-[var(--color-ink-muted)]">{group.empty}</p>}
          <ul className="border-y border-[var(--color-border)]">
            {members.map((o) => {
              const workflowRecorded = Boolean(o.pae_sealed || o.aggregate_state === "AUTHORIZED" || o.execution_status);
              const selectedRow = o.obligation_id === selectedId;
              const unresolvedRequest = Boolean(retainedAssessmentRequestKey(o.obligation_id) || selectedRow && assessmentRequestUnresolved);
              // Once selected, the current detail owns the assessment status;
              // a queue summary may refer to an older receipt or version.
              const assessed = selectedRow ? detailState === "loaded" && hasCurrentAssessment : o.assessed;
              const decision = selectedRow ? currentAssessment?.decision : o.decision;
              const assessmentStatus = unresolvedRequest
                ? selectedRow && currentFeedback?.kind === "pending" ? "Assessment pending" : "Assessment outcome unverified"
                : selectedRow && detailState !== "loaded" ? "Assessment status unavailable"
                : assessed ? `Assessment result · ${decision ?? "Unavailable"}`
                : workflowRecorded ? "Workflow recorded" : "Assessment required";
              const statusColor = assessed
                ? decision === "ESCALATE"
                  ? "var(--status-hold-text)"
                  : decision === "HOLD"
                    ? "var(--status-hold-text)"
                    : decision === "PAY"
                      ? "var(--color-ink)"
                      : "var(--color-ink)"
                : "var(--color-ink-muted)";
              return (
                <li key={o.obligation_id}>
                  <button
                    data-obligation-id={o.obligation_id}
                    onClick={() => selectObligation(o.obligation_id)}
                    aria-current={o.obligation_id === selectedId ? "true" : undefined}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)] px-3 py-3 text-start transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)] ${
                      o.obligation_id === selectedId
                        ? "border-s-4 border-s-[var(--color-accent)] bg-[var(--color-surface)]"
                        : "hover:bg-[var(--color-surface)]"
                    }`}
                  >
                    <span className="col-span-2 min-w-0 break-words text-[13px] font-semibold text-[var(--color-ink)]">
                      <span
                        aria-label={unresolvedRequest ? "assessment outcome unverified" : assessed ? "assessment recorded" : assessmentStatus.toLowerCase()}
                        title={unresolvedRequest ? "Assessment completion unverified; do not retry." : assessed ? `Assessment result: ${decision}` : assessmentStatus}
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: assessed || workflowRecorded ? "var(--color-ink-muted)" : "var(--color-border-strong)" }}
                      />{" "}{o.service_category.replaceAll("_", " ").toLowerCase()}
                    </span>
                    <span className="col-span-2 text-start text-[11px] text-[var(--color-ink-muted)]">Supplier · {o.beneficiary_name?.trim() || "Not recorded"}</span>
                    <span className="col-span-2 tabular flex flex-wrap items-baseline gap-x-2 text-start text-[15px] font-semibold text-[var(--color-ink)]">
                      <span className="min-w-0 max-w-full break-all">{o.amount} {o.currency}</span><span className="whitespace-nowrap font-normal text-[12px] text-[var(--color-ink-muted)]">Due {queueDueDate(o)}</span>
                    </span>
                    <span className="col-span-2 text-start text-[11px] font-semibold" style={{ color: statusColor }}>
                      {assessmentStatus}
                    </span>
                </button>
              </li>
              );
            })}
          </ul>
          </section>;
          })}
          {obligationListState(obligationsStatus, obligationsError, obligations.length) !== "ready" && (
            <div className="space-y-2 border-b border-[var(--color-border)] px-3 py-4">
              {obligationListState(obligationsStatus, obligationsError, obligations.length) === "loading" && <p role="status" className="text-[13px] text-[var(--color-ink-muted)]">Loading payables…</p>}
              {obligationListState(obligationsStatus, obligationsError, obligations.length) === "error" && <>
                <p role="alert" className="text-[13px] text-[var(--color-danger)]">Payables are unavailable. No substitute data has been added. {obligationsError}</p>
                <button type="button" onClick={() => void refreshObligations(true)} className="text-[13px] font-semibold underline">Retry payables</button>
              </>}
              {obligationListState(obligationsStatus, obligationsError, obligations.length) === "empty" && <>
                <p className="text-[13px] font-semibold text-[var(--color-ink)]">No payables are currently available.</p>
                <p className="text-[12px] text-[var(--color-ink-muted)]">No substitute records have been added to the queue.</p>
              </>}
            </div>
          )}
          </div>
        </aside>

        <section className="order-2 flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-[var(--shadow-soft)] md:order-2 md:p-4" aria-label="Payable details">
          {!selected && listPresentation === "loading" && <p role="status" className="px-1 text-[13px] text-[var(--color-ink-muted)] md:hidden">Loading payables…</p>}
          {selected && (
          <section aria-label={detailState === "loaded" ? "Genuine obligation workspace" : undefined}>
            {selectedFinancialResult && <ActionResultBanner result={selectedFinancialResult} title={selectedFinancialResult.label === "release" ? "Release approval status" : "Payment submission status"} focusOnMount />}
            <section aria-label="Selected source payable" className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 border-b border-[var(--color-border)] pb-2 sm:gap-3 sm:pb-3">
              <div className="min-w-0">
                <p className="sr-only">Selected payable</p>
                {selected.source_group&&selected.source_group!=="UNVERIFIED"&&<p className="mt-1 text-xs text-[var(--color-ink-muted)]">{selected.source_group==="GENUINE_COMPANY"?"Company payable":"Test payment · Arc Testnet"}</p>}
                <h2 className={viewedStage === "Assessment"
                  ? "mt-1 break-words text-[18px] font-semibold leading-6 text-[var(--color-ink)] md:text-[25px]"
                  : "mt-1 break-words text-[21px] font-semibold leading-7 text-[var(--color-ink)] md:text-[25px]"}>
                  {businessTitle(detailState === "loaded" && detail && sourceText(detail.record, "service_category") !== "Not captured"
                    ? sourceText(detail.record, "service_category") : selected.service_category)}
                </h2>
              </div>
              <div className="min-w-0 max-w-[min(10rem,40vw)] text-end sm:max-w-[16rem]">
                  <p className="tabular break-all text-[17px] font-semibold leading-6 text-[var(--color-ink)] md:text-[23px] md:leading-7"><bdi dir="ltr">{detailState === "loaded" && detail ? `${detail.record.amount} ${detail.record.currency}` : `${selected.amount} ${selected.currency}`}</bdi></p>
                </div>
              <div className="col-span-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                  <p className="min-w-0 break-words">{detailState === "loaded" && detail && sourceText(detail.record, "beneficiary_name") !== "Not captured"
                    ? `Supplier: ${sourceText(detail.record, "beneficiary_name")}` : "Supplier not recorded"}</p>
                  <p className="mono break-all text-[11px]">{selectedId}</p>
                </div>
                {detailState === "loaded" && detail && (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                      <p><strong>{sourcePayableState(detail)}</strong></p>
                      <p><span className="text-[var(--color-ink-muted)]">Due </span><strong>{sourceText(detail.record, "effective_due_date") !== "Not captured" ? sourceText(detail.record, "effective_due_date") : sourceText(detail.record, "due_date")}</strong></p>
                    </div>
                    <dl aria-label="Source billing details" className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--color-ink-muted)]">
                      {([ ["invoice_reference", "Invoice"], ["issue_date", "Issued"], ["recurrence", "Frequency"] ] as const).map(([field,label]) => sourceText(detail.record, field) !== "Not captured" &&
                        <div key={field} className="min-w-0 break-words"><dt className="inline">{label}: </dt><dd className="inline">{field === "recurrence" ? businessTitle(sourceText(detail.record, field)) : sourceText(detail.record, field)}</dd></div>)}
                    </dl>
                    <p aria-label="Current assessment outcome" className="mt-2 text-xs font-semibold">{assessmentRequestUnresolved
                      ? currentFeedback?.kind === "in-flight" || currentFeedback?.kind === "pending" ? "Assessment pending" : "Assessment outcome unverified"
                      : hasCurrentAssessment && currentAssessment ? `Assessment result · ${currentAssessment.decision} · advisory`
                      : currentAssessment ? "Assessment needs refresh" : "Assessment not recorded"}</p>
                    {viewedStage !== "Assessment" && sourceServiceContext(detail.record) && <p data-testid="source-service-context" className="mt-1 text-sm leading-5 text-[var(--color-ink-muted)]">{sourceServiceContext(detail.record)}</p>}
                    {viewedStage === "Authorization" && <p className="mt-1 text-sm leading-5 text-[var(--color-warning)]">
                      ARC TESTNET · {detail.settlement_proxy ? "testnet payment destination prepared" : "testnet payment destination not prepared"} · real-world payable remains {sourcePayableState(detail)}.
                    </p>}
                    {viewedStage === "Authorization" && detail.settlement_proxy && <p className="mt-1 text-sm text-[var(--color-ink-muted)]">
                      Testnet amount: <bdi dir="ltr" className="tabular font-semibold">{businessAmount(detail.settlement_proxy.preflight.amount)} {detail.settlement_proxy.preflight.asset}</bdi>
                      {" · "}{detail.settlement_proxy.preflight.network}.
                    </p>}
                  </>
                )}
                {detailState === "loaded" && <HoldReasonCard blockers={selectedBlockers} feedback={currentFeedback} requestKey={selectedRequestKey} />}
                {detailState !== "loaded" && <StateLine tone={state.tone} label={state.label} explanation={state.explanation} />}
                {(detailState === "loading" || detailState === "failed" || detailState === "stale") && (
                  <p className="mt-2 text-[12px] text-[var(--color-warning)]">Source and control details are {detailState === "loading" ? "loading" : detailState === "stale" ? "stale" : "unavailable"}; no current action is inferred.</p>
                )}
              </div>
            </section>
          </section>
          )}

          {selectedBlockers.length > 0 && detailState !== "loaded" && <HoldReasonCard blockers={selectedBlockers} feedback={null} requestKey={selectedRequestKey} />}

          {selected && !detail && detailError && (
            <div role="alert" className="rounded border border-[var(--color-danger)] bg-[var(--color-surface)] px-3 py-3">
              <p className="text-[13px] font-semibold text-[var(--color-danger)]">Payable details are unavailable.</p>
              <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">{detailError}</p>
            </div>
          )}

          {selected && detail && detailState === "stale" && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded border-s-[3px] border-s-[var(--color-warning)] bg-[var(--color-surface)] px-3 py-3">
              <div>
                <p className="text-[13px] font-semibold text-[var(--color-warning)]">Last-known payable details are out of date.</p>
                <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">Retained control, kill-switch, assessment, and execution fields are not freshly verified. Actions are unavailable until detail refresh succeeds.</p>
              </div>
            </div>
          )}

          {selected && detail && detailState === "loaded" && detail.financial_action_eligible !== true && detail.advisory_action_eligible !== true && (
            <section role="status" aria-label="Review-only payable" className="rounded border-s-4 border-s-[var(--color-warning)] bg-[var(--color-surface)] px-3 py-3">
              <p className="text-[13px] font-semibold text-[var(--color-ink)]">Review-only payable</p>
              <p className="mt-1 text-[12px] leading-5 text-[var(--color-ink-muted)]">This record can be reviewed, but it cannot be assessed, authorized or submitted for payment. Financial actions require a separately approved controlled test obligation.</p>
            </section>
          )}

          {detail?.advisory_action_eligible===true && (detail.linked_testnet_instructions?.length??0)>0 && <section aria-label="Linked Arc Testnet instructions" className="rounded border border-[var(--color-border)] p-3">
            <h2 className="font-semibold">Linked Arc Testnet instructions</h2>
            <p className="text-sm">Drafts require separate controlled approval before preparation or payment. Testnet activity does not pay the genuine supplier.</p>
            {detail.linked_testnet_instructions?.map(row=><div key={row.instruction_id} className="mt-2 min-w-0 border-t border-[var(--color-border)] pt-2 text-sm"><p className="break-all">{row.instruction_id}</p><p>Draft · payment authority required</p></div>)}
          </section>}

          {!isInitialObligationScreen && <section aria-label="Guided lifecycle" className={viewedStage === "Obligation" ? "space-y-2 border-b border-[var(--color-border)] pb-2" : "border-b border-[var(--color-border)] pb-1 md:space-y-2 md:pb-2"}>
            {viewedStage === "Obligation" ? <div className="rounded border border-[var(--color-border)] px-3 py-2">
              <p aria-live="polite" aria-atomic="true" className="text-sm font-semibold text-[var(--color-ink)]">{viewedStage === currentLifecycleStage ? `Step ${currentStageIndex + 1} of 6 · ${viewedStage}` : `Reviewing step ${viewedStageIndex + 1} of 6 · ${viewedStage}`}</p>
              <p className="mt-0.5 text-sm text-[var(--color-ink-muted)]">{stagePositionLabel}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-[var(--color-border)]" role="progressbar" aria-label="Current workflow progress" aria-valuemin={1} aria-valuemax={6} aria-valuenow={currentStageIndex + 1}>
                <span className="block h-full bg-[var(--color-accent)]" style={{ width: `${((currentStageIndex + 1) / PAYMENT_LIFECYCLE_STAGES.length) * 100}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={!canGoBack} onClick={() => previousViewedStage && showStage(previousViewedStage)} className="min-h-11 rounded border border-[var(--color-border-strong)] px-3 text-sm font-semibold disabled:opacity-50">{previousViewedStage ? `Back to ${previousViewedStage}` : "Back"}</button>
                {continueTarget && <button type="button" onClick={() => showStage(continueTarget)} className="min-h-11 rounded border border-[var(--color-border-strong)] px-3 text-sm font-semibold text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]">Continue to {continueTarget}</button>}
              </div>
              <div className="mt-2">
                <button type="button" aria-expanded={mobileStagesOpen} aria-controls="all-payment-stages" onClick={() => setMobileStagesOpen((open) => !open)} className="min-h-11 py-2 text-sm font-semibold text-[var(--color-ink-muted)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]">View all stages</button>
                <nav id="all-payment-stages" aria-label="Payment lifecycle navigation" hidden={!mobileStagesOpen}>
                  <ol aria-label="Payment lifecycle" className="grid gap-1 border-t border-[var(--color-border)] pt-2 md:grid-cols-2 lg:grid-cols-3">
                    {PAYMENT_LIFECYCLE_STAGES.map((stage) => stageButton(stage))}
                  </ol>
                </nav>
              </div>
            </div> : <div className="rounded border border-[var(--color-border)] px-2 py-1 md:px-3 md:py-2">
              <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <p aria-live="polite" aria-atomic="true" className="text-sm font-semibold text-[var(--color-ink)]">{viewedStage === currentLifecycleStage ? `Step ${currentStageIndex + 1} of 6 · ${viewedStage}` : `Reviewing step ${viewedStageIndex + 1} of 6 · ${viewedStage}`}</p>
                <p className="text-sm text-[var(--color-ink-muted)]">{stagePositionLabel}</p>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <div className="h-1.5 min-w-8 flex-1 overflow-hidden rounded bg-[var(--color-border)]" role="progressbar" aria-label="Current workflow progress" aria-valuemin={1} aria-valuemax={6} aria-valuenow={currentStageIndex + 1}>
                  <span className="block h-full bg-[var(--color-accent)]" style={{ width: `${((currentStageIndex + 1) / PAYMENT_LIFECYCLE_STAGES.length) * 100}%` }} />
                </div>
                <button type="button" disabled={!canGoBack} onClick={() => previousViewedStage && showStage(previousViewedStage)} className="min-h-11 shrink-0 rounded border border-[var(--color-border-strong)] px-2 text-sm font-semibold disabled:opacity-50">{previousViewedStage ? `Back to ${previousViewedStage}` : "Back"}</button>
                {continueTarget && <button type="button" onClick={() => showStage(continueTarget)} className="min-h-11 shrink-0 rounded border border-[var(--color-border-strong)] px-2 text-sm font-semibold text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]">Continue to {continueTarget}</button>}
                <button type="button" aria-expanded={mobileStagesOpen} aria-controls="all-payment-stages" onClick={() => setMobileStagesOpen((open) => !open)} className="min-h-11 shrink-0 px-1 text-sm font-semibold text-[var(--color-ink-muted)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]">View all stages</button>
              </div>
              <nav id="all-payment-stages" aria-label="Payment lifecycle navigation" hidden={!mobileStagesOpen}>
                <ol aria-label="Payment lifecycle" className="grid gap-1 border-t border-[var(--color-border)] pt-2 md:grid-cols-2 lg:grid-cols-3">
                  {PAYMENT_LIFECYCLE_STAGES.map((stage) => stageButton(stage))}
                </ol>
              </nav>
            </div>}
          </section>}

          <span id={stageDescriptionId} className="sr-only">{stageAccessibilityLabel}</span>

          {(!assessmentRequestUnresolved || detailState !== "loaded") && !selectedBlockers.some(b => ["source-evidence", "assessment-hold"].includes(b.kind)) && !assessmentOwnsCurrentStage && !stageOwnsCurrentBusinessCard && (selectedId || listPresentation !== "loading") && <section aria-label={isInitialObligationScreen ? "Obligation next step" : "Current next step"} data-testid="current-next-step" className="rounded border-s-4 border-s-[var(--color-accent)] bg-[var(--color-bg)] p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                {!isInitialObligationScreen && <p className="text-sm font-semibold text-[var(--color-ink-muted)]">{stagePositionLabel}</p>}
                <h3 ref={stageHeadingRef} tabIndex={-1} aria-describedby={stageDescriptionId} className="mt-1 text-[16px] font-semibold leading-5 text-[var(--color-ink)]">{!selectedId
                  ? listPresentation === "ready" ? "Choose a payable" : listPresentation === "empty" ? "No payables" : "Payables unavailable"
                  : detailState === "loaded" && currentLifecycleStage === "Obligation" && !hasCurrentAssessment ? "Assessment required" : viewedStage === "Assessment" && hasCurrentPayAssessment ? "PAY — advisory" : viewedStage === "Payment" && detailState === "loaded" && detail ? paymentStageStatus(detail, exactPacketSubmissionReady, detailState) : detailState === "loaded" ? lifecycleStatus(viewedStage) : state.label}</h3>
                {!showExceptionRecovery && selectedWorkspaceGuidance !== lifecycleStatus(viewedStage) && <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--color-ink-muted)]">{isInitialObligationScreen && selectedId && detailState === "loaded" ? "This obligation needs an assessment before it can proceed." : selectedWorkspaceGuidance}</p>}
                {isInitialObligationScreen && selectedId && <p className="mt-2 max-w-3xl text-[13px] leading-5 text-[var(--color-ink-muted)]">This action records an advisory PAY, HOLD or ESCALATE result. It does not approve or send payment.</p>}
                {visibleWorkspaceAction && !showExceptionRecovery && !isInitialObligationScreen && <p className="mt-2 text-[12px] text-[var(--color-ink-muted)]">Next owner: <strong className="text-[var(--color-ink)]">{visibleWorkspaceAction.actor}</strong></p>}
              {!visibleWorkspaceAction && !showContinueToAuthorization && !showContinueToPayment && selectedId && detailState === "loaded" && !showExceptionRecovery && !isInitialObligationScreen && (
                  <p className="mt-2 text-sm text-[var(--color-ink-muted)]">Next owner: <strong className="text-[var(--color-ink)]">
                    {detail?.execution?.status === "FAILED" || detail?.execution?.status === "BLOCKED" ||
                    ["BLOCKED", "REVOKED", "EXPIRED"].includes(detail?.truth.tameion_control_truth.execution_release_authority ?? "")
                      ? "Unassigned · no permitted product action is available"
                      : noCurrentExactExecutionPacket || detail?.execution_kill_switched === true
                        ? "Unassigned · no permitted product action is available"
                      : currentPacketNeedsRelease
                      ? "Final payment authorization"
                      : detail?.settlement_proxy && detail.execution?.status === "UNKNOWN"
                        ? "Unassigned · read-only reconciliation only"
                        : detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution
                          ? "External-evidence owner unavailable"
                        : firstUnmetPrerequisite?.startsWith("Payment-route assurance")
                          ? "External-evidence owner unavailable"
                          : "Unassigned · no permitted product action is available"}
                  </strong></p>
                )}
                {visibleWorkspaceAction?.exactConfirmation && (
                  <label className="mt-3 grid max-w-lg gap-1 text-[12px] font-medium text-[var(--color-ink)]">
                    I have reviewed the exact testnet amount, recipient and estimated fees
                    <input
                      className="min-h-11 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]"
                      type="checkbox"
                      checked={executionConfirmation.matchesExact}
                      onChange={(event) => executionConfirmation.setValue(event.target.checked ? "SUBMIT EXACT TESTNET SETTLEMENT PROXY" : "")}
                      aria-describedby="payment-release-confirmation-guidance"
                    />
                    <span id="payment-release-confirmation-guidance" className="font-normal text-[var(--color-ink-muted)]">Approval does not submit payment. Estimated fees are checked again before submission.</span>
                  </label>
                )}
              </div>
              {exceptionRecoveryCard && (historicalAssessmentRecoveryIsSecondary
                ? <details className="rounded border border-[var(--color-border)] px-3 py-1" data-testid="historical-current-recovery-disclosure">
                    <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">Current Assurance recovery details</summary>
                    {exceptionRecoveryCard}
                  </details>
                : detailState === "failed"
                  ? <details className="rounded border border-[var(--color-border)] px-3 py-1" data-testid="unavailable-detail-recovery-disclosure">
                      <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">Unavailable detail and submission evidence</summary>
                      {exceptionRecoveryCard}
                    </details>
                : exceptionRecoveryCard)}
              {stageCompletionReceiptView}
              {!assessmentOwnsCurrentStage && selectedAssessmentFeedbackView}
            </div>
          </section>}

          <div>
            {panel === "assessment" && (
              <div className="w-full max-w-3xl">
                {currentResult?.label === "proxy preflight" && (
                  <div className="mb-3">
                    <ActionResultBanner result={currentResult} title="Payment details not prepared" focusOnMount />
                  </div>
                )}
                {assessmentResult ? (
                  <AssessmentResultCard
                    assessment={assessmentResult}
                    nextAction={assessmentNextStep}
                    nextOwner={assessmentNextOwner}
                    paymentEligibility={assessmentPaymentEligibility}
                    primaryAction={null}
                    stageDescriptionId={stageDescriptionId}
                    stageHeadingRef={stageHeadingRef}
                    holdFindingsRef={holdFindingsRef}
                    holdReviewActive={Boolean(currentHoldReview && viewedStage === "Assessment")}
                    canReassess={optionalReassessmentAvailable}
                    reassessmentIsPrimary={false}
                    onReassess={() => void runAssessment()}
                    busy={busy}
                  />
                ) : (
                  <section aria-label="Assessment result" className="max-w-xl space-y-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-2 sm:p-4">
                    <h3 className="text-[16px] font-semibold text-[var(--color-ink)]">Assessment</h3>
                    <p role="status" className="text-[13px] leading-5 text-[var(--color-ink-muted)]">
                      {assessmentAction === "assess"
                        ? "Run AI Assessment from the permanent action strip. The result is advisory and cannot authorize or execute payment."
                        : assessmentActionStatus}
                    </p>
                    <p className="border-t border-[var(--color-border)] pt-2 text-[12px] leading-5 text-[var(--color-ink-muted)]"><strong>Capability boundary:</strong> this product does not verify invoice contents, match purchase orders or receipts, validate supplier tax, or provide enterprise fraud or duplicate assurance.</p>
                    {detailState !== "loaded" && <RuntimeBadge mode={selected?.provider_mode ?? null} />}
                  </section>
                )}
                {assessmentOwnsCurrentStage && stageCompletionReceipt?.obligationId === selectedId && (
                  <p role="status" aria-label="Stage completion receipt" aria-live="polite" className="mt-3 rounded border border-[var(--color-success)] px-3 py-2 text-[12px] text-[var(--color-success)]">
                    {stageCompletionReceipt.message}
                  </p>
                )}
                {assessmentOwnsCurrentStage && selectedAssessmentFeedbackView}
              </div>
            )}

            {panel === "authorization" && (
              <div className="w-full max-w-4xl space-y-3">
                {detailState !== "loaded" && <p className="text-[13px] text-[var(--color-ink-muted)]">
                  {authorizationPanelCopy(detailState, Boolean(selectedId))}
                </p>}
                {detailState === "loaded" && selectedId && detail && (
                  <section aria-label="Payment approval decision" className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <h3 ref={stageHeadingRef} tabIndex={-1} aria-describedby={stageDescriptionId} className="text-[14px] font-semibold text-[var(--color-ink)]">Payment approval decision</h3>
                    <p className="text-sm text-[var(--color-warning)]">Source payment obligation · Arc Testnet payment destination · testnet execution does not discharge the real-world payable.</p>
                    {detail.pae_sealed && detail.settlement_proxy
                      ? <p className="text-[13px] font-semibold text-[var(--color-ink)]">The Arc Testnet payment instruction is approved. Final payment authorization and pre-release checks still apply.</p>
                      : detail.aggregate.state === "AUTHORIZED"
                        ? <p className="text-[13px] font-semibold text-[var(--color-ink)]">Approval is recorded, but required payment controls did not complete. No payment can be released.</p>
                        : <p className="text-[13px] font-semibold text-[var(--color-ink)]">AI did not authorize this payment. You are approving this exact instruction.</p>}
                    <section aria-label="Authorization summary" className="space-y-2">
                      <dl className="grid gap-x-6 sm:grid-cols-2">
                        <Field label="Source payable" value={`${detail.record.amount} ${detail.record.currency} · ${sourcePayableState(detail)}`} />
                        <Field label="Source beneficiary" value={sourceText(detail.record,"beneficiary_name") === "Not captured" ? "Supplier identity not established" : sourceText(detail.record,"beneficiary_name")} />
                        <Field label="Testnet amount" value={detail.settlement_proxy ? `${detail.settlement_proxy.preflight.amount} ${detail.settlement_proxy.preflight.asset}` : "No testnet instruction prepared"} />
                        <Field label="Testnet destination" value={detail.settlement_proxy ? `${detail.settlement_proxy.preflight.destination_wallet.name ?? "Controlled testnet proxy"} · ${detail.settlement_proxy.preflight.destination_wallet.address.slice(0,6)}…${detail.settlement_proxy.preflight.destination_wallet.address.slice(-4)}` : "No controlled proxy prepared"} />
                        <Field label="Network" value={detail.settlement_proxy?.preflight.network ?? "No testnet instruction prepared"} />
                      </dl>
                      <p className="text-[13px]">Testnet execution does not discharge the real-world payable or verify the source supplier.</p>
                      <p className="text-[13px]"><strong>Current decision:</strong> {lifecycleStatus("Authorization")}. {hasCurrentPayAssessment ? "The PAY assessment is current for this selected version; it remains advisory." : "A current PAY review is not established."}</p>
                      <p className="text-[13px]"><strong>Reason:</strong> {hasCurrentAssessment && currentAssessment?.reasons[0] ? financeFacingAssessmentText(currentAssessment.reasons[0]) : "No current assessment reason is established."}</p>
                      <p className="text-[13px]"><strong>Next owner:</strong> {recoveryOwner}. <strong>Next step:</strong> {contextualAction?.label ?? recoveryNextAction}</p>
                    </section>
                    <details className="rounded border border-[var(--color-border)] px-3 py-2">
                      <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold">View payment instruction details</summary>
                      <div className="space-y-3 border-t border-[var(--color-border)] pt-3">
                    {detail.settlement_proxy && <dl><Field label="Exact testnet destination address" value={detail.settlement_proxy.preflight.destination_wallet.address} /></dl>}
                    <SourceObligationLineage
                      record={detail.record}
                      payableState={sourcePayableState(detail)}
                      selectedObligationId={selectedId}
                      preflight={detail.settlement_proxy?.preflight}
                    />
                    {detail.settlement_proxy ? <ControlledProxyLineage
                      record={detail.record}
                      selectedObligationId={selectedId}
                      preflight={detail.settlement_proxy.preflight}
                      payableState={sourcePayableState(detail)}
                    /> : <p className="text-sm text-[var(--color-ink-muted)]">No Arc Testnet payment destination is prepared for this source obligation.</p>}
                      </div>
                    </details>
                    <p className="border-t border-[var(--color-border)] pt-2 text-sm text-[var(--color-ink-muted)]">Authorization records approval only. Payment controls and release remain separate; approval does not submit payment.</p>
                    {!detail.pae_sealed && <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]">{selectedWorkspaceGuidance}</p>}
                    {exceptionRecoveryCard}
                    {stageCompletionReceiptView}
                  </section>
                )}
                {authorizationPrerequisitesVisible(detailState, Boolean(selectedId), Boolean(detail?.pae_sealed), Boolean(detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution)) && (() => {
                  const blockers = authorizationBlockers({
                    hasSelection: Boolean(selectedId),
                    allAssessed: authorizationCoverageReady,
                    hasCurrentPayAssessment,
                    routeAssuranceReady,
                    destinationVerification: detail?.aggregate.destination_verification_status,
                    destinationOperational: detail?.aggregate.destination_operational_status,
                    sourceWallet: detail?.aggregate.source_wallet_status,
                    productTrustProvenance: detail?.aggregate.product_trust_provenance,
                    proxyPreparationAvailable: proxyPreparationReady,
                    reviewed: Boolean(authorizationAssessment),
                    killSwitchEngaged: killSwitchView === "engaged",
                  });
                  return blockers.length ? (
                    <details className="rounded border border-[var(--color-border)] px-3 py-2">
                      <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">Why authorization is unavailable</summary>
                      <ul className="list-disc space-y-1 border-t border-[var(--color-border)] pt-3 ps-5 text-[12px] text-[var(--color-warning)]" aria-label="Unmet authorization prerequisites">
                        {blockers.map((b) => <li key={b}>{b}</li>)}
                      </ul>
                    </details>
                  ) : null;
                })()}
                {currentResult?.label === "approve" && <ActionResultBanner result={currentResult} />}
              </div>
            )}

            {panel === "assurance" && viewedStage === "Payment" && detail && (
              <div className="max-w-xl space-y-3">
                <section aria-label="Payment status" className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="payment-status-card">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Payment · Arc Testnet</p>
                    <h3 ref={stageHeadingRef} tabIndex={-1} aria-describedby={stageDescriptionId} className="mt-1 text-[16px] font-semibold text-[var(--color-ink)]">{paymentStageStatus(detail, exactPacketSubmissionReady, detailState)}</h3>
                  </div>
                  {detail.execution?.status === "UNKNOWN" && <p role="status" className="border-s-4 border-s-[var(--color-warning)] ps-3 text-[13px] font-semibold">Reconciliation only. No blind retry or second submission.</p>}
                  <dl>
                    <Field label="Testnet settlement" value={detail.settlement_proxy
                      ? `${detail.settlement_proxy.preflight.amount} ${detail.settlement_proxy.preflight.asset} · ${detail.settlement_proxy.preflight.network}`
                      : `${detail.aggregate.amount} ${detail.aggregate.asset} · ${detail.aggregate.network}`} />
                    <Field label="Testnet payment destination" value={detail.settlement_proxy
                      ? detail.settlement_proxy.preflight.destination_wallet.address
                      : "No controlled proxy recipient is recorded."} />
                    {detail.settlement_proxy && <>
                      <Field label="Source wallet" value={detail.settlement_proxy.preflight.source_wallet.address} />
                      <Field label="Estimated network fee" value={`${detail.settlement_proxy.preflight.estimated_network_fee} USDC`} />
                      <Field label="Planning fee limit" value={`${detail.settlement_proxy.preflight.max_network_fee} USDC`} />
                      <Field label="Planning total limit" value={`${detail.settlement_proxy.preflight.max_total_debit} USDC`} />
                    </>}
                    {detail.payment_release_current && detail.payment_release_approval && <Field label="Release approval recorded" value={detail.payment_release_approval.approved_at} />}
                    <Field label="Instruction state" value={currentPaeDisplay(detail)} />
                    <Field label="Execution state" value={detail.execution?.status ?? "No execution has been recorded for this instruction."} />
                    <Field label="Source payable" value={`${sourcePayableState(detail)} · unchanged by testnet execution`} />
                  </dl>
                  {detail.settlement_proxy && !detail.execution && <p className="text-[12px] text-[var(--color-ink-muted)]">Testnet USDC only. Network fees are estimates, checked against the planning limits before submission; they are not a guaranteed final fee.</p>}
                  {detail.execution?.status === "SETTLED" && <p className="border-t border-[var(--color-border)] pt-2 text-[12px] text-[var(--color-warning)]">The Arc Testnet transaction does not discharge the real-world payable.</p>}
                  {detail.execution === null && exactPacketSubmissionReady && <p className="text-[12px] text-[var(--color-ink-muted)]">Release approval is recorded. Confirm this instruction again, then choose Pay testnet USDC to submit once.</p>}
                  {workspaceAction?.exactConfirmation && (
                    <label className="grid max-w-lg gap-1 text-[12px] font-medium text-[var(--color-ink)]">
                      I have reviewed the exact testnet amount, recipient and estimated fees
                      <input
                        className="min-h-11 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]"
                        type="checkbox"
                        checked={executionConfirmation.matchesExact}
                        onChange={(event) => executionConfirmation.setValue(event.target.checked ? "SUBMIT EXACT TESTNET SETTLEMENT PROXY" : "")}
                        aria-describedby="execution-confirmation-guidance"
                      />
                      <span id="execution-confirmation-guidance" className="font-normal text-[var(--color-ink-muted)]">Approval does not submit payment. Estimated fees are checked again before submission.</span>
                    </label>
                  )}
                  {exceptionRecoveryCard}
                  {stageCompletionReceiptView}
                </section>
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">Payment stop controls</summary>
                  <div className={`mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-s-[3px] px-3 py-3 ${killSwitchView === "engaged" ? "border-s-[var(--color-danger)] bg-[var(--color-surface)]" : "border-s-[var(--color-border)]"}`}>
                    <div>
                      <p className={`text-[13px] font-semibold uppercase tracking-wide ${killSwitchView === "engaged" ? "text-[var(--color-danger)]" : "text-[var(--color-ink-muted)]"}`}>Payment stop: {killSwitchLabel(killSwitchView)}</p>
                      <p className="text-[12px] text-[var(--color-ink-muted)]">Checked by the payment controls and settlement service.</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={busy || detailState !== "loaded" || !selectedId || detail.financial_action_eligible !== true}
                        onClick={() => run("kill-switch", () => postCommand(`/api/obligations/${selectedId}/kill-switch`, { action: "ACTIVATE", scope: "TRANSACTION" }))}
                        className="min-h-11 rounded border border-[var(--color-danger)] px-3 py-2 text-[12px] font-semibold text-[var(--color-danger)] transition hover:bg-[var(--color-danger)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >Disable this obligation</button>
                      <button
                        disabled={busy || detailState !== "loaded" || !selectedId || detail.financial_action_eligible !== true}
                        onClick={() => run("kill-switch", () => postCommand(`/api/obligations/${selectedId}/kill-switch`, { action: "DEACTIVATE", scope: "TRANSACTION" }))}
                        className="min-h-11 rounded border border-[var(--color-border)] px-3 py-2 text-[12px] font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-40"
                      >Re-enable</button>
                    </div>
                  </div>
                </details>
                {currentResult?.label === "kill-switch" && <ActionResultBanner result={currentResult} />}
              </div>
            )}

            {panel === "assurance" && viewedStage === "Assurance" && (
              <div className="max-w-xl space-y-3">
                {detailState === "loaded" && detail && <>
                  <h3 ref={stageHeadingRef} tabIndex={-1} aria-describedby={stageDescriptionId} className="sr-only">Assurance · Payment controls</h3>
                  <DeterministicAssuranceSummary detail={detail} />
                </>}
                {detailState !== "loaded" && <section aria-label="Deterministic assurance result" className="rounded border border-[var(--color-border)] p-4"><h3 className="text-[16px] font-semibold">Assurance · Payment controls</h3><p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Current payment controls are unavailable until the obligation detail is refreshed.</p></section>}
                {exceptionRecoveryCard}
                {stageCompletionReceiptView}
              </div>
            )}

            {panel === "reconciliation" && (
              <div className="max-w-xl space-y-3">
                <header className="space-y-1">
                  <h3 className="text-[16px] font-semibold text-[var(--color-ink)]">Reconciliation · Settlement confirmation</h3>
                  <p className="text-[13px] text-[var(--color-ink-muted)]">Compare the recorded testnet outcome with the source obligation. The source payable remains separate and unchanged.</p>
                </header>
                {detail && detailState === "loaded" && detail.settlement_proxy ? (() => {
                  const evidence = detail.execution?.provider_evidence;
                  const observedAmount = evidence?.atomic_amount ?? evidence?.atomicAmount;
                  const observedDestination = evidence?.destination_address ?? evidence?.destinationAddress;
                  const settledEvidence = detail.execution?.status === "SETTLED" ? classifySettledEvidence(detail) : null;
                  const amountMatch = settledEvidence?.amountMatch ?? (evidence?.status === "CONFIRMED" && observedAmount && detail.execution?.atomic_amount
                    ? observedAmount === detail.execution.atomic_amount ? "confirmed" : "mismatch recorded"
                    : "not established from the settlement record");
                  const destinationMatch = settledEvidence?.destinationMatch ?? (evidence?.status === "CONFIRMED" && observedDestination && detail.execution?.destination_address
                    ? observedDestination.toLowerCase() === detail.execution.destination_address.toLowerCase() ? "confirmed" : "mismatch recorded"
                    : "not established from the settlement record");
                  const providerState = evidence?.status ?? (detail.execution?.provider_ref ? "Settlement-network status is not included in the current record" : "No settlement-network reference is recorded for this instruction");
                  const result = detail.execution?.status === "SETTLED"
                    ? detail.truth.settlement_truth.runtime === "SIMULATED"
                      ? "Simulated record — no Arc settlement"
                      : settledEvidence!.summary
                    : detail.execution?.status === "UNKNOWN"
                      ? "Outcome unknown · read-only reconciliation only; do not resubmit"
                      : detail.execution?.status === "SUBMITTING"
                        ? "Submission is in progress. The settlement outcome has not been reconciled; continue with read-only reconciliation for this same intent. Do not resubmit."
                        : detail.execution?.status === "SUBMITTED"
                          ? "Submission is recorded. The settlement outcome is awaiting reconciliation for this same intent; reconcile read-only and do not resubmit."
                      : detail.execution?.status === "FAILED"
                        ? "Settlement attempt failed · successful reconciliation is not recorded"
                        : detail.execution?.status === "BLOCKED"
                          ? "Payment release is blocked · the external settlement outcome is not confirmed"
                          : detail.execution == null
                            ? "No Tameion payment record is recorded for this instruction"
                            : "A payment record is present, but its status is not classified in this receipt.";
                  return (
                    <section aria-label="Reconciliation receipt" className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4">
                      <h3 ref={stageHeadingRef} tabIndex={-1} aria-describedby={stageDescriptionId} className="text-[14px] font-semibold text-[var(--color-ink)]">Testnet reconciliation receipt</h3>
                      <p className="text-[13px] font-semibold text-[var(--color-ink)]">{result}</p>
                      <dl>
                        <Field label="Source obligation" value={`${sourceText(detail.record, "beneficiary_name")} · ${detail.record.amount} ${detail.record.currency}`} />
                        <Field label="Source payable" value={`${sourcePayableState(detail)} · remains outstanding in the source record`} />
                        <Field label="Testnet settlement" value={`${detail.settlement_proxy.preflight.amount} ${detail.settlement_proxy.preflight.asset} · ${detail.settlement_proxy.preflight.network}`} />
                        <Field label="Testnet payment destination" value={detail.settlement_proxy.preflight.destination_wallet.name ?? "Arc Testnet payment destination"} />
                        <Field label="Exact amount verification" value={amountMatch} />
                      <Field label="Settlement-network amount verification" value={settledEvidence?.providerAmountMatch ?? "not established from the settlement record"} />
                        <Field label="Exact destination verification" value={destinationMatch} />
                      </dl>
                      {settledEvidence && <p className={`text-[12px] ${settledEvidence.state === "verified" ? "text-[var(--color-ink-muted)]" : "text-[var(--color-warning)]"}`}>{settledEvidenceExplanation(detail)}</p>}
                      <p className="border-t border-[var(--color-border)] pt-2 text-[12px] text-[var(--color-warning)]">ARC TESTNET · Testnet payment destination · testnet execution does not discharge the real-world payable.</p>
                      {exceptionRecoveryCard}
                      {stageCompletionReceiptView}
                      <details className="rounded border border-[var(--color-border)] px-3 py-2">
                        <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">View reconciliation evidence</summary>
                        <dl className="border-t border-[var(--color-border)] pt-3">
                          <Field label="Settlement status record" value={providerState} />
                          <Field label="Recorded payment status" value={detail.execution?.status ?? "No execution record"} />
                          <Field label="Settlement record classification" value={detail.execution?.status === "SETTLED" ? settledEvidenceSummary(detail) : result} />
                          {settledEvidence && <p role="note" className="text-[12px] text-[var(--color-ink-muted)]">{settledEvidenceExplanation(detail)}</p>}
                        </dl>
                      </details>
                    </section>
                  );
                })() : (
                  <div className="space-y-3">
                    <h3 ref={stageHeadingRef} tabIndex={-1} aria-describedby={stageDescriptionId} className="sr-only">Reconciliation</h3>
                    <p className="text-[13px] font-semibold text-[var(--color-ink)]">{reconciliationLeadLine(detailState, detail?.execution, Boolean(detail?.settlement_proxy), detail ? sourcePayableState(detail) : "OUTSTANDING")}</p>
                    {exceptionRecoveryCard}
                    {stageCompletionReceiptView}
                  </div>
                )}
              </div>
            )}

          </div>

          {!isInitialObligationScreen && detailState === "loaded" && detail && <section aria-label="Current control status" className="rounded-lg border border-[var(--color-border)] px-3 py-2">
            <h3 className="text-xs font-semibold">Current controls</h3>
            <dl className="mt-2 grid grid-cols-2 gap-3 text-xs lg:grid-cols-4">
              <div><dt className="text-[var(--color-ink-muted)]">Assessment</dt><dd className="mt-1 font-semibold">{assessmentRequestUnresolved ? "Outcome unverified" : hasCurrentAssessment && currentAssessment ? `${currentAssessment.decision} · advisory` : currentAssessment ? "Needs refresh" : "Not recorded"}</dd></div>
              <div><dt className="text-[var(--color-ink-muted)]">Authorization</dt><dd className="mt-1 font-semibold">{detail.aggregate.state === "AUTHORIZED" ? "Recorded · release checks separate" : "Not recorded"}</dd></div>
              <div><dt className="text-[var(--color-ink-muted)]">Assurance evidence</dt><dd className="mt-1 font-semibold">{detail.assurance_evidence?.state === "AVAILABLE_CURRENT_BINDING" ? "Recorded · current binding" : detail.assurance_evidence?.state === "AVAILABLE_HISTORICAL" ? "Historical record" : detail.assurance_evidence?.state === "NOT_CREATED" ? "Not recorded" : detail.assurance_evidence?.state === "INVALID" ? "Invalid" : "Not verified"}</dd></div>
              <div><dt className="text-[var(--color-ink-muted)]">Payment record</dt><dd className="mt-1 font-semibold">{unresolvedSubmission ? "Outcome unverified" : !detail.execution ? "Not submitted in Tameion" : detail.execution.status === "SETTLED" ? settledEvidenceSummary(detail) : businessTitle(detail.execution.status)}</dd></div>
            </dl>
          </section>}

          {!isInitialObligationScreen && detailState === "loaded" && detail && (
            <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <summary className="min-h-11 cursor-pointer py-2 text-[13px] font-semibold text-[var(--color-ink)]" title={`Transaction ledger · Payment activity · ${activityItems.length ? `${activityItems.length} records · latest: ${activityItems.at(-1)?.label}` : "no dated activity · current position available on open"}`}>
                <span className="inline-block w-[calc(100%-1.5rem)] truncate align-top">Transaction ledger · Payment activity · {activityItems.length ? `${activityItems.length} records · latest: ${activityItems.at(-1)?.label}` : "no dated activity · current position available on open"}</span>
              </summary>
              <section aria-label="Payment activity and records" className="space-y-4 border-t border-[var(--color-border)] pt-3">
                <div>
                  <h4 className="text-[12px] font-semibold text-[var(--color-ink)]">Recorded payment history</h4>
                  {activityItems.length ? (
                    <ol className="mt-2 space-y-2">
                      {activityItems.map((item, index) => (
                        <li key={`${item.occurredAt}-${item.label}-${index}`} className="border-s-2 border-[var(--color-border-strong)] ps-3">
                          <p className="text-[12px] font-semibold text-[var(--color-ink)]">{item.label}</p>
                          <time dateTime={item.occurredAt} className="text-[11px] text-[var(--color-ink-muted)]">{item.occurredAt} · stored time</time>
                          <p className="text-[12px] text-[var(--color-ink-muted)]">{item.result}</p>
                        </li>
                      ))}
                    </ol>
                  ) : <p className="mt-2 text-[12px] text-[var(--color-ink-muted)]">No timestamped durable evidence is available in this detail.</p>}
                </div>
                <div>
                  <h4 className="text-[12px] font-semibold text-[var(--color-ink)]">Current state · not an event history</h4>
                  <ul className="mt-2 space-y-1 text-[12px] text-[var(--color-ink-muted)]">
                    <li>{assessmentCurrentState}</li>
                    <li>Current authorization state: {authorizationCurrentState}</li>
                    <li>{paeCurrentState}</li>
                    <li>{executionCurrentState}</li>
                    <li>Source payable: {sourcePayableState(detail)} · unchanged by Arc Testnet activity.</li>
                  </ul>
                </div>
                {currentAuthorityGuidance(detail) && (
                  <p className="border-s-2 border-[var(--color-warning)] ps-3 text-[12px] text-[var(--color-warning)]">{currentAuthorityGuidance(detail)}</p>
                )}
              </section>
            </details>
          )}

          {!isInitialObligationScreen && detail && (
            <details className="rounded border border-[var(--color-border)] px-3 py-2">
              <summary className="min-h-11 cursor-pointer py-2 text-[13px] font-semibold text-[var(--color-ink)]">Control and audit records</summary>
              <div className="space-y-2 border-t border-[var(--color-border)] pt-3 text-[12px]">
                {(detail.current_assessment || currentResult?.label === "assess") && (
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Payment review record</summary>
                  <div className="space-y-2 pt-2">
                    {detail.current_assessment ? <>
                      <p className="font-semibold">{assessmentRequestUnresolved ? "Recorded assessment · latest request unresolved" : hasCurrentAssessment ? "Current recorded assessment" : "Historical assessment"}</p>
                      <dl>
                        <Field label="Review reference" value={detail.current_assessment.assessment_id} />
                        <Field label="Review fingerprint" value={detail.current_assessment.assessment_hash} />
                        <Field label="Obligation version" value={detail.current_assessment.aggregate_version} />
                      <Field label="Assessment source" value={detail.current_assessment.provider_mode ?? "Not available"} />
                      </dl>
                      <ul className="list-disc ps-5">{detail.current_assessment.reasons.map((reason, index) => <li key={index}>{financeFacingAssessmentText(reason)}</li>)}</ul>
                      {detail.current_assessment.race && <AssessmentTraceView race={detail.current_assessment.race} />}
                      {currentAssessment?.provider_truth && <ProviderTruthRow truth={currentAssessment.provider_truth} />}
                      {currentAssessment && <EvidenceAndRuntimeDetail assessment={currentAssessment} />}
                    </> : <p>No current assessment artifact is present in this detail.</p>}
                    {currentResult?.label === "assess" && <EvidencePanel value={currentResult.data} />}
                  </div>
                </details>
                )}
                {detail.aggregate.state === "AUTHORIZED" && (
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Approval record</summary>
                  <dl className="pt-2">
                    <Field label="Authorization state" value={detail.truth.tameion_control_truth.aggregate_state} />
                    <Field label="Release authority" value={detail.truth.tameion_control_truth.execution_release_authority} />
                    <Field label="Approval record details" value="Not included in the current obligation detail response." />
                    <Field label="Approval timestamp / actor" value="Not available in the current detail; no event is inferred." />
                  </dl>
                </details>
                )}
                {detail.assurance_evidence && detail.assurance_evidence.state !== "NOT_CREATED" && (
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Payment control record</summary>
                  <div className="space-y-2 pt-2">
                    <p role="status" className="text-[12px] text-[var(--color-ink-muted)]">{detail.assurance_evidence?.message ?? "Assurance evidence is expected but unavailable."}</p>
                    {detail.assurance_evidence && (detail.assurance_evidence.state === "AVAILABLE_CURRENT_BINDING" || detail.assurance_evidence.state === "AVAILABLE_HISTORICAL") && <>
                      <dl>
                        <Field label="Assurance record" value={detail.assurance_evidence.assurance_id} />
                        <Field label="Recorded at" value={detail.assurance_evidence.recorded_at} />
                        <Field label="Recorded obligation version" value={detail.assurance_evidence.aggregate_version} />
                        <Field label="Recorded policy" value={detail.assurance_evidence.policy_version} />
                      </dl>
                      <SafetyKernelBreakdown overall={detail.assurance_evidence.overall} controlResults={detail.assurance_evidence.control_results} />
                    </>}
                  </div>
                </details>
                )}
                {(detail.pae_sealed || detail.sealed_pae_instruction_hash || detail.execution_packet) && (
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Authorized payment instruction</summary>
                  <dl className="pt-2">
                    <Field label="Sealed instruction" value={detail.pae_sealed ? "Present" : "Not present"} />
                    <Field label="Instruction hash" value={detail.sealed_pae_instruction_hash ?? "Not available"} />
                    <Field label="Payment release control" value={detail.execution_gate ?? "Not available"} />
                    {detail.execution_packet?.packet_sha256 && <Field label="Payment instruction fingerprint" value={detail.execution_packet.packet_sha256} />}
                  </dl>
                </details>
                )}
                {(detail.execution || detail.settlement_proxy) && (
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Payment processing</summary>
                  <dl className="pt-2">
                    <Field label="Payment status" value={detail.execution?.status ?? "No Tameion payment record"} />
                    <Field label="Settlement-network reference" value={detail.execution?.provider_ref ?? "Not recorded"} />
                    <Field label="Duplicate-payment protection reference" value={detail.execution?.idempotency_key ?? "Not available"} />
                    <Field label="Source wallet reference" value={detail.aggregate.source_wallet_ref} />
                    <Field label="Destination address" value={detail.execution?.destination_address ?? detail.aggregate.destination_address} />
                    <Field label="Settlement-network status" value={detail.execution?.provider_evidence?.status ?? "Not available"} />
                  </dl>
                </details>
                )}
                {(detail.execution?.provider_evidence || detail.truth.settlement_truth.status !== "NOT_SUBMITTED") && (
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Settlement and reconciliation record</summary>
                  <div className="space-y-2 pt-2">
                    <dl>
                      <Field label="Recorded settlement status" value={detail.truth.settlement_truth.status} />
                      <Field label="Settlement verification" value={detail.execution?.status === "SETTLED" ? settledEvidenceSummary(detail) : "No completed-settlement verification applies"} />
                      {detail.execution?.status === "SETTLED" && <p role="note" className="text-[12px] text-[var(--color-ink-muted)]">{settledEvidenceExplanation(detail)}</p>}
                      <Field label="Settlement confirmed at" value={detail.execution?.provider_evidence?.reconciled_at ?? "Not recorded"} />
                      <Field label="Settlement-network status" value={detail.execution?.provider_evidence?.status ?? "Not available"} />
                    </dl>
                    <EvidencePanel value={detail.execution?.provider_evidence ?? detail.truth.settlement_truth} />
                  </div>
                </details>
                )}
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">Source and current payment records</summary>
                <dl className="mt-2">
                  <Field label="Source amount" value={`${detail.record.amount} ${detail.record.currency}`} />
                  <Field label="Source record / reference" value={String(detail.truth.source_truth.source.record_id || "Not captured")} />
                  <Field label="Beneficiary captured in source" value={sourceText(detail.record, "beneficiary_name")} />
                  <Field label="Source reference / invoice" value={sourceText(detail.record, "invoice_reference")} />
                  <Field label="Particulars / service period" value={sourceText(detail.record, "particulars")} />
                  <Field label="Source issue/invoice date" value={sourceText(detail.record, "issue_date")} />
                  <Field label="Raw source due date" value={sourceText(detail.record, "due_date")} />
                  <Field label="Effective due date / basis / authority" value={currentAssessment?.race
                    ? buildAssessmentTrace(currentAssessment.race).find((step) => step.step === "SUPPLIED_FACTS")?.items
                      .filter((item) => item.startsWith("Effective due date:") || item.startsWith("Effective date basis:") || item.startsWith("Effective date authority:"))
                      .join(" · ").replace("authorized operator attestation", "authorized user attestation") ?? "Not captured"
                    : `${sourceText(detail.record, "effective_due_date")} · ${sourceText(detail.record, "effective_due_date_basis")} · ${sourceDateProvenance(detail.record)}`} />
                  <Field label="Assessment as of" value={currentAssessment?.race?.evidence.authoritative_facts.as_of_date ?? "Not captured"} />
                  <Field label="Source document references" value={currentAssessment?.race?.evidence.evidence_ids.join(", ") || "Not captured"} />
                  <Field
                    label={detail.pae_sealed ? "Settlement amount in authorized intent" : "Indicative settlement equivalent"}
                    value={settlementDisplay(
                      { currency: detail.record.currency, amount: detail.record.amount },
                      detail.aggregate ? { amount: detail.aggregate.amount, asset: detail.aggregate.asset } : undefined,
                      detail.pae_sealed,
                    )}
                  />
                  <Field label="AI assessment" value={hasCurrentAssessment && currentAssessment ? `${currentAssessment.decision} — sealed advisory result` : "Not run"} />
                  <Field label="Payment intent" value={detail.pae_sealed ? "Sealed intent exists; human authorization retained" : "No payment intent created"} />
                  <Field
                    label="Payee destination verification"
                    value={simulatedTrustFixture
                      ? "Not established for this genuine obligation"
                      : `${judgeReadableState(detail.aggregate.destination_verification_status)} · ${judgeReadableState(detail.aggregate.destination_operational_status)}`}
                  />
                  <Field label="Payment release authority" value={judgeReadableState(detail.truth.tameion_control_truth.execution_release_authority)} />
                </dl>
                {(detail.pae_sealed || (hasCurrentPayAssessment && routeAssuranceReady)) && (
                  <section aria-label="Exact payment intent summary" className="space-y-1 rounded border border-[var(--color-border)] p-3">
                    <h3 className="text-[12px] font-semibold">{detail.pae_sealed ? "Exact sealed intent summary" : "Exact current intent summary — before authorization"}</h3>
                    <dl>
                      <Field label="Source amount" value={`${detail.record.amount} ${detail.record.currency}`} />
                      <Field label="Settlement amount / asset / network" value={`${detail.aggregate.amount} ${detail.aggregate.asset} · ${detail.aggregate.network}`} />
                      <Field label="FX rate" value={detail.truth.settlement_truth.settlement_conversion_rate ?? "No FX rate recorded"} />
                      <Field label="Arc Testnet proxy recipient" value={`${detail.aggregate.counterparty_id ?? "Unavailable"} · ${detail.aggregate.destination_address}`} />
                      <Field label="Source vendor destination reference" value={sourceText(detail.record, "source_destination_reference_token")} />
                      <Field label="Source reference" value={String(detail.truth.source_truth.source.record_id || "Not captured")} />
                      <Field label="Assessment" value={currentAssessment ? `${currentAssessment.decision} · ${currentAssessment.assessment_id} · ${currentAssessment.assessment_hash}` : "Not captured"} />
                      <Field label="Controls and approval" value={detail.pae_sealed ? judgeReadableState(detail.truth.tameion_control_truth.execution_release_authority) : "Pending payment-control review and human approval"} />
                      <Field label="Fee / total debit cap" value={detail.settlement_proxy
                        ? `${detail.settlement_proxy.preflight.max_network_fee} / ${detail.settlement_proxy.preflight.max_total_debit} USDC`
                        : "Settlement checks not prepared"} />
                    </dl>
                  </section>
                )}
                </details>
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Business obligation and payment records</summary>
                  <section aria-label="Payment authority boundary" className="mt-2 grid gap-3 md:grid-cols-3">
                    <article className="min-w-0 space-y-1 border-s-2 border-[var(--color-border)] ps-3" data-testid="source-truth">
                      <h4 className="font-semibold">Business obligation record</h4>
                      <p>{detail.truth.source_truth.role}</p>
                      <p className="mono break-words">{detail.truth.source_truth.source.source_kind} · {detail.truth.source_truth.source.source_system_id}</p>
                      <p>Record {detail.truth.source_truth.source.record_id} · state {detail.truth.source_truth.obligation_state}</p>
                      <p>Source approval {detail.truth.source_truth.source.approval_state} · execution authority {detail.truth.source_truth.source.execution_authority}</p>
                    </article>
                    <article className="min-w-0 space-y-1 border-s-2 border-[var(--color-ink)] ps-3" data-testid="tameion-control-truth">
                      <h4 className="font-semibold">Approval and control record</h4>
                      <p>{detail.truth.tameion_control_truth.role}</p>
                      <p>Aggregate {detail.truth.tameion_control_truth.aggregate_state} · v{detail.truth.tameion_control_truth.aggregate_version}</p>
                      <p>Review {detail.truth.tameion_control_truth.assessment_state} · payment instruction {detail.truth.tameion_control_truth.pae_state}</p>
                      <p>Release authority {detail.truth.tameion_control_truth.execution_release_authority}</p>
                    </article>
                    <article className="min-w-0 space-y-1 border-s-2 border-[var(--color-warning)] ps-3" data-testid="settlement-truth">
                      <h4 className="font-semibold">Settlement record</h4>
                      <p>{detail.truth.settlement_truth.provider_target} · {detail.truth.settlement_truth.network}</p>
                      <p>Settlement mode {detail.truth.settlement_truth.runtime} · status {detail.truth.settlement_truth.status}</p>
                      <p className="mono break-all">Settlement reference {detail.truth.settlement_truth.provider_ref ?? "None"}</p>
                    </article>
                  </section>
                </details>
              </div>
            </details>
          )}
        </section>
      </div>
      )}

      {!dashboardVisible && <section ref={actionStripRef} role="region" aria-label="Current payable action" className="obligation-action-strip fixed inset-x-0 bottom-0 z-20 border-t-2 border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 shadow-lg">
        <div className="mx-auto flex max-w-[1392px] flex-nowrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{selectedId || "No payable selected"}{selected ? ` · ${detailState === "loaded" && detail && sourceText(detail.record, "beneficiary_name") !== "Not captured" ? sourceText(detail.record, "beneficiary_name") : "Supplier not recorded"} · ${businessAmount(detailState === "loaded" && detail ? detail.record.amount : selected.amount)} ${detailState === "loaded" && detail ? detail.record.currency : selected.currency}` : ""}</p>
          </div>
          {contextualAction && <PrimaryButton ariaLabel={contextualAction.label} busy={busy || checkingPayableList || checkingExactAssessment} disabled={busy || checkingPayableList || checkingExactAssessment || (contextualAction.exactConfirmation && ((!exactPacketSubmissionReady && !currentPacketNeedsRelease) || !executionConfirmation.isBound || !executionConfirmation.matchesExact))} danger={contextualAction.exactConfirmation} onClick={contextualAction.run}>{checkingExactAssessment?'Checking assessment request…':checkingPayableList?'Refreshing payable list…':busy&&activeActionLabel==='assess'?'Assessing obligation…':busy&&activeActionLabel==='release'?'Recording approval…':busy&&activeActionLabel==='execute'?'Submitting payment…':contextualAction.label}</PrimaryButton>}
        </div>
        {currentPayableListCheck && <p role="status" aria-label="Payable list check" className="payable-list-check mx-auto mt-1 max-w-[1392px] text-[12px] text-[var(--color-ink-muted)]">
          {currentPayableListCheck.status === "checking" ? "Checking payable list…" : currentPayableListCheck.status === "checked" ? "Payable list checked." : currentPayableListCheck.status === "identity-unavailable" ? "Request identity could not be read. Reload when storage is available." : "Payable list could not be checked."}
          {" "}Assessment outcome remains unverified.
        </p>}
        {currentHoldReview&&viewedStage==="Assessment"&&<p role="status" aria-label="HOLD findings review" aria-live="polite" className="mx-auto mt-1 max-w-[1392px] text-[12px] text-[var(--color-ink-muted)]">{currentHoldReview.status==="opened"?"HOLD findings opened. Review the required evidence and responsible owner. HOLD remains.":currentHoldReview.status==="unavailable"?"HOLD — details unavailable. Ask the workspace owner to review the recorded findings. Authorization and payment remain blocked.":"Opening HOLD findings…"}</p>}
        {currentExactAssessmentCheck&&<p role="status" aria-label="Assessment request check" className="mx-auto mt-1 max-w-[1392px] text-[12px] text-[var(--color-ink-muted)]">{currentExactAssessmentCheck.message}{currentExactAssessmentCheck.status!=="checking"&&currentExactAssessmentCheck.status!=="confirmed"?" Ask the workspace owner to review the original request. Do not submit another assessment.":""}</p>}
      </section>}
    </main>
  );
}
