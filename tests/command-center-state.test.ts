import { describe, expect, it } from "vitest";

import {
  aggregateVersionLabel,
  assessmentCoverageLabel,
  assessmentGateCopy,
  killSwitchLabel,
  killSwitchPresentation,
  obligationListState,
  obligationsFetchErrorMessage,
  pendingPrerequisiteLabel,
  reportSummaryUnavailableReason,
  settlementDisplay,
  workflowState,
} from "../app/command-center";

describe("Command Center obligation list presentation", () => {
  it("distinguishes loading, error, empty and populated genuine lists", () => {
    expect(obligationListState("loading", null, 0)).toBe("loading");
    expect(obligationListState("error", "unavailable", 0)).toBe("error");
    expect(obligationListState("ready", null, 0)).toBe("empty");
    expect(obligationListState("ready", null, 1)).toBe("ready");
  });
});

describe("Command Center fetch error presentation", () => {
  it("never leaks a native JSON-parse exception; reports the HTTP status instead", () => {
    expect(obligationsFetchErrorMessage(500, null)).toBe("Obligations unavailable (HTTP 500).");
  });

  it("surfaces a server-supplied error string when the body is valid JSON", () => {
    expect(obligationsFetchErrorMessage(400, { error: "Malformed request." })).toBe("Malformed request.");
  });
});

describe("Command Center assessment coverage copy", () => {
  it("does not claim 0/0 assessed when the genuine list is unavailable", () => {
    expect(assessmentCoverageLabel("error", 0, 0)).not.toContain("0/0");
    expect(assessmentCoverageLabel("error", 0, 0)).toContain("unavailable");
  });

  it("does not claim 0/0 assessed while the genuine list is loading", () => {
    expect(assessmentCoverageLabel("loading", 0, 0)).not.toContain("0/0");
  });

  it("reports a verified-empty list distinctly from an unavailable one", () => {
    expect(assessmentCoverageLabel("empty", 0, 0)).toContain("No genuine obligations");
  });

  it("reports real counts once the list is populated", () => {
    expect(assessmentCoverageLabel("ready", 2, 5)).toBe("2/5 obligations assessed");
  });
});

describe("Command Center assessment gate copy", () => {
  it("never tells the operator to assess all 0 obligations", () => {
    expect(assessmentGateCopy("error", false, 0)).toBeNull();
    expect(assessmentGateCopy("empty", false, 0)).toBeNull();
    expect(assessmentGateCopy("loading", false, 0)).toBeNull();
  });

  it("gates authorization on the real total once the list is populated", () => {
    expect(assessmentGateCopy("ready", false, 5)).toContain("all 5");
    expect(assessmentGateCopy("ready", true, 5)).toBeNull();
  });
});

describe("Command Center kill-switch presentation", () => {
  it("shows 'no obligation selected' instead of implying execution is allowed", () => {
    expect(killSwitchPresentation(false, undefined)).toBe("no-selection");
    expect(killSwitchLabel("no-selection")).toBe("No obligation selected");
  });

  it("never encodes an inactive kill switch as 'Execution allowed' (release is separate, still NOT_GRANTED)", () => {
    expect(killSwitchPresentation(true, false)).toBe("inactive");
    expect(killSwitchLabel("inactive")).not.toBe("Execution allowed");
    expect(killSwitchLabel("inactive")).toContain("does not grant release");
  });

  it("reflects an engaged kill switch", () => {
    expect(killSwitchPresentation(true, true)).toBe("engaged");
    expect(killSwitchLabel("engaged")).toBe("Execution disabled");
  });
});

describe("Command Center aggregate version label", () => {
  it("never renders the raw 'v?' placeholder when nothing is selected", () => {
    expect(aggregateVersionLabel(undefined, false)).not.toBe("?");
  });

  it("distinguishes no-selection from a selection still loading its detail", () => {
    expect(aggregateVersionLabel(undefined, false)).not.toBe(aggregateVersionLabel(undefined, true));
  });

  it("renders the real version once detail has loaded", () => {
    expect(aggregateVersionLabel(7, true)).toBe("7");
  });
});

describe("Command Center operational report availability", () => {
  it("flags the HOLD/ESCALATE summary as unavailable rather than showing false zeros", () => {
    expect(reportSummaryUnavailableReason("error")).not.toBeNull();
    expect(reportSummaryUnavailableReason("loading")).not.toBeNull();
  });

  it("treats a verified-empty or populated list as a real, reportable summary", () => {
    expect(reportSummaryUnavailableReason("empty")).toBeNull();
    expect(reportSummaryUnavailableReason("ready")).toBeNull();
  });
});

