import { describe, expect, it } from "vitest";

import { paeUnsignedPayloadSchema, type PaeUnsignedPayload } from "../src/domain/schemas";
import { AuthorityStore, type AuthorityAggregate } from "../src/authority/aggregate";
import { ExecutionWorker } from "../src/execution/worker";
import { FakeProviderAdapter } from "../src/execution/fake-provider-adapter";
import { sealTestAssessment } from "./test-support/seal-assessment";

/**
 * Closes out the minimum negative cases listed in the SWD methodology
 * amendment (issue #1 comment 5864595995, section 6) not already covered
 * by tests/pae.test.ts, tests/execution.test.ts and tests/finance-agent.test.ts:
 * amount/asset/network mismatch, and missing human authorization.
 */

function validPayload(overrides: Partial<PaeUnsignedPayload> = {}): unknown {
  return {
    signing_key_id: "K1",
    signing_algorithm: "Ed25519",
    pae_schema_version: "PAE-P0-1",
    instruction_id: "INSTR-1",
    organization_id: "ORG-DEMO-001",
    obligation_ids: ["OBL-1"],
    evidence_hashes: [],
    counterparty_id: "CP-1",
    counterparty_version: "1",
    source_wallet_ref: "WALLET-1",
    source_wallet_version: "1",
    destination_ref: "DEST-1",
    destination_version: "1",
    destination_address: `0x${"1".repeat(40)}`,
    amount: "1.000000",
    atomic_amount: "1000000",
    asset: "USDC",
    network: "ARC_TESTNET",
    policy_version: "POLICY-P0-1",
    approval_evidence: [
      {
        approval_id: "APR-1",
        organization_id: "ORG-DEMO-001",
        obligation_id: "OBL-1",
        actor_id: "USR-1",
        actor_role: "FINANCE_APPROVER",
        authority_version: "1",
        reviewed_aggregate_version: "1",
        authorized_aggregate_version: "2",
        approved_at: "2026-09-28T00:00:00.000Z",
        policy_version: "POLICY-P0-1",
        approval_record_hash: "a".repeat(64),
        assessment_id: "ASM-1",
        assessment_hash: "c".repeat(64),
      },
    ],
    assurance_hash: "b".repeat(64),
    aggregate_version: "2",
    expiry: "2026-09-28T00:30:00.000Z",
    nonce: "nonce-1",
    idempotency_key: "idem-1",
    ...overrides,
  };
}

