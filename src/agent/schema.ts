import {historicalAssessmentBasisSchema,historicalDatePosition} from "./assessment-context";
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

/** Sealed application facts; this schema validates historical consistency, not live authority. */
export const controlledInstructionSchema=z.object({
 basis:z.literal("CONTROLLED_OWNER_INSTRUCTION"),purpose:z.literal("TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT"),
 approval_id:z.string().min(1).max(128),admission_version:z.literal(1),source_sha256:z.string().regex(/^[a-f0-9]{64}$/),
 organization_id:z.literal("ORG-DEMO-001"),intent_id:z.string().min(1).max(128),obligation_id:z.string().regex(/^TESTNET-CONTROLLED-[A-Za-z0-9_.:-]+$/),
 aggregate_version:z.string().regex(/^[1-9][0-9]*$/),principal:z.literal("1.000000"),
 source_evidence_sha256:z.string().regex(/^[a-f0-9]{64}$/),valid_from:z.iso.datetime({precision:3}),expires_at:z.iso.datetime({precision:3}),observed_at:z.iso.datetime({precision:3}),status:z.literal("OPEN"),
}).strict().superRefine((p,c)=>{const start=Date.parse(p.valid_from),end=Date.parse(p.expires_at),observed=Date.parse(p.observed_at);if(start>observed||observed>=end||end<=start||end-start>3600000)c.addIssue({code:"custom",message:"Controlled half-open instruction window invalid"});});
export type ControlledInstruction=z.infer<typeof controlledInstructionSchema>;

