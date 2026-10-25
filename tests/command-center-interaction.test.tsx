/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from "@testing-library/react";

import { CommandCenter, isRetryableProviderValidationFailure } from "../app/command-center";
import { webcrypto, createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { assessmentReviewSnapshot } from "../src/client/assessment-review-snapshot";

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

/** Existing interaction cases exercise selected-stage behavior. They now
 * model the operator explicitly choosing the first fixture row after the
 * unselected entry screen has loaded. The dedicated entry test uses rtlRender
 * directly and asserts that no row is selected by default. */
function renderWithExplicitFirstSelection(csrfToken?: string) {
  const result = rtlRender(<CommandCenter csrfToken={csrfToken} />);
  void waitFor(() => {
    const main = screen.getByRole("main");
    const row = main.querySelector<HTMLButtonElement>("button[data-obligation-id]");
    if (row) return row;
    if (/No payables|Payables are unavailable/.test(main.textContent ?? "")) return null;
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
    financial_action_eligible: true,
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

function selectedFinancialScope(id: string, aggregateVersion = 1, record: Record<string, unknown> = detail(id).record) {
  const now = Date.now();
  return {
    schema_version: "SELECTED-FINANCIAL-SCOPE-1",
    status: "PASS",
    scope: "CONTROLLED_FINANCIAL_NAMESPACE",
    namespace: "CONTROLLED-UAT",
    selected_obligation_id: id,
    selected_aggregate_version: aggregateVersion,
    selected_source_record_sha256: createHash("sha256").update(canonicalize(record)).digest("hex"),
    source_valid_until: new Date(now + 60_000).toISOString(),
    observed_at: new Date(now).toISOString(),
    membership: "COMPLETE",
    assessment_coverage: { status: "PASS" },
    competing_candidate: { status: "NONE" },
    uncertain_execution: { status: "NONE" },
    reason: "Selected controlled instruction is current in the complete controlled financial namespace.",
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
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function invokeClickHandler(button: HTMLButtonElement): Promise<unknown> {
  const onClick = captureClickHandler(button);
  let operation: unknown;
  act(() => { operation = onClick(); });
  return operation as Promise<unknown>;
}

function captureClickHandler(button: HTMLButtonElement): () => unknown {
  const reactPropsKey = Object.keys(button).find((key) => key.startsWith("__reactProps$"));
  if (!reactPropsKey) throw new Error("React click callback is unavailable");
  const onClick = (button as unknown as Record<string, { onClick?: () => unknown }>)[reactPropsKey].onClick;
  if (!onClick) throw new Error("React click callback is unavailable");
  return onClick;
}

describe("Command Center mounted Operational Report", () => {
  const fetchMock = vi.fn<typeof fetch>();

  beforeEach(() => {
    localStorage.clear();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows the source-backed queue on a compact dashboard and opens Stage 1 without a second queue owner", async () => {
    fetchMock.mockResolvedValue(response({obligations:[{...obligation("OBL-DASH"),source_group:"GENUINE_COMPANY",beneficiary_name:"du",due_date:"2026-10-15"}]}));
    rtlRender(<CommandCenter initialView="dashboard" walletSummary={<div>Wallet observation</div>} />);
    expect(await screen.findByRole("heading", {name:"Dashboard"})).toBeTruthy();
    expect(screen.getByText("Wallet observation")).toBeTruthy();
    expect(within(screen.getByRole("region", {name:"Total payables"})).getByText("1")).toBeTruthy();
    const reviewPayables = screen.getByRole("button", {name:"Review payables"});
    expect(reviewPayables).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url])=>String(url)==="/api/obligations")).toHaveLength(1);
    reviewPayables.focus();
    fireEvent.click(reviewPayables, {detail: 0});
    const stageHeading = await screen.findByRole("heading", {name:"Choose a payable"});
    expect(stageHeading.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(stageHeading);
    expect(obligationRow("OBL-DASH")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([url])=>String(url)==="/api/obligations")).toHaveLength(1);
    const dashboardButton = screen.getByRole("button", {name:"Dashboard"});
    dashboardButton.focus();
    fireEvent.click(dashboardButton, {detail: 0});
    const dashboardHeading = screen.getByRole("heading", {name:"Dashboard"});
    expect(dashboardHeading.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(dashboardHeading);
  });

  it("groups server-admitted company obligations separately from testnet demo and unknown records",async()=>{
    const company={...obligation("COMPANY"),source_group:"GENUINE_COMPANY"};
    const demo={...obligation("DEMO"),source_group:"DEMO_ARC_TESTNET"};
    fetchMock.mockResolvedValue(response({obligations:[company,demo,obligation("UNKNOWN")]}));
    rtlRender(<CommandCenter/>);
    await waitFor(()=>expect(obligationRow("COMPANY")).toBeTruthy());
    expect(within(screen.getByRole("region",{name:"Company payables"})).getByRole("button").dataset.obligationId).toBe("COMPANY");
    expect(within(screen.getByRole("region",{name:"Demo · Arc Testnet"})).getByRole("button").dataset.obligationId).toBe("DEMO");
    expect(within(screen.getByRole("region",{name:"Other review records"})).getByRole("button").dataset.obligationId).toBe("UNKNOWN");
  });
  it("omits an empty demo section without inventing a dollar entry",async()=>{
    fetchMock.mockResolvedValue(response({obligations:[{...obligation("COMPANY"),source_group:"GENUINE_COMPANY"}]}));
    rtlRender(<CommandCenter/>);await waitFor(()=>expect(obligationRow("COMPANY")).toBeTruthy());
    expect(screen.queryByRole("region",{name:"Demo · Arc Testnet"})).toBeNull();
    expect(screen.getByRole("complementary").querySelectorAll("button[data-obligation-id]")).toHaveLength(1);
  });
  it("keeps the single selected-identity action in a permanent contextual strip", async () => {
    fetchMock.mockImplementation(input => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A"), obligation("OBL-B")] }))
      : Promise.resolve(response(detail(String(input).split("/").at(-1)!))));
    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-A")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-A"));
    const action = await screen.findByRole("button", { name: "Run AI Assessment" });
    const strip = screen.getByRole("region", { name: "Current payable action" });
    expect(strip.contains(action)).toBe(true);
    expect(strip.textContent).toContain("OBL-A · Supplier not recorded · 125.00 USD");
    expect(strip.textContent).not.toMatch(/Workflow now:|Owner:|Payment authority remains separate/);
    expect(screen.getAllByRole("button", { name: "Run AI Assessment" })).toHaveLength(1);
    fireEvent.click(obligationRow("OBL-B"));
    await waitFor(() => expect(strip.textContent).toContain("OBL-B · Supplier not recorded · 125.00 USD"));
    expect(strip.textContent).not.toContain("OBL-A");
    expect(fetchMock.mock.calls.filter(([,init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("shows a plain authorization summary with exact evidence collapsed", async () => {
    const authorized = proxyPrepared(sealedDetail("OBL-AUTH-SUMMARY"));
    fetchMock.mockImplementation(input => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-AUTH-SUMMARY", true)] }))
      : Promise.resolve(response(authorized)));
    renderWithExplicitFirstSelection();await screen.findByRole("region", { name: "Genuine obligation workspace" });
    navigateStage("Authorization");
    const summary=screen.getByRole("region",{name:"Authorization summary"});
    expect(summary.textContent).toContain("Source payable");expect(summary.textContent).toContain("Testnet destination");
    expect(summary.textContent).toContain("does not discharge");expect(summary.textContent).toContain("Next owner");
    const disclosure=screen.getByText("View payment instruction details").closest("details");
    expect(disclosure?.open).toBe(false);
    const strip=screen.getByRole("region",{name:"Current payable action"});
    expect(strip.textContent).toContain("OBL-AUTH-SUMMARY · Supplier not recorded · 125.00 USD");
    expect(strip.textContent).not.toMatch(/Workflow now:|Owner:|Authorization recorded/);
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
    expect(document.getElementById("genuine-obligation-queue")?.className).toBe("block");
    expect(screen.getByRole("button", { name: "Close payables list" })).toBeTruthy();
    expect(screen.getByRole("main").querySelectorAll('button[data-obligation-id][aria-current="true"]')).toHaveLength(0);
    expect(screen.getByTestId("current-next-step").querySelector("h3")?.textContent).toBe("Choose a payable");
    expect(screen.getByTestId("current-next-step").textContent).toContain("Choose a payable to review its current status.");
    expect(screen.getByTestId("current-next-step").textContent).not.toMatch(/no genuine obligations|demo mode|loading/i);
    expect(screen.getByRole("main").textContent).not.toMatch(/no genuine obligations to show|open demo mode|loading genuine obligations/i);
    expect(screen.getByRole("main").querySelectorAll('[aria-label*="loading" i]')).toHaveLength(0);
    expect(screen.getByRole("main").querySelector('button[data-primary-action="true"]')?.textContent).toContain("Choose a payable");
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith("/api/obligations/") && String(input) !== "/api/obligations")).toHaveLength(0);

    for (const [index, id] of ids.entries()) {
      fireEvent.click(obligationRow(id));
      await waitFor(() => expect(obligationRow(id).getAttribute("aria-current")).toBe("true"));
      const selectedIdentity = screen.getByRole("region", { name: "Selected source payable" });
      await waitFor(() => expect(selectedIdentity.textContent).toContain(`Source ${id}`));
      expect(selectedIdentity.textContent).toContain(`${index + 1}.00 USD`);
      expect(screen.getByRole("region", { name: "Current payable action" }).textContent).toContain(`${id} · Source ${id} · ${index + 1}.00 USD`);
      expect(obligationRow(id).getAttribute("aria-current")).toBe("true");
    }
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("shows loading progress only until a genuine queue response arrives", async () => {
    const list = deferred<Response>();
    fetchMock.mockReturnValue(list.promise);

    rtlRender(<CommandCenter />);
    expect(screen.getAllByRole("status").every((status) => status.textContent?.includes("Loading payables"))).toBe(true);
    expect(screen.queryByText("Choose a payable", { selector: "h3" })).toBeNull();
    expect(screen.queryByText("No payables", { selector: "h3" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose a payable" })).toBeNull();
    expect(screen.getByRole("main").textContent).not.toMatch(/no genuine obligations to show|open demo mode/i);
    expect(screen.getByRole("main").querySelectorAll('[aria-label*="loading" i]')).toHaveLength(0);

    list.resolve(response({ obligations: [obligation("OBL-A")] }));
    await waitFor(() => expect(screen.getByTestId("current-next-step").querySelector("h3")?.textContent).toBe("Choose a payable"));
    expect(screen.getByRole("main").querySelectorAll('button[data-obligation-id][aria-current="true"]')).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("shows a genuine empty-queue state only after a successful empty response", async () => {
    fetchMock.mockResolvedValue(response({ obligations: [] }));

    rtlRender(<CommandCenter />);
    expect(await screen.findByText("No payables", { selector: "h3" })).toBeTruthy();
    expect(screen.getByTestId("current-next-step").textContent).toContain("Refresh the list to check again");
    expect(screen.getByRole("main").textContent).not.toMatch(/demo mode|loading genuine obligations/i);
    expect(screen.getByRole("main").querySelectorAll('button[data-obligation-id]')).toHaveLength(0);
    expect(screen.getByRole("main").querySelectorAll('[aria-label*="loading" i]')).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps an unavailable genuine queue distinct from loading and empty", async () => {
    fetchMock.mockResolvedValue(response({ error: "Queue read unavailable" }, 503));

    rtlRender(<CommandCenter />);
    expect(await screen.findByText("Payables unavailable", { selector: "h3" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Payables are unavailable");
    expect(screen.getByTestId("current-next-step").textContent).toContain("Retry before selecting a payable");
    expect(screen.getByRole("main").textContent).not.toMatch(/no genuine obligations to show|open demo mode|loading/i);
    expect(screen.queryByText("Choose a payable", { selector: "h3" })).toBeNull();
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
    await screen.findByRole("region", { name: "Selected source payable" });
    const assess = await screen.findByRole("button", { name: "Run AI Assessment" });
    fireEvent.click(assess);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/OBL-A/assess") && init?.method === "POST")).toBe(true));

    const writesBeforeNavigation = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    fireEvent.click(obligationRow("OBL-B"));
    await waitFor(() => expect(obligationRow("OBL-B").getAttribute("aria-current")).toBe("true"));
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected source payable" }).textContent).toContain("Source OBL-B"));
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(writesBeforeNavigation);

    assessment.resolve(response({ error: "Assessment unavailable" }, 503));
    await waitFor(() => expect((screen.getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement).disabled).toBe(false));
    expect(obligationRow("OBL-B").getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("region", { name: "Selected source payable" }).textContent).toContain("Source OBL-B");
    expect(listReads).toBe(1);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(writesBeforeNavigation);
  });

  it("keeps wallet observation unavailable without the authenticated owner summary", async () => {
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-FUNDING-AUTH")] }))
      : Promise.resolve(response(detail("OBL-FUNDING-AUTH"))));

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-FUNDING-AUTH")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-FUNDING-AUTH"));
    await screen.findByRole("region", { name: "Selected source payable" });

    expect(screen.queryByRole("region", { name: "Wallet funding and payment readiness" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("does not contradict a verified owner balance on the empty obligation screen", async () => {
    fetchMock.mockResolvedValue(response({ obligations: [] }));

    rtlRender(<CommandCenter
      walletSummary={<div>Verified wallet summary</div>}
      walletBalance={{amount:"19.989211477825042",asset:"USDC",network:"ARC-TESTNET",captured_at:"2026-10-13T16:46:10.708Z"}}
    />);

    await screen.findAllByText("No payables");
    expect(screen.queryByRole("region", { name: "Wallet funding and payment readiness" })).toBeNull();
    expect(screen.getByRole("main").textContent).not.toContain("USDC balance not verified");
  });

  it("keeps the verified owner balance in the owner summary without duplicating it in obligation detail", async () => {
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-FUNDING-VERIFIED")] }))
      : Promise.resolve(response(detail("OBL-FUNDING-VERIFIED"))));

    rtlRender(<CommandCenter
      walletSummary={<div>Verified wallet summary</div>}
      walletBalance={{amount:"19.989211477825042",asset:"USDC",network:"ARC-TESTNET",captured_at:"2026-10-13T16:46:10.708Z"}}
    />);
    await waitFor(() => expect(obligationRow("OBL-FUNDING-VERIFIED")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-FUNDING-VERIFIED"));
    await screen.findByRole("region", { name: "Selected source payable" });

    expect(screen.getByText("Verified wallet summary")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Wallet funding and payment readiness" })).toBeNull();
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
    const selectedIdentity = screen.getByRole("region", { name: "Selected source payable" });
    await waitFor(() => expect(selectedIdentity.textContent).toContain("Stable selected source"));
    const detailReads = fetchMock.mock.calls.filter(([input]) => String(input) === "/api/obligations/OBL-J0C-001").length;

    fireEvent.click(obligationRow("OBL-J0C-001"));

    expect(screen.getByRole("region", { name: "Selected source payable" }).textContent).toContain("Stable selected source");
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

    const selectedIdentity = screen.getByRole("region", { name: "Selected source payable" });
    await waitFor(() => expect(selectedIdentity.textContent).toContain("Current final A"));
    expect(selectedIdentity.textContent).not.toContain("Stale");
    expect(obligationRow("OBL-A").getAttribute("aria-current")).toBe("true");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps the removed client-only payment report absent after assessment detail loads", async () => {
    const list = deferred<Response>();
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      return url === "/api/obligations" ? list.promise : selectedDetail.promise;
    });

    renderWithExplicitFirstSelection();
    expect(screen.queryByText("Related payment information")).toBeNull();
    expect(screen.queryByText(/Payment review report/)).toBeNull();

    list.resolve(response({ obligations: [obligation("OBL-A", true)] }));
    await waitFor(() => expect(obligationRow("OBL-A")).toBeTruthy());
    expect(screen.queryByText("Related payment information")).toBeNull();
    selectedDetail.resolve(response(assessedDetail("OBL-A", "HOLD")));
    await waitFor(() => expect(screen.getByRole("main").querySelector('nav[aria-label="Payment lifecycle navigation"]')).not.toBeNull());
    openStageNavigator();
    await screen.findByRole("navigation", { name: "Payment lifecycle navigation" });
    expect(screen.queryByText("Related payment information")).toBeNull();
    expect(screen.queryByRole("button", { name: /Payment review report/i })).toBeNull();
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
  });

  it("does not expose report controls while selected detail is loading or unavailable", async () => {
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A")] }))
      : selectedDetail.promise);

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(screen.getByTestId("current-next-step").textContent).toContain("Loading current payable status."));
    expect(screen.queryByText("Related payment information")).toBeNull();
    expect(screen.queryByText(/Payment review report/)).toBeNull();
    selectedDetail.resolve(response(detail("OBL-A")));
    expect(await screen.findByRole("button", { name: "Run AI Assessment" })).toBeTruthy();
    expect(screen.queryByText("Related payment information")).toBeNull();
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
  });

  it("keeps Operational Report absent for a failed or empty initial queue", async () => {
    fetchMock
      .mockResolvedValueOnce(response(null, 503))
      .mockResolvedValueOnce(response({ obligations: [] }));

    renderWithExplicitFirstSelection();
    expect(await screen.findByText(/Payables are unavailable/)).toBeTruthy();
    expect(screen.queryByText("Related payment information")).toBeNull();
    expect(screen.queryByText(/Payment review report/)).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry payables" }));
    expect(await screen.findByText("No payables are currently available.")).toBeTruthy();
    expect(screen.queryByText("Related payment information")).toBeNull();
    expect(screen.queryByText(/Payment review report/)).toBeNull();
  });

  it("shows the selected detail unavailable state after a failed read", async () => {
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A")] }))
      : selectedDetail.promise);

    renderWithExplicitFirstSelection();
    await waitFor(() => expect(screen.getByTestId("current-next-step").textContent).toContain("Loading current payable status."));
    expect(screen.queryByText("Related payment information")).toBeNull();
    selectedDetail.resolve(response(null, 502));
    expect(await screen.findByText(/Selected payable status is unavailable/)).toBeTruthy();
    expect(screen.queryByText("Related payment information")).toBeNull();
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
  });

  it("makes assessment the genuine obligation action and omits demo/report/technical surfaces from Screen 1", async () => {
    const aedDetail = detail("OBL-A");
    aedDetail.record.amount = "367.25";
    aedDetail.record.currency = "AED";
    aedDetail.aggregate.amount = "100.000000";
    aedDetail.demo_arc_trust_simulated = true;
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A", false, "AED")] }))
      : Promise.resolve(response(aedDetail)));

    renderWithExplicitFirstSelection("verified-session-csrf");
    await waitFor(() => expect(obligationRow("OBL-A")).toBeTruthy());
    const workspace = await screen.findByRole("region", { name: "Genuine obligation workspace" });
    const main = screen.getByRole("main");
    expect(main.getAttribute("dir")).toBe("ltr");
    expect(screen.queryByRole("navigation", { name: "Payment lifecycle navigation" })).toBeNull();
    expect(screen.queryByText("Training scenario")).toBeNull();
    expect(screen.queryByText("Control and audit records")).toBeNull();
    expect(screen.queryByText(/Payment review report/)).toBeNull();
    expect(screen.getByRole("button", { name: "Run AI Assessment" })).toBeTruthy();
    const assess = screen.getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement;
    expect(assess.disabled).toBe(false);

    expect(workspace.textContent).toContain("Selected payable");
    expect(workspace.textContent).not.toContain("indicative only");
    expect(workspace.textContent).not.toContain("1 USD = AED 3.6725");
    expect(workspace.textContent).not.toContain("Execution authority");
    expect(workspace.textContent).not.toContain("SIMULATED");
    expect(workspace.textContent).not.toContain("TEST-WALLET");
    expect(screen.queryByText("Training scenario")).toBeNull();
    expect(screen.queryByText("Control and audit records")).toBeNull();
    expect(screen.queryByText(/Payment review report/)).toBeNull();
    fireEvent.click(assess);
    await waitFor(() => {
      const assessment = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/OBL-A/assess") && init?.method === "POST");
      expect(assessment?.[1]?.headers).toMatchObject({
        "Content-Type": "application/json",
        "X-Tameion-CSRF": "verified-session-csrf",
      });
      expect(assessment?.[1]?.body).toBe("{}");
    });
  });

  it("shows purposeful AI assessment progress while the request is in flight", async () => {
    const assessment = deferred<Response>();
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [obligation("OBL-A")] }));
      if (url.endsWith("/assess") && init?.method === "POST") return assessment.promise;
      return Promise.resolve(response(detail("OBL-A")));
    });
    renderWithExplicitFirstSelection();
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    const progress = await screen.findByRole("status", { name: "AI assessment in progress" });
    expect(progress.textContent).toContain("Reviewing payable details");
    const action=screen.getByRole("button", { name: "Refresh payable list" }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);expect(action.textContent).toBe("Assessing obligation…");
    assessment.resolve(response({ error: "Assessment unavailable." }, 503));
    await waitFor(() => expect(screen.queryByRole("status", { name: "AI assessment in progress" })).toBeNull());
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
    const stageHeading = screen.getByRole("heading", { name: "Assessment required" });
    expect(document.getElementById(stageHeading.getAttribute("aria-describedby")!)?.textContent).toBe("Workflow now: Obligation. Step 1 of 6.");
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    const feedback = await screen.findByRole("status", { name: "Assessment request status" });
    expect(feedback.getAttribute("aria-live")).toBe("assertive");
    expect(feedback.textContent).toContain("Assessment unavailable.");
  });

  it.each([
    ["202 in progress", 202, { status: "IN_PROGRESS" }, "Completion not confirmed"],
    ["202 recovery pending", 202, { status: "RECOVERY_PENDING" }, "Assessment result recorded"],
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
    await screen.findByRole("region", { name: "Selected source payable" });
    const stageHeading = screen.getByRole("heading", { name: "Approved For Payment" });
    expect(document.getElementById(stageHeading.getAttribute("aria-describedby")!)?.textContent).toBe("Reviewing: Obligation. Workflow now: Assessment. Reviewing step 1 of 6; workflow is at step 2 of 6.");

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
    await screen.findByRole("region", { name: "Selected source payable" });
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
    await screen.findByRole("region", { name: "Selected source payable" });
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    const feedback = await screen.findByRole("status", { name: "Assessment request status" });
    await waitFor(() => expect(feedback.getAttribute("data-feedback-kind")).toBe("pending"));
    expect(screen.getByRole("region", {name:"Hold reason and next action"}).textContent).toContain("Assessment confirmation pending");
    expect(screen.queryByRole("button", {name:"Run AI Assessment"})).toBeNull();
    expect(screen.queryByRole("status", { name: "Stage completion receipt" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Assessment result" })?.textContent ?? "").not.toContain("Assessment result — PAY");
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
    await screen.findByRole("region", { name: "Selected source payable" });
    navigateStage("Assessment");
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST")).toHaveLength(1));

    const inFlight = screen.getByRole("status", { name: "Assessment request status" });
    expect(inFlight.getAttribute("aria-live")).toBe("polite");
    expect(inFlight.getAttribute("data-feedback-kind")).toBe("in-flight");
    expect((screen.getByRole("button", { name: "Refresh payable list" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Refresh payable list" }));
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST")).toHaveLength(1);
    expect(localStorage.getItem("tameion.assessment-request.OBL-J0C-003")).toBeTruthy();
    const postsBeforeNavigation = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    navigateStage("Obligation");
    expect(screen.getByRole("status", { name: "Assessment request status" })).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postsBeforeNavigation);

    assessment.resolve(response({ status: "IN_PROGRESS" }, 202));
    await waitFor(() => expect(screen.getByRole("status", { name: "Assessment request status" }).getAttribute("data-feedback-kind")).toBe("pending"));
    expect(screen.getByRole("status", { name: "Assessment request status" }).textContent).toContain("not a current assessment result");
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
    await screen.findByRole("region", { name: "Selected source payable" });
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    await screen.findByRole("status", { name: "Assessment request status" });
    expect(fetchMock.mock.calls.filter(([url, init]) => String(url) === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST")).toHaveLength(1);

    fireEvent.click(obligationRow("OBL-J0C-001"));
    await waitFor(() => expect(obligationRow("OBL-J0C-001").getAttribute("aria-current")).toBe("true"));
    await screen.findByRole("region", { name: "Selected source payable" });
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
    await screen.findByRole("region", { name: "Selected source payable" });
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));

    const durable = await screen.findByRole("status", { name: "Assessment request status" });
    await waitFor(() => expect(screen.getByRole("status", {name:"Assessment request status"}).getAttribute("data-feedback-kind")).toBe("durable"));
    expect(screen.getByRole("status", {name:"Assessment request status"}).textContent).toContain("Refreshed obligation detail confirms this assessment receipt and version");
    expect(screen.getByRole("status", {name:"Assessment request status"}).textContent).toContain("assessment remains advisory");
    expect(localStorage.getItem("tameion.assessment-request.OBL-J0C-003")).toBeNull();
    const postsBeforeNavigation = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    navigateStage("Assessment");
    expect(screen.getByRole("status", { name: "Assessment request status" }).getAttribute("data-feedback-kind")).toBe("durable");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postsBeforeNavigation);
  });

  it("does not let a 200 response without a complete receipt become stale-currentness feedback", async () => {
    const ids = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005"];
    const rows = ids.map((id) => ({ ...obligation(id, true), decision: "PAY" as const }));
    const current = staleAssessmentDetail("OBL-J0C-003");
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: rows }));
      if (url === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST") return Promise.resolve(response({ accepted: true }));
      if (url === "/api/obligations/OBL-J0C-003") return Promise.resolve(response(structuredClone(current)));
      throw new Error(`Unexpected request: ${url}`);
    });
    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-J0C-003")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-J0C-003"));
    await screen.findByRole("region", { name: "Selected source payable" });
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    const feedback = await screen.findByRole("status", { name: "Assessment request status" });
    await waitFor(() => expect(feedback.getAttribute("data-feedback-kind")).toBe("unconfirmed"));
    expect(feedback.textContent).toContain("did not contain a complete assessment receipt");
    expect(feedback.textContent).not.toContain("Assessment currentness was not confirmed");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("offers a safe queue-summary observation for pending feedback without retrying or reading provider detail", async () => {
    const ids = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005"];
    const rows = ids.map((id) => ({ ...obligation(id, true), decision: "PAY" as const }));
    const current = staleAssessmentDetail("OBL-J0C-003");
    let queueReads = 0;
    let detailReads = 0;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") {
        queueReads += 1;
        return Promise.resolve(response({ obligations: rows }));
      }
      if (url === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST") return Promise.resolve(response({ status: "IN_PROGRESS" }, 202));
      if (url === "/api/obligations/OBL-J0C-003") {
        detailReads += 1;
        return Promise.resolve(response(structuredClone(current)));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-J0C-003")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-J0C-003"));
    await screen.findByRole("region", { name: "Selected source payable" });
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    const feedback = await screen.findByRole("status", { name: "Assessment request status" });
    await waitFor(() => expect(feedback.getAttribute("data-feedback-kind")).toBe("pending"));
    expect(feedback.textContent).toContain("Refresh the read-only queue summary for any newer record");
    expect(feedback.textContent).toContain("it does not confirm this operation's exact receipt or completion");
    const detailReadsBeforeObservation = detailReads;
    const queueReadsBeforeObservation = queueReads;
    const postsBeforeObservation = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").length;
    fireEvent.click(screen.getByRole("button", { name: "Refresh payable list" }));
    await waitFor(() => expect(queueReads).toBe(queueReadsBeforeObservation + 1));
    expect(detailReads).toBe(detailReadsBeforeObservation);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(postsBeforeObservation);
    expect(localStorage.getItem("tameion.assessment-request.OBL-J0C-003")).toBeTruthy();
    expect(screen.getByRole("status", { name: "Assessment request status" }).textContent).toContain("does not confirm this request's exact receipt or completion");
  });

  it("does not let an assessment receipt refresh from a prior 003 selection generation replace the current 003 view", async () => {
    const delayedOldRefresh = deferred<Response>();
    const rows = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005"]
      .map((id) => ({ ...obligation(id, true), decision: "PAY" as const }));
    const before = staleAssessmentDetail("OBL-J0C-003");
    const receipt = {
      assessment_id: "ASM-OBL-J0C-003-V2",
      assessment_hash: "b".repeat(64),
      aggregate_version: "2",
      decision: { obligation_id: "OBL-J0C-003", decision: "PAY", reasons: ["Current PAY recommendation; advisory only."] },
    };
    let reads003 = 0;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: rows }));
      if (url === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST") return Promise.resolve(response(receipt));
      if (url === "/api/obligations/OBL-J0C-003") {
        reads003 += 1;
        if (reads003 === 2) return delayedOldRefresh.promise;
        return Promise.resolve(response(structuredClone(before)));
      }
      if (url === "/api/obligations/OBL-J0C-001") return Promise.resolve(response(detail("OBL-J0C-001")));
      throw new Error(`Unexpected request: ${url}`);
    });
    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-J0C-003")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-J0C-003"));
    await screen.findByRole("region", { name: "Selected source payable" });
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    await waitFor(() => expect(reads003).toBe(2));
    fireEvent.click(obligationRow("OBL-J0C-001"));
    await screen.findByRole("region", { name: "Selected source payable" });
    fireEvent.click(obligationRow("OBL-J0C-003"));
    await screen.findByRole("region", { name: "Selected source payable" });
    await act(async () => { delayedOldRefresh.resolve(response(structuredClone(before))); });
    await waitFor(() => expect(obligationRow("OBL-J0C-003").getAttribute("aria-current")).toBe("true"));
    expect(screen.getByRole("status", { name: "Assessment request status" }).textContent).toContain("Assessment completion not confirmed");
    expect(localStorage.getItem("tameion.assessment-request.OBL-J0C-003")).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  });

  it("keeps current 003 detail and assessment result when its stale first response arrives last", async () => {
    const staleFirst003 = deferred<Response>();
    const currentFinal003 = deferred<Response>();
    const rows = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005"]
      .map((id) => ({ ...obligation(id, true), decision: "PAY" as const }));
    const staleDetail = assessedDetail("OBL-J0C-003", "HOLD");
    staleDetail.record.beneficiary_name = "Stale first 003";
    staleDetail.current_assessment.reasons = ["Stale first 003 HOLD assessment."];
    staleDetail.current_assessment.race.result.decision_summary = "Stale first 003 HOLD assessment.";
    const currentDetail = assessedDetail("OBL-J0C-003", "PAY");
    currentDetail.record.beneficiary_name = "Current final 003";
    currentDetail.current_assessment.reasons = ["Current final 003 PAY assessment."];
    currentDetail.current_assessment.race.result.decision_summary = "Current final 003 PAY assessment.";
    let reads003 = 0;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: rows }));
      if (url === "/api/obligations/OBL-J0C-003") {
        reads003 += 1;
        if (reads003 === 1) return staleFirst003.promise;
        if (reads003 === 2) return currentFinal003.promise;
        throw new Error("Only the two A→B→A detail requests are expected.");
      }
      if (url === "/api/obligations/OBL-J0C-001") return Promise.resolve(response(detail("OBL-J0C-001")));
      throw new Error(`Unexpected request: ${url}`);
    });

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-J0C-003")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-J0C-003"));
    fireEvent.click(obligationRow("OBL-J0C-001"));
    fireEvent.click(obligationRow("OBL-J0C-003"));
    await waitFor(() => expect(reads003).toBe(2));

    currentFinal003.resolve(response(structuredClone(currentDetail)));
    const selectedIdentity = await screen.findByRole("region", { name: "Selected source payable" });
    await waitFor(() => expect(selectedIdentity.textContent).toContain("Current final 003"));
    navigateStage("Assessment");
    const assessmentResult = await screen.findByRole("region", { name: "Assessment result" });
    expect(assessmentResult.textContent).toContain("Current final 003 PAY assessment.");
    expect(selectedIdentity.textContent).toContain("Current final 003");

    await act(async () => { staleFirst003.resolve(response(structuredClone(staleDetail))); });

    await waitFor(() => expect(selectedIdentity.textContent).toContain("Current final 003"));
    expect(selectedIdentity.textContent).not.toContain("Stale first 003");
    expect(obligationRow("OBL-J0C-003").getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("region", { name: "Assessment result" }).textContent).toContain("Current final 003 PAY assessment.");
    expect(screen.getByRole("region", { name: "Assessment result" }).textContent).not.toContain("Stale first 003 HOLD assessment.");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("shows current recovery after a successful response is superseded by a newer aggregate version", async () => {
    const rows = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005"]
      .map((id) => ({ ...obligation(id, true), decision: "PAY" as const }));
    const version2 = staleAssessmentDetail("OBL-J0C-003");
    const version3 = structuredClone(version2);
    version3.aggregate.aggregate_version = 3;
    version3.truth.tameion_control_truth.aggregate_version = 3;
    version3.current_assessment.aggregate_version = "2";
    const receipt = {
      assessment_id: "ASM-OBL-J0C-003-V2",
      assessment_hash: "c".repeat(64),
      aggregate_version: "2",
      decision: { obligation_id: "OBL-J0C-003", decision: "PAY", reasons: ["Current PAY recommendation; advisory only."] },
    };
    let detailReads = 0;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: rows }));
      if (url === "/api/obligations/OBL-J0C-003/assess" && init?.method === "POST") return Promise.resolve(response(receipt));
      if (url === "/api/obligations/OBL-J0C-003") {
        detailReads += 1;
        return Promise.resolve(response(structuredClone(detailReads === 1 ? version2 : version3)));
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow("OBL-J0C-003")).toBeTruthy());
    fireEvent.click(obligationRow("OBL-J0C-003"));
    await screen.findByRole("region", { name: "Selected source payable" });
    navigateStage("Assessment");
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    await waitFor(() => expect(detailReads).toBe(2));
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh payable list" })).toBeTruthy();
    expect(screen.queryByText(/Assessment is recorded for the current selected obligation/)).toBeNull();
    expect(screen.getByRole("region", { name: "Hold reason and next action" }).textContent).toContain("Do not reassess or retry");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
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
    await screen.findByRole("region", { name: "Selected source payable" });
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
    expect(obligationRow("OBL-ASSURANCE-NOT-READY").textContent).toContain("Assessment result · PAY");
    expect(screen.getByRole("list", { name: "Payment lifecycle" }).textContent).toContain("Upcoming");
    expect(screen.getByTestId("current-next-step").textContent).toContain("View Assessment");
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    expect(screen.getByRole("region", { name: "Assessment result" }).textContent).toContain("PAY");
    expect(screen.getByTestId("payment-eligibility").textContent).toContain("Route checks pending; authorization locked");
    const authorizationStage = screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement;
    expect(authorizationStage.disabled).toBe(true);
    expect(screen.getByRole("list", { name: "Payment lifecycle" }).textContent).toContain("Upcoming");
    expect(screen.getAllByRole("button", { name: "Prepare testnet payment details" })).toHaveLength(1);
    expect(screen.queryByTestId("current-next-step")).toBeNull();
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
  });

  it("explains a refused testnet payment-detail preparation without retrying it", async () => {
    const pay = assessedDetail("OBL-PREFLIGHT-FEE-CAP", "PAY");
    pay.current_assessment.provider_mode = "LIVE_AI";
    pay.current_assessment.provider_used = "test-live-ai";

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") {
        return Promise.resolve(response({
          obligations: [{
            ...obligation("OBL-PREFLIGHT-FEE-CAP", true),
            decision: "PAY",
            provider_mode: "LIVE_AI",
          }],
        }));
      }
      if (url === "/api/internal/demo/real-testnet-payment/preflight" && init?.method === "POST") {
        return Promise.resolve(response({
          readiness: "BLOCKED",
          blocker: "FEE_CAP_EXCEEDED",
          captured_at: "2026-10-14T08:00:00.000Z",
        }, 409));
      }
      if (url === "/api/obligations/OBL-PREFLIGHT-FEE-CAP") {
        return Promise.resolve(response(structuredClone(pay)));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderWithExplicitFirstSelection("verified-session-csrf");
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    const prepare = await screen.findByRole("button", { name: "Prepare testnet payment details" });
    expect(screen.getByText("Authorized user",{exact:true})).toBeTruthy();
    fireEvent.click(prepare);

    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("estimated network fee exceeds the approved network-fee limit");
    expect(refusal.textContent).toContain("No payment was submitted");
    expect(document.activeElement).toBe(refusal);
    const preflightCalls = fetchMock.mock.calls.filter(([input, init]) =>
      String(input) === "/api/internal/demo/real-testnet-payment/preflight" && init?.method === "POST",
    );
    expect(preflightCalls).toHaveLength(1);
    expect(preflightCalls[0]?.[1]?.headers).toMatchObject({
      "Content-Type": "application/json",
      "X-Tameion-CSRF": "verified-session-csrf",
    });
    expect(JSON.parse(String(preflightCalls[0]?.[1]?.body))).toEqual({
      obligation_id: "OBL-PREFLIGHT-FEE-CAP",
      expected_version: 1,
    });
  });

  it("uses the selected controlled namespace observation instead of unrelated genuine assessment coverage", async () => {
    const selectedId = "TESTNET-CONTROLLED-SELECTED-001";
    const controlled = assessedDetail(selectedId, "PAY");
    controlled.source_group = "DEMO_ARC_TESTNET";
    controlled.selected_financial_scope = selectedFinancialScope(selectedId);
    controlled.current_assessment.provider_mode = "LIVE_AI";
    controlled.current_assessment.provider_used = "test-live-ai";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [
        { ...obligation("OBL-GENUINE-UNASSESSED"), source_group: "GENUINE_COMPANY" },
        { ...obligation(selectedId, true), source_group: "DEMO_ARC_TESTNET", decision: "PAY", provider_mode: "LIVE_AI" },
      ] }))
      : Promise.resolve(response(structuredClone(controlled))));

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow(selectedId)).toBeTruthy());
    fireEvent.click(obligationRow(selectedId));
    await screen.findByRole("region", { name: "Selected source payable" });
    fireEvent.click(await screen.findByRole("button", { name: "View Assessment" }));
    expect(screen.getByRole("button", { name: "Prepare testnet payment details" })).toBeTruthy();
    expect(screen.getByRole("main").textContent).not.toContain("Assess the remaining payables before authorization review");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it.each([
    ["missing", undefined],
    ["foreign", { ...selectedFinancialScope("TESTNET-CONTROLLED-OTHER"), selected_obligation_id: "TESTNET-CONTROLLED-OTHER" }],
    ["stale", { ...selectedFinancialScope("TESTNET-CONTROLLED-SCOPE-LOCK"), selected_aggregate_version: 2 }],
    ["aged", { ...selectedFinancialScope("TESTNET-CONTROLLED-SCOPE-LOCK"), observed_at: new Date(Date.now() - 5 * 60_000 - 1).toISOString() }],
    ["expired", { ...selectedFinancialScope("TESTNET-CONTROLLED-SCOPE-LOCK"), source_valid_until: new Date(Date.now() - 1).toISOString() }],
    ["source-hash mismatch", { ...selectedFinancialScope("TESTNET-CONTROLLED-SCOPE-LOCK"), selected_source_record_sha256: "0".repeat(64) }],
    ["malformed", { ...selectedFinancialScope("TESTNET-CONTROLLED-SCOPE-LOCK"), assessment_coverage: undefined }],
    ["unknown", { ...selectedFinancialScope("TESTNET-CONTROLLED-SCOPE-LOCK"), status: "BLOCKED", uncertain_execution: { status: "PRESENT" }, reason: "An execution outcome is unknown." }],
  ])("keeps financial progression locked for a %s selected-scope observation", async (_label, observation) => {
    const selectedId = "TESTNET-CONTROLLED-SCOPE-LOCK";
    const controlled = assessedDetail(selectedId, "PAY");
    controlled.source_group = "DEMO_ARC_TESTNET";
    controlled.selected_financial_scope = observation;
    controlled.current_assessment.provider_mode = "LIVE_AI";
    controlled.current_assessment.provider_used = "test-live-ai";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [{ ...obligation(selectedId, true), source_group: "DEMO_ARC_TESTNET", decision: "PAY", provider_mode: "LIVE_AI" }] }))
      : Promise.resolve(response(structuredClone(controlled))));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    expect(screen.queryByRole("button", { name: "Prepare testnet payment details" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Review current PAY assessment" }));
    expect(screen.getByRole("main").textContent).toMatch(/controlled payment scope|execution outcome is unknown/i);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it.each([undefined, "UNVERIFIED", "GENUINE_COMPANY"] as const)("fails closed when a controlled queue row receives %s detail", async sourceGroup => {
    const selectedId = "TESTNET-CONTROLLED-LANE-MISMATCH";
    const controlled = assessedDetail(selectedId, "PAY");
    controlled.source_group = sourceGroup;
    controlled.selected_financial_scope = selectedFinancialScope(selectedId);
    controlled.current_assessment.provider_mode = "LIVE_AI";
    controlled.current_assessment.provider_used = "test-live-ai";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [{ ...obligation(selectedId, true), source_group: "DEMO_ARC_TESTNET", decision: "PAY", provider_mode: "LIVE_AI" }] }))
      : Promise.resolve(response(structuredClone(controlled))));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    expect(screen.queryByRole("button", { name: "Prepare testnet payment details" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("invalidates a retained controlled payment callback across pagehide", async () => {
    const selectedId = "TESTNET-CONTROLLED-PAGE-LIFETIME";
    const controlled = assessedDetail(selectedId, "PAY");
    controlled.source_group = "DEMO_ARC_TESTNET";
    controlled.selected_financial_scope = selectedFinancialScope(selectedId);
    controlled.current_assessment.provider_mode = "LIVE_AI";
    controlled.current_assessment.provider_used = "test-live-ai";
    fetchMock.mockImplementation((input, init) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [{ ...obligation(selectedId, true), source_group: "DEMO_ARC_TESTNET", decision: "PAY", provider_mode: "LIVE_AI" }] }))
      : init?.method === "POST"
        ? Promise.resolve(response({ error: "POST must remain unreachable" }, 500))
        : Promise.resolve(response(structuredClone(controlled))));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    const retained = await screen.findByRole("button", { name: "Prepare testnet payment details" }) as HTMLButtonElement;
    const retainedClick = captureClickHandler(retained);
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(screen.queryByRole("button", { name: "Prepare testnet payment details" })).toBeNull();
    act(() => { void retainedClick(); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("invalidates a retained controlled authorization callback across pagehide", async () => {
    const selectedId = "TESTNET-CONTROLLED-AUTH-LIFETIME";
    const controlled = proxyPrepared(assessedDetail(selectedId, "PAY"));
    controlled.source_group = "DEMO_ARC_TESTNET";
    controlled.selected_financial_scope = selectedFinancialScope(selectedId);
    controlled.current_assessment.provider_mode = "LIVE_AI";
    controlled.current_assessment.provider_used = "test-live-ai";
    Object.assign(controlled.aggregate, {
      destination_verification_status: "VERIFIED",
      destination_operational_status: "ACTIVE",
      source_wallet_status: "ACTIVE",
      product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
    });
    fetchMock.mockImplementation((input, init) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [{ ...obligation(selectedId, true), source_group: "DEMO_ARC_TESTNET", decision: "PAY", provider_mode: "LIVE_AI", route_assurance_status: "Route assurance ready" }] }))
      : init?.method === "POST"
        ? Promise.resolve(response({ error: "POST must remain unreachable" }, 500))
        : Promise.resolve(response(structuredClone(controlled))));

    renderWithExplicitFirstSelection("verified-session-csrf");
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    fireEvent.click(await screen.findByRole("button", { name: "View Assessment" }));
    fireEvent.click(screen.getByRole("button", { name: "Review current PAY assessment" }));
    navigateStage("Authorization");
    const authorize = await screen.findByRole("button", { name: "Authorize payment" }) as HTMLButtonElement;
    const retainedClick = captureClickHandler(authorize);
    act(() => window.dispatchEvent(new Event("pagehide")));
    act(() => { void retainedClick(); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("rejects a retained controlled payment callback after A to B to A selection", async () => {
    const firstId = "TESTNET-CONTROLLED-CALLBACK-A", secondId = "TESTNET-CONTROLLED-CALLBACK-B";
    const details = new Map([firstId, secondId].map(id => {
      const value = assessedDetail(id, "PAY");
      value.source_group = "DEMO_ARC_TESTNET";
      value.selected_financial_scope = selectedFinancialScope(id);
      value.current_assessment.provider_mode = "LIVE_AI";
      value.current_assessment.provider_used = "test-live-ai";
      return [id, value] as const;
    }));
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [firstId, secondId].map(id => ({ ...obligation(id, true), source_group: "DEMO_ARC_TESTNET", decision: "PAY", provider_mode: "LIVE_AI" })) }));
      if (init?.method === "POST") return Promise.resolve(response({ error: "POST must remain unreachable" }, 500));
      return Promise.resolve(response(structuredClone(details.get(url.split("/").pop()!)!)));
    });

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow(firstId)).toBeTruthy());
    fireEvent.click(obligationRow(firstId));
    fireEvent.click(await screen.findByRole("button", { name: "View Assessment" }));
    const retained = await screen.findByRole("button", { name: "Prepare testnet payment details" }) as HTMLButtonElement;
    const retainedClick = captureClickHandler(retained);
    fireEvent.click(obligationRow(secondId));
    await waitFor(() => expect(obligationRow(secondId).getAttribute("aria-current")).toBe("true"));
    fireEvent.click(obligationRow(firstId));
    await waitFor(() => expect(obligationRow(firstId).getAttribute("aria-current")).toBe("true"));
    fireEvent.click(await screen.findByRole("button", { name: "View Assessment" }));
    await screen.findByRole("button", { name: "Prepare testnet payment details" });
    act(() => { void retainedClick(); });
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("does not adopt a controlled detail response that resolves after pagehide", async () => {
    const selectedId = "TESTNET-CONTROLLED-LATE-DETAIL";
    const controlled = assessedDetail(selectedId, "PAY");
    controlled.source_group = "DEMO_ARC_TESTNET";
    controlled.selected_financial_scope = selectedFinancialScope(selectedId);
    controlled.current_assessment.provider_mode = "LIVE_AI";
    controlled.current_assessment.provider_used = "test-live-ai";
    const pending = deferred<Response>();
    fetchMock.mockImplementation(input => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [{ ...obligation(selectedId, true), source_group: "DEMO_ARC_TESTNET", decision: "PAY", provider_mode: "LIVE_AI" }] }))
      : pending.promise);

    rtlRender(<CommandCenter />);
    await waitFor(() => expect(obligationRow(selectedId)).toBeTruthy());
    fireEvent.click(obligationRow(selectedId));
    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === `/api/obligations/${selectedId}`)).toBe(true));
    act(() => window.dispatchEvent(new Event("pagehide")));
    await act(async () => { pending.resolve(response(structuredClone(controlled)));await Promise.resolve(); });
    expect(screen.queryByRole("button", { name: "Prepare testnet payment details" })).toBeNull();
  });

  it("uses safe finance wording for an unknown payment-detail blocker", async () => {
    const pay = assessedDetail("OBL-PREFLIGHT-UNKNOWN", "PAY");
    pay.current_assessment.provider_mode = "LIVE_AI";
    pay.current_assessment.provider_used = "test-live-ai";

    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") {
        return Promise.resolve(response({ obligations: [{
          ...obligation("OBL-PREFLIGHT-UNKNOWN", true), decision: "PAY", provider_mode: "LIVE_AI",
        }] }));
      }
      if (url === "/api/internal/demo/real-testnet-payment/preflight" && init?.method === "POST") {
        return Promise.resolve(response({ readiness: "BLOCKED", blocker: "NEW_SAFE_BLOCKER" }, 409));
      }
      if (url === "/api/obligations/OBL-PREFLIGHT-UNKNOWN") {
        return Promise.resolve(response(structuredClone(pay)));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Prepare testnet payment details" }));

    const refusal = await screen.findByRole("alert");
    expect(refusal.textContent).toContain("Settlement readiness could not be verified");
    expect(refusal.textContent).toContain("No payment was submitted");
    expect(fetchMock.mock.calls.filter(([input, init]) =>
      String(input) === "/api/internal/demo/real-testnet-payment/preflight" && init?.method === "POST",
    )).toHaveLength(1);
  });

  it("does not render the static training placeholder or invoke payment routes", async () => {
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
    expect(screen.queryByText("Training scenario")).toBeNull();
    expect(screen.queryByText("Illustrative payment journey")).toBeNull();
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

    expect(await screen.findByText("Assessment result — HOLD")).toBeTruthy();
    expect(screen.getAllByText("Destination trust evidence is not verified.").length).toBeGreaterThan(0);
    expect(screen.getByRole("region", {name:"Hold reason and next action"}).textContent).toContain("Review the finding.");
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
    expect(screen.getByTestId("current-next-step").textContent).toContain("Loading current payable status.");
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
    expect(screen.queryByText(/No payment intent exists/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Authorization status unavailable" })).toBeNull();

    selectedDetail.resolve(response(null, 503));
    const recovery = await screen.findByRole("region", { name: "Exception recovery" });
    expect(recovery.textContent).toContain("Selected payable status is unavailable; retry before taking action.");
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
    await screen.findByText("No payables", { selector: "h3" });
    expect(screen.getByTestId("current-next-step").textContent).toContain("Refresh the list to check again");
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
    expect(screen.getByTestId("payment-eligibility").textContent).toMatch(/route checks pending/i);
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
    expect(screen.getByRole("region", { name: "Payment status" }).textContent).toContain("Current payment authority is unavailable");
    expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).getAttribute("data-stage-state")).toBe("COMPLETED");
    expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain("Payment");
  });

  it("records portal release with CSRF, resets consent and never auto-submits payment", async () => {
    const id="TESTNET-CONTROLLED-PORTAL-RELEASE";
    const authorized=proxyPrepared(sealedDetail(id));
    authorized.aggregate.destination_verification_status="VERIFIED";
    authorized.aggregate.destination_operational_status="ACTIVE";
    authorized.aggregate.source_wallet_status="ACTIVE";
    authorized.aggregate.product_trust_provenance="CURRENT_PRODUCT_EVIDENCE";
    authorized.execution_packet={packet_sha256:"c".repeat(64),packet:{obligation_id:id}};
    authorized.sealed_pae_instruction_hash="d".repeat(64);
    authorized.execution_gate="PORTAL_RELEASE_APPROVAL_REQUIRED";
    fetchMock.mockImplementation((input,init)=>{
      if(init?.method==="POST"){
        expect(String(input)).toBe(`/api/obligations/${id}/release`);
        expect(new Headers(init.headers).get("X-Tameion-CSRF")).toBe("verified-session-csrf");
        expect(JSON.parse(String(init.body))).toEqual({expected_version:authorized.aggregate.aggregate_version,packet_sha256:"c".repeat(64),pae_instruction_hash:"d".repeat(64),confirmation:"APPROVE EXACT TESTNET SETTLEMENT PROXY"});
        authorized.execution_gate="PORTAL_APPROVED_EXACT_PACKET";
        return Promise.resolve(response({code:"PAYMENT_RELEASE_APPROVED"}));
      }
      return Promise.resolve(response(String(input)==="/api/obligations"?{obligations:[obligation(id,true)]}:authorized));
    });
    renderWithExplicitFirstSelection("verified-session-csrf");await screen.findByRole("region",{name:"Genuine obligation workspace"});navigateStage("Payment");
    const approve=screen.getByRole("button",{name:"Approve payment release"}) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox",{name:/I have reviewed the exact testnet/}));expect(approve.disabled).toBe(false);fireEvent.click(approve);
    const pay=await screen.findByRole("button",{name:"Pay testnet USDC"}) as HTMLButtonElement;
    await waitFor(()=>expect(pay.disabled).toBe(true));
    expect((screen.getByRole("checkbox",{name:/I have reviewed the exact testnet/}) as HTMLInputElement).checked).toBe(false);
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });

  it.each([false,true])("shows unverified release-save feedback with readback lost=%s",async lostReadback=>{
    const id="TESTNET-CONTROLLED-UNCERTAIN-RELEASE",authorized=proxyPrepared(sealedDetail(id));
    Object.assign(authorized.aggregate,{destination_verification_status:"VERIFIED",destination_operational_status:"ACTIVE",source_wallet_status:"ACTIVE",product_trust_provenance:"CURRENT_PRODUCT_EVIDENCE"});
    authorized.execution_packet={packet_sha256:"c".repeat(64),packet:{obligation_id:id}};authorized.sealed_pae_instruction_hash="d".repeat(64);authorized.execution_gate="PORTAL_RELEASE_APPROVAL_REQUIRED";
    let posted=false;
    fetchMock.mockImplementation((input,init)=>{if(init?.method==="POST")posted=true;return Promise.resolve(init?.method==="POST"
      ? new Response(JSON.stringify({code:"OUTCOME_UNVERIFIED",error:"Release approval may have been recorded. Refresh current status before taking another action.",retry_submission:false}),{status:503})
      : lostReadback&&posted&&String(input)!=="/api/obligations"?new Response(JSON.stringify({code:"SESSION_REQUIRED"}),{status:401})
      : response(String(input)==="/api/obligations"?{obligations:[obligation(id,true)]}:authorized));});
    renderWithExplicitFirstSelection("verified-session-csrf");await screen.findByRole("region",{name:"Genuine obligation workspace"});navigateStage("Payment");
    fireEvent.click(screen.getByRole("checkbox",{name:/I have reviewed the exact testnet/}));fireEvent.click(screen.getByRole("button",{name:"Approve payment release"}));
    expect(await screen.findByText(/Release approval may have been recorded/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
    expect(screen.queryByRole("button",{name:"Pay testnet USDC"})).toBeNull();
  });

  it.each([
    [false,"OUTCOME_UNVERIFIED",503],[true,"OUTCOME_UNVERIFIED",503],
    [false,"RECONCILIATION_ONLY",409],[true,"RECONCILIATION_ONLY",409],
    [false,"RECONCILIATION_ONLY",202],[true,"RECONCILIATION_ONLY",202],
    [false,"EXECUTION_ALREADY_RECORDED",409],[true,"EXECUTION_ALREADY_RECORDED",409],
  ] as const)("explains execute uncertainty with lost readback=%s code=%s", async (lostReadback,code,status) => {
    const id = "TESTNET-CONTROLLED-EXECUTE-UNCERTAIN", authorized = proxyPrepared(sealedDetail(id));
    Object.assign(authorized.aggregate, {destination_verification_status:"VERIFIED",destination_operational_status:"ACTIVE",source_wallet_status:"ACTIVE",product_trust_provenance:"CURRENT_PRODUCT_EVIDENCE"});
    authorized.execution_packet={packet_sha256:"c".repeat(64),packet:{obligation_id:id}};
    authorized.sealed_pae_instruction_hash="d".repeat(64); authorized.execution_gate="PORTAL_APPROVED_EXACT_PACKET";
    let posted=false;
    fetchMock.mockImplementation((input,init)=>{
      if(init?.method==="POST"){posted=true; return Promise.resolve(response({code,retry_submission:false,execution_gate:"RECONCILIATION_ONLY",...(status===202?{execution:{obligation_id:id,status:"UNKNOWN"}}:{})},status));}
      if(posted && lostReadback && String(input)!=="/api/obligations")return Promise.resolve(response({code:"STATE_UNAVAILABLE"},503));
      return Promise.resolve(response(String(input)==="/api/obligations"?{obligations:[obligation(id,true)]}:authorized));
    });
    renderWithExplicitFirstSelection(); await screen.findByRole("region",{name:"Genuine obligation workspace"}); navigateStage("Payment");
    fireEvent.click(screen.getByRole("checkbox",{name:/I have reviewed the exact testnet/})); fireEvent.click(screen.getByRole("button",{name:"Pay testnet USDC"}));
    expect(await screen.findByText(code==="OUTCOME_UNVERIFIED"?/Payment may have been submitted/:/An execution attempt is recorded/)).toBeTruthy();
    await waitFor(()=>expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1));
    expect(screen.getByRole("alert").textContent).toMatch(/do not retry.*read-only reconciliation/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/no payment was submitted/i);
    await waitFor(()=>expect(screen.queryByRole("button",{name:"Pay testnet USDC"})).toBeNull());
    fireEvent.click(screen.getByRole("button",{name:"Refresh current status"}));
    await waitFor(()=>expect(fetchMock.mock.calls.filter(([url,init])=>String(url).endsWith(id)&&init?.method!=="POST").length).toBeGreaterThanOrEqual(3));
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });

  it.each([
    ["lost", 0, ""], ["gateway", 502, "<html>Bad gateway</html>"],
    ["timeout", 504, "Gateway timeout"], ["empty-success", 200, ""],
    ["malformed-success", 200, "{not json"], ["unrecognised-success", 200, '{"status":"PASS"}'],
    ["unconfirmed-settlement", 200, '{"code":"RECONCILED","execution":{"status":"SETTLED"}}'],
    ["unrecognised-refusal", 409, '{"code":"UNRECOGNISED","blocker":"INSUFFICIENT_BALANCE"}'],
    ["mixed-known-refusal", 403, '{"code":"CSRF_REJECTED","outcome":"UNKNOWN"}'],
    ["mixed-unknown", 503, '{"code":"OUTCOME_UNVERIFIED","blocker":"INSUFFICIENT_BALANCE","error":"Retry"}'],
    ["wallet-extra-outcome",503,'{"code":"BALANCE_NOT_VERIFIED","outcome":"UNKNOWN"}'],
    ["wallet-extra-retry",503,'{"code":"BALANCE_NOT_VERIFIED","retry_submission":false}'],
    ["wallet-wrong-status",409,'{"code":"BALANCE_NOT_VERIFIED"}'],
  ] as const)("retains no-retry after %s execute response and unchanged or lost readback", async (_case,status,body) => {
    const id="TESTNET-CONTROLLED-TRANSPORT-UNCERTAIN", authorized=proxyPrepared(sealedDetail(id));
    Object.assign(authorized.aggregate,{destination_verification_status:"VERIFIED",destination_operational_status:"ACTIVE",source_wallet_status:"ACTIVE",product_trust_provenance:"CURRENT_PRODUCT_EVIDENCE"});
    authorized.execution_packet={packet_sha256:"c".repeat(64),packet:{obligation_id:id}};
    authorized.sealed_pae_instruction_hash="d".repeat(64);authorized.execution_gate="PORTAL_APPROVED_EXACT_PACKET";
    let posted=false,loseReadback=false;
    fetchMock.mockImplementation((input,init)=>{
      if(init?.method==="POST") {posted=true;return status===0?Promise.reject(new TypeError("Failed to fetch")):Promise.resolve(new Response(body,{status}));}
      if(String(input)==="/api/obligations")return Promise.resolve(response({obligations:[obligation(id,true)]}));
      if(posted&&loseReadback)return Promise.resolve(response({},503));
      return Promise.resolve(response(authorized));
    });
    renderWithExplicitFirstSelection();await screen.findByRole("region",{name:"Genuine obligation workspace"});navigateStage("Payment");
    fireEvent.click(screen.getByRole("checkbox",{name:/I have reviewed the exact testnet/}));fireEvent.click(screen.getByRole("button",{name:"Pay testnet USDC"}));
    expect(await screen.findByText(/Payment may have been submitted/)).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toMatch(/do not retry or resubmit/i);
    expect(screen.getByRole("alert").textContent).not.toMatch(/no payment was submitted|Retry after|did not succeed/i);
    await waitFor(()=>expect(screen.queryByRole("button",{name:"Pay testnet USDC"})).toBeNull());
    expect(screen.queryByRole("button",{name:"Approve payment release"})).toBeNull();
    loseReadback=true;fireEvent.click(screen.getByRole("button",{name:"Refresh current status"}));
    await waitFor(()=>expect(fetchMock.mock.calls.filter(([url,init])=>String(url).endsWith(id)&&init?.method!=="POST").length).toBeGreaterThanOrEqual(3));
    expect(screen.getByRole("alert").textContent).toMatch(/do not retry or resubmit/i);
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });

  it('S05-F01 permits deliberate same-body confirmation after exact wallet refusal without automatic submission',async()=>{
    const id='TESTNET-CONTROLLED-S05-REFUSAL',authorized=proxyPrepared(sealedDetail(id));
    Object.assign(authorized.aggregate,{destination_verification_status:'VERIFIED',destination_operational_status:'ACTIVE',source_wallet_status:'ACTIVE',product_trust_provenance:'CURRENT_PRODUCT_EVIDENCE'});
    const key='SYNTHETIC-S05-ORIGINAL-KEY',hash='d'.repeat(64);
    authorized.execution_packet={packet_sha256:'c'.repeat(64),packet:{obligation_id:id,pae:{instruction_hash:hash,idempotency_key:key}}};authorized.sealed_pae_instruction_hash=hash;authorized.execution_gate='PORTAL_APPROVED_EXACT_PACKET';
    const bodies:string[]=[];
    fetchMock.mockImplementation((input,init)=>{
      if(init?.method==='POST'){
        expect(String(input)).toBe(`/api/obligations/${id}/execute`);bodies.push(String(init.body));
        if(bodies.length===1)return Promise.resolve(response({code:'BALANCE_NOT_VERIFIED'},503));
        return Promise.resolve(response({code:'RECONCILIATION_ONLY',execution:{obligation_id:id,idempotency_key:key,status:'UNKNOWN'}},202));
      }
      return Promise.resolve(response(String(input)==='/api/obligations'?{obligations:[obligation(id,true)]}:authorized));
    });
    renderWithExplicitFirstSelection('SYNTHETIC-S05-CSRF');await screen.findByRole('region',{name:'Genuine obligation workspace'});navigateStage('Payment');
    fireEvent.click(screen.getByRole('checkbox',{name:/I have reviewed the exact testnet/}));fireEvent.click(screen.getByRole('button',{name:'Pay testnet USDC'}));
    expect(await screen.findByText(/The request did not succeed \(BALANCE_NOT_VERIFIED\)/)).toBeTruthy();
    expect(screen.queryByText(/Payment may have been submitted/)).toBeNull();
    const pay=await screen.findByRole('button',{name:'Pay testnet USDC'});expect(bodies).toHaveLength(1);
    const confirm=screen.getByRole('checkbox',{name:/I have reviewed the exact testnet/}) as HTMLInputElement;if(confirm.checked)fireEvent.click(confirm);expect((pay as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(confirm);fireEvent.click(pay);
    await screen.findByText(/An execution attempt is recorded/);expect(bodies).toHaveLength(2);expect(bodies[1]).toBe(bodies[0]);expect(JSON.parse(bodies[1])).toMatchObject({packet_sha256:'c'.repeat(64),pae_instruction_hash:hash});
    expect(screen.queryByRole('button',{name:'Pay testnet USDC'})).toBeNull();
  });

  it('S05-F01 late known refusal never grants a different selection or stale read payment authority',async()=>{
    const id='TESTNET-CONTROLLED-S05-LATE',other='SYNTHETIC-S05-OTHER',authorized=proxyPrepared(sealedDetail(id)),pending=deferred<Response>();let failOriginal=false;
    Object.assign(authorized.aggregate,{destination_verification_status:'VERIFIED',destination_operational_status:'ACTIVE',source_wallet_status:'ACTIVE',product_trust_provenance:'CURRENT_PRODUCT_EVIDENCE'});
    authorized.execution_packet={packet_sha256:'c'.repeat(64),packet:{obligation_id:id}};authorized.sealed_pae_instruction_hash='d'.repeat(64);authorized.execution_gate='PORTAL_APPROVED_EXACT_PACKET';
    fetchMock.mockImplementation((input,init)=>init?.method==='POST'?pending.promise:Promise.resolve(response(String(input)==='/api/obligations'?{obligations:[obligation(id,true),obligation(other)]}:String(input).endsWith(other)?detail(other):failOriginal?{code:'STATE_UNAVAILABLE'}:authorized,failOriginal&&String(input).endsWith(id)?503:200)));
    renderWithExplicitFirstSelection();await screen.findByRole('region',{name:'Genuine obligation workspace'});navigateStage('Payment');fireEvent.click(screen.getByRole('checkbox',{name:/I have reviewed the exact testnet/}));fireEvent.click(screen.getByRole('button',{name:'Pay testnet USDC'}));
    fireEvent.click(obligationRow(other));await screen.findByRole('button',{name:'Run AI Assessment'});await act(async()=>pending.resolve(response({code:'BALANCE_NOT_VERIFIED'},503)));
    expect(screen.queryByRole('button',{name:'Pay testnet USDC'})).toBeNull();failOriginal=true;fireEvent.click(obligationRow(id));await screen.findByText(/Payable details are unavailable/);expect(screen.queryByRole('button',{name:'Pay testnet USDC'})).toBeNull();expect(fetchMock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  });

  it("preserves definitive pre-effect CSRF refusal recovery without claiming an uncertain submission",async()=>{
    const id="TESTNET-CONTROLLED-PRE-EFFECT",authorized=proxyPrepared(sealedDetail(id));
    Object.assign(authorized.aggregate,{destination_verification_status:"VERIFIED",destination_operational_status:"ACTIVE",source_wallet_status:"ACTIVE",product_trust_provenance:"CURRENT_PRODUCT_EVIDENCE"});
    authorized.execution_packet={packet_sha256:"c".repeat(64),packet:{obligation_id:id}};authorized.sealed_pae_instruction_hash="d".repeat(64);authorized.execution_gate="PORTAL_APPROVED_EXACT_PACKET";
    fetchMock.mockImplementation((input,init)=>Promise.resolve(init?.method==="POST"?response({code:"CSRF_REJECTED"},403):response(String(input)==="/api/obligations"?{obligations:[obligation(id,true)]}:authorized)));
    renderWithExplicitFirstSelection();await screen.findByRole("region",{name:"Genuine obligation workspace"});navigateStage("Payment");
    fireEvent.click(screen.getByRole("checkbox",{name:/I have reviewed the exact testnet/}));fireEvent.click(screen.getByRole("button",{name:"Pay testnet USDC"}));
    expect(await screen.findByText(/The request did not succeed \(CSRF_REJECTED\)/)).toBeTruthy();
    expect(screen.queryByText(/Payment may have been submitted/)).toBeNull();
    await waitFor(()=>expect(screen.getByRole("button",{name:"Pay testnet USDC"})).toBeTruthy());
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });

  it.each(["matching","wrong-instruction","wrong-packet","unconfirmed","lost"])("supersedes release uncertainty only for durable matching readback: %s", async readback => {
    const id="TESTNET-CONTROLLED-RECEIPT", authorized=proxyPrepared(sealedDetail(id));
    Object.assign(authorized.aggregate,{destination_verification_status:"VERIFIED",destination_operational_status:"ACTIVE",source_wallet_status:"ACTIVE",product_trust_provenance:"CURRENT_PRODUCT_EVIDENCE"});
    authorized.execution_packet={packet_sha256:"c".repeat(64),packet:{obligation_id:id}};authorized.sealed_pae_instruction_hash="d".repeat(64);authorized.execution_gate="PORTAL_RELEASE_APPROVAL_REQUIRED";
    let posted=false;
    fetchMock.mockImplementation((input,init)=>{
      if(init?.method==="POST"){posted=true;return Promise.resolve(response({code:"OUTCOME_UNVERIFIED",release_gate:"READ_ONLY_CONFIRMATION_REQUIRED",error:"Release approval may have been recorded. Refresh current status before taking another action.",retry_submission:false},503));}
      if(String(input)==="/api/obligations")return Promise.resolve(response({obligations:[obligation(id,true)]}));
      if(posted && readback==="lost")return Promise.resolve(response({},503));
      const restored=structuredClone(authorized);
      if(posted && readback!=="unconfirmed"){
        restored.execution_gate="PORTAL_APPROVED_EXACT_PACKET";restored.payment_release_current=true;
        restored.payment_release_approval={actor_id:"SYNTHETIC",approved_at:new Date().toISOString(),expires_at:new Date(Date.now()+10000).toISOString()};
        if(readback==="wrong-instruction")restored.sealed_pae_instruction_hash="e".repeat(64);
        if(readback==="wrong-packet")restored.execution_packet.packet_sha256="e".repeat(64);
      }
      return Promise.resolve(response(restored));
    });
    renderWithExplicitFirstSelection();await screen.findByRole("region",{name:"Genuine obligation workspace"});navigateStage("Payment");
    fireEvent.click(screen.getByRole("checkbox",{name:/I have reviewed the exact testnet/}));fireEvent.click(screen.getByRole("button",{name:"Approve payment release"}));
    if(readback==="matching"){
      expect(await screen.findByText(/Refreshed status confirms release approval for this same instruction/)).toBeTruthy();
      expect(screen.queryByText(/Release approval may have been recorded/)).toBeNull();
      expect((screen.getByRole("checkbox",{name:/I have reviewed the exact testnet/}) as HTMLInputElement).checked).toBe(false);
    }else expect(await screen.findByText(/Release approval may have been recorded/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });

  it.each(["matching","wrong-instruction","wrong-packet","unknown","missing-binding"])("retains execute uncertainty unless exact durable execution proves resolution: %s",async evidence=>{
    const id="TESTNET-CONTROLLED-EXECUTE-RECEIPT",authorized=proxyPrepared(sealedDetail(id));
    Object.assign(authorized.aggregate,{destination_verification_status:"VERIFIED",destination_operational_status:"ACTIVE",source_wallet_status:"ACTIVE",product_trust_provenance:"CURRENT_PRODUCT_EVIDENCE"});
    authorized.execution_packet={packet_sha256:"c".repeat(64),packet:{obligation_id:id,pae:{instruction_hash:"d".repeat(64),idempotency_key:"SYNTHETIC-EXECUTE-RECEIPT-KEY"}}};authorized.sealed_pae_instruction_hash="d".repeat(64);authorized.execution_gate="PORTAL_APPROVED_EXACT_PACKET";
    let posted=false;
    fetchMock.mockImplementation((input,init)=>{
      if(init?.method==="POST"){posted=true;return Promise.resolve(response({code:"OUTCOME_UNVERIFIED",retry_submission:false},503));}
      if(String(input)==="/api/obligations")return Promise.resolve(response({obligations:[obligation(id,true)]}));
      const read=structuredClone(authorized);
      if(posted){
        read.execution={obligation_id:id,idempotency_key:"SYNTHETIC-EXECUTE-RECEIPT-KEY",status:evidence==="unknown"?"UNKNOWN":"SETTLED",provider_ref:"SYNTHETIC-CONFIRMED-RECEIPT"};
        read.execution_gate="EXECUTION_ALREADY_RECORDED";
        read.settlement_evidence_binding={state:evidence==="missing-binding"?"UNAVAILABLE":"AVAILABLE_HISTORICAL",packet:{packet_sha256:evidence==="wrong-packet"?"e".repeat(64):"c".repeat(64),packet:structuredClone(authorized.execution_packet.packet)}};
        if(evidence==="wrong-instruction")read.sealed_pae_instruction_hash="e".repeat(64);
      }
      return Promise.resolve(response(read));
    });
    renderWithExplicitFirstSelection();await screen.findByRole("region",{name:"Genuine obligation workspace"});navigateStage("Payment");
    fireEvent.click(screen.getByRole("checkbox",{name:/I have reviewed the exact testnet/}));fireEvent.click(screen.getByRole("button",{name:"Pay testnet USDC"}));
    if(evidence==="matching")expect(await screen.findByText(/Refreshed status confirms an execution record for this same instruction/)).toBeTruthy();
    else expect(await screen.findByText(/Payment may have been submitted/)).toBeTruthy();
    expect(screen.queryByRole("button",{name:"Pay testnet USDC"})).toBeNull();
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });

  it.each(["coded","lost","gateway"])("retains a late %s financial outcome across A to B to A without attributing it to B",async outcome=>{
    const id="TESTNET-CONTROLLED-LATE-A",other="OBL-LATE-B",authorized=proxyPrepared(sealedDetail(id));
    Object.assign(authorized.aggregate,{destination_verification_status:"VERIFIED",destination_operational_status:"ACTIVE",source_wallet_status:"ACTIVE",product_trust_provenance:"CURRENT_PRODUCT_EVIDENCE"});
    authorized.execution_packet={packet_sha256:"c".repeat(64),packet:{obligation_id:id}};authorized.sealed_pae_instruction_hash="d".repeat(64);authorized.execution_gate="PORTAL_APPROVED_EXACT_PACKET";
    const pending=deferred<Response>();let failA=false;
    fetchMock.mockImplementation((input,init)=>{
      if(init?.method==="POST")return pending.promise;
      const url=String(input);
      return Promise.resolve(url==="/api/obligations"?response({obligations:[obligation(id,true),obligation(other)]}):url.endsWith(other)?response(detail(other)):failA?response({},503):response(authorized));
    });
    renderWithExplicitFirstSelection();await screen.findByRole("region",{name:"Genuine obligation workspace"});navigateStage("Payment");
    fireEvent.click(screen.getByRole("checkbox",{name:/I have reviewed the exact testnet/}));fireEvent.click(screen.getByRole("button",{name:"Pay testnet USDC"}));
    fireEvent.click(obligationRow(other));await screen.findByRole("button",{name:"Run AI Assessment"});
    expect(screen.queryByText(/Payment may have been submitted/)).toBeNull();
    failA=true;fireEvent.click(obligationRow(id));await screen.findByText(/Payable details are unavailable/);
    await act(async()=>{if(outcome==="lost")pending.reject(new TypeError("Lost response"));else pending.resolve(outcome==="gateway"?new Response("Bad gateway",{status:502}):response({code:"OUTCOME_UNVERIFIED",retry_submission:false},503));});
    expect(await screen.findByText(/Payment may have been submitted/)).toBeTruthy();
    fireEvent.click(obligationRow(other));await screen.findByRole("button",{name:"Run AI Assessment"});
    expect(screen.queryByText(/Payment may have been submitted/)).toBeNull();
    fireEvent.click(obligationRow(id));expect(await screen.findByText(/Payment may have been submitted/)).toBeTruthy();
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });

  it.each(["PORTAL_RELEASE_RENEWAL_REQUIRED","PORTAL_RELEASE_UNAVAILABLE"])("aligns rollup, workspace and recovery with %s",async gate=>{
    const id="TESTNET-CONTROLLED-RECOVERY",authorized=proxyPrepared(sealedDetail(id));
    authorized.execution_packet={packet_sha256:"c".repeat(64),packet:{obligation_id:id}};authorized.sealed_pae_instruction_hash="d".repeat(64);authorized.execution_gate=gate;
    fetchMock.mockImplementation(input=>Promise.resolve(response(String(input)==="/api/obligations"?{obligations:[obligation(id,true)]}:authorized)));
    renderWithExplicitFirstSelection();await screen.findByRole("region",{name:"Genuine obligation workspace"});openStageNavigator();
    const copy=gate==="PORTAL_RELEASE_RENEWAL_REQUIRED"?/Release consent is no longer current/:/Payment release is unavailable/;
    expect(screen.getByRole("list",{name:"Payment lifecycle"}).textContent).toMatch(copy);
    navigateStage("Payment");
    expect(screen.getByRole("region",{name:"Exception recovery"}).textContent).toMatch(copy);
    expect(screen.getByRole("region",{name:"Payment status"}).textContent).toMatch(copy);
    expect(screen.getByRole("region",{name:"Current payable action"}).textContent).toContain(`${id} · Supplier not recorded · 125.00 USD`);
    expect(screen.queryByRole("button",{name:"Pay testnet USDC"})).toBeNull();
    expect(screen.queryByRole("button",{name:"Approve payment release"})).toBeNull();
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
  });

  it.each(["PORTAL_RELEASE_RENEWAL_REQUIRED","PORTAL_RELEASE_UNAVAILABLE"])("shows blocked release guidance at production AUTHORIZED N+1 Assurance: %s",async gate=>{
    const id="TESTNET-CONTROLLED-NPLUS1-RELEASE",authorized=approvedNPlusOneDetail(id,true);
    authorized.execution_packet={packet_sha256:"c".repeat(64),packet:{obligation_id:id}};authorized.sealed_pae_instruction_hash="d".repeat(64);authorized.execution_gate=gate;
    fetchMock.mockImplementation(input=>Promise.resolve(response(String(input)==="/api/obligations"?{obligations:[obligation(id,false)]}:authorized)));
    renderWithExplicitFirstSelection();await screen.findByRole("region",{name:"Genuine obligation workspace"});openStageNavigator();
    const copy=gate==="PORTAL_RELEASE_RENEWAL_REQUIRED"?/Release consent is no longer current/:/Payment release is unavailable/;
    const lifecycle=screen.getByRole("list",{name:"Payment lifecycle"});
    expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain("Assurance");
    expect(lifecycle.textContent).toMatch(copy);
    navigateStage("Assurance");
    expect(screen.getByRole("region",{name:"Exception recovery"}).textContent).toMatch(copy);
    expect(screen.getByRole("region",{name:"Current payable action"}).textContent).toContain(`${id} · Supplier not recorded · 125.00 USD`);
    expect(screen.queryByRole("button",{name:"Pay testnet USDC"})).toBeNull();expect(screen.queryByRole("button",{name:"Approve payment release"})).toBeNull();
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
  });

  it.each([
    ["kill", /payment stop is active/i], ["expired", /Payment authority is expired/i],
    ["UNKNOWN", /Outcome unknown/i], ["SUBMITTING", /Submission is in progress/i],
    ["BLOCKED", /Execution is blocked/i], ["FAILED", /settlement attempt failed/i],
    ["SETTLED", /Simulated record/],
  ] as const)("keeps %s ahead of renewal and unavailable guidance",async(state,copy)=>{
    for(const gate of ["PORTAL_RELEASE_RENEWAL_REQUIRED","PORTAL_RELEASE_UNAVAILABLE"]){
      const id="TESTNET-CONTROLLED-PRIORITY",authorized=proxyPrepared(sealedDetail(id));
      authorized.execution_packet={packet_sha256:"c".repeat(64),packet:{obligation_id:id}};authorized.sealed_pae_instruction_hash="d".repeat(64);authorized.execution_gate=gate;
      if(state==="kill")authorized.execution_kill_switched=true;
      else if(state==="expired"){authorized.truth.tameion_control_truth.pae_state="EXPIRED";authorized.truth.tameion_control_truth.execution_release_authority="EXPIRED";}
      else {authorized.execution={obligation_id:id,status:state,provider_ref:null};authorized.aggregate.execution_state=state;authorized.truth.tameion_control_truth.execution_state=state;}
      fetchMock.mockImplementation(input=>Promise.resolve(response(String(input)==="/api/obligations"?{obligations:[obligation(id,true)]}:authorized)));
      renderWithExplicitFirstSelection();await screen.findByRole("region",{name:"Genuine obligation workspace"});navigateStage("Payment");
      const card=screen.getByRole("region",{name:"Payment status"});expect(within(card).getByRole("heading",{name:copy})).toBeTruthy();
      expect(screen.queryByRole("button",{name:"Pay testnet USDC"})).toBeNull();expect(screen.queryByRole("button",{name:"Approve payment release"})).toBeNull();
      expect(screen.getByRole("region",{name:"Current payable action"}).textContent).not.toMatch(/Release consent is no longer current|Payment release is unavailable/);
      cleanup();fetchMock.mockReset();
    }
  });

  it("supersedes lost release readback on a later explicit matching refresh",async()=>{
    const id="TESTNET-CONTROLLED-REFRESH-RECEIPT",authorized=proxyPrepared(sealedDetail(id));
    Object.assign(authorized.aggregate,{destination_verification_status:"VERIFIED",destination_operational_status:"ACTIVE",source_wallet_status:"ACTIVE",product_trust_provenance:"CURRENT_PRODUCT_EVIDENCE"});
    authorized.execution_packet={packet_sha256:"c".repeat(64),packet:{obligation_id:id}};authorized.sealed_pae_instruction_hash="d".repeat(64);authorized.execution_gate="PORTAL_RELEASE_APPROVAL_REQUIRED";
    let posted=false,available=false;
    fetchMock.mockImplementation((input,init)=>{
      if(init?.method==="POST"){posted=true;return Promise.resolve(response({code:"OUTCOME_UNVERIFIED",release_gate:"READ_ONLY_CONFIRMATION_REQUIRED",error:"Release approval may have been recorded.",retry_submission:false},503));}
      if(String(input)==="/api/obligations")return Promise.resolve(response({obligations:[obligation(id,true)]}));
      if(posted&&!available)return Promise.resolve(response({},503));
      const read=structuredClone(authorized);
      if(posted){read.payment_release_current=true;read.execution_gate="PORTAL_APPROVED_EXACT_PACKET";read.payment_release_approval={actor_id:"SYNTHETIC",approved_at:new Date().toISOString(),expires_at:new Date(Date.now()+10000).toISOString()};}
      return Promise.resolve(response(read));
    });
    renderWithExplicitFirstSelection();await screen.findByRole("region",{name:"Genuine obligation workspace"});navigateStage("Payment");
    fireEvent.click(screen.getByRole("checkbox",{name:/I have reviewed the exact testnet/}));fireEvent.click(screen.getByRole("button",{name:"Approve payment release"}));
    expect(await screen.findByText(/Release approval may have been recorded/)).toBeTruthy();
    await screen.findByRole("button",{name:"Refresh current status"});available=true;fireEvent.click(screen.getByRole("button",{name:"Refresh current status"}));
    expect(await screen.findByText(/Refreshed status confirms release approval for this same instruction/)).toBeTruthy();expect(screen.queryByText(/Release approval may have been recorded/)).toBeNull();
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });

  it("labels a sealed authorization as an Arc Testnet proxy subject to exact-packet and pre-send gates", async () => {
    const authorized = proxyPrepared(sealedDetail("OBL-SEALED-PROXY"));
    authorized.aggregate.destination_verification_status = "VERIFIED";
    authorized.aggregate.destination_operational_status = "ACTIVE";
    authorized.aggregate.source_wallet_status = "ACTIVE";
    authorized.aggregate.product_trust_provenance = "CURRENT_PRODUCT_EVIDENCE";
    authorized.execution_packet = { packet_sha256: "c".repeat(64), packet: { obligation_id: "OBL-SEALED-PROXY" } };
    authorized.sealed_pae_instruction_hash = "d".repeat(64);
    authorized.execution_gate = "PORTAL_RELEASE_APPROVAL_REQUIRED";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-SEALED-PROXY", true)] }))
      : Promise.resolve(response(authorized)));

    renderWithExplicitFirstSelection();
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(screen.queryByText(/Approved instruction is sealed for the Arc Testnet settlement proxy/)).toBeNull();
    navigateStage("Authorization");
    const packet = screen.getByRole("region", { name: "Payment approval decision" });
    expect(within(packet).getByText(/Arc Testnet payment instruction is approved.*Final payment authorization and pre-release checks still apply/)).toBeTruthy();
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
      expected: /Settlement attempt failed/i,
    },
    {
      name: "execution BLOCKED",
      executionStatus: "BLOCKED",
      releaseAuthority: "BLOCKED",
      paeState: "REVOKED",
      currentStage: "Reconciliation",
      expected: /Payment release is blocked.*external settlement outcome is not confirmed/i,
    },
    {
      name: "PAE-011/REVOKED without an execution record",
      executionStatus: null,
      aggregateExecutionState: "BLOCKED",
      releaseAuthority: "BLOCKED",
      paeState: "REVOKED",
      currentStage: "Payment",
      expected: /Payment authority is revoked.*instruction cannot be submitted/i,
    },
    {
      name: "PAE EXPIRED without an execution record",
      executionStatus: null,
      releaseAuthority: "EXPIRED",
      paeState: "EXPIRED",
      currentStage: "Payment",
      expected: /Payment authority is expired.*instruction cannot be submitted/i,
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
    expect(currentStageCard.textContent).not.toContain("Final payment authorization");
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
    expect(assurance.textContent).toContain("Approval recorded · payment controls incomplete");
    expect(assurance.textContent).toMatch(/no payment can be released/i);
    const lifecycle = openStageNavigator().querySelector<HTMLOListElement>('ol[aria-label="Payment lifecycle"]')!;
    expect(lifecycle.textContent).toContain("AssuranceBlockedApproval recorded · payment controls incomplete; no payment can be released.");
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
    await waitFor(() => expect(assurance.textContent).toContain("Approval recorded · payment controls incomplete"));
    const lifecycle = openStageNavigator().querySelector<HTMLOListElement>('ol[aria-label="Payment lifecycle"]')!;
    await waitFor(() => expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain("Assurance"));
    expect(lifecycle.textContent).toContain("AssuranceBlockedApproval recorded · payment controls incomplete; no payment can be released.");
    expect((screen.getByRole("button", { name: "Assessment" }) as HTMLButtonElement).getAttribute("data-stage-state")).toBe("COMPLETED");
    expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).getAttribute("data-stage-state")).toBe("COMPLETED");
    expect(assurance.textContent).toContain("Approval recorded · payment controls incomplete");
    expect(assurance.textContent).toMatch(/no payment can be released/i);
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]')).toHaveLength(0);

    navigateStage("Assessment");
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getAllByText(/Approval is recorded, but required payment controls did not complete/).length).toBeGreaterThan(0);
    navigateStage("Authorization");
    expect(screen.getAllByText(/Approval is recorded, but required payment controls did not complete/).length).toBeGreaterThan(0);
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
    expect(workspace.textContent).not.toContain("Assessment result — HOLD");
    navigateStage("Assessment");
    const assessmentStage = await screen.findByRole("region", { name: "Assessment result" });

    expect(assessmentStage.textContent).toContain("Current Arc product destination or source-wallet readiness is not verified and active.");
    expect(assessmentStage.textContent).not.toContain("DESTINATION_NOT_READY");
    expect(assessmentStage.textContent).toContain("Resolve the current destination or source-wallet readiness blocker.");
    expect(assessmentStage.textContent).toContain("Treasury Operations");
    expect(assessmentStage.textContent).toContain("What this means");
    expect(assessmentStage.textContent).toContain("Returned findings");
    expect(assessmentStage.textContent).toContain("Verified destination readiness and source-wallet trust-seed record");
    expect(within(assessmentStage).queryByRole("button", { name: /resolve/i })).toBeNull();

    const lifecycle = screen.getByRole("list", { name: "Payment lifecycle" });
    expect(lifecycle.textContent).toContain("AssessmentCurrent");
    expect(lifecycle.textContent).not.toContain("AssessmentBlocked");
    expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Assurance" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Payment" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reconciliation" }) as HTMLButtonElement).disabled).toBe(true);
    expect(lifecycle.textContent).not.toMatch(/transaction (failed|pending)/i);
    const developer = screen.getByText("Control and audit records");
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
    fireEvent.click(screen.getByText("Control and audit records"));
    const traceSummary = await screen.findByText("Assessment trace — evidence, facts, model proposal, validated findings, remediation");
    fireEvent.click(traceSummary);
    const trace = screen.getByTestId("assessment-trace");
    expect(trace.textContent).toContain("Raw due date: Not captured on source");
    expect(trace.textContent).toContain("Effective due date: 2026-09-01");
    expect(trace.textContent).toContain("INVOICE_DATE_CASH_TERM");
    expect(trace.textContent).toContain("authorized user attestation (UAT-AUTH-REF-1)");
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
    expect(await screen.findByText("Assessment result — PAY")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Assessment result" }).textContent).toContain("PAY");

    expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("payment-eligibility").textContent).toMatch(/route checks pending/i);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/approve"))).toBe(false);
  });

  it.each([true, undefined])("keeps approval unavailable when a payment stop is active or unknown after PAY review (%s)", async (killSwitch) => {
    const pay = proxyPrepared(assessedDetail("OBL-STOPPED", "PAY"));
    Object.assign(pay.aggregate,{destination_verification_status:"VERIFIED",destination_operational_status:"ACTIVE",source_wallet_status:"ACTIVE",product_trust_provenance:"CURRENT_PRODUCT_EVIDENCE"});
    pay.execution_kill_switched = killSwitch;
    fetchMock.mockImplementation(input=>String(input)==="/api/obligations"
      ? Promise.resolve(response({obligations:[{...obligation("OBL-STOPPED",true),decision:"PAY"}]}))
      : Promise.resolve(response(pay)));
    renderWithExplicitFirstSelection();
    await screen.findByRole("region",{name:"Genuine obligation workspace"});
    fireEvent.click(screen.getByRole("button",{name:"View Assessment"}));
    fireEvent.click(screen.getByRole("button",{name:"Review current PAY assessment"}));
    fireEvent.click(screen.getByRole("button",{name:"Continue to Authorization"}));
    const strip=screen.getByRole("region",{name:"Current payable action"});
    expect(within(strip).queryByRole("button",{name:"Authorize payment"})).toBeNull();
    expect(strip.textContent).toMatch(/stop|kill switch/i);
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
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
    const sourceSummary = await screen.findByRole("region", { name: "Selected source payable" });
    await waitFor(() => expect(sourceSummary.textContent).not.toContain("Source and control details are loading"));
    expect(sourceSummary.textContent).toContain("125.00 USD");
    expect(sourceSummary.textContent).not.toContain("125.000000 USDC");
    expect(sourceSummary.textContent).not.toContain("ARC_TESTNET");
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    fireEvent.click(screen.getByRole("button", { name: "Review current PAY assessment" }));
    fireEvent.click(screen.getByRole("button", { name: "Continue to Authorization" }));
    navigateStage("Authorization");
    const packet = screen.getByText("Payment approval decision").closest("section");
    expect(packet?.textContent).toContain("125.00 USD");
    expect(packet?.textContent).toContain("125.000000 USDC");
    expect(packet?.textContent).toContain("ARC_TESTNET");
    const developer = screen.getByText("Control and audit records");
    fireEvent.click(developer);
    const sourceDetails = screen.getByText("Source and current payment records").closest("details") as HTMLDetailsElement;
    expect(sourceDetails.open).toBe(false);
    fireEvent.click(screen.getByText("Source and current payment records"));
    const intentDetails = await screen.findByRole("region", { name: "Exact payment intent summary" });
    expect(intentDetails.textContent).toContain("No FX rate recorded");
    expect(intentDetails.textContent).toContain("Pending payment-control review and human approval");
    expect((screen.getByRole("button", { name: "Authorize payment" }) as HTMLButtonElement).disabled).toBe(false);
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/approve"))).toBe(false);
    fireEvent.click(screen.getByText("Payment processing"));
    const executionEvidence = screen.getByText("Payment processing").closest("details");
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
    expect(obligationRow(winner.obligation_id).textContent).toContain("Assessment result · PAY");
    expect(obligationRow(winner.obligation_id).textContent).not.toMatch(/Sole PAY candidate|route assurance|PAE|execution/i);
    expect(obligationRow(explicitlySelected.obligation_id).getAttribute("aria-current")).toBe("true");
    navigateStage("Assessment");
    expect(screen.getByRole("main").textContent).toContain(explicitlySelected.obligation_id);
    expect(screen.getByRole("main").textContent).not.toContain("View selected payment candidate");
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]')).toHaveLength(1);
    await waitFor(() => expect((screen.getByRole("button", { name: "Authorization" }) as HTMLButtonElement).disabled).toBe(true));
    expect(screen.getByRole("button", { name: "Prepare testnet payment details" })).toBeTruthy();
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
    expect(workspace.textContent).not.toContain(`Assessment result — ${decision}`);
    navigateStage("Assessment");
    expect(await screen.findByText(`Assessment result — ${decision}`)).toBeTruthy();
    const decisionHeading = screen.getByText(`Assessment result — ${decision}`);
    expect(decisionHeading.className).toContain("text-[var(--status-hold-text)]");
    expect(obligationRow("OBL-A").querySelector("span.col-span-2[style]")?.getAttribute("style"))
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

  it("keeps provider validation HOLD on evidence review without explicit reassessment eligibility", async () => {
    const held = assessedDetail("OBL-A", "HOLD");
    held.current_assessment.provider_used = "NVIDIA Build";
    held.current_assessment.provider_mode = "LIVE_AI";
    held.current_assessment.race.result.validated_findings = [{
      code: "MODEL_OUTPUT_INVALID",
      severity: "HOLD",
      reason: "The advisory assessment output failed application validation.",
    }];
    held.current_assessment.race.result.decision_summary = "The advisory assessment output failed application validation.";
    held.current_assessment.race.remediation = [{
      finding_code: "MODEL_OUTPUT_INVALID",
      reason: "The advisory assessment output failed application validation.",
      required_action: "Resolve the advisory output validation failure before requesting a new assessment.",
      required_evidence: ["A valid schema-conforming advisory assessment"],
      owner_role: "AI Operations",
      reassess_after_resolution: true,
    }];
    const heldSnapshot = assessmentReviewSnapshot(held.current_assessment);
    expect(heldSnapshot).not.toBeNull();
    expect(isRetryableProviderValidationFailure(heldSnapshot)).toBe(true);
    localStorage.removeItem("tameion.assessment-request.OBL-A");
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [{ ...obligation("OBL-A", true), decision: "HOLD" }] }));
      if (url === "/api/obligations/OBL-A/assess" && init?.method === "POST") {
        return Promise.resolve(response({ error: "Assessment service unavailable." }, 503));
      }
      if (url === "/api/obligations/OBL-A") return Promise.resolve(response(structuredClone(held)));
      throw new Error(`Unexpected request: ${url}`);
    });

    renderWithExplicitFirstSelection("verified-session-csrf");
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    navigateStage("Assessment");
    const action = await screen.findByRole("button", {name:"View HOLD findings"});
    fireEvent.click(action);
    expect((screen.getByTestId("assessment-supporting-detail") as HTMLDetailsElement).open).toBe(true);
    expect(document.activeElement).toBe(screen.getByTestId("assessment-supporting-detail").querySelector("summary"));
    expect(screen.queryByRole("button",{name:"Run AI Assessment"})).toBeNull();
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
  });

  it("submits a current reviewed PAY authorization with the verified session CSRF token", async () => {
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

    renderWithExplicitFirstSelection("verified-session-csrf");
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    navigateStage("Assessment");
    expect(await screen.findByText("Assessment result — PAY")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review current PAY assessment" }));
    navigateStage("Authorization");

    fireEvent.click(screen.getByRole("button", { name: "Authorize payment" }));
    await waitFor(() => {
      const approval = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/approve") && init?.method === "POST");
      expect(approval?.[1]?.headers).toMatchObject({ "X-Tameion-CSRF": "verified-session-csrf" });
      expect(JSON.parse(String(approval?.[1]?.body))).toMatchObject({
        reason_text: "Authorized after reviewing the current PAY assessment and exact Arc Testnet payment instruction.",
      });
    });
  });

  it("keeps a protected view-only obligation out of financial actions despite historical PAY and preflight state", async () => {
    const obligations = ["OBL-A", "OBL-B", "OBL-C", "OBL-D", "OBL-E"].map((id) => ({
      ...obligation(id, true),
      decision: id === "OBL-A" ? "PAY" : "HOLD",
    }));
    const pay = proxyPrepared(assessedDetail("OBL-A", "PAY"));
    pay.financial_action_eligible = false;
    pay.aggregate.destination_verification_status = "VERIFIED";
    pay.aggregate.destination_operational_status = "ACTIVE";
    pay.aggregate.source_wallet_status = "ACTIVE";
    pay.aggregate.product_trust_provenance = "CURRENT_PRODUCT_EVIDENCE";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations, sole_pay_candidate_id: "OBL-A" }))
      : Promise.resolve(response(pay)));

    renderWithExplicitFirstSelection("verified-session-csrf");
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    fireEvent.click(screen.getByRole("button", { name: "View Assessment" }));
    navigateStage("Assessment");
    fireEvent.click(screen.getByRole("button", { name: "Review current PAY assessment" }));
    navigateStage("Authorization");

    expect(screen.getByRole("status", { name: "Review-only payable" }).textContent).toMatch(/separately approved controlled test obligation/i);
    expect(screen.queryByRole("button", { name: "Authorize payment" })).toBeNull();
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

    expect(await screen.findByText(/Payables are unavailable\. No substitute data has been added/)).toBeTruthy();
    expect(await screen.findByText(/Selected payable status is stale/)).toBeTruthy();
    expect(screen.getAllByText("Last-known state — stale").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Run AI Assessment again" })).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh current status" })).toBeTruthy();
    expect(screen.queryByText("Related payment information")).toBeNull();
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
    expect(obligationRow("OBL-A")).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Payment lifecycle navigation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Authorization" })).toBeNull();
    expect(screen.getByTestId("current-next-step").textContent).toContain("Selected payable status is stale");
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Refresh current status" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assurance" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Submit for execution (simulated)" })).toBeNull();
    expect(screen.getByTestId("current-next-step").textContent).toContain("Selected payable status is stale");
    fireEvent.click(screen.getByRole("button", { name: "Refresh current status" }));
    await waitFor(() => expect(screen.queryByText(/Selected payable status is stale/)).toBeNull());
    expect(screen.queryByText("Related payment information")).toBeNull();
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
    expect((screen.getByRole("button", { name: "Refresh payable list" }) as HTMLButtonElement).disabled).toBe(true);

    actionB.resolve(response({ error: "Assessment unavailable" }, 503));
    await act(async () => { await actionBCompletion; });
    expect(listReads).toBe(2);
    expect((screen.getByRole("button", { name: "Refresh payable list" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByText("Related payment information")).toBeNull();
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
    expect(await screen.findByText(/Payable details are unavailable/)).toBeTruthy();
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
    await waitFor(() => expect(screen.getByTestId("current-next-step").textContent).toContain("Loading current payable status."));
    expect(screen.queryByText("Related payment information")).toBeNull();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/obligations/OBL-A"));
    fireEvent.click(obligationRow("OBL-B"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/obligations/OBL-B"));
    secondDetail.resolve(response(detail("OBL-B")));
    await waitFor(() => expect(obligationRow("OBL-B").getAttribute("aria-current")).toBe("true"));
    firstDetail.resolve(response(detail("OBL-A")));
    await waitFor(() => expect(obligationRow("OBL-B").getAttribute("aria-current")).toBe("true"));
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
    expect(screen.queryByText("Related payment information")).toBeNull();
  });
});

describe("guided lifecycle navigation", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => {
    localStorage.clear();
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

    const stageHeading = screen.getByRole("heading", { name: "Assessment required" });
    expect(document.getElementById(stageHeading.getAttribute("aria-describedby")!)?.textContent).toBe("Workflow now: Obligation. Step 1 of 6.");
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
    const reconciliationHeading = await screen.findByRole("heading", { name: "Reconciliation" });
    expect(document.getElementById(reconciliationHeading.getAttribute("aria-describedby")!)?.textContent).toBe("Workflow now: Reconciliation, Settlement confirmation. Step 6 of 6.");
    const refreshedRail = screen.getByRole("navigation", { name: "Payment lifecycle navigation" });
    fireEvent.click(within(refreshedRail).getByRole("button", { name: "Obligation" }));

    const reviewedHeading = screen.getByRole("heading", { name: "Approved For Payment" });
    expect(document.getElementById(reviewedHeading.getAttribute("aria-describedby")!)?.textContent).toBe("Reviewing: Obligation. Workflow now: Reconciliation, Settlement confirmation. Reviewing step 1 of 6; workflow is at step 6 of 6.");
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
    expect(screen.getByRole("region", {name:"Guided lifecycle"}).textContent).toContain("Workflow now: Assessment");
    expect((within(rail).getByRole("button", { name: "Authorization" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: /^Continue to / })).toBeNull();
    fireEvent.click(within(rail).getByRole("button", { name: "Obligation" }));
    expect(screen.getByRole("region", {name:"Guided lifecycle"}).textContent).toContain("Reviewing: Obligation · Workflow now: Assessment");
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
    expect((await screen.findAllByText(/Reviewing: Authorization · Workflow now:/)).length).toBeGreaterThan(0);
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
    expect(screen.getByRole("heading", { name: "Last-known state — stale" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Payment lifecycle navigation" })).toBeNull();
    await act(async () => { delayedDetail.resolve(response(refreshed)); });
    await waitFor(() => expect(screen.getByRole("region", { name: "Assessment result" })).toBeTruthy());
    const focusedHeading = screen.getByRole("heading", { name: "Assessment result — HOLD" });
    expect(focusedHeading).toBe(document.activeElement);
    expect(document.getElementById(focusedHeading.getAttribute("aria-describedby")!)?.textContent).toBe("Workflow now: Assessment. Step 2 of 6.");
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
    const staleHeading = screen.getByRole("heading", { name: "Last-known state — stale" });
    expect(document.getElementById(staleHeading.getAttribute("aria-describedby")!)?.textContent).toBe("Workflow now: Obligation. Step 1 of 6.");
    expect(screen.queryByRole("navigation", { name: "Payment lifecycle navigation" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back to Assessment" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST").map(([, init]) => init?.method)).toEqual(["POST"]);
  });
});

describe("HOLD reason and lawful resolution", () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => { localStorage.clear(); vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

  it.each(["missing", "wrong identity", "wrong version", "new PAY"])("does not present a queue HOLD as current when selected detail has %s assessment", async variant => {
    const id = "OBL-QUEUE-HOLD-UX";
    const selected = variant === "missing" ? detail(id) : assessedDetail(id, variant === "new PAY" ? "PAY" : "HOLD");
    if (variant === "wrong identity") selected.current_assessment.obligation_id = "OBL-OTHER";
    if (variant === "wrong version") selected.current_assessment.aggregate_version = "99";
    fetchMock.mockImplementation(input => Promise.resolve(response(String(input) === "/api/obligations"
      ? {obligations: [obligation(id, true), obligation("OBL-UNSELECTED-HOLD", true)]} : selected)));
    renderWithExplicitFirstSelection();
    await screen.findByRole("region", {name: "Selected source payable"});
    await waitFor(() => expect(obligationRow(id).textContent).toContain(variant === "new PAY" ? "Assessment result · PAY" : "Assessment required"));
    expect(obligationRow(id).textContent).not.toContain("Assessment result · HOLD");
    expect(obligationRow(id).querySelector('[title="Assessment result: HOLD"]')).toBeNull();
    expect(obligationRow("OBL-UNSELECTED-HOLD").textContent).toContain("Assessment result · HOLD");
    expect(fetchMock.mock.calls.filter(([,init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("explains a confirmed source HOLD beside the payable without claiming correction eligibility", async () => {
    const held = assessedDetail("OBL-HOLD-UX", "HOLD");
    held.advisory_action_eligible = true;
    held.financial_action_eligible = false;
    fetchMock.mockImplementation(input => Promise.resolve(response(String(input) === "/api/obligations"
      ? {obligations: [obligation("OBL-HOLD-UX", true)]} : held)));
    renderWithExplicitFirstSelection();
    const reason = await screen.findByRole("region", {name: "Hold reason and next action"});
    expect(reason.textContent).toContain("Source evidence is incomplete.");
    expect(reason.textContent).toContain("Accounts Payable");
    expect(reason.textContent).toContain("Authorization");
    expect(screen.getByRole("region", {name: "Selected source payable"}).contains(reason)).toBe(true);
    expect(screen.queryByRole("button", {name: "Reassess after correction"})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "View HOLD findings"}));
    expect(fetchMock.mock.calls.filter(([,init]) => init?.method === "POST")).toHaveLength(0);
  });

  it.each(["remount", "reselect"])("retains no-retry for an unresolved request across %s", async mode => {
    const held = assessedDetail("OBL-UNRESOLVED-UX", "HOLD");
    held.advisory_action_eligible = true;
    localStorage.setItem("tameion.assessment-request.OBL-UNRESOLVED-UX", "original-request-identity");
    fetchMock.mockImplementation(input => Promise.resolve(response(String(input) === "/api/obligations"
      ? {obligations: [obligation("OBL-UNRESOLVED-UX", true), obligation("OBL-OTHER-UX")]} : String(input).endsWith("OBL-OTHER-UX") ? detail("OBL-OTHER-UX") : held)));
    const view = renderWithExplicitFirstSelection();
    await screen.findByRole("region", {name: "Selected source payable"});
    if (mode === "remount") { view.unmount(); renderWithExplicitFirstSelection(); }
    else { fireEvent.click(obligationRow("OBL-OTHER-UX")); await screen.findByRole("region", {name: "Selected source payable"}); fireEvent.click(obligationRow("OBL-UNRESOLVED-UX")); }
    const reason = await screen.findByRole("region", {name: "Hold reason and next action"});
    expect(reason.textContent).toContain("Assessment completion not confirmed");
    expect(reason.textContent).toMatch(/do not.*retry/i);
    expect(obligationRow("OBL-UNRESOLVED-UX").textContent).not.toContain("Assessment result · HOLD");
    expect(screen.queryByRole("button", {name: /Reassess after correction|Run AI Assessment/})).toBeNull();
    fireEvent.click(screen.getByRole("button", {name: "Refresh payable list"}));
    expect(localStorage.getItem("tameion.assessment-request.OBL-UNRESOLVED-UX")).toBe("original-request-identity");
    expect(fetchMock.mock.calls.filter(([,init]) => init?.method === "POST")).toHaveLength(0);
  });
});

describe("unresolved assessment callback containment", () => {
  it("does not send an assessment when request identity storage fails", async () => {
    localStorage.clear();
    const fetchMock=vi.fn<typeof fetch>(input=>Promise.resolve(response(String(input)==="/api/obligations"?{obligations:[obligation("OBL-STORAGE-UX")]}:detail("OBL-STORAGE-UX"))));
    vi.stubGlobal("fetch",fetchMock);
    renderWithExplicitFirstSelection();
    const action=await screen.findByRole("button",{name:"Run AI Assessment"});
    const storage=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("Storage denied");});
    try {
      fireEvent.click(action);
      const reason=await screen.findByRole("region",{name:"Hold reason and next action"});
      await waitFor(()=>expect(reason.textContent).toContain("Assessment was not sent"));
      expect(reason.textContent).not.toContain("Existing request identity retained");
      expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
    } finally {storage.mockRestore();}
  });

  it("retains an ASM-001 response because provider work may already have occurred", async () => {
    localStorage.clear();
    const fetchMock=vi.fn<typeof fetch>((input,init)=>Promise.resolve(response(init?.method==="POST"?{code:"ASM-001",error:"Selected version changed."}:String(input)==="/api/obligations"?{obligations:[obligation("OBL-REFUSED-UX")]}:detail("OBL-REFUSED-UX"),init?.method==="POST"?409:200)));
    vi.stubGlobal("fetch",fetchMock);
    renderWithExplicitFirstSelection();
    fireEvent.click(await screen.findByRole("button",{name:"Run AI Assessment"}));
    await waitFor(()=>expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1));
    await waitFor(()=>expect(localStorage.getItem("tameion.assessment-request.OBL-REFUSED-UX")).not.toBeNull());
    await waitFor(()=>expect(screen.getByRole("region",{name:"Hold reason and next action"}).textContent).toContain("Assessment completion not confirmed"));
    expect(screen.queryByRole("button",{name:/Run AI Assessment|Reassess after correction|Authorize payment/})).toBeNull();
  });

  it("does not create an orphan request from an old A callback after A to B to A", async () => {
    localStorage.clear();
    const fetchMock=vi.fn<typeof fetch>((input,init)=>Promise.resolve(response(init?.method==="POST"?{status:"IN_PROGRESS"}:String(input)==="/api/obligations"?{obligations:[obligation("OBL-RACE-A"),obligation("OBL-RACE-B")]}:detail(String(input).split("/").at(-1)!),init?.method==="POST"?202:200)));
    vi.stubGlobal("fetch",fetchMock);
    renderWithExplicitFirstSelection();
    const action=await screen.findByRole("button",{name:"Run AI Assessment"}) as HTMLButtonElement;
    const key=Object.keys(action).find(k=>k.startsWith("__reactProps$"))!;
    const staleCallback=(action as any)[key].onClick;
    fireEvent.click(obligationRow("OBL-RACE-B"));
    await screen.findByRole("button",{name:"Run AI Assessment"});
    act(()=>{staleCallback();});
    expect(localStorage.getItem("tameion.assessment-request.OBL-RACE-A")).toBeNull();
    fireEvent.click(obligationRow("OBL-RACE-A"));
    await screen.findByRole("button",{name:"Run AI Assessment"});
    act(()=>{staleCallback();});
    expect(localStorage.getItem("tameion.assessment-request.OBL-RACE-A")).toBeNull();
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button",{name:"Run AI Assessment"}));
    await screen.findByRole("heading",{name:"Assessment confirmation pending"});
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
  });

  afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
  it.each([
    {status:503,data:{code:"ASM-UNKNOWN"}},
    {status:503,data:{code:"ASM-001",outcome:"UNKNOWN"}},
    {status:409,data:{code:"ASM-001",outcome:"UNKNOWN"}},
    {status:409,data:{code:"ASM-001",status:"IN_PROGRESS"}},
    {status:409,data:{code:"ASM-001",retry_submission:false}},
  ])("keeps contradictory or unknown completion unresolved across old HOLD and captured callback: %j", async reply => {
    localStorage.clear();
    const held=assessedDetail("OBL-UNKNOWN-OLD-HOLD", "HOLD");
    held.current_assessment.race.result.validated_findings[0].code="MODEL_OUTPUT_INVALID";
    held.current_assessment.race.remediation[0].finding_code="MODEL_OUTPUT_INVALID";
    let posted=false;
    const fetchMock=vi.fn<typeof fetch>((input,init)=>{
      if(init?.method==="POST") {posted=true;return Promise.resolve(response(reply.data,reply.status));}
      return Promise.resolve(response(String(input)==="/api/obligations"?{obligations:[obligation("OBL-UNKNOWN-OLD-HOLD",true)]}:posted?held:detail("OBL-UNKNOWN-OLD-HOLD")));
    });
    vi.stubGlobal("fetch",fetchMock);
    renderWithExplicitFirstSelection();
    const action=await screen.findByRole("button",{name:"Run AI Assessment"}) as HTMLButtonElement;
    const propsKey=Object.keys(action).find(k=>k.startsWith("__reactProps$"))!;
    const staleCallback=(action as any)[propsKey].onClick;
    fireEvent.click(action);
    await screen.findByRole("heading",{name:"Assessment completion not confirmed"});
    await waitFor(()=>expect((screen.getByRole("button",{name:"Refresh payable list"}) as HTMLButtonElement).disabled).toBe(false));
    const identity=localStorage.getItem("tameion.assessment-request.OBL-UNKNOWN-OLD-HOLD");
    expect(identity).toBeTruthy();
    expect(screen.queryByRole("heading",{name:"Assessment result — HOLD"})).toBeNull();
    expect(obligationRow("OBL-UNKNOWN-OLD-HOLD").textContent).not.toContain("Assessment result · HOLD");
    act(()=>{staleCallback();});
    fireEvent.click(screen.getByRole("button",{name:"Refresh payable list"}));
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(1);
    expect(localStorage.getItem("tameion.assessment-request.OBL-UNKNOWN-OLD-HOLD")).toBe(identity);
  });
});


describe("payable list checks for retained assessment requests", () => {
  const id = "OBL-LIST-CHECK-A";
  const storageKey = `tameion.assessment-request.${id}`;
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

  function setup(reply: () => Promise<Response>) {
    localStorage.setItem(storageKey, "retained-exact-request");
    let reads = 0;
    const fetchMock = vi.fn<typeof fetch>((input) => {
      if (String(input) === "/api/obligations") {
        reads++;
        return reads === 1 ? Promise.resolve(response({obligations:[obligation(id),obligation("OBL-LIST-CHECK-B")]})) : reply();
      }
      return Promise.resolve(response(assessedDetail(String(input).split("/").at(-1)!, "HOLD")));
    });
    vi.stubGlobal("fetch", fetchMock);
    renderWithExplicitFirstSelection();
    return fetchMock;
  }

  it("shows progress and a list-only result beside the action after reload, without resolving the retained request", async () => {
    const pending = deferred<Response>();
    const fetchMock = setup(() => pending.promise);
    const button = await screen.findByRole("button", {name:"Refresh payable list"});
    const propsKey=Object.keys(button).find(k=>k.startsWith("__reactProps$"))!;
    const callback=(button as any)[propsKey].onClick;
    button.focus(); act(()=>{callback();callback();});
    const status = screen.getByRole("status", {name:"Payable list check"});
    expect(screen.getByRole("region", {name:"Current payable action"}).contains(status)).toBe(true);
    expect(status.textContent).toContain("Checking payable list");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button);
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === "/api/obligations")).toHaveLength(2);
    await act(async () => { pending.resolve(response({obligations:[{...obligation(id,true),decision:"PAY"}]})); });
    expect(status.textContent).toContain("Payable list checked");
    expect(status.textContent).toContain("Assessment outcome remains unverified");
    expect(localStorage.getItem(storageKey)).toBe("retained-exact-request");
    expect(screen.queryByRole("button", {name:/Run AI Assessment|Approve payment/})).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(fetchMock.mock.calls.filter(([,init]) => init?.method === "POST")).toHaveLength(0);
  });

  it.each([401,403,429,503,"malformed","transport"])("shows a failed check for %s while retaining the exact request", async failure => {
    const fetchMock = setup(() => failure === "transport" ? Promise.reject(new Error("offline")) : Promise.resolve(failure === "malformed" ? new Response("not json",{status:200}) : response({code:"UNAVAILABLE"},failure as number)));
    fireEvent.click(await screen.findByRole("button",{name:"Refresh payable list"}));
    const status = await screen.findByRole("status",{name:"Payable list check"});
    await waitFor(() => expect(status.textContent).toContain("Payable list could not be checked"));
    expect(status.textContent).toContain("Assessment outcome remains unverified");
    expect(localStorage.getItem(storageKey)).toBe("retained-exact-request");
    expect(fetchMock.mock.calls.filter(([,init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("ignores a captured old callback and response across A to B to A", async () => {
    const old = deferred<Response>(); const latest = deferred<Response>(); let checks=0;
    const fetchMock=setup(() => ++checks===1 ? old.promise : latest.promise);
    const action=await screen.findByRole("button",{name:"Refresh payable list"}) as HTMLButtonElement;
    const propsKey=Object.keys(action).find(k=>k.startsWith("__reactProps$"))!;
    const staleCallback=(action as any)[propsKey].onClick;
    fireEvent.click(action);
    fireEvent.click(obligationRow("OBL-LIST-CHECK-B"));
    await waitFor(()=>expect(screen.getByLabelText("Current assessment outcome").textContent).toContain("HOLD"));
    fireEvent.click(obligationRow(id));
    const current=await screen.findByRole("button",{name:"Refresh payable list"});
    act(()=>{staleCallback();});
    expect(checks).toBe(1);
    fireEvent.click(current);
    expect(checks).toBe(2);
    await act(async()=>{old.resolve(response({obligations:[obligation(id)]}));});
    expect(screen.getByRole("status",{name:"Payable list check"}).textContent).toContain("Checking payable list");
    await act(async()=>{latest.resolve(response({obligations:[obligation(id)]}));});
    expect(screen.getByRole("status",{name:"Payable list check"}).textContent).toContain("Payable list checked");
    expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
  });

  it("reports storage becoming unavailable between render and click without sending a check or retry",async()=>{
    const fetchMock=setup(()=>Promise.reject(new Error("Unexpected check")));
    const action=await screen.findByRole("button",{name:"Refresh payable list"});
    const readsBefore=fetchMock.mock.calls.length;
    const storage=vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("Storage denied");});
    try {
      fireEvent.click(action);
      const status=screen.getByRole("status",{name:"Payable list check"});
      expect(status.textContent).toContain("Request identity could not be read");
      expect(fetchMock).toHaveBeenCalledTimes(readsBefore);
    } finally {storage.mockRestore();}
    expect(localStorage.getItem(storageKey)).toBe("retained-exact-request");
  });

  it("reports identity storage failure during an in-flight check without losing its completion feedback",async()=>{
    const pending=deferred<Response>(); const fetchMock=setup(()=>pending.promise);
    fireEvent.click(await screen.findByRole("button",{name:"Refresh payable list"}));
    const storage=vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("Storage denied");});
    try {
      await act(async()=>{pending.resolve(response({obligations:[obligation(id)]}));});
      expect(screen.getByRole("status",{name:"Payable list check"}).textContent).toContain("Request identity could not be read");
      expect(fetchMock.mock.calls.filter(([,init])=>init?.method==="POST")).toHaveLength(0);
    } finally {storage.mockRestore();}
    expect(localStorage.getItem(storageKey)).toBe("retained-exact-request");
  });

  it.each(["replaced","removed"])("does not display completion for a %s request identity", async mode => {
    const pending=deferred<Response>(); setup(()=>pending.promise);
    fireEvent.click(await screen.findByRole("button",{name:"Refresh payable list"}));
    if (mode === "replaced") localStorage.setItem(storageKey,"new-exact-request");
    else localStorage.removeItem(storageKey);
    await act(async()=>{pending.resolve(response({obligations:[obligation(id)]}));});
    expect(screen.queryByRole("status",{name:"Payable list check"})).toBeNull();
    expect(localStorage.getItem(storageKey)).toBe(mode === "replaced" ? "new-exact-request" : null);
  });
});


describe("selected payable business facts", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });
  function setup(value: Record<string,any>, row=obligation(value.record.obligation_id)) {
    vi.stubGlobal("fetch",vi.fn<typeof fetch>(input=>Promise.resolve(response(String(input)==="/api/obligations"?{obligations:[row]}:value))));
    renderWithExplicitFirstSelection();
  }
  it("keeps purpose, supplier, immutable reference, exact original amount and genuine source dates together", async()=>{
    const value=detail("OBL-BUSINESS-FACTS");
    Object.assign(value.record,{beneficiary_name:"Example Supplier",service_category:"AI_SOFTWARE_SUBSCRIPTION",amount:"0.000001",currency:"USD",invoice_reference:"EXAMPLE-INVOICE-7",issue_date:"2026-10-01",due_date:"2026-10-20",recurrence:"MONTHLY"});
    setup(value);
    const card=await screen.findByRole("region",{name:"Genuine obligation workspace"});
    expect(within(card).getByRole("heading",{name:"AI software subscription"})).toBeTruthy();
    expect(card.textContent).toContain("Supplier: Example Supplier");
    expect(card.textContent).toContain("OBL-BUSINESS-FACTS");
    expect(card.textContent).toContain("0.000001 USD");
    expect(card.textContent).toContain("EXAMPLE-INVOICE-7");
    expect(card.textContent).toContain("2026-10-01");
    expect(card.textContent).toContain("2026-10-20");
    expect(card.textContent).toContain("Monthly");
    expect(card.textContent).toContain("Assessment not recorded");
  });
  it("does not fabricate supplier or invoice data when private source metadata is absent",async()=>{
    setup(detail("OBL-NO-BUSINESS-METADATA"));
    const card=await screen.findByRole("region",{name:"Genuine obligation workspace"});
    expect(card.textContent).toContain("Supplier not recorded");
    expect(within(card).queryByText(/Invoice:/)).toBeNull();
    expect(within(card).queryByText(/Issued:/)).toBeNull();
    expect(card.textContent).not.toContain("Example Supplier");
  });
  it("labels current advisory results and gives priority to an unresolved latest request",async()=>{
    const value=assessedDetail("OBL-CURRENT-FACTS","HOLD");
    localStorage.setItem("tameion.assessment-request.OBL-CURRENT-FACTS","unresolved-request");
    setup(value,obligation("OBL-CURRENT-FACTS",true));
    const card=await screen.findByRole("region",{name:"Genuine obligation workspace"});
    expect(within(card).getByLabelText("Current assessment outcome").textContent).toBe("Assessment completion not confirmed");
    expect(within(card).getByLabelText("Current assessment outcome").textContent).not.toContain("HOLD");
  });
  it("explains that the assessment action records advice without sending payment",async()=>{
    setup(detail("OBL-ADVISORY-SEND"));
    await screen.findByRole("button",{name:"Run AI Assessment"});
    expect(screen.getByTestId("current-next-step").textContent).toContain("records an advisory PAY, HOLD or ESCALATE result");
    expect(screen.getByTestId("current-next-step").textContent).toContain("does not approve or send payment");
  });
});


describe("compact dashboard and current controls",()=>{
  afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});
  it("shows at most six genuine payables from the existing authenticated queue without extra reads",async()=>{
    const rows=Array.from({length:7},(_,i)=>({...obligation(`OBL-OVERVIEW-${i}`),source_group:"GENUINE_COMPANY",beneficiary_name:i===0?"Example Supplier":null}));
    const fetchMock=vi.fn<typeof fetch>(()=>Promise.resolve(response({obligations:[...rows,{...obligation("OBL-DEMO-OVERVIEW"),source_group:"DEMO_ARC_TESTNET"}]})));
    vi.stubGlobal("fetch",fetchMock);rtlRender(<CommandCenter initialView="dashboard"/>);
    const overview=await screen.findByRole("region",{name:"Payables overview"});
    expect(within(overview).getAllByRole("listitem")).toHaveLength(6);
    expect(overview.textContent).toContain("Example Supplier");
    expect(overview.textContent).toContain("Supplier not recorded");
    expect(overview.textContent).toContain("125.00 USD");
    expect(overview.textContent).toContain("Assessment required");
    expect(overview.textContent).not.toContain("OBL-DEMO-OVERVIEW");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region",{name:"Selected source payable"})).toBeNull();
  });
  it("shows current control facts without presenting an old HOLD as the latest result",async()=>{
    const id="OBL-CONTROL-FACTS";localStorage.setItem(`tameion.assessment-request.${id}`,"exact-request-pending");
    const value=assessedDetail(id,"HOLD");
    vi.stubGlobal("fetch",vi.fn<typeof fetch>(input=>Promise.resolve(response(String(input)==="/api/obligations"?{obligations:[obligation(id,true)]}:value))));
    renderWithExplicitFirstSelection();
    const controls=await screen.findByRole("region",{name:"Current control status"});
    expect(within(controls).getAllByRole("definition")).toHaveLength(4);
    expect(controls.textContent).toContain("Assessment completion not confirmed");
    expect(controls.textContent).toContain("Not recorded");
    expect(controls.textContent).toContain("Not submitted");
    expect(controls.textContent).not.toMatch(/HOLD|PASS|paid|balance verified/i);
  });
});


