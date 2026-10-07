import { describe, expect, it, vi } from "vitest";

import { AuthorityStore, type AuthorityAggregate } from "../src/authority/aggregate";
import { ExecutionBlockedError, ExecutionWorker } from "../src/execution/worker";
import { FakeProviderAdapter } from "../src/execution/fake-provider-adapter";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { sealDurableApprovalRecord } from "../src/pae/durable-records";
import { processTrustedKeyRegistry } from "../src/pae/keys";
import type { DurableApprovalRecord, DurableAssuranceRecord, SealedPae } from "../src/domain/schemas";
import { DemoStateConflictError } from "../src/server/supabase-demo-state-repository";
import { currentAssessmentReview, sealTestAssessment } from "./test-support/seal-assessment";

const ORG = "ORG-DEMO-001";
const OBLIGATION = "OBL-J0C-002";
const SIGNING_KEY_ID = "TEST-SIGNING-KEY-1";

interface AuthorizationArtifacts {
  approval_record: DurableApprovalRecord;
  approval_record_hash: string;
  assurance_record: DurableAssuranceRecord;
  assurance_hash: string;
  sealed_pae: SealedPae;
}

function baseAggregate(overrides: Partial<AuthorityAggregate> = {}): AuthorityAggregate {
  return {
    organization_id: ORG,
    obligation_id: OBLIGATION,
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
    reviewed_aggregate_version: 3,
    source_amount: "21.00",
    source_currency: "USD",
    settlement_conversion_rate: null,
    ...overrides,
  };
}

function authorizedFixture() {
  const store = new AuthorityStore();
  store.seed(baseAggregate({ pae_state: "UNUSED", state: "APPROVAL_PENDING", reviewed_aggregate_version: null }));
  sealTestAssessment(store, ORG, OBLIGATION, 3);
  const authorized = approveAndSealPae(store, SIGNING_KEY_ID, {
    organizationId: ORG,
    obligationId: OBLIGATION,
    expectedVersion: 3,
    ...currentAssessmentReview(store, ORG, OBLIGATION),
    actorId: "USR-OPERATOR-001",
    actorRole: "FINANCE_APPROVER",
    policyVersion: "POLICY-P0-1",
    reasonText: "Approved under the deterministic worker test actor authority fixture.",
  });
  const authorization: AuthorizationArtifacts = {
    approval_record: authorized.approvalRecord.record,
    approval_record_hash: authorized.approvalRecord.approval_record_hash,
    assurance_record: authorized.assuranceRecord.record,
    assurance_hash: authorized.assuranceRecord.assurance_hash,
    sealed_pae: authorized.sealed,
  };
  const adapter = new FakeProviderAdapter();
  adapter.queueOutcome("CONFIRMED");
  const clock = { now: () => new Date() };
  const actorAuthority = {
    organization_id: ORG,
    actor_id: "USR-OPERATOR-001",
    actor_role: "FINANCE_APPROVER",
    authority_version: "1",
    status: "ACTIVE" as const,
    permissions: ["T1_SINGLE_APPROVAL"],
    valid_from: "2020-01-01T00:00:00.000Z",
    expires_at: null,
  };
  const worker = (overrides: Record<string, unknown> = {}) => new ExecutionWorker(
    store,
    adapter,
    undefined,
    undefined,
    {
      now: clock.now,
      loadAuthorizationArtifacts: () => authorization,
      resolveActorAuthority: () => actorAuthority,
      ...overrides,
    },
  );
  return { store, sealed: authorized.sealed, authorization, adapter, actorAuthority, worker };
}

