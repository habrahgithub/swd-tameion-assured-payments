import { NextResponse } from "next/server";

import { buildJ2PrimeApprovalPacket, renderJ2PrimeApprovalPacketText } from "../../../../../src/pipeline/prime-approval-packet";
import { getDemoState } from "../../../../../src/server/demo-state";

/**
 * Renders the exact-intent disclosure Prime must approve before any real J2
 * Arc Testnet transfer (DIR-TAMEION-PROTOTYPE-CLAUDE-001 gate 1). This route
 * only reads an already-sealed PAE and formats it — it never submits
 * anything and is unrelated to /execute.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = getDemoState();
  const sealed = state.getSealedPae(id);
  if (!sealed) {
    return NextResponse.json({ error: "No sealed PAE for this obligation; authorize it first." }, { status: 409 });
  }
  const packet = buildJ2PrimeApprovalPacket(sealed);
  return NextResponse.json({ packet, text: renderJ2PrimeApprovalPacketText(packet) });
}