describe("audit records without empty placeholders",()=>{
  afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});
  it("keeps recorded assessment and source details but omits nonexistent payment artifacts",async()=>{
    const id="OBL-AUDIT-CONDENSED";const value=assessedDetail(id,"HOLD");
    value.assurance_evidence={state:"NOT_CREATED",message:"Not created",control_results:[]};
    vi.stubGlobal("fetch",vi.fn<typeof fetch>(input=>Promise.resolve(response(String(input)==="/api/obligations"?{obligations:[obligation(id,true)]}:value))));
    renderWithExplicitFirstSelection();
    await screen.findByRole("region",{name:"Genuine obligation workspace"});
    expect(screen.getByText("Payment review record",{exact:true})).toBeTruthy();
    expect(screen.getByText("Source and current payment records",{exact:true})).toBeTruthy();
    for(const label of ["Approval record","Payment control record","Authorized payment instruction","Payment processing","Settlement and reconciliation record"])
      expect(screen.queryByText(label,{exact:true})).toBeNull();
    expect(value.current_assessment.assessment_id).toBeTruthy();
  });
});


describe("current controls preserve history and unresolved payment states",()=>{
  afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});
  it("labels historical assurance and unknown execution without implying a settled payment",async()=>{
    const id="OBL-HISTORICAL-CONTROLS";const value=assessedDetail(id,"PAY");
    value.assurance_evidence={state:"AVAILABLE_HISTORICAL",message:"Historical binding",control_results:[],overall:"PASS",assurance_id:"SYNTHETIC-OLD-ASSURANCE",recorded_at:"2026-10-01T00:00:00Z",aggregate_version:"0",policy_version:"TEST"};
    value.execution={status:"UNKNOWN",idempotency_key:"SYNTHETIC-EXISTING-SUBMISSION"};
    vi.stubGlobal("fetch",vi.fn<typeof fetch>(input=>Promise.resolve(response(String(input)==="/api/obligations"?{obligations:[{...obligation(id,true),decision:"PAY"}]}:value))));
    renderWithExplicitFirstSelection();
    const facts=await screen.findByRole("region",{name:"Current control status"});
    expect(facts.textContent).toContain("Historical record");
    expect(facts.textContent).toContain("Unknown");
    expect(facts.textContent).not.toMatch(/settled|paid|Recorded · current binding/);
    expect(screen.getByText("Payment control record",{exact:true})).toBeTruthy();
    expect(screen.getByText("Payment processing",{exact:true})).toBeTruthy();
  });
});


