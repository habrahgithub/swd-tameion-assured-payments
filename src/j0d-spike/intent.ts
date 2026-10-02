import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { z } from "zod";

/**
 * Canonical J0-D exact-intent contract (#26).
 *
 * The read-only preflight is the only producer of this intent. The
 * state-changing spike accepts only an intent that parses against this
 * schema, is internally consistent, and matches its SHA-256 fingerprint;
 * it then re-derives the intent from current provider truth and refuses to
 * submit unless the immutable transfer fields still match and current fee
 * evidence remains within the fixed authorization ceilings.
 *
 * The fingerprint is an integrity binding only. Possessing it is not human
 * authorization.
 *
 * This module is deliberately independent of `src/pae/*`: the J0-D spike is
 * infrastructure evidence, never product execution.
 */

export const ARC_TESTNET = "ARC-TESTNET" as const;
export const J0D_SPIKE_AMOUNT = "0.01" as const;
export const J0D_SPIKE_ASSET = "USDC" as const;
export const J0D_SPIKE_FEE_LEVEL = "MEDIUM" as const;
export const J0D_INTENT_VERSION = "J0D-EXACT-INTENT-v2" as const;
export const J0D_MAX_NETWORK_FEE = "0.002" as const;
export const J0D_MAX_TOTAL_DEBIT = "0.012" as const;
export const J0D_SPIKE_CLASSIFICATION = "INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION" as const;
export const MAX_PROVIDER_NUMERIC_LENGTH = 128;

export const walletIdSchema = z.string().min(1).max(128);
export const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const tokenIdSchema = z.string().min(1).max(256);
const decimalStringSchema = z.string().min(1).max(MAX_PROVIDER_NUMERIC_LENGTH).regex(/^(0|[1-9][0-9]*)(\.[0-9]+)?$/);

export const verifiedUsdcTokenSchema = z.object({
  id: tokenIdSchema,
  symbol: z.literal(J0D_SPIKE_ASSET),
  blockchain: z.literal(ARC_TESTNET),
  is_native: z.literal(true),
  decimals: z.number().int().min(0).max(36),
  token_address: z.string().max(256).nullable(),
}).strict();
export type VerifiedUsdcToken = z.infer<typeof verifiedUsdcTokenSchema>;

/** Exact decimal -> atomic units at the provider-reported scale. Never floating point. */
export function decimalToAtomicAtScale(value: string, decimals: number): bigint | null {
  if (typeof value !== "string" || value.length > MAX_PROVIDER_NUMERIC_LENGTH) return null;
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36) return null;
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((fraction || "0").padEnd(decimals, "0"));
}

export function atomicToDecimalAtScale(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString(10);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString(10).padStart(decimals, "0");
  return `${whole.toString(10)}.${fraction}`;
}

export const j0dExactIntentSchema = z.object({
  intent_version: z.literal(J0D_INTENT_VERSION),
  classification: z.literal(J0D_SPIKE_CLASSIFICATION),
  network: z.literal(ARC_TESTNET),
  asset: z.literal(J0D_SPIKE_ASSET),
  amount: z.literal(J0D_SPIKE_AMOUNT),
  fee_level: z.literal(J0D_SPIKE_FEE_LEVEL),
  estimated_network_fee: decimalStringSchema,
  minimum_required_total: decimalStringSchema,
  max_network_fee: z.literal(J0D_MAX_NETWORK_FEE),
  max_total_debit: z.literal(J0D_MAX_TOTAL_DEBIT),
  wallet_set_id: walletIdSchema,
  source_wallet_id: walletIdSchema,
  source_wallet_address: evmAddressSchema,
  destination_wallet_id: walletIdSchema,
  destination_wallet_address: evmAddressSchema,
  provider_token: verifiedUsdcTokenSchema,
  /** Provider-evidence identity: when the preflight read the truth this intent was derived from. */
  preflight_captured_at: z.string().datetime({ offset: true }),
}).strict().superRefine((intent, ctx) => {
  if (intent.source_wallet_id === intent.destination_wallet_id) {
    ctx.addIssue({ code: "custom", path: ["destination_wallet_id"], message: "source and destination wallet ids must differ" });
  }
  if (intent.source_wallet_address.toLowerCase() === intent.destination_wallet_address.toLowerCase()) {
    ctx.addIssue({ code: "custom", path: ["destination_wallet_address"], message: "source and destination addresses must differ" });
  }
  const decimals = intent.provider_token.decimals;
  const amount = decimalToAtomicAtScale(intent.amount, decimals);
  const fee = decimalToAtomicAtScale(intent.estimated_network_fee, decimals);
  const total = decimalToAtomicAtScale(intent.minimum_required_total, decimals);
  if (amount === null || fee === null || total === null) {
    ctx.addIssue({ code: "custom", path: ["provider_token", "decimals"], message: "intent amounts must be exactly representable at the provider token scale" });
    return;
  }
  if (fee <= 0n) {
    ctx.addIssue({ code: "custom", path: ["estimated_network_fee"], message: "estimated network fee must be positive" });
  }
  if (total !== amount + fee) {
    ctx.addIssue({ code: "custom", path: ["minimum_required_total"], message: "minimum_required_total must equal amount + estimated_network_fee exactly" });
  }
  const maxFee = decimalToAtomicAtScale(J0D_MAX_NETWORK_FEE, decimals);
  const maxTotal = decimalToAtomicAtScale(J0D_MAX_TOTAL_DEBIT, decimals);
  if (maxFee === null || fee > maxFee) {
    ctx.addIssue({ code: "custom", path: ["estimated_network_fee"], message: "estimated_network_fee must not exceed the fixed max_network_fee" });
  }
  if (maxTotal === null || total > maxTotal) {
    ctx.addIssue({ code: "custom", path: ["minimum_required_total"], message: "minimum_required_total must not exceed the fixed max_total_debit" });
  }
});
export type J0dExactIntent = z.infer<typeof j0dExactIntentSchema>;

