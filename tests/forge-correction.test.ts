import { describe, expect, it } from "vitest";

import { AuthorityStore, type AuthorityAggregate } from "../src/authority/aggregate";
import { sealTestAssessment, currentAssessmentReview } from "./test-support/seal-assessment";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { DemoState, DEMO_ORGANIZATION_ID } from "../src/server/demo-state";
import { convertSourceToSettlement } from "../src/domain/currency-conversion";
import type { RaceAssessment } from "../src/agent/schema";

const SIGNING_KEY_ID = "TAMEION-DEMO-PAE-KEY-1";

function baseAggregate(overrides: Partial<AuthorityAggregate> = {}): AuthorityAggregate {
  return {
    organization_id: DEMO_ORGANIZATION_ID,
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
    product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
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

function aedRaceFacts(amount: string, currency: string = "AED"): RaceAssessment {
  return {
    result: {
      decision: "PAY",
      decision_summary: "Test fixture.",
      validated_findings: [],
    },
    action_taken: { summary: "Checks.", checks: ["Done."] },
    caveats: {
      missing_context: [],
      uncertainty_signal: false,
      model_proposed_findings: [],
      model_proposed_findings_authority: "NON_AUTHORITATIVE",
      model_explanation: "Test.",
      model_explanation_authority: "NON_AUTHORITATIVE",
    },
    evidence: {
      evidence_ids: ["EVID-TEST-1"],
      authoritative_facts: {
        obligation_id: "OBL-J0C-002",
        aggregate_version: "1",
        amount,
        currency,
        due_date: null,
        due_date_status: "NOT_STATED_ON_SOURCE",
        due_date_position: "NOT_STATED",
        as_of_date: "2026-01-01",
        state_at_event_baseline: "OUTSTANDING",
        business_purpose_confirmed: true,
        source_evidence_present: true,
        destination_status: "READY",
      },
    },
        remediation: [],
    prompt_identity: null,
  };
}

function authorizeFixture(
  store: AuthorityStore,
  overrides: Partial<AuthorityAggregate> = {},
  assessmentCurrency: string = "AED",
  assessmentAmount: string = "5760.00",
) {
  store.seed(baseAggregate(overrides));
  sealTestAssessment(store, DEMO_ORGANIZATION_ID, "OBL-J0C-002", 1, {
    race: aedRaceFacts(assessmentAmount, assessmentCurrency),
  });
  return approveAndSealPae(store, SIGNING_KEY_ID, {
    organizationId: DEMO_ORGANIZATION_ID,
    obligationId: "OBL-J0C-002",
    expectedVersion: 1,
    ...currentAssessmentReview(store, DEMO_ORGANIZATION_ID, "OBL-J0C-002"),
    actorId: "USR-DEMO-OPERATOR",
    actorRole: "FINANCE_APPROVER",
    policyVersion: "POLICY-P0-1",
    reasonText: "Test.",
  });
}

describe("F1: approval binding gap — source amount/currency match assessment", () => {
  it("P1: legacy AED aggregate with 0.000000/no source fields must NOT authorize", () => {
    const store = new AuthorityStore();
    store.seed(
      baseAggregate({
        amount: "0.000000",
        source_amount: undefined,
        source_currency: undefined,
        settlement_conversion_rate: undefined,
      }),
    );
    sealTestAssessment(store, DEMO_ORGANIZATION_ID, "OBL-J0C-002", 1, {
      race: aedRaceFacts("5760.00", "AED"),
    });

    expect(() =>
      approveAndSealPae(store, SIGNING_KEY_ID, {
        organizationId: DEMO_ORGANIZATION_ID,
        obligationId: "OBL-J0C-002",
        expectedVersion: 1,
        ...currentAssessmentReview(store, DEMO_ORGANIZATION_ID, "OBL-J0C-002"),
        actorId: "USR-DEMO-OPERATOR",
        actorRole: "FINANCE_APPROVER",
        policyVersion: "POLICY-P0-1",
        reasonText: "Test.",
      }),
    ).toThrow();
  });

  it("P2: assessed AED 99999.00 against aggregate source AED 5760.00 must NOT authorize", () => {
    const store = new AuthorityStore();
    store.seed(
      baseAggregate({
        amount: "1568.413887",
        source_amount: "5760.00",
        source_currency: "AED",
        settlement_conversion_rate: "3.6725",
      }),
    );
    sealTestAssessment(store, DEMO_ORGANIZATION_ID, "OBL-J0C-002", 1, {
      race: aedRaceFacts("99999.00", "AED"),
    });

    expect(() =>
      approveAndSealPae(store, SIGNING_KEY_ID, {
        organizationId: DEMO_ORGANIZATION_ID,
        obligationId: "OBL-J0C-002",
        expectedVersion: 1,
        ...currentAssessmentReview(store, DEMO_ORGANIZATION_ID, "OBL-J0C-002"),
        actorId: "USR-DEMO-OPERATOR",
        actorRole: "FINANCE_APPROVER",
        policyVersion: "POLICY-P0-1",
        reasonText: "Test.",
      }),
    ).toThrow();
  });

  it("AED aggregate with matching source facts and correct derived amount authorizes", () => {
    const store = new AuthorityStore();
    const result = authorizeFixture(
      store,
      {
        amount: "1568.413887",
        source_amount: "5760.00",
        source_currency: "AED",
        settlement_conversion_rate: "3.6725",
      },
      "AED",
      "5760.00",
    );
    expect(result.aggregate.state).toBe("AUTHORIZED");
    expect(result.aggregate.source_amount).toBe("5760.00");
    expect(result.aggregate.source_currency).toBe("AED");
  });

  it("USD aggregate with matching source facts authorizes", () => {
    const store = new AuthorityStore();
    const result = authorizeFixture(
      store,
      {
        amount: "21.000000",
        source_amount: "21.00",
        source_currency: "USD",
        settlement_conversion_rate: null,
      },
      "USD",
      "21.00",
    );
    expect(result.aggregate.state).toBe("AUTHORIZED");
    expect(result.aggregate.source_currency).toBe("USD");
  });
});

describe("F2: hydrated stale snapshot/source truth", () => {
  it("pre-change durable snapshot with AED amount=0.000000/no source fields does NOT survive", () => {
    const state = new DemoState();
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, "OBL-J0C-001");
    expect(aggregate.source_amount).toBe("5760.00");
    expect(aggregate.source_currency).toBe("AED");
    expect(aggregate.settlement_conversion_rate).toBe("3.6725");
    expect(aggregate.amount).toBe("1568.413887");
  });

  it("source record remains 5760.00 AED and settlement separately 1568.413887 USD", () => {
    const state = new DemoState();
    const record = state.getRecord("OBL-J0C-001");
    expect(record).toMatchObject({ amount: "5760.00", currency: "AED" });
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, "OBL-J0C-001");
    expect(aggregate.source_amount).toBe("5760.00");
    expect(aggregate.source_currency).toBe("AED");
    expect(aggregate.amount).toBe("1568.413887");
  });
});