export const currentSourceBasisSchema=z.object({kind:z.enum(['INVOICE','PREPAID_RECHARGE']),revision:z.number().int().positive(),business_date:z.iso.date(),source_revision_sha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();

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
      current_source_basis:currentSourceBasisSchema.optional(),
    assessment_basis:historicalAssessmentBasisSchema.optional(),
      historical_basis_verified:z.boolean().optional(),
      obligation_id: z.string().min(1),
      aggregate_version: z.string().regex(/^(0|[1-9][0-9]*)$/),
      amount: z.string().min(1),
      currency: z.string().regex(/^[A-Z]{3}$/),
      issue_date: z.string().nullable().optional(),
      due_date: z.string().nullable(),
      due_date_status: z.enum(["STATED_ON_SOURCE", "NOT_STATED_ON_SOURCE"]),
      effective_due_date: z.string().nullable().optional(),
      effective_due_date_basis: z.literal("INVOICE_DATE_CASH_TERM").nullable().optional(),
      effective_due_date_provenance: z.discriminatedUnion("provenance_class", [
        z.object({ provenance_class: z.literal("SOURCE_INVOICE_DATE"), evidence_id: z.string().min(1) }).strict(),
        z.object({ provenance_class: z.literal("AUTHORIZED_OPERATOR_ATTESTATION"), authority_reference: z.string().min(1) }).strict(),
      ]).nullable().optional(),
      due_date_position: z.enum(["NOT_STATED", "INVALID", "OVERDUE", "DUE_TODAY", "FUTURE", "CONTROLLED_WINDOW_OPEN"]),
      as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      state_at_event_baseline: z.literal("OUTSTANDING"),
      business_purpose_confirmed: z.boolean(),
      controlled_instruction: controlledInstructionSchema.optional(),
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
  const hasEffectiveDateContract = facts.issue_date !== undefined || facts.effective_due_date !== undefined ||
    facts.effective_due_date_basis !== undefined || facts.effective_due_date_provenance !== undefined;
  const rawDueDateConsistent = facts.due_date_status === "NOT_STATED_ON_SOURCE"
    ? facts.due_date === null
    : facts.due_date_status === "STATED_ON_SOURCE" && !!facts.due_date && validDate(facts.due_date);
  let effectiveDateContractValid = false;
  if (hasEffectiveDateContract) {
    const provenance = facts.effective_due_date_provenance;
    const provenanceValid = facts.due_date === facts.issue_date && facts.due_date_status === "STATED_ON_SOURCE"
      ? provenance?.provenance_class === "SOURCE_INVOICE_DATE" && provenance.evidence_id.length > 0
      : provenance?.provenance_class === "AUTHORIZED_OPERATOR_ATTESTATION" && provenance.authority_reference.length > 0;
    effectiveDateContractValid = !!facts.issue_date && validDate(facts.issue_date) &&
      !!facts.effective_due_date && validDate(facts.effective_due_date) &&
      facts.effective_due_date === facts.issue_date &&
      facts.effective_due_date_basis === "INVOICE_DATE_CASH_TERM" && provenanceValid;
  }
  const controlled=facts.controlled_instruction;
  if(controlled && (controlled.obligation_id!==facts.obligation_id||controlled.aggregate_version!==facts.aggregate_version||facts.amount!=="1.00"||facts.currency!=="USD"||facts.issue_date!=null||facts.due_date!==null||facts.effective_due_date!=null||facts.effective_due_date_basis!=null||facts.business_purpose_confirmed!==false))ctx.addIssue({code:"custom",message:"Controlled source facts mismatch"});
  const invoiceExpectedDuePosition = controlled ? "CONTROLLED_WINDOW_OPEN" : hasEffectiveDateContract
    ? !rawDueDateConsistent || !effectiveDateContractValid
      ? "INVALID"
      : facts.effective_due_date! < facts.as_of_date
        ? "OVERDUE"
        : facts.effective_due_date === facts.as_of_date
          ? "DUE_TODAY"
          : "FUTURE"
    : facts.due_date_status === "NOT_STATED_ON_SOURCE" && facts.due_date === null
      ? "NOT_STATED"
      : facts.due_date_status !== "STATED_ON_SOURCE" || !facts.due_date || !validDate(facts.due_date)
        ? "INVALID"
        : facts.due_date < facts.as_of_date
          ? "OVERDUE"
          : facts.due_date === facts.as_of_date
            ? "DUE_TODAY"
            : "FUTURE";
  const b=facts.assessment_basis;
  const expectedDuePosition=facts.current_source_basis?(facts.current_source_basis.business_date<facts.as_of_date?"OVERDUE":facts.current_source_basis.business_date===facts.as_of_date?"DUE_TODAY":"FUTURE"):facts.historical_basis_verified===false?"INVALID":b
    ? !facts.historical_basis_verified ? "INVALID" : b.transaction_type==='INVOICE' ? invoiceExpectedDuePosition
      : !rawDueDateConsistent ? "INVALID" : historicalDatePosition(b)
    : invoiceExpectedDuePosition;
  if(b && facts.historical_basis_verified && (facts.as_of_date!==b.simulation.as_of_date ||
    [b.classification_evidence,b.timing.evidence,b.simulation.evidence].some(p=>!race.evidence.evidence_ids.includes(p.evidence_id)) ||
    b.transaction_type==='PREPAID_NO_INVOICE'&&(facts.issue_date!=null||facts.effective_due_date!=null||facts.effective_due_date_basis!=null)||
    b.timing.basis==='STATED_SOURCE_DUE_DATE'&&(facts.due_date!==b.timing.date||facts.due_date_status!=='STATED_ON_SOURCE')))
    ctx.addIssue({code:'custom',message:'Historical assessment basis inconsistent'});
  if (facts.due_date_position !== expectedDuePosition) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "due_date_position must match the application-derived calendar dates" });
  }
  if (facts.effective_due_date_provenance?.provenance_class === "SOURCE_INVOICE_DATE" &&
      !race.evidence.evidence_ids.includes(facts.effective_due_date_provenance.evidence_id)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "source invoice-date provenance must reference supplied evidence" });
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
    current_source_basis:currentSourceBasisSchema.optional(),
    assessment_basis:historicalAssessmentBasisSchema.optional(),
    historical_basis_verified:z.boolean().optional(),
    obligation_id: z.string(),
    aggregate_version: z.string().regex(/^(0|[1-9][0-9]*)$/),
    as_of_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amount: z.string(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    service_category: z.string(),
    recurrence: z.enum(["MONTHLY", "YEARLY", "ONE_TIME"]),
    issue_date: z.string().nullable().optional(),
    due_date: z.string().nullable(),
    due_date_status: z.enum(["STATED_ON_SOURCE", "NOT_STATED_ON_SOURCE"]),
    effective_due_date: z.string().nullable().optional(),
    effective_due_date_basis: z.literal("INVOICE_DATE_CASH_TERM").nullable().optional(),
    effective_due_date_provenance: z.discriminatedUnion("provenance_class", [
      z.object({ provenance_class: z.literal("SOURCE_INVOICE_DATE"), evidence_id: z.string().min(1) }).strict(),
      z.object({ provenance_class: z.literal("AUTHORIZED_OPERATOR_ATTESTATION"), authority_reference: z.string().min(1) }).strict(),
    ]).nullable().optional(),
    state_at_event_baseline: z.literal("OUTSTANDING"),
    business_purpose_confirmed: z.boolean(),
    controlled_instruction: controlledInstructionSchema.optional(),
    commercial_terms: z.string(),
    evidence_ids: z.array(z.string()),
    evidence_present: z.boolean(),
    destination_ready: z.boolean(),
    destination_status: z.string(),
    destination_readiness_source: z.enum(["IMMUTABLE_SOURCE_EVIDENCE", "CURRENT_PRODUCT_TRUST_EVIDENCE", "SIMULATED_DEMO_FIXTURE", "SYNTHETIC_EVALUATION_FIXTURE", "UNVERIFIED_CURRENT_TRUST"]),
      due_date_position: z.enum(["NOT_STATED", "INVALID", "OVERDUE", "DUE_TODAY", "FUTURE", "CONTROLLED_WINDOW_OPEN"]),
  })
  .strict();

export type FinanceAgentContext = z.infer<typeof financeAgentContextSchema>;

/** Finance Agent model input excludes payment-route facts, which belong to Assurance & Authorization. */
export type FinanceAgentModelContext = Omit<
  FinanceAgentContext,
  "destination_ready" | "destination_status" | "destination_readiness_source"
>;
