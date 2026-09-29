import { describe, expect, it } from "vitest";

import {
  adaptDirectEvidenceObligation,
  buildPaymentTruthLayers,
  canonicalPaymentObligationSchema,
  deriveExecutionReleaseAuthority,
  sourceRecordReferenceSchema,
} from "../src/domain/payment-control-boundary";

const sourceKinds = ["ERP", "ACCOUNTING_SYSTEM", "API", "CSV_IMPORT", "DIRECT_EVIDENCE"] as const;

function canonicalSource(sourceKind: (typeof sourceKinds)[number], approvalState = "APPROVED") {
  return canonicalPaymentObligationSchema.parse({
    source: {
      source_kind: sourceKind,
      source_system_id: "SOURCE-SYSTEM-1",
      record_type: "PAYABLE_OBLIGATION",
      record_id: "SRC-INV-001",
      record_version: "7",
      approval_state: approvalState,
      execution_authority: "NONE",
    },
    obligation_id: "OBL-001",
    amount: "1250.00",
    currency: "USD",
    due_date: "2026-10-05",
    evidence_ids: ["EVID-001"],
  });
}

describe("ERP-native payment control boundary", () => {
  it.each(sourceKinds)("accepts vendor-neutral %s source records", (sourceKind) => {
    expect(canonicalSource(sourceKind).source.source_kind).toBe(sourceKind);
  });

  it("rejects any upstream source record that tries to carry execution authority", () => {
    const result = sourceRecordReferenceSchema.safeParse({
      source_kind: "ERP",
      source_system_id: "ERP-1",
      record_type: "PAYABLE_OBLIGATION",
      record_id: "ERP-INV-001",
      record_version: "1",
      approval_state: "APPROVED",
      execution_authority: "GRANTED",
    });

    expect(result.success).toBe(false);
  });

  it("keeps upstream APPROVED separate from Tameion execution authority", () => {
    const truth = buildPaymentTruthLayers({
      obligation: canonicalSource("ERP", "APPROVED"),
      source_obligation_state: "APPROVED_FOR_PAYMENT",
      aggregate_version: 1,
      aggregate_state: "APPROVAL_PENDING",
      pae_state: "UNUSED",
      execution_state: "NONE",
      current_assessment_present: false,
      pae_sealed: false,
      execution_kill_switched: false,
      network: "ARC_TESTNET",
      settlement_status: "NOT_SUBMITTED",
      provider_ref: null,
      settlement_runtime: "SIMULATED",
    });

    expect(truth.source_truth.source.approval_state).toBe("APPROVED");
    expect(truth.source_truth.source.execution_authority).toBe("NONE");
    expect(truth.tameion_control_truth.aggregate_state).toBe("APPROVAL_PENDING");
    expect(truth.tameion_control_truth.execution_release_authority).toBe("NOT_GRANTED");
    expect(truth.settlement_truth.status).toBe("NOT_SUBMITTED");
  });

  it.each([
    [{ aggregate_state: "AUTHORIZED", pae_state: "UNUSED", execution_state: "NONE", pae_sealed: true, execution_kill_switched: false }, "TAMEION_PAE_REVERIFY_REQUIRED"],
    [{ aggregate_state: "AUTHORIZED", pae_state: "UNUSED", execution_state: "NONE", pae_sealed: true, execution_kill_switched: true }, "SUSPENDED_KILL_SWITCH"],
    [{ aggregate_state: "AUTHORIZED", pae_state: "RESERVED", execution_state: "RESERVED", pae_sealed: true, execution_kill_switched: false }, "RESERVED_FOR_EXECUTION"],
    [{ aggregate_state: "AUTHORIZED", pae_state: "RESERVED", execution_state: "SUBMITTING", pae_sealed: true, execution_kill_switched: false }, "IN_DOUBT_PROVIDER_SUBMISSION"],
    [{ aggregate_state: "AUTHORIZED", pae_state: "RESERVED", execution_state: "UNKNOWN", pae_sealed: true, execution_kill_switched: false }, "IN_DOUBT_PROVIDER_SUBMISSION"],
    [{ aggregate_state: "AUTHORIZED", pae_state: "SUBMITTED", execution_state: "UNKNOWN", pae_sealed: true, execution_kill_switched: false }, "IN_DOUBT_PROVIDER_SUBMISSION"],
    [{ aggregate_state: "AUTHORIZED", pae_state: "SUBMITTED", execution_state: "SUBMITTED", pae_sealed: true, execution_kill_switched: false }, "SUBMITTED_TO_PROVIDER"],
    [{ aggregate_state: "RECONCILED", pae_state: "CONSUMED", execution_state: "SETTLED", pae_sealed: true, execution_kill_switched: false }, "CONSUMED"],
    [{ aggregate_state: "RECONCILED", pae_state: "CONSUMED", execution_state: "SETTLED", pae_sealed: true, execution_kill_switched: true }, "CONSUMED"],
    [{ aggregate_state: "AUTHORIZED", pae_state: "SUBMITTED", execution_state: "SUBMITTED", pae_sealed: true, execution_kill_switched: true }, "SUBMITTED_TO_PROVIDER"],
    [{ aggregate_state: "AUTHORIZED", pae_state: "REVOKED", execution_state: "BLOCKED", pae_sealed: true, execution_kill_switched: false }, "BLOCKED"],
    [{ aggregate_state: "AUTHORIZED", pae_state: "REVOKED", execution_state: "NONE", pae_sealed: true, execution_kill_switched: false }, "REVOKED"],
    [{ aggregate_state: "AUTHORIZED", pae_state: "EXPIRED", execution_state: "NONE", pae_sealed: true, execution_kill_switched: false }, "EXPIRED"],
    [{ aggregate_state: "APPROVAL_PENDING", pae_state: "UNUSED", execution_state: "NONE", pae_sealed: false, execution_kill_switched: false }, "NOT_GRANTED"],
  ] as const)("derives release authority from lifecycle state: %s", (input, expected) => {
    expect(deriveExecutionReleaseAuthority(input)).toBe(expected);
  });

  it("labels the current genuine dataset adapter as direct evidence, not ERP", () => {
    const adapted = adaptDirectEvidenceObligation({
      obligation_id: "OBL-J0C-001",
      amount: "5760.00",
      currency: "AED",
      due_date: null,
      source_evidence: [{ evidence_id: "EVID-J0C-001-A" }],
    });

    expect(adapted.source.source_kind).toBe("DIRECT_EVIDENCE");
    expect(adapted.source.source_system_id).toBe("J0-C-LIVE-USAGE-LEDGER");
    expect(adapted.source.approval_state).toBe("NOT_ASSERTED");
    expect(adapted.source.execution_authority).toBe("NONE");
  });
});
