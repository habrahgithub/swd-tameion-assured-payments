"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { RaceAssessment } from "../src/agent/schema";
import type { PaymentTruthLayers } from "../src/domain/payment-control-boundary";
import {
  assessmentReviewSnapshot,
  currentReviewedAssessment,
  shouldKeepAssessmentRecoveryKey,
  type AssessmentReviewSnapshot,
  type ProviderRuntimeTruth,
} from "../src/client/assessment-review-snapshot";
import {
  buildHoldEscalateReport,
  buildHoldEscalateSummary,
  type HoldEscalateReportInput,
  type HoldEscalateReportLine,
  type HoldEscalateSummary,
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
}

interface AggregateView {
  aggregate_version: number;
  state: string;
  amount: string;
  asset: string;
  network: string;
  destination_address: string;
  destination_verification_status: string;
  destination_operational_status: string;
  source_wallet_ref: string;
  execution_state: string;
  pae_state: string;
}

interface ObligationDetail {
  truth: PaymentTruthLayers;
  aggregate: AggregateView;
  record: Record<string, unknown> & { amount: string; currency: string };
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
  execution_kill_switched: boolean;
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

export type KillSwitchPresentation = "no-selection" | "allowed" | "disabled";

/** Never report "Execution allowed" when there is no selected obligation —
 * that implies a real, checked state when none has been verified yet. */
export function killSwitchPresentation(
  hasDetail: boolean,
  executionKillSwitched: boolean | undefined,
): KillSwitchPresentation {
  if (!hasDetail) return "no-selection";
  return executionKillSwitched ? "disabled" : "allowed";
}

export function killSwitchLabel(presentation: KillSwitchPresentation): string {
  if (presentation === "no-selection") return "No obligation selected";
  return presentation === "disabled" ? "Execution disabled" : "Execution allowed";
}

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

const PANELS: Array<{ key: PanelKey; label: string }> = [
  { key: "obligations", label: "Obligations" },
  { key: "assessment", label: "Assessment" },
  { key: "authorization", label: "Authorization" },
  { key: "assurance", label: "Assurance & Execution" },
  { key: "reconciliation", label: "Reconciliation & Evidence" },
  { key: "report", label: "Operational Report" },
];

async function postJson(url: string, body?: unknown, headers: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  return { ok: response.ok, status: response.status, data };
}

type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONE_STYLE: Record<Tone, { border: string; text: string }> = {
  neutral: { border: "border-l-[3px] border-l-[var(--color-border)]", text: "text-[var(--color-ink-muted)]" },
  info: { border: "border-l-[3px] border-l-[var(--color-ink)]", text: "text-[var(--color-ink)]" },
  success: { border: "border-l-[3px] border-l-[var(--color-success)]", text: "text-[var(--color-success)]" },
  warning: { border: "border-l-[3px] border-l-[var(--color-warning)]", text: "text-[var(--color-warning)]" },
  danger: { border: "border-l-[3px] border-l-[var(--color-danger)]", text: "text-[var(--color-danger)]" },
};

/** Explicit workflow state, never expressed by colour alone. Authority-bearing
 * labels consume the server-derived truth layer rather than recomputing release
 * authority in the browser. */
export function workflowState(detail: ObligationDetail | null): { label: string; tone: Tone; explanation: string } {
  if (!detail) return { label: "Loading", tone: "neutral", explanation: "" };
  const { aggregate, execution, truth } = detail;
  const releaseAuthority = truth.tameion_control_truth.execution_release_authority;

  if (execution?.status === "SETTLED" && aggregate.state === "RECONCILED") {
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
  if (aggregate.state === "APPROVAL_PENDING") {
    return { label: "Awaiting human authorization", tone: "neutral", explanation: "No Tameion execution authority has been granted." };
  }
  return { label: aggregate.state, tone: "neutral", explanation: "" };
}

function StateLine({ tone, label, explanation }: { tone: Tone; label: string; explanation?: string }) {
  const style = TONE_STYLE[tone];
  return (
    <div className={`${style.border} pl-3 py-1`}>
      <p className={`text-[13px] font-semibold uppercase tracking-wide ${style.text}`}>{label}</p>
      {explanation && <p className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">{explanation}</p>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--color-border)] py-1.5">
      <dt className="text-[13px] text-[var(--color-ink-muted)]">{label}</dt>
      <dd className="tabular text-[13px] font-medium text-[var(--color-ink)]">{value}</dd>
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
        <ul className="list-disc pl-5">{race.action_taken.checks.map((check, index) => <li key={index}>{check}</li>)}</ul>
        <p><strong>Caveats:</strong> {race.caveats.missing_context.length ? race.caveats.missing_context.join(", ") : "No typed missing context"}; uncertainty {race.caveats.uncertainty_signal ? "flagged" : "not flagged"}.</p>
        <p><strong>Validated evidence IDs:</strong> {race.evidence.evidence_ids.join(", ") || "None"}</p>
        <p><strong>Due-date fact:</strong> {race.evidence.authoritative_facts.due_date ?? "Not stated"} ({race.evidence.authoritative_facts.due_date_position} as of {race.evidence.authoritative_facts.as_of_date}).</p>
      </div>
      {race.result.validated_findings.length > 0 && (
        <ul className="space-y-2 text-[12px]">
          {race.remediation.map((item) => (
            <li key={item.finding_code} className="border-l-2 border-[var(--color-warning)] pl-2">
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
            Due-date fact: {race.evidence.authoritative_facts.due_date ?? "Not stated"} ({race.evidence.authoritative_facts.due_date_position} as of {race.evidence.authoritative_facts.as_of_date})
          </p>
        )}
            </div>
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
  action,
}: {
  assessment: AssessmentReviewSnapshot;
  label: string;
  stale?: boolean;
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
      className={`space-y-2 border-l-2 pl-3 ${stale ? "border-[var(--color-danger)] bg-[var(--color-warning-bg)]" : border}`}
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
      <ul className="list-disc pl-5 text-[12px] text-[var(--color-ink-muted)]">
        {assessment.reasons.map((reason, index) => (
          <li key={index}>{reason}</li>
        ))}
      </ul>

      {/* Deterministic findings — the application-owned blockers */}
      {findings.length > 0 && (
        <div className="space-y-1 border-l-[3px] border-l-[var(--color-warning)] pl-2">
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
            <div key={item.finding_code} className="border-l-2 border-[var(--color-warning)] pl-2">
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

type ActionResult = { label: string; data: unknown; ok: boolean; status: number };

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
    <div className="border-l-[3px] border-l-[var(--color-danger)] bg-[var(--color-surface)] px-3 py-2">
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

function SimulatedDemoStages({ value }: { value: Record<string, unknown> }) {
  const happyPath = value.happy_path as {
    label: string;
    provider_label: string;
    vendor_notice: string;
    obligation_id: string;
    obligation: { obligation_id: string; state: string };
    assessment: { decision: string; provider_mode: string };
    human_authorization: { state: string };
    assurance: { pae_state: string; safety_kernel_overall: string };
    execution: { status: string; provider_label: string };
    reconciliation: { aggregate_state: string; execution_status: string };
  };
  return (
    <div className="space-y-3 border-t border-[var(--color-border)] pt-3" data-testid="simulated-demo-result">
      <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-warning)]">
        {happyPath.label} / {happyPath.provider_label} / {happyPath.vendor_notice}
      </p>
      <p className="mono break-all text-[12px] text-[var(--color-ink-muted)]">Synthetic obligation: {happyPath.obligation_id}</p>
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        <DemoStage title="Obligation" value={`${happyPath.obligation.obligation_id} · ${happyPath.obligation.state}`} />
        <DemoStage title="Assessment" value={`${happyPath.assessment.decision} · ${happyPath.assessment.provider_mode}`} />
        <DemoStage title="Human Authorization" value={happyPath.human_authorization.state} />
        <DemoStage title="Assurance & Execution" value={`Safety Kernel ${happyPath.assurance.safety_kernel_overall} · PAE ${happyPath.assurance.pae_state} · ${happyPath.execution.provider_label} ${happyPath.execution.status}`} />
        <DemoStage title="Reconciliation / Evidence" value={`${happyPath.reconciliation.aggregate_state} · execution ${happyPath.reconciliation.execution_status}`} />
      </ol>
      <p className="text-[11px] text-[var(--color-ink-muted)]">Server-derived pipeline result only. It remains separate from genuine obligations, real payment authority, and vendor settlement.</p>
    </div>
  );
}

function DemoStage({ title, value }: { title: string; value: string }) {
  return (
    <li className="min-w-0 border-l-2 border-[var(--color-warning)] pl-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">{title}</p>
      <p className="mt-1 break-words text-[12px] font-medium text-[var(--color-ink)]">{value}</p>
    </li>
  );
}

export function CommandCenter() {
  const [obligations, setObligations] = useState<ObligationSummary[]>([]);
  const [obligationsStatus, setObligationsStatus] = useState<ObligationListStatus>("loading");
  const [obligationsError, setObligationsError] = useState<string | null>(null);
  const [demoStatus, setDemoStatus] = useState<"idle" | "loading" | "error" | "result">("idle");
  const [demoResult, setDemoResult] = useState<Record<string, unknown> | null>(null);
  const [demoError, setDemoError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [panel, setPanel] = useState<PanelKey>("obligations");
  const [detail, setDetail] = useState<ObligationDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<ActionResult | null>(null);
  const [displayedAssessment, setDisplayedAssessment] = useState<AssessmentReviewSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const assessmentRequestKey = useRef<{ obligationId: string; key: string } | null>(null);

  const refreshObligations = async (showLoading = false) => {
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
      const fetched = (data as { obligations: ObligationSummary[] }).obligations;
      setObligations(fetched);
      setObligationsStatus("ready");
      if (fetched.length === 0) setSelectedId("");
      return fetched;
    } catch (error) {
      setObligations([]);
      setSelectedId("");
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

  const runSimulatedDemo = async () => {
    setDemoStatus("loading");
    setDemoResult(null);
    setDemoError(null);
    try {
      const result = await postJson("/api/internal/demo/simulated-happy-path", { confirm: "RUN_SIMULATED_HAPPY_PATH" });
      if (!result.ok || !result.data || typeof result.data !== "object" || !("happy_path" in result.data)) {
        throw new Error(actionErrorMessage(result.data));
      }
      setDemoResult(result.data as Record<string, unknown>);
      setDemoStatus("result");
    } catch (error) {
      setDemoError(error instanceof Error ? error.message : "The simulated demo could not be run.");
      setDemoStatus("error");
    }
  };

  const refreshDetail = async (id: string): Promise<ObligationDetail | null> => {
    try {
      const response = await fetch(`/api/obligations/${id}`);
      // Same root-cause guard as refreshObligations: never let an empty or
      // malformed body reach response.json() directly.
      const text = await response.text();
      const data = tryParseJson(text);
      if (!response.ok || !data || typeof data !== "object") {
        throw new Error(obligationsFetchErrorMessage(response.status, data));
      }
      setDetail(data as ObligationDetail);
      setDetailError(null);
      return data as ObligationDetail;
    } catch (error) {
      setDetail(null);
      setDetailError(error instanceof Error ? error.message : "Obligation detail could not be loaded.");
      return null;
    }
  };

  useEffect(() => {
    setDisplayedAssessment(null);
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
    setBusy(true);
    try {
      const result = await action();
      setLastResult({ label, data: result.data, ok: result.ok, status: result.status });
      if (label === "approve" && !result.ok && result.status === 409) setDisplayedAssessment(null);
      await Promise.all([refreshDetail(selectedId), refreshObligations()]);
    } finally {
      setBusy(false);
    }
  };

    const runAssessment = () => {
    const obligationId = selectedId;
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
    const code = result.data && typeof result.data === "object" && "code" in result.data
      ? (result.data as { code?: unknown }).code
      : undefined;
    if (!shouldKeepAssessmentRecoveryKey(result.status, typeof code === "string" ? code : undefined)) {
      localStorage.removeItem(storageKey);
      assessmentRequestKey.current = null;
    }
    if (result.status === 200 && result.ok && result.data && typeof result.data === "object") {
      const data = result.data as {
        assessment_id?: unknown;
        aggregate_version?: unknown;
        decision?: { obligation_id?: unknown; decision?: unknown; reasons?: unknown };
        assessment_hash?: unknown;
        race?: unknown;
        provider_used?: unknown;
        provider_mode?: unknown;
        model_id?: unknown;
        model_config_version?: unknown;
        runtime_config_sha256?: unknown;
      };
      const snapshot = assessmentReviewSnapshot({
        obligation_id: data.decision?.obligation_id,
        assessment_id: data.assessment_id,
        assessment_hash: data.assessment_hash,
        aggregate_version: data.aggregate_version,
        decision: data.decision?.decision,
        reasons: data.decision?.reasons,
        race: data.race,
        provider_used: data.provider_used,
        provider_mode: data.provider_mode,
        ...(data.model_id ? { model_id: data.model_id } : {}),
        ...(data.model_config_version ? { model_config_version: data.model_config_version } : {}),
        ...(data.runtime_config_sha256 ? { runtime_config_sha256: data.runtime_config_sha256 } : {}),
      });
      if (snapshot) {
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
    }
    return result;
    });
  };

  const selected = obligations.find((o) => o.obligation_id === selectedId);
    const assessedCount = obligations.filter((o) => o.assessed).length;
  const payCandidateCount = obligations.filter((o) => o.decision === "PAY").length;
  const allAssessed = obligations.length > 0 && assessedCount === obligations.length;
  const listPresentation = obligationListState(obligationsStatus, obligationsError, obligations.length);
  const killSwitchView = killSwitchPresentation(Boolean(detail), detail?.execution_kill_switched);
  const state = useMemo(() => workflowState(detail), [detail]);
  const aggregateVersion = detail?.aggregate?.aggregate_version;
  const currentAssessment = assessmentReviewSnapshot(detail?.current_assessment);
    const authorizationAssessment = currentReviewedAssessment(
    displayedAssessment,
    currentAssessment,
    selectedId,
    aggregateVersion,
  );

  // HOLD/ESCALATE operational report — read-only, derived from authoritative
  // current assessment and obligation state. Fails closed when truth is
  // missing or stale. See src/client/hold-escalate-report.ts.
  const reportInput: HoldEscalateReportInput | null = useMemo(() => {
    if (!detail || !selectedId) return null;
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
  }, [detail, selectedId]);
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

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-4 px-4 py-5 md:gap-5 md:px-6 md:py-8">
      <header className="flex flex-col items-start justify-between gap-3 border-b border-[var(--color-border)] pb-4 sm:flex-row sm:items-baseline">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--color-ink-muted)]">
            Tameion
          </p>
          <h1 className="text-xl font-semibold text-[var(--color-ink)]">Assured Payment — Command Center</h1>
        </div>
        <p className="max-w-none text-left text-[12px] leading-5 text-[var(--color-ink-muted)] sm:max-w-sm sm:text-right">
          Execution and demo destination/source-wallet trust are simulated fixtures. J0-D connectivity completed
          with disposable wallets; product destination/source-wallet trust remains separately gated unless
          supported by current, non-simulated evidence. J0-C source evidence retains its original pending status.
        </p>
      </header>

      <section aria-label="Simulated demo" className="space-y-3 rounded border border-[var(--color-warning)] bg-[var(--color-surface)] p-3 sm:p-4">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-warning)]">SIMULATED / NON-ECONOMIC / NOT_VENDOR_PAYMENT</p>
            <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">Runs the isolated in-memory demo pipeline with a fake adapter. This result is separate from genuine obligations and cannot represent a vendor payment.</p>
          </div>
          <PrimaryButton disabled={demoStatus === "loading"} onClick={() => void runSimulatedDemo()}>
            {demoStatus === "loading" ? "Running simulated demo…" : "Run safe simulated demo"}
          </PrimaryButton>
        </div>
        {demoStatus === "loading" && <p role="status" className="text-[13px] text-[var(--color-ink-muted)]">Running the isolated simulated workflow…</p>}
        {demoStatus === "error" && (
          <div role="alert" className="flex flex-col items-start gap-2 border-l-[3px] border-l-[var(--color-danger)] pl-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[13px] text-[var(--color-danger)]">Simulated demo unavailable: {demoError}</p>
            <button type="button" onClick={() => void runSimulatedDemo()} className="text-[13px] font-semibold underline">Retry simulated demo</button>
          </div>
        )}
        {demoStatus === "result" && demoResult && <SimulatedDemoStages value={demoResult} />}
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr] md:gap-5">
        <aside className="md:border-r md:pr-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            Obligations
          </p>
          {/* Ledger header row — columnar alignment for operator scan */}
          {obligationListState(obligationsStatus, obligationsError, obligations.length) === "ready" && <div className="grid grid-cols-[1fr_auto_auto] gap-1 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
            <span>Id</span>
            <span className="tabular text-right">Amount</span>
            <span className="tabular text-right">Status</span>
          </div>}
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
                    }}
                    className={`grid w-full grid-cols-[1fr_auto_auto] items-center gap-x-2 gap-y-0.5 px-2 py-1.5 text-left transition ${
                      o.obligation_id === selectedId
                        ? "border-l-2 border-l-[var(--color-accent)] bg-[var(--color-surface)]"
                        : "hover:bg-[var(--color-surface)]"
                    }`}
                  >
                    <span className="mono text-[12px] font-medium text-[var(--color-ink)] col-span-1">
                      <span
                        aria-label={o.assessed ? "assessed" : "not yet assessed"}
                        title={o.assessed ? `Assessed: ${o.decision}` : "Not yet assessed"}
                        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: o.assessed ? "var(--status-pass-text)" : "var(--color-border-strong)" }}
                      />{" "}
                      {o.obligation_id}
                    </span>
                    <span className="tabular text-right text-[12px] text-[var(--color-ink-muted)]">
                      {o.amount} {o.currency}
                    </span>
                    <span className="tabular text-right text-[12px] font-medium" style={{ color: statusColor }}>
                      {o.assessed ? (o.decision ?? "—") : "UNASSESSED"}
                    </span>
                    <span className="col-span-3 truncate text-[11px] text-[var(--color-ink-muted)]">
                      {o.service_category.replaceAll("_", " ").toLowerCase()}
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
                <p className="text-[12px] text-[var(--color-ink-muted)]">Use the separate simulated demo above to view a clearly labeled synthetic workflow.</p>
              </>}
              {obligationListState(obligationsStatus, obligationsError, obligations.length) === "empty" && <>
                <p className="text-[13px] font-semibold text-[var(--color-ink)]">No genuine obligations are currently available.</p>
                <p className="text-[12px] text-[var(--color-ink-muted)]">The genuine lane remains empty; a simulated demo is available above and is never treated as payable.</p>
              </>}
            </div>
          )}
        </aside>

        <section className="flex flex-col gap-4 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 md:p-5">
          {selected && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="mono text-base font-semibold text-[var(--color-ink)]">{selected.obligation_id}</h2>
                <p className="text-[12px] text-[var(--color-ink-muted)]">{selected.commercial_terms}</p>
              </div>
              <StateLine tone={state.tone} label={state.label} explanation={state.explanation} />
            </div>
          )}

          {!selected && (
            <div className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-3">
              <p className="text-[13px] font-semibold text-[var(--color-ink)]">Genuine obligations are not selected.</p>
              <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">
                {obligationsStatus === "loading"
                  ? "The genuine source list is loading."
                  : obligationsStatus === "error"
                    ? "The genuine source list is unavailable. Retry it or use the separately labeled simulated demo above."
                    : "There are no genuine obligations to show. The simulated demo above is separate and is not payable."}
              </p>
            </div>
          )}

          {selected && !detail && detailError && (
            <div role="alert" className="rounded border border-[var(--color-danger)] bg-[var(--color-surface)] px-3 py-3">
              <p className="text-[13px] font-semibold text-[var(--color-danger)]">Obligation detail is unavailable.</p>
              <p className="mt-1 text-[12px] text-[var(--color-ink-muted)]">{detailError}</p>
              <button type="button" onClick={() => void refreshDetail(selectedId)} className="mt-1 text-[12px] font-semibold underline">
                Retry obligation detail
              </button>
            </div>
          )}

          {detail && (
            <section aria-label="Payment authority boundary" className="grid gap-3 border-b border-[var(--color-border)] pb-4 md:grid-cols-3">
              <article className="space-y-1 border-l-2 border-[var(--color-border)] pl-3" data-testid="source-truth">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide">Source-system truth</h3>
                <p className="text-[12px] text-[var(--color-ink)]">{detail.truth.source_truth.role}</p>
                <p className="mono text-[11px] text-[var(--color-ink-muted)]">
                  {detail.truth.source_truth.source.source_kind} · {detail.truth.source_truth.source.source_system_id}
                </p>
                <p className="text-[11px] text-[var(--color-ink-muted)]">Record {detail.truth.source_truth.source.record_id} · state {detail.truth.source_truth.obligation_state}</p>
                <p className="text-[11px] text-[var(--color-ink-muted)]">Source approval {detail.truth.source_truth.source.approval_state} · execution authority {detail.truth.source_truth.source.execution_authority}</p>
              </article>
              <article className="space-y-1 border-l-2 border-[var(--color-ink)] pl-3" data-testid="tameion-control-truth">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide">Tameion control truth</h3>
                <p className="text-[12px] text-[var(--color-ink)]">{detail.truth.tameion_control_truth.role}</p>
                <p className="text-[11px] text-[var(--color-ink-muted)]">Aggregate {detail.truth.tameion_control_truth.aggregate_state} · v{detail.truth.tameion_control_truth.aggregate_version}</p>
                <p className="text-[11px] text-[var(--color-ink-muted)]">Assessment {detail.truth.tameion_control_truth.assessment_state} · PAE {detail.truth.tameion_control_truth.pae_state}</p>
                <p className="text-[11px] text-[var(--color-ink-muted)]">Release authority {detail.truth.tameion_control_truth.execution_release_authority}</p>
              </article>
              <article className="space-y-1 border-l-2 border-[var(--color-warning)] pl-3" data-testid="settlement-truth">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide">Settlement truth</h3>
                <p className="text-[12px] text-[var(--color-ink)]">{detail.truth.settlement_truth.provider_target} · {detail.truth.settlement_truth.network}</p>
                <p className="text-[11px] text-[var(--color-ink-muted)]">Runtime {detail.truth.settlement_truth.runtime} · status {detail.truth.settlement_truth.status}</p>
                <p className="mono text-[11px] text-[var(--color-ink-muted)]">Provider reference {detail.truth.settlement_truth.provider_ref ?? "None"}</p>
                <p className="text-[11px] font-semibold text-[var(--color-ink)]">NO ASSURANCE, NO EXECUTION</p>
              </article>
            </section>
          )}

          <nav aria-label="Command Center surfaces" className="flex flex-wrap gap-1 border-b border-[var(--color-border)]">
            {PANELS.map((p) => (
              <button
                key={p.key}
                onClick={() => setPanel(p.key)}
                className={`shrink-0 border-b-2 px-2 py-2 text-[12px] font-medium transition sm:px-3 sm:text-[13px] ${
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
              <dl className="max-w-md">
                <Field label="Source obligation amount (source truth)" value={`${detail.record.amount} ${detail.record.currency}`} />
                <Field
                  label="Settlement amount (execution rail)"
                  value={detail.record.currency === "USD"
                    ? `${detail.aggregate.amount} ${detail.aggregate.asset}`
                    : `Not applicable — unsupported ${detail.record.currency}`}
                />
                <Field label="Network" value={detail.aggregate.network} />
                <Field label="Aggregate version" value={String(detail.aggregate.aggregate_version)} />
                <Field label="Source wallet" value={detail.aggregate.source_wallet_ref} />
                <Field
                  label="Destination trust"
                  value={`${detail.aggregate.destination_verification_status} / ${detail.aggregate.destination_operational_status}${detail.demo_arc_trust_simulated ? " (simulated demo fixture; not product-trust evidence)" : ""}`}
                />
              </dl>
                        )}

            {panel === "assessment" && (
              <div className="max-w-xl space-y-3">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  The Finance Agent reads this obligation and returns exactly one PAY / HOLD / ESCALATE
                  recommendation with reasons. It cannot approve, sign, or execute anything. A PAY
                  recommendation is advisory only — it still requires human authorization and a
                  Safety Kernel PASS before any release authority.
                </p>
                <div className="flex items-center justify-between gap-3 border-l-[3px] border-l-[var(--color-border)] px-3 py-2">
                  <p className="text-[13px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                    {assessmentCoverageLabel(listPresentation, assessedCount, obligations.length)}
                  </p>
                  <RuntimeBadge mode={selected?.provider_mode ?? null} />
                </div>
                <PrimaryButton disabled={busy || !selectedId} onClick={runAssessment}>
                  Run assessment
                </PrimaryButton>

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
                      Result: J1_NO_CANDIDATE / STOP — no payment execution, no signed PAE, no provider submission.
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

                {displayedAssessment && authorizationAssessment && (
                  <AdvisoryAssessmentCard
                    assessment={displayedAssessment}
                    label="Displayed assessment under review"
                    action={
                      <button
                        type="button"
                        className="text-[12px] font-semibold underline text-[var(--color-warning)]"
                        disabled={!displayedAssessment.race}
                        onClick={() => setDisplayedAssessment(assessmentReviewSnapshot(detail!.current_assessment)!)}
                      >
                        Discard review selection
                      </button>
                    }
                  />
                )}
                {!displayedAssessment && currentAssessment && (
                  <div className="space-y-2">
                    <AdvisoryAssessmentCard
                      assessment={currentAssessment}
                      label="Current sealed assessment"
                      action={
                        <button
                          type="button"
                          className="text-[12px] font-semibold underline"
                          disabled={!currentAssessment.race}
                          onClick={() => setDisplayedAssessment(assessmentReviewSnapshot(currentAssessment)!)}
                        >
                          Review this assessment for authorization
                        </button>
                      }
                    />
                  </div>
                )}
                {displayedAssessment && !authorizationAssessment && displayedAssessment !== currentAssessment && (
                  <p className="text-[12px] text-[var(--color-danger)]">
                    The displayed assessment is no longer current. Review the current sealed assessment before authorization.
                  </p>
                )}
                {lastResult?.label === "assess" && <ActionResultBanner result={lastResult} />}
                {lastResult?.label === "assess" && <EvidencePanel value={lastResult.data} />}
              </div>
            )}

            {panel === "authorization" && (
              <div className="max-w-xl space-y-3">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  Authorizing this exact intent (aggregate version: {aggregateVersionLabel(aggregateVersion, Boolean(selectedId))}) atomically advances
                  reviewed → authorized state, runs the deterministic Safety Kernel, and — only if every
                  control PASSes — seals a signed Payment Authorization Envelope.
                </p>
                {authorizationAssessment && (
                  <dl className="space-y-1 border-l-2 border-[var(--color-border)] pl-3 text-[12px] text-[var(--color-ink-muted)]">
                    <Field label="Reviewed assessment" value={authorizationAssessment.assessment_id} />
                    <Field label="Assessment hash" value={authorizationAssessment.assessment_hash} />
                    <Field label="Assessment aggregate version" value={authorizationAssessment.aggregate_version} />
                    <Field label="Decision reviewed" value={authorizationAssessment.decision} />
                    <ul className="list-disc pl-5">{authorizationAssessment.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>
                    <RacePanel race={authorizationAssessment.race} />
                  </dl>
                )}
                <div className="flex gap-3">
                  <PrimaryButton
                    disabled={busy || !selectedId || !authorizationAssessment}
                    onClick={() =>
                      run("approve", () =>
                        postJson(`/api/obligations/${selectedId}/approve`, {
                          expected_version: Number(authorizationAssessment!.aggregate_version),
                          reviewed_assessment_id: authorizationAssessment!.assessment_id,
                          reviewed_assessment_hash: authorizationAssessment!.assessment_hash,
                        }),
                      )
                    }
                  >
                    Authorize this exact intent
                  </PrimaryButton>
                </div>
                {lastResult?.label === "approve" && <ActionResultBanner result={lastResult} />}
                {lastResult?.label === "approve" &&
                  (() => {
                    const data = lastResult.data as { safety_kernel?: { overall: string; control_results: ControlResultView[] } };
                    return data.safety_kernel ? (
                      <SafetyKernelBreakdown overall={data.safety_kernel.overall} controlResults={data.safety_kernel.control_results} />
                    ) : null;
                  })()}
                {lastResult?.label === "approve" && <EvidencePanel value={lastResult.data} />}
              </div>
            )}

            {panel === "assurance" && (
              <div className="max-w-xl space-y-3">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  The Execution Worker independently re-verifies the sealed envelope and current destination/
                  wallet trust before submitting — a changed destination is blocked here, before any provider
                  call.
                </p>

                <div
                  className={`flex flex-wrap items-center justify-between gap-3 border-l-[3px] px-3 py-2 ${
                    killSwitchView === "disabled"
                      ? "border-l-[var(--color-danger)] bg-[var(--color-surface)]"
                      : "border-l-[var(--color-border)]"
                  }`}
                >
                  <div>
                    <p
                      className={`text-[13px] font-semibold uppercase tracking-wide ${
                        killSwitchView === "disabled"
                          ? "text-[var(--color-danger)]"
                          : killSwitchView === "no-selection"
                            ? "text-[var(--color-ink-muted)]"
                            : "text-[var(--status-pass-text)]"
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
                      disabled={busy || !selectedId}
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
                      disabled={busy || !selectedId}
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
                {lastResult?.label === "kill-switch" && <ActionResultBanner result={lastResult} />}

                <div className="flex flex-wrap items-center gap-4">
                  <PrimaryButton disabled={busy || !selectedId || !detail?.pae_sealed} onClick={() => run("execute", () => postJson(`/api/obligations/${selectedId}/execute`))}>
                    Submit for execution (simulated)
                  </PrimaryButton>
                  <button
                    disabled={busy || !selectedId || !detail?.pae_sealed}
                    onClick={() =>
                      run("prime-packet", async () => {
                        const response = await fetch(`/api/obligations/${selectedId}/prime-approval-packet`);
                        return { ok: response.ok, status: response.status, data: await response.json() };
                      })
                    }
                    className="text-[13px] font-medium text-[var(--color-ink)] underline decoration-[var(--color-border)] underline-offset-4 hover:decoration-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    View exact intent for a real J2 transfer (Prime approval packet)
                  </button>
                </div>
                {!detail?.pae_sealed && (
                  <p className="text-[12px] text-[var(--color-warning)]">Authorize the obligation first.</p>
                )}
                {lastResult?.label === "execute" && <ActionResultBanner result={lastResult} />}
                {lastResult?.label === "execute" && <EvidencePanel value={lastResult.data} />}
                {lastResult?.label === "prime-packet" && <ActionResultBanner result={lastResult} />}
                {lastResult?.label === "prime-packet" && lastResult.ok && (
                  <div className="max-w-xl border-l-[3px] border-l-[var(--color-warning)] pl-3">
                    <p className="mb-2 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-warning)]">
                      Retained Prime gate — not submitted
                    </p>
                    <pre className="tabular whitespace-pre-wrap text-[12px] leading-relaxed text-[var(--color-ink)]">
                      {(lastResult.data as { text?: string })?.text ?? JSON.stringify(lastResult.data, null, 2)}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {panel === "reconciliation" && (
              <div className="max-w-xl space-y-3">
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  Demonstration attack: mutate the destination after authorization, as if a compromised
                  session changed it. Expected result — blocked before submission, zero unauthorized
                  movement.
                </p>
                <PrimaryButton
                  danger
                  disabled={busy || !selectedId || !detail?.pae_sealed}
                  onClick={() => run("attack", () => postJson(`/api/obligations/${selectedId}/simulate-attack`))}
                >
                  Simulate changed-destination attack
                </PrimaryButton>
                {!detail?.pae_sealed && (
                  <p className="text-[12px] text-[var(--color-warning)]">Authorize the obligation first.</p>
                )}
                {lastResult?.label === "attack" && <ActionResultBanner result={lastResult} />}
                {lastResult?.label === "attack" && <EvidencePanel value={lastResult.data} />}
                                {detail && <EvidencePanel value={detail} />}
              </div>
            )}

            {panel === "report" && (
              <div className="max-w-xl space-y-4">
                <section aria-label="HOLD/ESCALATE aggregate summary" className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                    Operational report — HOLD/ESCALATE obligations
                  </p>
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
                    Select an obligation to view its HOLD/ESCALATE operational report.
                  </p>
                )}

                {report && report.fail_closed && report.fail_closed_reason && (
                  <div className="rounded border-l-[3px] border-l-[var(--color-danger)] bg-[var(--color-danger-bg)] px-3 py-2">
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-danger)]">
                      Fail-closed — default HOLD
                    </p>
                    <p className="text-[12px] text-[var(--color-danger)]">{report.fail_closed_reason}</p>
                  </div>
                )}

                {report && (
                  <section aria-label={`Operational report for ${report.obligation_id}`} className="space-y-3">
                    {/* Supplier / source reference */}
                    <div className="space-y-1 border-l-2 border-[var(--color-ink)] pl-3">
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
                    <div className="space-y-1 border-l-2 border-[var(--color-ink-muted)] pl-3">
                      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ink-muted)]">
                        Amount
                      </h3>
                      <Field label="Obligation amount" value={`${report.amount} ${report.currency}`} />
                    </div>

                    {/* Decision banner — never color-only */}
                    <div
                      className="border-l-[3px] pl-3 py-2"
                      style={{
                        borderLeftColor: report.decision === "ESCALATE"
                          ? "var(--status-blocked-border)"
                          : report.decision === "PAY" ? "var(--color-border)" : "var(--status-hold-border)",
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--color-ink)]">
                          Decision: {report.decision}
                        </p>
                        <span
                          className="text-[11px] font-semibold uppercase"
                          style={{
                            color: report.decision === "ESCALATE"
                              ? "var(--status-blocked-text)"
                              : report.decision === "PAY" ? "var(--color-ink-muted)" : "var(--status-hold-text)",
                          }}
                          aria-label={`Effective decision: ${report.decision}${report.fail_closed ? " (fail-closed HOLD)" : ""}`}
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
                    <div className="space-y-1 border-l-2 border-[var(--color-border)] pl-3">
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
                        <ul className="list-disc pl-5 text-[12px] text-[var(--color-ink-muted)]">
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
                        <ul className="list-disc pl-5 text-[12px] text-[var(--color-ink-muted)]">
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
                          <div key={item.finding_code} className="border-l-2 border-[var(--color-warning)] pl-2 space-y-1">
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
    </main>
  );
}
