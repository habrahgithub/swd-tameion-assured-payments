import { z } from "zod";
import { raceAssessmentSchema } from "../agent/schema";

/**
 * Core Zod schemas shared by the Finance Agent, Safety Kernel, PAE signer/
 * verifier and Execution Worker. These encode the P0 normalization rules
 * from the frozen Tameion blueprint (PAE / Domain Model sections).
 */

const boundedAscii = (max = 128) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[\x20-\x7E]+$/, "must be a bounded printable-ASCII string");

export const canonicalIntegerString = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "must be a canonical non-negative base-10 integer string");

export const canonicalUsdcAmount = z
  .string()
  .regex(/^(0|[1-9][0-9]*)\.[0-9]{6}$/, "must be a canonical decimal with exactly 6 fractional digits");

export const rfc3339Millis = z
  .string()
  .regex(
    /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]\.[0-9]{3}Z$/,
    "must be UTC RFC3339 with millisecond precision",
  );

export const evmAddress = z
  .string()
  .regex(/^0x[0-9a-f]{40}$/, "must be a normalized lowercase 0x-prefixed 40-hex address");

export const controlResultEnum = z.enum(["PASS", "HOLD", "BLOCK", "NOT_ASSESSED"]);

export const REQUIRED_CONTROL_IDS_P0 = [
  "SK-AMOUNT-ATOMIC-EXACT",
  "SK-ASSET-NETWORK",
  "SK-COUNTERPARTY-TRUST",
  "SK-DESTINATION-TRUST",
  "SK-DUPLICATE-EXTERNAL-SETTLEMENT",
  "SK-FINANCIAL-AUTHORITY",
  "SK-IDENTITY-ORG",
  "SK-KILL-SWITCH",
  "SK-SOURCE-WALLET-AUTHORITY",
  "SK-STATE-CURRENTNESS",
] as const;

export const controlResultSchema = z
  .object({
    control_id: z.enum(REQUIRED_CONTROL_IDS_P0),
    result: controlResultEnum,
    finding_code: boundedAscii(32),
  })
  .strict();
export type ControlResult = z.infer<typeof controlResultSchema>;

/** DURABLE-ASSESSMENT-RECORD-P0-1 canonical payload: the sealed, hash-addressable
 * Finance Agent output that candidate selection and approval must reference,
 * rather than trusting mutable in-memory decision state. */
export const durableAssessmentRecordSchema = z
  .object({
    assessment_id: boundedAscii(),
    organization_id: boundedAscii(),
    obligation_id: boundedAscii(),
    aggregate_version: canonicalIntegerString,
    decision: z.enum(["PAY", "HOLD", "ESCALATE"]),
    // Free-text model/fallback output — deliberately Unicode, not
    // boundedAscii, since an AI provider's reasons are not guaranteed ASCII.
    reasons: z.array(z.string().min(1).max(1000)).min(1).max(10),
    evidence_ids: z.array(boundedAscii()),
    missing_evidence: z.array(boundedAscii()),
    uncertainty_signal: z.boolean(),
    /** Optional only for immutable pre-#17 records; every new assessment carries RACE. */
    race: raceAssessmentSchema.optional(),
    provider_name: boundedAscii(),
    model_id: boundedAscii().optional(),
    model_config_version: boundedAscii().optional(),
    runtime_config_sha256: z.string().regex(/^[0-9a-f]{64}$/).optional(),
    /** LIVE_AI only for a real model call that actually returned parseable
     * output; deterministic/mock/fallback reasoning is always NOT_LIVE_AI;
     * BLOCKED_EXTERNAL is a live call that was attempted but failed before
     * any model reasoning occurred (e.g. provider auth failure) — the
     * resulting HOLD is a fail-closed default, not model output, and must
     * never be shown as successful live reasoning. */
    provider_mode: z.enum(["LIVE_AI", "NOT_LIVE_AI", "BLOCKED_EXTERNAL"]),
    assessed_at: rfc3339Millis,
  })
  .strict()
  .superRefine((record, ctx) => {
    const race = record.race;
    if (!race) return; // immutable pre-#17 assessment history remains readable
    const facts = race.evidence.authoritative_facts;
    if (race.result.decision !== record.decision) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "RACE decision must match the sealed assessment decision" });
    }
    if (facts.obligation_id !== record.obligation_id || facts.aggregate_version !== record.aggregate_version) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "RACE authoritative identity must match the sealed assessment" });
    }
    if (JSON.stringify(race.evidence.evidence_ids) !== JSON.stringify(record.evidence_ids)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "RACE evidence must match the sealed assessment evidence" });
    }
  });
export type DurableAssessmentRecord = z.infer<typeof durableAssessmentRecordSchema>;

