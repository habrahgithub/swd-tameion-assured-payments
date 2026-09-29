import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createCircleArcSpikeExecutionClient } from "../src/j0d-spike/circle-arc-client";
import {
  runConnectivitySpike,
  assertJ0dProviderConfigured,
  J0ConnectivitySpikeNotConfiguredError,
  J0ConnectivitySpikeError,
  type J0dSpikeExecutionClient,
  type J0dStageEvidence,
} from "../src/j0d-spike/connectivity-spike";
import { computeJ0dExecutionIdentity, computeJ0dIntentFingerprint, j0dIdempotencyKeyForExecutionIdentity, type J0dExactIntent } from "../src/j0d-spike/intent";
import { runJ0dPreflight } from "../src/j0d-spike/preflight";

const resumeFrom = {
  walletSetId: "2b72f116-16da-591a-9212-5382388a35c4",
  sourceWallet: { id: "9fe9c001-a044-5f9a-8997-165474887952", address: "0x8a5ec63c8bc7a4d4b4f0134e034bda4c24043e95" },
  destinationWallet: { id: "01769e53-cfbe-57aa-ba88-c787b8cba2d3", address: "0x591a1002127b1605d9dbb51348787bbe3014b2b9" },
};
const fixedNow = () => new Date("2026-09-29T07:00:00.000Z");
const RAW_PROVIDER_SECRET = "RAW-PROVIDER-BODY api_key=sk_live_do_not_echo";

interface Truth {
  source?: Record<string, unknown>;
  destination?: Record<string, unknown>;
  tokenBalances?: unknown[];
  balance?: string;
  token?: Record<string, unknown>;
  fee?: string;
  transactions?: unknown[];
  finalState?: string;
}

function makeClient(truth: Truth = {}, overrides: Partial<Record<string, unknown>> = {}) {
  const source = { id: resumeFrom.sourceWallet.id, address: resumeFrom.sourceWallet.address, blockchain: "ARC-TESTNET", walletSetId: resumeFrom.walletSetId, state: "LIVE", ...truth.source };
  const destination = { id: resumeFrom.destinationWallet.id, address: resumeFrom.destinationWallet.address, blockchain: "ARC-TESTNET", walletSetId: resumeFrom.walletSetId, state: "LIVE", ...truth.destination };
  const tokenBalances = truth.tokenBalances ?? [{
    amount: truth.balance ?? "20.000000000000000000",
    token: { id: "USDC-ARC-TESTNET", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 18, isNative: true, ...truth.token },
  }];
  const prohibited = {
    createWalletSet: vi.fn(() => Promise.reject(new Error("prohibited"))),
    createWallets: vi.fn(() => Promise.reject(new Error("prohibited"))),
    requestTestnetTokens: vi.fn(() => Promise.reject(new Error("prohibited"))),
  };
  const client = {
    getWallet: vi.fn(async ({ id }: { id: string }) => ({ data: { wallet: id === source.id ? source : destination } })),
    getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances } })),
    estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: truth.fee ?? "0.001000000000000000" } } })),
    listTransactions: vi.fn(async () => ({ data: { transactions: truth.transactions ?? [] } })),
    createTransaction: vi.fn(async () => ({ data: { id: "tx-1", state: "INITIATED" } })),
    getTransaction: vi.fn(async () => ({ data: { transaction: { state: truth.finalState ?? "COMPLETE", txHash: "0xhash" } } })),
    ...prohibited,
    ...overrides,
  };
  return { client, prohibited };
}

/** Obtain the approved intent + fingerprint from the real read-only preflight over the same truth. */
async function approved(truth: Truth = {}): Promise<{ approvedIntent: J0dExactIntent; intentFingerprint: string }> {
  const { client } = makeClient(truth);
  const result = await runJ0dPreflight(resumeFrom, { client, now: () => new Date("2026-09-29T06:55:00.000Z") });
  if (result.readiness !== "READY_FOR_EXPLICIT_AUTHORIZATION") throw new Error(`fixture preflight not READY: ${result.readiness}`);
  return { approvedIntent: result.exact_intent, intentFingerprint: result.intent_fingerprint };
}