describe('genuine exact assessment status recovery',()=>{
 const id='OBL-EXACT-STATUS-A', key='00000000-0000-4000-8000-000000000091';
 afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});
 it('offers the original request status action after reload without resubmitting assessment',async()=>{
  localStorage.setItem(`tameion.assessment-request.${id}`,key);
  const selected=assessedDetail(id,'HOLD');Object.assign(selected,{source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true});
  const mock=vi.fn<typeof fetch>(input=>Promise.resolve(response(String(input)==='/api/obligations'?{obligations:[{...obligation(id,true),source_group:'GENUINE_COMPANY'}]}:selected)));
  vi.stubGlobal('fetch',mock);renderWithExplicitFirstSelection();
  expect(await screen.findByRole('button',{name:'Check assessment request'})).toBeTruthy();
  expect(mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
  expect(localStorage.getItem(`tameion.assessment-request.${id}`)).toBe(key);
 });
});

describe('exact assessment recovery gates and races',()=>{
 const id='OBL-EXACT-STATUS-A',secondId='OBL-EXACT-STATUS-B',key='00000000-0000-4000-8000-000000000091',nextKey='00000000-0000-4000-8000-000000000092';
 const storageKey=`tameion.assessment-request.${id}`;
 function genuine(selectedId=id,decision:'PAY'|'HOLD'|'ESCALATE'='HOLD'){
  const value=assessedDetail(selectedId,decision);Object.assign(value,{source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true});value.current_assessment.assessment_id=`ASM-${key}`;return value;
 }
 function status(value=genuine(),state='COMPLETED_CURRENT'){
  return {status:state,obligation_id:id,idempotency_key:key,aggregate_version:'1',source_record_sha256:createHash('sha256').update(canonicalize(value.record)).digest('hex'),financial_action_eligible:false,...(state==='COMPLETED_CURRENT'?{receipt:{assessment_id:`ASM-${key}`,assessment_hash:value.current_assessment.assessment_hash,aggregate_version:'1'}}:{})};
 }
 function mount(options:{state?:string;selected?:Record<string,any>;statusResponse?:(n:number)=>Promise<Response>;detailResponse?:(n:number)=>Promise<Response>}={}){
  const value=options.selected??genuine();let statuses=0,details=0;
  localStorage.setItem(storageKey,key);vi.stubGlobal('crypto',webcrypto);
  const mock=vi.fn<typeof fetch>((input,init)=>{
   const url=String(input);
   if(init?.method==='POST'){
    if(url!==`/api/obligations/${id}/advisory/status`)throw new Error('Unexpected mutation '+url);
    return options.statusResponse?.(++statuses)??Promise.resolve(response(status(value,options.state)));
   }
   if(url==='/api/obligations')return Promise.resolve(response({obligations:[{...obligation(id,true),source_group:'GENUINE_COMPANY'},{...obligation(secondId,true),source_group:'GENUINE_COMPANY'}]}));
   if(url===`/api/obligations/${id}`)return options.detailResponse?.(++details)??Promise.resolve(response(value));
   if(url===`/api/obligations/${secondId}`)return Promise.resolve(response(genuine(secondId)));
   throw new Error('Unexpected request '+url);
  });vi.stubGlobal('fetch',mock);return {mock,view:renderWithExplicitFirstSelection('FICTIONAL-CSRF'),value};
 }
 const posts=(mock:ReturnType<typeof vi.fn<typeof fetch>>)=>mock.mock.calls.filter(([,init])=>init?.method==='POST');
 const result=()=>screen.findByRole('status',{name:'Assessment request check'});
 afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
 it.each(['PAY','HOLD','ESCALATE'] as const)('confirms the original %s receipt after independent detail and final status, enabling review only',async decision=>{
  const {mock}=mount({selected:genuine(id,decision)});fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  await screen.findByRole('button',{name:'Review assessment'});expect((await result()).textContent).toContain('Assessment confirmed');expect(localStorage.getItem(storageKey)).toBeNull();
  expect(posts(mock)).toHaveLength(2);for(const [url,init] of posts(mock)){expect(url).toBe(`/api/obligations/${id}/advisory/status`);expect(JSON.parse(init!.body as string)).toEqual({idempotency_key:key});expect(init!.headers).toMatchObject({'X-Tameion-CSRF':'FICTIONAL-CSRF'});}
  expect(mock.mock.calls.filter(([url,init])=>String(url)===`/api/obligations/${id}`&&init?.method!=='POST')).toHaveLength(2);
  expect(screen.queryByRole('button',{name:/Authorize payment|Submit payment|Create linked testnet instruction/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Review assessment'}));expect(posts(mock)).toHaveLength(2);
  if(decision==='PAY')expect(await screen.findByRole('button',{name:'Create linked testnet instruction'})).toBeTruthy();
 });
 it.each(['RESERVED','PROVIDER_RESULT_DURABLE','UNKNOWN','STALE','NOT_FOUND'])('keeps %s unresolved with owner guidance, one status read and original key',async state=>{
  const {mock}=mount({state});fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  await waitFor(()=>expect((screen.getByRole('status',{name:'Assessment request check'})).textContent).toMatch(/workspace owner/i));
  expect(localStorage.getItem(storageKey)).toBe(key);expect(posts(mock)).toHaveLength(1);expect(screen.queryByRole('button',{name:/Review assessment$|Reassess after correction|Run AI Assessment|Create linked/})).toBeNull();
  expect(mock.mock.calls.filter(([url])=>url===`/api/obligations/${id}`)).toHaveLength(1);
 });
 it.each([401,403,409,503])('does not clear or retry after HTTP %s',async code=>{
  const {mock}=mount({statusResponse:async()=>response({code:'UNAVAILABLE'},code)});fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  await waitFor(()=>expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toContain('could not be checked'));expect(posts(mock)).toHaveLength(1);expect(localStorage.getItem(storageKey)).toBe(key);
 });
 it.each(['key','payable','version','hash','source','eligibility'])('refuses mismatched initial %s without detail promotion',async field=>{
  const first=status();if(field==='key')first.idempotency_key=nextKey;if(field==='payable')first.obligation_id=secondId;if(field==='version')first.aggregate_version='2';if(field==='hash')first.receipt!.assessment_hash='bad';if(field==='source')first.source_record_sha256='bad';if(field==='eligibility')(first as any).financial_action_eligible=true;
  const {mock}=mount({statusResponse:async()=>response(first)});fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));await waitFor(()=>expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toContain('could not be checked'));expect(posts(mock)).toHaveLength(1);expect(localStorage.getItem(storageKey)).toBe(key);
 });
 it.each(['receipt','version','source','missing','foreign','error'])('withholds final confirmation when independent detail has %s mismatch',async field=>{
  const value=genuine();const changed=structuredClone(value);if(field==='receipt')changed.current_assessment.assessment_hash='b'.repeat(64);if(field==='version')changed.aggregate.aggregate_version=2;if(field==='source')changed.record.amount='126.00';if(field==='missing')changed.current_assessment=null;if(field==='foreign')changed.record.obligation_id=secondId;
  const {mock}=mount({selected:value,detailResponse:async n=>n===1?response(value):response(changed,field==='error'?503:200)});fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));await waitFor(()=>expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toContain('does not confirm'));expect(posts(mock)).toHaveLength(1);expect(localStorage.getItem(storageKey)).toBe(key);expect(screen.queryByRole('button',{name:'Review assessment'})).toBeNull();
 });
 it.each(['UNKNOWN','STALE','NOT_FOUND','FAILED','changed-source','changed-receipt'])('does not release after %s appears between status and detail confirmation',async field=>{
  const value=genuine();let final=status(value);if(field==='changed-source')final.source_record_sha256='c'.repeat(64);else if(field==='changed-receipt')final.receipt!.assessment_hash='b'.repeat(64);else final=status(value,field);
  const {mock}=mount({statusResponse:async n=>n===1?response(status(value)):response(final,field==='FAILED'?503:200)});fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));await waitFor(()=>expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toMatch(/workspace owner/i));expect(posts(mock)).toHaveLength(2);expect(localStorage.getItem(storageKey)).toBe(key);expect(screen.queryByRole('button',{name:'Review assessment'})).toBeNull();
 });
 it('guards duplicate callbacks synchronously while the original status is pending',async()=>{
  const pending=deferred<Response>(),{mock}=mount({statusResponse:()=>pending.promise});const button=await screen.findByRole('button',{name:'Check assessment request'}) as HTMLButtonElement;
  void invokeClickHandler(button);void invokeClickHandler(button);expect(posts(mock)).toHaveLength(1);expect(screen.getByRole('button',{name:'Check assessment request'}).hasAttribute('disabled')).toBe(true);
  await act(async()=>pending.resolve(response(status(genuine(),'UNKNOWN'))));expect(localStorage.getItem(storageKey)).toBe(key);
 });
 it.each(['A-B-A','unmount','pagehide','BFCache','replaced-key','removed-key','storage-fails'])('ignores a late positive response after %s',async transition=>{
  const pending=deferred<Response>(),{mock,view}=mount({statusResponse:()=>pending.promise});fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  if(transition==='A-B-A'){fireEvent.click(obligationRow(secondId));await waitFor(()=>expect(screen.getAllByText('Source evidence is incomplete.').length).toBeGreaterThan(0));fireEvent.click(obligationRow(id));await screen.findByRole('button',{name:'Check assessment request'});}
  if(transition==='unmount'){view.unmount();renderWithExplicitFirstSelection();await screen.findByRole('button',{name:'Check assessment request'});}
  if(transition==='pagehide')act(()=>window.dispatchEvent(new Event('pagehide')));
  if(transition==='BFCache'){const event=new Event('pageshow');Object.defineProperty(event,'persisted',{value:true});act(()=>window.dispatchEvent(event));}
  if(transition==='replaced-key')localStorage.setItem(storageKey,nextKey);
  if(transition==='removed-key')localStorage.removeItem(storageKey);
  if(transition==='storage-fails')vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('Denied');});
  await act(async()=>pending.resolve(response(status())));expect(posts(mock)).toHaveLength(1);expect(screen.queryByRole('button',{name:'Review assessment'})).toBeNull();vi.restoreAllMocks();expect(localStorage.getItem(storageKey)).toBe(transition==='removed-key'?null:transition==='replaced-key'?nextKey:key);
 });
 it('refuses an old render callback after A-B-A before issuing a status request',async()=>{
  const {mock}=mount(),button=await screen.findByRole('button',{name:'Check assessment request'}) as HTMLButtonElement;
  const propsKey=Object.keys(button).find(k=>k.startsWith('__reactProps$'))!;const oldClick=(button as any)[propsKey].onClick as ()=>void;
  fireEvent.click(obligationRow(secondId));await waitFor(()=>expect(screen.getAllByText('Source evidence is incomplete.').length).toBeGreaterThan(0));fireEvent.click(obligationRow(id));await screen.findByRole('button',{name:'Check assessment request'});act(()=>oldClick());expect(posts(mock)).toHaveLength(0);expect(localStorage.getItem(storageKey)).toBe(key);
 });
 it.each(['detail-await','digest-await','final-await'])('keeps retained identity when selection changes during %s',async phase=>{
  const value=genuine(),pending=deferred<Response>(),digest=deferred<ArrayBuffer>();let digestStarted=false;
  const {mock}=mount({selected:value,detailResponse:async n=>n===2&&phase==='detail-await'?pending.promise:response(value),statusResponse:async n=>n===2&&phase==='final-await'?pending.promise:response(status(value))});
  if(phase==='digest-await')vi.stubGlobal('crypto',{subtle:{digest:()=>{digestStarted=true;return digest.promise;}}});
  fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  await waitFor(()=>{if(phase==='detail-await')expect(mock.mock.calls.filter(([url])=>url===`/api/obligations/${id}`)).toHaveLength(2);if(phase==='digest-await')expect(digestStarted).toBe(true);if(phase==='final-await')expect(posts(mock)).toHaveLength(2);});
  fireEvent.click(obligationRow(secondId));await waitFor(()=>expect(screen.getAllByText('Source evidence is incomplete.').length).toBeGreaterThan(0));fireEvent.click(obligationRow(id));await screen.findByRole('button',{name:'Check assessment request'});
  await act(async()=>{if(phase==='digest-await')digest.resolve(new Uint8Array(Buffer.from(status(value).source_record_sha256,'hex')).buffer);else pending.resolve(response(phase==='detail-await'?value:status(value)));});
  expect(localStorage.getItem(storageKey)).toBe(key);expect(screen.queryByRole('button',{name:'Review assessment'})).toBeNull();expect(posts(mock)).toHaveLength(phase==='final-await'?2:1);
 });
 it.each(['malformed-key','storage-denied'])('shows owner escalation without a request for %s',async variant=>{
  const {mock}=mount();if(variant==='malformed-key')localStorage.setItem(storageKey,'invalid');else vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('Denied');});
  fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));await waitFor(()=>expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toMatch(/workspace owner|Workspace owner/));expect(posts(mock)).toHaveLength(0);
 });
 it('reports storage denial occurring after the actionable render but before its click',async()=>{
  const {mock}=mount();const button=await screen.findByRole('button',{name:'Check assessment request'}) as HTMLButtonElement;
  vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('Denied after render');});
  void invokeClickHandler(button);
  expect((await result()).textContent).toMatch(/original request reference could not be verified/);
  expect(posts(mock)).toHaveLength(0);vi.restoreAllMocks();expect(localStorage.getItem(storageKey)).toBe(key);
 });
 it('holds a matching result when clearing retained storage is denied',async()=>{
  const {mock}=mount();vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw new Error('Denied');});fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));await waitFor(()=>expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toContain('could not be checked'));expect(localStorage.getItem(storageKey)).toBe(key);expect(posts(mock)).toHaveLength(2);expect(screen.queryByRole('button',{name:'Review assessment'})).toBeNull();
 });
});

