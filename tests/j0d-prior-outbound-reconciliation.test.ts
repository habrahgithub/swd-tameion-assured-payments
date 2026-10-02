import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({ fakeClient: null as Record<string, ReturnType<typeof vi.fn>> | null, initiateCalls: 0 }));

vi.mock("@circle-fin/developer-controlled-wallets", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@circle-fin/developer-controlled-wallets")>();
  return {
    ...actual,
    initiateDeveloperControlledWalletsClient: (...args: Parameters<typeof actual.initiateDeveloperControlledWalletsClient>) => {
      sdk.initiateCalls += 1;
      return sdk.fakeClient ?? actual.initiateDeveloperControlledWalletsClient(...args);
    },
  };
});

import { POST } from "../app/api/j0d/reconcile-prior-outbound/route";
import { createCircleArcPriorOutboundReadClient } from "../src/j0d-spike/circle-arc-client";
import {
  J0D_PRIOR_OUTBOUND_PROBES,
  runJ0dPriorOutboundReconciliation,
  sanitizeProviderMessage,
  type J0dPriorOutboundProbe,
  type J0dPriorOutboundReadClient,
} from "../src/j0d-spike/prior-outbound-reconciliation";

const sourceWalletId = "9fe9c001-a044-5f9a-8997-165474887952";
const fixedNow = () => new Date("2026-09-29T06:10:00.000Z");
const expectedQuery = {
  walletIds: [sourceWalletId],
  blockchain: "ARC-TESTNET",
  txType: "OUTBOUND",
  pageSize: 1,
  order: "DESC",
};

/** Exact SDK input and reported query description per probe (#40 B7-B). */
const probeCases: Array<[J0dPriorOutboundProbe, Record<string, unknown>, Record<string, unknown>]> = [
  [
    "FULL_CURRENT",
    { walletIds: [sourceWalletId], blockchain: "ARC-TESTNET", txType: "OUTBOUND", pageSize: 1, order: "DESC" },
    { wallet_id: sourceWalletId, blockchain: "ARC-TESTNET", tx_type: "OUTBOUND", custody_type: "DEVELOPER", page_size: 1, order: "DESC" },
  ],
  [
    "WALLET_TXTYPE",
    { walletIds: [sourceWalletId], txType: "OUTBOUND", pageSize: 1, order: "DESC" },
    { wallet_id: sourceWalletId, tx_type: "OUTBOUND", custody_type: "DEVELOPER", page_size: 1, order: "DESC" },
  ],
  [
    "WALLET_ONLY",
    { walletIds: [sourceWalletId], pageSize: 1, order: "DESC" },
    { wallet_id: sourceWalletId, custody_type: "DEVELOPER", page_size: 1, order: "DESC" },
  ],
  [
    "UNFILTERED_ONE",
    { pageSize: 1, order: "DESC" },
    { custody_type: "DEVELOPER", page_size: 1, order: "DESC" },
  ],
];

const prohibitedSdkMethods = [
  "createTransaction", "createWallets", "createWalletSet", "requestTestnetTokens", "signTransaction",
  "signMessage", "signTypedData", "getWallet", "getWalletTokenBalance", "estimateTransferFee",
  "getTransaction", "cancelTransaction", "accelerateTransaction", "createContractExecutionTransaction",
];

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

let savedApiKey: string | undefined;
let savedEntitySecret: string | undefined;

beforeEach(() => {
  savedApiKey = process.env.CIRCLE_API_KEY;
  savedEntitySecret = process.env.CIRCLE_ENTITY_SECRET;
  sdk.fakeClient = null;
  sdk.initiateCalls = 0;
});

afterEach(() => {
  restoreEnv("CIRCLE_API_KEY", savedApiKey);
  restoreEnv("CIRCLE_ENTITY_SECRET", savedEntitySecret);
  sdk.fakeClient = null;
  vi.restoreAllMocks();
});

function useFakeCredentials() {
  process.env.CIRCLE_API_KEY = "TEST_API_KEY:0123456789abcdef0123456789abcdef:fedcba9876543210fedcba9876543210";
  process.env.CIRCLE_ENTITY_SECRET = "ab".repeat(32);
}

function readClient(response: unknown): J0dPriorOutboundReadClient & { listTransactions: ReturnType<typeof vi.fn> } {
  return { listTransactions: vi.fn(async () => response) };
}

