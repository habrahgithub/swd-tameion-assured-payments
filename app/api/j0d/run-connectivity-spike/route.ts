import { NextResponse } from "next/server";

import {
  runConnectivitySpike,
  J0ConnectivitySpikeNotConfiguredError,
  J0ConnectivitySpikeError,
  type J0dResumeContext,
} from "../../../../src/j0d-spike/connectivity-spike";

/**
 * Triggers the isolated J0-D connectivity spike: one deliberately tiny
 * (0.01 USDC) disposable transfer between two freshly created Arc Testnet
 * wallets. This is infrastructure connectivity evidence, not a Tameion
 * product execution — it has no relationship to ExecutionWorker, PAE, or
 * any genuine obligation.
 *
 * Guarded deliberately: this performs a real (if trivial, testnet-only)
 * external action against Circle/Arc, so it requires an explicit
 * confirmation body rather than firing on a bare GET/POST. This route also
 * sits behind Vercel's own deployment protection (SSO) on this project's
 * non-custom-domain URLs.
 *
 * Not idempotent across calls: each successful call (with no `resumeFrom`)
 * creates new disposable wallets and attempts one new transfer. There is no
 * persistent store in this build to enforce "at most once" across separate
 * serverless invocations — that is a known limitation, not an oversight.
 * Call it exactly once, deliberately, unless deliberately resuming a known
 * prior wallet-set/wallet context recovered out-of-band via Circle's own
 * `listWalletSets`/`listWallets` (see docs/evidence/J0-D-CONNECTIVITY-SPIKE.md).
 *
 * Wallet context is logged (via `onStageEvidence`) as soon as it's known —
 * before the faucet call — so a mid-run failure on this serverless platform
 * still leaves the wallet-set/wallet IDs in Vercel's function logs instead
 * of requiring a manual provider-side recovery.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    confirm?: string;
    resumeFrom?: J0dResumeContext;
  };
  if (body.confirm !== "RUN_J0D_CONNECTIVITY_SPIKE_ONCE") {
    return NextResponse.json(
      {
        error:
          'Refusing to run: POST body must be exactly {"confirm":"RUN_J0D_CONNECTIVITY_SPIKE_ONCE"}. ' +
          "This performs one real (testnet) transfer; it does not run by accident.",
      },
      { status: 400 },
    );
  }

  try {
    const result = await runConnectivitySpike({
      resumeFrom: body.resumeFrom,
      onStageEvidence: (evidence) => {
        // eslint-disable-next-line no-console
        console.log("[j0d-spike] WALLET_CONTEXT_READY", JSON.stringify(evidence));
      },
    });
    // eslint-disable-next-line no-console
    console.log("[j0d-spike] COMPLETE", JSON.stringify(result));
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof J0ConnectivitySpikeNotConfiguredError) {
      return NextResponse.json({ error: error.message, blocked_external: true }, { status: 503 });
    }
    if (error instanceof J0ConnectivitySpikeError) {
      // eslint-disable-next-line no-console
      console.error(`[j0d-spike] FAILED at stage ${error.stage}: ${error.message}`);
      return NextResponse.json({ error: error.message, stage: error.stage }, { status: 502 });
    }
    throw error;
  }
}
