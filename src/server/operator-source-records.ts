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
  service_category: text(256), recurrence: z.enum(["MONTHLY", "YEARLY", "ONE_TIME"]),
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
  } catch { context.addIssue({ code: "custom", message: "Canonical source record invalid" }); }
});
export interface OperatorStateBinding { namespace: string; revision: number; authority_sha256: string; workflow_base_sha256?: string }
export interface OperatorSourceView { records: readonly LiveUsageObligationRecord[]; state_binding: OperatorStateBinding }
const packetFields = { state_binding: z.object({ namespace: text(), revision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER), authority_sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(), purpose: z.literal("OPERATOR_VIEW_ONLY"), organization_id: z.literal("ORG-DEMO-001") };
// V1 remains exactly five records. V2 is an explicitly approved genuine-view
// catalog, not a controlled financial source or permission to seed missing state.
const packetSchema = z.union([
  z.object({ ...packetFields, purpose:z.literal("GENUINE_ADVISORY_SOURCE"), schema_version:z.literal(3), provenance:z.literal("GENUINE_COMPANY_OBLIGATIONS"),record_count:z.number().int().min(1).max(50),records:z.array(operatorSourceRecordSchema).min(1).max(50), state_binding:packetFields.state_binding.extend({workflow_base_sha256:z.string().regex(/^[a-f0-9]{64}$/)}) }).strict().refine(packet=>packet.record_count===packet.records.length),
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
    return structuredClone({records:packet.records,state_binding:packet.state_binding});
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
