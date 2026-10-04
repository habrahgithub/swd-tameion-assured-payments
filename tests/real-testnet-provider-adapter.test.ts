import { describe, expect, it, vi } from "vitest";

import { ArcCircleProviderAdapter, type J2aCircleClient } from "../src/execution/provider-adapter";
import {
  J2A_DEMO_DESTINATION,
  J2A_DEMO_SOURCE,
  J2A_DEMO_WALLET_SET_ID,
  runJ2aReadOnlyPreflight,
} from "../src/demo/real-testnet-payment";

function createClient(overrides: Partial<J2aCircleClient> = {}): J2aCircleClient {
  return {
    getWallet: vi.fn(async ({ id }) => ({ data: { wallet: {
      id,
      address: id === J2A_DEMO_SOURCE.id ? J2A_DEMO_SOURCE.address : J2A_DEMO_DESTINATION.address,
      blockchain: "ARC-TESTNET",
      walletSetId: J2A_DEMO_WALLET_SET_ID,
      state: "LIVE",
    } } })),
    getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
      amount: "10.000000",
      token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: true, tokenAddress: null },
    }] } })),
    estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.001000" } } })),
    listTransactions: vi.fn(async () => ({ data: { transactions: [] } })),
    getTransaction: vi.fn(async () => ({ data: { transaction: {
      id: "circle-tx-1", state: "INITIATED", blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
      destinationAddress: J2A_DEMO_DESTINATION.address, amounts: ["5.000000"], tokenId: "native-arc-usdc",
    } } })),
    createTransaction: vi.fn(async () => ({ data: { id: "circle-tx-1", state: "INITIATED" } })),
    ...overrides,
  };
}

