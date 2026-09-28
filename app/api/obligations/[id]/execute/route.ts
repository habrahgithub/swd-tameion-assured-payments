import { NextResponse } from "next/server";

import { ExecutionBlockedError } from "../../../../../src/execution/worker";
import { getDemoState } from "../../../../../src/server/demo-state";
import { DemoStateConflictError } from "../../../../../src/server/supabase-demo-state-repository";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = await getDemoState();
  const sealed = state.getSealedPae(id);
  if (!sealed) {
    return NextResponse.json({ error: "No sealed PAE for this obligation; approve first." }, { status: 409 });
  }

  try {
    const record = await state.worker.execute(sealed);
    return NextResponse.json({ execution: record });
  } catch (error) {
    if (error instanceof ExecutionBlockedError) {
      try {
        await state.flush();
      } catch (persistenceError) {
        if (persistenceError instanceof DemoStateConflictError) {
          return NextResponse.json({ error: persistenceError.message, code: "OPS-002" }, { status: 409 });
        }
        throw persistenceError;
      }
      return NextResponse.json({ error: error.message, code: error.code, blocked: true }, { status: 409 });
    }
    if (error instanceof DemoStateConflictError) {
      return NextResponse.json({ error: error.message, code: "OPS-002" }, { status: 409 });
    }
    throw error;
  }
}
