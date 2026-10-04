import { createHash } from "node:crypto";
import { z } from "zod";

import { createCircleArcJ2aExecutionClient } from "../j0d-spike/circle-arc-client";
import {
  J2A_DEMO_DESTINATION,
  J2A_DEMO_SOURCE,
  J2A_TRANSFER_AMOUNT,
  runJ2aReadOnlyPreflight,
  type J2aPreflightResult,
} from "../demo/real-testnet-payment";
import { USDC_DECIMALS, atomicToDecimal, decimalToAtomic } from "../domain/numeric";

/**
 * Provider adapter boundary: the only place allowed to talk to a real
 * payment rail. FakeProviderAdapter is deterministic for tests and the mocked
 * golden path; ArcCircleProviderAdapter is restricted to the admitted J2A
 * Arc Testnet demonstration lane.
 *
 * This adapter cannot create wallets or request testnet funds. It checks the
 * fixed J2A wallet pair and a fresh read-only preflight before one idempotent
 * transfer request, and uses read-only calls for later reconciliation.
 */

export interface SubmitTransferParams {
  idempotencyKey: string;
  sourceWalletRef: string;
  destinationAddress: string;
  atomicAmount: string;
  asset: "USDC";
  network: "ARC_TESTNET";
}

export type ProviderTransferStatus = "SUBMITTED" | "UNKNOWN";
export type ProviderStatusResult = "PENDING" | "CONFIRMED" | "FAILED" | "UNKNOWN";

export interface SubmitTransferResult {
  providerRef: string;
  status: ProviderTransferStatus;
}

export interface StatusResult {
  status: ProviderStatusResult;
  destinationAddress?: string;
  atomicAmount?: string;
}

export interface ProviderAdapter {
  readonly name: string;
  submitTransfer(params: SubmitTransferParams): Promise<SubmitTransferResult>;
  getStatus(providerRef: string): Promise<StatusResult>;
  getStatusByIdempotencyKey?(idempotencyKey: string): Promise<StatusResult>;
}

/** Rejection before any provider write was attempted; the worker may safely mark the intent BLOCKED. */
export class ProviderPreSubmitBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderPreSubmitBlockedError";
  }
}

