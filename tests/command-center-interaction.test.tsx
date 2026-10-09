/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";

import { CommandCenter } from "../app/command-center";

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

function openAdditionalTools() {
  const summary = screen.getByText("Additional tools");
  const disclosure = summary.closest("details") as HTMLDetailsElement;
  if (!disclosure.open) fireEvent.click(summary);
}

/** Existing interaction cases exercise selected-stage behavior. They now
 * model the operator explicitly choosing the first fixture row after the
 * unselected entry screen has loaded. The dedicated entry test uses rtlRender
 * directly and asserts that no row is selected by default. */
function renderWithExplicitFirstSelection() {
  const result = rtlRender(<CommandCenter />);
  void waitFor(() => {
    const main = screen.getByRole("main");
    const row = main.querySelector<HTMLButtonElement>("button[data-obligation-id]");
    if (row) return row;
    if (/No genuine obligations|Genuine obligations are unavailable/.test(main.textContent ?? "")) return null;
    throw new Error("Waiting for a genuine obligation row before explicit selection.");
  }).then((row) => {
    if (row && row.getAttribute("aria-current") !== "true") fireEvent.click(row);
  }).catch(() => {});
  return result;
}

type Obligation = {
  obligation_id: string;
  service_category: string;
  amount: string;
  currency: "USD" | "AED";
  recurrence: string;
  due_date: string;
  commercial_terms: string;
  assessed: boolean;
  decision: "PAY" | "HOLD" | "ESCALATE" | null;
  provider_mode: "NOT_LIVE_AI" | null;
};

function obligation(id: string, assessed = false, currency: "USD" | "AED" = "USD"): Obligation {
  return {
    obligation_id: id,
    service_category: "TEST_SERVICE",
    amount: "125.00",
    currency,
    recurrence: "MONTHLY",
    due_date: "2026-10-05",
    commercial_terms: "Net 30",
    assessed,
    decision: assessed ? "HOLD" : null,
    provider_mode: assessed ? "NOT_LIVE_AI" : null,
  };
}

function detail(id: string): Record<string, any> {
  return {
    truth: {
      source_truth: {
        role: "SOURCE_OF_RECORD",
        source: {
          source_kind: "DIRECT_EVIDENCE",
          source_system_id: "TEST-SOURCE",
          record_type: "PAYABLE_OBLIGATION",
          record_id: `RECORD-${id}`,
          record_version: "1",
          approval_state: "APPROVED",
          execution_authority: "NONE",
        },
        obligation_state: "APPROVED_FOR_PAYMENT",
      },
      tameion_control_truth: {
        role: "ASSURED_PAYMENT_CONTROL_PLANE",
        aggregate_version: 1,
        aggregate_state: "APPROVAL_PENDING",
        assessment_state: "NOT_ASSESSED",
        pae_state: "UNUSED",
        pae_sealed: false,
        execution_state: "NONE",
        execution_kill_switched: false,
        execution_release_authority: "NOT_GRANTED",
      },
      settlement_truth: {
        role: "SETTLEMENT_PROVIDER",
        provider_target: "CIRCLE_DCW",
        network: "ARC_TESTNET",
        runtime: "SIMULATED",
        status: "NOT_SUBMITTED",
        provider_ref: null,
        settlement_amount: "125.000000",
        settlement_atomic_amount: "125000000",
        source_amount: "125.00",
        source_currency: "USD",
        settlement_conversion_rate: null,
      },
    },
    aggregate: {
      aggregate_version: 1,
      state: "APPROVAL_PENDING",
      amount: "125.000000",
      asset: "USDC",
      network: "ARC_TESTNET",
      destination_address: "0x1111111111111111111111111111111111111111",
      destination_verification_status: "UNVERIFIED",
      destination_operational_status: "UNVERIFIED",
      source_wallet_ref: "TEST-WALLET",
      source_wallet_status: "INACTIVE",
      product_trust_provenance: "UNVERIFIED",
      execution_state: "NONE",
      pae_state: "UNUSED",
    },
    record: { obligation_id: id, amount: "125.00", currency: "USD" },
    current_assessment: null,
    demo_arc_trust_simulated: false,
    pae_sealed: false,
    execution: null,
    settlement_proxy: null,
    source_settlement_disclosure: "Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.",
    source_payable_state: "OUTSTANDING",
    execution_packet: null,
    execution_gate: "LOCKED_UNTIL_CURRENT_AUTHORIZATION",
    execution_kill_switched: false,
  };
}

function proxyPrepared(value: ReturnType<typeof detail>) {
  value.settlement_proxy = {
    source_aggregate_version: 1,
    mapped_aggregate_version: value.aggregate.aggregate_version,
    preflight: {
      profile: "GENUINE_OBLIGATION_ARC_TESTNET_PROXY",
      organization_id: "ORG-DEMO-001",
      obligation_id: value.record.obligation_id,
      source_amount: value.record.amount,
      source_currency: value.record.currency,
      amount: value.aggregate.amount,
      asset: "USDC",
      network: "ARC_TESTNET",
      source_wallet: { id: "testnet-source-id", address: "0x1111111111111111111111111111111111111111" },
      destination_wallet: { id: "testnet-proxy-id", address: "0x2222222222222222222222222222222222222222", name: "Arc Testnet settlement proxy" },
      captured_at: "2026-10-06T18:00:00.000Z",
      evidence_sha256: "b".repeat(64),
      max_network_fee: "0.002000",
      estimated_network_fee: "0.001000",
      max_total_debit: `${value.aggregate.amount}`,
    },
  };
  return value;
}

function assessedDetail(id: string, decision: "PAY" | "HOLD" | "ESCALATE"): Record<string, any> {
  const finding = decision === "PAY" ? null : {
    code: decision === "HOLD" ? "SOURCE_EVIDENCE_MISSING" : "OTHER_REQUIRES_HUMAN_REVIEW",
    severity: decision,
    reason: decision === "HOLD" ? "Source evidence is incomplete." : "Controller review is required.",
  };
  return {
    ...detail(id),
    current_assessment: {
      obligation_id: id,
      assessment_id: `ASM-${id}`,
      assessment_hash: "a".repeat(64),
      aggregate_version: "1",
      decision,
      reasons: [finding?.reason ?? "All required checks passed."],
      race: {
        result: {
          decision,
          decision_summary: finding?.reason ?? "Checks passed; advisory recommendation only.",
          validated_findings: finding ? [finding] : [],
        },
        action_taken: { summary: "Checks complete.", checks: ["Required checks evaluated."] },
        caveats: {
          missing_context: [],
          uncertainty_signal: false,
          model_proposed_findings: [],
          model_proposed_findings_authority: "NON_AUTHORITATIVE",
          model_explanation: "Test fixture explanation.",
          model_explanation_authority: "NON_AUTHORITATIVE",
        },
        evidence: {
          evidence_ids: ["TEST-EVIDENCE-1"],
          authoritative_facts: {
            obligation_id: id,
            aggregate_version: "1",
            amount: "125.00",
            currency: "USD",
            due_date: null,
            due_date_status: "NOT_STATED_ON_SOURCE",
            due_date_position: "NOT_STATED",
            as_of_date: "2026-10-04",
            state_at_event_baseline: "OUTSTANDING",
            business_purpose_confirmed: true,
            source_evidence_present: decision !== "HOLD",
            destination_status: "READY",
          },
        },
        remediation: finding ? [{
          finding_code: finding.code,
          reason: finding.reason,
          required_action: "Review the finding.",
          required_evidence: ["Supporting document"],
          owner_role: "Accounts Payable",
          reassess_after_resolution: decision === "HOLD",
          ...(decision === "ESCALATE" ? { escalation_target: "Finance controller" } : {}),
        }] : [],
        prompt_identity: { version: "care-v1", sha256: "a".repeat(64) },
      },
    },
  };
}

function staleAssessmentDetail(id: string): Record<string, any> {
  const value = assessedDetail(id, "PAY");
  value.aggregate.aggregate_version = 2;
  value.truth.tameion_control_truth.aggregate_version = 2;
  value.current_assessment.aggregate_version = "1";
  return value;
}

function sealedDetail(id: string) {
  const sealed = assessedDetail(id, "PAY");
  sealed.pae_sealed = true;
  sealed.truth.tameion_control_truth.pae_sealed = true;
  sealed.truth.tameion_control_truth.pae_state = "SEALED";
  sealed.truth.tameion_control_truth.execution_release_authority = "TAMEION_PAE_REVERIFY_REQUIRED";
  sealed.aggregate.pae_state = "SEALED";
  return sealed;
}

function approvedNPlusOneDetail(id: string, paeSealed: boolean) {
  const approved = proxyPrepared(assessedDetail(id, "PAY"));
  approved.aggregate.aggregate_version = 2;
  approved.aggregate.state = "AUTHORIZED";
  approved.aggregate.pae_state = paeSealed ? "SEALED" : "UNUSED";
  approved.truth.tameion_control_truth.aggregate_version = 2;
  approved.truth.tameion_control_truth.aggregate_state = "AUTHORIZED";
  approved.truth.tameion_control_truth.assessment_state = "NOT_CURRENT";
  approved.truth.tameion_control_truth.pae_state = paeSealed ? "SEALED" : "UNUSED";
  approved.truth.tameion_control_truth.pae_sealed = paeSealed;
  approved.truth.tameion_control_truth.execution_state = "NONE";
  approved.truth.tameion_control_truth.execution_release_authority = paeSealed ? "TAMEION_PAE_REVERIFY_REQUIRED" : "NOT_GRANTED";
  approved.current_assessment = null;
  approved.pae_sealed = paeSealed;
  approved.execution = null;
  return approved;
}

