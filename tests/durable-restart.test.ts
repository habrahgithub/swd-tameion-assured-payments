import { describe, expect, it, vi } from "vitest";

import { DEMO_ORGANIZATION_ID, DEMO_SIGNING_KEY_ID, DemoState } from "../src/server/demo-state";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { currentAssessmentReview, sealTestAssessment } from "./test-support/seal-assessment";
import { FakeProviderAdapter } from "../src/execution/fake-provider-adapter";
import { DemoStateConflictError, type SupabaseDemoStateRepository } from "../src/server/supabase-demo-state-repository";

function assessEveryObligation(state: DemoState): void {
  for (const obligation of state.listObligations()) {
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, obligation.obligation_id);
    // This suite exercises persistence mechanics using an explicit trusted
    // test fixture; ordinary DemoState seeds remain simulated and fail closed.
    state.store.seed({
      ...aggregate,
      destination_ref: `DEST-${obligation.obligation_id}-TEST-EVIDENCED`,
      source_wallet_ref: "WALLET-SOURCE-TEST-EVIDENCED",
      product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
    });
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, obligation.obligation_id, aggregate.aggregate_version);
  }
}

function authorize(state: DemoState, obligationId: string) {
  const approver = state.resolveDesignatedApprover(DEMO_ORGANIZATION_ID);
  const result = approveAndSealPae(state.store, DEMO_SIGNING_KEY_ID, {
    organizationId: DEMO_ORGANIZATION_ID,
    obligationId,
    expectedVersion: state.store.get(DEMO_ORGANIZATION_ID, obligationId).aggregate_version,
    ...currentAssessmentReview(state.store, DEMO_ORGANIZATION_ID, obligationId),
    actorId: approver.actor_id,
    actorRole: approver.actor_role,
    authorityVersion: approver.authority_version,
    policyVersion: "POLICY-P0-1",
    reasonText: "Reviewed in durability restart test.",
  }, state.trustedKeys);
  state.recordAuthorization({
    approval_record: result.approvalRecord.record,
    approval_record_hash: result.approvalRecord.approval_record_hash,
    assurance_record: result.assuranceRecord.record,
    assurance_hash: result.assuranceRecord.assurance_hash,
    sealed_pae: result.sealed,
  });
  return result.sealed;
}

