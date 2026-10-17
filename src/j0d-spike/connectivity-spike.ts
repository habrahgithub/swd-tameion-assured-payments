/**
 * J0 Arc Connectivity Spike (blueprint: "J0 Arc Connectivity Spike
 * Boundary"). Classification: INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION.
 *
 * This module is deliberately isolated from the product runtime:
 *  - it has no import of AuthorityStore, the PAE signer, or ExecutionWorker;
 *  - it never produces or consumes a PAE;
 *  - it uses only the recovered disposable spike wallet set/wallets, never the
 *    product's source wallet;
 *  - there is no code path from here into `src/execution/worker.ts` or
 *    `src/pipeline/*`.
 *
 * #26 invariant: NO APPROVED PREFLIGHT INTENT, NO J0-D TRANSFER.
 *
 * Submission is resume-only and intent-bound. The caller must supply the
 * recovered wallet context, the exact intent produced by the read-only
 * preflight (and approved by Prime out-of-band), and that intent's SHA-256
 * fingerprint. Immediately before submission this module re-runs the same
 * read-only preflight against current provider truth and refuses to submit
 * unless immutable transfer fields still match and current MEDIUM fee and
 * total debit remain within the fixed v2 ceilings. The
 * execution capability has no wallet-creation or faucet method, so a
 * resumed transfer can never mint wallets or request testnet funds.
 *
 * Fail-closed contract: every failed check throws a typed
 * J0ConnectivitySpikeError before `createTransaction`; provider error text is
 * never propagated. After submission an ambiguous state returns "UNKNOWN" and
 * is never blind-retried.
 */

import type { FeeLevel } from "@circle-fin/developer-controlled-wallets";
import { z } from "zod";

import { createCircleArcSpikeExecutionClient } from "./circle-arc-client";
import {
  decimalToAtomicAtScale,
  computeJ0dExecutionIdentity,
  computeJ0dIntentFingerprint,
  diffMaterialIntentFields,
  j0dExactIntentSchema,
  j0dIdempotencyKeyForExecutionIdentity,
  j0dIntentFingerprintSchema,
  type J0dExactIntent,
} from "./intent";
import { j0dResumeContextSchema, runJ0dPreflight, type J0dPreflightClient, type J0dResumeContext } from "./preflight";

export type { J0dResumeContext } from "./preflight";

export class J0ConnectivitySpikeNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "J0ConnectivitySpikeNotConfiguredError";
  }
}

export type J0ConnectivitySpikeStage =
  | "INVALID_RESUME_CONTEXT"
  | "INVALID_APPROVED_INTENT"
  | "INTENT_FINGERPRINT_MISMATCH"
  | "RESUME_CONTEXT_INTENT_MISMATCH"
  | "PROVIDER_TRUTH_BLOCKED"
  | "FUNDING_REQUIRED"
  | "AUTHORIZATION_CEILING_EXCEEDED"
  | "STALE_INTENT"
  | "PRIOR_TRANSACTION_CHECK_FAILED"
  | "PRIOR_OUTBOUND_TRANSACTION_EXISTS"
  | "SUBMISSION_OUTCOME_UNKNOWN";

/** Stages that stop before `createTransaction` is ever called. */
export const J0D_PRE_SUBMISSION_STAGES: ReadonlySet<J0ConnectivitySpikeStage> = new Set([
  "INVALID_RESUME_CONTEXT",
  "INVALID_APPROVED_INTENT",
  "INTENT_FINGERPRINT_MISMATCH",
  "RESUME_CONTEXT_INTENT_MISMATCH",
  "PROVIDER_TRUTH_BLOCKED",
  "FUNDING_REQUIRED",
  "AUTHORIZATION_CEILING_EXCEEDED",
  "STALE_INTENT",
  "PRIOR_TRANSACTION_CHECK_FAILED",
  "PRIOR_OUTBOUND_TRANSACTION_EXISTS",
]);

