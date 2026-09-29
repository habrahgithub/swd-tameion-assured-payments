import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { assessObligation } from "../src/agent/finance-agent";
import { buildFinanceAgentContext, type LiveUsageObligationRecord } from "../src/agent/context-builder";
import type { AiProvider } from "../src/agent/ai-provider";
import { CARE_SYSTEM_PROMPT } from "../src/agent/ai-provider";
import { raceAssessmentSchema } from "../src/agent/schema";

function record(id: string, overrides: Partial<LiveUsageObligationRecord> = {}): LiveUsageObligationRecord {
  return {
    obligation_id: id,
    service_category: "AI_SOFTWARE_SUBSCRIPTION",
    recurrence: "MONTHLY",
    due_date: "2026-09-01",
    due_date_status: "STATED_ON_SOURCE",
    amount: "25.00",
    currency: "USD",
    state_at_event_baseline: "OUTSTANDING",
    business_purpose_confirmed: true,
    commercial_terms: "Monthly subscription.",
    source_evidence: [{ evidence_id: `EVID-${id}` }],
    candidate_readiness: { arc_product_destination_status: "READY" },
    ...overrides,
  };
}

const liveRecords = (JSON.parse(readFileSync(new URL("../data/live-usage/LIVE_USAGE_SET.json", import.meta.url), "utf8")) as {
  records: LiveUsageObligationRecord[];
}).records;

function liveRecord(id: string): LiveUsageObligationRecord {
  const found = liveRecords.find((item) => item.obligation_id === id);
  if (!found) throw new Error(`Missing live-usage fixture ${id}`);
  return found;
}

class RecommendationProvider implements AiProvider {
  readonly name = "test-advisory-model";
  constructor(private readonly output: unknown) {}
  async assess() { return this.output; }
}

function recommendation(obligationId: string, overrides: Record<string, unknown> = {}) {
  return {
    obligation_id: obligationId,
    decision: "PAY",
    finding_codes: [],
    evidence_ids: Array.isArray(overrides.evidence_ids) ? overrides.evidence_ids : [`EVID-${obligationId}`],
    uncertainty_signal: false,
    explanation: "The source text says this will be paid next month; require a bank statement and CFO approval.",
    ...overrides,
  };
}

