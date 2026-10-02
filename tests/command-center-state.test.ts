import { describe, expect, it } from "vitest";

import { workflowState } from "../app/command-center";

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
