import { z } from "zod";

import { ARC_TESTNET_BLOCKCHAIN, createCircleArcReadOnlyClient } from "./circle-arc-client";
import {
  J0D_INTENT_VERSION,
  J0D_MAX_NETWORK_FEE,
  J0D_MAX_TOTAL_DEBIT,
  J0D_SPIKE_AMOUNT,
  J0D_SPIKE_ASSET,
  J0D_SPIKE_CLASSIFICATION,
  J0D_SPIKE_FEE_LEVEL,
  MAX_PROVIDER_NUMERIC_LENGTH,
  atomicToDecimalAtScale,
  computeJ0dExecutionIdentity,
  computeJ0dIntentFingerprint,
  decimalToAtomicAtScale,
  evmAddressSchema,
  j0dExactIntentSchema,
  j0dExecutionIdentitySchema,
  j0dIdempotencyKeyForExecutionIdentity,
  j0dIntentFingerprintSchema,
  verifiedUsdcTokenSchema,
  walletIdSchema,
  type VerifiedUsdcToken,
} from "./intent";

export { J0D_SPIKE_AMOUNT, J0D_SPIKE_ASSET, J0D_SPIKE_FEE_LEVEL };

export const j0dResumeContextSchema = z.object({
  walletSetId: walletIdSchema,
  sourceWallet: z.object({ id: walletIdSchema, address: evmAddressSchema }).strict(),
  destinationWallet: z.object({ id: walletIdSchema, address: evmAddressSchema }).strict(),
}).strict().superRefine((context, issue) => {
  if (context.sourceWallet.id === context.destinationWallet.id) {
    issue.addIssue({ code: "custom", path: ["destinationWallet", "id"], message: "source and destination wallet ids must differ" });
  }
  if (context.sourceWallet.address.toLowerCase() === context.destinationWallet.address.toLowerCase()) {
    issue.addIssue({ code: "custom", path: ["destinationWallet", "address"], message: "source and destination addresses must differ" });
  }
});
export type J0dResumeContext = z.infer<typeof j0dResumeContextSchema>;

const verifiedWalletSchema = z.object({
  id: walletIdSchema,
  address: evmAddressSchema,
  blockchain: z.literal(ARC_TESTNET_BLOCKCHAIN),
  wallet_set_id: walletIdSchema,
  state: z.literal("LIVE"),
}).strict();

