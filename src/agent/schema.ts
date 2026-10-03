import { z } from "zod";
import { FINDING_CATALOG, findingCodeSchema } from "./finding-catalog";

const modelFindingCodeSchema = z.enum([
  "DUPLICATE_SOURCE",
  "POTENTIAL_DUPLICATE",
  "NORMALIZATION_REVIEW_REQUIRED",
  "OTHER_REQUIRES_HUMAN_REVIEW",
]);
export const modelProposedFindingCodeSchema = modelFindingCodeSchema;
export type ModelProposedFindingCode = z.infer<typeof modelProposedFindingCodeSchema>;

export const missingContextCodeSchema = z.enum([
  "DUE_DATE_SOURCE",
  "DESTINATION_TRUST_SEED",
  "SOURCE_EVIDENCE",
  "BUSINESS_PURPOSE_CONFIRMATION",
  "CURRENCY_POLICY",
  "DUPLICATE_REVIEW",
  "EVIDENCE_INTEGRITY_REVIEW",
  "NORMALIZATION_SOURCE",
  "PROVIDER_RESPONSE",
  "HUMAN_DECISION",
]);
export type MissingContextCode = z.infer<typeof missingContextCodeSchema>;

const validatedFindingSchema = z.object({
  code: findingCodeSchema,
  severity: z.enum(["HOLD", "ESCALATE"]),
  reason: z.string().min(1),
}).strict().superRefine((finding, ctx) => {
  const expected = FINDING_CATALOG[finding.code].severity;
  if (finding.severity !== expected) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "finding severity does not match the application catalog" });
});

export const remediationItemSchema = z.object({
  finding_code: findingCodeSchema,
  reason: z.string().min(1),
  required_action: z.string().min(1),
  required_evidence: z.array(z.string().min(1)).min(1),
  owner_role: z.string().min(1),
  reassess_after_resolution: z.boolean(),
  escalation_target: z.string().min(1).optional(),
}).strict().superRefine((item, ctx) => {
  if (FINDING_CATALOG[item.finding_code].severity === "ESCALATE" && !item.escalation_target) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "escalation finding requires an escalation_target" });
  }
});

export const raceAssessmentSchema = z.object({
  result: z.object({
    decision: z.enum(["PAY", "HOLD", "ESCALATE"]),
    decision_summary: z.string().min(1),
    validated_findings: z.array(validatedFindingSchema),
  }).strict(),
  action_taken: z.object({
    summary: z.string().min(1),
    checks: z.array(z.string().min(1)),
  }).strict(),
  caveats: z.object({
    missing_context: z.array(missingContextCodeSchema),
    uncertainty_signal: z.boolean(),
    /** Optional only for immutable RACE records sealed before proposal audit was added. */
    model_proposed_findings: z.array(modelProposedFindingCodeSchema).optional(),
    model_proposed_findings_authority: z.literal("NON_AUTHORITATIVE").optional(),
    model_explanation: z.string().max(1000),
    model_explanation_authority: z.literal("NON_AUTHORITATIVE"),
  }).strict(),
  evidence: z.object({
    evidence_ids: z.array(z.string().min(1)),
    authoritative_facts: z.object({
      obligation_id: z.string().min(1),
      aggregate_version: z.string().regex(/^(0|[1-9][0-9]*)$/),
      amount: z.string().min(1),
      currency: z.string().regex(/^[A-Z]{3}$/),
      due_date: z.string().nullable(),
      due_date_status: z.enum(["STATED_ON_SOURCE", "NOT_STATED_ON_SOURCE"]),
      due_date_position: z.enum(["NOT_STATED", "INVALID", "OVERDUE", "DUE_TODAY", "FUTURE"]),
      as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      state_at_event_baseline: z.literal("OUTSTANDING"),
      business_purpose_confirmed: z.boolean(),
      source_evidence_present: z.boolean(),
      destination_status: z.string().min(1),
      destination_readiness_source: z.enum(["IMMUTABLE_SOURCE_EVIDENCE", "CURRENT_PRODUCT_TRUST_EVIDENCE", "SIMULATED_DEMO_FIXTURE", "SYNTHETIC_EVALUATION_FIXTURE", "UNVERIFIED_CURRENT_TRUST"]).optional(),
    }).strict(),
  }).strict(),
  remediation: z.array(remediationItemSchema),
  prompt_identity: z.object({
    version: z.string().min(1),
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
  }).strict().nullable(),
}).strict().superRefine((race, ctx) => {
  const findingCodes = race.result.validated_findings.map((finding) => finding.code);
  const remediationCodes = race.remediation.map((item) => item.finding_code);
  if (new Set(findingCodes).size !== findingCodes.length || new Set(remediationCodes).size !== remediationCodes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "RACE findings and remediation codes must be unique" });
  }
  if (findingCodes.length !== remediationCodes.length || findingCodes.some((code) => !remediationCodes.includes(code))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "every validated finding must have application-owned remediation" });
  }
  if (race.result.decision === "PAY" && findingCodes.length > 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "PAY cannot contain validated blockers" });
  }
  if (race.result.decision === "HOLD" && (findingCodes.length === 0 || race.result.validated_findings.some((finding) => finding.severity !== "HOLD"))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "HOLD requires only validated HOLD findings" });
  }
  if (race.result.decision === "ESCALATE" && !race.result.validated_findings.some((finding) => finding.severity === "ESCALATE")) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "ESCALATE requires a validated escalation finding" });
  }
  if ((race.caveats.model_proposed_findings === undefined) !== (race.caveats.model_proposed_findings_authority === undefined)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "model proposal audit data and its authority label must be present together" });
  }
  const facts = race.evidence.authoritative_facts;
  const validDate = (date: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
  };
  if (!validDate(facts.as_of_date)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "as_of_date must be a valid calendar date" });
  const expectedDuePosition = facts.due_date_status === "NOT_STATED_ON_SOURCE" && facts.due_date === null
    ? "NOT_STATED"
    : facts.due_date_status !== "STATED_ON_SOURCE" || !facts.due_date || !validDate(facts.due_date)
      ? "INVALID"
      : facts.due_date < facts.as_of_date
        ? "OVERDUE"
        : facts.due_date === facts.as_of_date
          ? "DUE_TODAY"
          : "FUTURE";
  if (facts.due_date_position !== expectedDuePosition) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "due_date_position must match the application-derived calendar dates" });
  }
  for (const proposedCode of race.caveats.model_proposed_findings ?? []) {
    const applicationPredicateProvesProposal = proposedCode === "NORMALIZATION_REVIEW_REQUIRED" && facts.due_date_position === "INVALID";
    if (findingCodes.includes(proposedCode) && !applicationPredicateProvesProposal) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "a model proposal cannot be authoritative without a matching application predicate" });
    }
  }
});
export type RaceAssessment = z.infer<typeof raceAssessmentSchema>;

