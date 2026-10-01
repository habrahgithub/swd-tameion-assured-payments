import { NextResponse } from "next/server";
import { z } from "zod";

import {
  runSimulatedBlockedVariant,
  runSimulatedHappyPath,
  SimulatedDemoGuardError,
  SIMULATED_HAPPY_PATH_LABEL,
  FAKE_PROVIDER_LABEL,
  NOT_VENDOR_PAYMENT_LABEL,
} from "../../../../../src/demo/simulated-happy-path";
import { PaeKeyError } from "../../../../../src/pae/keys";

export const runtime = "nodejs";
export const maxDuration = 30;

const CONFIRMATION = "RUN_SIMULATED_HAPPY_PATH";
const requestSchema = z.object({ confirm: z.literal(CONFIRMATION) }).strict();

const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
};

function reply(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

/**
 * #44 admitted isolated prototype route. Local and Preview only — never
 * production. In-memory only: this route does not read or write Supabase,
 * does not call Circle/Arc/J0-D, and never touches genuine OBL-J0C-*
 * obligation state.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.VERCEL_ENV === "production") {
    return reply({ status: "BLOCKED", code: "PRODUCTION_BLOCKED" }, 404);
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return reply(
      { status: "BLOCKED", code: "MALFORMED_REQUEST", error: `POST body must be { "confirm": "${CONFIRMATION}" }` },
      400,
    );
  }

  try {
    const happyPath = await runSimulatedHappyPath();
    const blockedVariant = runSimulatedBlockedVariant();
    return reply(
      {
        status: "PASS",
        label: SIMULATED_HAPPY_PATH_LABEL,
        provider_label: FAKE_PROVIDER_LABEL,
        vendor_notice: NOT_VENDOR_PAYMENT_LABEL,
        happy_path: happyPath,
        blocked_variant: blockedVariant,
      },
      200,
    );
  } catch (error) {
    if (error instanceof PaeKeyError) {
      return reply({ status: "BLOCKED", code: "SIGNING_KEY_UNAVAILABLE" }, 503);
    }
    if (error instanceof SimulatedDemoGuardError) {
      return reply({ status: "BLOCKED", code: error.code, error: error.message }, 400);
    }
    throw error;
  }
}

function methodNotAllowed(): NextResponse {
  return reply({ status: "BLOCKED", code: "METHOD_NOT_ALLOWED" }, 405);
}

export const GET = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
