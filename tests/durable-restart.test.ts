import { describe, expect, it, vi } from "vitest";

import { DEMO_ORGANIZATION_ID, DEMO_SIGNING_KEY_ID, DemoState, J2aRealTestnetDemoState } from "../src/server/demo-state";
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
  const result = approveAndSealPae(state.store, DEMO_SIGNING_KEY_ID, {
    organizationId: DEMO_ORGANIZATION_ID,
    obligationId,
    expectedVersion: state.store.get(DEMO_ORGANIZATION_ID, obligationId).aggregate_version,
    ...currentAssessmentReview(state.store, DEMO_ORGANIZATION_ID, obligationId),
    actorId: "USR-TEST-OPERATOR",
    actorRole: "FINANCE_APPROVER",
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
    const staleExecution = new J2aRealTestnetDemoState(activeSnapshot, repository, 1, provider);
    const revoker = new J2aRealTestnetDemoState(activeSnapshot, repository, 1);
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
    const afterRestart = new DemoState(beforeRestart.exportSnapshot());

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
    const unknown = await beforeRestart.worker.execute(sealed);
    expect(unknown.status).toBe("UNKNOWN");
    const afterRestart = new DemoState(beforeRestart.exportSnapshot());
    (afterRestart.adapter as FakeProviderAdapter).resolvePending(unknown.provider_ref!, "CONFIRMED");

    const reconciled = await afterRestart.worker.reconcilePendingByIdempotencyKey(sealed.payload.idempotency_key, DEMO_ORGANIZATION_ID);
    expect(reconciled.status).toBe("SETTLED");
    expect((afterRestart.adapter as FakeProviderAdapter).getSubmissionCount()).toBe(1);
  });
});