describe("Command Center unmet-prerequisite label (no 'awaiting authorization' before assessment)", () => {
  it("names assessment as the first unmet prerequisite when no current assessment exists", () => {
    expect(pendingPrerequisiteLabel(false)).toContain("Assessment required");
    expect(pendingPrerequisiteLabel(false)).not.toContain("Awaiting human authorization");
  });

  it("names human authorization only after a current assessment exists", () => {
    expect(pendingPrerequisiteLabel(true)).toBe("Awaiting human authorization");
  });
});

describe("Command Center settlement display (AED source keeps derived settlement truth)", () => {
  it("does not claim settlement is 'Not applicable' for an AED source with server settlement truth", () => {
    const text = settlementDisplay({ currency: "AED", amount: "5760.00" }, { amount: "1568.413887", asset: "USDC" });
    expect(text).not.toContain("Not applicable");
    expect(text).toContain("1568.413887 USDC");
    expect(text).toContain("5760.00 AED");
  });

  it("reports unavailable settlement truth rather than a fabricated amount", () => {
    expect(settlementDisplay({ currency: "AED", amount: "5760.00" }, undefined)).toContain("Unavailable");
  });
});

function detailWithReleaseAuthority(releaseAuthority: string) {
  return {
    aggregate: { state: "AUTHORIZED", execution_state: "NONE" },
    execution: null,
    truth: { tameion_control_truth: { execution_release_authority: releaseAuthority } },
  } as Parameters<typeof workflowState>[0];
}

describe("Command Center server-derived authority headline", () => {
  it("shows execution suspended instead of ready when server truth reports a kill switch", () => {
    expect(workflowState(detailWithReleaseAuthority("SUSPENDED_KILL_SWITCH"))).toEqual({
      label: "Execution suspended",
      tone: "warning",
      explanation: "A kill switch prevents release of the currently sealed PAE.",
    });
  });

  it("describes a sealed PAE as requiring worker re-verification, not unconditional readiness", () => {
    const state = workflowState(detailWithReleaseAuthority("TAMEION_PAE_REVERIFY_REQUIRED"));
    expect(state.label).toBe("Authorized — PAE sealed");
    expect(state.explanation).toContain("must still re-verify");
    expect(state.explanation).not.toContain("ready for execution");
  });
});

import { authorizationBlockers, queueCompletionLabel, reconciliationLeadLine } from "../app/command-center";

describe("queue completion: incomplete assessment is never a completed no-candidate", () => {
  it("reports an incomplete assessment set with its count", () => {
    expect(queueCompletionLabel({ total: 5, unassessed: 5, hold: 0, escalate: 0, pay: 0 })).toContain("0 of 5 assessed");
  });

  it("reports a completed no-candidate result only when every obligation is assessed and none is PAY", () => {
    const label = queueCompletionLabel({ total: 5, unassessed: 0, hold: 4, escalate: 1, pay: 0 });
    expect(label).toContain("Completed");
    expect(label).toContain("no PAY candidate");
  });

  it("reports PAY candidates as advisory, not authorized", () => {
    expect(queueCompletionLabel({ total: 5, unassessed: 0, hold: 3, escalate: 0, pay: 2 })).toContain("2 PAY recommendation");
  });
});

describe("authorization blockers name the first unmet prerequisite in order", () => {
  it("starts with selection, then assessment, then review of the current assessment", () => {
    expect(authorizationBlockers({ hasSelection: false, allAssessed: false, hasCurrentAssessment: false, reviewed: false, killSwitchEngaged: false })[0]).toContain("Select an obligation");
    expect(authorizationBlockers({ hasSelection: true, allAssessed: false, hasCurrentAssessment: false, reviewed: false, killSwitchEngaged: false })[0]).toContain("Assess all");
    expect(authorizationBlockers({ hasSelection: true, allAssessed: true, hasCurrentAssessment: true, reviewed: false, killSwitchEngaged: false })[0]).toContain("Review");
  });

  it("returns no blockers only when every prerequisite is met", () => {
    expect(authorizationBlockers({ hasSelection: true, allAssessed: true, hasCurrentAssessment: true, reviewed: true, killSwitchEngaged: false })).toEqual([]);
  });

  it("reports an engaged kill switch as a blocker", () => {
    expect(authorizationBlockers({ hasSelection: true, allAssessed: true, hasCurrentAssessment: true, reviewed: true, killSwitchEngaged: true }).join(" ")).toContain("Kill switch engaged");
  });
});

describe("reconciliation leads with the absence of submission", () => {
  it("says there is nothing to reconcile when no submission exists", () => {
    expect(reconciliationLeadLine(null)).toBe("No submission; nothing to reconcile.");
  });

  it("does not claim nothing to reconcile once a submission exists", () => {
    expect(reconciliationLeadLine("SUBMITTED")).not.toContain("nothing to reconcile");
  });
});