export class J0ConnectivitySpikeError extends Error {
  constructor(
    message: string,
    public readonly stage: J0ConnectivitySpikeStage,
    /** Sanitized, application-owned detail only — never provider error text. */
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "J0ConnectivitySpikeError";
  }
}

export interface J0ConnectivitySpikeResult {
  dispatch_profile: "J0_CONNECTIVITY_SPIKE";
  classification: "INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION";
  network: "ARC-TESTNET";
  asset: "USDC";
  amount: "0.01";
  fee_level: "MEDIUM";
  provider_token_id: string;
  estimated_network_fee: string;
  intent_fingerprint: string;
  execution_identity: string;
  wallet_set_id: string;
  source_wallet_id: string;
  source_wallet_address: string;
  destination_wallet_id: string;
  destination_wallet_address: string;
  idempotency_key: string;
  provider_transaction_id: string;
  provider_tx_hash: string | null;
  status: "COMPLETE" | "UNKNOWN" | "FAILED";
  provider_state: string | null;
  captured_at: string;
}

/**
 * The only Circle capability the intent-bound spike receives: the read-only
 * preflight operations, read-only transaction lookup, and one submission
 * method. No wallet creation, no faucet, no signing.
 */
export interface J0dSpikeExecutionClient extends J0dPreflightClient {
  listTransactions(input: {
    walletIds: string[];
    txType: "OUTBOUND";
    pageSize: 1;
    order: "DESC";
  }): Promise<unknown>;
  createTransaction(input: {
    walletId: string;
    tokenId: string;
    amount: string[];
    destinationAddress: string;
    fee: { type: "level"; config: { feeLevel: FeeLevel } };
    idempotencyKey: string;
  }): Promise<unknown>;
  getTransaction(input: { id: string }): Promise<unknown>;
}

export interface J0dStageEvidence {
  stage: "PRE_SUBMISSION_VERIFIED";
  intent_fingerprint: string;
  execution_identity: string;
  idempotency_key: string;
  wallet_set_id: string;
  source_wallet_id: string;
  source_wallet_address: string;
  destination_wallet_id: string;
  destination_wallet_address: string;
  provider_token_id: string;
  amount: string;
  fee_level: string;
  estimated_network_fee: string;
}

export interface RunConnectivitySpikeOptions {
  /** Recovered disposable wallet context. Required: fresh wallet creation is not reachable. */
  resumeFrom: J0dResumeContext;
  /** Exact intent returned by the read-only preflight and approved by Prime. */
  approvedIntent: J0dExactIntent;
  /** SHA-256 fingerprint of `approvedIntent` as returned by the preflight. */
  intentFingerprint: string;
  client?: J0dSpikeExecutionClient;
  pollIntervalMs?: number;
  transactionTimeoutMs?: number;
  now?: () => Date;
  /** Called after every binding check passes and immediately before submission, so the
   * fingerprint and idempotency key are logged even if the invocation dies mid-submission. */
  onStageEvidence?: (evidence: J0dStageEvidence) => void;
}

function nowIso(now: () => Date): string {
  return now().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fails closed (throws J0ConnectivitySpikeNotConfiguredError) if the Circle
 * Developer-Controlled Wallet credentials consumed by this path are not
 * configured. Arc Testnet routing is selected by the Circle SDK blockchain
 * literal ARC-TESTNET; no ARC_API_KEY is required.
 */
export function assertJ0dProviderConfigured(): void {
  if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
    throw new J0ConnectivitySpikeNotConfiguredError(
      "J0-D connectivity spike requires CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET. " +
        "This build environment does not have them configured; the spike has not been executed.",
    );
  }
}

const providerTransactionListSchema = z.object({
  data: z.object({
    transactions: z.array(z.object({
      id: z.string().min(1),
      transactionType: z.literal("OUTBOUND"),
    }).passthrough()).max(1),
  }).passthrough(),
}).passthrough();

