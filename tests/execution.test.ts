import { beforeEach, describe, expect, it } from "vitest";

import { AuthorityStore, type AuthorityAggregate } from "../src/authority/aggregate";
import { approveAndSealPae, AssuranceFailedError } from "../src/pipeline/authorize-and-seal";
import { ExecutionWorker, ExecutionBlockedError } from "../src/execution/worker";
import { FakeProviderAdapter } from "../src/execution/fake-provider-adapter";

const SIGNING_KEY_ID = "TEST-SIGNING-KEY-1";

function baseAggregate(overrides: Partial<AuthorityAggregate> = {}): AuthorityAggregate {
  return {
    organization_id: "ORG-DEMO-001",
    obligation_id: "OBL-J0C-002",
    aggregate_version: 3,
    state: "APPROVAL_PENDING",
    amount: "21.000000",
    asset: "USDC",
    network: "ARC_TESTNET",
    counterparty_id: "CP-J0C-002",
    counterparty_version: 1,
    counterparty_status: "VERIFIED",
    destination_ref: "DEST-J0C-999",
    destination_version: 1,
    destination_address: "0x1234567890abcdef1234567890abcdef12345678",
    destination_verification_status: "VERIFIED",
    destination_operational_status: "ACTIVE",
    source_wallet_ref: "WALLET-SOURCE-P0-1",
    source_wallet_version: 1,
    source_wallet_status: "ACTIVE",
    evidence_hashes: ["156d7aea6b0c0b843426cc795eb889982f074bff86df3158688759bd8252332f"],
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

function setupAuthorizedFixture() {
  const store = new AuthorityStore();
  store.seed(baseAggregate());
  const { aggregate, sealed } = approveAndSealPae(store, SIGNING_KEY_ID, {
    organizationId: "ORG-DEMO-001",
    obligationId: "OBL-J0C-002",
    expectedVersion: 3,
    actorId: "USR-OPERATOR-001",
    actorRole: "FINANCE_APPROVER",
    policyVersion: "POLICY-P0-1",
    reasonText: "Reviewed and approved for testnet product payment.",
  });
  return { store, aggregate, sealed };
}

describe("human approval + Safety Kernel (P0 core tests 2-3)", () => {
  it("binds reviewed N and atomically creates authorized N+1", () => {
    const { store, aggregate } = setupAuthorizedFixture();
    expect(aggregate.aggregate_version).toBe(4);
    expect(aggregate.state).toBe("AUTHORIZED");
    expect(store.get("ORG-DEMO-001", "OBL-J0C-002").aggregate_version).toBe(4);
  });

  it("refuses to seal a PAE when the Safety Kernel does not PASS", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate({ destination_verification_status: "PENDING_VERIFICATION" }));
    expect(() =>
      approveAndSealPae(store, SIGNING_KEY_ID, {
        organizationId: "ORG-DEMO-001",
        obligationId: "OBL-J0C-002",
        expectedVersion: 3,
        actorId: "USR-OPERATOR-001",
        actorRole: "FINANCE_APPROVER",
        policyVersion: "POLICY-P0-1",
        reasonText: "Attempting approval with an unverified destination.",
      }),
    ).toThrow(AssuranceFailedError);
  });

  it("rejects a stale approval attempt (STALE_STATE)", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate());
    expect(() =>
      approveAndSealPae(store, SIGNING_KEY_ID, {
        organizationId: "ORG-DEMO-001",
        obligationId: "OBL-J0C-002",
        expectedVersion: 2, // stale; current is 3
        actorId: "USR-OPERATOR-001",
        actorRole: "FINANCE_APPROVER",
        policyVersion: "POLICY-P0-1",
        reasonText: "Stale approval attempt.",
      }),
    ).toThrow(/STALE_STATE/);
  });
});