export const j0dPreflightResultSchema = z.discriminatedUnion("readiness", [
  z.object({
    dispatch_profile: z.literal("J0_CONNECTIVITY_SPIKE"),
    action: z.literal("READ_ONLY_PREFLIGHT"),
    readiness: z.literal("READY_FOR_EXPLICIT_AUTHORIZATION"),
    source_wallet: verifiedWalletSchema,
    destination_wallet: verifiedWalletSchema,
    source_usdc_balance: z.string().min(1).max(128),
    source_usdc_token: verifiedUsdcTokenSchema,
    exact_intent: j0dExactIntentSchema,
    /** SHA-256 integrity binding over exact_intent. Not authorization. */
    intent_fingerprint: j0dIntentFingerprintSchema,
    execution_identity: j0dExecutionIdentitySchema,
    idempotency_key: z.string().uuid(),
    captured_at: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({
    dispatch_profile: z.literal("J0_CONNECTIVITY_SPIKE"),
    action: z.literal("READ_ONLY_PREFLIGHT"),
    readiness: z.literal("AUTHORIZATION_CEILING_EXCEEDED"),
    source_wallet: verifiedWalletSchema,
    destination_wallet: verifiedWalletSchema,
    source_usdc_balance: z.string().min(1).max(128),
    source_usdc_token: verifiedUsdcTokenSchema,
    minimum_transfer_amount: z.literal(J0D_SPIKE_AMOUNT),
    estimated_network_fee: z.string().min(1).max(128),
    minimum_required_total: z.string().min(1).max(128),
    max_network_fee: z.literal(J0D_MAX_NETWORK_FEE),
    max_total_debit: z.literal(J0D_MAX_TOTAL_DEBIT),
    captured_at: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({
    dispatch_profile: z.literal("J0_CONNECTIVITY_SPIKE"),
    action: z.literal("READ_ONLY_PREFLIGHT"),
    readiness: z.literal("FUNDING_REQUIRED"),
    source_wallet: verifiedWalletSchema,
    destination_wallet: verifiedWalletSchema,
    source_usdc_balance: z.string().min(1).max(128),
    source_usdc_token: verifiedUsdcTokenSchema.nullable(),
    minimum_transfer_amount: z.literal(J0D_SPIKE_AMOUNT),
    estimated_network_fee: z.string().min(1).max(128).nullable(),
    minimum_required_total: z.string().min(1).max(128).nullable(),
    funding_address: evmAddressSchema,
    captured_at: z.string().datetime({ offset: true }),
  }).strict(),
  z.object({
    dispatch_profile: z.literal("J0_CONNECTIVITY_SPIKE"),
    action: z.literal("READ_ONLY_PREFLIGHT"),
    readiness: z.literal("BLOCKED_EXTERNAL"),
    blocker: z.enum([
      "CIRCLE_NOT_CONFIGURED",
      "PROVIDER_QUERY_FAILED",
      "FEE_ESTIMATE_FAILED",
      "SOURCE_WALLET_CONTEXT_MISMATCH",
      "DESTINATION_WALLET_CONTEXT_MISMATCH",
      "SOURCE_WALLET_NOT_LIVE",
      "DESTINATION_WALLET_NOT_LIVE",
      "INVALID_PROVIDER_TOKEN",
      "INVALID_PROVIDER_BALANCE",
      "INVALID_FEE_ESTIMATE",
    ]),
    message: z.string().min(1).max(500),
    captured_at: z.string().datetime({ offset: true }),
  }).strict(),
]);

export type J0dPreflightResult = z.infer<typeof j0dPreflightResultSchema>;

export function j0dPreflightHttpStatus(result: J0dPreflightResult): number {
  if (result.readiness !== "BLOCKED_EXTERNAL") return 200;
  if (result.blocker === "CIRCLE_NOT_CONFIGURED") return 503;
  if (result.blocker.endsWith("_CONTEXT_MISMATCH") || result.blocker.endsWith("_NOT_LIVE")) return 409;
  if (result.blocker.startsWith("INVALID_")) return 422;
  return 502;
}
type VerifiedWallet = z.infer<typeof verifiedWalletSchema>;

const providerWalletTruthSchema = z.object({
  id: z.string(),
  address: z.string(),
  blockchain: z.string(),
  walletSetId: z.string(),
  state: z.string(),
}).passthrough();

const providerWalletResponseSchema = z.object({
  data: z.object({ wallet: providerWalletTruthSchema }).passthrough(),
}).passthrough();

const providerTokenSchema = z.object({
  id: z.unknown().optional(),
  symbol: z.unknown().optional(),
  blockchain: z.unknown().optional(),
  decimals: z.unknown().optional(),
  isNative: z.unknown().optional(),
  tokenAddress: z.unknown().optional(),
}).passthrough();

const providerBalanceEntrySchema = z.object({
  amount: z.unknown().optional(),
  token: providerTokenSchema.optional(),
}).passthrough();

const providerBalanceResponseSchema = z.object({
  data: z.object({ tokenBalances: z.array(providerBalanceEntrySchema) }).passthrough(),
}).passthrough();

const providerFeeResponseSchema = z.object({
  data: z.object({
    medium: z.object({ networkFee: z.unknown().optional() }).passthrough().optional(),
  }).passthrough(),
}).passthrough();

type ProviderWalletTruth = z.infer<typeof providerWalletTruthSchema>;
type ProviderBalanceEntry = z.infer<typeof providerBalanceEntrySchema>;

export interface J0dPreflightClient {
  getWallet(input: { id: string }): Promise<unknown>;
  getWalletTokenBalance(input: { id: string; includeAll?: boolean }): Promise<unknown>;
  estimateTransferFee(input: {
    walletId: string;
    tokenId: string;
    amount: string[];
    destinationAddress: string;
  }): Promise<unknown>;
}

export interface RunJ0dPreflightOptions {
  client?: J0dPreflightClient;
  now?: () => Date;
}

function capturedAt(now: () => Date): string {
  return now().toISOString();
}

function blocked(
  blocker: Extract<J0dPreflightResult, { readiness: "BLOCKED_EXTERNAL" }>["blocker"],
  message: string,
  now: () => Date,
): J0dPreflightResult {
  return j0dPreflightResultSchema.parse({
    dispatch_profile: "J0_CONNECTIVITY_SPIKE",
    action: "READ_ONLY_PREFLIGHT",
    readiness: "BLOCKED_EXTERNAL",
    blocker,
    message: message.slice(0, 500),
    captured_at: capturedAt(now),
  });
}

function normalizeWallet(
  expected: { id: string; address: string },
  expectedWalletSetId: string,
  wallet: ProviderWalletTruth,
  mismatchBlocker: "SOURCE_WALLET_CONTEXT_MISMATCH" | "DESTINATION_WALLET_CONTEXT_MISMATCH",
  notLiveBlocker: "SOURCE_WALLET_NOT_LIVE" | "DESTINATION_WALLET_NOT_LIVE",
  now: () => Date,
): { ok: true; wallet: VerifiedWallet } | { ok: false; result: J0dPreflightResult } {
  if (
    wallet.id !== expected.id ||
    wallet.address?.toLowerCase() !== expected.address.toLowerCase() ||
    wallet.blockchain !== ARC_TESTNET_BLOCKCHAIN ||
    wallet.walletSetId !== expectedWalletSetId
  ) {
    return { ok: false, result: blocked(mismatchBlocker, "Circle wallet truth does not match the recovered J0-D context.", now) };
  }
  if (wallet.state !== "LIVE") {
    return { ok: false, result: blocked(notLiveBlocker, "Circle wallet is not LIVE.", now) };
  }
  return {
    ok: true,
    wallet: verifiedWalletSchema.parse({
      id: wallet.id,
      address: wallet.address,
      blockchain: wallet.blockchain,
      wallet_set_id: wallet.walletSetId,
      state: wallet.state,
    }),
  };
}

function normalizeProviderSymbol(value: unknown): string | null {
  return typeof value === "string" ? value.trim().toUpperCase() : null;
}

function pinNativeArcUsdc(
  balances: ProviderBalanceEntry[],
  now: () => Date,
): { kind: "NONE" } | { kind: "BLOCKED"; result: J0dPreflightResult } | {
  kind: "PINNED";
  amount: string;
  token: VerifiedUsdcToken;
} {
  const candidates = balances.filter((balance) => {
    const token = balance.token;
    if (!token) return true;
    const symbol = normalizeProviderSymbol(token.symbol);
    return symbol === J0D_SPIKE_ASSET || token.isNative !== false;
  });
  if (candidates.length === 0) return { kind: "NONE" };

  const pinned = candidates.filter((balance) => {
    const token = balance.token;
    return normalizeProviderSymbol(token?.symbol) === J0D_SPIKE_ASSET &&
      token?.blockchain === ARC_TESTNET_BLOCKCHAIN &&
      token.isNative === true;
  });
  if (pinned.length !== 1) {
    return {
      kind: "BLOCKED",
      result: blocked("INVALID_PROVIDER_TOKEN", "Circle did not return exactly one valid native ARC-TESTNET USDC balance entry.", now),
    };
  }

  const balance = pinned[0];
  const token = balance.token;
  if (
    typeof token?.id !== "string" || !token.id ||
    typeof token.decimals !== "number" || !Number.isSafeInteger(token.decimals) || token.decimals < 0 || token.decimals > 36 ||
    typeof balance.amount !== "string" ||
    (token.tokenAddress !== undefined && token.tokenAddress !== null && typeof token.tokenAddress !== "string")
  ) {
    return { kind: "BLOCKED", result: blocked("INVALID_PROVIDER_TOKEN", "Circle native Arc USDC token metadata is incomplete or invalid.", now) };
  }

  const parsedToken = verifiedUsdcTokenSchema.safeParse({
    id: token.id,
    symbol: J0D_SPIKE_ASSET,
    blockchain: ARC_TESTNET_BLOCKCHAIN,
    is_native: true,
    decimals: token.decimals,
    token_address: token.tokenAddress ?? null,
  });
  if (!parsedToken.success) {
    return { kind: "BLOCKED", result: blocked("INVALID_PROVIDER_TOKEN", "Circle native Arc USDC token metadata is outside the accepted bounds.", now) };
  }

  return {
    kind: "PINNED",
    amount: balance.amount,
    token: parsedToken.data,
  };
}

function fundingRequired(
  source: VerifiedWallet,
  destination: VerifiedWallet,
  balance: string,
  token: VerifiedUsdcToken | null,
  now: () => Date,
  estimatedNetworkFee: string | null = null,
  minimumRequiredTotal: string | null = null,
): J0dPreflightResult {
  return j0dPreflightResultSchema.parse({
    dispatch_profile: "J0_CONNECTIVITY_SPIKE",
    action: "READ_ONLY_PREFLIGHT",
    readiness: "FUNDING_REQUIRED",
    source_wallet: source,
    destination_wallet: destination,
    source_usdc_balance: balance,
    source_usdc_token: token,
    minimum_transfer_amount: J0D_SPIKE_AMOUNT,
    estimated_network_fee: estimatedNetworkFee,
    minimum_required_total: minimumRequiredTotal,
    funding_address: source.address,
    captured_at: capturedAt(now),
  });
}

export async function runJ0dPreflight(
  rawContext: J0dResumeContext,
  options: RunJ0dPreflightOptions = {},
): Promise<J0dPreflightResult> {
  const now = options.now ?? (() => new Date());
  const context = j0dResumeContextSchema.parse(rawContext);

  let client = options.client;
  if (!client) {
    if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
      return blocked("CIRCLE_NOT_CONFIGURED", "Circle credentials are not configured in this runtime; provider truth was not queried.", now);
    }
    client = createCircleArcReadOnlyClient();
  }

  let sourceResponse: unknown;
  let destinationResponse: unknown;
  let balanceResponse: unknown;
  try {
    [sourceResponse, destinationResponse, balanceResponse] = await Promise.all([
      client.getWallet({ id: context.sourceWallet.id }),
      client.getWallet({ id: context.destinationWallet.id }),
      client.getWalletTokenBalance({ id: context.sourceWallet.id, includeAll: true }),
    ]);
  } catch (error) {
    const name = error instanceof Error ? error.name : "ProviderError";
    return blocked("PROVIDER_QUERY_FAILED", `Circle read-only wallet/balance query failed (${name}).`, now);
  }

  const parsedSourceResponse = providerWalletResponseSchema.safeParse(sourceResponse);
  const parsedDestinationResponse = providerWalletResponseSchema.safeParse(destinationResponse);
  if (!parsedSourceResponse.success || !parsedDestinationResponse.success) {
    return blocked("PROVIDER_QUERY_FAILED", "Circle returned a malformed wallet response during read-only preflight.", now);
  }
  const parsedBalanceResponse = providerBalanceResponseSchema.safeParse(balanceResponse);
  if (!parsedBalanceResponse.success) {
    return blocked("INVALID_PROVIDER_BALANCE", "Circle returned a malformed token-balance response during read-only preflight.", now);
  }

  const source = normalizeWallet(context.sourceWallet, context.walletSetId, parsedSourceResponse.data.data.wallet, "SOURCE_WALLET_CONTEXT_MISMATCH", "SOURCE_WALLET_NOT_LIVE", now);
  if (!source.ok) return source.result;
  const destination = normalizeWallet(context.destinationWallet, context.walletSetId, parsedDestinationResponse.data.data.wallet, "DESTINATION_WALLET_CONTEXT_MISMATCH", "DESTINATION_WALLET_NOT_LIVE", now);
  if (!destination.ok) return destination.result;

  const pinnedUsdc = pinNativeArcUsdc(parsedBalanceResponse.data.data.tokenBalances, now);
  if (pinnedUsdc.kind === "BLOCKED") return pinnedUsdc.result;
  if (pinnedUsdc.kind === "NONE") return fundingRequired(source.wallet, destination.wallet, "0", null, now);

  const balanceAtomic = decimalToAtomicAtScale(pinnedUsdc.amount, pinnedUsdc.token.decimals);
  const transferAtomic = decimalToAtomicAtScale(J0D_SPIKE_AMOUNT, pinnedUsdc.token.decimals);
  if (balanceAtomic === null || transferAtomic === null) {
    return blocked("INVALID_PROVIDER_BALANCE", "Circle native Arc USDC balance or token decimals could not be represented exactly.", now);
  }
  if (balanceAtomic < transferAtomic) {
    return fundingRequired(source.wallet, destination.wallet, pinnedUsdc.amount, pinnedUsdc.token, now);
  }

  let feeResponse: unknown;
  try {
    feeResponse = await client.estimateTransferFee({
      walletId: source.wallet.id,
      tokenId: pinnedUsdc.token.id,
      amount: [J0D_SPIKE_AMOUNT],
      destinationAddress: destination.wallet.address,
    });
  } catch (error) {
    const name = error instanceof Error ? error.name : "ProviderError";
    return blocked("FEE_ESTIMATE_FAILED", `Circle read-only transfer-fee estimate failed (${name}).`, now);
  }

  const parsedFeeResponse = providerFeeResponseSchema.safeParse(feeResponse);
  if (!parsedFeeResponse.success) {
    return blocked("INVALID_FEE_ESTIMATE", "Circle returned a malformed transfer-fee response.", now);
  }
  const estimatedNetworkFee = parsedFeeResponse.data.data.medium?.networkFee;
  if (typeof estimatedNetworkFee !== "string") {
    return blocked("INVALID_FEE_ESTIMATE", "Circle did not return a MEDIUM network fee estimate for the contemplated transfer.", now);
  }
  const feeAtomic = decimalToAtomicAtScale(estimatedNetworkFee, pinnedUsdc.token.decimals);
  if (feeAtomic === null || feeAtomic <= 0n) {
    return blocked("INVALID_FEE_ESTIMATE", "Circle returned a non-positive or non-representable network fee for the contemplated transfer.", now);
  }

  const minimumRequiredAtomic = transferAtomic + feeAtomic;
  const minimumRequiredTotal = atomicToDecimalAtScale(minimumRequiredAtomic, pinnedUsdc.token.decimals);
  if (minimumRequiredTotal.length > MAX_PROVIDER_NUMERIC_LENGTH) {
    return blocked("INVALID_FEE_ESTIMATE", "The computed transfer-plus-fee total exceeds the accepted numeric bound.", now);
  }
  const maxFeeAtomic = decimalToAtomicAtScale(J0D_MAX_NETWORK_FEE, pinnedUsdc.token.decimals);
  const maxTotalAtomic = decimalToAtomicAtScale(J0D_MAX_TOTAL_DEBIT, pinnedUsdc.token.decimals);
  if (maxFeeAtomic === null || maxTotalAtomic === null) {
    return blocked("INVALID_FEE_ESTIMATE", "The fixed authorization ceilings are not representable at the provider token scale.", now);
  }
  if (feeAtomic > maxFeeAtomic || minimumRequiredAtomic > maxTotalAtomic) {
    return j0dPreflightResultSchema.parse({
      dispatch_profile: "J0_CONNECTIVITY_SPIKE",
      action: "READ_ONLY_PREFLIGHT",
      readiness: "AUTHORIZATION_CEILING_EXCEEDED",
      source_wallet: source.wallet,
      destination_wallet: destination.wallet,
      source_usdc_balance: pinnedUsdc.amount,
      source_usdc_token: pinnedUsdc.token,
      minimum_transfer_amount: J0D_SPIKE_AMOUNT,
      estimated_network_fee: estimatedNetworkFee,
      minimum_required_total: minimumRequiredTotal,
      max_network_fee: J0D_MAX_NETWORK_FEE,
      max_total_debit: J0D_MAX_TOTAL_DEBIT,
      captured_at: capturedAt(now),
    });
  }
  if (balanceAtomic < minimumRequiredAtomic) {
    return fundingRequired(
      source.wallet,
      destination.wallet,
      pinnedUsdc.amount,
      pinnedUsdc.token,
      now,
      estimatedNetworkFee,
      minimumRequiredTotal,
    );
  }

  const readAt = capturedAt(now);
  const exactIntent = j0dExactIntentSchema.safeParse({
    intent_version: J0D_INTENT_VERSION,
    classification: J0D_SPIKE_CLASSIFICATION,
    network: ARC_TESTNET_BLOCKCHAIN,
    asset: J0D_SPIKE_ASSET,
    amount: J0D_SPIKE_AMOUNT,
    fee_level: J0D_SPIKE_FEE_LEVEL,
    estimated_network_fee: estimatedNetworkFee,
    minimum_required_total: minimumRequiredTotal,
    max_network_fee: J0D_MAX_NETWORK_FEE,
    max_total_debit: J0D_MAX_TOTAL_DEBIT,
    wallet_set_id: source.wallet.wallet_set_id,
    source_wallet_id: source.wallet.id,
    source_wallet_address: source.wallet.address,
    destination_wallet_id: destination.wallet.id,
    destination_wallet_address: destination.wallet.address,
    provider_token: pinnedUsdc.token,
    preflight_captured_at: readAt,
  });
  if (!exactIntent.success) {
    return blocked("INVALID_FEE_ESTIMATE", "The contemplated transfer intent could not be represented exactly from provider truth.", now);
  }

  return j0dPreflightResultSchema.parse({
    dispatch_profile: "J0_CONNECTIVITY_SPIKE",
    action: "READ_ONLY_PREFLIGHT",
    readiness: "READY_FOR_EXPLICIT_AUTHORIZATION",
    source_wallet: source.wallet,
    destination_wallet: destination.wallet,
    source_usdc_balance: pinnedUsdc.amount,
    source_usdc_token: pinnedUsdc.token,
    exact_intent: exactIntent.data,
    intent_fingerprint: computeJ0dIntentFingerprint(exactIntent.data),
    execution_identity: computeJ0dExecutionIdentity(exactIntent.data),
    idempotency_key: j0dIdempotencyKeyForExecutionIdentity(computeJ0dExecutionIdentity(exactIntent.data)),
    captured_at: readAt,
  });
}
