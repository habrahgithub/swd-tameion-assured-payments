import { afterEach, describe, expect, it, vi } from "vitest";

import { DEMO_ORGANIZATION_ID, DEMO_SIGNING_KEY_ID, DemoState, J2aRealTestnetDemoState, parseDemoStateSnapshot } from "../src/server/demo-state";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { exportPrivateKeyPem, exportPublicKeySpkiBase64Url, generateEd25519KeyPair, signingKeyEnvironmentVariableName } from "../src/pae/keys";
import type { TrustedKeyEntry } from "../src/pae/keys";
import { verifySealedPae } from "../src/pae/sign-verify";
import { currentAssessmentReview, sealTestAssessment } from "./test-support/seal-assessment";

function trustedKey(status: TrustedKeyEntry["status"] = "ACTIVE"): TrustedKeyEntry {
  const { publicKey } = generateEd25519KeyPair();
  return {
    signing_key_id: "J2A-DURABLE-KEY",
    signing_algorithm: "Ed25519",
    public_key_spki_base64url: exportPublicKeySpkiBase64Url(publicKey),
    status,
  };
}

function baseSnapshot(trusted_keys: TrustedKeyEntry[] = []) {
  return { ...new J2aRealTestnetDemoState().exportSnapshot(), trusted_keys };
}

afterEach(() => vi.unstubAllGlobals());