export const j0dIntentFingerprintSchema = z.string().regex(/^[0-9a-f]{64}$/);
export const j0dExecutionIdentitySchema = z.string().regex(/^[0-9a-f]{64}$/);

/** Lowercase hex SHA-256 over the RFC 8785 canonical JSON of the strictly parsed intent. */
export function computeJ0dIntentFingerprint(intent: J0dExactIntent): string {
  const parsed = j0dExactIntentSchema.parse(intent);
  return createHash("sha256").update(canonicalize(parsed), "utf8").digest("hex");
}

/** Stable identity for one immutable transfer, independent of fee freshness evidence. */
export function computeJ0dExecutionIdentity(intent: J0dExactIntent): string {
  const parsed = j0dExactIntentSchema.parse(intent);
  const stableExecution = {
    domain: "tameion-j0d-stable-execution-v2",
    classification: parsed.classification,
    network: parsed.network,
    asset: parsed.asset,
    amount: parsed.amount,
    fee_level: parsed.fee_level,
    wallet_set_id: parsed.wallet_set_id,
    source_wallet_id: parsed.source_wallet_id,
    source_wallet_address: parsed.source_wallet_address.toLowerCase(),
    destination_wallet_id: parsed.destination_wallet_id,
    destination_wallet_address: parsed.destination_wallet_address.toLowerCase(),
    provider_token: {
      id: parsed.provider_token.id,
      symbol: parsed.provider_token.symbol,
      blockchain: parsed.provider_token.blockchain,
      decimals: parsed.provider_token.decimals,
      is_native: parsed.provider_token.is_native,
      token_address: parsed.provider_token.token_address,
    },
  };
  return createHash("sha256").update(canonicalize(stableExecution), "utf8").digest("hex");
}

/**
 * Deterministic UUIDv4-shaped Circle idempotency key bound to immutable
 * execution identity, so refreshed fee evidence does not mint a new key.
 */
export function j0dIdempotencyKeyForExecutionIdentity(identity: string): string {
  const stableIdentity = j0dExecutionIdentitySchema.parse(identity);
  const bytes = createHash("sha256").update(`tameion-j0d-idempotency-v1:${stableIdentity}`, "utf8").digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Immutable transfer fields compared against re-derived provider truth. Fee and total are point-in-time evidence. */
export const J0D_MATERIAL_INTENT_FIELDS = [
  "intent_version",
  "classification",
  "network",
  "asset",
  "amount",
  "fee_level",
  "wallet_set_id",
  "source_wallet_id",
  "source_wallet_address",
  "destination_wallet_id",
  "destination_wallet_address",
  "provider_token",
] as const satisfies ReadonlyArray<keyof J0dExactIntent>;

export function diffMaterialIntentFields(approved: J0dExactIntent, current: J0dExactIntent): string[] {
  return J0D_MATERIAL_INTENT_FIELDS.filter((field) => {
    const a = approved[field];
    const b = current[field];
    if (field === "source_wallet_address" || field === "destination_wallet_address") {
      return String(a).toLowerCase() !== String(b).toLowerCase();
    }
    return canonicalize(a) !== canonicalize(b);
  });
}
