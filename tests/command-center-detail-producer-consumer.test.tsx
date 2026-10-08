/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";

const stateMocks = vi.hoisted(() => ({ getDemoState: vi.fn() }));
vi.mock("../src/server/demo-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/demo-state")>();
  return { ...actual, getDemoState: stateMocks.getDemoState };
});

import { GET as getObligationDetail } from "../app/api/obligations/[id]/route";
import { GET as getObligationList } from "../app/api/obligations/route";
import { POST as approveObligation } from "../app/api/obligations/[id]/approve/route";
import { POST as postAssessment } from "../app/api/obligations/[id]/assess/route";
import { CommandCenter, useExecutionConfirmation, workflowState } from "../app/command-center";
import { DEMO_ORGANIZATION_ID, DemoState, parseDemoStateSnapshot } from "../src/server/demo-state";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { ArcCircleProviderAdapter, type J2aCircleClient } from "../src/execution/provider-adapter";
import { J2A_DEMO_DESTINATION, J2A_DEMO_SOURCE, J2A_DEMO_WALLET_SET_ID, runJ2aReadOnlyPreflight } from "../src/demo/real-testnet-payment";
import { getCurrentSettlementProxyPacket } from "../src/server/settlement-proxy-packet";
import { projectAssuranceEvidence } from "../src/server/assurance-evidence-projection";
import { sealDurableAssuranceRecord } from "../src/pae/durable-records";
import { sealPae } from "../src/pae/sign-verify";
import { canonicalBytes, sha256Hex } from "../src/pae/canonicalize";
import { currentAssessmentReview, sealTestAssessment } from "./test-support/seal-assessment";

const originalPrimePacketHash = process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256;
const signingKeyId = "SETTLEMENT-PROXY-ROUTE-TEST-KEY";
const exactConfirmation = "SUBMIT EXACT TESTNET SETTLEMENT PROXY";
const fetchMock = vi.fn<typeof fetch>();

function obligationRow(id: string): HTMLButtonElement {
  const row = screen.getByRole("main").querySelector<HTMLButtonElement>(`button[data-obligation-id="${id}"]`);
  if (!row) throw new Error(`Queue row for ${id} was not rendered.`);
  return row;
}

function openStageNavigator() {
  const main = screen.getByRole("main");
  let nav = main.querySelector<HTMLElement>('nav[aria-label="Payment lifecycle navigation"]');
  if (!nav) throw new Error("The guided stage navigator is not available in this state.");
  if (nav.hidden) {
    fireEvent.click(within(main).getByRole("button", { name: "View all stages" }));
    nav = screen.getByRole("main").querySelector<HTMLElement>('nav[aria-label="Payment lifecycle navigation"]');
    if (!nav) throw new Error("The guided stage navigator did not open.");
  }
  return nav;
}

function navigateStage(stage: string) {
  const nav = openStageNavigator();
  const button = nav.querySelector<HTMLButtonElement>(`button[aria-label="${stage}"]`);
  if (!button) throw new Error(`Stage ${stage} is not available in the guided navigator.`);
  fireEvent.click(button);
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

async function preparedAuthorizedState(now?: () => Date) {
  const api = circleClient();
  let state: DemoState;
  const provider = new ArcCircleProviderAdapter(api, (key) => state?.getSettlementProxyByIdempotencyKey(key)?.preflight ?? null);
  state = new DemoState(undefined, undefined, undefined, provider);
  const sources = state.liveUsageRecords
    .filter((record) => Boolean(record.issue_date && record.effective_due_date && record.effective_due_date_basis &&
      record.business_purpose_confirmed && record.source_evidence.length > 0 && record.state_at_event_baseline === "OUTSTANDING"))
    .sort((a, b) => a.effective_due_date!.localeCompare(b.effective_due_date!) || a.obligation_id.localeCompare(b.obligation_id));
  const selected = sources[0];
  if (!selected) throw new Error("Frozen genuine source set has no complete obligation for the mocked route fixture.");

  for (const record of state.liveUsageRecords) {
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, record.obligation_id, 1, {
      decision: record.obligation_id === selected.obligation_id ? "PAY" : "HOLD",
      provider_mode: "LIVE_AI",
    });
  }
  const preflight = await runJ2aReadOnlyPreflight(api, now ?? (() => new Date()), state.createSettlementProxyIntent(selected.obligation_id));
  if (preflight.readiness !== "READY") throw new Error("Mocked provider preflight did not reach READY.");
  state.bindSettlementProxy(preflight, state.store.get(DEMO_ORGANIZATION_ID, selected.obligation_id).aggregate_version);

  const preparedAggregate = state.store.get(DEMO_ORGANIZATION_ID, selected.obligation_id);
  sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, selected.obligation_id, preparedAggregate.aggregate_version, {
    decision: "PAY",
    provider_mode: "LIVE_AI",
  });
  const aggregate = state.store.get(DEMO_ORGANIZATION_ID, selected.obligation_id);
  const review = currentAssessmentReview(state.store, DEMO_ORGANIZATION_ID, selected.obligation_id);
  const approver = state.resolveDesignatedApprover(DEMO_ORGANIZATION_ID, now?.() ?? new Date());
  const approval = approveAndSealPae(state.store, signingKeyId, {
    organizationId: DEMO_ORGANIZATION_ID,
    obligationId: selected.obligation_id,
    expectedVersion: aggregate.aggregate_version,
    ...review,
    actorId: approver.actor_id,
    actorRole: approver.actor_role,
    authorityVersion: approver.authority_version,
    policyVersion: aggregate.policy_version,
    reasonText: "Mocked producer-consumer UI fixture.",
    ...(now ? { now } : {}),
  }, state.trustedKeys);
  state.recordAuthorization({
    approval_record: approval.approvalRecord.record,
    approval_record_hash: approval.approvalRecord.approval_record_hash,
    assurance_record: approval.assuranceRecord.record,
    assurance_hash: approval.assuranceRecord.assurance_hash,
    sealed_pae: approval.sealed,
  });
  return { state, api, selectedId: selected.obligation_id, sealed: approval.sealed };
}

async function proxyPreparedWithoutCurrentAssessment(currentAssessment = false) {
  const api = circleClient();
  let state: DemoState;
  const provider = new ArcCircleProviderAdapter(api, (key) => state?.getSettlementProxyByIdempotencyKey(key)?.preflight ?? null);
  state = new DemoState(undefined, undefined, undefined, provider);
  const sources = state.liveUsageRecords
    .filter((record) => Boolean(record.issue_date && record.effective_due_date && record.effective_due_date_basis &&
      record.business_purpose_confirmed && record.source_evidence.length > 0 && record.state_at_event_baseline === "OUTSTANDING"))
    .sort((a, b) => a.effective_due_date!.localeCompare(b.effective_due_date!) || a.obligation_id.localeCompare(b.obligation_id));
  const selected = sources[0];
  if (!selected) throw new Error("Frozen genuine source set has no complete obligation for the mocked route fixture.");
  for (const record of state.liveUsageRecords) {
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, record.obligation_id, 1, {
      decision: record.obligation_id === selected.obligation_id ? "PAY" : "HOLD",
      provider_mode: "LIVE_AI",
    });
  }
  const preflight = await runJ2aReadOnlyPreflight(api, () => new Date(), state.createSettlementProxyIntent(selected.obligation_id));
  if (preflight.readiness !== "READY") throw new Error("Mocked provider preflight did not reach READY.");
  state.bindSettlementProxy(preflight, state.store.get(DEMO_ORGANIZATION_ID, selected.obligation_id).aggregate_version);
  const current = state.store.get(DEMO_ORGANIZATION_ID, selected.obligation_id);
  if (currentAssessment) {
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, selected.obligation_id, current.aggregate_version, {
      decision: "PAY",
      provider_mode: "LIVE_AI",
    });
  } else {
    state.store.applyMaterialChange(DEMO_ORGANIZATION_ID, selected.obligation_id, current.aggregate_version, {
      counterparty_id: current.counterparty_id,
    });
  }
  return { state, selectedId: selected.obligation_id, api };
}

function livePayAssessedState() {
  const state = new DemoState();
  const sources = state.liveUsageRecords
    .filter((record) => Boolean(record.issue_date && record.effective_due_date && record.effective_due_date_basis &&
      record.business_purpose_confirmed && record.source_evidence.length > 0 && record.state_at_event_baseline === "OUTSTANDING"))
    .sort((a, b) => a.effective_due_date!.localeCompare(b.effective_due_date!) || a.obligation_id.localeCompare(b.obligation_id));
  const selected = sources[0];
  if (!selected) throw new Error("Frozen genuine source set has no complete obligation for the mocked route fixture.");
  for (const record of state.liveUsageRecords) {
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, record.obligation_id, 1, {
      decision: record.obligation_id === selected.obligation_id ? "PAY" : "HOLD",
      provider_mode: "LIVE_AI",
    });
  }
  return { state, selectedId: selected.obligation_id };
}

async function detailJson(state: DemoState, obligationId: string) {
  stateMocks.getDemoState.mockResolvedValue(state);
  const response = await getObligationDetail(
    new Request(`http://localhost/api/obligations/${obligationId}`),
    { params: Promise.resolve({ id: obligationId }) },
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function listJson(state: DemoState) {
  stateMocks.getDemoState.mockResolvedValue(state);
  const response = await getObligationList();
  expect(response.status).toBe(200);
  return response.json();
}

async function assessedProducerState(decision: "PAY" | "HOLD" | "ESCALATE") {
  const state = new DemoState();
  const initialQueue = await listJson(state);
  const selectedId = initialQueue.obligations[0]?.obligation_id;
  if (!selectedId) throw new Error("Frozen source set is empty.");
  for (const record of state.liveUsageRecords) {
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, record.obligation_id);
    if (!aggregate) throw new Error(`No aggregate exists for ${record.obligation_id}.`);
    const isSelected = record.obligation_id === selectedId;
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, record.obligation_id, aggregate.aggregate_version, {
      decision: isSelected ? decision : "HOLD",
      provider_mode: isSelected && decision === "PAY" ? "LIVE_AI" : "NOT_LIVE_AI",
      reasons: [isSelected ? `Persisted ${decision} reason from the assessment fixture.` : "Other obligation assessed for coverage."],
    });
  }
  const queue = await listJson(state);
  const body = await detailJson(state, selectedId);
  if (!body.current_assessment) throw new Error("Detail GET did not return the current assessment.");
  return { state, selectedId, queue, body };
}

function assuranceProjectionInput(
  state: DemoState,
  obligationId: string,
  overrides: Partial<Parameters<typeof projectAssuranceEvidence>[0]> = {},
): Parameters<typeof projectAssuranceEvidence>[0] {
  const aggregate = state.store.get(DEMO_ORGANIZATION_ID, obligationId);
  const sealedPae = state.getSealedPae(obligationId) ?? null;
  const artifacts = state.getAuthorizationArtifacts(obligationId) ?? null;
  return {
    organizationId: DEMO_ORGANIZATION_ID,
    obligationId,
    aggregate,
    executionReleaseAuthority: "TAMEION_PAE_REVERIFY_REQUIRED",
    executionKillSwitched: state.store.isExecutionKillSwitched(DEMO_ORGANIZATION_ID, obligationId),
    execution: sealedPae ? state.worker.getExecutionRecord(sealedPae.payload.idempotency_key) ?? null : null,
    sealedPae,
    authorizationArtifacts: artifacts,
    trustedKeys: state.trustedKeys.export(),
    now: new Date(),
    ...overrides,
  };
}

async function renderProducerJson(body: Record<string, unknown>, additionalBodies: Record<string, unknown>[] = [], queueResponse?: Record<string, unknown>) {
  const bodies = new Map([body, ...additionalBodies].map((entry) => {
    const record = entry.record as { obligation_id: string };
    return [record.obligation_id, entry] as const;
  }));
  const summary = (entry: Record<string, unknown>) => {
    const record = entry.record as { obligation_id: string; amount: string; currency: string };
    const producedSummary = (queueResponse?.obligations as Array<Record<string, unknown>> | undefined)
      ?.find((item) => item.obligation_id === record.obligation_id);
    if (producedSummary) return producedSummary;
    return {
      obligation_id: record.obligation_id,
      service_category: "SOFTWARE_SERVICES",
      amount: record.amount,
      currency: record.currency,
      recurrence: "MONTHLY",
      due_date: "2026-10-10",
      commercial_terms: "Net 30",
      assessed: Boolean((queueResponse?.obligations as Array<Record<string, unknown>> | undefined)?.find((item) => item.obligation_id === record.obligation_id)?.assessed),
      decision: (queueResponse?.obligations as Array<Record<string, unknown>> | undefined)?.find((item) => item.obligation_id === record.obligation_id)?.decision ?? null,
      provider_mode: (queueResponse?.obligations as Array<Record<string, unknown>> | undefined)?.find((item) => item.obligation_id === record.obligation_id)?.provider_mode ?? null,
      aggregate_state: (queueResponse?.obligations as Array<Record<string, unknown>> | undefined)?.find((item) => item.obligation_id === record.obligation_id)?.aggregate_state ?? "APPROVAL_PENDING",
      pae_sealed: Boolean((queueResponse?.obligations as Array<Record<string, unknown>> | undefined)?.find((item) => item.obligation_id === record.obligation_id)?.pae_sealed),
      execution_status: (queueResponse?.obligations as Array<Record<string, unknown>> | undefined)?.find((item) => item.obligation_id === record.obligation_id)?.execution_status ?? null,
    };
  };
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({ accepted: true }), { status: 200 }));
    }
    if (url === "/api/obligations") {
      return Promise.resolve(new Response(JSON.stringify(queueResponse ?? { obligations: [...bodies.values()].map(summary) }), { status: 200 }));
    }
    const obligationId = url.split("/").at(-1) ?? "";
    const responseBody = bodies.get(obligationId);
    return Promise.resolve(new Response(JSON.stringify(responseBody ?? { error: "Unknown fixture identity." }), { status: responseBody ? 200 : 404 }));
  });
  render(<CommandCenter />);
  await screen.findByRole("region", { name: "Genuine obligation workspace" });
  return {
    main: screen.getByRole("main"),
    setDetailBody: (entry: Record<string, unknown>) => bodies.set((entry.record as { obligation_id: string }).obligation_id, entry),
  };
}

