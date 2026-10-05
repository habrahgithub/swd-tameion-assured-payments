import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const stateRef = vi.hoisted(() => ({
  current: null as Record<string, unknown> | null,
  approveAndSealPae: vi.fn(),
  verifyJ2aSealedPae: vi.fn(),
}));

vi.mock("../src/server/demo-state", () => ({
  getJ2aRealTestnetDemoState: async () => stateRef.current,
}));
vi.mock("../src/pipeline/authorize-and-seal", () => ({
  approveAndSealPae: stateRef.approveAndSealPae,
  AssuranceFailedError: class AssuranceFailedError extends Error {},
}));
vi.mock("../src/pae/sign-verify", async (importOriginal) => ({
  ...await importOriginal<typeof import("../src/pae/sign-verify")>(),
  verifySealedPae: vi.fn(),
}));
vi.mock("../src/demo/verify-j2a-pae", () => ({ verifyJ2aSealedPae: stateRef.verifyJ2aSealedPae }));

import { GET as getDemoStatus } from "../app/api/internal/demo/real-testnet-payment/status/route";
import { POST as executeDemo } from "../app/api/internal/demo/real-testnet-payment/execute/route";
import { POST as authorizeDemo } from "../app/api/internal/demo/real-testnet-payment/authorize/route";
import { buildJ2aExecutionPacket } from "../src/demo/real-testnet-payment";
import { PaeVerificationError } from "../src/pae/sign-verify";

