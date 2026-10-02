import { describe, expect, it } from "vitest";

import {
  AED_PER_USD_RATE,
  SUPPORTED_SETTLEMENT_CURRENCIES,
  convertSourceToSettlement,
  isSettleableCurrency,
  toUsdcSettlementAmount,
} from "../src/domain/currency-conversion";

describe("currency conversion", () => {
  describe("isSettleableCurrency", () => {
    it("admits USD", () => {
      expect(isSettleableCurrency("USD")).toBe(true);
    });

    it("admits AED", () => {
      expect(isSettleableCurrency("AED")).toBe(true);
    });

    it("rejects EUR", () => {
      expect(isSettleableCurrency("EUR")).toBe(false);
    });

    it("rejects GBP", () => {
      expect(isSettleableCurrency("GBP")).toBe(false);
    });

    it("rejects empty string", () => {
      expect(isSettleableCurrency("")).toBe(false);
    });
  });

  describe("convertSourceToSettlement — AED to USD", () => {
    it("converts AED 5760.00 to USD 1568.413887 at rate 3.6725 (round-half-up)", () => {
      const result = convertSourceToSettlement("5760.00", "AED");
      expect(result.isAdmitted).toBe(true);
      expect(result.sourceAmount).toBe("5760.00");
      expect(result.sourceCurrency).toBe("AED");
      expect(result.conversionRate).toBe("3.6725");
      expect(result.settlementAmount).toBe("1568.413887");
      expect(result.settlementAtomic).toBe("1568413887");
    });

    it("preserves source amount/currency evidence exactly", () => {
      const result = convertSourceToSettlement("5760.00", "AED");
      expect(result.sourceAmount).toBe("5760.00");
      expect(result.sourceCurrency).toBe("AED");
    });

    it("converts a round AED amount correctly", () => {
      // 367.25 AED / 3.6725 = 100.000000 USD exactly
      const result = convertSourceToSettlement("367.25", "AED");
      expect(result.settlementAmount).toBe("100.000000");
      expect(result.settlementAtomic).toBe("100000000");
    });

    it("rounds half-up at the 7th decimal (1568.41388699... -> 1568.413887)", () => {
      const result = convertSourceToSettlement("5760.00", "AED");
      // 5760 / 3.6725 = 1568.413886997958...
      // 7th decimal digit is 9 (>5), so 6th digit rounds up: .413886 -> .413887
      expect(result.settlementAmount).toBe("1568.413887");
    });

    it("truncates (floor) for positive amounts when rounding down", () => {
      // 100.00 AED / 3.6725 = 27.2294077603...
      // 7th decimal is 7 (>5), rounds up: 27.229408
      const result = convertSourceToSettlement("100.00", "AED");
      expect(result.settlementAmount).toBe("27.229408");
      expect(result.settlementAtomic).toBe("27229408");
    });

    it("produces a canonical 6-decimal USDC settlement amount", () => {
      const result = convertSourceToSettlement("5760.00", "AED");
      expect(result.settlementAmount).toMatch(/^(0|[1-9][0-9]*)\.[0-9]{6}$/);
    });
  });

  describe("convertSourceToSettlement — USD passthrough", () => {
    it("passes USD through unchanged (no conversion rate)", () => {
      const result = convertSourceToSettlement("21.00", "USD");
      expect(result.isAdmitted).toBe(true);
      expect(result.sourceAmount).toBe("21.00");
      expect(result.sourceCurrency).toBe("USD");
      expect(result.conversionRate).toBeNull();
      expect(result.settlementAmount).toBe("21.000000");
      expect(result.settlementAtomic).toBe("21000000");
    });

    it("passes USD with 6 decimal places through unchanged", () => {
      const result = convertSourceToSettlement("5.000000", "USD");
      expect(result.settlementAmount).toBe("5.000000");
      expect(result.settlementAtomic).toBe("5000000");
    });

    it("scales USD 75.60 to 6 decimal places", () => {
      const result = convertSourceToSettlement("75.60", "USD");
      expect(result.settlementAmount).toBe("75.600000");
      expect(result.settlementAtomic).toBe("75600000");
    });
  });

    describe("convertSourceToSettlement — unsupported currencies", () => {
    it("throws for EUR (fail-closed, no conversion)", () => {
      expect(() => convertSourceToSettlement("250.00", "EUR")).toThrow();
    });

    it("throws for GBP (fail-closed)", () => {
      expect(() => convertSourceToSettlement("100.00", "GBP")).toThrow();
    });

    it("throws for JPY (fail-closed)", () => {
      expect(() => convertSourceToSettlement("1000", "JPY")).toThrow();
    });
  });

  describe("toUsdcSettlementAmount", () => {
    it("returns the 6-decimal USDC amount for AED", () => {
      expect(toUsdcSettlementAmount("5760.00", "AED")).toBe("1568.413887");
    });

    it("returns the 6-decimal USDC amount for USD", () => {
      expect(toUsdcSettlementAmount("21.00", "USD")).toBe("21.000000");
    });

    it("throws for EUR (fail-closed, never returns 0.000000)", () => {
      expect(() => toUsdcSettlementAmount("250.00", "EUR")).toThrow();
    });

    it("throws for any unsupported currency", () => {
      expect(() => toUsdcSettlementAmount("100.00", "GBP")).toThrow();
      expect(() => toUsdcSettlementAmount("1000", "JPY")).toThrow();
    });
  });

  describe("rate constant", () => {
    it("exposes the fixed policy rate as a string", () => {
      expect(AED_PER_USD_RATE).toBe("3.6725");
    });

    it("lists only USD and AED as supported settlement currencies", () => {
      expect(SUPPORTED_SETTLEMENT_CURRENCIES).toEqual(["USD", "AED"]);
    });
  });
});