/** DURABLE-APPROVAL-RECORD-P0-1 canonical payload. */
export const durableApprovalRecordSchema = z
  .object({
    approval_id: boundedAscii(),
    organization_id: boundedAscii(),
    obligation_id: boundedAscii(),
    actor_id: boundedAscii(),
    actor_role: boundedAscii(),
    action: z.literal("APPROVE"),
    authority_version: canonicalIntegerString,
    reviewed_aggregate_version: canonicalIntegerString,
    authorized_aggregate_version: canonicalIntegerString,
    policy_version: boundedAscii(),
    previous_state: boundedAscii(),
    new_state: boundedAscii(),
    approved_at: rfc3339Millis,
    reason_hash: z.string().regex(/^[0-9a-f]{64}$/),
    assessment_id: boundedAscii(),
    assessment_hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type DurableApprovalRecord = z.infer<typeof durableApprovalRecordSchema>;

/** PAE-APPROVAL-EVIDENCE-P0-1: the duplicated-field record bound inside the PAE. */
export const paeApprovalEvidenceSchema = z
  .object({
    approval_id: boundedAscii(),
    organization_id: boundedAscii(),
    obligation_id: boundedAscii(),
    actor_id: boundedAscii(),
    actor_role: boundedAscii(),
    authority_version: canonicalIntegerString,
    reviewed_aggregate_version: canonicalIntegerString,
    authorized_aggregate_version: canonicalIntegerString,
    approved_at: rfc3339Millis,
    policy_version: boundedAscii(),
    approval_record_hash: z.string().regex(/^[0-9a-f]{64}$/),
    assessment_id: boundedAscii(),
    assessment_hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();
export type PaeApprovalEvidence = z.infer<typeof paeApprovalEvidenceSchema>;

/** DURABLE-ASSURANCE-RECORD-P0-1 canonical payload. */
export const durableAssuranceRecordSchema = z
  .object({
    assurance_id: boundedAscii(),
    organization_id: boundedAscii(),
    obligation_id: boundedAscii(),
    aggregate_version: canonicalIntegerString,
    result: z.literal("PASS"),
    policy_version: boundedAscii(),
    safety_kernel_version: boundedAscii(),
    assessed_at: rfc3339Millis,
    control_results: z.array(controlResultSchema).length(REQUIRED_CONTROL_IDS_P0.length),
  })
  .strict()
  .superRefine((record, ctx) => {
    const seen = new Set<string>();
    for (const control of record.control_results) {
      if (seen.has(control.control_id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate control_id ${control.control_id}`,
        });
      }
      seen.add(control.control_id);
    }
    for (const requiredId of REQUIRED_CONTROL_IDS_P0) {
      if (!seen.has(requiredId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `missing required control ${requiredId}`,
        });
      }
    }
    const sorted = [...record.control_results].sort((a, b) => (a.control_id < b.control_id ? -1 : 1));
    for (let i = 0; i < sorted.length; i += 1) {
      if (sorted[i].control_id !== record.control_results[i].control_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "control_results must be sorted lexicographically by control_id",
        });
        break;
      }
    }
  });
export type DurableAssuranceRecord = z.infer<typeof durableAssuranceRecordSchema>;

/** PAE-P0-1 unsigned payload — the exact bytes that get JCS-canonicalized, hashed and signed. */
export const paeUnsignedPayloadSchema = z
  .object({
    signing_key_id: boundedAscii(64),
    signing_algorithm: z.literal("Ed25519"),
    pae_schema_version: z.literal("PAE-P0-1"),
    instruction_id: boundedAscii(),
    organization_id: boundedAscii(),
    obligation_ids: z.array(boundedAscii()).length(1),
    evidence_hashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)),
    counterparty_id: boundedAscii(),
    counterparty_version: canonicalIntegerString,
    source_wallet_ref: boundedAscii(),
    source_wallet_version: canonicalIntegerString,
    destination_ref: boundedAscii(),
    destination_version: canonicalIntegerString,
    destination_address: evmAddress,
    amount: canonicalUsdcAmount,
    atomic_amount: canonicalIntegerString,
    asset: z.literal("USDC"),
    network: z.literal("ARC_TESTNET"),
    policy_version: boundedAscii(),
    approval_evidence: z.array(paeApprovalEvidenceSchema).length(1),
    assurance_hash: z.string().regex(/^[0-9a-f]{64}$/),
    aggregate_version: canonicalIntegerString,
    expiry: rfc3339Millis,
    nonce: boundedAscii(64),
    idempotency_key: boundedAscii(128),
  })
  .strict()
  .superRefine((payload, ctx) => {
    const sortedEvidence = [...payload.evidence_hashes].sort();
    const uniqueEvidence = new Set(payload.evidence_hashes);
    if (uniqueEvidence.size !== payload.evidence_hashes.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "evidence_hashes must be unique" });
    }
    for (let i = 0; i < sortedEvidence.length; i += 1) {
      if (sortedEvidence[i] !== payload.evidence_hashes[i]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "evidence_hashes must be sorted lexicographically",
        });
        break;
      }
    }
    const approval = payload.approval_evidence[0];
    if (approval.organization_id !== payload.organization_id) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "approval_evidence.organization_id must equal outer organization_id" });
    }
    if (approval.obligation_id !== payload.obligation_ids[0]) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "approval_evidence.obligation_id must equal the sole obligation_ids[0]" });
    }
    if (approval.authorized_aggregate_version !== payload.aggregate_version) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "approval_evidence.authorized_aggregate_version must equal outer aggregate_version",
      });
    }
  });
export type PaeUnsignedPayload = z.infer<typeof paeUnsignedPayloadSchema>;

/** A sealed PAE: the unsigned payload plus its derived instruction_hash/signature. */
export const sealedPaeSchema = z
  .object({
    payload: paeUnsignedPayloadSchema,
    instruction_hash: z.string().regex(/^[0-9a-f]{64}$/),
    signature: z.string().regex(/^[0-9a-f]{128}$/),
  })
  .strict();
export type SealedPae = z.infer<typeof sealedPaeSchema>;
