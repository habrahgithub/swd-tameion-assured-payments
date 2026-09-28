/**
 * Provider adapter boundary: the only place allowed to talk to a real
 * payment rail. Two implementations exist — FakeProviderAdapter (in-memory,
 * deterministic, used for tests and the mocked golden path) and
 * ArcCircleProviderAdapter (a real-provider stub gated on env credentials).
 *
 * KNOWN PROTOTYPE LIMITATION: this build environment has no live Circle/Arc
 * credentials (see .env.example — names only, no values). ArcCircleProviderAdapter
 * therefore fails closed with a clear error rather than silently doing
 * nothing or fabricating a result. Wiring it to real Circle Developer-
 * Controlled Wallets / Arc Testnet calls is required before any live J0-D
 * spike or J2 execution, and is explicitly gated behind the Prime approval
 * described in DIR-TAMEION-PROTOTYPE-CLAUDE-001.
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
}

export class ProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderNotConfiguredError";
  }
}

/**
 * Real-provider adapter stub. Fails closed (throws) instead of guessing at
 * an API shape it cannot test against without live credentials. Replace
 * the body of each method with real Circle Developer-Controlled Wallets /
 * Arc Testnet calls once credentials are available in this environment
 * (they currently live only in Vercel's Production-scoped secret store).
 */
export class ArcCircleProviderAdapter implements ProviderAdapter {
  readonly name = "arc-circle-live";

  submitTransfer(_params: SubmitTransferParams): Promise<SubmitTransferResult> {
    if (!process.env.CIRCLE_API_KEY || !process.env.ARC_API_KEY) {
      throw new ProviderNotConfiguredError(
        "ArcCircleProviderAdapter requires CIRCLE_API_KEY and ARC_API_KEY; none are configured in this environment.",
      );
    }
    throw new ProviderNotConfiguredError(
      "ArcCircleProviderAdapter is a stub: real Circle DCW / Arc Testnet submission is not implemented in this " +
        "prototype build. Do not use for J0-D or J2 execution until implemented and independently tested against " +
        "the real testnet, per DIR-TAMEION-PROTOTYPE-CLAUDE-001 gate 1.",
    );
  }

  getStatus(_providerRef: string): Promise<StatusResult> {
    throw new ProviderNotConfiguredError("ArcCircleProviderAdapter.getStatus is not implemented in this prototype build.");
  }
}
