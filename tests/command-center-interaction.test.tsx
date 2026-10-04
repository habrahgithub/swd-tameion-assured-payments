/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { CommandCenter } from "../app/command-center";

type Obligation = {
  obligation_id: string;
  service_category: string;
  amount: string;
  currency: "USD";
  recurrence: string;
  due_date: string;
  commercial_terms: string;
  assessed: boolean;
  decision: "HOLD" | null;
  provider_mode: "NOT_LIVE_AI" | null;
};

function obligation(id: string, assessed = false): Obligation {
  return {
    obligation_id: id,
    service_category: "TEST_SERVICE",
    amount: "125.00",
    currency: "USD",
    recurrence: "MONTHLY",
    due_date: "2026-10-05",
    commercial_terms: "Net 30",
    assessed,
    decision: assessed ? "HOLD" : null,
    provider_mode: assessed ? "NOT_LIVE_AI" : null,
  };
}

function detail(id: string) {
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
      execution_state: "NONE",
      pae_state: "UNUSED",
    },
    record: { amount: "125.00", currency: "USD" },
    current_assessment: null,
    demo_arc_trust_simulated: false,
    pae_sealed: false,
    execution: null,
    execution_kill_switched: false,
  };
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
  fireEvent.click(screen.getByRole("button", { name: "Operational Report" }));
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
    expect(await screen.findByRole("alert")).toBeTruthy();
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
    expect(screen.queryByRole("heading", { name: "Operational report for OBL-A" })).toBeNull();
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
    fireEvent.click(screen.getByRole("button", { name: /OBL-B/ }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/obligations/OBL-B"));
    secondDetail.resolve(response(detail("OBL-B")));
    expect(await screen.findByRole("region", { name: "Operational report for OBL-B" })).toBeTruthy();
    firstDetail.resolve(response(detail("OBL-A")));
    await waitFor(() => expect(screen.getByRole("region", { name: "Operational report for OBL-B" })).toBeTruthy());
    expect(screen.queryByRole("region", { name: "Operational report for OBL-A" })).toBeNull();
  });
});
