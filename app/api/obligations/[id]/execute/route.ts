import { NextResponse } from "next/server";

import { DEMO_ORGANIZATION_ID, getDemoState } from "../../../../../src/server/demo-state";
import { DemoStateConflictError } from "../../../../../src/server/supabase-demo-state-repository";
import { getCurrentSettlementProxyPacket } from "../../../../../src/server/settlement-proxy-packet";
import { ExecutionBlockedError } from "../../../../../src/execution/worker";

const EXECUTION_CONFIRMATION = "SUBMIT EXACT TESTNET SETTLEMENT PROXY";

/** Sole provider submission path for the selected genuine-obligation proxy.
 * UNKNOWN and persisted submissions are reconciliation-only; they are never
 * re-entered through the worker. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => ({})) as {
    expected_version?: unknown; packet_sha256?: unknown; pae_instruction_hash?: unknown; confirmation?: unknown;
  };
  if (!Number.isSafeInteger(body.expected_version) || typeof body.packet_sha256 !== "string" ||
      !/^[0-9a-f]{64}$/.test(body.packet_sha256) || typeof body.pae_instruction_hash !== "string" ||
      !/^[0-9a-f]{64}$/.test(body.pae_instruction_hash) || body.confirmation !== EXECUTION_CONFIRMATION) {
    return NextResponse.json({ error: "Current aggregate version, exact packet and PAE hashes, and explicit proxy confirmation are required." }, { status: 400 });
  }

  const state = await getDemoState();
  if (state.providerAdapter.name !== "arc-circle-live") {
    return NextResponse.json({ error: "The Circle Arc Testnet adapter is unavailable. No provider submission was made." }, { status: 503 });
  }
  const sealed = state.getSealedPae(id);
  const aggregate = state.store.get(DEMO_ORGANIZATION_ID, id);
  const prior = sealed ? state.worker.getExecutionRecord(sealed.payload.idempotency_key) : undefined;
  if (prior) {
    if (prior.status === "UNKNOWN" || prior.status === "SUBMITTING") {
      return NextResponse.json({ error: "This identity has an ambiguous prior provider outcome. Use read-only status reconciliation; resubmission is prohibited.", execution: prior }, { status: 409 });
    }
    return NextResponse.json({ execution: prior, source_payable_state: state.getRecord(id)?.state_at_event_baseline }, { status: 200 });
  }
  const exactPacket = getCurrentSettlementProxyPacket(state, id);
  if (!exactPacket || !sealed || aggregate.aggregate_version !== body.expected_version ||
      sealed.instruction_hash !== body.pae_instruction_hash || exactPacket.packet_sha256 !== body.packet_sha256 ||
      process.env.J2A_EXECUTION_AUTHORIZED_PACKET_SHA256 !== exactPacket.packet_sha256) {
    return NextResponse.json({ error: "Execution remains locked until the current PAE and exact packet are separately Prime-authorized." }, { status: 403 });
  }

  try {
    const execution = await state.worker.execute(sealed);
    await state.flush();
    return NextResponse.json({
      execution,
      classification: exactPacket.packet.classification,
      source_settlement_disclosure: "Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.",
      source_payable_state: state.getRecord(id)?.state_at_event_baseline,
      execution_authority: "ONE_EXACT_PACKET_PRIME_AUTHORIZED",
    }, { status: execution.status === "UNKNOWN" ? 202 : execution.status === "BLOCKED" ? 409 : 200 });
  } catch (error) {
    if (error instanceof ExecutionBlockedError) {
      try {
        await state.flush();
      } catch (persistenceError) {
        if (persistenceError instanceof DemoStateConflictError) return NextResponse.json({ error: persistenceError.message, code: "OPS-002" }, { status: 409 });
        throw persistenceError;
      }
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }
    if (error instanceof DemoStateConflictError) return NextResponse.json({ error: error.message, code: "OPS-002" }, { status: 409 });
    throw error;
  }
}