async function expectStopped(promise: Promise<unknown>, stage: string) {
  const error = await promise.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(J0ConnectivitySpikeError);
  expect((error as J0ConnectivitySpikeError).stage).toBe(stage);
  return error as J0ConnectivitySpikeError;
}

function expectNothingSubmitted(client: ReturnType<typeof makeClient>["client"], prohibited: ReturnType<typeof makeClient>["prohibited"]) {
  expect(client.createTransaction).not.toHaveBeenCalled();
  expect(prohibited.requestTestnetTokens).not.toHaveBeenCalled();
  expect(prohibited.createWallets).not.toHaveBeenCalled();
  expect(prohibited.createWalletSet).not.toHaveBeenCalled();
}

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("J0-D spike credentials", () => {
  it("fails closed when the Circle credentials actually consumed by J0-D are absent", () => {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    try {
      expect(() => assertJ0dProviderConfigured()).toThrow(J0ConnectivitySpikeNotConfiguredError);
    } finally {
      restoreEnv("CIRCLE_API_KEY", apiKey);
      restoreEnv("CIRCLE_ENTITY_SECRET", entitySecret);
    }
  });

  it("does not require unused ARC_API_KEY when Circle credentials are present", () => {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    const arc = process.env.ARC_API_KEY;
    process.env.CIRCLE_API_KEY = "test-circle-key";
    process.env.CIRCLE_ENTITY_SECRET = "test-entity-secret";
    delete process.env.ARC_API_KEY;
    try {
      expect(() => assertJ0dProviderConfigured()).not.toThrow();
    } finally {
      restoreEnv("CIRCLE_API_KEY", apiKey);
      restoreEnv("CIRCLE_ENTITY_SECRET", entitySecret);
      restoreEnv("ARC_API_KEY", arc);
    }
  });

  it("validates the intent binding before the credential check, and fails closed without credentials", async () => {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    try {
      const binding = await approved();
      await expect(runConnectivitySpike({ resumeFrom, ...binding })).rejects.toBeInstanceOf(J0ConnectivitySpikeNotConfiguredError);
      await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, intentFingerprint: "0".repeat(64) }), "INTENT_FINGERPRINT_MISMATCH");
    } finally {
      restoreEnv("CIRCLE_API_KEY", apiKey);
      restoreEnv("CIRCLE_ENTITY_SECRET", entitySecret);
    }
  });
});

