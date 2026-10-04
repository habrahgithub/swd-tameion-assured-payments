import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { z } from "zod";

import type { AuthorityAggregate } from "../authority/aggregate";
import type { DurableAssessmentRecord, SealedPae } from "../domain/schemas";
import { USDC_DECIMALS, decimalToAtomic } from "../domain/numeric";
import { ARC_TESTNET_BLOCKCHAIN, createCircleArcJ2aReadOnlyClient } from "../j0d-spike/circle-arc-client";

export const J2A_DEMO_WALLET_SET_ID = "2b72f116-16da-591a-9212-5382388a35c4";
export const J2A_DEMO_ORGANIZATION_ID = "ORG-TAMEION-TESTNET-DEMO";
export const J2A_DEMO_ORGANIZATION_NAME = "Tameion Testnet Demonstration Organization";
export const J2A_DEMO_OBLIGATION_ID = "DEMO-ARC-TESTNET-001";
export const J2A_DEMO_PAYMENT_BASIS = "PROTOTYPE_CASH_PAYMENT_DUE_ON_INVOICE_DATE";
export const J2A_DEMO_SYNTHETIC_EVIDENCE_ID = "J2A-DEMO-OBLIGATION-SYNTHETIC-EVIDENCE-001";
export const J2A_PAE_SIGNING_KEY_ID = "TAMEION-J2A-TESTNET-DEMO-PAE-KEY-1";
export const J2A_ARC_TESTNET_CHAIN_ID = 5042002;
export const J2A_ARC_TESTNET_EXPLORER = "https://explorer.testnet.arc.io";
export const J2A_DEMO_SOURCE = {
  id: "9fe9c001-a044-5f9a-8997-165474887952",
  address: "0x8a5ec63c8bc7a4d4b4f0134e034bda4c24043e95",
} as const;
export const J2A_DEMO_DESTINATION = {
  id: "01769e53-cfbe-57aa-ba88-c787b8cba2d3",
  address: "0x591a1002127b1605d9dbb51348787bbe3014b2b9",
  name: "Tameion Test Counterparty",
} as const;
export const J2A_TRANSFER_AMOUNT = "5.000000";
export const J2A_MAX_NETWORK_FEE = "0.002000";
export const J2A_MAX_TOTAL_DEBIT = "5.012000";

export interface BusinessPaymentInstruction {
  payer: {
    organization_id: string;
    display_name: string;
    business_postal_address: { status: "NOT_PROVIDED_IN_SOURCE"; statement: string; classification: "UNVERIFIED_BUSINESS_METADATA" };
    jurisdiction: { status: "NOT_PROVIDED_IN_SOURCE"; statement: string; classification: "UNVERIFIED_BUSINESS_METADATA" };
    source_wallet_id: string;
    source_wallet_address: string;
    wallet_set_id: string;
    wallet_status: string;
    wallet_version: number;
  };
  beneficiary: {
    beneficiary_id: string;
    display_name: string;
    business_postal_address: { status: "NOT_APPLICABLE_TEST_COUNTERPARTY"; statement: string; classification: "SYNTHETIC_DEMO_METADATA" };
    jurisdiction: { status: "NOT_APPLICABLE_TEST_COUNTERPARTY"; statement: string; classification: "SYNTHETIC_DEMO_METADATA" };
    destination_wallet_id: string;
    destination_ref: string;
    destination_wallet_address: string;
    wallet_status: string;
    verification_status: string;
    verification_version: number;
    operational_status: string;
    operational_version: number;
  };
  commercial: {
    obligation_id: string;
    classification: string;
    invoice_reference: string;
    invoice_date: string;
    effective_due_date: string;
    payment_basis: string;
    particulars: string;
    source_amount: string;
    source_currency: string;
    settlement_amount: string;
    settlement_asset: string;
    source_evidence_id: string;
  };
}

