import { NextResponse } from "next/server";

/** Lifecycle status now belongs to GET /api/obligations/[id], which resolves
 * the genuine source record, namespace-owned proxy, and worker ledger. */
export async function GET() {
  return NextResponse.json({ error: "Fixed synthetic status lane is retired; fetch the selected genuine obligation detail." }, { status: 410 });
}
