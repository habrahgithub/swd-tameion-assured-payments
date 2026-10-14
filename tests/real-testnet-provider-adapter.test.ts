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
  const api: J2aCircleClient = {
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
    listTransactions: vi.fn(async () => ({ data: { transactions: [], pagination: { nextPageAfter: null } } })),
    getTransaction: vi.fn(async () => ({ data: { transaction: {
      id: "circle-tx-1", state: "INITIATED", blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
      destinationAddress: J2A_DEMO_DESTINATION.address, amounts: ["5.000000"], tokenId: "native-arc-usdc",
      refId: deriveJ2aCircleRefId("exact-demo-key"),
    } } })),
    createTransaction: vi.fn(async () => ({ data: { id: "circle-tx-1", state: "INITIATED" } })),
    ...overrides,
  };
  const balanceReader = api.getWalletTokenBalance;
  api.getWalletTokenBalance = vi.fn(async input => {
    const response = await balanceReader(input);
    if (!response || typeof response !== "object" || !("data" in response) || !response.data || typeof response.data !== "object") return response;
    const data = response.data as Record<string, unknown>;
    return { ...response, data: { ...data, pagination: data.pagination ?? { nextPageAfter: null } } };
  });
  return api;
}

async function statusAdapter(api: J2aCircleClient) {
  const authorized = await runJ2aReadOnlyPreflight(api);
  if (authorized.readiness !== "READY") throw new Error("expected ready status identity");
  return new ArcCircleProviderAdapter(api, () => authorized);
}