async function readPriorOutboundTransaction(client: J0dSpikeExecutionClient, walletId: string): Promise<string | null> {
  const response = await client.listTransactions({
    walletIds: [walletId],
    txType: "OUTBOUND",
    pageSize: 1,
    order: "DESC",
  });
  const parsed = providerTransactionListSchema.safeParse(response);
  if (!parsed.success) throw new Error("prior outbound check response invalid");
  return parsed.data.data.transactions[0]?.id ?? null;
}

const providerCreateTransactionSchema = z.object({
  data: z.object({ id: z.string().min(1).max(256) }).passthrough(),
}).passthrough();

const providerGetTransactionSchema = z.object({
  data: z.object({
    transaction: z.object({
      state: z.string().max(64).optional(),
      txHash: z.string().max(256).optional(),
    }).passthrough(),
  }).passthrough(),
}).passthrough();

/**
 * Binds the caller's inputs to each other before any provider call:
 * strict resume context, strict internally-consistent intent, matching
 * fingerprint, and resume context that agrees with the intent.
 */
export function verifyJ0dIntentBinding(input: {
  resumeFrom: unknown;
  approvedIntent: unknown;
  intentFingerprint: unknown;
}): { resumeFrom: J0dResumeContext; approvedIntent: J0dExactIntent; intentFingerprint: string } {
  const resume = j0dResumeContextSchema.safeParse(input.resumeFrom);
  if (!resume.success) {
    throw new J0ConnectivitySpikeError("Refusing to submit: the recovered wallet context is missing or invalid.", "INVALID_RESUME_CONTEXT");
  }
  const intent = j0dExactIntentSchema.safeParse(input.approvedIntent);
  if (!intent.success) {
    throw new J0ConnectivitySpikeError("Refusing to submit: the approved preflight intent is missing or invalid.", "INVALID_APPROVED_INTENT");
  }
  const fingerprint = j0dIntentFingerprintSchema.safeParse(input.intentFingerprint);
  if (!fingerprint.success || computeJ0dIntentFingerprint(intent.data) !== fingerprint.data) {
    throw new J0ConnectivitySpikeError("Refusing to submit: the intent fingerprint does not match the approved intent.", "INTENT_FINGERPRINT_MISMATCH");
  }
  const context = resume.data;
  const approved = intent.data;
  if (
    context.walletSetId !== approved.wallet_set_id ||
    context.sourceWallet.id !== approved.source_wallet_id ||
    context.sourceWallet.address.toLowerCase() !== approved.source_wallet_address.toLowerCase() ||
    context.destinationWallet.id !== approved.destination_wallet_id ||
    context.destinationWallet.address.toLowerCase() !== approved.destination_wallet_address.toLowerCase()
  ) {
    throw new J0ConnectivitySpikeError("Refusing to submit: the recovered wallet context disagrees with the approved intent.", "RESUME_CONTEXT_INTENT_MISMATCH");
  }
  return { resumeFrom: context, approvedIntent: approved, intentFingerprint: fingerprint.data };
}

/**
 * Submits exactly one 0.01 native Arc Testnet USDC transfer, and only the
 * transfer described by the approved preflight intent. Every check below
 * runs before `createTransaction`; any failure throws a typed pre-submission
 * error and nothing is submitted.
 */
