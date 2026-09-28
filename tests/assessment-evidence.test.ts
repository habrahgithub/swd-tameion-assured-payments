import { describe, expect, it } from "vitest";

import { AuthorityStore, type AuthorityAggregate } from "../src/authority/aggregate";
import type { DurableAssessmentRecord } from "../src/domain/schemas";
import { sealDurableAssessmentRecord, verifyDurableAssessmentRecordHash } from "../src/pae/durable-records";
import { sealTestAssessment } from "./test-support/seal-assessment";

/**
 * J1 assessment-evidence sealing: the durable, hash-addressable artifact
 * that the sole-candidate-selection gate (src/authority/aggregate.ts
 * approve()) references, rather than trusting mutable in-memory state.
 * Covers the acceptance criteria from the J1 gap-census hardening pass:
 * immutability/hash-addressability, missing/modified/duplicate assessment
 * handling, and explicit NOT_LIVE_AI marking for non-live reasoning.
 */

function baseAggregate(overrides: Partial<AuthorityAggregate> = {}): AuthorityAggregate {
  return {
    organization_id: "ORG-DEMO-001",
    obligation_id: "OBL-J0C-002",
    aggregate_version: 1,
    state: "APPROVAL_PENDING",
    amount: "21.000000",
    asset: "USDC",
    network: "ARC_TESTNET",
    counterparty_id: "CP-J0C-002",
    counterparty_version: 1,
    counterparty_status: "VERIFIED",
    destination_ref: "DEST-J0C-999",
    destination_version: 1,
    destination_address: `0x${"1".repeat(40)}`,
    destination_verification_status: "VERIFIED",
    destination_operational_status: "ACTIVE",
    source_wallet_ref: "WALLET-SOURCE-P0-1",
    source_wallet_version: 1,
    source_wallet_status: "ACTIVE",
    evidence_hashes: [],
    policy_version: "POLICY-P0-1",
    business_hold: false,
    security_freeze: false,
    external_settlement_state: "NONE",
    pae_state: "UNUSED",
    execution_state: "NONE",
    execution_idempotency_key: null,
    reviewed_aggregate_version: null,
    ...overrides,
  };
}

function validRecord(overrides: Partial<DurableAssessmentRecord> = {}): DurableAssessmentRecord {
  return {
    assessment_id: "ASM-1",
    organization_id: "ORG-DEMO-001",
    obligation_id: "OBL-J0C-002",
    aggregate_version: "1",
    decision: "PAY",
    reasons: ["Complete evidence and confirmed business purpose."],
    evidence_ids: ["EVID-1"],
    missing_evidence: [],
    uncertainty_signal: false,
    provider_name: "deterministic-fallback (NOT the judged Finance Agent reasoning)",
    provider_mode: "NOT_LIVE_AI",
    assessed_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("assessment artifact: immutability / hash-addressability", () => {
  it("the same record content always produces the same hash (deterministic canonicalization)", () => {
    const a = sealDurableAssessmentRecord(validRecord());
    const b = sealDurableAssessmentRecord(validRecord());
    expect(a.assessment_hash).toBe(b.assessment_hash);
    expect(a.assessment_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("any field change produces a different hash", () => {
    const a = sealDurableAssessmentRecord(validRecord());
    const b = sealDurableAssessmentRecord(validRecord({ decision: "HOLD" }));
    expect(a.assessment_hash).not.toBe(b.assessment_hash);
  });

  it("detects tampering: a record mutated after sealing fails hash verification", () => {
    const { record, assessment_hash } = sealDurableAssessmentRecord(validRecord());
    expect(verifyDurableAssessmentRecordHash(record, assessment_hash)).toBe(true);
    const tamperedDecision: DurableAssessmentRecord = { ...record, decision: "HOLD" };
    expect(verifyDurableAssessmentRecordHash(tamperedDecision, assessment_hash)).toBe(false);
  });

  it("rejects an unparseable/malformed record outright rather than sealing it", () => {
    expect(() => sealDurableAssessmentRecord({ ...validRecord(), decision: "MAYBE" } as unknown as DurableAssessmentRecord)).toThrow();
  });
});

describe("AuthorityStore.sealAssessment: missing / modified / duplicate / stale cases", () => {
  it("missing: getSealedAssessment returns undefined before any assessment is sealed", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate());
    expect(store.getSealedAssessment("ORG-DEMO-001", "OBL-J0C-002")).toBeUndefined();
  });

  it("refuses to seal an assessment bound to the wrong aggregate_version (ASM-001)", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate({ aggregate_version: 5 }));
    expect(() => store.sealAssessment(validRecord({ aggregate_version: "1" }))).toThrow(/does not match current/);
  });

  it("reassessment appends immutable history and deterministically selects the newest current record", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate());
    sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 1, { decision: "HOLD" });
    sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 1, { decision: "PAY" });
    const history = store.getAssessmentHistory("ORG-DEMO-001", "OBL-J0C-002");
    expect(history.map((item) => item.record.decision)).toEqual(["HOLD", "PAY"]);
    expect(store.getCurrentAssessment("ORG-DEMO-001", "OBL-J0C-002")?.record.decision).toBe("PAY");
    expect(history[0].hash).not.toBe(history[1].hash);
  });

  it("assessment history and its derived current assessment survive a store restart", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate());
    sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 1, { decision: "HOLD" });
    sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 1, { decision: "PAY" });

    const restarted = AuthorityStore.fromSnapshot(store.exportSnapshot());
    expect(restarted.getAssessmentHistory("ORG-DEMO-001", "OBL-J0C-002")).toHaveLength(2);
    expect(restarted.getCurrentAssessment("ORG-DEMO-001", "OBL-J0C-002")?.record.decision).toBe("PAY");
  });

  it("modified: a sealed assessment retrieved from the store still passes hash-integrity verification untouched", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate());
    sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 1);
    const sealed = store.getSealedAssessment("ORG-DEMO-001", "OBL-J0C-002")!;
    expect(verifyDurableAssessmentRecordHash(sealed.record, sealed.hash)).toBe(true);
  });

  it("deterministic-fallback assessments are always sealed as NOT_LIVE_AI, never mistaken for live model output", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate());
    sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 1, {
      provider_name: "deterministic-fallback (NOT the judged Finance Agent reasoning)",
      provider_mode: "NOT_LIVE_AI",
    });
    const sealed = store.getSealedAssessment("ORG-DEMO-001", "OBL-J0C-002")!;
    expect(sealed.record.provider_mode).toBe("NOT_LIVE_AI");
  });
});
