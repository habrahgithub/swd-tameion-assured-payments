/**
 * Numeric Safety (blueprint: "Numeric Safety").
 * Authoritative money is exact data, never binary floating point. All
 * conversions here operate on strings/BigInt only; nothing here ever
 * round-trips a financial value through `Number`.
 */

export class NumericSafetyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "NumericSafetyError";
  }
}

/** USDC on Arc uses 6 decimal places for its atomic (smallest) unit. */
export const USDC_DECIMALS = 6;

const CANONICAL_DECIMAL_PATTERN = /^(0|[1-9][0-9]*)\.([0-9]+)$/;
const CANONICAL_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;

/**
 * Validates that `value` is a canonical non-negative decimal string with
 * exactly `scale` fractional digits: no scientific notation, no leading
 * zeros (except a bare integer part of "0"), no sign, no whitespace.
 */
export function assertCanonicalDecimal(value: string, scale: number): void {
  if (typeof value !== "string") {
    throw new NumericSafetyError("Amount must be a string, not a number", "NUM-001");
  }
  const match = CANONICAL_DECIMAL_PATTERN.exec(value);
  if (!match) {
    throw new NumericSafetyError(
      `Amount "${value}" is not a canonical non-negative decimal string`,
      "NUM-001",
    );
  }
  const fractional = match[2];
  if (fractional.length !== scale) {
    throw new NumericSafetyError(
      `Amount "${value}" must have exactly ${scale} fractional digits, got ${fractional.length}`,
      "NUM-004",
    );
  }
}

/** Validates a canonical non-negative base-10 integer string (no leading zeros except "0"). */
export function assertCanonicalInteger(value: string, label = "value"): void {
  if (typeof value !== "string" || !CANONICAL_INTEGER_PATTERN.test(value)) {
    throw new NumericSafetyError(
      `${label} "${value}" is not a canonical non-negative base-10 integer string`,
      "NUM-005",
    );
  }
}

/**
 * Converts a canonical decimal amount string (exactly `decimals` fractional
 * digits) into its canonical atomic base-10 integer string. Exact — uses
 * BigInt only, never Number.
 */
export function decimalToAtomic(amount: string, decimals: number): string {
  assertCanonicalDecimal(amount, decimals);
  const [whole, fractional] = amount.split(".");
  const atomic = BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fractional);
  return atomic.toString(10);
}

/**
 * Converts a canonical atomic base-10 integer string back into its
 * canonical decimal string with exactly `decimals` fractional digits.
 */
export function atomicToDecimal(atomic: string, decimals: number): string {
  assertCanonicalInteger(atomic, "atomic amount");
  const value = BigInt(atomic);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fractional = (value % divisor).toString(10).padStart(decimals, "0");
  return `${whole.toString(10)}.${fractional}`;
}

/**
 * Authoritative-value roundtrip proof required before execution: canonical
 * decimal -> atomic -> canonical decimal must reproduce the exact original
 * value bit-for-bit (string-for-string).
 */
export function verifyAtomicRoundtrip(amount: string, decimals: number): string {
  const atomic = decimalToAtomic(amount, decimals);
  const roundtripped = atomicToDecimal(atomic, decimals);
  if (roundtripped !== amount) {
    throw new NumericSafetyError(
      `Atomic roundtrip mismatch: "${amount}" -> "${atomic}" -> "${roundtripped}"`,
      "NUM-006",
    );
  }
  return atomic;
}