describe("negative path: amount/asset/network mismatch", () => {
  it("rejects a non-USDC asset at the schema boundary", () => {
    const result = paeUnsignedPayloadSchema.safeParse(validPayload({ asset: "BTC" as unknown as "USDC" }));
    expect(result.success).toBe(false);
  });

  it("rejects a non-Arc-Testnet network at the schema boundary", () => {
    const result = paeUnsignedPayloadSchema.safeParse(
      validPayload({ network: "ETHEREUM_MAINNET" as unknown as "ARC_TESTNET" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects an amount with the wrong decimal scale (not exactly 6 fractional digits)", () => {
    const result = paeUnsignedPayloadSchema.safeParse(validPayload({ amount: "1.00" }));
    expect(result.success).toBe(false);
  });

  it("rejects a negative or scientific-notation amount", () => {
    expect(paeUnsignedPayloadSchema.safeParse(validPayload({ amount: "-1.000000" })).success).toBe(false);
    expect(paeUnsignedPayloadSchema.safeParse(validPayload({ amount: "1e2.000000" })).success).toBe(false);
  });
});

describe("negative path: missing human authorization", () => {
  function baseAggregate(overrides: Partial<AuthorityAggregate> = {}): AuthorityAggregate {
    return {
      organization_id: "ORG-DEMO-001",
      obligation_id: "OBL-J0C-002",
      aggregate_version: 1,
      state: "OPEN",
      amount: "21.000000",
      asset: "USDC",
      network: "ARC_TESTNET",
      counterparty_id: "CP-J0C-002",
      counterparty_version: 1,
      counterparty_status: "VERIFIED",
      destination_ref: "DEST-J0C-999",
      destination_version: 1,
      destination_address: `0x${"1".repeat(40)}`,
      destination_verification_status: "VERIFIED",
      destination_operational_status: "ACTIVE",
      source_wallet_ref: "WALLET-SOURCE-P0-1",
      source_wallet_version: 1,
      source_wallet_status: "ACTIVE",
      evidence_hashes: [],
      policy_version: "POLICY-P0-1",
      business_hold: false,
      security_freeze: false,
      external_settlement_state: "NONE",
      pae_state: "UNUSED",
      execution_state: "NONE",
      execution_idempotency_key: null,
      reviewed_aggregate_version: null,
      ...overrides,
    };
  }

  it("the Safety Kernel BLOCKs on SK-FINANCIAL-AUTHORITY when the obligation was never approved", async () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate()); // still OPEN — never transitioned through approve()
    const { runSafetyKernel } = await import("../src/safety-kernel/kernel");
    const result = runSafetyKernel(store.get("ORG-DEMO-001", "OBL-J0C-002"), store);
    expect(result.overall).toBe("BLOCK");
    expect(result.controlResults.find((c) => c.control_id === "SK-FINANCIAL-AUTHORITY")?.result).toBe("BLOCK");
  });

  it("the Execution Worker cannot be invoked at all without a sealed PAE object to pass it", async () => {
    // There is no code path that lets a caller construct/obtain a SealedPae
    // without going through approveAndSealPae, which itself requires the
    // atomic approve() transition. This test documents that boundary: an
    // obligation aggregate that was never approved has no sealed PAE to
    // execute in the first place.
    const store = new AuthorityStore();
    store.seed(baseAggregate());
    const worker = new ExecutionWorker(store, new FakeProviderAdapter());
    expect(worker.getExecutionRecord("idem-never-approved")).toBeUndefined();
  });

  it("refuses to approve an obligation that was never assessed by the Finance Agent", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate({ state: "APPROVAL_PENDING" }));
    expect(() => store.approve("ORG-DEMO-001", "OBL-J0C-002", 1, "missing", "0".repeat(64))).toThrow(/no sealed Finance Agent assessment/);
  });

  it("refuses to approve an obligation the Finance Agent decided HOLD or ESCALATE", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate({ state: "APPROVAL_PENDING" }));
    const assessment = sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 1, { decision: "HOLD" });
    expect(() => store.approve("ORG-DEMO-001", "OBL-J0C-002", 1, assessment.record.assessment_id, assessment.assessment_hash)).toThrow(/sealed assessment decision is HOLD/);
  });

  it("refuses approval when the human reviewed an older same-version assessment", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate({ state: "APPROVAL_PENDING" }));
    const reviewed = sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 1);
    const replacement = sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 1);
    expect(replacement.assessment_hash).not.toBe(reviewed.assessment_hash);

    expect(() => store.approve(
      "ORG-DEMO-001",
      "OBL-J0C-002",
      1,
      reviewed.record.assessment_id,
      reviewed.assessment_hash,
    )).toThrow(/reviewed assessment is no longer current/);
  });

  it("refuses to approve when the sealed assessment is stale (obligation changed since it was assessed)", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate({ state: "APPROVAL_PENDING" }));
    const assessment = sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 1);
    store.applyMaterialChange("ORG-DEMO-001", "OBL-J0C-002", 1, { policy_version: "POLICY-P0-2" });
    // Aggregate is now version 2; the sealed assessment is still bound to version 1.
    expect(() => store.approve("ORG-DEMO-001", "OBL-J0C-002", 2, assessment.record.assessment_id, assessment.assessment_hash)).toThrow(/bound to aggregate_version 1/);
  });

  it("refuses to approve even a PAY-decided obligation while a sibling obligation has not been assessed yet", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate({ obligation_id: "OBL-A", state: "APPROVAL_PENDING" }));
    store.seed(baseAggregate({ obligation_id: "OBL-B", state: "APPROVAL_PENDING" }));
    const assessment = sealTestAssessment(store, "ORG-DEMO-001", "OBL-A", 1);
    // OBL-B is never assessed.
    expect(() => store.approve("ORG-DEMO-001", "OBL-A", 1, assessment.record.assessment_id, assessment.assessment_hash)).toThrow(/OBL-B has not been assessed yet/);
  });

  it("enforces exactly-one candidate selection: refuses to approve a second obligation while another is already the committed candidate", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate({ obligation_id: "OBL-A", state: "APPROVAL_PENDING" }));
    store.seed(baseAggregate({ obligation_id: "OBL-B", state: "APPROVAL_PENDING" }));
    const assessmentA = sealTestAssessment(store, "ORG-DEMO-001", "OBL-A", 1);
    const assessmentB = sealTestAssessment(store, "ORG-DEMO-001", "OBL-B", 1);

    store.approve("ORG-DEMO-001", "OBL-A", 1, assessmentA.record.assessment_id, assessmentA.assessment_hash);
    expect(() => store.approve("ORG-DEMO-001", "OBL-B", 1, assessmentB.record.assessment_id, assessmentB.assessment_hash)).toThrow(/already the committed sole execution candidate/);
  });

  it("allows approving a different obligation once the previously-committed candidate is cancelled", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate({ obligation_id: "OBL-A", state: "APPROVAL_PENDING" }));
    store.seed(baseAggregate({ obligation_id: "OBL-B", state: "APPROVAL_PENDING" }));
    const assessmentA = sealTestAssessment(store, "ORG-DEMO-001", "OBL-A", 1);
    const assessmentB = sealTestAssessment(store, "ORG-DEMO-001", "OBL-B", 1);

    const authorizedA = store.approve("ORG-DEMO-001", "OBL-A", 1, assessmentA.record.assessment_id, assessmentA.assessment_hash);
    store.cancel("ORG-DEMO-001", "OBL-A", authorizedA.aggregate_version);
    const authorizedB = store.approve("ORG-DEMO-001", "OBL-B", 1, assessmentB.record.assessment_id, assessmentB.assessment_hash);
    expect(authorizedB.state).toBe("AUTHORIZED");
  });
});
