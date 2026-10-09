import { z } from "zod";

import { createCircleArcJ2aExecutionClient } from "../j0d-spike/circle-arc-client";
import {
  deriveJ2aCircleIdempotencyUuid,
  deriveJ2aCircleRefId,
  hashJ2aBusinessPaymentInstruction,
  hashJ2aPreflightEvidence,
  J2A_DEMO_DESTINATION,
  J2A_DEMO_SOURCE,
  J2A_MAX_NETWORK_FEE,
  J2A_TRANSFER_AMOUNT,
  type GenuineSettlementProxyIntent,
  j2aArcTestnetExplorerReference,
  runJ2aReadOnlyPreflight,
  type J2aPreflightResult,
} from "../demo/real-testnet-payment";
import { USDC_DECIMALS, atomicToDecimal, decimalToAtomic } from "../domain/numeric";
import { decimalToAtomicAtScale } from "../j0d-spike/intent";
import { sameEvmAddressIdentity } from "./evm-address";

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
  /** Worker-owned current-authority recheck, called after every async preflight and immediately before provider creation. */
  beforeProviderSend: () => Promise<void>;
}

export type ProviderTransferStatus = "SUBMITTED" | "UNKNOWN";
export type ProviderStatusResult = "PENDING" | "CONFIRMED" | "FAILED" | "UNKNOWN";

export interface SubmitTransferResult {
  providerRef: string;
  status: ProviderTransferStatus;
}

export interface StatusResult {
  status: ProviderStatusResult;
  /** Existing generic adapters use camelCase; retained for compatibility. */
  destinationAddress?: string;
  atomicAmount?: string;
  transaction_id?: string;
  transaction_state?: string;
  tx_hash?: string | null;
  explorer_reference?: string | null;
  wallet_id?: string;
  source_address?: string;
  destination_address?: string;
  token_id?: string;
  network?: string;
  amounts?: string[];
  atomic_amount?: string;
  /** Circle-native atomic quantity and scale, distinct from Tameion's 6-place settlement units. */
  provider_atomic_amount?: string;
  provider_token_decimals?: number;
  operation?: string;
  ref_id?: string;
  network_fee?: string | null;
  provider_created_at?: string | null;
  provider_updated_at?: string | null;
  reconciled_at?: string;
}

export interface ProviderAdapter {
  readonly name: string;
  submitTransfer(params: SubmitTransferParams): Promise<SubmitTransferResult>;
  getStatus(providerRef: string, idempotencyKey?: string): Promise<StatusResult>;
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
  listTransactions(input: { txType: "OUTBOUND"; walletIds: string[]; pageSize: number; order: "DESC" }): Promise<unknown>;
  getTransaction(input: { id: string }): Promise<unknown>;
  createTransaction(input: { amount: string[]; destinationAddress: string; tokenId: string; walletId: string; fee: { type: "level"; config: { feeLevel: "MEDIUM" } }; idempotencyKey: string; refId: string }): Promise<unknown>;
}

const circleTransactionSchema = z.object({
  data: z.object({ transaction: z.object({
    id: z.string().optional(), state: z.string().optional(), sourceAddress: z.string().optional(), destinationAddress: z.string().optional(),
    amounts: z.array(z.string()).optional(), tokenId: z.string().optional(), walletId: z.string().optional(),
    blockchain: z.string().optional(), refId: z.string().optional(), txHash: z.string().optional(),
    operation: z.string().optional(), networkFee: z.union([z.string(), z.number()]).optional(),
    createDate: z.string().optional(), updateDate: z.string().optional(),
  }).passthrough().optional() }).passthrough(),
}).passthrough();
const createdTransactionSchema = z.object({ data: z.object({ id: z.string() }).passthrough() }).passthrough();
const listedTransactionsSchema = z.object({ data: z.object({ transactions: z.array(z.unknown()) }).passthrough() }).passthrough();
const tokenBalancesSchema = z.object({ data: z.object({ tokenBalances: z.array(z.object({
  token: z.object({
    id: z.unknown().optional(), symbol: z.unknown().optional(), blockchain: z.unknown().optional(), decimals: z.unknown().optional(),
    isNative: z.unknown().optional(), tokenAddress: z.unknown().optional(),
  }).passthrough().optional(),
}).passthrough()) }).passthrough() }).passthrough();

