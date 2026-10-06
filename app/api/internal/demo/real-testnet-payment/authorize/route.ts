import { NextResponse } from "next/server";

/** Authorization is available only through the selected genuine obligation
 * route, which resolves current LIVE_AI assessment and its bound proxy. */
export async function POST() {
  return NextResponse.json({ error: "Fixed synthetic authorization lane is retired; use the selected genuine obligation lifecycle." }, { status: 410 });
}
