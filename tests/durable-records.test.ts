import { describe, expect, it } from "vitest";

import {
  hashApprovalReason,
  sealDurableApprovalRecord,
  sealDurableAssuranceRecord,
  verifyDurableApprovalRecordHash,
  verifyDurableAssuranceRecordHash,
} from "../src/pae/durable-records";
import { REQUIRED_CONTROL_IDS_P0, type ControlResult, type DurableApprovalRecord } from "../src/domain/schemas";

function passControls(): ControlResult[] {
  return REQUIRED_CONTROL_IDS_P0.map((id) => ({ control_id: id, result: "PASS" as const, finding_code: "NONE" }));
}

function approvalRecordFixture(overrides: Partial<DurableApprovalRecord> = {}): DurableApprovalRecord {
  return {
    approval_id: "APR-001",
    organization_id: "ORG-DEMO-001",
    obligation_id: "OBL-J0C-002",
    actor_id: "USR-OPERATOR-001",
    actor_role: "FINANCE_APPROVER",
    action: "APPROVE",
    authority_version: "1",
    reviewed_aggregate_version: "3",
    authorized_aggregate_version: "4",
    policy_version: "POLICY-P0-1",
    previous_state: "APPROVAL_PENDING",
    new_state: "AUTHORIZED",
    approved_at: "2026-09-28T12:00:00.000Z",
    reason_hash: hashApprovalReason("Reviewed and approved."),
    assessment_id: "ASM-001",
    assessment_hash: "c".repeat(64),
    ...overrides,
  };
}

describe("hashApprovalReason normalization (Durable Approval Record Schema)", () => {
  it("produces a 64-hex SHA-256 hash", () => {
    expect(hashApprovalReason("Approved after review.")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("normalizes CRLF and CR to LF before hashing (same content, different line endings hash identically)", () => {
    const withCrlf = hashApprovalReason("Line one\r\nLine two");
    const withCr = hashApprovalReason("Line one\rLine two");
    const withLf = hashApprovalReason("Line one\nLine two");
    expect(withCrlf).toBe(withLf);
    expect(withCr).toBe(withLf);
  });

  it("normalizes to NFC (decomposed and precomposed Unicode hash identically)", () => {
    const precomposed = hashApprovalReason("Café approved"); // é as single code point
    const decomposed = hashApprovalReason("Café approved"); // e + combining acute accent
    expect(precomposed).toBe(decomposed);
  });

  it("rejects NUL bytes", () => {
    expect(() => hashApprovalReason("bad\u0000reason")).toThrow();
  });

  it("rejects empty reason text", () => {
    expect(() => hashApprovalReason("")).toThrow();
  });

  it("rejects reason text longer than 512 Unicode scalar values", () => {
    expect(() => hashApprovalReason("a".repeat(513))).toThrow();
    expect(() => hashApprovalReason("a".repeat(512))).not.toThrow();
  });
});

describe("durable approval record hash integrity", () => {
  it("round-trips: sealing then verifying the same record succeeds", () => {
    const record = approvalRecordFixture();
    const { approval_record_hash } = sealDurableApprovalRecord(record);
    expect(verifyDurableApprovalRecordHash(record, approval_record_hash)).toBe(true);
  });

  it("detects tampering: a changed field fails verification against the original hash", () => {
    const record = approvalRecordFixture();
    const { approval_record_hash } = sealDurableApprovalRecord(record);
    const tampered = { ...record, actor_id: "USR-ATTACKER-999" };
    expect(verifyDurableApprovalRecordHash(tampered, approval_record_hash)).toBe(false);
  });

  it("detects a tampered authorized_aggregate_version specifically (the field the PAE binds to)", () => {
    const record = approvalRecordFixture();
    const { approval_record_hash } = sealDurableApprovalRecord(record);
    const tampered = { ...record, authorized_aggregate_version: "999" };
    expect(verifyDurableApprovalRecordHash(tampered, approval_record_hash)).toBe(false);
  });
});

describe("durable assurance record hash integrity", () => {
  function assuranceFixture() {
    return {
      assurance_id: "ASR-001",
      organization_id: "ORG-DEMO-001",
      obligation_id: "OBL-J0C-002",
      aggregate_version: "4",
      result: "PASS" as const,
      policy_version: "POLICY-P0-1",
      safety_kernel_version: "SK-P0-1",
      assessed_at: "2026-09-28T12:00:01.000Z",
      control_results: passControls(),
    };
  }

  it("round-trips: sealing then verifying the same record succeeds", () => {
    const { record, assurance_hash } = sealDurableAssuranceRecord(assuranceFixture());
    expect(verifyDurableAssuranceRecordHash(record, assurance_hash)).toBe(true);
  });

  it("detects tampering: flipping one control result from PASS to BLOCK fails verification", () => {
    const { record, assurance_hash } = sealDurableAssuranceRecord(assuranceFixture());
    const tampered = {
      ...record,
      control_results: record.control_results.map((c, i) =>
        i === 0 ? { ...c, result: "BLOCK" as const, finding_code: "SEC-001" } : c,
      ),
    };
    expect(verifyDurableAssuranceRecordHash(tampered, assurance_hash)).toBe(false);
  });

  it("detects a tampered aggregate_version (the field the PAE binds to)", () => {
    const { record, assurance_hash } = sealDurableAssuranceRecord(assuranceFixture());
    const tampered = { ...record, aggregate_version: "1" };
    expect(verifyDurableAssuranceRecordHash(tampered, assurance_hash)).toBe(false);
  });
});
