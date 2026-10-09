import { describe, expect, it, vi } from "vitest";

const stateMocks = vi.hoisted(() => ({ getDemoState: vi.fn() }));
vi.mock("../src/server/demo-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/demo-state")>();
  return { ...actual, getDemoState: stateMocks.getDemoState };
});

import { DEMO_ORGANIZATION_ID, DemoState, parseDemoStateSnapshot } from "../src/server/demo-state";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { ArcCircleProviderAdapter, type J2aCircleClient } from "../src/execution/provider-adapter";
import { getCurrentSettlementProxyPacket } from "../src/server/settlement-proxy-packet";
import { deriveJ2aCircleRefId, J2A_DEMO_DESTINATION, J2A_DEMO_SOURCE, J2A_DEMO_WALLET_SET_ID, runJ2aReadOnlyPreflight } from "../src/demo/real-testnet-payment";
import { ExecutionBlockedError } from "../src/execution/worker";
import { DemoStateConflictError, type SupabaseDemoStateRepository } from "../src/server/supabase-demo-state-repository";
import { sealTestAssessment, currentAssessmentReview } from "./test-support/seal-assessment";
import { GET as getObligationDetail } from "../app/api/obligations/[id]/route";

function selectCandidate(state: DemoState): string {
  const record = state.liveUsageRecords.find((candidate) => Boolean(
    candidate.issue_date && candidate.due_date && candidate.effective_due_date &&
    candidate.business_purpose_confirmed && candidate.source_evidence.length > 0 &&
    candidate.state_at_event_baseline === "OUTSTANDING" && candidate.currency === "USD"
  ));
  if (!record) throw new Error("Frozen genuine source set has no fully dated USD obligation fixture for the mocked integration proof.");
  return record.obligation_id;
}
const SIGNING_KEY_ID = "IDENTITY-INTEGRATION-TEST-KEY";

function circleClient(options: { loseCreateResponse?: boolean } = {}) {
  let transaction: Record<string, unknown> | null = null;
  let createCount = 0;
  const client: J2aCircleClient = {
    getWallet: vi.fn(async ({ id }) => ({ data: { wallet: {
      id,
      address: id === J2A_DEMO_SOURCE.id ? J2A_DEMO_SOURCE.address : J2A_DEMO_DESTINATION.address,
      blockchain: "ARC-TESTNET",
      walletSetId: J2A_DEMO_WALLET_SET_ID,
      state: "LIVE",
    } } })),
    getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
      amount: "100.000000",
      token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: true },
    }] } })),
    estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.001000" } } })),
    listTransactions: vi.fn(async () => ({ data: { transactions: transaction ? [transaction] : [] } })),
    getTransaction: vi.fn(async ({ id }) => ({ data: { transaction: transaction?.id === id ? transaction : undefined } })),
    createTransaction: vi.fn(async (input) => {
      createCount += 1;
      transaction = {
        id: "circle-tx-identity-1",
        state: "COMPLETE",
        transactionType: "OUTBOUND",
        blockchain: "ARC-TESTNET",
        walletId: input.walletId,
        sourceAddress: J2A_DEMO_SOURCE.address,
        destinationAddress: input.destinationAddress,
        amounts: input.amount,
        tokenId: input.tokenId,
        refId: input.refId,
        networkFee: "0.001000",
        txHash: `0x${"a".repeat(64)}`,
      };
      if (options.loseCreateResponse && createCount === 1) throw new Error("provider accepted request; response was lost");
      return { data: { id: "circle-tx-identity-1" } };
    }),
  };
  return { client, createCount: () => createCount };
}

function assessEveryFrozenObligation(state: DemoState, selectedId: string, selectedDecision: "PAY" | "HOLD" = "PAY", selectedMode: "LIVE_AI" | "NOT_LIVE_AI" = "LIVE_AI") {
  for (const record of state.liveUsageRecords) {
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, record.obligation_id, state.store.get(DEMO_ORGANIZATION_ID, record.obligation_id).aggregate_version, {
      decision: record.obligation_id === selectedId ? selectedDecision : "HOLD",
      provider_mode: record.obligation_id === selectedId ? selectedMode : "LIVE_AI",
    });
  }
}

