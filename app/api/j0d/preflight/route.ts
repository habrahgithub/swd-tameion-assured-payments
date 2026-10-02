import { NextResponse } from "next/server";
import { z } from "zod";

import {
  j0dPreflightHttpStatus,
  j0dResumeContextSchema,
  runJ0dPreflight,
} from "../../../../src/j0d-spike/preflight";

const preflightRequestSchema = z.object({
  confirm: z.literal("READ_J0D_PREFLIGHT_ONLY"),
  resumeFrom: j0dResumeContextSchema,
}).strict();

/**
 * Read-only J0-D provider preflight.
 *
 * This route has no import of createTransaction, requestTestnetTokens,
 * createWallets, AuthorityStore, PAE, or ExecutionWorker. It can only read
 * the two recovered Circle wallets, the source wallet's token balances, and
 * a non-submitting transfer-fee estimate.
 * A READY result is evidence for a later explicit authorization decision;
 * it is not authorization and cannot continue into transfer submission.
 */
export async function POST(request: Request) {
  const parsed = preflightRequestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: 'Refusing preflight: POST body must contain confirm="READ_J0D_PREFLIGHT_ONLY" and a valid recovered resumeFrom context.',
      },
      { status: 400 },
    );
  }

  const result = await runJ0dPreflight(parsed.data.resumeFrom);
  if (result.readiness === "BLOCKED_EXTERNAL") {
    return NextResponse.json({ result }, { status: j0dPreflightHttpStatus(result) });
  }
  return NextResponse.json({ result });
}
