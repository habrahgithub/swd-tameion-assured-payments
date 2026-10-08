"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  aggregate_state?: string;
  pae_sealed?: boolean;
  execution_status?: string | null;
  route_assurance_status?: "Route assurance ready" | "Route assurance not ready";
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
  assurance_evidence?: AssuranceEvidenceView;
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

function sourceServiceContext(record: Record<string, unknown>): string | null {
  const commercialTerms = typeof record.commercial_terms === "string" ? record.commercial_terms.trim() : "";
  const evidence = Array.isArray(record.source_evidence) ? record.source_evidence : [];
  const sourceType = evidence.find((item) => item && typeof item === "object" && !Array.isArray(item)) as Record<string, unknown> | undefined;
  const sourceLabels: Record<string, string> = {
    PDF_PROFORMA_INVOICE: "proforma invoice",
    PDF_INVOICE: "invoice",
    PDF_TAX_INVOICE: "tax invoice",
    USER_SUPPLIED_EMAIL_INVOICE_EXCERPT: "user-supplied email invoice excerpt",
    AUTHORIZED_OPERATOR_ATTESTATION: "operator attestation",
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
  if (hasSettlementProxy) return "The Arc Testnet proxy is prepared. Current assessment and assurance determine whether authorization is available; no PAE is sealed.";
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
    if (hasSettlementProxy && status === "BLOCKED" && !record.provider_ref && !record.provider_evidence) return `Arc Testnet execution is blocked. No provider reference is recorded for this instruction; external provider status is not established by this record. Source payable remains ${sourceState}.`;
    if (hasSettlementProxy && status === "BLOCKED") return `Arc Testnet execution is blocked and provider evidence is recorded; review the recorded provider outcome. Source payable remains ${sourceState}.`;
    if (hasSettlementProxy) return `Arc Testnet proxy execution ${status}; source payable remains ${sourceState}.`;
    return `Simulated execution ${status}; no Arc settlement to reconcile.`;
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
    items.push({ occurredAt: preflightTime, label: "Read-only Arc Testnet preflight evidence", result: "Captured for the controlled settlement proxy." });
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
      label: "Provider status evidence",
      result: typeof detail.execution?.provider_evidence?.status === "string"
        ? detail.execution.provider_evidence.status
        : "Status recorded",
    });
  }
  return items.sort((left, right) => Date.parse(left.occurredAt) - Date.parse(right.occurredAt));
}

export function submissionEvidenceCopy(detail: ObligationDetail): string {
  const execution = detail.execution;
  if (execution?.provider_ref) return "A provider reference is recorded for this instruction.";
  if (execution) return "No provider reference is recorded for this instruction. External provider status is not established by this record.";
  return "No Tameion execution record is recorded for this instruction. This does not establish external provider status.";
}

export function currentAuthorityGuidance(detail: ObligationDetail): string | null {
  const authority = detail.truth.tameion_control_truth.execution_release_authority;
  const paeState = detail.truth.tameion_control_truth.pae_state;
  if (["BLOCKED", "REVOKED", "EXPIRED"].includes(authority) || ["REVOKED", "EXPIRED"].includes(paeState)) {
    return "The previous instruction is not available for submission. Re-establish current payment authority before any new execution packet.";
  }
  if (detail.pae_sealed && (!detail.execution_packet || !detail.sealed_pae_instruction_hash || detail.execution_gate === "LOCKED_UNTIL_CURRENT_AUTHORIZATION")) {
    return "Current payment authority is not available for submission. Re-establish the current assessment and authorization path before any new execution packet.";
  }
  return null;
}