describe("F3: fail-open numeric/material change", () => {
  it("P4a: positive AED amount rounding to zero USDC must throw", () => {
    expect(() => convertSourceToSettlement("0.0000018", "AED")).toThrow();
  });

  it("P4d: zero USD passthrough must throw for decimal zero", () => {
    expect(() => convertSourceToSettlement("0.00", "USD")).toThrow();
  });

  it("P4d: zero USD passthrough must throw for integer zero", () => {
    expect(() => convertSourceToSettlement("0", "USD")).toThrow();
  });

  it("P4b: zero-rounded AED material change must throw without changing aggregate", () => {
    const store = new AuthorityStore();
    store.seed(
      baseAggregate({
        amount: "1568.413887",
        source_amount: "5760.00",
        source_currency: "AED",
        settlement_conversion_rate: "3.6725",
      }),
    );
    const before = store.get(DEMO_ORGANIZATION_ID, "OBL-J0C-002");

    expect(() =>
      store.applyMaterialChange(DEMO_ORGANIZATION_ID, "OBL-J0C-002", 1, {
        source_amount: "0.0000018",
        source_currency: "AED",
      }),
    ).toThrow();
    expect(store.get(DEMO_ORGANIZATION_ID, "OBL-J0C-002")).toEqual(before);
  });

  it("P4b2: zero USD material change must throw without changing aggregate", () => {
    const store = new AuthorityStore();
    store.seed(
      baseAggregate({
        amount: "21.000000",
        source_amount: "21.00",
        source_currency: "USD",
        settlement_conversion_rate: null,
      }),
    );
    const before = store.get(DEMO_ORGANIZATION_ID, "OBL-J0C-002");

    expect(() =>
      store.applyMaterialChange(DEMO_ORGANIZATION_ID, "OBL-J0C-002", 1, {
        source_amount: "0.00",
        source_currency: "USD",
      }),
    ).toThrow();
    expect(store.get(DEMO_ORGANIZATION_ID, "OBL-J0C-002")).toEqual(before);
  });

  it("P3: USD >6 decimals must throw/fail closed (not truncate)", () => {
    expect(() => convertSourceToSettlement("21.1234567", "USD")).toThrow();
  });

  it("P3: USD >6 decimals must throw/fail closed (7 decimal places)", () => {
    expect(() => convertSourceToSettlement("5.1234567", "USD")).toThrow();
  });

  it("P4: AED amount rounding to 0.000000 must throw/fail closed", () => {
    expect(() => convertSourceToSettlement("0.00", "AED")).toThrow();
  });

  it("P5: source_currency-only partial patch must throw/fail closed", () => {
    const store = new AuthorityStore();
    store.seed(
      baseAggregate({
        amount: "1568.413887",
        source_amount: "5760.00",
        source_currency: "AED",
        settlement_conversion_rate: "3.6725",
      }),
    );
    expect(() =>
      store.applyMaterialChange(DEMO_ORGANIZATION_ID, "OBL-J0C-002", 1, { source_currency: "USD" }),
    ).toThrow();
  });

  it("P5: source_amount-only partial patch must throw/fail closed", () => {
    const store = new AuthorityStore();
    store.seed(
      baseAggregate({
        amount: "1568.413887",
        source_amount: "5760.00",
        source_currency: "AED",
        settlement_conversion_rate: "3.6725",
      }),
    );
    expect(() =>
      store.applyMaterialChange(DEMO_ORGANIZATION_ID, "OBL-J0C-002", 1, { source_amount: "10000.00" }),
    ).toThrow();
  });

  it("P6: unsupported currency patch must throw/fail closed (not write 0.000000)", () => {
    const store = new AuthorityStore();
    store.seed(
      baseAggregate({
        amount: "21.000000",
        source_amount: "21.00",
        source_currency: "USD",
        settlement_conversion_rate: null,
      }),
    );
    expect(() =>
      store.applyMaterialChange(DEMO_ORGANIZATION_ID, "OBL-J0C-002", 1, { source_currency: "EUR" }),
    ).toThrow();
  });

  it("P5/P6: applyMaterialChange must not mutate the caller's patch object", () => {
    const store = new AuthorityStore();
    store.seed(
      baseAggregate({
        amount: "1568.413887",
        source_amount: "5760.00",
        source_currency: "AED",
        settlement_conversion_rate: "3.6725",
      }),
    );
    const patch = { source_amount: "10000.00", source_currency: "AED" };
    const patchCopy = { ...patch };
    store.applyMaterialChange(DEMO_ORGANIZATION_ID, "OBL-J0C-002", 1, patch);
    expect(patch).toEqual(patchCopy);
  });
});
