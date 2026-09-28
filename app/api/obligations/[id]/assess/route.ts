import { NextResponse } from "next/server";

import { buildFinanceAgentContext } from "../../../../../src/agent/context-builder";
import { DeterministicFallbackProvider, NvidiaProvider } from "../../../../../src/agent/ai-provider";
import { assessObligation } from "../../../../../src/agent/finance-agent";
import { DEMO_ORGANIZATION_ID, getDemoState } from "../../../../../src/server/demo-state";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const state = getDemoState();
  const record = state.getRecord(id);
  if (!record) {
    return NextResponse.json({ error: `Unknown obligation ${id}` }, { status: 404 });
  }

  const provider = process.env.NVIDIA_API_KEY ? new NvidiaProvider() : new DeterministicFallbackProvider();
  const context_ = buildFinanceAgentContext(record);
  const decision = await assessObligation(context_, provider);

  // Persist the decision as the server-side source of truth for the J1
  // candidate-selection gate — POST /approve refuses any obligation without
  // a recorded PAY decision here, regardless of what the client claims.
  state.store.recordAssessment(DEMO_ORGANIZATION_ID, id, decision.decision);

  return NextResponse.json({ decision, provider_used: provider.name });
}
