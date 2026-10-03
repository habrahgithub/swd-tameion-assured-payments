import { describe, expect, it } from "vitest";

import type { RaceAssessment } from "../src/agent/schema";
import {
  buildHoldEscalateReport,
  buildHoldEscalateSummary,
  type HoldEscalateReportInput,
  type ReportAssessmentInput,
} from "../src/client/hold-escalate-report";

const SOURCE_REF = {
  source_system_id: "J0-C-LIVE-USAGE-LEDGER",
  record_id: "OBL-J0C-001",
  record_type: "BUSINESS_OBLIGATION",
  approval_state: "NOT_ASSERTED",
  execution_authority: "NONE",
};

function baseAssessment(overrides: Partial<ReportAssessmentInput> = {}): ReportAssessmentInput {
  return {
    assessment_id: "ASM-1",
    assessment_hash: "a".repeat(64),
    aggregate_version: "3",
    decision: "HOLD",
    reasons: ["Evidence is incomplete."],
    ...overrides,
  };
}

function baseReportInput(overrides: Partial<HoldEscalateReportInput> = {}): HoldEscalateReportInput {
  return {
    obligation_id: "OBL-J0C-001",
    amount: "5.00",
    currency: "USD",
    aggregate_version: 3,
    source: SOURCE_REF,
    assessment: baseAssessment(),
    ...overrides,
  };
}

function baseRace(overrides: Partial<RaceAssessment> = {}): RaceAssessment {
  return {
    result: {
      decision: "HOLD",
      decision_summary: "Evidence is incomplete.",
      validated_findings: [
        { code: "SOURCE_EVIDENCE_MISSING", severity: "HOLD", reason: "No source evidence is attached." },
      ],
    },
    action_taken: {
      summary: "Checks complete.",
      checks: ["Evidence checked."],
    },
    caveats: {
      missing_context: ["SOURCE_EVIDENCE"],
      uncertainty_signal: true,
      model_proposed_findings: [],
      model_proposed_findings_authority: "NON_AUTHORITATIVE",
      model_explanation: "Need source evidence.",
      model_explanation_authority: "NON_AUTHORITATIVE",
    },
    evidence: {
      evidence_ids: [],
      authoritative_facts: {
        obligation_id: "OBL-J0C-001",
        aggregate_version: "3",
        amount: "5.00",
        currency: "USD",
        due_date: null,
        due_date_status: "NOT_STATED_ON_SOURCE",
        due_date_position: "NOT_STATED",
        as_of_date: "2026-09-29",
        state_at_event_baseline: "OUTSTANDING",
        business_purpose_confirmed: true,
        source_evidence_present: false,
        destination_status: "PENDING_J0_D_TRUST_SEED",
      },
    },
    remediation: [
      {
        finding_code: "SOURCE_EVIDENCE_MISSING",
        reason: "No source evidence is attached.",
        required_action: "Attach and validate the source evidence for this obligation.",
        required_evidence: ["Invoice", "Contract"],
        owner_role: "Accounts Payable",
        reassess_after_resolution: true,
        escalation_target: "Accounts Payable Reviewer",
      },
    ],
        prompt_identity: { version: "care-v1", sha256: "a".repeat(64) },
    ...overrides,
  };
}

