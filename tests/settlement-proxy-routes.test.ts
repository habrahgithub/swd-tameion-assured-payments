import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDemoState: vi.fn() }));
vi.mock("../src/server/demo-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/demo-state")>();
  return { ...actual, getDemoState: mocks.getDemoState };
});

import { POST as approve } from "../app/api/obligations/[id]/approve/route";
import { POST as execute } from "../app/api/obligations/[id]/execute/route";
import { GET as listObligations } from "../app/api/obligations/route";
import { DEMO_ORGANIZATION_ID, DemoState } from "../src/server/demo-state";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import {
  ArcCircleProviderAdapter,
  type J2aCircleClient,
} from "../src/execution/provider-adapter";
import {
  J2A_DEMO_DESTINATION,
  J2A_DEMO_SOURCE,
  J2A_DEMO_WALLET_SET_ID,
  runJ2aReadOnlyPreflight,
} from "../src/demo/real-testnet-payment";
import { currentAssessmentReview, sealTestAssessment } from "./test-support/seal-assessment";

const originalPrimePacketHash = process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256;
const signingKeyId = "SETTLEMENT-PROXY-ROUTE-TEST-KEY";
const exactConfirmation = "SUBMIT EXACT TESTNET SETTLEMENT PROXY";

function eligibleSources(state: DemoState) {
  return state.liveUsageRecords
    .filter((record) => Boolean(record.issue_date && record.effective_due_date &&
      record.effective_due_date_basis && record.business_purpose_confirmed && record.source_evidence.length > 0 &&
      record.state_at_event_baseline === "OUTSTANDING"))
    .sort((a, b) => a.effective_due_date!.localeCompare(b.effective_due_date!) || a.obligation_id.localeCompare(b.obligation_id));
}

function circleClient(): J2aCircleClient {
  return {
    getWallet: vi.fn(async ({ id }) => ({ data: { wallet: {
      id,
      address: id === J2A_DEMO_SOURCE.id ? J2A_DEMO_SOURCE.address : J2A_DEMO_DESTINATION.address,
      blockchain: "ARC-TESTNET",
      walletSetId: J2A_DEMO_WALLET_SET_ID,
      state: "LIVE",
    } } })),
    getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
      amount: "10000.000000",
      token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: true },
    }] } })),
    estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.001000" } } })),
    listTransactions: vi.fn(async () => ({ data: { transactions: [] } })),
    getTransaction: vi.fn(async () => ({ data: { transaction: undefined } })),
    createTransaction: vi.fn(async () => ({ data: { id: "mock-circle-transaction" } })),
  };
}

async function preparedState(selectedIndex = 0) {
  const api = circleClient();
  let state: DemoState;
  const provider = new ArcCircleProviderAdapter(api, (key) => state?.getSettlementProxyByIdempotencyKey(key)?.preflight ?? null);
  state = new DemoState(undefined, undefined, undefined, provider);
  const records = eligibleSources(state);
  const selected = selectedIndex < 0 ? records.at(selectedIndex) : records[selectedIndex];
  if (!selected) throw new Error("Frozen genuine set has too few complete USD sources for this route proof.");

  for (const record of state.liveUsageRecords) {
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, record.obligation_id, 1, {
      decision: record.obligation_id === selected.obligation_id ? "PAY" : "HOLD",
      provider_mode: "LIVE_AI",
    });
  }
  const preflight = await runJ2aReadOnlyPreflight(api, () => new Date("2026-10-06T18:00:00.000Z"), state.createSettlementProxyIntent(selected.obligation_id));
  if (preflight.readiness !== "READY") throw new Error("Mocked Arc preflight should be READY.");
  state.bindSettlementProxy(preflight, state.store.get(DEMO_ORGANIZATION_ID, selected.obligation_id).aggregate_version);
  return { state, api, selectedId: selected.obligation_id, records };
}

function reassess(state: DemoState, obligationId: string, overrides: Parameters<typeof sealTestAssessment>[4] = {}) {
  const aggregate = state.store.get(DEMO_ORGANIZATION_ID, obligationId);
  return sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, obligationId, aggregate.aggregate_version, {
    provider_mode: "LIVE_AI",
    decision: "PAY",
    ...overrides,
  });
}

