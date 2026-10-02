import { NumericSafetyError } from "./numeric";

/**
 * Fixed policy rate: 1 USD = 3.6725 AED for Arc Testnet USDC settlement.
 *
 * Source AED obligations remain source-of-truth in AED; the transaction/
 * settlement amount for Arc Testnet USDC is derived in USD at this rate:
 *   USD = AED / 3.6725
 *
 * Expressed as an exact rational: 36725 / 10000. All arithmetic below uses
 * BigInt only — `AED_PER_USD_RATE` is human/documentation only.
 */
export const AED_PER_USD_RATE = "3.6725";
const AED_PER_USD_NUMERATOR = 36725n;
const AED_PER_USD_DENOMINATOR = 10000n;

/** USDC on Arc Testnet uses 6 decimal places. */
export const USDC_DECIMALS = 6;
const USDC_SCALE = 10n ** BigInt(USDC_DECIMALS); // 10^6

/**
 * Currencies admitted for Arc Testnet USDC settlement:
 * - USD: direct passthrough (1:1 with USDC, no conversion rate)
 * - AED: converted to USD at the fixed policy rate
 *
 * Any other currency is unsupported and fails closed.
 */
export const SUPPORTED_SETTLEMENT_CURRENCIES = ["USD", "AED"] as const;

export function isSettleableCurrency(currency: string): boolean {
  return (SUPPORTED_SETTLEMENT_CURRENCIES as readonly string[]).includes(currency);
}

export interface SettlementConversion {
  /** The 6-decimal canonical USDC settlement amount (e.g. "1568.413887"). */
  settlementAmount: string;
  /** Atomic integer representation of settlementAmount (e.g. "1568413887"). */
  settlementAtomic: string;
  /** Original source amount, preserved exactly (e.g. "5760.00"). */
  sourceAmount: string;
  /** Original source currency (e.g. "AED" or "USD"). */
  sourceCurrency: string;
  /**
   * Conversion rate applied, or null for USD passthrough.
   * e.g. "3.6725" for AED→USD, null for USD→USD.
   */
  conversionRate: string | null;
  /** Whether this currency is admitted for settlement conversion. */
  isAdmitted: boolean;
}

/**
 * Converts a source amount in a given currency to a USDC settlement amount
 * using deterministic BigInt arithmetic. Never binary floating point.
 *
 * - USD: passes through, scaling to 6 decimal places (conversionRate = null)
 * - AED: converts to USD at fixed rate 1 USD = 3.6725 AED, round-half-up
 * - Other currencies: returns isAdmitted=false (fail-closed, no conversion)
 */
export function convertSourceToSettlement(
  sourceAmount: string,
  sourceCurrency: string,
): SettlementConversion {
  if (sourceCurrency === "USD") {
    return convertUsdPassthrough(sourceAmount);
  }

  if (sourceCurrency === "AED") {
    return convertAedToUsd(sourceAmount);
  }

  // Unsupported currency — fail closed with zero amount.
  return {
    settlementAmount: "0.000000",
    settlementAtomic: "0",
    sourceAmount,
    sourceCurrency,
    conversionRate: null,
    isAdmitted: false,
  };
}

/** Returns just the 6-decimal USDC settlement amount, or "0.000000" for unsupported. */
export function toUsdcSettlementAmount(sourceAmount: string, sourceCurrency: string): string {
  return convertSourceToSettlement(sourceAmount, sourceCurrency).settlementAmount;
}

function convertUsdPassthrough(amount: string): SettlementConversion {
  const [whole, fractional] = parseDecimalParts(amount);
  const integer = BigInt(whole) * 10n ** BigInt(fractional.length) + BigInt(fractional || "0");
  const decimals = fractional.length;

  const usdcAtomic = scaleToUsdc(integer, decimals);
  return {
    settlementAmount: formatUsdcAmount(usdcAtomic),
    settlementAtomic: usdcAtomic,
    sourceAmount: amount,
    sourceCurrency: "USD",
    conversionRate: null,
    isAdmitted: true,
  };
}

function convertAedToUsd(amount: string): SettlementConversion {
  const [whole, fractional] = parseDecimalParts(amount);
  const aedInteger = BigInt(whole) * 10n ** BigInt(fractional.length) + BigInt(fractional || "0");
  const aedDecimals = fractional.length;

  // USD = AED / (36725/10000) = AED * 10000 / 36725
  // USD_atomic_6dp = aedInteger * DEN * 10^6 / (10^aedDecimals * NUM)
  const numerator = aedInteger * AED_PER_USD_DENOMINATOR * USDC_SCALE;
  const denominator = (10n ** BigInt(aedDecimals)) * AED_PER_USD_NUMERATOR;

  // Round-half-up: if remainder * 2 >= denominator, round the quotient up.
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const usdcAtomic = remainder * 2n >= denominator ? quotient + 1n : quotient;

  return {
    settlementAmount: formatUsdcAmount(usdcAtomic.toString(10)),
    settlementAtomic: usdcAtomic.toString(10),
    sourceAmount: amount,
    sourceCurrency: "AED",
    conversionRate: AED_PER_USD_RATE,
    isAdmitted: true,
  };
}

/**
 * Validates and splits a canonical non-negative decimal string into its
 * whole and fractional parts. Rejects leading zeros, signs, scientific
 * notation, and whitespace.
 */
function parseDecimalParts(amount: string): [string, string] {
  if (typeof amount !== "string") {
    throw new NumericSafetyError(`Amount must be a string, not ${typeof amount}`, "NUM-001");
  }
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(amount);
  if (!match) {
    throw new NumericSafetyError(`Amount "${amount}" is not a canonical non-negative decimal string`, "NUM-001");
  }
  return [match[1], match[2] ?? ""];
}

function scaleToUsdc(integer: bigint, decimals: number): string {
  if (decimals === USDC_DECIMALS) return integer.toString(10);
  if (decimals < USDC_DECIMALS) {
    return (integer * 10n ** BigInt(USDC_DECIMALS - decimals)).toString(10);
  }
  // decimals > USDC_DECIMALS: truncate excess precision (should not occur for USD source)
  return (integer / 10n ** BigInt(decimals - USDC_DECIMALS)).toString(10);
}

function formatUsdcAmount(atomic: string): string {
  const value = BigInt(atomic);
  const whole = value / USDC_SCALE;
  const fractional = (value % USDC_SCALE).toString(10).padStart(USDC_DECIMALS, "0");
  return `${whole.toString(10)}.${fractional}`;
}
