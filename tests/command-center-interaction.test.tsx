/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { CommandCenter } from "../app/command-center";

type Obligation = {
  obligation_id: string;
  service_category: string;
  amount: string;
  currency: "USD" | "AED";
  recurrence: string;
  due_date: string;
  commercial_terms: string;
  assessed: boolean;
  decision: "HOLD" | null;
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

function selectReport() {
  fireEvent.click(screen.getByRole("button", { name: /Operational Report.*secondary/i }));
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

  it("keeps a loading summary unavailable, then reports an incomplete batch", async () => {
    const list = deferred<Response>();
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      return url === "/api/obligations" ? list.promise : selectedDetail.promise;
    });

    render(<CommandCenter />);
    selectReport();
    expect(screen.getByRole("status").textContent).toContain("Loading genuine obligations");
    expect(screen.getByText(/summary is not yet available/)).toBeTruthy();
    expect(screen.queryByText("Completed — no PAY candidate; all obligations assessed as HOLD or ESCALATE.")).toBeNull();

    list.resolve(response({ obligations: [obligation("OBL-A"), obligation("OBL-B", true)] }));
    await screen.findByRole("button", { name: /OBL-A/ });
    await waitFor(() => expect(screen.getAllByText("Incomplete assessment — 1 of 2 assessed. No candidate determination yet.").length).toBeGreaterThan(0));
    expect(screen.getByText("Unassessed").parentElement?.textContent).toContain("1");
    expect(screen.getByText(/Selected obligation detail is loading/)).toBeTruthy();
  });

  it("shows selected detail loading, then renders the fail-closed unassessed report", async () => {
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A")] }))
      : selectedDetail.promise);

    render(<CommandCenter />);
    selectReport();
    expect(await screen.findByText(/Selected obligation detail is loading/)).toBeTruthy();
    selectedDetail.resolve(response(detail("OBL-A")));
    expect(await screen.findByRole("region", { name: "Operational report for OBL-A" })).toBeTruthy();
    expect(screen.getByText("Fail-closed — default HOLD")).toBeTruthy();
    const summary = screen.getByRole("region", { name: "HOLD/ESCALATE aggregate summary" });
    expect(within(summary).getByText("HOLD").parentElement?.textContent).toContain("0");
    expect(within(summary).getByText("Unassessed").parentElement?.textContent).toContain("1");
  });

  it("shows list failure and then a verified empty summary after retry", async () => {
    fetchMock
      .mockResolvedValueOnce(response(null, 503))
      .mockResolvedValueOnce(response({ obligations: [] }));

    render(<CommandCenter />);
    selectReport();
    const summary = screen.getByRole("region", { name: "HOLD/ESCALATE aggregate summary" });
    expect(await within(summary).findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/summary cannot be determined/)).toBeTruthy();
    expect(screen.queryByText("Total obligations")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry genuine obligations" }));
    expect(await screen.findByText("No genuine obligations — nothing to report.")).toBeTruthy();
    expect(screen.getByText("Total obligations").parentElement?.textContent).toContain("0");
    expect(screen.queryByText(/Completed —/)).toBeNull();
  });

  it("shows the selected detail unavailable state after a failed read", async () => {
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A")] }))
      : selectedDetail.promise);

    render(<CommandCenter />);
    selectReport();
    expect(await screen.findByText(/Selected obligation detail is loading/)).toBeTruthy();
    selectedDetail.resolve(response(null, 502));
    expect(await screen.findByText(/Selected obligation detail is unavailable/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
  });

  it("makes assessment the genuine obligation action and separates the secondary demo path", async () => {
    const aedDetail = detail("OBL-A");
    aedDetail.record.amount = "5760.00";
    aedDetail.record.currency = "AED";
    aedDetail.aggregate.amount = "1568.413887";
    aedDetail.demo_arc_trust_simulated = true;
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A", false, "AED")] }))
      : Promise.resolve(response(aedDetail)));

    render(<CommandCenter />);
    await screen.findByRole("button", { name: /OBL-A/ });
    const workspace = await screen.findByRole("region", { name: "Genuine obligation workspace" });
    const main = screen.getByRole("main");
    const demonstrations = screen.getByText("Demonstrations").closest("details") as HTMLDetailsElement;
    expect(main.getAttribute("dir")).toBe("ltr");
    expect(workspace.compareDocumentPosition(demonstrations) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(demonstrations.open).toBe(false);

    const lifecycle = screen.getByRole("list", { name: "Payment lifecycle" });
    expect(Array.from(lifecycle.querySelectorAll("li div span:nth-child(2)")).map((step) => step.textContent?.trim())).toEqual([
      "Obligation",
      "Assessment",
      "Authorization",
      "Assurance",
      "Payment",
      "Reconciliation",
    ]);
    expect(screen.getByText("AI recommends · human authorizes · assurance controls release")).toBeTruthy();
    expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain("Assessment");
    expect(screen.getByRole("button", { name: "Run AI Assessment" })).toBeTruthy();
    const assess = screen.getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement;
    expect(assess.disabled).toBe(false);
    const demoSummary = screen.getByText("Demonstrations");
    expect((demoSummary.closest("details") as HTMLDetailsElement).open).toBe(false);

    expect(workspace.textContent).toContain("REAL BUSINESS OBLIGATION");
    expect(workspace.textContent).toContain("indicative only");
    expect(workspace.textContent).toContain("1 USD = AED 3.6725");
    expect(workspace.textContent).toContain("No payment intent exists");
    expect(workspace.textContent).toContain("No payment intent created");
    expect(workspace.textContent).toContain("Execution authorityNot Granted");
    expect(workspace.textContent).not.toContain("SIMULATED");
    expect(workspace.textContent).not.toContain("TEST-WALLET");
    const technicalSummary = screen.getByText("Source and control evidence (technical details)");
    fireEvent.click(technicalSummary);
    const technicalDetails = technicalSummary.closest("details") as HTMLDetailsElement;
    expect(technicalDetails.open).toBe(true);
    expect(technicalDetails.textContent).toContain("Simulated source-wallet and destination-trust fixtures are excluded");
    expect(technicalDetails.textContent).not.toContain("TEST-WALLET");
    expect(technicalDetails.textContent).not.toContain("UNVERIFIED");
    expect(screen.getByRole("button", { name: /Operational Report.*secondary/i })).toBeTruthy();

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
    render(<CommandCenter />);
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    const nav = screen.getByRole("navigation", { name: "Command Center surfaces" });
    expect(within(nav).getByRole("button", { name: "Obligations" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(nav).getByRole("button", { name: "Assessment" }));
    expect(within(nav).getByRole("button", { name: "Assessment" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(nav).getByRole("button", { name: "Obligations" }).getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(await screen.findByRole("button", { name: "Run AI Assessment" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Assessment unavailable.");
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
    render(<CommandCenter />);
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(screen.getByRole("button", { name: /OBL-ASSURANCE-NOT-READY/ }).textContent).toContain("PAY recommendation (advisory)");
    expect(screen.getByRole("list", { name: "Payment lifecycle" }).textContent).toContain("Approval locked — route assurance not ready");
    expect(screen.getByTestId("current-next-step").textContent).toContain("External-evidence step");
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));
    const prerequisites = screen.getByRole("list", { name: "Unmet authorization prerequisites" });
    expect(prerequisites.textContent).toContain("Owner: unavailable");
    expect(screen.getAllByRole("button", { name: "Prepare Arc Testnet settlement proxy" })).toHaveLength(1);
    expect(prerequisites.textContent).toContain("External-evidence step");
    expect(prerequisites.textContent).toContain("fresh assessment after preparation");
    expect(prerequisites.textContent).not.toContain("no product action is available here");
    expect(prerequisites.textContent).not.toContain("satisfy the existing readiness gate");
  });

  it("plays a deterministic same-identity sample without invoking payment routes", async () => {
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [obligation("OBL-A")] }));
      if (url === "/api/obligations/OBL-A") return Promise.resolve(response(detail("OBL-A")));
      return Promise.resolve(response({ error: "Unexpected request." }, 404));
    });
    render(<CommandCenter />);
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(screen.queryByRole("button", { name: "Simulate changed-destination attack" })).toBeNull();
    fireEvent.click(screen.getByText("Demonstrations"));
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
    const assessed = {
      obligation_id: "OBL-A",
      assessment_id: "ASM-OBL-A",
      assessment_hash: "a".repeat(64),
      aggregate_version: "1",
      decision: "HOLD" as const,
      reasons: ["Destination trust evidence is not verified."],
    };
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [obligation("OBL-A", true)] }));
      return Promise.resolve(response({ ...detail("OBL-A"), current_assessment: assessed }));
    });

    render(<CommandCenter />);
    await screen.findByRole("button", { name: /OBL-A/ });
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));

    expect(await screen.findByText("Advisory — HOLD")).toBeTruthy();
    expect(screen.getByText("Destination trust evidence is not verified.")).toBeTruthy();
    expect(screen.getByText(/Next action: resolve the findings before reassessing/)).toBeTruthy();
  });

  it("offers no more than one enabled primary action in the selected workspace", async () => {
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-ONE-ACTION")] }))
      : Promise.resolve(response(detail("OBL-ONE-ACTION"))));
    render(<CommandCenter />);
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
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

    render(<CommandCenter />);
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));
    expect(await screen.findByText(/An authorization envelope is already sealed for this obligation/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
    expect(screen.queryByText(/No payment intent exists at this step/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Authorization already sealed" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(0);
    expect(screen.getByText(/A payment authorization envelope is already sealed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));

    fireEvent.click(screen.getByRole("button", { name: /OBL-UNSEALED/ }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected source obligation" }).textContent).toContain("OBL-UNSEALED"));
    expect(await screen.findByText(/Current detail confirms no payment intent exists/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Authorization locked — prepare the testnet proxy/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /OBL-SEALED/ }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Selected source obligation" }).textContent).toContain("OBL-SEALED"));
    expect(await screen.findByText(/An authorization envelope is already sealed for this obligation/)).toBeTruthy();
    expect(sealedReads).toBe(2);
    expect(screen.queryByRole("button", { name: "Authorization already sealed" })).toBeNull();
  });

  it("does not infer no intent while authorization detail is loading or unavailable", async () => {
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A")] }))
      : selectedDetail.promise);

    render(<CommandCenter />);
    await screen.findByRole("button", { name: /OBL-A/ });
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));
    expect(await screen.findByText("Loading current obligation detail; authorization status is not yet available.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
    expect(screen.queryByText(/Current detail confirms no payment intent exists/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Authorization status unavailable" })).toBeNull();

    selectedDetail.resolve(response(null, 503));
    expect(await screen.findByText("Selected obligation detail is unavailable; authorization and payment-intent status cannot be confirmed.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
    expect(screen.queryByText(/Current detail confirms no payment intent exists/)).toBeNull();
    expect(screen.getByRole("button", { name: "Refresh current status" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Refresh current status" })).toBeTruthy();
  });

  it("does not show actionable authorization prerequisites with no selected obligation", async () => {
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [] }))
      : Promise.resolve(response(null, 404)));

    render(<CommandCenter />);
    await screen.findByText("Genuine obligations are not selected.");
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));
    expect(screen.getByText("Select an obligation to review its authorization and payment-intent status.")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
  });

  it("makes review the primary PAY action, then removes primary action while route assurance blocks", async () => {
    const pay = assessedDetail("OBL-PAY-BLOCKED", "PAY");
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [{ ...obligation("OBL-PAY-BLOCKED", true), decision: "PAY", route_assurance_status: "Route assurance not ready" }] }))
      : Promise.resolve(response(pay)));

    render(<CommandCenter />);
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    const primary = () => Array.from(screen.getByRole("main").querySelectorAll<HTMLButtonElement>('button[data-primary-action="true"]'))
      .filter((button) => !button.disabled);
    expect(primary()).toHaveLength(1);
    expect(primary()[0].textContent).toContain("Review current PAY assessment");
    expect(primary()[0].textContent).not.toContain("Run AI Assessment");

    fireEvent.click(primary()[0]);
    await screen.findByText(/Blocker: payment-route assurance is not ready/);
    expect(primary()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Authorization locked — prepare the testnet proxy/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Reassess current PAY recommendation (optional)" })).toBeTruthy();
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
    render(<CommandCenter />);
    const lifecycle = await screen.findByRole("list", { name: "Payment lifecycle" });
    await waitFor(() => expect(lifecycle.textContent).toContain("Authorized — sealed PAE exists"));
    expect(lifecycle.textContent).toContain("AuthorizationAuthorized — sealed PAE exists");
    expect(lifecycle.textContent).toContain("AssurancePAE is sealed; detailed assurance unavailable in this view");
    expect(lifecycle.textContent).toContain("PaymentBlocked — no Arc payment binding for this obligation");
    expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain("Payment");
  });

  it("labels a sealed authorization as an Arc Testnet proxy subject to exact-packet and pre-send gates", async () => {
    const authorized = proxyPrepared(sealedDetail("OBL-SEALED-PROXY"));
    authorized.aggregate.destination_verification_status = "VERIFIED";
    authorized.aggregate.destination_operational_status = "ACTIVE";
    authorized.aggregate.source_wallet_status = "ACTIVE";
    authorized.aggregate.product_trust_provenance = "CURRENT_PRODUCT_EVIDENCE";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-SEALED-PROXY", true)] }))
      : Promise.resolve(response(authorized)));

    render(<CommandCenter />);
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(screen.getAllByText(/Approved instruction is sealed for the Arc Testnet settlement proxy/).length).toBeGreaterThan(0);
    expect(screen.getByText(/subject to the exact-packet gate and final pre-send checks/)).toBeTruthy();
    expect(screen.queryByText(/has no Arc payment binding/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));
    expect(screen.getAllByText(/Approved instruction is sealed for the Arc Testnet settlement proxy/)).toHaveLength(2);
    expect(screen.queryByText(/payment remains blocked without an Arc binding/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    expect(screen.queryByText(/payment remains blocked without an Arc binding/)).toBeNull();
  });

  it.each([
    {
      name: "execution FAILED",
      executionStatus: "FAILED",
      releaseAuthority: "BLOCKED",
      paeState: "REVOKED",
      currentStage: "Reconciliation",
      expected: /provider attempt failed/i,
    },
    {
      name: "execution BLOCKED",
      executionStatus: "BLOCKED",
      releaseAuthority: "BLOCKED",
      paeState: "REVOKED",
      currentStage: "Payment",
      expected: /blocked before provider submission/i,
    },
    {
      name: "PAE-011/REVOKED without an execution record",
      executionStatus: null,
      aggregateExecutionState: "BLOCKED",
      releaseAuthority: "BLOCKED",
      paeState: "REVOKED",
      currentStage: "Payment",
      expected: /execution record (?:is )?unavailable.*revoked/i,
    },
    {
      name: "PAE EXPIRED without an execution record",
      executionStatus: null,
      releaseAuthority: "EXPIRED",
      paeState: "EXPIRED",
      currentStage: "Payment",
      expected: /execution record (?:is )?unavailable.*expired/i,
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

    render(<CommandCenter />);
    const lifecycle = await screen.findByRole("list", { name: "Payment lifecycle" });
    await waitFor(() => expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain(currentStage));
    expect(lifecycle.textContent).not.toMatch(/awaits separate exact-packet gate/i);
    expect(screen.getByTestId("current-next-step").textContent).not.toContain("Prime · exact-packet authorization");
    expect(screen.getByTestId("current-next-step").textContent).toMatch(expected);
    expect(lifecycle.textContent).toMatch(expected);
    expect(lifecycle.textContent).not.toMatch(/Not submitted/i);
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(0);
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("labels AUTHORIZED N+1 without a sealed PAE as assurance failed or blocked", async () => {
    const authorized = proxyPrepared(assessedDetail("OBL-ASSURANCE-BLOCKED-AFTER-APPROVAL", "PAY"));
    authorized.aggregate.state = "AUTHORIZED";
    authorized.aggregate.pae_state = "UNUSED";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-ASSURANCE-BLOCKED-AFTER-APPROVAL", true)] }))
      : Promise.resolve(response(authorized)));

    render(<CommandCenter />);
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(screen.getByTestId("current-next-step").textContent).toContain("Authorization recorded · Assurance failed/blocked");
    expect(screen.getByTestId("current-next-step").textContent).toMatch(/no PASS assurance, usable PAE, or execution is available/i);
    const lifecycle = screen.getByRole("list", { name: "Payment lifecycle" });
    expect(lifecycle.textContent).toContain("AuthorizationAuthorization recorded — assurance failed or blocked");
    expect(lifecycle.textContent).toContain("AssuranceAssurance failed or blocked; no PASS assurance is available");
    expect(lifecycle.textContent).toContain("PaymentAuthorization recorded; assurance failed or blocked; no usable PAE or execution");
  });

  it("keeps an actual post-approval AUTHORIZED N+1 response at Assurance with no unsupported reassessment", async () => {
    const id = "OBL-AUTHORIZED-NPLUS1-NO-PAE";
    const authorized = approvedNPlusOneDetail(id, false);
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation(id, false)] }))
      : Promise.resolve(response(authorized)));

    render(<CommandCenter />);
    const nextStep = await screen.findByTestId("current-next-step");
    const lifecycle = screen.getByRole("list", { name: "Payment lifecycle" });
    await waitFor(() => expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain("Assurance"));
    expect(lifecycle.textContent).toContain("AssessmentNot current for this version");
    expect(lifecycle.textContent).toContain("AssuranceAssurance failed or blocked; no PASS assurance is available");
    expect(nextStep.textContent).toContain("Authorization recorded · Assurance failed/blocked");
    expect(nextStep.textContent).toMatch(/no PASS assurance, usable PAE, or execution is available/i);
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByText(/Authorization was recorded, but assurance failed or is blocked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));
    expect(screen.getByText(/Authorization was recorded, but assurance failed or is blocked/)).toBeTruthy();
    expect(screen.queryByText(/Authorization review applies to the current PAY assessment/)).toBeNull();
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  });

  it("keeps an actual sealed post-approval N+1 response at Payment without offering assessment", async () => {
    const id = "OBL-SEALED-NPLUS1-NO-ASSESSMENT";
    const sealed = approvedNPlusOneDetail(id, true);
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation(id, false)] }))
      : Promise.resolve(response(sealed)));

    render(<CommandCenter />);
    const lifecycle = await screen.findByRole("list", { name: "Payment lifecycle" });
    await waitFor(() => expect(lifecycle.querySelector('[aria-current="step"]')?.textContent).toContain("Payment"));
    expect(lifecycle.textContent).toContain("AssessmentNot current for this version");
    expect(lifecycle.textContent).toContain("AuthorizationAuthorized — sealed PAE exists");
    expect(screen.getByTestId("current-next-step").textContent).toContain("Approved instruction is sealed for the Arc Testnet settlement proxy");
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
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

    render(<CommandCenter />);
    const workspace = await screen.findByRole("region", { name: "Genuine obligation workspace" });

    expect(workspace.textContent).toContain("Advisory — HOLD");
    expect(workspace.textContent).toContain("Current destination and source-wallet readiness are not verified.");
    expect(workspace.textContent).toContain("DESTINATION_NOT_READY");
    expect(workspace.textContent).toContain("Resolve the current destination or source-wallet readiness blocker.");
    expect(workspace.textContent).toContain("Treasury Operations");
    expect(workspace.textContent).toContain("Verified destination readiness and source-wallet trust-seed record");
    expect(workspace.textContent).toContain("reassess permitted");
    expect(workspace.textContent).toContain("Resolution action is not yet available in this build; provide/verify current payment-route evidence, then reassess.");
    expect(within(workspace).queryByRole("button", { name: /resolve/i })).toBeNull();

    const lifecycle = screen.getByRole("list", { name: "Payment lifecycle" });
    expect(lifecycle.textContent).toContain("AssessmentRequires attention");
    expect(lifecycle.textContent).toContain("AuthorizationLocked — assessment requires attention");
    expect(lifecycle.textContent).toContain("AssuranceFinal assurance not run");
    expect(lifecycle.textContent).toContain("PaymentBlocked — no Arc payment binding for this obligation");
    expect(lifecycle.textContent).toContain("ReconciliationNo Arc settlement to reconcile");
    expect(lifecycle.textContent).not.toMatch(/transaction (failed|pending)/i);
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
    render(<CommandCenter />);
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    fireEvent.click(await screen.findByRole("button", { name: "Review assessment evidence" }));
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
      ? Promise.resolve(response({ obligations: [obligation("OBL-ASSURANCE-NOT-READY", true)] }))
      : Promise.resolve(response(pay)));

    render(<CommandCenter />);
    const lifecycle = await screen.findByRole("list", { name: "Payment lifecycle" });
    await screen.findByRole("region", { name: "Genuine obligation workspace" });
    expect(Array.from(lifecycle.querySelectorAll("li div span:nth-child(2)")).map((step) => step.textContent?.trim())).toEqual([
      "Obligation",
      "Assessment",
      "Authorization",
      "Assurance",
      "Payment",
      "Reconciliation",
    ]);
    expect(lifecycle.textContent).toContain("PAY — advisory");
    expect(lifecycle.textContent).toContain("Approval locked — route assurance not ready");
    expect(lifecycle.textContent).toContain("Final assurance not run");
    expect(lifecycle.textContent).toContain("Blocked — no Arc payment binding for this obligation");
    expect(lifecycle.textContent).toContain("No Arc settlement to reconcile");
    const selectedHeader = screen.getByRole("region", { name: "Selected source obligation" });
    expect(within(selectedHeader as HTMLElement).getByText("PAY recommended — assurance not ready; authorization locked")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));
    const prerequisites = screen.getByRole("list", { name: "Unmet authorization prerequisites" });
    expect(within(prerequisites).getAllByRole("listitem").map((item) => item.textContent?.trim())).toEqual([
      expect.stringContaining("Payment-route assurance is not ready: Destination verification is pending verification"),
      "Review the current PAY assessment before authorization.",
    ]);
    expect(prerequisites.textContent).toMatch(/product-trust provenance is/i);
    expect(screen.queryByRole("button", { name: /Authorization locked — prepare the testnet proxy/ })).toBeNull();
    expect(screen.getByText(/Current detail confirms no payment intent exists/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assurance & Execution" }));
    expect(screen.getAllByText(/Payment-route assurance is not ready: Destination verification is pending verification/).length).toBeGreaterThan(0);
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
      ? Promise.resolve(response({ obligations: [{ ...obligation("OBL-EXACT-INTENT", true), decision: "PAY", route_assurance_status: "Route assurance ready" }] }))
      : Promise.resolve(response(pay)));
    render(<CommandCenter />);
    const sourceSummary = await screen.findByRole("region", { name: "Selected source obligation" });
    await waitFor(() => expect(sourceSummary.textContent).not.toContain("Source and control details are loading"));
    expect(sourceSummary.textContent).toContain("125.00 USD");
    expect(sourceSummary.textContent).toContain("125.000000 USDC");
    expect(sourceSummary.textContent).toContain("ARC_TESTNET");
    expect(sourceSummary.textContent).toContain("testnet-source-id · 0x1111111111111111111111111111111111111111");
    expect(sourceSummary.textContent).toContain("testnet-proxy-id · 0x2222222222222222222222222222222222222222");
    const sourceDetails = screen.getByText("Source records and payment details").closest("details") as HTMLDetailsElement;
    expect(sourceDetails.open).toBe(false);
    fireEvent.click(screen.getByText("Source records and payment details"));
    const intentDetails = await screen.findByRole("region", { name: "Exact payment intent summary" });
    expect(intentDetails.textContent).toContain("No FX rate recorded");
    expect(intentDetails.textContent).toContain("Pending separate Safety Kernel review and human authorization");
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));
    const summary = screen.getByRole("region", { name: "Genuine obligation and Arc Testnet settlement proxy" });
    expect(summary.textContent).toContain("125.00 USD · OUTSTANDING");
    expect(summary.textContent).toContain("125.000000 USDC");
    expect(summary.textContent).toContain("ARC_TESTNET");
    expect(summary.textContent).toContain("testnet-source-id · 0x1111111111111111111111111111111111111111");
    expect(summary.textContent).toContain("testnet-proxy-id · 0x2222222222222222222222222222222222222222");
    expect(screen.queryByRole("button", { name: "Authorize selected obligation" })).toBeNull();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes("/approve"))).toBe(false);
  });

  it("uses the server winner projection when five current PAY candidates exist", async () => {
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
        sole_pay_candidate_id: winner.obligation_id,
      }));
      const id = url.split("/").at(-1)!;
      const current = assessedDetail(id, "PAY");
      current.current_assessment.provider_mode = "LIVE_AI";
      current.current_assessment.provider_used = "mock-live-ai";
      current.record.due_date = fivePay.find((item) => item.obligation_id === id)?.due_date;
      return Promise.resolve(response(current));
    });

    render(<CommandCenter />);
    await screen.findByRole("button", { name: new RegExp(winner.obligation_id) });
    expect(screen.getByText(/Assessment complete — 5 PAY recommendations/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));
    expect(await screen.findByRole("button", { name: "Prepare Arc Testnet settlement proxy" })).toBeTruthy();

    const nonwinner = fivePay.find((item) => item.obligation_id !== winner.obligation_id)!;
    fireEvent.click(screen.getByRole("button", { name: new RegExp(nonwinner.obligation_id) }));
    await waitFor(() => expect(screen.getByText(new RegExp(`The existing deterministic gate selected ${winner.obligation_id}`))).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Prepare Arc Testnet settlement proxy" })).toBeNull();
    expect(fetchMock.mock.calls.some(([input, init]) => String(input).endsWith("/preflight") && init?.method === "POST")).toBe(false);
  });

  it.each([
    ["HOLD", "Requires attention"],
    ["ESCALATE", "Escalation required"],
  ] as const)("keeps a current %s assessment locked even after all five obligations are assessed", async (decision, stateLabel) => {
    const obligations = ["OBL-A", "OBL-B", "OBL-C", "OBL-D", "OBL-E"].map((id) => obligation(id, true));
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations }))
      : Promise.resolve(response(assessedDetail("OBL-A", decision))));

    render(<CommandCenter />);
    expect((await screen.findAllByText(stateLabel)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Awaiting human authorization")).toBeNull();
    const workspace = screen.getByRole("region", { name: "Genuine obligation workspace" });
    expect(workspace.textContent).toContain(`Advisory — ${decision}`);
    expect(workspace.textContent).toContain(decision === "HOLD" ? "Source evidence is incomplete." : "Controller review is required.");
    expect(workspace.textContent).toContain("Review the finding.");
    expect(workspace.textContent).toContain("Accounts Payable");
    expect(workspace.textContent).toContain("Supporting document");
    expect(within(workspace).queryByRole("button", { name: /resolve/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    expect(await screen.findByText(`Advisory — ${decision}`)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review assessment evidence" }));
    expect(await screen.findByText(/Authorization remains locked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));

    const authorize = screen.queryByRole("button", { name: /Authorization locked — prepare the testnet proxy/ });
    expect(authorize).toBeNull();
    expect(screen.getByText(/A current PAY assessment is required/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/approve") && init?.method === "POST")).toBe(false);
  });

  it("allows only a current reviewed PAY assessment to become authorization eligible", async () => {
    const obligations = ["OBL-A", "OBL-B", "OBL-C", "OBL-D", "OBL-E"].map((id) => obligation(id, true));
    const pay = proxyPrepared(assessedDetail("OBL-A", "PAY"));
    pay.aggregate.destination_verification_status = "VERIFIED";
    pay.aggregate.destination_operational_status = "ACTIVE";
    pay.aggregate.source_wallet_status = "ACTIVE";
    pay.aggregate.product_trust_provenance = "CURRENT_PRODUCT_EVIDENCE";
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations }))
      : Promise.resolve(response(pay)));

    render(<CommandCenter />);
    expect((await screen.findAllByText("Eligible for human authorization review")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    expect(await screen.findByText("Advisory — PAY")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Review this assessment for authorization" }));
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));

    expect(screen.getByRole("button", { name: "Authorize this exact obligation" })).toBeTruthy();
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

    render(<CommandCenter />);
    await screen.findByRole("button", { name: /OBL-A/ });
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    const assess = await screen.findByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement;
    await waitFor(() => expect(assess.disabled).toBe(false));
    fireEvent.click(assess);

    expect(await screen.findByText(/Genuine obligations are unavailable\. No synthetic demo data has been added to this list/)).toBeTruthy();
    expect(await screen.findByText(/Last-known obligation details are stale/)).toBeTruthy();
    expect(screen.getAllByText("Last-known state — stale").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Refresh current status" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Operational Report.*secondary/i }));
    expect(await screen.findByText(/Selected obligation detail is stale/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
    expect(screen.getByRole("button", { name: /OBL-A/ })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Authorization" }));
    expect(screen.getByText(/Last-known obligation detail is stale; refresh before relying on authorization or payment-intent status/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Unmet authorization prerequisites" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Refresh current status" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Assurance & Execution" }));
    expect(screen.getByText(/Kill switch: selected obligation detail is stale/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Disable this obligation" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Submit for execution (simulated)" })).toBeNull();
    expect(screen.getByText(/Payment is blocked while current obligation and settlement details are unavailable/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Refresh current status" }));
    await waitFor(() => expect(screen.queryByText(/Last-known obligation details are stale/)).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: /Operational Report.*secondary/i }));
    expect(await screen.findByRole("region", { name: "Operational report for OBL-A" })).toBeTruthy();
  });

  it("keeps the internal active-run counter positive until all dispatched callbacks settle", async () => {
    const actionA = deferred<Response>();
    const actionB = deferred<Response>();
    const staleActionListRefresh = deferred<Response>();
    let listReads = 0;
    let detailBReads = 0;
    fetchMock.mockImplementation((input, init) => {
      const url = String(input);
      if (url === "/api/obligations" && init?.method !== "POST") {
        listReads += 1;
        if (listReads === 1) return Promise.resolve(response({ obligations: [obligation("OBL-A"), obligation("OBL-B")] }));
        if (listReads === 2) return staleActionListRefresh.promise;
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

    render(<CommandCenter />);
    await screen.findByRole("button", { name: /OBL-B/ });
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    const assessA = await screen.findByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement;
    await waitFor(() => expect(assessA.disabled).toBe(false));
    const actionACompletion = invokeClickHandler(assessA);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/OBL-A/assess") && init?.method === "POST")).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: /OBL-B/ }));
    await waitFor(() => expect(detailBReads).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: /Operational Report.*secondary/i }));
    const reportB = await screen.findByRole("region", { name: "Operational report for OBL-B" });
    expect(reportB.textContent).toContain("RECORD-OBL-B");
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    const assessB = screen.getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement;
    expect(assessB.disabled).toBe(true);
    // Invoke the internal callback directly to isolate the defensive counter invariant.
    // This does not claim the disabled button is reachable through browser interaction.
    const actionBCompletion = invokeClickHandler(assessB);
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual(expect.arrayContaining([["/api/obligations/OBL-B/assess", "POST"]]));

    actionA.resolve(response({ error: "Assessment unavailable" }, 503));
    await waitFor(() => expect(listReads).toBe(2));
    await act(async () => {
      staleActionListRefresh.resolve(response({ obligations: [obligation("OBL-A"), obligation("OBL-B")] }));
      await actionACompletion;
    });
    expect((screen.getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement).disabled).toBe(true);

    actionB.resolve(response({ error: "Assessment unavailable" }, 503));
    await act(async () => { await actionBCompletion; });
    expect((screen.getByRole("button", { name: "Run AI Assessment" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("keeps assessment disabled during loading and a browser click sends no request", async () => {
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A")] }))
      : selectedDetail.promise);

    render(<CommandCenter />);
    await screen.findByRole("button", { name: /OBL-A/ });
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
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

    render(<CommandCenter />);
    await screen.findByRole("button", { name: /OBL-A/ });
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    expect(await screen.findByText(/Obligation detail is unavailable/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Run AI Assessment" })).toBeNull();
    expect(screen.getByRole("main").querySelectorAll('button[data-primary-action="true"]:not(:disabled)')).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Refresh current status" })).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/assess") && init?.method === "POST")).toBe(false);
    expect(screen.queryByRole("region", { name: /Operational report for/ })).toBeNull();
  });

  it("keeps the report bound to the current selection when an older detail request finishes late", async () => {
    const firstDetail = deferred<Response>();
    const secondDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/obligations") return Promise.resolve(response({ obligations: [obligation("OBL-A"), obligation("OBL-B")] }));
      return url.endsWith("OBL-A") ? firstDetail.promise : secondDetail.promise;
    });

    render(<CommandCenter />);
    await screen.findByRole("button", { name: /OBL-B/ });
    selectReport();
    expect(await screen.findByText(/Selected obligation detail is loading/)).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/obligations/OBL-A"));
    fireEvent.click(screen.getByRole("button", { name: /OBL-B/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/obligations/OBL-B"));
    secondDetail.resolve(response(detail("OBL-B")));
    const reportForB = await screen.findByRole("region", { name: "Operational report for OBL-B" });
    expect(reportForB.textContent).toContain("RECORD-OBL-B");
    expect(reportForB.textContent).not.toContain("RECORD-OBL-A");
    firstDetail.resolve(response(detail("OBL-A")));
    await waitFor(() => expect(screen.getByRole("region", { name: "Operational report for OBL-B" }).textContent).toContain("RECORD-OBL-B"));
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
    expect(screen.getByRole("region", { name: "Operational report for OBL-B" }).textContent).not.toContain("RECORD-OBL-A");
  });
});