describe("real detail GET producer-consumer packet controls", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
    delete process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256;
  });

  afterEach(() => {
    cleanup();
    stateMocks.getDemoState.mockReset();
    vi.useRealTimers();
    if (originalPrimePacketHash === undefined) delete process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256;
    else process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 = originalPrimePacketHash;
  });

  it("consumes the real GET shape for an expired PAE without inventing EXPIRED authority or Prime as next actor", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2000-01-01T00:00:00.000Z"));
    const fixture = await preparedAuthorizedState(() => new Date());
    const currentPacket = getCurrentSettlementProxyPacket(fixture.state, fixture.selectedId);
    expect(currentPacket).toBeTruthy();
    vi.setSystemTime(new Date("2026-10-06T19:00:00.000Z"));
    const body = await detailJson(fixture.state, fixture.selectedId);

    expect(body.truth.tameion_control_truth).toMatchObject({
      pae_state: "UNUSED",
      execution_release_authority: "TAMEION_PAE_REVERIFY_REQUIRED",
    });
    expect(body.truth.tameion_control_truth.pae_state).not.toBe("EXPIRED");
    expect(body.truth.tameion_control_truth.execution_release_authority).not.toBe("EXPIRED");
    expect(body.execution_packet).toBeNull();
    expect(body.execution_gate).toBe("LOCKED_UNTIL_CURRENT_AUTHORIZATION");
    expect(body.execution).toBeNull();
    const { main } = await renderProducerJson(body);
    expect(screen.getByRole("heading", {
      name: "Viewed stage: Obligation. Current lifecycle position: Assurance. Step 1 of 6.",
    })).toBeTruthy();
    expect(openStageNavigator().querySelector('[aria-current="step"]')?.textContent).toContain("Assurance");
    expect((screen.getByRole("button", { name: "Payment" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("current-next-step").textContent).not.toContain("Prime · exact-packet authorization");
    expect(main.querySelectorAll('button[data-primary-action="true"]').length).toBeLessThanOrEqual(1);
    expect(screen.queryByRole("textbox", { name: /Confirm exact testnet intent/ })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("consumes the real GET shape after kill-switch refusal and clear without exposing Submit", async () => {
    const fixture = await preparedAuthorizedState();
    const packet = getCurrentSettlementProxyPacket(fixture.state, fixture.selectedId);
    expect(packet).toBeTruthy();
    process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 = packet!.packet_sha256;
    const validOpenGate = await detailJson(fixture.state, fixture.selectedId);
    expect(validOpenGate.execution_gate).toBe("PRIME_AUTHORIZED_EXACT_PACKET");
    const otherId = fixture.state.liveUsageRecords.find((record) => record.obligation_id !== fixture.selectedId)?.obligation_id;
    if (!otherId) throw new Error("A second frozen obligation is required to exercise selection identity refresh.");
    const otherBody = await detailJson(fixture.state, otherId);
    const { main, setDetailBody } = await renderProducerJson(validOpenGate, [otherBody]);
    navigateStage("Payment");
    fireEvent.change(screen.getByRole("textbox", { name: /Confirm exact testnet intent/ }), { target: { value: exactConfirmation } });
    expect(screen.getByRole("button", { name: "Execute Test Payment" })).toBeTruthy();

    fixture.state.store.activateKillSwitch("TRANSACTION_DISABLED", fixture.selectedId);
    await expect(fixture.state.worker.execute(fixture.sealed)).rejects.toMatchObject({ code: "WDG-001" });
    fixture.state.store.deactivateKillSwitch("TRANSACTION_DISABLED", fixture.selectedId);

    const body = await detailJson(fixture.state, fixture.selectedId);
    setDetailBody(body);
    expect(body.truth.tameion_control_truth).toMatchObject({ pae_state: "REVOKED", execution_release_authority: "BLOCKED" });
    expect(body.execution_packet).toBeTruthy();
    expect(body.execution_gate).toBe("PRIME_AUTHORIZED_EXACT_PACKET");
    expect(body.execution).toBeNull();
    expect(fixture.api.createTransaction).not.toHaveBeenCalled();

    fireEvent.click(obligationRow(otherId));
    await waitFor(() => expect(obligationRow(otherId).getAttribute("aria-current")).toBe("true"));
    fireEvent.click(obligationRow(fixture.selectedId));
    await waitFor(() => expect(obligationRow(fixture.selectedId).getAttribute("aria-current")).toBe("true"));
    navigateStage("Payment");
    const payment = screen.getByRole("region", { name: "Payment status" });
    expect(payment.querySelector("h3")?.textContent).toMatch(/revoked|blocked/i);
    expect(payment.textContent).not.toMatch(/ready for confirmation/i);
    expect(within(payment).queryByRole("button", { name: "Execute Test Payment" })).toBeNull();
    expect(payment.querySelector("h3")?.textContent).toMatch(/payment authority is revoked/i);
    expect(screen.getByRole("region", { name: "Exception recovery" }).textContent).toContain("Unassigned · no permitted product action is available");
    expect(payment.textContent).not.toContain("exact packet gate passed");
    expect(main.querySelector('button[data-primary-action="true"]')).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Confirm exact testnet intent/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execute Test Payment" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps Payment status and actions aligned with producer execution and release truth", async () => {
    const fixture = await preparedAuthorizedState();
    const packet = getCurrentSettlementProxyPacket(fixture.state, fixture.selectedId);
    expect(packet).toBeTruthy();
    process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 = packet!.packet_sha256;
    const ready = await detailJson(fixture.state, fixture.selectedId);
    expect(ready.execution_gate).toBe("PRIME_AUTHORIZED_EXACT_PACKET");
    expect(ready.truth.tameion_control_truth.execution_release_authority).toBe("TAMEION_PAE_REVERIFY_REQUIRED");

    fixture.state.store.activateKillSwitch("TRANSACTION_DISABLED", fixture.selectedId);
    const killSwitched = await detailJson(fixture.state, fixture.selectedId);
    fixture.state.store.deactivateKillSwitch("TRANSACTION_DISABLED", fixture.selectedId);
    expect(killSwitched.execution_kill_switched).toBe(true);

    const makeExecution = (status: string, body: Record<string, any>) => {
      body.execution = {
        status,
        provider_ref: status === "SETTLED" ? "mock-provider-reference" : null,
        idempotency_key: "producer-fixture-idempotency-key",
        atomic_amount: "125000000",
        destination_address: body.settlement_proxy.preflight.destination_wallet.address,
        provider_evidence: null,
      };
      body.aggregate.execution_state = status;
      body.truth.tameion_control_truth.execution_state = status;
    };
    const expired = structuredClone(ready);
    expired.truth.tameion_control_truth.pae_state = "EXPIRED";
    expired.truth.tameion_control_truth.execution_release_authority = "EXPIRED";
    const absentPacket = structuredClone(ready);
    absentPacket.pae_sealed = false;
    absentPacket.execution_packet = null;
    absentPacket.sealed_pae_instruction_hash = null;
    absentPacket.execution_gate = "LOCKED_UNTIL_CURRENT_AUTHORIZATION";
    absentPacket.truth.tameion_control_truth.pae_state = "NOT_CREATED";
    const submitting = structuredClone(ready);
    makeExecution("SUBMITTING", submitting);
    const submitted = structuredClone(ready);
    makeExecution("SUBMITTED", submitted);
    const unknown = structuredClone(ready);
    makeExecution("UNKNOWN", unknown);
    const settled = structuredClone(ready);
    makeExecution("SETTLED", settled);
    const cases = [
      { name: "current exact packet", body: ready, expected: /ready for confirmation/i, execute: true },
      { name: "expired authority despite retained packet", body: expired, expected: /authority is expired/i, execute: false },
      { name: "active kill switch", body: killSwitched, expected: /payment stop is active/i, execute: false },
      { name: "submission in progress", body: submitting, expected: /submission is in progress/i, execute: false },
      { name: "submission recorded", body: submitted, expected: /awaiting reconciliation/i, execute: false },
      { name: "unknown outcome", body: unknown, expected: /outcome unknown.*do not retry or resubmit/i, execute: false },
      { name: "settled testnet execution", body: settled, expected: /real-world payable remains outstanding/i, execute: false },
    ];

    for (const scenario of cases) {
      cleanup();
      fetchMock.mockClear();
      await renderProducerJson(scenario.body);
      navigateStage("Payment");
      const payment = screen.getByRole("region", { name: "Payment status" });
      expect(payment.querySelector("h3")?.textContent, scenario.name).toMatch(scenario.expected);
      expect(payment.textContent, scenario.name).toContain("Testnet proxy destination");
      const executeActions = screen.queryAllByRole("button", { name: "Execute Test Payment" });
      expect(executeActions.length, scenario.name).toBe(scenario.execute ? 1 : 0);
      expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]').length, scenario.name).toBeLessThanOrEqual(1);
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"), scenario.name).toHaveLength(0);
    }

    cleanup();
    fetchMock.mockClear();
    await renderProducerJson(absentPacket);
    openStageNavigator();
    const paymentStage = screen.getByRole("button", { name: /^Payment$/ }) as HTMLButtonElement;
    expect(paymentStage.disabled).toBe(true);
    expect(screen.queryByRole("region", { name: "Payment status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execute Test Payment" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("classifies SETTLED only from stored provider evidence bound to the exact selected instruction", async () => {
    const fixture = await preparedAuthorizedState();
    const packet = getCurrentSettlementProxyPacket(fixture.state, fixture.selectedId);
    expect(packet).toBeTruthy();
    process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 = packet!.packet_sha256;
    const produced = await detailJson(fixture.state, fixture.selectedId);
    const exactPacket = produced.execution_packet.packet;
    const expectedAmount = exactPacket.settlement_amount as string;
    const expectedDecimals = exactPacket.provider_token.decimals as number;
    const expectedAtomic = (() => {
      const [whole, fractional = ""] = expectedAmount.split(".");
      return (BigInt(whole) * 10n ** BigInt(expectedDecimals) + BigInt((fractional + "0".repeat(expectedDecimals)).slice(0, expectedDecimals) || "0")).toString();
    })();
    const expectedDestination = exactPacket.circle_arc_execution_instruction.destination_address as string;
    const expectedInstructionHash = exactPacket.pae.instruction_hash as string;
    const expectedIdempotencyKey = exactPacket.pae.idempotency_key as string;

    const asSettled = (evidence: Record<string, unknown> | null | undefined, evidenceMode: "set" | "omit" = "set") => {
      const body = structuredClone(produced);
      body.aggregate = { ...body.aggregate, state: "RECONCILED", execution_state: "SETTLED", pae_state: "CONSUMED" };
      body.truth.tameion_control_truth = {
        ...body.truth.tameion_control_truth,
        aggregate_state: "RECONCILED",
        execution_state: "SETTLED",
        pae_state: "CONSUMED",
      };
      // Deliberate fixture-only mode label; no live provider was called.
      body.truth.settlement_truth.runtime = "LIVE";
      body.execution_gate = "EXECUTION_ALREADY_RECORDED";
      body.execution = {
        status: "SETTLED",
        provider_ref: "fixture-provider-reference",
        idempotency_key: expectedIdempotencyKey,
        atomic_amount: expectedAtomic,
        destination_address: expectedDestination,
        ...(evidenceMode === "omit" ? {} : { provider_evidence: evidence }),
      };
      return body as any;
    };
    const exactEvidence = {
      status: "CONFIRMED",
      atomic_amount: expectedAtomic,
      destination_address: expectedDestination,
      reconciled_at: "2026-10-08T10:00:00.000Z",
    };
    const cases = [
      { name: "evidence omitted", body: asSettled(undefined, "omit"), expected: "Recorded as SETTLED — reconciliation evidence unavailable", forbidden: /TESTNET EXECUTION RECONCILED|Settlement matches the authorized obligation exactly/i },
      { name: "evidence null", body: asSettled(null), expected: "Recorded as SETTLED — reconciliation evidence unavailable", forbidden: /TESTNET EXECUTION RECONCILED|Settlement matches the authorized obligation exactly/i },
      { name: "evidence incomplete", body: asSettled({ status: "CONFIRMED", atomic_amount: expectedAtomic }), expected: "Recorded as SETTLED — reconciliation evidence unavailable", forbidden: /TESTNET EXECUTION RECONCILED|Settlement matches the authorized obligation exactly/i },
      { name: "provider status contradicts SETTLED", body: asSettled({ ...exactEvidence, status: "PENDING" }), expected: "Reconciliation evidence mismatch — review required", forbidden: /TESTNET EXECUTION RECONCILED|Settlement matches the authorized obligation exactly/i },
      { name: "provider amount contradicts the instruction", body: asSettled({ ...exactEvidence, atomic_amount: "1" }), expected: "Reconciliation evidence mismatch — review required", forbidden: /TESTNET EXECUTION RECONCILED|Settlement matches the authorized obligation exactly/i },
      { name: "provider destination contradicts the instruction", body: asSettled({ ...exactEvidence, destination_address: "0x1111111111111111111111111111111111111111" }), expected: "Reconciliation evidence mismatch — review required", forbidden: /TESTNET EXECUTION RECONCILED|Settlement matches the authorized obligation exactly/i },
      { name: "execution ledger amount contradicts the sealed instruction", body: (() => { const body = asSettled(exactEvidence); body.execution.atomic_amount = "1"; return body; })(), expected: "Reconciliation evidence mismatch — review required", forbidden: /TESTNET EXECUTION RECONCILED|Settlement matches the authorized obligation exactly/i },
      { name: "packet instruction amount contradicts packet settlement amount", body: (() => { const body = asSettled(exactEvidence); body.execution_packet.packet.circle_arc_execution_instruction.amount = "1.000000"; return body; })(), expected: "Reconciliation evidence mismatch — review required", forbidden: /TESTNET EXECUTION RECONCILED|Settlement matches the authorized obligation exactly/i },
      { name: "packet instruction decimals contradict the token", body: (() => { const body = asSettled(exactEvidence); body.execution_packet.packet.circle_arc_execution_instruction.decimals = 8; return body; })(), expected: "Reconciliation evidence mismatch — review required", forbidden: /TESTNET EXECUTION RECONCILED|Settlement matches the authorized obligation exactly/i },
      { name: "confirmed exact instruction", body: asSettled(exactEvidence), expected: "TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION", forbidden: null },
      { name: "simulated ledger record", body: (() => { const body = asSettled(exactEvidence); body.truth.settlement_truth.runtime = "SIMULATED"; return body; })(), expected: "Simulated record — no Arc settlement", forbidden: /TESTNET EXECUTION RECONCILED|Settlement matches the authorized obligation exactly/i },
      { name: "instruction identity cannot be rebound", body: (() => { const body = asSettled(exactEvidence); body.sealed_pae_instruction_hash = "f".repeat(64); return body; })(), expected: "Recorded as SETTLED — reconciliation evidence unavailable", forbidden: /TESTNET EXECUTION RECONCILED|Settlement matches the authorized obligation exactly/i },
    ];

    for (const scenario of cases) {
      cleanup();
      fetchMock.mockClear();
      await renderProducerJson(scenario.body);
      const workflow = workflowState(scenario.body as never);
      if (scenario.forbidden) {
        expect(workflow.label, scenario.name).toBe(scenario.expected);
        expect(workflow.tone, scenario.name).not.toBe("success");
      } else {
        expect(workflow).toMatchObject({ label: "Reconciled", tone: "success" });
      }
      navigateStage("Payment");
      const payment = screen.getByRole("region", { name: "Payment status" });
      expect(payment.textContent, scenario.name).toContain(scenario.expected);
      expect(payment.textContent, scenario.name).toContain("OUTSTANDING");
      expect(screen.queryByRole("button", { name: /Execute Test Payment|Retry payment|Resubmit/i })).toBeNull();
      expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]').length).toBeLessThanOrEqual(1);

      navigateStage("Reconciliation");
      const receipt = screen.getByRole("region", { name: "Reconciliation receipt" });
      expect(receipt.textContent, scenario.name).toContain(scenario.expected);
      expect(receipt.textContent, scenario.name).toContain("Source payable");
      expect(receipt.textContent, scenario.name).toContain("OUTSTANDING · remains outstanding in the source record");
      if (scenario.forbidden) {
        expect(screen.getByRole("main").textContent, scenario.name).not.toMatch(scenario.forbidden);
      } else if (scenario.name === "confirmed exact instruction") {
        expect(receipt.textContent).toContain("Exact amount verificationconfirmed");
        expect(receipt.textContent).toContain("Exact destination verificationconfirmed");
      }

      fireEvent.click(within(receipt).getByText("View reconciliation evidence"));
      expect(receipt.textContent, scenario.name).toContain(scenario.expected);
      expect(receipt.textContent, scenario.name).toContain("Evidence classification");
      fireEvent.click(within(screen.getByRole("main")).getByText("Developer & audit evidence"));
      const mainText = screen.getByRole("main").textContent ?? "";
      expect(mainText, `${scenario.name} developer evidence`).toContain(scenario.expected);
      if (scenario.forbidden) expect(mainText, scenario.name).not.toMatch(scenario.forbidden);
      if (scenario.name.startsWith("evidence ") || scenario.name === "instruction identity cannot be rebound") {
        expect(mainText).toContain("Exact provider amount and destination verification cannot be established from the stored record.");
      }
      fireEvent.click(within(screen.getByRole("main")).getByText("Additional tools"));
      fireEvent.click(within(screen.getByRole("main")).getByRole("button", { name: "Operational Report (secondary)" }));
      const reportText = screen.getByRole("main").textContent ?? "";
      if (scenario.forbidden) expect(reportText, `${scenario.name} report`).not.toMatch(scenario.forbidden);
      else expect(reportText).toContain("TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION");
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"), scenario.name).toHaveLength(0);
    }
  });

  it("normalizes and renders a legacy schema-v1 settled ledger record without inventing reconciliation evidence", async () => {
    const fixture = await preparedAuthorizedState();
    const sealed = fixture.state.getSealedPae(fixture.selectedId)!;
    const aggregate = fixture.state.store.get(DEMO_ORGANIZATION_ID, fixture.selectedId);
    const atomic = sealed.payload.atomic_amount;
    const destination = sealed.payload.destination_address;
    fixture.state.store.markSettled(DEMO_ORGANIZATION_ID, fixture.selectedId);
    fixture.state.store.markReconciled(DEMO_ORGANIZATION_ID, fixture.selectedId);
    const snapshot = fixture.state.exportSnapshot() as any;
    snapshot.schema_version = 1;
    delete snapshot.trusted_keys;
    delete snapshot.actor_authorities;
    delete snapshot.actor_authority_registry_initialized;
    snapshot.execution_ledger = [{
      obligation_id: fixture.selectedId,
      idempotency_key: sealed.payload.idempotency_key,
      provider_ref: null,
      status: "SETTLED",
      atomic_amount: atomic,
      destination_address: destination,
    }];
    const parsed = parseDemoStateSnapshot(snapshot);
    expect(parsed.schema_version).toBe(2);
    const restored = new DemoState(parsed);
    expect(restored.worker.getExecutionRecord(sealed.payload.idempotency_key)?.status).toBe("SETTLED");
    expect(restored.worker.getExecutionRecord(sealed.payload.idempotency_key)?.provider_evidence).toBeUndefined();

    const legacyGet = await detailJson(restored, fixture.selectedId);
    // Controlled read-model truth override: this legacy SETTLED row represents
    // historical Arc execution; no provider call is made by the test.
    legacyGet.truth.settlement_truth.runtime = "LIVE";
    expect(legacyGet.execution?.status).toBe("SETTLED");
    expect(legacyGet.execution?.provider_evidence).toBeUndefined();
    expect(legacyGet.execution_packet).toBeNull();
    const { main } = await renderProducerJson(legacyGet);
    navigateStage("Reconciliation");
    const receipt = screen.getByRole("region", { name: "Reconciliation receipt" });
    expect(receipt.textContent).toContain("Recorded as SETTLED — reconciliation evidence unavailable");
    expect(receipt.textContent).toContain("Exact provider amount and destination verification cannot be established from the stored record.");
    expect(receipt.textContent).toContain("OUTSTANDING · remains outstanding in the source record");
    expect(main.textContent).not.toMatch(/TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION|Settlement matches the authorized obligation exactly/i);
    expect(screen.queryByRole("button", { name: /Execute Test Payment|Retry payment|Resubmit/i })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("locks Payment while a retained pending execution detail is stale", async () => {
    const fixture = await preparedAuthorizedState();
    const packet = getCurrentSettlementProxyPacket(fixture.state, fixture.selectedId);
    expect(packet).toBeTruthy();
    process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 = packet!.packet_sha256;
    const body = await detailJson(fixture.state, fixture.selectedId);
    body.execution = {
      status: "UNKNOWN",
      provider_ref: null,
      idempotency_key: "producer-fixture-idempotency-key",
      atomic_amount: "125000000",
      destination_address: body.settlement_proxy.preflight.destination_wallet.address,
      provider_evidence: null,
    };
    body.aggregate.execution_state = "UNKNOWN";
    body.truth.tameion_control_truth.execution_state = "UNKNOWN";
    await renderProducerJson(body);
    navigateStage("Payment");
    const reconcile = await screen.findByRole("button", { name: /Reconcile this same intent/ });
    let finishRefresh!: (response: Response) => void;
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => { finishRefresh = resolve; }));
    fireEvent.click(reconcile);

    await screen.findByText("Last-known obligation details are stale.");
    expect((screen.getByRole("button", { name: /^Payment$/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("region", { name: "Payment status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execute Test Payment" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    finishRefresh(new Response(JSON.stringify(body), { status: 200 }));
    await waitFor(() => expect(screen.queryByText("Last-known obligation details are stale.")).toBeNull());
  });

  it("clears confirmation across reversible kill-switch and A→B→A selection transitions", async () => {
    const fixture = await preparedAuthorizedState();
    const packet = getCurrentSettlementProxyPacket(fixture.state, fixture.selectedId);
    expect(packet).toBeTruthy();
    process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 = packet!.packet_sha256;
    const openGate = await detailJson(fixture.state, fixture.selectedId);
    const otherId = fixture.state.liveUsageRecords.find((record) => record.obligation_id !== fixture.selectedId)?.obligation_id;
    if (!otherId) throw new Error("A second frozen obligation is required to exercise selection identity refresh.");
    const otherBody = await detailJson(fixture.state, otherId);
    const { setDetailBody } = await renderProducerJson(openGate, [otherBody]);
    navigateStage("Payment");
    const submit = () => screen.getByRole("button", { name: "Execute Test Payment" });
    const confirm = () => screen.getByRole("textbox", { name: /Confirm exact testnet intent/ });

    fireEvent.change(confirm(), { target: { value: exactConfirmation } });
    expect(submit().hasAttribute("disabled")).toBe(false);

    fixture.state.store.activateKillSwitch("TRANSACTION_DISABLED", fixture.selectedId);
    const suspended = await detailJson(fixture.state, fixture.selectedId);
    expect(suspended.execution_kill_switched).toBe(true);
    setDetailBody(suspended);
    fireEvent.click(obligationRow(otherId));
    await waitFor(() => expect(obligationRow(otherId).getAttribute("aria-current")).toBe("true"));
    fireEvent.click(obligationRow(fixture.selectedId));
    await waitFor(() => expect(obligationRow(fixture.selectedId).getAttribute("aria-current")).toBe("true"));
    expect(screen.queryByRole("textbox", { name: /Confirm exact testnet intent/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execute Test Payment" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    fixture.state.store.deactivateKillSwitch("TRANSACTION_DISABLED", fixture.selectedId);
    const recovered = await detailJson(fixture.state, fixture.selectedId);
    expect(recovered.execution_kill_switched).toBe(false);
    expect(recovered.execution_gate).toBe("PRIME_AUTHORIZED_EXACT_PACKET");
    setDetailBody(recovered);
    fireEvent.click(obligationRow(otherId));
    await waitFor(() => expect(obligationRow(otherId).getAttribute("aria-current")).toBe("true"));
    fireEvent.click(obligationRow(fixture.selectedId));
    await waitFor(() => expect(obligationRow(fixture.selectedId).getAttribute("aria-current")).toBe("true"));
    navigateStage("Payment");
    expect(confirm().getAttribute("value")).not.toBe(exactConfirmation);
    expect((confirm() as HTMLInputElement).value).toBe("");
    expect(submit().hasAttribute("disabled")).toBe(true);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    fireEvent.change(confirm(), { target: { value: exactConfirmation } });
    expect(submit().hasAttribute("disabled")).toBe(false);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("binds the exact text to selected obligation and both hashes, clearing invalid and replaced identities", () => {
    const identity = JSON.stringify(["OBL-01", "packet-a", "instruction-a"]);
    const { result, rerender } = renderHook(({ currentIdentity }) => useExecutionConfirmation(currentIdentity), {
      initialProps: { currentIdentity: identity as string | null },
    });

    act(() => result.current.setValue(exactConfirmation));
    expect(result.current.matchesExact).toBe(true);
    rerender({ currentIdentity: identity });
    expect(result.current.value).toBe(exactConfirmation);
    expect(result.current.matchesExact).toBe(true);

    rerender({ currentIdentity: JSON.stringify(["OBL-01", "packet-b", "instruction-a"]) });
    expect(result.current.value).toBe("");
    expect(result.current.matchesExact).toBe(false);
    act(() => result.current.setValue(exactConfirmation));
    rerender({ currentIdentity: JSON.stringify(["OBL-01", "packet-b", "instruction-b"]) });
    expect(result.current.value).toBe("");
    expect(result.current.matchesExact).toBe(false);

    act(() => result.current.setValue(exactConfirmation));
    rerender({ currentIdentity: null });
    expect(result.current.value).toBe("");
    expect(result.current.matchesExact).toBe(false);
    rerender({ currentIdentity: identity });
    expect(result.current.value).toBe("");
    expect(result.current.matchesExact).toBe(false);
  });

  it("preserves the real valid awaiting-Prime and open-gate controls", async () => {
    const fixture = await preparedAuthorizedState();
    const packet = getCurrentSettlementProxyPacket(fixture.state, fixture.selectedId);
    expect(packet).toBeTruthy();

    const awaitingPrime = await detailJson(fixture.state, fixture.selectedId);
    expect(awaitingPrime.execution_gate).toBe("LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION");
    await renderProducerJson(awaitingPrime);
    navigateStage("Payment");
    expect(screen.getByRole("region", { name: "Payment status" }).textContent).toContain("awaiting exact-packet authorization");
    expect(screen.queryByRole("button", { name: "Execute Test Payment" })).toBeNull();
    cleanup();
    fetchMock.mockReset();
    process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 = packet!.packet_sha256;

    const openGate = await detailJson(fixture.state, fixture.selectedId);
    expect(openGate.execution_gate).toBe("PRIME_AUTHORIZED_EXACT_PACKET");
    await renderProducerJson({
      ...openGate,
      assurance_evidence: { state: "UNAVAILABLE", message: "Assurance evidence is expected but unavailable.", control_results: [] },
    });
    navigateStage("Payment");
    const submit = screen.getByRole("button", { name: "Execute Test Payment" });
    const confirmation = screen.getByRole("textbox", { name: /Confirm exact testnet intent/ }) as HTMLInputElement;
    fireEvent.change(confirmation, { target: { value: exactConfirmation } });
    expect(submit.hasAttribute("disabled")).toBe(false);
    navigateStage("Authorization");
    navigateStage("Obligation");
    navigateStage("Payment");
    expect((screen.getByRole("textbox", { name: /Confirm exact testnet intent/ }) as HTMLInputElement).value).toBe(exactConfirmation);
    expect(screen.getByRole("button", { name: "Execute Test Payment" }).hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Execute Test Payment" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1));
    const [postUrl, postInit] = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")!;
    expect(String(postUrl)).toBe(`/api/obligations/${fixture.selectedId}/execute`);
    expect(postInit?.method).toBe("POST");
    expect(JSON.parse(String(postInit?.body))).toMatchObject({
      expected_version: openGate.aggregate.aggregate_version,
      packet_sha256: openGate.execution_packet.packet_sha256,
      pae_instruction_hash: openGate.sealed_pae_instruction_hash,
      confirmation: exactConfirmation,
    });
    expect(fixture.api.createTransaction).not.toHaveBeenCalled();
  });

  it("projects persisted assurance evidence across all five explicit states after cold reload", async () => {
    const fixture = await preparedAuthorizedState();
    const snapshot = fixture.state.exportSnapshot();
    const cold = new DemoState(snapshot);
    const current = projectAssuranceEvidence(assuranceProjectionInput(cold, fixture.selectedId));
    expect(current.state).toBe("AVAILABLE_CURRENT_BINDING");
    expect(current.control_results).toEqual(fixture.state.getAuthorizationArtifacts(fixture.selectedId)?.assurance_record.control_results);
    expect(current.control_results.map((control) => control.control_id)).toEqual(
      fixture.state.getAuthorizationArtifacts(fixture.selectedId)?.assurance_record.control_results.map((control) => control.control_id),
    );
    const coldGet = await detailJson(cold, fixture.selectedId);
    expect(coldGet.assurance_evidence).toMatchObject({ state: "AVAILABLE_CURRENT_BINDING", overall: "PASS" });
    const expectedStoredOrder = cold.getAuthorizationArtifacts(fixture.selectedId)!.assurance_record.control_results.map((control) => control.control_id);
    await renderProducerJson(coldGet);
    navigateStage("Assurance");
    const actionBeforeEvidence = screen.getByRole("main").querySelector('button[data-primary-action="true"]')?.textContent ?? null;
    openStageNavigator();
    const lifecycleBeforeEvidence = screen.getByRole("list", { name: "Payment lifecycle" }).textContent;
    const paymentStateBeforeEvidence = screen.getByRole("button", { name: "Payment" }).getAttribute("data-stage-state");
    fireEvent.click(screen.getByText("Developer & audit evidence"));
    fireEvent.click(screen.getByText("Assurance evidence"));
    const renderedOrder = Array.from(screen.getByText(/Stored assurance evidence — PASS/).parentElement!.querySelectorAll("li span:first-child"))
      .map((entry) => entry.textContent);
    expect(renderedOrder).toEqual(expectedStoredOrder);
    expect(screen.getByRole("main").querySelector('button[data-primary-action="true"]')?.textContent ?? null).toBe(actionBeforeEvidence);
    expect(screen.getByRole("list", { name: "Payment lifecycle" }).textContent).toBe(lifecycleBeforeEvidence);
    expect(screen.getByRole("button", { name: "Payment" }).getAttribute("data-stage-state")).toBe(paymentStateBeforeEvidence);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    cleanup();

    const aggregate = cold.store.get(DEMO_ORGANIZATION_ID, fixture.selectedId);
    const notCreated = projectAssuranceEvidence(assuranceProjectionInput(cold, fixture.selectedId, {
      aggregate: { ...aggregate, state: "APPROVAL_PENDING", pae_state: "REVOKED", execution_state: "NONE" },
      sealedPae: null,
      authorizationArtifacts: null,
      execution: null,
    }));
    expect(notCreated.state).toBe("NOT_CREATED");

    const unavailable = projectAssuranceEvidence(assuranceProjectionInput(cold, fixture.selectedId, {
      authorizationArtifacts: null,
    }));
    expect(unavailable.state).toBe("UNAVAILABLE");

    const terminalAbsence = projectAssuranceEvidence(assuranceProjectionInput(cold, fixture.selectedId, {
      aggregate: { ...aggregate, state: "RECONCILED", pae_state: "CONSUMED", execution_state: "SETTLED" },
      sealedPae: null,
      authorizationArtifacts: null,
      execution: null,
    }));
    expect(terminalAbsence.state).toBe("UNAVAILABLE");

    const validArtifacts = cold.getAuthorizationArtifacts(fixture.selectedId)!;
    const invalid = projectAssuranceEvidence(assuranceProjectionInput(cold, fixture.selectedId, {
      authorizationArtifacts: { ...validArtifacts, assurance_hash: "0".repeat(64) },
    }));
    expect(invalid.state).toBe("INVALID");

    const historical = projectAssuranceEvidence(assuranceProjectionInput(cold, fixture.selectedId, {
      executionReleaseAuthority: "REVOKED",
    }));
    expect(historical.state).toBe("AVAILABLE_HISTORICAL");
    expect(historical.control_results).toEqual(current.control_results);
  });

  it("rejects a current PAE pointer whose canonical payload differs from its signed history", async () => {
    const fixture = await preparedAuthorizedState();
    const snapshot = fixture.state.exportSnapshot();
    const pointer = snapshot.sealed_paes.find(([id]) => id === fixture.selectedId)?.[1];
    expect(pointer).toBeTruthy();
    const originalInstructionHash = pointer!.instruction_hash;
    const originalSignature = pointer!.signature;
    pointer!.payload.amount = "0.000001";
    expect(pointer!.instruction_hash).toBe(originalInstructionHash);
    expect(pointer!.signature).toBe(originalSignature);

    const restored = new DemoState(parseDemoStateSnapshot(snapshot));
    const body = await detailJson(restored, fixture.selectedId);

    expect(body.assurance_evidence).toMatchObject({ state: "INVALID", control_results: [] });
    expect(body.assurance_evidence).not.toHaveProperty("overall");
  });

  it("keeps genuine durable-loader failures outside presentation projection errors", async () => {
    stateMocks.getDemoState.mockRejectedValue(new Error("Persisted demo-state integrity failure."));
    await expect(getObligationDetail(
      new Request("http://localhost/api/obligations/OBL-LOADER-FAILURE"),
      { params: Promise.resolve({ id: "OBL-LOADER-FAILURE" }) },
    )).rejects.toThrow("Persisted demo-state integrity failure.");
  });

  it("rebuilds the assurance producer from a cold module registry and durable snapshot", async () => {
    const fixture = await preparedAuthorizedState();
    const snapshot = fixture.state.exportSnapshot();
    await vi.resetModules();
    const runtime = await import("../src/server/demo-state");
    const restored = new runtime.DemoState(runtime.parseDemoStateSnapshot(snapshot));
    stateMocks.getDemoState.mockResolvedValue(restored);
    const route = await import("../app/api/obligations/[id]/route");
    const response = await route.GET(
      new Request(`http://localhost/api/obligations/${fixture.selectedId}`),
      { params: Promise.resolve({ id: fixture.selectedId }) },
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ assurance_evidence: { state: "AVAILABLE_CURRENT_BINDING", overall: "PASS" } });
  });

  it("rejects malformed and cross-bound assurance chains and treats stale or revoked evidence as historical", async () => {
    const fixture = await preparedAuthorizedState();
    const base = assuranceProjectionInput(fixture.state, fixture.selectedId);
    const artifacts = fixture.state.getAuthorizationArtifacts(fixture.selectedId)!;
    const invalidCases = [
      { ...base, organizationId: "ORG-OTHER" },
      { ...base, obligationId: "OBL-OTHER" },
      { ...base, authorizationArtifacts: {} },
      { ...base, authorizationArtifacts: { ...artifacts, approval_record_hash: "f".repeat(64) } },
      { ...base, authorizationArtifacts: { ...artifacts, sealed_pae: { ...artifacts.sealed_pae, instruction_hash: "0".repeat(64) } } },
    ];
    for (const input of invalidCases) expect(projectAssuranceEvidence(input).state).toBe("INVALID");

    const signer = fixture.state.trustedKeys.loadServerSigningKey(signingKeyId);
    const inconsistentVersion = sealDurableAssuranceRecord({
      ...artifacts.assurance_record,
      aggregate_version: String(Number(artifacts.assurance_record.aggregate_version) + 1),
    });
    const versionPae = sealPae({ ...artifacts.sealed_pae.payload, assurance_hash: inconsistentVersion.assurance_hash }, signer.privateKey);
    expect(projectAssuranceEvidence({
      ...base,
      sealedPae: versionPae,
      authorizationArtifacts: { ...artifacts, assurance_record: inconsistentVersion.record, assurance_hash: inconsistentVersion.assurance_hash, sealed_pae: versionPae },
    }).state).toBe("INVALID");

    const inconsistentPolicy = sealDurableAssuranceRecord({ ...artifacts.assurance_record, policy_version: "POLICY-OTHER" });
    const policyPae = sealPae({ ...artifacts.sealed_pae.payload, assurance_hash: inconsistentPolicy.assurance_hash }, signer.privateKey);
    expect(projectAssuranceEvidence({
      ...base,
      sealedPae: policyPae,
      authorizationArtifacts: { ...artifacts, assurance_record: inconsistentPolicy.record, assurance_hash: inconsistentPolicy.assurance_hash, sealed_pae: policyPae },
    }).state).toBe("INVALID");

    expect(projectAssuranceEvidence({ ...base, aggregate: { ...base.aggregate, aggregate_version: base.aggregate.aggregate_version + 1 } }).state)
      .toBe("AVAILABLE_HISTORICAL");
    expect(projectAssuranceEvidence({ ...base, aggregate: { ...base.aggregate, policy_version: "POLICY-OLDER" } }).state)
      .toBe("AVAILABLE_HISTORICAL");
    fixture.state.trustedKeys.revoke(signingKeyId);
    expect(projectAssuranceEvidence({ ...base, trustedKeys: fixture.state.trustedKeys.export() }).state).toBe("AVAILABLE_HISTORICAL");
    expect(fixture.state.trustedKeys.export().find((entry) => entry.signing_key_id === signingKeyId)?.status).toBe("REVOKED");
    expect(projectAssuranceEvidence({ ...base, now: new Date("2999-01-01T00:00:00.000Z") }).state)
      .toBe("AVAILABLE_HISTORICAL");

    const changedControls = artifacts.assurance_record.control_results.map((control, index) =>
      index === 0 ? { ...control, result: "BLOCK" as const, finding_code: "TEST-BLOCK" } : control,
    );
    for (const result of ["HOLD", "BLOCK", "NOT_ASSESSED"] as const) {
      const controls = artifacts.assurance_record.control_results.map((control, index) =>
        index === 0 ? { ...control, result, finding_code: `TEST-${result}` } : control,
      );
      const changedAssurance = sealDurableAssuranceRecord({ ...artifacts.assurance_record, control_results: controls });
      const changedPae = sealPae({ ...artifacts.sealed_pae.payload, assurance_hash: changedAssurance.assurance_hash }, signer.privateKey);
      const projection = projectAssuranceEvidence({
        ...base,
        sealedPae: changedPae,
        authorizationArtifacts: {
          ...artifacts,
          assurance_record: changedAssurance.record,
          assurance_hash: changedAssurance.assurance_hash,
          sealed_pae: changedPae,
        },
      });
      expect(projection.state, result).toBe("INVALID");
      expect("overall" in projection, result).toBe(false);
    }

    for (const controls of [
      artifacts.assurance_record.control_results.slice(1),
      [...artifacts.assurance_record.control_results, artifacts.assurance_record.control_results[0]],
    ]) {
      const malformedRecord = { ...artifacts.assurance_record, control_results: controls };
      const malformedHash = sha256Hex(canonicalBytes(malformedRecord));
      const malformedPae = sealPae({ ...artifacts.sealed_pae.payload, assurance_hash: malformedHash }, signer.privateKey);
      expect(projectAssuranceEvidence({
        ...base,
        sealedPae: malformedPae,
        authorizationArtifacts: { ...artifacts, assurance_record: malformedRecord, assurance_hash: malformedHash, sealed_pae: malformedPae },
      }).state).toBe("INVALID");
    }
  });

  it("keeps evidence projection independent of execution status, gate and kill-switch eligibility", async () => {
    const fixture = await preparedAuthorizedState();
    const base = assuranceProjectionInput(fixture.state, fixture.selectedId);
    const expectedControls = fixture.state.getAuthorizationArtifacts(fixture.selectedId)!.assurance_record.control_results;
    const cases = [
      { label: "reserved", aggregate: { ...base.aggregate, pae_state: "RESERVED", execution_state: "RESERVED" }, executionReleaseAuthority: "RESERVED_FOR_EXECUTION", execution: null, executionKillSwitched: false },
      { label: "submitting", aggregate: { ...base.aggregate, pae_state: "SUBMITTED", execution_state: "SUBMITTING" }, executionReleaseAuthority: "SUBMITTED_TO_PROVIDER", execution: { status: "SUBMITTING" }, executionKillSwitched: false },
      { label: "submitted", aggregate: { ...base.aggregate, pae_state: "SUBMITTED", execution_state: "SUBMITTED" }, executionReleaseAuthority: "SUBMITTED_TO_PROVIDER", execution: { status: "SUBMITTED" }, executionKillSwitched: false },
      { label: "unknown", aggregate: { ...base.aggregate, pae_state: "UNKNOWN", execution_state: "UNKNOWN" }, executionReleaseAuthority: "IN_DOUBT_PROVIDER_SUBMISSION", execution: { status: "UNKNOWN" }, executionKillSwitched: false },
      { label: "consumed", aggregate: { ...base.aggregate, pae_state: "CONSUMED", execution_state: "SETTLED" }, executionReleaseAuthority: "CONSUMED", execution: { status: "SETTLED" }, executionKillSwitched: false },
      { label: "reconciled", aggregate: { ...base.aggregate, state: "RECONCILED", pae_state: "CONSUMED", execution_state: "SETTLED" }, executionReleaseAuthority: "CONSUMED", execution: { status: "SETTLED" }, executionKillSwitched: false },
      { label: "failed provider attempt", aggregate: { ...base.aggregate, pae_state: "REVOKED", execution_state: "FAILED" }, executionReleaseAuthority: "BLOCKED", execution: { status: "FAILED" }, executionKillSwitched: false },
      { label: "pre-submit blocked", aggregate: { ...base.aggregate, pae_state: "REVOKED", execution_state: "BLOCKED" }, executionReleaseAuthority: "BLOCKED", execution: { status: "BLOCKED" }, executionKillSwitched: false },
      { label: "same-version kill refusal", aggregate: base.aggregate, executionReleaseAuthority: "BLOCKED", execution: null, executionKillSwitched: true },
      { label: "expired", aggregate: base.aggregate, executionReleaseAuthority: "EXPIRED", execution: null, executionKillSwitched: false, now: new Date("2999-01-01T00:00:00.000Z") },
    ];
    for (const entry of cases) {
      const projection = projectAssuranceEvidence({ ...base, ...entry });
      expect(projection.state, entry.label).toBe("AVAILABLE_HISTORICAL");
      expect(projection.control_results, entry.label).toEqual(expectedControls);
    }
  });

  it("selects only the latest durable authorization from repeated cold-restored history", async () => {
    const first = await preparedAuthorizedState();
    const second = await preparedAuthorizedState();
    expect(first.selectedId).toBe(second.selectedId);
    const firstSnapshot = first.state.exportSnapshot();
    const secondSnapshot = second.state.exportSnapshot();
    secondSnapshot.authorization_history = [
      firstSnapshot.authorization_history.at(-1)!,
      ...secondSnapshot.authorization_history,
    ];
    secondSnapshot.authority.assessments = [
      ...firstSnapshot.authority.assessments,
      ...secondSnapshot.authority.assessments,
    ];
    const cold = new DemoState(secondSnapshot);
    const latest = cold.getAuthorizationArtifacts(second.selectedId)!;
    expect(latest.approval_record.approval_id).toBe(second.state.getAuthorizationArtifacts(second.selectedId)!.approval_record.approval_id);
    expect(projectAssuranceEvidence(assuranceProjectionInput(cold, second.selectedId)).state).toBe("AVAILABLE_CURRENT_BINDING");
  });

  it("renders the authoritative sole candidate and post-proxy fresh-assessment state from real GET producers", async () => {
    const eligible = livePayAssessedState();
    const queue = await listJson(eligible.state);
    expect(queue.sole_pay_candidate_id).toBe(eligible.selectedId);
    expect(queue.obligations.find((item: { obligation_id: string }) => item.obligation_id === eligible.selectedId)).toMatchObject({
      aggregate_state: "APPROVAL_PENDING",
      assessed: true,
    });
    const eligibleDetail = await detailJson(eligible.state, eligible.selectedId);
    const { main } = await renderProducerJson(eligibleDetail, [], queue);
    const winner = obligationRow(eligible.selectedId);
    expect(winner.textContent).toContain("PAY recommendation (advisory)");
    expect(winner.textContent).not.toMatch(/Sole PAY candidate|route assurance|PAE|execution/i);
    expect(main.querySelector('button[data-primary-action="true"]')).not.toBeNull();
    cleanup();

    const prepared = await preparedAuthorizedState();
    const authorized = await detailJson(prepared.state, prepared.selectedId);
    const authorizedQueue = await listJson(prepared.state);
    expect(authorizedQueue.obligations.find((item: { obligation_id: string }) => item.obligation_id === prepared.selectedId)).toMatchObject({
      aggregate_state: "AUTHORIZED",
      pae_sealed: true,
    });
    const { main: authorizedMain } = await renderProducerJson(authorized, [], authorizedQueue);
    expect(obligationRow(prepared.selectedId).textContent).toContain("Workflow recorded");
    expect(obligationRow(prepared.selectedId).textContent).not.toMatch(/PAE|execution|route|provider/i);
    expect(obligationRow(prepared.selectedId).textContent).not.toContain("Assessment required");
    expect(authorizedMain.querySelectorAll('button[data-primary-action="true"]').length).toBeLessThanOrEqual(1);
    navigateStage("Assurance");
    expect((screen.getByText("Developer & audit evidence").closest("details") as HTMLDetailsElement).open).toBe(false);
    cleanup();

    const postProxy = await proxyPreparedWithoutCurrentAssessment();
    const postProxyDetail = await detailJson(postProxy.state, postProxy.selectedId);
    expect(postProxyDetail.pae_sealed).toBe(false);
    expect(postProxyDetail.execution).toBeNull();
    expect(postProxyDetail.truth.tameion_control_truth.pae_state).toBe("REVOKED");
    expect(postProxyDetail.assurance_evidence.state).toBe("NOT_CREATED");
    const postProxyQueue = await listJson(postProxy.state);
    const { main: postProxyMain } = await renderProducerJson(postProxyDetail, [], postProxyQueue);
    expect(screen.getByText(/Current position: Assessment/)).toBeTruthy();
    expect(screen.getByTestId("current-next-step").textContent).toContain("fresh assessment for the prepared Arc Testnet proxy");
    expect(screen.getByTestId("current-next-step").textContent).not.toMatch(/PAE.*revoked|sealed.*revoked/i);
    expect(postProxyMain.querySelector('button[data-primary-action="true"]')?.textContent).toContain("Run AI Assessment");
    openStageNavigator();
    expect((screen.getByRole("button", { name: "Assurance" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Developer & audit evidence").closest("details") as HTMLDetailsElement).open).toBe(false);
    expect(screen.queryByText(/Stored assurance evidence/)).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps a current non-winner PAY advisory distinct from the authoritative candidate disposition", async () => {
    const preparedWinner = await proxyPreparedWithoutCurrentAssessment(true);
    const preparedQueue = await listJson(preparedWinner.state);
    const preparedDetail = await detailJson(preparedWinner.state, preparedWinner.selectedId);
    preparedDetail.demo_arc_trust_simulated = false;
    preparedDetail.aggregate.product_trust_provenance = "UNVERIFIED_CURRENT_TRUST";
    preparedDetail.aggregate.destination_verification_status = "PENDING_VERIFICATION";
    preparedDetail.aggregate.destination_operational_status = "ACTIVE";
    preparedDetail.aggregate.source_wallet_status = "ACTIVE";
    const { main: preparedMain } = await renderProducerJson(preparedDetail, [], preparedQueue);
    navigateStage("Assessment");
    expect(preparedMain.querySelector('nav[aria-label="Payment lifecycle navigation"] button[aria-label="Assessment"]')?.getAttribute("data-stage-state")).toBe("CURRENT");
    expect(screen.getByTestId("payment-eligibility").textContent).toContain("Selected payment candidate");
    expect(screen.getByTestId("payment-eligibility").textContent).toContain("current payment-route assurance is not ready");
    expect(screen.getByRole("button", { name: "Review current PAY assessment" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue to Authorization" })).toBeNull();
    cleanup();

    const fixture = livePayAssessedState();
    const selectedCandidateId = fixture.selectedId;
    const nonCandidateId = "OBL-J0C-003";
    expect(selectedCandidateId).toBe("OBL-J0C-001");
    expect(nonCandidateId).not.toBe(selectedCandidateId);
    const nonCandidateAggregate = fixture.state.store.get(DEMO_ORGANIZATION_ID, nonCandidateId);
    expect(nonCandidateAggregate).toBeTruthy();
    sealTestAssessment(fixture.state.store, DEMO_ORGANIZATION_ID, nonCandidateId, nonCandidateAggregate!.aggregate_version, {
      decision: "PAY",
      provider_mode: "LIVE_AI",
      reasons: ["Current PAY recommendation for this genuine obligation."],
    });

    const queue = await listJson(fixture.state);
    const payRecommendations = queue.obligations.filter((item: { decision: string | null }) => item.decision === "PAY");
    expect(payRecommendations).toHaveLength(2);
    expect(queue.sole_pay_candidate_id).toBe(selectedCandidateId);
    const candidateBody = await detailJson(fixture.state, selectedCandidateId);
    const body = await detailJson(fixture.state, nonCandidateId);
    expect(body.current_assessment.decision).toBe("PAY");
    const { main } = await renderProducerJson(candidateBody, [body], queue);
    fireEvent.click(obligationRow(nonCandidateId));
    await waitFor(() => expect(["CURRENT", "BLOCKED"]).toContain(
      main.querySelector('nav[aria-label="Payment lifecycle navigation"] button[aria-label="Assessment"]')?.getAttribute("data-stage-state"),
    ));
    navigateStage("Assessment");

    expect(main.querySelector('nav[aria-label="Payment lifecycle navigation"] button[aria-label="Assessment"]')?.getAttribute("data-stage-state")).toBe("CURRENT");
    expect(screen.getByTestId("assessment-result-card").textContent).toContain("Advisory — PAY");
    expect(screen.getByTestId("assessment-result-card").textContent).toContain("Payment eligibility");
    expect(screen.getByTestId("assessment-result-card").textContent).toContain("Not the selected payment candidate.");
    const candidateSummary = queue.obligations.find((item: { obligation_id: string }) => item.obligation_id === selectedCandidateId);
    const candidateLabel = candidateSummary.service_category.replaceAll("_", " ").toLowerCase();
    expect(screen.getByTestId("assessment-result-card").textContent).toContain(candidateLabel);
    expect(screen.getByTestId("assessment-result-card").textContent).not.toContain(selectedCandidateId);
    expect(screen.getByTestId("assessment-result-card").textContent).toContain("earliest effective due date among PAY recommendations");
    expect(screen.getByTestId("assessment-result-card").textContent).toContain("View selected payment candidate");
    expect(screen.getByRole("button", { name: "View selected payment candidate" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review current PAY assessment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue to Authorization" })).toBeNull();
    expect(main.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "View selected payment candidate" }));
    await waitFor(() => expect(main.querySelector('[data-obligation-id="OBL-J0C-001"]')?.getAttribute("aria-current")).toBe("true"));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps a current PAY recommendation advisory when assessment coverage leaves the winner unknown", async () => {
    const state = new DemoState();
    const nonCandidateId = "OBL-J0C-003";
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, nonCandidateId);
    expect(aggregate).toBeTruthy();
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, nonCandidateId, aggregate!.aggregate_version, {
      decision: "PAY",
      provider_mode: "LIVE_AI",
      reasons: ["Current PAY recommendation while other obligations remain unassessed."],
    });
    const queue = await listJson(state);
    expect(queue.assessed_count).toBeLessThan(queue.total_count);
    expect(queue.sole_pay_candidate_id).toBeNull();
    const firstBody = await detailJson(state, queue.obligations[0].obligation_id);
    const body = await detailJson(state, nonCandidateId);
    const { main } = await renderProducerJson(firstBody, [body], queue);
    fireEvent.click(obligationRow(nonCandidateId));
    await waitFor(() => expect(["CURRENT", "BLOCKED"]).toContain(
      main.querySelector('nav[aria-label="Payment lifecycle navigation"] button[aria-label="Assessment"]')?.getAttribute("data-stage-state"),
    ));
    navigateStage("Assessment");

    expect(main.querySelector('nav[aria-label="Payment lifecycle navigation"] button[aria-label="Assessment"]')?.getAttribute("data-stage-state")).toBe("CURRENT");
    expect(screen.getByTestId("assessment-result-card").textContent).toContain("Advisory — PAY");
    expect(screen.getByTestId("payment-eligibility").textContent).toContain("assessment coverage is incomplete");
    expect(screen.getByTestId("assessment-result-card").textContent).toContain("Back to obligations");
    expect(screen.getByRole("button", { name: "Back to obligations" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Review current PAY assessment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Continue to Authorization" })).toBeNull();
    expect(main.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(1);
    expect(main.querySelectorAll("details[open]")).toHaveLength(0);
    for (const row of Array.from(main.querySelectorAll<HTMLButtonElement>("button[data-obligation-id]"))) {
      expect(row.textContent).not.toMatch(/Sole PAY candidate|route assurance|PAE|execution|provider/i);
    }

    fireEvent.click(screen.getByRole("button", { name: "Back to obligations" }));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("shows a minimal obligation screen with no downstream lifecycle or technical material", async () => {
    const state = new DemoState();
    const queue = await listJson(state);
    const first = queue.obligations[0];
    expect(first).toBeTruthy();
    const body = await detailJson(state, first.obligation_id);
    expect(body.current_assessment).toBeNull();
    const { main } = await renderProducerJson(body, [], queue);

    const source = screen.getByRole("region", { name: "Selected source obligation" });
    await waitFor(() => expect(source.textContent).toContain("OUTSTANDING"));
    expect(source.textContent).toContain(`${body.record.amount} ${body.record.currency}`);
    expect(source.textContent).not.toContain(body.record.obligation_id);
    expect(source.querySelector('[data-testid="source-service-context"]')?.textContent).toContain(body.record.commercial_terms);

    expect(main.querySelector('nav[aria-label="Payment lifecycle navigation"]')).toBeNull();
    expect(screen.queryByText("Payment journey")).toBeNull();
    expect(screen.queryByText(/Activity & evidence/)).toBeNull();
    expect(screen.queryByText("Developer & audit evidence")).toBeNull();
    expect(screen.queryByText("Demo tools", { exact: true })).toBeNull();
    expect(screen.queryByText(/Operational Report/)).toBeNull();
    expect(source.textContent).not.toMatch(/ARC TESTNET|USDC|PAE|Safety Kernel|provider|reconciliation/i);
    expect(main.textContent).toContain("This obligation needs an assessment before it can proceed.");
    expect(main.textContent).toContain("AI can recommend PAY, HOLD or ESCALATE. It cannot approve payment or move money.");
    expect(main.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(1);
    expect(main.querySelector('button[data-primary-action="true"]')?.textContent).toContain("Run AI Assessment");

    expect(screen.queryByText("Demonstrations", { exact: true })).toBeNull();

    const queueRow = document.querySelector(`button[data-obligation-id="${first.obligation_id}"]`) as HTMLButtonElement;
    expect(queueRow).toBeTruthy();
    expect(queueRow.textContent).toContain(`${first.amount} ${first.currency}`);
    expect(queueRow.textContent).not.toContain(first.obligation_id);
    expect(queueRow.textContent).not.toContain(first.commercial_terms);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps the guided journey compact, upcoming stages distinct, and Assessment free of proxy header details", async () => {
    const fixture = await proxyPreparedWithoutCurrentAssessment(true);
    const body = await detailJson(fixture.state, fixture.selectedId);
    const queue = await listJson(fixture.state);
    const { main } = await renderProducerJson(body, [], queue);

    const header = screen.getByRole("region", { name: "Selected source obligation" });
    expect(header.textContent).not.toMatch(/ARC TESTNET|controlled settlement proxy|USDC|PAE|provider/i);
    expect(screen.getByText(/Step 1 of 6 · Obligation/)).toBeTruthy();
    expect(screen.getByText("View all stages")).toBeTruthy();
    expect((main.querySelector('nav[aria-label="Payment lifecycle navigation"]') as HTMLElement).hidden).toBe(true);
    expect(main.querySelectorAll("details[open]")).toHaveLength(0);

    fireEvent.click(screen.getByText("View all stages"));
    const stages = screen.getByRole("navigation", { name: "Payment lifecycle navigation" });
    expect(stages.querySelector('[aria-label="Authorization"]')?.getAttribute("data-stage-state")).toBe("UPCOMING");
    expect(stages.querySelector('[aria-label="Assurance"]')?.textContent).toContain("Upcoming");
    expect(stages.querySelector('[aria-label="Authorization"]')?.textContent).not.toContain("Blocked");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("resumes an existing current assessment by read-only navigation instead of reassessing", async () => {
    const fixture = await assessedProducerState("PAY");
    const { main } = await renderProducerJson(fixture.body, [], fixture.queue);

    expect(main.querySelector('button[data-primary-action="true"]')?.textContent).toContain("View Assessment");
    expect(main.querySelector('button[data-primary-action="true"]')?.textContent).not.toMatch(/Run AI Assessment/);
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    expect(screen.getByRole("region", { name: "Assessment result" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps only a concise current assurance summary open and folds the full control matrix", async () => {
    const fixture = await preparedAuthorizedState();
    const body = await detailJson(fixture.state, fixture.selectedId);
    await renderProducerJson(body);
    fireEvent.click(screen.getByText("View all stages"));
    navigateStage("Assurance");

    const assurance = screen.getByRole("region", { name: "Deterministic assurance result" });
    expect(assurance.textContent).toMatch(/10\/10 controls passed/);
    expect(assurance.textContent).toContain("Deterministic controls, not AI, grant or deny release authority.");
    expect((assurance.querySelector("details[aria-label='Assurance control details']") as HTMLDetailsElement | null)?.open).toBe(false);
    expect(screen.getAllByRole("button", { name: "Continue to Payment" })).toHaveLength(1);
    expect(assurance.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps Screen 2 capability boundaries explicit without inventing assessment results", async () => {
    const fixture = await assessedProducerState("PAY");
    const { main } = await renderProducerJson(fixture.body, [], fixture.queue);
    navigateStage("Assessment");
    const card = screen.getByRole("region", { name: "Assessment result" });
    expect(screen.getByTestId("assessment-provenance").textContent).toMatch(/live AI.*advisory/i);
    expect(card.textContent).toContain("Capability boundary");
    expect(card.textContent).toContain("This assessment does not verify invoice contents, match purchase orders or receipts, validate supplier tax, or provide enterprise fraud or duplicate assurance.");
    expect(card.textContent).toContain(fixture.body.current_assessment.race.result.decision_summary);
    expect(card.textContent).not.toContain("PO match passed");
    expect(main.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(1);
  });

  it("shows provider provenance from an actual deterministic assess-route fallback result", async () => {
    const state = new DemoState();
    const queue = await listJson(state);
    const selectedId = queue.obligations[0]?.obligation_id;
    if (!selectedId) throw new Error("Frozen source set is empty.");
    stateMocks.getDemoState.mockResolvedValue(state);
    vi.stubEnv("NVIDIA_API_KEY", "");
    try {
      const response = await postAssessment(new Request(`http://localhost/api/obligations/${selectedId}/assess`, {
        method: "POST",
        headers: { "Idempotency-Key": "f47ac10b-58cc-4372-a567-0e02b2c3d479" },
      }), { params: Promise.resolve({ id: selectedId }) });
      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.provider_mode).toBe("NOT_LIVE_AI");

      const body = await detailJson(state, selectedId);
      const currentQueue = await listJson(state);
      expect(body.current_assessment.provider_mode).toBe("NOT_LIVE_AI");
      await renderProducerJson(body, [], currentQueue);
      navigateStage("Assessment");

      const card = screen.getByRole("region", { name: "Assessment result" });
      expect(screen.getByTestId("assessment-provenance").textContent)
        .toMatch(/deterministic fallback.*not live AI/i);
      expect(card.textContent).not.toMatch(/NOT_LIVE_AI|runtime_config_sha256|Model:/);
      const developerEvidence = screen.getByText("Developer & audit evidence").closest("details") as HTMLDetailsElement;
      expect(developerEvidence.open).toBe(false);
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("states uncertainty for missing or unknown provider details and distinguishes blocked external status", async () => {
    const fixture = await assessedProducerState("PAY");
    const cases = [
      {
        label: "missing provider fields",
        edit: (assessment: Record<string, any>) => {
          delete assessment.provider_mode;
          delete assessment.provider_used;
        },
        expected: /provider source is unavailable.*whether this assessment used live AI is unknown/i,
      },
      {
        label: "unknown provider mode",
        edit: (assessment: Record<string, any>) => { assessment.provider_mode = "UNKNOWN"; },
        expected: /provider source is unavailable.*whether this assessment used live AI is unknown/i,
      },
      {
        label: "blocked external provider",
        edit: (assessment: Record<string, any>) => { assessment.provider_mode = "BLOCKED_EXTERNAL"; },
        expected: /external provider blocked.*live AI is unconfirmed/i,
      },
    ];

    for (const scenario of cases) {
      cleanup();
      fetchMock.mockClear();
      const body = structuredClone(fixture.body);
      scenario.edit(body.current_assessment);
      await renderProducerJson(body, [], fixture.queue);
      navigateStage("Assessment");
      expect(screen.getByTestId("assessment-provenance").textContent, scenario.label).toMatch(scenario.expected);
      expect(screen.getByText("Developer & audit evidence").closest("details")?.getAttribute("open")).toBeNull();
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST"), scenario.label).toHaveLength(0);
    }
  });

  it("uses current fresh PAY truth for Recovery copy before Review, then preserves reviewed authorization", async () => {
    const fixture = await proxyPreparedWithoutCurrentAssessment(true);
    const body = await detailJson(fixture.state, fixture.selectedId);
    const current = fixture.state.store.get(DEMO_ORGANIZATION_ID, fixture.selectedId);
    expect(body.aggregate.pae_state).toBe("REVOKED");
    expect(body.aggregate.state).toBe("APPROVAL_PENDING");
    expect(body.aggregate.aggregate_version).toBe(2);
    expect(body.truth.tameion_control_truth.execution_release_authority).toBe("REVOKED");
    expect(body.pae_sealed).toBe(false);
    expect(body.execution_gate).toBe("LOCKED_UNTIL_CURRENT_AUTHORIZATION");
    expect(body.execution).toBeNull();
    expect(body.current_assessment).toMatchObject({
      obligation_id: fixture.selectedId,
      aggregate_version: String(current.aggregate_version),
      decision: "PAY",
      provider_mode: "LIVE_AI",
    });

    const queue = await listJson(fixture.state);
    const { main } = await renderProducerJson(body, [], queue);
    expect(screen.queryByRole("region", { name: "Exception recovery" })).toBeNull();
    expect(screen.getByRole("button", { name: "View Assessment" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    expect(screen.queryByRole("region", { name: "Exception recovery" })).toBeNull();
    expect(screen.getByRole("button", { name: "Review current PAY assessment" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Review current PAY assessment" }));
    expect(screen.queryByRole("region", { name: "Exception recovery" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Continue to Authorization" }));
    // Continue is read-only navigation and lands directly on Authorization.
    expect(screen.queryByRole("region", { name: "Exception recovery" })).toBeNull();
    expect(screen.getByRole("button", { name: "Authorize payment" })).toBeTruthy();
    expect(main.querySelectorAll('button[data-primary-action="true"]').length).toBeLessThanOrEqual(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps genuine sealed-PAE revocation in Recovery after material change and fresh PAY", async () => {
    const fixture = await preparedAuthorizedState();
    expect(fixture.state.getSealedPae(fixture.selectedId)).toBeTruthy();
    const before = fixture.state.store.get(DEMO_ORGANIZATION_ID, fixture.selectedId);
    fixture.state.store.applyMaterialChange(
      DEMO_ORGANIZATION_ID,
      fixture.selectedId,
      before.aggregate_version,
      { destination_version: before.destination_version + 1 },
    );
    const current = fixture.state.store.get(DEMO_ORGANIZATION_ID, fixture.selectedId);
    sealTestAssessment(fixture.state.store, DEMO_ORGANIZATION_ID, fixture.selectedId, current.aggregate_version, {
      decision: "PAY",
      provider_mode: "LIVE_AI",
    });
    const body = await detailJson(fixture.state, fixture.selectedId);
    expect(body.pae_sealed).toBe(true);
    expect(body.truth.tameion_control_truth).toMatchObject({ pae_state: "REVOKED", execution_release_authority: "REVOKED" });

    const queue = await listJson(fixture.state);
    const { main } = await renderProducerJson(body, [], queue);
    navigateStage("Payment");
    expect(screen.getByRole("region", { name: "Payment status" }).textContent).toMatch(/payment authority is revoked/i);
    expect(screen.queryByRole("button", { name: "Authorize payment" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Execute Test Payment" })).toBeNull();
    expect(main.querySelector('button[data-primary-action="true"]')).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("retains Recovery for non-current, HOLD, and cancelled preauthorization states", async () => {
    const nonCurrent = await proxyPreparedWithoutCurrentAssessment();
    const nonCurrentBody = await detailJson(nonCurrent.state, nonCurrent.selectedId);
    expect(nonCurrentBody.current_assessment?.aggregate_version).not.toBe(String(nonCurrentBody.aggregate.aggregate_version));
    await renderProducerJson(nonCurrentBody, [], await listJson(nonCurrent.state));
    navigateStage("Assessment");
    expect(screen.getByTestId("current-next-step").textContent).toContain("fresh assessment for the prepared Arc Testnet proxy");
    expect(screen.getByTestId("current-next-step").textContent).toContain("Not current for this version");
    expect(screen.queryByRole("button", { name: "Authorize payment" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    cleanup();
    fetchMock.mockClear();
    const held = await proxyPreparedWithoutCurrentAssessment(true);
    const heldAggregate = held.state.store.get(DEMO_ORGANIZATION_ID, held.selectedId);
    sealTestAssessment(held.state.store, DEMO_ORGANIZATION_ID, held.selectedId, heldAggregate.aggregate_version, {
      decision: "HOLD",
      provider_mode: "LIVE_AI",
    });
    const heldBody = await detailJson(held.state, held.selectedId);
    expect(heldBody.current_assessment).toMatchObject({ decision: "HOLD", aggregate_version: String(heldAggregate.aggregate_version) });
    await renderProducerJson(heldBody, [], await listJson(held.state));
    navigateStage("Assessment");
    expect(screen.getByRole("region", { name: "Assessment result" }).textContent).toContain("HOLD");
    expect(screen.queryByRole("region", { name: "Exception recovery" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Authorize payment" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    cleanup();
    fetchMock.mockClear();
    const cancelled = await proxyPreparedWithoutCurrentAssessment(true);
    const beforeCancel = cancelled.state.store.get(DEMO_ORGANIZATION_ID, cancelled.selectedId);
    cancelled.state.store.cancel(DEMO_ORGANIZATION_ID, cancelled.selectedId, beforeCancel.aggregate_version);
    const cancelledBody = await detailJson(cancelled.state, cancelled.selectedId);
    expect(cancelledBody.aggregate.state).toBe("CANCELLED");
    await renderProducerJson(cancelledBody, [], await listJson(cancelled.state));
    navigateStage("Assessment");
    expect(screen.getByRole("region", { name: "Exception recovery" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Authorize payment" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("renders concise source provenance and service period from producer-shaped obligation records", async () => {
    const state = new DemoState();
    const queue = await listJson(state);
    const expectedById = new Map([
      ["OBL-J0C-001", /One-year business-license\/flexi-desk package.*proforma invoice/i],
      ["OBL-J0C-005", /One-year productivity-suite commitment covering 2026-03-29 through 2027-03-28.*email invoice excerpt/i],
    ]);
    const bodies = await Promise.all([...expectedById.keys()].map((id) => detailJson(state, id)));
    const [first, fifth] = bodies;
    if (!first || !fifth) throw new Error("Expected producer details for source obligations 001 and 005.");
    const { main } = await renderProducerJson(first, [fifth], queue);
    const source = screen.getByRole("region", { name: "Selected source obligation" });
    const firstContext = source.querySelector('[data-testid="source-service-context"]');

    expect(firstContext?.textContent).toMatch(expectedById.get("OBL-J0C-001")!);
    expect(source.textContent).not.toContain("OBL-J0C-001");
    expect(source.textContent).not.toMatch(/EVID-|sha256|content_hash|PDF_PROFORMA_INVOICE/);
    expect(main.querySelector('button[data-primary-action="true"]')?.textContent).toContain("Run AI Assessment");

    fireEvent.click(obligationRow("OBL-J0C-005"));
    await waitFor(() => {
      expect(screen.getByRole("region", { name: "Selected source obligation" }).querySelector('[data-testid="source-service-context"]')?.textContent)
        .toMatch(expectedById.get("OBL-J0C-005")!);
    });
    const selectedSource = screen.getByRole("region", { name: "Selected source obligation" });
    expect(selectedSource.textContent).not.toContain("OBL-J0C-005");
    expect(selectedSource.textContent).not.toMatch(/EVID-|sha256|content_hash|USER_SUPPLIED_EMAIL_INVOICE_EXCERPT/);
    expect(main.querySelector('button[data-primary-action="true"]')?.textContent).toContain("Run AI Assessment");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps initial obligation guidance advisory and aggregate version in technical evidence", async () => {
    const unassessed = new DemoState();
    const firstSource = unassessed.liveUsageRecords[0];
    if (!firstSource) throw new Error("Frozen source set is empty.");
    const unassessedBody = await detailJson(unassessed, firstSource.obligation_id);
    const unassessedQueue = await listJson(unassessed);
    const { main: unassessedMain } = await renderProducerJson(unassessedBody, [], unassessedQueue);
    expect(unassessedMain.textContent).toContain("AI can recommend PAY, HOLD or ESCALATE. It cannot approve payment or move money.");
    expect(screen.queryByRole("navigation", { name: "Payment lifecycle navigation" })).toBeNull();
    expect(unassessedMain.textContent).not.toMatch(/no provider submission/i);
    cleanup();

    const fixture = await proxyPreparedWithoutCurrentAssessment(true);
    const body = await detailJson(fixture.state, fixture.selectedId);
    body.demo_arc_trust_simulated = false;
    body.aggregate = {
      ...body.aggregate,
      product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
      destination_verification_status: "VERIFIED",
      destination_operational_status: "ACTIVE",
      source_wallet_ref: "CURRENT-ROUTE-SOURCE-WALLET",
      source_wallet_status: "ACTIVE",
    };
    const queue = await listJson(fixture.state);
    const { main } = await renderProducerJson(body, [], queue);
    const developerEvidence = screen.getByText("Developer & audit evidence").closest("details") as HTMLDetailsElement;
    expect(developerEvidence.open).toBe(false);
    expect(developerEvidence.textContent).toContain("Aggregate version");
    const visibleOutsideTechnicalEvidence = Array.from(main.querySelectorAll("*"))
      .filter((element) => element.children.length === 0 && /aggregate version/i.test(element.textContent ?? ""))
      .filter((element) => !developerEvidence.contains(element));
    expect(visibleOutsideTechnicalEvidence).toHaveLength(0);
  });

  it.each(["PAY", "HOLD", "ESCALATE"] as const)("renders the producer-returned %s assessment as a clerk-readable result", async (decision) => {
    const fixture = await assessedProducerState(decision);
    const assessment = fixture.body.current_assessment;
    const race = assessment.race;
    const { main } = await renderProducerJson(fixture.body, [], fixture.queue);
    navigateStage("Assessment");

    const card = await screen.findByRole("region", { name: "Assessment result" });
    expect(card.textContent).toContain(`Advisory — ${decision}`);
    expect(card.textContent).toContain(race.result.decision_summary);
    expect(card.textContent).toContain("What this means");
    expect(card.textContent).toContain("What to do next");
    for (const check of race.action_taken.checks) expect(card.textContent).toContain(check);
    for (const finding of race.result.validated_findings) expect(card.textContent).toContain(finding.reason);
    for (const remediation of race.remediation) expect(card.textContent).toContain(remediation.required_action);
    const expectedOwner = decision === "HOLD" ? race.remediation[0]?.owner_role
      : decision === "ESCALATE" ? race.remediation[0]?.escalation_target
        : "Authorized operator";
    const hasPrimaryAssessmentAction = Boolean(card.querySelector('button[data-primary-action="true"]'));
    if (expectedOwner && !hasPrimaryAssessmentAction) expect(card.textContent).toContain(`Next owner/role: ${expectedOwner}`);
    else expect(card.textContent).not.toContain("Next owner/role:");
    expect(card.textContent).not.toContain(assessment.assessment_id);
    expect(card.textContent).not.toContain(assessment.assessment_hash);
    expect(card.textContent).not.toContain(race.evidence.evidence_ids[0]);
    if (race.result.validated_findings[0]) expect(card.textContent).not.toContain(race.result.validated_findings[0].code);
    expect(card.textContent).not.toMatch(/\bPASS\b|passed/i);
    expect(main.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(decision === "PAY" ? 1 : 0);
    expect(within(card).queryByRole("button", { name: "Run AI Assessment again" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("promotes only the existing eligible reassessment option and keeps the simple entry untouched", async () => {
    const fixture = await proxyPreparedWithoutCurrentAssessment(true);
    const queue = await listJson(fixture.state);
    const body = await detailJson(fixture.state, fixture.selectedId);
    body.demo_arc_trust_simulated = true;
    body.aggregate.product_trust_provenance = "UNVERIFIED";
    body.aggregate.destination_verification_status = "UNVERIFIED";
    body.aggregate.destination_operational_status = "UNVERIFIED";
    body.aggregate.source_wallet_ref = "SIMULATED-ROUTE-WALLET";
    body.aggregate.source_wallet_status = "INACTIVE";
    const { main } = await renderProducerJson(body, [], queue);
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    fireEvent.click(screen.getByRole("button", { name: "Review current PAY assessment" }));
    fireEvent.click(screen.getByText("Findings and supporting detail"));

    const card = await screen.findByRole("region", { name: "Assessment result" });
    const reassess = within(card).getByRole("button", { name: "Run AI Assessment again" }) as HTMLButtonElement;
    expect(reassess.disabled).toBe(false);
    expect(reassess.className).toMatch(/min-h-\[44px\]/);
    expect(reassess.className).not.toMatch(/underline/);
    expect(main.querySelectorAll('button[data-primary-action="true"]').length).toBeLessThanOrEqual(1);
    expect(reassess.hasAttribute("data-primary-action")).toBe(false);
    fireEvent.click(reassess);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith(`/${fixture.selectedId}/assess`) && init?.method === "POST")).toBe(true));

    cleanup();
    const unassessed = new DemoState();
    const initialQueue = await listJson(unassessed);
    const initialBody = await detailJson(unassessed, initialQueue.obligations[0].obligation_id);
    const entry = await renderProducerJson(initialBody, [], initialQueue);
    expect(initialBody.current_assessment).toBeNull();
    expect(entry.main.querySelector('button[data-primary-action="true"]')?.textContent).toContain("Run AI Assessment");
    expect(screen.queryByRole("button", { name: "Run AI Assessment again" })).toBeNull();
  });

  it("does not offer reassessment when authorized truth makes the assessment historical", async () => {
    const fixture = await preparedAuthorizedState();
    const body = await detailJson(fixture.state, fixture.selectedId);
    const queue = await listJson(fixture.state);
    const { main } = await renderProducerJson(body, [], queue);
    navigateStage("Assessment");

    expect(screen.queryByRole("button", { name: "Run AI Assessment again" })).toBeNull();
    expect(main.querySelectorAll('button[data-primary-action="true"]').length).toBeLessThanOrEqual(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("consumes the actual 422 assurance refusal with N+1 and no sealed PAE as NOT_CREATED evidence", async () => {
    const fixture = await proxyPreparedWithoutCurrentAssessment(true);
    const current = fixture.state.store.get(DEMO_ORGANIZATION_ID, fixture.selectedId);
    const assessment = fixture.state.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, fixture.selectedId)!;
    fixture.state.store.activateKillSwitch("TRANSACTION_DISABLED", fixture.selectedId);
    stateMocks.getDemoState.mockResolvedValue(fixture.state);
    const response = await approveObligation(new Request(`http://localhost/api/obligations/${fixture.selectedId}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_version: current.aggregate_version,
        reviewed_assessment_id: assessment.record.assessment_id,
        reviewed_assessment_hash: assessment.hash,
      }),
    }), { params: Promise.resolve({ id: fixture.selectedId }) });
    expect(response.status).toBe(422);

    const body = await detailJson(fixture.state, fixture.selectedId);
    expect(body.aggregate.state).toBe("AUTHORIZED");
    expect(body.current_assessment).toBeNull();
    expect(body.pae_sealed).toBe(false);
    expect(body.execution).toBeNull();
    expect(body.assurance_evidence).toMatchObject({
      state: "NOT_CREATED",
      message: "No assurance PASS evidence exists for this state.",
    });
    const queue = await listJson(fixture.state);
    const { main } = await renderProducerJson(body, [], queue);
    expect(screen.getByText(/Current position: Assurance/)).toBeTruthy();
    expect(obligationRow(fixture.selectedId).textContent).toContain("Workflow recorded");
    expect(obligationRow(fixture.selectedId).textContent).not.toMatch(/PAE|execution|route|provider/i);
    expect(obligationRow(fixture.selectedId).textContent).not.toContain("Assessment required");
    expect(main.querySelectorAll('button[data-primary-action="true"]').length).toBeLessThanOrEqual(1);
    expect(fixture.api.createTransaction).not.toHaveBeenCalled();
  });

  it("renders only timestamped durable artifacts as history and labels untimestamped authority as current state", async () => {
    const fixture = await preparedAuthorizedState();
    const body = await detailJson(fixture.state, fixture.selectedId);
    const { main } = await renderProducerJson(body);

    const activity = screen.getByRole("region", { name: "Activity and evidence" });
    expect(activity.textContent).toContain("Available evidence history");
    expect(activity.textContent).toContain(body.settlement_proxy.preflight.captured_at);
    expect(activity.textContent).toContain(body.assurance_evidence.recorded_at);
    expect(activity.textContent).not.toMatch(/approved at|authorization event|execution event/i);
    expect(activity.textContent).toContain("Current authorization state");
    expect(activity.textContent).toContain("No Tameion execution record is recorded for this instruction.");
    expect(activity.textContent).not.toMatch(/provider submissions\s*[:=]\s*0|zero provider submissions|not submitted to provider/i);

    const developerEvidence = screen.getByText("Developer & audit evidence").closest("details");
    expect(developerEvidence?.open).toBe(false);
    expect(main.querySelectorAll('button[data-primary-action="true"]').length).toBeLessThanOrEqual(1);
    const postsBefore = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    fireEvent.click(screen.getByText("Developer & audit evidence"));
    expect(screen.getByText("Assessment evidence").closest("details")?.open).toBe(false);
    expect(screen.getByText("Authorization evidence").closest("details")?.open).toBe(false);
    expect(screen.getByText("Assurance evidence").closest("details")?.open).toBe(false);
    expect(screen.getByText("PAE / instruction").closest("details")?.open).toBe(false);
    expect(screen.getByText("Execution / provider").closest("details")?.open).toBe(false);
    expect(screen.getByText("Reconciliation evidence").closest("details")?.open).toBe(false);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postsBefore);

    cleanup();
    const malformedTimes = structuredClone(body);
    malformedTimes.settlement_proxy.preflight.captured_at = "yesterday";
    malformedTimes.assurance_evidence.recorded_at = "October 7, 2026";
    await renderProducerJson(malformedTimes);
    fireEvent.click(screen.getByText(/Activity & evidence/));
    const unavailableHistory = screen.getByRole("region", { name: "Activity and evidence" });
    expect(unavailableHistory.textContent).toContain("No timestamped durable evidence is available in this detail.");
    expect(unavailableHistory.textContent).not.toContain("yesterday");
    expect(unavailableHistory.textContent).not.toContain("October 7, 2026");
  });

  it("shows a compact approver decision packet with the source payable and proxy as separate identities", async () => {
    const fixture = await preparedAuthorizedState();
    const body = await detailJson(fixture.state, fixture.selectedId);
    await renderProducerJson(body);
    navigateStage("Authorization");

    const packet = screen.getByText("Approver decision packet").closest("section");
    if (!packet) throw new Error("Approver decision packet section was not rendered.");
    expect(packet.textContent).toContain(`${body.record.amount} ${body.record.currency}`);
    expect(packet.textContent).toContain(`${body.settlement_proxy.preflight.amount} ${body.settlement_proxy.preflight.asset}`);
    expect(packet.textContent).toContain("ARC_TESTNET");
    expect(packet.textContent).toContain("OUTSTANDING");
    expect(packet.textContent).not.toContain("No current assessment is available in this detail");
    expect(packet.textContent).toContain("Authorization records approval only. Assurance and execution remain separately gated; approval does not submit payment.");
    expect(packet.textContent).toContain("Approved instruction is sealed for the Arc Testnet settlement proxy.");
    expect(packet.textContent).toContain("Source obligation amount");
    expect(packet.textContent).toContain("Exact testnet settlement");
    expect(packet.textContent).toMatch(/Arc Testnet settlement proxy · 0x[0-9a-f]{4}…[0-9a-f]{4}/i);
    expect(packet.textContent).not.toContain(body.settlement_proxy.preflight.destination_wallet.address);
    expect(packet.closest("main")?.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(0);
  });

  it("shows persisted assurance controls and plain PAE state on Screen 4", async () => {
    const fixture = await preparedAuthorizedState();
    const body = await detailJson(fixture.state, fixture.selectedId);
    await renderProducerJson(body);
    navigateStage("Assurance");

    const assurance = screen.getByRole("region", { name: "Deterministic assurance result" });
    expect(assurance.textContent).toMatch(/ASSURANCE PASSED|Historical assurance evidence/);
    expect(assurance.textContent).toContain("Human financial authorization is recorded");
    expect(assurance.textContent).toContain("Payment amount matches the approved instruction");
    expect(assurance.textContent).toContain("Payment instruction state: Sealed · single use");
    expect(assurance.textContent).not.toContain("SK-");
    expect(assurance.textContent).not.toContain(body.assurance_evidence.assurance_id);
    expect(screen.getByText("Developer & audit evidence").closest("details")?.open).toBe(false);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("gives Screen 5 a concise execution status while retaining the exact single submission path", async () => {
    const fixture = await preparedAuthorizedState();
    const body = await detailJson(fixture.state, fixture.selectedId);
    body.execution_gate = "PRIME_AUTHORIZED_EXACT_PACKET";
    body.execution_packet = { packet_sha256: "e".repeat(64), packet: { obligation_id: fixture.selectedId } };
    body.sealed_pae_instruction_hash = "d".repeat(64);
    await renderProducerJson(body);
    navigateStage("Payment");

    const payment = screen.getByRole("region", { name: "Payment status" });
    expect(payment.textContent).toContain(`${body.settlement_proxy.preflight.amount} ${body.settlement_proxy.preflight.asset} · ${body.settlement_proxy.preflight.network}`);
    expect(payment.textContent).toContain("No execution has been recorded for this instruction.");
    expect(screen.getByRole("textbox", { name: /Confirm exact testnet intent/ })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Execute Test Payment" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]')).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("uses a single recovery card with record-scoped submission evidence and a human-readable reconciliation receipt", async () => {
    const fixture = await preparedAuthorizedState();
    const body = await detailJson(fixture.state, fixture.selectedId);
    body.execution = {
      status: "BLOCKED",
      provider_ref: null,
      idempotency_key: "instruction-replay-key",
      atomic_amount: "125000000",
      destination_address: body.settlement_proxy.preflight.destination_wallet.address,
      provider_evidence: null,
    };
    body.aggregate.execution_state = "BLOCKED";
    body.truth.tameion_control_truth.execution_state = "BLOCKED";
    const { main } = await renderProducerJson(body);
    navigateStage("Payment");
    const recovery = screen.getByRole("region", { name: "Exception recovery" });
    expect(screen.getByRole("region", { name: "Payment status" }).textContent).toContain("Execution is blocked. No successful settlement is established by this record.");
    expect(recovery.textContent).toContain("No provider reference is recorded for this instruction.");
    expect(recovery.textContent).toContain("External provider status is not established by this record.");
    expect(recovery.textContent).not.toMatch(/before provider submission|provider submissions\s*[:=]\s*0|zero provider submissions/i);
    expect(main.querySelectorAll('[aria-label="Exception recovery"]')).toHaveLength(1);

    cleanup();
    const currentPacket = getCurrentSettlementProxyPacket(fixture.state, fixture.selectedId);
    expect(currentPacket).toBeTruthy();
    process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 = currentPacket!.packet_sha256;
    const reconciliationBase = await detailJson(fixture.state, fixture.selectedId);
    const exactPacket = reconciliationBase.execution_packet!.packet!;
    const expectedAmount = exactPacket.settlement_amount as string;
    const expectedDecimals = exactPacket.provider_token.decimals as number;
    const [whole, fractional = ""] = expectedAmount.split(".");
    const expectedAtomic = (BigInt(whole) * 10n ** BigInt(expectedDecimals) + BigInt((fractional + "0".repeat(expectedDecimals)).slice(0, expectedDecimals) || "0")).toString();
    const expectedDestination = exactPacket.circle_arc_execution_instruction.destination_address as string;
    const reconciled = {
      ...reconciliationBase,
      aggregate: { ...reconciliationBase.aggregate, state: "RECONCILED", execution_state: "SETTLED", pae_state: "CONSUMED" },
      truth: {
        ...reconciliationBase.truth,
        tameion_control_truth: { ...reconciliationBase.truth.tameion_control_truth, aggregate_state: "RECONCILED", execution_state: "SETTLED", pae_state: "CONSUMED" },
      },
      execution: {
        status: "SETTLED",
        provider_ref: "mock-provider-reference",
        idempotency_key: exactPacket.pae.idempotency_key,
        atomic_amount: expectedAtomic,
        destination_address: expectedDestination,
        provider_evidence: {
          status: "CONFIRMED",
          atomic_amount: expectedAtomic,
          destination_address: expectedDestination,
          reconciled_at: "2026-10-07T12:00:00.000Z",
        },
      },
    };
    await renderProducerJson(reconciled);
    navigateStage("Reconciliation");
    const receipt = screen.getByRole("region", { name: "Reconciliation receipt" });
    expect(receipt.textContent).toContain(`${body.settlement_proxy.preflight.amount} ${body.settlement_proxy.preflight.asset}`);
    expect(receipt.textContent).toContain("ARC_TESTNET");
    expect(receipt.textContent).toContain("Exact amount verificationconfirmed");
    expect(receipt.textContent).toContain("Exact destination verificationconfirmed");
    expect(receipt.textContent).toContain("TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION");
    expect(receipt.textContent).toContain("OUTSTANDING · remains outstanding in the source record");
  });

  it.each([
    ["SUBMITTING", "Submission is in progress. Provider outcome has not been reconciled; continue with read-only reconciliation for this same intent. Do not resubmit."],
    ["SUBMITTED", "Submission is recorded. Provider outcome is awaiting reconciliation for this same intent; reconcile read-only and do not resubmit."],
  ] as const)("renders the recorded %s execution as pending reconciliation from the detail GET", async (status, expectedReceipt) => {
    const fixture = await preparedAuthorizedState();
    const body = await detailJson(fixture.state, fixture.selectedId);
    body.aggregate = { ...body.aggregate, pae_state: "SUBMITTED", execution_state: status };
    body.truth.tameion_control_truth = {
      ...body.truth.tameion_control_truth,
      pae_state: "SUBMITTED",
      execution_state: status,
      execution_release_authority: "SUBMITTED_TO_PROVIDER",
    };
    body.execution = {
      status,
      provider_ref: null,
      idempotency_key: "pending-producer-consumer-instruction",
      atomic_amount: body.settlement_proxy.preflight.atomic_amount,
      destination_address: body.settlement_proxy.preflight.destination_wallet.address,
      provider_evidence: null,
    };

    await renderProducerJson(body);
    navigateStage("Reconciliation");
    const receipt = screen.getByRole("region", { name: "Reconciliation receipt" });
    expect(receipt.textContent).toContain(expectedReceipt);
    expect(receipt.textContent).not.toContain("No Tameion execution record is recorded for this instruction");
    expect(receipt.textContent).toContain("No provider reference is recorded for this instruction");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
});
