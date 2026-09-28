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
});
