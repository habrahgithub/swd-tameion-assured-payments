import { describe, expect, it, vi } from "vitest";

import { ArcCircleProviderAdapter, type J2aCircleClient } from "../src/execution/provider-adapter";
import {
  J2A_DEMO_DESTINATION,
  J2A_DEMO_SOURCE,
  J2A_DEMO_WALLET_SET_ID,
  deriveJ2aCircleIdempotencyUuid,
  deriveJ2aCircleRefId,
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
      refId: deriveJ2aCircleRefId("exact-demo-key"),
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
    const circleRequest = vi.mocked(api.createTransaction).mock.calls[0]?.[0];
    expect(circleRequest).toEqual({
      amount: ["5.000000"],
      destinationAddress: J2A_DEMO_DESTINATION.address,
      tokenId: "native-arc-usdc",
      walletId: J2A_DEMO_SOURCE.id,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      refId: expect.stringMatching(/^j2a-[0-9a-f]{28}$/),
      idempotencyKey: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    });
    expect(deriveJ2aCircleIdempotencyUuid("stable-execution-identity")).toBe(deriveJ2aCircleIdempotencyUuid("stable-execution-identity"));
    expect(deriveJ2aCircleIdempotencyUuid("stable-execution-identity")).not.toBe(deriveJ2aCircleIdempotencyUuid("different-execution-identity"));
    expect(circleRequest?.refId).not.toContain("ORG-TAMEION");
    expect(circleRequest?.refId).not.toContain("DEMO-ARC");
  });

  it("blocks before submission when the reviewed business instruction changes", async () => {
    const api = createClient();
    const authorized = await runJ2aReadOnlyPreflight(api);
    expect(authorized.readiness).toBe("READY");
    if (authorized.readiness !== "READY") throw new Error("expected ready preflight");
    const changedAuthorized = structuredClone(authorized);
    changedAuthorized.business_payment_instruction.commercial.invoice_reference = "DIFFERENT-INVOICE";

    await expect(new ArcCircleProviderAdapter(api, () => changedAuthorized).submitTransfer({
      idempotencyKey: "exact-demo-key", sourceWalletRef: J2A_DEMO_SOURCE.id,
      destinationAddress: J2A_DEMO_DESTINATION.address, atomicAmount: "5000000", asset: "USDC", network: "ARC_TESTNET",
    })).rejects.toThrow();
    expect(api.createTransaction).not.toHaveBeenCalled();
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
    expect(await adapter.getStatus("circle-tx-1")).toMatchObject({ status: "PENDING", transaction_id: "circle-tx-1" });
    expect(api.getTransaction).toHaveBeenCalledWith({ id: "circle-tx-1" });
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it("returns exact completed transfer evidence for the worker to reconcile", async () => {
    const api = createClient({ getTransaction: vi.fn(async () => ({ data: { transaction: {
      id: "circle-tx-1", state: "COMPLETE", blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
      destinationAddress: J2A_DEMO_DESTINATION.address, amounts: ["5.000000"], tokenId: "native-arc-usdc",
      sourceAddress: J2A_DEMO_SOURCE.address, operation: "TRANSFER", refId: deriveJ2aCircleRefId("exact-demo-key"),
      txHash: "0xabc123", networkFee: "0.001000", createDate: "2026-10-04T10:00:00.000Z",
      updateDate: "2026-10-04T10:01:00.000Z",
    } } })) });
    const adapter = new ArcCircleProviderAdapter(api);
    const result = await adapter.getStatus("circle-tx-1", "exact-demo-key");
    expect(result).toMatchObject({
      status: "CONFIRMED", transaction_id: "circle-tx-1", transaction_state: "COMPLETE",
      destination_address: J2A_DEMO_DESTINATION.address, atomic_amount: "5000000",
      wallet_id: J2A_DEMO_SOURCE.id, source_address: J2A_DEMO_SOURCE.address,
      token_id: "native-arc-usdc", network: "ARC-TESTNET", operation: "TRANSFER",
      ref_id: expect.stringMatching(/^j2a-[0-9a-f]{28}$/), tx_hash: "0xabc123",
      explorer_reference: null,
      network_fee: "0.001000", provider_created_at: "2026-10-04T10:00:00.000Z",
      provider_updated_at: "2026-10-04T10:01:00.000Z", reconciled_at: expect.any(String),
      amounts: ["5.000000"],
    });
    expect(result.ref_id).not.toBe("exact-demo-key");
  });

  it.each([
    { walletId: "wrong-wallet" },
    { destinationAddress: "0x0000000000000000000000000000000000000001" },
    { tokenId: "wrong-token" },
    { blockchain: "ETH-SEPOLIA" },
    { refId: "wrong-ref" },
    { id: "different-transaction" },
    { amounts: ["4.000000"] },
    { networkFee: "0.002001" },
    { walletId: undefined },
    { destinationAddress: undefined },
    { tokenId: undefined },
    { blockchain: undefined },
    { refId: undefined },
    { amounts: undefined },
    { networkFee: undefined },
  ])("fails closed for mismatched Circle completion identity %#", async (override) => {
    const api = createClient({ getTransaction: vi.fn(async () => ({ data: { transaction: {
      id: "circle-tx-1", state: "COMPLETE", blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
      sourceAddress: J2A_DEMO_SOURCE.address, destinationAddress: J2A_DEMO_DESTINATION.address,
      amounts: ["5.000000"], tokenId: "native-arc-usdc", operation: "TRANSFER", refId: deriveJ2aCircleRefId("exact-demo-key"), networkFee: "0.001000",
      ...override,
    } } })) });
    const result = await new ArcCircleProviderAdapter(api).getStatus("circle-tx-1", "exact-demo-key");
    expect(result.status).toBe("UNKNOWN");
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it("derives an Arc Testnet explorer reference only from a complete observed transaction hash", async () => {
    const txHash = `0x${"ab".repeat(32)}`;
    const api = createClient({ getTransaction: vi.fn(async () => ({ data: { transaction: {
      id: "circle-tx-1", state: "COMPLETE", blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
      sourceAddress: J2A_DEMO_SOURCE.address, destinationAddress: J2A_DEMO_DESTINATION.address,
      amounts: ["5.000000"], tokenId: "native-arc-usdc", refId: deriveJ2aCircleRefId("exact-demo-key"),
      txHash, networkFee: "0.001000",
    } } })) });
    const result = await new ArcCircleProviderAdapter(api).getStatus("circle-tx-1", "exact-demo-key");
    expect(result.explorer_reference).toBe(`https://explorer.testnet.arc.io/tx/${txHash}`);
  });

  it("does not submit during status-by-idempotency-key reconciliation", async () => {
    const api = createClient({
      listTransactions: vi.fn(async () => ({ data: { transactions: [{ id: "circle-tx-1", refId: deriveJ2aCircleRefId("exact-demo-key") }] } })),
    });
    expect(await new ArcCircleProviderAdapter(api).getStatusByIdempotencyKey("exact-demo-key")).toMatchObject({ status: "PENDING", transaction_id: "circle-tx-1" });
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
        transactionType: "OUTBOUND", blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
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
