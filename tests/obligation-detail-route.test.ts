import { describe, expect, it } from "vitest";

import { GET } from "../app/api/obligations/[id]/route";
import { DEMO_ORGANIZATION_ID, getDemoState } from "../src/server/demo-state";

describe("obligation detail truth-layer API", () => {
  it("returns server-derived source, Tameion control, and settlement truth", async () => {
    const response = await GET(
      new Request("http://localhost/api/obligations/OBL-J0C-001"),
      { params: Promise.resolve({ id: "OBL-J0C-001" }) },
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.truth.source_truth.source.source_kind).toBe("DIRECT_EVIDENCE");
    expect(body.truth.source_truth.source.approval_state).toBe("NOT_ASSERTED");
    expect(body.truth.source_truth.source.execution_authority).toBe("NONE");
    expect(body.truth.tameion_control_truth.role).toBe("ASSURED_PAYMENT_CONTROL_PLANE");
    expect(body.truth.tameion_control_truth.execution_release_authority).toBe("NOT_GRANTED");
    expect(body.truth.settlement_truth.provider_target).toBe("CIRCLE_DCW");
    expect(body.truth.settlement_truth.runtime).toBe("SIMULATED");
    expect(body.truth.settlement_truth.status).toBe("NOT_SUBMITTED");
    expect(body.demo_arc_trust_simulated).toBe(true);
    expect(body.aggregate.product_trust_provenance).toBe("SIMULATED_DEMO_FIXTURE");
    expect(body.record).toMatchObject({ amount: "5760.00", currency: "AED" });
  });

  it("projects a transaction kill switch from server authority state into the truth layer", async () => {
    const state = await getDemoState();
    state.store.activateKillSwitch("TRANSACTION_DISABLED", "OBL-J0C-001");
    try {
      const response = await GET(
        new Request("http://localhost/api/obligations/OBL-J0C-001"),
        { params: Promise.resolve({ id: "OBL-J0C-001" }) },
      );
      const body = await response.json();
      expect(body.truth.tameion_control_truth.execution_kill_switched).toBe(true);
      expect(body.truth.source_truth.source.execution_authority).toBe("NONE");
      expect(body.truth.tameion_control_truth.execution_release_authority).toBe("NOT_GRANTED");
    } finally {
      state.store.deactivateKillSwitch("TRANSACTION_DISABLED", "OBL-J0C-001");
    }
  });
});
