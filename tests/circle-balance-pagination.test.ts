import { describe, expect, it, vi } from "vitest";

import { readCompleteCircleBalanceRows } from "../src/server/circle-balance-pagination";

describe("Circle balance pagination completeness", () => {
  it.each([
    ["missing pagination object", undefined],
    ["empty pagination object", { pagination: {} }],
    ["omitted terminal cursor", { pagination: { nextPageAfter: undefined } }],
  ] as const)("rejects %s instead of treating it as the final page", async (_name, responseBody) => {
    const client = {
      getWalletTokenBalance: vi.fn(async () => ({
        headers: {},
        data: { tokenBalances: [], ...(responseBody ?? {}) },
      })),
    };

    await expect(readCompleteCircleBalanceRows(client, "WALLET"))
      .rejects.toThrow("CIRCLE_BALANCE_COMPLETENESS_UNVERIFIED");
    expect(client.getWalletTokenBalance).toHaveBeenCalledOnce();
  });

  it("accepts an explicit null cursor as the terminal page", async () => {
    const client = {
      getWalletTokenBalance: vi.fn(async () => ({
        headers: {},
        data: { tokenBalances: [{ id: "USDC" }], pagination: { nextPageAfter: null } },
      })),
    };

    await expect(readCompleteCircleBalanceRows(client, "WALLET"))
      .resolves.toEqual([{ id: "USDC" }]);
    expect(client.getWalletTokenBalance).toHaveBeenCalledOnce();
  });

  it("accepts a validated terminal Link header when the body has no pagination object", async () => {
    const client = {
      getWalletTokenBalance: vi.fn(async () => ({
        headers: { link: '<https://api.circle.com/v1/balances>; rel="first", <https://api.circle.com/v1/balances>; rel="self"' },
        data: { tokenBalances: [{ id: "USDC" }] },
      })),
    };

    await expect(readCompleteCircleBalanceRows(client, "WALLET"))
      .resolves.toEqual([{ id: "USDC" }]);
  });
});
