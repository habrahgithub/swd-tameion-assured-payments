import { describe, expect, it, vi } from "vitest";

const stateMocks = vi.hoisted(() => ({ getDemoState: vi.fn() }));
vi.mock("../src/server/demo-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/demo-state")>();
  return { ...actual, getDemoState: stateMocks.getDemoState };
});

import { DEMO_ORGANIZATION_ID, DemoState, parseDemoStateSnapshot } from "../src/server/demo-state";
import { AuthorityStore } from "../src/authority/aggregate";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { ArcCircleProviderAdapter, type J2aCircleClient } from "../src/execution/provider-adapter";
import { getCurrentSettlementProxyPacket } from "../src/server/settlement-proxy-packet";
import { deriveJ2aCircleRefId, J2A_DEMO_DESTINATION, J2A_DEMO_SOURCE, J2A_DEMO_WALLET_SET_ID, runJ2aReadOnlyPreflight } from "../src/demo/real-testnet-payment";
import { ExecutionBlockedError } from "../src/execution/worker";
import { DemoStateConflictError, type SupabaseDemoStateRepository } from "../src/server/supabase-demo-state-repository";
import { sealTestAssessment, currentAssessmentReview } from "./test-support/seal-assessment";
import { GET as getObligationDetail } from "../app/api/obligations/[id]/route";
import { POST as executeObligation } from "../app/api/obligations/[id]/execute/route";

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

