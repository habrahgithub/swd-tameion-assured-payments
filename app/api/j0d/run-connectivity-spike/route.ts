import { NextResponse } from "next/server";
import { z } from "zod";

import {
  runConnectivitySpike,
  verifyJ0dIntentBinding,
  J0ConnectivitySpikeNotConfiguredError,
  J0ConnectivitySpikeError,
  J0D_PRE_SUBMISSION_STAGES,
} from "../../../../src/j0d-spike/connectivity-spike";
import { j0dExactIntentSchema, j0dIntentFingerprintSchema } from "../../../../src/j0d-spike/intent";
import { j0dResumeContextSchema } from "../../../../src/j0d-spike/preflight";

const spikeRequestSchema = z.object({
  confirm: z.literal("RUN_J0D_CONNECTIVITY_SPIKE_ONCE"),
  resumeFrom: j0dResumeContextSchema,
  approvedIntent: j0dExactIntentSchema,
  intentFingerprint: j0dIntentFingerprintSchema,
}).strict();

/**
 * Intent-bound J0-D connectivity spike (#26): submits one 0.01 native Arc
 * Testnet USDC transfer between the recovered disposable spike wallets, and
 * only the exact transfer described by a read-only preflight intent. This is
 * infrastructure connectivity evidence, not Tameion product execution — it
 * has no relationship to ExecutionWorker, PAE, or any genuine obligation.
 *
 * NO APPROVED PREFLIGHT INTENT, NO J0-D TRANSFER. The body must contain the
 * confirmation literal, the recovered `resumeFrom` context, the exact
 * `approvedIntent` returned by `POST /api/j0d/preflight`, and its
 * `intentFingerprint`. A bare confirmation is refused. Wallet creation and
 * faucet funding are not reachable from this route.
 *
 * The fingerprint is an integrity binding, not authorization: Prime's
 * explicit approval of the displayed intent happens out-of-band and must
 * precede any call. Current provider truth is re-read immediately before
 * submission; immutable transfer changes or a current fee above the fixed
 * 0.002 USDC fee cap or total above the fixed 0.012 USDC debit cap stop the
 * request before `createTransaction`. Fee and total are point-in-time evidence
 * and may vary within those exact caps.
 *
 * There is no durable J0-D ledger or lock, and point-in-time provider truth
 * plus Circle idempotency alone provides no production exactly-once guarantee.
 * The Circle idempotency key is derived from the separate stable execution
 * identity; see docs/evidence/J0-D-CONNECTIVITY-SPIKE.md for residual risks.
 */
export async function POST(request: Request) {
  const parsed = spikeRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error:
          "Refusing to run: POST body must contain exactly confirm=\"RUN_J0D_CONNECTIVITY_SPIKE_ONCE\", the recovered resumeFrom context, " +
          "the approvedIntent returned by the read-only preflight, and its intentFingerprint.",
      },
      { status: 400 },
    );
  }

  try {
    // Bind context <-> intent <-> fingerprint before touching credentials or the provider.
    verifyJ0dIntentBinding(parsed.data);
    const result = await runConnectivitySpike({
      resumeFrom: parsed.data.resumeFrom,
      approvedIntent: parsed.data.approvedIntent,
      intentFingerprint: parsed.data.intentFingerprint,
      onStageEvidence: (evidence) => {
        // eslint-disable-next-line no-console
        console.log("[j0d-spike] PRE_SUBMISSION_VERIFIED", JSON.stringify(evidence));
      },
    });
    // eslint-disable-next-line no-console
    console.log("[j0d-spike] RESULT", JSON.stringify(result));
    return NextResponse.json({ result });
  } catch (error) {
    if (error instanceof J0ConnectivitySpikeNotConfiguredError) {
      return NextResponse.json({ error: error.message, blocked_external: true }, { status: 503 });
    }
    if (error instanceof J0ConnectivitySpikeError) {
      const submitted = !J0D_PRE_SUBMISSION_STAGES.has(error.stage);
      // eslint-disable-next-line no-console
      console.error(`[j0d-spike] STOPPED at stage ${error.stage}`, JSON.stringify(error.details));
      return NextResponse.json(
        { error: error.message, stage: error.stage, details: error.details, transaction_submitted: submitted ? "UNKNOWN" : false },
        { status: submitted ? 502 : 409 },
      );
    }
    // eslint-disable-next-line no-console
    console.error("[j0d-spike] STOPPED with an unexpected internal error");
    return NextResponse.json({ error: "J0-D spike stopped with an unexpected internal error.", transaction_submitted: "UNKNOWN" }, { status: 500 });
  }
}
