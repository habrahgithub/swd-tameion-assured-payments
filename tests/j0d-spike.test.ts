import { describe, expect, it } from "vitest";

import {
  runConnectivitySpike,
  J0ConnectivitySpikeNotConfiguredError,
  J0ConnectivitySpikeError,
  type CircleSpikeClient,
} from "../src/j0d-spike/connectivity-spike";

describe("J0-D connectivity spike (isolated infrastructure harness)", () => {
  it("fails closed rather than fabricating a transaction when no provider credentials are configured", async () => {
    const originalCircle = process.env.CIRCLE_API_KEY;
    const originalEntity = process.env.CIRCLE_ENTITY_SECRET;
    const originalArc = process.env.ARC_API_KEY;
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    delete process.env.ARC_API_KEY;

    try {
      await expect(runConnectivitySpike()).rejects.toThrow(J0ConnectivitySpikeNotConfiguredError);
    } finally {
      if (originalCircle) process.env.CIRCLE_API_KEY = originalCircle;
      if (originalEntity) process.env.CIRCLE_ENTITY_SECRET = originalEntity;
      if (originalArc) process.env.ARC_API_KEY = originalArc;
    }
  });
});

/**
 * Orchestration tests against a fake CircleSpikeClient. This build
 * environment cannot reach api.circle.com or rpc.testnet.arc.io (see
 * README "Prototype status"), so these tests are the only verification
 * this orchestration logic has received — they exercise every branch
 * (funding timeout, transaction timeout/UNKNOWN, terminal FAILED, and the
 * happy COMPLETE path) using a scriptable fake, with poll intervals turned
 * down so the suite stays fast.
 */
function makeFakeClient(overrides: Partial<CircleSpikeClient> = {}): CircleSpikeClient {
  return {
    createWalletSet: async () => ({ data: { walletSet: { id: "ws-1" } } }),
    createWallets: async () => ({
      data: { wallets: [{ id: "w-source", address: "0xsource" }, { id: "w-dest", address: "0xdest" }] },
    }),
    requestTestnetTokens: async () => undefined,
    getWalletTokenBalance: async () => ({
      data: { tokenBalances: [{ amount: "10", token: { id: "usdc-token-id", symbol: "USDC" } }] },
    }),
    createTransaction: async () => ({ data: { id: "tx-1" } }),
    getTransaction: async () => ({ data: { transaction: { state: "COMPLETE", txHash: "0xhash" } } }),
    ...overrides,
  };
}

describe("J0-D connectivity spike orchestration (fake client — no live network in this build)", () => {
  it("happy path: returns COMPLETE with full evidence", async () => {
    const result = await runConnectivitySpike({ client: makeFakeClient(), pollIntervalMs: 1 });
    expect(result.status).toBe("COMPLETE");
    expect(result.dispatch_profile).toBe("J0_CONNECTIVITY_SPIKE");
    expect(result.classification).toBe("INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION");
    expect(result.amount).toBe("0.01");
    expect(result.source_wallet_id).toBe("w-source");
    expect(result.destination_wallet_id).toBe("w-dest");
    expect(result.provider_tx_hash).toBe("0xhash");
  });

  it("fails closed at CREATE_WALLET_SET on provider error, without attempting later steps", async () => {
    let walletsCalled = false;
    const client = makeFakeClient({
      createWalletSet: async () => {
        throw new Error("simulated Circle 500");
      },
      createWallets: async () => {
        walletsCalled = true;
        return { data: { wallets: [] } };
      },
    });
    await expect(runConnectivitySpike({ client, pollIntervalMs: 1 })).rejects.toMatchObject({
      stage: "CREATE_WALLET_SET",
    });
    expect(walletsCalled).toBe(false);
  });

  it("fails closed at FAUCET_TIMEOUT rather than attempting a transfer with no funds", async () => {
    let transactionCalled = false;
    const client = makeFakeClient({
      getWalletTokenBalance: async () => ({ data: { tokenBalances: [] } }), // never funded
      createTransaction: async () => {
        transactionCalled = true;
        return { data: { id: "tx-1" } };
      },
    });
    await expect(
      runConnectivitySpike({ client, pollIntervalMs: 1, balanceTimeoutMs: 5 }),
    ).rejects.toBeInstanceOf(J0ConnectivitySpikeError);
    expect(transactionCalled).toBe(false);
  });

  it("returns UNKNOWN (never blind-retries) when the transaction never reaches a terminal state within the timeout", async () => {
    const client = makeFakeClient({
      getTransaction: async () => ({ data: { transaction: { state: "SENT" } } }), // stuck non-terminal
    });
    const result = await runConnectivitySpike({ client, pollIntervalMs: 1, transactionTimeoutMs: 5 });
    expect(result.status).toBe("UNKNOWN");
    expect(result.provider_state).toBeNull();
  });

  it("returns FAILED (a real terminal failure, distinct from UNKNOWN) when the provider denies the transaction", async () => {
    const client = makeFakeClient({
      getTransaction: async () => ({ data: { transaction: { state: "DENIED" } } }),
    });
    const result = await runConnectivitySpike({ client, pollIntervalMs: 1 });
    expect(result.status).toBe("FAILED");
    expect(result.provider_state).toBe("DENIED");
  });

  it("propagates a clear stage on faucet request failure without creating a transaction", async () => {
    let transactionCalled = false;
    const client = makeFakeClient({
      requestTestnetTokens: async () => {
        throw new Error("simulated faucet rate limit");
      },
      createTransaction: async () => {
        transactionCalled = true;
        return { data: { id: "tx-1" } };
      },
    });
    await expect(runConnectivitySpike({ client, pollIntervalMs: 1 })).rejects.toMatchObject({
      stage: "FAUCET_REQUEST",
    });
    expect(transactionCalled).toBe(false);
  });
});
