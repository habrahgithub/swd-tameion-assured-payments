import {historicalAssessmentBasisSchema} from "../agent/assessment-context";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { adaptDirectEvidenceObligation } from "../domain/payment-control-boundary";
import type { LiveUsageObligationRecord } from "../agent/context-builder";

export const OPERATOR_SOURCE_PATH = ".tameion/operator-source.json";
export const MAX_OPERATOR_SOURCE_BYTES = 131_072;
const text = (max = 128) => z.string().min(1).max(max);
const date = z.iso.date();
export const operatorSourceRecordSchema = z.object({
  obligation_id: text().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/),
  // Optional source-backed supplier identity with explicit provenance; both-or-neither, anchored to a listed source evidence item.
  beneficiary_name: text(256).optional(),
  beneficiary_provenance: z.object({ provenance_class: z.literal("SOURCE_EVIDENCE"), evidence_id: text() }).strict().optional(),
  service_category: text(256), recurrence: z.enum(["MONTHLY", "YEARLY", "ONE_TIME"]),
  assessment_basis: historicalAssessmentBasisSchema.optional(),
  issue_date: date.nullable().optional(), due_date: date.nullable(),
  due_date_status: z.enum(["STATED_ON_SOURCE", "NOT_STATED_ON_SOURCE"]),
  effective_due_date: date.nullable().optional(), effective_due_date_basis: z.literal("INVOICE_DATE_CASH_TERM").nullable().optional(),
  effective_due_date_provenance: z.union([
    z.object({ provenance_class: z.literal("SOURCE_INVOICE_DATE"), evidence_id: text() }).strict(),
    z.object({ provenance_class: z.literal("AUTHORIZED_OPERATOR_ATTESTATION"), authority_reference: text(256) }).strict(),
  ]).nullable().optional(),
  amount: text(80), currency: z.string().regex(/^[A-Z]{3}$/),
  state_at_event_baseline: z.literal("OUTSTANDING"), business_purpose_confirmed: z.boolean(), commercial_terms: text(2048),
  source_evidence: z.array(z.object({ evidence_id: text(), content_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict()).min(1).max(16),
  candidate_readiness: z.object({ arc_product_destination_status: text() }).strict(),
}).strict().superRefine((record, context) => {
  try {
    adaptDirectEvidenceObligation(record);
    if ((record.due_date_status === "NOT_STATED_ON_SOURCE") !== (record.due_date === null)) throw new Error();
    if (new Set(record.source_evidence.map(item => item.evidence_id)).size !== record.source_evidence.length) throw new Error();
    if ((record.beneficiary_name === undefined) !== (record.beneficiary_provenance === undefined)) throw new Error();
    if (record.beneficiary_provenance && !record.source_evidence.some(item => item.evidence_id === record.beneficiary_provenance!.evidence_id)) throw new Error();
  } catch { context.addIssue({ code: "custom", message: "Canonical source record invalid" }); }
});
export const MAX_ADMISSION_WINDOW_MS = 60 * 60 * 1000;
const sha = z.string().regex(/^[a-f0-9]{64}$/);
/** Optional owner admission carried OUTSIDE records in the canonical V3 source envelope (covered by the source digest, so it cannot
 * self-reference a record hash). It binds one exact target, record, state binding and unbound legacy UNKNOWN predecessor for a bounded window. */
export const ownerAdmissionSchema = z.object({
  kind: z.literal("CURRENT_SOURCE_REASSESSMENT_ADMISSION"),
  approval_id: text(),
  obligation_id: text(),
  aggregate_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  source_record_sha256: sha, binding_sha256: sha,
  predecessor_key: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/), predecessor_sha256: sha,
  valid_from: z.iso.datetime({ precision: 3 }), expires_at: z.iso.datetime({ precision: 3 }),
}).strict().superRefine((admission, context) => {
  const start = Date.parse(admission.valid_from), end = Date.parse(admission.expires_at);
  if (!(end > start) || end - start > MAX_ADMISSION_WINDOW_MS) context.addIssue({ code: "custom", message: "Invalid admission window" });
});
export type OwnerAdmission = z.infer<typeof ownerAdmissionSchema>;
export type OwnerAdmissionState = { status: "VALID"; admission: OwnerAdmission } | { status: "INVALID" };
/** Absent stays absent; malformed or invalid disables only this capability and never makes the underlying source unreadable. */
export function parseOwnerAdmission(value: unknown): OwnerAdmissionState | undefined {
  if (value === undefined) return undefined;
  const parsed = ownerAdmissionSchema.safeParse(value);
  return parsed.success ? { status: "VALID", admission: parsed.data } : { status: "INVALID" };
}
export interface OperatorStateBinding { namespace: string; revision: number; authority_sha256: string; workflow_base_sha256?: string }
export const sourceIngressSchema=z.object({schema_version:z.literal('SOURCE-INGRESS-1'),operator_key:text(),credential_version:z.number().int().positive(),actor_id:text(),valid_from:z.iso.datetime({precision:3}),expires_at:z.iso.datetime({precision:3}),permissions:z.array(z.enum(['CREATE_SOURCE','CORRECT_SOURCE','REVIEW_SOURCE'])).min(1).max(3)}).strict();
export interface OperatorSourceView { source_ingress?:z.infer<typeof sourceIngressSchema>; records: readonly LiveUsageObligationRecord[]; state_binding: OperatorStateBinding; owner_admission?: OwnerAdmissionState }
const packetFields = { state_binding: z.object({ namespace: text(), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), authority_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), purpose: z.literal("OPERATOR_VIEW_ONLY"), organization_id: z.literal("ORG-DEMO-001") };
// V1 remains exactly five records. V2 is an explicitly approved genuine-view
// catalog, not a controlled financial source or permission to seed missing state.
const packetSchema = z.union([
  z.object({...packetFields,purpose:z.literal('RECOVERABLE_PAYMENT_SOURCE'),schema_version:z.literal(4),provenance:z.literal('GENUINE_COMPANY_OBLIGATIONS'),record_count:z.number().int().min(0).max(50),records:z.array(operatorSourceRecordSchema).max(50),source_ingress:sourceIngressSchema}).strict().refine(packet=>packet.record_count===packet.records.length),
  z.object({ ...packetFields, purpose:z.literal("GENUINE_ADVISORY_SOURCE"), schema_version:z.literal(3), provenance:z.literal("GENUINE_COMPANY_OBLIGATIONS"),record_count:z.number().int().min(1).max(50),records:z.array(operatorSourceRecordSchema).min(1).max(50), state_binding:packetFields.state_binding.extend({workflow_base_sha256:z.string().regex(/^[a-f0-9]{64}$/)}),
    // Validated separately so a malformed admission disables only that capability, never the source or auth.
    owner_admission:z.unknown().optional() }).strict().refine(packet=>packet.record_count===packet.records.length),
  z.object({ ...packetFields, records: z.array(operatorSourceRecordSchema).length(5) }).strict(),
  z.object({ ...packetFields, schema_version: z.literal(2), provenance: z.literal("GENUINE_COMPANY_OBLIGATIONS"), record_count: z.number().int().min(1).max(50), records: z.array(operatorSourceRecordSchema).min(1).max(50) }).strict()
    .refine(packet => packet.record_count === packet.records.length),
]);
export function parseOperatorSource(bytes: Uint8Array, expectedHash: string): OperatorSourceView {
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || bytes.byteLength > MAX_OPERATOR_SOURCE_BYTES || createHash("sha256").update(bytes).digest("hex") !== expectedHash) throw new Error("OPERATOR_SOURCE_UNAVAILABLE");
  try {
    const contents = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const value: unknown = JSON.parse(contents);
    // Canonical JSON bytes are owner-approved before packaging. This rejects
    // duplicate keys instead of silently accepting JSON.parse's last value.
    if (JSON.stringify(value) !== contents) throw new Error();
    const packet = packetSchema.parse(value);
    if (new Set(packet.records.map(record => record.obligation_id)).size !== packet.records.length) throw new Error();
    const admission = "owner_admission" in packet && "owner_admission" in (value as Record<string, unknown>) ? parseOwnerAdmission(packet.owner_admission) ?? ({ status: "INVALID" } as const) : undefined;
    return structuredClone({records:packet.records,state_binding:packet.state_binding,...("source_ingress" in packet?{source_ingress:packet.source_ingress}:{}),...(admission?{owner_admission:admission}:{})});
  } catch { throw new Error("OPERATOR_SOURCE_UNAVAILABLE"); }
}
/** Caller must authenticate before this read. Undefined means no private
 * approval/input, so the caller keeps the canonical public withdrawal path. */
export function loadOperatorSourceRecords(env: Record<string, string | undefined> = process.env): OperatorSourceView | undefined {
  let fd: number;
  try { fd = openSync(join(process.cwd(), OPERATOR_SOURCE_PATH), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT" && env.TAMEION_OPERATOR_SOURCE_SHA256 === undefined) return undefined; throw new Error("OPERATOR_SOURCE_UNAVAILABLE"); }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_OPERATOR_SOURCE_BYTES) throw new Error();
    const bytes = Buffer.alloc(MAX_OPERATOR_SOURCE_BYTES + 1); let size = 0;
    while (size < bytes.length) { const count = readSync(fd, bytes, size, bytes.length - size, null); if (!count) break; size += count; }
    return parseOperatorSource(bytes.subarray(0, size), env.TAMEION_OPERATOR_SOURCE_SHA256 ?? "");
  } catch { throw new Error("OPERATOR_SOURCE_UNAVAILABLE"); }
  finally { closeSync(fd); }
}