function approvalRequest(state: DemoState, obligationId: string, review = currentAssessmentReview(state.store, DEMO_ORGANIZATION_ID, obligationId)) {
  return new Request(`http://localhost/api/obligations/${obligationId}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expected_version: state.store.get(DEMO_ORGANIZATION_ID, obligationId).aggregate_version,
      reviewed_assessment_id: review.reviewedAssessmentId,
      reviewed_assessment_hash: review.reviewedAssessmentHash,
    }),
  });
}

function sealAuthorization(state: DemoState, selectedId: string, now?: () => Date) {
  reassess(state, selectedId);
  const aggregate = state.store.get(DEMO_ORGANIZATION_ID, selectedId);
  const review = currentAssessmentReview(state.store, DEMO_ORGANIZATION_ID, selectedId);
  const result = approveAndSealPae(state.store, signingKeyId, {
    organizationId: DEMO_ORGANIZATION_ID,
    obligationId: selectedId,
    expectedVersion: aggregate.aggregate_version,
    ...review,
    actorId: "USR-ROUTE-TEST",
    actorRole: "FINANCE_APPROVER",
    policyVersion: aggregate.policy_version,
    reasonText: "Mock route test for the exact Arc proxy identity.",
    ...(now ? { now } : {}),
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

async function authorizedState(selectedIndex = 0) {
  const fixture = await preparedState(selectedIndex);
  const { state, selectedId } = fixture;
  sealAuthorization(state, selectedId);
  const packet = (await import("../src/server/settlement-proxy-packet")).getCurrentSettlementProxyPacket(state, selectedId);
  if (!packet) throw new Error("Mock approval did not produce a current exact packet.");
  return { ...fixture, packet };
}

async function expiredAuthorizedState() {
  const fixture = await preparedState();
  sealAuthorization(fixture.state, fixture.selectedId, () => new Date("2000-01-01T00:00:00.000Z"));
  return fixture;
}

function executeRequest(obligationId: string, packet: { packet_sha256: string }, instructionHash: string, version: number, confirmation = exactConfirmation) {
  return new Request(`http://localhost/api/obligations/${obligationId}/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      expected_version: version,
      packet_sha256: packet.packet_sha256,
      pae_instruction_hash: instructionHash,
      confirmation,
    }),
  });
}

function setPrimeHash(value: string) {
  process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 = value;
}

afterEach(() => {
  mocks.getDemoState.mockReset();
  if (originalPrimePacketHash === undefined) delete process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256;
  else process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 = originalPrimePacketHash;
});