describe('exact assessment HTTP completion contract',()=>{
 afterEach(()=>{cleanup();vi.unstubAllGlobals();localStorage.clear();});
 it.each([[201,1],[202,1],[201,2],[202,2],[200,1],[200,2]])('does not release a completed-looking HTTP %s (ASM-001 for 200) at observation %s',async(code,phase)=>{
  const id='OBL-EXACT-HTTP',key='00000000-0000-4000-8000-000000000096',storageKey=`tameion.assessment-request.${id}`;
  const value=assessedDetail(id,'PAY');Object.assign(value,{source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true});value.current_assessment.assessment_id=`ASM-${key}`;
  const status={status:'COMPLETED_CURRENT',obligation_id:id,idempotency_key:key,aggregate_version:'1',source_record_sha256:createHash('sha256').update(canonicalize(value.record)).digest('hex'),financial_action_eligible:false,receipt:{assessment_id:`ASM-${key}`,assessment_hash:value.current_assessment.assessment_hash,aggregate_version:'1'}};
  let calls=0;localStorage.setItem(storageKey,key);vi.stubGlobal('crypto',webcrypto);
  const mock=vi.fn<typeof fetch>((url,init)=>Promise.resolve(response(init?.method==='POST'?{...status,...(code===200&&calls+1===phase?{code:'ASM-001'}:{})}:String(url)==='/api/obligations'?{obligations:[obligation(id,true)]}:value,init?.method==='POST'&&++calls===phase?code:200)));
  vi.stubGlobal('fetch',mock);renderWithExplicitFirstSelection();fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  await waitFor(()=>expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toContain('could not be checked'));
  expect(localStorage.getItem(storageKey)).toBe(key);expect(calls).toBe(phase);expect(screen.queryByRole('button',{name:'Review assessment'})).toBeNull();
 });
});