async function authorizedSnapshot() {
  const state = new DemoState();
  const selectedId = selectCandidate(state);
  assessEveryFrozenObligation(state, selectedId);
  const source = structuredClone(state.getRecord(selectedId));
  const provider = circleClient();
  const preflight = await runJ2aReadOnlyPreflight(provider.client, () => new Date("2026-10-06T18:00:00.000Z"), state.createSettlementProxyIntent(selectedId));
  expect(preflight.readiness).toBe("READY");
  if (preflight.readiness !== "READY") throw new Error("mocked Circle preflight did not return READY");
  state.bindSettlementProxy(preflight, 1);
  const preparedAggregate = state.store.get(DEMO_ORGANIZATION_ID, selectedId);
  sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, selectedId, preparedAggregate.aggregate_version, { provider_mode: "LIVE_AI" });
  const review = currentAssessmentReview(state.store, DEMO_ORGANIZATION_ID, selectedId);
  const approver = state.resolveDesignatedApprover(DEMO_ORGANIZATION_ID);
  const authorized = approveAndSealPae(state.store, SIGNING_KEY_ID, {
    organizationId: DEMO_ORGANIZATION_ID,
    obligationId: selectedId,
    expectedVersion: preparedAggregate.aggregate_version,
    ...review,
    actorId: approver.actor_id,
    actorRole: approver.actor_role,
    authorityVersion: approver.authority_version,
    policyVersion: preparedAggregate.policy_version,
    reasonText: "Approve exact Arc Testnet proxy for this genuine source obligation; source payable remains outstanding.",
  }, state.trustedKeys);
  state.recordAuthorization({
    approval_record: authorized.approvalRecord.record,
    approval_record_hash: authorized.approvalRecord.approval_record_hash,
    assurance_record: authorized.assuranceRecord.record,
    assurance_hash: authorized.assuranceRecord.assurance_hash,
    sealed_pae: authorized.sealed,
  });
  expect(state.getRecord(selectedId)).toEqual(source);
  return { snapshot: state.exportSnapshot(), sealed: authorized.sealed, provider, selectedId };
}

function restoredWithCircle(snapshot: ReturnType<DemoState["exportSnapshot"]>, provider: ReturnType<typeof circleClient>) {
  let state: DemoState;
  const adapter = new ArcCircleProviderAdapter(provider.client, (key) => state?.getSettlementProxyByIdempotencyKey(key)?.preflight ?? null);
  state = new DemoState(parseDemoStateSnapshot(snapshot), undefined, undefined, adapter);
  return state;
}

