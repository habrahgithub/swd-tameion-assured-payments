"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RaceAssessment } from "../src/agent/schema";
import type { PaymentTruthLayers } from "../src/domain/payment-control-boundary";
import {
  assessmentReviewSnapshot,
  currentReviewedAssessment,
  type AssessmentReviewSnapshot,
  type ProviderRuntimeTruth,
} from "../src/client/assessment-review-snapshot";
import { assessmentKeyDisposition, assessmentReceiptSnapshot, interpretPostResponse, isCurrentGeneration, isCurrentRequest, isSameIdentity, parseJsonBody } from "../src/client/command-center-requests";
import { assessmentNextAction, buildAssessmentTrace, hasExpectedObligationIdentity, hasSimulatedTrustFixture, judgeReadableState, settlementDisplay } from "../src/client/command-center-state";
import {
  buildHoldEscalateReport,
  buildHoldEscalateSummary,
  type HoldEscalateReportInput,
  type HoldEscalateReportLine,
  type HoldEscalateSummary,
  reportDecisionLabel,
} from "../src/client/hold-escalate-report";

interface ObligationSummary {
  obligation_id: string;
  service_category: string;
  amount: string;
  currency: "AED" | "USD";
  recurrence: string;
  due_date: string | null;
  commercial_terms: string;
  assessed: boolean;
  decision: string | null;
  provider_mode: "LIVE_AI" | "NOT_LIVE_AI" | "BLOCKED_EXTERNAL" | null;
  route_assurance_status?: "Route assurance ready" | "Route assurance not ready";
}

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
  execution: { status: string; provider_ref: string | null } | null;
  settlement_proxy?: {
    source_aggregate_version: number;
    mapped_aggregate_version: number;
    preflight: {
      profile: string;
      organization_id: string;
      obligation_id: string;
      source_amount: string;
      source_currency: string;
      amount: string;
      asset: string;
      network: string;
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
  sealed_pae_instruction_hash?: string | null;
  execution_gate?: string;
  execution_kill_switched: boolean;
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

function sourcePayableState(detail: ObligationDetail): string {
  const state = detail.source_payable_state ?? detail.truth.source_truth.obligation_state;
  return typeof state === "string" && state.trim() ? state : "Not reported";
}

function sourceDateProvenance(record: Record<string, unknown>): string {
  const value = record.effective_due_date_provenance;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Not captured";
  const provenance = value as Record<string, unknown>;
  if (provenance.provenance_class === "SOURCE_INVOICE_DATE" && typeof provenance.evidence_id === "string") {
    return `Source invoice date · evidence ${provenance.evidence_id}`;
  }
  if (provenance.provenance_class === "AUTHORIZED_OPERATOR_ATTESTATION" && typeof provenance.authority_reference === "string") {
    return `Authorized operator attestation · ${provenance.authority_reference}`;
  }
  return "Not captured";
}

type PanelKey = "obligations" | "assessment" | "authorization" | "assurance" | "reconciliation" | "report";
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
  if (presentation === "loading") return "Genuine obligations are loading — assessment coverage is not yet known.";
  if (presentation === "error") return "Genuine obligations are unavailable — assessment coverage cannot be determined.";
  if (presentation === "empty") return "No genuine obligations are currently available to assess.";
  return `${assessedCount}/${total} obligations assessed`;
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
  return `Authorization is refused for every obligation until all ${total} have been assessed.`;
}

export type KillSwitchPresentation = "no-selection" | "inactive" | "engaged";

/** An inactive kill switch is one control fact only. It never grants release:
 * payment authority remains separately NOT_GRANTED until human authorization,
 * assessment and the Safety Kernel complete. */
export type DetailState = "none" | "loading" | "failed" | "loaded" | "stale";

export type AssessmentPrimaryAction = "none" | "assess" | "review" | "continue";

export function authorizationPanelCopy(state: DetailState, hasSelection: boolean, paeSealed = false, hasSettlementProxy = false, authorizationRecordedBlocked = false): string {
  if (!hasSelection || state === "none") return "Select an obligation to review its authorization and payment-intent status.";
  if (state === "loading") return "Loading current obligation detail; authorization status is not yet available.";
  if (state === "failed") return "Selected obligation detail is unavailable; authorization and payment-intent status cannot be confirmed.";
  if (state === "stale") return "Last-known obligation detail is stale; refresh before relying on authorization or payment-intent status.";
  if (authorizationRecordedBlocked) return "Authorization was recorded, but assurance failed or is blocked. No PASS assurance, usable PAE, or execution is available; reassessment and further authorization are unavailable here.";
  if (paeSealed && hasSettlementProxy) return "Approved instruction is sealed for the Arc Testnet settlement proxy. Execution remains subject to the exact-packet gate and final pre-send checks.";
  if (paeSealed) return "An authorization envelope is already sealed for this obligation. No further authorization action is available here; provider submission remains separate.";
  return "Current detail confirms no payment intent exists. If every deterministic Safety Kernel control passes, the system can seal a signed Payment Authorization Envelope; no provider submission occurs here.";
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
}): AssessmentPrimaryAction {
  if (state.detailState !== "loaded" || !state.hasSelection || state.paeSealed) return "none";
  if (state.authorizationRecordedBlocked) return "none";
  if (!state.hasCurrentAssessment) return "assess";
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
  if (presentation === "no-selection") return "No obligation selected";
  if (presentation === "loading") return "Kill switch: selected obligation detail loading — not verified";
  if (presentation === "failed") return "Kill switch: selected obligation detail unavailable — not verified";
  if (presentation === "stale") return "Kill switch: selected obligation detail is stale — retry before relying on it";
  if (presentation === "unknown") return "Kill switch state unknown — not verified";
  if (presentation === "engaged") return "Execution disabled";
  return "Kill switch inactive — does not grant release";
}

export function lifecycleStopLabel(args: { presentation: ObligationListPresentation; total: number; assessed: number; pay: number }): string {
  if (args.presentation === "loading") return "Genuine obligations are loading — lifecycle not yet known.";
  if (args.presentation === "error") return "Genuine obligations are unavailable — lifecycle cannot be determined.";
  if (args.presentation === "empty") return "No genuine obligations — nothing to assess or authorize.";
  if (args.assessed < args.total) return `STOP — ${args.assessed} of ${args.total} assessed. Authorization is blocked until all are assessed.`;
  if (args.pay > 0) return `Assessed — ${args.pay} PAY recommendation(s); advisory, still requires human authorization.`;
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
  if (!hasSelection) return "no obligation selected";
  if (aggregateVersion === undefined) return "loading";
  return String(aggregateVersion);
}

/** When the genuine list is unavailable or still loading, the HOLD/ESCALATE
 * operational-report summary must say so instead of rendering an all-zero
 * table that looks like a verified, reportable empty state. */
export function reportSummaryUnavailableReason(presentation: ObligationListPresentation): string | null {
  if (presentation === "error") return "Genuine obligations are unavailable — this operational report cannot be produced.";
  if (presentation === "loading") return "Genuine obligations are loading — this operational report is not yet available.";
  return null;
}

export function queueCompletionLabel(summary: HoldEscalateSummary): string {
  if (summary.unassessed > 0) {
    return `Incomplete assessment — ${summary.total - summary.unassessed} of ${summary.total} assessed. No candidate determination yet.`;
  }
  if (summary.pay > 0) {
    return `Assessment complete — ${summary.pay} PAY recommendation${summary.pay === 1 ? "" : "s"} (advisory; still requires separate assurance and human authorization).`;
  }
  return "Assessment complete — no PAY candidate; all obligations assessed as HOLD or ESCALATE.";
}

/** A queue snapshot is reportable only after the obligations request resolves.
 * Empty and unavailable states must not inherit the empty array's all-zero
 * summary as if it were a completed assessment batch. */
export function operationalReportSummaryLabel(
  presentation: ObligationListPresentation,
  summary: HoldEscalateSummary,
): string {
  if (presentation === "loading") return "Genuine obligations are loading — operational report summary is not yet available.";
  if (presentation === "error") return "Genuine obligations are unavailable — operational report summary cannot be determined.";
  if (presentation === "empty") return "No genuine obligations — nothing to report.";
  return queueCompletionLabel(summary);
}

/** Keep selection state separate from detail-fetch state in the report panel. */
export function operationalReportDetailPrompt(state: DetailState): string {
  if (state === "loading") return "Selected obligation detail is loading — its operational report is not yet available.";
  if (state === "failed") return "Selected obligation detail is unavailable — its operational report cannot be produced.";
  if (state === "stale") return "Selected obligation detail is stale — retry to produce a current operational report.";
  return "Select an obligation to view its HOLD/ESCALATE operational report.";
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
  if (!state.hasSelection) blockers.push("Select an obligation.");
  if (!state.allAssessed) blockers.push("Assess all obligations (AUT-012 requires every obligation assessed).");
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
  if (state.killSwitchEngaged) blockers.push("Kill switch engaged — execution is disabled for this obligation.");
  return blockers;
}

export function reconciliationLeadLine(state: DetailState, execution: unknown, hasSettlementProxy = false, sourceState = "OUTSTANDING"): string {
  if (state === "stale") return "Last-known submission state is stale — refresh before relying on it.";
  if (state !== "loaded") return "Submission state unknown — authoritative detail is not loaded.";
  if (execution === null) return "No Arc settlement to reconcile.";
  if (execution && typeof execution === "object" && typeof (execution as { status?: unknown }).status === "string") {
    const record = execution as { status: string; provider_ref?: unknown; provider_evidence?: unknown };
    const status = record.status;
    if (hasSettlementProxy && status === "SETTLED") return `TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION · source payable remains ${sourceState}.`;
    if (hasSettlementProxy && (status === "UNKNOWN" || status === "SUBMITTING")) return "TESTNET outcome is UNKNOWN — perform read-only reconciliation for this same intent; resubmission is blocked.";
    if (hasSettlementProxy && status === "FAILED") return `Arc Testnet provider attempt failed; source payable remains ${sourceState}.`;
    if (hasSettlementProxy && status === "BLOCKED" && !record.provider_ref && !record.provider_evidence) return `Arc Testnet execution was blocked before provider submission; source payable remains ${sourceState}.`;
    if (hasSettlementProxy && status === "BLOCKED") return `Arc Testnet execution is blocked with provider evidence present; outcome requires review. Source payable remains ${sourceState}.`;
    if (hasSettlementProxy) return `Arc Testnet proxy execution ${status}; source payable remains ${sourceState}.`;
    return `Simulated execution ${status}; no Arc settlement to reconcile.`;
  }
  return "Submission state unknown — authoritative execution field is absent.";
}

export function queueHeaderLabel(presentation: ObligationListPresentation, summary: HoldEscalateSummary): string {
  if (presentation === "loading") return "Loading genuine queue — completion is not yet known.";
  if (presentation === "error") return "Genuine queue unavailable — completion cannot be determined.";
  if (presentation === "empty") return "No genuine obligations are in the queue.";
  return queueCompletionLabel(summary);
}

const PANELS: Array<{ key: PanelKey; label: string }> = [
  { key: "obligations", label: "Obligations" },
  { key: "assessment", label: "Assessment" },
  { key: "authorization", label: "Authorization" },
  { key: "assurance", label: "Assurance & Execution" },
  { key: "reconciliation", label: "Reconciliation & Evidence" },
  { key: "report", label: "Operational Report (secondary)" },
];

const PAYMENT_LIFECYCLE_STAGES = [
  "Obligation",
  "Assessment",
  "Authorization",
  "Assurance",
  "Payment",
  "Reconciliation",
] as const;