async function reconcile(response: unknown) {
  const client = readClient(response);
  const result = await runJ0dPriorOutboundReconciliation(sourceWalletId, "FULL_CURRENT", { client, now: fixedNow });
  expect(client.listTransactions).toHaveBeenCalledTimes(1);
  expect(client.listTransactions.mock.calls[0]).toStrictEqual([expectedQuery]);
  return result;
}

function routeRequest(body: unknown) {
  return new Request("http://localhost/api/j0d/reconcile-prior-outbound", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const outboundTransaction = {
  id: "7b5c4a1e-1111-4222-8333-944455556666",
  transactionType: "OUTBOUND",
  state: "COMPLETE",
  walletId: sourceWalletId,
  blockchain: "ARC-TESTNET",
  txHash: "0x" + "12".repeat(32),
  amounts: ["0.01"],
  destinationAddress: "0x591a1002127b1605d9dbb51348787bbe3014b2b9",
  sourceAddress: "0x8a5ec63c8bc7a4d4b4f0134e034bda4c24043e95",
  networkFee: "0.001",
};

describe("J0-D prior-outbound reconciliation: sanitized provider structure", () => {
  it("reports an empty transactions array as present, array, count 0", async () => {
    const result = await reconcile({ data: { transactions: [] } });
    expect(result).toEqual({
      dispatch_profile: "J0_CONNECTIVITY_SPIKE",
      action: "READ_ONLY_PRIOR_OUTBOUND_RECONCILIATION",
      probe: "FULL_CURRENT",
      query: { wallet_id: sourceWalletId, blockchain: "ARC-TESTNET", tx_type: "OUTBOUND", custody_type: "DEVELOPER", page_size: 1, order: "DESC" },
      provider_query: "SUCCEEDED",
      data_present: true,
      transactions_present: true,
      transactions_is_array: true,
      transactions_count: 0,
      first_transaction: null,
      captured_at: "2026-09-29T06:10:00.000Z",
    });
  });

  it("reports an omitted transactions field as omitted, never as an empty array", async () => {
    for (const response of [{ data: {} }, { data: { transactions: undefined } }]) {
      const result = await reconcile(response);
      expect(result).toMatchObject({
        provider_query: "SUCCEEDED",
        data_present: true,
        transactions_present: false,
        transactions_is_array: false,
        transactions_count: null,
        first_transaction: null,
      });
    }
  });

  it("reports an omitted or non-object data envelope without inventing transactions", async () => {
    for (const response of [{}, { data: null }, { data: [] }, { data: "ok" }, null, undefined, "raw"]) {
      const result = await reconcile(response);
      expect(result).toMatchObject({
        provider_query: "SUCCEEDED",
        data_present: false,
        transactions_present: false,
        transactions_is_array: false,
        transactions_count: null,
        first_transaction: null,
      });
    }
  });

  it("reports a malformed transactions field as present but not an array", async () => {
    for (const transactions of [null, "none", 0, {}, { 0: outboundTransaction }]) {
      const result = await reconcile({ data: { transactions } });
      expect(result).toMatchObject({
        provider_query: "SUCCEEDED",
        data_present: true,
        transactions_present: true,
        transactions_is_array: false,
        transactions_count: null,
        first_transaction: null,
      });
    }
  });

  it("reports one OUTBOUND transaction with only id, type, state, and wallet id", async () => {
    const result = await reconcile({ data: { transactions: [outboundTransaction] }, headers: { "x-request-id": "abc" }, status: 200 });
    expect(result).toMatchObject({
      provider_query: "SUCCEEDED",
      data_present: true,
      transactions_present: true,
      transactions_is_array: true,
      transactions_count: 1,
      first_transaction: {
        is_object: true,
        id: outboundTransaction.id,
        transaction_type: "OUTBOUND",
        state: "COMPLETE",
        wallet_id: sourceWalletId,
      },
    });
    const serialized = JSON.stringify(result);
    for (const raw of [outboundTransaction.txHash, outboundTransaction.destinationAddress, outboundTransaction.sourceAddress, "x-request-id", "0.001", "amounts"]) {
      expect(serialized).not.toContain(raw);
    }
  });

  it("reports the provider count as returned and nulls malformed first-transaction fields", async () => {
    const result = await reconcile({
      data: {
        transactions: [
          { id: "bad id with spaces", transactionType: 7, state: "complete; drop", walletId: "x".repeat(500) },
          outboundTransaction,
        ],
      },
    });
    expect(result).toMatchObject({
      transactions_count: 2,
      first_transaction: { is_object: true, id: null, transaction_type: null, state: null, wallet_id: null },
    });

    const nonObject = await reconcile({ data: { transactions: ["tx-1"] } });
    expect(nonObject).toMatchObject({
      transactions_count: 1,
      first_transaction: { is_object: false, id: null, transaction_type: null, state: null, wallet_id: null },
    });
  });

  it("reports a provider error with sanitized status, code, and message only", async () => {
    useFakeCredentials();
    const providerError = Object.assign(new Error(
      `Invalid entity secret ${process.env.CIRCLE_ENTITY_SECRET} for key ${process.env.CIRCLE_API_KEY} Bearer abc.def ` +
        "ciphertext " + "Q".repeat(80) + "\n\tplease retry",
    ), {
      name: "BadRequestError",
      status: 400,
      code: 155101,
      url: `/v1/w3s/transactions?walletIds=${sourceWalletId}`,
      method: "GET",
      error: { config: { headers: { Authorization: `Bearer ${process.env.CIRCLE_API_KEY}` } } },
    });
    const client = { listTransactions: vi.fn(() => Promise.reject(providerError)) };
    const result = await runJ0dPriorOutboundReconciliation(sourceWalletId, "FULL_CURRENT", { client, now: fixedNow });

    expect(result.provider_query).toBe("FAILED");
    if (result.provider_query !== "FAILED") throw new Error("unreachable");
    expect(result.provider_error).toEqual({
      name: "BadRequestError",
      status: 400,
      code: 155101,
      message: "Invalid entity secret [REDACTED] for key [REDACTED] Bearer [REDACTED] ciphertext [REDACTED] please retry",
    });
    const serialized = JSON.stringify(result);
    for (const secret of [process.env.CIRCLE_API_KEY!, process.env.CIRCLE_ENTITY_SECRET!, "/v1/w3s", "Authorization", "GET"]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("reports non-Error and malformed provider failures without leaking their payload", async () => {
    for (const thrown of ["raw string failure", { name: "Bad Name!", status: 42, code: "has spaces", message: 12 }, null]) {
      const client = { listTransactions: vi.fn(() => Promise.reject(thrown)) };
      const result = await runJ0dPriorOutboundReconciliation(sourceWalletId, "FULL_CURRENT", { client, now: fixedNow });
      expect(result).toMatchObject({
        provider_query: "FAILED",
        provider_error: { name: "ProviderError", status: null, code: null, message: null },
      });
    }
    const requestError = { listTransactions: vi.fn(() => Promise.reject(Object.assign(new Error("connect ECONNREFUSED"), { name: "ConnectionRefusedError", code: "ECONNREFUSED" }))) };
    const result = await runJ0dPriorOutboundReconciliation(sourceWalletId, "FULL_CURRENT", { client: requestError, now: fixedNow });
    expect(result).toMatchObject({
      provider_query: "FAILED",
      provider_error: { name: "ConnectionRefusedError", status: null, code: "ECONNREFUSED", message: "connect ECONNREFUSED" },
    });
  });

  it("bounds sanitized provider messages", () => {
    expect(sanitizeProviderMessage("word ".repeat(200))!.length).toBeLessThanOrEqual(300);
    expect(sanitizeProviderMessage("   ")).toBeNull();
    expect(sanitizeProviderMessage(undefined)).toBeNull();
  });
});

describe("J0-D prior-outbound reconciliation API", () => {
  it.each([
    ["missing confirmation", { sourceWalletId, probe: "FULL_CURRENT" }],
    ["wrong confirmation literal", { confirm: "READ_J0D_PREFLIGHT_ONLY", sourceWalletId, probe: "FULL_CURRENT" }],
    ["execution confirmation literal", { confirm: "RUN_J0D_CONNECTIVITY_SPIKE_ONCE", sourceWalletId, probe: "FULL_CURRENT" }],
    ["missing source wallet", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", probe: "FULL_CURRENT" }],
    ["missing source wallet for UNFILTERED_ONE", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", probe: "UNFILTERED_ONE" }],
    ["empty source wallet", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId: "", probe: "FULL_CURRENT" }],
    ["non-string source wallet", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId: [sourceWalletId], probe: "FULL_CURRENT" }],
    ["extra execution field", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: "FULL_CURRENT", execute: true }],
    ["extra query override", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: "FULL_CURRENT", pageSize: 50 }],
    ["missing probe", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId }],
    ["null probe", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: null }],
    ["unknown probe", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: "WALLET_BLOCKCHAIN" }],
    ["lowercase probe", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: "full_current" }],
    ["padded probe", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: " FULL_CURRENT" }],
    ["array probe", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: ["FULL_CURRENT"] }],
    ["object probe", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: { txType: "INBOUND" } }],
    ["numeric probe index", { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: 0 }],
    ...([
      ["walletIds", ["another-wallet"]],
      ["blockchain", "ETH-SEPOLIA"],
      ["txType", "INBOUND"],
      ["custodyType", "ENDUSER"],
      ["pageSize", 50],
      ["order", "ASC"],
      ["includeAll", true],
      ["pageAfter", "cursor"],
      ["state", "COMPLETE"],
      ["txHash", "0xabc"],
      ["destinationAddress", "0x591a1002127b1605d9dbb51348787bbe3014b2b9"],
      ["query", { blockchain: "ETH-SEPOLIA" }],
      ["params", { txType: "INBOUND" }],
    ] as const).map(([field, value]) => [
      `arbitrary query override ${field} with UNFILTERED_ONE`,
      { confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: "UNFILTERED_ONE", [field]: value },
    ] as [string, unknown]),
    ["non-JSON body", "not json"],
    ["array body", [{ confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: "FULL_CURRENT" }]],
  ])("rejects %s with HTTP 400 before any provider client is created", async (_label, body) => {
    useFakeCredentials();
    const listTransactions = vi.fn();
    sdk.fakeClient = { listTransactions };
    const response = await POST(routeRequest(body));
    expect(response.status).toBe(400);
    expect(sdk.initiateCalls).toBe(0);
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it("fails closed with HTTP 503 when the runtime has no Circle credentials", async () => {
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    const response = await POST(routeRequest({ confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: "FULL_CURRENT" }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.result.provider_query).toBe("NOT_CONFIGURED");
  });

  it("reaches only listTransactions with the exact query through the full route and SDK boundary", async () => {
    useFakeCredentials();
    const prohibited = prohibitedSdkMethods;
    const fullClient: Record<string, ReturnType<typeof vi.fn>> = {
      listTransactions: vi.fn(async () => ({ data: { transactions: [outboundTransaction] } })),
    };
    for (const method of prohibited) fullClient[method] = vi.fn(() => Promise.reject(new Error("must never be called")));
    sdk.fakeClient = fullClient;

    const response = await POST(routeRequest({ confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: "FULL_CURRENT" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.first_transaction.id).toBe(outboundTransaction.id);
    expect(fullClient.listTransactions).toHaveBeenCalledTimes(1);
    expect(fullClient.listTransactions.mock.calls[0]).toStrictEqual([expectedQuery]);
    for (const method of prohibited) expect(fullClient[method], method).not.toHaveBeenCalled();
  });

  it("maps a provider failure to HTTP 502 through the route", async () => {
    useFakeCredentials();
    sdk.fakeClient = {
      listTransactions: vi.fn(() => Promise.reject(Object.assign(new Error("Internal"), { name: "InternalServerError", status: 500, code: 500 }))),
    };
    const response = await POST(routeRequest({ confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe: "FULL_CURRENT" }));
    expect(response.status).toBe(502);
    const body = await response.json();
    expect(body.result.provider_error).toEqual({ name: "InternalServerError", status: 500, code: 500, message: "Internal" });
  });
});

describe("J0-D prior-outbound reconciliation: fixed query isolation probes (#40 B7-B)", () => {
  it("exposes exactly the four fixed probes", () => {
    expect(J0D_PRIOR_OUTBOUND_PROBES).toEqual(["FULL_CURRENT", "WALLET_TXTYPE", "WALLET_ONLY", "UNFILTERED_ONE"]);
    expect(probeCases.map(([probe]) => probe)).toEqual([...J0D_PRIOR_OUTBOUND_PROBES]);
  });

  it.each(probeCases)("%s sends exactly its fixed SDK input and reports its effective query", async (probe, sdkInput, description) => {
    const client = readClient({ data: { transactions: [] } });
    const result = await runJ0dPriorOutboundReconciliation(sourceWalletId, probe, { client, now: fixedNow });

    expect(client.listTransactions).toHaveBeenCalledTimes(1);
    expect(client.listTransactions.mock.calls[0]).toStrictEqual([sdkInput]);
    expect(Object.keys(client.listTransactions.mock.calls[0][0]).sort()).toEqual(Object.keys(sdkInput).sort());
    expect(result).toStrictEqual({
      dispatch_profile: "J0_CONNECTIVITY_SPIKE",
      action: "READ_ONLY_PRIOR_OUTBOUND_RECONCILIATION",
      probe,
      query: description,
      provider_query: "SUCCEEDED",
      data_present: true,
      transactions_present: true,
      transactions_is_array: true,
      transactions_count: 0,
      first_transaction: null,
      captured_at: "2026-09-29T06:10:00.000Z",
    });
  });

  it("UNFILTERED_ONE validates the source wallet but never sends it to the provider", async () => {
    const client = readClient({ data: { transactions: [] } });
    const result = await runJ0dPriorOutboundReconciliation(sourceWalletId, "UNFILTERED_ONE", { client, now: fixedNow });
    expect(JSON.stringify(client.listTransactions.mock.calls)).not.toContain(sourceWalletId);
    expect(JSON.stringify(result)).not.toContain(sourceWalletId);
    await expect(runJ0dPriorOutboundReconciliation("", "UNFILTERED_ONE", { client, now: fixedNow })).rejects.toThrow();
    expect(client.listTransactions).toHaveBeenCalledTimes(1);
  });

  it.each(probeCases)("%s reports a provider failure with the same sanitized error shape", async (probe, _sdkInput, description) => {
    const client = {
      listTransactions: vi.fn(() => Promise.reject(Object.assign(new Error("API parameter invalid"), { name: "BadRequestError", status: 400, code: 2 }))),
    };
    const result = await runJ0dPriorOutboundReconciliation(sourceWalletId, probe, { client, now: fixedNow });
    expect(result).toStrictEqual({
      dispatch_profile: "J0_CONNECTIVITY_SPIKE",
      action: "READ_ONLY_PRIOR_OUTBOUND_RECONCILIATION",
      probe,
      query: description,
      provider_query: "FAILED",
      provider_error: { name: "BadRequestError", status: 400, code: 2, message: "API parameter invalid" },
      captured_at: "2026-09-29T06:10:00.000Z",
    });
  });

  it("UNFILTERED_ONE reports only the permitted first-transaction fields of whatever wallet the provider returns", async () => {
    const otherWalletTx = { ...outboundTransaction, id: "0a1b2c3d-0000-4000-8000-000000000001", walletId: "5d0c1f5e-0000-4000-8000-00000000000a", transactionType: "INBOUND" };
    const client = readClient({ data: { transactions: [otherWalletTx] } });
    const result = await runJ0dPriorOutboundReconciliation(sourceWalletId, "UNFILTERED_ONE", { client, now: fixedNow });
    expect(result).toMatchObject({
      probe: "UNFILTERED_ONE",
      transactions_count: 1,
      first_transaction: { is_object: true, id: otherWalletTx.id, transaction_type: "INBOUND", state: "COMPLETE", wallet_id: otherWalletTx.walletId },
    });
    const serialized = JSON.stringify(result);
    for (const raw of [otherWalletTx.txHash, otherWalletTx.destinationAddress, otherWalletTx.sourceAddress, "0.001", "amounts"]) {
      expect(serialized).not.toContain(raw);
    }
  });

  it.each([
    ["unknown probe", "WALLET_BLOCKCHAIN"],
    ["lowercase probe", "full_current"],
    ["empty probe", ""],
    ["undefined probe", undefined],
    ["object probe", { walletIds: [sourceWalletId], txType: "INBOUND" }],
  ])("the module rejects %s before any provider client is created", async (_label, probe) => {
    useFakeCredentials();
    const listTransactions = vi.fn();
    sdk.fakeClient = { listTransactions };
    await expect(runJ0dPriorOutboundReconciliation(sourceWalletId, probe as J0dPriorOutboundProbe, { now: fixedNow })).rejects.toThrow();
    expect(sdk.initiateCalls).toBe(0);
    expect(listTransactions).not.toHaveBeenCalled();
  });

  it.each(probeCases)("%s reaches only listTransactions with its exact query through the full route and SDK boundary", async (probe, sdkInput, description) => {
    useFakeCredentials();
    const fullClient: Record<string, ReturnType<typeof vi.fn>> = {
      listTransactions: vi.fn(async () => ({ data: { transactions: [outboundTransaction] } })),
    };
    for (const method of prohibitedSdkMethods) fullClient[method] = vi.fn(() => Promise.reject(new Error("must never be called")));
    sdk.fakeClient = fullClient;

    const response = await POST(routeRequest({ confirm: "READ_J0D_PRIOR_OUTBOUND_ONLY", sourceWalletId, probe }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.probe).toBe(probe);
    expect(body.result.query).toStrictEqual(description);
    expect(sdk.initiateCalls).toBe(1);
    expect(fullClient.listTransactions).toHaveBeenCalledTimes(1);
    expect(fullClient.listTransactions.mock.calls[0]).toStrictEqual([sdkInput]);
    for (const method of prohibitedSdkMethods) expect(fullClient[method], method).not.toHaveBeenCalled();
  });

  it("pinned SDK 10.8.1 injects custodyType DEVELOPER when listTransactions omits it", () => {
    const require = createRequire(import.meta.url);
    const sdkPackage = JSON.parse(
      readFileSync(require.resolve("@circle-fin/developer-controlled-wallets/package.json"), "utf8"),
    ) as { version: string };
    expect(sdkPackage.version).toBe("10.8.1");
    const bundle = readFileSync(
      require.resolve("@circle-fin/developer-controlled-wallets/package.json").replace(/package\.json$/, "dist/developer-controlled-wallets.es.js"),
      "utf8",
    );
    expect(bundle).toMatch(/Transactions\.listTransactions\(\w+,\w+\?\?"DEVELOPER",/);
  });
});

describe("J0-D prior-outbound reconciliation capability invariants", () => {
  it("the live reconciliation capability exposes only listTransactions", () => {
    useFakeCredentials();
    const client = createCircleArcPriorOutboundReadClient();
    expect(Object.keys(client)).toEqual(["listTransactions"]);
    for (const prohibited of [
      "createTransaction", "requestTestnetTokens", "createWallets", "createWalletSet", "signTransaction", "signMessage",
      "signTypedData", "getWallet", "getWalletTokenBalance", "estimateTransferFee", "getTransaction",
    ]) {
      expect(prohibited in client).toBe(false);
    }
  });

  it("the route and module cannot import or name any mutation or execution capability", () => {
    const importSpecifiers = (source: string) => [...source.matchAll(/\bfrom\s+"([^"]+)"|\bimport\(\s*"([^"]+)"\s*\)/g)].map((m) => m[1] ?? m[2]);
    const route = readFileSync(new URL("../app/api/j0d/reconcile-prior-outbound/route.ts", import.meta.url), "utf8");
    const moduleSource = readFileSync(new URL("../src/j0d-spike/prior-outbound-reconciliation.ts", import.meta.url), "utf8");

    expect(importSpecifiers(route)).toEqual(["next/server", "../../../../src/j0d-spike/prior-outbound-reconciliation"]);
    expect(importSpecifiers(moduleSource)).toEqual(["zod", "./circle-arc-client", "./intent"]);
    expect(moduleSource).toMatch(/import \{ ARC_TESTNET_BLOCKCHAIN, createCircleArcPriorOutboundReadClient \} from "\.\/circle-arc-client";/);
    expect(moduleSource).toMatch(/import \{ walletIdSchema \} from "\.\/intent";/);

    const forbidden = /createTransaction|requestTestnetTokens|createWallets?\b|createWalletSet|sign(?:Transaction|Message|TypedData)|createCircleArcSpikeClient|createCircleArcSpikeExecutionClient|createCircleArcReadOnlyClient|connectivity-spike|runConnectivitySpike|ExecutionWorker|AuthorityStore|process\.env\.\w+\s*=/;
    expect(route).not.toMatch(forbidden);
    expect(moduleSource).not.toMatch(forbidden);
  });
});
