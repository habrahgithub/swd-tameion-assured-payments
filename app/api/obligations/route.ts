import { NextResponse } from "next/server";

import { getDemoState } from "../../../src/server/demo-state";

export function GET() {
  const state = getDemoState();
  return NextResponse.json({ obligations: state.listObligations() });
}