describe('mobile current HOLD findings review',()=>{
 const id='OBL-HOLD-REVIEW-A';
 function held(){
  const value=assessedDetail(id,'HOLD');Object.assign(value,{source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true});
  value.current_assessment.reasons=['A normalized payable field requires source review.'];
  value.current_assessment.race.result={decision:'HOLD',decision_summary:value.current_assessment.reasons[0],validated_findings:[{code:'NORMALIZATION_REVIEW_REQUIRED',severity:'HOLD',reason:value.current_assessment.reasons[0]}]};
  value.current_assessment.race.remediation=[{finding_code:'NORMALIZATION_REVIEW_REQUIRED',reason:value.current_assessment.reasons[0],required_action:'Compare the normalized field with the authoritative source and correct it.',required_evidence:['Source evidence supporting the corrected normalized field'],owner_role:'Finance Operations',reassess_after_resolution:true}];return value;
 }
 function mount(value=held()){
  const mock=vi.fn<typeof fetch>(url=>Promise.resolve(response(String(url)==='/api/obligations'?{obligations:[{...obligation(id,true),source_group:'GENUINE_COMPANY'}]}:value)));vi.stubGlobal('fetch',mock);const view=renderWithExplicitFirstSelection();return {mock,view};
 }
 afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
 it('opens actual HOLD findings in Assessment and focuses business evidence rather than technical IDs',async()=>{
  const {mock}=mount();await screen.findByRole('region',{name:'Genuine obligation workspace'});navigateStage('Assessment');
  fireEvent.click(await screen.findByRole('button',{name:/View HOLD findings|Review assessment evidence/}));
  const findings=screen.getByTestId('assessment-supporting-detail') as HTMLDetailsElement;
  expect(findings.open).toBe(true);expect(document.activeElement).toBe(findings.querySelector('summary'));
  expect(findings.textContent).toContain('Source evidence supporting the corrected normalized field');expect(findings.textContent).toContain('Finance Operations');
  expect((screen.getByRole('status',{name:'HOLD findings review'})).textContent).toContain('HOLD remains');expect(mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
 });
 it('announces unavailable HOLD details when the current business disclosure is missing',async()=>{
  mount();await screen.findByRole('region',{name:'Genuine obligation workspace'});navigateStage('Assessment');
  const target=screen.getByTestId('assessment-supporting-detail'),parent=target.parentElement!;target.remove();
  fireEvent.click(await screen.findByRole('button',{name:/View HOLD findings|Review assessment evidence/}));
  expect((await screen.findByRole('status',{name:'HOLD findings review'})).textContent).toContain('HOLD — details unavailable');parent.appendChild(target);
 });
 it('navigates from Obligation to Assessment in one tap without any network or storage write',async()=>{
  const {mock}=mount();const action=await screen.findByRole('button',{name:'View HOLD findings'}),reads=mock.mock.calls.length;
  const set=vi.spyOn(Storage.prototype,'setItem'),remove=vi.spyOn(Storage.prototype,'removeItem');
  fireEvent.click(action);const findings=screen.getByTestId('assessment-supporting-detail') as HTMLDetailsElement;
  expect(findings.open).toBe(true);expect(screen.getByText('Step 2 of 6 · Assessment')).toBeTruthy();expect(findings.textContent).toContain('outside this screen');
  expect(screen.queryByRole('button',{name:/Authorize payment|Continue to Authorization|Run AI Assessment|Create linked testnet instruction|Pay testnet USDC/})).toBeNull();
  expect(mock.mock.calls).toHaveLength(reads);expect(set).not.toHaveBeenCalled();expect(remove).not.toHaveBeenCalled();
 });
 it('refocuses the business disclosure on repeated taps when it is already open or has been closed',async()=>{
  mount();const action=await screen.findByRole('button',{name:'View HOLD findings'});fireEvent.click(action);
  const target=screen.getByTestId('assessment-supporting-detail') as HTMLDetailsElement,scroll=vi.fn();target.scrollIntoView=scroll;
  for(const open of [true,false]){target.open=open;action.focus();fireEvent.click(action);expect(target.open).toBe(true);expect(document.activeElement).toBe(target.querySelector('summary'));}
  expect(scroll).toHaveBeenCalledTimes(2);expect(screen.getAllByTestId('assessment-supporting-detail')).toHaveLength(1);expect((document.getElementById('hold-technical-details') as HTMLDetailsElement).open).toBe(false);
 });
 it('reports disconnected target without changing HOLD or inventing an unresolved request',async()=>{
  mount();fireEvent.click(await screen.findByRole('button',{name:'View HOLD findings'}));
  const target=screen.getByTestId('assessment-supporting-detail'),parent=target.parentElement!;target.remove();fireEvent.click(screen.getByRole('button',{name:'View HOLD findings'}));
  expect(screen.getByRole('status',{name:'HOLD findings review'}).textContent).toContain('HOLD — details unavailable');expect(screen.getByLabelText('Current assessment outcome').textContent).toContain('HOLD');expect(screen.queryByRole('button',{name:'Check assessment request'})).toBeNull();parent.appendChild(target);
 });
 it('shows recorded source-absent evidence and owner without claiming a normalization defect',async()=>{
  const value=assessedDetail(id,'HOLD');Object.assign(value,{source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true});
  value.current_assessment.race.remediation=[{finding_code:'SOURCE_EVIDENCE_MISSING',reason:'Source evidence is incomplete.',required_action:'Supply the approved source invoice.',required_evidence:['Approved source invoice'],owner_role:'Accounts Payable',reassess_after_resolution:true}];
  mount(value);fireEvent.click(await screen.findByRole('button',{name:'View HOLD findings'}));const target=screen.getByTestId('assessment-supporting-detail');expect(target.textContent).toContain('Approved source invoice');expect(target.textContent).toContain('Accounts Payable');expect(target.textContent).toContain('outside this screen');expect(target.textContent).not.toContain('Source correction required.');
 });
 it('keeps legacy HOLD reasons visible and missing remediation truthful',async()=>{
  const value=held();delete value.current_assessment.race;mount(value);fireEvent.click(await screen.findByRole('button',{name:'View HOLD findings'}));
  const target=screen.getByTestId('assessment-supporting-detail');expect(target.textContent).toContain(value.current_assessment.reasons[0]);expect(target.textContent).toContain('Required evidence and correction owner are not recorded');expect(target.textContent).not.toContain('Source correction required.');
 });
 it('keeps an unresolved original request dominant over an older HOLD',async()=>{
  const key='00000000-0000-4000-8000-000000000098';localStorage.setItem(`tameion.assessment-request.${id}`,key);const {mock}=mount();
  expect(await screen.findByRole('button',{name:'Check assessment request'})).toBeTruthy();expect(screen.queryByRole('button',{name:'View HOLD findings'})).toBeNull();expect(localStorage.getItem(`tameion.assessment-request.${id}`)).toBe(key);expect(mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
 });
 it.each(['pagehide','BFCache','unmount','new-request'])('rejects a captured HOLD action after %s',async transition=>{
  const {mock,view}=mount(),button=await screen.findByRole('button',{name:'View HOLD findings'}) as HTMLButtonElement;
  const prop=Object.keys(button).find(k=>k.startsWith('__reactProps$'))!,click=(button as any)[prop].onClick as ()=>void;
  if(transition==='pagehide')act(()=>window.dispatchEvent(new Event('pagehide')));
  if(transition==='BFCache'){const event=new Event('pageshow');Object.defineProperty(event,'persisted',{value:true});act(()=>window.dispatchEvent(event));}
  if(transition==='unmount')view.unmount();if(transition==='new-request')localStorage.setItem(`tameion.assessment-request.${id}`,'00000000-0000-4000-8000-000000000098');
  const before=mock.mock.calls.length;act(()=>click());expect(screen.queryByRole('status',{name:'HOLD findings review'})).toBeNull();expect(mock.mock.calls).toHaveLength(before);
 });
 it.each(['same-proof','changed-version','changed-source'])('rejects an old A-B-A callback with %s',async change=>{
  let aReads=0;const value=held(),newValue=held();if(change==='changed-version'){newValue.aggregate.aggregate_version=2;newValue.current_assessment.aggregate_version='2';newValue.current_assessment.race.evidence.authoritative_facts.aggregate_version='2';}if(change==='changed-source')newValue.record.amount='126.00';
  const b=assessedDetail('OBL-HOLD-REVIEW-B','PAY');Object.assign(b,{source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true});
  const mock=vi.fn<typeof fetch>(url=>Promise.resolve(response(String(url)==='/api/obligations'?{obligations:[obligation(id,true),obligation('OBL-HOLD-REVIEW-B',true)]}:String(url).endsWith('/'+id)?++aReads===1?value:newValue:b)));vi.stubGlobal('fetch',mock);renderWithExplicitFirstSelection();
  const action=await screen.findByRole('button',{name:'View HOLD findings'}) as HTMLButtonElement,prop=Object.keys(action).find(k=>k.startsWith('__reactProps$'))!,click=(action as any)[prop].onClick as ()=>void;
  fireEvent.click(obligationRow('OBL-HOLD-REVIEW-B'));await waitFor(()=>expect(screen.getByLabelText('Current assessment outcome').textContent).toContain('PAY'));fireEvent.click(obligationRow(id));await screen.findByRole('button',{name:'View HOLD findings'});const before=mock.mock.calls.length;act(()=>click());expect(screen.queryByRole('status',{name:'HOLD findings review'})).toBeNull();expect(mock.mock.calls).toHaveLength(before);
 });
 it('does not offer HOLD review for a stale assessment version',async()=>{
  const value=held();value.aggregate.aggregate_version=2;mount(value);await screen.findByRole('region',{name:'Genuine obligation workspace'});expect(screen.queryByRole('button',{name:'View HOLD findings'})).toBeNull();
 });
 it.each([401,403])('does not offer review when selected details return HTTP%s',async code=>{
  vi.stubGlobal('fetch',vi.fn<typeof fetch>(url=>Promise.resolve(response(String(url)==='/api/obligations'?{obligations:[obligation(id,true)]}:{code:'SESSION_REQUIRED'},String(url)==='/api/obligations'?200:code))));renderWithExplicitFirstSelection();await screen.findByText('Payable details are unavailable.');expect(screen.queryByRole('button',{name:'View HOLD findings'})).toBeNull();
 });

 it('does not let a captured HOLD review override a newly ambiguous financial response',async()=>{
  const pending=deferred<Response>(),authorized=proxyPrepared(sealedDetail(id));Object.assign(authorized.aggregate,{destination_verification_status:'VERIFIED',destination_operational_status:'ACTIVE',source_wallet_status:'ACTIVE',product_trust_provenance:'CURRENT_PRODUCT_EVIDENCE'});
  authorized.execution_packet={packet_sha256:'c'.repeat(64),packet:{obligation_id:id}};authorized.sealed_pae_instruction_hash='d'.repeat(64);authorized.execution_gate='PORTAL_APPROVED_EXACT_PACKET';let reads=0;
  const mock=vi.fn<typeof fetch>((url,init)=>init?.method==='POST'?pending.promise:Promise.resolve(response(String(url)==='/api/obligations'?{obligations:[obligation(id,true),obligation('OBL-HOLD-REVIEW-B')]}:String(url).endsWith('/'+id)?++reads===1?authorized:held():detail('OBL-HOLD-REVIEW-B'))));vi.stubGlobal('fetch',mock);renderWithExplicitFirstSelection();
  await screen.findByRole('region',{name:'Genuine obligation workspace'});navigateStage('Payment');fireEvent.click(screen.getByRole('checkbox',{name:/I have reviewed the exact testnet/}));fireEvent.click(screen.getByRole('button',{name:'Pay testnet USDC'}));
  fireEvent.click(obligationRow('OBL-HOLD-REVIEW-B'));await screen.findByRole('button',{name:'Run AI Assessment'});fireEvent.click(obligationRow(id));
  const action=await screen.findByRole('button',{name:'View HOLD findings'}) as HTMLButtonElement,prop=Object.keys(action).find(k=>k.startsWith('__reactProps$'))!,click=(action as any)[prop].onClick as ()=>void;
  await act(async()=>pending.resolve(response({code:'OUTCOME_UNVERIFIED'},503)));await screen.findByRole('button',{name:'Refresh current status'});const before=mock.mock.calls.length;
  act(()=>click());expect(screen.queryByRole('status',{name:'HOLD findings review'})).toBeNull();expect(mock.mock.calls).toHaveLength(before);
 });
 it('keeps reconciliation higher priority than an inconsistent old HOLD alongside settled execution',async()=>{
  const value=held();value.execution={status:'SETTLED',idempotency_key:'SYNTHETIC-RECORDED'};mount(value);await screen.findByRole('region',{name:'Genuine obligation workspace'});expect(screen.queryByRole('button',{name:'View HOLD findings'})).toBeNull();
 });

 it('clears an opened review announcement when the page is hidden',async()=>{
  mount();fireEvent.click(await screen.findByRole('button',{name:'View HOLD findings'}));expect(screen.getByRole('status',{name:'HOLD findings review'})).toBeTruthy();
  act(()=>window.dispatchEvent(new Event('pagehide')));expect(screen.queryByRole('status',{name:'HOLD findings review'})).toBeNull();
 });

});


describe('R1 conflict-aware assessment recovery',()=>{
 const id='FICTIONAL-R1-A',otherId='FICTIONAL-R1-B';
 const attempted='00000000-0000-4000-8000-000000000301',earlier='00000000-0000-4000-8000-000000000302';
 const storageKey=`tameion.assessment-request.${id}`;
 const conflict={code:'ASM-OPERATION-UNRESOLVED',error:'Another assessment is unresolved.',idempotency_key:earlier,operation_status:'UNKNOWN'};
 function genuine(selectedId=id):Record<string,any>{return {...detail(selectedId),source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true};}
 function mount(payload:unknown=conflict,options:{status?:number;changed?:'source'|'version';submission?:Promise<Response>;statusResponse?:Promise<Response>}={}){
  localStorage.clear();vi.stubGlobal('crypto',{randomUUID:()=>attempted,subtle:webcrypto.subtle});
  let posted=false;const mock=vi.fn<typeof fetch>((input,init)=>{
   const url=String(input);
   if(url===`/api/obligations/${id}/advisory`&&init?.method==='POST'){posted=true;return options.submission??Promise.resolve(response(payload,options.status??409));}
   if(url===`/api/obligations/${id}/advisory/status`&&init?.method==='POST')return options.statusResponse??Promise.resolve(response({status:'NOT_FOUND',obligation_id:id,idempotency_key:attempted,aggregate_version:'1',source_record_sha256:'a'.repeat(64),financial_action_eligible:false}));
   if(init?.method==='POST')throw new Error('Forbidden extra POST');
   if(url==='/api/obligations')return Promise.resolve(response({obligations:[{...obligation(id),source_group:'GENUINE_COMPANY'},{...obligation(otherId),source_group:'GENUINE_COMPANY'}]}));
   const value=genuine(url.endsWith(otherId)?otherId:id);
   if(posted&&options.changed==='source')value.record.commercial_terms='Changed source';
   if(posted&&options.changed==='version')value.aggregate.aggregate_version=2;
   return Promise.resolve(response(value));
  });vi.stubGlobal('fetch',mock);return {mock,view:renderWithExplicitFirstSelection('FICTIONAL-CSRF')};
 }
 const posts=(mock:ReturnType<typeof vi.fn<typeof fetch>>)=>mock.mock.calls.filter(([,init])=>init?.method==='POST');
 async function submit(){fireEvent.click(await screen.findByRole('button',{name:'Run AI Assessment'}));await screen.findByRole('button',{name:'Check assessment request'});}
 afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
 it.each([conflict,{code:'ASM-UNKNOWN',status:'UNKNOWN',error:'Earlier outcome unknown.',idempotency_key:earlier}])('explains a separate server-reported reference without adopting or checking it: %j',async payload=>{
  const {mock}=mount(payload);await submit();
  await waitFor(()=>expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).toContain('earlier unresolved assessment'));
  const card=screen.getByRole('region',{name:'Hold reason and next action'});expect(card.textContent).not.toContain(attempted);expect(card.textContent).not.toContain(earlier);expect(card.textContent).toContain('source/version unverified');
  expect(localStorage.getItem(storageKey)).toBe(attempted);expect(posts(mock)).toHaveLength(1);
  fireEvent.click(screen.getByRole('button',{name:'Check assessment request'}));
  await waitFor(()=>expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toContain('could not be verified'));
  expect(card.textContent).toContain('earlier unresolved assessment');expect(localStorage.getItem(storageKey)).toBe(attempted);
  expect(posts(mock)).toHaveLength(2);expect(JSON.parse(posts(mock)[1][1]!.body as string)).toEqual({idempotency_key:attempted});
  expect(screen.queryByRole('button',{name:/Run AI Assessment|Reassess after correction|Authorize payment|Create linked/})).toBeNull();
 });
 it.each([
  {...conflict,idempotency_key:attempted}, {...conflict,idempotency_key:'bad'}, {...conflict,obligation_id:otherId},
  {...conflict,idempotency_key:[earlier,attempted]}, {...conflict,operation_status:'COMPLETED'}, {...conflict,outcome:'PAY'}, {...conflict,operation_status:['UNKNOWN']},
  {code:'ASM-UNKNOWN',status:'UNKNOWN',error:'Original outcome unknown.',idempotency_key:attempted},
 ])('keeps malformed, foreign, multiple or same-key responses generic: %j',async payload=>{
  const {mock}=mount(payload);await submit();expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).not.toContain('earlier unresolved assessment');
  expect(localStorage.getItem(storageKey)).toBe(attempted);expect(posts(mock)).toHaveLength(1);
 });
 it.each(['source','version'] as const)('does not retain earlier-reference presentation after %s drift',async changed=>{
  const {mock}=mount(conflict,{changed});await submit();expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).not.toContain('earlier unresolved assessment');expect(localStorage.getItem(storageKey)).toBe(attempted);expect(posts(mock)).toHaveLength(1);
 });
 it('keeps a lost-response key and does not invent an earlier request',async()=>{
  const lost=deferred<Response>();const {mock}=mount(null,{submission:lost.promise});fireEvent.click(await screen.findByRole('button',{name:'Run AI Assessment'}));await act(async()=>lost.reject(new Error('Lost response')));await screen.findByRole('button',{name:'Check assessment request'});expect(localStorage.getItem(storageKey)).toBe(attempted);expect(posts(mock)).toHaveLength(1);expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).not.toContain('earlier unresolved assessment');
 });
 it.each(['pagehide','bfcache'] as const)('does not adopt a deferred earlier reference across %s',async event=>{
  const pending=deferred<Response>(),{mock}=mount(conflict,{submission:pending.promise});
  fireEvent.click(await screen.findByRole('button',{name:'Run AI Assessment'}));await waitFor(()=>expect(posts(mock)).toHaveLength(1));
  act(()=>{if(event==='pagehide')window.dispatchEvent(new Event('pagehide'));else{const e=new Event('pageshow');Object.defineProperty(e,'persisted',{value:true});window.dispatchEvent(e);}});
  await act(async()=>pending.resolve(response(conflict,409)));await screen.findByRole('button',{name:'Check assessment request'});
  expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).not.toContain(earlier);expect(localStorage.getItem(storageKey)).toBe(attempted);expect(posts(mock)).toHaveLength(1);
 });
 it.each([401,403])('withdraws earlier-reference presentation after status HTTP %s without removing identity',async code=>{
  const {mock}=mount(conflict,{statusResponse:Promise.resolve(response({code:'SESSION_REQUIRED'},code))});await submit();
  await waitFor(()=>expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).toContain('Server reported a separate earlier request'));
  expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).not.toContain(attempted);expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).not.toContain(earlier);fireEvent.click(screen.getByRole('button',{name:'Check assessment request'}));
  await waitFor(()=>expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toContain('could not be checked'));
  expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).not.toContain('Server reported a separate earlier request');expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).not.toContain(earlier);expect(localStorage.getItem(storageKey)).toBe(attempted);expect(posts(mock)).toHaveLength(2);
 });
 it('invalidates the ephemeral explanation after A-B-A and reload while preserving attempted storage',async()=>{
  const {mock,view}=mount();await submit();await waitFor(()=>expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).toContain('earlier unresolved assessment'));
  fireEvent.click(obligationRow(otherId));await screen.findByRole('button',{name:'Run AI Assessment'});fireEvent.click(obligationRow(id));await screen.findByRole('button',{name:'Check assessment request'});
  expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).not.toContain(earlier);expect(localStorage.getItem(storageKey)).toBe(attempted);
  view.unmount();rtlRender(<CommandCenter csrfToken='FICTIONAL-CSRF'/>);await waitFor(()=>expect(obligationRow(id)).toBeTruthy());fireEvent.click(obligationRow(id));await screen.findByRole('button',{name:'Check assessment request'});expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).not.toContain(earlier);
  expect(localStorage.getItem(storageKey)).toBe(attempted);expect(posts(mock)).toHaveLength(1);
 });
});