function authorizedLineageFixture(overrides: {
  assessmentId?: string;
  historyAssessmentId?: string;
  historyHash?: string;
  historyAggregateVersion?: string;
} = {}) {
  const evidenceHash = "a".repeat(64);
  const assessmentHash = "c".repeat(64);
  const paeHash = "b".repeat(64);
  const approvalRecordHash = "d".repeat(64);
  const expires = new Date(Date.now() + 60 * 60_000).toISOString();
  const assessmentId = overrides.assessmentId ?? "ASM-J2A-REVIEWED-V3";
  const assessment = {
    assessment_id: overrides.historyAssessmentId ?? assessmentId,
    organization_id: "ORG-TAMEION-TESTNET-DEMO",
    obligation_id: "DEMO-ARC-TESTNET-001",
    aggregate_version: overrides.historyAggregateVersion ?? "3",
    decision: "PAY",
    provider_mode: "LIVE_AI",
    provider_name: "NVIDIA Build",
    model_id: "nvidia/nemotron-3-super-120b-a12b",
    model_config_version: "test-config",
    missing_evidence: [],
    reasons: [],
    race: { result: { validated_findings: [] } },
  };
  const evidence = {
    approval_id: "APR-J2A-1",
    organization_id: "ORG-TAMEION-TESTNET-DEMO",
    obligation_id: "DEMO-ARC-TESTNET-001",
    actor_id: "USR-PRIME-01",
    actor_role: "PRIME",
    authority_version: "1",
    reviewed_aggregate_version: "3",
    authorized_aggregate_version: "4",
    approved_at: "2026-10-05T05:00:00.000Z",
    policy_version: "J2A-1",
    approval_record_hash: approvalRecordHash,
    assessment_id: assessmentId,
    assessment_hash: assessmentHash,
  };
  const sealed = {
    instruction_hash: paeHash,
    signature: "e".repeat(128),
    payload: {
      instruction_id: "PAE-J2A-1", signing_key_id: "J2A-KEY-1", signing_algorithm: "Ed25519", pae_schema_version: "PAE-P0-1",
      organization_id: "ORG-TAMEION-TESTNET-DEMO", obligation_ids: ["DEMO-ARC-TESTNET-001"],
      evidence_hashes: [evidenceHash], counterparty_id: "CP-J2A-1", counterparty_version: "1",
      source_wallet_ref: "9fe9c001-a044-5f9a-8997-165474887952", source_wallet_version: "1",
      destination_ref: "CIRCLE-DCW-01769e53-cfbe-57aa-ba88-c787b8cba2d3", destination_version: "1",
      destination_address: "0x591a1002127b1605d9dbb51348787bbe3014b2b9",
      amount: "5.000000", atomic_amount: "5000000", asset: "USDC", network: "ARC_TESTNET",
      policy_version: "J2A-1", approval_evidence: [evidence], assurance_hash: "f".repeat(64),
      aggregate_version: "4", expiry: expires, nonce: "nonce-J2A-1", idempotency_key: "j2a-exact-key",
    },
  };
  const preflight = {
    readiness: "READY",
    evidence_sha256: evidenceHash,
    captured_at: "2026-10-04T10:00:00.000Z",
    organization_id: "ORG-TAMEION-TESTNET-DEMO",
    obligation_id: "DEMO-ARC-TESTNET-001",
    amount: "5.000000",
    asset: "USDC",
    network: "ARC_TESTNET",
    source_wallet: { id: "9fe9c001-a044-5f9a-8997-165474887952", address: "0x8a5ec63c8bc7a4d4b4f0134e034bda4c24043e95", network: "ARC_TESTNET", state: "LIVE", wallet_set_id: "2b72f116-16da-591a-9212-5382388a35c4" },
    destination_wallet: { id: "01769e53-cfbe-57aa-ba88-c787b8cba2d3", address: "0x591a1002127b1605d9dbb51348787bbe3014b2b9", name: "Tameion Test Counterparty", network: "ARC_TESTNET", state: "LIVE", wallet_set_id: "2b72f116-16da-591a-9212-5382388a35c4" },
    provider_token: { id: "native-arc-usdc", symbol: "USDC", decimals: 6, native: true },
    source_balance: "10.000000", estimated_network_fee: "0.001000", max_network_fee: "0.002000", max_total_debit: "5.012000",
    business_payment_instruction: {
      payer: { organization_id: "ORG-TAMEION-TESTNET-DEMO", display_name: "Tameion Testnet Demonstration Organization" },
      beneficiary: { beneficiary_id: "CP-J2A-1", display_name: "Tameion Test Counterparty" },
      commercial: { obligation_id: "DEMO-ARC-TESTNET-001", classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT", invoice_reference: "DEMO-ARC-TESTNET-001", invoice_date: "2026-10-04", effective_due_date: "2026-10-04", payment_basis: "PROTOTYPE_CASH_PAYMENT_DUE_ON_INVOICE_DATE", source_evidence_id: "J2A-DEMO-OBLIGATION-SYNTHETIC-EVIDENCE-001" },
    },
  };
  const aggregate = {
    organization_id: "ORG-TAMEION-TESTNET-DEMO", obligation_id: "DEMO-ARC-TESTNET-001", aggregate_version: 4,
    evidence_hashes: [evidenceHash], source_wallet_status: "ACTIVE", source_wallet_version: 1,
    destination_ref: "CIRCLE-DCW-01769e53-cfbe-57aa-ba88-c787b8cba2d3", destination_version: 1,
    destination_verification_status: "VERIFIED", destination_operational_status: "ACTIVE",
    counterparty_id: "CP-J2A-1", counterparty_version: 1,
  };
  const authorization = {
    approval_record: {
      approval_id: evidence.approval_id, organization_id: evidence.organization_id, obligation_id: evidence.obligation_id,
      actor_id: evidence.actor_id, actor_role: evidence.actor_role, action: "APPROVE", authority_version: evidence.authority_version,
      reviewed_aggregate_version: "3", authorized_aggregate_version: "4", policy_version: evidence.policy_version,
      previous_state: "REVIEWED", new_state: "AUTHORIZED", approved_at: evidence.approved_at,
      reason_hash: "1".repeat(64), assessment_id: assessmentId, assessment_hash: assessmentHash,
    },
    approval_record_hash: approvalRecordHash,
    assurance_record: { organization_id: "ORG-TAMEION-TESTNET-DEMO", obligation_id: "DEMO-ARC-TESTNET-001", result: "PASS", aggregate_version: "4" },
    assurance_hash: sealed.payload.assurance_hash,
    sealed_pae: sealed,
  };
  return {
    evidenceHash,
    assessmentHash,
    paeHash,
    assessment,
    history: [{ record: assessment, hash: overrides.historyHash ?? assessmentHash }],
    preflight,
    aggregate,
    sealed,
    authorization,
  };
}

afterEach(() => vi.unstubAllEnvs());

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
    stateRef.verifyJ2aSealedPae.mockReset();
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

  it("recovers a persisted SUBMITTING marker through read-only status without invoking execute", async () => {
    const submitting = {
      obligation_id: "DEMO-ARC-TESTNET-001",
      idempotency_key: "j2a-exact-key",
      provider_ref: null,
      status: "SUBMITTING",
      atomic_amount: "5000000",
      destination_address: "0x591a1002127b1605d9dbb51348787bbe3014b2b9",
    };
    const execute = vi.fn();
    const recoverSubmittingByIdempotencyKey = vi.fn(async () => ({ ...submitting, status: "UNKNOWN" }));
    const reconcilePendingByIdempotencyKey = vi.fn(async () => ({ ...submitting, status: "UNKNOWN" }));
    const sealed = { payload: { idempotency_key: "j2a-exact-key" } };
    stateRef.current = {
      lastPreflight: {
        readiness: "READY",
        evidence_sha256: "a".repeat(64),
        captured_at: "2026-10-04T10:00:00.000Z",
        business_payment_instruction: {
          payer: { organization_id: "ORG-TAMEION-TESTNET-DEMO", display_name: "Test payer" },
          commercial: { obligation_id: "DEMO-ARC-TESTNET-001", classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT", invoice_reference: "DEMO-ARC-TESTNET-001", invoice_date: "2026-10-04", effective_due_date: "2026-10-04", payment_basis: "PROTOTYPE_CASH_PAYMENT_DUE_ON_INVOICE_DATE", source_evidence_id: "TEST-EVIDENCE" },
        },
        source_wallet: { id: "source-wallet", address: "0x1111111111111111111111111111111111111111", state: "LIVE", network: "ARC_TESTNET", wallet_set_id: "set" },
        destination_wallet: { id: "dest-wallet", address: "0x2222222222222222222222222222222222222222", name: "test counterparty", state: "LIVE", network: "ARC_TESTNET", wallet_set_id: "set" },
      },
      store: {
        get: vi.fn(() => ({ aggregate_version: 1 })),
        getCurrentAssessment: vi.fn(() => null),
      },
      getSealedPae: vi.fn(() => sealed),
      getAuthorizationArtifacts: vi.fn(() => null),
      worker: {
        execute,
        getExecutionRecord: vi.fn(() => submitting),
        recoverSubmittingByIdempotencyKey,
        reconcilePendingByIdempotencyKey,
      },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;

    const response = await getDemoStatus();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(execute).not.toHaveBeenCalled();
    expect(recoverSubmittingByIdempotencyKey).toHaveBeenCalledWith("j2a-exact-key", "ORG-TAMEION-TESTNET-DEMO");
    expect(reconcilePendingByIdempotencyKey).toHaveBeenCalledWith("j2a-exact-key", "ORG-TAMEION-TESTNET-DEMO");
    expect(data.execution.status).toBe("UNKNOWN");
  });

  it("retains the exact reviewed PAY assessment and builds a packet after approval advances aggregate v3 to v4", async () => {
    const fixture = authorizedLineageFixture();
    stateRef.current = {
      lastPreflight: fixture.preflight,
      store: {
        get: vi.fn(() => fixture.aggregate),
        getCurrentAssessment: vi.fn(() => null),
        getAssessmentHistory: vi.fn(() => fixture.history),
      },
      getSealedPae: vi.fn(() => fixture.sealed),
      getAuthorizationArtifacts: vi.fn(() => fixture.authorization),
      worker: { getExecutionRecord: vi.fn(() => null), recoverSubmittingByIdempotencyKey: vi.fn(), reconcilePendingByIdempotencyKey: vi.fn() },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;

    const response = await getDemoStatus();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.current_assessment).toMatchObject({ assessment_id: "ASM-J2A-REVIEWED-V3", assessment_hash: fixture.assessmentHash, decision: "PAY", provider_mode: "LIVE_AI" });
    expect(data.execution_packet).not.toBeNull();
    expect(data.execution_gate).toBe("LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION");
    expect(data.authorization_current).toBe(true);
  });

  it("keeps current-version authorization fail-closed when its reviewed lineage is malformed", async () => {
    const fixture = authorizedLineageFixture({ historyAssessmentId: "ASM-OTHER", historyHash: "9".repeat(64) });
    const unboundCurrentAssessment = {
      record: { ...fixture.assessment, assessment_id: "ASM-CURRENT-V4", aggregate_version: "4" },
      hash: "8".repeat(64),
    };
    stateRef.current = {
      lastPreflight: fixture.preflight,
      store: {
        get: vi.fn(() => fixture.aggregate),
        getCurrentAssessment: vi.fn(() => unboundCurrentAssessment),
        getAssessmentHistory: vi.fn(() => fixture.history),
      },
      getSealedPae: vi.fn(() => fixture.sealed),
      getAuthorizationArtifacts: vi.fn(() => fixture.authorization),
      worker: { getExecutionRecord: vi.fn(() => null), recoverSubmittingByIdempotencyKey: vi.fn(), reconcilePendingByIdempotencyKey: vi.fn() },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;

    const response = await getDemoStatus();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.current_assessment).toBeNull();
    expect(data.execution_packet).toBeNull();
    expect(data.execution_gate).toBe("LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION");
    expect(data.authorization_current).toBe(false);
  });

  it("shows a fresh current assessment when the latest authorization is stale", async () => {
    const fixture = authorizedLineageFixture();
    fixture.aggregate.aggregate_version = 5;
    const currentAssessment = {
      record: { ...fixture.assessment, assessment_id: "ASM-J2A-FRESH-V5", aggregate_version: "5" },
      hash: "7".repeat(64),
    };
    stateRef.current = {
      lastPreflight: fixture.preflight,
      store: {
        get: vi.fn(() => fixture.aggregate),
        getCurrentAssessment: vi.fn(() => currentAssessment),
        getAssessmentHistory: vi.fn(() => fixture.history),
      },
      getSealedPae: vi.fn(() => fixture.sealed),
      getAuthorizationArtifacts: vi.fn(() => fixture.authorization),
      worker: { getExecutionRecord: vi.fn(() => null), recoverSubmittingByIdempotencyKey: vi.fn(), reconcilePendingByIdempotencyKey: vi.fn() },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;

    const response = await getDemoStatus();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.current_assessment).toMatchObject({ assessment_id: "ASM-J2A-FRESH-V5", assessment_hash: currentAssessment.hash, decision: "PAY" });
    expect(data.execution_packet).toBeNull();
    expect(data.authorization_current).toBe(false);
    expect(data.execution_gate).toBe("LOCKED_AWAITING_PRIME_EXACT_PACKET_AUTHORIZATION");
  });

  it("fails closed when the reviewed assessment aggregate version differs from approval evidence", async () => {
    const fixture = authorizedLineageFixture({ historyAggregateVersion: "2" });
    stateRef.current = {
      lastPreflight: fixture.preflight,
      store: {
        get: vi.fn(() => fixture.aggregate),
        getCurrentAssessment: vi.fn(() => null),
        getAssessmentHistory: vi.fn(() => fixture.history),
      },
      getSealedPae: vi.fn(() => fixture.sealed),
      getAuthorizationArtifacts: vi.fn(() => fixture.authorization),
      worker: { getExecutionRecord: vi.fn(() => null), recoverSubmittingByIdempotencyKey: vi.fn(), reconcilePendingByIdempotencyKey: vi.fn() },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;

    const response = await getDemoStatus();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.current_assessment).toBeNull();
    expect(data.execution_packet).toBeNull();
    expect(data.authorization_current).toBe(false);
  });

  it("keeps pre-authorization status on the current assessment path", async () => {
    const fixture = authorizedLineageFixture();
    const current = { record: fixture.assessment, hash: fixture.assessmentHash };
    stateRef.current = {
      lastPreflight: fixture.preflight,
      store: {
        get: vi.fn(() => ({ ...fixture.aggregate, aggregate_version: 3 })),
        getCurrentAssessment: vi.fn(() => current),
        getAssessmentHistory: vi.fn(() => fixture.history),
      },
      getSealedPae: vi.fn(() => undefined),
      getAuthorizationArtifacts: vi.fn(() => undefined),
      worker: { getExecutionRecord: vi.fn() },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;

    const response = await getDemoStatus();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.current_assessment).toMatchObject({ assessment_id: current.record.assessment_id, decision: "PAY" });
    expect(data.execution_packet).toBeNull();
    expect(data.authorization_current).toBe(false);
  });

  it("uses reviewed assessment lineage after authorization but stays locked without exact packet authorization", async () => {
    const fixture = authorizedLineageFixture();
    const packet = buildJ2aExecutionPacket({
      preflight: fixture.preflight as never, aggregate: fixture.aggregate as never,
      assessment: fixture.assessment as never, assessmentHash: fixture.assessmentHash, sealedPae: fixture.sealed as never,
    });
    const execute = vi.fn();
    stateRef.current = {
      lastPreflight: fixture.preflight,
      store: {
        get: vi.fn(() => fixture.aggregate),
        getCurrentAssessment: vi.fn(() => null),
        getAssessmentHistory: vi.fn(() => fixture.history),
      },
      getSealedPae: vi.fn(() => fixture.sealed),
      getAuthorizationArtifacts: vi.fn(() => fixture.authorization),
      worker: { execute },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;
    vi.stubEnv("J2A_EXECUTION_AUTHORIZED_PACKET_SHA256", "0".repeat(64));

    const response = await executeDemo(new Request("http://localhost/api/internal/demo/real-testnet-payment/execute", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_version: 4,
        packet_sha256: packet.packet_sha256,
        pae_instruction_hash: fixture.paeHash,
        confirmation: "SUBMIT EXACT TESTNET DEMO TRANSFER",
      }),
    }));

    expect(response.status).toBe(403);
    expect((await response.json()).error).toMatch(/separately authorizes this exact packet/);
    expect(execute).not.toHaveBeenCalled();
  });

  it("submits to the mocked worker once only when the exact packet hash is authorized", async () => {
    const fixture = authorizedLineageFixture();
    const packet = buildJ2aExecutionPacket({
      preflight: fixture.preflight as never, aggregate: fixture.aggregate as never,
      assessment: fixture.assessment as never, assessmentHash: fixture.assessmentHash, sealedPae: fixture.sealed as never,
    });
    const execute = vi.fn(async () => ({ status: "SETTLED", idempotency_key: "j2a-exact-key" }));
    stateRef.current = {
      lastPreflight: fixture.preflight,
      store: {
        get: vi.fn(() => fixture.aggregate),
        getCurrentAssessment: vi.fn(() => null),
        getAssessmentHistory: vi.fn(() => fixture.history),
      },
      getSealedPae: vi.fn(() => fixture.sealed),
      getAuthorizationArtifacts: vi.fn(() => fixture.authorization),
      worker: { execute },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;
    vi.stubEnv("J2A_EXECUTION_AUTHORIZED_PACKET_SHA256", packet.packet_sha256);

    const response = await executeDemo(new Request("http://localhost/api/internal/demo/real-testnet-payment/execute", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_version: 4,
        packet_sha256: packet.packet_sha256,
        pae_instruction_hash: fixture.paeHash,
        confirmation: "SUBMIT EXACT TESTNET DEMO TRANSFER",
      }),
    }));

    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(stateRef.verifyJ2aSealedPae).toHaveBeenCalledWith(fixture.sealed);
  });

  it("returns a safe verification code and makes no worker call when PAE trust initialization fails", async () => {
    const fixture = authorizedLineageFixture();
    const execute = vi.fn();
    stateRef.verifyJ2aSealedPae.mockImplementationOnce(() => { throw new PaeVerificationError("hidden detail", "PAE-015"); });
    stateRef.current = {
      lastPreflight: fixture.preflight,
      store: {
        get: vi.fn(() => fixture.aggregate),
        getCurrentAssessment: vi.fn(() => null),
        getAssessmentHistory: vi.fn(() => fixture.history),
      },
      getSealedPae: vi.fn(() => fixture.sealed),
      getAuthorizationArtifacts: vi.fn(() => fixture.authorization),
      worker: { execute },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;
    const packet = buildJ2aExecutionPacket({
      preflight: fixture.preflight as never, aggregate: fixture.aggregate as never,
      assessment: fixture.assessment as never, assessmentHash: fixture.assessmentHash, sealedPae: fixture.sealed as never,
    });
    vi.stubEnv("J2A_EXECUTION_AUTHORIZED_PACKET_SHA256", packet.packet_sha256);

    const response = await executeDemo(new Request("http://localhost/api/internal/demo/real-testnet-payment/execute", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_version: 4, packet_sha256: packet.packet_sha256, pae_instruction_hash: fixture.paeHash, confirmation: "SUBMIT EXACT TESTNET DEMO TRANSFER" }),
    }));
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.code).toBe("PAE-015");
    expect(JSON.stringify(data)).not.toContain("hidden detail");
    expect(execute).not.toHaveBeenCalled();
  });

  it("reports invalid PAE lifecycle and withholds packet after status verification fails", async () => {
    const fixture = authorizedLineageFixture();
    stateRef.verifyJ2aSealedPae.mockImplementationOnce(() => { throw new PaeVerificationError("sensitive detail", "PAE-015"); });
    const getExecutionRecord = vi.fn(() => null);
    const recoverSubmittingByIdempotencyKey = vi.fn();
    stateRef.current = {
      lastPreflight: fixture.preflight,
      store: {
        get: vi.fn(() => fixture.aggregate),
        getCurrentAssessment: vi.fn(() => null),
        getAssessmentHistory: vi.fn(() => fixture.history),
      },
      getSealedPae: vi.fn(() => fixture.sealed),
      getAuthorizationArtifacts: vi.fn(() => fixture.authorization),
      worker: { getExecutionRecord, recoverSubmittingByIdempotencyKey, reconcilePendingByIdempotencyKey: vi.fn() },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;

    const response = await getDemoStatus();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.pae_verification).toEqual({ status: "FAILED", error_code: "PAE-015" });
    expect(data.authorization_current).toBe(false);
    expect(data.execution_packet).toBeNull();
    expect(data.lifecycle[2].status).toBe("PAE_INVALID");
    expect(recoverSubmittingByIdempotencyKey).not.toHaveBeenCalled();
    expect(JSON.stringify(data)).not.toContain("sensitive detail");
  });

  it("rejects an expired PAE before the mocked worker can execute", async () => {
    const fixture = authorizedLineageFixture();
    fixture.sealed.payload.expiry = "2020-01-01T00:00:00.000Z";
    const execute = vi.fn();
    stateRef.current = {
      lastPreflight: fixture.preflight,
      store: {
        get: vi.fn(() => fixture.aggregate),
        getCurrentAssessment: vi.fn(() => null),
        getAssessmentHistory: vi.fn(() => fixture.history),
      },
      getSealedPae: vi.fn(() => fixture.sealed),
      getAuthorizationArtifacts: vi.fn(() => fixture.authorization),
      worker: { execute },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;
    const packet = buildJ2aExecutionPacket({
      preflight: fixture.preflight as never, aggregate: fixture.aggregate as never,
      assessment: fixture.assessment as never, assessmentHash: fixture.assessmentHash, sealedPae: fixture.sealed as never,
    });

    const response = await executeDemo(new Request("http://localhost/api/internal/demo/real-testnet-payment/execute", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ expected_version: 4, packet_sha256: packet.packet_sha256, pae_instruction_hash: fixture.paeHash, confirmation: "SUBMIT EXACT TESTNET DEMO TRANSFER" }),
    }));

    expect(response.status).toBe(409);
    expect(execute).not.toHaveBeenCalled();
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

  it.each(["wrong request packet hash", "wrong Prime packet authorization hash"])("keeps provider submission locked for %s", async (failure) => {
    const fixture = authorizedLineageFixture();
    const packet = buildJ2aExecutionPacket({
      preflight: fixture.preflight as never, aggregate: fixture.aggregate as never,
      assessment: fixture.assessment as never, assessmentHash: fixture.assessmentHash, sealedPae: fixture.sealed as never,
    });
    const execute = vi.fn();
    stateRef.current = {
      lastPreflight: fixture.preflight,
      store: {
        get: vi.fn(() => fixture.aggregate),
        getCurrentAssessment: vi.fn(() => null),
        getAssessmentHistory: vi.fn(() => fixture.history),
      },
      getSealedPae: vi.fn(() => fixture.sealed),
      getAuthorizationArtifacts: vi.fn(() => fixture.authorization),
      worker: { execute },
      flush: vi.fn(),
    } as unknown as Record<string, unknown>;

    const authorizedHash = failure === "wrong Prime packet authorization hash" ? "f".repeat(64) : packet.packet_sha256;
    vi.stubEnv("J2A_EXECUTION_AUTHORIZED_PACKET_SHA256", authorizedHash);
    const requestPacketHash = failure === "wrong request packet hash" ? "e".repeat(64) : packet.packet_sha256;
    const response = await executeDemo(new Request("http://localhost/api/internal/demo/real-testnet-payment/execute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        expected_version: 4,
        packet_sha256: requestPacketHash,
        pae_instruction_hash: fixture.paeHash,
        confirmation: "SUBMIT EXACT TESTNET DEMO TRANSFER",
      }),
    }));

    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
});