describe("#26 NO APPROVED PREFLIGHT INTENT, NO J0-D TRANSFER", () => {
  it("submits exactly the approved source/token/destination/0.01/MEDIUM once when all provider truth matches", async () => {
    const binding = await approved();
    expect(computeJ0dIntentFingerprint(binding.approvedIntent)).toBe(binding.intentFingerprint);
    const { client, prohibited } = makeClient();
    const order: string[] = [];
    client.createTransaction.mockImplementation(async () => {
      order.push("createTransaction");
      return { data: { id: "tx-1", state: "INITIATED" } };
    });
    const evidence: J0dStageEvidence[] = [];
    const result = await runConnectivitySpike({
      resumeFrom, ...binding, client, pollIntervalMs: 1, now: fixedNow,
      onStageEvidence: (e) => { order.push("evidence"); evidence.push(e); },
    });

    expect(client.createTransaction).toHaveBeenCalledTimes(1);
    expect(client.createTransaction).toHaveBeenCalledWith({
      walletId: resumeFrom.sourceWallet.id,
      tokenId: "USDC-ARC-TESTNET",
      amount: ["0.01"],
      destinationAddress: resumeFrom.destinationWallet.address,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey: j0dIdempotencyKeyForExecutionIdentity(computeJ0dExecutionIdentity(binding.approvedIntent)),
    });
    expect(order).toEqual(["evidence", "createTransaction"]);
    expect(evidence[0]).toMatchObject({ stage: "PRE_SUBMISSION_VERIFIED", intent_fingerprint: binding.intentFingerprint });
    expect(result).toMatchObject({
      status: "COMPLETE",
      classification: "INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION",
      network: "ARC-TESTNET",
      amount: "0.01",
      fee_level: "MEDIUM",
      provider_token_id: "USDC-ARC-TESTNET",
      intent_fingerprint: binding.intentFingerprint,
      execution_identity: computeJ0dExecutionIdentity(binding.approvedIntent),
      idempotency_key: j0dIdempotencyKeyForExecutionIdentity(computeJ0dExecutionIdentity(binding.approvedIntent)),
      provider_transaction_id: "tx-1",
      provider_tx_hash: "0xhash",
    });
    // Provider truth was re-read before submission.
    expect(client.getWallet).toHaveBeenCalledTimes(2);
    expect(client.getWalletTokenBalance).toHaveBeenCalledTimes(1);
    expect(client.estimateTransferFee).toHaveBeenCalledTimes(1);
    expect(client.listTransactions).toHaveBeenCalledWith({
      walletIds: [resumeFrom.sourceWallet.id], txType: "OUTBOUND", pageSize: 1, order: "DESC",
    });
    expect(prohibited.requestTestnetTokens).not.toHaveBeenCalled();
    expect(prohibited.createWallets).not.toHaveBeenCalled();
  });

  it("refuses a missing approved intent before any provider call", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient();
    await expectStopped(
      runConnectivitySpike({ resumeFrom, intentFingerprint: binding.intentFingerprint, client } as unknown as Parameters<typeof runConnectivitySpike>[0]),
      "INVALID_APPROVED_INTENT",
    );
    expect(client.getWallet).not.toHaveBeenCalled();
    expectNothingSubmitted(client, prohibited);
  });

  it("refuses a missing resume context before any provider call (no fresh-wallet path exists)", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient();
    await expectStopped(
      runConnectivitySpike({ ...binding, client } as unknown as Parameters<typeof runConnectivitySpike>[0]),
      "INVALID_RESUME_CONTEXT",
    );
    expect(client.getWallet).not.toHaveBeenCalled();
    expectNothingSubmitted(client, prohibited);
  });

  it("refuses same-wallet source/destination by id or address before any provider call", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient();
    await expectStopped(runConnectivitySpike({ resumeFrom: { ...resumeFrom, destinationWallet: resumeFrom.sourceWallet }, ...binding, client }), "INVALID_RESUME_CONTEXT");
    await expectStopped(runConnectivitySpike({
      resumeFrom: { ...resumeFrom, destinationWallet: { id: resumeFrom.destinationWallet.id, address: resumeFrom.sourceWallet.address.toUpperCase().replace("0X", "0x") } },
      ...binding, client,
    }), "INVALID_RESUME_CONTEXT");
    const selfIntent = { ...binding.approvedIntent, destination_wallet_id: binding.approvedIntent.source_wallet_id };
    await expectStopped(runConnectivitySpike({ resumeFrom, approvedIntent: selfIntent, intentFingerprint: binding.intentFingerprint, client }), "INVALID_APPROVED_INTENT");
    expect(client.getWallet).not.toHaveBeenCalled();
    expectNothingSubmitted(client, prohibited);
  });

  it("refuses a fingerprint that does not match the approved intent, including a tampered intent", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient();
    await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, intentFingerprint: "f".repeat(64), client }), "INTENT_FINGERPRINT_MISMATCH");
    await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, intentFingerprint: "not-a-fingerprint", client }), "INTENT_FINGERPRINT_MISMATCH");
    const tampered = { ...binding.approvedIntent, destination_wallet_address: "0x1111111111111111111111111111111111111111" };
    await expectStopped(runConnectivitySpike({ resumeFrom, approvedIntent: tampered, intentFingerprint: binding.intentFingerprint, client }), "INTENT_FINGERPRINT_MISMATCH");
    expect(client.getWallet).not.toHaveBeenCalled();
    expectNothingSubmitted(client, prohibited);
  });

  it("refuses a resume context that disagrees with the approved intent", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient();
    const otherWallet = { id: "other-dest", address: "0x2222222222222222222222222222222222222222" };
    await expectStopped(runConnectivitySpike({ resumeFrom: { ...resumeFrom, destinationWallet: otherWallet }, ...binding, client }), "RESUME_CONTEXT_INTENT_MISMATCH");
    await expectStopped(runConnectivitySpike({ resumeFrom: { ...resumeFrom, walletSetId: "other-set" }, ...binding, client }), "RESUME_CONTEXT_INTENT_MISMATCH");
    expect(client.getWallet).not.toHaveBeenCalled();
    expectNothingSubmitted(client, prohibited);
  });

  it.each([
    ["source address", { source: { address: "0x3333333333333333333333333333333333333333" } }, "SOURCE_WALLET_CONTEXT_MISMATCH"],
    ["source wallet set", { source: { walletSetId: "moved" } }, "SOURCE_WALLET_CONTEXT_MISMATCH"],
    ["source network", { source: { blockchain: "ETH-SEPOLIA" } }, "SOURCE_WALLET_CONTEXT_MISMATCH"],
    ["destination address", { destination: { address: "0x4444444444444444444444444444444444444444" } }, "DESTINATION_WALLET_CONTEXT_MISMATCH"],
    ["destination wallet set", { destination: { walletSetId: "moved" } }, "DESTINATION_WALLET_CONTEXT_MISMATCH"],
    ["source not LIVE", { source: { state: "FROZEN" } }, "SOURCE_WALLET_NOT_LIVE"],
    ["destination not LIVE", { destination: { state: "FROZEN" } }, "DESTINATION_WALLET_NOT_LIVE"],
  ] as const)("stops before submission when current provider %s differs", async (_label, truth, blocker) => {
    const binding = await approved();
    const { client, prohibited } = makeClient(truth as Truth);
    const error = await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client, pollIntervalMs: 1 }), "PROVIDER_TRUTH_BLOCKED");
    expect(error.details).toEqual({ blocker });
    expectNothingSubmitted(client, prohibited);
  });

  it("stops when native Arc USDC is replaced by wrong-network or non-native USDC", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient({
      tokenBalances: [
        { amount: "20", token: { id: "USDC-ETH", symbol: "USDC", blockchain: "ETH-SEPOLIA", decimals: 6, isNative: false } },
        { amount: "20", token: { id: "USDC-ARC-ERC20", symbol: "USDC", blockchain: "ARC-TESTNET", decimals: 6, isNative: false } },
      ],
    });
    const error = await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client }), "PROVIDER_TRUTH_BLOCKED");
    expect(error.details).toEqual({ blocker: "INVALID_PROVIDER_TOKEN" });
    expectNothingSubmitted(client, prohibited);
  });

  it("stops as STALE_INTENT when the native Arc USDC provider token id changes", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient({ token: { id: "USDC-ARC-TESTNET-V2" } });
    const error = await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client }), "STALE_INTENT");
    expect(error.details.changed_fields).toEqual(["provider_token"]);
    expectNothingSubmitted(client, prohibited);
  });

  it("stops as STALE_INTENT when provider token decimals differ from the approved intent", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient({ balance: "20.000000", fee: "0.001", token: { decimals: 6 } });
    const error = await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client }), "STALE_INTENT");
    expect(error.details.changed_fields).toEqual(expect.arrayContaining(["provider_token"]));
    expectNothingSubmitted(client, prohibited);
  });

  it("stops with FUNDING_REQUIRED and never calls a faucet when balance is below transfer + fee", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient({ balance: "0.010999999999999999" });
    const error = await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client }), "FUNDING_REQUIRED");
    expect(error.details).toMatchObject({ minimum_required_total: "0.011000000000000000", funding_address: resumeFrom.sourceWallet.address });
    expectNothingSubmitted(client, prohibited);
  });

  it("stops with FUNDING_REQUIRED and never calls a faucet when the resumed source wallet has zero balance", async () => {
    const binding = await approved();
    for (const truth of [{ tokenBalances: [] }, { balance: "0" }] as Truth[]) {
      const { client, prohibited } = makeClient(truth);
      await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client }), "FUNDING_REQUIRED");
      expectNothingSubmitted(client, prohibited);
    }
  });

  it.each([
    ["lower than estimate", "0.0005"],
    ["higher than estimate within cap", "0.0015"],
    ["equal to the approved estimate", "0.001000000000000000"],
    ["exactly at fee and total caps", "0.002"],
  ])("submits when the current fee is %s and the total remains within both ceilings", async (_label, fee) => {
    const binding = await approved();
    const { client } = makeClient({ fee });
    const result = await runConnectivitySpike({ resumeFrom, ...binding, client, pollIntervalMs: 1 });
    expect(result.status).toBe("COMPLETE");
    expect(client.createTransaction).toHaveBeenCalledTimes(1);
  });

  it("blocks a current fee above the authorized max_network_fee before submission", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient({ fee: "0.002000000000000001" });
    const error = await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client }), "AUTHORIZATION_CEILING_EXCEEDED");
    expect(error.details.current_total_debit).toBe("0.012000000000000001");
    expectNothingSubmitted(client, prohibited);
  });

  it("returns STALE_INTENT when provider token identity changes after current context validation", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient({ token: { id: "USDC-ARC-TESTNET-ROTATED" } });
    const error = await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client }), "STALE_INTENT");
    expect(error.details.changed_fields).toContain("provider_token");
    expect(client.getWallet).toHaveBeenCalledTimes(2);
    expect(client.getWalletTokenBalance).toHaveBeenCalledTimes(1);
    expect(client.estimateTransferFee).toHaveBeenCalledWith(expect.objectContaining({ tokenId: "USDC-ARC-TESTNET-ROTATED" }));
    expectNothingSubmitted(client, prohibited);
  });

  it("blocks a changed immutable transfer field before submission", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient({ destination: { address: "0x1111111111111111111111111111111111111111" } });
    const error = await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client }), "PROVIDER_TRUTH_BLOCKED");
    expect(error.details.blocker).toBe("DESTINATION_WALLET_CONTEXT_MISMATCH");
    expectNothingSubmitted(client, prohibited);
  });

  it("fails closed on malformed provider responses before submission", async () => {
    const binding = await approved();
    const cases: Array<[Partial<Record<string, unknown>>, string]> = [
      [{ getWallet: vi.fn(async () => ({ data: {} })) }, "PROVIDER_TRUTH_BLOCKED"],
      [{ getWalletTokenBalance: vi.fn(async () => ({ data: { tokenBalances: "nope" } })) }, "PROVIDER_TRUTH_BLOCKED"],
      [{ estimateTransferFee: vi.fn(async () => ({ data: { medium: { networkFee: 1 } } })) }, "PROVIDER_TRUTH_BLOCKED"],
      [{ listTransactions: vi.fn(async () => ({ data: { transactions: [{ id: "bad", transactionType: "UNKNOWN" }] } })) }, "PRIOR_TRANSACTION_CHECK_FAILED"],
      [{ listTransactions: vi.fn(async () => ({ data: { transactions: [{ id: "bad", transactionType: "INBOUND" }] } })) }, "PRIOR_TRANSACTION_CHECK_FAILED"],
      [{ listTransactions: vi.fn(async () => ({ data: { transactions: [{ id: "bad" }] } })) }, "PRIOR_TRANSACTION_CHECK_FAILED"],
      [{ listTransactions: vi.fn(async () => ({ data: { transactions: [{ transactionType: "OUTBOUND" }] } })) }, "PRIOR_TRANSACTION_CHECK_FAILED"],
      [{ listTransactions: vi.fn(async () => ({ data: { transactions: [{ id: "", transactionType: "OUTBOUND" }] } })) }, "PRIOR_TRANSACTION_CHECK_FAILED"],
      [{ listTransactions: vi.fn(async () => ({ nope: true })) }, "PRIOR_TRANSACTION_CHECK_FAILED"],
      [{ listTransactions: vi.fn(async () => ({ data: { transactions: [
        { id: "out-1", transactionType: "OUTBOUND" }, { id: "out-2", transactionType: "OUTBOUND" },
      ] } })) }, "PRIOR_TRANSACTION_CHECK_FAILED"],
    ];
    for (const [override, stage] of cases) {
      const { client, prohibited } = makeClient({}, override);
      await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client }), stage);
      expectNothingSubmitted(client, prohibited);
    }
  });

  it("does not leak raw provider error text from read or submission failures", async () => {
    const binding = await approved();
    const leak = () => Promise.reject(new Error(RAW_PROVIDER_SECRET));
    for (const override of [{ getWallet: vi.fn(leak) }, { estimateTransferFee: vi.fn(leak) }, { listTransactions: vi.fn(leak) }, { createTransaction: vi.fn(leak) }]) {
      const { client } = makeClient({}, override);
      const error = await runConnectivitySpike({ resumeFrom, ...binding, client, pollIntervalMs: 1 }).then(() => null, (e: unknown) => e);
      expect(error).toBeInstanceOf(J0ConnectivitySpikeError);
      expect(JSON.stringify({ message: (error as Error).message, details: (error as J0ConnectivitySpikeError).details })).not.toContain("RAW-PROVIDER-BODY");
    }
  });

  it("uses the exact provider-filtered outbound existence query", async () => {
    const binding = await approved();
    const { client } = makeClient();
    const result = await runConnectivitySpike({ resumeFrom, ...binding, client, pollIntervalMs: 1 });
    expect(result.status).toBe("COMPLETE");
    expect(client.listTransactions).toHaveBeenCalledTimes(1);
    const [query] = vi.mocked(client.listTransactions).mock.calls[0] as unknown as [Record<string, unknown>];
    expect(query).toStrictEqual({
      walletIds: [resumeFrom.sourceWallet.id],
      txType: "OUTBOUND",
      pageSize: 1,
      order: "DESC",
    });
    // B7-B: the provider rejects a blockchain filter on this query; it must never be sent.
    expect(Object.keys(query).sort()).toEqual(["order", "pageSize", "txType", "walletIds"]);
    expect(query).not.toHaveProperty("blockchain");
  });

  it("stops without submitting when the source wallet already has a prior outbound transaction", async () => {
    const binding = await approved();
    for (const tx of [{ id: "prior-1", transactionType: "OUTBOUND", state: "FAILED" }]) {
      const { client, prohibited } = makeClient({ transactions: [tx] });
      const error = await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client }), "PRIOR_OUTBOUND_TRANSACTION_EXISTS");
      expect(error.details).toEqual({ provider_transaction_ids: [tx.id] });
      expectNothingSubmitted(client, prohibited);
    }
  });

  it("fails closed when the filtered outbound check throws", async () => {
    const binding = await approved();
    const { client, prohibited } = makeClient({}, { listTransactions: vi.fn(async () => { throw new Error(RAW_PROVIDER_SECRET); }) });
    await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client }), "PRIOR_TRANSACTION_CHECK_FAILED");
    expect(client.listTransactions).toHaveBeenCalledTimes(1);
    expectNothingSubmitted(client, prohibited);
  });

  it("continues to the next gate when the filtered result is empty", async () => {
    const binding = await approved();
    const { client } = makeClient({ transactions: [] });
    const result = await runConnectivitySpike({ resumeFrom, ...binding, client, pollIntervalMs: 1 });
    expect(result.status).toBe("COMPLETE");
    expect(client.createTransaction).toHaveBeenCalledTimes(1);
  });

  it("treats a thrown or malformed submission response as SUBMISSION_OUTCOME_UNKNOWN and never retries", async () => {
    const binding = await approved();
    for (const createTransaction of [vi.fn(() => Promise.reject(new Error("socket hang up"))), vi.fn(async () => ({ data: {} }))]) {
      const { client } = makeClient({}, { createTransaction });
      const error = await expectStopped(runConnectivitySpike({ resumeFrom, ...binding, client, pollIntervalMs: 1 }), "SUBMISSION_OUTCOME_UNKNOWN");
      expect(error.details).toEqual({
        intent_fingerprint: binding.intentFingerprint,
        execution_identity: computeJ0dExecutionIdentity(binding.approvedIntent),
        idempotency_key: j0dIdempotencyKeyForExecutionIdentity(computeJ0dExecutionIdentity(binding.approvedIntent)),
      });
      expect(createTransaction).toHaveBeenCalledTimes(1);
      expect(client.getTransaction).not.toHaveBeenCalled();
    }
  });

  it("returns UNKNOWN (never blind-retries) when the transaction never reaches a terminal state", async () => {
    const binding = await approved();
    const { client } = makeClient({ finalState: "SENT" });
    const result = await runConnectivitySpike({ resumeFrom, ...binding, client, pollIntervalMs: 1, transactionTimeoutMs: 5 });
    expect(result.status).toBe("UNKNOWN");
    expect(result.provider_state).toBeNull();
    expect(client.createTransaction).toHaveBeenCalledTimes(1);
  });

  it("returns UNKNOWN when status reads fail or are malformed, without resubmitting", async () => {
    const binding = await approved();
    for (const getTransaction of [vi.fn(() => Promise.reject(new Error(RAW_PROVIDER_SECRET))), vi.fn(async () => ({ nope: true }))]) {
      const { client } = makeClient({}, { getTransaction });
      const result = await runConnectivitySpike({ resumeFrom, ...binding, client, pollIntervalMs: 1, transactionTimeoutMs: 5 });
      expect(result.status).toBe("UNKNOWN");
      expect(JSON.stringify(result)).not.toContain("RAW-PROVIDER-BODY");
      expect(client.createTransaction).toHaveBeenCalledTimes(1);
    }
  });

  it("returns FAILED (distinct from UNKNOWN) when the provider denies the transaction", async () => {
    const binding = await approved();
    const { client } = makeClient({ finalState: "DENIED" });
    const result = await runConnectivitySpike({ resumeFrom, ...binding, client, pollIntervalMs: 1 });
    expect(result.status).toBe("FAILED");
    expect(result.provider_state).toBe("DENIED");
  });
});

