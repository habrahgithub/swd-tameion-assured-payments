import { describe, expect, it } from "vitest";

import {
  assessmentReviewSnapshot,
  currentReviewedAssessment,
  shouldKeepAssessmentRecoveryKey,
} from "../src/client/assessment-review-snapshot";

const response = {
  obligation_id: "OBL-J0C-001",
  assessment_id: "ASM-1",
  assessment_hash: "a".repeat(64),
  aggregate_version: "3",
  decision: "HOLD",
  reasons: ["Evidence is incomplete."],
  race: {
    result: { decision: "HOLD", decision_summary: "Evidence is incomplete.", validated_findings: [{ code: "SOURCE_EVIDENCE_MISSING", severity: "HOLD", reason: "No source evidence is attached." }] },
    action_taken: { summary: "Checks complete.", checks: ["Evidence checked."] },
    caveats: { missing_context: ["SOURCE_EVIDENCE"], uncertainty_signal: true, model_proposed_findings: [], model_proposed_findings_authority: "NON_AUTHORITATIVE", model_explanation: "Need bank proof.", model_explanation_authority: "NON_AUTHORITATIVE" },
    evidence: { evidence_ids: [], authoritative_facts: { obligation_id: "OBL-J0C-001", aggregate_version: "3", amount: "5.00", currency: "USD", due_date: null, due_date_status: "NOT_STATED_ON_SOURCE", due_date_position: "NOT_STATED", as_of_date: "2026-09-29", state_at_event_baseline: "OUTSTANDING", business_purpose_confirmed: true, source_evidence_present: false, destination_status: "PENDING_J0_D_TRUST_SEED" } },
    remediation: [{ finding_code: "SOURCE_EVIDENCE_MISSING", reason: "No source evidence is attached.", required_action: "Attach approved evidence.", required_evidence: ["Invoice"], owner_role: "Accounts Payable", reassess_after_resolution: true }],
    prompt_identity: { version: "care-v1", sha256: "a".repeat(64) },
  },
};

describe("human-reviewed assessment snapshot", () => {
    it("captures exactly the identity, version, decision, and reasons shown to the human", () => {
    expect(assessmentReviewSnapshot(response)).toEqual(response);
  });

  it("authorizes only the displayed snapshot while it still matches currentness", () => {
    const displayed = assessmentReviewSnapshot(response);
    const current = assessmentReviewSnapshot(response);

    expect(currentReviewedAssessment(displayed, current, "OBL-J0C-001", 3)).toBe(displayed);
    expect(currentReviewedAssessment(displayed, { ...current!, assessment_hash: "b".repeat(64) }, "OBL-J0C-001", 3)).toBeNull();
    expect(currentReviewedAssessment(displayed, current, "OBL-J0C-001", 4)).toBeNull();
    expect(currentReviewedAssessment(displayed, current, "OBL-J0C-002", 3)).toBeNull();
  });

  it("retains the same recovery key across pending, server-error, and gateway-timeout responses", () => {
    expect(shouldKeepAssessmentRecoveryKey(202)).toBe(true);
    expect(shouldKeepAssessmentRecoveryKey(500)).toBe(true);
    expect(shouldKeepAssessmentRecoveryKey(504)).toBe(true);
    expect(shouldKeepAssessmentRecoveryKey(409, "ASM-UNKNOWN")).toBe(true);
    expect(shouldKeepAssessmentRecoveryKey(200)).toBe(false);
    expect(shouldKeepAssessmentRecoveryKey(409, "ASM-001")).toBe(false);
  });

  it("refuses legacy assessment snapshots without validated RACE data", () => {
    const legacy = assessmentReviewSnapshot({ ...response, race: undefined });
    expect(legacy).not.toBeNull();
    expect(currentReviewedAssessment(legacy, legacy, "OBL-J0C-001", 3)).toBeNull();
  });

  it("preserves immutable pre-proposal RACE snapshots without synthesizing audit fields", () => {
    const legacyRace = structuredClone(response.race);
    delete (legacyRace.caveats as Partial<typeof legacyRace.caveats>).model_proposed_findings;
    delete (legacyRace.caveats as Partial<typeof legacyRace.caveats>).model_proposed_findings_authority;
    const legacy = assessmentReviewSnapshot({ ...response, race: legacyRace });

    expect(legacy?.race?.caveats).not.toHaveProperty("model_proposed_findings");
    expect(legacy?.race?.caveats).not.toHaveProperty("model_proposed_findings_authority");
  });

    it("rejects a displayed snapshot if application-owned remediation changes", () => {
    const displayed = assessmentReviewSnapshot(response)!;
    const current = assessmentReviewSnapshot({
      ...response,
      race: { ...response.race, remediation: [{ ...response.race.remediation[0], required_action: "Different action" }] },
    });
    expect(currentReviewedAssessment(displayed, current, "OBL-J0C-001", 3)).toBeNull();
  });
});

describe("provider/runtime truth in snapshot", () => {
  it("captures provider_used, provider_mode, and optional model/runtime fields when present", () => {
    const withProvider = {
      ...response,
      provider_used: "deterministic-fallback-v1",
      provider_mode: "NOT_LIVE_AI",
      model_id: "gpt-oss-fallback",
      model_config_version: "care-v1",
      runtime_config_sha256: "b".repeat(64),
    };
    const snapshot = assessmentReviewSnapshot(withProvider);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.provider_truth).toEqual({
      provider_used: "deterministic-fallback-v1",
      provider_mode: "NOT_LIVE_AI",
      model_id: "gpt-oss-fallback",
      model_config_version: "care-v1",
      runtime_config_sha256: "b".repeat(64),
    });
  });

  it("omits provider_truth when provider_used or provider_mode is absent", () => {
    const snapshot = assessmentReviewSnapshot(response);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.provider_truth).toBeUndefined();
  });

  it("omits provider_truth when provider_mode has an invalid value", () => {
    const bad = assessmentReviewSnapshot({ ...response, provider_used: "test", provider_mode: "FAKE" });
    expect(bad).not.toBeNull();
    expect(bad!.provider_truth).toBeUndefined();
  });

  it("distinguishes snapshots when provider truth changes", () => {
    const base = assessmentReviewSnapshot({ ...response, provider_used: "a", provider_mode: "NOT_LIVE_AI" });
    const changed = assessmentReviewSnapshot({ ...response, provider_used: "b", provider_mode: "NOT_LIVE_AI" });
    expect(currentReviewedAssessment(base, changed, "OBL-J0C-001", 3)).toBeNull();
  });
});
