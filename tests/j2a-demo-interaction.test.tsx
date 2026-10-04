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
    demo_obligation: null,
    intent_identity: null,
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
      demo_obligation: {
        invoice_date: "2026-10-04",
        effective_due_date: "2026-10-04",
        payment_basis: "PROTOTYPE_CASH_PAYMENT_DUE_ON_INVOICE_DATE",
      },
      intent_identity: {
        payer: {
          organization_id: "ORG-TAMEION-TESTNET-DEMO",
          organization_name: "Tameion Testnet Demonstration Organization",
          wallet_id: "source-wallet-id",
          wallet_address: "0xsource",
          provider_wallet_status: "LIVE",
          assurance_wallet_status: "ACTIVE",
          wallet_version: 1,
          wallet_set_id: "wallet-set-id",
          provider: "Circle Developer-Controlled Wallets",
        },
        beneficiary: {
          beneficiary_id: "CP-destination-wallet-id",
          name: "Tameion Test Counterparty",
          wallet_id: "destination-wallet-id",
          destination_ref: "CIRCLE-DCW-destination-wallet-id",
          wallet_address: "0xdestination",
          provider_wallet_status: "LIVE",
          verification_status: "VERIFIED",
          verification_version: 1,
          operational_status: "ACTIVE",
          operational_version: 1,
        },
      },
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
        business_payment_instruction: {
          payer: {
            business_postal_address: { status: "NOT_PROVIDED_IN_SOURCE", statement: "No verified payer address is present in source." },
            jurisdiction: { status: "NOT_PROVIDED_IN_SOURCE", statement: "No verified payer jurisdiction is present in source." },
          },
          beneficiary: {
            business_postal_address: { status: "NOT_APPLICABLE_TEST_COUNTERPARTY", statement: "No real postal address applies to the synthetic non-economic test counterparty." },
            jurisdiction: { status: "NOT_APPLICABLE_TEST_COUNTERPARTY", statement: "No real jurisdiction applies to the synthetic non-economic test counterparty." },
          },
          commercial: { invoice_reference: "DEMO-ARC-TESTNET-001", particulars: "Non-economic testnet demonstration." },
        },
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
      execution: {
        status: "UNKNOWN",
        provider_ref: "circle-tx-1",
        provider_evidence: {
          transaction_id: "circle-tx-1",
          transaction_state: "PENDING",
          tx_hash: "0xabc",
          wallet_id: "source-wallet-id",
          source_address: "0xsource",
          destination_address: "0xdestination",
          token_id: "native-usdc-token",
          network: "ARC-TESTNET",
          amounts: ["5.000000"],
          operation: "TRANSFER",
          ref_id: "j2a-privacy-safe-reference",
          network_fee: "0.001000",
          provider_created_at: "2026-10-04T12:00:00.000Z",
          provider_updated_at: "2026-10-04T12:01:00.000Z",
          reconciled_at: "2026-10-04T12:02:00.000Z",
        },
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
    expect(section.textContent).toContain("ARC-TESTNET · chain ID 5042002 · USDC gas");
    expect(section.textContent).toContain("NVIDIA Build");
    expect(section.textContent).toContain("b".repeat(64));
    expect(section.textContent).toContain("2026-10-04");
    expect(section.textContent).toContain("PROTOTYPE_CASH_PAYMENT_DUE_ON_INVOICE_DATE");
    expect(section.textContent).toContain("No real postal address applies to the synthetic non-economic test counterparty.");
    expect(section.textContent).toContain("They are not sent to Circle");
    expect(within(section).getByRole("region", { name: "Circle reconciliation evidence" })).toBeTruthy();
    expect(section.textContent).toContain("j2a-privacy-safe-reference");
    expect(section.textContent).toContain("2026-10-04T12:01:00.000Z");
    expect(within(section).getByRole("region", { name: "Payer and beneficiary identity binding" })).toBeTruthy();
    expect(section.textContent).toContain("source-wallet-id · 0xsource");
    expect(section.textContent).toContain("CP-destination-wallet-id");
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