describe("buildHoldEscalateReport", () => {
  it("fails closed to HOLD when no assessment exists (UNASSESSED)", () => {
    const report = buildHoldEscalateReport(baseReportInput({ assessment: null }));
    expect(report.decision).toBe("HOLD");
    expect(report.status).toBe("UNASSESSED");
    expect(report.in_scope).toBe(true);
    expect(report.fail_closed).toBe(true);
    expect(report.fail_closed_reason).not.toBeNull();
    expect(report.reasons).toEqual([
      "No sealed assessment exists — an assessment is required before any HOLD or ESCALATE determination.",
    ]);
    expect(report.evidence_gap).toEqual([]);
    expect(report.remediation).toEqual([]);
    expect(report.assessment_time).toBeNull();
    expect(report.provider_mode).toBeNull();
    expect(report.provider_used).toBeNull();
    expect(report.assessment_id).toBeNull();
    expect(report.assessment_hash).toBeNull();
  });

    it("preserves supplier/reference and amount even when unassessed", () => {
    const report = buildHoldEscalateReport(baseReportInput({ assessment: null }));
    expect(report.supplier_reference).toEqual(SOURCE_REF);
    expect(report.amount).toBe("5.00");
    expect(report.currency).toBe("USD");
    expect(report.obligation_id).toBe("OBL-J0C-001");
  });

  it("fails closed to HOLD when assessment is stale (version mismatch)", () => {
    const staleAssessment = baseAssessment({ aggregate_version: "2" });
    const report = buildHoldEscalateReport(
      baseReportInput({ assessment: staleAssessment, aggregate_version: 3 }),
    );
    expect(report.decision).toBe("HOLD");
    expect(report.status).toBe("STALE");
    expect(report.in_scope).toBe(true);
    expect(report.fail_closed).toBe(true);
    expect(report.fail_closed_reason).toContain("v2");
    expect(report.fail_closed_reason).toContain("v3");
    expect(report.reasons).toEqual(staleAssessment.reasons);
    expect(report.assessment_id).toBe("ASM-1");
    expect(report.assessment_hash).toBe("a".repeat(64));
  });

  it("uses the actual HOLD decision when assessment is current", () => {
    const race = baseRace();
    const assessment = baseAssessment({
      decision: "HOLD",
      provider_mode: "NOT_LIVE_AI",
      provider_used: "deterministic-fallback-v1",
      race,
    });
    const report = buildHoldEscalateReport(baseReportInput({ assessment, aggregate_version: 3 }));
    expect(report.decision).toBe("HOLD");
    expect(report.status).toBe("CURRENT");
    expect(report.in_scope).toBe(true);
        expect(report.fail_closed).toBe(false);
    expect(report.fail_closed_reason).toBeNull();
  });

  it("uses the actual ESCALATE decision when assessment is current", () => {
    const report = buildHoldEscalateReport(
      baseReportInput({
        assessment: baseAssessment({ decision: "ESCALATE" }),
        aggregate_version: 3,
      }),
    );
    expect(report.decision).toBe("ESCALATE");
    expect(report.status).toBe("CURRENT");
    expect(report.in_scope).toBe(true);
    expect(report.fail_closed).toBe(false);
  });

  it("shows PAY truthfully but marks out of scope (does not fabricate HOLD)", () => {
    const report = buildHoldEscalateReport(
      baseReportInput({
        assessment: baseAssessment({ decision: "PAY", reasons: ["All checks pass."] }),
        aggregate_version: 3,
      }),
    );
    expect(report.decision).toBe("PAY");
    expect(report.in_scope).toBe(false);
    expect(report.status).toBe("CURRENT");
    expect(report.fail_closed).toBe(false);
    expect(report.reasons).toEqual(["All checks pass."]);
  });

  it("derives assessment_time from RACE authoritative-facts as_of_date", () => {
    const race = baseRace();
    const report = buildHoldEscalateReport(
      baseReportInput({
        assessment: baseAssessment({ race }),
        aggregate_version: 3,
      }),
    );
    expect(report.assessment_time).toBe("2026-09-29");
  });

  it("sets assessment_time to null when race is absent (legacy)", () => {
    const report = buildHoldEscalateReport(
      baseReportInput({
        assessment: baseAssessment({ race: undefined }),
        aggregate_version: 3,
      }),
    );
    expect(report.assessment_time).toBeNull();
  });

  it("reports truthful provider_mode only when present", () => {
    const withLive = buildHoldEscalateReport(
      baseReportInput({
        assessment: baseAssessment({ provider_mode: "LIVE_AI", provider_used: "real-model-v1" }),
        aggregate_version: 3,
      }),
    );
    expect(withLive.provider_mode).toBe("LIVE_AI");
    expect(withLive.provider_used).toBe("real-model-v1");

    const withoutProvider = buildHoldEscalateReport(
      baseReportInput({
        assessment: baseAssessment({ provider_mode: undefined, provider_used: undefined }),
        aggregate_version: 3,
      }),
    );
    expect(withoutProvider.provider_mode).toBeNull();
    expect(withoutProvider.provider_used).toBeNull();
  });

  it("extracts evidence_gap from RACE caveats missing_context", () => {
    const race = baseRace();
    const report = buildHoldEscalateReport(
      baseReportInput({
        assessment: baseAssessment({ race }),
        aggregate_version: 3,
      }),
    );
    expect(report.evidence_gap).toEqual(["SOURCE_EVIDENCE"]);
  });

    it("returns empty remediation without throwing when race is absent", () => {
    const report = buildHoldEscalateReport(
      baseReportInput({
        assessment: baseAssessment({ race: undefined }),
        aggregate_version: 3,
      }),
    );
    expect(report.remediation).toEqual([]);
    expect(report.evidence_gap).toEqual([]);
  });

  it("projects remediation items from RACE with all fields", () => {
    const race = baseRace();
    const report = buildHoldEscalateReport(
      baseReportInput({
        assessment: baseAssessment({ race }),
        aggregate_version: 3,
      }),
    );
    expect(report.remediation).toHaveLength(1);
    const item = report.remediation[0];
    expect(item.finding_code).toBe("SOURCE_EVIDENCE_MISSING");
    expect(item.reason).toBe("No source evidence is attached.");
    expect(item.required_evidence).toEqual(["Invoice", "Contract"]);
    expect(item.owner_role).toBe("Accounts Payable");
    expect(item.escalation_target).toBe("Accounts Payable Reviewer");
  });

  it("does not include escalation_target when absent", () => {
    const race = baseRace({
      remediation: [
        {
          finding_code: "DUE_DATE_NOT_STATED",
          reason: "No due date.",
          required_action: "Confirm due date.",
          required_evidence: ["Contract"],
          owner_role: "Accounts Payable",
          reassess_after_resolution: true,
        },
      ],
    });
    const report = buildHoldEscalateReport(
      baseReportInput({
        assessment: baseAssessment({ race }),
        aggregate_version: 3,
      }),
    );
    expect(report.remediation[0]).not.toHaveProperty("escalation_target");
  });
});

