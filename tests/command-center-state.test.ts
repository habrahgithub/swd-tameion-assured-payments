import { describe, expect, it } from "vitest";

import {
  aggregateVersionLabel,
  assessmentCoverageLabel,
  assessmentGateCopy,
  killSwitchLabel,
  killSwitchPresentation,
  obligationListState,
  obligationsFetchErrorMessage,
  reportSummaryUnavailableReason,
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

describe("Command Center fetch error presentation (root-cause: unguarded response.json())", () => {
  it("never leaks a native JSON-parse exception; reports the HTTP status instead", () => {
    // Reproduces the confirmed production failure: an upstream 500 with an
    // empty body makes response.json() throw a native, browser-specific
    // parse error ("The string did not match the expected pattern." on
    // WebKit, "Unexpected end of JSON input" on V8). Neither is a usable
    // operator-facing message.
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

  it("reflects the real server-derived kill-switch state once an obligation is selected", () => {
    expect(killSwitchPresentation(true, false)).toBe("allowed");
    expect(killSwitchLabel("allowed")).toBe("Execution allowed");
    expect(killSwitchPresentation(true, true)).toBe("disabled");
    expect(killSwitchLabel("disabled")).toBe("Execution disabled");
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