export class ProviderNotConfiguredError extends ProviderPreSubmitBlockedError {
  constructor(message: string) {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

export interface J2aCircleClient {
  getWallet(input: { id: string }): Promise<unknown>;
  getWalletTokenBalance(input: { id: string; includeAll?: boolean }): Promise<unknown>;
  estimateTransferFee(input: { walletId: string; tokenId: string; amount: string[]; destinationAddress: string }): Promise<unknown>;
  listTransactions(input: { blockchain: string; txType: "OUTBOUND"; walletIds: string[]; pageSize: number; order: "DESC" }): Promise<unknown>;
  getTransaction(input: { id: string }): Promise<unknown>;
  createTransaction(input: { amount: string[]; destinationAddress: string; tokenId: string; walletId: string; fee: { type: "level"; config: { feeLevel: "MEDIUM" } }; idempotencyKey: string; refId: string }): Promise<unknown>;
}

function circleIdempotencyUuid(key: string): string {
  const bytes = createHash("sha256").update(`tameion-j2a-circle-idempotency:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const circleTransactionSchema = z.object({
  data: z.object({ transaction: z.object({
    id: z.string().optional(), state: z.string().optional(), destinationAddress: z.string().optional(),
    amounts: z.array(z.string()).optional(), tokenId: z.string().optional(), walletId: z.string().optional(),
    blockchain: z.string().optional(), refId: z.string().optional(), txHash: z.string().optional(),
  }).passthrough().optional() }).passthrough(),
}).passthrough();
const createdTransactionSchema = z.object({ data: z.object({ id: z.string() }).passthrough() }).passthrough();
const listedTransactionsSchema = z.object({ data: z.object({ transactions: z.array(z.unknown()) }).passthrough() }).passthrough();
const tokenBalancesSchema = z.object({ data: z.object({ tokenBalances: z.array(z.object({
  token: z.object({ id: z.unknown(), symbol: z.unknown(), blockchain: z.unknown(), decimals: z.unknown(), isNative: z.unknown(), tokenAddress: z.unknown() }).passthrough(),
}).passthrough()) }).passthrough() }).passthrough();

function statusForCircleTransaction(value: unknown, tokenId: string): StatusResult {
  const parsed = circleTransactionSchema.safeParse(value);
  if (!parsed.success || !parsed.data.data.transaction) return { status: "UNKNOWN" };
  const tx = parsed.data.data.transaction;
  if (["FAILED", "DENIED", "CANCELLED", "STUCK"].includes(tx.state ?? "")) return { status: "FAILED" };
  if (tx.state !== "COMPLETE") return { status: "PENDING" };
  if (tx.blockchain !== "ARC-TESTNET" || tx.walletId !== J2A_DEMO_SOURCE.id ||
      tx.tokenId !== tokenId || tx.destinationAddress === undefined || !tx.amounts || tx.amounts.length !== 1) {
    return { status: "UNKNOWN" };
  }
  try {
    return {
      status: "CONFIRMED",
      destinationAddress: tx.destinationAddress,
      atomicAmount: decimalToAtomic(tx.amounts[0], USDC_DECIMALS),
    };
  } catch {
    return { status: "UNKNOWN" };
  }
}

export class ArcCircleProviderAdapter implements ProviderAdapter {
  readonly name = "arc-circle-live";

  constructor(
    private readonly suppliedClient?: J2aCircleClient,
    private readonly authorizedPreflight?: () => J2aPreflightResult | null,
  ) {}

  private client(): J2aCircleClient {
    if (this.suppliedClient) return this.suppliedClient;
    if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
      throw new ProviderNotConfiguredError("ArcCircleProviderAdapter requires server-side CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET.");
    }
    return createCircleArcJ2aExecutionClient() as unknown as J2aCircleClient;
  }

  async submitTransfer(params: SubmitTransferParams): Promise<SubmitTransferResult> {
    if (params.network !== "ARC_TESTNET" || params.asset !== "USDC" ||
        params.sourceWalletRef !== J2A_DEMO_SOURCE.id ||
        params.destinationAddress.toLowerCase() !== J2A_DEMO_DESTINATION.address.toLowerCase() ||
        params.atomicAmount !== "5000000" || atomicToDecimal(params.atomicAmount, USDC_DECIMALS) !== J2A_TRANSFER_AMOUNT) {
      throw new ProviderNotConfiguredError("Circle adapter accepts only the fixed J2A Arc Testnet demonstration intent.");
    }
    const client = this.client();
    const preflight = await runJ2aReadOnlyPreflight(client);
    if (preflight.readiness !== "READY" || preflight.source_wallet.id !== params.sourceWalletRef ||
        preflight.destination_wallet.address.toLowerCase() !== params.destinationAddress.toLowerCase() || preflight.amount !== J2A_TRANSFER_AMOUNT) {
      throw new ProviderPreSubmitBlockedError("Fresh Circle preflight did not confirm the fixed J2A transfer intent.");
    }
    const authorized = this.authorizedPreflight?.();
    if (!authorized || authorized.readiness !== "READY" ||
        preflight.provider_token.id !== authorized.provider_token.id ||
        preflight.source_balance !== authorized.source_balance ||
        preflight.estimated_network_fee !== authorized.estimated_network_fee ||
        preflight.max_network_fee !== authorized.max_network_fee || preflight.max_total_debit !== authorized.max_total_debit) {
      throw new ProviderPreSubmitBlockedError("Fresh Circle token or fee evidence differs from the Prime-reviewed J2A intent.");
    }
    const response = await client.createTransaction({
      amount: [J2A_TRANSFER_AMOUNT],
      destinationAddress: J2A_DEMO_DESTINATION.address,
      tokenId: preflight.provider_token.id,
      walletId: J2A_DEMO_SOURCE.id,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey: circleIdempotencyUuid(params.idempotencyKey),
      refId: params.idempotencyKey,
    });
    const created = createdTransactionSchema.safeParse(response);
    if (!created.success) throw new Error("Circle createTransaction returned an invalid response.");
    return { providerRef: created.data.data.id, status: "SUBMITTED" };
  }

  async getStatus(providerRef: string): Promise<StatusResult> {
    const client = this.client();
    const balances = tokenBalancesSchema.safeParse(await client.getWalletTokenBalance({ id: J2A_DEMO_SOURCE.id, includeAll: true }));
    if (!balances.success) return { status: "UNKNOWN" };
    const nativeUsdc = balances.data.data.tokenBalances.filter(({ token }) => token.symbol === "USDC" &&
      token.blockchain === "ARC-TESTNET" && token.decimals === 6 && token.isNative === true && token.tokenAddress === null &&
      typeof token.id === "string" && token.id.length > 0);
    if (nativeUsdc.length !== 1 || typeof nativeUsdc[0].token.id !== "string") return { status: "UNKNOWN" };
    return statusForCircleTransaction(await client.getTransaction({ id: providerRef }), nativeUsdc[0].token.id);
  }

  async getStatusByIdempotencyKey(idempotencyKey: string): Promise<StatusResult> {
    const response = listedTransactionsSchema.safeParse(await this.client().listTransactions({
      blockchain: "ARC-TESTNET", txType: "OUTBOUND", walletIds: [J2A_DEMO_SOURCE.id], pageSize: 50, order: "DESC",
    }));
    if (!response.success) return { status: "UNKNOWN" };
    const found = response.data.data.transactions.find((value) => {
      const item = z.object({ refId: z.unknown().optional() }).passthrough().safeParse(value);
      return item.success && item.data.refId === idempotencyKey;
    });
    if (!found) return { status: "UNKNOWN" };
    const transaction = z.object({ id: z.unknown().optional() }).passthrough().safeParse(found);
    if (!transaction.success || typeof transaction.data.id !== "string") return { status: "UNKNOWN" };
    return this.getStatus(transaction.data.id);
  }
}