function response(body: unknown, status = 200): Response {
  return new Response(body === null ? "" : JSON.stringify(body), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function invokeClickHandler(button: HTMLButtonElement): Promise<unknown> {
  const reactPropsKey = Object.keys(button).find((key) => key.startsWith("__reactProps$"));
  if (!reactPropsKey) throw new Error("React click callback is unavailable");
  const reactProps = (button as unknown as Record<string, { onClick?: () => unknown }>)[reactPropsKey];
  let operation: unknown;
  act(() => { operation = reactProps.onClick?.(); });
  return operation as Promise<unknown>;
}

describe("Command Center mounted Operational Report", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("starts unselected, lets the operator inspect all five source records, and never posts during selection", async () => {
    const ids = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005"];
    const rows = ids.map((id, index) => ({ ...obligation(id, true), decision: index === 2 ? "PAY" as const : "HOLD" as const }));
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: rows }));
      const id = url.split("/").at(-1)!;
      const index = ids.indexOf(id);
      const selectedDetail = assessedDetail(id, id === "OBL-J0C-003" ? "PAY" : "HOLD");
      selectedDetail.record.amount = `${index + 1}.00`;
      selectedDetail.record.beneficiary_name = `Source ${id}`;
      return Promise.resolve(response(selectedDetail));
    });

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(screen.getByRole("main").querySelectorAll("button[data-obligation-id]")).toHaveLength(5));
    expect(screen.getByRole("main").querySelectorAll('button[data-obligation-id][aria-current="true"]')).toHaveLength(0);
    expect(screen.getByTestId("current-next-step").querySelector("h3")?.textContent).toBe("Choose an obligation");
    expect(screen.getByTestId("current-next-step").textContent).toContain("Choose one obligation from the genuine queue");
    expect(screen.getByTestId("current-next-step").textContent).not.toMatch(/no genuine obligations|demo mode|loading/i);
    expect(screen.getByRole("main").textContent).not.toMatch(/no genuine obligations to show|open demo mode|loading genuine obligations/i);
    expect(screen.getByRole("main").querySelectorAll('[aria-label*="loading" i]')).toHaveLength(0);
    expect(screen.getByRole("main").querySelector('button[data-primary-action="true"]')?.textContent).toContain("Choose an obligation");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/obligations/") && String(input) !== "/api/obligations")).toHaveLength(0);

    for (const [index, id] of ids.entries()) {
      fireEvent.click(obligationRow(id));
      await waitFor(() => expect(obligationRow(id).getAttribute("aria-current")).toBe("true"));
      const selectedIdentity = screen.getByRole("region", { name: "Selected source obligation" });
      await waitFor(() => expect(selectedIdentity.textContent).toContain(`Source ${id}`));
      expect(selectedIdentity.textContent).toContain(`${index + 1}.00 USD`);
      expect(obligationRow(id).getAttribute("aria-current")).toBe("true");
    }
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("shows loading progress only until a genuine queue response arrives", async () => {
    const list = deferred<Response>();
    fetchMock.mockReturnValue(list.promise);

    rtlRender(<CommandCenter />);
    expect(screen.getAllByRole("status").every((status) => status.textContent?.includes("Loading genuine obligations"))).toBe(true);
    expect(screen.queryByText("Choose an obligation", { selector: "h3" })).toBeNull();
    expect(screen.queryByText("No genuine obligations", { selector: "h3" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose an obligation" })).toBeNull();
    expect(screen.getByRole("main").textContent).not.toMatch(/no genuine obligations to show|open demo mode/i);
    expect(screen.getByRole("main").querySelectorAll('[aria-label*="loading" i]')).toHaveLength(0);

    list.resolve(response({ obligations: [obligation("OBL-A")] }));
    await waitFor(() => expect(screen.getByTestId("current-next-step").querySelector("h3")?.textContent).toBe("Choose an obligation"));
    expect(screen.getByRole("main").querySelectorAll('button[data-obligation-id][aria-current="true"]')).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("shows a genuine empty-queue state only after a successful empty response", async () => {
    fetchMock.mockResolvedValue(response({ obligations: [] }));

    rtlRender(<CommandCenter />);
    expect(await screen.findByText("No genuine obligations", { selector: "h3" })).toBeTruthy();
    expect(screen.getByTestId("current-next-step").textContent).toContain("Refresh the genuine queue to check again");
    expect(screen.getByRole("main").textContent).not.toMatch(/demo mode|loading genuine obligations/i);
    expect(screen.getByRole("main").querySelectorAll('button[data-obligation-id]')).toHaveLength(0);
    expect(screen.getByRole("main").querySelectorAll('[aria-label*="loading" i]')).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps an unavailable genuine queue distinct from loading and empty", async () => {
    fetchMock.mockResolvedValue(response({ error: "Queue read unavailable" }, 503));

    rtlRender(<CommandCenter />);
    expect(await screen.findByText("Genuine obligations unavailable", { selector: "h3" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Genuine obligations are unavailable");
    expect(screen.getByTestId("current-next-step").textContent).toContain("Retry the queue");
    expect(screen.getByRole("main").textContent).not.toMatch(/no genuine obligations to show|open demo mode|loading/i);
    expect(screen.queryByText("Choose an obligation", { selector: "h3" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("does not let an old selected-action refresh clear a newer manual selection", async () => {
    const assessment = deferred<Response>();
    let listReads = 0;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations" && init?.method !== "POST") {
        listReads += 1;
        return Promise.resolve(response({ obligations: listReads === 1 ? [obligation("OBL-A"), obligation("OBL-B")] : [] }));
      }
      if (url === "/api/obligations/OBL-A/assess") return assessment.promise;
      if (url === "/api/obligations/OBL-A" || url === "/api/obligations/OBL-B") {
        const selectedDetail = detail(url.split("/").at(-1)!);
        selectedDetail.record.beneficiary_name = `Source ${selectedDetail.record.obligation_id}`;
        return Promise.resolve(response(selectedDetail));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(obligationRow("OBL-A").getAttribute("aria-current")).toBe("true"));
    await screen.findByRole("region", { name: "Selected source obligation" });
    const assess = await screen.findByRole("button", { name: "Run AI Assessment" });
    fireEvent.click(assess);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/OBL-A/assess") && init?.method === "POST")).toBe(true));

    const writesBeforeNavigation = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    fireEvent.click(obligationRow("OBL-B"));
    await waitFor(() => expect(obligationRow("OBL-B").getAttribute("aria-current")).toBe("true"));
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected source obligation" }).textContent).toContain("Source OBL-B"));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(writesBeforeNavigation);

    assessment.resolve(response({ error: "Assessment unavailable" }, 503));
    await waitFor(() => expect((screen.getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement).disabled).toBe(false));
    expect(obligationRow("OBL-B").getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("region", { name: "Selected source obligation" }).textContent).toContain("Source OBL-B");
    expect(listReads).toBe(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(writesBeforeNavigation);
  });

  it("keeps wallet refresh visibly disabled until operator authentication is verified", async () => {
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-FUNDING-AUTH")] }))
      : Promise.resolve(response(detail("OBL-FUNDING-AUTH"))));

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-FUNDING-AUTH")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-FUNDING-AUTH"));
    await screen.findByRole("region", { name: "Selected source obligation" });

    const funding = screen.getByRole("region", { name: "Wallet funding and payment readiness" });
    const refresh = within(funding).getByRole("button", { name: "Refresh Wallet Balance" }) as HTMLButtonElement;
    expect(refresh.disabled).toBe(true);
    expect(funding.textContent).toContain("USDC funding: NOT VERIFIED");
    expect(funding.textContent).toContain("AUTH_GATE_UNVERIFIED");
    expect(funding.textContent).toContain("operator access is not verified");
    const assessmentAction = within(screen.getByRole("region", { name: "Obligation next step" })).getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement;
    expect(assessmentAction.disabled).toBe(false);

    fireEvent.click(refresh);
    expect(fetchMock.mock.calls.some(([input]) => /balance|circle/i.test(String(input)))).toBe(false);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps loaded detail when the operator reselects the already-selected obligation", async () => {
    const rows = [obligation("OBL-J0C-001", true)];
    const selectedDetail = assessedDetail("OBL-J0C-001", "PAY");
    selectedDetail.record.beneficiary_name = "Stable selected source";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: rows }))
      : Promise.resolve(response(selectedDetail)));

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-J0C-001")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-J0C-001"));
    const selectedIdentity = screen.getByRole("region", { name: "Selected source obligation" });
    await waitFor(() => expect(selectedIdentity.textContent).toContain("Stable selected source"));
    const detailReads = fetchMock.mock.calls.filter(([input]) => String(input) === "/api/obligations/OBL-J0C-001").length;

    fireEvent.click(obligationRow("OBL-J0C-001"));

    expect(screen.getByRole("region", { name: "Selected source obligation" }).textContent).toContain("Stable selected source");
    expect(fetchMock.mock.calls.filter(([input]) => String(input) === "/api/obligations/OBL-J0C-001")).toHaveLength(detailReads);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("discards stale A→B→A detail responses and preserves the last explicit selection", async () => {
    const firstA = deferred<Response>();
    const onlyB = deferred<Response>();
    const currentA = deferred<Response>();
    let aRequests = 0;
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [obligation("OBL-A"), obligation("OBL-B")] }));
      const id = url.split("/").at(-1);
      if (id === "OBL-A") return ++aRequests === 1 ? firstA.promise : currentA.promise;
      return onlyB.promise;
    });

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-B")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-A"));
    fireEvent.click(obligationRow("OBL-B"));
    fireEvent.click(obligationRow("OBL-A"));
    await waitFor(() => expect(aRequests).toBe(2));

    const staleA = detail("OBL-A");
    staleA.record.beneficiary_name = "Stale first A";
    const staleB = detail("OBL-B");
    staleB.record.beneficiary_name = "Stale B";
    const latestA = detail("OBL-A");
    latestA.record.beneficiary_name = "Current final A";
    onlyB.resolve(response(staleB));
    firstA.resolve(response(staleA));
    currentA.resolve(response(latestA));

    const selectedIdentity = screen.getByRole("region", { name: "Selected source obligation" });
    await waitFor(() => expect(selectedIdentity.textContent).toContain("Current final A"));
    expect(selectedIdentity.textContent).not.toContain("Stale");
    expect(obligationRow("OBL-A").getAttribute("aria-current")).toBe("true");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps reports absent from Screen 1 until loaded assessment truth makes the secondary utility available", async () => {
    const list = deferred<Response>();
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      return url === "/api/obligations" ? list.promise : selectedDetail.promise;
    });

    renderWithExplicitFirstSelection();
    expect(screen.queryByText("Additional tools")).toBeNull();
    expect(screen.queryByText(/Operational Report/)).toBeNull();

    list.resolve(response({ obligations: [obligation("OBL-A", true)] }));
    await waitFor(() => expect(obligationRow("OBL-A")).toBeTruthy());
    expect(screen.queryByText("Additional tools")).toBeNull();
    selectedDetail.resolve(response(assessedDetail("OBL-A", "HOLD")));
    await waitFor(() => expect(screen.getByRole("main").querySelector('nav[aria-label="Payment lifecycle navigation"]')).not.toBeNull());
    openStageNavigator();
    await screen.findByRole("navigation", { name: "Payment lifecycle navigation" });
    openAdditionalTools();
    expect(screen.getByRole("button", { name: /Operational Report.*secondary/i })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
  });

  it("does not expose report controls while selected detail is loading or unavailable", async () => {
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A")] }))
      : selectedDetail.promise);

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(screen.getByTestId("current-next-step").textContent).toContain("Loading current obligation status."));
    expect(screen.queryByText("Additional tools")).toBeNull();
    expect(screen.queryByText(/Operational Report/)).toBeNull();
    selectedDetail.resolve(response(detail("OBL-A")));
    expect(await screen.findByRole("button", { name: "Run AI Assessment" })).toBeTruthy();
    expect(screen.queryByText("Additional tools")).toBeNull();
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
  });

  it("keeps Operational Report absent for a failed or empty initial queue", async () => {
    fetchMock
      .mockResolvedValueOnce(response(null, 503))
      .mockResolvedValueOnce(response({ obligations: [] }));

    renderWithExplicitFirstSelection();
    expect(await screen.findByText(/Genuine obligations are unavailable/)).toBeTruthy();
    expect(screen.queryByText("Additional tools")).toBeNull();
    expect(screen.queryByText(/Operational Report/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry genuine obligations" }));
    expect(await screen.findByText("No genuine obligations are currently available.")).toBeTruthy();
    expect(screen.queryByText("Additional tools")).toBeNull();
    expect(screen.queryByText(/Operational Report/)).toBeNull();
  });

  it("shows the selected detail unavailable state after a failed read", async () => {
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A")] }))
      : selectedDetail.promise);

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(screen.getByTestId("current-next-step").textContent).toContain("Loading current obligation status."));
    expect(screen.queryByText("Additional tools")).toBeNull();
    selectedDetail.resolve(response(null, 502));
    expect(await screen.findByText(/Selected obligation status is unavailable/)).toBeTruthy();
    expect(screen.queryByText("Additional tools")).toBeNull();
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
  });

  it("makes assessment the genuine obligation action and omits demo/report/technical surfaces from Screen 1", async () => {
    const aedDetail = detail("OBL-A");
    aedDetail.record.amount = "5760.00";
    aedDetail.record.currency = "AED";
    aedDetail.aggregate.amount = "1568.413887";
    aedDetail.demo_arc_trust_simulated = true;
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A", false, "AED")] }))
      : Promise.resolve(response(aedDetail)));

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(obligationRow("OBL-A")).toBeTruthy());
    const workspace = await screen.findByRole("region", { name: "Genuine obligation workspace" });
    const main = screen.getByRole("main");
    expect(main.getAttribute("dir")).toBe("ltr");
    expect(screen.queryByRole("navigation", { name: "Payment lifecycle navigation" })).toBeNull();
    expect(screen.queryByText("Demo tools")).toBeNull();
    expect(screen.queryByText("Developer & audit evidence")).toBeNull();
    expect(screen.queryByText(/Operational Report/)).toBeNull();
    expect(screen.getByRole("button", { name: "Run AI Assessment" })).toBeTruthy();
    const assess = screen.getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement;
    expect(assess.disabled).toBe(false);

    expect(workspace.textContent).toContain("Selected obligation");
    expect(workspace.textContent).not.toContain("indicative only");
    expect(workspace.textContent).not.toContain("1 USD = AED 3.6725");
    expect(workspace.textContent).not.toContain("Execution authority");
    expect(workspace.textContent).not.toContain("SIMULATED");
    expect(workspace.textContent).not.toContain("TEST-WALLET");
    expect(screen.queryByText("Demo tools")).toBeNull();
    expect(screen.queryByText("Developer & audit evidence")).toBeNull();
    expect(screen.queryByText(/Operational Report/)).toBeNull();
    fireEvent.click(assess);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/OBL-A/assess") && init?.method === "POST")).toBe(true));
  });

  it("announces the selected surface programmatically and gives refusal feedback alert semantics", async () => {
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [obligation("OBL-A")] }));
      if (url.endsWith("/assess") && init?.method === "POST") return Promise.resolve(response({ error: "Assessment unavailable." }, 503));
      return Promise.resolve(response(detail("OBL-A")));
    });
    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(screen.queryByRole("navigation", { name: "Payment lifecycle navigation" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Current stage: Obligation. Step 1 of 6." })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    const feedback = await screen.findByRole("status", { name: "Assessment request status" });
    expect(feedback.getAttribute("aria-live")).toBe("assertive");
    expect(feedback.textContent).toContain("Assessment unavailable.");
  });

  it.each([
    ["202 in progress", 202, { status: "IN_PROGRESS" }, "Completion not confirmed"],
    ["202 recovery pending", 202, { status: "RECOVERY_PENDING" }, "Provider result recorded"],
    ["409 unresolved", 409, { code: "ASM-UNKNOWN", error: "The provider outcome is unknown." }, "request key retained"],
    ["503 unavailable", 503, { code: "ASSESSMENT_UNAVAILABLE", error: "Assessment service unavailable." }, "request key retained"],
  ])("shows selected OBL-J0C-003 assessment feedback for %s on the Obligation and Assessment views", async (_label, status, payload, expectedDurability) => {
    const ids = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005"];
    const rows = ids.map((id) => ({ ...obligation(id, true), decision: "PAY" as const }));
    const selectedDetail = staleAssessmentDetail("OBL-J0C-003");
    localStorage.removeItem("tameion.assessment-request.OBL-J0C-003");
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: rows }));
      if (url === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST") return Promise.resolve(response(payload, status));
      if (url === "/api/obligations/OBL-J0C-003") return Promise.resolve(response(structuredClone(selectedDetail)));
      throw new Error(`Unexpected request: ${url}`);
    });

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-J0C-003")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-J0C-003"));
    await screen.findByRole("region", { name: "Selected source obligation" });
    expect(screen.getByRole("heading", { name: "Viewed stage: Obligation. Current lifecycle position: Assessment. Step 1 of 6." })).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST")).toHaveLength(1));

    // RED: these accepted non-200 outcomes currently have no selected-assessment
    // announcement on Obligation even though Assessment is the authoritative stage.
    expect(await screen.findByRole("status", { name: "Assessment request status" })).toBeTruthy();
    expect(obligationRow("OBL-J0C-003").getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("status", { name: "Assessment request status" }).textContent).toContain(expectedDurability);
    expect(localStorage.getItem("tameion.assessment-request.OBL-J0C-003")).toBeTruthy();
    const postsBeforeNavigation = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    navigateStage("Assessment");
    expect(screen.getByRole("status", { name: "Assessment request status" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postsBeforeNavigation);
  });

  it("announces a network-ambiguous OBL-J0C-003 assessment result on both selected views without another POST", async () => {
    const ids = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005"];
    const rows = ids.map((id) => ({ ...obligation(id, true), decision: "PAY" as const }));
    const selectedDetail = staleAssessmentDetail("OBL-J0C-003");
    localStorage.removeItem("tameion.assessment-request.OBL-J0C-003");
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: rows }));
      if (url === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST") return Promise.reject(new TypeError("network disconnected"));
      if (url === "/api/obligations/OBL-J0C-003") return Promise.resolve(response(structuredClone(selectedDetail)));
      throw new Error(`Unexpected request: ${url}`);
    });

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-J0C-003")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-J0C-003"));
    await screen.findByRole("region", { name: "Selected source obligation" });
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));

    // RED: transport ambiguity currently produces no accessible explanation.
    const feedback = await screen.findByRole("status", { name: "Assessment request status" });
    expect(feedback.textContent).toMatch(/not confirmed|unknown|no response/i);
    expect(feedback.textContent).toMatch(/no automatic retry|do not.*retry|refresh/i);
    expect(localStorage.getItem("tameion.assessment-request.OBL-J0C-003")).toBeTruthy();
    const postsBeforeNavigation = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    navigateStage("Assessment");
    expect(screen.getByRole("status", { name: "Assessment request status" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postsBeforeNavigation);
  });

  it("does not treat HTTP 202 as a completed assessment or advance current Obligation", async () => {
    const currentDetail = detail("OBL-J0C-003");
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [obligation("OBL-J0C-003", false)] }));
      if (url === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST") return Promise.resolve(response({ status: "IN_PROGRESS" }, 202));
      if (url === "/api/obligations/OBL-J0C-003") return Promise.resolve(response(structuredClone(currentDetail)));
      throw new Error(`Unexpected request: ${url}`);
    });

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Selected source obligation" });
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    const feedback = await screen.findByRole("status", { name: "Assessment request status" });
    await waitFor(() => expect(feedback.getAttribute("data-feedback-kind")).toBe("pending"));
    expect(screen.getByRole("heading", { name: "Current stage: Obligation. Step 1 of 6." })).toBeTruthy();
    expect(screen.queryByRole("status", { name: "Stage completion receipt" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Assessment result" })?.textContent ?? "").not.toContain("Advisory — PAY");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("announces in-flight assessment on either viewed stage and keeps the request key while pending", async () => {
    const assessment = deferred<Response>();
    const ids = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005"];
    const rows = ids.map((id) => ({ ...obligation(id, true), decision: "PAY" as const }));
    const selectedDetail = staleAssessmentDetail("OBL-J0C-003");
    localStorage.removeItem("tameion.assessment-request.OBL-J0C-003");
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: rows }));
      if (url === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST") return assessment.promise;
      if (url === "/api/obligations/OBL-J0C-003") return Promise.resolve(response(structuredClone(selectedDetail)));
      throw new Error(`Unexpected request: ${url}`);
    });

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-J0C-003")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-J0C-003"));
    await screen.findByRole("region", { name: "Selected source obligation" });
    navigateStage("Assessment");
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST")).toHaveLength(1));

    const inFlight = screen.getByRole("status", { name: "Assessment request status" });
    expect(inFlight.getAttribute("aria-live")).toBe("polite");
    expect(inFlight.getAttribute("data-feedback-kind")).toBe("in-flight");
    expect((screen.getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Run AI Assessment" }));
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST")).toHaveLength(1);
    expect(localStorage.getItem("tameion.assessment-request.OBL-J0C-003")).toBeTruthy();
    const postsBeforeNavigation = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    navigateStage("Obligation");
    expect(screen.getByRole("status", { name: "Assessment request status" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postsBeforeNavigation);

    assessment.resolve(response({ status: "IN_PROGRESS" }, 202));
    await waitFor(() => expect(screen.getByRole("status", { name: "Assessment request status" }).getAttribute("data-feedback-kind")).toBe("pending"));
    expect(screen.getByRole("status", { name: "Assessment request status" }).textContent).toContain("not a current recommendation");
    expect(localStorage.getItem("tameion.assessment-request.OBL-J0C-003")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postsBeforeNavigation);
  });

  it("does not carry late assessment feedback across a manual selection race", async () => {
    const assessment = deferred<Response>();
    const ids = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005"];
    const rows = ids.map((id) => ({ ...obligation(id, true), decision: "PAY" as const }));
    const selectedDetail = staleAssessmentDetail("OBL-J0C-003");
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: rows }));
      if (url === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST") return assessment.promise;
      if (url === "/api/obligations/OBL-J0C-003") return Promise.resolve(response(structuredClone(selectedDetail)));
      if (url === "/api/obligations/OBL-J0C-001") return Promise.resolve(response(detail("OBL-J0C-001")));
      throw new Error(`Unexpected request: ${url}`);
    });

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-J0C-003")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-J0C-003"));
    await screen.findByRole("region", { name: "Selected source obligation" });
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    await screen.findByRole("status", { name: "Assessment request status" });
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST")).toHaveLength(1);

    fireEvent.click(obligationRow("OBL-J0C-001"));
    await waitFor(() => expect(obligationRow("OBL-J0C-001").getAttribute("aria-current")).toBe("true"));
    await screen.findByRole("region", { name: "Selected source obligation" });
    expect(screen.queryByRole("status", { name: "Assessment request status" })).toBeNull();

    assessment.resolve(response({ error: "Assessment service unavailable." }, 503));
    await waitFor(() => expect(obligationRow("OBL-J0C-001").getAttribute("aria-current")).toBe("true"));
    expect(screen.queryByRole("status", { name: "Assessment request status" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("marks only a matching exact 200 receipt confirmed by refreshed detail as durable", async () => {
    const ids = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005"];
    const rows = ids.map((id) => ({ ...obligation(id, true), decision: "PAY" as const }));
    const stale = staleAssessmentDetail("OBL-J0C-003");
    const fresh = structuredClone(stale);
    const receipt = {
      assessment_id: "ASM-OBL-J0C-003-V2",
      assessment_hash: "d".repeat(64),
      aggregate_version: "2",
      decision: { obligation_id: "OBL-J0C-003", decision: "PAY", reasons: ["Current PAY recommendation; advisory only."] },
    };
    fresh.current_assessment = {
      ...fresh.current_assessment,
      assessment_id: receipt.assessment_id,
      assessment_hash: receipt.assessment_hash,
      aggregate_version: receipt.aggregate_version,
      reasons: receipt.decision.reasons,
    };
    delete fresh.current_assessment.race;
    let detailReads = 0;
    localStorage.removeItem("tameion.assessment-request.OBL-J0C-003");
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: rows }));
      if (url === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST") return Promise.resolve(response(receipt));
      if (url === "/api/obligations/OBL-J0C-003") {
        detailReads += 1;
        return Promise.resolve(response(structuredClone(detailReads === 1 ? stale : fresh)));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-J0C-003")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-J0C-003"));
    await screen.findByRole("region", { name: "Selected source obligation" });
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));

    const durable = await screen.findByRole("status", { name: "Assessment request status" });
    await waitFor(() => expect(durable.getAttribute("data-feedback-kind")).toBe("durable"));
    expect(durable.textContent).toContain("Refreshed obligation detail confirms this assessment receipt and version");
    expect(durable.textContent).toContain("recommendation remains advisory");
    expect(localStorage.getItem("tameion.assessment-request.OBL-J0C-003")).toBeNull();
    const postsBeforeNavigation = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    navigateStage("Assessment");
    expect(screen.getByRole("status", { name: "Assessment request status" }).getAttribute("data-feedback-kind")).toBe("durable");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postsBeforeNavigation);
  });

  it.each([
    ["wrong obligation", { assessment_id: "ASM-WRONG", assessment_hash: "e".repeat(64), aggregate_version: "2", decision: { obligation_id: "OBL-J0C-001", decision: "PAY", reasons: ["Advisory."] } }, "identity-mismatch"],
    ["stale aggregate version", { assessment_id: "ASM-STALE", assessment_hash: "f".repeat(64), aggregate_version: "1", decision: { obligation_id: "OBL-J0C-003", decision: "PAY", reasons: ["Advisory."] } }, "stale"],
  ])("does not present a %s assessment response as current", async (_label, receipt, expectedKind) => {
    const ids = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005"];
    const rows = ids.map((id) => ({ ...obligation(id, true), decision: "PAY" as const }));
    const selectedDetail = staleAssessmentDetail("OBL-J0C-003");
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: rows }));
      if (url === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST") return Promise.resolve(response(receipt));
      if (url === "/api/obligations/OBL-J0C-003") return Promise.resolve(response(structuredClone(selectedDetail)));
      throw new Error(`Unexpected request: ${url}`);
    });

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-J0C-003")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-J0C-003"));
    await screen.findByRole("region", { name: "Selected source obligation" });
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    const feedback = await screen.findByRole("status", { name: "Assessment request status" });
    await waitFor(() => expect(feedback.getAttribute("data-feedback-kind")).toBe(expectedKind));
    expect(feedback.textContent).not.toContain("recorded for the current selected obligation");
    expect(localStorage.getItem("tameion.assessment-request.OBL-J0C-003")).toBeTruthy();
    const postsBeforeNavigation = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    navigateStage("Assessment");
    expect(screen.getByRole("status", { name: "Assessment request status" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postsBeforeNavigation);
  });

  it("keeps a missing route owner/product action explicit and no longer uses generic gate copy", async () => {
    const pay = assessedDetail("OBL-ASSURANCE-NOT-READY", "PAY");
    pay.current_assessment.provider_mode = "LIVE_AI";
    pay.current_assessment.provider_used = "mock-live-ai";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({
        obligations: [{ ...obligation("OBL-ASSURANCE-NOT-READY", true), decision: "PAY", provider_mode: "LIVE_AI", route_assurance_status: "Route assurance not ready" }],
        sole_pay_candidate_id: "OBL-ASSURANCE-NOT-READY",
      }))
      : Promise.resolve(response(pay)));
    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    openStageNavigator();
    expect(obligationRow("OBL-ASSURANCE-NOT-READY").textContent).toContain("PAY recommendation (advisory)");
    expect(screen.getByRole("list", { name: "Payment lifecycle" }).textContent).toContain("Upcoming");
    expect(screen.getByTestId("current-next-step").textContent).toContain("View Assessment");
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    expect(screen.getByRole("region", { name: "Assessment result" }).textContent).toContain("PAY");
    expect(screen.getByTestId("payment-eligibility").textContent).toContain("payment-route assurance is not ready");
    const authorizationStage = screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement;
    expect(authorizationStage.disabled).toBe(true);
    expect(screen.getByRole("list", { name: "Payment lifecycle" }).textContent).toContain("Upcoming");
    expect(screen.getAllByRole("button", { name: "Prepare Arc Testnet settlement proxy" })).toHaveLength(1);
    expect(screen.queryByTestId("current-next-step")).toBeNull();
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
  });

  it("plays a deterministic same-identity sample without invoking payment routes", async () => {
    const assessed = assessedDetail("OBL-A", "HOLD");
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [obligation("OBL-A", true)] }));
      if (url === "/api/obligations/OBL-A") return Promise.resolve(response(assessed));
      return Promise.resolve(response({ error: "Unexpected request." }, 404));
    });
    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(screen.queryByRole("button", { name: "Simulate changed-destination attack" })).toBeNull();
    fireEvent.click(screen.getByText("Demo tools"));
    fireEvent.click(screen.getByText("Read-only sample"));
    const callsBeforePlayback = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole("button", { name: "Show sample playback" }));
    const fixture = await screen.findByRole("region", { name: "Read-only sample playback" });
    expect(fixture.textContent).toContain("No approval, assurance, provider call, or settlement is performed");
    expect(fixture.textContent).toContain("ORG-SAMPLE-PLAYBACK-001");
    expect(fixture.textContent).toContain("DEMO-SAMPLE-OBLIGATION-001");
    expect(fixture.textContent).toContain("Changed destination branch — expected BLOCK before provider submission");
    expect(fixture.textContent).toContain("Same sample organization and obligation");
    expect(fixture.textContent?.split("ORG-SAMPLE-PLAYBACK-001")).toHaveLength(3);
    expect(fixture.textContent?.split("DEMO-SAMPLE-OBLIGATION-001")).toHaveLength(3);
    expect(fetchMock.mock.calls.slice(callsBeforePlayback).some(([input, init]) =>
      String(input).includes("/api/") && (init?.method ?? "GET") !== "GET",
    )).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => /approve|execute|simulated-happy-path|real-testnet-payment/.test(String(input)))).toBe(false);
  });

  it("makes the current AI decision, reasons, and next action the assessment result", async () => {
    const assessed = assessedDetail("OBL-A", "HOLD");
    assessed.current_assessment!.reasons = ["Destination trust evidence is not verified."];
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [obligation("OBL-A", true)] }));
      return Promise.resolve(response(assessed));
    });

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(obligationRow("OBL-A")).toBeTruthy());
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    navigateStage("Assessment");

    expect(await screen.findByText("Advisory — HOLD")).toBeTruthy();
    expect(screen.getAllByText("Destination trust evidence is not verified.").length).toBeGreaterThan(0);
    expect(screen.getByText("Review the finding.")).toBeTruthy();
  });

  it("offers no more than one enabled primary action in the selected workspace", async () => {
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-ONE-ACTION")] }))
      : Promise.resolve(response(detail("OBL-ONE-ACTION"))));
    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    const main = screen.getByRole("main");
    const primaryActions = Array.from(main.querySelectorAll<HTMLButtonElement>('button[data-primary-action="true"]'));
    expect(primaryActions.filter((button) => !button.disabled)).toHaveLength(1);
    expect(primaryActions.find((button) => !button.disabled)?.textContent).toContain("Run AI Assessment");
  });

  it("keeps authorization intent copy current through sealed reloads and obligation switches", async () => {
    const sealed = sealedDetail("OBL-SEALED");
    const unsealed = detail("OBL-UNSEALED");
    let sealedReads = 0;
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/obligations") {
        return Promise.resolve(response({ obligations: [
          { ...obligation("OBL-SEALED", true), decision: "PAY" },
          obligation("OBL-UNSEALED"),
        ] }));
      }
      if (url === "/api/obligations/OBL-SEALED") {
        sealedReads += 1;
        return Promise.resolve(response(sealed));
      }
      if (url === "/api/obligations/OBL-UNSEALED") return Promise.resolve(response(unsealed));
      return Promise.resolve(response({ error: "Unexpected request." }, 404));
    });

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    navigateStage("Authorization");
    expect(await screen.findByText(/Authorization records approval only/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
    expect(screen.queryByText(/No payment intent exists at this step/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Authorization already sealed" })).toBeNull();
    navigateStage("Assessment");
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(0);
    expect(screen.getByRole("region", { name: "Assessment result" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run AI Assessment again" })).toBeNull();
    navigateStage("Authorization");

    fireEvent.click(obligationRow("OBL-UNSEALED"));
    await waitFor(() => expect(obligationRow("OBL-UNSEALED").getAttribute("aria-current")).toBe("true"));
    expect(screen.getByTestId("current-next-step").textContent).toContain("This obligation needs an assessment before it can proceed.");
    expect(screen.queryByRole("button", { name: "Authorization" })).toBeNull();
    expect(screen.queryByText(/An authorization envelope is already sealed/)).toBeNull();

    fireEvent.click(obligationRow("OBL-SEALED"));
    await waitFor(() => expect(obligationRow("OBL-SEALED").getAttribute("aria-current")).toBe("true"));
    await screen.findByRole("button", { name: "View current stage · Payment" });
    navigateStage("Authorization");
    navigateStage("Assurance");
    expect(screen.getByRole("region", { name: "Deterministic assurance result" }).textContent).toContain("Payment instruction state: Sealed · single use");
    expect(sealedReads).toBe(2);
    expect(screen.queryByRole("button", { name: "Authorization already sealed" })).toBeNull();
  });

  it("does not infer no intent while authorization detail is loading or unavailable", async () => {
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A")] }))
      : selectedDetail.promise);

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(obligationRow("OBL-A")).toBeTruthy());
    expect(screen.getByTestId("current-next-step").textContent).toContain("Loading current obligation status.");
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
    expect(screen.queryByText(/No payment intent exists/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Authorization status unavailable" })).toBeNull();

    selectedDetail.resolve(response(null, 503));
    const recovery = await screen.findByRole("region", { name: "Exception recovery" });
    expect(recovery.textContent).toContain("Selected obligation status is unavailable; retry before taking action.");
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
    expect(screen.queryByText(/No payment intent exists/)).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh current status" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh current status" })).toBeTruthy();
  });

  it("shows a true empty queue without turning the no-selection state into a demo-mode blocker", async () => {
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [] }))
      : Promise.resolve(response(null, 404)));

    renderWithExplicitFirstSelection();
    await screen.findByText("No genuine obligations", { selector: "h3" });
    expect(screen.getByTestId("current-next-step").textContent).toContain("Refresh the genuine queue to check again");
    expect(screen.getByRole("main").textContent).not.toMatch(/open demo mode/i);
    expect(screen.queryByRole("navigation", { name: "Payment lifecycle navigation" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
  });

  it("makes review the primary PAY action, then removes primary action while route assurance blocks", async () => {
    const pay = assessedDetail("OBL-PAY-BLOCKED", "PAY");
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [{ ...obligation("OBL-PAY-BLOCKED", true), decision: "PAY", route_assurance_status: "Route assurance not ready" }], sole_pay_candidate_id: "OBL-PAY-BLOCKED" }))
      : Promise.resolve(response(pay)));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    const primary = () => Array.from(screen.getByRole("main").querySelectorAll<HTMLButtonElement>('button[data-primary-action="true"]'))
      .filter((button) => !button.disabled);
    expect(primary()).toHaveLength(1);
    expect(primary()[0].textContent).toContain("View Assessment");
    expect(primary()[0].textContent).not.toContain("Run AI Assessment");

    fireEvent.click(primary()[0]);
    expect(screen.getByRole("button", { name: "Review current PAY assessment" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review current PAY assessment" }));
    expect(screen.getByTestId("payment-eligibility").textContent).toMatch(/current payment-route assurance is not ready/i);
    expect(primary()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Authorization locked — prepare the testnet proxy/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Run AI Assessment again" })).toBeTruthy();
  });

  it("shows final assurance only as unavailable detail after a sealed PAE and keeps Arc payment blocked", async () => {
    const authorized = assessedDetail("OBL-SEALED-PAE", "PAY");
    authorized.pae_sealed = true;
    authorized.aggregate.destination_verification_status = "VERIFIED";
    authorized.aggregate.destination_operational_status = "ACTIVE";
    authorized.aggregate.source_wallet_status = "ACTIVE";
    authorized.aggregate.product_trust_provenance = "CURRENT_PRODUCT_EVIDENCE";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [{ ...obligation("OBL-SEALED-PAE", true), decision: "PAY", route_assurance_status: "Route assurance ready" }] }))
      : Promise.resolve(response(authorized)));
    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    openStageNavigator();
    const lifecycle = await screen.findByRole("list", { name: "Payment lifecycle" });
    await waitFor(() => expect(lifecycle.textContent).toContain("PaymentCurrent"));
    expect(lifecycle.textContent).toContain("PaymentCurrent");
    navigateStage("Payment");
    expect(screen.getByRole("region", { name: "Payment status" }).textContent).toContain("Current payment authority is not available for submission");
    expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).getAttribute("data-stage-state")).toBe("COMPLETED");
    expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain("Payment");
  });

  it("labels a sealed authorization as an Arc Testnet proxy subject to exact-packet and pre-send gates", async () => {
    const authorized = proxyPrepared(sealedDetail("OBL-SEALED-PROXY"));
    authorized.aggregate.destination_verification_status = "VERIFIED";
    authorized.aggregate.destination_operational_status = "ACTIVE";
    authorized.aggregate.source_wallet_status = "ACTIVE";
    authorized.aggregate.product_trust_provenance = "CURRENT_PRODUCT_EVIDENCE";
    authorized.execution_packet = { packet_sha256: "c".repeat(64), packet: { obligation_id: "OBL-SEALED-PROXY" } };
    authorized.sealed_pae_instruction_hash = "d".repeat(64);
    authorized.execution_gate = "LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-SEALED-PROXY", true)] }))
      : Promise.resolve(response(authorized)));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(screen.queryByText(/Approved instruction is sealed for the Arc Testnet settlement proxy/)).toBeNull();
    navigateStage("Authorization");
    const packet = screen.getByRole("region", { name: "Approver decision packet" });
    expect(within(packet).getByText(/Approved instruction is sealed for the Arc Testnet settlement proxy.*subject to the exact-packet gate and final pre-send checks/)).toBeTruthy();
    expect(screen.queryByText(/has no Arc payment binding/)).toBeNull();
    expect(screen.queryByText(/payment remains blocked without an Arc binding/)).toBeNull();
    navigateStage("Assessment");
    expect(screen.queryByText(/payment remains blocked without an Arc binding/)).toBeNull();
  });

  it.each([
    {
      name: "execution FAILED",
      executionStatus: "FAILED",
      releaseAuthority: "BLOCKED",
      paeState: "REVOKED",
      currentStage: "Reconciliation",
      expected: /Provider attempt failed/i,
    },
    {
      name: "execution BLOCKED",
      executionStatus: "BLOCKED",
      releaseAuthority: "BLOCKED",
      paeState: "REVOKED",
      currentStage: "Reconciliation",
      expected: /Execution is blocked.*external provider outcome is not established/i,
    },
    {
      name: "PAE-011/REVOKED without an execution record",
      executionStatus: null,
      aggregateExecutionState: "BLOCKED",
      releaseAuthority: "BLOCKED",
      paeState: "REVOKED",
      currentStage: "Payment",
      expected: /Payment authority is revoked.*instruction is unavailable for submission/i,
    },
    {
      name: "PAE EXPIRED without an execution record",
      executionStatus: null,
      releaseAuthority: "EXPIRED",
      paeState: "EXPIRED",
      currentStage: "Payment",
      expected: /Payment authority is expired.*instruction is unavailable for submission/i,
    },
  ])("keeps $name distinct from a valid sealed exact-packet gate", async ({ executionStatus, aggregateExecutionState, releaseAuthority, paeState, currentStage, expected }) => {
    const id = `OBL-TERMINAL-${releaseAuthority}-${executionStatus ?? "NO-EXECUTION"}`;
    const terminal = proxyPrepared(sealedDetail(id));
    terminal.truth.tameion_control_truth.pae_state = paeState;
    terminal.truth.tameion_control_truth.execution_state = executionStatus ?? aggregateExecutionState ?? "NONE";
    terminal.truth.tameion_control_truth.execution_release_authority = releaseAuthority;
    terminal.aggregate.pae_state = paeState;
    if (aggregateExecutionState) terminal.aggregate.execution_state = aggregateExecutionState;
    if (executionStatus) {
      terminal.execution = { status: executionStatus, provider_ref: null };
      terminal.aggregate.execution_state = executionStatus;
    }
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation(id, true)] }))
      : Promise.resolve(response(terminal)));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    openStageNavigator();
    const lifecycle = await screen.findByRole("list", { name: "Payment lifecycle" });
    await waitFor(() => expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain(currentStage));
    navigateStage(currentStage);
    expect(lifecycle.textContent).not.toMatch(/awaits separate exact-packet gate/i);
    const currentStageCard = currentStage === "Payment"
      ? screen.getByRole("region", { name: "Payment status" })
      : screen.getByRole("region", { name: "Reconciliation receipt" });
    expect(currentStageCard.textContent).not.toContain("Prime · exact-packet authorization");
    expect(currentStageCard.textContent).toMatch(expected);
    expect(lifecycle.querySelector('[aria-current="step"]')?.getAttribute("data-stage-state")).toMatch(/CURRENT|BLOCKED/);
    expect(lifecycle.textContent).not.toMatch(/Not submitted/i);
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)').length).toBeLessThanOrEqual(1);
    expect(screen.queryByRole("button", { name: /^Continue to / })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("labels AUTHORIZED N+1 without a sealed PAE as assurance failed or blocked", async () => {
    const authorized = proxyPrepared(assessedDetail("OBL-ASSURANCE-BLOCKED-AFTER-APPROVAL", "PAY"));
    authorized.aggregate.state = "AUTHORIZED";
    authorized.aggregate.pae_state = "UNUSED";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-ASSURANCE-BLOCKED-AFTER-APPROVAL", true)] }))
      : Promise.resolve(response(authorized)));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    openStageNavigator();
    navigateStage("Assurance");
    const assurance = screen.getByRole("region", { name: "Deterministic assurance result" });
    expect(assurance.textContent).toContain("Authorization recorded · Assurance failed/blocked");
    expect(assurance.textContent).toMatch(/no PASS assurance, usable PAE, or execution is available/i);
    const lifecycle = openStageNavigator().querySelector<HTMLOListElement>('ol[aria-label="Payment lifecycle"]')!;
    expect(lifecycle.textContent).toContain("AssuranceBlockedAuthorization recorded · Assurance failed/blocked; no PASS assurance, usable PAE, or execution is available.");
    expect((screen.getByRole("button", { name: "Payment" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).getAttribute("data-stage-state")).toBe("COMPLETED");
  });

  it("keeps an actual post-approval AUTHORIZED N+1 response at Assurance with no unsupported reassessment", async () => {
    const id = "OBL-AUTHORIZED-NPLUS1-NO-PAE";
    const authorized = approvedNPlusOneDetail(id, false);
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation(id, false)] }))
      : Promise.resolve(response(authorized)));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    openStageNavigator();
    navigateStage("Assurance");
    const assurance = screen.getByRole("region", { name: "Deterministic assurance result" });
    await waitFor(() => expect(assurance.textContent).toContain("Authorization recorded · Assurance failed/blocked"));
    const lifecycle = openStageNavigator().querySelector<HTMLOListElement>('ol[aria-label="Payment lifecycle"]')!;
    await waitFor(() => expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain("Assurance"));
    expect(lifecycle.textContent).toContain("AssuranceBlockedAuthorization recorded · Assurance failed/blocked; no PASS assurance, usable PAE, or execution is available.");
    expect((screen.getByRole("button", { name: "Assessment" }) as HTMLButtonElement).getAttribute("data-stage-state")).toBe("COMPLETED");
    expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).getAttribute("data-stage-state")).toBe("COMPLETED");
    expect(assurance.textContent).toContain("Authorization recorded · Assurance failed/blocked");
    expect(assurance.textContent).toMatch(/no PASS assurance, usable PAE, or execution is available/i);
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]')).toHaveLength(0);

    navigateStage("Assessment");
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByText(/Authorization is recorded\. Assurance failed or is blocked/)).toBeTruthy();
    navigateStage("Authorization");
    expect(screen.getByText(/Authorization is recorded\. Assurance failed or is blocked/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Authorize payment" })).toBeNull();
    expect(screen.queryByText(/Authorization review applies to the current PAY assessment/)).toBeNull();
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps an actual sealed post-approval N+1 response at Assurance while the release gate is unavailable", async () => {
    const id = "OBL-SEALED-NPLUS1-NO-ASSESSMENT";
    const sealed = approvedNPlusOneDetail(id, true);
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation(id, false)] }))
      : Promise.resolve(response(sealed)));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    openStageNavigator();
    const lifecycle = await screen.findByRole("list", { name: "Payment lifecycle" });
    await waitFor(() => expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain("Assurance"));
    expect((screen.getByRole("button", { name: "Assessment" }) as HTMLButtonElement).getAttribute("data-stage-state")).toBe("COMPLETED");
    expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).getAttribute("data-stage-state")).toBe("COMPLETED");
    expect((screen.getByRole("button", { name: "Payment" }) as HTMLButtonElement).getAttribute("data-stage-state")).toBe("UPCOMING");
    expect(screen.queryByRole("button", { name: "Continue to Payment" })).toBeNull();
    navigateStage("Assurance");
    expect(screen.queryByRole("button", { name: "Continue to Payment" })).toBeNull();
    expect(screen.getByRole("region", { name: "Deterministic assurance result" }).textContent).toContain("Payment instruction state: Sealed · single use");
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]').length).toBeLessThanOrEqual(1);

    navigateStage("Assessment");
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("shows the current OBL-J0C-003 HOLD remediation and truthful lifecycle in the primary obligation workspace", async () => {
    const assessed = assessedDetail("OBL-J0C-003", "HOLD");
    assessed.current_assessment!.reasons = ["Current destination and source-wallet readiness are not verified."];
    assessed.current_assessment!.race!.result.decision_summary = "Payment cannot progress until current destination readiness is verified.";
    assessed.current_assessment!.race!.result.validated_findings = [{
      code: "DESTINATION_NOT_READY",
      severity: "HOLD",
      reason: "Current Arc product destination or source-wallet readiness is not verified and active.",
    }];
    assessed.current_assessment!.race!.remediation = [{
      finding_code: "DESTINATION_NOT_READY",
      reason: "Current Arc product destination or source-wallet readiness is not verified and active.",
      required_action: "Resolve the current destination or source-wallet readiness blocker.",
      required_evidence: ["Verified destination readiness and source-wallet trust-seed record"],
      owner_role: "Treasury Operations",
      reassess_after_resolution: true,
    }];
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-J0C-003", true)] }))
      : Promise.resolve(response(assessed)));

    renderWithExplicitFirstSelection();
    const workspace = await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(workspace.textContent).not.toContain("Advisory — HOLD");
    navigateStage("Assessment");
    const assessmentStage = await screen.findByRole("region", { name: "Assessment result" });

    expect(assessmentStage.textContent).toContain("Current Arc product destination or source-wallet readiness is not verified and active.");
    expect(assessmentStage.textContent).not.toContain("DESTINATION_NOT_READY");
    expect(assessmentStage.textContent).toContain("Resolve the current destination or source-wallet readiness blocker.");
    expect(assessmentStage.textContent).toContain("Treasury Operations");
    expect(assessmentStage.textContent).toContain("What this means");
    expect(assessmentStage.textContent).toContain("Returned findings");
    expect(assessmentStage.textContent).not.toContain("Verified destination readiness and source-wallet trust-seed record");
    expect(within(assessmentStage).queryByRole("button", { name: /resolve/i })).toBeNull();

    const lifecycle = screen.getByRole("list", { name: "Payment lifecycle" });
    expect(lifecycle.textContent).toContain("AssessmentCurrent");
    expect(lifecycle.textContent).not.toContain("AssessmentBlocked");
    expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Assurance" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Payment" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reconciliation" }) as HTMLButtonElement).disabled).toBe(true);
    expect(lifecycle.textContent).not.toMatch(/transaction (failed|pending)/i);
    const developer = screen.getByText("Developer & audit evidence");
    fireEvent.click(developer);
    expect(developer.closest("details")?.textContent).toContain("DESTINATION_NOT_READY");
  });

  it("renders attested effective due date and readiness fixture provenance in the assessment trace", async () => {
    const assessed = assessedDetail("OBL-DATE-PROVENANCE", "HOLD");
    const facts = assessed.current_assessment!.race!.evidence.authoritative_facts as Record<string, unknown>;
    Object.assign(facts, {
      due_date: null,
      due_date_status: "NOT_STATED_ON_SOURCE",
      issue_date: "2026-09-01",
      effective_due_date: "2026-09-01",
      effective_due_date_basis: "INVOICE_DATE_CASH_TERM",
      effective_due_date_provenance: { provenance_class: "AUTHORIZED_OPERATOR_ATTESTATION", authority_reference: "UAT-AUTH-REF-1" },
      due_date_position: "OVERDUE",
      destination_readiness_source: "SIMULATED_DEMO_FIXTURE",
    });
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-DATE-PROVENANCE", true)] }))
      : Promise.resolve(response(assessed)));
    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    navigateStage("Assessment");
    fireEvent.click(screen.getByText("Developer & audit evidence"));
    const traceSummary = await screen.findByText("Assessment trace — evidence, facts, model proposal, validated findings, remediation");
    fireEvent.click(traceSummary);
    const trace = screen.getByTestId("assessment-trace");
    expect(trace.textContent).toContain("Raw due date: Not captured on source");
    expect(trace.textContent).toContain("Effective due date: 2026-09-01");
    expect(trace.textContent).toContain("INVOICE_DATE_CASH_TERM");
    expect(trace.textContent).toContain("authorized operator attestation (UAT-AUTH-REF-1)");
    expect(trace.textContent).toContain("Assessment as of: 2026-10-04 (overdue)");
    expect(trace.textContent).toContain("simulated demo fixture; it is not source evidence or current product trust");
  });

  it("presents PAY separately from route assurance and keeps authorization locked when assurance is not ready", async () => {
    const pay = assessedDetail("OBL-ASSURANCE-NOT-READY", "PAY");
    pay.aggregate.destination_verification_status = "PENDING_VERIFICATION";
    pay.aggregate.destination_operational_status = "ON_HOLD";
    pay.aggregate.source_wallet_status = "INACTIVE";
    pay.aggregate.product_trust_provenance = "UNVERIFIED_CURRENT_TRUST";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [{ ...obligation("OBL-ASSURANCE-NOT-READY", true), decision: "PAY", route_assurance_status: "Route assurance not ready" }], sole_pay_candidate_id: "OBL-ASSURANCE-NOT-READY" }))
      : Promise.resolve(response(pay)));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    openStageNavigator();
    const lifecycle = await screen.findByRole("list", { name: "Payment lifecycle" });
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(Array.from(lifecycle.querySelectorAll("li")).map((item) => item.querySelector("button > span:nth-child(2)")?.textContent?.trim())).toEqual([
      "Obligation",
      "Assessment",
      "Authorization",
      "Assurance",
      "Payment",
      "Reconciliation",
    ]);
    expect(lifecycle.textContent).toContain("Approval locked — route assurance not ready");
    expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Assurance" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reconciliation" }) as HTMLButtonElement).disabled).toBe(true);
    navigateStage("Assessment");
    expect(await screen.findByText("Advisory — PAY")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Assessment result" }).textContent).toContain("PAY");

    expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("payment-eligibility").textContent).toMatch(/current payment-route assurance is not ready/i);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/approve"))).toBe(false);
  });

  it("shows the current amount, destination, FX and authority boundary before an approval control can enable", async () => {
    const pay = proxyPrepared(assessedDetail("OBL-EXACT-INTENT", "PAY"));
    pay.aggregate.destination_verification_status = "VERIFIED";
    pay.aggregate.destination_operational_status = "ACTIVE";
    pay.aggregate.source_wallet_status = "ACTIVE";
    pay.aggregate.product_trust_provenance = "CURRENT_PRODUCT_EVIDENCE";
    Object.assign(pay.aggregate, { counterparty_id: "CP-CURRENT-01" });
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [{ ...obligation("OBL-EXACT-INTENT", true), decision: "PAY", route_assurance_status: "Route assurance ready" }], sole_pay_candidate_id: "OBL-EXACT-INTENT" }))
      : Promise.resolve(response(pay)));
    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    openStageNavigator();
    const sourceSummary = await screen.findByRole("region", { name: "Selected source obligation" });
    await waitFor(() => expect(sourceSummary.textContent).not.toContain("Source and control details are loading"));
    expect(sourceSummary.textContent).toContain("125.00 USD");
    expect(sourceSummary.textContent).not.toContain("125.000000 USDC");
    expect(sourceSummary.textContent).not.toContain("ARC_TESTNET");
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    fireEvent.click(screen.getByRole("button", { name: "Review current PAY assessment" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Authorization" }));
    navigateStage("Authorization");
    const packet = screen.getByText("Approver decision packet").closest("section");
    expect(packet?.textContent).toContain("125.00 USD");
    expect(packet?.textContent).toContain("125.000000 USDC");
    expect(packet?.textContent).toContain("ARC_TESTNET");
    const developer = screen.getByText("Developer & audit evidence");
    fireEvent.click(developer);
    const sourceDetails = screen.getByText("Source and current payment records").closest("details") as HTMLDetailsElement;
    expect(sourceDetails.open).toBe(false);
    fireEvent.click(screen.getByText("Source and current payment records"));
    const intentDetails = await screen.findByRole("region", { name: "Exact payment intent summary" });
    expect(intentDetails.textContent).toContain("No FX rate recorded");
    expect(intentDetails.textContent).toContain("Pending separate Safety Kernel review and human authorization");
    expect((screen.getByRole("button", { name: "Authorize payment" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/approve"))).toBe(false);
    fireEvent.click(screen.getByText("Execution / provider"));
    const executionEvidence = screen.getByText("Execution / provider").closest("details");
    expect(executionEvidence?.textContent).toContain("Source wallet reference");
    expect(executionEvidence?.textContent).toContain("Destination address");
  });

  it("does not auto-promote the earlier-due PAY obligation when the operator selects another source", async () => {
    const fivePay = ["PAY-QUEUE-E", "PAY-QUEUE-C", "PAY-QUEUE-A", "PAY-QUEUE-D", "PAY-QUEUE-B"]
      .map((id, index) => ({
        ...obligation(id, true),
        due_date: `2026-10-${String(10 + index).padStart(2, "0")}`,
        decision: "PAY" as const,
        provider_mode: "LIVE_AI" as const,
      }));
    const winner = [...fivePay].sort((a, b) => a.due_date.localeCompare(b.due_date) || a.obligation_id.localeCompare(b.obligation_id))[0]!;
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({
        obligations: fivePay,
        assessed_count: fivePay.length,
        total_count: fivePay.length,
      }));
      const id = url.split("/").at(-1)!;
      const current = assessedDetail(id, "PAY");
      current.current_assessment.provider_mode = "LIVE_AI";
      current.current_assessment.provider_used = "mock-live-ai";
      current.record.due_date = fivePay.find((item) => item.obligation_id === id)?.due_date;
      return Promise.resolve(response(current));
    });

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow(winner.obligation_id)).toBeTruthy());
    expect(screen.getByRole("main").querySelectorAll('button[data-obligation-id][aria-current="true"]')).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([input]) => String(input).startsWith("/api/obligations/") && String(input) !== "/api/obligations")).toBe(false);
    const explicitlySelected = fivePay.find((item) => item.obligation_id !== winner.obligation_id)!;
    fireEvent.click(obligationRow(explicitlySelected.obligation_id));
    await waitFor(() => expect(screen.getByRole("main").querySelector('nav[aria-label="Payment lifecycle navigation"]')).not.toBeNull());
    openStageNavigator();
    await waitFor(() => expect(screen.getByRole("navigation", { name: "Payment lifecycle navigation" })).toBeTruthy());
    expect(obligationRow(winner.obligation_id).textContent).toContain("PAY recommendation (advisory)");
    expect(obligationRow(winner.obligation_id).textContent).not.toMatch(/Sole PAY candidate|route assurance|PAE|execution/i);
    expect(obligationRow(explicitlySelected.obligation_id).getAttribute("aria-current")).toBe("true");
    navigateStage("Assessment");
    expect(screen.getByRole("main").textContent).toContain(explicitlySelected.obligation_id);
    expect(screen.getByRole("main").textContent).not.toContain("View selected payment candidate");
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]')).toHaveLength(1);
    await waitFor(() => expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole("button", { name: "Prepare Arc Testnet settlement proxy" })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/preflight") && init?.method === "POST")).toBe(false);
  });

  it.each([
    ["HOLD"],
    ["ESCALATE"],
  ] as const)("keeps a current %s assessment locked even after all five obligations are assessed", async (decision) => {
    const obligations = ["OBL-A", "OBL-B", "OBL-C", "OBL-D", "OBL-E"].map((id) => ({
      ...obligation(id, true),
      decision: id === "OBL-A" ? decision : "HOLD" as const,
    }));
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations }))
      : Promise.resolve(response(assessedDetail("OBL-A", decision))));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(screen.queryByText("Awaiting human authorization")).toBeNull();
    const workspace = screen.getByRole("region", { name: "Genuine obligation workspace" });
    expect(workspace.textContent).not.toContain(`Advisory — ${decision}`);
    navigateStage("Assessment");
    expect(await screen.findByText(`Advisory — ${decision}`)).toBeTruthy();
    const decisionHeading = screen.getByText(`Advisory — ${decision}`);
    expect(decisionHeading.className).toContain("text-[var(--status-hold-text)]");
    expect(obligationRow("OBL-A").querySelector("span.text-end")?.getAttribute("style"))
      .toContain("--status-hold-text");
    const assessmentStage = screen.getByRole("region", { name: "Assessment result" });
    expect(assessmentStage.textContent).toContain(decision === "HOLD" ? "Source evidence is incomplete." : "Controller review is required.");
    expect(assessmentStage.textContent).toContain("Review the finding.");
    expect(assessmentStage.textContent).toContain(decision === "HOLD" ? "Accounts Payable" : "Finance controller");
    expect(within(assessmentStage).queryByRole("button", { name: /resolve/i })).toBeNull();
    expect(within(assessmentStage).queryByRole("button", { name: "Run AI Assessment again" })).toBeNull();
    expect(assessmentStage.textContent).toContain("remains locked");
    expect((screen.getByRole("button", { name: "Assessment" }) as HTMLButtonElement).getAttribute("data-stage-state")).toBe("CURRENT");
    expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId("current-next-step")).toBeNull();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/approve") && init?.method === "POST")).toBe(false);
  });

  it("allows only a current reviewed PAY assessment to become authorization eligible", async () => {
    const obligations = ["OBL-A", "OBL-B", "OBL-C", "OBL-D", "OBL-E"].map((id) => ({
      ...obligation(id, true),
      decision: id === "OBL-A" ? "PAY" : "HOLD",
    }));
    const pay = proxyPrepared(assessedDetail("OBL-A", "PAY"));
    pay.aggregate.destination_verification_status = "VERIFIED";
    pay.aggregate.destination_operational_status = "ACTIVE";
    pay.aggregate.source_wallet_status = "ACTIVE";
    pay.aggregate.product_trust_provenance = "CURRENT_PRODUCT_EVIDENCE";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations, sole_pay_candidate_id: "OBL-A" }))
      : Promise.resolve(response(pay)));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    navigateStage("Assessment");
    expect(await screen.findByText("Advisory — PAY")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review current PAY assessment" }));
    navigateStage("Authorization");

    expect(screen.getByRole("button", { name: "Authorize payment" })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/approve") && init?.method === "POST")).toBe(false);
  });

  it("marks retained detail stale and offers retry when post-action refresh reads fail", async () => {
    let listReads = 0;
    let detailReads = 0;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations" && init?.method !== "POST") {
        listReads += 1;
        return Promise.resolve(listReads === 1 ? response({ obligations: [obligation("OBL-A")] }) : response(null, 503));
      }
      if (url.endsWith("/OBL-A/assess") && init?.method === "POST") return Promise.resolve(response({ error: "Action unavailable" }, 503));
      if (url === "/api/obligations/OBL-A") {
        detailReads += 1;
        return Promise.resolve(detailReads === 1 || detailReads === 3 ? response(detail("OBL-A")) : response(null, 502));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(obligationRow("OBL-A")).toBeTruthy());
    const assess = await screen.findByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement;
    await waitFor(() => expect(assess.disabled).toBe(false));
    fireEvent.click(assess);

    expect(await screen.findByText(/Genuine obligations are unavailable\. No synthetic demo data has been added to this list/)).toBeTruthy();
    expect(await screen.findByText(/Last-known obligation details are stale/)).toBeTruthy();
    expect(screen.getAllByText("Last-known state — stale").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Run AI Assessment again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh current status" })).toBeTruthy();
    expect(screen.queryByText("Additional tools")).toBeNull();
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
    expect(obligationRow("OBL-A")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Payment lifecycle navigation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Authorization" })).toBeNull();
    expect(screen.getByTestId("current-next-step").textContent).toContain("Selected obligation status is stale");
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Refresh current status" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assurance" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit for execution (simulated)" })).toBeNull();
    expect(screen.getByTestId("current-next-step").textContent).toContain("Selected obligation status is stale");
    fireEvent.click(screen.getByRole("button", { name: "Refresh current status" }));
    await waitFor(() => expect(screen.queryByText(/Last-known obligation details are stale/)).toBeNull());
    expect(screen.queryByText("Additional tools")).toBeNull();
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
  });

  it("keeps the internal active-run counter positive until all dispatched callbacks settle", async () => {
    const actionA = deferred<Response>();
    const actionB = deferred<Response>();
    let listReads = 0;
    let detailBReads = 0;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations" && init?.method !== "POST") {
        listReads += 1;
        if (listReads === 1) return Promise.resolve(response({ obligations: [obligation("OBL-A"), obligation("OBL-B")] }));
        return Promise.resolve(response({ obligations: [obligation("OBL-A"), obligation("OBL-B")] }));
      }
      if (url.endsWith("/OBL-A/assess")) return actionA.promise;
      if (url.endsWith("/OBL-B/assess")) return actionB.promise;
      if (url === "/api/obligations/OBL-A") return Promise.resolve(response(detail("OBL-A")));
      if (url === "/api/obligations/OBL-B") {
        detailBReads += 1;
        return Promise.resolve(response(detail("OBL-B")));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(obligationRow("OBL-B")).toBeTruthy());
    const assessA = await screen.findByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement;
    await waitFor(() => expect(assessA.disabled).toBe(false));
    const actionACompletion = invokeClickHandler(assessA);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/OBL-A/assess") && init?.method === "POST")).toBe(true));

    fireEvent.click(obligationRow("OBL-B"));
    await waitFor(() => expect(detailBReads).toBeGreaterThan(0));
    expect(obligationRow("OBL-B").getAttribute("aria-current")).toBe("true");
    expect(screen.queryByRole("region", { name: "Operational report for OBL-B" })).toBeNull();
    const assessB = await screen.findByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement;
    expect(assessB.disabled).toBe(true);
    // Invoke the internal callback directly to isolate the defensive counter invariant.
    // This does not claim the disabled button is reachable through browser interaction.
    const actionBCompletion = invokeClickHandler(assessB);
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual(expect.arrayContaining([["/api/obligations/OBL-B/assess", "POST"]]));

    actionA.resolve(response({ error: "Assessment unavailable" }, 503));
    await act(async () => { await actionACompletion; });
    expect(listReads).toBe(1);
    expect((screen.getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement).disabled).toBe(true);

    actionB.resolve(response({ error: "Assessment unavailable" }, 503));
    await act(async () => { await actionBCompletion; });
    expect(listReads).toBe(2);
    expect((screen.getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Additional tools")).toBeNull();
  });

  it("keeps assessment disabled during loading and a browser click sends no request", async () => {
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A")] }))
      : selectedDetail.promise);

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(obligationRow("OBL-A")).toBeTruthy());
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/obligations/OBL-A"));
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(0);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/assess") && init?.method === "POST")).toBe(false);

    selectedDetail.resolve(response(detail("OBL-A")));
    await waitFor(() => expect((screen.getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it.each([
    ["mismatched", { ...detail("OBL-A"), record: { ...detail("OBL-A").record, obligation_id: "OBL-B" } }],
    ["missing", { ...detail("OBL-A"), record: { amount: "125.00", currency: "USD" } }],
  ])("fails closed when selected detail identity is %s", async (_case, payload) => {
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A")] }))
      : Promise.resolve(response(payload)));

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(obligationRow("OBL-A")).toBeTruthy());
    expect(await screen.findByText(/Obligation detail is unavailable/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Refresh current status" })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/assess") && init?.method === "POST")).toBe(false);
    expect(screen.queryByRole("region", { name: /Operational report for/ })).toBeNull();
  });

  it("keeps the selected obligation bound when an older detail request finishes late", async () => {
    const firstDetail = deferred<Response>();
    const secondDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [obligation("OBL-A"), obligation("OBL-B")] }));
      return url.endsWith("OBL-A") ? firstDetail.promise : secondDetail.promise;
    });

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(obligationRow("OBL-B")).toBeTruthy());
    await waitFor(() => expect(screen.getByTestId("current-next-step").textContent).toContain("Loading current obligation status."));
    expect(screen.queryByText("Additional tools")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/obligations/OBL-A"));
    fireEvent.click(obligationRow("OBL-B"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/obligations/OBL-B"));
    secondDetail.resolve(response(detail("OBL-B")));
    await waitFor(() => expect(obligationRow("OBL-B").getAttribute("aria-current")).toBe("true"));
    firstDetail.resolve(response(detail("OBL-A")));
    await waitFor(() => expect(obligationRow("OBL-B").getAttribute("aria-current")).toBe("true"));
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
    expect(screen.queryByText("Additional tools")).toBeNull();
  });
});

