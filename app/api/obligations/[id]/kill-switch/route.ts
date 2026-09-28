import { NextResponse } from "next/server";

import { DEMO_ORGANIZATION_ID, getDemoState } from "../../../../../src/server/demo-state";
import { DemoStateConflictError } from "../../../../../src/server/supabase-demo-state-repository";

interface KillSwitchRequestBody {
  action: "ACTIVATE" | "DEACTIVATE";
  scope: "TRANSACTION" | "GLOBAL";
}

/**
 * J3 kill-switch control surface. Exposes exactly two of the blueprint's
 * Kill Switch Scopes to the demo UI: TRANSACTION_DISABLED (this obligation
 * only) and GLOBAL_EXECUTION_DISABLED (every obligation, every
 * organization). This route only flips the switch — it never itself blocks
 * or unblocks an in-flight execution; that check already happens inside
 * the Safety Kernel (pre-approval) and the Execution Worker (pre-submit)
 * via AuthorityStore.isExecutionKillSwitched, unchanged by this route.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = await getDemoState();
  const body = (await request.json().catch(() => ({}))) as Partial<KillSwitchRequestBody>;

  if (body.action !== "ACTIVATE" && body.action !== "DEACTIVATE") {
    return NextResponse.json({ error: 'action must be "ACTIVATE" or "DEACTIVATE"' }, { status: 400 });
  }
  if (body.scope !== "TRANSACTION" && body.scope !== "GLOBAL") {
    return NextResponse.json({ error: 'scope must be "TRANSACTION" or "GLOBAL"' }, { status: 400 });
  }

  const targetId = body.scope === "TRANSACTION" ? id : undefined;
  const killSwitchScope = body.scope === "TRANSACTION" ? "TRANSACTION_DISABLED" : "GLOBAL_EXECUTION_DISABLED";

  if (body.action === "ACTIVATE") {
    state.store.activateKillSwitch(killSwitchScope, targetId);
  } else {
    state.store.deactivateKillSwitch(killSwitchScope, targetId);
  }

  try {
    await state.flush();
  } catch (error) {
    if (error instanceof DemoStateConflictError) {
      return NextResponse.json({ error: error.message, code: "OPS-002" }, { status: 409 });
    }
    throw error;
  }

  return NextResponse.json({
    scope: body.scope,
    action: body.action,
    execution_kill_switched: state.store.isExecutionKillSwitched(DEMO_ORGANIZATION_ID, id),
  });
}
