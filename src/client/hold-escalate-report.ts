import type { RaceAssessment } from "../agent/schema";

/** Provider mode — truthful, only surfaced when actually present in the
 * sealed assessment. Never fabricated. Mirrors the domain enum. */
export type ReportProviderMode = "LIVE_AI" | "NOT_LIVE_AI" | "BLOCKED_EXTERNAL";

/** Effective decision for the report. HOLD/ESCALATE are the report scope;
 * PAY is shown truthfully but flagged out-of-scope. */
export type ReportDecision = "HOLD" | "ESCALATE" | "PAY";

/** Freshness of the assessment truth backing the report line. */
export type ReportStatus = "CURRENT" | "STALE" | "UNASSESSED";

/** Source-system reference identifying the supplier / obligation origin. */
export interface ReportSupplierReference {
  source_system_id: string;
  record_id: string;
  record_type: string;
  approval_state: string;
  execution_authority: string;
}

/** One catalog-derived remediation item, projected to plain data. */
export interface ReportRemediationItem {
  finding_code: string;
  reason: string;
  required_action: string;
  required_evidence: string[];
  owner_role: string;
  reassess_after_resolution: boolean;
  escalation_target?: string;
}

/** Minimal assessment view consumed by the report. Structurally compatible
 * with the current_assessment object that the obligations API surfaces, so
 * the Command Center can pass it directly without extra mapping. */
export interface ReportAssessmentInput {
  assessment_id: string;
  assessment_hash: string;
  aggregate_version: string;
  decision: "PAY" | "HOLD" | "ESCALATE";
  reasons: string[];
  provider_used?: string;
  provider_mode?: ReportProviderMode;
  race?: RaceAssessment;
}

/** All authoritative state the report needs from a single obligation. */
export interface HoldEscalateReportInput {
  obligation_id: string;
  amount: string;
  currency: string;
  aggregate_version: number;
  source: ReportSupplierReference;
  assessment: ReportAssessmentInput | null;
}

/** A single operational-report line for one obligation. */
export interface HoldEscalateReportLine {
  obligation_id: string;
  supplier_reference: ReportSupplierReference;
  amount: string;
  currency: string;
  /** Effective decision after fail-closed evaluation (HOLD/ESCALATE/PAY). */
  decision: ReportDecision;
  /** Freshness of the assessment truth. */
  status: ReportStatus;
  /** True for HOLD/ESCALATE (the report's scope); false for PAY. */
  in_scope: boolean;
  /** True when the decision was derived from fail-closed defaults rather
   * than from a current, assessed state. */
  fail_closed: boolean;
  /** Why truth was insufficient, when fail_closed is true. */
  fail_closed_reason: string | null;
  /** Application-owned reason strings from the sealed assessment. Empty when
   * the assessment is missing and reasons cannot be trusted. */
  reasons: string[];
  /** Evidence-gap codes from RACE caveats (typed missing context). */
  evidence_gap: string[];
  /** Catalog-derived remediation items from RACE. */
  remediation: ReportRemediationItem[];
  /** As-of date from the RACE authoritative-facts block, when available. */
  assessment_time: string | null;
  /** Truthful provider mode, only when actually present in the assessment. */
  provider_mode: ReportProviderMode | null;
  /** Provider used (advisory), when available. */
  provider_used: string | null;
  assessment_id: string | null;
  assessment_hash: string | null;
}

/** Minimal obligation summary consumed by the aggregate function. */
export interface SummaryObligationInput {
  obligation_id: string;
  assessed: boolean;
  decision: string | null;
  provider_mode: ReportProviderMode | null;
}

/** Aggregate HOLD/ESCALATE counts across the obligation set. */
export interface HoldEscalateSummary {
  total: number;
  hold: number;
  escalate: number;
  unassessed: number;
  pay: number;
}


function normalizeRemediation(
  item: RaceAssessment["remediation"][number],
): ReportRemediationItem {
  return {
    finding_code: item.finding_code,
    reason: item.reason,
    required_action: item.required_action,
    required_evidence: [...item.required_evidence],
    owner_role: item.owner_role,
    reassess_after_resolution: item.reassess_after_resolution,
    ...(item.escalation_target ? { escalation_target: item.escalation_target } : {}),
  };
}

