import { NextResponse } from "next/server";

/** Retire the fixed synthetic provider submission endpoint. The sole allowed
 * submission route resolves the selected source identity and exact PAE. */
export async function POST() {
  return NextResponse.json({ error: "Fixed synthetic submission lane is retired; execution must use the selected genuine obligation identity." }, { status: 410 });
}