describe("Execution Worker (P0 core tests 6-11)", () => {
  it("(6) executes and settles with a valid PAE on the mocked golden path", async () => {
    const { store, sealed } = setupAuthorizedFixture();
    const adapter = new FakeProviderAdapter();
    adapter.queueOutcome("CONFIRMED");
    const worker = new ExecutionWorker(store, adapter);
    const record = await worker.execute(sealed);
    expect(record.status).toBe("SETTLED");
    expect(store.get("ORG-DEMO-001", "OBL-J0C-002").state).toBe("RECONCILED");
  });

  it("(6) refuses execution when the PAE signature is invalid", async () => {
    const { store, sealed } = setupAuthorizedFixture();
    const tampered = { ...sealed, signature: "0".repeat(128) };
    const worker = new ExecutionWorker(store, new FakeProviderAdapter());
    await expect(worker.execute(tampered)).rejects.toThrow();
  });

  it("(7) replay/concurrent execute produces at most one provider submission", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    const adapter = new FakeProviderAdapter();
    adapter.queueOutcome("CONFIRMED");
    const worker = new ExecutionWorker(store, adapter);

    const [first, second] = await Promise.all([worker.execute(sealed), worker.execute(sealed).catch((e) => e)]);
    // Whichever call wins the atomic claim submits once; the other either
    // returns the same terminal record or is rejected — never a second submission.
    expect(adapter.getSubmissionCount()).toBe(1);
    expect(first.status).toBe("SETTLED");
    if (!(second instanceof Error)) {
      expect(second.provider_ref).toBe(first.provider_ref);
    }

    // A later call with the exact same sealed PAE after settlement must also
    // be idempotent, not a fresh submission.
    const third = await worker.execute(sealed);
    expect(third.provider_ref).toBe(first.provider_ref);
    expect(adapter.getSubmissionCount()).toBe(1);
  });

  it("(8) provider timeout/UNKNOWN performs status lookup and never blind-retries", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    const adapter = new FakeProviderAdapter();
    adapter.queueOutcome("TIMEOUT");
    const worker = new ExecutionWorker(store, adapter);

    const record = await worker.execute(sealed);
    expect(record.status).toBe("UNKNOWN");
    expect(adapter.getSubmissionCount()).toBe(1);

    // Calling execute again with the same PAE must not resubmit.
    const again = await worker.execute(sealed);
    expect(again.status).toBe("UNKNOWN");
    expect(adapter.getSubmissionCount()).toBe(1);

    // The chain eventually confirms; reconciliation must query provider
    // truth, not guess or resubmit.
    adapter.resolvePending(record.provider_ref!, "CONFIRMED");
    const resolved = await worker.reconcilePendingByIdempotencyKey(sealed.payload.idempotency_key, "ORG-DEMO-001");
    expect(resolved.status).toBe("SETTLED");
    expect(adapter.getSubmissionCount()).toBe(1);
  });

  it("(9) BLOCKs pre-submit with zero unauthorized movement when the destination changed after authorization", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    // Simulate an attacker/operator changing the destination after the PAE was sealed.
    store.applyMaterialChange("ORG-DEMO-001", "OBL-J0C-002", 4, {
      destination_ref: "DEST-J0C-ATTACKER",
      destination_version: 2,
      destination_address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      destination_verification_status: "PENDING_VERIFICATION",
    });
    const adapter = new FakeProviderAdapter();
    const worker = new ExecutionWorker(store, adapter);

    await expect(worker.execute(sealed)).rejects.toThrow(ExecutionBlockedError);
    expect(adapter.getSubmissionCount()).toBe(0);
    expect(store.get("ORG-DEMO-001", "OBL-J0C-002").execution_state).toBe("BLOCKED");
  });

  it("(10) kill switch prevents execution", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    store.activateKillSwitch("GLOBAL_EXECUTION_DISABLED");
    const adapter = new FakeProviderAdapter();
    const worker = new ExecutionWorker(store, adapter);

    await expect(worker.execute(sealed)).rejects.toThrow(ExecutionBlockedError);
    expect(adapter.getSubmissionCount()).toBe(0);
  });

  it("(11) settlement amount/destination/status must reconcile exactly to the obligation", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    const adapter = new FakeProviderAdapter();
    // Force a provider confirmation whose recorded amount silently differs
    // (simulating a corrupted/incorrect settlement observation).
    const originalGetStatus = adapter.getStatus.bind(adapter);
    adapter.getStatus = async (ref: string) => {
      const result = await originalGetStatus(ref);
      if (result.status === "CONFIRMED") {
        return { ...result, atomicAmount: "1" };
      }
      return result;
    };
    adapter.queueOutcome("CONFIRMED");
    const worker = new ExecutionWorker(store, adapter);

    const record = await worker.execute(sealed);
    expect(record.status).toBe("BLOCKED");
    expect(store.get("ORG-DEMO-001", "OBL-J0C-002").state).not.toBe("RECONCILED");
  });
});