/**
 * The Finance Agent's entire allowed output surface. Nothing outside this
 * schema can ever reach the rest of the system: nothing here can approve,
 * sign, select a provider, or move money — those fields simply do not
 * exist in this schema, so a prompt-injected model response asking to
 * "approve and execute" has no field to write that request into. Unknown
 * keys are rejected outright (`.strict()`), not silently dropped, so an
 * attempted capability-expansion is a hard parse failure, not a partial
 * success.
 */
export const financeAgentModelRecommendationSchema = z
  .object({
    obligation_id: z.string().min(1),
    decision: z.enum(["PAY", "HOLD", "ESCALATE"]),
    finding_codes: z.array(modelFindingCodeSchema).max(10),
    evidence_ids: z.array(z.string().min(1)),
    uncertainty_signal: z.boolean(),
    explanation: z.string().max(1000),
  })
  .strict();

export type FinanceAgentModelRecommendation = z.infer<typeof financeAgentModelRecommendationSchema>;

/** The minimal, allowlisted, read-only context handed to the AI provider. No PII, no secrets. */
export const financeAgentContextSchema = z
  .object({
    obligation_id: z.string(),
    aggregate_version: z.string().regex(/^(0|[1-9][0-9]*)$/),
    as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amount: z.string(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    service_category: z.string(),
    recurrence: z.enum(["MONTHLY", "YEARLY", "ONE_TIME"]),
    due_date: z.string().nullable(),
    due_date_status: z.enum(["STATED_ON_SOURCE", "NOT_STATED_ON_SOURCE"]),
    state_at_event_baseline: z.literal("OUTSTANDING"),
    business_purpose_confirmed: z.boolean(),
    commercial_terms: z.string(),
    evidence_ids: z.array(z.string()),
    evidence_present: z.boolean(),
    destination_ready: z.boolean(),
    destination_status: z.string(),
    destination_readiness_source: z.enum(["IMMUTABLE_SOURCE_EVIDENCE", "CURRENT_PRODUCT_TRUST_EVIDENCE", "SIMULATED_DEMO_FIXTURE", "SYNTHETIC_EVALUATION_FIXTURE", "UNVERIFIED_CURRENT_TRUST"]),
      due_date_position: z.enum(["NOT_STATED", "INVALID", "OVERDUE", "DUE_TODAY", "FUTURE"]),
  })
  .strict();

export type FinanceAgentContext = z.infer<typeof financeAgentContextSchema>;
