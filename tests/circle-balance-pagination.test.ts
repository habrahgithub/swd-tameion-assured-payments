import { describe, expect, it, vi } from "vitest";

import { readCompleteCircleBalanceRows, readCompleteCircleCollectionRows } from "../src/server/circle-balance-pagination";

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

  it("uses the same bounded completion contract for other Circle collections", async () => {
    const client = { getPage: vi.fn()
      .mockResolvedValueOnce({ data: { transactions: [{ id: "first" }], pagination: { nextPageAfter: "cursor-2" } } })
      .mockResolvedValueOnce({ data: { transactions: [{ id: "second" }], pagination: { nextPageAfter: null } } }) };

    await expect(readCompleteCircleCollectionRows(client, "transactions"))
      .resolves.toEqual([{ id: "first" }, { id: "second" }]);
    expect(client.getPage).toHaveBeenNthCalledWith(1, { pageSize: 50 });
    expect(client.getPage).toHaveBeenNthCalledWith(2, { pageSize: 50, pageAfter: "cursor-2" });
  });
});
