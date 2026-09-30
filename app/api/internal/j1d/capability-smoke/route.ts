import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import { NvidiaProvider } from "../../../../../src/agent/ai-provider";
import { runJ1dCapabilitySmoke } from "../../../../../src/agent/j1d-capability-smoke";

export const runtime = "nodejs";
export const maxDuration = 65;

const CONFIRMATION = "RUN_SYNTHETIC_NVIDIA_CAPABILITY_SMOKE";
const MIN_SECRET_BYTES = 32;
const MAX_TOKEN_BYTES = 4096;
const requestSchema = z.object({ confirm: z.literal(CONFIRMATION) }).strict();
const noStoreHeaders = {
  "Cache-Control": "no-store, max-age=0",
  Pragma: "no-cache",
  Vary: "Authorization",
};

function reply(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: noStoreHeaders });
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

function isAuthorized(request: Request, secret: string): boolean {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  const token = authorization.slice("Bearer ".length);
  if (!token || Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES) return false;

  // Fixed-length digests let timingSafeEqual handle every token length.
  return timingSafeEqual(digest(token), digest(secret));
}

export async function POST(request: Request): Promise<NextResponse> {
  if (process.env.VERCEL_ENV !== "preview") {
    return reply({ status: "BLOCKED", code: "PREVIEW_ONLY" }, 404);
  }

  const secret = process.env.J1D_SMOKE_SECRET;
  if (
    process.env.J1D_SMOKE_ENABLED !== "true" ||
    !secret ||
    Buffer.byteLength(secret, "utf8") < MIN_SECRET_BYTES
  ) {
    return reply({ status: "BLOCKED", code: "BLOCKED_CONFIG" }, 503);
  }

  if (!isAuthorized(request, secret)) {
    return reply({ status: "BLOCKED", code: "UNAUTHORIZED" }, 401);
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return reply({ status: "BLOCKED", code: "MALFORMED_REQUEST" }, 400);
  }

  const result = await runJ1dCapabilitySmoke(new NvidiaProvider());
  if (result.status === "BLOCKED") return reply(result, 502);
  return reply(result, 200);
}

function methodNotAllowed(_request: Request): NextResponse {
  return reply({ status: "BLOCKED", code: "METHOD_NOT_ALLOWED" }, 405);
}

export const GET = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = methodNotAllowed;