describe("durable namespace key trust", () => {
  it("keeps persisted trust and revocation isolated between state namespaces", () => {
    const keyA = trustedKey();
    const keyB = trustedKey();
    const namespaceA = new J2aRealTestnetDemoState(baseSnapshot([keyA]));
    const namespaceB = new J2aRealTestnetDemoState(baseSnapshot([keyB]));

    namespaceA.trustedKeys.revoke(keyA.signing_key_id);

    expect(namespaceA.exportSnapshot().trusted_keys).toEqual([{ ...keyA, status: "REVOKED" }]);
    expect(namespaceB.exportSnapshot().trusted_keys).toEqual([keyB]);
    expect(() => namespaceA.trustedKeys.restore([keyA])).toThrow();
    expect(() => namespaceB.trustedKeys.resolve(keyB.signing_key_id, "Ed25519")).not.toThrow();
  });

  it("rejects malformed, conflicting, and unsupported persisted trust snapshots", () => {
    const valid = baseSnapshot([trustedKey()]);
    expect(() => parseDemoStateSnapshot({ ...valid, schema_version: 3 })).toThrow();
    expect(() => parseDemoStateSnapshot({ ...valid, trusted_keys: undefined })).toThrow();
    expect(() => parseDemoStateSnapshot({ ...valid, trusted_keys: [valid.trusted_keys[0], valid.trusted_keys[0]] })).toThrow();
    expect(() => parseDemoStateSnapshot({
      ...valid,
      trusted_keys: [{ ...valid.trusted_keys[0], signing_algorithm: "RSA" }],
    })).toThrow();
    expect(() => parseDemoStateSnapshot({
      ...valid,
      trusted_keys: [{ ...valid.trusted_keys[0], public_key_spki_base64url: "not-a-key" }],
    })).toThrow();
    expect(() => parseDemoStateSnapshot({
      ...valid,
      trusted_keys: [{ ...valid.trusted_keys[0], private_key_pem: "must-not-persist" }],
    })).toThrow();
  });

  it("requires durable storage before reporting a persisted revocation", async () => {
    const key = trustedKey();
    const state = new J2aRealTestnetDemoState(baseSnapshot([key]));
    await expect(state.revokeTrustedKey(key.signing_key_id)).rejects.toThrow(/durable repository/i);
    expect(state.trustedKeys.export()).toContainEqual(expect.objectContaining({ status: "ACTIVE" }));
  });

  it("propagates failed CAS and keeps repeated durable revocation idempotent", async () => {
    const key = trustedKey();
    const state = new J2aRealTestnetDemoState(baseSnapshot([key]));
    const compareAndSet = vi.fn()
      .mockRejectedValueOnce(new Error("durable write failed"))
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(3);
    const repository = { compareAndSet } as never;
    state.attachRepository(repository, "j2a-test", 1);

    await expect(state.revokeTrustedKey(key.signing_key_id)).rejects.toThrow("durable write failed");
    expect(state.trustedKeys.export()).toContainEqual(expect.objectContaining({ status: "REVOKED" }));
    await state.revokeTrustedKey(key.signing_key_id);
    await state.revokeTrustedKey(key.signing_key_id);

    expect(compareAndSet).toHaveBeenCalledTimes(3);
    expect(compareAndSet.mock.calls.map((call) => call[2].trusted_keys)).toEqual([
      expect.arrayContaining([expect.objectContaining({ status: "REVOKED" })]),
      expect.arrayContaining([expect.objectContaining({ status: "REVOKED" })]),
      expect.arrayContaining([expect.objectContaining({ status: "REVOKED" })]),
    ]);
  });

  it("upgrades legacy snapshots without inferring active trust from a configured signing secret", async () => {
    const pair = generateEd25519KeyPair();
    vi.stubEnv(signingKeyEnvironmentVariableName(DEMO_SIGNING_KEY_ID), exportPrivateKeyPem(pair.privateKey));
    vi.stubEnv("SUPABASE_URL", "https://demo.supabase.test");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_GIT_PULL_REQUEST_ID", "58");
    const source = new DemoState();
    for (const obligation of source.listObligations()) {
      const current = source.store.get(DEMO_ORGANIZATION_ID, obligation.obligation_id);
      source.store.seed({
        ...current,
        destination_ref: `DEST-${obligation.obligation_id}-LEGACY-TEST`,
        source_wallet_ref: "WALLET-SOURCE-LEGACY-TEST",
        product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
      });
      sealTestAssessment(source.store, DEMO_ORGANIZATION_ID, obligation.obligation_id, current.aggregate_version);
    }
    const obligationId = source.listObligations()[0]!.obligation_id;
    const aggregate = source.store.get(DEMO_ORGANIZATION_ID, obligationId);
    const authorization = approveAndSealPae(source.store, DEMO_SIGNING_KEY_ID, {
      organizationId: DEMO_ORGANIZATION_ID,
      obligationId,
      expectedVersion: aggregate.aggregate_version,
      ...currentAssessmentReview(source.store, DEMO_ORGANIZATION_ID, obligationId),
      actorId: "USR-LEGACY-TEST",
      actorRole: "FINANCE_APPROVER",
      policyVersion: "POLICY-P0-1",
      reasonText: "Legacy migration test fixture with prior PAE trust status omitted.",
    }, source.trustedKeys);
    source.recordAuthorization({
      approval_record: authorization.approvalRecord.record,
      approval_record_hash: authorization.approvalRecord.approval_record_hash,
      assurance_record: authorization.assuranceRecord.record,
      assurance_hash: authorization.assuranceRecord.assurance_hash,
      sealed_pae: authorization.sealed,
    });
    const legacy = source.exportSnapshot();
    const { trusted_keys: _discard, ...withoutTrustedKeys } = legacy;
    const legacySnapshot = { ...withoutTrustedKeys, schema_version: 1 };
    let migrated: Record<string, unknown> | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      if (String(_url).includes("load_or_seed")) {
        return new Response(JSON.stringify({ revision: 1, snapshot: legacySnapshot }));
      }
      migrated = body.p_next_snapshot as Record<string, unknown>;
      return new Response(JSON.stringify({ accepted: true, revision: 2 }));
    }));

    const { getJ2aRealTestnetDemoState } = await import("../src/server/demo-state");
    const state = await getJ2aRealTestnetDemoState();

    expect(state.trustedKeys.export()).toEqual([]);
    expect(migrated?.trusted_keys).toEqual([]);
    expect(() => verifySealedPae(authorization.sealed, state.trustedKeys)).toThrow(expect.objectContaining({ code: "PAE-015" }));
    expect(JSON.stringify(migrated)).not.toContain("BEGIN PRIVATE KEY");
    expect(migrated?.schema_version).toBe(2);
  });
});
