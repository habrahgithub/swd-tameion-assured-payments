import { NextResponse } from "next/server";

import { runJ2aReadOnlyPreflight } from "../../../../../../src/demo/real-testnet-payment";
import { getJ2aRealTestnetDemoState } from "../../../../../../src/server/demo-state";

export const dynamic = "force-dynamic";

/** Fresh, read-only Circle truth for the fixed J2A wallet pair. This route
 * never creates a wallet, requests testnet funds, or submits a transaction. */
export async function POST() {
  const state = await getJ2aRealTestnetDemoState();
  const result = await runJ2aReadOnlyPreflight();
  state.recordPreflight(result);
  await state.flush();
  return NextResponse.json({
    ...result,
    ...(result.readiness === "READY" ? { aggregate_version: state.store.get(result.organization_id, result.obligation_id).aggregate_version } : {}),
  }, { status: result.readiness === "READY" ? 200 : 409 });
}
