import { initiateDeveloperControlledWalletsClient } from "@circle-fin/developer-controlled-wallets";

/**
 * Thin, isolated client factory for the J0-D connectivity spike only.
 * Deliberately not shared with `src/execution/*` — the J0-D spike must stay
 * a separately labelled infrastructure test, never a product execution
 * path (blueprint: "J0 Arc Connectivity Spike Boundary").
 *
 * The entity secret was already generated and registered against this
 * Circle account before this build (see docs/evidence/J0-B-CONNECTIVITY.md:
 * an authenticated `GET /v1/w3s/wallets` already returned HTTP 200 with it).
 * This factory only uses it to sign requests — it never re-registers it.
 */
export function createCircleArcSpikeClient() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
  if (!apiKey || !entitySecret) {
    throw new Error("CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET are required for the J0-D spike client");
  }
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

export const ARC_TESTNET_BLOCKCHAIN = "ARC-TESTNET" as const;

/**
 * Read-only capability wrapper for J0-D preflight. The returned object does
 * not expose wallet creation, faucet, signing, or transaction submission
 * methods even though the underlying authenticated SDK client supports them.
 */
export function createCircleArcReadOnlyClient() {
  const client = createCircleArcSpikeClient();
  return {
    getWallet: client.getWallet.bind(client),
    getWalletTokenBalance: client.getWalletTokenBalance.bind(client),
    estimateTransferFee: client.estimateTransferFee.bind(client),
  };
}

/**
 * Read-only capability for J0-D prior-outbound reconciliation (#40 B7-A).
 * Exposes only `listTransactions`: no wallet lookup/creation, faucet,
 * signing, fee estimation, or transaction submission is reachable from it.
 */
export function createCircleArcPriorOutboundReadClient() {
  const client = createCircleArcSpikeClient();
  return {
    listTransactions: client.listTransactions.bind(client),
  };
}

/**
 * Read-only Circle capability for the isolated J2A real-testnet demo.
 * Kept separate from J0-D so the demo lane cannot inherit J0-D execution
 * methods or expose wallet creation/faucet operations.
 */
export function createCircleArcJ2aReadOnlyClient() {
  const client = createCircleArcSpikeClient();
  return {
    getWallet: client.getWallet.bind(client),
    getWalletTokenBalance: client.getWalletTokenBalance.bind(client),
    estimateTransferFee: client.estimateTransferFee.bind(client),
    listTransactions: client.listTransactions.bind(client),
  };
}

/**
 * Narrow transaction capability for J2A. The fixed demo adapter resolves
 * the wallet/token itself and receives no wallet creation or faucet method.
 */
export function createCircleArcJ2aExecutionClient() {
  const client = createCircleArcSpikeClient();
  return {
    getWallet: client.getWallet.bind(client),
    getWalletTokenBalance: client.getWalletTokenBalance.bind(client),
    estimateTransferFee: client.estimateTransferFee.bind(client),
    listTransactions: client.listTransactions.bind(client),
    getTransaction: client.getTransaction.bind(client),
    createTransaction: client.createTransaction.bind(client),
  };
}

/**
 * Intent-bound execution capability for the J0-D spike (#26). Exposes the
 * three read-only preflight operations (so provider truth can be re-read
 * immediately before submission), a read-only transaction listing/lookup for
 * no-blind-retry, and `createTransaction`. It deliberately does NOT expose
 * wallet-set/wallet creation or the faucet: a resumed, intent-bound transfer
 * is structurally unable to mint wallets or request testnet funds.
 */
export function createCircleArcSpikeExecutionClient() {
  const client = createCircleArcSpikeClient();
  return {
    getWallet: client.getWallet.bind(client),
    getWalletTokenBalance: client.getWalletTokenBalance.bind(client),
    estimateTransferFee: client.estimateTransferFee.bind(client),
    listTransactions: client.listTransactions.bind(client),
    getTransaction: client.getTransaction.bind(client),
    createTransaction: client.createTransaction.bind(client),
  };
}
