import type { RaceAssessment } from "../agent/schema";

/** Validate selected-detail identity at the JSON boundary before the response
 * is used to build a report or bind an action to an obligation. */
export function hasExpectedObligationIdentity(value: unknown, expectedId: string): boolean {
  if (!expectedId) return false;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = (value as { record?: unknown }).record;
  return Boolean(
    record &&
      typeof record === "object" &&
      !Array.isArray(record) &&
      "obligation_id" in record &&
      typeof (record as { obligation_id?: unknown }).obligation_id === "string" &&
      (record as { obligation_id: string }).obligation_id === expectedId,
  );
}

export function judgeReadableState(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

export function hasSimulatedTrustFixture(flag: boolean, sourceWalletRef: string): boolean {
  return flag || /simulated/i.test(sourceWalletRef);
}

export function assessmentNextAction(decision: "PAY" | "HOLD" | "ESCALATE", allAssessed: boolean): string {
  if (decision === "PAY") {
    return allAssessed
      ? "Next action: review this advisory recommendation for human authorization. A PAY decision does not authorize payment."
      : "Next action: assess the remaining genuine obligations before human authorization review. A PAY decision does not authorize payment.";
  }
  if (decision === "HOLD") return "Next action: resolve the findings before reassessing. Authorization remains locked.";
  return "Next action: escalate the findings for human review. Authorization remains locked.";
}

export function settlementDisplay(
  source: { currency: string; amount: string },
  settlement: { amount: string; asset: string } | undefined,
  intentExists = false,
): string {
  if (source.currency !== "AED" && source.currency !== "USD") {
    return `Not settleable — unsupported source currency ${source.currency}; no settlement is derived.`;
  }
  if (!settlement) return `Unavailable — server settlement truth not loaded (source ${source.amount} ${source.currency}).`;
  if (intentExists) return `Intent-bound amount: ${settlement.amount} ${settlement.asset}.`;
  const policyRate = source.currency === "AED" ? " · Rate: 1 USD = AED 3.6725" : "";
  return `≈ ${settlement.amount} ${settlement.asset} (indicative only)${policyRate} · No payment intent exists.`;
}

export type AssessmentTraceStepId = "SOURCE_IDS" | "SUPPLIED_FACTS" | "PROPOSAL" | "VALIDATED_FINDINGS" | "CATALOG";

export interface AssessmentTraceStep {
  step: AssessmentTraceStepId;
  label: string;
  authority: "SOURCE_IDENTIFIERS" | "SUPPLIED_FACTS" | "NON_AUTHORITATIVE" | "APPLICATION_OWNED" | "CATALOG";
  items: string[];
  empty_reason: string | null;
}

/** Trace of one sealed assessment, projected only from fields already present in
 * the RACE record. It describes what the record contains; it does not assert any
 * independent source investigation, raw-document review, or new evidence. */
export function buildAssessmentTrace(race: RaceAssessment): AssessmentTraceStep[] {
  const facts = race.evidence.authoritative_facts;
  const validated = race.result.validated_findings;
  const validatedCodes = new Set<string>(validated.map((finding) => finding.code));
  const proposed = race.caveats.model_proposed_findings ?? [];
  const rejected = proposed.filter((code) => !validatedCodes.has(code));

  return [
    {
      step: "SOURCE_IDS",
      label: "Source evidence IDs",
      authority: "SOURCE_IDENTIFIERS",
      items: [...race.evidence.evidence_ids],
      empty_reason: race.evidence.evidence_ids.length === 0 ? "No source evidence IDs were supplied; no evidence is claimed." : null,
    },
    {
      step: "SUPPLIED_FACTS",
      label: "Supplied facts used by the decision",
      authority: "SUPPLIED_FACTS",
      items: [
        `Amount ${facts.amount} ${facts.currency}`,
        `Due date ${facts.due_date ?? "not stated"} (${facts.due_date_position} as of ${facts.as_of_date})`,
        `Source evidence present: ${facts.source_evidence_present ? "yes" : "no"}`,
        `Business purpose confirmed: ${facts.business_purpose_confirmed ? "yes" : "no"}`,
        `Destination: ${facts.destination_status}`,
        `Destination readiness source: ${facts.destination_readiness_source ?? "not recorded"}`,
        `Due date status: ${facts.due_date_status}`,
        "Source-to-context completeness: UNVERIFIED — this record does not establish that every source fact was supplied.",
      ],
      empty_reason: null,
    },
    {
      step: "PROPOSAL",
      label: "Model proposal (advisory)",
      authority: "NON_AUTHORITATIVE",
      items: [
        race.caveats.model_explanation,
        ...rejected.map((code) => `${code} — not validated; rejected by deterministic checks`),
      ].filter((item) => item.length > 0),
      empty_reason: race.caveats.model_explanation ? null : "The model returned no explanation.",
    },
    {
      step: "VALIDATED_FINDINGS",
      label: "Validated deterministic findings",
      authority: "APPLICATION_OWNED",
      items: validated.map((finding) => `${finding.code} (${finding.severity}) — ${finding.reason}`),
      empty_reason: validated.length === 0 ? "No deterministic findings were validated for this record." : null,
    },
    {
      step: "CATALOG",
      label: "Catalog remediation",
      authority: "CATALOG",
      items: race.remediation.map(
        (item) => `${item.finding_code} → ${item.owner_role}: ${item.required_action}`,
      ),
      empty_reason: race.remediation.length === 0 ? "No catalog remediation applies to this record." : null,
    },
  ];
}