export function deriveJ2aCircleIdempotencyUuid(key: string): string {
  const bytes = createHash("sha256").update(`tameion-j2a-circle-idempotency:${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function deriveJ2aCircleRefId(key: string): string {
  return `j2a-${createHash("sha256").update(`tameion-j2a-circle-ref:${key}`).digest("hex").slice(0, 28)}`;
}

export function j2aArcTestnetExplorerReference(txHash: string | undefined): string | null {
  if (!txHash || !/^0x[0-9a-f]{64}$/i.test(txHash)) return null;
  return `${J2A_ARC_TESTNET_EXPLORER}/tx/${txHash}`;
}

const walletTruthSchema = z.object({
  id: z.string(),
  address: z.string(),
  blockchain: z.string(),
  walletSetId: z.string(),
  state: z.string(),
}).passthrough();
const walletResponseSchema = z.object({ data: z.object({ wallet: walletTruthSchema }).passthrough() }).passthrough();
const balanceResponseSchema = z.object({ data: z.object({ tokenBalances: z.array(z.object({
  amount: z.unknown(),
  token: z.object({
    id: z.unknown(), symbol: z.unknown(), blockchain: z.unknown(), decimals: z.unknown(),
    isNative: z.unknown(), tokenAddress: z.unknown(),
  }).passthrough(),
}).passthrough()) }).passthrough() }).passthrough();
const feeResponseSchema = z.object({ data: z.object({ medium: z.object({ networkFee: z.unknown() }).passthrough() }).passthrough() }).passthrough();
const transactionsResponseSchema = z.object({ data: z.object({ transactions: z.array(z.unknown()) }).passthrough() }).passthrough();

export interface J2aPreflightClient {
  getWallet(input: { id: string }): Promise<unknown>;
  getWalletTokenBalance(input: { id: string; includeAll?: boolean }): Promise<unknown>;
  estimateTransferFee(input: { walletId: string; tokenId: string; amount: string[]; destinationAddress: string }): Promise<unknown>;
  listTransactions(input: { blockchain: string; txType: "OUTBOUND"; walletIds: string[]; pageSize: number; order: "DESC" }): Promise<unknown>;
}

type J2aWallet = { id: string; address: string; network: "ARC_TESTNET"; state: "LIVE"; wallet_set_id: string; name?: string };
type J2aProviderToken = { id: string; symbol: "USDC"; decimals: 6; native: true };

const businessPaymentInstructionSchema = z.object({
  payer: z.object({
    organization_id: z.literal(J2A_DEMO_ORGANIZATION_ID), display_name: z.literal(J2A_DEMO_ORGANIZATION_NAME),
    business_postal_address: z.object({ status: z.literal("NOT_PROVIDED_IN_SOURCE"), statement: z.string().min(1), classification: z.literal("UNVERIFIED_BUSINESS_METADATA") }).strict(),
    jurisdiction: z.object({ status: z.literal("NOT_PROVIDED_IN_SOURCE"), statement: z.string().min(1), classification: z.literal("UNVERIFIED_BUSINESS_METADATA") }).strict(),
    source_wallet_id: z.literal(J2A_DEMO_SOURCE.id), source_wallet_address: z.literal(J2A_DEMO_SOURCE.address),
    wallet_set_id: z.literal(J2A_DEMO_WALLET_SET_ID), wallet_status: z.literal("LIVE"), wallet_version: z.literal(1),
  }).strict(),
  beneficiary: z.object({
    beneficiary_id: z.literal(`CP-${J2A_DEMO_DESTINATION.id}`), display_name: z.literal(J2A_DEMO_DESTINATION.name),
    business_postal_address: z.object({
      status: z.literal("NOT_APPLICABLE_TEST_COUNTERPARTY"),
      statement: z.literal("No real postal address applies to the synthetic non-economic test counterparty."),
      classification: z.literal("SYNTHETIC_DEMO_METADATA"),
    }).strict(),
    jurisdiction: z.object({
      status: z.literal("NOT_APPLICABLE_TEST_COUNTERPARTY"),
      statement: z.literal("No real jurisdiction applies to the synthetic non-economic test counterparty."),
      classification: z.literal("SYNTHETIC_DEMO_METADATA"),
    }).strict(),
    destination_wallet_id: z.literal(J2A_DEMO_DESTINATION.id), destination_ref: z.literal(`CIRCLE-DCW-${J2A_DEMO_DESTINATION.id}`),
    destination_wallet_address: z.literal(J2A_DEMO_DESTINATION.address), wallet_status: z.literal("LIVE"),
    verification_status: z.literal("VERIFIED"), verification_version: z.literal(1),
    operational_status: z.literal("ACTIVE"), operational_version: z.literal(1),
  }).strict(),
  commercial: z.object({
    obligation_id: z.literal(J2A_DEMO_OBLIGATION_ID),
    classification: z.literal("TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT"),
    invoice_reference: z.literal(J2A_DEMO_OBLIGATION_ID), invoice_date: z.string().date(), effective_due_date: z.string().date(),
    payment_basis: z.literal(J2A_DEMO_PAYMENT_BASIS),
    particulars: z.literal("Non-economic Arc Testnet demonstration to the synthetic test counterparty."),
    source_amount: z.literal("5.00"), source_currency: z.literal("USD"),
    settlement_amount: z.literal(J2A_TRANSFER_AMOUNT), settlement_asset: z.literal("USDC"),
    source_evidence_id: z.literal(J2A_DEMO_SYNTHETIC_EVIDENCE_ID),
  }).strict(),
}).strict();

export type J2aPreflightResult =
  | {
      readiness: "READY";
      profile: "J2A_REAL_TESTNET_DEMO";
      classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT";
      organization_id: "ORG-TAMEION-TESTNET-DEMO";
      obligation_id: "DEMO-ARC-TESTNET-001";
      amount: typeof J2A_TRANSFER_AMOUNT;
      asset: "USDC";
      network: "ARC_TESTNET";
      wallet_set_id: typeof J2A_DEMO_WALLET_SET_ID;
      beneficiary_id: `CP-${typeof J2A_DEMO_DESTINATION.id}`;
      business_payment_instruction: BusinessPaymentInstruction;
      max_network_fee: typeof J2A_MAX_NETWORK_FEE;
      max_total_debit: typeof J2A_MAX_TOTAL_DEBIT;
      source_wallet: J2aWallet;
      destination_wallet: J2aWallet;
      provider_token: J2aProviderToken;
      source_balance: string;
      estimated_network_fee: string;
      captured_at: string;
      prior_matching_outbound: false;
      evidence_sha256: string;
    }
  | { readiness: "BLOCKED"; blocker: string; captured_at: string };

const canonicalDecimalSchema = z.string().regex(/^(0|[1-9][0-9]*)\.[0-9]{6}$/);
const evidenceSha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
export const j2aPreflightResultSchema = z.discriminatedUnion("readiness", [
  z.object({
    readiness: z.literal("READY"), profile: z.literal("J2A_REAL_TESTNET_DEMO"),
    classification: z.literal("TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT"),
    organization_id: z.literal("ORG-TAMEION-TESTNET-DEMO"), obligation_id: z.literal("DEMO-ARC-TESTNET-001"),
    amount: z.literal(J2A_TRANSFER_AMOUNT), asset: z.literal("USDC"), network: z.literal("ARC_TESTNET"),
    max_network_fee: z.literal(J2A_MAX_NETWORK_FEE), max_total_debit: z.literal(J2A_MAX_TOTAL_DEBIT),
    wallet_set_id: z.literal(J2A_DEMO_WALLET_SET_ID), beneficiary_id: z.literal(`CP-${J2A_DEMO_DESTINATION.id}`),
    business_payment_instruction: businessPaymentInstructionSchema,
    source_wallet: z.object({ id: z.literal(J2A_DEMO_SOURCE.id), address: z.literal(J2A_DEMO_SOURCE.address), network: z.literal("ARC_TESTNET"), state: z.literal("LIVE"), wallet_set_id: z.literal(J2A_DEMO_WALLET_SET_ID) }).strict(),
    destination_wallet: z.object({ id: z.literal(J2A_DEMO_DESTINATION.id), address: z.literal(J2A_DEMO_DESTINATION.address), network: z.literal("ARC_TESTNET"), state: z.literal("LIVE"), wallet_set_id: z.literal(J2A_DEMO_WALLET_SET_ID), name: z.literal(J2A_DEMO_DESTINATION.name) }).strict(),
    provider_token: z.object({ id: z.string().min(1), symbol: z.literal("USDC"), decimals: z.literal(6), native: z.literal(true) }).strict(),
    source_balance: canonicalDecimalSchema, estimated_network_fee: canonicalDecimalSchema,
    captured_at: z.string().datetime({ offset: true }), prior_matching_outbound: z.literal(false), evidence_sha256: evidenceSha256Schema,
  }).strict(),
  z.object({ readiness: z.literal("BLOCKED"), blocker: z.string().min(1).max(100), captured_at: z.string().datetime({ offset: true }) }).strict(),
]);

function sha256(value: unknown): string {
  return createHash("sha256").update(canonicalize(value) ?? "").digest("hex");
}

/** Hash the canonical read-only preflight evidence. Business identity is part
 * of this value, so an identity edit advances the isolated aggregate version. */
export function hashJ2aPreflightEvidence(evidence: Record<string, unknown>): string {
  return sha256({
    profile: evidence.profile,
    classification: evidence.classification,
    wallet_set_id: evidence.wallet_set_id,
    beneficiary_id: evidence.beneficiary_id,
    business_payment_instruction: evidence.business_payment_instruction,
    source_wallet: evidence.source_wallet,
    destination_wallet: evidence.destination_wallet,
    provider_token: evidence.provider_token,
    amount: evidence.amount,
    source_balance: evidence.source_balance,
    estimated_network_fee: evidence.estimated_network_fee,
    max_network_fee: evidence.max_network_fee,
    max_total_debit: evidence.max_total_debit,
    prior_matching_outbound: evidence.prior_matching_outbound,
    captured_at: evidence.captured_at,
  });
}

export function hashJ2aExecutionPacket(packet: Record<string, unknown>): string {
  return sha256(packet);
}

function atomic(value: string): bigint {
  return BigInt(decimalToAtomic(value, USDC_DECIMALS));
}

function blocked(blocker: string, now: () => Date): J2aPreflightResult {
  return { readiness: "BLOCKED", blocker, captured_at: now().toISOString() };
}

function matchingPriorOutbound(value: unknown, tokenId: string): boolean {
  const transaction = z.object({
    txType: z.unknown().optional(), blockchain: z.unknown().optional(), walletId: z.unknown().optional(),
    destinationAddress: z.unknown().optional(), amounts: z.array(z.unknown()).optional(),
    tokenId: z.unknown().optional(),
  }).passthrough().safeParse(value);
  if (!transaction.success) return false;
  const item = transaction.data;
  return item.txType === "OUTBOUND" && item.blockchain === ARC_TESTNET_BLOCKCHAIN &&
    item.walletId === J2A_DEMO_SOURCE.id &&
    typeof item.destinationAddress === "string" && item.destinationAddress.toLowerCase() === J2A_DEMO_DESTINATION.address.toLowerCase() &&
    item.tokenId === tokenId && item.amounts?.length === 1 && item.amounts[0] === J2A_TRANSFER_AMOUNT;
}

export async function runJ2aReadOnlyPreflight(
  client?: J2aPreflightClient,
  now: () => Date = () => new Date(),
): Promise<J2aPreflightResult> {
  const providerClient = client ?? createCircleArcJ2aReadOnlyClient() as unknown as J2aPreflightClient;
  try {
    const [sourceResponse, destinationResponse] = await Promise.all([
      providerClient.getWallet({ id: J2A_DEMO_SOURCE.id }),
      providerClient.getWallet({ id: J2A_DEMO_DESTINATION.id }),
    ]);
    const sourceParsed = walletResponseSchema.safeParse(sourceResponse);
    const destinationParsed = walletResponseSchema.safeParse(destinationResponse);
    if (!sourceParsed.success || !destinationParsed.success) return blocked("PROVIDER_QUERY_FAILED", now);
    const sourceTruth = sourceParsed.data.data.wallet;
    const destinationTruth = destinationParsed.data.data.wallet;
    if (sourceTruth.id !== J2A_DEMO_SOURCE.id || sourceTruth.address.toLowerCase() !== J2A_DEMO_SOURCE.address.toLowerCase() || sourceTruth.walletSetId !== J2A_DEMO_WALLET_SET_ID || sourceTruth.blockchain !== ARC_TESTNET_BLOCKCHAIN) {
      return blocked("SOURCE_WALLET_MISMATCH", now);
    }
    if (destinationTruth.id !== J2A_DEMO_DESTINATION.id || destinationTruth.address.toLowerCase() !== J2A_DEMO_DESTINATION.address.toLowerCase() || destinationTruth.walletSetId !== J2A_DEMO_WALLET_SET_ID || destinationTruth.blockchain !== ARC_TESTNET_BLOCKCHAIN) {
      return blocked("DESTINATION_WALLET_MISMATCH", now);
    }
    if (sourceTruth.state !== "LIVE" || destinationTruth.state !== "LIVE") return blocked("WALLET_NOT_LIVE", now);

    const balanceResponse = await providerClient.getWalletTokenBalance({ id: J2A_DEMO_SOURCE.id, includeAll: true });
    const balancesParsed = balanceResponseSchema.safeParse(balanceResponse);
    if (!balancesParsed.success) return blocked("INVALID_PROVIDER_BALANCE", now);
    const nativeUsdc = balancesParsed.data.data.tokenBalances.filter(({ token }) =>
      token.symbol === "USDC" && token.blockchain === ARC_TESTNET_BLOCKCHAIN && token.decimals === 6 &&
      token.isNative === true && token.tokenAddress === null && typeof token.id === "string" && token.id.length > 0);
    if (nativeUsdc.length !== 1 || typeof nativeUsdc[0].token.id !== "string") return blocked("INVALID_PROVIDER_TOKEN", now);
    const tokenId = nativeUsdc[0].token.id;
    const sourceBalanceResult = canonicalDecimalSchema.safeParse(nativeUsdc[0].amount);
    if (!sourceBalanceResult.success) return blocked("INVALID_PROVIDER_BALANCE", now);
    const sourceBalance = sourceBalanceResult.data;

    const [feeResponse, transactionsResponse] = await Promise.all([
      providerClient.estimateTransferFee({ walletId: J2A_DEMO_SOURCE.id, tokenId, amount: [J2A_TRANSFER_AMOUNT], destinationAddress: J2A_DEMO_DESTINATION.address }),
      providerClient.listTransactions({ blockchain: ARC_TESTNET_BLOCKCHAIN, txType: "OUTBOUND", walletIds: [J2A_DEMO_SOURCE.id], pageSize: 50, order: "DESC" }),
    ]);
    const feeParsed = feeResponseSchema.safeParse(feeResponse);
    const transactionsParsed = transactionsResponseSchema.safeParse(transactionsResponse);
    if (!feeParsed.success || !transactionsParsed.success) return blocked("PROVIDER_QUERY_FAILED", now);
    const fee = feeParsed.data.data.medium.networkFee;
    const feeResult = canonicalDecimalSchema.safeParse(fee);
    if (!feeResult.success) return blocked("INVALID_FEE_ESTIMATE", now);
    const estimatedNetworkFee = feeResult.data;
    if (atomic(estimatedNetworkFee) > atomic(J2A_MAX_NETWORK_FEE)) return blocked("FEE_CAP_EXCEEDED", now);
    if (atomic(J2A_TRANSFER_AMOUNT) + atomic(estimatedNetworkFee) > atomic(J2A_MAX_TOTAL_DEBIT)) return blocked("TOTAL_DEBIT_CAP_EXCEEDED", now);
    if (atomic(sourceBalance) < atomic(J2A_TRANSFER_AMOUNT) + atomic(estimatedNetworkFee)) return blocked("INSUFFICIENT_BALANCE", now);
    if (transactionsParsed.data.data.transactions.some((transaction) => matchingPriorOutbound(transaction, tokenId))) return blocked("PRIOR_MATCHING_OUTBOUND", now);

    const capturedAt = now().toISOString();
    const invoiceDate = capturedAt.slice(0, 10);
    const businessPaymentInstruction: BusinessPaymentInstruction = {
      payer: {
        organization_id: J2A_DEMO_ORGANIZATION_ID,
        display_name: J2A_DEMO_ORGANIZATION_NAME,
        business_postal_address: {
          status: "NOT_PROVIDED_IN_SOURCE",
          statement: "No verified payer business or postal address is present in the admitted source data.",
          classification: "UNVERIFIED_BUSINESS_METADATA",
        },
        jurisdiction: {
          status: "NOT_PROVIDED_IN_SOURCE",
          statement: "No verified payer jurisdiction is present in the admitted source data.",
          classification: "UNVERIFIED_BUSINESS_METADATA",
        },
        source_wallet_id: sourceTruth.id,
        source_wallet_address: sourceTruth.address,
        wallet_set_id: sourceTruth.walletSetId,
        wallet_status: sourceTruth.state,
        wallet_version: 1,
      },
      beneficiary: {
        beneficiary_id: `CP-${destinationTruth.id}`,
        display_name: J2A_DEMO_DESTINATION.name,
        business_postal_address: {
          status: "NOT_APPLICABLE_TEST_COUNTERPARTY",
          statement: "No real postal address applies to the synthetic non-economic test counterparty.",
          classification: "SYNTHETIC_DEMO_METADATA",
        },
        jurisdiction: {
          status: "NOT_APPLICABLE_TEST_COUNTERPARTY",
          statement: "No real jurisdiction applies to the synthetic non-economic test counterparty.",
          classification: "SYNTHETIC_DEMO_METADATA",
        },
        destination_wallet_id: destinationTruth.id,
        destination_ref: `CIRCLE-DCW-${destinationTruth.id}`,
        destination_wallet_address: destinationTruth.address,
        wallet_status: destinationTruth.state,
        verification_status: "VERIFIED",
        verification_version: 1,
        operational_status: "ACTIVE",
        operational_version: 1,
      },
      commercial: {
        obligation_id: J2A_DEMO_OBLIGATION_ID,
        classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
        invoice_reference: J2A_DEMO_OBLIGATION_ID,
        invoice_date: invoiceDate,
        effective_due_date: invoiceDate,
        payment_basis: J2A_DEMO_PAYMENT_BASIS,
        particulars: "Non-economic Arc Testnet demonstration to the synthetic test counterparty.",
        source_amount: "5.00",
        source_currency: "USD",
        settlement_amount: J2A_TRANSFER_AMOUNT,
        settlement_asset: "USDC",
        source_evidence_id: J2A_DEMO_SYNTHETIC_EVIDENCE_ID,
      },
    };
    const evidence = {
      profile: "J2A_REAL_TESTNET_DEMO",
      classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
      wallet_set_id: J2A_DEMO_WALLET_SET_ID,
      beneficiary_id: `CP-${J2A_DEMO_DESTINATION.id}`,
      business_payment_instruction: businessPaymentInstruction,
      source_wallet: { id: sourceTruth.id, address: sourceTruth.address, state: sourceTruth.state, network: "ARC_TESTNET", wallet_set_id: sourceTruth.walletSetId },
      destination_wallet: { id: destinationTruth.id, address: destinationTruth.address, state: destinationTruth.state, network: "ARC_TESTNET", wallet_set_id: destinationTruth.walletSetId, name: J2A_DEMO_DESTINATION.name },
      provider_token: { id: tokenId, symbol: "USDC", decimals: 6, native: true },
      amount: J2A_TRANSFER_AMOUNT,
      source_balance: sourceBalance,
      estimated_network_fee: estimatedNetworkFee,
      max_network_fee: J2A_MAX_NETWORK_FEE,
      max_total_debit: J2A_MAX_TOTAL_DEBIT,
      prior_matching_outbound: false,
      captured_at: capturedAt,
    } as const;
    const resultWithoutHash = {
      readiness: "READY",
      ...evidence,
      organization_id: J2A_DEMO_ORGANIZATION_ID,
      obligation_id: J2A_DEMO_OBLIGATION_ID,
      asset: "USDC",
      network: "ARC_TESTNET",
      wallet_set_id: J2A_DEMO_WALLET_SET_ID,
      beneficiary_id: `CP-${J2A_DEMO_DESTINATION.id}`,
      source_wallet: { id: J2A_DEMO_SOURCE.id, address: J2A_DEMO_SOURCE.address, network: "ARC_TESTNET", state: "LIVE", wallet_set_id: J2A_DEMO_WALLET_SET_ID },
      destination_wallet: { id: J2A_DEMO_DESTINATION.id, address: J2A_DEMO_DESTINATION.address, network: "ARC_TESTNET", state: "LIVE", wallet_set_id: J2A_DEMO_WALLET_SET_ID, name: J2A_DEMO_DESTINATION.name },
      provider_token: { id: tokenId, symbol: "USDC", decimals: 6, native: true },
    } as const;
    const result = { ...resultWithoutHash, evidence_sha256: hashJ2aPreflightEvidence(resultWithoutHash) } as const;
    evidenceSha256Schema.parse(result.evidence_sha256);
    return j2aPreflightResultSchema.parse(result);
  } catch {
    return blocked("PROVIDER_QUERY_FAILED", now);
  }
}

export function buildJ2aDemoAggregate(preflight: Extract<J2aPreflightResult, { readiness: "READY" }>) {
  return {
    organization_id: J2A_DEMO_ORGANIZATION_ID,
    obligation_id: J2A_DEMO_OBLIGATION_ID,
    classification: "TESTNET_DEMONSTRATION_NON_ECONOMIC" as const,
    aggregate_version: 1,
    amount: J2A_TRANSFER_AMOUNT,
    asset: "USDC" as const,
    network: "ARC_TESTNET" as const,
    state: "APPROVAL_PENDING" as const,
    counterparty_id: preflight.beneficiary_id,
    counterparty_version: 1,
    counterparty_status: "VERIFIED" as const,
    destination_version: 1,
    product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE" as const,
    destination_verification_status: "VERIFIED" as const,
    destination_operational_status: "ACTIVE" as const,
    source_wallet_version: 1,
    source_wallet_status: "ACTIVE" as const,
    source_wallet_ref: J2A_DEMO_SOURCE.id,
    source_address: J2A_DEMO_SOURCE.address,
    destination_ref: `CIRCLE-DCW-${J2A_DEMO_DESTINATION.id}`,
    destination_address: J2A_DEMO_DESTINATION.address,
    evidence_hashes: [preflight.evidence_sha256],
    policy_version: "POLICY-P0-1",
    business_hold: false,
    security_freeze: false,
    external_settlement_state: "NONE" as const,
    pae_state: "UNUSED" as const,
    execution_state: "NONE" as const,
    execution_idempotency_key: null,
    reviewed_aggregate_version: null,
    source_amount: "5.00",
    source_currency: "USD",
    settlement_conversion_rate: null,
  };
}

/** Explicit synthetic obligation fixture. Its invoice date and effective due
 * date share the frozen prototype cash-payment basis; provider preflight
 * evidence remains separately bound to assurance and authorization. */
export function buildJ2aDemoObligation(preflight: Extract<J2aPreflightResult, { readiness: "READY" }>) {
  const commercial = preflight.business_payment_instruction.commercial;
  return {
    organization_id: preflight.business_payment_instruction.payer.organization_id,
    organization_name: preflight.business_payment_instruction.payer.display_name,
    ...commercial,
  };
}

/** Canonical server-derived payer/beneficiary identity used by status and the
 * Prime-reviewed execution packet. Provider wallet facts come from preflight;
 * assurance versions/statuses come from the isolated authority aggregate. */
export function buildJ2aIntentIdentity(
  preflight: Extract<J2aPreflightResult, { readiness: "READY" }>,
  aggregate: AuthorityAggregate,
) {
  return {
    payer: {
      organization_id: J2A_DEMO_ORGANIZATION_ID,
      organization_name: J2A_DEMO_ORGANIZATION_NAME,
      wallet_id: preflight.source_wallet.id,
      wallet_address: preflight.source_wallet.address,
      provider_wallet_status: preflight.source_wallet.state,
      assurance_wallet_status: aggregate.source_wallet_status,
      wallet_version: aggregate.source_wallet_version,
      wallet_set_id: preflight.wallet_set_id,
      provider: "Circle Developer-Controlled Wallets",
    },
    beneficiary: {
      beneficiary_id: aggregate.counterparty_id,
      name: preflight.destination_wallet.name,
      wallet_id: preflight.destination_wallet.id,
      destination_ref: aggregate.destination_ref,
      wallet_address: preflight.destination_wallet.address,
      provider_wallet_status: preflight.destination_wallet.state,
      verification_status: aggregate.destination_verification_status,
      verification_version: aggregate.counterparty_version,
      operational_status: aggregate.destination_operational_status,
      operational_version: aggregate.destination_version,
    },
  } as const;
}

export function buildJ2aExecutionPacket(input: {
  preflight: Extract<J2aPreflightResult, { readiness: "READY" }>;
  aggregate: AuthorityAggregate;
  assessment: DurableAssessmentRecord;
  assessmentHash: string;
  sealedPae: SealedPae;
}) {
  const { preflight, aggregate, assessment, assessmentHash, sealedPae } = input;
  const packet = {
    classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
    organization_id: J2A_DEMO_ORGANIZATION_ID,
    ...buildJ2aIntentIdentity(preflight, aggregate),
    business_payment_instruction: preflight.business_payment_instruction,
    circle_arc_execution_instruction: buildJ2aCircleArcExecutionInstruction(preflight, sealedPae.payload.idempotency_key),
    obligation_id: J2A_DEMO_OBLIGATION_ID,
    demo_obligation: buildJ2aDemoObligation(preflight),
    aggregate_version: aggregate.aggregate_version,
    source_amount: "5.00",
    settlement_amount: J2A_TRANSFER_AMOUNT,
    asset: "USDC",
    network: "ARC_TESTNET",
    source_wallet: preflight.source_wallet,
    destination_wallet: preflight.destination_wallet,
    provider_token: preflight.provider_token,
    source_balance: preflight.source_balance,
    estimated_network_fee: preflight.estimated_network_fee,
    max_network_fee: preflight.max_network_fee,
    max_total_debit: preflight.max_total_debit,
    preflight_captured_at: preflight.captured_at,
    preflight_evidence_sha256: preflight.evidence_sha256,
    assessment: {
      assessment_id: assessment.assessment_id,
      assessment_hash: assessmentHash,
      aggregate_version: assessment.aggregate_version,
      decision: assessment.decision,
      provider_mode: assessment.provider_mode,
      provider_name: assessment.provider_name,
      model_id: assessment.model_id,
      model_config_version: assessment.model_config_version,
    },
    pae: {
      instruction_id: sealedPae.payload.instruction_id,
      instruction_hash: sealedPae.instruction_hash,
      signing_key_id: sealedPae.payload.signing_key_id,
      aggregate_version: sealedPae.payload.aggregate_version,
      expiry: sealedPae.payload.expiry,
      idempotency_key: sealedPae.payload.idempotency_key,
    },
  } as const;
  return { packet, packet_sha256: hashJ2aExecutionPacket(packet) };
}

export function buildJ2aCircleArcExecutionInstruction(
  preflight: Extract<J2aPreflightResult, { readiness: "READY" }>,
  idempotencyKey: string,
) {
  return {
    provider: "Circle Developer-Controlled Wallets",
    network: "ARC-TESTNET",
    chain_id: J2A_ARC_TESTNET_CHAIN_ID,
    gas_currency: "USDC",
    source_wallet_id: preflight.source_wallet.id,
    source_address: preflight.source_wallet.address,
    destination_wallet_id: preflight.destination_wallet.id,
    destination_address: preflight.destination_wallet.address,
    token_id: preflight.provider_token.id,
    token: "USDC",
    decimals: preflight.provider_token.decimals,
    amount: J2A_TRANSFER_AMOUNT,
    max_network_fee: preflight.max_network_fee,
    max_total_debit: preflight.max_total_debit,
    circle_request: {
      walletId: preflight.source_wallet.id,
      tokenId: preflight.provider_token.id,
      destinationAddress: preflight.destination_wallet.address,
      amount: [J2A_TRANSFER_AMOUNT],
      fee: { type: "level" as const, config: { feeLevel: "MEDIUM" as const } },
      idempotencyKey: deriveJ2aCircleIdempotencyUuid(idempotencyKey),
      refId: deriveJ2aCircleRefId(idempotencyKey),
    },
  } as const;
}
