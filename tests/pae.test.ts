import { afterEach, describe, expect, it, vi } from "vitest";

import { hashApprovalReason, sealDurableApprovalRecord, sealDurableAssuranceRecord } from "../src/pae/durable-records";
import { generateEd25519KeyPair, exportPublicKeySpkiBase64Url, exportPrivateKeyPem, TrustedKeyRegistry, signingKeyEnvironmentVariableName } from "../src/pae/keys";
import { sealPae, verifySealedPae, PaeVerificationError } from "../src/pae/sign-verify";
import type { PaeUnsignedPayload, ControlResult } from "../src/domain/schemas";
import { REQUIRED_CONTROL_IDS_P0 } from "../src/domain/schemas";

afterEach(() => vi.unstubAllEnvs());

function passControls(): ControlResult[] {
  return REQUIRED_CONTROL_IDS_P0.map((id) => ({ control_id: id, result: "PASS" as const, finding_code: "NONE" }));
}

function buildFixture(signingKeyId = "TEST-KEY-1") {
  const { privateKey, publicKey } = generateEd25519KeyPair();
  const trustedKeys = new TrustedKeyRegistry();
  trustedKeys.register({
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

  return { privateKey, publicKey, trustedKeys, unsignedPayload, approvalRecord, assuranceRecord };
}

describe("PAE golden vector", () => {
  it("restores active trust and preserves revocation from the durable registry across cold starts", async () => {
    const keyId = "TAMEION-J2A-TESTNET-DEMO-PAE-KEY-1";
    const { privateKey, trustedKeys, unsignedPayload } = buildFixture(keyId);
    const sealed = sealPae(unsignedPayload, privateKey);
    const { J2aRealTestnetDemoState } = await import("../src/server/demo-state");
    const persisted = new J2aRealTestnetDemoState().exportSnapshot();
    persisted.sealed_paes.push(["OBL-J0C-002", sealed]);
    persisted.trusted_keys = trustedKeys.export();

    vi.resetModules();
    const [{ J2aRealTestnetDemoState: ColdState }, coldVerifier] = await Promise.all([
      import("../src/server/demo-state"),
      import("../src/demo/verify-j2a-pae"),
    ]);
    const restored = new ColdState(persisted);
    expect(() => coldVerifier.verifyJ2aSealedPae(sealed, restored.trustedKeys)).not.toThrow();

    restored.trustedKeys.revoke(keyId);
    const revokedSnapshot = restored.exportSnapshot();
    expect(revokedSnapshot.trusted_keys).toContainEqual(expect.objectContaining({ signing_key_id: keyId, status: "REVOKED" }));
    vi.resetModules();
    const [{ J2aRealTestnetDemoState: RevokedState }, revokedVerifier] = await Promise.all([
      import("../src/server/demo-state"),
      import("../src/demo/verify-j2a-pae"),
    ]);
    const revokedState = new RevokedState(revokedSnapshot);
    expect(() => revokedVerifier.verifyJ2aSealedPae(sealed, revokedState.trustedKeys)).toThrow(expect.objectContaining({ code: "PAE-015" }));
  });

  it("rejects an envelope that names a key outside the fixed J2A trust boundary", async () => {
    const { privateKey, unsignedPayload } = buildFixture("UNEXPECTED-ENVELOPE-KEY");
    const sealed = sealPae(unsignedPayload, privateKey);
    vi.resetModules();
    const coldVerifier = await import("../src/demo/verify-j2a-pae");

    expect(() => coldVerifier.verifyJ2aSealedPae(sealed, new TrustedKeyRegistry())).toThrow(expect.objectContaining({ code: "PAE-015" }));
  });

  it("does not initialize verification trust without the configured server key", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv(signingKeyEnvironmentVariableName("J2A-COLD-START-MISSING-KEY"), "");
    vi.resetModules();
    const coldKeys = await import("../src/pae/keys");

    expect(() => coldKeys.initializeServerTrustedKey("J2A-COLD-START-MISSING-KEY")).toThrow(expect.objectContaining({ code: "PAE-015" }));
  });

  it("does not reactivate a revoked trusted key during cold-start initialization", async () => {
    const pair = generateEd25519KeyPair();
    const keyId = "J2A-COLD-START-REVOKED-KEY";
    vi.stubEnv(signingKeyEnvironmentVariableName(keyId), exportPrivateKeyPem(pair.privateKey));
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.resetModules();
    const coldKeys = await import("../src/pae/keys");
    coldKeys.registerTrustedKey({
      signing_key_id: keyId,
      signing_algorithm: "Ed25519",
      public_key_spki_base64url: exportPublicKeySpkiBase64Url(pair.publicKey),
      status: "REVOKED",
    });

    expect(() => coldKeys.initializeServerTrustedKey(keyId)).toThrow(expect.objectContaining({ code: "PAE-015" }));
  });

  it("rejects a configured key that does not match an already trusted key", async () => {
    const trusted = generateEd25519KeyPair();
    const configured = generateEd25519KeyPair();
    const keyId = "J2A-COLD-START-MISMATCHED-KEY";
    vi.stubEnv(signingKeyEnvironmentVariableName(keyId), exportPrivateKeyPem(configured.privateKey));
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.resetModules();
    const coldKeys = await import("../src/pae/keys");
    coldKeys.registerTrustedKey({
      signing_key_id: keyId,
      signing_algorithm: "Ed25519",
      public_key_spki_base64url: exportPublicKeySpkiBase64Url(trusted.publicKey),
      status: "ACTIVE",
    });

    expect(() => coldKeys.initializeServerTrustedKey(keyId)).toThrow(expect.objectContaining({ code: "PAE-015" }));
  });

  it("seals and independently verifies a valid PAE", () => {
    const { privateKey, trustedKeys, unsignedPayload } = buildFixture();
    const sealed = sealPae(unsignedPayload, privateKey);
    expect(sealed.instruction_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sealed.signature).toMatch(/^[0-9a-f]{128}$/);
    expect(() => verifySealedPae(sealed, trustedKeys)).not.toThrow();
  });

  it("is deterministic: identical payload always yields the identical instruction_hash", () => {
    const { privateKey, trustedKeys, unsignedPayload } = buildFixture();
    const first = sealPae(unsignedPayload, privateKey);
    const second = sealPae({ ...unsignedPayload }, privateKey);
    expect(second.instruction_hash).toBe(first.instruction_hash);
  });

  it("rejects a tampered amount", () => {
    const { privateKey, trustedKeys, unsignedPayload } = buildFixture();
    const sealed = sealPae(unsignedPayload, privateKey);
    const tampered = { ...sealed, payload: { ...sealed.payload, amount: "9999.000000" } };
    expect(() => verifySealedPae(tampered, trustedKeys)).toThrow(PaeVerificationError);
  });

  it("rejects a tampered destination address", () => {
    const { privateKey, trustedKeys, unsignedPayload } = buildFixture();
    const sealed = sealPae(unsignedPayload, privateKey);
    const tampered = {
      ...sealed,
      payload: { ...sealed.payload, destination_address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" },
    };
    expect(() => verifySealedPae(tampered, trustedKeys)).toThrow(PaeVerificationError);
  });

  it("rejects a tampered aggregate_version", () => {
    const { privateKey, trustedKeys, unsignedPayload } = buildFixture();
    const sealed = sealPae(unsignedPayload, privateKey);
    const tampered = { ...sealed, payload: { ...sealed.payload, aggregate_version: "999" } };
    expect(() => verifySealedPae(tampered, trustedKeys)).toThrow(PaeVerificationError);
  });

  it("rejects a tampered expiry", () => {
    const { privateKey, trustedKeys, unsignedPayload } = buildFixture();
    const sealed = sealPae(unsignedPayload, privateKey);
    const tampered = { ...sealed, payload: { ...sealed.payload, expiry: "2099-01-01T00:00:00.000Z" } };
    expect(() => verifySealedPae(tampered, trustedKeys)).toThrow(PaeVerificationError);
  });

  it("rejects a corrupted signature even if instruction_hash matches", () => {
    const { privateKey, trustedKeys, unsignedPayload } = buildFixture();
    const sealed = sealPae(unsignedPayload, privateKey);
    const corruptSignature = `${"0".repeat(128)}`;
    const tampered = { ...sealed, signature: corruptSignature };
    expect(() => verifySealedPae(tampered, trustedKeys)).toThrow(PaeVerificationError);
  });

  it("rejects a signature from a different key", () => {
    const { trustedKeys, unsignedPayload } = buildFixture();
    const other = generateEd25519KeyPair();
    const sealed = sealPae(unsignedPayload, other.privateKey); // not registered as trusted
    expect(() => verifySealedPae(sealed, trustedKeys)).toThrow();
  });
});
