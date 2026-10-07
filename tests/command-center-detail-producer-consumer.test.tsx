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
import { CommandCenter, useExecutionConfirmation } from "../app/command-center";
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
    expect(screen.getByRole("list", { name: "Payment lifecycle" }).querySelector('[aria-current="step"]')?.textContent).toContain("Assurance");
    expect(screen.getByTestId("current-next-step").textContent).toContain(
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

    fireEvent.click(obligationRow(otherId));
    await waitFor(() => expect(obligationRow(otherId).getAttribute("aria-current")).toBe("true"));
    fireEvent.click(obligationRow(fixture.selectedId));
    await waitFor(() => expect(obligationRow(fixture.selectedId).getAttribute("aria-current")).toBe("true"));
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
    fireEvent.click(obligationRow(otherId));
    await waitFor(() => expect(obligationRow(otherId).getAttribute("aria-current")).toBe("true"));
    fireEvent.click(obligationRow(fixture.selectedId));
    await waitFor(() => expect(obligationRow(fixture.selectedId).getAttribute("aria-current")).toBe("true"));
    expect(screen.queryByRole("textbox", { name: /Confirm exact testnet intent/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit this exact Arc Testnet proxy intent" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: "Obligation" }));
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
    const expectedStoredOrder = cold.getAuthorizationArtifacts(fixture.selectedId)!.assurance_record.control_results.map((control) => control.control_id);
    await renderProducerJson(coldGet);
    fireEvent.click(screen.getByRole("button", { name: "Assurance" }));
    const actionBeforeEvidence = screen.getByRole("main").querySelector('button[data-primary-action="true"]')?.textContent ?? null;
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
    expect(obligationRow(prepared.selectedId).textContent).toContain("Authorized · sealed PAE");
    expect(obligationRow(prepared.selectedId).textContent).not.toContain("Assessment required");
    expect(authorizedMain.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Assurance" }));
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
    expect((screen.getByRole("button", { name: "Assurance" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByText("Developer & audit evidence").closest("details") as HTMLDetailsElement).open).toBe(false);
    expect(screen.queryByText(/Stored assurance evidence/)).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps the genuine initial obligation view concise and its secondary evidence closed", async () => {
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
    expect(source.textContent).not.toContain(body.record.commercial_terms);

    const lifecycle = screen.getByRole("list", { name: "Payment lifecycle" });
    expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain("Obligation");
    expect(main.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(1);
    expect(main.querySelector('button[data-primary-action="true"]')?.textContent).toContain("Run AI Assessment");

    const activity = screen.getByText(/Activity & evidence/).closest("details") as HTMLDetailsElement;
    const developer = screen.getByText("Developer & audit evidence").closest("details") as HTMLDetailsElement;
    expect(activity.open).toBe(false);
    expect(developer.open).toBe(false);
    expect(developer.querySelectorAll("details[open]")).toHaveLength(0);
    const additionalTools = screen.getByText("Additional tools").closest("details") as HTMLDetailsElement;
    expect(additionalTools.open).toBe(false);
    expect(additionalTools.querySelector("button")?.textContent).toContain("Operational Report");
    expect(screen.queryByText("Demo tools", { exact: true })).toBeTruthy();
    expect(screen.queryByText("Demonstrations", { exact: true })).toBeNull();

    const queueRow = document.querySelector(`button[data-obligation-id="${first.obligation_id}"]`) as HTMLButtonElement;
    expect(queueRow).toBeTruthy();
    expect(queueRow.textContent).toContain(`${first.amount} ${first.currency}`);
    expect(queueRow.textContent).not.toContain(first.obligation_id);
    expect(queueRow.textContent).not.toContain(first.commercial_terms);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps assessment coverage advisory and aggregate version in collapsed technical evidence", async () => {
    const unassessed = new DemoState();
    const firstSource = unassessed.liveUsageRecords[0];
    if (!firstSource) throw new Error("Frozen source set is empty.");
    const unassessedBody = await detailJson(unassessed, firstSource.obligation_id);
    const unassessedQueue = await listJson(unassessed);
    const { main: unassessedMain } = await renderProducerJson(unassessedBody, [], unassessedQueue);
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    expect(unassessedMain.textContent).toContain("The result is advisory and cannot authorize or execute payment.");
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
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));

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
    if (expectedOwner) expect(card.textContent).toContain(`Next owner/role: ${expectedOwner}`);
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
    fireEvent.click(screen.getByRole("button", { name: "Review current PAY assessment" }));

    const card = await screen.findByRole("region", { name: "Assessment result" });
    const reassess = within(card).getByRole("button", { name: "Run AI Assessment again" }) as HTMLButtonElement;
    expect(reassess.disabled).toBe(false);
    expect(reassess.className).toMatch(/min-h-\[44px\]/);
    expect(reassess.className).not.toMatch(/underline/);
    expect(main.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(1);
    expect(main.querySelector('button[data-primary-action="true"]')?.textContent).toContain("Run AI Assessment again");
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
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));

    expect(screen.queryByRole("button", { name: "Run AI Assessment again" })).toBeNull();
    expect(main.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(0);
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
    expect(obligationRow(fixture.selectedId).textContent).toContain("Authorization recorded · no sealed PAE");
    expect(obligationRow(fixture.selectedId).textContent).not.toContain("Assessment required");
    expect(main.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(0);
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
    expect(main.querySelectorAll('button[data-primary-action="true"]')).toHaveLength(0);
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
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));

    const packet = screen.getByText("Approver decision packet").closest("section");
    if (!packet) throw new Error("Approver decision packet section was not rendered.");
    expect(packet.textContent).toContain(`${body.record.amount} ${body.record.currency}`);
    expect(packet.textContent).toContain(`${body.settlement_proxy.preflight.amount} ${body.settlement_proxy.preflight.asset}`);
    expect(packet.textContent).toContain("ARC_TESTNET");
    expect(packet.textContent).toContain("OUTSTANDING");
    expect(packet.textContent).toContain("No current assessment is available in this detail");
    expect(packet.textContent).toContain("Authorization records approval for the reviewed obligation. Assurance and execution remain separately gated; authorization alone does not submit a payment.");
    expect(packet.textContent).not.toContain(body.settlement_proxy.preflight.destination_wallet.address);
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
    const recovery = screen.getByRole("region", { name: "Exception recovery" });
    expect(recovery.textContent).toContain("Arc Testnet execution is blocked");
    expect(recovery.textContent).toContain("No provider reference is recorded for this instruction.");
    expect(recovery.textContent).toContain("External provider status is not established by this record.");
    expect(recovery.textContent).not.toMatch(/before provider submission|provider submissions\s*[:=]\s*0|zero provider submissions/i);
    expect(main.querySelectorAll('[aria-label="Exception recovery"]')).toHaveLength(1);

    cleanup();
    const reconciled = {
      ...body,
      aggregate: { ...body.aggregate, state: "RECONCILED", execution_state: "SETTLED", pae_state: "CONSUMED" },
      truth: {
        ...body.truth,
        tameion_control_truth: { ...body.truth.tameion_control_truth, aggregate_state: "RECONCILED", execution_state: "SETTLED", pae_state: "CONSUMED" },
      },
      execution: {
        status: "SETTLED",
        provider_ref: "mock-provider-reference",
        idempotency_key: "instruction-replay-key",
        atomic_amount: "125000000",
        destination_address: body.settlement_proxy.preflight.destination_wallet.address,
        provider_evidence: {
          status: "CONFIRMED",
          atomic_amount: "125000000",
          destination_address: body.settlement_proxy.preflight.destination_wallet.address,
          reconciled_at: "2026-10-07T12:00:00.000Z",
        },
      },
    };
    await renderProducerJson(reconciled);
    fireEvent.click(screen.getByRole("button", { name: "Reconciliation" }));
    const receipt = screen.getByRole("region", { name: "Reconciliation receipt" });
    expect(receipt.textContent).toContain(`${body.settlement_proxy.preflight.amount} ${body.settlement_proxy.preflight.asset}`);
    expect(receipt.textContent).toContain("ARC_TESTNET");
    expect(receipt.textContent).toContain("Amount matchconfirmed");
    expect(receipt.textContent).toContain("Destination matchconfirmed");
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
    fireEvent.click(screen.getByRole("button", { name: "Reconciliation" }));
    const receipt = screen.getByRole("region", { name: "Reconciliation receipt" });
    expect(receipt.textContent).toContain(expectedReceipt);
    expect(receipt.textContent).not.toContain("No Tameion execution record is recorded for this instruction");
    expect(receipt.textContent).toContain("No provider reference is recorded for this instruction");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });
});