describe("#17 CARE and RACE grounding", () => {
  it("encodes the CARE boundary in the provider prompt and strictly validates actionable RACE", async () => {
    expect(CARE_SYSTEM_PROMPT).toMatch(/C — CONTEXT[\s\S]*A — ACTION[\s\S]*R — ROLE[\s\S]*E — EXPECTATION/);
    const context = buildFinanceAgentContext(record("OBL-CARE"));
    const result = await assessObligation(context, new RecommendationProvider(recommendation(context.obligation_id, { evidence_ids: context.evidence_ids })));
    expect(raceAssessmentSchema.safeParse(result.race).success).toBe(true);
    expect(raceAssessmentSchema.safeParse({
      ...result.race,
      result: { decision: "ESCALATE", decision_summary: "Human review.", validated_findings: [{ code: "OTHER_REQUIRES_HUMAN_REVIEW", severity: "ESCALATE", reason: "Human review." }] },
      remediation: [{ finding_code: "OTHER_REQUIRES_HUMAN_REVIEW", reason: "Human review.", required_action: "Review.", required_evidence: ["Decision"], owner_role: "Finance", reassess_after_resolution: true }],
    }).success).toBe(false);
  });

  it("does not turn unsupported model evidence requirements into remediation", async () => {
    const context = buildFinanceAgentContext(liveRecord("OBL-J0C-001"), "1", "2026-09-29");
    const result = await assessObligation(context, new RecommendationProvider(recommendation(context.obligation_id, { evidence_ids: context.evidence_ids })));

    expect(result.race.remediation.flatMap((item) => item.required_evidence)).not.toContain("bank statement");
    expect(result.race.caveats.model_explanation).toContain("bank statement");
    expect(result.race.caveats.model_explanation_authority).toBe("NON_AUTHORITATIVE");
  });

  it.each(["OBL-J0C-002", "OBL-J0C-004", "OBL-J0C-005"])(
    "%s always gets application-owned destination remediation despite inconsistent model output",
    async (id) => {
      const context = buildFinanceAgentContext(liveRecord(id), "1", "2026-09-29");
      const result = await assessObligation(context, new RecommendationProvider(recommendation(id, { evidence_ids: context.evidence_ids })));
      expect(result.decision).toBe("HOLD");
      expect(result.race.result.validated_findings.map((finding) => finding.code)).toContain("DESTINATION_NOT_READY");
      expect(result.race.remediation.find((item) => item.finding_code === "DESTINATION_NOT_READY")).toMatchObject({
        required_action: expect.any(String),
        required_evidence: [expect.any(String)],
        owner_role: expect.any(String),
        reassess_after_resolution: true,
      });
    },
  );

  it("keeps OBL-J0C-003's overdue date an application-owned fact despite temporal model prose", async () => {
    const context = buildFinanceAgentContext(liveRecord("OBL-J0C-003"), "7", "2026-09-29");
    const result = await assessObligation(context, new RecommendationProvider(recommendation(context.obligation_id, {
      evidence_ids: context.evidence_ids,
      explanation: "The due date is in the future and payment will happen in October 2026.",
    })));
    expect(result.race.evidence.authoritative_facts.due_date_position).toBe("OVERDUE");
    expect(result.race.evidence.authoritative_facts.as_of_date).toBe("2026-09-29");
    expect(result.race.evidence.authoritative_facts.due_date).toBe("2026-09-12");
    expect(result.race.caveats.model_explanation).not.toEqual(result.race.evidence.authoritative_facts.due_date_position);
  });

  it("treats an impossible source calendar date as normalization HOLD, never as a due-date fact", async () => {
    const context = buildFinanceAgentContext(record("OBL-INVALID-DATE", { due_date: "2026-02-30" }), "1", "2026-03-01");
    const result = await assessObligation(context, new RecommendationProvider(recommendation(context.obligation_id)));
    expect(result.decision).toBe("HOLD");
    expect(result.race.evidence.authoritative_facts.due_date_position).toBe("INVALID");
    expect(result.race.result.validated_findings.map((finding) => finding.code)).toContain("NORMALIZATION_REVIEW_REQUIRED");
  });

  it("treats conflicting due-date status and value as normalization HOLD", async () => {
    const context = buildFinanceAgentContext(record("OBL-DATE-CONFLICT", {
      due_date: "2026-09-30",
      due_date_status: "NOT_STATED_ON_SOURCE",
    }), "1", "2026-09-29");
    const result = await assessObligation(context, new RecommendationProvider(recommendation(context.obligation_id)));
    expect(result.decision).toBe("HOLD");
    expect(result.race.evidence.authoritative_facts.due_date_position).toBe("INVALID");
    expect(result.race.result.validated_findings.map((finding) => finding.code)).toContain("NORMALIZATION_REVIEW_REQUIRED");
  });

  it("fails closed when the model invents a finding code", async () => {
    const context = buildFinanceAgentContext(record("OBL-UNKNOWN-CODE"));
    const result = await assessObligation(context, new RecommendationProvider(recommendation(context.obligation_id, {
      decision: "HOLD",
      finding_codes: ["REQUIRE_BANK_STATEMENT"],
    })));
    expect(result.decision).toBe("HOLD");
    expect(result.race.result.validated_findings.map((finding) => finding.code)).toContain("MODEL_OUTPUT_INVALID");
  });

  it("preserves deterministic blockers when malformed output also fails closed", async () => {
    const context = buildFinanceAgentContext(liveRecord("OBL-J0C-002"), "1", "2026-09-29");
    const result = await assessObligation(context, new RecommendationProvider({
      ...recommendation(context.obligation_id, { evidence_ids: context.evidence_ids }),
      finding_codes: ["MADE_UP_CODE"],
    }));
    const codes = result.race.result.validated_findings.map((finding) => finding.code);
    expect(result.decision).toBe("HOLD");
    expect(codes).toContain("MODEL_OUTPUT_INVALID");
    expect(codes).toContain("DESTINATION_NOT_READY");
  });

  it("does not derive required evidence from model prose", async () => {
    const context = buildFinanceAgentContext(record("OBL-MODEL-PROSE"));
    const result = await assessObligation(context, new RecommendationProvider(recommendation(context.obligation_id, {
      decision: "ESCALATE",
      finding_codes: ["OTHER_REQUIRES_HUMAN_REVIEW"],
      explanation: "Require a bank statement, CFO sign-off, and new policy exception.",
    })));
    expect(result.race.remediation.flatMap((item) => item.required_evidence)).toEqual(["Human decision and its supporting evidence"]);
  });

  it("returns actionable HOLD remediation from validated codes", async () => {
    const context = buildFinanceAgentContext(record("OBL-HOLD", { business_purpose_confirmed: false }));
    const result = await assessObligation(context, new RecommendationProvider(recommendation(context.obligation_id)));
    expect(result.decision).toBe("HOLD");
    expect(result.race.remediation).toContainEqual(expect.objectContaining({
      finding_code: "BUSINESS_PURPOSE_UNCONFIRMED",
      reason: expect.any(String),
      required_action: expect.any(String),
      required_evidence: [expect.any(String)],
      owner_role: expect.any(String),
      reassess_after_resolution: true,
    }));
  });

  it("returns actionable ESCALATE target and context from validated codes", async () => {
    const context = buildFinanceAgentContext(record("OBL-ESCALATE"));
    const result = await assessObligation(context, new RecommendationProvider(recommendation(context.obligation_id, {
      decision: "ESCALATE",
      finding_codes: ["OTHER_REQUIRES_HUMAN_REVIEW"],
    })));
    expect(result.decision).toBe("ESCALATE");
    expect(result.race.remediation[0]).toMatchObject({
      finding_code: "OTHER_REQUIRES_HUMAN_REVIEW",
      escalation_target: expect.any(String),
      required_evidence: [expect.any(String)],
      owner_role: expect.any(String),
      reassess_after_resolution: true,
    });
  });
});