function circleClient(options: { loseCreateResponse?: boolean; pendingStatusReads?: number; reportedDestinationAddress?: string } = {}) {
  let transaction: Record<string, unknown> | null = null;
  let createCount = 0;
  let statusReadCount = 0;
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
    getTransaction: vi.fn(async ({ id }) => {
      if (transaction?.id !== id) return { data: { transaction: undefined } };
      statusReadCount += 1;
      const state = statusReadCount <= (options.pendingStatusReads ?? 0) ? "PENDING" : "COMPLETE";
      return { data: { transaction: {
        ...transaction,
        ...(options.reportedDestinationAddress === undefined ? {} : { destinationAddress: options.reportedDestinationAddress }),
        state,
      } } };
    }),
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

async function authorizedSnapshot(selectedOverride?: string) {
  const state = new DemoState();
  const selectedId = selectedOverride ?? selectCandidate(state);
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

async function proxyPreparedPreauthorizationState(selectedId = "OBL-J0C-003") {
  const state = new DemoState();
  assessEveryFrozenObligation(state, selectedId);
  const preflight = await runJ2aReadOnlyPreflight(
    circleClient().client,
    () => new Date("2026-10-06T18:00:00.000Z"),
    state.createSettlementProxyIntent(selectedId),
  );
  expect(preflight.readiness).toBe("READY");
  if (preflight.readiness !== "READY") throw new Error("mocked Circle preflight did not return READY");
  state.bindSettlementProxy(preflight, 1);
  return { state, selectedId };
}

function restoredWithCircle(snapshot: ReturnType<DemoState["exportSnapshot"]>, provider: ReturnType<typeof circleClient>) {
  let state: DemoState;
  const adapter = new ArcCircleProviderAdapter(provider.client, (key) => state?.getSettlementProxyByIdempotencyKey(key)?.preflight ?? null);
  state = new DemoState(parseDemoStateSnapshot(snapshot), undefined, undefined, adapter);
  return state;
}

describe("selected genuine obligation to Arc Testnet proxy integration", () => {
  it("allows one fresh v2 reservation when REVOKED is only the preauthorization material-change marker", async () => {
    const { state, selectedId } = await proxyPreparedPreauthorizationState();
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, selectedId);
    expect(aggregate).toMatchObject({ aggregate_version: 2, state: "APPROVAL_PENDING", pae_state: "REVOKED" });
    expect(state.getSealedPae(selectedId)).toBeUndefined();
    expect(state.getAuthorizationArtifacts(selectedId)).toBeUndefined();
    expect(state.exportSnapshot().execution_ledger).toEqual([]);
    expect(state.hasLivePaeAuthority(selectedId)).toBe(false);

    const reserved = state.reserveAssessmentOperation("assessment-v2-marker-only", selectedId, 2);
    expect(reserved).toMatchObject({ status: "RESERVED", obligation_id: selectedId, aggregate_version: 2 });
    expect(state.store.get(DEMO_ORGANIZATION_ID, selectedId).pae_state).toBe("REVOKED");
  });

  it("keeps real revoked and expired signed PAE history closed after a later material change", async () => {
    const { snapshot, selectedId } = await authorizedSnapshot("OBL-J0C-003");
    const state = restoredWithCircle(snapshot, circleClient());
    const authorized = state.store.get(DEMO_ORGANIZATION_ID, selectedId);
    state.store.applyMaterialChange(DEMO_ORGANIZATION_ID, selectedId, authorized.aggregate_version, {
      destination_operational_status: "ON_HOLD",
    });
    const revoked = state.store.get(DEMO_ORGANIZATION_ID, selectedId);
    expect(revoked).toMatchObject({ state: "APPROVAL_PENDING", pae_state: "REVOKED" });
    expect(state.getSealedPae(selectedId)).toBeDefined();
    expect(state.getAuthorizationArtifacts(selectedId)).toBeDefined();
    expect(state.hasLivePaeAuthority(selectedId)).toBe(true);
    expect(() => state.reserveAssessmentOperation("assessment-after-real-revocation", selectedId, revoked.aggregate_version))
      .toThrow(/authorization or PAE creation/i);

    state.store.seed({ ...revoked, pae_state: "EXPIRED" });
    expect(state.hasLivePaeAuthority(selectedId)).toBe(true);
    expect(() => state.reserveAssessmentOperation("assessment-after-expiry", selectedId, revoked.aggregate_version))
      .toThrow(/authorization or PAE creation/i);
  });

  it("rejects a persisted authorization history whose required current sealed PAE pointer is missing", async () => {
    const { snapshot, selectedId } = await authorizedSnapshot("OBL-J0C-003");
    const withoutCurrentPaePointer = { ...snapshot, sealed_paes: [] };
    expect(() => parseDemoStateSnapshot(withoutCurrentPaePointer)).toThrow(/missing its current sealed PAE pointer/i);
    expect(snapshot.authorization_history.some((entry) => entry.sealed_pae.payload.obligation_ids[0] === selectedId)).toBe(true);
  });

  it.each(["SUBMITTING", "UNKNOWN", "SETTLED"] as const)(
    "keeps a persisted execution-ledger %s record closed even without a PAE pointer",
    async (status) => {
      const { state: prepared, selectedId } = await proxyPreparedPreauthorizationState();
      const snapshot = prepared.exportSnapshot();
      snapshot.execution_ledger = [{
        obligation_id: selectedId,
        idempotency_key: `execution-${status.toLowerCase()}`,
        provider_ref: status === "SUBMITTING" ? null : "provider-recorded-reference",
        status,
        atomic_amount: "5000000",
        destination_address: "0x1111111111111111111111111111111111111111",
      }];
      const state = new DemoState(parseDemoStateSnapshot(snapshot));
      expect(state.getSealedPae(selectedId)).toBeUndefined();
      expect(state.worker.exportSnapshot()).toHaveLength(1);
      expect(state.hasLivePaeAuthority(selectedId)).toBe(true);
      expect(() => state.reserveAssessmentOperation(`assessment-after-${status.toLowerCase()}`, selectedId, 2))
        .toThrow(/authorization or PAE creation/i);
    },
  );

  it("preserves assessment operation identity, replay, and UNKNOWN closure on the v2 marker-only path", async () => {
    const { state, selectedId } = await proxyPreparedPreauthorizationState();
    const first = state.reserveAssessmentOperation("assessment-v2-marker-only", selectedId, 2);
    expect(state.reserveAssessmentOperation("assessment-v2-marker-only", selectedId, 2)).toEqual(first);
    expect(() => state.reserveAssessmentOperation("assessment-v2-marker-only", "OBL-J0C-001", 1))
      .toThrow(/bound to a different assessment request/i);
    expect(() => state.reserveAssessmentOperation("assessment-v2-wrong-version", selectedId, 1))
      .toThrow(/aggregate changed/i);

    expect(state.markAssessmentUnknown(first.idempotency_key)).toMatchObject({ status: "UNKNOWN" });
    expect(state.reserveAssessmentOperation(first.idempotency_key, selectedId, 2)).toMatchObject({ status: "UNKNOWN" });
    expect(() => state.reserveAssessmentOperation("assessment-v2-no-duplicate", selectedId, 2))
      .toThrow(/another assessment operation is unresolved/i);
    expect(state.store.get(DEMO_ORGANIZATION_ID, selectedId).pae_state).toBe("REVOKED");
  });

  it("completes the mocked selected-003 v2 assessment, separate approval/assurance/PAE, one exact-gated submit, and same-intent read", async () => {
    let state: DemoState;
    const provider = circleClient({ pendingStatusReads: 1 });
    const adapter = new ArcCircleProviderAdapter(provider.client, (key) => state?.getSettlementProxyByIdempotencyKey(key)?.preflight ?? null);
    state = new DemoState(undefined, undefined, undefined, adapter);
    const selectedId = "OBL-J0C-003";
    assessEveryFrozenObligation(state, selectedId);
    const sourceBeforeProxy = structuredClone(state.getRecord(selectedId));
    const preflight = await runJ2aReadOnlyPreflight(provider.client, () => new Date("2026-10-06T18:00:00.000Z"), state.createSettlementProxyIntent(selectedId));
    expect(preflight.readiness).toBe("READY");
    if (preflight.readiness !== "READY") throw new Error("mocked Circle preflight did not return READY");
    state.bindSettlementProxy(preflight, 1);
    const prepared = state.store.get(DEMO_ORGANIZATION_ID, selectedId);
    expect(prepared).toMatchObject({ aggregate_version: 2, state: "APPROVAL_PENDING", pae_state: "REVOKED" });

    const operationKey = "ASSESSMENT-V2-OBL-J0C-003";
    state.reserveAssessmentOperation(operationKey, selectedId, prepared.aggregate_version);
    const fixtureStore = AuthorityStore.fromSnapshot(state.store.exportSnapshot());
    const fixture = sealTestAssessment(fixtureStore, DEMO_ORGANIZATION_ID, selectedId, prepared.aggregate_version, {
      assessment_id: `ASM-${operationKey}`,
      provider_name: "mock-live-ai-test-fixture",
      provider_mode: "LIVE_AI",
    });
    expect(state.checkpointAssessmentResult(operationKey, fixture.record)).toMatchObject({ status: "PROVIDER_RESULT_DURABLE" });
    expect(state.completeAssessmentOperation(operationKey)).toMatchObject({ status: "COMPLETED" });
    expect(state.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, selectedId)?.record).toMatchObject({
      obligation_id: selectedId,
      aggregate_version: "2",
      decision: "PAY",
      provider_mode: "LIVE_AI",
    });
    expect(state.store.get(DEMO_ORGANIZATION_ID, selectedId).pae_state).toBe("REVOKED");
    expect(state.getRecord(selectedId)).toEqual(sourceBeforeProxy);

    const review = currentAssessmentReview(state.store, DEMO_ORGANIZATION_ID, selectedId);
    const approver = state.resolveDesignatedApprover(DEMO_ORGANIZATION_ID);
    const authorized = approveAndSealPae(state.store, SIGNING_KEY_ID, {
      organizationId: DEMO_ORGANIZATION_ID,
      obligationId: selectedId,
      expectedVersion: 2,
      ...review,
      actorId: approver.actor_id,
      actorRole: approver.actor_role,
      authorityVersion: approver.authority_version,
      policyVersion: prepared.policy_version,
      reasonText: "Mocked human approval of the exact testnet proxy; source payable remains outstanding.",
    }, state.trustedKeys);
    state.recordAuthorization({
      approval_record: authorized.approvalRecord.record,
      approval_record_hash: authorized.approvalRecord.approval_record_hash,
      assurance_record: authorized.assuranceRecord.record,
      assurance_hash: authorized.assuranceRecord.assurance_hash,
      sealed_pae: authorized.sealed,
    });
    expect(authorized.safetyKernel.overall).toBe("PASS");
    expect(state.getSealedPae(selectedId)?.payload.approval_evidence[0]?.actor_id).toBe(approver.actor_id);

    const packet = getCurrentSettlementProxyPacket(state, selectedId);
    expect(packet).not.toBeNull();
    if (!packet) throw new Error("mocked exact packet was not resolved");
    const previousPacketApproval = process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256;
    vi.stubEnv("J2A_EXECUTION_AUTHORIZED_PACKET_SHA256", packet.packet_sha256);
    stateMocks.getDemoState.mockResolvedValue(state);
    try {
      const executeResponse = await executeObligation(new Request("http://localhost/api/obligations/OBL-J0C-003/execute", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          expected_version: 3,
          packet_sha256: packet.packet_sha256,
          pae_instruction_hash: authorized.sealed.instruction_hash,
          confirmation: "SUBMIT EXACT TESTNET SETTLEMENT PROXY",
        }),
      }), { params: Promise.resolve({ id: selectedId }) });
      expect(executeResponse.status).toBe(202);
      expect(await executeResponse.json()).toMatchObject({
        execution: { status: "UNKNOWN", idempotency_key: authorized.sealed.payload.idempotency_key },
        source_payable_state: "OUTSTANDING",
        execution_authority: "ONE_EXACT_PACKET_PRIME_AUTHORIZED",
      });
      expect(provider.createCount()).toBe(1);
      const detailResponse = await getObligationDetail(new Request(`http://localhost/api/obligations/${selectedId}`), { params: Promise.resolve({ id: selectedId }) });
      const detailBody = await detailResponse.json();
      expect(detailBody.execution).toMatchObject({ status: "SETTLED", obligation_id: selectedId });
      expect(detailBody.aggregate.state).toBe("RECONCILED");
      expect(detailBody.record.state_at_event_baseline).toBe("OUTSTANDING");
      expect(detailBody.execution_gate).toBe("EXECUTION_ALREADY_RECORDED");
      expect(provider.createCount()).toBe(1);
      expect(state.getRecord(selectedId)).toEqual(sourceBeforeProxy);
    } finally {
      vi.unstubAllEnvs();
      if (previousPacketApproval !== undefined) process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 = previousPacketApproval;
      else delete process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256;
      stateMocks.getDemoState.mockReset();
    }
  });

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

  it("reconciles a checksummed same-byte provider destination through a cold replay without another create", async () => {
    const { snapshot, sealed, selectedId } = await authorizedSnapshot();
    const checksummedDestination = "0x591A1002127b1605d9DbB51348787bbE3014b2b9";
    const provider = circleClient({ reportedDestinationAddress: checksummedDestination, pendingStatusReads: 1 });
    const state = restoredWithCircle(snapshot, provider);

    const pending = await state.worker.execute(sealed);
    expect(pending).toMatchObject({ status: "UNKNOWN", destination_address: J2A_DEMO_DESTINATION.address });
    expect(provider.createCount()).toBe(1);

    const coldReload = restoredWithCircle(state.exportSnapshot(), provider);
    const settled = await coldReload.worker.reconcilePendingByIdempotencyKey(sealed.payload.idempotency_key, DEMO_ORGANIZATION_ID);
    expect(settled).toMatchObject({ status: "SETTLED", destination_address: J2A_DEMO_DESTINATION.address });
    expect(settled.provider_evidence).toMatchObject({ status: "CONFIRMED", destination_address: checksummedDestination });
    expect(coldReload.store.get(DEMO_ORGANIZATION_ID, selectedId).state).toBe("RECONCILED");
    expect(provider.createCount()).toBe(1);

    expect(await coldReload.worker.execute(sealed)).toMatchObject({ status: "SETTLED" });
    expect(provider.createCount()).toBe(1);
  });

  it.each([
    "0x591a1002127b1605d9dbb51348787bbe3014b2b8", // wrong address bytes
    "0x591a1002127b1605d9dbb51348787bbe3014b2b", // short
    "0x591a1002127b1605d9dbb51348787bbe3014b2b900", // long
    "0x591a1002127b1605d9dbb51348787bbe3014b2bg", // nonhex
    "591a1002127b1605d9dbb51348787bbe3014b2b9", // missing prefix
    " 0x591a1002127b1605d9dbb51348787bbe3014b2b9", // whitespace
    "0x591a1002127b1605d9DbB51348787bbE3014b2b9", // invalid EIP-55 checksum
  ])("keeps an invalid destination UNKNOWN through cold replay without a second create: %s", async (reportedDestinationAddress) => {
    const { snapshot, sealed, selectedId } = await authorizedSnapshot();
    const provider = circleClient({ reportedDestinationAddress });
    const state = restoredWithCircle(snapshot, provider);

    expect(await state.worker.execute(sealed)).toMatchObject({ status: "UNKNOWN" });
    expect(state.store.get(DEMO_ORGANIZATION_ID, selectedId).execution_state).toBe("UNKNOWN");
    expect(provider.createCount()).toBe(1);

    const coldReload = restoredWithCircle(state.exportSnapshot(), provider);
    expect(await coldReload.worker.reconcilePendingByIdempotencyKey(sealed.payload.idempotency_key, DEMO_ORGANIZATION_ID)).toMatchObject({ status: "UNKNOWN" });
    expect(coldReload.worker.getExecutionRecord(sealed.payload.idempotency_key)?.provider_evidence?.destination_address).toBe(reportedDestinationAddress);
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