describe("selected genuine obligation to Arc Testnet proxy integration", () => {
  it("carries one genuine source identity through current LIVE_AI PAY, human assurance, cold PAE verification, and one provider submission", async () => {
    const { snapshot, sealed, provider, selectedId } = await authorizedSnapshot();
    const state = restoredWithCircle(snapshot, provider);
    const source = state.getRecord(selectedId)!;
    const proxy = state.getSettlementProxy(selectedId)!;
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, selectedId);
    const packet = getCurrentSettlementProxyPacket(state, selectedId);

    expect(state.getRecord(selectedId)?.state_at_event_baseline).toBe("OUTSTANDING");
    expect(proxy.preflight.obligation_id).toBe(source.obligation_id);
    expect(proxy.preflight.source_amount).toBe(source.amount);
    expect(proxy.preflight.source_currency).toBe(source.currency);
    expect(proxy.preflight.amount).toBe(aggregate.amount);
    expect(proxy.preflight.classification).toBe("Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.");
    expect(aggregate.destination_ref).toBe(`ARC-TESTNET-SETTLEMENT-PROXY:${proxy.preflight.destination_wallet.id}`);
    expect(aggregate.destination_ref).not.toBe((source as unknown as Record<string, unknown>).source_destination_reference_token);
    expect(sealed.payload).toMatchObject({
      organization_id: DEMO_ORGANIZATION_ID,
      obligation_ids: [selectedId],
      aggregate_version: String(aggregate.aggregate_version),
      amount: proxy.preflight.amount,
      atomic_amount: (BigInt(proxy.preflight.amount.split(".")[0]!) * 1_000_000n + BigInt(proxy.preflight.amount.split(".")[1]!)).toString(),
      asset: "USDC",
      network: "ARC_TESTNET",
      source_wallet_ref: proxy.preflight.source_wallet.id,
      destination_ref: aggregate.destination_ref,
      destination_address: proxy.preflight.destination_wallet.address,
      idempotency_key: expect.any(String),
      evidence_hashes: expect.arrayContaining([proxy.preflight.evidence_sha256, source!.source_evidence[0]!.content_sha256]),
      approval_evidence: [expect.objectContaining({ assessment_hash: expect.any(String), authorized_aggregate_version: String(aggregate.aggregate_version) })],
      assurance_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(packet?.packet).toMatchObject({
      organization_id: DEMO_ORGANIZATION_ID,
      obligation_id: selectedId,
      source_amount: source.amount,
      source_currency: source.currency,
      settlement_amount: proxy.preflight.amount,
      source_identity_disclosure: "Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.",
    });

    // Construction above restores only persisted public trust; this real verifier
    // proves no authorization/signing cache is needed after cold restoration.
    const execution = await state.worker.execute(sealed);
    expect(execution.status).toBe("SETTLED");
    expect(execution.obligation_id).toBe(selectedId);
    expect(execution.atomic_amount).toBe((BigInt(proxy.preflight.amount.split(".")[0]!) * 1_000_000n + BigInt(proxy.preflight.amount.split(".")[1]!)).toString());
    expect(execution.destination_address).toBe(proxy.preflight.destination_wallet.address);
    expect(provider.createCount()).toBe(1);
    expect(state.getRecord(selectedId)?.state_at_event_baseline).toBe("OUTSTANDING");
    expect(state.store.get(DEMO_ORGANIZATION_ID, selectedId).state).toBe("RECONCILED");
    expect((await state.worker.execute(sealed)).status).toBe("SETTLED");
    expect(provider.createCount()).toBe(1);
  });

  it.each(["expiry", "signer revocation", "PAE revocation", "durable kill switch"] as const)(
    "revalidates Worker authority after deferred Circle preflight when %s races with the read",
    async (race) => {
      const { snapshot, sealed, selectedId } = await authorizedSnapshot();
      const api = circleClient().client;
      let enterPreflight!: () => void;
      const preflightEntered = new Promise<void>((resolve) => { enterPreflight = resolve; });
      let releasePreflight!: () => void;
      const deferred = new Promise<void>((resolve) => { releasePreflight = resolve; });
      const balanceRead = api.getWalletTokenBalance;
      api.getWalletTokenBalance = vi.fn(async (input) => {
        enterPreflight();
        await deferred;
        return balanceRead(input);
      });
      let state: DemoState;
      const adapter = new ArcCircleProviderAdapter(api, (key) => state?.getSettlementProxyByIdempotencyKey(key)?.preflight ?? null);
      let now = new Date(Date.parse(sealed.payload.expiry) - 1);
      state = new DemoState(parseDemoStateSnapshot(snapshot), undefined, undefined, adapter, { now: () => now });

      const executing = state.worker.execute(sealed);
      await preflightEntered;
      if (race === "expiry") now = new Date(sealed.payload.expiry);
      if (race === "signer revocation") state.trustedKeys.revoke(sealed.payload.signing_key_id);
      if (race === "PAE revocation") {
        const current = state.store.get(DEMO_ORGANIZATION_ID, selectedId);
        state.store.applyMaterialChange(DEMO_ORGANIZATION_ID, selectedId, current.aggregate_version, {
          destination_operational_status: "ON_HOLD",
        });
      }
      if (race === "durable kill switch") state.store.activateKillSwitch("GLOBAL_EXECUTION_DISABLED");
      releasePreflight();

      await expect(executing).rejects.toBeInstanceOf(ExecutionBlockedError);
      expect(api.createTransaction).not.toHaveBeenCalled();
      expect(state.worker.getExecutionRecord(sealed.payload.idempotency_key)?.status).toBe("BLOCKED");
      expect(state.store.get(DEMO_ORGANIZATION_ID, selectedId).execution_state).toBe("BLOCKED");
    },
  );

  it("keeps the authorized deferred-preflight positive path and calls Circle create exactly once", async () => {
    const { snapshot, sealed } = await authorizedSnapshot();
    const api = circleClient().client;
    let enterPreflight!: () => void;
    const preflightEntered = new Promise<void>((resolve) => { enterPreflight = resolve; });
    let releasePreflight!: () => void;
    const deferred = new Promise<void>((resolve) => { releasePreflight = resolve; });
    const balanceRead = api.getWalletTokenBalance;
    api.getWalletTokenBalance = vi.fn(async (input) => {
      enterPreflight();
      await deferred;
      return balanceRead(input);
    });
    let state: DemoState;
    const adapter = new ArcCircleProviderAdapter(api, (key) => state?.getSettlementProxyByIdempotencyKey(key)?.preflight ?? null);
    state = new DemoState(parseDemoStateSnapshot(snapshot), undefined, undefined, adapter);

    const executing = state.worker.execute(sealed);
    await preflightEntered;
    releasePreflight();
    await expect(executing).resolves.toMatchObject({ status: "SETTLED", idempotency_key: sealed.payload.idempotency_key });
    expect(api.createTransaction).toHaveBeenCalledTimes(1);
    expect(api.createTransaction).toHaveBeenCalledWith(expect.objectContaining({
      amount: [sealed.payload.amount],
      destinationAddress: sealed.payload.destination_address,
      walletId: sealed.payload.source_wallet_ref,
    }));
  });

  it("blocks proxy preparation unless the manually selected obligation is current LIVE_AI PAY with all assessments present", async () => {
    const state = new DemoState();
    const selectedId = selectCandidate(state);
    assessEveryFrozenObligation(state, selectedId, "HOLD");
    const hold = await runJ2aReadOnlyPreflight(circleClient().client, undefined, state.createSettlementProxyIntent(selectedId));
    expect(hold.readiness).toBe("READY");
    if (hold.readiness === "READY") expect(() => state.bindSettlementProxy(hold, 1)).toThrow(/LIVE_AI PAY/);

    const fallbackState = new DemoState();
    const fallbackSelectedId = selectCandidate(fallbackState);
    assessEveryFrozenObligation(fallbackState, fallbackSelectedId, "PAY", "NOT_LIVE_AI");
    const fallback = await runJ2aReadOnlyPreflight(circleClient().client, undefined, fallbackState.createSettlementProxyIntent(fallbackSelectedId));
    expect(fallback.readiness).toBe("READY");
    if (fallback.readiness === "READY") expect(() => fallbackState.bindSettlementProxy(fallback, 1)).toThrow(/LIVE_AI PAY/);

    const twoPayState = new DemoState();
    const soleCandidate = selectCandidate(twoPayState);
    assessEveryFrozenObligation(twoPayState, soleCandidate);
    const secondPay = twoPayState.getRecord("OBL-J0C-003")!;
    sealTestAssessment(twoPayState.store, DEMO_ORGANIZATION_ID, secondPay.obligation_id, 1, { provider_mode: "LIVE_AI", decision: "PAY" });
    expect(twoPayState.getSolePayCandidateId()).toBe(soleCandidate);
    const twoPayPreflight = await runJ2aReadOnlyPreflight(circleClient().client, undefined, twoPayState.createSettlementProxyIntent(secondPay.obligation_id));
    expect(twoPayPreflight.readiness).toBe("READY");
    if (twoPayPreflight.readiness === "READY") {
      expect(() => twoPayState.bindSettlementProxy(twoPayPreflight, 1)).not.toThrow();
      expect(twoPayState.getSettlementProxy(secondPay.obligation_id)?.preflight.obligation_id).toBe(secondPay.obligation_id);
      expect(twoPayState.getSettlementProxy(soleCandidate)).toBeUndefined();
    }
  });

  it("blocks a destination change before the provider boundary", async () => {
    const { snapshot, sealed, selectedId } = await authorizedSnapshot();
    const provider = circleClient();
    const state = restoredWithCircle(snapshot, provider);
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, selectedId);
    state.store.seed({ ...aggregate, destination_address: "0x0000000000000000000000000000000000000001" });
    await expect(state.worker.execute(sealed)).rejects.toBeInstanceOf(ExecutionBlockedError);
    expect(provider.createCount()).toBe(0);
  });

  it("blocks the old PAE after a normal same-identity material change with PAE-011 and revokes it", async () => {
    const { snapshot, sealed, selectedId } = await authorizedSnapshot();
    const provider = circleClient();
    const state = restoredWithCircle(snapshot, provider);
    const aggregateBeforeChange = state.store.get(DEMO_ORGANIZATION_ID, selectedId);

    state.store.applyMaterialChange(
      DEMO_ORGANIZATION_ID,
      selectedId,
      aggregateBeforeChange.aggregate_version,
      { destination_operational_status: "ON_HOLD" },
    );

    await expect(state.worker.execute(sealed)).rejects.toMatchObject({ code: "PAE-011" });
    const aggregateAfterBlock = state.store.get(DEMO_ORGANIZATION_ID, selectedId);
    expect(aggregateAfterBlock).toMatchObject({ execution_state: "BLOCKED", pae_state: "REVOKED" });
    expect(provider.createCount()).toBe(0);
  });

  it("blocks at the actual durable worker pre-submit CAS when another writer advances currentness", async () => {
    const { snapshot, sealed, selectedId } = await authorizedSnapshot();
    const provider = circleClient();
    const state = restoredWithCircle(snapshot, provider);
    let durableRevision = 1;
    const repository = {
      compareAndSet: vi.fn(async (_namespace: string, expectedRevision: number) => {
        if (expectedRevision !== durableRevision) throw new DemoStateConflictError();
        durableRevision += 1; // model the durable namespace advancing before this worker's pre-submit write
        throw new DemoStateConflictError();
      }),
    } as unknown as SupabaseDemoStateRepository;
    state.attachRepository(repository, "identity-integration-cas", 1);
    await expect(state.worker.execute(sealed)).rejects.toBeInstanceOf(DemoStateConflictError);
    expect(provider.createCount()).toBe(0);
    expect(state.worker.getExecutionRecord(sealed.payload.idempotency_key)?.status).toBe("SUBMITTING");
  });

  it("recovers provider acceptance with a lost response by the same idempotency identity and never submits again", async () => {
    const { snapshot, sealed, selectedId } = await authorizedSnapshot();
    const provider = circleClient({ loseCreateResponse: true });
    const state = restoredWithCircle(snapshot, provider);
    const first = await state.worker.execute(sealed);
    expect(first.status).toBe("UNKNOWN");
    expect(provider.createCount()).toBe(1);
    const persisted = state.exportSnapshot();
    const restarted = restoredWithCircle(persisted, provider);
    const reconciled = await restarted.worker.reconcilePendingByIdempotencyKey(sealed.payload.idempotency_key, DEMO_ORGANIZATION_ID);
    expect(reconciled.status).toBe("SETTLED");
    expect(reconciled.idempotency_key).toBe(sealed.payload.idempotency_key);
    expect(provider.createCount()).toBe(1);
    expect(provider.client.listTransactions).toHaveBeenCalledWith(expect.objectContaining({ walletIds: [J2A_DEMO_SOURCE.id] }));
    expect(deriveJ2aCircleRefId(sealed.payload.idempotency_key)).toBe((provider.client.createTransaction as ReturnType<typeof vi.fn>).mock.calls[0][0].refId);
    expect(restarted.getRecord(selectedId)?.state_at_event_baseline).toBe("OUTSTANDING");
  });

  it("returns one post-reconciliation authority read after GET resolves a persisted UNKNOWN", async () => {
    const { snapshot, sealed, provider, selectedId } = await authorizedSnapshot();
    const acceptingThenLosingResponse = circleClient({ loseCreateResponse: true });
    const state = restoredWithCircle(snapshot, acceptingThenLosingResponse);
    expect((await state.worker.execute(sealed)).status).toBe("UNKNOWN");
    expect(acceptingThenLosingResponse.createCount()).toBe(1);

    stateMocks.getDemoState.mockResolvedValue(state);
    try {
      const response = await getObligationDetail(new Request(`http://localhost/api/obligations/${selectedId}`), {
        params: Promise.resolve({ id: selectedId }),
      });
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.execution).toMatchObject({ status: "SETTLED", idempotency_key: sealed.payload.idempotency_key });
      expect(body.aggregate).toMatchObject({ state: "RECONCILED", execution_state: "SETTLED", pae_state: "CONSUMED" });
      expect(body.truth.tameion_control_truth).toMatchObject({
        aggregate_version: body.aggregate.aggregate_version,
        aggregate_state: "RECONCILED",
        execution_state: "SETTLED",
        pae_state: "CONSUMED",
        pae_sealed: true,
      });
      expect(body.truth.settlement_truth.status).toBe("SETTLED");
      expect(body.record.state_at_event_baseline).toBe("OUTSTANDING");
      expect(body.source_payable_state).toBe("OUTSTANDING");
      expect(body.execution_packet.packet_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(body.execution_gate).toBe("EXECUTION_ALREADY_RECORDED");
      expect(acceptingThenLosingResponse.createCount()).toBe(1);
    } finally {
      stateMocks.getDemoState.mockReset();
    }
  });

  it("does not publish a locally reconciled success when attached durable CAS rejects, then permits a safe read-only follow-up", async () => {
    const { snapshot, sealed, selectedId } = await authorizedSnapshot();
    const acceptingThenLosingResponse = circleClient({ loseCreateResponse: true });
    const staleWriter = restoredWithCircle(snapshot, acceptingThenLosingResponse);
    expect((await staleWriter.worker.execute(sealed)).status).toBe("UNKNOWN");
    expect(acceptingThenLosingResponse.createCount()).toBe(1);

    let durableRevision = 1;
    let durableSnapshot: ReturnType<DemoState["exportSnapshot"]> = staleWriter.exportSnapshot();
    let rejectNextWrite = true;
    const repository = {
      loadOrSeed: vi.fn(async () => ({ revision: durableRevision, snapshot: structuredClone(durableSnapshot) })),
      compareAndSet: vi.fn(async (_namespace: string, expectedRevision: number, nextSnapshot: Record<string, unknown>) => {
        if (rejectNextWrite) {
          rejectNextWrite = false;
          durableRevision += 1; // another writer wins; persisted state still records UNKNOWN
          throw new DemoStateConflictError();
        }
        if (expectedRevision !== durableRevision) throw new DemoStateConflictError();
        durableRevision += 1;
        durableSnapshot = structuredClone(nextSnapshot) as unknown as ReturnType<DemoState["exportSnapshot"]>;
        return durableRevision;
      }),
    } as unknown as SupabaseDemoStateRepository;
    staleWriter.attachRepository(repository, "identity-integration-reconcile-cas", 1);

    const reloadedAuthority = restoredWithCircle(durableSnapshot, acceptingThenLosingResponse);
    reloadedAuthority.attachRepository(repository, "identity-integration-reconcile-cas", 2);
    stateMocks.getDemoState.mockResolvedValueOnce(staleWriter).mockResolvedValue(reloadedAuthority);

    const firstResponse = await getObligationDetail(new Request(`http://localhost/api/obligations/${selectedId}`), {
      params: Promise.resolve({ id: selectedId }),
    });
    expect(firstResponse.status).toBe(409);
    const firstBody = await firstResponse.json();
    expect(firstBody.code).toBe("OPS-002");
    expect(firstBody.provider_observation).toMatchObject({ status: "CONFIRMED", durably_recorded: false });
    expect(firstBody.authoritative_state).toMatchObject({ execution_status: "UNKNOWN", source_payable_state: "OUTSTANDING" });
    expect(firstBody.execution).toBeUndefined();
    expect(firstBody.truth).toBeUndefined();
    expect(acceptingThenLosingResponse.createCount()).toBe(1);

    const followUp = await getObligationDetail(new Request(`http://localhost/api/obligations/${selectedId}`), {
      params: Promise.resolve({ id: selectedId }),
    });
    expect(followUp.status).toBe(200);
    const followUpBody = await followUp.json();
    expect(followUpBody.execution.status).toBe("SETTLED");
    expect(followUpBody.aggregate).toMatchObject({ state: "RECONCILED", execution_state: "SETTLED", pae_state: "CONSUMED" });
    expect(followUpBody.source_payable_state).toBe("OUTSTANDING");
    expect(followUpBody.execution_gate).toBe("EXECUTION_ALREADY_RECORDED");
    expect(acceptingThenLosingResponse.createCount()).toBe(1);
    expect(repository.compareAndSet).toHaveBeenCalledTimes(2);
  });
});