describe("buildHoldEscalateSummary", () => {
  it("counts HOLD, ESCALATE, unassessed, and PAY correctly", () => {
    const summary = buildHoldEscalateSummary([
      { obligation_id: "OBL-1", assessed: true, decision: "HOLD", provider_mode: null },
      { obligation_id: "OBL-2", assessed: true, decision: "ESCALATE", provider_mode: null },
      { obligation_id: "OBL-3", assessed: false, decision: null, provider_mode: null },
      { obligation_id: "OBL-4", assessed: true, decision: "PAY", provider_mode: "NOT_LIVE_AI" },
      { obligation_id: "OBL-5", assessed: true, decision: "HOLD", provider_mode: "LIVE_AI" },
    ]);
    expect(summary).toEqual({
      total: 5,
      hold: 2,
      escalate: 1,
      unassessed: 1,
      pay: 1,
    });
  });

  it("counts all unassessed when no obligations are assessed", () => {
    const summary = buildHoldEscalateSummary([
      { obligation_id: "OBL-1", assessed: false, decision: null, provider_mode: null },
    ]);
    expect(summary.unassessed).toBe(1);
    expect(summary.hold).toBe(0);
    expect(summary.escalate).toBe(0);
    expect(summary.pay).toBe(0);
  });

  it("handles an empty obligation set", () => {
    const summary = buildHoldEscalateSummary([]);
    expect(summary).toEqual({ total: 0, hold: 0, escalate: 0, unassessed: 0, pay: 0 });
  });
});

import { reportDecisionLabel, type HoldEscalateReportLine } from "../src/client/hold-escalate-report";

describe("report decision label distinguishes default blocking from a formal HOLD", () => {
  const base = {
    obligation_id: "OBL-X",
    supplier_reference: { source_system_id: "S", record_id: "R", record_type: "T", approval_state: "A", execution_authority: "N" },
    amount: "1", currency: "AED", assessment_id: null, assessment_hash: null, assessment_time: null,
    provider_mode: null, provider_used: null, reasons: [], evidence_gap: [], remediation: [],
  } satisfies Omit<HoldEscalateReportLine, "decision" | "status" | "in_scope" | "fail_closed" | "fail_closed_reason">;

  it("labels an unassessed obligation as default blocking, never as a formal HOLD", () => {
    const label = reportDecisionLabel({ ...base, decision: "HOLD", status: "UNASSESSED", in_scope: true, fail_closed: true, fail_closed_reason: "x" });
    expect(label).toContain("Default blocking");
    expect(label).toContain("unassessed");
    expect(label).not.toBe("HOLD");
  });

  it("labels a stale assessment as default blocking, not a current HOLD", () => {
    const label = reportDecisionLabel({ ...base, decision: "HOLD", status: "STALE", in_scope: true, fail_closed: true, fail_closed_reason: "x" });
    expect(label).toContain("Default blocking");
    expect(label).toContain("stale");
  });

  it("labels a current model HOLD as a formal HOLD", () => {
    expect(reportDecisionLabel({ ...base, decision: "HOLD", status: "CURRENT", in_scope: true, fail_closed: false, fail_closed_reason: null })).toBe("Formal HOLD (current sealed assessment)");
  });
});
