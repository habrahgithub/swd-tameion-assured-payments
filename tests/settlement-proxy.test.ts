import { describe, expect, it, vi } from "vitest";

import { DEMO_ORGANIZATION_ID, DemoState, parseDemoStateSnapshot } from "../src/server/demo-state";
import {
  J2A_DEMO_DESTINATION,
  J2A_DEMO_SOURCE,
  J2A_DEMO_WALLET_SET_ID,
  runJ2aReadOnlyPreflight,
  type J2aPreflightClient,
} from "../src/demo/real-testnet-payment";
import { sealTestAssessment } from "./test-support/seal-assessment";

function sourceIntent(state: DemoState, obligationId: string) {
  const record = state.getRecord(obligationId);
  if (!record) throw new Error(`Missing frozen source obligation ${obligationId}`);
  if (!record.issue_date || !record.effective_due_date || !record.effective_due_date_basis) throw new Error("Source has no complete commercial date basis");
  const aggregate = state.store.get(DEMO_ORGANIZATION_ID, obligationId);
  return {
    organization_id: DEMO_ORGANIZATION_ID,
    obligation_id: obligationId,
    source_amount: record.amount,
    source_currency: record.currency,
    settlement_amount: aggregate.amount,
    source_evidence_ids: record.source_evidence.map((item) => item.evidence_id),
    classification: "Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.",
    invoice_reference: record.obligation_id,
    invoice_date: record.issue_date,
    effective_due_date: record.effective_due_date,
    payment_basis: record.effective_due_date_basis,
    particulars: record.commercial_terms,
  };
}

function selectedFrozenSource(state: DemoState) {
  const source = state.liveUsageRecords.find((candidate) => Boolean(
    candidate.issue_date && candidate.effective_due_date && candidate.effective_due_date_basis &&
    candidate.due_date && candidate.business_purpose_confirmed && candidate.source_evidence.length > 0 &&
    candidate.state_at_event_baseline === "OUTSTANDING" && candidate.currency === "USD"
  ));
  if (!source) throw new Error("Frozen genuine source set has no complete USD obligation for the mocked settlement proxy proof.");
  return source.obligation_id;
}

function circleClient(): J2aPreflightClient {
  return {
    getWallet: vi.fn(async ({ id }: { id: string }) => ({ data: { wallet: {
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
    listTransactions: vi.fn(async () => ({ data: { transactions: [] } })),
  };
}

async function proxyPreflight(state: DemoState, obligationId: string) {
  return runJ2aReadOnlyPreflight(circleClient(), () => new Date("2026-10-06T18:00:00.000Z"), sourceIntent(state, obligationId));
}

function assessFrozenSet(state: DemoState, selectedId: string, selectedDecision: "PAY" | "HOLD" = "PAY", mode = "LIVE_AI") {
  for (const record of state.liveUsageRecords) {
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, record.obligation_id, 1, {
      decision: record.obligation_id === selectedId ? selectedDecision : "HOLD",
      provider_mode: mode as "LIVE_AI",
    });
  }
}

describe("genuine obligation Arc Testnet settlement proxy binding", () => {
  it("binds the selected frozen source identity and Circle proxy without changing source truth", async () => {
    const state = new DemoState();
    const obligationId = selectedFrozenSource(state);
    assessFrozenSet(state, obligationId);
    expect(state.getSolePayCandidateId()).toBe(obligationId);
    const sourceBefore = structuredClone(state.getRecord(obligationId));
    const preflight = await proxyPreflight(state, obligationId);
    expect(preflight.readiness).toBe("READY");
    if (preflight.readiness !== "READY") throw new Error("expected ready provider evidence");

    const bound = state.bindSettlementProxy(preflight, 1);
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, obligationId);

    expect(bound).toMatchObject({ preflight: { obligation_id: obligationId }, source_aggregate_version: 1, mapped_aggregate_version: 2 });
    expect(aggregate).toMatchObject({
      organization_id: DEMO_ORGANIZATION_ID,
      obligation_id: obligationId,
      source_amount: sourceBefore?.amount,
      source_currency: sourceBefore?.currency,
      amount: preflight.amount,
      source_wallet_ref: J2A_DEMO_SOURCE.id,
      destination_ref: `ARC-TESTNET-SETTLEMENT-PROXY:${J2A_DEMO_DESTINATION.id}`,
      destination_address: J2A_DEMO_DESTINATION.address,
      evidence_hashes: expect.arrayContaining([preflight.evidence_sha256]),
    });
    expect(state.getRecord(obligationId)).toEqual(sourceBefore);
    expect(state.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, obligationId)).toBeUndefined();
    expect(state.getSettlementProxy(obligationId)?.preflight).toEqual(preflight);
  });

  it.each([
    ["HOLD", "LIVE_AI"],
    ["PAY", "NOT_LIVE_AI"],
  ] as const)("refuses proxy binding without a current LIVE_AI PAY recommendation (%s/%s)", async (decision, mode) => {
    const state = new DemoState();
    const obligationId = selectedFrozenSource(state);
    assessFrozenSet(state, obligationId, decision, mode);
    const preflight = await proxyPreflight(state, obligationId);
    expect(preflight.readiness).toBe("READY");
    if (preflight.readiness !== "READY") throw new Error("expected ready provider evidence");
    expect(() => state.bindSettlementProxy(preflight, 1)).toThrow(/LIVE_AI PAY/);
  });

  it("refuses a preflight bound to a stale aggregate version", async () => {
    const state = new DemoState();
    const obligationId = selectedFrozenSource(state);
    assessFrozenSet(state, obligationId);
    const preflight = await proxyPreflight(state, obligationId);
    expect(preflight.readiness).toBe("READY");
    if (preflight.readiness !== "READY") throw new Error("expected ready provider evidence");
    state.store.applyMaterialChange(DEMO_ORGANIZATION_ID, obligationId, 1, { destination_version: 2 });
    expect(() => state.bindSettlementProxy(preflight, 1)).toThrow(/stale|version/i);
  });

  it("requires every frozen genuine obligation to have a current assessment", async () => {
    const state = new DemoState();
    const obligationId = selectedFrozenSource(state);
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, obligationId, 1, { provider_mode: "LIVE_AI" });
    const preflight = await proxyPreflight(state, obligationId);
    expect(preflight.readiness).toBe("READY");
    if (preflight.readiness !== "READY") throw new Error("expected ready provider evidence");
    expect(() => state.bindSettlementProxy(preflight, 1)).toThrow(/Assess every frozen genuine obligation/);
  });

  it("restores proxy identity and source aggregate binding from the persisted namespace snapshot", async () => {
    const state = new DemoState();
    const obligationId = selectedFrozenSource(state);
    assessFrozenSet(state, obligationId);
    const preflight = await proxyPreflight(state, obligationId);
    expect(preflight.readiness).toBe("READY");
    if (preflight.readiness !== "READY") throw new Error("expected ready provider evidence");
    state.bindSettlementProxy(preflight, 1);

    const restored = new DemoState(parseDemoStateSnapshot(state.exportSnapshot()));
    expect(restored.getSettlementProxy(obligationId)).toEqual(state.getSettlementProxy(obligationId));
    expect(restored.store.get(DEMO_ORGANIZATION_ID, obligationId)).toEqual(state.store.get(DEMO_ORGANIZATION_ID, obligationId));
    expect(restored.getRecord(obligationId)).toEqual(state.getRecord(obligationId));
  });
});