export function queueHeaderLabel(presentation: ObligationListPresentation, summary: HoldEscalateSummary): string {
  if (presentation === "loading") return "Loading genuine queue — completion is not yet known.";
  if (presentation === "error") return "Genuine queue unavailable — completion cannot be determined.";
  if (presentation === "empty") return "No genuine obligations are in the queue.";
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
type ExecutionConfirmation = { identity: string; value: string } | null;

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
  if ((releaseAuthority === "BLOCKED" || releaseAuthority === "REVOKED") && (detail.pae_sealed || execution)) {
    return {
      label: "Blocked",
      tone: "danger",
      explanation: "Execution authority is no longer usable. Review the control and evidence state before any new attempt.",
    };
  }
  if (releaseAuthority === "EXPIRED" && (detail.pae_sealed || execution)) {
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
  if (detail.pae_sealed && detail.settlement_proxy && !execution &&
      (!detail.execution_packet || !detail.sealed_pae_instruction_hash || detail.execution_gate === "LOCKED_UNTIL_CURRENT_AUTHORIZATION")) {
    return {
      label: "PAE sealed · no current exact packet",
      tone: "warning",
      explanation: "A sealed record exists, but no current exact execution packet is available. Payment authority must be re-established before submission.",
    };
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
      <summary className="min-h-11 cursor-pointer select-none py-2 text-[var(--color-ink-muted)]">Evidence &amp; runtime detail</summary>
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

/** Finance-facing advisory summary. Technical traces and provider metadata
 * live in the single Developer & audit evidence disclosure. */
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
  if (mode === "LIVE_AI") return "Live AI · advisory.";
  if (mode === "NOT_LIVE_AI") return "Deterministic fallback · not live AI.";
  if (mode === "BLOCKED_EXTERNAL") return "External provider blocked; live AI is unconfirmed.";
  return "Provider source is unavailable; whether this assessment used live AI is unknown.";
}

function AssessmentResultCard({
  assessment,
  nextAction,
  nextOwner,
  paymentEligibility,
  primaryAction,
  stageAccessibilityLabel,
  stageHeadingRef,
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
  stageAccessibilityLabel: string;
  stageHeadingRef: React.RefObject<HTMLHeadingElement | null>;
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
    <section aria-label="Assessment result" className="space-y-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:space-y-3 sm:p-4" data-testid="assessment-result-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--color-border)] pb-1 sm:pb-2">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">Finance Agent · advisory result</p>
          <h3 ref={stageHeadingRef} tabIndex={-1} aria-label={stageAccessibilityLabel} className={`mt-0.5 text-[21px] font-semibold ${decisionToneClass}`}>Advisory — {assessment.decision}</h3>
          <p aria-label="Assessment provenance" className="mt-0.5 text-[12px] leading-4 text-[var(--color-ink-muted)]" data-testid="assessment-provenance">
            {assessmentProvenanceCopy(assessment)}
          </p>
        </div>
      </header>

      <p className="text-[15px] leading-6 text-[var(--color-ink)]">{summary}</p>

      <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]"><strong className="text-[var(--color-ink)]">What this means:</strong> {meaning}</p>

      {paymentEligibility && (
        <section aria-label="Payment eligibility" className="border-t border-[var(--color-border)] pt-1" data-testid="payment-eligibility">
          <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]">
            <strong className="text-[var(--color-ink)]">Payment eligibility:</strong> {paymentEligibility.summary}
            {paymentEligibility.candidate && <> Selected candidate: <strong className="text-[var(--color-ink)]">{paymentEligibility.candidate}</strong>.</>}
            {paymentEligibility.reason && <> {paymentEligibility.reason}</>}
          </p>
        </section>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--color-border)] pt-1" data-testid="assessment-action-area">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold text-[var(--color-ink)]">What to do next</p>
          {!primaryAction && <p className="text-[13px] leading-5 text-[var(--color-ink-muted)]">{nextAction}</p>}
          {!primaryAction && nextOwner && <p className="text-[12px] text-[var(--color-ink-muted)]">Next owner/role: <strong className="text-[var(--color-ink)]">{nextOwner}</strong></p>}
        </div>
        {primaryAction && <PrimaryButton onClick={primaryAction.onClick} disabled={busy}>{primaryAction.label}</PrimaryButton>}
      </div>

      <details className="rounded border border-[var(--color-border)] px-3 py-2" data-testid="assessment-supporting-detail">
        <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">Findings and supporting detail</summary>
        <div className="space-y-3 border-t border-[var(--color-border)] pt-3">
          {additionalReasons.length > 0 && (
            <section aria-label="Assessment reasons" className="space-y-1">
              <h4 className="text-[12px] font-semibold text-[var(--color-ink)]">Assessment reasons</h4>
              <ul className="list-disc space-y-1 ps-5 text-[13px] leading-5 text-[var(--color-ink-muted)]">
                {additionalReasons.map((reason, index) => <li key={`${index}-${reason}`}>{reason}</li>)}
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
          {canReassess && (
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
      className={`min-h-[44px] w-fit rounded px-4 py-2 text-[13px] font-semibold tracking-wide text-white transition disabled:cursor-not-allowed disabled:opacity-40 ${
        danger ? "bg-[var(--color-danger)] hover:opacity-90" : "bg-[var(--color-ink)] hover:opacity-90"
      }`}
    >
      {children}
    </button>
  );
}

type ActionResult = { label: string; data: unknown; ok: boolean; status: number; obligationId: string | null };
type StageCompletionReceipt = { obligationId: string; message: string };

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

function DeterministicAssuranceSummary({ detail, continueToPayment }: { detail: ObligationDetail; continueToPayment?: () => void }) {
  const evidence = detail.assurance_evidence;
  const available = evidence?.state === "AVAILABLE_CURRENT_BINDING" || evidence?.state === "AVAILABLE_HISTORICAL";
  const current = evidence?.state === "AVAILABLE_CURRENT_BINDING";
  const controls = available ? evidence.control_results : [];
  const failedControls = current ? controls.filter((control) => control.result !== "PASS") : [];
  const status = detail.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution
    ? "Authorization recorded · Assurance failed/blocked; no PASS assurance, usable PAE, or execution is available."
    : assuranceStateSummary(evidence);

  return (
    <section aria-label="Deterministic assurance result" className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4" data-testid="assurance-result-card">
      <div>
        <h3 className="text-[16px] font-semibold text-[var(--color-ink)]">Deterministic assurance</h3>
        <p className="mt-1 text-[14px] font-semibold text-[var(--color-ink)]">{status}</p>
      </div>
      <p className="text-[12px] text-[var(--color-ink-muted)]">Deterministic controls, not AI, grant or deny release authority.</p>
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
      {continueToPayment && <PrimaryButton onClick={continueToPayment}>Continue to Payment</PrimaryButton>}
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
  if (detail.execution?.status === "SETTLED") return "Testnet execution is reconciled. The real-world payable remains outstanding in the source record.";
  if (detail.execution?.status === "FAILED") return "The provider attempt failed. Review current evidence; no retry is available from this instruction.";
  if (detail.execution?.status === "BLOCKED") return "Execution is blocked. No successful settlement is established by this record.";
  if (detail.execution_kill_switched) return "A payment stop is active. No execution is permitted.";
  const authority = detail.truth.tameion_control_truth.execution_release_authority;
  const paeState = detail.truth.tameion_control_truth.pae_state;
  if (["BLOCKED", "REVOKED", "EXPIRED"].includes(authority) || ["REVOKED", "EXPIRED"].includes(paeState)) {
    const reason = paeState === "REVOKED" || authority === "REVOKED" ? "revoked"
      : paeState === "EXPIRED" || authority === "EXPIRED" ? "expired" : "blocked";
    return `Payment authority is ${reason}. This instruction is unavailable for submission; re-establish current payment authority before any new execution packet.`;
  }
  if (detailState === "stale") return "Payment details are stale. Refresh current status before relying on or acting on this instruction.";
  if (!detail.pae_sealed) return "No sealed payment instruction is available. Complete the existing authorization and assurance steps before execution.";
  if (exactPacketSubmissionReady) return "The exact testnet instruction is ready for confirmation. Final pre-send checks still apply.";
  if (detail.execution_gate === "LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION") return "The sealed instruction is awaiting exact-packet authorization. Submission remains unavailable until the current gate opens.";
  return currentAuthorityGuidance(detail) ?? "The instruction is sealed, but current execution checks are not satisfied. Refresh and re-establish current payment authority before submission.";
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
        <summary className="min-h-11 cursor-pointer py-2 font-semibold text-[var(--color-ink-muted)]">Evidence &amp; technical details</summary>
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
  const [viewedStage, setViewedStage] = useState<LifecycleStage>("Obligation");
  const [mobileStagesOpen, setMobileStagesOpen] = useState(false);
  const [detail, setDetail] = useState<ObligationDetail | null>(null);
  const [detailIsStale, setDetailIsStale] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const [stageCompletionReceipt, setStageCompletionReceipt] = useState<StageCompletionReceipt | null>(null);
  const [displayedAssessment, setDisplayedAssessment] = useState<AssessmentReviewSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const activeRunCount = useRef(0);
  const assessmentRequestKey = useRef<{ obligationId: string; key: string } | null>(null);
  const detailGeneration = useRef(0);
  const selectedRef = useRef("");
  const selectionGeneration = useRef(0);
  const stageHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusConfirmedStageRef = useRef(false);

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
    if (!focusConfirmedStageRef.current) return;
    focusConfirmedStageRef.current = false;
    stageHeadingRef.current?.focus();
  }, [viewedStage, panel]);

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
    setViewedStage("Obligation");
    setDisplayedAssessment(null);
    setDetail(null);
    setDetailIsStale(false);
    setDetailError(null);
    setStageCompletionReceipt(null);
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
    const priorPosition = authoritativeLifecyclePosition(targetId, detailState, detail);
    const generation = selectionGeneration.current;
    const stillCurrent = () => isCurrentGeneration(generation, selectionGeneration.current) && isSameIdentity(selectedRef.current, targetId);
    activeRunCount.current += 1;
    setBusy(true);
    setStageCompletionReceipt(null);
    let actionSucceeded = false;
    try {
      const result = await action();
      if (!stillCurrent()) return;
      actionSucceeded = result.ok;
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
      if (stillCurrent()) {
        const refreshed = await refreshDetail(targetId, true);
        if (actionSucceeded && stillCurrent() && refreshed) {
          const confirmedPosition = authoritativeLifecyclePosition(targetId, "loaded", refreshed);
          if (confirmedPosition !== priorPosition) showCurrentStageAfterRefresh(refreshed);
          const receiptMessage = label === "assess" && refreshed.current_assessment?.obligation_id === targetId &&
              refreshed.current_assessment.aggregate_version === String(refreshed.aggregate.aggregate_version)
            ? "Assessment is now available from refreshed obligation detail."
            : label === "proxy preflight" && refreshed.settlement_proxy?.preflight.obligation_id === targetId
              ? "Arc Testnet settlement proxy preparation is recorded. A fresh assessment is required before authorization."
              : label === "approve" && refreshed.aggregate.state === "AUTHORIZED"
                ? "Authorization is recorded. Assurance remains a separate release control."
                : label === "execute" && refreshed.execution
                  ? "An execution record is available. Continue with read-only reconciliation for this same instruction."
                  : null;
          if (receiptMessage) setStageCompletionReceipt({ obligationId: targetId, message: receiptMessage });
        }
      }
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
  const queueDueDate = (obligation: ObligationSummary) => {
    if (obligation.obligation_id === selectedId && detail?.record.obligation_id === selectedId) {
      return sourceText(detail.record, "effective_due_date") !== "Not captured"
        ? sourceText(detail.record, "effective_due_date")
        : sourceText(detail.record, "due_date");
    }
    return obligation.due_date ?? "Due date unavailable";
  };
  const assessedCount = obligations.filter((o) => o.assessed).length;
  const payCandidateCount = obligations.filter((o) => o.decision === "PAY").length;
  const allAssessed = obligations.length > 0 && assessedCount === obligations.length;
  const listPresentation = obligationListState(obligationsStatus, obligationsError, obligations.length);
  const detailState: DetailState = detail && detailIsStale ? "stale" : detail ? "loaded" : detailError ? "failed" : selectedId ? "loading" : "none";
  const killSwitchView = killSwitchPresentation(detailState, detail?.execution_kill_switched);
  const routeAssuranceReady = isRouteAssuranceReady(detail);
  const exactPacketSubmissionReady = Boolean(detailState === "loaded" && !detailIsStale && selectedId && detail &&
    detail.record.obligation_id === selectedId && detail.pae_sealed === true &&
    detail.settlement_proxy?.preflight.obligation_id === selectedId &&
    detail.execution_packet?.packet && detail.execution_packet.packet_sha256 && detail.sealed_pae_instruction_hash &&
    detail.execution === null && detail.execution_gate === "PRIME_AUTHORIZED_EXACT_PACKET" &&
    detail.truth.tameion_control_truth.execution_release_authority === "TAMEION_PAE_REVERIFY_REQUIRED" &&
    detail.execution_kill_switched === false);
  const exactPacketConfirmationIdentity = exactPacketSubmissionReady && detail && selectedId
    ? JSON.stringify([selectedId, detail.execution_packet!.packet_sha256, detail.sealed_pae_instruction_hash])
    : null;
  const executionConfirmation = useExecutionConfirmation(exactPacketConfirmationIdentity);
  const currentPacketAwaitingPrime = Boolean(detailState === "loaded" && !detailIsStale && selectedId && detail &&
    detail.record.obligation_id === selectedId && detail.pae_sealed === true &&
    detail.settlement_proxy?.preflight.obligation_id === selectedId &&
    detail.execution_packet?.packet && detail.execution_packet.packet_sha256 && detail.sealed_pae_instruction_hash &&
    detail.execution === null && detail.execution_gate === "LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION" &&
    detail.truth.tameion_control_truth.execution_release_authority === "TAMEION_PAE_REVERIFY_REQUIRED" &&
    detail.execution_kill_switched === false);
  const noCurrentExactExecutionPacket = Boolean(detailState === "loaded" && detail?.pae_sealed && detail.settlement_proxy &&
    !detail.execution && (!detail.execution_packet || !detail.sealed_pae_instruction_hash ||
      detail.execution_gate === "LOCKED_UNTIL_CURRENT_AUTHORIZATION"));
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
  const candidatePresentationContext = Boolean(detailState === "loaded" && detail && !detail.pae_sealed && !detail.execution &&
    detail.aggregate.state !== "AUTHORIZED");
  const authoritativePayCandidate = listPresentation === "ready" && solePayCandidateId
    ? obligations.find((obligation) => obligation.obligation_id === solePayCandidateId && obligation.assessed && obligation.decision === "PAY") ?? null
    : null;
  const currentPayCandidateUnknown = Boolean(candidatePresentationContext && hasCurrentPayAssessment && !detailIsStale && !authoritativePayCandidate);
  const currentPayIsNonWinner = Boolean(candidatePresentationContext && hasCurrentPayAssessment && !detailIsStale && authoritativePayCandidate && authoritativePayCandidate.obligation_id !== selectedId);
  const currentPayIsSelectedWinner = Boolean(candidatePresentationContext && hasCurrentPayAssessment && !detailIsStale && authoritativePayCandidate?.obligation_id === selectedId);
  const candidateBusinessLabel = authoritativePayCandidate
    ? `${authoritativePayCandidate.service_category.replaceAll("_", " ").toLowerCase()} · ${authoritativePayCandidate.amount} ${authoritativePayCandidate.currency}${authoritativePayCandidate.due_date ? ` · due ${authoritativePayCandidate.due_date}` : ""}`
    : undefined;
  const assessmentPaymentEligibility = currentPayIsNonWinner && candidateBusinessLabel
    ? {
        summary: "PAY is recorded; this is not the selected payment candidate for the demo.",
        candidate: candidateBusinessLabel,
        reason: "Earliest effective due date among PAY recommendations.",
        selectionDetail: "The existing deterministic rule selects the earliest effective due date among PAY recommendations, with obligation ID as the tie-break.",
        ...(authoritativePayCandidate?.route_assurance_status === "Route assurance not ready"
          ? { routeNote: "Authorization is not available until the selected candidate also has current payment-route assurance." }
          : {}),
      }
    : currentPayCandidateUnknown
      ? {
          summary: listPresentation !== "ready"
            ? "The PAY recommendation is recorded, but the selected payment candidate is uncertain because the current obligation queue is unavailable."
            : !allAssessed
              ? "The PAY recommendation is recorded, but the selected payment candidate is not determined while assessment coverage is incomplete."
              : "The PAY recommendation is recorded, but no selected payment candidate is confirmed in the current queue.",
        }
      : currentPayIsSelectedWinner && !routeAssuranceReady
        ? {
        summary: "Selected payment candidate; current payment-route assurance is not ready, so authorization is unavailable.",
          }
        : null;
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
        if (detail.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution) return "Authorization recorded · Assurance failed/blocked; no PASS assurance, usable PAE, or execution is available.";
        if (detail.assurance_evidence?.state === "AVAILABLE_CURRENT_BINDING" || detail.assurance_evidence?.state === "AVAILABLE_HISTORICAL" || detail.assurance_evidence?.state === "INVALID" || detail.assurance_evidence?.state === "UNAVAILABLE") {
          return assuranceStateSummary(detail.assurance_evidence);
        }
        if (detail.pae_sealed) return "PAE is sealed; current assurance evidence is unavailable.";
        if (hasCurrentPayAssessment && routeAssuranceReady) return "Final assurance runs after human approval";
        return "Final assurance not run";
      case "Payment":
        if (detail.settlement_proxy && detail.execution?.status === "SETTLED") return `Arc Testnet proxy execution reconciled; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "UNKNOWN") return "Outcome unknown — reconcile this same intent; resubmission blocked";
        if (detail.settlement_proxy && ["SUBMITTING", "SUBMITTED"].includes(detail.execution?.status ?? "")) return "Submitted to Arc Testnet provider; reconciliation is pending";
        if (detail.settlement_proxy && detail.execution?.status === "FAILED") return `Arc Testnet provider attempt failed; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "BLOCKED") return reconciliationLeadLine("loaded", detail.execution, true, sourcePayableState(detail));
        if (detail.settlement_proxy && detail.execution_kill_switched) return "Execution suspended by active kill switch; no submission is permitted";
        if (detail.settlement_proxy && invalidReleaseAuthority && (detail.pae_sealed || detail.execution)) return `Execution record unavailable; sealed PAE is ${invalidPaeState}. Execution history unavailable; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.pae_sealed && !detail.execution &&
            (!detail.execution_packet || !detail.sealed_pae_instruction_hash || detail.execution_gate === "LOCKED_UNTIL_CURRENT_AUTHORIZATION")) {
          return "No current exact execution packet is available. Payment authority must be re-established before submission.";
        }
        if (detail.settlement_proxy && detail.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution) return "Authorization recorded; assurance failed or blocked; no usable PAE or execution";
        if (detail.settlement_proxy && detail.pae_sealed) return "Arc Testnet proxy prepared; execution awaits separate exact-packet gate";
        if (detail.settlement_proxy && (!hasCurrentAssessment || !currentAssessment)) return "Arc Testnet proxy prepared; fresh assessment required before authorization";
        if (detail.settlement_proxy) return "Arc Testnet proxy prepared; final assessment and human authorization required";
        if (detail.execution && detail.truth.settlement_truth.runtime === "SIMULATED") {
          return `Simulated execution ${judgeReadableState(detail.execution.status)}; no Arc payment binding`;
        }
        return "Arc Testnet proxy not prepared for this obligation";
      case "Reconciliation":
        if (detail.settlement_proxy && detail.execution?.status === "SETTLED") return `TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "UNKNOWN") return "Read-only reconciliation pending; no resubmission";
        if (detail.settlement_proxy && ["SUBMITTING", "SUBMITTED"].includes(detail.execution?.status ?? "")) return `Submission recorded; reconcile this same intent; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "FAILED") return `Arc Testnet provider attempt failed; source payable remains ${sourcePayableState(detail)}`;
        if (detail.settlement_proxy && detail.execution?.status === "BLOCKED") return reconciliationLeadLine("loaded", detail.execution, true, sourcePayableState(detail));
        if (detail.settlement_proxy && invalidReleaseAuthority && (detail.pae_sealed || detail.execution)) return `Execution record unavailable; sealed PAE is ${invalidPaeState}. Execution history unavailable; source payable remains ${sourcePayableState(detail)}`;
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
    ? `Current stage: ${viewedStage}. Step ${viewedStageIndex + 1} of 6.`
    : `Viewed stage: ${viewedStage}. Current lifecycle position: ${currentLifecycleStage}. Step ${viewedStageIndex + 1} of 6.`;
  const currentPositionBlocked = detailState !== "loaded" || detailIsStale || !detail ||
    (currentLifecycleStage === "Assurance" && !detail.pae_sealed) ||
    (currentLifecycleStage === "Payment" && (
      detail.execution_kill_switched === true ||
      ["BLOCKED", "REVOKED", "EXPIRED"].includes(detail.truth.tameion_control_truth.execution_release_authority)
    )) ||
    (currentLifecycleStage === "Reconciliation" && ["FAILED", "BLOCKED"].includes(detail?.execution?.status ?? ""));
  const canContinueToAssessment = currentLifecycleStage === "Obligation" && detailState === "loaded" &&
    Boolean(detail && hasExpectedObligationIdentity(detail, selectedId));
  const canContinueToAuthorization = currentLifecycleStage === "Assessment" && detailState === "loaded" && !detailIsStale &&
    hasCurrentPayAssessment && Boolean(authorizationAssessment) && allAssessed && solePayCandidateId === selectedId &&
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
    if (stage === "Authorization") return detailState === "loaded" ? lifecycleStatus(stage) : "Requires a current PAY review, sole-winner, proxy and route checks.";
    if (stage === "Assurance") return "Requires exact human authorization.";
    if (stage === "Payment") return "Requires current PASS assurance and a usable sealed PAE.";
    if (stage === "Reconciliation") return "Requires an actual provider attempt or execution record.";
    return "Requires the selected source obligation to be current.";
  };
  const currentBlockedReason = currentLifecycleStage === "Assessment"
    ? currentAssessment?.decision === "PAY"
      ? `${lifecycleStatus("Assessment")} · ${!routeAssuranceReady ? "Payment-route evidence is not ready; authorization remains locked." : "Current PAY, review, sole-winner and proxy prerequisites are incomplete."}`
      : lifecycleStatus("Assessment")
    : lifecycleStatus(currentLifecycleStage);

  const currentWorkspaceGuidance = detailState === "loaded" && detail?.aggregate.state === "CANCELLED"
    ? "This obligation was cancelled. No authorization or execution action is available."
    : currentPayIsNonWinner
    ? "This PAY recommendation is recorded, but this obligation is not the selected payment candidate for the demo."
    : currentPayCandidateUnknown
      ? assessmentPaymentEligibility?.summary ?? "The selected payment candidate cannot currently be confirmed."
    : !selectedId
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
      : detail?.settlement_proxy && detail.execution_kill_switched === true
        ? "Execution is suspended while a kill switch is active. No submission action is available."
      : detail?.aggregate.state === "CANCELLED"
        ? "This obligation was cancelled. No authorization or execution action is available."
      : detail?.settlement_proxy && (detail.pae_sealed || detail.execution) && ["BLOCKED", "REVOKED", "EXPIRED"].includes(detail.truth.tameion_control_truth.execution_release_authority)
        ? `Execution record is unavailable. The sealed Arc Testnet payment authority is ${["REVOKED", "EXPIRED"].includes(detail.truth.tameion_control_truth.pae_state) ? detail.truth.tameion_control_truth.pae_state.toLowerCase() : detail.truth.tameion_control_truth.execution_release_authority.toLowerCase()}; execution history is unavailable. The source payable remains ${sourcePayableState(detail)}.`
      : noCurrentExactExecutionPacket
        ? "No current exact execution packet is available. Payment authority must be re-established before submission."
      : detail?.settlement_proxy && currentAssessment && !hasCurrentAssessment
        ? "The previous assessment is stale for this version. Run a fresh assessment for the prepared Arc Testnet proxy before authorization review."
      : detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution
          ? "Authorization is recorded, but assurance failed or is blocked; no PASS assurance, usable PAE, or execution is available. No reassessment or further authorization action is available."
        : detail?.pae_sealed
          ? detail.settlement_proxy
            ? "Approved instruction is sealed for the Arc Testnet settlement proxy. Execution remains subject to the exact-packet gate and final pre-send checks."
            : "Blocker: this genuine obligation has no Arc payment binding; the separate fixed testnet intent does not represent it."
          : detail?.settlement_proxy && (!hasCurrentAssessment || !currentAssessment)
            ? "Next step: run a fresh assessment for the prepared Arc Testnet proxy; a PAY recommendation is advisory."
          : proxyPreparationReady
            ? "Current PAY is eligible for read-only proxy preparation; fresh assessment and review follow, with route assurance still required."
            : !hasCurrentAssessment || !currentAssessment
              ? "This obligation has no current advisory assessment."
              : !allAssessed
                ? "Other obligations still need assessment before authorization review."
                : currentAssessment.decision !== "PAY"
                  ? `Blocked: current assessment is ${currentAssessment.decision}; resolve its findings before reassessment.`
                  : !authorizationAssessment
                    ? routeAssuranceReady
                      ? "Next step: review the current PAY assessment before authorization."
                      : "Next step: review the current PAY assessment; payment-route assurance is not ready and authorization remains locked."
                    : !routeAssuranceReady
                      ? "Blocker: payment-route assurance is not ready; authorization remains locked."
                      : "Next step: an authorized human may approve this exact reviewed obligation.";

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
              ? "Authorization is recorded. Assurance failed or is blocked; no usable PAE or execution is available. Reassessment and further authorization are unavailable here."
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
  const currentException = Boolean(selectedId && (
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
      noCurrentExactExecutionPacket || detail?.execution_kill_switched ||
      ["BLOCKED", "REVOKED", "EXPIRED"].includes(detail?.truth.tameion_control_truth.execution_release_authority ?? ""),
    )) ||
    (viewedStage === "Assurance" && Boolean(detail?.aggregate.state === "AUTHORIZED" && !detail.pae_sealed && !detail.execution)) ||
    (viewedStage === "Assessment" && Boolean(
      (Boolean(currentAssessment) && !hasCurrentAssessment) ||
      detail?.aggregate.state === "CANCELLED" ||
      ["HOLD", "ESCALATE"].includes(currentAssessment?.decision ?? "") ||
      (detail?.settlement_proxy && !routeAssuranceReady && !detail.pae_sealed && !detail.execution),
    ));
  const showExceptionRecovery = currentException && exceptionStageVisible;
  const activityItems = detail && detailState === "loaded" ? availableEvidenceItems(detail) : [];
  const assessmentCurrentState = !detail || detailState !== "loaded"
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
  let workspaceAction: WorkspaceAction | null = null;
  if (!selectedId && obligations.length > 0) {
    workspaceAction = { label: "Choose an obligation", actor: "You", run: () => setMobileQueueOpen(true) };
  } else if (selectedId && (detailState === "stale" || detailState === "failed")) {
    workspaceAction = { label: "Refresh current status", actor: "You · read-only refresh", run: () => void refreshDetail(selectedId, true) };
  } else if (viewedStage === "Obligation" && hasCurrentAssessment && currentAssessment && !detail?.pae_sealed && !detail?.execution) {
    workspaceAction = { label: "View Assessment", actor: "You · read-only navigation", run: () => showStage("Assessment") };
  } else if (viewedStage === "Obligation" && currentLifecycleStage !== "Obligation" && !(currentLifecycleStage === "Assessment" && !hasCurrentAssessment)) {
    workspaceAction = { label: `View current stage · ${currentLifecycleStage}`, actor: "You · read-only navigation", run: () => showStage(currentLifecycleStage) };
  } else if ((viewedStage === "Payment" || viewedStage === "Reconciliation") && detailState === "loaded" && detail?.settlement_proxy && ["UNKNOWN", "SUBMITTING", "SUBMITTED"].includes(detail.execution?.status ?? "")) {
    workspaceAction = { label: "Reconcile this same intent", actor: "Unassigned · read-only reconciliation", run: () => { showStage("Reconciliation"); void refreshDetail(selectedId, true); } };
  } else if (viewedStage !== "Reconciliation" && detailState === "loaded" && detail?.execution?.status === "SETTLED") {
    workspaceAction = { label: "View reconciliation receipt", actor: "Reconciliation record", run: () => showStage("Reconciliation") };
  } else if (viewedStage === "Assessment" && currentPayIsNonWinner && authoritativePayCandidate) {
    workspaceAction = { label: "View selected payment candidate", actor: "You · read-only navigation", run: () => {
      setSelectedId(authoritativePayCandidate.obligation_id);
      showStage("Obligation");
      setLastResult(null);
      setDisplayedAssessment(null);
      setMobileQueueOpen(false);
    } };
  } else if (viewedStage === "Assessment" && currentPayCandidateUnknown) {
    workspaceAction = { label: "Back to obligations", actor: "You · read-only navigation", run: () => {
      showStage("Obligation");
      setMobileQueueOpen(true);
    } };
  } else if (viewedStage === "Payment" && detailState === "loaded" && detail?.pae_sealed && detail.settlement_proxy && detail.execution === null && !exactPacketSubmissionReady) {
    workspaceAction = null;
  } else if (viewedStage === "Payment" && detailState === "loaded" && detail?.pae_sealed && detail.settlement_proxy && exactPacketSubmissionReady) {
    workspaceAction = { label: "Execute Test Payment", actor: "Authorized operator · exact packet gate passed", exactConfirmation: true, run: () => {
      if (!exactPacketSubmissionReady || !exactPacketConfirmationIdentity || !executionConfirmation.isBound || !executionConfirmation.matchesExact ||
          !selectedId || detail.record.obligation_id !== selectedId || detail.settlement_proxy?.preflight.obligation_id !== selectedId ||
          !detail.sealed_pae_instruction_hash || !detail.execution_packet?.packet_sha256) return;
      void run("execute", () => postJson(`/api/obligations/${selectedId}/execute`, {
        expected_version: detail.aggregate.aggregate_version,
        packet_sha256: detail.execution_packet!.packet_sha256,
        pae_instruction_hash: detail.sealed_pae_instruction_hash,
        confirmation: executionConfirmation.value,
      }));
    } };
  } else if (viewedStage === "Assessment" && proxyPreparationReady && detail) {
    workspaceAction = { label: "Prepare Arc Testnet settlement proxy", actor: "Authorized operator", run: () => {
      void run("proxy preflight", () => postJson("/api/internal/demo/real-testnet-payment/preflight", {
        obligation_id: selectedId,
        expected_version: detail.aggregate.aggregate_version,
      }));
    } };
  } else if (assessmentAction === "assess" && (viewedStage === "Obligation" || viewedStage === "Assessment")) {
    workspaceAction = { label: "Run AI Assessment", actor: "Finance Agent", run: () => { void runAssessment(); } };
  } else if (viewedStage === "Assessment" && assessmentAction === "review") {
    workspaceAction = { label: "Review current PAY assessment", actor: "Human reviewer · unassigned", run: () => { reviewCurrentAssessment(); showStage("Assessment"); } };
  } else if (viewedStage === "Authorization" && detailState === "loaded" && detail?.settlement_proxy && authorizationAssessment?.decision === "PAY" && routeAssuranceReady && !detail.pae_sealed && !detail.execution) {
    workspaceAction = { label: "Authorize payment", actor: "Authorized approver · identity not shown", run: () => {
      if (detailState !== "loaded" || !detail?.settlement_proxy || authorizationAssessment?.decision !== "PAY" || !routeAssuranceReady) return;
      void run("approve", () => postJson(`/api/obligations/${selectedId}/approve`, {
        expected_version: Number(authorizationAssessment.aggregate_version),
        reviewed_assessment_id: authorizationAssessment.assessment_id,
        reviewed_assessment_hash: authorizationAssessment.assessment_hash,
      }));
    } };
  }
  const recoveryOwner = workspaceAction?.actor ?? (detail?.execution?.status === "UNKNOWN"
    ? "Unassigned · read-only reconciliation"
    : firstUnmetPrerequisite?.startsWith("Payment-route assurance")
      ? "External-evidence owner unavailable"
      : "Unassigned · no permitted product action is available");
  const recoveryNextAction = workspaceAction?.label ?? (detail?.execution?.status === "FAILED"
    ? "No retry action is available here. Review current provider evidence and payment authority before any new instruction."
    : detail?.execution?.status === "BLOCKED" || noCurrentExactExecutionPacket
      ? "No submission action is available. Re-establish current payment authority before any new execution packet."
      : "No product action is available from the currently recorded state.");
  const exceptionRecoveryCard = showExceptionRecovery ? (
    <section aria-label="Exception recovery" className="space-y-2 rounded border-s-4 border-s-[var(--color-warning)] bg-[var(--color-surface)] px-3 py-3">
      <h4 className="text-[13px] font-semibold text-[var(--color-ink)]">Recovery guidance</h4>
      {(detailState === "failed" || detailState === "stale") && <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]"><strong>Current issue:</strong> {detailState === "stale" ? "Selected obligation status is stale; refresh before taking action." : "Selected obligation status is unavailable; retry before taking action."}</p>}
      <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]"><strong>Submission evidence:</strong> {detail ? submissionEvidenceCopy(detail) : "Submission and provider status are unavailable until current detail is refreshed."}</p>
      {detail && currentAuthorityGuidance(detail) && <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]">{currentAuthorityGuidance(detail)}</p>}
      <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]"><strong>Next action:</strong> {recoveryNextAction}</p>
      <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]"><strong>Next owner:</strong> {recoveryOwner}</p>
    </section>
  ) : null;
  const stageCompletionReceiptView = stageCompletionReceipt?.obligationId === selectedId ? (
    <p role="status" aria-label="Stage completion receipt" aria-live="polite" className="rounded border border-[var(--color-success)] px-3 py-2 text-[12px] text-[var(--color-success)]">
      {stageCompletionReceipt.message}
    </p>
  ) : null;
  const assessmentResult = detailState === "loaded" && hasCurrentAssessment && detail?.aggregate.state !== "CANCELLED" ? currentAssessment : null;
  const assessmentRemediation = assessmentResult?.race?.remediation ?? [];
  const assessmentNextStep = showContinueToAuthorization
    ? "Continue to Authorization to review this exact instruction; navigation does not approve or submit it."
    : currentPayIsNonWinner
      ? "View the selected payment candidate for this demo. Viewing it does not change the candidate selection."
    : currentPayCandidateUnknown
      ? "Return to obligations while the selected payment candidate remains unconfirmed."
    : assessmentResult?.decision === "PAY"
    ? !assessmentResult.race
      ? "This recorded PAY recommendation has no review evidence in this detail; authorization remains locked."
      : proxyPreparationReady
      ? "Prepare the Arc Testnet proxy; a fresh assessment is required afterward, before authorization review."
      : workspaceAction?.label === "Review current PAY assessment"
        ? "Review this advisory recommendation before any separate human authorization decision."
        : workspaceAction?.label === "Authorize payment"
          ? "An authorized approver may review this exact obligation."
          : !allAssessed
            ? "Assess the remaining genuine obligations before authorization review."
            : !routeAssuranceReady
              ? "Complete current payment-route assurance before authorization review."
              : assessmentNextAction("PAY", allAssessed).replace(/^Next action:\s*/, "")
    : assessmentRemediation.length > 0
      ? [...new Set(assessmentRemediation.map((item) => item.required_action))].join(" ")
      : assessmentResult
        ? assessmentNextAction(assessmentResult.decision, allAssessed).replace(/^Next action:\s*/, "")
        : "Run AI Assessment from the current-stage action above.";
  const assessmentOwnerRoles = assessmentResult?.decision === "ESCALATE"
    ? assessmentRemediation.map((item) => item.escalation_target).filter((role): role is string => Boolean(role))
    : assessmentResult?.decision === "HOLD"
      ? assessmentRemediation.map((item) => item.owner_role)
      : workspaceAction ? [workspaceAction.actor] : [];
  const uniqueAssessmentOwnerRoles = [...new Set(assessmentOwnerRoles)];
  const assessmentNextOwner = uniqueAssessmentOwnerRoles.length === 1 ? uniqueAssessmentOwnerRoles[0] : null;

  const previousViewedStage = viewedStageIndex > 0 ? PAYMENT_LIFECYCLE_STAGES[viewedStageIndex - 1] : null;
  const canGoBack = Boolean(previousViewedStage && stageState(previousViewedStage) !== "UPCOMING");
  const continueTarget = panel !== "report" && viewedStage === currentLifecycleStage && !showContinueToAuthorization && !showContinueToPayment ? nextAvailableStage : null;
  const visibleWorkspaceAction = showContinueToAuthorization ? null : workspaceAction;
  const assessmentOwnsCurrentStage = panel === "assessment" && currentLifecycleStage === "Assessment" && Boolean(assessmentResult) && detail?.aggregate.state !== "CANCELLED";
  const stageOwnsCurrentBusinessCard = detailState === "loaded" && Boolean(detail) && (
    (panel === "authorization" && viewedStage === "Authorization") ||
    (panel === "assurance" && (viewedStage === "Assurance" || viewedStage === "Payment")) ||
    (panel === "reconciliation" && viewedStage === "Reconciliation")
  );
  const assessmentCardPrimaryAction = showContinueToAuthorization
    ? { label: "Continue to Authorization", onClick: () => showStage("Authorization") }
    : visibleWorkspaceAction && !visibleWorkspaceAction.exactConfirmation
      ? { label: visibleWorkspaceAction.label, onClick: visibleWorkspaceAction.run }
      : null;
  const stageButton = (stage: LifecycleStage, mobile = false) => {
    const status = stageState(stage);
    const upcoming = status === "UPCOMING";
    const reason = upcoming ? stageLockReason(stage) : status === "BLOCKED" ? currentBlockedReason : null;
    const statusId = `${mobile ? "mobile-" : ""}lifecycle-${stage.toLowerCase()}`;
    const reasonId = `${mobile ? "mobile-" : ""}lifecycle-reason-${stage.toLowerCase()}`;
    const selectedView = viewedStage === stage && panel !== "report";
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
    <main dir="ltr" className="mx-auto flex min-h-screen max-w-[1440px] flex-col gap-2 px-4 py-3 md:gap-3 md:px-6 md:py-3">
      <header className="-mx-4 flex flex-col items-start justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-2 sm:flex-row sm:items-baseline md:-mx-6 md:px-6">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
            Tameion
          </p>
          <h1 className="text-lg font-semibold text-[var(--color-ink)] sm:text-xl">Assured Payment — Command Center</h1>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-[300px_minmax(0,1fr)] md:gap-3">
        <aside className="order-1 min-w-0 md:order-1 md:border-e md:pe-4">
          <button
            type="button"
            aria-expanded={mobileQueueOpen}
            aria-controls="genuine-obligation-queue"
            onClick={() => setMobileQueueOpen((open) => !open)}
            className="mb-3 min-h-11 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-start text-[13px] font-semibold text-[var(--color-ink)] md:hidden"
          >
            {mobileQueueOpen ? "Close obligation list" : `Switch obligation${viewedStage !== "Assessment" && selected ? ` · ${selected.service_category.replaceAll("_", " ").toLowerCase()}` : ""}`}
          </button>
          <div id="genuine-obligation-queue" className={mobileQueueOpen ? "block" : "hidden md:block"}>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            Genuine obligations
          </p>
          <p className="mb-2 text-[12px] text-[var(--color-ink)]">{listPresentation === "ready" ? `${obligations.length} obligations` : queueHeaderLabel(listPresentation, reportSummary)}</p>
          <ul className="border-y border-[var(--color-border)]">
            {obligations.map((o) => {
              const workflowRecorded = Boolean(o.pae_sealed || o.aggregate_state === "AUTHORIZED" || o.execution_status);
              const statusColor = o.assessed
                ? o.decision === "ESCALATE"
                  ? "var(--status-hold-text)"
                  : o.decision === "HOLD"
                    ? "var(--status-hold-text)"
                    : o.decision === "PAY"
                      ? "var(--color-ink)"
                      : "var(--color-ink)"
                : "var(--color-ink-muted)";
              return (
                <li key={o.obligation_id}>
                  <button
                    data-obligation-id={o.obligation_id}
                    onClick={() => {
                      setSelectedId(o.obligation_id);
                      if (panel === "report") setViewedStage("Obligation");
                      else showStage("Obligation");
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
                        aria-label={o.assessed ? "assessment recorded" : workflowRecorded ? "workflow recorded" : "assessment required"}
                        title={o.assessed ? `Assessment complete: ${o.decision} recommendation` : workflowRecorded ? "Workflow recorded; a current assessment is not available." : "Assessment required"}
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: o.assessed || workflowRecorded ? "var(--color-ink-muted)" : "var(--color-border-strong)" }}
                      />{" "}{o.service_category.replaceAll("_", " ").toLowerCase()}
                    </span>
                    <span className="col-span-1 tabular text-start text-[15px] font-semibold text-[var(--color-ink)]">
                      {o.amount} {o.currency}<span className="font-normal text-[12px] text-[var(--color-ink-muted)]"> · {queueDueDate(o)}</span>
                    </span>
                    <span className="col-span-1 text-end text-[11px] font-semibold" style={{ color: statusColor }}>
                      {o.assessed
                        ? o.decision === "PAY" ? "PAY recommendation (advisory)" : `${o.decision ?? "—"} assessment`
                        : workflowRecorded ? "Workflow recorded" : "Assessment required"}
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
          <section aria-label={detailState === "loaded" ? "Genuine obligation workspace" : undefined}>
            <section aria-label="Selected source obligation" className="grid gap-3 border-b border-[var(--color-border)] pb-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">Selected obligation</p>
                <h2 className="mt-1 break-words text-[21px] font-semibold leading-7 text-[var(--color-ink)] md:text-[25px]">
                  {detailState === "loaded" && detail && sourceText(detail.record, "beneficiary_name") !== "Not captured"
                    ? sourceText(detail.record, "beneficiary_name")
                    : selected.service_category.replaceAll("_", " ").toLowerCase()}
                </h2>
              </div>
              <div className="sm:text-end">
                  <p className="tabular text-[23px] font-semibold leading-7 text-[var(--color-ink)]"><bdi dir="ltr">{detailState === "loaded" && detail ? `${detail.record.amount} ${detail.record.currency}` : `${selected.amount} ${selected.currency}`}</bdi></p>
                </div>
              <div className="sm:col-span-2">
                {detailState === "loaded" && detail && (
                  <>
                    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
                      <p><strong>{sourcePayableState(detail)}</strong></p>
                      <p><span className="text-[var(--color-ink-muted)]">Due </span><strong>{sourceText(detail.record, "effective_due_date") !== "Not captured" ? sourceText(detail.record, "effective_due_date") : sourceText(detail.record, "due_date")}</strong></p>
                    </div>
                    {viewedStage !== "Assessment" && sourceServiceContext(detail.record) && <p data-testid="source-service-context" className="mt-1 text-[12px] leading-4 text-[var(--color-ink-muted)]">{sourceServiceContext(detail.record)}</p>}
                    {viewedStage === "Authorization" && <p className="mt-1 text-[11px] leading-4 text-[var(--color-warning)]">
                      ARC TESTNET · {detail.settlement_proxy ? "controlled settlement proxy" : "no controlled proxy"} · real-world payable remains {sourcePayableState(detail)}.
                    </p>}
                    {viewedStage === "Authorization" && detail.settlement_proxy && <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">
                      Testnet intent: <bdi dir="ltr" className="tabular font-semibold">{detail.settlement_proxy.preflight.amount} {detail.settlement_proxy.preflight.asset}</bdi>
                      {" · "}{detail.settlement_proxy.preflight.network}. Testnet execution does not discharge the real-world payable.
                    </p>}
                  </>
                )}
                {detailState !== "loaded" && <StateLine tone={state.tone} label={state.label} explanation={state.explanation} />}
                {(detailState === "loading" || detailState === "failed" || detailState === "stale") && (
                  <p className="mt-2 text-[12px] text-[var(--color-warning)]">Source and control details are {detailState === "loading" ? "loading" : detailState === "stale" ? "stale" : "unavailable"}; no current action is inferred.</p>
                )}
              </div>
            </section>
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

          {!isInitialObligationScreen && <section aria-label="Guided lifecycle" className={viewedStage === "Assessment" ? "border-b border-[var(--color-border)] pb-2" : "space-y-2 border-b border-[var(--color-border)] pb-2"}>
            <div className="rounded border border-[var(--color-border)] px-3 py-2">
              {viewedStage === "Assessment" ? <>
              <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-0.5">
                <p aria-live="polite" aria-atomic="true" className="text-[12px] font-semibold text-[var(--color-ink)]">Step {viewedStageIndex + 1} of 6 · {viewedStage}</p>
                <p className="text-[11px] text-[var(--color-ink-muted)]">{viewedStage === currentLifecycleStage ? `Current stage · ${currentLifecycleStage}` : `Viewing ${viewedStage} · current position ${currentLifecycleStage}`}</p>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <div className="h-1.5 min-w-12 flex-1 overflow-hidden rounded bg-[var(--color-border)]" role="progressbar" aria-label="Viewed step progress" aria-valuemin={1} aria-valuemax={6} aria-valuenow={viewedStageIndex + 1}>
                  <span className="block h-full bg-[var(--color-accent)]" style={{ width: `${((viewedStageIndex + 1) / PAYMENT_LIFECYCLE_STAGES.length) * 100}%` }} />
                </div>
                <button type="button" disabled={!canGoBack} onClick={() => previousViewedStage && showStage(previousViewedStage)} className="min-h-11 rounded border border-[var(--color-border-strong)] px-3 text-[12px] font-semibold disabled:opacity-50">{previousViewedStage ? `Back to ${previousViewedStage}` : "Back"}</button>
                {continueTarget && <button type="button" onClick={() => showStage(continueTarget)} className="min-h-11 rounded border border-[var(--color-border-strong)] px-3 text-[12px] font-semibold text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]">Continue to {continueTarget}</button>}
                <button type="button" aria-expanded={mobileStagesOpen} aria-controls="all-payment-stages"
                  onClick={() => setMobileStagesOpen((open) => !open)}
                  className="min-h-11 py-2 text-[12px] font-semibold text-[var(--color-ink-muted)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]">
                  View all stages
                </button>
              </div>
              <nav id="all-payment-stages" aria-label="Payment lifecycle navigation" hidden={!mobileStagesOpen}>
                <ol aria-label="Payment lifecycle" className="grid gap-1 border-t border-[var(--color-border)] pt-2 md:grid-cols-2 lg:grid-cols-3">
                  {PAYMENT_LIFECYCLE_STAGES.map((stage) => stageButton(stage))}
                </ol>
              </nav>
              </> : <>
              <p aria-live="polite" aria-atomic="true" className="text-[12px] font-semibold text-[var(--color-ink)]">Step {viewedStageIndex + 1} of 6 · {viewedStage}</p>
              <p className="mt-0.5 text-[11px] text-[var(--color-ink-muted)]">{viewedStage === currentLifecycleStage ? `Current stage · ${currentLifecycleStage}` : `Viewing ${viewedStage} · current position ${currentLifecycleStage}`}</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded bg-[var(--color-border)]" role="progressbar" aria-label="Viewed step progress" aria-valuemin={1} aria-valuemax={6} aria-valuenow={viewedStageIndex + 1}>
                <span className="block h-full bg-[var(--color-accent)]" style={{ width: `${((viewedStageIndex + 1) / PAYMENT_LIFECYCLE_STAGES.length) * 100}%` }} />
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={!canGoBack} onClick={() => previousViewedStage && showStage(previousViewedStage)} className="min-h-11 rounded border border-[var(--color-border-strong)] px-3 text-[12px] font-semibold disabled:opacity-50">{previousViewedStage ? `Back to ${previousViewedStage}` : "Back"}</button>
                {continueTarget && <button type="button" onClick={() => showStage(continueTarget)} className="min-h-11 rounded border border-[var(--color-border-strong)] px-3 text-[12px] font-semibold text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]">Continue to {continueTarget}</button>}
              </div>
              <div className="mt-2">
                <button type="button" aria-expanded={mobileStagesOpen} aria-controls="all-payment-stages"
                  onClick={() => setMobileStagesOpen((open) => !open)}
                  className="min-h-11 py-2 text-[12px] font-semibold text-[var(--color-ink-muted)] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]">
                  View all stages
                </button>
                <nav id="all-payment-stages" aria-label="Payment lifecycle navigation" hidden={!mobileStagesOpen}>
                  <ol aria-label="Payment lifecycle" className="grid gap-1 border-t border-[var(--color-border)] pt-2 md:grid-cols-2 lg:grid-cols-3">
                    {PAYMENT_LIFECYCLE_STAGES.map((stage) => stageButton(stage))}
                  </ol>
                </nav>
              </div>
              </>}
            </div>
          </section>}

          {!assessmentOwnsCurrentStage && !stageOwnsCurrentBusinessCard && <section aria-label={isInitialObligationScreen ? "Obligation next step" : "Current next step"} data-testid="current-next-step" className="rounded border-s-4 border-s-[var(--color-accent)] bg-[var(--color-bg)] p-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                {!isInitialObligationScreen && <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-ink-muted)]">{viewedStage === currentLifecycleStage ? `Current stage · ${currentLifecycleStage}` : `Viewing ${viewedStage} · Current position: ${currentLifecycleStage}`}</p>}
                <h3 ref={stageHeadingRef} tabIndex={-1} aria-label={stageAccessibilityLabel} className="mt-1 text-[16px] font-semibold leading-5 text-[var(--color-ink)]">{detailState === "loaded" && currentLifecycleStage === "Obligation" && !hasCurrentAssessment ? "Assessment required" : viewedStage === "Assessment" && hasCurrentPayAssessment ? "PAY — advisory" : viewedStage === "Payment" && detailState === "loaded" && detail ? paymentStageStatus(detail, exactPacketSubmissionReady, detailState) : detailState === "loaded" ? lifecycleStatus(viewedStage) : state.label}</h3>
                {!showExceptionRecovery && selectedWorkspaceGuidance !== lifecycleStatus(viewedStage) && !(viewedStage === "Assessment" && (currentPayIsNonWinner || currentPayCandidateUnknown)) && <p className="mt-1 max-w-3xl text-[13px] leading-5 text-[var(--color-ink-muted)]">{isInitialObligationScreen && selectedId && detailState === "loaded" ? "This obligation needs an assessment before it can proceed." : selectedWorkspaceGuidance}</p>}
                {isInitialObligationScreen && selectedId && <p className="mt-2 max-w-3xl text-[13px] leading-5 text-[var(--color-ink-muted)]">AI can recommend PAY, HOLD or ESCALATE. It cannot approve payment or move money.</p>}
                {visibleWorkspaceAction && !showExceptionRecovery && !isInitialObligationScreen && <p className="mt-2 text-[12px] text-[var(--color-ink-muted)]">Next owner: <strong className="text-[var(--color-ink)]">{visibleWorkspaceAction.actor}</strong></p>}
              {!visibleWorkspaceAction && !showContinueToAuthorization && !showContinueToPayment && selectedId && detailState === "loaded" && !showExceptionRecovery && !isInitialObligationScreen && (
                  <p className="mt-2 text-[12px] text-[var(--color-ink-muted)]">Next owner: <strong className="text-[var(--color-ink)]">
                    {detail?.execution?.status === "FAILED" || detail?.execution?.status === "BLOCKED" ||
                    ["BLOCKED", "REVOKED", "EXPIRED"].includes(detail?.truth.tameion_control_truth.execution_release_authority ?? "")
                      ? "Unassigned · no permitted product action is available"
                      : noCurrentExactExecutionPacket || detail?.execution_kill_switched === true
                        ? "Unassigned · no permitted product action is available"
                      : currentPacketAwaitingPrime
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
                {visibleWorkspaceAction?.exactConfirmation && (
                  <label className="mt-3 grid max-w-lg gap-1 text-[12px] font-medium text-[var(--color-ink)]">
                    Confirm exact testnet intent
                    <input
                      className="min-h-11 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]"
                      value={executionConfirmation.value}
                      onChange={(event) => executionConfirmation.setValue(event.target.value)}
                      placeholder="SUBMIT EXACT TESTNET SETTLEMENT PROXY"
                      aria-describedby="execution-confirmation-guidance"
                    />
                    <span id="execution-confirmation-guidance" className="font-normal text-[var(--color-ink-muted)]">The exact-packet gate and final pre-send checks must still pass.</span>
                  </label>
                )}
              </div>
              {exceptionRecoveryCard}
              {showContinueToAuthorization && (
                <PrimaryButton onClick={() => showStage("Authorization")} disabled={busy}>Continue to Authorization</PrimaryButton>
              )}
              {showContinueToPayment && (
                <PrimaryButton onClick={() => showStage("Payment")} disabled={busy}>Continue to Payment</PrimaryButton>
              )}
              {visibleWorkspaceAction && (
                <PrimaryButton
                  disabled={busy || (visibleWorkspaceAction.exactConfirmation && !executionConfirmation.matchesExact)}
                  danger={visibleWorkspaceAction.exactConfirmation}
                  onClick={visibleWorkspaceAction.run}
                >
                  {visibleWorkspaceAction.label}
                </PrimaryButton>
              )}
              {stageCompletionReceiptView}
            </div>
          </section>}
          {isInitialObligationScreen && currentResult?.label === "assess" && <ActionResultBanner result={currentResult} />}

          <div>
            {panel === "assessment" && (
              <div className="w-full max-w-3xl">
                {assessmentResult ? (
                  <AssessmentResultCard
                    assessment={assessmentResult}
                    nextAction={assessmentNextStep}
                    nextOwner={assessmentNextOwner}
                    paymentEligibility={assessmentPaymentEligibility}
                    primaryAction={assessmentOwnsCurrentStage ? assessmentCardPrimaryAction : null}
                    stageAccessibilityLabel={stageAccessibilityLabel}
                    stageHeadingRef={stageHeadingRef}
                    canReassess={optionalReassessmentAvailable}
                    reassessmentIsPrimary={false}
                    onReassess={() => void runAssessment()}
                    busy={busy}
                  />
                ) : (
                  <section aria-label="Assessment result" className="max-w-xl space-y-2 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <h3 className="text-[16px] font-semibold text-[var(--color-ink)]">Assessment</h3>
                    <p role="status" className="text-[13px] leading-5 text-[var(--color-ink-muted)]">
                      {assessmentAction === "assess"
                        ? "Run AI Assessment from the current-stage action above. The result is advisory and cannot authorize or execute payment."
                        : assessmentActionStatus}
                    </p>
                    <p className="border-t border-[var(--color-border)] pt-2 text-[12px] leading-5 text-[var(--color-ink-muted)]"><strong>Capability boundary:</strong> this product does not verify invoice contents, match purchase orders or receipts, validate supplier tax, or provide enterprise fraud or duplicate assurance.</p>
                    {detailState !== "loaded" && <RuntimeBadge mode={selected?.provider_mode ?? null} />}
                  </section>
                )}
                {currentResult?.label === "assess" && <ActionResultBanner result={currentResult} />}
                {assessmentOwnsCurrentStage && stageCompletionReceipt?.obligationId === selectedId && (
                  <p role="status" aria-label="Stage completion receipt" aria-live="polite" className="mt-3 rounded border border-[var(--color-success)] px-3 py-2 text-[12px] text-[var(--color-success)]">
                    {stageCompletionReceipt.message}
                  </p>
                )}
              </div>
            )}

            {panel === "authorization" && (
              <div className="max-w-xl space-y-3">
                {detailState !== "loaded" && <p className="text-[13px] text-[var(--color-ink-muted)]">
                  {authorizationPanelCopy(detailState, Boolean(selectedId))}
                </p>}
                {detailState === "loaded" && selectedId && detail && (
                  <section aria-label="Approver decision packet" className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                    <h3 ref={stageHeadingRef} tabIndex={-1} aria-label={stageAccessibilityLabel} className="text-[14px] font-semibold text-[var(--color-ink)]">Approver decision packet</h3>
                    <p className="text-[12px] text-[var(--color-warning)]">Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.</p>
                    {detail.pae_sealed && detail.settlement_proxy
                      ? <p className="text-[13px] font-semibold text-[var(--color-ink)]">Approved instruction is sealed for the Arc Testnet settlement proxy. Execution remains subject to the exact-packet gate and final pre-send checks.</p>
                      : detail.aggregate.state === "AUTHORIZED"
                        ? <p className="text-[13px] font-semibold text-[var(--color-ink)]">Authorization is recorded. Assurance failed or is blocked; no usable PAE or execution is available.</p>
                        : <p className="text-[13px] font-semibold text-[var(--color-ink)]">AI did not authorize this payment. You are approving this exact instruction.</p>}
                    <dl className="grid gap-x-5 sm:grid-cols-2">
                      <Field label="Payee / source obligation" value={sourceText(detail.record, "beneficiary_name")} />
                      <Field label="Source obligation amount" value={`${detail.record.amount} ${detail.record.currency} · ${sourcePayableState(detail)}`} />
                    </dl>
                    {detail.settlement_proxy ? (
                      <dl className="grid gap-x-5 sm:grid-cols-2">
                        <Field label="Exact testnet settlement" value={`${detail.settlement_proxy.preflight.amount} ${detail.settlement_proxy.preflight.asset} · ${detail.settlement_proxy.preflight.network}`} />
                        <Field label="Testnet source wallet" value={compactProxyDestination("Arc Testnet controlled source", detail.settlement_proxy.preflight.source_wallet.address)} />
                        <Field label="Testnet proxy destination" value={compactProxyDestination(detail.settlement_proxy.preflight.destination_wallet.name, detail.settlement_proxy.preflight.destination_wallet.address)} />
                      </dl>
                    ) : <p className="text-[12px] text-[var(--color-ink-muted)]">No controlled Arc Testnet settlement proxy is prepared for this source obligation.</p>}
                    <p className="border-t border-[var(--color-border)] pt-2 text-[12px] text-[var(--color-ink-muted)]">Authorization records approval only. Assurance and execution remain separately gated; approval does not submit payment.</p>
                    {!detail.pae_sealed && <p className="text-[12px] leading-5 text-[var(--color-ink-muted)]">{selectedWorkspaceGuidance}</p>}
                    {workspaceAction?.label === "Authorize payment" && <PrimaryButton onClick={workspaceAction.run} disabled={busy}>Authorize payment</PrimaryButton>}
                    {exceptionRecoveryCard}
                    {stageCompletionReceiptView}
                  </section>
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
                    <h3 ref={stageHeadingRef} tabIndex={-1} aria-label={stageAccessibilityLabel} className="mt-1 text-[16px] font-semibold text-[var(--color-ink)]">{paymentStageStatus(detail, exactPacketSubmissionReady, detailState)}</h3>
                  </div>
                  <dl>
                    <Field label="Testnet settlement" value={detail.settlement_proxy
                      ? `${detail.settlement_proxy.preflight.amount} ${detail.settlement_proxy.preflight.asset} · ${detail.settlement_proxy.preflight.network}`
                      : `${detail.aggregate.amount} ${detail.aggregate.asset} · ${detail.aggregate.network}`} />
                    <Field label="Testnet proxy destination" value={detail.settlement_proxy
                      ? compactProxyDestination(detail.settlement_proxy.preflight.destination_wallet.name, detail.settlement_proxy.preflight.destination_wallet.address)
                      : "No controlled proxy recipient is recorded."} />
                    <Field label="Instruction state" value={currentPaeDisplay(detail)} />
                    <Field label="Execution state" value={detail.execution?.status ?? "No execution has been recorded for this instruction."} />
                    <Field label="Source payable" value={`${sourcePayableState(detail)} · unchanged by testnet execution`} />
                  </dl>
                  {detail.execution?.status === "UNKNOWN" && <p role="status" className="border-s-4 border-s-[var(--color-warning)] ps-3 text-[13px] font-semibold">Reconciliation only. No blind retry or second submission.</p>}
                  {detail.execution?.status === "SETTLED" && <p className="border-t border-[var(--color-border)] pt-2 text-[12px] text-[var(--color-warning)]">The Arc Testnet transaction does not discharge the real-world payable.</p>}
                  {detail.execution === null && exactPacketSubmissionReady && <p className="text-[12px] text-[var(--color-ink-muted)]">Confirm the exact instruction only if the current gate is open. Release and pre-send checks remain authoritative.</p>}
                  {workspaceAction?.exactConfirmation && (
                    <label className="grid max-w-lg gap-1 text-[12px] font-medium text-[var(--color-ink)]">
                      Confirm exact testnet intent
                      <input
                        className="min-h-11 rounded border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-[13px] text-[var(--color-ink)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ink)]"
                        value={executionConfirmation.value}
                        onChange={(event) => executionConfirmation.setValue(event.target.value)}
                        placeholder="SUBMIT EXACT TESTNET SETTLEMENT PROXY"
                        aria-describedby="execution-confirmation-guidance"
                      />
                      <span id="execution-confirmation-guidance" className="font-normal text-[var(--color-ink-muted)]">The exact-packet gate and final pre-send checks must still pass.</span>
                    </label>
                  )}
                  {workspaceAction && <PrimaryButton disabled={busy || (workspaceAction.exactConfirmation && (!exactPacketSubmissionReady || !executionConfirmation.isBound || !executionConfirmation.matchesExact))} danger={workspaceAction.exactConfirmation} onClick={workspaceAction.run}>{workspaceAction.label}</PrimaryButton>}
                  {exceptionRecoveryCard}
                  {stageCompletionReceiptView}
                </section>
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">Payment stop controls</summary>
                  <div className={`mt-2 flex flex-wrap items-center justify-between gap-3 border-t border-s-[3px] px-3 py-3 ${killSwitchView === "engaged" ? "border-s-[var(--color-danger)] bg-[var(--color-surface)]" : "border-s-[var(--color-border)]"}`}>
                    <div>
                      <p className={`text-[13px] font-semibold uppercase tracking-wide ${killSwitchView === "engaged" ? "text-[var(--color-danger)]" : "text-[var(--color-ink-muted)]"}`}>Kill switch: {killSwitchLabel(killSwitchView)}</p>
                      <p className="text-[12px] text-[var(--color-ink-muted)]">Checked by both the Safety Kernel and the Execution Worker.</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        disabled={busy || detailState !== "loaded" || !selectedId}
                        onClick={() => run("kill-switch", () => postJson(`/api/obligations/${selectedId}/kill-switch`, { action: "ACTIVATE", scope: "TRANSACTION" }))}
                        className="min-h-11 rounded border border-[var(--color-danger)] px-3 py-2 text-[12px] font-semibold text-[var(--color-danger)] transition hover:bg-[var(--color-danger)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                      >Disable this obligation</button>
                      <button
                        disabled={busy || detailState !== "loaded" || !selectedId}
                        onClick={() => run("kill-switch", () => postJson(`/api/obligations/${selectedId}/kill-switch`, { action: "DEACTIVATE", scope: "TRANSACTION" }))}
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
                  <h3 ref={stageHeadingRef} tabIndex={-1} aria-label={stageAccessibilityLabel} className="sr-only">Deterministic assurance</h3>
                  <DeterministicAssuranceSummary detail={detail} continueToPayment={showContinueToPayment ? () => showStage("Payment") : undefined} />
                </>}
                {detailState !== "loaded" && <section aria-label="Deterministic assurance result" className="rounded border border-[var(--color-border)] p-4"><h3 className="text-[16px] font-semibold">Deterministic assurance</h3><p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Current assurance is unavailable until the obligation detail is refreshed.</p></section>}
                {exceptionRecoveryCard}
                {stageCompletionReceiptView}
              </div>
            )}

            {panel === "reconciliation" && (
              <div className="max-w-xl space-y-3">
                <header className="space-y-1">
                  <h3 className="text-[16px] font-semibold text-[var(--color-ink)]">Reconciliation &amp; evidence</h3>
                  <p className="text-[13px] text-[var(--color-ink-muted)]">Compare the recorded testnet outcome with the source obligation. The source payable remains separate and unchanged.</p>
                </header>
                {detail && detailState === "loaded" && detail.settlement_proxy ? (() => {
                  const evidence = detail.execution?.provider_evidence;
                  const observedAmount = evidence?.atomic_amount ?? evidence?.atomicAmount;
                  const observedDestination = evidence?.destination_address ?? evidence?.destinationAddress;
                  const amountMatch = evidence?.status === "CONFIRMED" && observedAmount && detail.execution?.atomic_amount
                    ? observedAmount === detail.execution.atomic_amount ? "confirmed" : "mismatch recorded"
                    : "not established from stored provider evidence";
                  const destinationMatch = evidence?.status === "CONFIRMED" && observedDestination && detail.execution?.destination_address
                    ? observedDestination.toLowerCase() === detail.execution.destination_address.toLowerCase() ? "confirmed" : "mismatch recorded"
                    : "not established from stored provider evidence";
                  const providerState = evidence?.status ?? (detail.execution?.provider_ref ? "Provider status not included in current detail" : "No provider reference is recorded for this instruction");
                  const result = detail.execution?.status === "SETTLED"
                    ? "TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION"
                    : detail.execution?.status === "UNKNOWN"
                      ? "Outcome unknown · read-only reconciliation only; do not resubmit"
                      : detail.execution?.status === "SUBMITTING"
                        ? "Submission is in progress. Provider outcome has not been reconciled; continue with read-only reconciliation for this same intent. Do not resubmit."
                        : detail.execution?.status === "SUBMITTED"
                          ? "Submission is recorded. Provider outcome is awaiting reconciliation for this same intent; reconcile read-only and do not resubmit."
                      : detail.execution?.status === "FAILED"
                        ? "Provider attempt failed · successful reconciliation is not recorded"
                        : detail.execution?.status === "BLOCKED"
                          ? "Execution is blocked · external provider outcome is not established by this record"
                          : detail.execution == null
                            ? "No Tameion execution record is recorded for this instruction"
                            : "An execution record is present; its status is not classified in this receipt.";
                  return (
                    <section aria-label="Reconciliation receipt" className="space-y-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                      <h3 ref={stageHeadingRef} tabIndex={-1} aria-label={stageAccessibilityLabel} className="text-[14px] font-semibold text-[var(--color-ink)]">Testnet reconciliation receipt</h3>
                      <p className="text-[13px] font-semibold text-[var(--color-ink)]">{result}</p>
                      <dl>
                        <Field label="Source obligation" value={`${sourceText(detail.record, "beneficiary_name")} · ${detail.record.amount} ${detail.record.currency}`} />
                        <Field label="Source payable" value={`${sourcePayableState(detail)} · remains outstanding in the source record`} />
                        <Field label="Testnet settlement" value={`${detail.settlement_proxy.preflight.amount} ${detail.settlement_proxy.preflight.asset} · ${detail.settlement_proxy.preflight.network}`} />
                        <Field label="Testnet proxy destination" value={detail.settlement_proxy.preflight.destination_wallet.name ?? "Arc Testnet settlement proxy"} />
                        <Field label="Amount match" value={amountMatch} />
                        <Field label="Destination match" value={destinationMatch} />
                      </dl>
                      <p className="border-t border-[var(--color-border)] pt-2 text-[12px] text-[var(--color-warning)]">ARC TESTNET · Controlled settlement proxy · testnet execution does not discharge the real-world payable.</p>
                      {workspaceAction && <PrimaryButton onClick={workspaceAction.run} disabled={busy}>{workspaceAction.label}</PrimaryButton>}
                      {exceptionRecoveryCard}
                      {stageCompletionReceiptView}
                      <details className="rounded border border-[var(--color-border)] px-3 py-2">
                        <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">View reconciliation evidence</summary>
                        <dl className="border-t border-[var(--color-border)] pt-3">
                          <Field label="Provider status" value={providerState} />
                          <Field label="Reconciliation result" value={detail.execution?.status === "SETTLED" ? "Testnet execution reconciled to source obligation; real-world payable is unchanged." : result} />
                        </dl>
                      </details>
                    </section>
                  );
                })() : (
                  <div className="space-y-3">
                    <h3 ref={stageHeadingRef} tabIndex={-1} aria-label={stageAccessibilityLabel} className="sr-only">Reconciliation</h3>
                    <p className="text-[13px] font-semibold text-[var(--color-ink)]">{reconciliationLeadLine(detailState, detail?.execution, Boolean(detail?.settlement_proxy), detail ? sourcePayableState(detail) : "OUTSTANDING")}</p>
                    {workspaceAction && <PrimaryButton onClick={workspaceAction.run} disabled={busy}>{workspaceAction.label}</PrimaryButton>}
                    {exceptionRecoveryCard}
                    {stageCompletionReceiptView}
                  </div>
                )}
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
                      <Field label="Record ID" value={report.supplier_reference.record_id} />
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
                          ? "var(--status-hold-border)"
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
                              ? "var(--status-hold-text)"
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
                            <p className="text-[12px]">{item.reason}</p>
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

          {!isInitialObligationScreen && <details className={`rounded border border-[var(--color-border)] px-3 py-2 ${viewedStage === "Obligation" ? "relative -top-2" : ""}`}>
            <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink-muted)]">Additional tools</summary>
            <nav aria-label="Secondary tools" className="border-t border-[var(--color-border)] pt-2">
              <button
                onClick={() => setPanel("report")}
                aria-pressed={panel === "report"}
                className={`min-h-11 rounded border px-3 py-2 text-start text-[12px] font-medium transition sm:text-[13px] ${panel === "report" ? "border-[var(--color-accent)] text-[var(--color-ink)]" : "border-[var(--color-border-strong)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"}`}
              >Operational Report (secondary)</button>
            </nav>
          </details>}

          {!isInitialObligationScreen && panel !== "report" && detailState === "loaded" && detail && (
            <details className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
              <summary className="min-h-11 cursor-pointer py-2 text-[13px] font-semibold text-[var(--color-ink)]" title={`Activity & evidence · ${activityItems.length ? `${activityItems.length} records · latest: ${activityItems.at(-1)?.label}` : "no timestamped history · current state available on open"}`}>
                <span className="inline-block w-[calc(100%-1.5rem)] truncate align-top">Activity &amp; evidence · {activityItems.length ? `${activityItems.length} records · latest: ${activityItems.at(-1)?.label}` : "no timestamped history · current state available on open"}</span>
              </summary>
              <section aria-label="Activity and evidence" className="space-y-4 border-t border-[var(--color-border)] pt-3">
                <div>
                  <h4 className="text-[12px] font-semibold text-[var(--color-ink)]">Available evidence history</h4>
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

          {!isInitialObligationScreen && panel !== "report" && detail && (
            <details className="rounded border border-[var(--color-border)] px-3 py-2">
              <summary className="min-h-11 cursor-pointer py-2 text-[13px] font-semibold text-[var(--color-ink)]">Developer &amp; audit evidence</summary>
              <div className="space-y-2 border-t border-[var(--color-border)] pt-3 text-[12px]">
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Assessment evidence</summary>
                  <div className="space-y-2 pt-2">
                    {detail.current_assessment ? <>
                      <dl>
                        <Field label="Assessment ID" value={detail.current_assessment.assessment_id} />
                        <Field label="Assessment hash" value={detail.current_assessment.assessment_hash} />
                        <Field label="Aggregate version" value={detail.current_assessment.aggregate_version} />
                        <Field label="Provider mode" value={detail.current_assessment.provider_mode ?? "Not available"} />
                      </dl>
                      <ul className="list-disc ps-5">{detail.current_assessment.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
                      {detail.current_assessment.race && <AssessmentTraceView race={detail.current_assessment.race} />}
                      {currentAssessment?.provider_truth && <ProviderTruthRow truth={currentAssessment.provider_truth} />}
                      {currentAssessment && <EvidenceAndRuntimeDetail assessment={currentAssessment} />}
                    </> : <p>No current assessment artifact is present in this detail.</p>}
                    {currentResult?.label === "assess" && <EvidencePanel value={currentResult.data} />}
                  </div>
                </details>
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Authorization evidence</summary>
                  <dl className="pt-2">
                    <Field label="Authorization state" value={detail.truth.tameion_control_truth.aggregate_state} />
                    <Field label="Release authority" value={detail.truth.tameion_control_truth.execution_release_authority} />
                    <Field label="Approval record details" value="Not included in the current obligation detail response." />
                    <Field label="Approval timestamp / actor" value="Not available in the current detail; no event is inferred." />
                  </dl>
                </details>
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Assurance evidence</summary>
                  <div className="space-y-2 pt-2">
                    <p role="status" className="text-[12px] text-[var(--color-ink-muted)]">{detail.assurance_evidence?.message ?? "Assurance evidence is expected but unavailable."}</p>
                    {detail.assurance_evidence && (detail.assurance_evidence.state === "AVAILABLE_CURRENT_BINDING" || detail.assurance_evidence.state === "AVAILABLE_HISTORICAL") && <>
                      <dl>
                        <Field label="Assurance record" value={detail.assurance_evidence.assurance_id} />
                        <Field label="Recorded at" value={detail.assurance_evidence.recorded_at} />
                        <Field label="Recorded aggregate version" value={detail.assurance_evidence.aggregate_version} />
                        <Field label="Recorded policy" value={detail.assurance_evidence.policy_version} />
                      </dl>
                      <SafetyKernelBreakdown overall={detail.assurance_evidence.overall} controlResults={detail.assurance_evidence.control_results} />
                    </>}
                  </div>
                </details>
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">PAE / instruction</summary>
                  <dl className="pt-2">
                    <Field label="Sealed instruction" value={detail.pae_sealed ? "Present" : "Not present"} />
                    <Field label="Instruction hash" value={detail.sealed_pae_instruction_hash ?? "Not available"} />
                    <Field label="Execution gate" value={detail.execution_gate ?? "Not available"} />
                    {detail.execution_packet?.packet_sha256 && <Field label="Exact packet SHA-256" value={detail.execution_packet.packet_sha256} />}
                  </dl>
                </details>
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Execution / provider</summary>
                  <dl className="pt-2">
                    <Field label="Execution state" value={detail.execution?.status ?? "No Tameion execution record"} />
                    <Field label="Provider reference" value={detail.execution?.provider_ref ?? "Not recorded"} />
                    <Field label="Instruction idempotency key" value={detail.execution?.idempotency_key ?? "Not available"} />
                    <Field label="Source wallet reference" value={detail.aggregate.source_wallet_ref} />
                    <Field label="Destination address" value={detail.execution?.destination_address ?? detail.aggregate.destination_address} />
                    <Field label="Provider status evidence" value={detail.execution?.provider_evidence?.status ?? "Not available"} />
                  </dl>
                </details>
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Reconciliation evidence</summary>
                  <div className="space-y-2 pt-2">
                    <dl>
                      <Field label="Settlement status" value={detail.truth.settlement_truth.status} />
                      <Field label="Provider reconciliation time" value={detail.execution?.provider_evidence?.reconciled_at ?? "Not recorded"} />
                      <Field label="Provider evidence status" value={detail.execution?.provider_evidence?.status ?? "Not available"} />
                    </dl>
                    <EvidencePanel value={detail.execution?.provider_evidence ?? detail.truth.settlement_truth} />
                  </div>
                </details>
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
                <details className="rounded border border-[var(--color-border)] px-3 py-2">
                  <summary className="min-h-11 cursor-pointer py-2 font-semibold">Source and control records</summary>
                  <section aria-label="Payment authority boundary" className="mt-2 grid gap-3 md:grid-cols-3">
                    <article className="min-w-0 space-y-1 border-s-2 border-[var(--color-border)] ps-3" data-testid="source-truth">
                      <h4 className="font-semibold">Source-system truth</h4>
                      <p>{detail.truth.source_truth.role}</p>
                      <p className="mono break-words">{detail.truth.source_truth.source.source_kind} · {detail.truth.source_truth.source.source_system_id}</p>
                      <p>Record {detail.truth.source_truth.source.record_id} · state {detail.truth.source_truth.obligation_state}</p>
                      <p>Source approval {detail.truth.source_truth.source.approval_state} · execution authority {detail.truth.source_truth.source.execution_authority}</p>
                    </article>
                    <article className="min-w-0 space-y-1 border-s-2 border-[var(--color-ink)] ps-3" data-testid="tameion-control-truth">
                      <h4 className="font-semibold">Tameion control truth</h4>
                      <p>{detail.truth.tameion_control_truth.role}</p>
                      <p>Aggregate {detail.truth.tameion_control_truth.aggregate_state} · v{detail.truth.tameion_control_truth.aggregate_version}</p>
                      <p>Assessment {detail.truth.tameion_control_truth.assessment_state} · PAE {detail.truth.tameion_control_truth.pae_state}</p>
                      <p>Release authority {detail.truth.tameion_control_truth.execution_release_authority}</p>
                    </article>
                    <article className="min-w-0 space-y-1 border-s-2 border-[var(--color-warning)] ps-3" data-testid="settlement-truth">
                      <h4 className="font-semibold">Settlement truth</h4>
                      <p>{detail.truth.settlement_truth.provider_target} · {detail.truth.settlement_truth.network}</p>
                      <p>Runtime {detail.truth.settlement_truth.runtime} · status {detail.truth.settlement_truth.status}</p>
                      <p className="mono break-all">Provider reference {detail.truth.settlement_truth.provider_ref ?? "None"}</p>
                    </article>
                  </section>
                </details>
              </div>
            </details>
          )}
        </section>
      </div>

      {!isInitialObligationScreen && <details className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2">
        <summary className="min-h-11 cursor-pointer py-2 text-[12px] font-semibold text-[var(--color-ink)]">Demo tools</summary>
        <div className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
          <details className="rounded border border-[var(--color-warning)] px-3 py-2">
            <summary className="min-h-11 cursor-pointer py-2 text-[13px] font-semibold text-[var(--color-warning)]">Read-only sample</summary>
            <section aria-label="Simulated demonstration" className="mt-3 space-y-3 border-t border-[var(--color-border)] pt-3">
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <p className="text-[13px] font-semibold text-[var(--color-warning)]">Illustrative only · not a genuine payment</p>
                  <p className="mt-1 text-[13px] text-[var(--color-ink-muted)]">Playback uses a fixed local fixture. It makes no approval, assurance, provider, or execution requests.</p>
                </div>
                <button type="button" aria-expanded={samplePlaybackVisible} onClick={() => setSamplePlaybackVisible((visible) => !visible)} className="min-h-11 rounded border border-[var(--color-border)] px-3 py-2 text-[13px] font-semibold text-[var(--color-ink)] hover:bg-[var(--color-surface)]">
                  {samplePlaybackVisible ? "Hide sample playback" : "Show sample playback"}
                </button>
              </div>
              {samplePlaybackVisible && <SimulatedDemoStages />}
            </section>
          </details>

        </div>
      </details>}
    </main>
  );
}
