/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
    record: { obligation_id: id, amount: "125.00", currency: "USD" },
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

  it("keeps the last known selection and detail when post-action refresh reads fail", async () => {
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
        return Promise.resolve(detailReads === 1 ? response(detail("OBL-A")) : response(null, 502));
      }
      throw new Error(`Unexpected request: ${url}`);
    });

    render(<CommandCenter />);
    await screen.findByRole("button", { name: /OBL-A/ });
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    const assess = await screen.findByRole("button", { name: "Run assessment" }) as HTMLButtonElement;
    await waitFor(() => expect(assess.disabled).toBe(false));
    fireEvent.click(assess);

    expect(await screen.findByText(/Genuine obligations are unavailable\. No synthetic demo data has been added to this list/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Operational Report" }));
    const report = await screen.findByRole("region", { name: "Operational report for OBL-A" });
    expect(report.textContent).toContain("RECORD-OBL-A");
    expect(screen.getByRole("button", { name: /OBL-A/ })).toBeTruthy();
  });

  it("keeps non-idempotent controls busy while a newer selected action is still in flight", async () => {
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
    const assessA = await screen.findByRole("button", { name: "Run assessment" }) as HTMLButtonElement;
    await waitFor(() => expect(assessA.disabled).toBe(false));
    const actionACompletion = invokeClickHandler(assessA);
    await waitFor(() => expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/OBL-A/assess") && init?.method === "POST")).toBe(true));

    fireEvent.click(screen.getByRole("button", { name: /OBL-B/ }));
    await waitFor(() => expect(detailBReads).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole("button", { name: "Operational Report" }));
    const reportB = await screen.findByRole("region", { name: "Operational report for OBL-B" });
    expect(reportB.textContent).toContain("RECORD-OBL-B");
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    const assessB = screen.getByRole("button", { name: "Run assessment" }) as HTMLButtonElement;
    expect(assessB.disabled).toBe(true);
    // Exercise a previously dispatched B callback while A is still unwinding.
    const actionBCompletion = invokeClickHandler(assessB);
    expect(fetchMock.mock.calls.map(([url, init]) => [String(url), init?.method])).toEqual(expect.arrayContaining([["/api/obligations/OBL-B/assess", "POST"]]));

    actionA.resolve(response({ error: "Assessment unavailable" }, 503));
    await waitFor(() => expect(listReads).toBe(2));
    await act(async () => {
      staleActionListRefresh.resolve(response({ obligations: [obligation("OBL-A"), obligation("OBL-B")] }));
      await actionACompletion;
    });
    expect((screen.getByRole("button", { name: "Run assessment" }) as HTMLButtonElement).disabled).toBe(true);

    actionB.resolve(response({ error: "Assessment unavailable" }, 503));
    await act(async () => { await actionBCompletion; });
    expect((screen.getByRole("button", { name: "Run assessment" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("disables and rejects assessment while the selected detail is still loading", async () => {
    const selectedDetail = deferred<Response>();
    fetchMock.mockImplementation((input) => String(input) === "/api/obligations"
      ? Promise.resolve(response({ obligations: [obligation("OBL-A")] }))
      : selectedDetail.promise);

    render(<CommandCenter />);
    await screen.findByRole("button", { name: /OBL-A/ });
    fireEvent.click(screen.getByRole("button", { name: "Assessment" }));
    const assess = await screen.findByRole("button", { name: "Run assessment" }) as HTMLButtonElement;
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/obligations/OBL-A"));
    expect(assess.disabled).toBe(true);
    assess.disabled = false;
    fireEvent.click(assess);
    expect(fetchMock.mock.calls.some(([url, init]) => String(url).endsWith("/assess") && init?.method === "POST")).toBe(false);

    selectedDetail.resolve(response(detail("OBL-A")));
    await waitFor(() => expect((screen.getByRole("button", { name: "Run assessment" }) as HTMLButtonElement).disabled).toBe(false));
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
