import { describe, expect, it, vi } from "vitest";

import {
  J2A_DEMO_DESTINATION,
  J2A_DEMO_SOURCE,
  J2A_DEMO_WALLET_SET_ID,
  J2A_MAX_NETWORK_FEE,
  J2A_MAX_TOTAL_DEBIT,
  J2A_TRANSFER_AMOUNT,
  buildJ2aDemoAggregate,
  runJ2aReadOnlyPreflight,
  type J2aPreflightClient,
} from "../src/demo/real-testnet-payment";

const capturedAt = "2026-10-04T12:00:00.000Z";

function wallet(id: string, address: string) {
  return { id, address, blockchain: "ARC-TESTNET", walletSetId: J2A_DEMO_WALLET_SET_ID, state: "LIVE" };
}

function providerTransaction(overrides: Record<string, unknown> = {}) {
  return {
    id: "prior-transaction",
    state: "COMPLETE",
    txType: "OUTBOUND",
    blockchain: "ARC-TESTNET",
    walletId: J2A_DEMO_SOURCE.id,
    destinationAddress: "0x0000000000000000000000000000000000000001",
    amounts: ["1.000000"],
    tokenId: "native-arc-usdc",
    refId: "prior-reference",
    ...overrides,
  };
}

function client(overrides: Partial<J2aPreflightClient> = {}): J2aPreflightClient {
  return {
    getWallet: vi.fn(async ({ id }: { id: string }) => ({
      data: { wallet: id === J2A_DEMO_SOURCE.id ? wallet(J2A_DEMO_SOURCE.id, J2A_DEMO_SOURCE.address) : wallet(J2A_DEMO_DESTINATION.id, J2A_DEMO_DESTINATION.address) },
    })),
    getWalletTokenBalance: vi.fn(async () => ({
      data: { tokenBalances: [{
        amount: "10.000000",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: true, tokenAddress: null },
      }] },
    })),
    estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.001000" } } })),
    listTransactions: vi.fn(async () => ({ data: { transactions: [providerTransaction()] } })),
    ...overrides,
  };
}

describe("J2A real Arc Testnet demo preflight", () => {
  it("pins the exact test wallets, fixed amount, network, token and capped fee", async () => {
    const api = client();
    const result = await runJ2aReadOnlyPreflight(api, () => new Date(capturedAt));

    expect(result.readiness).toBe("READY");
    if (result.readiness !== "READY") throw new Error("expected ready preflight");
    expect(result).toMatchObject({
      profile: "J2A_REAL_TESTNET_DEMO",
      amount: J2A_TRANSFER_AMOUNT,
      asset: "USDC",
      network: "ARC_TESTNET",
      max_network_fee: J2A_MAX_NETWORK_FEE,
      max_total_debit: J2A_MAX_TOTAL_DEBIT,
      source_wallet: { ...J2A_DEMO_SOURCE, state: "LIVE" },
      destination_wallet: { ...J2A_DEMO_DESTINATION, state: "LIVE" },
      provider_token: { id: "native-arc-usdc", symbol: "USDC", decimals: 6 },
      estimated_network_fee: "0.001000",
      captured_at: capturedAt,
      prior_matching_outbound: false,
    });
    expect(result.evidence_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(api.getWallet).toHaveBeenCalledTimes(2);
    expect(api.getWalletTokenBalance).toHaveBeenCalledWith({ id: J2A_DEMO_SOURCE.id, includeAll: true });
    expect(api.estimateTransferFee).toHaveBeenCalledWith(expect.objectContaining({
      walletId: J2A_DEMO_SOURCE.id,
      tokenId: "native-arc-usdc",
      amount: [J2A_TRANSFER_AMOUNT],
      destinationAddress: J2A_DEMO_DESTINATION.address,
    }));
    expect(api.listTransactions).toHaveBeenCalledWith(expect.objectContaining({
      blockchain: "ARC-TESTNET",
      txType: "OUTBOUND",
      walletIds: [J2A_DEMO_SOURCE.id],
    }));
  });

  it("fails closed when source wallet identity differs", async () => {
    const result = await runJ2aReadOnlyPreflight(client({
      getWallet: vi.fn(async () => ({ data: { wallet: wallet("wrong-wallet", J2A_DEMO_SOURCE.address) } })),
    }));
    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "SOURCE_WALLET_MISMATCH" });
  });

  it("fails closed when destination address differs", async () => {
    const result = await runJ2aReadOnlyPreflight(client({
      getWallet: vi.fn(async ({ id }: { id: string }) => ({ data: { wallet: id === J2A_DEMO_SOURCE.id
        ? wallet(J2A_DEMO_SOURCE.id, J2A_DEMO_SOURCE.address)
        : wallet(J2A_DEMO_DESTINATION.id, "0x0000000000000000000000000000000000000002") } })),
    }));
    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "DESTINATION_WALLET_MISMATCH" });
  });

  it("fails closed when either wallet is not LIVE", async () => {
    const result = await runJ2aReadOnlyPreflight(client({
      getWallet: vi.fn(async ({ id }: { id: string }) => ({ data: { wallet: {
        ...wallet(id, id === J2A_DEMO_SOURCE.id ? J2A_DEMO_SOURCE.address : J2A_DEMO_DESTINATION.address),
        state: "FROZEN",
      } } })),
    }));
    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "WALLET_NOT_LIVE" });
  });

  it("blocks when current balance does not cover exactly 5 USDC plus the estimated fee", async () => {
    const api = client({
      getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
        amount: "5.000999",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: true, tokenAddress: null },
      }] } })),
    });
    const result = await runJ2aReadOnlyPreflight(api);
    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "INSUFFICIENT_BALANCE" });
    expect(api.estimateTransferFee).toHaveBeenCalledTimes(1);
  });

  it("blocks when the fresh fee exceeds the fixed network-fee ceiling", async () => {
    const result = await runJ2aReadOnlyPreflight(client({
      estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.002001" } } })),
    }));
    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "FEE_CAP_EXCEEDED" });
  });

  it("blocks an exact prior 5 USDC outbound to this demo counterparty", async () => {
    const result = await runJ2aReadOnlyPreflight(client({
      listTransactions: vi.fn(async () => ({ data: { transactions: [providerTransaction({
        destinationAddress: J2A_DEMO_DESTINATION.address,
        amounts: [J2A_TRANSFER_AMOUNT],
      })] } })),
    }));
    expect(result).toMatchObject({ readiness: "BLOCKED", blocker: "PRIOR_MATCHING_OUTBOUND" });
  });

  it("does not prepare an isolated demo aggregate until read-only provider truth is READY", async () => {
    const ready = await runJ2aReadOnlyPreflight(client(), () => new Date(capturedAt));
    expect(ready.readiness).toBe("READY");
    if (ready.readiness !== "READY") throw new Error("expected ready preflight");
    const aggregate = buildJ2aDemoAggregate(ready);

    expect(aggregate).toMatchObject({
      organization_id: "ORG-TAMEION-TESTNET-DEMO",
      obligation_id: "DEMO-ARC-TESTNET-001",
      aggregate_version: 1,
      amount: "5.000000",
      asset: "USDC",
      network: "ARC_TESTNET",
      product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
      destination_ref: `CIRCLE-DCW-${J2A_DEMO_DESTINATION.id}`,
      destination_address: J2A_DEMO_DESTINATION.address,
      source_wallet_ref: J2A_DEMO_SOURCE.id,
      evidence_hashes: [ready.evidence_sha256],
    });
  });
});
