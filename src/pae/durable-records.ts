import { createHash } from "node:crypto";

import {
  durableApprovalRecordSchema,
  durableAssuranceRecordSchema,
  type ControlResult,
  type DurableApprovalRecord,
  type DurableAssuranceRecord,
} from "../domain/schemas";
import { canonicalBytes, sha256Hex } from "./canonicalize";

/**
 * Normalizes a raw human-entered approval reason into reason_hash per the
 * Durable Approval Record Schema: NFC, CRLF/CR -> LF, reject NUL, length
 * 1..512 Unicode scalar values, UTF-8, SHA-256, lowercase hex. The raw
 * reason itself remains separate audit evidence — it is never put in the
 * PAE or the canonical hashed payload.
 */
export function hashApprovalReason(rawReason: string): string {
  if (rawReason.includes("\u0000")) {
    throw new Error("Approval reason must not contain NUL");
  }
  const normalized = rawReason.normalize("NFC").replace(/\r\n|\r/g, "\n");
  const length = Array.from(normalized).length;
  if (length < 1 || length > 512) {
    throw new Error(`Approval reason must be 1..512 Unicode scalar values, got ${length}`);
  }
  return createHash("sha256").update(Buffer.from(normalized, "utf8")).digest("hex");
}

export function sealDurableApprovalRecord(
  record: DurableApprovalRecord,
): { record: DurableApprovalRecord; approval_record_hash: string } {
  const validated = durableApprovalRecordSchema.parse(record);
  const hash = sha256Hex(canonicalBytes(validated));
  return { record: validated, approval_record_hash: hash };
}

export function verifyDurableApprovalRecordHash(
  record: DurableApprovalRecord,
  expectedHash: string,
): boolean {
  const validated = durableApprovalRecordSchema.parse(record);
  return sha256Hex(canonicalBytes(validated)) === expectedHash;
}

function sortControlResults(controlResults: ControlResult[]): ControlResult[] {
  return [...controlResults].sort((a, b) => (a.control_id < b.control_id ? -1 : a.control_id > b.control_id ? 1 : 0));
}

export function sealDurableAssuranceRecord(
  record: Omit<DurableAssuranceRecord, "control_results"> & { control_results: ControlResult[] },
): { record: DurableAssuranceRecord; assurance_hash: string } {
  const sorted = { ...record, control_results: sortControlResults(record.control_results) };
  const validated = durableAssuranceRecordSchema.parse(sorted);
  const hash = sha256Hex(canonicalBytes(validated));
  return { record: validated, assurance_hash: hash };
}

export function verifyDurableAssuranceRecordHash(
  record: DurableAssuranceRecord,
  expectedHash: string,
): boolean {
  const validated = durableAssuranceRecordSchema.parse(record);
  return sha256Hex(canonicalBytes(validated)) === expectedHash;
}