function statusForCircleTransaction(
  value: unknown,
  tokenId: string,
  tokenDecimals: number,
  providerRef: string,
  expectedIdempotencyKey?: string,
  authorizedPreflight?: Extract<J2aPreflightResult, { readiness: "READY" }>,
): StatusResult {
  const parsed = circleTransactionSchema.safeParse(value);
  if (!parsed.success || !parsed.data.data.transaction) return { status: "UNKNOWN" };
  const tx = parsed.data.data.transaction;
  const expectedRefId = expectedIdempotencyKey ? deriveJ2aCircleRefId(expectedIdempotencyKey) : undefined;
  const fee = tx.networkFee === undefined ? undefined : String(tx.networkFee);
  const reconciledAt = new Date().toISOString();
  const evidence: Omit<StatusResult, "status"> = {
    ...(tx.id === undefined ? {} : { transaction_id: tx.id }),
    ...(tx.state === undefined ? {} : { transaction_state: tx.state }),
    tx_hash: tx.txHash ?? null,
    explorer_reference: j2aArcTestnetExplorerReference(tx.txHash),
    ...(tx.walletId === undefined ? {} : { wallet_id: tx.walletId }),
    ...(tx.sourceAddress === undefined ? {} : { source_address: tx.sourceAddress }),
    ...(tx.destinationAddress === undefined ? {} : { destination_address: tx.destinationAddress }),
    ...(tx.tokenId === undefined ? {} : { token_id: tx.tokenId }),
    ...(tx.blockchain === undefined ? {} : { network: tx.blockchain }),
    ...(tx.amounts === undefined ? {} : { amounts: tx.amounts }),
    ...(tx.operation === undefined ? {} : { operation: tx.operation }),
    ...(tx.refId === undefined ? {} : { ref_id: tx.refId }),
    provider_token_decimals: tokenDecimals,
    network_fee: fee ?? null,
    provider_created_at: tx.createDate ?? null,
    provider_updated_at: tx.updateDate ?? null,
    reconciled_at: reconciledAt,
  };
  const providerAmount = tx.amounts?.length === 1 ? decimalToAtomicAtScale(tx.amounts[0], tokenDecimals) : null;
  if (providerAmount !== null) {
    evidence.provider_atomic_amount = providerAmount.toString(10);
    const settlementScale = 10n ** BigInt(tokenDecimals - USDC_DECIMALS);
    if (providerAmount % settlementScale === 0n) evidence.atomic_amount = (providerAmount / settlementScale).toString(10);
  }
  const expectedProviderAmount = decimalToAtomicAtScale(authorizedPreflight?.amount ?? J2A_TRANSFER_AMOUNT, tokenDecimals);
  const amountMatchesIntent = providerAmount !== null && expectedProviderAmount !== null && providerAmount === expectedProviderAmount;

  const expectedSource = authorizedPreflight?.source_wallet.id ?? J2A_DEMO_SOURCE.id;
  const expectedDestination = authorizedPreflight?.destination_wallet.address ?? J2A_DEMO_DESTINATION.address;
  const exactIdentity = tx.id === providerRef && tx.blockchain === "ARC-TESTNET" &&
    tx.walletId === expectedSource && sameEvmAddressIdentity(tx.destinationAddress, expectedDestination) &&
    tx.tokenId === tokenId && amountMatchesIntent &&
    tx.refId !== undefined && (expectedRefId ? tx.refId === expectedRefId : /^j2a-[0-9a-f]{28}$/.test(tx.refId));
  if (!exactIdentity) return { status: "UNKNOWN", ...evidence };
  if (["FAILED", "DENIED", "CANCELLED", "STUCK"].includes(tx.state ?? "")) return { status: "FAILED", ...evidence };
  if (tx.state !== "COMPLETE") return { status: "PENDING", ...evidence };

  try {
    if (!fee) return { status: "UNKNOWN", ...evidence };
    const feeAtomic = decimalToAtomicAtScale(fee, tokenDecimals);
    const maxFeeAtomic = decimalToAtomicAtScale(authorizedPreflight?.max_network_fee ?? J2A_MAX_NETWORK_FEE, tokenDecimals);
    if (feeAtomic === null || maxFeeAtomic === null || feeAtomic > maxFeeAtomic) return { status: "UNKNOWN", ...evidence };
  } catch {
    return { status: "UNKNOWN", ...evidence };
  }
  return { status: "CONFIRMED", ...evidence };
}