describe("Arc Circle provider adapter for J2A", () => {
  it("stops transaction pagination as soon as requester revalidation fails", async () => {
    const api = createClient();
    const adapter = await statusAdapter(api);
    api.listTransactions = vi.fn(async () => ({
      data: { transactions: [], pagination: { nextPageAfter: "transactions-page-2" } },
    }));
    let revalidations = 0;

    await expect(adapter.getStatusByIdempotencyKey("exact-demo-key", async () => {
      revalidations += 1;
      if (revalidations === 2) throw new Error("requester revoked");
    })).resolves.toMatchObject({ status: "UNKNOWN" });

    expect(revalidations).toBe(2);
    expect(api.listTransactions).toHaveBeenCalledOnce();
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it("does not reconcile a transaction until every Circle balance page is read", async () => {
    const api = createClient();
    const adapter = await statusAdapter(api);
    api.getWalletTokenBalance = vi.fn()
      .mockResolvedValueOnce({ data: { tokenBalances: [], pagination: { nextPageAfter: "reconcile-page-2" } } })
      .mockResolvedValueOnce({ data: { tokenBalances: [{ amount: "10.000000", token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: true } }], pagination: { nextPageAfter: null } } });
    const result = await adapter.getStatus("circle-tx-1", "exact-demo-key");
    expect(result.status).toBe("PENDING");
    expect(api.getWalletTokenBalance).toHaveBeenNthCalledWith(1, { id: J2A_DEMO_SOURCE.id, includeAll: true, pageSize: 50 });
    expect(api.getWalletTokenBalance).toHaveBeenNthCalledWith(2, { id: J2A_DEMO_SOURCE.id, includeAll: true, pageSize: 50, pageAfter: "reconcile-page-2" });
  });

  it("keeps reconciliation unknown when the terminal balance cursor is missing", async () => {
    const api = createClient();
    const adapter = await statusAdapter(api);
    api.getWalletTokenBalance = vi.fn(async () => ({
      data: { tokenBalances: [{ amount: "10.000000", token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: true } }], pagination: {} },
    }));

    await expect(adapter.getStatus("circle-tx-1", "exact-demo-key"))
      .resolves.toMatchObject({ status: "UNKNOWN" });
    expect(api.getTransaction).not.toHaveBeenCalled();
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it.each(["STUCK", "INITIATED", "PENDING_RISK_SCREENING", "QUEUED", "SENT", "CONFIRMED"])("keeps intermediate provider state %s pending without resubmission", async state => {
    const api = createClient({ getTransaction: vi.fn(async () => ({ data: { transaction: {
      id: "circle-tx-1", state, blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
      destinationAddress: J2A_DEMO_DESTINATION.address, amounts: ["5.000000"], tokenId: "native-arc-usdc",
      refId: deriveJ2aCircleRefId("exact-demo-key"),
    } } })) });
    const result = await (await statusAdapter(api)).getStatus("circle-tx-1", "exact-demo-key");
    expect(result).toMatchObject({ status: "PENDING", transaction_state: state });
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it.each(["FAILED", "DENIED", "CANCELLED"])("retains exact-identity terminal failure %s", async state => {
    const api = createClient({ getTransaction: vi.fn(async () => ({ data: { transaction: {
      id: "circle-tx-1", state, blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
      destinationAddress: J2A_DEMO_DESTINATION.address, amounts: ["5.000000"], tokenId: "native-arc-usdc",
      refId: deriveJ2aCircleRefId("exact-demo-key"),
    } } })) });
    expect(await (await statusAdapter(api)).getStatus("circle-tx-1", "exact-demo-key")).toMatchObject({ status: "FAILED", transaction_state: state });
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it("does not accept intermediate state evidence for a different transaction identity", async () => {
    const api = createClient({ getTransaction: vi.fn(async () => ({ data: { transaction: {
      id: "different-transaction", state: "STUCK", blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
      destinationAddress: J2A_DEMO_DESTINATION.address, amounts: ["5.000000"], tokenId: "native-arc-usdc",
      refId: deriveJ2aCircleRefId("exact-demo-key"),
    } } })) });
    expect((await (await statusAdapter(api)).getStatus("circle-tx-1", "exact-demo-key")).status).toBe("UNKNOWN");
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it("accepts a valid EIP-55 representation of the exact destination and preserves the raw provider evidence", async () => {
    const checksummedDestination = "0x591A1002127b1605d9DbB51348787bbE3014b2b9";
    const api = createClient({ getTransaction: vi.fn(async () => ({ data: { transaction: {
      id: "circle-tx-1", state: "COMPLETE", blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
      destinationAddress: checksummedDestination, amounts: ["5.000000"], tokenId: "native-arc-usdc",
      refId: deriveJ2aCircleRefId("exact-demo-key"), networkFee: "0.001000",
    } } })) });

    const result = await (await statusAdapter(api)).getStatus("circle-tx-1", "exact-demo-key");

    expect(result.status).toBe("CONFIRMED");
    expect(result.destination_address).toBe(checksummedDestination);
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it.each([
    "0x591a1002127b1605d9dbb51348787bbe3014b2b8", // wrong address bytes
    "0x591a1002127b1605d9dbb51348787bbe3014b2b", // short
    "0x591a1002127b1605d9dbb51348787bbe3014b2b900", // long
    "0x591a1002127b1605d9dbb51348787bbe3014b2bg", // nonhex
    "591a1002127b1605d9dbb51348787bbe3014b2b9", // missing prefix
    " 0x591a1002127b1605d9dbb51348787bbe3014b2b9", // whitespace
    "0x591a1002127b1605d9DbB51348787bbE3014b2b9", // invalid EIP-55 checksum (A should be uppercase)
  ])("keeps a malformed or nonmatching destination UNKNOWN without creating another transaction: %s", async (destinationAddress) => {
    const api = createClient({ getTransaction: vi.fn(async () => ({ data: { transaction: {
      id: "circle-tx-1", state: "COMPLETE", blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
      destinationAddress, amounts: ["5.000000"], tokenId: "native-arc-usdc",
      refId: deriveJ2aCircleRefId("exact-demo-key"), networkFee: "0.001000",
    } } })) });

    const result = await (await statusAdapter(api)).getStatus("circle-tx-1", "exact-demo-key");

    expect(result.status).toBe("UNKNOWN");
    expect(result.destination_address).toBe(destinationAddress);
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

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
      beforeProviderSend: async () => {},
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

  it("submits the fixed six-place amount against the reviewed provider-reported 18-decimal token", async () => {
    const api = createClient({
      getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
        amount: "19.989211477825042",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 18, isNative: true },
      }] } })),
      estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.0011679675" } } })),
    });
    const authorized = await runJ2aReadOnlyPreflight(api);
    expect(authorized).toMatchObject({ readiness: "READY", provider_token: { decimals: 18 } });
    const adapter = new ArcCircleProviderAdapter(api, () => authorized);

    await adapter.submitTransfer({
      idempotencyKey: "idem-ORG-TAMEION-TESTNET-DEMO-DEMO-ARC-TESTNET-001-2",
      sourceWalletRef: J2A_DEMO_SOURCE.id,
      destinationAddress: J2A_DEMO_DESTINATION.address,
      atomicAmount: "5000000",
      asset: "USDC",
      network: "ARC_TESTNET",
      beforeProviderSend: async () => {},
    });

    expect(vi.mocked(api.createTransaction).mock.calls[0]?.[0]).toMatchObject({
      amount: ["5.000000"],
      tokenId: "native-arc-usdc",
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
    });
  });

  it("blocks pre-submit when provider-reported precision changes after the reviewed preflight", async () => {
    const authorizedApi = createClient({
      getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
        amount: "19.989211477825042",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 18, isNative: true },
      }] } })),
      estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.0011679675" } } })),
    });
    const authorized = await runJ2aReadOnlyPreflight(authorizedApi);
    expect(authorized.readiness).toBe("READY");
    const changedPrecisionApi = createClient();

    await expect(new ArcCircleProviderAdapter(changedPrecisionApi, () => authorized).submitTransfer({
      idempotencyKey: "exact-demo-key",
      sourceWalletRef: J2A_DEMO_SOURCE.id,
      destinationAddress: J2A_DEMO_DESTINATION.address,
      atomicAmount: "5000000",
      asset: "USDC",
      network: "ARC_TESTNET",
      beforeProviderSend: async () => {},
    })).rejects.toThrow();
    expect(changedPrecisionApi.createTransaction).not.toHaveBeenCalled();
  });

  it("keeps reconciliation UNKNOWN when current provider precision differs from the reviewed preflight", async () => {
    const authorizedApi = createClient({
      getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
        amount: "19.989211477825042",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 18, isNative: true },
      }] } })),
      estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: "0.0011679675" } } })),
    });
    const authorized = await runJ2aReadOnlyPreflight(authorizedApi);
    expect(authorized.readiness).toBe("READY");
    const changedPrecisionApi = createClient();
    const adapter = new ArcCircleProviderAdapter(changedPrecisionApi, () => authorized);

    expect(await adapter.getStatus("circle-tx-1", "exact-demo-key")).toEqual({ status: "UNKNOWN" });
    expect(changedPrecisionApi.getTransaction).not.toHaveBeenCalled();
    expect(changedPrecisionApi.createTransaction).not.toHaveBeenCalled();
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
      beforeProviderSend: async () => {},
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
        beforeProviderSend: async () => {},
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
      beforeProviderSend: async () => {},
    })).rejects.toThrow();
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it("rejects source, destination, network, asset and amount substitutions before provider submission", async () => {
    const authorizedApi = createClient();
    const authorized = await runJ2aReadOnlyPreflight(authorizedApi);
    expect(authorized.readiness).toBe("READY");
    const invalid = [
      { sourceWalletRef: "other-wallet" },
      { destinationAddress: "0x0000000000000000000000000000000000000001" },
      { network: "ETH-SEPOLIA" as "ARC_TESTNET" },
      { asset: "ETH" as "USDC" },
      { atomicAmount: "5000001" },
    ];
    for (const override of invalid) {
      const api = createClient();
      const adapter = new ArcCircleProviderAdapter(api, () => authorized);
      await expect(adapter.submitTransfer({
        idempotencyKey: "stable-key",
        sourceWalletRef: J2A_DEMO_SOURCE.id,
        destinationAddress: J2A_DEMO_DESTINATION.address,
        atomicAmount: "5000000",
        asset: "USDC",
        network: "ARC_TESTNET",
        ...override,
        beforeProviderSend: async () => {},
      })).rejects.toThrow();
      expect(api.createTransaction).not.toHaveBeenCalled();
    }
  });

  it("keeps in-flight Circle state pending and reconciles with one read-only transaction lookup", async () => {
    const api = createClient();
    const adapter = await statusAdapter(api);
    expect(await adapter.getStatus("circle-tx-1", "exact-demo-key")).toMatchObject({ status: "PENDING", transaction_id: "circle-tx-1" });
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
    const adapter = await statusAdapter(api);
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

  it("reconciles provider-normalized 18-decimal amount and fee to the six-decimal Tameion intent", async () => {
    const api = createClient({
      getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: [{
        amount: "19.989211477825042",
        token: { id: "native-arc-usdc", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 18, isNative: true },
      }] } })),
      getTransaction: vi.fn(async () => ({ data: { transaction: {
        id: "circle-tx-1", state: "COMPLETE", blockchain: "ARC-TESTNET", walletId: J2A_DEMO_SOURCE.id,
        destinationAddress: J2A_DEMO_DESTINATION.address, amounts: ["5.000000000000000000"], tokenId: "native-arc-usdc",
        sourceAddress: J2A_DEMO_SOURCE.address, operation: "TRANSFER", refId: deriveJ2aCircleRefId("exact-demo-key"),
        txHash: "0xabc123", networkFee: "0.0011679675", createDate: "2026-10-04T10:00:00.000Z",
        updateDate: "2026-10-04T10:01:00.000Z",
      } } })),
    });

    const result = await (await statusAdapter(api)).getStatus("circle-tx-1", "exact-demo-key");

    expect(result).toMatchObject({
      status: "CONFIRMED",
      atomic_amount: "5000000",
      provider_atomic_amount: "5000000000000000000",
      provider_token_decimals: 18,
      amounts: ["5.000000000000000000"],
      network_fee: "0.0011679675",
    });
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
    const result = await (await statusAdapter(api)).getStatus("circle-tx-1", "exact-demo-key");
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
    const result = await (await statusAdapter(api)).getStatus("circle-tx-1", "exact-demo-key");
    expect(result.explorer_reference).toBe(`https://explorer.testnet.arc.io/tx/${txHash}`);
  });

  it("does not submit during status-by-idempotency-key reconciliation", async () => {
    const api = createClient({
      listTransactions: vi.fn(async () => ({ data: { transactions: [{ id: "circle-tx-1", refId: deriveJ2aCircleRefId("exact-demo-key") }], pagination: { nextPageAfter: null } } })),
    });
    const adapter = await statusAdapter(api);
    vi.mocked(api.listTransactions).mockClear();
    expect(await adapter.getStatusByIdempotencyKey("exact-demo-key")).toMatchObject({ status: "PENDING", transaction_id: "circle-tx-1" });
    expect(api.createTransaction).not.toHaveBeenCalled();
    expect(api.listTransactions).toHaveBeenCalledTimes(1);
    expect(api.listTransactions).toHaveBeenCalledWith({
      txType: "OUTBOUND", walletIds: [J2A_DEMO_SOURCE.id], pageSize: 50, order: "DESC",
    });
    expect(api.getTransaction).toHaveBeenCalledTimes(1);
  });

  it("finds an idempotency match beyond the first Circle transaction page", async () => {
    const api = createClient();
    const adapter = await statusAdapter(api);
    vi.mocked(api.listTransactions).mockClear()
      .mockResolvedValueOnce({ data: { transactions: [{ id: "other-tx", refId: "unrelated" }], pagination: { nextPageAfter: "transaction-page-2" } } })
      .mockResolvedValueOnce({ data: { transactions: [{ id: "circle-tx-1", refId: deriveJ2aCircleRefId("exact-demo-key") }], pagination: { nextPageAfter: null } } });

    await expect(adapter.getStatusByIdempotencyKey("exact-demo-key"))
      .resolves.toMatchObject({ status: "PENDING", transaction_id: "circle-tx-1" });
    expect(api.listTransactions).toHaveBeenNthCalledWith(1, { txType: "OUTBOUND", walletIds: [J2A_DEMO_SOURCE.id], pageSize: 50, order: "DESC" });
    expect(api.listTransactions).toHaveBeenNthCalledWith(2, { txType: "OUTBOUND", walletIds: [J2A_DEMO_SOURCE.id], pageSize: 50, order: "DESC", pageAfter: "transaction-page-2" });
    expect(api.createTransaction).not.toHaveBeenCalled();
  });

  it("keeps idempotency reconciliation UNKNOWN when transaction-list completeness is missing", async () => {
    const api = createClient();
    const adapter = await statusAdapter(api);
    vi.mocked(api.listTransactions).mockClear().mockResolvedValueOnce({
      data: { transactions: [{ id: "circle-tx-1", refId: deriveJ2aCircleRefId("exact-demo-key") }], pagination: {} },
    });

    await expect(adapter.getStatusByIdempotencyKey("exact-demo-key")).resolves.toMatchObject({ status: "UNKNOWN" });
    expect(api.getTransaction).not.toHaveBeenCalled();
    expect(api.createTransaction).not.toHaveBeenCalled();
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
      beforeProviderSend: async () => {},
      })).rejects.toThrow();
      expect(api.createTransaction).not.toHaveBeenCalled();
    }
  });
});
