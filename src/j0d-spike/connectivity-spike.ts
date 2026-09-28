import { randomUUID } from "node:crypto";

/**
 * J0 Arc Connectivity Spike (blueprint: "J0 Arc Connectivity Spike
 * Boundary"). Classification: INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION.
 *
 * This module is deliberately isolated from the product runtime:
 *  - it has no import of AuthorityStore, the PAE signer, or ExecutionWorker;
 *  - it never produces or consumes a PAE;
 *  - it creates and uses its own disposable wallet set/wallets, never the
 *    product's source wallet;
 *  - NO_VALID_PAE_NO_EXECUTION_REGARDLESS_OF_INTERFACE applies to product
 *    execution interfaces, not to this spike, but this spike also cannot
 *    become a product execution path — there is no code path from here
 *    into `src/execution/worker.ts` or `src/pipeline/*`.
 *
 * Dispatch profile: J0_CONNECTIVITY_SPIKE. Allowed: one deliberately tiny
 * disposable testnet transfer using a dedicated spike wallet/context that
 * is not reachable by product execution APIs.
 *
 * Fail-closed contract: any provider error, any timeout, or an ambiguous
 * transaction state returns/throws a clear, typed result — it never
 * fabricates a transaction hash or guesses at success. On an ambiguous
 * final transaction state, this function returns status "UNKNOWN" and does
 * not retry submission (a second call to this function would submit a new,
 * distinct transaction — it is not a safe automatic retry path; that is
 * intentional, since the whole point of the spike is one deliberate
 * transfer, decided by whoever invokes it).
 */

import type { AccountType, Blockchain, FeeLevel } from "@circle-fin/developer-controlled-wallets";

import { createCircleArcSpikeClient, ARC_TESTNET_BLOCKCHAIN } from "./circle-arc-client";

export class J0ConnectivitySpikeNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "J0ConnectivitySpikeNotConfiguredError";
  }
}

export class J0ConnectivitySpikeError extends Error {
  constructor(
    message: string,
    public readonly stage: string,
  ) {
    super(message);
    this.name = "J0ConnectivitySpikeError";
  }
}

