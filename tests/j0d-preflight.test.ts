import { afterEach, describe, expect, it, vi } from "vitest";

import { createCircleArcReadOnlyClient } from "../src/j0d-spike/circle-arc-client";
import type { J0dPreflightClient } from "../src/j0d-spike/preflight";
import { runJ0dPreflight } from "../src/j0d-spike/preflight";

const context = {
  walletSetId: "2b72f116-16da-591a-9212-5382388a35c4",
  sourceWallet: {
    id: "9fe9c001-a044-5f9a-8997-165474887952",
    address: "0x8a5ec63c8bc7a4d4b4f0134e034bda4c24043e95",
  },
  destinationWallet: {
    id: "01769e53-cfbe-57aa-ba88-c787b8cba2d3",
    address: "0x591a1002127b1605d9dbb51348787bbe3014b2b9",
  },
};

const fixedNow = () => new Date("2026-09-29T06:10:00.000Z");

function arcUsdcToken(overrides: Record<string, unknown> = {}) {
  return {
    id: "USDC-ARC-TESTNET",
    symbol: "USDC",
    blockchain: "ARC-TESTNET",
    decimals: 18,
    isNative: true,
    tokenAddress: undefined,
    ...overrides,
  };
}

function fakeClient(options: {
  balance?: string;
  fee?: string;
  token?: Record<string, unknown>;
  tokenBalances?: Array<{ amount?: string; token?: Record<string, unknown> }>;
} = {}) {
  const source = {
    id: context.sourceWallet.id,
    address: context.sourceWallet.address,
    blockchain: "ARC-TESTNET",
    walletSetId: context.walletSetId,
    state: "LIVE",
  };
  const destination = {
    id: context.destinationWallet.id,
    address: context.destinationWallet.address,
    blockchain: "ARC-TESTNET",
    walletSetId: context.walletSetId,
    state: "LIVE",
  };
  const tokenBalances = options.tokenBalances ?? [{
    amount: options.balance ?? "20.000000000000000000",
    token: arcUsdcToken(options.token),
  }];
  const prohibited = {
    createWallets: vi.fn(() => Promise.reject(new Error("must never be called"))),
    requestTestnetTokens: vi.fn(() => Promise.reject(new Error("must never be called"))),
    createTransaction: vi.fn(() => Promise.reject(new Error("must never be called"))),
  };
  const client = {
    getWallet: vi.fn(async ({ id }: { id: string }) => ({
      data: { wallet: id === source.id ? source : destination },
    })),
    getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances } })),
    estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: options.fee ?? "0.001000000000000000" } } })),
    ...prohibited,
  };
  return { client, prohibited, source, destination };
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("J0-D read-only recovered-wallet preflight", () => {
  it("returns the exact 0.01 USDC Arc Testnet intent only when balance covers transfer plus MEDIUM fee", async () => {
    const { client, prohibited } = fakeClient({ balance: "0.011000000000000000", fee: "0.001000000000000000" });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });

    expect(result.readiness).toBe("READY_FOR_EXPLICIT_AUTHORIZATION");
    if (result.readiness !== "READY_FOR_EXPLICIT_AUTHORIZATION") throw new Error("unexpected readiness");
    expect(result.exact_intent).toMatchObject({
      network: "ARC-TESTNET",
      asset: "USDC",
      amount: "0.01",
      fee_level: "MEDIUM",
      estimated_network_fee: "0.001000000000000000",
      minimum_required_total: "0.011000000000000000",
      source_wallet_id: context.sourceWallet.id,
      destination_wallet_id: context.destinationWallet.id,
      provider_token: { id: "USDC-ARC-TESTNET", decimals: 18, is_native: true },
    });
    expect(client.estimateTransferFee).toHaveBeenCalledWith({
      walletId: context.sourceWallet.id,
      tokenId: "USDC-ARC-TESTNET",
      amount: ["0.01"],
      destinationAddress: context.destinationWallet.address,
    });
    expect(prohibited.createWallets).not.toHaveBeenCalled();
    expect(prohibited.requestTestnetTokens).not.toHaveBeenCalled();
    expect(prohibited.createTransaction).not.toHaveBeenCalled();
  });

  it("does not call exactly 0.01 USDC ready when Arc gas still needs native USDC", async () => {
    const { client } = fakeClient({ balance: "0.010000000000000000", fee: "0.001000000000000000" });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("FUNDING_REQUIRED");
    if (result.readiness !== "FUNDING_REQUIRED") throw new Error("unexpected readiness");
    expect(result.estimated_network_fee).toBe("0.001000000000000000");
    expect(result.minimum_required_total).toBe("0.011000000000000000");
  });

  it("uses the token-reported decimal scale rather than assuming six decimals", async () => {
    const { client } = fakeClient({ balance: "0.011000000000000000", fee: "0.001000000000000000", token: { decimals: 18 } });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("READY_FOR_EXPLICIT_AUTHORIZATION");
  });

  it("pins native ARC-TESTNET USDC even when another USDC entry appears first", async () => {
    const { client } = fakeClient({
      tokenBalances: [
        { amount: "999", token: arcUsdcToken({ id: "BRIDGED", blockchain: "ETH-SEPOLIA", isNative: false, decimals: 6 }) },
        { amount: "0.011000000000000000", token: arcUsdcToken() },
      ],
    });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("READY_FOR_EXPLICIT_AUTHORIZATION");
    if (result.readiness !== "READY_FOR_EXPLICIT_AUTHORIZATION") throw new Error("unexpected readiness");
    expect(result.source_usdc_token.id).toBe("USDC-ARC-TESTNET");
  });

  it("returns FUNDING_REQUIRED without estimating fees when no USDC balance entry exists", async () => {
    const { client, prohibited } = fakeClient({ tokenBalances: [] });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("FUNDING_REQUIRED");
    if (result.readiness !== "FUNDING_REQUIRED") throw new Error("unexpected readiness");
    expect(result.source_usdc_balance).toBe("0");
    expect(result.source_usdc_token).toBeNull();
    expect(result.estimated_network_fee).toBeNull();
    expect(client.estimateTransferFee).not.toHaveBeenCalled();
    expect(prohibited.requestTestnetTokens).not.toHaveBeenCalled();
  });

  it("blocks instead of misclassifying a funded-looking USDC entry with missing token identity", async () => {
    const { client } = fakeClient({
      tokenBalances: [{ amount: "20", token: { symbol: "USDC", blockchain: "ARC-TESTNET", isNative: true, decimals: 18 } }],
    });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_PROVIDER_TOKEN");
  });

  it("blocks when a native Arc token candidate is missing the USDC symbol", async () => {
    const { client } = fakeClient({
      tokenBalances: [{ amount: "20", token: arcUsdcToken({ symbol: undefined }) }],
    });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_PROVIDER_TOKEN");
  });

  it("blocks when the only USDC entry is non-native or on another chain", async () => {
    const { client } = fakeClient({
      tokenBalances: [{ amount: "20", token: arcUsdcToken({ id: "OTHER-USDC", blockchain: "ETH-SEPOLIA", isNative: false, decimals: 6 }) }],
    });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_PROVIDER_TOKEN");
  });

  it("blocks ambiguous duplicate native Arc USDC entries", async () => {
    const { client } = fakeClient({
      tokenBalances: [
        { amount: "20", token: arcUsdcToken({ id: "USDC-ARC-A" }) },
        { amount: "20", token: arcUsdcToken({ id: "USDC-ARC-B" }) },
      ],
    });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_PROVIDER_TOKEN");
  });

  it("blocks oversized provider token metadata instead of throwing", async () => {
    const { client } = fakeClient({ token: { id: "x".repeat(300), tokenAddress: "y".repeat(300) } });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_PROVIDER_TOKEN");
  });

  it("fails closed and sanitizes a transfer-fee estimation error", async () => {
    const { client } = fakeClient();
    client.estimateTransferFee.mockRejectedValueOnce(new Error("SECRET-FEE-DETAIL-" + "x".repeat(2000)));
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("FEE_ESTIMATE_FAILED");
    expect(result.message).not.toContain("SECRET-FEE-DETAIL");
  });

  it("fails closed when Circle returns no MEDIUM network fee", async () => {
    const { client } = fakeClient();
    client.estimateTransferFee.mockResolvedValueOnce({ data: {} } as never);
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_FEE_ESTIMATE");
  });

  it("fails closed when the fee has more precision than the pinned token", async () => {
    const { client } = fakeClient({ token: { decimals: 6 }, balance: "20.000000", fee: "0.0000001" });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_FEE_ESTIMATE");
  });

  it("binds the fee estimate request to the pinned token, source wallet, destination, and exact amount", async () => {
    const { client } = fakeClient();
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("READY_FOR_EXPLICIT_AUTHORIZATION");
    expect(client.estimateTransferFee).toHaveBeenCalledTimes(1);
    expect(client.estimateTransferFee).toHaveBeenCalledWith({
      walletId: context.sourceWallet.id,
      tokenId: "USDC-ARC-TESTNET",
      amount: ["0.01"],
      destinationAddress: context.destinationWallet.address,
    });
  });

  it("blocks an oversized provider balance string instead of throwing during result serialization", async () => {
    const { client } = fakeClient({ balance: "1" + "0".repeat(200) });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_PROVIDER_BALANCE");
  });

  it("blocks an oversized provider fee string instead of throwing during result serialization", async () => {
    const { client } = fakeClient({ balance: "20", fee: "9".repeat(200) });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_FEE_ESTIMATE");
  });

  it("blocks malformed token-balance response shapes instead of treating them as zero", async () => {
    const { client } = fakeClient();
    client.getWalletTokenBalance.mockImplementationOnce(async () => ({ data: { tokenBalances: null } } as never));
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_PROVIDER_BALANCE");
  });

  it("blocks malformed wallet response shapes instead of throwing", async () => {
    const { client } = fakeClient();
    client.getWallet.mockImplementationOnce(async () => ({ data: { wallet: { id: context.sourceWallet.id, address: 123 } } } as never));
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("PROVIDER_QUERY_FAILED");
  });

  it("blocks a native-looking token with missing symbol and blockchain instead of inventing zero balance", async () => {
    const { client } = fakeClient({
      tokenBalances: [{
        amount: "20",
        token: { id: "USDC-ARC-TESTNET", decimals: 18, isNative: true },
      }],
    });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_PROVIDER_TOKEN");
  });

  it("accepts an explicit null tokenAddress for native Arc USDC", async () => {
    const { client } = fakeClient({ token: { tokenAddress: null } });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("READY_FOR_EXPLICIT_AUTHORIZATION");
    if (result.readiness !== "READY_FOR_EXPLICIT_AUTHORIZATION") throw new Error("unexpected readiness");
    expect(result.source_usdc_token.token_address).toBeNull();
  });

  it("rejects a zero MEDIUM network fee as invalid provider truth", async () => {
    const { client } = fakeClient({ fee: "0" });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_FEE_ESTIMATE");
  });

  it("blocks malformed native flags rather than inventing a zero balance", async () => {
    const { client } = fakeClient({
      tokenBalances: [{
        amount: "20",
        token: { id: "USDC-ARC-TESTNET", symbol: "usdc", blockchain: "ARC-TESTNET", decimals: 18, isNative: "true" },
      }],
    });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_PROVIDER_TOKEN");
  });

  it("accepts case/whitespace-normalized USDC symbol only when native flag is a real boolean true", async () => {
    const { client } = fakeClient({ token: { symbol: " usdc ", isNative: true } });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("READY_FOR_EXPLICIT_AUTHORIZATION");
    if (result.readiness !== "READY_FOR_EXPLICIT_AUTHORIZATION") throw new Error("unexpected readiness");
    expect(result.source_usdc_token.symbol).toBe("USDC");
  });

  it("rejects a self-transfer context before any provider call", async () => {
    const { client } = fakeClient();
    await expect(runJ0dPreflight({
      ...context,
      destinationWallet: { ...context.sourceWallet },
    }, { client: client as J0dPreflightClient, now: fixedNow })).rejects.toThrow();
    expect(client.getWallet).not.toHaveBeenCalled();
  });

  it("fails closed when the source wallet differs from recovered context", async () => {
    const { client } = fakeClient();
    client.getWallet.mockImplementationOnce(async () => ({
      data: { wallet: { id: context.sourceWallet.id, address: "0x1111111111111111111111111111111111111111", blockchain: "ARC-TESTNET", walletSetId: context.walletSetId, state: "LIVE" } },
    }));
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("SOURCE_WALLET_CONTEXT_MISMATCH");
  });

  it("fails closed when the destination wallet differs from recovered context", async () => {
    const { client, source } = fakeClient();
    client.getWallet.mockImplementation(async ({ id }: { id: string }) => ({
      data: { wallet: id === source.id ? source : { id, address: "0x2222222222222222222222222222222222222222", blockchain: "ARC-TESTNET", walletSetId: context.walletSetId, state: "LIVE" } },
    }));
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("DESTINATION_WALLET_CONTEXT_MISMATCH");
  });

  it("fails closed when a recovered wallet is not LIVE", async () => {
    const { client, destination } = fakeClient();
    client.getWallet.mockImplementationOnce(async () => ({
      data: { wallet: { ...destination, id: context.sourceWallet.id, address: context.sourceWallet.address, state: "FROZEN" } },
    }));
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("SOURCE_WALLET_NOT_LIVE");
    expect(result.message).toBe("Circle wallet is not LIVE.");
    expect(result.message).not.toContain("FROZEN");
  });

  it("fails closed and does not echo a raw provider error", async () => {
    const { client } = fakeClient();
    client.getWallet.mockRejectedValueOnce(new Error("SECRET-LIKE-DETAIL-" + "x".repeat(2000)));
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("PROVIDER_QUERY_FAILED");
    expect(result.message).not.toContain("SECRET-LIKE-DETAIL");
    expect(result.message.length).toBeLessThanOrEqual(500);
  });

  it("fails closed on a provider balance that exceeds the token's declared decimal precision", async () => {
    const { client } = fakeClient({ balance: "0.0000001", token: { decimals: 6 } });
    const result = await runJ0dPreflight(context, { client: client as J0dPreflightClient, now: fixedNow });
    expect(result.readiness).toBe("BLOCKED_EXTERNAL");
    if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
    expect(result.blocker).toBe("INVALID_PROVIDER_BALANCE");
  });

  it("fails closed without Circle credentials and does not fabricate provider truth", async () => {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    try {
      const result = await runJ0dPreflight(context, { now: fixedNow });
      expect(result.readiness).toBe("BLOCKED_EXTERNAL");
      if (result.readiness !== "BLOCKED_EXTERNAL") throw new Error("unexpected readiness");
      expect(result.blocker).toBe("CIRCLE_NOT_CONFIGURED");
      expect("source_usdc_balance" in result).toBe(false);
    } finally {
      restoreEnv("CIRCLE_API_KEY", apiKey);
      restoreEnv("CIRCLE_ENTITY_SECRET", entitySecret);
    }
  });

  it("the live capability wrapper exposes only three read-only provider operations", () => {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    process.env.CIRCLE_API_KEY = "TEST-ONLY-API-KEY";
    process.env.CIRCLE_ENTITY_SECRET = "00".repeat(32);
    try {
      const client = createCircleArcReadOnlyClient();
      expect(Object.keys(client).sort()).toEqual(["estimateTransferFee", "getWallet", "getWalletTokenBalance"]);
      expect("createTransaction" in client).toBe(false);
      expect("requestTestnetTokens" in client).toBe(false);
      expect("createWallets" in client).toBe(false);
    } finally {
      restoreEnv("CIRCLE_API_KEY", apiKey);
      restoreEnv("CIRCLE_ENTITY_SECRET", entitySecret);
    }
  });
});