describe("guided lifecycle navigation", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("labels the viewed stage as current when it matches authoritative position", async () => {
    const source = detail("OBL-GUIDED-A11Y-EQUAL");
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-GUIDED-A11Y-EQUAL")] }))
      : Promise.resolve(response(source)));
    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });

    expect(screen.getByRole("heading", { name: "Current stage: Obligation. Step 1 of 6." })).toBeTruthy();
  });

  it("labels a back-viewed stage separately from the authoritative current position", async () => {
    const source = detail("OBL-GUIDED-A11Y-DIFFERENT");
    source.execution = { status: "SUBMITTED" };
    source.aggregate.execution_state = "SUBMITTED";
    source.truth.tameion_control_truth.execution_state = "SUBMITTED";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-GUIDED-A11Y-DIFFERENT", true)] }))
      : Promise.resolve(response(source)));
    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    openStageNavigator();
    const rail = screen.getByRole("navigation", { name: "Payment lifecycle navigation" });
    fireEvent.click(within(rail).getByRole("button", { name: "Reconciliation" }));
    expect(await screen.findByRole("heading", { name: "Current stage: Reconciliation. Step 6 of 6." })).toBeTruthy();
    const refreshedRail = screen.getByRole("navigation", { name: "Payment lifecycle navigation" });
    fireEvent.click(within(refreshedRail).getByRole("button", { name: "Obligation" }));

    expect(screen.getByRole("heading", {
      name: "Viewed stage: Obligation. Current lifecycle position: Reconciliation. Step 1 of 6.",
    })).toBeTruthy();
  });

  it("uses one primary rail, makes locked stages unavailable, and keeps Back/Continue read-only", async () => {
    const source = assessedDetail("OBL-GUIDED-01", "HOLD");
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-GUIDED-01", true)] }))
      : Promise.resolve(response(source)));
    renderWithExplicitFirstSelection();
    const workspace = await screen.findByRole("region", { name: "Genuine obligation workspace" });
    const rail = openStageNavigator();
    expect(screen.queryByRole("navigation", { name: "Command Center surfaces" })).toBeNull();
    expect(within(rail).getByRole("button", { name: "Obligation" }).getAttribute("data-stage-state")).toBe("COMPLETED");
    expect(within(rail).getByRole("button", { name: "Assessment" }).getAttribute("data-stage-state")).toBe("CURRENT");
    expect((within(rail).getByRole("button", { name: "Authorization" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(rail).getByRole("button", { name: "Reconciliation" }) as HTMLButtonElement).disabled).toBe(true);

    const before = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    fireEvent.click(within(rail).getByRole("button", { name: "Authorization" }));
    expect(screen.getByTestId("current-next-step").textContent).toContain("Viewing Obligation · Current position: Assessment");
    expect((within(rail).getByRole("button", { name: "Authorization" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /^Continue to / })).toBeNull();
    fireEvent.click(within(rail).getByRole("button", { name: "Obligation" }));
    expect(screen.getByTestId("current-next-step").textContent).toContain("Viewing Obligation · Current position: Assessment");
    expect(workspace).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(before);
  });

  it("exposes Continue to Authorization only after current PAY review and route prerequisites, without merging the action", async () => {
    const pay = proxyPrepared(assessedDetail("OBL-GUIDED-PAY", "PAY"));
    pay.current_assessment.provider_mode = "LIVE_AI";
    pay.aggregate.product_trust_provenance = "CURRENT_PRODUCT_EVIDENCE";
    pay.aggregate.destination_verification_status = "VERIFIED";
    pay.aggregate.destination_operational_status = "ACTIVE";
    pay.aggregate.source_wallet_status = "ACTIVE";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [{ ...obligation("OBL-GUIDED-PAY", true), decision: "PAY", provider_mode: "LIVE_AI" }], sole_pay_candidate_id: "OBL-GUIDED-PAY" }))
      : Promise.resolve(response(pay)));
    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(screen.queryByRole("button", { name: "Continue to Authorization" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    fireEvent.click(screen.getByRole("button", { name: "Review current PAY assessment" }));
    const continueButtons = screen.getAllByRole("button", { name: "Continue to Authorization" });
    expect(continueButtons.length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Authorize payment" })).toBeNull();
    const before = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    fireEvent.click(continueButtons[0]);
    expect(await screen.findByText(/Viewing Authorization · current position/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Authorize payment" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(before);
  });

  it("auto-opens Assessment only after a successful action and refreshed detail confirm it", async () => {
    const refreshed = detail("OBL-GUIDED-REFRESH");
    refreshed.current_assessment = assessedDetail("OBL-GUIDED-REFRESH", "HOLD").current_assessment;
    delete refreshed.current_assessment.race;
    const currentAssessment = refreshed.current_assessment;
    const exactReceipt = {
      assessment_id: currentAssessment.assessment_id,
      assessment_hash: currentAssessment.assessment_hash,
      aggregate_version: currentAssessment.aggregate_version,
      decision: {
        obligation_id: currentAssessment.obligation_id,
        decision: currentAssessment.decision,
        reasons: currentAssessment.reasons,
      },
    };
    const delayedDetail = deferred<Response>();
    let detailReads = 0;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [obligation("OBL-GUIDED-REFRESH", true)] }));
      if (url.endsWith("/assess") && init?.method === "POST") return Promise.resolve(response(exactReceipt));
      if (url === "/api/obligations/OBL-GUIDED-REFRESH") {
        detailReads += 1;
        return detailReads === 1 ? Promise.resolve(response(detail("OBL-GUIDED-REFRESH"))) : delayedDetail.promise;
      }
      return Promise.resolve(response({ error: "Unexpected mutation." }, 404));
    });
    renderWithExplicitFirstSelection();
    await screen.findByRole("button", { name: "Run AI Assessment" });
    fireEvent.click(screen.getByRole("button", { name: "Run AI Assessment" }));
    await waitFor(() => expect(detailReads).toBe(2));
    expect(screen.getByRole("heading", { name: "Current stage: Obligation. Step 1 of 6." })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Payment lifecycle navigation" })).toBeNull();
    await act(async () => { delayedDetail.resolve(response(refreshed)); });
    await waitFor(() => expect(screen.getByRole("region", { name: "Assessment result" })).toBeTruthy());
    expect(screen.getByRole("heading", { name: "Current stage: Assessment. Step 2 of 6." })).toBe(document.activeElement);
    expect(screen.getByRole("status", { name: "Assessment request status" }).getAttribute("data-feedback-kind")).toBe("durable");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => init?.method)).toEqual(["POST"]);
  });

  it("stays on the viewed stage when a successful action cannot be confirmed by the refreshed server read", async () => {
    let detailReads = 0;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [obligation("OBL-GUIDED-STALE")] }));
      if (url.endsWith("/assess") && init?.method === "POST") return Promise.resolve(response({ accepted: true }));
      if (url === "/api/obligations/OBL-GUIDED-STALE") {
        detailReads += 1;
        return detailReads === 1 ? Promise.resolve(response(detail("OBL-GUIDED-STALE"))) : Promise.resolve(response(null, 503));
      }
      return Promise.resolve(response({ error: "Unexpected mutation." }, 404));
    });
    renderWithExplicitFirstSelection();
    await screen.findByRole("button", { name: "Run AI Assessment" });
    fireEvent.click(screen.getByRole("button", { name: "Run AI Assessment" }));
    await waitFor(() => expect(detailReads).toBe(2));
    await waitFor(() => expect(screen.getByTestId("current-next-step").textContent).toContain("stale"));
    expect(screen.getByRole("heading", { name: "Current stage: Obligation. Step 1 of 6." })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Payment lifecycle navigation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to Assessment" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => init?.method)).toEqual(["POST"]);
  });
});