describe("durable demo-state restart boundaries", () => {
  it("seeds the designated P0 approver once and never reactivates altered authority on restart", () => {
    const initial = new DemoState().exportSnapshot() as ReturnType<DemoState["exportSnapshot"]> & {
      actor_authorities: Array<Record<string, unknown>>;
    };
    expect(initial.actor_authorities).toHaveLength(1);
    expect(initial.actor_authorities[0]).toMatchObject({
      organization_id: DEMO_ORGANIZATION_ID,
      actor_id: "USR-DEMO-OPERATOR",
      actor_role: "FINANCE_APPROVER",
      permissions: ["T1_SINGLE_APPROVAL"],
      authority_version: "1",
      status: "ACTIVE",
      expires_at: null,
    });

    const suspendedSnapshot = {
      ...initial,
      actor_authorities: initial.actor_authorities.map((authority) => ({
        ...authority,
        authority_version: "2",
        status: "SUSPENDED" as const,
      })),
    };
    const coldRestart = new DemoState(suspendedSnapshot).exportSnapshot() as typeof initial;
    expect(coldRestart.actor_authorities[0]).toMatchObject({
      actor_id: "USR-DEMO-OPERATOR",
      authority_version: "2",
      status: "SUSPENDED",
    });

    const legacySnapshot = { ...initial } as Record<string, unknown>;
    delete legacySnapshot.actor_authorities;
    const legacyRestore = new DemoState(legacySnapshot as never).exportSnapshot() as typeof initial;
    expect(legacyRestore.actor_authorities).toEqual([]);
  });

  it("persists a one-time legacy namespace bootstrap and restores the actor record cold", async () => {
    const rawLegacySnapshot = new DemoState().exportSnapshot() as unknown as Record<string, unknown>;
    delete rawLegacySnapshot.actor_authorities;
    delete rawLegacySnapshot.actor_authority_registry_initialized;
    const legacyState = new DemoState(rawLegacySnapshot as never);
    let persisted: Record<string, unknown> | undefined;
    const repository = {
      compareAndSet: vi.fn(async (_namespace: string, expected: number, next: Record<string, unknown>) => {
        persisted = structuredClone(next);
        return expected + 1;
      }),
    } as unknown as SupabaseDemoStateRepository;
    legacyState.attachRepository(repository, "actor-bootstrap", 1);

    expect(legacyState.actorAuthorities.export()).toEqual([]);
    expect(legacyState.bootstrapP0ApproverIfUninitialized()).toBe(true);
    await legacyState.flush();

    const coldRestore = new DemoState(persisted as never);
    expect(coldRestore.actorAuthorities.resolveDesignatedApprover(DEMO_ORGANIZATION_ID)).toMatchObject({
      actor_id: "USR-DEMO-OPERATOR",
      authority_version: "1",
      status: "ACTIVE",
      permissions: ["T1_SINGLE_APPROVAL"],
    });
    expect(coldRestore.bootstrapP0ApproverIfUninitialized()).toBe(false);
    expect(repository.compareAndSet).toHaveBeenCalledTimes(1);
  });

  it("does not retroactively validate a pre-registry PAE during the legacy bootstrap", async () => {
    const preRegistry = new DemoState();
    assessEveryObligation(preRegistry);
    const obligationId = preRegistry.listObligations()[0]!.obligation_id;
    const sealed = authorize(preRegistry, obligationId);
    const rawLegacySnapshot = preRegistry.exportSnapshot() as unknown as Record<string, unknown>;
    delete rawLegacySnapshot.actor_authorities;
    delete rawLegacySnapshot.actor_authority_registry_initialized;
    const legacyState = new DemoState(rawLegacySnapshot as never);
    let persisted: Record<string, unknown> | undefined;
    const repository = {
      compareAndSet: vi.fn(async (_namespace: string, expected: number, next: Record<string, unknown>) => {
        persisted = structuredClone(next);
        return expected + 1;
      }),
    } as unknown as SupabaseDemoStateRepository;
    legacyState.attachRepository(repository, "legacy-approval-authority", 1);

    const approvedAt = Date.parse(sealed.payload.approval_evidence[0]!.approved_at);
    expect(legacyState.bootstrapP0ApproverIfUninitialized(new Date(approvedAt + 1))).toBe(true);
    await legacyState.flush();
    const coldRestart = new DemoState(persisted as never);

    await expect(coldRestart.worker.execute(sealed)).rejects.toMatchObject({ code: "ACT-001" });
    expect(coldRestart.store.get(DEMO_ORGANIZATION_ID, obligationId).pae_state).toBe("UNUSED");
    expect((coldRestart.adapter as FakeProviderAdapter).getSubmissionCount()).toBe(0);
  });

  it.each([
    { name: "revoked", authority_version: "1", status: "REVOKED" as const, permissions: ["T1_SINGLE_APPROVAL"] },
    { name: "version-changed", authority_version: "2", status: "ACTIVE" as const, permissions: ["T1_SINGLE_APPROVAL"] },
    { name: "permission-removed", authority_version: "2", status: "ACTIVE" as const, permissions: [] },
  ])("preserves $name actor authority through repeated cold bootstrap", ({ authority_version, status, permissions }) => {
    const active = new DemoState().exportSnapshot();
    const changed = {
      ...active,
      actor_authorities: active.actor_authorities.map((authority) => ({
        ...authority,
        authority_version,
        status,
        permissions,
      })),
    };
    const firstRestart = new DemoState(changed).exportSnapshot();
    const secondRestart = new DemoState(firstRestart).exportSnapshot();

    expect(secondRestart.actor_authorities[0]).toMatchObject({ authority_version, status, permissions });
    expect(secondRestart.actor_authority_registry_initialized).toBe(true);
  });

  it("rejects stale active registry restore after a local approver revocation", () => {
    const state = new DemoState();
    const active = state.actorAuthorities.export();
    state.actorAuthorities.restore(active.map((record) => ({ ...record, authority_version: "2", status: "REVOKED" as const })));

    expect(() => state.actorAuthorities.restore(active)).toThrow(/cannot roll back, reactivate/i);
    expect(state.actorAuthorities.export()[0]).toMatchObject({ authority_version: "2", status: "REVOKED" });
  });

  it("rejects a stale ACTIVE worker at J2A pre-submit CAS after durable revocation wins", async () => {
    const firstProcess = new DemoState();
    assessEveryObligation(firstProcess);
    const obligationId = firstProcess.listObligations()[0]!.obligation_id;
    const sealed = authorize(firstProcess, obligationId);
    const activeSnapshot = firstProcess.exportSnapshot();
    let revision = 1;
    let durableSnapshot: Record<string, unknown> = activeSnapshot as unknown as Record<string, unknown>;
    const compareAndSet = vi.fn(async (_namespace: string, expected: number, next: Record<string, unknown>) => {
      if (expected !== revision) throw new DemoStateConflictError();
      revision += 1;
      durableSnapshot = next;
      return revision;
    });
    const repository = { compareAndSet } as unknown as SupabaseDemoStateRepository;
    const provider = new FakeProviderAdapter();
    provider.queueOutcome("CONFIRMED");
    const submit = vi.spyOn(provider, "submitTransfer");
    const staleExecution = new DemoState(activeSnapshot, repository, 1, provider);
    const revoker = new DemoState(activeSnapshot, repository, 1);
    staleExecution.attachRepository(repository, "j2a-shared", 1);
    revoker.attachRepository(repository, "j2a-shared", 1);

    await revoker.revokeTrustedKey(DEMO_SIGNING_KEY_ID);
    expect(revision).toBe(2);
    expect((durableSnapshot.trusted_keys as Array<{ status: string }>)[0]?.status).toBe("REVOKED");
    await expect(staleExecution.worker.execute(sealed)).rejects.toBeInstanceOf(DemoStateConflictError);

    expect(submit).not.toHaveBeenCalled();
    expect(revision).toBe(2);
  });

  it("restores active and revoked PAE trust entries across a cold module restart", async () => {
    const firstProcess = new DemoState();
    assessEveryObligation(firstProcess);
    const obligationId = firstProcess.listObligations()[0]!.obligation_id;
    const sealed = authorize(firstProcess, obligationId);
    const activeSnapshot = firstProcess.exportSnapshot();

    expect(activeSnapshot.trusted_keys).toContainEqual(expect.objectContaining({
      signing_key_id: DEMO_SIGNING_KEY_ID,
      signing_algorithm: "Ed25519",
      status: "ACTIVE",
    }));

    vi.resetModules();
    const [{ DemoState: ColdDemoState }, { verifySealedPae: coldVerify }] = await Promise.all([
      import("../src/server/demo-state"),
      import("../src/pae/sign-verify"),
    ]);
    const secondProcess = new ColdDemoState(activeSnapshot);
    expect(() => coldVerify(sealed, secondProcess.trustedKeys)).not.toThrow();

    secondProcess.trustedKeys.revoke(DEMO_SIGNING_KEY_ID);
    const revokedSnapshot = secondProcess.exportSnapshot();
    expect(revokedSnapshot.trusted_keys).toContainEqual(expect.objectContaining({
      signing_key_id: DEMO_SIGNING_KEY_ID,
      status: "REVOKED",
    }));

    vi.resetModules();
    const [{ DemoState: RestartedDemoState }, { verifySealedPae: restartedVerify }] = await Promise.all([
      import("../src/server/demo-state"),
      import("../src/pae/sign-verify"),
    ]);
    const restarted = new RestartedDemoState(revokedSnapshot);
    expect(() => restartedVerify(sealed, restarted.trustedKeys)).toThrow(expect.objectContaining({ code: "PAE-015" }));
  });

  it("preserves assessment state across restart and permits exact-version authorization", () => {
    const firstProcess = new DemoState();
    assessEveryObligation(firstProcess);
    const obligationId = firstProcess.listObligations()[0]!.obligation_id;
    const secondProcess = new DemoState(firstProcess.exportSnapshot());
    expect(secondProcess.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, obligationId)).toBeDefined();
    expect(secondProcess.store.findUnassessedObligation(DEMO_ORGANIZATION_ID)).toBeNull();

    const sealed = authorize(secondProcess, obligationId);
    expect(sealed.payload.signing_key_id).toBe(DEMO_SIGNING_KEY_ID);
    expect(sealed.payload.obligation_ids).toEqual([obligationId]);
    expect(secondProcess.exportSnapshot().authorization_history).toHaveLength(1);
  });

  it("preserves authorization and sealed PAE across restart so execution remains idempotent", async () => {
    const beforeRestart = new DemoState();
    assessEveryObligation(beforeRestart);
    const obligationId = beforeRestart.listObligations()[0]!.obligation_id;
    const sealed = authorize(beforeRestart, obligationId);
    const snapshot = beforeRestart.exportSnapshot();
    const afterRestart = new DemoState(snapshot);

    const result = await afterRestart.worker.execute(sealed);
    expect(result.status).toBe("SETTLED");
    expect((afterRestart.adapter as FakeProviderAdapter).getSubmissionCount()).toBe(1);
    expect(afterRestart.exportSnapshot().authorization_history[0]?.sealed_pae.instruction_hash).toBe(sealed.instruction_hash);
  });

  it("preserves UNKNOWN across restart and reconciles provider truth without resubmitting", async () => {
    const beforeRestart = new DemoState();
    assessEveryObligation(beforeRestart);
    const obligationId = beforeRestart.listObligations()[0]!.obligation_id;
    const sealed = authorize(beforeRestart, obligationId);
    (beforeRestart.adapter as FakeProviderAdapter).queueOutcome("TIMEOUT");
    const snapshotBeforeRestart = beforeRestart.exportSnapshot();
    const reloadedBeforeRestart = new DemoState(snapshotBeforeRestart);
    const unknown = await reloadedBeforeRestart.worker.execute(sealed);
    expect(unknown.status).toBe("UNKNOWN");
    const snapshotAfterUnknown = reloadedBeforeRestart.exportSnapshot();
    const afterRestart = new DemoState(snapshotAfterUnknown);
    (afterRestart.adapter as FakeProviderAdapter).resolvePending(unknown.provider_ref!, "CONFIRMED");

    const reconciled = await afterRestart.worker.reconcilePendingByIdempotencyKey(sealed.payload.idempotency_key, DEMO_ORGANIZATION_ID);
    expect(reconciled.status).toBe("SETTLED");
    expect((afterRestart.adapter as FakeProviderAdapter).getSubmissionCount()).toBe(1);
  });
});
