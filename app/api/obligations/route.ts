import { projectObligationList } from "../../../src/server/obligation-read-model";
import { loadPublicSourceRecords } from "../../../src/server/source-records";
import { NextResponse } from "next/server";

import { getDemoState } from "../../../src/server/demo-state";

export async function GET() {
  // Source withdrawal must be checked before hydration, whose durable loader
  // can seed/migrate state. An empty source never requires that side effect.
  try {
    if (loadPublicSourceRecords().length === 0) {
      return NextResponse.json({ obligations: [], assessed_count: 0, total_count: 0 });
    }
  } catch {
    return NextResponse.json({ error: "Current source cannot be verified.", code: "SRC-001" }, { status: 503 });
  }
  return projectObligationList(await getDemoState());
}
