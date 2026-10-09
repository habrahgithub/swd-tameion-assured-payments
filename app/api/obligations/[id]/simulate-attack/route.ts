import { NextResponse } from "next/server";

/** The former demonstration mutated a selected genuine obligation before
 * invoking the worker. Keep a typed response for old clients, but do not
 * perform any state change here. Changed-destination proof now runs only on
 * the isolated synthetic in-memory demo path. */
export async function POST() {
  return NextResponse.json({
    error: "This legacy attack route is disabled because it targeted genuine obligation state. Use the isolated synthetic demo lane.",
    code: "DEMO-004",
  }, { status: 410, headers: { "Cache-Control": "no-store, max-age=0" } });
}
