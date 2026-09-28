import { describe, expect, it } from "vitest";

import { hashApprovalReason, sealDurableApprovalRecord, sealDurableAssuranceRecord } from "../src/pae/durable-records";
import { generateEd25519KeyPair, exportPublicKeySpkiBase64Url, registerTrustedKey } from "../src/pae/keys";
import { sealPae, verifySealedPae, PaeVerificationError } from "../src/pae/sign-verify";
import type { PaeUnsignedPayload, ControlResult } from "../src/domain/schemas";
import { REQUIRED_CONTROL_IDS_P0 } from "../src/domain/schemas";

function passControls(): ControlResult[] {
  return REQUIRED_CONTROL_IDS_P0.map((id) => ({ control_id: id, result: "PASS" as const, finding_code: "NONE" }));
}

function buildFixture() {
  const { privateKey, publicKey } = generateEd25519KeyPair();
  const signingKeyId = "TEST-KEY-1";
  registerTrustedKey({
    signing_key_id: signingKeyId,
    signing_algorithm: "Ed25519",
    public_key_spki_base64url: exportPublicKeySpkiBase64Url(publicKey),
    status: "ACTIVE",
  });

  const reasonHash = hashApprovalReason("Authorized operator approved the reviewed obligation for payment.");
  const { record: approvalRecord, approval_record_hash } = sealDurableApprovalRecord({
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
    reason_hash: reasonHash,
    assessment_id: "ASM-001",
    assessment_hash: "c".repeat(64),
  });

  const { record: assuranceRecord, assurance_hash } = sealDurableAssuranceRecord({
    assurance_id: "ASR-001",
    organization_id: "ORG-DEMO-001",
    obligation_id: "OBL-J0C-002",
    aggregate_version: "4",
    result: "PASS",
    policy_version: "POLICY-P0-1",
    safety_kernel_version: "SK-P0-1",
    assessed_at: "2026-09-28T12:00:01.000Z",
    control_results: passControls(),
  });

  const unsignedPayload: PaeUnsignedPayload = {
    signing_key_id: signingKeyId,
    signing_algorithm: "Ed25519",
    pae_schema_version: "PAE-P0-1",
    instruction_id: "INSTR-001",
    organization_id: "ORG-DEMO-001",
    obligation_ids: ["OBL-J0C-002"],
    evidence_hashes: [
      "0ef1dd4044b513998fed4b5354b9c92001f78645a2ba7603d21b58bb094227e4",
      "156d7aea6b0c0b843426cc795eb889982f074bff86df3158688759bd8252332f",
    ].sort(),
    counterparty_id: "CP-J0C-002",
    counterparty_version: "1",
    source_wallet_ref: "WALLET-SOURCE-P0-1",
    source_wallet_version: "1",
    destination_ref: "DEST-J0C-999",
    destination_version: "1",
    destination_address: "0x1234567890abcdef1234567890abcdef12345678",
    amount: "21.000000",
    atomic_amount: "21000000",
    asset: "USDC",
    network: "ARC_TESTNET",
    policy_version: "POLICY-P0-1",
    approval_evidence: [
      {
        approval_id: "APR-001",
        organization_id: "ORG-DEMO-001",
        obligation_id: "OBL-J0C-002",
        actor_id: "USR-OPERATOR-001",
        actor_role: "FINANCE_APPROVER",
        authority_version: "1",
        reviewed_aggregate_version: "3",
        authorized_aggregate_version: "4",
        approved_at: "2026-09-28T12:00:00.000Z",
        policy_version: "POLICY-P0-1",
        approval_record_hash,
        assessment_id: "ASM-001",
        assessment_hash: "c".repeat(64),
      },
    ],
    assurance_hash,
    aggregate_version: "4",
    expiry: "2026-09-28T12:30:00.000Z",
    nonce: "nonce-0001",
    idempotency_key: "idem-OBL-J0C-002-0001",
  };

  return { privateKey, unsignedPayload, approvalRecord, assuranceRecord };
}

describe("PAE golden vector", () => {
  it("seals and independently verifies a valid PAE", () => {
    const { privateKey, unsignedPayload } = buildFixture();
    const sealed = sealPae(unsignedPayload, privateKey);
    expect(sealed.instruction_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sealed.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(() => verifySealedPae(sealed)).not.toThrow();
  });

  it("is deterministic: identical payload always yields the identical instruction_hash", () => {
    const { privateKey, unsignedPayload } = buildFixture();
    const first = sealPae(unsignedPayload, privateKey);
    const second = sealPae({ ...unsignedPayload }, privateKey);
    expect(second.instruction_hash).toBe(first.instruction_hash);
  });

  it("rejects a tampered amount", () => {
    const { privateKey, unsignedPayload } = buildFixture();
    const sealed = sealPae(unsignedPayload, privateKey);
    const tampered = { ...sealed, payload: { ...sealed.payload, amount: "9999.000000" } };
    expect(() => verifySealedPae(tampered)).toThrow(PaeVerificationError);
  });

  it("rejects a tampered destination address", () => {
    const { privateKey, unsignedPayload } = buildFixture();
    const sealed = sealPae(unsignedPayload, privateKey);
    const tampered = {
      ...sealed,
      payload: { ...sealed.payload, destination_address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
    };
    expect(() => verifySealedPae(tampered)).toThrow(PaeVerificationError);
  });

  it("rejects a tampered aggregate_version", () => {
    const { privateKey, unsignedPayload } = buildFixture();
    const sealed = sealPae(unsignedPayload, privateKey);
    const tampered = { ...sealed, payload: { ...sealed.payload, aggregate_version: "999" } };
    expect(() => verifySealedPae(tampered)).toThrow(PaeVerificationError);
  });

  it("rejects a tampered expiry", () => {
    const { privateKey, unsignedPayload } = buildFixture();
    const sealed = sealPae(unsignedPayload, privateKey);
    const tampered = { ...sealed, payload: { ...sealed.payload, expiry: "2099-01-01T00:00:00.000Z" } };
    expect(() => verifySealedPae(tampered)).toThrow(PaeVerificationError);
  });

  it("rejects a corrupted signature even if instruction_hash matches", () => {
    const { privateKey, unsignedPayload } = buildFixture();
    const sealed = sealPae(unsignedPayload, privateKey);
    const corruptSignature = `${"0".repeat(128)}`;
    const tampered = { ...sealed, signature: corruptSignature };
    expect(() => verifySealedPae(tampered)).toThrow(PaeVerificationError);
  });

  it("rejects a signature from a different key", () => {
    const { unsignedPayload } = buildFixture();
    const other = generateEd25519KeyPair();
    const sealed = sealPae(unsignedPayload, other.privateKey); // not registered as trusted
    expect(() => verifySealedPae(sealed)).toThrow();
  });
});
