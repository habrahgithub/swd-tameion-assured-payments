/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";

const stateMocks = vi.hoisted(() => ({ getDemoState: vi.fn() }));
vi.mock("../src/server/demo-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/server/demo-state")>();
  return { ...actual, getDemoState: stateMocks.getDemoState };
});

import { GET as getObligationDetail } from "../app/api/obligations/[id]/route";
import { GET as getObligationList } from "../app/api/obligations/route";
import { POST as approveObligation } from "../app/api/obligations/[id]/approve/route";
import { CommandCenter, useExecutionConfirmation } from "../app/command-center";
import { DEMO_ORGANIZATION_ID, DemoState } from "../src/server/demo-state";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { ArcCircleProviderAdapter, type J2aCircleClient } from "../src/execution/provider-adapter";
import { J2A_DEMO_DESTINATION, J2A_DEMO_SOURCE, J2A_DEMO_WALLET_SET_ID, runJ2aReadOnlyPreflight } from "../src/demo/real-testnet-payment";
import { getCurrentSettlementProxyPacket } from "../src/server/settlement-proxy-packet";
import { projectAssuranceEvidence } from "../src/server/assurance-evidence-projection";
import { sealDurableAssuranceRecord } from "../src/pae/durable-records";
import { sealPae } from "../src/pae/sign-verify";
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
    await renderProducerJson({
      ...openGate,
      assurance_evidence: { state: "UNAVAILABLE", message: "Assurance evidence is expected but unavailable.", control_results: [] },
    });
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
    const changedAssurance = sealDurableAssuranceRecord({ ...artifacts.assurance_record, control_results: changedControls });
    const signingKey = signer;
    const changedPae = sealPae({ ...artifacts.sealed_pae.payload, assurance_hash: changedAssurance.assurance_hash }, signingKey.privateKey);
    const passWithBlockedControl = projectAssuranceEvidence({
      ...base,
      sealedPae: changedPae,
      authorizationArtifacts: {
        ...artifacts,
        assurance_record: changedAssurance.record,
        assurance_hash: changedAssurance.assurance_hash,
        sealed_pae: changedPae,
      },
    });
    expect(passWithBlockedControl.state).toBe("INVALID");
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
      { label: "failed", aggregate: { ...base.aggregate, pae_state: "REVOKED", execution_state: "BLOCKED" }, executionReleaseAuthority: "BLOCKED", execution: { status: "BLOCKED" }, executionKillSwitched: false },
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
    const winner = screen.getByRole("button", { name: new RegExp(eligible.selectedId) });
    expect(winner.textContent).toContain("Sole PAY candidate");
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
    expect(screen.getByRole("button", { name: new RegExp(prepared.selectedId) }).textContent).toContain("Authorized · sealed PAE");
    expect(screen.getByRole("button", { name: new RegExp(prepared.selectedId) }).textContent).not.toContain("Assessment required");
    expect(authorizedMain.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Assurance & Execution" }));
    expect(screen.getByText("View assurance evidence").closest("details")?.open).toBe(false);
    cleanup();

    const postProxy = await proxyPreparedWithoutCurrentAssessment();
    const postProxyDetail = await detailJson(postProxy.state, postProxy.selectedId);
    expect(postProxyDetail.pae_sealed).toBe(false);
    expect(postProxyDetail.execution).toBeNull();
    expect(postProxyDetail.truth.tameion_control_truth.pae_state).toBe("REVOKED");
    expect(postProxyDetail.assurance_evidence.state).toBe("NOT_CREATED");
    const postProxyQueue = await listJson(postProxy.state);
    const { main: postProxyMain } = await renderProducerJson(postProxyDetail, [], postProxyQueue);
    expect(screen.getByText("Current position · Assessment")).toBeTruthy();
    expect(screen.getByTestId("current-next-step").textContent).toContain("fresh assessment for the prepared Arc Testnet proxy");
    expect(screen.getByTestId("current-next-step").textContent).not.toMatch(/PAE.*revoked|sealed.*revoked/i);
    expect(postProxyMain.querySelector('button[data-primary-action="true"]')?.textContent).toContain("Run AI Assessment");
    fireEvent.click(screen.getByRole("button", { name: "Assurance & Execution" }));
    expect(screen.getByText("No assurance PASS evidence exists for this state.")).toBeTruthy();
    expect(screen.getByText("View assurance evidence").closest("details")?.open).toBe(false);
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
    expect(screen.getByText("Current position · Assurance")).toBeTruthy();
    expect(screen.getByRole("button", { name: new RegExp(fixture.selectedId) }).textContent).toContain("Authorization recorded · no sealed PAE");
    expect(screen.getByRole("button", { name: new RegExp(fixture.selectedId) }).textContent).not.toContain("Assessment required");
    expect(main.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(0);
    expect(fixture.api.createTransaction).not.toHaveBeenCalled();
  });
});