/**
 * Derives a read-only HOLD/ESCALATE operational-report line from
 * authoritative current assessment and obligation state.
 *
 * Fail-closed rules:
 * - UNASSESSED (no sealed assessment): decision → HOLD, no fabricated reasons.
 * - STALE (aggregate-version mismatch): decision → HOLD, preserve old data for
 *   context but flag fail-closed so it is never mistaken for current truth.
 * - Current assessment: use the actual decision; PAY is shown truthfully but
 *   flagged as outside HOLD/ESCALATE scope.
 *
 * This function never fabricates settled/PAY/provider facts. It never
 * touches execution state, Paid/Reconciled status, or the execution register —
 * those are deferred pending verified backing truth.
 */
export function buildHoldEscalateReport(
  input: HoldEscalateReportInput,
): HoldEscalateReportLine {
  const { obligation_id, amount, currency, aggregate_version, source, assessment } = input;

  // --- UNASSESSED: fail closed to HOLD, no fabricated facts ---
  if (!assessment) {
    return {
      obligation_id,
      supplier_reference: source,
      amount,
      currency,
      decision: "HOLD",
      status: "UNASSESSED",
      in_scope: true,
      fail_closed: true,
      fail_closed_reason: "No sealed assessment exists for this obligation.",
      reasons: [
        "No sealed assessment exists — an assessment is required before any HOLD or ESCALATE determination.",
      ],
      evidence_gap: [],
      remediation: [],
      assessment_time: null,
      provider_mode: null,
      provider_used: null,
      assessment_id: null,
      assessment_hash: null,
    };
  }

  const race = assessment.race;
  // assessment_time: the as-of date from RACE authoritative facts, when
  // available. Not fabricated when the race block is absent.
  const assessmentTime = race?.evidence.authoritative_facts.as_of_date ?? null;
  const evidenceGap = race?.caveats.missing_context ?? [];
  const remediation = race ? race.remediation.map(normalizeRemediation) : [];
  const isStale = assessment.aggregate_version !== String(aggregate_version);

  // --- STALE: fail closed to HOLD, preserve data for context only ---
  if (isStale) {
    return {
      obligation_id,
      supplier_reference: source,
      amount,
      currency,
      decision: "HOLD",
      status: "STALE",
      in_scope: true,
      fail_closed: true,
      fail_closed_reason:
        `Assessment is bound to aggregate v${assessment.aggregate_version}; current aggregate is v${aggregate_version}.`,
            reasons: assessment.reasons,
      evidence_gap: evidenceGap,
      remediation,
      assessment_time: assessmentTime,
      provider_mode: assessment.provider_mode ?? null,
      provider_used: assessment.provider_used ?? null,
      assessment_id: assessment.assessment_id,
      assessment_hash: assessment.assessment_hash,
    };
  }

  // --- CURRENT: use the actual decision, truthfully ---
  return {
    obligation_id,
    supplier_reference: source,
    amount,
    currency,
    decision: assessment.decision,
    status: "CURRENT",
    in_scope: assessment.decision === "HOLD" || assessment.decision === "ESCALATE",
    fail_closed: false,
    fail_closed_reason: null,
    reasons: assessment.reasons,
    evidence_gap: evidenceGap,
    remediation,
    assessment_time: assessmentTime,
    provider_mode: assessment.provider_mode ?? null,
    provider_used: assessment.provider_used ?? null,
    assessment_id: assessment.assessment_id,
    assessment_hash: assessment.assessment_hash,
  };
}

/**
 * Computes aggregate HOLD/ESCALATE counts across the obligation set.
 * Unassessed obligations (no sealed assessment or null decision) are
 * counted as "unassessed"; PAY obligations are counted separately since
 * they are outside HOLD/ESCALATE scope.
 */
export function buildHoldEscalateSummary(
  obligations: readonly SummaryObligationInput[],
): HoldEscalateSummary {
  const summary: HoldEscalateSummary = {
    total: obligations.length,
    hold: 0,
    escalate: 0,
    unassessed: 0,
    pay: 0,
  };
  for (const o of obligations) {
    if (!o.assessed || o.decision === null) {
      summary.unassessed += 1;
    } else if (o.decision === "HOLD") {
      summary.hold += 1;
    } else if (o.decision === "ESCALATE") {
      summary.escalate += 1;
    } else if (o.decision === "PAY") {
      summary.pay += 1;
    } else {
      summary.unassessed += 1;
    }
  }
  return summary;
}

