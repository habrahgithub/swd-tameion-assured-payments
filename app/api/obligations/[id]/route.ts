import { NextResponse } from "next/server";
import { isCurrentSourceEligible } from "../../../../src/server/source-records";
import { DEMO_ORGANIZATION_ID, getDemoState } from "../../../../src/server/demo-state";
import { projectObligationDetail } from "../../../../src/server/obligation-read-model";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (isCurrentSourceEligible(DEMO_ORGANIZATION_ID, id) !== true) {
    return NextResponse.json({ error: "Obligation source record not found", code: "SRC-001" }, { status: 404 });
  }
  return projectObligationDetail(await getDemoState(), id);
}
