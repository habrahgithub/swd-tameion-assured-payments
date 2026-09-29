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
