import { NextResponse } from "next/server";

/** No verified requester boundary exists in this private demonstrator.
 * Caller fields, headers and a server-designated actor are not authentication.
 * Refuse before loading durable state, parsing mutation input or any side effect.
 */
export async function POST(_request: Request, _context: { params: Promise<{ id: string }> }) {
  return NextResponse.json({
    error: "Mutation disabled: requester identity cannot be verified in this demonstrator.",
    code: "REQUESTER_UNVERIFIED",
  }, { status: 403 });
}