describe("ExecutionWorker final authority gates", () => {
  it("blocks an expired PAE at its exact expiry before claim or provider submission, while a future control executes", async () => {
    const expired = authorizedFixture();
    const expiredWorker = expired.worker({ now: () => new Date(expired.sealed.payload.expiry) });

    await expect(expiredWorker.execute(expired.sealed)).rejects.toMatchObject({ code: "EXP-001" });
    expect(expired.store.get(ORG, OBLIGATION).pae_state).toBe("UNUSED");
    expect(expired.store.get(ORG, OBLIGATION).execution_state).toBe("NONE");
    expect(expiredWorker.getExecutionRecord(expired.sealed.payload.idempotency_key)).toBeUndefined();
    expect(expired.adapter.getSubmissionCount()).toBe(0);

    const future = authorizedFixture();
    const futureWorker = future.worker({
      now: () => new Date(Date.parse(future.sealed.payload.expiry) - 1),
    });
    await expect(futureWorker.execute(future.sealed)).resolves.toMatchObject({ status: "SETTLED" });
    expect(future.adapter.getSubmissionCount()).toBe(1);
  });

  it.each(["reservation persistence", "durable context reload"] as const)(
    "rechecks PAE expiry after %s and durably refuses without provider submission",
    async (advanceDuring) => {
      const fixture = authorizedFixture();
      const expiry = Date.parse(fixture.sealed.payload.expiry);
      let currentTime = expiry - 1;
      let durableWrites = 0;
      let persistedAggregate: AuthorityAggregate | undefined;
      const worker = new ExecutionWorker(
        fixture.store,
        fixture.adapter,
        async () => {
          durableWrites += 1;
          if (advanceDuring === "reservation persistence" && durableWrites === 1) currentTime = expiry;
          persistedAggregate = fixture.store.get(ORG, OBLIGATION);
        },
        undefined,
        {
          now: () => new Date(currentTime),
          loadAuthorizationArtifacts: () => fixture.authorization,
          resolveActorAuthority: () => fixture.actorAuthority,
          reloadDurableExecutionContext: async () => {
            if (advanceDuring === "durable context reload") currentTime = expiry;
            return {
              authorization: fixture.authorization,
              aggregate: fixture.store.get(ORG, OBLIGATION),
              trustedKeys: processTrustedKeyRegistry.export(),
              actorAuthorities: [fixture.actorAuthority],
              executionKillSwitched: false,
            };
          },
        },
      );

      await expect(worker.execute(fixture.sealed)).rejects.toMatchObject({ code: "EXP-001" });
      expect(fixture.store.get(ORG, OBLIGATION)).toMatchObject({ pae_state: "REVOKED", execution_state: "BLOCKED" });
      expect(worker.getExecutionRecord(fixture.sealed.payload.idempotency_key)).toMatchObject({ status: "BLOCKED" });
      expect(persistedAggregate).toMatchObject({ pae_state: "REVOKED", execution_state: "BLOCKED" });
      expect(fixture.adapter.getSubmissionCount()).toBe(0);
      expect(durableWrites).toBe(2);
    },
  );

  it.each([
    { scope: "TRANSACTION_DISABLED" as const, target: OBLIGATION },
    { scope: "ORGANIZATION_EXECUTION_DISABLED" as const, target: ORG },
    { scope: "GLOBAL_EXECUTION_DISABLED" as const, target: undefined },
  ])("honors a durable $scope switch activated after reservation without aggregate version change", async ({ scope, target }) => {
    const fixture = authorizedFixture();
    const currentDurableStore = AuthorityStore.fromSnapshot(fixture.store.exportSnapshot());
    const preparedVersion = currentDurableStore.get(ORG, OBLIGATION).aggregate_version;
    currentDurableStore.activateKillSwitch(scope, target);
    expect(currentDurableStore.get(ORG, OBLIGATION).aggregate_version).toBe(preparedVersion);
    const worker = fixture.worker({
      reloadDurableExecutionContext: async () => ({
        authorization: fixture.authorization,
        aggregate: fixture.store.get(ORG, OBLIGATION),
        trustedKeys: processTrustedKeyRegistry.export(),
        actorAuthorities: [fixture.actorAuthority],
        executionKillSwitched: currentDurableStore.isExecutionKillSwitched(ORG, OBLIGATION),
      }),
    });

    await expect(worker.execute(fixture.sealed)).rejects.toMatchObject({ code: "WDG-001" });
    expect(fixture.store.get(ORG, OBLIGATION)).toMatchObject({ pae_state: "REVOKED", execution_state: "BLOCKED" });
    expect(fixture.adapter.getSubmissionCount()).toBe(0);
  });

  it("does not publish a kill-switch refusal when its durable CAS conflicts", async () => {
    const fixture = authorizedFixture();
    const currentDurableStore = AuthorityStore.fromSnapshot(fixture.store.exportSnapshot());
    currentDurableStore.activateKillSwitch("GLOBAL_EXECUTION_DISABLED");
    let writes = 0;
    let durableAuthority = fixture.store.exportSnapshot();
    const conflict = new DemoStateConflictError();
    const worker = new ExecutionWorker(
      fixture.store,
      fixture.adapter,
      async () => {
        writes += 1;
        if (writes === 1) {
          durableAuthority = fixture.store.exportSnapshot();
          return;
        }
        throw conflict;
      },
      undefined,
      {
        loadAuthorizationArtifacts: () => fixture.authorization,
        resolveActorAuthority: () => fixture.actorAuthority,
        reloadDurableExecutionContext: async () => ({
          authorization: fixture.authorization,
          aggregate: fixture.store.get(ORG, OBLIGATION),
          trustedKeys: processTrustedKeyRegistry.export(),
          actorAuthorities: [fixture.actorAuthority],
          executionKillSwitched: currentDurableStore.isExecutionKillSwitched(ORG, OBLIGATION),
        }),
      },
    );

    await expect(worker.execute(fixture.sealed)).rejects.toBe(conflict);
    expect(writes).toBe(2);
    expect(durableAuthority.aggregates[0]).toMatchObject({ pae_state: "RESERVED", execution_state: "SUBMITTING" });
    expect(fixture.store.get(ORG, OBLIGATION)).toMatchObject({ pae_state: "RESERVED", execution_state: "SUBMITTING" });
    expect(worker.getExecutionRecord(fixture.sealed.payload.idempotency_key)).toMatchObject({ status: "SUBMITTING" });
    expect(fixture.adapter.getSubmissionCount()).toBe(0);
  });

  it("blocks approval hash tampering and missing current approval without a claim", async () => {
    const tampered = authorizedFixture();
    const badApproval = {
      ...tampered.authorization,
      approval_record: { ...tampered.authorization.approval_record, actor_id: "USR-ATTACKER-001" },
    };
    await expect(tampered.worker({ loadAuthorizationArtifacts: () => badApproval }).execute(tampered.sealed))
      .rejects.toMatchObject({ code: "AUTH-002" });

    const fieldMismatch = authorizedFixture();
    const rehashedApproval = sealDurableApprovalRecord({
      ...fieldMismatch.authorization.approval_record,
      actor_id: "USR-OTHER-APPROVER",
    });
    const rehashedButUnboundApproval = {
      ...fieldMismatch.authorization,
      approval_record: rehashedApproval.record,
      approval_record_hash: rehashedApproval.approval_record_hash,
    };
    await expect(fieldMismatch.worker({ loadAuthorizationArtifacts: () => rehashedButUnboundApproval }).execute(fieldMismatch.sealed))
      .rejects.toMatchObject({ code: "AUTH-002" });

    const revoked = authorizedFixture();
    await expect(revoked.worker({ loadAuthorizationArtifacts: () => undefined }).execute(revoked.sealed))
      .rejects.toMatchObject({ code: "AUTH-001" });
    expect(revoked.store.get(ORG, OBLIGATION).pae_state).toBe("UNUSED");
    expect(revoked.adapter.getSubmissionCount()).toBe(0);
  });

  it("blocks tampered or non-PASS assurance before reservation", async () => {
    const tampered = authorizedFixture();
    const badAssurance = {
      ...tampered.authorization,
      assurance_record: { ...tampered.authorization.assurance_record, policy_version: "POLICY-OLD" },
    };
    await expect(tampered.worker({ loadAuthorizationArtifacts: () => badAssurance }).execute(tampered.sealed))
      .rejects.toMatchObject({ code: "ASR-001" });

    const held = authorizedFixture();
    const nonPass = {
      ...held.authorization,
      assurance_record: { ...held.authorization.assurance_record, result: "BLOCK" },
      assurance_hash: "0".repeat(64),
    };
    await expect(held.worker({ loadAuthorizationArtifacts: () => nonPass }).execute(held.sealed))
      .rejects.toMatchObject({ code: "ASR-001" });
    expect(held.store.get(ORG, OBLIGATION).pae_state).toBe("UNUSED");
    expect(held.adapter.getSubmissionCount()).toBe(0);
  });

  it.each([
    { status: "SUSPENDED" },
    { status: "REVOKED" },
    { status: "ACTIVE", actor_id: "USR-OTHER-APPROVER" },
    { status: "ACTIVE", permissions: [] },
    { status: "ACTIVE", expires_at: "2000-01-01T00:00:00.000Z" },
    { status: "ACTIVE", valid_from: "2099-01-01T00:00:00.000Z" },
    { status: "ACTIVE", authority_version: "2" },
    { status: "ACTIVE", actor_role: "VIEWER" },
  ])("blocks current approver authority mismatch: %o", async (currentActor) => {
    const fixture = authorizedFixture();
    await expect(fixture.worker({ resolveActorAuthority: () => ({
      organization_id: ORG,
      actor_id: "USR-OPERATOR-001",
      actor_role: "FINANCE_APPROVER",
      authority_version: "1",
      permissions: ["T1_SINGLE_APPROVAL"],
      valid_from: "2020-01-01T00:00:00.000Z",
      expires_at: null,
      ...currentActor,
    }) }).execute(fixture.sealed)).rejects.toMatchObject({ code: "ACT-001" });
    expect(fixture.store.get(ORG, OBLIGATION).pae_state).toBe("UNUSED");
    expect(fixture.adapter.getSubmissionCount()).toBe(0);
  });

  it.each([
    { counterparty_status: "BLOCKED" as const },
    { counterparty_version: 2 },
    { business_hold: true },
    { security_freeze: true },
  ])("blocks current counterparty/status/hold mismatch: %o", async (change) => {
    const fixture = authorizedFixture();
    const current = fixture.store.get(ORG, OBLIGATION);
    fixture.store.seed({ ...current, ...change });
    await expect(fixture.worker().execute(fixture.sealed)).rejects.toBeInstanceOf(ExecutionBlockedError);
    expect(fixture.store.get(ORG, OBLIGATION).pae_state).toBe("UNUSED");
    expect(fixture.adapter.getSubmissionCount()).toBe(0);
  });

  it("rechecks actor authority immediately before provider submission", async () => {
    const fixture = authorizedFixture();
    const actorResolver = vi.fn()
      .mockReturnValueOnce({
        organization_id: ORG,
        actor_id: "USR-OPERATOR-001",
        actor_role: "FINANCE_APPROVER",
        authority_version: "1",
        permissions: ["T1_SINGLE_APPROVAL"],
        valid_from: "2020-01-01T00:00:00.000Z",
        expires_at: null,
        status: "ACTIVE",
      })
      .mockReturnValueOnce({
        organization_id: ORG,
        actor_id: "USR-OPERATOR-001",
        actor_role: "FINANCE_APPROVER",
        authority_version: "1",
        permissions: ["T1_SINGLE_APPROVAL"],
        valid_from: "2020-01-01T00:00:00.000Z",
        expires_at: null,
        status: "REVOKED",
      });
    const worker = fixture.worker({ resolveActorAuthority: actorResolver });

    await expect(worker.execute(fixture.sealed)).rejects.toMatchObject({ code: "ACT-001" });
    expect(actorResolver).toHaveBeenCalledTimes(2);
    expect(fixture.store.get(ORG, OBLIGATION)).toMatchObject({ pae_state: "REVOKED", execution_state: "BLOCKED" });
    expect(fixture.adapter.getSubmissionCount()).toBe(0);
  });

  it.each([
    { authority_version: "2" },
    { actor_role: "VIEWER" },
    { permissions: [] },
    { status: "SUSPENDED" as const },
    { status: "REVOKED" as const },
    { expires_at: "2000-01-01T00:00:00.000Z" },
    { organization_id: "ORG-OTHER" },
  ])("blocks final durable actor authority change after in-memory precheck: %o", async (change) => {
    const fixture = authorizedFixture();
    const worker = fixture.worker({
      reloadDurableExecutionContext: async () => ({
        authorization: fixture.authorization,
        aggregate: fixture.store.get(ORG, OBLIGATION),
        trustedKeys: processTrustedKeyRegistry.export(),
        actorAuthorities: [{ ...fixture.actorAuthority, ...change }],
        executionKillSwitched: false,
      }),
    });

    await expect(worker.execute(fixture.sealed)).rejects.toMatchObject({ code: "ACT-001" });
    expect(fixture.store.get(ORG, OBLIGATION)).toMatchObject({ pae_state: "REVOKED", execution_state: "BLOCKED" });
    expect(fixture.adapter.getSubmissionCount()).toBe(0);
  });

  it("reloads persisted approval and aggregate authority after reservation and before provider submission", async () => {
    const fixture = authorizedFixture();
    const worker = fixture.worker({
      reloadDurableExecutionContext: async () => ({
        authorization: null,
        aggregate: fixture.store.get(ORG, OBLIGATION),
        trustedKeys: processTrustedKeyRegistry.export(),
        actorAuthorities: [fixture.actorAuthority],
        executionKillSwitched: false,
      }),
    });

    await expect(worker.execute(fixture.sealed)).rejects.toMatchObject({ code: "AUTH-001" });
    expect(fixture.store.get(ORG, OBLIGATION)).toMatchObject({ pae_state: "REVOKED", execution_state: "BLOCKED" });
    expect(fixture.adapter.getSubmissionCount()).toBe(0);
  });

  it("rejects a signer revoked in the latest durable namespace snapshot before submission", async () => {
    const fixture = authorizedFixture();
    const revokedKeys = processTrustedKeyRegistry.export().map((entry) => ({ ...entry, status: "REVOKED" as const }));
    const worker = fixture.worker({
      reloadDurableExecutionContext: async () => ({
        authorization: fixture.authorization,
        aggregate: fixture.store.get(ORG, OBLIGATION),
        trustedKeys: revokedKeys,
        actorAuthorities: [fixture.actorAuthority],
        executionKillSwitched: false,
      }),
    });

    await expect(worker.execute(fixture.sealed)).rejects.toMatchObject({ code: "PAE-015" });
    expect(fixture.store.get(ORG, OBLIGATION)).toMatchObject({ pae_state: "REVOKED", execution_state: "BLOCKED" });
    expect(fixture.adapter.getSubmissionCount()).toBe(0);
  });

  it("fails closed with a concrete source error when current actor authority is not configured", async () => {
    const fixture = authorizedFixture();
    await expect(fixture.worker({ resolveActorAuthority: undefined }).execute(fixture.sealed))
      .rejects.toMatchObject({ code: "ACT-002", message: expect.stringContaining("actor authority source") });
    expect(fixture.store.get(ORG, OBLIGATION).pae_state).toBe("UNUSED");
    expect(fixture.adapter.getSubmissionCount()).toBe(0);
  });
});
