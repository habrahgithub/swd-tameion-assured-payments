import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AuthorityStore, type AuthorityAggregate } from "../src/authority/aggregate";
import { approveAndSealPae, AssuranceFailedError } from "../src/pipeline/authorize-and-seal";
import { exportPublicKeySpkiBase64Url, signingKeyEnvironmentVariableName, TrustedKeyRegistry } from "../src/pae/keys";
import * as signing from "../src/pae/sign-verify";
import { isCurrentSourceEligible } from "../src/server/source-records";
import { currentAssessmentReview, sealTestAssessment } from "./test-support/seal-assessment";

const keyId = "SYNTHETIC-SIGNER-PRECONDITION";
const envName = signingKeyEnvironmentVariableName(keyId);

afterEach(() => vi.unstubAllEnvs());

// Invented, non-economic fixture; source admission is mocked by suite setup.
function fixture() {
  const store = new AuthorityStore();
  const aggregate: AuthorityAggregate = {
    organization_id: "SYNTHETIC-ORG", obligation_id: "SYNTHETIC-OBL", aggregate_version: 3,
    state: "APPROVAL_PENDING", amount: "21.000000", asset: "USDC", network: "ARC_TESTNET",
    counterparty_id: "SYNTHETIC-CP", counterparty_version: 1, counterparty_status: "VERIFIED",
    destination_ref: "SYNTHETIC-DEST", destination_version: 1,
    product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
    destination_address: `0x${"1".repeat(40)}`, destination_verification_status: "VERIFIED",
    destination_operational_status: "ACTIVE", source_wallet_ref: "SYNTHETIC-WALLET",
    source_wallet_version: 1, source_wallet_status: "ACTIVE", evidence_hashes: ["a".repeat(64)],
    policy_version: "SYNTHETIC-POLICY", business_hold: false, security_freeze: false,
    external_settlement_state: "NONE", pae_state: "REVOKED", execution_state: "NONE",
    execution_idempotency_key: null, reviewed_aggregate_version: null,
    source_amount: "21.00", source_currency: "USD", settlement_conversion_rate: null,
  };
  store.seed(aggregate);
  sealTestAssessment(store, aggregate.organization_id, aggregate.obligation_id, 3);
  const registry = new TrustedKeyRegistry();
  const input = {
    organizationId: aggregate.organization_id, obligationId: aggregate.obligation_id, expectedVersion: 3,
    ...currentAssessmentReview(store, aggregate.organization_id, aggregate.obligation_id),
    actorId: "SYNTHETIC-REVIEWER", actorRole: "FINANCE_APPROVER", policyVersion: aggregate.policy_version,
    reasonText: "SIMULATED / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
    now: () => new Date("2026-10-12T12:00:00.000Z"),
  };
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv(envName, undefined);
  return { store, registry, input, approve: () => approveAndSealPae(store, keyId, input, registry) };
}