describe("selected genuine Arc proxy route enforcement", () => {
  it("rejects authorization after proxy preparation when the current assessment is stale", async () => {
    const { state, selectedId } = await preparedState();
    const stale = { reviewedAssessmentId: "stale-review", reviewedAssessmentHash: "a".repeat(64) };
    mocks.getDemoState.mockResolvedValue(state);

    const response = await approve(approvalRequest(state, selectedId, stale), { params: Promise.resolve({ id: selectedId }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/current LIVE_AI PAY assessment/i);
    expect(state.getSealedPae(selectedId)).toBeUndefined();
  });

  it("rejects authorization when the post-binding assessment is not LIVE_AI", async () => {
    const { state, selectedId } = await preparedState();
    reassess(state, selectedId, { provider_mode: "NOT_LIVE_AI" });
    mocks.getDemoState.mockResolvedValue(state);

    const response = await approve(approvalRequest(state, selectedId), { params: Promise.resolve({ id: selectedId }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/current LIVE_AI PAY assessment/i);
    expect(state.getSealedPae(selectedId)).toBeUndefined();
  });

  it("rejects authorization if the unchanged sole-candidate rule has since selected a different PAY winner", async () => {
    const { state, selectedId, records } = await preparedState(-1);
    reassess(state, selectedId);
    const earlierWinner = records[0];
    if (!earlierWinner || earlierWinner.obligation_id === selectedId) throw new Error("Fixture did not provide a distinct earlier-due source.");
    reassess(state, earlierWinner.obligation_id);
    expect(state.getSolePayCandidateId()).toBe(earlierWinner.obligation_id);
    mocks.getDemoState.mockResolvedValue(state);

    const response = await approve(approvalRequest(state, selectedId), { params: Promise.resolve({ id: selectedId }) });

    expect(response.status).toBe(409);
    expect((await response.json()).error).toContain(earlierWinner.obligation_id);
    expect(state.getSealedPae(selectedId)).toBeUndefined();
  });

  it("projects the deterministic winner when five current assessments are PAY", async () => {
    const state = new DemoState();
    const records = eligibleSources(state);
    if (records.length < 5) throw new Error("Frozen source set must retain at least five dated settlement sources for this projection test.");
    for (const record of state.liveUsageRecords) {
      sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, record.obligation_id, 1, {
        provider_mode: "LIVE_AI",
        decision: records.slice(0, 5).some((candidate) => candidate.obligation_id === record.obligation_id) ? "PAY" : "HOLD",
      });
    }
    const winner = records[0]!.obligation_id;
    mocks.getDemoState.mockResolvedValue(state);

    const response = await listObligations();
    const body = await response.json();

    expect(body.obligations.filter((item: { decision: string }) => item.decision === "PAY")).toHaveLength(5);
    expect(body.sole_pay_candidate_id).toBe(winner);

    const api = circleClient();
    const winningPreflight = await runJ2aReadOnlyPreflight(api, () => new Date("2026-10-06T18:00:00.000Z"), state.createSettlementProxyIntent(winner));
    if (winningPreflight.readiness !== "READY") throw new Error("Mock winner preflight should be READY.");
    expect(() => state.bindSettlementProxy(winningPreflight, 1)).not.toThrow();
    reassess(state, winner);
    const nonWinner = records[1]!.obligation_id;
    const nonWinningPreflight = await runJ2aReadOnlyPreflight(api, () => new Date("2026-10-06T18:00:00.000Z"), state.createSettlementProxyIntent(nonWinner));
    if (nonWinningPreflight.readiness !== "READY") throw new Error("Mock nonwinner preflight should reach the existing selection gate.");
    expect(() => state.bindSettlementProxy(nonWinningPreflight, 1)).toThrow(/existing sole-candidate gate selected/i);
  });

  it("requires exact confirmation, request hash, Prime packet hash, and current aggregate version before execute", async () => {
    const { state, selectedId, packet } = await authorizedState();
    const sealed = state.getSealedPae(selectedId)!;
    const version = state.store.get(DEMO_ORGANIZATION_ID, selectedId).aggregate_version;
    mocks.getDemoState.mockResolvedValue(state);
    setPrimeHash(packet.packet_sha256);

    const wrongConfirmation = await execute(executeRequest(selectedId, packet, sealed.instruction_hash, version, "SUBMIT"), { params: Promise.resolve({ id: selectedId }) });
    expect(wrongConfirmation.status).toBe(400);
    const wrongRequestHash = await execute(executeRequest(selectedId, { packet_sha256: "0".repeat(64) }, sealed.instruction_hash, version), { params: Promise.resolve({ id: selectedId }) });
    expect(wrongRequestHash.status).toBe(403);
    setPrimeHash("f".repeat(64));
    const wrongPrimeHash = await execute(executeRequest(selectedId, packet, sealed.instruction_hash, version), { params: Promise.resolve({ id: selectedId }) });
    expect(wrongPrimeHash.status).toBe(403);
    setPrimeHash(packet.packet_sha256);
    const staleVersion = await execute(executeRequest(selectedId, packet, sealed.instruction_hash, version - 1), { params: Promise.resolve({ id: selectedId }) });
    expect(staleVersion.status).toBe(403);
    expect(state.providerAdapter.name).toBe("arc-circle-live");
    expect((state.providerAdapter as ArcCircleProviderAdapter)).toBeTruthy();
  });

  it.each(["expired", "revoked"] as const)("blocks the selected execute route for a %s PAE without provider submission", async (scenario) => {
    const fixture = scenario === "expired" ? await expiredAuthorizedState() : await authorizedState();
    const { state, selectedId, api } = fixture;
    const currentPacket = scenario === "expired" ? null :
      (await import("../src/server/settlement-proxy-packet")).getCurrentSettlementProxyPacket(state, selectedId);
    const sealed = state.getSealedPae(selectedId)!;
    if (scenario === "expired") {
      expect(Date.parse(sealed.payload.expiry)).toBeLessThan(Date.now());
      expect(currentPacket).toBeNull();
    }
    if (scenario !== "expired" && !currentPacket) throw new Error("Expected a current packet for the revoked PAE fixture.");
    const packet = { packet_sha256: currentPacket?.packet_sha256 ?? "0".repeat(64) };
    const version = state.store.get(DEMO_ORGANIZATION_ID, selectedId).aggregate_version;
    if (scenario === "revoked") state.store.applyMaterialChange(DEMO_ORGANIZATION_ID, selectedId, version, { destination_operational_status: "ON_HOLD" });
    mocks.getDemoState.mockResolvedValue(state);
    setPrimeHash(packet.packet_sha256);

    const response = await execute(executeRequest(selectedId, packet, sealed.instruction_hash, version), { params: Promise.resolve({ id: selectedId }) });

    expect(response.status).toBe(403);
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it.each([
    ["SETTLED", 200],
    ["UNKNOWN", 409],
  ] as const)("does not submit again for a prior %s execution", async (status, expectedStatus) => {
    const { state, selectedId, api } = await authorizedState();
    const sealed = state.getSealedPae(selectedId)!;
    state.worker.restoreSnapshot([{
      obligation_id: selectedId,
      idempotency_key: sealed.payload.idempotency_key,
      provider_ref: status === "SETTLED" ? "circle-prior-settlement" : null,
      status,
      atomic_amount: sealed.payload.atomic_amount,
      destination_address: sealed.payload.destination_address,
    }]);
    mocks.getDemoState.mockResolvedValue(state);

    const response = await execute(executeRequest(selectedId, { packet_sha256: "0".repeat(64) }, "0".repeat(64), -1), { params: Promise.resolve({ id: selectedId }) });

    expect(response.status).toBe(expectedStatus);
    expect(api.createTransaction).not.toHaveBeenCalled();
    if (status === "UNKNOWN") expect((await response.json()).error).toMatch(/read-only status reconciliation/i);
  });
});