export async function runConnectivitySpike(options: RunConnectivitySpikeOptions): Promise<J0ConnectivitySpikeResult> {
  const now = options.now ?? (() => new Date());
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const transactionTimeoutMs = options.transactionTimeoutMs ?? 3 * 60 * 1000;

  // 1. Caller-supplied binding: context <-> intent <-> fingerprint. No provider call yet.
  const { resumeFrom, approvedIntent, intentFingerprint } = verifyJ0dIntentBinding(options);

  if (!options.client) {
    assertJ0dProviderConfigured();
  }
  const client: J0dSpikeExecutionClient = options.client ?? createCircleArcSpikeExecutionClient();
  const capturedAt = nowIso(now);

  // 2. Re-derive the intent from current provider truth using the same
  // read-only preflight that produced the approved intent.
  const current = await runJ0dPreflight(resumeFrom, { client, now });
  if (current.readiness === "BLOCKED_EXTERNAL") {
    throw new J0ConnectivitySpikeError(
      "Refusing to submit: current provider truth failed read-only verification.",
      "PROVIDER_TRUTH_BLOCKED",
      { blocker: current.blocker },
    );
  }
  if (current.readiness === "AUTHORIZATION_CEILING_EXCEEDED") {
    throw new J0ConnectivitySpikeError(
      "Refusing to submit: current fee estimate or total debit exceeds a fixed J0-D authorization ceiling.",
      "AUTHORIZATION_CEILING_EXCEEDED",
      {
        current_network_fee: current.estimated_network_fee,
        max_network_fee: current.max_network_fee,
        current_total_debit: current.minimum_required_total,
        max_total_debit: current.max_total_debit,
      },
    );
  }
  if (current.readiness === "FUNDING_REQUIRED") {
    throw new J0ConnectivitySpikeError(
      "Refusing to submit: the source wallet no longer covers the transfer plus estimated network fee. No faucet request was made.",
      "FUNDING_REQUIRED",
      {
        source_usdc_balance: current.source_usdc_balance,
        minimum_required_total: current.minimum_required_total,
        funding_address: current.funding_address,
      },
    );
  }

  // 3. Immutable transfer fields must still match. Fee and total remain
  // point-in-time preflight evidence and are checked against authorized caps.
  const changed = diffMaterialIntentFields(approvedIntent, current.exact_intent);
  if (changed.length > 0) {
    throw new J0ConnectivitySpikeError(
      "Refusing to submit: current provider truth differs from the approved immutable transfer intent.",
      "STALE_INTENT",
      {
        changed_fields: changed,
      },
    );
  }

  const decimals = approvedIntent.provider_token.decimals;
  const currentFee = decimalToAtomicAtScale(current.exact_intent.estimated_network_fee, decimals);
  const authorizedMaxFee = decimalToAtomicAtScale(approvedIntent.max_network_fee, decimals);
  const transferAmount = decimalToAtomicAtScale(approvedIntent.amount, decimals);
  const authorizedMaxTotal = decimalToAtomicAtScale(approvedIntent.max_total_debit, decimals);
  if (currentFee === null || authorizedMaxFee === null || transferAmount === null || authorizedMaxTotal === null ||
      currentFee > authorizedMaxFee || transferAmount + currentFee > authorizedMaxTotal) {
    throw new J0ConnectivitySpikeError(
      "Refusing to submit: the current network fee or total debit exceeds the approved authorization ceiling.",
      "AUTHORIZATION_CEILING_EXCEEDED",
      {
        current_network_fee: current.exact_intent.estimated_network_fee,
        max_network_fee: approvedIntent.max_network_fee,
        current_total_debit: current.exact_intent.minimum_required_total,
        max_total_debit: approvedIntent.max_total_debit,
      },
    );
  }

  // 4. No blind retry across invocations: check whether any prior OUTBOUND
  // transaction exists for the disposable source wallet.
  let priorOutboundId: string | null;
  try {
    priorOutboundId = await readPriorOutboundTransaction(client, approvedIntent.source_wallet_id);
  } catch {
    throw new J0ConnectivitySpikeError("Refusing to submit: prior outbound transaction status could not be verified.", "PRIOR_TRANSACTION_CHECK_FAILED");
  }
  if (priorOutboundId !== null) {
    throw new J0ConnectivitySpikeError(
      "Refusing to submit: the source wallet already has an outbound transaction. Reconcile it from provider truth; do not resubmit.",
      "PRIOR_OUTBOUND_TRANSACTION_EXISTS",
      { provider_transaction_ids: [priorOutboundId] },
    );
  }

  // 5. The full intent remains authorization evidence; identity excludes fee/timestamp.
  const executionIdentity = computeJ0dExecutionIdentity(approvedIntent);
  const idempotencyKey = j0dIdempotencyKeyForExecutionIdentity(executionIdentity);
  options.onStageEvidence?.({
    stage: "PRE_SUBMISSION_VERIFIED",
    intent_fingerprint: intentFingerprint,
    execution_identity: executionIdentity,
    idempotency_key: idempotencyKey,
    wallet_set_id: approvedIntent.wallet_set_id,
    source_wallet_id: approvedIntent.source_wallet_id,
    source_wallet_address: approvedIntent.source_wallet_address,
    destination_wallet_id: approvedIntent.destination_wallet_id,
    destination_wallet_address: approvedIntent.destination_wallet_address,
    provider_token_id: approvedIntent.provider_token.id,
    amount: approvedIntent.amount,
    fee_level: approvedIntent.fee_level,
    estimated_network_fee: approvedIntent.estimated_network_fee,
  });

  let transactionId: string;
  try {
    const transferResponse = await client.createTransaction({
      walletId: approvedIntent.source_wallet_id,
      tokenId: approvedIntent.provider_token.id,
      amount: [approvedIntent.amount],
      destinationAddress: approvedIntent.destination_wallet_address,
      fee: { type: "level", config: { feeLevel: approvedIntent.fee_level } },
      idempotencyKey,
    });
    const parsed = providerCreateTransactionSchema.safeParse(transferResponse);
    if (!parsed.success) throw new Error("malformed");
    transactionId = parsed.data.data.id;
  } catch {
    // The request may or may not have been accepted. Never retry blindly:
    // reconcile from provider truth (listTransactions / idempotency key).
    throw new J0ConnectivitySpikeError(
      "Transfer submission outcome is unknown. Do not resubmit; reconcile from Circle provider truth using the idempotency key.",
      "SUBMISSION_OUTCOME_UNKNOWN",
      { intent_fingerprint: intentFingerprint, execution_identity: executionIdentity, idempotency_key: idempotencyKey },
    );
  }

  // 6. Query provider truth until a terminal state or a bounded timeout —
  // never blind-retry the submission itself.
  let finalState: string | null = null;
  let txHash: string | null = null;
  const terminalFailureStates = new Set(["CANCELLED", "DENIED", "FAILED", "STUCK"]);
  const txPollDeadline = Date.now() + transactionTimeoutMs;
  while (Date.now() < txPollDeadline) {
    await delay(pollIntervalMs);
    let statusResponse: unknown;
    try {
      statusResponse = await client.getTransaction({ id: transactionId });
    } catch {
      continue; // transient read failure; bounded by the deadline, result stays UNKNOWN
    }
    const parsed = providerGetTransactionSchema.safeParse(statusResponse);
    if (!parsed.success) continue;
    const tx = parsed.data.data.transaction;
    const state = tx.state ?? null;
    txHash = tx.txHash ?? null;
    if (state === "COMPLETE" || (state && terminalFailureStates.has(state))) {
      finalState = state;
      break;
    }
  }

  const status: J0ConnectivitySpikeResult["status"] =
    finalState === "COMPLETE" ? "COMPLETE" : finalState && terminalFailureStates.has(finalState) ? "FAILED" : "UNKNOWN";

  return {
    dispatch_profile: "J0_CONNECTIVITY_SPIKE",
    classification: approvedIntent.classification,
    network: approvedIntent.network,
    asset: approvedIntent.asset,
    amount: approvedIntent.amount,
    fee_level: approvedIntent.fee_level,
    provider_token_id: approvedIntent.provider_token.id,
    estimated_network_fee: approvedIntent.estimated_network_fee,
    intent_fingerprint: intentFingerprint,
    execution_identity: executionIdentity,
    wallet_set_id: approvedIntent.wallet_set_id,
    source_wallet_id: approvedIntent.source_wallet_id,
    source_wallet_address: approvedIntent.source_wallet_address,
    destination_wallet_id: approvedIntent.destination_wallet_id,
    destination_wallet_address: approvedIntent.destination_wallet_address,
    idempotency_key: idempotencyKey,
    provider_transaction_id: transactionId,
    provider_tx_hash: txHash,
    status,
    provider_state: finalState,
    captured_at: capturedAt,
  };
}