describe('R1 status-only waiting deadline',()=>{
 const id='FICTIONAL-R1-TIMEOUT',key='00000000-0000-4000-8000-000000000401',storageKey=`tameion.assessment-request.${id}`;
 const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
 afterEach(()=>{cleanup();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
 it.each(['replace','remove','unavailable'] as const)('does not attribute a hanging old check timeout after storage %s',async change=>{
  const value=assessedDetail(id,'HOLD');Object.assign(value,{source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true});
  const pending=deferred<Response>();localStorage.setItem(storageKey,key);const replacement='00000000-0000-4000-8000-000000000402';
  const mock=vi.fn<typeof fetch>((input,init)=>init?.method==='POST'?pending.promise:Promise.resolve(response(String(input)==='/api/obligations'?{obligations:[{...obligation(id,true),source_group:'GENUINE_COMPANY'}]}:value)));
  vi.stubGlobal('fetch',mock);renderWithExplicitFirstSelection('FICTIONAL-CSRF');const button=await screen.findByRole('button',{name:'Check assessment request'});
  vi.useFakeTimers();fireEvent.click(button);await act(flush);
  if(change==='replace')localStorage.setItem(storageKey,replacement);else if(change==='remove')localStorage.removeItem(storageKey);else vi.spyOn(Storage.prototype,'getItem').mockImplementation(()=>{throw new Error('Denied');});
  await act(async()=>{await vi.advanceTimersByTimeAsync(15_001);await flush();});
  const text=screen.getByRole('region',{name:'Hold reason and next action'}).textContent;expect(text).not.toContain('timed out');expect(text).toMatch(/reference changed|reference.*unavailable/);
  expect(screen.queryByRole('button',{name:'Review assessment'})).toBeNull();expect(mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  vi.restoreAllMocks();expect(localStorage.getItem(storageKey)).toBe(change==='replace'?replacement:change==='remove'?null:key);
 });
 it('retains the key when observed time expires before the timeout task runs',async()=>{
  const value=assessedDetail(id,'HOLD');Object.assign(value,{source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true});value.current_assessment.assessment_id=`ASM-${key}`;
  const receipt={status:'COMPLETED_CURRENT',obligation_id:id,idempotency_key:key,aggregate_version:'1',source_record_sha256:createHash('sha256').update(canonicalize(value.record)).digest('hex'),financial_action_eligible:false,receipt:{assessment_id:`ASM-${key}`,assessment_hash:value.current_assessment.assessment_hash,aggregate_version:'1'}};
  const final=deferred<Response>();let posts=0;localStorage.setItem(storageKey,key);vi.stubGlobal('crypto',webcrypto);
  const mock=vi.fn<typeof fetch>((input,init)=>init?.method==='POST'?(++posts===2?final.promise:Promise.resolve(response(receipt))):Promise.resolve(response(String(input)==='/api/obligations'?{obligations:[{...obligation(id,true),source_group:'GENUINE_COMPANY'}]}:value)));
  vi.stubGlobal('fetch',mock);renderWithExplicitFirstSelection('FICTIONAL-CSRF');const button=await screen.findByRole('button',{name:'Check assessment request'});
  vi.useFakeTimers();const clock=vi.spyOn(performance,'now').mockReturnValue(100);fireEvent.click(button);await act(flush);expect(posts).toBe(2);
  clock.mockReturnValue(15_101);await act(async()=>{final.resolve(response(receipt));await flush();});
  expect(localStorage.getItem(storageKey)).toBe(key);expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toContain('timed out');expect(screen.queryByRole('button',{name:'Review assessment'})).toBeNull();expect(posts).toBe(2);
 });
 it.each(['fetch','body','detail','digest','final'] as const)('finishes UI waiting during %s and ignores late confirmation without retry',async phase=>{
  const value=assessedDetail(id,'HOLD');Object.assign(value,{source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true});value.current_assessment.assessment_id=`ASM-${key}`;
  const receipt={status:'COMPLETED_CURRENT',obligation_id:id,idempotency_key:key,aggregate_version:'1',source_record_sha256:createHash('sha256').update(canonicalize(value.record)).digest('hex'),financial_action_eligible:false,receipt:{assessment_id:`ASM-${key}`,assessment_hash:value.current_assessment.assessment_hash,aggregate_version:'1'}};
  const pending=deferred<Response>(),text=deferred<string>(),digest=deferred<ArrayBuffer>();let statuses=0,details=0;
  localStorage.setItem(storageKey,key);vi.stubGlobal('crypto',phase==='digest'?{subtle:{digest:()=>digest.promise}}:webcrypto);
  const lateValue=structuredClone(value);lateValue.record.commercial_terms='LATE DETAIL MUST NOT COMMIT';
  const mock=vi.fn<typeof fetch>((input,init)=>{
   const url=String(input);
   if(init?.method==='POST'){
    if(url!==`/api/obligations/${id}/advisory/status`)throw new Error('Forbidden mutation');statuses++;
    if(phase==='fetch'&&statuses===1||phase==='final'&&statuses===2)return pending.promise;
    if(phase==='body'){const r=response(receipt);r.text=()=>text.promise;return Promise.resolve(r);}
    return Promise.resolve(response(receipt));
   }
   if(url==='/api/obligations')return Promise.resolve(response({obligations:[{...obligation(id,true),source_group:'GENUINE_COMPANY'}]}));
   details++;return phase==='detail'&&details===2?pending.promise:Promise.resolve(response(value));
  });vi.stubGlobal('fetch',mock);renderWithExplicitFirstSelection('FICTIONAL-CSRF');const button=await screen.findByRole('button',{name:'Check assessment request'});
  vi.useFakeTimers();fireEvent.click(button);await act(flush);
  expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toMatch(/Checking|Confirming/);
  await act(async()=>{await vi.advanceTimersByTimeAsync(15_001);await flush();});
  expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toContain('timed out');
  expect(localStorage.getItem(storageKey)).toBe(key);const requests=mock.mock.calls.length;
  await act(async()=>{if(phase==='body')text.resolve(JSON.stringify(receipt));else if(phase==='digest')digest.resolve(new Uint8Array(Buffer.from(receipt.source_record_sha256,'hex')).buffer);else pending.resolve(response(phase==='detail'?lateValue:receipt));await flush();});
  expect(localStorage.getItem(storageKey)).toBe(key);expect(mock.mock.calls).toHaveLength(requests);expect(screen.queryByRole('button',{name:'Review assessment'})).toBeNull();expect(screen.queryByText('LATE DETAIL MUST NOT COMMIT')).toBeNull();
  expect(mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(phase==='final'?2:1);
  if(phase==='fetch'){fireEvent.click(screen.getByRole('button',{name:'Check assessment request'}));await act(flush);expect(localStorage.getItem(storageKey)).toBeNull();expect(statuses).toBe(3);expect(screen.getByRole('button',{name:'Review assessment'})).toBeTruthy();}
 });
});


describe('R1 contradictory receipt containment',()=>{
 afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
 it('does not release or display a completed receipt carrying ASM-001 despite matching detail',async()=>{
  const id='FICTIONAL-R1-CONTRADICTORY',held=assessedDetail(id,'HOLD');Object.assign(held,{source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true});
  const record=held.current_assessment;const receipt={code:'ASM-001',assessment_id:record.assessment_id,assessment_hash:record.assessment_hash,aggregate_version:'1',decision:{obligation_id:id,decision:'HOLD',reasons:record.reasons},race:record.race,provider_used:'NVIDIA',provider_mode:'LIVE_AI'};
  let submitted=false;localStorage.clear();vi.stubGlobal('crypto',webcrypto);
  const mock=vi.fn<typeof fetch>((input,init)=>{
   if(init?.method==='POST'){submitted=true;return Promise.resolve(response(receipt));}
   return Promise.resolve(response(String(input)==='/api/obligations'?{obligations:[{...obligation(id),source_group:'GENUINE_COMPANY'}]}:submitted?held:{...detail(id),source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true}));
  });vi.stubGlobal('fetch',mock);renderWithExplicitFirstSelection('FICTIONAL-CSRF');fireEvent.click(await screen.findByRole('button',{name:'Run AI Assessment'}));
  await waitFor(()=>expect(mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1));
  await waitFor(()=>expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).toContain('Assessment completion not confirmed'));
  expect(localStorage.getItem(`tameion.assessment-request.${id}`)).not.toBeNull();expect(screen.queryByRole('button',{name:'View HOLD findings'})).toBeNull();expect(screen.queryByRole('button',{name:'Review assessment'})).toBeNull();
 });
});

describe('Stage 2 server-owned UNKNOWN presentation and deliberate recovery',()=>{
 beforeEach(()=>{localStorage.clear();vi.stubGlobal('crypto',webcrypto);});
 afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
 const id='FICTIONAL-STAGE2';
 function mountStage2(eligible=false){
  const held=assessedDetail(id,'HOLD'),value={...held,record:held.record,source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:false,current_assessment:null,historical_assessment:held.current_assessment,genuine_assessment:{status:'UNKNOWN',recovery_eligible:eligible,recovery_reason:eligible?'ELIGIBLE':'LEGACY_EVIDENCE_MISSING'}};
  const statusMock=vi.fn((init?:RequestInit)=>Promise.resolve(response({status:'UNKNOWN',obligation_id:id,idempotency_key:JSON.parse(String(init?.body)).idempotency_key,aggregate_version:'1',source_record_sha256:createHash('sha256').update(canonicalize(value.record)).digest('hex'),financial_action_eligible:false})));
  const pending=deferred<Response>();const mock=vi.fn<typeof fetch>((input,init)=>init?.method==='POST'?String(input).endsWith('/status')?statusMock(init):pending.promise:Promise.resolve(response(String(input)==='/api/obligations'?{obligations:[{...obligation(id),source_group:'GENUINE_COMPANY'},obligation('FICTIONAL-OTHER')]}:String(input).includes('FICTIONAL-OTHER')?detail('FICTIONAL-OTHER'):value)));
  vi.stubGlobal('fetch',mock);const view=renderWithExplicitFirstSelection('FICTIONAL-CSRF');return {value,mock,pending,statusMock,view};
 }
 it('shows UNKNOWN without browser identity, keeps HOLD historical and denies financial actions',async()=>{
  const h=mountStage2();await screen.findByRole('region',{name:'Hold reason and next action'});await waitFor(()=>expect(screen.getByRole('region',{name:'Hold reason and next action'}).textContent).toContain('Assessment completion not confirmed'));
  expect(screen.queryByRole('button',{name:'Run AI Assessment'})).toBeNull();expect(screen.queryByRole('button',{name:'View HOLD findings'})).toBeNull();expect(screen.queryByRole('button',{name:'Request one new assessment'})).toBeNull();
  navigateStage('Assessment');expect(screen.getByText('Historical assessment · HOLD')).toBeTruthy();expect(screen.queryByRole('button',{name:/Authorize payment|Create linked testnet instruction|Pay testnet USDC/})).toBeNull();
  expect(h.mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);expect(localStorage.length).toBe(0);
 });
 it('offers no third assessment in a fresh browser after the server reports a completed successor',async()=>{
  const value=assessedDetail(id,'PAY');Object.assign(value,{source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:false,genuine_assessment:{status:'COMPLETED',recovery_eligible:false,recovery_reason:'ACTIVE_OR_SUCCESSOR'}});
  const mock=vi.fn<typeof fetch>((input,init)=>{if(init?.method==='POST')throw new Error('Forbidden A3');return Promise.resolve(response(String(input)==='/api/obligations'?{obligations:[{...obligation(id),source_group:'GENUINE_COMPANY'}]}:value));});
  vi.stubGlobal('fetch',mock);renderWithExplicitFirstSelection('FICTIONAL-CSRF');await screen.findByRole('region',{name:'Selected source payable'});
  expect(screen.queryByRole('button',{name:/Run AI Assessment|Request one new assessment|Reassess after correction/})).toBeNull();
  expect(mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);expect(localStorage.length).toBe(0);
 });
 it('one deliberate click creates a fresh identity, never replays retained K2, and duplicate callbacks dispatch once',async()=>{
  const key='11111111-1111-4111-8111-111111111111';localStorage.setItem(`tameion.assessment-request.${id}`,key);
  const h=mountStage2(true),button=await screen.findByRole('button',{name:'Request one new assessment'}),callback=captureClickHandler(button as HTMLButtonElement);
  act(()=>{for(let i=0;i<10;i++)callback();});
  await waitFor(()=>expect(h.mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1));
  const [url,init]=h.mock.mock.calls.find(([,init])=>init?.method==='POST')!;
  expect(String(url)).toBe(`/api/obligations/${id}/advisory`);expect(new Headers(init!.headers).get('Idempotency-Key')).not.toBe(key);
  expect(localStorage.getItem(`tameion.assessment-request.${id}`)).toBe(key);
  expect(localStorage.getItem(`tameion.assessment-successor.${id}`)).toBe(new Headers(init!.headers).get('Idempotency-Key'));
  expect(JSON.parse(String(init!.body))).toEqual({recovery:true,expected_version:1,source_record_sha256:createHash('sha256').update(canonicalize(h.value.record)).digest('hex')});
  h.value.genuine_assessment.recovery_eligible=false;
  await act(async()=>h.pending.resolve(response({code:'ASM-UNKNOWN',status:'UNKNOWN'},409)));
  await waitFor(()=>expect(screen.queryByRole('button',{name:'Request one new assessment'})).toBeNull());
 });
 it('a captured recovery callback cannot write a key or submit after A → B → A selection',async()=>{
  const h=mountStage2(true),button=await screen.findByRole('button',{name:'Request one new assessment'}),callback=captureClickHandler(button as HTMLButtonElement);
  fireEvent.click(obligationRow('FICTIONAL-OTHER'));await waitFor(()=>expect(screen.getByRole('region',{name:'Selected source payable'}).textContent).toContain('FICTIONAL-OTHER'));
  fireEvent.click(obligationRow(id));await screen.findByRole('button',{name:'Request one new assessment'});act(()=>{callback();});
  expect(h.mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);expect(localStorage.length).toBe(0);
 });
 it('suppresses dispatch when selection changes while the source digest is pending',async()=>{
  const digest=deferred<ArrayBuffer>();vi.stubGlobal('crypto',{randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:()=>digest.promise}});
  const h=mountStage2(true);vi.stubGlobal('crypto',{randomUUID:()=>webcrypto.randomUUID(),subtle:{digest:()=>digest.promise}});
  fireEvent.click(await screen.findByRole('button',{name:'Request one new assessment'}));fireEvent.click(obligationRow('FICTIONAL-OTHER'));
  await act(async()=>{digest.resolve(new ArrayBuffer(32));await Promise.resolve();});
  expect(h.mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
 });
 it.each([409,503,'network'] as const)('retains K2 and A2 after %s and reload; exact observation never sends A3',async failure=>{
  const original='11111111-1111-4111-8111-111111111111',originalSlot=`tameion.assessment-request.${id}`,successorSlot=`tameion.assessment-successor.${id}`;
  localStorage.setItem(originalSlot,original);const h=mountStage2(true);
  fireEvent.click(await screen.findByRole('button',{name:'Request one new assessment'}));
  await waitFor(()=>expect(localStorage.getItem(successorSlot)).not.toBeNull());const successor=localStorage.getItem(successorSlot);
  await act(async()=>{if(failure==='network')h.pending.reject(new Error('Synthetic lost response'));else h.pending.resolve(response({code:'ASM-UNKNOWN',status:'UNKNOWN'},failure));});
  await screen.findByRole('button',{name:'Check assessment request'});
  expect(localStorage.getItem(originalSlot)).toBe(original);expect(localStorage.getItem(successorSlot)).toBe(successor);
  h.view.unmount();const reloaded=mountStage2(true);
  expect(await screen.findByRole('button',{name:'Check assessment request'})).toBeTruthy();expect(screen.queryByRole('button',{name:'Request one new assessment'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Check assessment request'}));
  await waitFor(()=>expect(reloaded.statusMock).toHaveBeenCalledTimes(1));
  expect(JSON.parse(String(reloaded.statusMock.mock.calls[0][0]?.body))).toEqual({idempotency_key:successor});
  await waitFor(()=>expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toContain('unknown'));
  expect(reloaded.mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(1);
  expect(localStorage.getItem(originalSlot)).toBe(original);expect(localStorage.getItem(successorSlot)).toBe(successor);
  expect(screen.queryByRole('button',{name:/Authorize payment|Pay testnet USDC|View HOLD findings/})).toBeNull();
 });
 it.each(['throws','silent'] as const)('sends zero assessments when successor storage %s',async mode=>{
  const slot=`tameion.assessment-request.${id}`,original='11111111-1111-4111-8111-111111111111';localStorage.setItem(slot,original);
  const h=mountStage2(true),button=await screen.findByRole('button',{name:'Request one new assessment'});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{if(mode==='throws')throw new Error('Denied');});
  fireEvent.click(button);await waitFor(()=>expect(screen.queryByText('Waiting for a response for the selected obligation. No duplicate request has been sent.')).toBeNull());
  expect(h.mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);expect(localStorage.getItem(slot)).toBe(original);
 });
 it('clears only A2 after two exact status and independent current-detail confirmations',async()=>{
  const original='11111111-1111-4111-8111-111111111111',originalSlot=`tameion.assessment-request.${id}`,successorSlot=`tameion.assessment-successor.${id}`;
  localStorage.setItem(originalSlot,original);const h=mountStage2(true);
  fireEvent.click(await screen.findByRole('button',{name:'Request one new assessment'}));await waitFor(()=>expect(localStorage.getItem(successorSlot)).not.toBeNull());
  const key=localStorage.getItem(successorSlot)!;
  await act(async()=>h.pending.resolve(response({code:'ASM-UNKNOWN'},503)));await screen.findByRole('button',{name:'Check assessment request'});
  const current=assessedDetail(id,'PAY').current_assessment;current.assessment_id=`ASM-${key}`;Object.assign(h.value,{current_assessment:current,genuine_assessment:{status:'COMPLETED_CURRENT',recovery_eligible:false}});
  const status={status:'COMPLETED_CURRENT',obligation_id:id,idempotency_key:key,aggregate_version:'1',source_record_sha256:createHash('sha256').update(canonicalize(h.value.record)).digest('hex'),financial_action_eligible:false,receipt:{assessment_id:`ASM-${key}`,assessment_hash:current.assessment_hash,aggregate_version:'1'}};
  h.statusMock.mockImplementation(()=>Promise.resolve(response(status)));
  const readsBefore=h.mock.mock.calls.filter(([url,init])=>String(url)===`/api/obligations/${id}`&&init?.method!=='POST').length;
  fireEvent.click(screen.getByRole('button',{name:'Check assessment request'}));
  await waitFor(()=>expect(localStorage.getItem(successorSlot)).toBeNull());
  expect(h.statusMock).toHaveBeenCalledTimes(2);expect(localStorage.getItem(originalSlot)).toBe(original);
  expect(localStorage.getItem(`tameion.assessment-successor-ack.${id}`)).toBe(key);
  expect(await screen.findByRole('button',{name:'Review assessment'})).toBeTruthy();
  expect(h.mock.mock.calls.filter(([url,init])=>String(url)===`/api/obligations/${id}`&&init?.method!=='POST').length-readsBefore).toBe(2);
  expect(h.mock.mock.calls.filter(([url,init])=>init?.method==='POST'&&!String(url).endsWith('/status'))).toHaveLength(1);
  h.view.unmount();const reloaded=mountStage2(true);await screen.findByRole('region',{name:'Hold reason and next action'});
  expect(screen.queryByRole('button',{name:'Request one new assessment'})).toBeNull();expect(reloaded.mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);
  expect(localStorage.getItem(originalSlot)).toBe(original);
 });

 it('a successful A2 POST alone cannot clear either key',async()=>{
  const original='11111111-1111-4111-8111-111111111111';localStorage.setItem(`tameion.assessment-request.${id}`,original);
  const h=mountStage2(true);fireEvent.click(await screen.findByRole('button',{name:'Request one new assessment'}));
  await waitFor(()=>expect(localStorage.getItem(`tameion.assessment-successor.${id}`)).not.toBeNull());const key=localStorage.getItem(`tameion.assessment-successor.${id}`)!;
  const current=assessedDetail(id,'PAY').current_assessment;current.assessment_id=`ASM-${key}`;Object.assign(h.value,{current_assessment:current,genuine_assessment:{status:'COMPLETED_CURRENT',recovery_eligible:false}});
  await act(async()=>h.pending.resolve(response(current)));
  await screen.findByRole('button',{name:'Check assessment request'});
  expect(localStorage.getItem(`tameion.assessment-request.${id}`)).toBe(original);expect(localStorage.getItem(`tameion.assessment-successor.${id}`)).toBe(key);
  expect(h.statusMock).not.toHaveBeenCalled();
 });

 it('a newly rendered recovery callback after pagehide cannot use stale session detail',async()=>{
  const h=mountStage2(true);await screen.findByRole('button',{name:'Request one new assessment'});
  act(()=>window.dispatchEvent(new Event('pagehide')));
  const button=screen.getByRole('button',{name:'Request one new assessment'});
  await act(async()=>{captureClickHandler(button as HTMLButtonElement)();await Promise.resolve();});
  expect(h.mock.mock.calls.filter(([,init])=>init?.method==='POST')).toHaveLength(0);expect(localStorage.length).toBe(0);
 });

});

describe('Stage 2 admission browser flow',()=>{
 const idA='FICTIONAL-BS-A',idB='FICTIONAL-BS-B',earlierKey='00000000-0000-4000-8000-000000000401',newKey='00000000-0000-4000-8000-000000000402';
 const requestStorage=`tameion.assessment-request.${idA}`,successorStorage=`tameion.assessment-successor.${idA}`;
 const bootstrapAdmission={can_assess:true,reason:'LEGACY_HISTORY_ONLY',can_bootstrap:true,bootstrap_gate_code:'BOOTSTRAP_AVAILABLE',legacy_history_count:7,counted_history:0,genuine_admissions:0,unclassifiable_history:0};
 const reviewOnly={can_assess:false,reason:'FINANCIAL_HISTORY',can_bootstrap:false,bootstrap_gate_code:'BOOTSTRAP_FINANCIAL_HISTORY',legacy_history_count:20,counted_history:0,genuine_admissions:0,unclassifiable_history:0};
 function genuine(id:string,admission:Record<string,unknown>,cancelled=false):Record<string,any>{
  const value:Record<string,any>={...detail(id),source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:admission.can_assess===true,genuine_assessment:{status:'COMPLETED',recovery_eligible:false,recovery_reason:'NO_UNKNOWN',admission}};
  if(cancelled)value.aggregate={...value.aggregate,state:'CANCELLED'};return value;
 }
 function mount(admissions:Record<string,Record<string,unknown>>,options:{bootstrapReply?:()=>Promise<Response>;afterStatusAdmission?:Record<string,unknown>}={}){
  localStorage.clear();localStorage.setItem(requestStorage,earlierKey);vi.stubGlobal('crypto',{randomUUID:()=>newKey,subtle:webcrypto.subtle});
  let statusObserved=false;
  const mock=vi.fn<typeof fetch>((input,init)=>{
   const url=String(input);
   if(url===`/api/obligations/${idA}/advisory/status`&&init?.method==='POST'){statusObserved=true;return Promise.resolve(response({status:'NOT_FOUND',obligation_id:idA,idempotency_key:JSON.parse(init.body as string).idempotency_key,aggregate_version:'1',source_record_sha256:'a'.repeat(64),financial_action_eligible:false}));}
   if(url===`/api/obligations/${idA}/advisory`&&init?.method==='POST')return options.bootstrapReply?.()??Promise.resolve(response({status:'IN_PROGRESS',idempotency_key:newKey},202));
   if(init?.method==='POST')throw new Error('Forbidden extra POST '+url);
   if(url==='/api/obligations')return Promise.resolve(response({obligations:[{...obligation(idA),source_group:'GENUINE_COMPANY'},{...obligation(idB),source_group:'GENUINE_COMPANY'}]}));
   const id=url.endsWith(idB)?idB:idA;return Promise.resolve(response(genuine(id,statusObserved&&id===idA?options.afterStatusAdmission??admissions[id]??reviewOnly:admissions[id]??reviewOnly,id===idB)));
  });vi.stubGlobal('fetch',mock);return {mock,view:renderWithExplicitFirstSelection('FICTIONAL-CSRF')};
 }
 const posts=(mock:ReturnType<typeof vi.fn<typeof fetch>>)=>mock.mock.calls.filter(([,init])=>init?.method==='POST');
 afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();localStorage.clear();});
 it('offers one explicit current-source assessment only after an exact status read, preserving the earlier reference',async()=>{
  const {mock}=mount({[idA]:bootstrapAdmission});
  expect(screen.queryByRole('button',{name:'Request one assessment for the current source'})).toBeNull();
  fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  const action=await screen.findByRole('button',{name:'Request one assessment for the current source'});
  await waitFor(()=>expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toContain('could not be matched in the current source state'));
  expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).not.toMatch(/never sent|was completed/i);
  expect(posts(mock)).toHaveLength(1);expect(localStorage.getItem(successorStorage)).toBeNull();
  fireEvent.click(action);
  await waitFor(()=>expect(posts(mock)).toHaveLength(2));
  const [url,init]=posts(mock)[1];expect(url).toBe(`/api/obligations/${idA}/advisory`);
  const body=JSON.parse(init!.body as string);expect(body).toMatchObject({bootstrap:true,expected_version:1,unmatched_reference_key:earlierKey});expect(body.source_record_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect((init!.headers as Record<string,string>)['Idempotency-Key']).toBe(newKey);expect(newKey).not.toBe(earlierKey);
  expect(localStorage.getItem(successorStorage)).toBe(newKey);expect(localStorage.getItem(requestStorage)).toBe(earlierKey);
  await screen.findByRole('button',{name:'Check assessment request'});expect(screen.queryByRole('button',{name:'Request one assessment for the current source'})).toBeNull();
  expect(posts(mock)).toHaveLength(2); // no automatic retry, replacement or second submission
 });
 it('confirms only the new request through exact status and independent detail; the earlier reference is kept as history and never completed',async()=>{
  localStorage.clear();localStorage.setItem(requestStorage,earlierKey);vi.stubGlobal('crypto',{randomUUID:()=>newKey,subtle:webcrypto.subtle});
  let done=false;const completed=assessedDetail(idA,'HOLD');Object.assign(completed,{source_group:'GENUINE_COMPANY',financial_action_eligible:false,advisory_action_eligible:true});completed.current_assessment.assessment_id=`ASM-${newKey}`;
  const sourceHash=createHash('sha256').update(canonicalize(completed.record)).digest('hex');
  const mock=vi.fn<typeof fetch>((input,init)=>{
   const url=String(input);
   if(url===`/api/obligations/${idA}/advisory/status`&&init?.method==='POST'){const key=JSON.parse(init.body as string).idempotency_key;
    return Promise.resolve(response(done&&key===newKey?{status:'COMPLETED_CURRENT',obligation_id:idA,idempotency_key:key,aggregate_version:'1',source_record_sha256:sourceHash,financial_action_eligible:false,receipt:{assessment_id:`ASM-${newKey}`,assessment_hash:completed.current_assessment.assessment_hash,aggregate_version:'1'}}:{status:'NOT_FOUND',obligation_id:idA,idempotency_key:key,aggregate_version:'1',source_record_sha256:sourceHash,financial_action_eligible:false}));}
   if(url===`/api/obligations/${idA}/advisory`&&init?.method==='POST'){done=true;return Promise.resolve(response({status:'IN_PROGRESS',idempotency_key:newKey},202));}
   if(init?.method==='POST')throw new Error('Forbidden extra POST '+url);
   if(url==='/api/obligations')return Promise.resolve(response({obligations:[{...obligation(idA,true),source_group:'GENUINE_COMPANY'}]}));
   return Promise.resolve(response(done?completed:{...genuine(idA,bootstrapAdmission),record:completed.record}));
  });vi.stubGlobal('fetch',mock);renderWithExplicitFirstSelection('FICTIONAL-CSRF');
  fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  fireEvent.click(await screen.findByRole('button',{name:'Request one assessment for the current source'}));
  await waitFor(()=>expect(localStorage.getItem(successorStorage)).toBe(newKey));
  fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  await screen.findByRole('button',{name:'Review assessment'});
  expect(localStorage.getItem(successorStorage)).toBeNull();expect(localStorage.getItem(requestStorage)).toBe(earlierKey);expect(localStorage.getItem(`tameion.assessment-bootstrap-ack.${idA}`)).toBe(earlierKey);
  const statusPosts=posts(mock).filter(([url])=>String(url).endsWith('/status'));expect(statusPosts.length).toBeGreaterThanOrEqual(3);
  for(const [,init] of statusPosts.slice(1))expect(JSON.parse(init!.body as string)).toEqual({idempotency_key:newKey});
  expect(posts(mock).filter(([url])=>String(url).endsWith('/advisory'))).toHaveLength(1);
 });
 it('does not offer bootstrap when the server capability is false, and never invents a reassessment',async()=>{
  const {mock}=mount({[idA]:{...bootstrapAdmission,can_assess:false,reason:'HISTORY_LIMIT',can_bootstrap:false}});
  fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  await waitFor(()=>expect(screen.getByRole('status',{name:'Assessment request check'}).textContent).toMatch(/could not be verified/));
  expect(screen.queryByRole('button',{name:/Request one assessment|Run AI Assessment/})).toBeNull();expect(posts(mock)).toHaveLength(1);expect(localStorage.getItem(requestStorage)).toBe(earlierKey);
 });
 it.each([
  ['BOOTSTRAP_PROTECTION_NOT_ATTESTED',/bootstrap protection is not attested/],
  ['BOOTSTRAP_FINANCIAL_HISTORY',/payment-control history blocks another assessment/],
  ['BOOTSTRAP_UNRESOLVED_OPERATION',/another assessment operation is unresolved/],
  ['BOOTSTRAP_HISTORY_LIMIT',/assessment history limit has been reached/],
  ['BOOTSTRAP_HISTORY_NOT_ESTABLISHED',/required bootstrap history is not established/],
 ] as const)('shows the evaluator reason %s only after exact NOT_FOUND and does not resubmit',async(code,copy)=>{
  const {mock}=mount({[idA]:{...bootstrapAdmission,can_bootstrap:false,bootstrap_gate_code:code}});
  fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  const status=await screen.findByRole('status',{name:'Assessment request check'});
  await waitFor(()=>expect(status.textContent).toMatch(copy));
  expect(status.textContent).toMatch(/current source state|current recorded state/);
  expect(status.textContent).toMatch(/earlier outcome remains unverified/);
  expect(status.textContent).toMatch(/workspace owner/i);
  expect(status.textContent).not.toMatch(/never sent|was not sent/i);
  expect(screen.queryByRole('button',{name:/Request one assessment|Run AI Assessment/})).toBeNull();
  expect(posts(mock)).toHaveLength(1);expect(localStorage.getItem(requestStorage)).toBe(earlierKey);
 });
 it('refreshes and rebinds the gate after exact NOT_FOUND before showing its reason',async()=>{
  const stale={...bootstrapAdmission,can_bootstrap:false,bootstrap_gate_code:'BOOTSTRAP_PROTECTION_NOT_ATTESTED'};
  const current={...bootstrapAdmission,can_bootstrap:false,bootstrap_gate_code:'BOOTSTRAP_HISTORY_LIMIT'};
  const {mock}=mount({[idA]:stale},{afterStatusAdmission:current});
  fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  const status=await screen.findByRole('status',{name:'Assessment request check'});
  await waitFor(()=>expect(status.textContent).toMatch(/assessment history limit has been reached/));
  expect(status.textContent).not.toMatch(/bootstrap protection is not attested/);
  const calls=mock.mock.calls.map(([url,init])=>({url:String(url),method:init?.method??'GET'}));
  const statusIndex=calls.findIndex(call=>call.url.endsWith('/advisory/status')&&call.method==='POST');
  expect(calls.slice(statusIndex+1).some(call=>call.url===`/api/obligations/${idA}`&&call.method==='GET')).toBe(true);
  expect(posts(mock)).toHaveLength(1);expect(localStorage.getItem(requestStorage)).toBe(earlierKey);
 });
 it('shows a capability-derived review-only reason, no assessment instruction, and a history navigation action',async()=>{
  const {mock}=mount({});localStorage.clear();
  fireEvent.click(await screen.findByRole('button',{name:new RegExp(idB)}).catch(()=>obligationRow(idB)));
  const panel=await screen.findByRole('status',{name:'Review-only payable'});
  expect(panel.textContent).toContain('not a claim that this payable was paid or cancelled');
  expect(screen.queryByRole('button',{name:/Run AI Assessment|Request one assessment|Request one new assessment|Authorize payment|Pay testnet/})).toBeNull();
  expect(screen.getByRole('main').textContent).not.toMatch(/run a fresh assessment|This obligation was cancelled/i);
  expect(within(panel).getByRole('button',{name:'View assessment status'})).toBeTruthy();expect(posts(mock)).toHaveLength(0);
 });
 it('does not carry a prior payable\'s bootstrap action or request identity across selection',async()=>{
  const {mock}=mount({[idA]:bootstrapAdmission});
  fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));await screen.findByRole('button',{name:'Request one assessment for the current source'});
  fireEvent.click(obligationRow(idB));await screen.findByRole('status',{name:'Review-only payable'});
  expect(screen.queryByRole('button',{name:'Request one assessment for the current source'})).toBeNull();expect(posts(mock)).toHaveLength(1);
  fireEvent.click(obligationRow(idA));await screen.findByRole('button',{name:'Check assessment request'});
  expect(screen.queryByRole('button',{name:'Request one assessment for the current source'})).toBeNull(); // must re-observe; stale NOT_FOUND is not carried
 });
 it('lets a real bootstrap UNKNOWN admit exactly one explicit successor after grace, preserving bootstrap and earlier references',async()=>{
  const third='00000000-0000-4000-8000-000000000403',uuids=[newKey,third,'00000000-0000-4000-8000-000000000404'];
  localStorage.clear();localStorage.setItem(requestStorage,earlierKey);vi.stubGlobal('crypto',{randomUUID:()=>uuids.shift()!,subtle:webcrypto.subtle});
  let visibility:Record<string,unknown>={status:'COMPLETED',recovery_eligible:false,recovery_reason:'NO_UNKNOWN',admission:bootstrapAdmission};
  const mock=vi.fn<typeof fetch>((input,init)=>{
   const url=String(input);
   if(url===`/api/obligations/${idA}/advisory/status`&&init?.method==='POST')return Promise.resolve(response({status:'NOT_FOUND',obligation_id:idA,idempotency_key:JSON.parse(init.body as string).idempotency_key,aggregate_version:'1',source_record_sha256:'a'.repeat(64),financial_action_eligible:false}));
   if(url===`/api/obligations/${idA}/advisory`&&init?.method==='POST')return Promise.resolve(response({status:'IN_PROGRESS'},202));
   if(init?.method==='POST')throw new Error('Forbidden extra POST '+url);
   if(url==='/api/obligations')return Promise.resolve(response({obligations:[{...obligation(idA),source_group:'GENUINE_COMPANY'},{...obligation(idB),source_group:'GENUINE_COMPANY'}]}));
   return Promise.resolve(response(url.endsWith(idB)?genuine(idB,reviewOnly,true):{...genuine(idA,bootstrapAdmission),genuine_assessment:visibility}));
  });vi.stubGlobal('fetch',mock);
  const advisory=()=>posts(mock).filter(([url])=>String(url).endsWith('/advisory'));
  renderWithExplicitFirstSelection('FICTIONAL-CSRF');
  fireEvent.click(await screen.findByRole('button',{name:'Check assessment request'}));
  fireEvent.click(await screen.findByRole('button',{name:'Request one assessment for the current source'}));
  await waitFor(()=>expect(localStorage.getItem(successorStorage)).toBe(newKey));
  // server now records the bootstrap as a real UNKNOWN, still inside grace
  visibility={status:'UNKNOWN',recovery_eligible:false,recovery_reason:'GRACE',admission:{...bootstrapAdmission,can_assess:false,reason:'UNRESOLVED_OPERATION',can_bootstrap:false}};
  cleanup();renderWithExplicitFirstSelection('FICTIONAL-CSRF');
  await screen.findByRole('button',{name:'Check assessment request'});expect(screen.queryByRole('button',{name:'Request one new assessment'})).toBeNull();expect(advisory()).toHaveLength(1);
  // grace elapsed; reload and switch away/back
  visibility={...visibility,recovery_eligible:true,recovery_reason:'ELIGIBLE'};
  cleanup();renderWithExplicitFirstSelection('FICTIONAL-CSRF');
  fireEvent.click(await screen.findByRole('button',{name:'Request one new assessment'}).then(b=>b));
  await waitFor(()=>expect(advisory()).toHaveLength(2));
  const [,init]=advisory()[1];expect(JSON.parse(init!.body as string)).toMatchObject({recovery:true,expected_version:1});expect(JSON.parse(init!.body as string).unmatched_reference_key).toBeUndefined();
  expect((init!.headers as Record<string,string>)['Idempotency-Key']).toBe(third);
  expect(localStorage.getItem(successorStorage)).toBe(third);expect(localStorage.getItem(requestStorage)).toBe(earlierKey);expect(localStorage.getItem(`tameion.assessment-bootstrap-ref.${idA}`)).toBe(`${earlierKey}:${newKey}`);
  // a successor UNKNOWN (even a server wrongly saying eligible) never admits a second one
  cleanup();renderWithExplicitFirstSelection('FICTIONAL-CSRF');
  await screen.findByRole('button',{name:'Check assessment request'});expect(screen.queryByRole('button',{name:'Request one new assessment'})).toBeNull();
  fireEvent.click(obligationRow(idB));await screen.findByRole('status',{name:'Review-only payable'});fireEvent.click(obligationRow(idA));
  await screen.findByRole('button',{name:'Check assessment request'});expect(screen.queryByRole('button',{name:'Request one new assessment'})).toBeNull();expect(advisory()).toHaveLength(2);
 });
 it('labels the review-only navigation truthfully and lands on the promised content',async()=>{
  const {mock}=mount({});localStorage.clear();await waitFor(()=>obligationRow(idB));fireEvent.click(obligationRow(idB));
  const panel=await screen.findByRole('status',{name:'Review-only payable'});
  expect(screen.queryByRole('button',{name:/history/i})).toBeNull();
  fireEvent.click(within(panel).getByRole('button',{name:'View assessment status'}));
  await waitFor(()=>expect(screen.getByRole('region',{name:'Assessment result'}).textContent).toContain('not a claim that this payable was paid or cancelled'));
  expect(screen.queryByRole('button',{name:/Run AI Assessment|Request one|Authorize payment|Pay testnet/})).toBeNull();expect(posts(mock)).toHaveLength(0);
 });
});


describe("S01-F01 exact terminal readback after UNKNOWN", () => {
  const id = "TESTNET-CONTROLLED-S01-RECEIPT";
  const key = "SYNTHETIC-S01-ORIGINAL-KEY";
  const instructionHash = "d".repeat(64), packetHash = "c".repeat(64);
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => { localStorage.clear(); fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); localStorage.clear(); });

  function readback(bindingState: string, status: string) {
    const value = proxyPrepared(sealedDetail(id));
    value.source_group = "DEMO_ARC_TESTNET";
    Object.assign(value.aggregate, { destination_verification_status: "VERIFIED", destination_operational_status: "ACTIVE", source_wallet_status: "ACTIVE", product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE" });
    const packet = {
      organization_id: "ORG-DEMO-001", obligation_id: id, aggregate_version: 1,
      settlement_amount: value.aggregate.amount, asset: "USDC", network: "ARC_TESTNET",
      pae: { instruction_hash: instructionHash, idempotency_key: key },
      provider_token: { decimals: 6 },
      circle_arc_execution_instruction: { amount: value.aggregate.amount, decimals: 6, destination_address: value.settlement_proxy.preflight.destination_wallet.address },
    };
    value.execution_packet = { packet_sha256: packetHash, packet };
    value.sealed_pae_instruction_hash = instructionHash;
    value.execution_gate = status === "NONE" ? "PORTAL_APPROVED_EXACT_PACKET" : "EXECUTION_ALREADY_RECORDED";
    value.truth.settlement_truth.runtime = "LIVE"; // Synthetic transport; exercise the real evidence classifier.
    if (status !== "NONE") {
      value.execution = { obligation_id: id, idempotency_key: key, status, provider_ref: "SYNTHETIC-S01-PROVIDER", provider_evidence: { status: status === "SETTLED" ? "CONFIRMED" : "PENDING", atomic_amount: "125000000", destination_address: value.settlement_proxy.preflight.destination_wallet.address } };
      value.aggregate.state = status === "SETTLED" ? "RECONCILED" : "EXECUTING";
      value.aggregate.execution_state = status;
      value.truth.tameion_control_truth.aggregate_state = value.aggregate.state;
      value.truth.tameion_control_truth.execution_state = status;
      value.settlement_evidence_binding = { state: bindingState, packet: { packet_sha256: packetHash, packet } };
      if (bindingState === "AVAILABLE_HISTORICAL") value.execution_packet = null;
    }
    return value;
  }

  async function journey(bindingState: string, variant = "matching") {
    let phase = "initial";
    const lateRead = deferred<Response>();
    const original = readback(bindingState, "NONE"), pending = readback(bindingState, "UNKNOWN");
    const final = readback(bindingState, variant === "unknown" ? "UNKNOWN" : variant === "submitting" ? "SUBMITTING" : variant === "failed" ? "FAILED" : variant === "blocked" ? "BLOCKED" : "SETTLED");
    if (variant === "wrong-obligation") final.execution.obligation_id = "SYNTHETIC-OTHER";
    if (variant === "wrong-instruction") final.sealed_pae_instruction_hash = "e".repeat(64);
    if (variant === "wrong-packet") final.settlement_evidence_binding.packet.packet_sha256 = "e".repeat(64);
    if (variant === "wrong-key") final.execution.idempotency_key = "SYNTHETIC-OTHER-KEY";
    if (variant === "wrong-packet-key") final.settlement_evidence_binding.packet.packet.pae.idempotency_key = "SYNTHETIC-OTHER-KEY";
    if (variant === "changed-key-in-both") { final.execution.idempotency_key = "SYNTHETIC-OTHER-KEY"; final.settlement_evidence_binding.packet.packet.pae.idempotency_key = "SYNTHETIC-OTHER-KEY"; }
    if (variant === "wrong-version") final.aggregate.aggregate_version++;
    if (variant === "missing-key") delete final.execution.idempotency_key;
    if (variant === "missing-binding") delete final.settlement_evidence_binding;
    if (variant === "invalid-binding") final.settlement_evidence_binding.state = "INVALID";
    if (variant === "missing-packet") delete final.settlement_evidence_binding.packet;
    fetchMock.mockImplementation((input, init) => {
      if (init?.method === "POST") {
        if (String(input).endsWith("/execute")) { phase = "unknown"; return Promise.resolve(response({ code: "OUTCOME_UNVERIFIED", execution: pending.execution, retry_submission: false }, 202)); }
        expect(String(input)).toBe(`/api/obligations/${id}/reconcile`);
        expect(JSON.parse(String(init.body))).toEqual({ idempotency_key: key, pae_instruction_hash: instructionHash });
        phase = "final"; return Promise.resolve(response({ code: "RECONCILED", execution: final.execution }));
      }
      if (String(input) === "/api/obligations") return Promise.resolve(response({ obligations: [obligation(id, true), ...(variant === "selection" ? [obligation("SYNTHETIC-S01-OTHER")] : [])] }));
      if (String(input).endsWith("SYNTHETIC-S01-OTHER")) return Promise.resolve(response(detail("SYNTHETIC-S01-OTHER")));
      if (phase === "final" && ["selection", "session", "loading"].includes(variant)) return lateRead.promise;
      if (phase === "final" && variant === "failed-refresh") return Promise.resolve(response({ code: "STATE_UNAVAILABLE" }, 503));
      return Promise.resolve(response(phase === "initial" ? original : phase === "unknown" ? pending : final));
    });
    const mounted = renderWithExplicitFirstSelection("SYNTHETIC-S01-CSRF");
    await screen.findByRole("region", { name: "Genuine obligation workspace" }); navigateStage("Payment");
    fireEvent.click(screen.getByRole("checkbox", { name: /I have reviewed the exact testnet/ }));
    fireEvent.click(screen.getByRole("button", { name: "Pay testnet USDC" }));
    await screen.findByRole("heading", { name: "Payment outcome unverified" });
    await screen.findByText(/An execution record is available. Continue with read-only reconciliation/);
    const reconcile = await screen.findByRole("button", { name: "Reconcile this same intent" });
    await waitFor(() => expect((reconcile as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(reconcile);
    await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(2));
    return { mounted, lateRead, final };
  }

  it.each(["AVAILABLE_CURRENT_BINDING", "AVAILABLE_HISTORICAL"])("clears contradictory UNKNOWN feedback after exact SETTLED %s", async binding => {
    await journey(binding);
    await screen.findByRole("heading", { name: "Testnet reconciliation receipt" });
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Payment outcome unverified" })).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("region", { name: "Current control status" }).textContent).not.toContain("Outcome unverified");
    expect(screen.getByRole("region", { name: "Reconciliation receipt" }).textContent).toContain("confirmed");
    expect(screen.queryByRole("button", { name: "Pay testnet USDC" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([url, init]) => init?.method === "POST" && String(url).endsWith("/execute"))).toHaveLength(1);
  });

  for (const binding of ["AVAILABLE_CURRENT_BINDING", "AVAILABLE_HISTORICAL"]) {
    it.each(["wrong-obligation", "wrong-instruction", "wrong-packet", "wrong-key", "wrong-packet-key", "changed-key-in-both", "wrong-version", "missing-key", "missing-binding", "invalid-binding", "missing-packet", "unknown", "submitting", "failed-refresh"])(`retains uncertainty for ${binding} with %s`, async variant => {
      await journey(binding, variant);
      if (variant === "failed-refresh") await screen.findAllByText(/Selected payable status is stale/);
      else await screen.findByText(/Durable readback (confirms|shows)/);
      expect(screen.getByRole("heading", { name: "Payment outcome unverified" })).toBeTruthy();
      expect(screen.getByRole("alert").textContent).toMatch(/do not retry|do not resubmit/i);
      expect(screen.queryByRole("button", { name: "Pay testnet USDC" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Approve payment release" })).toBeNull();
      expect(fetchMock.mock.calls.filter(([url, init]) => init?.method === "POST" && String(url).endsWith("/execute"))).toHaveLength(1);
    });
  }

  for (const binding of ["AVAILABLE_CURRENT_BINDING", "AVAILABLE_HISTORICAL"]) {
    it.each(["loading", "selection", "session"])(`contains delayed ${binding} terminal read across %s`, async boundary => {
      const h = await journey(binding, boundary);
      if (boundary === "loading") {
        expect(screen.getByRole("heading", { name: "Payment outcome unverified" })).toBeTruthy();
        expect(screen.getByRole("alert").textContent).toMatch(/do not retry|do not resubmit/i);
      } else if (boundary === "selection") {
        fireEvent.click(obligationRow("SYNTHETIC-S01-OTHER"));
        await screen.findByRole("button", { name: "Run AI Assessment" });
      } else {
        h.mounted.unmount();
        rtlRender(<CommandCenter csrfToken="SYNTHETIC-S01-NEW-SESSION" />);
        await waitFor(() => expect(obligationRow(id)).toBeTruthy());
      }
      await act(async () => h.lateRead.resolve(response(h.final)));
      if (boundary === "loading") {
        await waitFor(() => expect(screen.queryByRole("heading", { name: "Payment outcome unverified" })).toBeNull());
      } else {
        expect(screen.queryByRole("heading", { name: "Testnet reconciliation receipt" })).toBeNull();
        expect(screen.queryByText(/Refreshed status confirms an execution record for this same instruction/)).toBeNull();
        if (boundary === "selection") expect(obligationRow("SYNTHETIC-S01-OTHER").getAttribute("aria-current")).toBe("true");
        else expect(obligationRow(id).getAttribute("aria-current")).not.toBe("true");
      }
      expect(screen.queryByRole("button", { name: "Pay testnet USDC" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Approve payment release" })).toBeNull();
      expect(fetchMock.mock.calls.filter(([url, init]) => init?.method === "POST" && String(url).endsWith("/execute"))).toHaveLength(1);
    });
  }

  it.each(["failed", "blocked"])("acknowledges exact current %s disposition without claiming successful settlement", async status => {
    await journey("AVAILABLE_CURRENT_BINDING", status);
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Payment outcome unverified" })).toBeNull());
    expect(screen.getByRole("region", { name: "Reconciliation receipt" }).textContent).toContain(status === "failed" ? "Settlement attempt failed · successful reconciliation is not recorded" : "Payment release is blocked · the external settlement outcome is not confirmed");
    expect(screen.queryByText("TESTNET EXECUTION RECONCILED TO SOURCE OBLIGATION")).toBeNull();
    expect(screen.queryByRole("button", { name: "Pay testnet USDC" })).toBeNull();
    expect(screen.getByRole("region", { name: "Current control status" }).textContent).not.toContain("Outcome unverified");
  });
});