export interface J0ConnectivitySpikeResult {
  dispatch_profile: "J0_CONNECTIVITY_SPIKE";
  classification: "INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION";
  network: "ARC_TESTNET";
  asset: "USDC";
  amount: string;
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
 * The subset of the Circle Developer-Controlled Wallets client this spike
 * uses. Narrowed to an interface so tests can inject a fake without
 * touching the network, and so this module never depends on more of the
 * SDK's surface than it actually needs.
 */
export interface CircleSpikeClient {
  createWalletSet(input: { name: string; idempotencyKey: string }): Promise<{ data?: { walletSet?: { id?: string } } }>;
  createWallets(input: {
    blockchains: Blockchain[];
    count: number;
    walletSetId: string;
    accountType: AccountType;
    idempotencyKey: string;
  }): Promise<{ data?: { wallets?: Array<{ id?: string; address?: string }> } }>;
  requestTestnetTokens(input: { address: string; blockchain: string; native?: boolean; usdc?: boolean }): Promise<unknown>;
  getWalletTokenBalance(input: {
    id: string;
  }): Promise<{ data?: { tokenBalances?: Array<{ amount?: string; token?: { id?: string; symbol?: string } }> } }>;
  createTransaction(input: {
    walletId: string;
    tokenId: string;
    amount: string[];
    destinationAddress: string;
    fee: { type: "level"; config: { feeLevel: FeeLevel } };
    idempotencyKey: string;
  }): Promise<{ data?: { id?: string } }>;
  getTransaction(input: { id: string }): Promise<{ data?: { transaction?: { state?: string; txHash?: string } } }>;
}

export interface RunConnectivitySpikeOptions {
  client?: CircleSpikeClient;
  pollIntervalMs?: number;
  balanceTimeoutMs?: number;
  transactionTimeoutMs?: number;
  now?: () => Date;
}

function nowIso(now: () => Date): string {
  return now().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Would perform exactly one deliberately tiny disposable Arc Testnet USDC
 * transfer using a freshly created, dedicated spike wallet set — two EOA
 * wallets on ARC-TESTNET, funded from Circle's testnet faucet, then one
 * 0.01 USDC transfer between them — entirely outside the Tameion product
 * execution service, returning the resulting evidence.
 *
 * Fails closed (throws J0ConnectivitySpikeNotConfiguredError) if the
 * Circle Developer-Controlled Wallet credentials actually consumed by this
 * path (CIRCLE_API_KEY / CIRCLE_ENTITY_SECRET) are not configured, rather
 * than fabricating a result. Arc Testnet routing is selected by the Circle
 * SDK blockchain literal ARC-TESTNET; this module does not call an Arc RPC
 * endpoint directly and therefore does not require an ARC_API_KEY.
 */
export function assertJ0dProviderConfigured(): void {
  if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) {
    throw new J0ConnectivitySpikeNotConfiguredError(
      "J0-D connectivity spike requires CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET. " +
        "This build environment does not have them configured; the spike has not been executed.",
    );
  }
}

export async function runConnectivitySpike(options: RunConnectivitySpikeOptions = {}): Promise<J0ConnectivitySpikeResult> {
  const now = options.now ?? (() => new Date());
  const pollIntervalMs = options.pollIntervalMs ?? 5000;
  const balanceTimeoutMs = options.balanceTimeoutMs ?? 2 * 60 * 1000;
  const transactionTimeoutMs = options.transactionTimeoutMs ?? 3 * 60 * 1000;

  if (!options.client) {
    assertJ0dProviderConfigured();
  }

  const client: CircleSpikeClient = options.client ?? createCircleArcSpikeClient();
  const capturedAt = nowIso(now);

  // 1. Dedicated disposable wallet set + two EOA wallets on Arc Testnet.
  let walletSetId: string;
  try {
    const walletSetResponse = await client.createWalletSet({
      name: `tameion-j0d-spike-${capturedAt}`,
      idempotencyKey: randomUUID(),
    });
    const id = walletSetResponse.data?.walletSet?.id;
    if (!id) throw new Error("Circle createWalletSet returned no wallet set id");
    walletSetId = id;
  } catch (error) {
    throw new J0ConnectivitySpikeError(`Failed to create spike wallet set: ${(error as Error).message}`, "CREATE_WALLET_SET");
  }

  let sourceWallet: { id: string; address: string };
  let destinationWallet: { id: string; address: string };
  try {
    const walletsResponse = await client.createWallets({
      blockchains: [ARC_TESTNET_BLOCKCHAIN],
      count: 2,
      walletSetId,
      accountType: "EOA",
      idempotencyKey: randomUUID(),
    });
    const wallets = walletsResponse.data?.wallets ?? [];
    if (wallets.length < 2) {
      throw new Error(`Expected 2 wallets, Circle returned ${wallets.length}`);
    }
    const [first, second] = wallets;
    if (!first.id || !first.address || !second.id || !second.address) {
      throw new Error("Circle createWallets response missing id/address");
    }
    sourceWallet = { id: first.id, address: first.address };
    destinationWallet = { id: second.id, address: second.address };
  } catch (error) {
    throw new J0ConnectivitySpikeError(`Failed to create spike wallets: ${(error as Error).message}`, "CREATE_WALLETS");
  }

  // 2. Fund the source wallet from Circle's testnet faucet (native gas + USDC).
  try {
    await client.requestTestnetTokens({
      address: sourceWallet.address,
      blockchain: ARC_TESTNET_BLOCKCHAIN,
      native: true,
      usdc: true,
    });
  } catch (error) {
    throw new J0ConnectivitySpikeError(`Faucet funding request failed: ${(error as Error).message}`, "FAUCET_REQUEST");
  }

  // 3. Poll the source wallet balance until USDC arrives (bounded).
  let usdcTokenId: string | null = null;
  const balancePollDeadline = Date.now() + balanceTimeoutMs;
  while (Date.now() < balancePollDeadline) {
    await delay(pollIntervalMs);
    try {
      const balanceResponse = await client.getWalletTokenBalance({ id: sourceWallet.id });
      const usdc = (balanceResponse.data?.tokenBalances ?? []).find((b) => b.token?.symbol === "USDC");
      if (usdc && Number(usdc.amount) > 0 && usdc.token?.id) {
        usdcTokenId = usdc.token.id;
        break;
      }
    } catch (error) {
      throw new J0ConnectivitySpikeError(`Balance check failed while awaiting faucet funds: ${(error as Error).message}`, "BALANCE_POLL");
    }
  }
  if (!usdcTokenId) {
    throw new J0ConnectivitySpikeError(
      "Faucet did not fund the spike wallet with testnet USDC within the polling window; no transfer was attempted.",
      "FAUCET_TIMEOUT",
    );
  }

  // 4. Exactly one deliberately tiny (0.01 USDC) disposable transfer.
  const idempotencyKey = randomUUID();
  const amount = "0.01";
  let transactionId: string;
  try {
    const transferResponse = await client.createTransaction({
      walletId: sourceWallet.id,
      tokenId: usdcTokenId,
      amount: [amount],
      destinationAddress: destinationWallet.address,
      fee: { type: "level", config: { feeLevel: "MEDIUM" } },
      idempotencyKey,
    });
    const id = transferResponse.data?.id;
    if (!id) throw new Error("Circle createTransaction returned no transaction id");
    transactionId = id;
  } catch (error) {
    throw new J0ConnectivitySpikeError(`Transfer submission failed: ${(error as Error).message}`, "CREATE_TRANSACTION");
  }

  // 5. Query provider truth until a terminal state or a bounded timeout —
  // never blind-retry the submission itself.
  let finalState: string | null = null;
  let txHash: string | null = null;
  const terminalFailureStates = new Set(["CANCELLED", "DENIED", "FAILED", "STUCK"]);
  const txPollDeadline = Date.now() + transactionTimeoutMs;
  while (Date.now() < txPollDeadline) {
    await delay(pollIntervalMs);
    const statusResponse = await client.getTransaction({ id: transactionId });
    const tx = statusResponse.data?.transaction;
    const state = tx?.state ?? null;
    txHash = tx?.txHash ?? null;
    if (state === "COMPLETE" || (state && terminalFailureStates.has(state))) {
      finalState = state;
      break;
    }
  }

  const status: J0ConnectivitySpikeResult["status"] =
    finalState === "COMPLETE" ? "COMPLETE" : finalState && terminalFailureStates.has(finalState) ? "FAILED" : "UNKNOWN";

  return {
    dispatch_profile: "J0_CONNECTIVITY_SPIKE",
    classification: "INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION",
    network: "ARC_TESTNET",
    asset: "USDC",
    amount,
    wallet_set_id: walletSetId,
    source_wallet_id: sourceWallet.id,
    source_wallet_address: sourceWallet.address,
    destination_wallet_id: destinationWallet.id,
    destination_wallet_address: destinationWallet.address,
    idempotency_key: idempotencyKey,
    provider_transaction_id: transactionId,
    provider_tx_hash: txHash,
    status,
    provider_state: finalState,
    captured_at: capturedAt,
  };
}
