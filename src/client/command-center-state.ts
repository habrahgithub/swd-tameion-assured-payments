import type { RaceAssessment } from "../agent/schema";

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
