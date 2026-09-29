import { z } from "zod";

import { ARC_TESTNET_BLOCKCHAIN, createCircleArcReadOnlyClient } from "./circle-arc-client";
import type { J0dResumeContext } from "./connectivity-spike";

export const J0D_SPIKE_AMOUNT = "0.01" as const;
export const J0D_SPIKE_ASSET = "USDC" as const;
export const J0D_SPIKE_FEE_LEVEL = "MEDIUM" as const;

const walletIdSchema = z.string().min(1).max(128);
const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const tokenIdSchema = z.string().min(1).max(256);

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

const verifiedWalletSchema = z.object({
  id: walletIdSchema,
  address: evmAddressSchema,
  blockchain: z.literal(ARC_TESTNET_BLOCKCHAIN),
  wallet_set_id: walletIdSchema,
  state: z.literal("LIVE"),
}).strict();

const verifiedUsdcTokenSchema = z.object({
  id: tokenIdSchema,
  symbol: z.literal(J0D_SPIKE_ASSET),
  blockchain: z.literal(ARC_TESTNET_BLOCKCHAIN),
  is_native: z.literal(true),
  decimals: z.number().int().min(0).max(36),
  token_address: z.string().max(256).nullable(),
}).strict();

const exactIntentSchema = z.object({
  classification: z.literal("INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION"),
  network: z.literal(ARC_TESTNET_BLOCKCHAIN),
  asset: z.literal(J0D_SPIKE_ASSET),
  amount: z.literal(J0D_SPIKE_AMOUNT),
  fee_level: z.literal(J0D_SPIKE_FEE_LEVEL),
  estimated_network_fee: z.string().min(1).max(128),
  minimum_required_total: z.string().min(1).max(128),
  source_wallet_id: walletIdSchema,
  source_wallet_address: evmAddressSchema,
  destination_wallet_id: walletIdSchema,
  destination_wallet_address: evmAddressSchema,
  provider_token: verifiedUsdcTokenSchema,
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
    exact_intent: exactIntentSchema,
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
type VerifiedUsdcToken = z.infer<typeof verifiedUsdcTokenSchema>;

interface ProviderToken {
  id?: string;
  symbol?: string;
  blockchain?: string;
  decimals?: number;
  isNative?: boolean;
  tokenAddress?: string;
}

export interface J0dPreflightClient {
  getWallet(input: { id: string }): Promise<{
    data?: { wallet?: { id?: string; address?: string; blockchain?: string; walletSetId?: string; state?: string } };
  }>;
  getWalletTokenBalance(input: { id: string; includeAll?: boolean }): Promise<{
    data?: { tokenBalances?: Array<{ amount?: string; token?: ProviderToken }> };
  }>;
  estimateTransferFee(input: {
    walletId: string;
    tokenId: string;
    amount: string[];
    destinationAddress: string;
  }): Promise<{ data?: { medium?: { networkFee?: string } } }>;
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
  wallet: NonNullable<NonNullable<Awaited<ReturnType<J0dPreflightClient["getWallet"]>>["data"]>["wallet"]>,
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

function decimalToAtomicAtScale(value: string, decimals: number): bigint | null {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > 36 || typeof value !== "string") return null;
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) return null;
  return BigInt(match[1]) * 10n ** BigInt(decimals) + BigInt((fraction || "0").padEnd(decimals, "0"));
}

function atomicToDecimalAtScale(value: bigint, decimals: number): string {
  if (decimals === 0) return value.toString(10);
  const divisor = 10n ** BigInt(decimals);
  const whole = value / divisor;
  const fraction = (value % divisor).toString(10).padStart(decimals, "0");
  return `${whole.toString(10)}.${fraction}`;
}

function pinNativeArcUsdc(
  balances: Array<{ amount?: string; token?: ProviderToken }>,
  now: () => Date,
): { kind: "NONE" } | { kind: "BLOCKED"; result: J0dPreflightResult } | {
  kind: "PINNED";
  amount: string;
  token: VerifiedUsdcToken;
} {
  const candidates = balances.filter((balance) => {
    const token = balance.token;
    return token?.symbol === J0D_SPIKE_ASSET ||
      (token?.blockchain === ARC_TESTNET_BLOCKCHAIN && token.isNative === true);
  });
  if (candidates.length === 0) return { kind: "NONE" };

  const pinned = candidates.filter((balance) => {
    const token = balance.token;
    return token?.symbol === J0D_SPIKE_ASSET &&
      token.blockchain === ARC_TESTNET_BLOCKCHAIN &&
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
    !token?.id ||
    !Number.isSafeInteger(token.decimals) || token.decimals! < 0 || token.decimals! > 36 ||
    typeof balance.amount !== "string"
  ) {
    return { kind: "BLOCKED", result: blocked("INVALID_PROVIDER_TOKEN", "Circle native Arc USDC token metadata is incomplete or invalid.", now) };
  }

  const parsedToken = verifiedUsdcTokenSchema.safeParse({
    id: token.id,
    symbol: token.symbol,
    blockchain: token.blockchain,
    is_native: token.isNative,
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

  let sourceResponse: Awaited<ReturnType<J0dPreflightClient["getWallet"]>>;
  let destinationResponse: Awaited<ReturnType<J0dPreflightClient["getWallet"]>>;
  let balanceResponse: Awaited<ReturnType<J0dPreflightClient["getWalletTokenBalance"]>>;
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

  const sourceProviderWallet = sourceResponse.data?.wallet;
  const destinationProviderWallet = destinationResponse.data?.wallet;
  if (!sourceProviderWallet) return blocked("SOURCE_WALLET_CONTEXT_MISMATCH", "Circle did not return the recovered source wallet.", now);
  if (!destinationProviderWallet) return blocked("DESTINATION_WALLET_CONTEXT_MISMATCH", "Circle did not return the recovered destination wallet.", now);

  const source = normalizeWallet(context.sourceWallet, context.walletSetId, sourceProviderWallet, "SOURCE_WALLET_CONTEXT_MISMATCH", "SOURCE_WALLET_NOT_LIVE", now);
  if (!source.ok) return source.result;
  const destination = normalizeWallet(context.destinationWallet, context.walletSetId, destinationProviderWallet, "DESTINATION_WALLET_CONTEXT_MISMATCH", "DESTINATION_WALLET_NOT_LIVE", now);
  if (!destination.ok) return destination.result;

  const pinnedUsdc = pinNativeArcUsdc(balanceResponse.data?.tokenBalances ?? [], now);
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

  let feeResponse: Awaited<ReturnType<J0dPreflightClient["estimateTransferFee"]>>;
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

  const estimatedNetworkFee = feeResponse.data?.medium?.networkFee;
  if (typeof estimatedNetworkFee !== "string") {
    return blocked("INVALID_FEE_ESTIMATE", "Circle did not return a MEDIUM network fee estimate for the contemplated transfer.", now);
  }
  const feeAtomic = decimalToAtomicAtScale(estimatedNetworkFee, pinnedUsdc.token.decimals);
  if (feeAtomic === null) {
    return blocked("INVALID_FEE_ESTIMATE", "Circle returned a network fee that could not be represented exactly in the native Arc USDC scale.", now);
  }

  const minimumRequiredAtomic = transferAtomic + feeAtomic;
  const minimumRequiredTotal = atomicToDecimalAtScale(minimumRequiredAtomic, pinnedUsdc.token.decimals);
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

  return j0dPreflightResultSchema.parse({
    dispatch_profile: "J0_CONNECTIVITY_SPIKE",
    action: "READ_ONLY_PREFLIGHT",
    readiness: "READY_FOR_EXPLICIT_AUTHORIZATION",
    source_wallet: source.wallet,
    destination_wallet: destination.wallet,
    source_usdc_balance: pinnedUsdc.amount,
    source_usdc_token: pinnedUsdc.token,
    exact_intent: {
      classification: "INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION",
      network: ARC_TESTNET_BLOCKCHAIN,
      asset: J0D_SPIKE_ASSET,
      amount: J0D_SPIKE_AMOUNT,
      fee_level: J0D_SPIKE_FEE_LEVEL,
      estimated_network_fee: estimatedNetworkFee,
      minimum_required_total: minimumRequiredTotal,
      source_wallet_id: source.wallet.id,
      source_wallet_address: source.wallet.address,
      destination_wallet_id: destination.wallet.id,
      destination_wallet_address: destination.wallet.address,
      provider_token: pinnedUsdc.token,
    },
    captured_at: capturedAt(now),
  });
}