const SAMPLE_PLAYBACK_IDENTITY = {
  organizationId: "ORG-SAMPLE-PLAYBACK-001",
  obligationId: "DEMO-SAMPLE-OBLIGATION-001",
} as const;

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

  if (execution?.status === "SETTLED" && aggregate.state === "RECONCILED") {
    if (detail.truth.settlement_truth.runtime === "SIMULATED") {
      return { label: "Simulated record — no Arc settlement", tone: "neutral", explanation: "The stored execution result used a simulated adapter and does not represent a vendor payment." };
    }
    return { label: "Reconciled", tone: "success", explanation: "Settlement matches the authorized obligation exactly." };
  }
  if (execution?.status === "UNKNOWN") {
    return {
      label: "Provider response unknown",
      tone: "warning",
      explanation: "Awaiting provider/chain truth. The system will not blind-retry submission.",
    };
  }
  if (execution?.status === "FAILED") {
    return { label: "Execution failed", tone: "danger", explanation: "Provider confirmed the attempt failed." };
  }
  if (releaseAuthority === "BLOCKED" || releaseAuthority === "REVOKED") {
    return {
      label: "Blocked",
      tone: "danger",
      explanation: "Execution authority is no longer usable. Review the control and evidence state before any new attempt.",
    };
  }
  if (releaseAuthority === "EXPIRED") {
    return { label: "PAE expired", tone: "warning", explanation: "The sealed payment authority expired and cannot be submitted." };
  }
  if (releaseAuthority === "SUBMITTED_TO_PROVIDER") {
    return { label: "Submitted to provider", tone: "info", explanation: "Provider/chain settlement truth is pending or being reconciled." };
  }
  if (releaseAuthority === "IN_DOUBT_PROVIDER_SUBMISSION") {
    return { label: "Submission state in doubt", tone: "warning", explanation: "The provider may have received the request. Tameion will reconcile provider truth and will not blind-retry." };
  }
  if (releaseAuthority === "RESERVED_FOR_EXECUTION") {
    return { label: "Execution reserved", tone: "info", explanation: "The PAE has been claimed for one idempotent execution attempt." };
  }
  if (releaseAuthority === "SUSPENDED_KILL_SWITCH") {
    return { label: "Execution suspended", tone: "warning", explanation: "A kill switch prevents release of the currently sealed PAE." };
  }
  if (releaseAuthority === "TAMEION_PAE_REVERIFY_REQUIRED") {
    return {
      label: "Authorized — PAE sealed",
      tone: "success",
      explanation: "Human authorization and assurance are sealed; the Execution Worker must still re-verify current state before submission.",
    };
  }
  if (releaseAuthority === "CONSUMED") {
    return { label: "PAE consumed", tone: "neutral", explanation: "This payment authority has already been consumed and cannot be reused." };
  }
  if (aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !execution) {
    return {
      label: "Authorization recorded · Assurance failed/blocked",
      tone: "warning",
      explanation: "No PASS assurance, usable PAE, or execution is available. Reassessment and further authorization are unavailable in this state.",
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
        ? "PAY recommended — assurance not ready; authorization locked"
        : pendingPrerequisiteLabel(decision),
      tone: decision === "HOLD" || decision === "ESCALATE" || payNeedsAssurance ? "warning" : decision === "PAY" ? "info" : "neutral",
      explanation: decision === "HOLD"
        ? "Resolve the HOLD findings before reassessing. Human authorization is locked."
        : decision === "ESCALATE"
          ? "Escalate the findings for human review. Human authorization is locked."
          : decision === "PAY"
            ? payNeedsAssurance
              ? "The current PAY recommendation is advisory. Payment-route assurance is not ready; human authorization remains locked. No execution authority is granted."
              : "The current PAY recommendation is advisory. Review it before authorization; no execution authority is granted."
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
  if (decision === "ESCALATE") return "danger";
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
    <div className="flex items-center gap-2">
      <RuntimeBadge mode={truth.provider_mode} />
      <span className="text-[11px] text-[var(--color-ink-muted)]">
        {truth.provider_used} · advisory only, non-authoritative
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
      <summary className="cursor-pointer select-none text-[var(--color-ink-muted)]">Evidence &amp; runtime detail</summary>
      <div className="mt-2 space-y-1">
        <Field label="Assessment ID" value={assessment.assessment_id} />
        <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border)] py-1.5">
          <dt className="text-[13px] text-[var(--color-ink-muted)]">Assessment hash</dt>
          <dd className="mono text-[13px] font-medium break-all text-[var(--color-ink)]">{assessment.assessment_hash}</dd>
        </div>
        <Field label="Aggregate version" value={assessment.aggregate_version} />
        {providerTruth?.model_id && <Field label="Model" value={providerTruth.model_id} />}
        {providerTruth?.model_config_version && <Field label="Config version" value={providerTruth.model_config_version} />}
        {providerTruth?.runtime_config_sha256 && <Field label="Runtime config" value={providerTruth.runtime_config_sha256} />}
        {race?.evidence.evidence_ids.length ? (
          <p className="text-[11px] text-[var(--color-ink-muted)]">Evidence IDs: {race.evidence.evidence_ids.join(", ")}</p>
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
      <summary className="cursor-pointer select-none text-[var(--color-ink-muted)]">
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
                {step.items.map((item, index) => <li key={index}>{item}</li>)}
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

/** Unified advisory assessment display — the dominant status for the
 * Assessment panel. Renders the Finance Agent's PAY/HOLD/ESCALATE proposal
 * with rationale, deterministic findings, catalog-derived remediation,
 * provider/runtime truth, and progressive disclosure for hash/evidence/
 * runtime detail. Always explicit about current vs superseded state. */
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
          {race.result.decision_summary}
        </p>
      )}

      {/* Reasons (application-owned summaries) */}
      <ul className="list-disc ps-5 text-[12px] text-[var(--color-ink-muted)]">
        {assessment.reasons.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>
      <p className="border-s-2 border-[var(--color-accent)] ps-2 text-[12px] font-medium text-[var(--color-ink)]">
        {assessmentNextAction(assessment.decision, allAssessed ?? false)}
      </p>

      {/* Deterministic findings — the application-owned blockers */}
      {findings.length > 0 && (
        <div className="space-y-1 border-s-[3px] border-s-[var(--color-warning)] ps-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            Deterministic findings ({findings.length})
          </p>
          <ul className="space-y-0.5">
            {findings.map((finding) => (
              <li key={finding.code} className="flex items-baseline justify-between gap-2">
                <span className="text-[12px]">{finding.code} — {finding.reason}</span>
                <span
                  className={`text-[11px] font-semibold ${
                    finding.severity === "ESCALATE" ? "text-[var(--status-blocked-text)]" : "text-[var(--status-hold-text)]"
                  }`}
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
              <p className="text-[12px]"><strong>{item.finding_code}:</strong> {item.reason}</p>
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

      {/* Provider/runtime truth — advisory-only */}
      <ProviderTruthRow truth={assessment.provider_truth} />

      {race && <AssessmentTraceView race={race} />}

      {/* Progressive disclosure for hash/evidence/runtime */}
      <EvidenceAndRuntimeDetail assessment={assessment} />

      {/* Stale state explanation */}
      {stale && (
        <p className="text-[12px] text-[var(--color-danger)]">
          This assessment is bound to aggregate v{assessment.aggregate_version}, which is no longer current.
          Review the current sealed assessment before authorization.
        </p>
      )}

      {action}
    </div>
  );
}

function PrimaryButton({
  onClick,
  disabled,
  children,
  danger,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
  danger?: boolean;
}) {
  return (
    <button
      data-primary-action="true"
      onClick={onClick}
      disabled={disabled}
      className={`w-fit rounded px-4 py-2 text-[13px] font-semibold tracking-wide text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "bg-[var(--color-danger)] hover:opacity-90" : "bg-[var(--color-ink)] hover:opacity-90"
      }`}
    >
      {children}
    </button>
  );
}

type ActionResult = { label: string; data: unknown; ok: boolean; status: number; obligationId: string | null };

function actionErrorMessage(data: unknown): string {
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  if (data && typeof data === "object" && "code" in data && typeof (data as { code: unknown }).code === "string") {
    return `The request did not succeed (${(data as { code: string }).code}).`;
  }
  return "The request did not succeed.";
}

function ActionResultBanner({ result }: { result: ActionResult }) {
  if (result.ok) return null;
  return (
    <div role="alert" aria-live="assertive" className="border-s-[3px] border-s-[var(--color-danger)] bg-[var(--color-surface)] px-3 py-2">
      <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-danger)]">
        Refused (HTTP {result.status})
      </p>
      <p className="mt-0.5 text-[13px] text-[var(--color-ink)]">{actionErrorMessage(result.data)}</p>
    </div>
  );
}

type ProviderMode = "LIVE_AI" | "NOT_LIVE_AI" | "BLOCKED_EXTERNAL";

const RUNTIME_BADGE: Record<ProviderMode, { label: string; textVar: string; surfaceVar: string; borderVar: string }> = {
  LIVE_AI: {
    label: "LIVE NVIDIA",
    textVar: "var(--status-pass-text)",
    surfaceVar: "var(--status-pass-surface)",
    borderVar: "var(--status-pass-border)",
  },
  NOT_LIVE_AI: {
    label: "DETERMINISTIC DEMO — NOT LIVE AI",
    textVar: "var(--status-advisory-text)",
    surfaceVar: "var(--status-advisory-surface)",
    borderVar: "var(--status-advisory-border)",
  },
  BLOCKED_EXTERNAL: {
    label: "BLOCKED_EXTERNAL — LIVE CALL FAILED",
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
      className="mono inline-flex w-fit items-center rounded px-2 py-0.5 text-[11px] font-semibold tracking-wide"
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
        Safety Kernel — {overall} ({controlResults.filter((c) => c.result === "PASS").length}/{controlResults.length} PASS)
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

function SimulatedDemoStages() {
  const identity = SAMPLE_PLAYBACK_IDENTITY;
  return (
    <div className="space-y-3 border-t border-[var(--color-border)] pt-3" data-testid="simulated-demo-result" role="region" aria-label="Read-only sample playback">
      <p className="text-[13px] font-semibold text-[var(--color-warning)]">
        Illustrative fixture only. No approval, assurance, provider call, or settlement is performed.
      </p>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <DemoStage title="Obligation" value="Sample obligation selected" />
        <DemoStage title="Assessment" value="PAY recommendation — illustrative and advisory" />
        <DemoStage title="Authorization" value="Not performed" />
        <DemoStage title="Assurance" value="Not run; no PAE is created" />
        <DemoStage title="Payment" value="Not submitted" />
        <DemoStage title="Reconciliation" value="Unavailable — no payment was submitted" />
      </ol>
      <section className="grid gap-3 border-t border-[var(--color-border)] pt-3 sm:grid-cols-2" aria-label="Illustrative same-intent branches">
        <div>
          <p className="text-[13px] font-semibold">Unchanged-destination sample branch</p>
          <p className="text-[12px] text-[var(--color-ink-muted)]">Same sample organization and obligation: <bdi dir="ltr" className="mono">{identity.organizationId}</bdi> · <bdi dir="ltr" className="mono">{identity.obligationId}</bdi>. No steps are executed.</p>
        </div>
        <div>
          <p className="text-[13px] font-semibold">Changed destination branch — expected BLOCK before provider submission</p>
          <p className="text-[12px] text-[var(--color-ink-muted)]">Same sample organization and obligation: <bdi dir="ltr" className="mono">{identity.organizationId}</bdi> · <bdi dir="ltr" className="mono">{identity.obligationId}</bdi>; destination differs from the sample intent. This fixture invokes no worker or provider and is not a live security test.</p>
        </div>
      </section>
      <details className="rounded border border-[var(--color-border)] px-3 py-2 text-[12px]">
        <summary className="cursor-pointer font-semibold text-[var(--color-ink-muted)]">Evidence &amp; technical details</summary>
        <p className="mt-2 border-t border-[var(--color-border)] pt-2 text-[12px] text-[var(--color-ink-muted)]">Deterministic sample fixture; zero network requests from playback. It does not prove readiness, selected-obligation execution, or live Arc settlement.</p>
      </details>
    </div>
  );
}

function DemoStage({ title, value }: { title: string; value: string }) {
  return (
    <li className="min-w-0 border-s-2 border-[var(--color-warning)] ps-2">
      <p className="text-[16px] font-semibold leading-5 text-[var(--color-ink)]">{title}</p>
      <p className="mt-1 break-words text-[13px] leading-5 text-[var(--color-ink-muted)]">{value}</p>
    </li>
  );
}

export function CommandCenter() {
  const [obligations, setObligations] = useState<ObligationSummary[]>([]);
  const [solePayCandidateId, setSolePayCandidateId] = useState<string | null>(null);
  const [obligationsStatus, setObligationsStatus] = useState<ObligationListStatus>("loading");
  const [obligationsError, setObligationsError] = useState<string | null>(null);
  const [samplePlaybackVisible, setSamplePlaybackVisible] = useState(false);
  const [mobileQueueOpen, setMobileQueueOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("");
  const [panel, setPanel] = useState<PanelKey>("obligations");
  const [detail, setDetail] = useState<ObligationDetail | null>(null);
  const [detailIsStale, setDetailIsStale] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const [displayedAssessment, setDisplayedAssessment] = useState<AssessmentReviewSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [executionConfirmation, setExecutionConfirmation] = useState("");
  const activeRunCount = useRef(0);
  const assessmentRequestKey = useRef<{ obligationId: string; key: string } | null>(null);
  const detailGeneration = useRef(0);
  const selectedRef = useRef("");
  const selectionGeneration = useRef(0);

  const refreshObligations = async (showLoading = false, preserveLastKnown = false) => {
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
      const list = data as { obligations: ObligationSummary[]; sole_pay_candidate_id?: unknown };
      const fetched = list.obligations;
      setObligations(fetched);
      setSolePayCandidateId(typeof list.sole_pay_candidate_id === "string" ? list.sole_pay_candidate_id : null);
      setObligationsStatus("ready");
      if (fetched.length === 0) setSelectedId("");
      return fetched;
    } catch (error) {
      if (!preserveLastKnown) {
        setObligations([]);
        setSolePayCandidateId(null);
        setSelectedId("");
      }
      setObligationsStatus("error");
      setObligationsError(error instanceof Error ? error.message : "Obligations could not be loaded.");
      return [];
    }
  };

  useEffect(() => {
    void refreshObligations(true).then((fetched) => {
      if (fetched[0]) setSelectedId(fetched[0].obligation_id);
    });
  }, []);

  const refreshDetail = async (id: string, preserveLastKnown = false): Promise<ObligationDetail | null> => {
    const requestId = ++detailGeneration.current;
    const isCurrent = () =>
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
      setDetail(data as ObligationDetail);
      setDetailIsStale(false);
      setDetailError(null);
      return data as ObligationDetail;
    } catch (error) {
      if (!isCurrent()) return null;
      if (!preserveLastKnown) {
        setDetail(null);
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
    setDetailIsStale(false);
    setDetailError(null);
    if (selectedId) void refreshDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (!displayedAssessment || !detail) return;
    const current = assessmentReviewSnapshot(detail?.current_assessment);
    if (!currentReviewedAssessment(displayedAssessment, current, selectedId, detail?.aggregate.aggregate_version)) {
      setDisplayedAssessment(null);
    }
  }, [displayedAssessment, detail, selectedId]);

  const run = async (label: string, action: () => Promise<{ ok: boolean; status: number; data: unknown }>) => {
    const targetId = selectedRef.current;
    if (detailIsStale || !detail || !hasExpectedObligationIdentity(detail, targetId)) return;
    const generation = selectionGeneration.current;
    const stillCurrent = () => isCurrentGeneration(generation, selectionGeneration.current) && isSameIdentity(selectedRef.current, targetId);
    activeRunCount.current += 1;
    setBusy(true);
    try {
      const result = await action();
      if (!stillCurrent()) return;
      setLastResult({ label, data: result.data, ok: result.ok, status: result.status, obligationId: targetId });
      if (label === "approve" && !result.ok && result.status === 409) setDisplayedAssessment(null);
    } catch {
      if (!stillCurrent()) return;
      setLastResult({
        label,
        data: { error: "The action could not be confirmed. No automatic retry was made; reload current state before acting again." },
        ok: false,
        status: 0,
        obligationId: targetId,
      });
    } finally {
      if (stillCurrent()) await refreshDetail(targetId, true);
      await refreshObligations(false, true);
      activeRunCount.current = Math.max(0, activeRunCount.current - 1);
      setBusy(activeRunCount.current > 0);
    }
  };

  const runAssessment = () => {
    const obligationId = selectedId;
    if (!obligationId || !detail || detailIsStale || !hasExpectedObligationIdentity(detail, obligationId)) return;
    const generation = selectionGeneration.current;
    const expectedVersion = String(detail.aggregate.aggregate_version);
    setDisplayedAssessment(null);
    return run("assess", async () => {
      const storageKey = `tameion.assessment-request.${obligationId}`;
      if (assessmentRequestKey.current?.obligationId !== obligationId) {
        const persistedKey = localStorage.getItem(storageKey);
        assessmentRequestKey.current = { obligationId, key: persistedKey ?? crypto.randomUUID() };
        if (!persistedKey) localStorage.setItem(storageKey, assessmentRequestKey.current.key);
      }
      const result = await postJson(`/api/obligations/${obligationId}/assess`, undefined, {
        "Idempotency-Key": assessmentRequestKey.current.key,
      });
      if (assessmentKeyDisposition({ status: result.status, data: result.data, obligationId, expectedAggregateVersion: expectedVersion }) === "RELEASE") {
        localStorage.removeItem(storageKey);
        assessmentRequestKey.current = null;
      }
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
    });
  };

  const selected = obligations.find((o) => o.obligation_id === selectedId);
    const assessedCount = obligations.filter((o) => o.assessed).length;
  const payCandidateCount = obligations.filter((o) => o.decision === "PAY").length;
  const allAssessed = obligations.length > 0 && assessedCount === obligations.length;
  const listPresentation = obligationListState(obligationsStatus, obligationsError, obligations.length);
  const detailState: DetailState = detail && detailIsStale ? "stale" : detail ? "loaded" : detailError ? "failed" : selectedId ? "loading" : "none";
  const killSwitchView = killSwitchPresentation(detailState, detail?.execution_kill_switched);
  const routeAssuranceReady = isRouteAssuranceReady(detail);
  const exactPacketGateOpen = Boolean(detailState === "loaded" && !detailIsStale && detail?.execution_packet &&
    detail.execution_gate === "PRIME_AUTHORIZED_EXACT_PACKET" && !detail.execution);
  const state = useMemo(() => detailState === "stale"
    ? { label: "Last-known state — stale", tone: "warning" as const, explanation: "Control and execution truth is not freshly verified. Retry detail before relying on it." }
    : workflowState(detailState === "loaded" ? detail : null, routeAssuranceReady), [detail, detailState, routeAssuranceReady]);
  const aggregateVersion = detail?.aggregate?.aggregate_version;
  const currentAssessment = assessmentReviewSnapshot(detail?.current_assessment);
  const simulatedTrustFixture = detail ? hasSimulatedTrustFixture(detail.demo_arc_trust_simulated, detail.aggregate.source_wallet_ref) : false;
  const hasCurrentAssessment = Boolean(detailState === "loaded" &&
    currentAssessment && currentAssessment.obligation_id === selectedId && currentAssessment.aggregate_version === String(aggregateVersion),
  );
  const hasCurrentPayAssessment = hasCurrentAssessment && currentAssessment?.decision === "PAY";
  const proxyPreparationReady = Boolean(detailState === "loaded" && detail && selectedId && !detail.settlement_proxy && !detail.pae_sealed &&
    hasCurrentPayAssessment && currentAssessment?.provider_truth?.provider_mode === "LIVE_AI" && allAssessed && solePayCandidateId === selectedId &&
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
    allAssessed,
    routeAssuranceReady,
  });
  const lifecycleStatus = (stage: (typeof PAYMENT_LIFECYCLE_STAGES)[number]): string => {
    if (detailState === "none") return stage === "Obligation" ? "No obligation selected" : "Waiting for selection";
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
        if (detail.pae_sealed) return "Authorized — sealed PAE exists";
        if (detail.aggregate.state === "AUTHORIZED") return "Authorization recorded — assurance failed or blocked";
        if (currentAssessment?.decision === "HOLD") return "Locked — assessment requires attention";
        if (currentAssessment?.decision === "ESCALATE") return "Locked — escalation required";
        if (!hasCurrentPayAssessment) return "Locked — current PAY assessment required";
        if (!routeAssuranceReady) return "Approval locked — route assurance not ready";
        return authorizationAssessment ? "Awaiting human approval" : "Review the current PAY assessment";
      case "Assurance":
        if (detail.pae_sealed) return "PAE is sealed; detailed assurance unavailable in this view";
        if (detail.aggregate.state === "AUTHORIZED") return "Assurance failed or blocked; no PASS assurance is available";
        if (hasCurrentPayAssessment && routeAssuranceReady) return "Final assurance runs after human approval";
        return "Final assurance not run";
      case "Payment":
        if (detail.settlement_proxy && detail.execution?.status === "SETTLED") return `Arc Testnet proxy execution reconciled; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "UNKNOWN") return "Outcome unknown — reconcile this same intent; resubmission blocked";
        if (detail.settlement_proxy && ["SUBMITTING", "SUBMITTED"].includes(detail.execution?.status ?? "")) return "Submitted to Arc Testnet provider; reconciliation is pending";
        if (detail.settlement_proxy && detail.execution?.status === "FAILED") return `Arc Testnet provider attempt failed; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "BLOCKED") return reconciliationLeadLine("loaded", detail.execution, true, sourcePayableState(detail));
        if (detail.settlement_proxy && invalidReleaseAuthority) return `Execution record unavailable; sealed PAE is ${invalidPaeState}. Execution history unavailable; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution) return "Authorization recorded; assurance failed or blocked; no usable PAE or execution";
        if (detail.settlement_proxy && detail.pae_sealed) return "Arc Testnet proxy prepared; execution awaits separate exact-packet gate";
        if (detail.settlement_proxy) return "Arc Testnet proxy prepared; final assessment and human authorization required";
        if (detail.execution && detail.truth.settlement_truth.runtime === "SIMULATED") {
          return `Simulated execution ${judgeReadableState(detail.execution.status)}; no Arc payment binding`;
        }
        return "Blocked — no Arc payment binding for this obligation";
      case "Reconciliation":
        if (detail.settlement_proxy && detail.execution?.status === "SETTLED") return `TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "UNKNOWN") return "Read-only reconciliation pending; no resubmission";
        if (detail.settlement_proxy && ["SUBMITTING", "SUBMITTED"].includes(detail.execution?.status ?? "")) return `Submission recorded; reconcile this same intent; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "FAILED") return `Arc Testnet provider attempt failed; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "BLOCKED") return reconciliationLeadLine("loaded", detail.execution, true, sourcePayableState(detail));
        if (detail.settlement_proxy && invalidReleaseAuthority) return `Execution record unavailable; sealed PAE is ${invalidPaeState}. Execution history unavailable; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.truth.tameion_control_truth.execution_state === "NONE") return `No execution record is present; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy) return `Execution history is unavailable; source payable remains ${sourcePayableState(detail)}`;
        if (detail.execution && detail.truth.settlement_truth.runtime === "SIMULATED") {
          return "Simulated evidence only; no Arc settlement to reconcile";
        }
        return "No Arc settlement to reconcile";
    }
  };

  const currentLifecycleStage = !selectedId
    ? "Obligation"
    : detailState !== "loaded" || !detail
      ? "Obligation"
      : detail.execution && ["SUBMITTING", "SUBMITTED", "UNKNOWN", "SETTLED"].includes(detail.execution.status)
        ? "Reconciliation"
      : detail.execution?.status === "FAILED"
        ? "Reconciliation"
      : detail.truth.tameion_control_truth.execution_release_authority === "BLOCKED" ||
        detail.truth.tameion_control_truth.execution_release_authority === "REVOKED" ||
        detail.truth.tameion_control_truth.execution_release_authority === "EXPIRED"
        ? "Payment"
      : detail.pae_sealed
        ? "Payment"
      : detail.aggregate.state === "AUTHORIZED"
        ? "Assurance"
      : !allAssessed || !hasCurrentAssessment || !currentAssessment || currentAssessment.decision !== "PAY"
        ? "Assessment"
        : "Authorization";

  const selectedWorkspaceGuidance = !selectedId
    ? "Choose one obligation from the queue."
    : detailState === "loading"
      ? "Loading current obligation status."
      : detailState === "failed"
        ? "Selected obligation status is unavailable; retry before taking action."
      : detailState === "stale"
        ? "Selected obligation status is stale; refresh before taking action."
      : detail?.settlement_proxy && detail.execution?.status === "UNKNOWN"
        ? `The Arc Testnet outcome is unknown. Reconcile this same intent read-only; do not resubmit. The source payable remains ${sourcePayableState(detail)}.`
      : detail?.settlement_proxy && ["SUBMITTING", "SUBMITTED"].includes(detail.execution?.status ?? "")
        ? `The Arc Testnet submission is recorded. Reconcile this same intent; do not resubmit. The source payable remains ${sourcePayableState(detail)}.`
      : detail?.settlement_proxy && detail.execution?.status === "SETTLED"
        ? `TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION. The source payable remains ${sourcePayableState(detail)}.`
      : detail?.settlement_proxy && detail.execution?.status === "FAILED"
        ? `The Arc Testnet provider attempt failed. No successful reconciliation is recorded; the source payable remains ${sourcePayableState(detail)}.`
      : detail?.settlement_proxy && detail.execution?.status === "BLOCKED"
        ? reconciliationLeadLine("loaded", detail.execution, true, sourcePayableState(detail))
      : detail?.settlement_proxy && ["BLOCKED", "REVOKED", "EXPIRED"].includes(detail.truth.tameion_control_truth.execution_release_authority)
        ? `Execution record is unavailable. The sealed Arc Testnet payment authority is ${["REVOKED", "EXPIRED"].includes(detail.truth.tameion_control_truth.pae_state) ? detail.truth.tameion_control_truth.pae_state.toLowerCase() : detail.truth.tameion_control_truth.execution_release_authority.toLowerCase()}; execution history is unavailable. The source payable remains ${sourcePayableState(detail)}.`
      : detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution
          ? "Authorization is recorded, but assurance failed or is blocked; no PASS assurance, usable PAE, or execution is available. No reassessment or further authorization action is available."
        : detail?.pae_sealed
          ? detail.settlement_proxy
            ? "Approved instruction is sealed for the Arc Testnet settlement proxy. Execution remains subject to the exact-packet gate and final pre-send checks."
            : "Blocker: this genuine obligation has no Arc payment binding; the separate fixed testnet intent does not represent it."
          : proxyPreparationReady
            ? "Prepare the Arc Testnet proxy using read-only provider checks. Preparation changes the aggregate, so run a fresh assessment next, then review it. Payment-route assurance remains a separate authorization gate."
            : !allAssessed
              ? "Next step: assess the remaining obligations before authorization review."
              : !hasCurrentAssessment || !currentAssessment
                ? "Next step: assess this obligation; a PAY recommendation is advisory."
                : currentAssessment.decision !== "PAY"
                  ? `Blocked: current assessment is ${currentAssessment.decision}; resolve its findings before reassessment.`
                  : !authorizationAssessment
                    ? routeAssuranceReady
                      ? "Next step: review the current PAY assessment before authorization."
                      : "Next step: review the current PAY assessment; payment-route assurance is not ready and authorization remains locked."
                    : !routeAssuranceReady
                      ? "Blocker: payment-route assurance is not ready; authorization remains locked."
                      : "Next step: an authorized human may approve this exact reviewed obligation.";

  const assessmentActionStatus = !selectedId || detailState === "none"
    ? "Choose an obligation before taking an assessment action."
    : detailState === "loading"
      ? "Loading current obligation detail; assessment actions are unavailable."
      : detailState === "failed"
        ? "Current obligation detail is unavailable; retry before taking an assessment action."
        : detailState === "stale"
          ? "Current obligation detail is stale; refresh before taking an assessment action."
          : detail?.pae_sealed
            ? detail.settlement_proxy
              ? "The approved instruction is sealed for the Arc Testnet settlement proxy. Reassessment is unavailable; execution remains subject to exact-packet and pre-send gates."
              : "A payment authorization envelope is already sealed. Reassessment is unavailable here; payment remains blocked without an Arc binding."
            : detail?.aggregate.state === "AUTHORIZED" && !detail.execution
              ? "Authorization was recorded, but assurance failed or is blocked. No PASS assurance or usable PAE is available; reassessment and further authorization are unavailable here."
            : currentAssessment?.decision === "PAY" && !currentAssessment.race
              ? "The current PAY recommendation has no review evidence in this detail; authorization remains locked."
              : currentAssessment?.decision === "PAY" && authorizationAssessment && !routeAssuranceReady
                ? "The PAY recommendation has been reviewed, but payment-route assurance is not ready. Authorization remains locked."
                : currentAssessment?.decision === "HOLD" || currentAssessment?.decision === "ESCALATE"
                  ? `Resolve the current ${currentAssessment.decision} findings before reassessment.`
                  : "No assessment action is available for the current obligation state.";
  const optionalReassessmentAvailable = detailState === "loaded" && !detail?.pae_sealed &&
    hasCurrentPayAssessment && Boolean(authorizationAssessment) && !routeAssuranceReady;
  const reviewCurrentAssessment = () => {
    if (detailState !== "loaded" || currentAssessment?.obligation_id !== selectedId || !currentAssessment?.race) return;
    setDisplayedAssessment(currentAssessment);
  };

  // HOLD/ESCALATE operational report — read-only, derived from authoritative
  // current assessment and obligation state. Fails closed when truth is
  // missing or stale. See src/client/hold-escalate-report.ts.
  const reportInput: HoldEscalateReportInput | null = useMemo(() => {
    if (!detail || !selectedId || detailState !== "loaded") return null;
    return {
      obligation_id: selectedId,
      amount: detail.record.amount,
      currency: detail.record.currency,
      aggregate_version: detail.aggregate.aggregate_version,
      source: {
        source_system_id: detail.truth.source_truth.source.source_system_id,
        record_id: detail.truth.source_truth.source.record_id,
        record_type: detail.truth.source_truth.source.record_type,
        approval_state: detail.truth.source_truth.source.approval_state,
        execution_authority: detail.truth.source_truth.source.execution_authority,
      },
      assessment: detail.current_assessment,
    };
  }, [detail, selectedId, detailState]);
  const report = useMemo(() => (reportInput ? buildHoldEscalateReport(reportInput) : null), [reportInput]);
  const reportSummary = useMemo(
    () =>
      buildHoldEscalateSummary(
        obligations.map((o) => ({
          obligation_id: o.obligation_id,
          assessed: o.assessed,
          decision: o.decision,
          provider_mode: o.provider_mode,
        })),
      ),
    [obligations],
  );

  const firstUnmetPrerequisite = authorizationBlockers({
    hasSelection: Boolean(selectedId),
    allAssessed,
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

  type WorkspaceAction = { label: string; actor: string; run: () => void };
  let workspaceAction: WorkspaceAction | null = null;
  if (!selectedId && obligations.length > 0) {
    workspaceAction = { label: "Choose an obligation", actor: "You", run: () => setMobileQueueOpen(true) };
  } else if (selectedId && (detailState === "stale" || detailState === "failed")) {
    workspaceAction = { label: "Refresh current status", actor: "You · read-only refresh", run: () => void refreshDetail(selectedId, true) };
  } else if (detailState === "loaded" && detail?.settlement_proxy && ["UNKNOWN", "SUBMITTING", "SUBMITTED"].includes(detail.execution?.status ?? "")) {
    workspaceAction = { label: "Reconcile this same intent", actor: "Unassigned · read-only reconciliation", run: () => { setPanel("reconciliation"); void refreshDetail(selectedId, true); } };
  } else if (detailState === "loaded" && detail?.execution?.status === "SETTLED") {
    workspaceAction = { label: "View reconciliation receipt", actor: "Reconciliation record", run: () => setPanel("reconciliation") };
  } else if (detailState === "loaded" && detail?.pae_sealed && detail.settlement_proxy && exactPacketGateOpen && detail.execution_packet) {
    workspaceAction = { label: "Submit this exact Arc Testnet proxy intent", actor: "Authorized operator · exact packet gate passed", run: () => {
      if (executionConfirmation !== "SUBMIT EXACT TESTNET SETTLEMENT PROXY" || !detail.sealed_pae_instruction_hash || !detail.execution_packet) return;
      void run("execute", () => postJson(`/api/obligations/${selectedId}/execute`, {
        expected_version: detail.aggregate.aggregate_version,
        packet_sha256: detail.execution_packet!.packet_sha256,
        pae_instruction_hash: detail.sealed_pae_instruction_hash,
        confirmation: executionConfirmation,
      }));
    } };
  } else if (proxyPreparationReady && detail) {
    workspaceAction = { label: "Prepare Arc Testnet settlement proxy", actor: "Authorized operator", run: () => {
      void run("proxy preflight", () => postJson("/api/internal/demo/real-testnet-payment/preflight", {
        obligation_id: selectedId,
        expected_version: detail.aggregate.aggregate_version,
      }));
    } };
  } else if (assessmentAction === "assess") {
    workspaceAction = { label: "Run AI Assessment", actor: "Finance Agent", run: () => { setPanel("assessment"); void runAssessment(); } };
  } else if (assessmentAction === "review") {
    workspaceAction = { label: "Review current PAY assessment", actor: "Human reviewer · unassigned", run: () => { reviewCurrentAssessment(); setPanel("assessment"); } };
  } else if (detailState === "loaded" && detail?.settlement_proxy && authorizationAssessment?.decision === "PAY" && routeAssuranceReady && !detail.pae_sealed && !detail.execution) {
    workspaceAction = { label: "Authorize this exact obligation", actor: "Authorized approver · identity not shown", run: () => {
      if (detailState !== "loaded" || !detail?.settlement_proxy || authorizationAssessment?.decision !== "PAY" || !routeAssuranceReady) return;
      void run("approve", () => postJson(`/api/obligations/${selectedId}/approve`, {
        expected_version: Number(authorizationAssessment.aggregate_version),
        reviewed_assessment_id: authorizationAssessment.assessment_id,
        reviewed_assessment_hash: authorizationAssessment.assessment_hash,
      }));
    } };
  } else if (assessmentAction === "continue" && detailState === "loaded" && detail?.settlement_proxy) {
    workspaceAction = { label: "Continue to authorization review", actor: "Authorized approver · unassigned", run: () => setPanel("authorization") };
  }

  return (
    <main dir="ltr" className="mx-auto flex min-h-screen max-w-[1440px] flex-col gap-2 px-4 py-3 md:gap-3 md:px-6 md:py-3">
      <header className="-mx-4 flex flex-col items-start justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2 sm:flex-row sm:items-baseline md:-mx-6 md:px-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
            Tameion
          </p>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">Assured Payment — Command Center</h1>
        </div>
        <p className="max-w-none text-start text-[12px] leading-5 text-[var(--color-ink-muted)] sm:max-w-sm sm:text-end">
          AI recommendations are advisory. Genuine obligation review is the primary workflow; demonstrations are separate and testnet execution remains locked behind independent review and Prime packet authorization.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-[300px_minmax(0,1fr)] md:gap-3">
        <aside className="order-1 min-w-0 md:order-1 md:border-e md:pe-4">
          <button
            type="button"
            aria-expanded={mobileQueueOpen}
            aria-controls="genuine-obligation-queue"
            onClick={() => setMobileQueueOpen((open) => !open)}
            className="mb-3 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-start text-[13px] font-semibold text-[var(--color-ink)] md:hidden"
          >
            {mobileQueueOpen ? "Close obligation list" : `Switch obligation${selected ? ` · ${selected.service_category.replaceAll("_", " ").toLowerCase()}` : ""}`}
          </button>
          <div id="genuine-obligation-queue" className={mobileQueueOpen ? "block" : "hidden md:block"}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            Genuine obligations
          </p>
          <p className="mb-2 text-[12px] text-[var(--color-ink)]">{queueHeaderLabel(listPresentation, reportSummary)}</p>
          <ul className="border-y border-[var(--color-border)]">
            {obligations.map((o) => {
              const statusColor = o.assessed
                ? o.decision === "ESCALATE"
                  ? "var(--status-blocked-text)"
                  : o.decision === "HOLD"
                    ? "var(--status-hold-text)"
                    : o.decision === "PAY"
                      ? "var(--color-ink)"
                      : "var(--color-ink)"
                : "var(--color-ink-muted)";
              return (
                <li key={o.obligation_id}>
                  <button
                    onClick={() => {
                      setSelectedId(o.obligation_id);
                      setLastResult(null);
                      setDisplayedAssessment(null);
                      setMobileQueueOpen(false);
                    }}
                    aria-current={o.obligation_id === selectedId ? "true" : undefined}
                    className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-[var(--color-border)] px-3 py-3 text-start transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)] ${
                      o.obligation_id === selectedId
                        ? "border-s-4 border-s-[var(--color-accent)] bg-[var(--color-surface)]"
                        : "hover:bg-[var(--color-surface)]"
                    }`}
                  >
                    <span className="col-span-2 min-w-0 break-words text-[13px] font-semibold text-[var(--color-ink)]">
                      <span
                        aria-label={o.assessed ? "assessment complete" : "assessment required"}
                        title={o.assessed ? `Assessment complete: ${o.decision} recommendation` : "Assessment required"}
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: o.assessed ? "var(--color-ink-muted)" : "var(--color-border-strong)" }}
                      />{" "}{o.service_category.replaceAll("_", " ").toLowerCase()}
                    </span>
                    <span className="col-span-1 tabular text-start text-[16px] font-semibold text-[var(--color-ink)]">
                      {o.amount} {o.currency}
                    </span>
                    <span className="col-span-1 text-end text-[12px] font-semibold" style={{ color: statusColor }}>
                      {o.assessed
                        ? o.decision === "PAY" ? "PAY recommendation (advisory)" : `${o.decision ?? "—"} assessment`
                        : "Assessment required"}
                    </span>
                    <span className="col-span-2 text-[12px] text-[var(--color-ink-muted)]">
                      <bdi dir="ltr" className="mono">{o.obligation_id}</bdi>
                      {o.commercial_terms ? ` · ${o.commercial_terms}` : ""}
                    </span>
                </button>
              </li>
              );
            })}
          </ul>
          {obligationListState(obligationsStatus, obligationsError, obligations.length) !== "ready" && (
            <div className="space-y-2 border-b border-[var(--color-border)] px-3 py-4">
              {obligationListState(obligationsStatus, obligationsError, obligations.length) === "loading" && <p role="status" className="text-[13px] text-[var(--color-ink-muted)]">Loading genuine obligations…</p>}
              {obligationListState(obligationsStatus, obligationsError, obligations.length) === "error" && <>
                <p role="alert" className="text-[13px] text-[var(--color-danger)]">Genuine obligations are unavailable. No synthetic demo data has been added to this list. {obligationsError}</p>
                <button type="button" onClick={() => void refreshObligations(true)} className="text-[13px] font-semibold underline">Retry genuine obligations</button>
                <p className="text-[12px] text-[var(--color-ink-muted)]">Open Demo Mode above to view a clearly labeled synthetic workflow.</p>
              </>}
              {obligationListState(obligationsStatus, obligationsError, obligations.length) === "empty" && <>
                <p className="text-[13px] font-semibold text-[var(--color-ink)]">No genuine obligations are currently available.</p>
                <p className="text-[12px] text-[var(--color-ink-muted)]">The genuine lane remains empty; Demo Mode above is separate and never treated as payable.</p>
              </>}
            </div>
          )}
          </div>
        </aside>

        <section className="order-2 flex min-w-0 flex-col gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 md:order-2 md:p-4" aria-label="Selected obligation details">
          {selected && (
            <section aria-label="Selected source obligation" className="grid gap-2 border-b border-[var(--color-border)] pb-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">Selected genuine obligation</p>
                <h2 className="mt-1 break-words text-[21px] font-semibold leading-7 text-[var(--color-ink)] md:text-[25px]">
                  {detailState === "loaded" && detail && sourceText(detail.record, "beneficiary_name") !== "Not captured"
                    ? sourceText(detail.record, "beneficiary_name")
                    : selected.service_category.replaceAll("_", " ").toLowerCase()}
                </h2>
                <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">
                  {detailState === "loaded" && detail && sourceText(detail.record, "beneficiary_name") === "Not captured" ? "Business name not captured · " : ""}
                  Source record <bdi dir="ltr" className="mono">{selected.obligation_id}</bdi>
                  {selected.commercial_terms ? ` · ${selected.commercial_terms}` : ""}
                </p>
              </div>
              <div className="sm:text-end">
                <p className="tabular text-[23px] font-semibold leading-7 text-[var(--color-ink)]"><bdi dir="ltr">{selected.amount} {selected.currency}</bdi></p>
                <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">Source obligation amount</p>
              </div>
              <div className="sm:col-span-2">
                <StateLine tone={state.tone} label={state.label} explanation={state.explanation} />
                {detailState === "loaded" && detail && (
                  <div className="mt-3 grid gap-2 text-[12px] sm:grid-cols-2">
                    <p><span className="text-[var(--color-ink-muted)]">Source payable: </span><strong>{sourcePayableState(detail)}</strong></p>
                    <p className="text-[var(--color-warning)]">
                      {detail.settlement_proxy
                        ? "Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable."
                        : `No Arc payment binding for this genuine obligation; the source payable remains ${sourcePayableState(detail)}.`}
                    </p>
                    {detail.settlement_proxy && <p className="sm:col-span-2">
                      <span className="text-[var(--color-ink-muted)]">Separate testnet intent: </span>
                      <bdi dir="ltr" className="tabular font-semibold">{detail.settlement_proxy.preflight.amount} {detail.settlement_proxy.preflight.asset}</bdi>
                      {" · "}{detail.settlement_proxy.preflight.network}
                      {" · source wallet "}<bdi dir="ltr" className="mono break-all">{detail.settlement_proxy.preflight.source_wallet.id} · {detail.settlement_proxy.preflight.source_wallet.address}</bdi>
                      {" · proxy recipient "}<bdi dir="ltr" className="mono break-all">{detail.settlement_proxy.preflight.destination_wallet.id} · {detail.settlement_proxy.preflight.destination_wallet.address}</bdi>
                    </p>}
                  </div>
                )}
                {(detailState === "loading" || detailState === "failed" || detailState === "stale") && (
                  <p className="mt-2 text-[12px] text-[var(--color-warning)]">Source and control details are {detailState === "loading" ? "loading" : detailState === "stale" ? "stale" : "unavailable"}; no current action is inferred.</p>
                )}
              </div>
            </section>
          )}

          {!selected && (
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
              <p className="text-[13px] font-semibold text-[var(--color-ink)]">Genuine obligations are not selected.</p>
              <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">
                {obligationsStatus === "loading"
                  ? "The genuine source list is loading."
                  : obligationsStatus === "error"
                    ? "The genuine source list is unavailable. Retry it or open Demo Mode above for a separate synthetic workflow."
                    : "There are no genuine obligations to show. Open Demo Mode above for a separate workflow that is never payable."}
              </p>
            </div>
          )}

          {selected && !detail && detailError && (
            <div role="alert" className="rounded border border-[var(--color-danger)] bg-[var(--color-surface)] px-3 py-3">
              <p className="text-[13px] font-semibold text-[var(--color-danger)]">Obligation detail is unavailable.</p>
              <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">{detailError}</p>
            </div>
          )}

          {selected && detail && detailState === "stale" && (
            <div role="status" className="flex flex-wrap items-center justify-between gap-2 rounded border-s-[3px] border-s-[var(--color-warning)] bg-[var(--color-surface)] px-3 py-3">
              <div>
                <p className="text-[13px] font-semibold text-[var(--color-warning)]">Last-known obligation details are stale.</p>
                <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">Retained control, kill-switch, assessment, and execution fields are not freshly verified. Actions are unavailable until detail refresh succeeds.</p>
              </div>
            </div>
          )}

          {detail && (
            <details className="border-b border-[var(--color-border)] pb-3">
              <summary className="cursor-pointer text-[12px] font-semibold text-[var(--color-ink-muted)]">Source and control evidence{detailState === "stale" ? " — last-known / stale" : ""} (technical details)</summary>
              <section aria-label="Payment authority boundary" className="mt-3 grid gap-3 md:grid-cols-3">
              <article className="min-w-0 space-y-1 border-s-2 border-[var(--color-border)] ps-3" data-testid="source-truth">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide">Source-system truth</h3>
                <p className="text-[12px] text-[var(--color-ink)]">{detail.truth.source_truth.role}</p>
                <p className="mono break-words text-[11px] text-[var(--color-ink-muted)]">
                  {detail.truth.source_truth.source.source_kind} · {detail.truth.source_truth.source.source_system_id}
                </p>
                <p className="text-[11px] text-[var(--color-ink-muted)]">Record {detail.truth.source_truth.source.record_id} · state {detail.truth.source_truth.obligation_state}</p>
                <p className="text-[11px] text-[var(--color-ink-muted)]">Source approval {detail.truth.source_truth.source.approval_state} · execution authority {detail.truth.source_truth.source.execution_authority}</p>
              </article>
              {simulatedTrustFixture ? (
                <p className="text-[11px] text-[var(--color-ink-muted)]">Simulated source-wallet and destination-trust fixtures are excluded from the genuine obligation view.</p>
              ) : (
                <>
                  <article className="min-w-0 space-y-1 border-s-2 border-[var(--color-ink)] ps-3" data-testid="tameion-control-truth">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide">Tameion control truth</h3>
                    <p className="break-words text-[12px] text-[var(--color-ink)]">{detail.truth.tameion_control_truth.role}</p>
                    <p className="text-[11px] text-[var(--color-ink-muted)]">Aggregate {detail.truth.tameion_control_truth.aggregate_state} · v{detail.truth.tameion_control_truth.aggregate_version}</p>
                    <p className="text-[11px] text-[var(--color-ink-muted)]">Assessment {detail.truth.tameion_control_truth.assessment_state} · PAE {detail.truth.tameion_control_truth.pae_state}</p>
                    <p className="text-[11px] text-[var(--color-ink-muted)]">Release authority {detail.truth.tameion_control_truth.execution_release_authority}</p>
                  </article>
                  <article className="min-w-0 space-y-1 border-s-2 border-[var(--color-warning)] ps-3" data-testid="settlement-truth">
                    <h3 className="text-[11px] font-semibold uppercase tracking-wide">Settlement truth</h3>
                    <p className="text-[12px] text-[var(--color-ink)]">{detail.truth.settlement_truth.provider_target} · {detail.truth.settlement_truth.network}</p>
                    <p className="text-[11px] text-[var(--color-ink-muted)]">Runtime {detail.truth.settlement_truth.runtime} · status {detail.truth.settlement_truth.status}</p>
                    <p className="mono break-all text-[11px] text-[var(--color-ink-muted)]">Provider reference {detail.truth.settlement_truth.provider_ref ?? "None"}</p>
                  </article>
                </>
              )}
              </section>
            </details>
          )}

          <section aria-label="Payment lifecycle" className="space-y-1 border-b border-[var(--color-border)] pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-[var(--color-ink)]">Selected obligation lifecycle</p>
              <p className="text-[12px] font-semibold tracking-wide text-[var(--color-ink-muted)]">AI recommends · human authorizes · assurance controls release</p>
            </div>
            <ol aria-label="Payment lifecycle" className="grid grid-cols-1 gap-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
              {PAYMENT_LIFECYCLE_STAGES.map((stage, index) => (
                <li key={stage} aria-current={currentLifecycleStage === stage ? "step" : undefined} className={`min-w-0 rounded-sm px-2 py-1 ${currentLifecycleStage === stage ? "border-s-2 border-[var(--color-accent)] bg-[var(--color-surface)]" : "border-s border-[var(--color-border)]"}`}>
                  <div className="flex items-baseline gap-2">
                    <span className="mono text-[12px] font-semibold text-[var(--color-ink-muted)]">{index + 1}.</span>
                    <span className="min-w-0 break-words text-[16px] font-semibold leading-5 text-[var(--color-ink)]">{stage}</span>
                  </div>
                  <span className="mt-1 block min-w-0 break-words text-[13px] leading-5 text-[var(--color-ink-muted)]">{lifecycleStatus(stage)}</span>
                </li>
              ))}
            </ol>
          </section>

          <section aria-label="Current next step" data-testid="current-next-step" className="rounded border-s-4 border-s-[var(--color-accent)] bg-[var(--color-bg)] p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">Current position · {currentLifecycleStage}</p>
                <h3 className="mt-1 text-[17px] font-semibold leading-6 text-[var(--color-ink)]">{state.label}</h3>
                <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--color-ink-muted)]">
                  {selectedWorkspaceGuidance}
                </p>
                {workspaceAction && <p className="mt-2 text-[12px] text-[var(--color-ink-muted)]">Next actor: <strong className="text-[var(--color-ink)]">{workspaceAction.actor}</strong></p>}
                {!workspaceAction && selectedId && detailState === "loaded" && (
                  <p className="mt-2 text-[12px] text-[var(--color-ink-muted)]">Next actor: <strong className="text-[var(--color-ink)]">
                    {detail?.execution?.status === "FAILED" || detail?.execution?.status === "BLOCKED" ||
                    ["BLOCKED", "REVOKED", "EXPIRED"].includes(detail?.truth.tameion_control_truth.execution_release_authority ?? "")
                      ? "Unassigned · no permitted product action is available"
                      : detail?.pae_sealed && detail.settlement_proxy && detail.execution_gate !== "PRIME_AUTHORIZED_EXACT_PACKET"
                      ? "Prime · exact-packet authorization"
                      : detail?.settlement_proxy && detail.execution?.status === "UNKNOWN"
                        ? "Unassigned · read-only reconciliation only"
                        : detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution
                          ? "External-evidence owner unavailable"
                        : firstUnmetPrerequisite?.startsWith("Payment-route assurance")
                          ? "External-evidence owner unavailable"
                          : "Unassigned · no permitted product action is available"}
                  </strong></p>
                )}
                {workspaceAction?.label === "Submit this exact Arc Testnet proxy intent" && (
                  <label className="mt-3 grid max-w-lg gap-1 text-[12px] font-medium text-[var(--color-ink)]">
                    Confirm exact testnet intent
                    <input
                      className="min-h-11 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]"
                      value={executionConfirmation}
                      onChange={(event) => setExecutionConfirmation(event.target.value)}
                      placeholder="SUBMIT EXACT TESTNET SETTLEMENT PROXY"
                      aria-describedby="execution-confirmation-guidance"
                    />
                    <span id="execution-confirmation-guidance" className="font-normal text-[var(--color-ink-muted)]">The exact-packet gate and final pre-send checks must still pass.</span>
                  </label>
                )}
              </div>
              {workspaceAction && (
                <PrimaryButton
                  disabled={busy || (workspaceAction.label === "Submit this exact Arc Testnet proxy intent" && executionConfirmation !== "SUBMIT EXACT TESTNET SETTLEMENT PROXY")}
                  danger={workspaceAction.label === "Submit this exact Arc Testnet proxy intent"}
                  onClick={workspaceAction.run}
                >
                  {workspaceAction.label}
                </PrimaryButton>
              )}
            </div>
            {selectedId && detailState === "loaded" && !terminalExecutionNoAction && firstUnmetPrerequisite?.startsWith("Payment-route assurance is not ready") && (
              <details className="mt-2 border-t border-[var(--color-border)] pt-2 text-[12px] leading-5 text-[var(--color-warning)]">
                <summary className="cursor-pointer font-semibold">Separate external-evidence blocker: payment-route assurance is not ready.</summary>
                <p className="mt-1">{firstUnmetPrerequisite}</p>
              </details>
            )}
          </section>

          <nav aria-label="Command Center surfaces" className="flex flex-wrap gap-1 border-b border-[var(--color-border)]">
            {PANELS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPanel(p.key)}
                aria-pressed={panel === p.key}
                className={`min-w-0 whitespace-normal break-words border-b-2 px-2 py-2 text-start text-[12px] font-medium transition sm:px-3 sm:text-[13px] ${
                  panel === p.key
                    ? "border-[var(--color-accent)] text-[var(--color-ink)]"
                    : "border-transparent text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
                }`}
              >
                {p.label}
              </button>
            ))}
          </nav>

          <div className="min-h-[120px]">
            {panel === "obligations" && detail && (
              <section aria-label="Genuine obligation workspace" className="max-w-xl space-y-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">REAL BUSINESS OBLIGATION</p>
                  <p className="mt-1 text-[13px] text-[var(--color-ink)]">Source: genuine business record · {selected?.service_category.replaceAll("_", " ").toLowerCase()}</p>
                </div>
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="cursor-pointer text-[12px] font-semibold text-[var(--color-ink-muted)]">Source records and payment details</summary>
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
                      .join(" · ") ?? "Not captured"
                    : `${sourceText(detail.record, "effective_due_date")} · ${sourceText(detail.record, "effective_due_date_basis")} · ${sourceDateProvenance(detail.record)}`} />
                  <Field label="Assessment as of" value={currentAssessment?.race?.evidence.authoritative_facts.as_of_date ?? "Not captured"} />
                  <Field label="Source evidence identity" value={currentAssessment?.race?.evidence.evidence_ids.join(", ") || "Not captured"} />
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
                    label="Product destination trust"
                    value={simulatedTrustFixture
                      ? "Not established for this genuine obligation"
                      : `${judgeReadableState(detail.aggregate.destination_verification_status)} · ${judgeReadableState(detail.aggregate.destination_operational_status)}`}
                  />
                  <Field label="Execution authority" value={judgeReadableState(detail.truth.tameion_control_truth.execution_release_authority)} />
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
                      <Field label="Assurance / authorization" value={detail.pae_sealed ? judgeReadableState(detail.truth.tameion_control_truth.execution_release_authority) : "Pending separate Safety Kernel review and human authorization"} />
                      <Field label="Fee / total debit cap" value={detail.settlement_proxy
                        ? `${detail.settlement_proxy.preflight.max_network_fee} / ${detail.settlement_proxy.preflight.max_total_debit} USDC`
                        : "Read-only provider preflight not prepared"} />
                    </dl>
                  </section>
                )}
                </details>
                {hasCurrentAssessment && currentAssessment && currentAssessment.decision !== "PAY" && (
                  <section aria-label="Current assessment and resolution" className="space-y-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
                    <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
                      {currentAssessment.decision === "HOLD" ? "Current assessment — Requires attention" : "Current assessment — Escalation required"}
                    </h3>
                    <AdvisoryAssessmentCard
                      assessment={currentAssessment}
                      label="Sealed assessment"
                      allAssessed={allAssessed}
                    />
                    <p className="text-[12px] text-[var(--color-ink-muted)]">
                      Resolution action is not yet available in this build; provide/verify current payment-route evidence, then reassess.
                    </p>
                  </section>
                )}
                {assessmentAction === "none" && <p role="status" className="text-[13px] leading-5 text-[var(--color-ink-muted)]">{assessmentActionStatus}</p>}
                {optionalReassessmentAvailable && (
                  <button type="button" disabled={busy} onClick={() => void runAssessment()} className="text-[12px] font-medium underline disabled:opacity-50">
                    Reassess current PAY recommendation (optional)
                  </button>
                )}
              </section>
                        )}

            {panel === "assessment" && (
              <div className="max-w-xl space-y-3">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  The Finance Agent reads this obligation and returns exactly one PAY / HOLD / ESCALATE
                  recommendation with reasons. It cannot approve, sign, or execute anything. A PAY
                  recommendation is advisory only — it still requires human authorization and a
                  Safety Kernel PASS before any release authority.
                </p>
                <div className="flex items-center justify-between gap-3 border-s-[3px] border-s-[var(--color-border)] px-3 py-2">
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                    {assessmentCoverageLabel(listPresentation, assessedCount, obligations.length)}
                  </p>
                  <RuntimeBadge mode={selected?.provider_mode ?? null} />
                </div>
                {displayedAssessment && displayedAssessment.decision === "PAY" && authorizationAssessment && (
                  <AdvisoryAssessmentCard
                    assessment={displayedAssessment}
                    label="Displayed assessment under review"
                    allAssessed={allAssessed}
                    action={
                      <button
                        type="button"
                        className="text-[12px] font-semibold underline text-[var(--color-warning)]"
                        disabled={detailState !== "loaded" || !displayedAssessment.race}
                        onClick={() => setDisplayedAssessment(assessmentReviewSnapshot(detail!.current_assessment)!)}
                      >
                        Discard review selection
                      </button>
                    }
                  />
                )}
                {displayedAssessment && displayedAssessment.decision !== "PAY" && (
                  <AdvisoryAssessmentCard
                    assessment={displayedAssessment}
                    label="Assessment evidence under review — authorization locked"
                    allAssessed={allAssessed}
                    action={
                      <button type="button" className="text-[12px] font-semibold underline" onClick={() => setDisplayedAssessment(null)}>
                        Close evidence review
                      </button>
                    }
                  />
                )}
                {!displayedAssessment && currentAssessment && detailState === "loaded" && (
                  <AdvisoryAssessmentCard
                    assessment={currentAssessment}
                    label="Current sealed assessment"
                    allAssessed={allAssessed}
                    action={
                      <button
                        type="button"
                        className="text-[12px] font-semibold underline"
                        disabled={detailState !== "loaded" || !currentAssessment.race}
                        onClick={() => setDisplayedAssessment(assessmentReviewSnapshot(currentAssessment)!)}
                      >
                        {currentAssessment.decision === "PAY" ? "Review this assessment for authorization" : "Review assessment evidence"}
                      </button>
                    }
                  />
                )}
                {displayedAssessment && displayedAssessment.decision === "PAY" && !authorizationAssessment && displayedAssessment !== currentAssessment && (
                  <p className="text-[12px] text-[var(--color-danger)]">
                    The displayed assessment is no longer current. Review the current sealed assessment before authorization.
                  </p>
                )}
                {assessmentAction === "none" && <p role="status" className="text-[13px] leading-5 text-[var(--color-ink-muted)]">{assessmentActionStatus}</p>}
                {optionalReassessmentAvailable && (
                  <button type="button" disabled={busy} onClick={() => void runAssessment()} className="text-[12px] font-medium underline disabled:opacity-50">
                    Reassess current PAY recommendation (optional)
                  </button>
                )}

                {assessmentGateCopy(listPresentation, allAssessed, obligations.length) && (
                  <p className="text-[12px] text-[var(--color-warning)]">
                    {assessmentGateCopy(listPresentation, allAssessed, obligations.length)}
                  </p>
                )}

                {payCandidateCount > 0 && (
                  <p className="text-[12px] text-[var(--color-ink-muted)]">
                    {payCandidateCount} obligation{payCandidateCount !== 1 ? "s" : ""} carry a PAY recommendation,
                    {payCandidateCount === obligations.length && allAssessed ? " but all must still authorize." : " but none are authorized yet."}
                  </p>
                )}

                {/* Genuine-lane explanation: HOLD / no candidate → no authorization → no PAE → no release */}
                {!allAssessed || payCandidateCount === 0 ? (
                  <div className="rounded border border-[var(--status-hold-border)] bg-[var(--status-hold-surface)] px-3 py-2 text-[12px] text-[var(--status-hold-text)]">
                    <p className="font-semibold">Genuine payment lane: no execution release</p>
                    <p>
                      {allAssessed
                        ? "All obligations are assessed, but no PAY candidate exists. The sealed HOLD assessments provide no execution-release authority."
                        : "Not all obligations have been assessed. Every obligation requires a sealed assessment before the Safety Kernel or PAE can run."}
                    </p>
                    <p className="mt-1 text-[var(--color-ink-muted)]">
                      {lifecycleStopLabel({ presentation: listPresentation, total: obligations.length, assessed: assessedCount, pay: payCandidateCount })} No payment execution, no signed PAE, no provider submission.
                    </p>
                  </div>
                ) : (
                  <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[12px] text-[var(--color-ink-muted)]">
                    <p className="font-semibold">Genuine payment lane status</p>
                    <p>
                      PAY recommendation detected — this is advisory only. A signed Payment Authorization
                      Envelope and Safety Kernel PASS are still required before any execution authority is
                      granted. The genuine lane remains STOP until authorization and PAE sealing complete.
                    </p>
                  </div>
                )}

                {currentResult?.label === "assess" && <ActionResultBanner result={currentResult} />}
                {currentResult?.label === "assess" && <EvidencePanel value={currentResult.data} />}
              </div>
            )}

            {panel === "authorization" && (
              <div className="max-w-xl space-y-3">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  {authorizationPanelCopy(
                    detailState,
                    Boolean(selectedId),
                    Boolean(detailState === "loaded" && detail?.pae_sealed),
                    Boolean(detailState === "loaded" && detail?.settlement_proxy),
                    Boolean(detailState === "loaded" && detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution),
                  )}
                  {detailState === "loaded" && !detail?.pae_sealed && detail?.aggregate.state !== "AUTHORIZED" && selectedId && <> Authorization review applies to the current PAY assessment (aggregate version: {aggregateVersionLabel(aggregateVersion, true)}).</>}
                </p>
                {detailState === "loaded" && selectedId && detail && (
                  <section aria-label="Genuine obligation and Arc Testnet settlement proxy" className="space-y-2 rounded border border-[var(--color-border)] p-3">
                    <p className="text-[12px] font-semibold">Source obligation and settlement proxy are separate identities</p>
                    <p className="text-[12px] font-semibold text-[var(--color-warning)]">{detail.source_settlement_disclosure ?? "Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable."}</p>
                    <dl className="grid grid-cols-1 gap-x-5 sm:grid-cols-2">
                      <Field label="Genuine source obligation" value={selectedId} />
                      <Field label="Source payable" value={`${detail.record.amount} ${detail.record.currency} · ${sourcePayableState(detail)}`} />
                      <Field label="Source vendor destination reference" value={sourceText(detail.record, "source_destination_reference_token")} />
                      <Field label="Source record status" value={`${sourcePayableState(detail)}; source record is not changed by testnet settlement`} />
                      {detail.settlement_proxy ? <>
                        <Field label="Settlement proxy amount" value={`${detail.settlement_proxy.preflight.amount} ${detail.settlement_proxy.preflight.asset}`} />
                        <Field label="Settlement network" value={detail.settlement_proxy.preflight.network} />
                        <Field label="Testnet source wallet" value={`${detail.settlement_proxy.preflight.source_wallet.id} · ${detail.settlement_proxy.preflight.source_wallet.address}`} />
                        <Field label="Testnet proxy recipient" value={`${detail.settlement_proxy.preflight.destination_wallet.id} · ${detail.settlement_proxy.preflight.destination_wallet.address}`} />
                      <details className="sm:col-span-2">
                        <summary className="cursor-pointer text-[12px] font-semibold text-[var(--color-ink-muted)]">Evidence and technical details</summary>
                        <dl className="mt-2">
                          <Field label="Proxy aggregate version" value={String(detail.settlement_proxy.mapped_aggregate_version)} />
                          <Field label="Preflight evidence hash" value={detail.settlement_proxy.preflight.evidence_sha256} />
                          <Field label="Maximum network fee / total debit" value={`${detail.settlement_proxy.preflight.max_network_fee} / ${detail.settlement_proxy.preflight.max_total_debit} USDC`} />
                        </dl>
                      </details>
                      </> : <Field label="Testnet settlement proxy" value="Not prepared; no testnet destination has been mapped to this source obligation" />}
                    </dl>
                    {proxyPreparationReady && (
                      <div className="space-y-1">
                        <p className="text-[12px] text-[var(--color-ink-muted)]">Current LIVE_AI PAY and sole-candidate checks pass. Circle wallet, balance, fee, and duplicate checks are read-only. Preparing the proxy changes the settlement aggregate, so a fresh assessment is required before authorization.</p>
                      </div>
                    )}
                    {!detail.settlement_proxy && hasCurrentPayAssessment && currentAssessment?.provider_truth?.provider_mode === "LIVE_AI" &&
                      allAssessed && solePayCandidateId && solePayCandidateId !== selectedId && (
                        <p role="status" className="text-[12px] text-[var(--color-warning)]">
                          The existing deterministic gate selected {solePayCandidateId}; select that obligation before preparing a testnet proxy.
                        </p>
                      )}
                  </section>
                )}
                {authorizationAssessment && (
                  <details className="border-s-2 border-[var(--color-border)] ps-3 text-[12px] text-[var(--color-ink-muted)]">
                    <summary className="cursor-pointer font-semibold">Reviewed assessment evidence</summary>
                    <dl className="mt-2 space-y-1">
                      <Field label="Reviewed assessment" value={authorizationAssessment.assessment_id} />
                      <Field label="Assessment hash" value={authorizationAssessment.assessment_hash} />
                      <Field label="Assessment aggregate version" value={authorizationAssessment.aggregate_version} />
                      <Field label="Decision reviewed" value={authorizationAssessment.decision} />
                      <ul className="list-disc ps-5">{authorizationAssessment.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
                      <RacePanel race={authorizationAssessment.race} />
                    </dl>
                  </details>
                )}
                {authorizationPrerequisitesVisible(detailState, Boolean(selectedId), Boolean(detail?.pae_sealed), Boolean(detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution)) && (() => {
                  const blockers = authorizationBlockers({
                    hasSelection: Boolean(selectedId),
                    allAssessed,
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
                    <ul className="list-disc space-y-1 ps-5 text-[12px] text-[var(--color-warning)]" aria-label="Unmet authorization prerequisites">
                      {blockers.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                  ) : null;
                })()}
                {detailState === "loaded" && detail && !detail.pae_sealed && detail.settlement_proxy && authorizationAssessment?.decision === "PAY" && routeAssuranceReady && (
                  <p className="text-[12px] text-[var(--color-ink-muted)]">The reviewed current PAY, proxy binding, and route assurance are ready for human authorization. Use the current next-step action above.</p>
                )}
                {currentResult?.label === "approve" && <ActionResultBanner result={currentResult} />}
                {currentResult?.label === "approve" &&
                  (() => {
                    const data = currentResult.data as { safety_kernel?: { overall: string; control_results: ControlResultView[] } };
                    return data.safety_kernel ? (
                      <SafetyKernelBreakdown overall={data.safety_kernel.overall} controlResults={data.safety_kernel.control_results} />
                    ) : null;
                  })()}
                {currentResult?.label === "approve" && <EvidencePanel value={currentResult.data} />}
              </div>
            )}

            {panel === "assurance" && (
              <div className="max-w-xl space-y-3">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  {detail?.settlement_proxy
                    ? `This selected genuine obligation is bound to a distinct Arc Testnet settlement proxy. The source payable remains ${sourcePayableState(detail)}.`
                    : "No Arc Testnet proxy is bound to this selected obligation. A testnet destination is never inferred from or substituted for the source vendor route."}
                </p>

                {detail?.settlement_proxy && (
                  <section aria-label="Arc Testnet assurance and payment gate" className="space-y-2 rounded border border-[var(--color-border)] p-3">
                    <p className="text-[12px] font-semibold">{detail.source_settlement_disclosure}</p>
                    <dl>
                      <Field label="Genuine obligation / source payable" value={`${selectedId} · ${detail.record.amount} ${detail.record.currency} · ${sourcePayableState(detail)}`} />
                      <Field label="Arc Testnet proxy intent" value={`${detail.settlement_proxy.preflight.amount} ${detail.settlement_proxy.preflight.asset} · ${detail.settlement_proxy.preflight.network}`} />
                      <Field label="Testnet source wallet" value={`${detail.settlement_proxy.preflight.source_wallet.id} · ${detail.settlement_proxy.preflight.source_wallet.address}`} />
                      <Field label="Testnet proxy recipient" value={`${detail.settlement_proxy.preflight.destination_wallet.id} · ${detail.settlement_proxy.preflight.destination_wallet.address}`} />
                      <Field label="Current exact packet gate" value={detail.execution_gate ?? "Locked until assurance and PAE are current"} />
                      {detail.execution_packet && <Field label="Prime reviewed exact packet SHA-256" value={detail.execution_packet.packet_sha256} />}
                    </dl>
                    {detail.execution?.status === "UNKNOWN" && <p role="status" className="text-[12px] text-[var(--color-warning)]">Provider outcome is UNKNOWN. Reconciliation is read-only and resubmission is blocked.</p>}
                    {detail.execution?.status === "SETTLED" && <p role="status" className="text-[12px] font-semibold">TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION · the source payable remains {sourcePayableState(detail)}.</p>}
                    {detail.execution_packet && !detail.execution && (
                      <EvidencePanel value={detail.execution_packet.packet} />
                    )}
                    {detail.execution_packet && !detail.execution && !exactPacketGateOpen && <p className="text-[11px] text-[var(--color-warning)]">Locked — separate Prime authorization of this exact packet is required.</p>}
                    {detail.execution_packet && !detail.execution && exactPacketGateOpen && <p className="text-[11px] text-[var(--color-warning)]">The exact-packet gate is open. Confirm the exact testnet intent in the current next-step card before submission.</p>}
                  </section>
                )}

                <div
                  className={`flex flex-wrap items-center justify-between gap-3 border-s-[3px] px-3 py-2 ${
                    killSwitchView === "engaged"
                      ? "border-s-[var(--color-danger)] bg-[var(--color-surface)]"
                      : "border-s-[var(--color-border)]"
                  }`}
                >
                  <div>
                    <p
                      className={`text-[13px] font-semibold uppercase tracking-wide ${
                        killSwitchView === "engaged"
                          ? "text-[var(--color-danger)]"
                          : "text-[var(--color-ink-muted)]"
                      }`}
                    >
                      Kill switch: {killSwitchLabel(killSwitchView)}
                    </p>
                    <p className="text-[12px] text-[var(--color-ink-muted)]">
                      Checked by both the Safety Kernel (pre-approval) and the Execution Worker (pre-submit).
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={busy || detailState !== "loaded" || !selectedId}
                      onClick={() =>
                        run("kill-switch", () =>
                          postJson(`/api/obligations/${selectedId}/kill-switch`, {
                            action: "ACTIVATE",
                            scope: "TRANSACTION",
                          }),
                        )
                      }
                      className="rounded border border-[var(--color-danger)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-danger)] transition hover:bg-[var(--color-danger)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Disable this obligation
                    </button>
                    <button
                      disabled={busy || detailState !== "loaded" || !selectedId}
                      onClick={() =>
                        run("kill-switch", () =>
                          postJson(`/api/obligations/${selectedId}/kill-switch`, {
                            action: "DEACTIVATE",
                            scope: "TRANSACTION",
                          }),
                        )
                      }
                      className="rounded border border-[var(--color-border)] px-3 py-1.5 text-[12px] font-medium text-[var(--color-ink)] transition hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Re-enable
                    </button>
                  </div>
                </div>
                {currentResult?.label === "kill-switch" && <ActionResultBanner result={currentResult} />}

                <p className="border-s-2 border-[var(--color-warning)] ps-3 text-[13px] leading-5 text-[var(--color-warning)]">
                  {detailState === "loaded" && detail
                    ? `Payment is blocked by the current gates. ${detail.settlement_proxy ? "An Arc Testnet settlement proxy is bound to this obligation" : "No Arc Testnet settlement proxy is prepared for this obligation"}; testnet execution does not discharge the real-world payable, which remains ${sourcePayableState(detail)}.`
                    : "Payment is blocked while current obligation and settlement details are unavailable. Refresh the authoritative detail before relying on its status."}
                </p>
                {!detail?.pae_sealed && (
                  <p className="text-[12px] text-[var(--color-warning)]">{firstUnmetPrerequisite ?? "Authorize the obligation first."}</p>
                )}
              </div>
            )}

            {panel === "reconciliation" && (
              <div className="max-w-xl space-y-3">
                <p className="text-[13px] font-semibold text-[var(--color-ink)]">{reconciliationLeadLine(detailState, detail?.execution, Boolean(detail?.settlement_proxy), detail ? sourcePayableState(detail) : "OUTSTANDING")}</p>
                {detail?.settlement_proxy && detailState === "loaded" && (
                  <dl className="rounded border border-[var(--color-border)] p-3">
                    <Field label="Source obligation" value={`${selectedId} · ${detail.record.amount} ${detail.record.currency}`} />
                    <Field label="Source payable state" value={`${sourcePayableState(detail)} · unchanged by testnet execution`} />
                    <Field label="Arc Testnet settlement proxy" value={`${detail.settlement_proxy.preflight.amount} ${detail.settlement_proxy.preflight.asset} · ${detail.settlement_proxy.preflight.network}`} />
                    <Field label="Proxy recipient" value={`${detail.settlement_proxy.preflight.destination_wallet.id} · ${detail.settlement_proxy.preflight.destination_wallet.address}`} />
                    <p className="pt-2 text-[12px] text-[var(--color-warning)]">{detail.source_settlement_disclosure}</p>
                  </dl>
                )}
                {detail && detailState === "loaded" && <EvidencePanel value={detail} />}
              </div>
            )}

            {panel === "report" && (
              <div className="max-w-xl space-y-4">
                <section aria-label="HOLD/ESCALATE aggregate summary" className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                    Operational report — HOLD/ESCALATE obligations
                  </p>
                  <p className="text-[12px] text-[var(--color-ink)]">{operationalReportSummaryLabel(listPresentation, reportSummary)}</p>
                  {reportSummaryUnavailableReason(listPresentation) ? (
                    <p role="alert" className="text-[12px] text-[var(--color-danger)]">
                      {reportSummaryUnavailableReason(listPresentation)}
                    </p>
                  ) : (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                      <Field label="Total obligations" value={String(reportSummary.total)} />
                      <Field label="HOLD" value={String(reportSummary.hold)} />
                      <Field label="ESCALATE" value={String(reportSummary.escalate)} />
                      <Field label="Unassessed" value={String(reportSummary.unassessed)} />
                      <Field label="PAY (out of scope)" value={String(reportSummary.pay)} />
                    </dl>
                  )}
                </section>

                {!report && (
                  <p className="text-[12px] text-[var(--color-ink-muted)]">
                    {operationalReportDetailPrompt(detailState)}
                  </p>
                )}

                {report && report.fail_closed && report.fail_closed_reason && (
                  <div className="rounded border-s-[3px] border-s-[var(--color-danger)] bg-[var(--color-danger-bg)] px-3 py-2">
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-danger)]">
                      Fail-closed — default HOLD
                    </p>
                    <p className="text-[12px] text-[var(--color-danger)]">{report.fail_closed_reason}</p>
                  </div>
                )}

                {report && (
                  <section aria-label={`Operational report for ${report.obligation_id}`} className="space-y-3">
                    {/* Supplier / source reference */}
                    <div className="space-y-1 border-s-2 border-[var(--color-ink)] ps-3">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                        Supplier / source reference
                      </h3>
                      <Field label="Source system" value={report.supplier_reference.source_system_id} />
                      <Field label="Record ID" value={report.supplier_reference.record_id} />
                      <Field label="Record type" value={report.supplier_reference.record_type} />
                      <Field label="Source approval" value={report.supplier_reference.approval_state} />
                      <Field label="Execution authority" value={report.supplier_reference.execution_authority} />
                    </div>

                    {/* Amount */}
                    <div className="space-y-1 border-s-2 border-[var(--color-ink-muted)] ps-3">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                        Amount
                      </h3>
                      <Field label="Obligation amount" value={`${report.amount} ${report.currency}`} />
                    </div>

                    {/* Decision banner — never color-only */}
                    <div
                      className="border-s-[3px] ps-3 py-2"
                      style={{
                        borderInlineStartColor: report.decision === "ESCALATE"
                          ? "var(--status-blocked-border)"
                          : report.decision === "PAY" ? "var(--color-border)" : "var(--status-hold-border)",
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
                          {reportDecisionLabel(report)}
                        </p>
                        <span
                          className="text-[11px] font-semibold uppercase"
                          style={{
                            color: report.decision === "ESCALATE"
                              ? "var(--status-blocked-text)"
                              : report.decision === "PAY" ? "var(--color-ink-muted)" : "var(--status-hold-text)",
                          }}
                          aria-label={reportDecisionLabel(report)}
                        >
                          {report.status}
                          {report.fail_closed && " · fail-closed"}
                        </span>
                      </div>
                      {!report.in_scope && (
                        <p className="text-[12px] text-[var(--color-ink-muted)]">
                          Advisory only — PAY is outside the HOLD/ESCALATE report scope and has
                          not been settled or authorized.
                        </p>
                      )}
                                        </div>

                    {/* Assessment truth */}
                    <div className="space-y-1 border-s-2 border-[var(--color-border)] ps-3">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                        Assessment truth
                      </h3>
                      <Field label="Status" value={report.status} />
                      {report.assessment_id && <Field label="Assessment ID" value={report.assessment_id} />}
                      {report.assessment_hash && (
                        <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border)] py-1.5">
                          <dt className="text-[13px] text-[var(--color-ink-muted)]">Assessment hash</dt>
                          <dd className="mono text-[13px] font-medium break-all text-[var(--color-ink)]">
                            {report.assessment_hash}
                          </dd>
                        </div>
                      )}
                      {report.assessment_time && <Field label="Assessment time" value={report.assessment_time} />}
                      {report.provider_mode && (
                        <div className="flex items-center gap-2 border-b border-[var(--color-border)] py-1.5">
                          <span className="text-[11px] font-semibold uppercase text-[var(--color-ink-muted)]">Provider mode</span>
                          <RuntimeBadge mode={report.provider_mode} />
                        </div>
                      )}
                      {report.provider_used && (
                        <p className="text-[11px] text-[var(--color-ink-muted)] border-b border-[var(--color-border)] py-1.5">
                            Provider: {report.provider_used} (advisory only, non-authoritative)
                        </p>
                      )}
                    </div>

                    {/* Reasons */}
                    {report.reasons.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                          Reasons
                        </p>
                        <ul className="list-disc ps-5 text-[12px] text-[var(--color-ink-muted)]">
                          {report.reasons.map((reason, index) => (
                            <li key={index}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Evidence gap */}
                    {report.evidence_gap.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                          Evidence gap
                        </p>
                        <ul className="list-disc ps-5 text-[12px] text-[var(--color-ink-muted)]">
                          {report.evidence_gap.map((gap, index) => (
                            <li key={index}>{gap}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {/* Remediation */}
                    {report.remediation.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                          Remediation
                        </p>
                        {report.remediation.map((item) => (
                          <div key={item.finding_code} className="border-s-2 border-[var(--color-warning)] ps-2 space-y-1">
                            <p className="text-[12px]"><strong>{item.finding_code}:</strong> {item.reason}</p>
                            <p className="text-[11px] text-[var(--color-ink-muted)]">
                              <strong>Action:</strong> {item.required_action} · <strong>Owner:</strong> {item.owner_role} · reassess{" "}
                              {item.reassess_after_resolution ? "permitted" : "not permitted"}
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
                  </section>
                )}
              </div>
            )}
          </div>
        </section>
      </div>

      <details className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
        <summary className="cursor-pointer text-[12px] font-semibold text-[var(--color-ink)]">Demonstrations</summary>
        <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
          <details className="rounded border border-[var(--color-warning)] px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-semibold text-[var(--color-warning)]">Read-only sample</summary>
            <section aria-label="Simulated demonstration" className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-[13px] font-semibold text-[var(--color-warning)]">Illustrative only · not a genuine payment</p>
                  <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Playback uses a fixed local fixture. It makes no approval, assurance, provider, or execution requests.</p>
                </div>
                <button type="button" aria-expanded={samplePlaybackVisible} onClick={() => setSamplePlaybackVisible((visible) => !visible)} className="rounded border border-[var(--color-border)] px-3 py-2 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface)]">
                  {samplePlaybackVisible ? "Hide sample playback" : "Show sample playback"}
                </button>
              </div>
              {samplePlaybackVisible && <SimulatedDemoStages />}
            </section>
          </details>

        </div>
      </details>
    </main>
  );
}
