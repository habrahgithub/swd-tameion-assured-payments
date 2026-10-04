import { beforeEach, describe, expect, it } from "vitest";

import { AuthorityStore, type AuthorityAggregate } from "../src/authority/aggregate";
import { approveAndSealPae, AssuranceFailedError } from "../src/pipeline/authorize-and-seal";
import { ExecutionWorker, ExecutionBlockedError } from "../src/execution/worker";
import { FakeProviderAdapter } from "../src/execution/fake-provider-adapter";
import { ProviderPreSubmitBlockedError } from "../src/execution/provider-adapter";
import { currentAssessmentReview, sealTestAssessment } from "./test-support/seal-assessment";

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
    product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
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
    source_amount: "21.00",
    source_currency: "USD",
    settlement_conversion_rate: null,
    ...overrides,
  };
}

function setupAuthorizedFixture() {
  const store = new AuthorityStore();
  store.seed(baseAggregate());
  sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 3);
  const { aggregate, sealed } = approveAndSealPae(store, SIGNING_KEY_ID, {
    organizationId: "ORG-DEMO-001",
    obligationId: "OBL-J0C-002",
    expectedVersion: 3,
    ...currentAssessmentReview(store, "ORG-DEMO-001", "OBL-J0C-002"),
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
    sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 3);
    expect(() =>
      approveAndSealPae(store, SIGNING_KEY_ID, {
        organizationId: "ORG-DEMO-001",
        obligationId: "OBL-J0C-002",
        expectedVersion: 3,
        ...currentAssessmentReview(store, "ORG-DEMO-001", "OBL-J0C-002"),
        actorId: "USR-OPERATOR-001",
        actorRole: "FINANCE_APPROVER",
        policyVersion: "POLICY-P0-1",
        reasonText: "Attempting approval with an unverified destination.",
      }),
    ).toThrow(AssuranceFailedError);
  });

  it("AssuranceFailedError carries the real per-control breakdown, not just an embedded message string", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate({ destination_verification_status: "PENDING_VERIFICATION" }));
    sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 3);
    try {
      approveAndSealPae(store, SIGNING_KEY_ID, {
        organizationId: "ORG-DEMO-001",
        obligationId: "OBL-J0C-002",
        expectedVersion: 3,
        ...currentAssessmentReview(store, "ORG-DEMO-001", "OBL-J0C-002"),
        actorId: "USR-OPERATOR-001",
        actorRole: "FINANCE_APPROVER",
        policyVersion: "POLICY-P0-1",
        reasonText: "Attempting approval with an unverified destination.",
      });
      expect.unreachable("expected approveAndSealPae to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(AssuranceFailedError);
      const failure = error as AssuranceFailedError;
      expect(failure.controlResults.length).toBe(10);
      const destinationControl = failure.controlResults.find((c) => c.control_id === "SK-DESTINATION-TRUST");
      expect(destinationControl?.result).toBe("BLOCK");
    }
  });

  it("rejects a stale approval attempt (STALE_STATE)", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate());
    expect(() =>
      approveAndSealPae(store, SIGNING_KEY_ID, {
        organizationId: "ORG-DEMO-001",
        obligationId: "OBL-J0C-002",
        expectedVersion: 2, // stale; current is 3
        reviewedAssessmentId: "stale-assessment",
        reviewedAssessmentHash: "0".repeat(64),
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

  it("keeps a provider PENDING response UNKNOWN with its reference for read-only reconciliation", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    let status: "PENDING" | "CONFIRMED" = "PENDING";
    let submissions = 0;
    const adapter = {
      name: "pending-provider-test-adapter",
      async submitTransfer() {
        submissions += 1;
        return { providerRef: "circle-transaction-1", status: "SUBMITTED" as const };
      },
      async getStatus() {
        return status === "PENDING"
          ? { status: "PENDING" as const }
          : { status: "CONFIRMED" as const, destinationAddress: baseAggregate().destination_address, atomicAmount: "21000000" };
      },
    };
    const worker = new ExecutionWorker(store, adapter);

    const first = await worker.execute(sealed);
    expect(first).toMatchObject({ status: "UNKNOWN", provider_ref: "circle-transaction-1" });
    expect(store.get("ORG-DEMO-001", "OBL-J0C-002").execution_state).toBe("UNKNOWN");
    expect(submissions).toBe(1);

    status = "CONFIRMED";
    const reconciled = await worker.reconcilePendingByIdempotencyKey(sealed.payload.idempotency_key, "ORG-DEMO-001");
    expect(reconciled.status).toBe("SETTLED");
    expect(submissions).toBe(1);
  });

  it("retains provider reconciliation evidence in the durable execution record", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    const adapter = {
      name: "circle-evidence-test-adapter",
      async submitTransfer() { return { providerRef: "circle-tx-evidence", status: "SUBMITTED" as const }; },
      async getStatus(_providerRef: string, idempotencyKey?: string) {
        return {
          status: "CONFIRMED" as const,
          destinationAddress: baseAggregate().destination_address,
          atomicAmount: "21000000",
          transaction_id: "circle-tx-evidence",
          transaction_state: "COMPLETE",
          tx_hash: "0xabc123",
          wallet_id: baseAggregate().source_wallet_ref,
          token_id: "native-arc-usdc",
          network: "ARC-TESTNET",
          amounts: ["21.000000"],
          operation: "TRANSFER",
          ref_id: idempotencyKey,
          network_fee: "0.001000",
          provider_created_at: "2026-10-04T10:00:00.000Z",
          provider_updated_at: "2026-10-04T10:01:00.000Z",
          reconciled_at: "2026-10-04T10:02:00.000Z",
        };
      },
    };
    const worker = new ExecutionWorker(store, adapter);
    const record = await worker.execute(sealed);

    expect(record.status).toBe("SETTLED");
    expect(record.provider_evidence).toMatchObject({
      transaction_id: "circle-tx-evidence",
      transaction_state: "COMPLETE",
      tx_hash: "0xabc123",
      network_fee: "0.001000",
      provider_created_at: "2026-10-04T10:00:00.000Z",
      provider_updated_at: "2026-10-04T10:01:00.000Z",
      reconciled_at: "2026-10-04T10:02:00.000Z",
    });
    expect(worker.exportSnapshot()[0]?.provider_evidence).toEqual(record.provider_evidence);
  });

  it("recovers persisted SUBMITTING as UNKNOWN through a read-only path without provider submission", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    const adapter = new FakeProviderAdapter();
    const worker = new ExecutionWorker(store, adapter);
    worker.restoreSnapshot([{
      obligation_id: sealed.payload.obligation_ids[0],
      idempotency_key: sealed.payload.idempotency_key,
      provider_ref: null,
      status: "SUBMITTING",
      atomic_amount: sealed.payload.atomic_amount,
      destination_address: sealed.payload.destination_address,
    }]);

    const recovered = await worker.recoverSubmittingByIdempotencyKey(sealed.payload.idempotency_key, "ORG-DEMO-001");

    expect(recovered?.status).toBe("UNKNOWN");
    expect(adapter.getSubmissionCount()).toBe(0);
    expect(worker.getExecutionRecord(sealed.payload.idempotency_key)?.status).toBe("UNKNOWN");
  });

  it("marks a typed pre-submit provider refusal BLOCKED without classifying it as UNKNOWN", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    let submissions = 0;
    const adapter = {
      name: "pre-submit-block-test-adapter",
      async submitTransfer() {
        submissions += 1;
        throw new ProviderPreSubmitBlockedError("fresh route evidence changed");
      },
      async getStatus() { return { status: "UNKNOWN" as const }; },
    };
    const worker = new ExecutionWorker(store, adapter);

    const result = await worker.execute(sealed);

    expect(result.status).toBe("BLOCKED");
    expect(store.get("ORG-DEMO-001", "OBL-J0C-002").execution_state).toBe("BLOCKED");
    expect(submissions).toBe(1);
  });

  it("records a thrown provider submission as UNKNOWN and never resubmits it", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    let submissionCount = 0;
    const adapter = {
      name: "throw-after-submit-test-adapter",
      async submitTransfer() {
        submissionCount += 1;
        throw new Error("transport closed after request dispatch");
      },
      async getStatus() {
        return { status: "UNKNOWN" as const };
      },
    };
    const worker = new ExecutionWorker(store, adapter);

    const first = await worker.execute(sealed);
    expect(first.status).toBe("UNKNOWN");
    expect(first.provider_ref).toBeNull();
    expect(store.get("ORG-DEMO-001", "OBL-J0C-002").execution_state).toBe("UNKNOWN");

    const replay = await worker.execute(sealed);
    expect(replay).toEqual(first);
    expect(submissionCount).toBe(1);
  });

  it("recovers a persisted SUBMITTING marker as UNKNOWN after restart without a provider resubmit", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    const adapter = new FakeProviderAdapter();
    let crashSnapshot: ReturnType<AuthorityStore["exportSnapshot"]> | undefined;
    let executionSnapshot: ReturnType<ExecutionWorker["exportSnapshot"]> | undefined;
    const interruptedWorker = new ExecutionWorker(store, adapter, async () => {
      crashSnapshot = store.exportSnapshot();
      executionSnapshot = interruptedWorker.exportSnapshot();
      throw new Error("simulated process loss after durable SUBMITTING marker");
    });

    await expect(interruptedWorker.execute(sealed)).rejects.toThrow(/simulated process loss/);
    expect(adapter.getSubmissionCount()).toBe(0);
    expect(executionSnapshot?.[0]?.status).toBe("SUBMITTING");

    const restartedStore = AuthorityStore.fromSnapshot(crashSnapshot!);
    const restartedWorker = new ExecutionWorker(restartedStore, adapter);
    restartedWorker.restoreSnapshot(executionSnapshot!);
    const recovered = await restartedWorker.execute(sealed);
    expect(recovered.status).toBe("UNKNOWN");
    expect(restartedStore.get("ORG-DEMO-001", "OBL-J0C-002").execution_state).toBe("UNKNOWN");
    expect(adapter.getSubmissionCount()).toBe(0);
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

  it("(9b) BLOCKs when the source wallet became inactive, even with aggregate_version unchanged (defense in depth beyond the version check)", async () => {
    const { sealed, store, aggregate } = setupAuthorizedFixture();
    // Directly overwrite the wallet status without going through
    // applyMaterialChange, so aggregate_version still matches the PAE.
    // This proves the Execution Worker re-checks wallet status itself
    // rather than relying solely on the version-mismatch shortcut.
    store.seed({ ...aggregate, source_wallet_status: "INACTIVE" });
    const adapter = new FakeProviderAdapter();
    const worker = new ExecutionWorker(store, adapter);

    await expect(worker.execute(sealed)).rejects.toThrow(ExecutionBlockedError);
    expect(adapter.getSubmissionCount()).toBe(0);
  });

  it("(9c) BLOCKs when the destination operational status degraded, even with ref/version/address unchanged", async () => {
    const { sealed, store, aggregate } = setupAuthorizedFixture();
    store.seed({ ...aggregate, destination_operational_status: "BLOCKED" });
    const adapter = new FakeProviderAdapter();
    const worker = new ExecutionWorker(store, adapter);

    await expect(worker.execute(sealed)).rejects.toThrow(ExecutionBlockedError);
    expect(adapter.getSubmissionCount()).toBe(0);
  });

  it("(10) kill switch prevents execution", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    store.activateKillSwitch("GLOBAL_EXECUTION_DISABLED");
    const adapter = new FakeProviderAdapter();
    const worker = new ExecutionWorker(store, adapter);

    await expect(worker.execute(sealed)).rejects.toThrow(ExecutionBlockedError);
    expect(adapter.getSubmissionCount()).toBe(0);
  });

  it("(10b) organization-scoped kill switch blocks execution for that organization", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    store.activateKillSwitch("ORGANIZATION_EXECUTION_DISABLED", "ORG-DEMO-001");
    const adapter = new FakeProviderAdapter();
    const worker = new ExecutionWorker(store, adapter);

    await expect(worker.execute(sealed)).rejects.toThrow(ExecutionBlockedError);
    expect(adapter.getSubmissionCount()).toBe(0);
  });

  it("(10c) transaction-scoped kill switch blocks only its exact obligation, never an unrelated one", async () => {
    const { sealed, store } = setupAuthorizedFixture();
    // Kill switch for a different obligation must not affect this one.
    store.activateKillSwitch("TRANSACTION_DISABLED", "OBL-SOME-OTHER-OBLIGATION");
    const adapter = new FakeProviderAdapter();
    adapter.queueOutcome("CONFIRMED");
    const worker = new ExecutionWorker(store, adapter);
    await expect(worker.execute(sealed)).resolves.toMatchObject({ status: "SETTLED" });

    // Now activate it for the exact obligation and prove it blocks a fresh one.
    const second = setupAuthorizedFixture();
    second.store.activateKillSwitch("TRANSACTION_DISABLED", "OBL-J0C-002");
    const worker2 = new ExecutionWorker(second.store, new FakeProviderAdapter());
    await expect(worker2.execute(second.sealed)).rejects.toThrow(ExecutionBlockedError);
  });

  it("cancel-vs-execute race yields exactly one winner, never both", async () => {
    // Case A: cancel completes fully before execute is ever invoked -> execute must lose.
    {
      const { sealed, store, aggregate } = setupAuthorizedFixture();
      store.cancel("ORG-DEMO-001", "OBL-J0C-002", aggregate.aggregate_version);
      const worker = new ExecutionWorker(store, new FakeProviderAdapter());
      await expect(worker.execute(sealed)).rejects.toThrow(ExecutionBlockedError);
      expect(store.get("ORG-DEMO-001", "OBL-J0C-002").state).toBe("CANCELLED");
    }

    // Case B: execute's synchronous claim (verify -> checks -> RESERVED -> SUBMITTING)
    // runs to completion before any interleaved code can act, so a cancel
    // attempted immediately after invoking (not awaiting) execute() must
    // observe the provider-submit boundary and be rejected — execute wins.
    {
      const { sealed, store, aggregate } = setupAuthorizedFixture();
      const adapter = new FakeProviderAdapter();
      adapter.queueOutcome("CONFIRMED");
      const worker = new ExecutionWorker(store, adapter);

      const executePromise = worker.execute(sealed); // not awaited yet
      expect(() => store.cancel("ORG-DEMO-001", "OBL-J0C-002", aggregate.aggregate_version)).toThrow(
        /provider-submit boundary/,
      );
      const record = await executePromise;
      expect(record.status).toBe("SETTLED");
      expect(adapter.getSubmissionCount()).toBe(1);
    }
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
