import { z } from "zod";

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
export const financeAgentDecisionSchema = z
  .object({
    obligation_id: z.string().min(1),
    decision: z.enum(["PAY", "HOLD", "ESCALATE"]),
    reasons: z.array(z.string().min(1)).min(1).max(10),
    evidence_ids: z.array(z.string().min(1)),
    missing_evidence: z.array(z.string().min(1)),
    uncertainty_signal: z.boolean(),
  })
  .strict();

export type FinanceAgentDecision = z.infer<typeof financeAgentDecisionSchema>;

/** The minimal, allowlisted, read-only context handed to the AI provider. No PII, no secrets. */
export const financeAgentContextSchema = z
  .object({
    obligation_id: z.string(),
    amount: z.string(),
    currency: z.enum(["AED", "USD"]),
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
  })
  .strict();

export type FinanceAgentContext = z.infer<typeof financeAgentContextSchema>;
