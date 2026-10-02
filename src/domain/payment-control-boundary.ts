import { z } from "zod";

const boundedAscii = (max = 128) =>
  z.string().min(1).max(max).regex(/^[\x20-\x7E]+$/, "must be bounded printable ASCII");

export const sourceSystemKindSchema = z.enum([
  "ERP",
  "ACCOUNTING_SYSTEM",
  "API",
  "CSV_IMPORT",
  "DIRECT_EVIDENCE",
]);

export const sourceApprovalStateSchema = z.enum([
  "APPROVED",
  "PENDING",
  "REJECTED",
  "NOT_ASSERTED",
]);

/**
 * Vendor-neutral upstream reference. Source approval is deliberately modeled
 * as business-system truth only; this contract cannot carry Tameion execution
 * authority.
 */
export const sourceRecordReferenceSchema = z.object({
  source_kind: sourceSystemKindSchema,
  source_system_id: boundedAscii(),
  record_type: boundedAscii(),
  record_id: boundedAscii(),
  record_version: boundedAscii(64),
  approval_state: sourceApprovalStateSchema,
  execution_authority: z.literal("NONE"),
}).strict();

export const canonicalPaymentObligationSchema = z.object({
  source: sourceRecordReferenceSchema,
  obligation_id: boundedAscii(),
  amount: z.string().regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/),
  currency: z.string().regex(/^[A-Z]{3}$/),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  evidence_ids: z.array(boundedAscii()).min(1),
}).strict();

export type CanonicalPaymentObligation = z.infer<typeof canonicalPaymentObligationSchema>;

export interface DirectEvidenceObligationInput {
  obligation_id: string;
  amount: string;
  currency: string;
  due_date: string | null;
  source_evidence: Array<{ evidence_id: string }>;
}

export function adaptDirectEvidenceObligation(record: DirectEvidenceObligationInput): CanonicalPaymentObligation {
  return canonicalPaymentObligationSchema.parse({
    source: {
      source_kind: "DIRECT_EVIDENCE",
      source_system_id: "J0-C-LIVE-USAGE-LEDGER",
      record_type: "BUSINESS_OBLIGATION",
      record_id: record.obligation_id,
      record_version: "1",
      approval_state: "NOT_ASSERTED",
      execution_authority: "NONE",
    },
    obligation_id: record.obligation_id,
    amount: record.amount,
    currency: record.currency,
    due_date: record.due_date,
    evidence_ids: record.source_evidence.map((e) => e.evidence_id),
  });
}

export interface PaymentTruthLayerInput {
  obligation: CanonicalPaymentObligation;
  source_obligation_state: string;
  aggregate_version: number;
  aggregate_state: string;
  pae_state: string;
  execution_state: string;
  current_assessment_present: boolean;
  pae_sealed: boolean;
  execution_kill_switched: boolean;
  network: string;
  settlement_status: string;
  provider_ref: string | null;
  settlement_runtime: "SIMULATED" | "LIVE";
  /** 6-decimal canonical USDC settlement amount (e.g. "1568.413887"). */
  settlement_amount: string;
  /** Atomic integer of settlement_amount (e.g. "1568413887"). */
  settlement_atomic_amount: string;
  /** Original source amount preserved exactly (e.g. "5760.00"). */
  source_amount: string;
  /** Original source currency (e.g. "AED", "USD"). */
  source_currency: string;
  /** Conversion rate applied, or null for USD passthrough (e.g. "3.6725"). */
  settlement_conversion_rate: string | null;
}

export type ExecutionReleaseAuthority =
  | "NOT_GRANTED"
  | "TAMEION_PAE_REVERIFY_REQUIRED"
  | "SUSPENDED_KILL_SWITCH"
  | "RESERVED_FOR_EXECUTION"
  | "SUBMITTED_TO_PROVIDER"
  | "IN_DOUBT_PROVIDER_SUBMISSION"
  | "CONSUMED"
  | "REVOKED"
  | "EXPIRED"
  | "BLOCKED";

export function deriveExecutionReleaseAuthority(input: Pick<PaymentTruthLayerInput,
  "aggregate_state" | "pae_state" | "execution_state" | "pae_sealed" | "execution_kill_switched"
>): ExecutionReleaseAuthority {
  if (input.execution_state === "BLOCKED") return "BLOCKED";
  if (input.pae_state === "CONSUMED") return "CONSUMED";
  if (input.execution_state === "SUBMITTING" || input.execution_state === "UNKNOWN") return "IN_DOUBT_PROVIDER_SUBMISSION";
  if (input.pae_state === "SUBMITTED") return "SUBMITTED_TO_PROVIDER";
  if (input.pae_state === "REVOKED") return "REVOKED";
  if (input.pae_state === "EXPIRED") return "EXPIRED";
  if (input.pae_state === "RESERVED") return "RESERVED_FOR_EXECUTION";
  if (input.aggregate_state === "AUTHORIZED" && input.pae_state === "UNUSED" && input.pae_sealed) {
    return input.execution_kill_switched ? "SUSPENDED_KILL_SWITCH" : "TAMEION_PAE_REVERIFY_REQUIRED";
  }
  return "NOT_GRANTED";
}

export function buildPaymentTruthLayers(input: PaymentTruthLayerInput) {
  return {
    source_truth: {
      role: "SOURCE_OF_RECORD" as const,
      source: input.obligation.source,
      obligation_state: input.source_obligation_state,
    },
    tameion_control_truth: {
      role: "ASSURED_PAYMENT_CONTROL_PLANE" as const,
      aggregate_version: input.aggregate_version,
      aggregate_state: input.aggregate_state,
      assessment_state: input.current_assessment_present ? "CURRENT" as const : "NOT_ASSESSED" as const,
      pae_state: input.pae_state,
      pae_sealed: input.pae_sealed,
      execution_state: input.execution_state,
      execution_kill_switched: input.execution_kill_switched,
      execution_release_authority: deriveExecutionReleaseAuthority(input),
    },
    settlement_truth: {
      role: "SETTLEMENT_PROVIDER" as const,
      provider_target: "CIRCLE_DCW" as const,
      network: input.network,
      runtime: input.settlement_runtime,
      status: input.settlement_status,
      provider_ref: input.provider_ref,
      settlement_amount: input.settlement_amount,
      settlement_atomic_amount: input.settlement_atomic_amount,
      source_amount: input.source_amount,
      source_currency: input.source_currency,
      settlement_conversion_rate: input.settlement_conversion_rate,
    },
  };
}

export type PaymentTruthLayers = ReturnType<typeof buildPaymentTruthLayers>;
