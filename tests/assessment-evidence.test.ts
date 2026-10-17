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
    source_amount: "21.00",
    source_currency: "USD",
    settlement_conversion_rate: null,
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

  it("RACE/remediation snapshots cannot mutate append-only assessment history", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate());
    sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 1);
    const exposed = store.getCurrentAssessment("ORG-DEMO-001", "OBL-J0C-002")!;
    exposed.record.race!.remediation.push({
      finding_code: "OTHER_REQUIRES_HUMAN_REVIEW",
      reason: "tamper",
      required_action: "tamper",
      required_evidence: [],
      owner_role: "tamper",
      reassess_after_resolution: true,
      escalation_target: "tamper",
    });
    const stored = store.getCurrentAssessment("ORG-DEMO-001", "OBL-J0C-002")!;
    expect(stored.record.race?.remediation).toHaveLength(0);
    expect(verifyDurableAssessmentRecordHash(stored.record, stored.hash)).toBe(true);
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

describe("assessment snapshot export: persisted append order preserved, never re-derived", () => {
  // The Supabase CAS RPC tameion_state_compare_and_set requires the previously
  // persisted authority.assessments array to remain an exact prefix of the next
  // one, so the exported order must be the order records were appended in and
  // must never be re-derived from record content. These fixtures are built to
  // defeat any re-derivation: the obligations are INTERLEAVED (so flattening the
  // per-obligation history map yields a different array) and every record
  // carries the SAME assessed_at (so a timestamp sort is order-blind and can
  // only echo whatever order it was handed).
  const EQUAL_ASSESSED_AT = "2026-01-01T00:00:00.000Z";

  function sealedEntry(obligationId: string, suffix: string) {
    const record: DurableAssessmentRecord = {
      assessment_id: `ASM-${obligationId}-${suffix}`,
      organization_id: "ORG-DEMO-001",
      obligation_id: obligationId,
      aggregate_version: "1",
      decision: "HOLD",
      reasons: ["Interleaved equal-assessed_at snapshot fixture."],
      evidence_ids: ["EVID-1"],
      missing_evidence: [],
      uncertainty_signal: false,
      provider_name: "test-fixture-provider",
      provider_mode: "NOT_LIVE_AI",
      assessed_at: EQUAL_ASSESSED_AT,
    };
    const { record: sealed, assessment_hash } = sealDurableAssessmentRecord(record);
    return { organization_id: "ORG-DEMO-001", obligation_id: obligationId, record: sealed, hash: assessment_hash };
  }

  /** A valid persisted snapshot whose assessment array interleaves three
   * obligations and gives every record an identical assessed_at. */
  function interleavedSnapshot() {
    return {
      aggregates: [
        baseAggregate({ obligation_id: "OBL-J0C-001" }),
        baseAggregate({ obligation_id: "OBL-J0C-002" }),
        baseAggregate({ obligation_id: "OBL-J0C-005" }),
      ],
      kill_switches: [],
      assessments: [
        sealedEntry("OBL-J0C-001", "1"),
        sealedEntry("OBL-J0C-002", "1"),
        sealedEntry("OBL-J0C-001", "2"),
        sealedEntry("OBL-J0C-005", "1"),
        sealedEntry("OBL-J0C-002", "2"),
      ],
    };
  }

  /** The obligation order a flatten-the-per-obligation-map export produces, and
   * the only order a stable assessed_at sort over that flatten could keep. */
  const GROUPED_BY_OBLIGATION = ["OBL-J0C-001", "OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-002", "OBL-J0C-005"];

  /** The exact interleaved order these fixtures persist. */
  const INTERLEAVED = ["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-001", "OBL-J0C-005", "OBL-J0C-002"];

  it("hydrate -> export is exactly deep-equal to the incoming interleaved, equal-assessed_at array", () => {
    const persisted = interleavedSnapshot();

    // Fixture discipline: the order under test cannot come from assessed_at (all
    // five records tie), and the obligations really are interleaved rather than
    // grouped per obligation.
    expect(persisted.assessments).toHaveLength(5);
    expect(new Set(persisted.assessments.map((item) => item.record.assessed_at)).size).toBe(1);
    expect(persisted.assessments.map((item) => item.obligation_id)).toEqual(INTERLEAVED);
    expect(persisted.assessments.map((item) => item.obligation_id)).not.toEqual(GROUPED_BY_OBLIGATION);

    const store = AuthorityStore.fromSnapshot(persisted);
    const exported = store.exportSnapshot().assessments;

    // Exact deep equality to the input array, in the input order.
    expect(exported).toEqual(persisted.assessments);
    expect(exported.map((item) => item.record.assessment_id))
      .toEqual(persisted.assessments.map((item) => item.record.assessment_id));
    expect(exported.map((item) => item.hash)).toEqual(persisted.assessments.map((item) => item.hash));

    // Records are cloned on export, so a mutated export cannot reach the store.
    exported[0].record.reasons.push("TAMPERED-AFTER-EXPORT");
    exported[0].record.evidence_ids.push("EVID-TAMPERED");
    expect(store.exportSnapshot().assessments).toEqual(persisted.assessments);

    // The exported array re-hydrates to itself, order and hashes included.
    const rehydrated = AuthorityStore.fromSnapshot(store.exportSnapshot());
    expect(rehydrated.exportSnapshot().assessments).toEqual(persisted.assessments);
    expect(rehydrated.getAssessmentHistory("ORG-DEMO-001", "OBL-J0C-001").map((item) => item.record.assessment_id))
      .toEqual(["ASM-OBL-J0C-001-1", "ASM-OBL-J0C-001-2"]);
  });

  it("sealing for an already represented obligation keeps the whole old array as an exact prefix and appends once at the tail", () => {
    const persisted = interleavedSnapshot();
    const store = AuthorityStore.fromSnapshot(persisted);
    const before = store.exportSnapshot().assessments;
    expect(before).toEqual(persisted.assessments);

    // OBL-J0C-001 is already represented twice and is NOT the persisted tail, so
    // a grouped export would insert this record ahead of the OBL-J0C-005 and
    // OBL-J0C-002 records that follow it. Its assessed_at is the same equal value
    // every persisted record already carries, so its position cannot come from a
    // timestamp either.
    const later = sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-001", 1, {
      assessed_at: EQUAL_ASSESSED_AT,
    });
    const after = store.exportSnapshot().assessments;

    // Exactly one new entry, at the tail: the complete old array survives as an
    // exact prefix, every record still in its original position.
    expect(after).toHaveLength(before.length + 1);
    expect(after.slice(0, before.length)).toEqual(before);
    expect(after.slice(0, before.length)).toEqual(persisted.assessments);
    expect(after.at(-1)).toMatchObject({
      organization_id: "ORG-DEMO-001",
      obligation_id: "OBL-J0C-001",
      hash: later.assessment_hash,
    });
    expect(after.at(-1)?.record).toEqual(later.record);

    // Appended exactly once to the serialized sequence: no duplicated entry.
    const hashes = after.map((item) => item.hash);
    expect(new Set(hashes).size).toBe(hashes.length);
    expect(after.filter((item) => item.hash === later.assessment_hash)).toHaveLength(1);
    expect(after.map((item) => item.obligation_id)).toEqual([...INTERLEAVED, "OBL-J0C-001"]);

    // Per-obligation retrieval order is unchanged by the global sequence.
    expect(store.getAssessmentHistory("ORG-DEMO-001", "OBL-J0C-001").map((item) => item.record.assessment_id))
      .toEqual(["ASM-OBL-J0C-001-1", "ASM-OBL-J0C-001-2", later.record.assessment_id]);
    expect(store.getAssessmentHistory("ORG-DEMO-001", "OBL-J0C-002").map((item) => item.record.assessment_id))
      .toEqual(["ASM-OBL-J0C-002-1", "ASM-OBL-J0C-002-2"]);
    expect(store.getAssessmentHistory("ORG-DEMO-001", "OBL-J0C-005").map((item) => item.record.assessment_id))
      .toEqual(["ASM-OBL-J0C-005-1"]);
    expect(store.getSealedAssessment("ORG-DEMO-001", "OBL-J0C-001")?.hash).toBe(later.assessment_hash);
    expect(store.getCurrentAssessment("ORG-DEMO-001", "OBL-J0C-002")?.record.assessment_id).toBe("ASM-OBL-J0C-002-2");

    // The appended array is itself a valid persisted snapshot: re-hydrating it
    // preserves the new order exactly, so the CAS prefix guard keeps holding.
    const rehydratedAfter = AuthorityStore.fromSnapshot(store.exportSnapshot());
    expect(rehydratedAfter.exportSnapshot().assessments).toEqual(after);
  });

  it("sealing interleaved obligations into an empty store exports in seal order, not grouped by obligation", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate({ obligation_id: "OBL-J0C-001" }));
    store.seed(baseAggregate({ obligation_id: "OBL-J0C-002" }));
    store.seed(baseAggregate({ obligation_id: "OBL-J0C-005" }));

    const first = sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-001", 1, { assessed_at: EQUAL_ASSESSED_AT });
    const second = sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-002", 1, { assessed_at: EQUAL_ASSESSED_AT });
    const third = sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-001", 1, { assessed_at: EQUAL_ASSESSED_AT });
    const fourth = sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-005", 1, { assessed_at: EQUAL_ASSESSED_AT });

    // The global append-order sequence is maintained by sealAssessment itself, so
    // a store that was never hydrated still exports true append order.
    expect(store.exportSnapshot().assessments.map((item) => item.hash))
      .toEqual([first.assessment_hash, second.assessment_hash, third.assessment_hash, fourth.assessment_hash]);
    expect(store.exportSnapshot().assessments.map((item) => item.obligation_id))
      .toEqual(["OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-001", "OBL-J0C-005"]);

    // Retrieval stays per-obligation, in each obligation's own seal order.
    expect(store.getAssessmentHistory("ORG-DEMO-001", "OBL-J0C-001").map((item) => item.hash))
      .toEqual([first.assessment_hash, third.assessment_hash]);
    expect(store.getAssessmentHistory("ORG-DEMO-001", "OBL-J0C-005").map((item) => item.hash))
      .toEqual([fourth.assessment_hash]);
  });
});