describe("Arc Circle provider adapter for J2A", () => {
  it("submits only the fixed intent when fresh token and fee match the authorized preflight", async () => {
    const api = createClient();
    const authorized = await runJ2aReadOnlyPreflight(api);
    expect(authorized.readiness).toBe("READY");
    const adapter = new ArcCircleProviderAdapter(api, () => authorized);
    const result = await adapter.submitTransfer({
      idempotencyKey: "idem-ORG-TAMEION-TESTNET-DEMO-DEMO-ARC-TESTNET-001-2",
      sourceWalletRef: J2A_DEMO_SOURCE.id,
      destinationAddress: J2A_DEMO_DESTINATION.address,
      atomicAmount: "5000000",
      asset: "USDC",
      network: "ARC_TESTNET",
    });

    expect(result).toEqual({ providerRef: "circle-tx-1", status: "SUBMITTED" });
    expect(api.createTransaction).toHaveBeenCalledWith(expect.objectContaining({
      amount: ["5.000000"],
      destinationAddress: J2A_DEMO_DESTINATION.address,
      tokenId: "native-arc-usdc",
      walletId: J2A_DEMO_SOURCE.id,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      refId: "idem-ORG-TAMEION-TESTNET-DEMO-DEMO-ARC-TESTNET-001-2",
      idempotencyKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    }));
  });

  it("blocks before Circle submission when the fresh fee or token differs from the authorized preflight", async () => {
    const authorizedClient = createClient();
    const authorized = await runJ2aReadOnlyPreflight(authorizedClient);
    expect(authorized.readiness).toBe("READY");
    const cases = [
      createClient({ estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.001500" } } })) }),
      createClient({ getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
        amount: "11.000000",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: true, tokenAddress: null },
      }] } })) }),
      createClient({ getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
        amount: "10.000000",
        token: { id: "changed-native-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: true, tokenAddress: null },
      }] } })) }),
    ];

    for (const api of cases) {
      const adapter = new ArcCircleProviderAdapter(api, () => authorized);
      await expect(adapter.submitTransfer({
        idempotencyKey: "exact-demo-key",
        sourceWalletRef: J2A_DEMO_SOURCE.id,
        destinationAddress: J2A_DEMO_DESTINATION.address,
        atomicAmount: "5000000",
        asset: "USDC",
        network: "ARC_TESTNET",
      })).rejects.toThrow();
      expect(api.createTransaction).not.toHaveBeenCalled();
    }
  });

  it("does not submit without an authorized preflight baseline", async () => {
    const api = createClient();
    const adapter = new ArcCircleProviderAdapter(api);
    await expect(adapter.submitTransfer({
      idempotencyKey: "exact-demo-key",
      sourceWalletRef: J2A_DEMO_SOURCE.id,
      destinationAddress: J2A_DEMO_DESTINATION.address,
      atomicAmount: "5000000",
      asset: "USDC",
      network: "ARC_TESTNET",
    })).rejects.toThrow();
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it("rejects source, destination, network, asset and amount substitutions before provider submission", async () => {
    const invalid = [
      { sourceWalletRef: "other-wallet" },
      { destinationAddress: "0x0000000000000000000000000000000000000001" },
      { network: "ETH-SEPOLIA" as "ARC_TESTNET" },
      { asset: "ETH" as "USDC" },
      { atomicAmount: "5000001" },
    ];
    for (const override of invalid) {
      const api = createClient();
      const adapter = new ArcCircleProviderAdapter(api);
      await expect(adapter.submitTransfer({
        idempotencyKey: "stable-key",
        sourceWalletRef: J2A_DEMO_SOURCE.id,
        destinationAddress: J2A_DEMO_DESTINATION.address,
        atomicAmount: "5000000",
        asset: "USDC",
        network: "ARC_TESTNET",
        ...override,
      })).rejects.toThrow();
      expect(api.createTransaction).not.toHaveBeenCalled();
    }
  });

  it("keeps in-flight Circle state pending and reconciles with one read-only transaction lookup", async () => {
    const api = createClient();
    const adapter = new ArcCircleProviderAdapter(api);
    expect(await adapter.getStatus("circle-tx-1")).toEqual({ status: "PENDING" });
    expect(api.getTransaction).toHaveBeenCalledWith({ id: "circle-tx-1" });
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it("returns exact completed transfer evidence for the worker to reconcile", async () => {
    const api = createClient({ getTransaction: vi.fn(async () => ({ data: { transaction: {
      id: "circle-tx-1", state: "COMPLETE", blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
      destinationAddress: J2A_DEMO_DESTINATION.address, amounts: ["5.000000"], tokenId: "native-arc-usdc",
    } } })) });
    const result = await new ArcCircleProviderAdapter(api).getStatus("circle-tx-1");
    expect(result).toEqual({ status: "CONFIRMED", destinationAddress: J2A_DEMO_DESTINATION.address, atomicAmount: "5000000" });
  });

  it("does not submit during status-by-idempotency-key reconciliation", async () => {
    const api = createClient({
      listTransactions: vi.fn(async () => ({ data: { transactions: [{ id: "circle-tx-1", refId: "exact-demo-key" }] } })),
    });
    expect(await new ArcCircleProviderAdapter(api).getStatusByIdempotencyKey("exact-demo-key")).toEqual({ status: "PENDING" });
    expect(api.createTransaction).not.toHaveBeenCalled();
    expect(api.listTransactions).toHaveBeenCalledTimes(1);
    expect(api.getTransaction).toHaveBeenCalledTimes(1);
  });

  it("fails closed before submission on a fee cap or prior exact outbound", async () => {
    const authorized = await runJ2aReadOnlyPreflight(createClient());
    expect(authorized.readiness).toBe("READY");
    for (const overrides of [
      { estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.002001" } } })) },
      { listTransactions: vi.fn(async () => ({ data: { transactions: [{
        txType: "OUTBOUND", blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
        destinationAddress: J2A_DEMO_DESTINATION.address, amounts: ["5.000000"], tokenId: "native-arc-usdc",
      }] } })) },
    ]) {
      const api = createClient(overrides);
      await expect(new ArcCircleProviderAdapter(api, () => authorized).submitTransfer({
        idempotencyKey: "exact-demo-key", sourceWalletRef: J2A_DEMO_SOURCE.id,
        destinationAddress: J2A_DEMO_DESTINATION.address, atomicAmount: "5000000", asset: "USDC", network: "ARC_TESTNET",
      })).rejects.toThrow();
      expect(api.createTransaction).not.toHaveBeenCalled();
    }
  });
});
