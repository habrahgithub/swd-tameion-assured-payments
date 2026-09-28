import { describe, expect, it } from "vitest";

import {
  NumericSafetyError,
  USDC_DECIMALS,
  atomicToDecimal,
  decimalToAtomic,
  verifyAtomicRoundtrip,
} from "../src/domain/numeric";

describe("numeric safety", () => {
  it("converts an exact decimal amount to atomic USDC units", () => {
    expect(decimalToAtomic("21.000000", USDC_DECIMALS)).toBe("21000000");
    expect(decimalToAtomic("0.000001", USDC_DECIMALS)).toBe("1");
    expect(decimalToAtomic("0.000000", USDC_DECIMALS)).toBe("0");
  });

  it("round-trips atomic back to the exact canonical decimal", () => {
    expect(atomicToDecimal("21000000", USDC_DECIMALS)).toBe("21.000000");
    expect(verifyAtomicRoundtrip("5760.000000", USDC_DECIMALS)).toBe("5760000000");
  });

  it("rejects scientific notation and non-canonical forms", () => {
    expect(() => decimalToAtomic("2.1e1", USDC_DECIMALS)).toThrow(NumericSafetyError);
    expect(() => decimalToAtomic("01.000000", USDC_DECIMALS)).toThrow(NumericSafetyError);
    expect(() => decimalToAtomic("-1.000000", USDC_DECIMALS)).toThrow(NumericSafetyError);
    expect(() => decimalToAtomic(21 as unknown as string, USDC_DECIMALS)).toThrow(NumericSafetyError);
  });

  it("rejects wrong fractional scale rather than silently truncating", () => {
    expect(() => decimalToAtomic("21.0", USDC_DECIMALS)).toThrow(NumericSafetyError);
    expect(() => decimalToAtomic("21.00000012345", USDC_DECIMALS)).toThrow(NumericSafetyError);
  });
});