export class ArcCircleProviderAdapter implements ProviderAdapter {
  readonly name = "arc-circle-live";

  constructor(
    private readonly suppliedClient?: J2aCircleClient,
    private readonly authorizedPreflight?: (idempotencyKey: string) => J2aPreflightResult | null,
  ) {}

  private client(): J2aCircleClient {
    if (this.suppliedClient) return this.suppliedClient;
    if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
      throw new ProviderNotConfiguredError("ArcCircleProviderAdapter requires server-side CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET.");
    }
    return createCircleArcJ2aExecutionClient() as unknown as J2aCircleClient;
  }

  async submitTransfer(params: SubmitTransferParams): Promise<SubmitTransferResult> {
    if (typeof params.beforeProviderSend !== "function") {
      throw new ProviderPreSubmitBlockedError("Circle submission requires the execution worker's final authority check.");
    }
    const authorized = this.authorizedPreflight?.(params.idempotencyKey);
    if (!authorized || authorized.readiness !== "READY" || params.network !== "ARC_TESTNET" || params.asset !== "USDC" ||
        params.sourceWalletRef !== authorized.source_wallet.id ||
        params.destinationAddress.toLowerCase() !== authorized.destination_wallet.address.toLowerCase() ||
        params.atomicAmount !== String(decimalToAtomicAtScale(authorized.amount, USDC_DECIMALS)) ||
        atomicToDecimal(params.atomicAmount, USDC_DECIMALS) !== authorized.amount) {
      throw new ProviderNotConfiguredError("Circle adapter accepts only the current PAE-bound Arc Testnet settlement proxy intent.");
    }
    if (hashJ2aPreflightEvidence(authorized as unknown as Record<string, unknown>) !== authorized.evidence_sha256) {
      throw new ProviderPreSubmitBlockedError("Persisted Arc preflight evidence no longer matches its authorized digest.");
    }
    const client = this.client();
    const commercial = authorized.business_payment_instruction.commercial;
    const intent: GenuineSettlementProxyIntent = {
      organization_id: authorized.organization_id,
      obligation_id: authorized.obligation_id,
      source_amount: authorized.source_amount,
      source_currency: authorized.source_currency,
      settlement_amount: authorized.amount,
      source_evidence_ids: authorized.source_evidence_ids,
      classification: authorized.classification,
      invoice_reference: commercial.invoice_reference,
      invoice_date: commercial.invoice_date,
      effective_due_date: commercial.effective_due_date,
      payment_basis: commercial.payment_basis,
      particulars: commercial.particulars,
    };
    const preflight = await runJ2aReadOnlyPreflight(client, undefined, intent);
    if (preflight.readiness !== "READY" || preflight.source_wallet.id !== params.sourceWalletRef ||
        preflight.destination_wallet.address.toLowerCase() !== params.destinationAddress.toLowerCase() || preflight.amount !== authorized.amount) {
      throw new ProviderPreSubmitBlockedError("Fresh Circle preflight did not confirm the PAE-bound genuine-obligation proxy intent.");
    }
    if (
        preflight.wallet_set_id !== authorized.wallet_set_id ||
        preflight.beneficiary_id !== authorized.beneficiary_id ||
        preflight.source_wallet.wallet_set_id !== authorized.source_wallet.wallet_set_id ||
        preflight.destination_wallet.wallet_set_id !== authorized.destination_wallet.wallet_set_id ||
        preflight.provider_token.decimals !== authorized.provider_token.decimals ||
        hashJ2aBusinessPaymentInstruction(preflight.business_payment_instruction) !==
          hashJ2aBusinessPaymentInstruction(authorized.business_payment_instruction) ||
        preflight.provider_token.id !== authorized.provider_token.id ||
        preflight.source_balance !== authorized.source_balance ||
        preflight.estimated_network_fee !== authorized.estimated_network_fee ||
        preflight.max_network_fee !== authorized.max_network_fee || preflight.max_total_debit !== authorized.max_total_debit) {
      throw new ProviderPreSubmitBlockedError("Fresh Circle token or fee evidence differs from the Prime-reviewed J2A intent.");
    }
    // No provider operation may occur between this current-authority read and
    // createTransaction. The worker callback is deliberately last after the
    // awaited Circle preflight and exact token/fee/intent comparisons.
    await params.beforeProviderSend();
    const response = await client.createTransaction({
      amount: [authorized.amount],
      destinationAddress: authorized.destination_wallet.address,
      tokenId: preflight.provider_token.id,
      walletId: authorized.source_wallet.id,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey: deriveJ2aCircleIdempotencyUuid(params.idempotencyKey),
      refId: deriveJ2aCircleRefId(params.idempotencyKey),
    });
    const created = createdTransactionSchema.safeParse(response);
    if (!created.success) throw new Error("Circle createTransaction returned an invalid response.");
    return { providerRef: created.data.data.id, status: "SUBMITTED" };
  }

  async getStatus(providerRef: string, idempotencyKey?: string): Promise<StatusResult> {
    const authorized = idempotencyKey ? this.authorizedPreflight?.(idempotencyKey) : null;
    if (!authorized || authorized.readiness !== "READY") return { status: "UNKNOWN" };
    const client = this.client();
    const balances = tokenBalancesSchema.safeParse(await client.getWalletTokenBalance({ id: authorized.source_wallet.id, includeAll: true }));
    if (!balances.success) return { status: "UNKNOWN" };
    const nativeUsdc = balances.data.data.tokenBalances.filter(({ token }) =>
      typeof token?.symbol === "string" && token.symbol.trim().toUpperCase() === "USDC" &&
      token.blockchain === "ARC-TESTNET" && token.isNative === true);
    if (nativeUsdc.length !== 1) return { status: "UNKNOWN" };
    const nativeUsdcToken = nativeUsdc[0].token;
    if (!nativeUsdcToken || typeof nativeUsdcToken.id !== "string" || !nativeUsdcToken.id ||
        typeof nativeUsdcToken.decimals !== "number" || !Number.isSafeInteger(nativeUsdcToken.decimals) ||
        nativeUsdcToken.decimals < USDC_DECIMALS || nativeUsdcToken.decimals > 36 ||
        (nativeUsdcToken.tokenAddress !== undefined && nativeUsdcToken.tokenAddress !== null && typeof nativeUsdcToken.tokenAddress !== "string")) {
      return { status: "UNKNOWN" };
    }
    if (nativeUsdcToken.id !== authorized.provider_token.id || nativeUsdcToken.decimals !== authorized.provider_token.decimals) {
      return { status: "UNKNOWN" };
    }
    return statusForCircleTransaction(
      await client.getTransaction({ id: providerRef }),
      nativeUsdcToken.id,
      nativeUsdcToken.decimals,
      providerRef,
      idempotencyKey,
      authorized,
    );
  }

  async getStatusByIdempotencyKey(idempotencyKey: string): Promise<StatusResult> {
    const authorized = this.authorizedPreflight?.(idempotencyKey);
    if (!authorized || authorized.readiness !== "READY") return { status: "UNKNOWN" };
    const response = listedTransactionsSchema.safeParse(await this.client().listTransactions({
      txType: "OUTBOUND", walletIds: [authorized.source_wallet.id], pageSize: 50, order: "DESC",
    }));
    if (!response.success) return { status: "UNKNOWN" };
    const found = response.data.data.transactions.filter((value) => {
      const item = z.object({ refId: z.unknown().optional() }).passthrough().safeParse(value);
      return item.success && item.data.refId === deriveJ2aCircleRefId(idempotencyKey);
    });
    if (found.length !== 1) return { status: "UNKNOWN" };
    const transaction = z.object({ id: z.unknown().optional() }).passthrough().safeParse(found[0]);
    if (!transaction.success || typeof transaction.data.id !== "string") return { status: "UNKNOWN" };
    return this.getStatus(transaction.data.id, idempotencyKey);
  }
}
