import { NextResponse } from "next/server";

/** The legacy fixed-ID assessment lane is retired. Assessment belongs to the
 * selected genuine obligation route at /api/obligations/[id]/assess. */
export async function POST() {
  return NextResponse.json({ error: "Fixed synthetic assessment lane is retired; select and assess a frozen genuine obligation." }, { status: 410 });
}
