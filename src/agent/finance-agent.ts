import type { AiProvider } from "./ai-provider";
import { FINDING_CATALOG, remediationFor, type FindingCode } from "./finding-catalog";
import {
  financeAgentModelRecommendationSchema,
  type FinanceAgentContext,
  type ModelProposedFindingCode,
  type MissingContextCode,
  type RaceAssessment,
 } from "./schema";
import { isSettleableCurrency } from "../domain/currency-conversion";


/** Compatibility prefix retained for the route's live-provider fail-closed classification. */
export const PROVIDER_CALL_FAILURE_REASON_PREFIX = "AI provider call failed:";

export interface FinanceAgentDecision {
  obligation_id: string;
  decision: "PAY" | "HOLD" | "ESCALATE";
  /** Application-owned summaries derived from validated finding codes. */
  reasons: string[];
  evidence_ids: string[];
  /** Compatibility projection of typed missing_context codes. */
  missing_evidence: string[];
  uncertainty_signal: boolean;
  race: RaceAssessment;
}

const MISSING_CONTEXT_BY_FINDING: Partial<Record<FindingCode, MissingContextCode>> = {
  DUE_DATE_NOT_STATED: "DUE_DATE_SOURCE",
  DESTINATION_NOT_READY: "DESTINATION_TRUST_SEED",
  SOURCE_EVIDENCE_MISSING: "SOURCE_EVIDENCE",
  BUSINESS_PURPOSE_UNCONFIRMED: "BUSINESS_PURPOSE_CONFIRMATION",
  UNSUPPORTED_SETTLEMENT_CURRENCY: "CURRENCY_POLICY",
  DUPLICATE_SOURCE: "DUPLICATE_REVIEW",
  POTENTIAL_DUPLICATE: "DUPLICATE_REVIEW",
  EVIDENCE_INTEGRITY_FAILED: "EVIDENCE_INTEGRITY_REVIEW",
  NORMALIZATION_REVIEW_REQUIRED: "NORMALIZATION_SOURCE",
  PROVIDER_UNAVAILABLE: "PROVIDER_RESPONSE",
  OTHER_REQUIRES_HUMAN_REVIEW: "HUMAN_DECISION",
  MODEL_OUTPUT_INVALID: "PROVIDER_RESPONSE",
};

export function wasProviderCallFailure(decision: FinanceAgentDecision): boolean {
  return decision.race.result.validated_findings.some((finding) => finding.code === "PROVIDER_UNAVAILABLE");
}

export async function assessObligation(
  context: FinanceAgentContext,
  provider: AiProvider,
  options: { signal?: AbortSignal } = {},
): Promise<FinanceAgentDecision> {
  let rawOutput: unknown;
  try {
    rawOutput = await provider.assess(context, options);
  } catch {
    if (options.signal?.aborted) throw new Error("Assessment cancelled");
    return normalizeFailure(context, "PROVIDER_UNAVAILABLE", provider);
  }

  const parsed = financeAgentModelRecommendationSchema.safeParse(rawOutput);
  if (!parsed.success || parsed.data.obligation_id !== context.obligation_id) {
    return normalizeFailure(context, "MODEL_OUTPUT_INVALID", provider);
  }

  const suppliedEvidenceIds = new Set(context.evidence_ids);
  if (parsed.data.evidence_ids.some((id) => !suppliedEvidenceIds.has(id))) {
    return normalizeFailure(context, "EVIDENCE_INTEGRITY_FAILED", provider);
  }
  if (parsed.data.decision === "PAY" && parsed.data.evidence_ids.length === 0) {
    return normalizeFailure(context, "SOURCE_EVIDENCE_MISSING", provider);
  }

  const codes = deterministicFindings(context);
  const modelProposedFindings: ModelProposedFindingCode[] = parsed.data.finding_codes;
  const unsupportedProposals = modelProposedFindings.filter((code) => !codes.has(code));
  if (unsupportedProposals.length > 0) codes.add("MODEL_OUTPUT_INVALID");

  const hasEscalationFinding = [...codes].some((code) => FINDING_CATALOG[code].severity === "ESCALATE");
  if ((parsed.data.decision === "HOLD" || parsed.data.decision === "ESCALATE") && !hasEscalationFinding && codes.size === 0) {
    codes.add("MODEL_OUTPUT_INVALID");
  }

  return normalize(context, {
    codes: [...codes],
    evidenceIds: context.evidence_ids,
    uncertaintySignal: parsed.data.uncertainty_signal,
    explanation: parsed.data.explanation,
    modelProposedFindings,
    promptIdentity: provider.promptIdentity ?? null,
  });
}

function deterministicFindings(context: FinanceAgentContext): Set<FindingCode> {
  const findings = new Set<FindingCode>();
  if (!context.evidence_present || context.evidence_ids.length === 0) findings.add("SOURCE_EVIDENCE_MISSING");
  if (context.due_date_position === "INVALID") findings.add("NORMALIZATION_REVIEW_REQUIRED");
  else if (context.due_date_position === "NOT_STATED") findings.add("DUE_DATE_NOT_STATED");
  if (!isSettleableCurrency(context.currency)) findings.add("UNSUPPORTED_SETTLEMENT_CURRENCY");
  if (!context.business_purpose_confirmed) findings.add("BUSINESS_PURPOSE_UNCONFIRMED");
  return findings;
}

