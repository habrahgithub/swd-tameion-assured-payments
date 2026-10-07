/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

const stateMocks = vi.hoisted(() => ({ getDemoState: vi.fn() }));
vi.mock("../src/server/demo-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/demo-state")>();
  return { ...actual, getDemoState: stateMocks.getDemoState };
});

import { GET as getObligationDetail } from "../app/api/obligations/[id]/route";
import { CommandCenter, useExecutionConfirmation } from "../app/command-center";
import { DEMO_ORGANIZATION_ID, DemoState } from "../src/server/demo-state";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { ArcCircleProviderAdapter, type J2aCircleClient } from "../src/execution/provider-adapter";
import { J2A_DEMO_DESTINATION, J2A_DEMO_SOURCE, J2A_DEMO_WALLET_SET_ID, runJ2aReadOnlyPreflight } from "../src/demo/real-testnet-payment";
import { getCurrentSettlementProxyPacket } from "../src/server/settlement-proxy-packet";
import { currentAssessmentReview, sealTestAssessment } from "./test-support/seal-assessment";

const originalPrimePacketHash = process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256;
const signingKeyId = "SETTLEMENT-PROXY-ROUTE-TEST-KEY";
const exactConfirmation = "SUBMIT EXACT TESTNET SETTLEMENT PROXY";
const fetchMock = vi.fn<typeof fetch>();

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

async function detailJson(state: DemoState, obligationId: string) {
  stateMocks.getDemoState.mockResolvedValue(state);
  const response = await getObligationDetail(
    new Request(`http://localhost/api/obligations/${obligationId}`),
    { params: Promise.resolve({ id: obligationId }) },
  );
  expect(response.status).toBe(200);
  return response.json();
}

async function renderProducerJson(body: Record<string, unknown>, additionalBodies: Record<string, unknown>[] = []) {
  const bodies = new Map([body, ...additionalBodies].map((entry) => {
    const record = entry.record as { obligation_id: string };
    return [record.obligation_id, entry] as const;
  }));
  const summary = (entry: Record<string, unknown>) => {
    const record = entry.record as { obligation_id: string; amount: string; currency: string };
    return {
      obligation_id: record.obligation_id,
      service_category: "SOFTWARE_SERVICES",
      amount: record.amount,
      currency: record.currency,
      recurrence: "MONTHLY",
      due_date: "2026-10-10",
      commercial_terms: "Net 30",
      assessed: false,
      decision: null,
      provider_mode: null,
    };
  };
  fetchMock.mockImplementation((input, init) => {
    const url = String(input);
    if (init?.method === "POST") {
      return Promise.resolve(new Response(JSON.stringify({ accepted: true }), { status: 200 }));
    }
    if (url === "/api/obligations") {
      return Promise.resolve(new Response(JSON.stringify({ obligations: [...bodies.values()].map(summary) }), { status: 200 }));
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
    expect(screen.getByRole("heading", { name: "PAE sealed · no current exact packet" })).toBeTruthy();
    expect(screen.getByRole("list", { name: "Payment lifecycle" }).textContent).toContain(
      "No current exact execution packet is available. Payment authority must be re-established before submission.",
    );
    expect(screen.getByTestId("current-next-step").textContent).toContain(
      "No current exact execution packet is available. Payment authority must be re-established before submission.",
    );
    expect(screen.getByTestId("current-next-step").textContent).toContain("Unassigned · no permitted product action is available");
    expect(screen.getByTestId("current-next-step").textContent).not.toContain("Prime · exact-packet authorization");
    expect(main.querySelector('button[data-primary-action="true"]')).toBeNull();
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
    fireEvent.change(screen.getByRole("textbox", { name: /Confirm exact testnet intent/ }), { target: { value: exactConfirmation } });
    expect(screen.getByRole("button", { name: "Submit this exact Arc Testnet proxy intent" })).toBeTruthy();

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

    fireEvent.click(screen.getByRole("button", { name: new RegExp(otherId) }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected source obligation" }).textContent).toContain(otherId));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(fixture.selectedId) }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected source obligation" }).textContent).toContain(fixture.selectedId));
    expect(screen.getByTestId("current-next-step").textContent).toMatch(/payment authority is revoked/i);
    expect(screen.getByTestId("current-next-step").textContent).toContain("Unassigned · no permitted product action is available");
    expect(screen.getByTestId("current-next-step").textContent).not.toContain("exact packet gate passed");
    expect(main.querySelector('button[data-primary-action="true"]')).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Confirm exact testnet intent/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit this exact Arc Testnet proxy intent" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
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
    const submit = () => screen.getByRole("button", { name: "Submit this exact Arc Testnet proxy intent" });
    const confirm = () => screen.getByRole("textbox", { name: /Confirm exact testnet intent/ });

    fireEvent.change(confirm(), { target: { value: exactConfirmation } });
    expect(submit().hasAttribute("disabled")).toBe(false);

    fixture.state.store.activateKillSwitch("TRANSACTION_DISABLED", fixture.selectedId);
    const suspended = await detailJson(fixture.state, fixture.selectedId);
    expect(suspended.execution_kill_switched).toBe(true);
    setDetailBody(suspended);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(otherId) }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected source obligation" }).textContent).toContain(otherId));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(fixture.selectedId) }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected source obligation" }).textContent).toContain(fixture.selectedId));
    expect(screen.queryByRole("textbox", { name: /Confirm exact testnet intent/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit this exact Arc Testnet proxy intent" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);

    fixture.state.store.deactivateKillSwitch("TRANSACTION_DISABLED", fixture.selectedId);
    const recovered = await detailJson(fixture.state, fixture.selectedId);
    expect(recovered.execution_kill_switched).toBe(false);
    expect(recovered.execution_gate).toBe("PRIME_AUTHORIZED_EXACT_PACKET");
    setDetailBody(recovered);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(otherId) }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected source obligation" }).textContent).toContain(otherId));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(fixture.selectedId) }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected source obligation" }).textContent).toContain(fixture.selectedId));
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
    expect(screen.getByTestId("current-next-step").textContent).toContain("Prime · exact-packet authorization");
    expect(screen.queryByRole("button", { name: "Submit this exact Arc Testnet proxy intent" })).toBeNull();
    cleanup();
    fetchMock.mockReset();
    process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 = packet!.packet_sha256;

    const openGate = await detailJson(fixture.state, fixture.selectedId);
    expect(openGate.execution_gate).toBe("PRIME_AUTHORIZED_EXACT_PACKET");
    await renderProducerJson(openGate);
    const submit = screen.getByRole("button", { name: "Submit this exact Arc Testnet proxy intent" });
    const confirmation = screen.getByRole("textbox", { name: /Confirm exact testnet intent/ }) as HTMLInputElement;
    fireEvent.change(confirmation, { target: { value: exactConfirmation } });
    expect(submit.hasAttribute("disabled")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));
    fireEvent.click(screen.getByRole("button", { name: "Obligations" }));
    expect((screen.getByRole("textbox", { name: /Confirm exact testnet intent/ }) as HTMLInputElement).value).toBe(exactConfirmation);
    expect(screen.getByRole("button", { name: "Submit this exact Arc Testnet proxy intent" }).hasAttribute("disabled")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Submit this exact Arc Testnet proxy intent" }));
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
});
