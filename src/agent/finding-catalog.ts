import { z } from "zod";

/** Application-owned findings and remediation. Model prose never supplies these fields. */
export const findingCodeSchema = z.enum([
  "DUE_DATE_NOT_STATED",
  "DESTINATION_NOT_READY",
  "SOURCE_EVIDENCE_MISSING",
  "BUSINESS_PURPOSE_UNCONFIRMED",
  "UNSUPPORTED_SETTLEMENT_CURRENCY",
  "DUPLICATE_SOURCE",
  "POTENTIAL_DUPLICATE",
  "EVIDENCE_INTEGRITY_FAILED",
  "NORMALIZATION_REVIEW_REQUIRED",
  "PROVIDER_UNAVAILABLE",
  "OTHER_REQUIRES_HUMAN_REVIEW",
  "MODEL_OUTPUT_INVALID",
]);

export type FindingCode = z.infer<typeof findingCodeSchema>;
export type FindingSeverity = "HOLD" | "ESCALATE";

export interface FindingDefinition {
  severity: FindingSeverity;
  reason: string;
  required_action: string;
  required_evidence: string[];
  owner_role: string;
  reassess_after_resolution: boolean;
  escalation_target?: string;
}

export const FINDING_CATALOG: Record<FindingCode, FindingDefinition> = {
  DUE_DATE_NOT_STATED: {
    severity: "HOLD",
    reason: "The source evidence does not state a due date.",
    required_action: "Confirm the contractual due date from an authoritative source.",
    required_evidence: ["Source record that states the obligation due date"],
    owner_role: "Accounts Payable",
    reassess_after_resolution: true,
  },
  DESTINATION_NOT_READY: {
    severity: "HOLD",
    reason: "The Arc product destination and source-wallet trust seed are pending.",
    required_action: "Complete the admitted J0-D destination and source-wallet trust-seed process.",
    required_evidence: ["Verified destination readiness and source-wallet trust-seed record"],
    owner_role: "Treasury Operations",
    reassess_after_resolution: true,
  },
  SOURCE_EVIDENCE_MISSING: {
    severity: "HOLD",
    reason: "No source evidence is attached to this obligation.",
    required_action: "Attach and validate the source evidence for this obligation.",
    required_evidence: ["Invoice, contract, or other approved source evidence"],
    owner_role: "Accounts Payable",
    reassess_after_resolution: true,
  },
  BUSINESS_PURPOSE_UNCONFIRMED: {
    severity: "HOLD",
    reason: "The business purpose has not been confirmed.",
    required_action: "Obtain confirmation from the accountable business owner.",
    required_evidence: ["Business-purpose confirmation from the accountable owner"],
    owner_role: "Requesting Business Owner",
    reassess_after_resolution: true,
  },
  UNSUPPORTED_SETTLEMENT_CURRENCY: {
    severity: "ESCALATE",
    reason: "The settlement currency is outside the application-supported set.",
    required_action: "Resolve the currency policy question through the authorized finance authority.",
    required_evidence: ["Approved settlement-currency policy or exception decision"],
    owner_role: "Finance Policy Owner",
    reassess_after_resolution: true,
    escalation_target: "Authorized finance policy authority",
  },
  DUPLICATE_SOURCE: {
    severity: "ESCALATE",
    reason: "The source may duplicate another recorded obligation.",
    required_action: "Resolve the suspected duplicate with a human reviewer before proceeding.",
    required_evidence: ["Human duplicate-resolution record"],
    owner_role: "Accounts Payable Reviewer",
    reassess_after_resolution: true,
    escalation_target: "Accounts Payable reviewer",
  },
  POTENTIAL_DUPLICATE: {
    severity: "ESCALATE",
    reason: "A potential duplicate requires human review.",
    required_action: "Compare the source obligation with existing records and record the decision.",
    required_evidence: ["Human duplicate-review decision and supporting source references"],
    owner_role: "Accounts Payable Reviewer",
    reassess_after_resolution: true,
    escalation_target: "Accounts Payable reviewer",
  },
  EVIDENCE_INTEGRITY_FAILED: {
    severity: "HOLD",
    reason: "The evidence reference or integrity check failed validation.",
    required_action: "Have an evidence steward validate or replace the affected evidence reference.",
    required_evidence: ["Validated evidence-integrity record"],
    owner_role: "Evidence Steward",
    reassess_after_resolution: true,
  },
  NORMALIZATION_REVIEW_REQUIRED: {
    severity: "HOLD",
    reason: "A normalized obligation field requires review against its source.",
    required_action: "Review the normalized field and correct it from authoritative source evidence.",
    required_evidence: ["Source evidence supporting the corrected normalized field"],
    owner_role: "Finance Operations",
    reassess_after_resolution: true,
  },
  PROVIDER_UNAVAILABLE: {
    severity: "HOLD",
    reason: "The advisory model provider did not return a usable assessment.",
    required_action: "Restore provider availability and submit a new admitted assessment after the operation is resolved.",
    required_evidence: ["Successful provider assessment response"],
    owner_role: "AI Operations",
    reassess_after_resolution: true,
  },
  OTHER_REQUIRES_HUMAN_REVIEW: {
    severity: "ESCALATE",
    reason: "The assessment identifies an issue that requires human judgment.",
    required_action: "Record an authorized human decision for the identified issue.",
    required_evidence: ["Human decision and its supporting evidence"],
    owner_role: "Finance Authority",
    reassess_after_resolution: true,
    escalation_target: "Authorized finance decision-maker",
  },
  MODEL_OUTPUT_INVALID: {
    severity: "HOLD",
    reason: "The advisory assessment output failed application validation.",
    required_action: "Resolve the advisory output validation failure before requesting a new assessment.",
    required_evidence: ["A valid schema-conforming advisory assessment"],
    owner_role: "AI Operations",
    reassess_after_resolution: true,
  },
};

export const findingCodeValues = findingCodeSchema.options;

export function remediationFor(code: FindingCode) {
  const definition = FINDING_CATALOG[code];
  return {
    finding_code: code,
    reason: definition.reason,
    required_action: definition.required_action,
    required_evidence: [...definition.required_evidence],
    owner_role: definition.owner_role,
    reassess_after_resolution: definition.reassess_after_resolution,
    ...(definition.escalation_target ? { escalation_target: definition.escalation_target } : {}),
  };
}