function configureKey(registry: TrustedKeyRegistry, status: "ACTIVE" | "REVOKED" = "ACTIVE") {
  const pair = generateKeyPairSync("ed25519");
  vi.stubEnv(envName, pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  registry.register({ signing_key_id: keyId, signing_algorithm: "Ed25519",
    public_key_spki_base64url: exportPublicKeySpkiBase64Url(pair.publicKey), status });
  return pair;
}

describe("authorization signing precondition and local failure integrity", () => {
  it.each(["preview", "production"])("missing %s signer refuses before authority mutation or key fabrication", environment => {
    const { store, registry, approve } = fixture();
    vi.stubEnv("VERCEL_ENV", environment);
    const before = store.exportSnapshot();
    const approveSpy = vi.spyOn(store, "approve");
    const markSpy = vi.spyOn(store, "markPaeSealed");
    expect(approve).toThrow(expect.objectContaining({ code: "PAE-015" }));
    expect(store.exportSnapshot()).toEqual(before);
    expect(approveSpy).not.toHaveBeenCalled();
    expect(markSpy).not.toHaveBeenCalled();
    expect(registry.export()).toEqual([]);
  });

  it.each(["malformed", "wrong algorithm", "revoked", "mismatched"])("%s signer is a typed refusal with unchanged authority and trust", kind => {
    const { store, registry, approve } = fixture();
    if (kind === "malformed") vi.stubEnv(envName, "invalid synthetic PEM");
    if (kind === "wrong algorithm") {
      const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      vi.stubEnv(envName, pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    }
    if (kind === "revoked") configureKey(registry, "REVOKED");
    if (kind === "mismatched") {
      configureKey(registry);
      vi.stubEnv(envName, generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    }
    const before = store.exportSnapshot(), trust = registry.export();
    const approveSpy = vi.spyOn(store, "approve");
    expect(approve).toThrow(expect.objectContaining({ code: "PAE-015" }));
    expect(store.exportSnapshot()).toEqual(before);
    expect(registry.export()).toEqual(trust);
    expect(approveSpy).not.toHaveBeenCalled();
  });

  it("an actual sealing exception restores local authority without publishing PAE state", () => {
    const { store, registry, approve } = fixture();
    configureKey(registry);
    const before = store.exportSnapshot();
    const mark = vi.spyOn(store, "markPaeSealed");
    const failure = new Error("synthetic signing failure");
    vi.spyOn(signing, "sealPae").mockImplementationOnce(() => { throw failure; });
    expect(approve).toThrow(failure);
    expect(store.exportSnapshot()).toEqual(before);
    expect(mark).not.toHaveBeenCalled();
  });

  it("payload validation failure after signer readiness preserves local authority", () => {
    const { store, registry, input, approve } = fixture();
    configureKey(registry);
    input.actorId = "";
    const before = store.exportSnapshot();
    expect(approve).toThrow();
    expect(store.exportSnapshot()).toEqual(before);
  });

  it("kernel BLOCK retains its structured refusal and restores the local aggregate", () => {
    const { store, registry, approve } = fixture();
    configureKey(registry);
    store.activateKillSwitch("GLOBAL_EXECUTION_DISABLED");
    const before = store.exportSnapshot();
    expect(approve).toThrow(AssuranceFailedError);
    expect(store.exportSnapshot()).toEqual(before);
  });

  it("a final local transition failure does not leave authorization or return an envelope", () => {
    const { store, registry, approve } = fixture();
    configureKey(registry);
    const before = store.exportSnapshot();
    const failure = new Error("synthetic local transition failure");
    const mark = store.markPaeSealed.bind(store);
    vi.spyOn(store, "markPaeSealed").mockImplementationOnce((...args) => {
      mark(...args);
      throw failure;
    });
    expect(approve).toThrow(failure);
    expect(store.exportSnapshot()).toEqual(before);
  });

  it("source withdrawal and stale review still reject before signing", () => {
    const { store, input, approve } = fixture();
    const seal = vi.spyOn(signing, "sealPae");
    const before = store.exportSnapshot();
    vi.mocked(isCurrentSourceEligible).mockReturnValue(false);
    expect(approve).toThrow(expect.objectContaining({ code: "SRC-001" }));
    vi.mocked(isCurrentSourceEligible).mockReturnValue(true);
    input.expectedVersion = 2;
    expect(approve).toThrow(/STALE_STATE/);
    input.expectedVersion = 3;
    input.reviewedAssessmentHash = "b".repeat(64);
    expect(approve).toThrow(expect.objectContaining({ code: "AUT-013" }));
    expect(store.exportSnapshot()).toEqual(before);
    expect(seal).not.toHaveBeenCalled();
  });

  it("valid signing precedes published PAE state and preserves exact intent and reviewed N to N+1", () => {
    const { store, registry, input, approve } = fixture();
    configureKey(registry);
    const actualSeal = signing.sealPae;
    const sign = vi.spyOn(signing, "sealPae").mockImplementation((payload, key) => {
      expect(store.get(input.organizationId, input.obligationId).pae_state).toBe("REVOKED");
      return actualSeal(payload, key);
    });
    const result = approve();
    signing.verifySealedPae(result.sealed, registry);
    expect(sign).toHaveBeenCalledOnce();
    expect(result.aggregate).toMatchObject({ aggregate_version: 4, reviewed_aggregate_version: 3, state: "AUTHORIZED", pae_state: "UNUSED" });
    expect(result.sealed.payload).toMatchObject({ aggregate_version: "4", amount: "21.000000", atomic_amount: "21000000",
      destination_address: `0x${"1".repeat(40)}`, idempotency_key: "idem-SYNTHETIC-ORG-SYNTHETIC-OBL-4",
      approval_evidence: [expect.objectContaining({ reviewed_aggregate_version: "3", authorized_aggregate_version: "4",
        assessment_id: input.reviewedAssessmentId, assessment_hash: input.reviewedAssessmentHash,
        approval_record_hash: result.approvalRecord.approval_record_hash })],
      assurance_hash: result.assuranceRecord.assurance_hash });
    expect(store.get(input.organizationId, input.obligationId)).toEqual(result.aggregate);
  });
});
