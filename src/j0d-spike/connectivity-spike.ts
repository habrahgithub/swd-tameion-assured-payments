/**
 * J0 Arc Connectivity Spike (blueprint: "J0 Arc Connectivity Spike
 * Boundary"). Classification: INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION.
 *
 * This module is deliberately isolated from the product runtime:
 *  - it has no import of AuthorityStore, the PAE signer, or ExecutionWorker;
 *  - it never produces or consumes a PAE;
 *  - NO_VALID_PAE_NO_EXECUTION_REGARDLESS_OF_INTERFACE applies to product
 *    execution interfaces, not to this spike, but this spike also cannot
 *    become a product execution path — there is no code path from here
 *    into `src/execution/worker.ts` or `src/pipeline/*`.
 *
 * Dispatch profile: J0_CONNECTIVITY_SPIKE. Allowed: one deliberately tiny
 * disposable testnet transfer using a dedicated spike wallet/context that
 * is not reachable by product execution APIs.
 *
 * KNOWN PROTOTYPE LIMITATION / BLOCKER: this build environment has no live
 * Circle/Arc credentials (CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET, ARC_API_KEY
 * are unset — see .env.example). `runConnectivitySpike` therefore fails
 * closed rather than fabricating a transaction. The real spike (one tiny
 * disposable testnet transfer, captured as J0_CONNECTIVITY_SPIKE evidence)
 * has not been executed by this session and must be run from an
 * environment that actually holds those credentials (today, that is only
 * the Vercel Production environment per docs/evidence/J0-B-CONNECTIVITY.md).
 */

export class J0ConnectivitySpikeNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "J0ConnectivitySpikeNotConfiguredError";
  }
}

export interface J0ConnectivitySpikeResult {
  dispatch_profile: "J0_CONNECTIVITY_SPIKE";
  classification: "INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION";
  provider_tx_reference: string;
  status: "CONFIRMED" | "UNKNOWN";
  network: "ARC_TESTNET";
  asset: "USDC";
  atomic_amount: string;
  captured_at: string;
}

/**
 * Would perform exactly one deliberately tiny disposable Arc Testnet USDC
 * transfer using a dedicated spike wallet/context, entirely outside the
 * Tameion product execution service, and return the resulting evidence.
 *
 * Currently always throws in this environment: there is no dedicated J0-D
 * spike wallet context and no live Circle/Arc credentials to prove
 * connectivity against. This is intentional fail-closed behavior, not a
 * stub that pretends to succeed.
 */
export async function runConnectivitySpike(): Promise<J0ConnectivitySpikeResult> {
  const circleKey = process.env.CIRCLE_API_KEY;
  const circleEntitySecret = process.env.CIRCLE_ENTITY_SECRET;
  const arcKey = process.env.ARC_API_KEY;

  if (!circleKey || !circleEntitySecret || !arcKey) {
    throw new J0ConnectivitySpikeNotConfiguredError(
      "J0-D connectivity spike requires CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET and ARC_API_KEY. " +
        "None are configured in this build environment (they are Vercel Production-scoped secrets — " +
        "see docs/evidence/J0-B-CONNECTIVITY.md). This spike has not been executed; J0-D remains open.",
    );
  }

  // Real implementation intentionally not written against unverifiable
  // credentials/endpoints: doing so without the ability to test it against
  // the actual Circle DCW / Arc Testnet APIs risks fabricating behavior
  // that looks plausible but has never been proven to work, which is worse
  // than leaving this explicitly unimplemented. Implement and independently
  // test this against real testnet credentials before relying on it.
  throw new J0ConnectivitySpikeNotConfiguredError(
    "J0-D connectivity spike is not implemented against a live provider in this prototype build.",
  );
}
