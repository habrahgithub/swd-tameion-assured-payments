import { describe, expect, it } from "vitest";

import { GET } from "../app/api/obligations/[id]/route";
import { DEMO_ORGANIZATION_ID, getDemoState } from "../src/server/demo-state";
import { AuthorityStore } from "../src/authority/aggregate";
import { sealTestAssessment } from "./test-support/seal-assessment";

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
    // AED 5760.00 is admitted via conversion: USD = 5760 / 3.6725 = 1568.413887.
    expect(body.truth.settlement_truth.settlement_amount).toBe("1568.413887");
    expect(body.truth.settlement_truth.source_amount).toBe("5760.00");
    expect(body.truth.settlement_truth.source_currency).toBe("AED");
    expect(body.truth.settlement_truth.settlement_conversion_rate).toBe("3.6725");
    expect(body.demo_arc_trust_simulated).toBe(true);
    expect(body.aggregate.product_trust_provenance).toBe("SIMULATED_DEMO_FIXTURE");
    expect(body.aggregate.source_amount).toBe("5760.00");
    expect(body.aggregate.source_currency).toBe("AED");
    expect(body.aggregate.settlement_conversion_rate).toBe("3.6725");
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

      it("projects provider/runtime truth from the sealed assessment into current_assessment", async () => {
    const state = await getDemoState();
    // Save snapshot so we can restore after test
    const savedSnapshot = state.store.exportSnapshot();
    try {
      // Explicit: the demo fixture must carry a sealed assessment so the
      // provider truth projection below is actually exercised (not skipped).
      sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, "OBL-J0C-001", 1, {
        provider_name: "demo-fx-provider-v1",
        provider_mode: "NOT_LIVE_AI",
      });
      const response = await GET(
        new Request("http://localhost/api/obligations/OBL-J0C-001"),
        { params: Promise.resolve({ id: "OBL-J0C-001" }) },
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.current_assessment).toBeTruthy();
      expect(body.current_assessment).toHaveProperty("provider_used");
      expect(body.current_assessment).toHaveProperty("provider_mode");
      expect(["LIVE_AI", "NOT_LIVE_AI", "BLOCKED_EXTERNAL"]).toContain(body.current_assessment.provider_mode);
      expect(typeof body.current_assessment.provider_used).toBe("string");
        } finally {
      // Restore store to its pre-test state
      const restored = AuthorityStore.fromSnapshot(savedSnapshot);
      (state as any).store = restored;
    }
  });
});