describe("J0-D execution capability and source invariants", () => {
  it("the live execution capability exposes no wallet-creation, faucet, or signing methods", () => {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    process.env.CIRCLE_API_KEY = "TEST-ONLY-API-KEY";
    process.env.CIRCLE_ENTITY_SECRET = "00".repeat(32);
    try {
      const client = createCircleArcSpikeExecutionClient();
      expect(Object.keys(client).sort()).toEqual([
        "createTransaction", "estimateTransferFee", "getTransaction", "getWallet", "getWalletTokenBalance", "listTransactions",
      ]);
      for (const prohibited of ["requestTestnetTokens", "createWallets", "createWalletSet", "signTransaction", "signMessage", "signTypedData"]) {
        expect(prohibited in client).toBe(false);
      }
    } finally {
      restoreEnv("CIRCLE_API_KEY", apiKey);
      restoreEnv("CIRCLE_ENTITY_SECRET", entitySecret);
    }
  });

  it("the spike/intent/preflight sources contain no Number()/parseFloat/parseInt money logic and no faucet or wallet-creation call", () => {
    for (const file of ["connectivity-spike.ts", "intent.ts", "preflight.ts"]) {
      const source = readFileSync(new URL(`../src/j0d-spike/${file}`, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/\bNumber\(|parseFloat|parseInt/);
    }
    const spike = readFileSync(new URL("../src/j0d-spike/connectivity-spike.ts", import.meta.url), "utf8");
    expect(spike).not.toMatch(/requestTestnetTokens|createWallets|createWalletSet|symbol === "USDC"/);
    const route = readFileSync(new URL("../app/api/j0d/run-connectivity-spike/route.ts", import.meta.url), "utf8");
    expect(route).not.toMatch(/requestTestnetTokens|createWallets|createWalletSet/);
  });
});
