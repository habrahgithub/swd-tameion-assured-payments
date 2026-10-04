/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";

import { RealTestnetDemoPanel } from "../app/command-center";

function statusResponse(overrides: Record<string, unknown> = {}) {
  return {
    classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
    organization_id: "ORG-TAMEION-TESTNET-DEMO",
    obligation_id: "DEMO-ARC-TESTNET-001",
    source_amount: "5.00",
    settlement_amount: "5.000000",
    asset: "USDC",
    network: "ARC_TESTNET",
    lifecycle: [
      { stage: "Obligation", status: "NOT_CREATED" },
      { stage: "AI Assessment", status: "NOT_ASSESSED" },
      { stage: "Assurance & Authorization", status: "NOT_AUTHORIZED" },
      { stage: "Execution", status: "NOT_SUBMITTED" },
      { stage: "Reconciliation & Evidence", status: "NOT_SUBMITTED" },
    ],
    preflight: null,
    aggregate_version: null,
    current_assessment: null,
    authorization: null,
    execution: null,
    execution_gate: "LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION",
    execution_packet: null,
    ...overrides,
  };
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

describe("J2A real-testnet Command Center surface", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("keeps the non-economic testnet lane distinct and renders server lifecycle truth", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(statusResponse()));
    vi.stubGlobal("fetch", fetchMock);

    render(<RealTestnetDemoPanel />);

    const section = await screen.findByRole("region", { name: "Live Testnet Demo" });
    expect(within(section).getByText("TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT")).toBeTruthy();
    expect(within(section).getByText("DEMO-ARC-TESTNET-001")).toBeTruthy();
    expect(within(section).getByText("5.000000 USDC · ARC_TESTNET")).toBeTruthy();
    for (const stage of ["Obligation", "AI Assessment", "Assurance & Authorization", "Execution", "Reconciliation & Evidence"]) {
      expect(within(section).getByText(stage)).toBeTruthy();
    }
    expect(within(section).getAllByText("NOT_SUBMITTED")).toHaveLength(2);
    expect(within(section).queryByText(/OBL-J0C-/)).toBeNull();
    expect((within(section).getByRole("button", { name: /Submit exact 5\.000000 USDC testnet demo/ }) as HTMLButtonElement).disabled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/internal/demo/real-testnet-payment/status");
  });

  it("does not dispatch an assessment, authorization, or execution request on mount", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(statusResponse()));
    vi.stubGlobal("fetch", fetchMock);

    render(<RealTestnetDemoPanel />);
    await screen.findByRole("region", { name: "Live Testnet Demo" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
      ["/api/internal/demo/real-testnet-payment/status", "GET"],
    ]);
  });

  it("shows the full current intent evidence before exposing PAY authorization inputs", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(statusResponse({
      aggregate_version: 9,
      preflight: {
        readiness: "READY",
        captured_at: "2026-10-04T12:00:00.000Z",
        source_wallet: { id: "source-wallet-id", address: "0xsource" },
        destination_wallet: { id: "destination-wallet-id", address: "0xdestination", name: "Tameion Test Counterparty" },
        provider_token: { id: "native-usdc-token", symbol: "USDC", decimals: 6, native: true },
        source_balance: "10.000000",
        estimated_network_fee: "0.001000",
        max_network_fee: "0.002000",
        max_total_debit: "5.012000",
        evidence_sha256: "a".repeat(64),
      },
      current_assessment: {
        assessment_id: "ASM-LIVE-1",
        assessment_hash: "b".repeat(64),
        decision: "PAY",
        reasons: ["Obligation facts are complete."],
        validated_findings: [],
        missing_evidence: [],
        provider_mode: "LIVE_AI",
        provider_name: "NVIDIA Build",
        model_id: "nvidia/nemotron-3-super-120b-a12b",
      },
    })));
    vi.stubGlobal("fetch", fetchMock);

    render(<RealTestnetDemoPanel />);
    const section = await screen.findByRole("region", { name: "Live Testnet Demo" });

    expect(within(section).getByRole("region", { name: "Exact current testnet intent" })).toBeTruthy();
    expect(section.textContent).toContain("Aggregate version");
    expect(section.textContent).toContain("source-wallet-id · 0xsource");
    expect(section.textContent).toContain("destination-wallet-id · 0xdestination");
    expect(section.textContent).toContain("native-usdc-token");
    expect(section.textContent).toContain("0.001000 / 0.002000 USDC");
    expect(section.textContent).toContain("5.012000 USDC");
    expect(section.textContent).toContain("NVIDIA Build");
    expect(section.textContent).toContain("b".repeat(64));
    expect(within(section).getByRole("button", { name: "Review exact intent and authorize" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["HOLD", "ESCALATE"] as const)("does not offer authorization inputs for a %s recommendation", async (decision) => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => jsonResponse(statusResponse({
      aggregate_version: 9,
      preflight: { readiness: "READY" },
      current_assessment: {
        assessment_id: "ASM-LIVE-1",
        assessment_hash: "c".repeat(64),
        decision,
        reasons: ["Assessment requires attention."],
        validated_findings: [],
        missing_evidence: [],
        provider_mode: "LIVE_AI",
        provider_name: "NVIDIA Build",
        model_id: "nvidia/nemotron-3-super-120b-a12b",
      },
    })));
    vi.stubGlobal("fetch", fetchMock);

    render(<RealTestnetDemoPanel />);
    const section = await screen.findByRole("region", { name: "Live Testnet Demo" });

    expect(within(section).queryByRole("button", { name: "Review exact intent and authorize" })).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
