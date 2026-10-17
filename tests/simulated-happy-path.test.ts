import { describe, expect, it } from "vitest";

import {
  runSimulatedHappyPath,
  runSimulatedBlockedVariant,
  runSimulatedAttackVariant,
  SimulatedDemoGuardError,
  SIMULATED_HAPPY_PATH_OBLIGATION_ID,
  SIMULATED_BLOCKED_OBLIGATION_ID,
  SIMULATED_HAPPY_PATH_LABEL,
  FAKE_PROVIDER_LABEL,
  NOT_VENDOR_PAYMENT_LABEL,
} from "../src/demo/simulated-happy-path";

describe("#44 simulated happy path (isolated synthetic prototype slice)", () => {
  it("uses the exact synthetic obligation id and never collides with a genuine OBL-J0C-* id", () => {
    expect(SIMULATED_HAPPY_PATH_OBLIGATION_ID).toBe("DEMO-SIMULATED-HAPPY-001");
    expect(SIMULATED_HAPPY_PATH_OBLIGATION_ID).not.toMatch(/^OBL-J0C-/);
    expect(SIMULATED_BLOCKED_OBLIGATION_ID).not.toMatch(/^OBL-J0C-/);
  });

  it("runs assessment -> authorization -> Safety Kernel PASS -> signed PAE -> ExecutionWorker -> FakeProviderAdapter -> reconciled/settled, with exactly one provider submission", async () => {
    const result = await runSimulatedHappyPath();

    expect(result.obligation_id).toBe(SIMULATED_HAPPY_PATH_OBLIGATION_ID);
    expect(result.label).toBe(SIMULATED_HAPPY_PATH_LABEL);
    expect(result.provider_label).toBe(FAKE_PROVIDER_LABEL);
    expect(result.vendor_notice).toBe(NOT_VENDOR_PAYMENT_LABEL);

    expect(result.safety_kernel_overall).toBe("PASS");
    expect(result.execution.status).toBe("SETTLED");
    expect(result.aggregate_state).toBe("RECONCILED");
    expect(result.obligation.obligation_id).toBe(SIMULATED_HAPPY_PATH_OBLIGATION_ID);
    expect(result.obligation.state).toBe("APPROVAL_PENDING");
    expect(result.assessment.decision).toBe("PAY");
    expect(result.assessment.provider_mode).toBe("NOT_LIVE_AI");
    expect(result.human_authorization.state).toBe("AUTHORIZED");
    expect(result.assurance.pae_state).toBe("CONSUMED");
    expect(result.assurance.safety_kernel_overall).toBe("PASS");
    expect(result.execution.provider_label).toBe(FAKE_PROVIDER_LABEL);
    expect(result.reconciliation.aggregate_state).toBe("RECONCILED");
    expect(result.obligation_id).not.toMatch(/^OBL-J0C-/);
    expect(result.label).toBe("SIMULATED_HAPPY_PATH");
    expect(result.vendor_notice).toBe("NOT_VENDOR_PAYMENT");

    // Exactly one fake-provider submission on the happy path.
    expect(result.provider_submission_count).toBe(1);
  });

  it("produces an independent fresh in-memory result on every call (no durable/shared state leaks across runs)", async () => {
    const first = await runSimulatedHappyPath();
    const second = await runSimulatedHappyPath();

    // Each call builds its own fresh in-memory AuthorityStore from identical
    // seed data, so both runs independently reach the same terminal state
    // with exactly one provider submission each — nothing is shared or
    // accumulated across calls.
    expect(first.provider_submission_count).toBe(1);
    expect(second.provider_submission_count).toBe(1);
    expect(second.aggregate_state).toBe("RECONCILED");
    expect(first.execution.idempotency_key).toBe(second.execution.idempotency_key);
  });

  it("blocks the synthetic variant whose destination readiness is not verified, with zero provider submissions", () => {
    const result = runSimulatedBlockedVariant();

    expect(result.obligation_id).toBe(SIMULATED_BLOCKED_OBLIGATION_ID);
    expect(result.blocked).toBe(true);
    expect(["HOLD", "BLOCK"]).toContain(result.safety_kernel_overall);
    expect(result.control_results.some((control) => control.control_id === "SK-DESTINATION-TRUST" && control.result !== "PASS")).toBe(true);
    expect(result.provider_label).toBe(FAKE_PROVIDER_LABEL);
    expect(result.vendor_notice).toBe(NOT_VENDOR_PAYMENT_LABEL);

    // Zero provider submissions: the FakeProviderAdapter instantiated for
    // this variant must never have been invoked.
    expect(result.provider_submission_count).toBe(0);
  });

  it("blocks a changed destination after synthetic authorization before fake provider submission", async () => {
    const result = await runSimulatedAttackVariant();
    expect(result.obligation_id).toBe("DEMO-SIMULATED-ATTACK-001");
    expect(result.blocked).toBe(true);
    expect(result.reason).toContain("aggregate_version");
    expect(result.worker_calls).toBe(1);
    expect(result.provider_submissions).toBe(0);
    expect(result.provider_label).toBe(FAKE_PROVIDER_LABEL);
    expect(result.vendor_notice).toBe(NOT_VENDOR_PAYMENT_LABEL);
  });

  it("exports a guard error class usable to detect a genuine-obligation-id collision attempt", () => {
    const error = new SimulatedDemoGuardError("refused", "DEMO-001");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("DEMO-001");
  });
});
