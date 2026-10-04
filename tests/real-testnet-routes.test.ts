import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
vi.mock("../src/pae/sign-verify", () => ({ verifySealedPae: vi.fn() }));

import { GET as getDemoStatus } from "../app/api/internal/demo/real-testnet-payment/status/route";
import { POST as executeDemo } from "../app/api/internal/demo/real-testnet-payment/execute/route";
import { POST as authorizeDemo } from "../app/api/internal/demo/real-testnet-payment/authorize/route";
import { buildJ2aExecutionPacket } from "../src/demo/real-testnet-payment";

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
    const evidenceHash = "a".repeat(64);
    const assessmentHash = "c".repeat(64);
    const paeHash = "b".repeat(64);
    const expires = new Date(Date.now() + 60 * 60_000).toISOString();
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
        beneficiary: { beneficiary_id: "CP-01769e53-cfbe-57aa-ba88-c787b8cba2d3", display_name: "Tameion Test Counterparty" },
        commercial: { obligation_id: "DEMO-ARC-TESTNET-001", classification: "TESTNET DEMONSTRATION / NON-ECONOMIC / NOT_VENDOR_PAYMENT", invoice_reference: "DEMO-ARC-TESTNET-001", invoice_date: "2026-10-04", effective_due_date: "2026-10-04", payment_basis: "PROTOTYPE_CASH_PAYMENT_DUE_ON_INVOICE_DATE", source_evidence_id: "J2A-DEMO-OBLIGATION-SYNTHETIC-EVIDENCE-001" },
      },
    };
    const aggregate = {
      organization_id: "ORG-TAMEION-TESTNET-DEMO", obligation_id: "DEMO-ARC-TESTNET-001", aggregate_version: 7,
      evidence_hashes: [evidenceHash], source_wallet_status: "ACTIVE", source_wallet_version: 1,
      destination_ref: "CIRCLE-DCW-01769e53-cfbe-57aa-ba88-c787b8cba2d3", destination_version: 1,
      destination_verification_status: "VERIFIED", destination_operational_status: "ACTIVE",
      counterparty_id: "CP-01769e53-cfbe-57aa-ba88-c787b8cba2d3", counterparty_version: 1,
    };
    const assessment = {
      assessment_id: "ASM-J2A-1", aggregate_version: "7", decision: "PAY", provider_mode: "LIVE_AI",
      provider_name: "NVIDIA Build", model_id: "nvidia/nemotron-3-super-120b-a12b", model_config_version: "test-config",
      missing_evidence: [], race: { result: { validated_findings: [] } }, reasons: [],
    };
    const sealed = {
      instruction_hash: paeHash,
      payload: {
        instruction_id: "PAE-J2A-1", signing_key_id: "J2A-KEY-1", organization_id: "ORG-TAMEION-TESTNET-DEMO",
        obligation_ids: ["DEMO-ARC-TESTNET-001"], aggregate_version: "7", evidence_hashes: [evidenceHash],
        source_wallet_ref: "9fe9c001-a044-5f9a-8997-165474887952", destination_address: "0x591a1002127b1605d9dbb51348787bbe3014b2b9",
        amount: "5.000000", atomic_amount: "5000000", asset: "USDC", network: "ARC_TESTNET", expiry: expires,
        idempotency_key: "j2a-exact-key", approval_evidence: [{ assessment_id: "ASM-J2A-1", assessment_hash: assessmentHash }],
      },
    };
    const packet = buildJ2aExecutionPacket({
      preflight: preflight as never, aggregate: aggregate as never, assessment: assessment as never,
      assessmentHash, sealedPae: sealed as never,
    });
    const execute = vi.fn();
    stateRef.current = {
      lastPreflight: preflight,
      store: {
        get: vi.fn(() => aggregate),
        getCurrentAssessment: vi.fn(() => ({ record: assessment, hash: assessmentHash })),
      },
      getSealedPae: vi.fn(() => sealed),
      getAuthorizationArtifacts: vi.fn(() => ({
        assurance_record: { result: "PASS" },
        sealed_pae: sealed,
      })),
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
        expected_version: 7,
        packet_sha256: requestPacketHash,
        pae_instruction_hash: paeHash,
        confirmation: "SUBMIT EXACT TESTNET DEMO TRANSFER",
      }),
    }));

    expect(response.status).toBe(403);
    expect(execute).not.toHaveBeenCalled();
  });
});
