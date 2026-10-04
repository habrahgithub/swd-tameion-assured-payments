import { beforeEach, describe, expect, it, vi } from "vitest";

const stateRef = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  approveAndSealPae: vi.fn(),
}));

vi.mock("../src/server/demo-state", () => ({
  getJ2aRealTestnetDemoState: async () => stateRef.current,
}));
vi.mock("../src/pipeline/authorize-and-seal", () => ({
  approveAndSealPae: stateRef.approveAndSealPae,
  AssuranceFailedError: class AssuranceFailedError extends Error {},
}));

import { GET as getDemoStatus } from "../app/api/internal/demo/real-testnet-payment/status/route";
import { POST as executeDemo } from "../app/api/internal/demo/real-testnet-payment/execute/route";
import { POST as authorizeDemo } from "../app/api/internal/demo/real-testnet-payment/authorize/route";

function stateWithoutPreflight() {
  return {
    lastPreflight: null,
    store: {
      get: vi.fn(() => { throw new Error("aggregate should not be read"); }),
      getCurrentAssessment: vi.fn(),
    },
    getSealedPae: vi.fn(() => undefined),
    getAuthorizationArtifacts: vi.fn(() => undefined),
    worker: {
      execute: vi.fn(),
      getExecutionRecord: vi.fn(),
      reconcilePendingByIdempotencyKey: vi.fn(),
    },
    flush: vi.fn(),
  } as unknown as Record<string, unknown>;
}

describe("J2A real-testnet API gates", () => {
  beforeEach(() => {
    stateRef.current = stateWithoutPreflight();
    stateRef.approveAndSealPae.mockReset();
  });

  it("reports the isolated lifecycle while keeping execution locked and performing no provider write", async () => {
    const response = await getDemoStatus();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT",
      obligation_id: "DEMO-ARC-TESTNET-001",
      execution_gate: "LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION",
      lifecycle: [
        { stage: "Obligation", status: "NOT_CREATED" },
        { stage: "AI Assessment", status: "NOT_ASSESSED" },
        { stage: "Assurance & Authorization", status: "NOT_AUTHORIZED" },
        { stage: "Execution", status: "NOT_SUBMITTED" },
        { stage: "Reconciliation & Evidence", status: "NOT_SUBMITTED" },
      ],
    });
    expect((stateRef.current as any).worker.execute).not.toHaveBeenCalled();
  });

  it("refuses execution before a current authorized intent exists", async () => {
    const response = await executeDemo(new Request("http://localhost/api/internal/demo/real-testnet-payment/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_version: 1,
        packet_sha256: "0".repeat(64),
        pae_instruction_hash: "0".repeat(64),
        confirmation: "SUBMIT EXACT TESTNET DEMO TRANSFER",
      }),
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/PAE|preflight|authorized/i);
    expect((stateRef.current as any).worker.execute).not.toHaveBeenCalled();
  });

  it.each(["HOLD", "ESCALATE"] as const)("does not create authorization or a PAE for a current %s assessment", async (decision) => {
    const hash = "a".repeat(64);
    stateRef.current = {
      lastPreflight: { readiness: "READY", obligation_id: "DEMO-ARC-TESTNET-001", evidence_sha256: hash },
      store: {
        get: vi.fn(() => ({ aggregate_version: 7, evidence_hashes: [hash] })),
        getCurrentAssessment: vi.fn(() => ({
          hash,
          record: {
            assessment_id: "ASM-J2A-1",
            aggregate_version: "7",
            provider_mode: "LIVE_AI",
            decision,
            missing_evidence: [],
            race: { result: { validated_findings: [] } },
          },
        })),
      },
      getSealedPae: vi.fn(() => undefined),
      getAuthorizationArtifacts: vi.fn(() => undefined),
      worker: { execute: vi.fn() },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;

    const response = await authorizeDemo(new Request("http://localhost/api/internal/demo/real-testnet-payment/authorize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_version: 7,
        reviewed_assessment_id: "ASM-J2A-1",
        reviewed_assessment_hash: hash,
        confirmation: "AUTHORIZE EXACT CURRENT TESTNET DEMO INTENT",
        actor_id: "USR-PRIME-01",
        reason_text: "Reviewed current testnet demonstration intent.",
      }),
    }));

    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/Only a current LIVE_AI PAY assessment/);
    expect(stateRef.approveAndSealPae).not.toHaveBeenCalled();
  });

  it("refuses a stale aggregate version before the execution worker can run", async () => {
    const hash = "b".repeat(64);
    const execute = vi.fn();
    stateRef.current = {
      lastPreflight: { readiness: "READY", evidence_sha256: hash },
      store: {
        get: vi.fn(() => ({ aggregate_version: 7, evidence_hashes: [hash] })),
        getCurrentAssessment: vi.fn(() => ({ record: { aggregate_version: "7" } })),
      },
      getSealedPae: vi.fn(() => ({})),
      getAuthorizationArtifacts: vi.fn(() => ({})),
      worker: { execute, getExecutionRecord: vi.fn() },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;

    const response = await executeDemo(new Request("http://localhost/api/internal/demo/real-testnet-payment/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_version: 6,
        packet_sha256: "c".repeat(64),
        pae_instruction_hash: "d".repeat(64),
        confirmation: "SUBMIT EXACT TESTNET DEMO TRANSFER",
      }),
    }));

    expect(response.status).toBe(409);
    expect(execute).not.toHaveBeenCalled();
  });
});