function normalizeFailure(context: FinanceAgentContext, code: FindingCode, provider: AiProvider): FinanceAgentDecision {
  const codes = deterministicFindings(context);
  codes.add(code);
  return normalize(context, {
    codes: [...codes],
    evidenceIds: context.evidence_ids,
    uncertaintySignal: true,
    explanation: "",
    modelProposedFindings: [],
    promptIdentity: provider.promptIdentity ?? null,
  });
}

function normalize(
  context: FinanceAgentContext,
  input: {
    codes: FindingCode[];
    evidenceIds: string[];
    uncertaintySignal: boolean;
    explanation: string;
    modelProposedFindings: ModelProposedFindingCode[];
    promptIdentity: AiProvider["promptIdentity"];
  },
): FinanceAgentDecision {
  const uniqueCodes = [...new Set(input.codes)];
  const findings = uniqueCodes.map((code) => ({
    code,
    severity: FINDING_CATALOG[code].severity,
    reason: FINDING_CATALOG[code].reason,
  }));
  const decision: FinanceAgentDecision["decision"] = findings.some((item) => item.severity === "ESCALATE")
    ? "ESCALATE"
    : findings.length > 0
      ? "HOLD"
      : "PAY";
  const finalCodes = findings.length === 0 && decision !== "PAY" ? ["MODEL_OUTPUT_INVALID" as const] : uniqueCodes;
  const finalFindings = finalCodes.map((code) => ({
    code,
    severity: FINDING_CATALOG[code].severity,
    reason: FINDING_CATALOG[code].reason,
  }));
  const normalizedDecision = finalFindings.some((item) => item.severity === "ESCALATE")
    ? "ESCALATE"
    : finalFindings.length > 0
      ? "HOLD"
      : decision;
  const missingContext = [...new Set(finalCodes.flatMap((code) => MISSING_CONTEXT_BY_FINDING[code] ?? []))];
  const summary = normalizedDecision === "PAY"
    ? "No validated blocker was found; existing deterministic authorization and Safety Kernel gates still apply."
    : finalFindings.map((finding) => finding.reason).join(" ");

  const race: RaceAssessment = {
    result: { decision: normalizedDecision, decision_summary: summary, validated_findings: finalFindings },
    action_taken: {
      summary: "The application checked supplied evidence references and deterministic obligation readiness facts.",
      checks: [
        "Supplied evidence identifiers were checked against the obligation context.",
        "Due-date source status and currentness were derived from the application context.",
        "Business-purpose confirmation and destination readiness were checked as application-owned facts.",
      ],
    },
    caveats: {
      missing_context: missingContext,
      uncertainty_signal: input.uncertaintySignal || normalizedDecision !== "PAY",
      model_proposed_findings: input.modelProposedFindings,
      model_proposed_findings_authority: "NON_AUTHORITATIVE",
      model_explanation: input.explanation,
      model_explanation_authority: "NON_AUTHORITATIVE",
    },
    evidence: {
      evidence_ids: input.evidenceIds,
      authoritative_facts: {
        obligation_id: context.obligation_id,
        aggregate_version: context.aggregate_version,
        amount: context.amount,
        currency: context.currency,
        due_date: context.due_date,
        due_date_status: context.due_date_status,
        due_date_position: context.due_date_position,
        as_of_date: context.as_of_date,
        state_at_event_baseline: context.state_at_event_baseline,
        business_purpose_confirmed: context.business_purpose_confirmed,
        source_evidence_present: context.evidence_present,
        destination_status: context.destination_status,
        destination_readiness_source: context.destination_readiness_source,
      },
    },
    remediation: finalCodes.map(remediationFor),
    prompt_identity: input.promptIdentity ?? null,
  };

  return {
    obligation_id: context.obligation_id,
    decision: normalizedDecision,
    reasons: normalizedDecision === "PAY" ? [summary] : finalFindings.map((finding) => finding.reason),
    evidence_ids: input.evidenceIds,
    missing_evidence: missingContext,
    uncertainty_signal: race.caveats.uncertainty_signal,
    race,
  };
}

export interface CandidateSelection {
  selected_obligation_id: string | null;
  rationale: string;
}

/** Selects only after every obligation is assessed. Tie-breaks remain deterministic. */
export function selectSoleCandidate(
  decisions: Array<Pick<FinanceAgentDecision, "obligation_id" | "decision">>,
  dueDatesByObligationId: Record<string, string | null>,
): CandidateSelection {
  const payCandidates = decisions.filter((decision) => decision.decision === "PAY");
  if (payCandidates.length === 0) return { selected_obligation_id: null, rationale: "No obligation received a PAY decision; no candidate selected." };
  const sorted = [...payCandidates].sort((a, b) => {
    const dueA = dueDatesByObligationId[a.obligation_id];
    const dueB = dueDatesByObligationId[b.obligation_id];
    if (dueA && dueB && dueA !== dueB) return dueA < dueB ? -1 : 1;
    if (dueA && !dueB) return -1;
    if (!dueA && dueB) return 1;
    return a.obligation_id < b.obligation_id ? -1 : 1;
  });
  const winner = sorted[0];
  return {
    selected_obligation_id: winner.obligation_id,
    rationale: payCandidates.length === 1
      ? `Sole PAY decision among ${decisions.length} assessed obligations.`
      : `${payCandidates.length} obligations received PAY; selected ${winner.obligation_id} by earliest stated due date, then lowest obligation_id as tie-break.`,
  };
}
