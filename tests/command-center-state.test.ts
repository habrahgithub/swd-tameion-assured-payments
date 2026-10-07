import { describe, expect, it } from "vitest";

import type { RaceAssessment } from "../src/agent/schema";
import { assessmentNextAction, buildAssessmentTrace, hasExpectedObligationIdentity, hasSimulatedTrustFixture, judgeReadableState, settlementDisplay, type AssessmentTraceStep } from "../src/client/command-center-state";

import {
  authorizationPanelCopy,
  aggregateVersionLabel,
  assessmentCoverageLabel,
  assessmentGateCopy,
  killSwitchLabel,
  killSwitchPresentation,
  obligationListState,
  obligationsFetchErrorMessage,
  pendingPrerequisiteLabel,
  reportSummaryUnavailableReason,
  operationalReportSummaryLabel,
  operationalReportDetailPrompt,
  workflowState,
} from "../app/command-center";

describe("authorization copy follows prepared proxy state", () => {
  it("does not describe an existing proxy as a missing payment intent before PAE sealing", () => {
    expect(authorizationPanelCopy("loaded", true, false, true, false)).toBe(
      "The Arc Testnet proxy is prepared. Current assessment and assurance determine whether authorization is available; no PAE is sealed.",
    );
    expect(authorizationPanelCopy("loaded", true, false, false, false)).toContain("no payment intent exists");
  });
});

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

describe("Command Center selected-detail identity contract", () => {
  it("accepts only a detail record whose explicit obligation identity matches the selection", () => {
    expect(hasExpectedObligationIdentity({ record: { obligation_id: "OBL-A" } }, "OBL-A")).toBe(true);
    expect(hasExpectedObligationIdentity({ record: { obligation_id: "OBL-B" } }, "OBL-A")).toBe(false);
    expect(hasExpectedObligationIdentity({ record: {} }, "OBL-A")).toBe(false);
    expect(hasExpectedObligationIdentity({ record: null }, "OBL-A")).toBe(false);
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
    expect(killSwitchPresentation("none", undefined)).toBe("no-selection");
    expect(killSwitchLabel("no-selection")).toBe("No obligation selected");
  });

  it("never encodes an inactive kill switch as 'Execution allowed' (release is separate, still NOT_GRANTED)", () => {
    expect(killSwitchPresentation("loaded", false)).toBe("inactive");
    expect(killSwitchLabel("inactive")).not.toBe("Execution allowed");
    expect(killSwitchLabel("inactive")).toContain("does not grant release");
  });

  it("reflects an engaged kill switch", () => {
    expect(killSwitchPresentation("loaded", true)).toBe("engaged");
    expect(killSwitchLabel("engaged")).toBe("Execution disabled");
  });

  it("does not present the retained kill-switch value as current when selected detail is stale", () => {
    expect(killSwitchPresentation("stale", false)).toBe("stale");
    expect(killSwitchLabel("stale")).toContain("stale");
    expect(killSwitchLabel("stale")).toContain("retry");
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

  it("keeps the lifecycle summary aligned with list availability", () => {
    const summary = { total: 0, hold: 0, escalate: 0, unassessed: 0, pay: 0 };
    expect(operationalReportSummaryLabel("loading", summary)).toContain("loading");
    expect(operationalReportSummaryLabel("error", summary)).toContain("unavailable");
    expect(operationalReportSummaryLabel("empty", summary)).toContain("No genuine obligations");
    expect(operationalReportSummaryLabel("ready", { ...summary, total: 2, unassessed: 2 })).toContain("Incomplete");
  });

  it("does not describe a selected but unresolved detail as no selection", () => {
    expect(operationalReportDetailPrompt("none")).toContain("Select an obligation");
    expect(operationalReportDetailPrompt("loading")).toContain("loading");
    expect(operationalReportDetailPrompt("failed")).toContain("unavailable");
    expect(operationalReportDetailPrompt("stale")).toContain("stale");
    expect(reconciliationLeadLine("stale", { status: "SUBMITTED" })).toContain("Last-known");
  });
});

describe("Command Center decision-specific authorization state", () => {
  it("names assessment as the first unmet prerequisite when no current assessment exists", () => {
    expect(pendingPrerequisiteLabel(null)).toContain("Assessment required");
    expect(pendingPrerequisiteLabel(null)).not.toContain("human authorization");
  });

  it("makes only PAY eligible for human authorization review", () => {
    expect(pendingPrerequisiteLabel("PAY")).toBe("Eligible for human authorization review");
    expect(pendingPrerequisiteLabel("HOLD")).toBe("Requires attention");
    expect(pendingPrerequisiteLabel("ESCALATE")).toBe("Escalation required");
  });
});

describe("Command Center settlement display (AED source keeps derived settlement truth)", () => {
  it("does not claim settlement is 'Not applicable' for an AED source with server settlement truth", () => {
    const text = settlementDisplay({ currency: "AED", amount: "5760.00" }, { amount: "1568.413887", asset: "USDC" });
    expect(text).not.toContain("Not applicable");
    expect(text).toContain("1568.413887 USDC");
    expect(text).toContain("1 USD = AED 3.6725");
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
  const pendingDecision = (decision: "PAY" | "HOLD" | "ESCALATE", aggregateVersion = "1") => ({
    ...detailWithReleaseAuthority("NOT_GRANTED"),
    aggregate: { state: "APPROVAL_PENDING", aggregate_version: 1 },
    record: { obligation_id: "OBL-1" },
    current_assessment: { obligation_id: "OBL-1", aggregate_version: aggregateVersion, decision },
  } as Parameters<typeof workflowState>[0]);

  it("keeps HOLD and ESCALATE visibly locked and allows review only for a current PAY", () => {
    expect(workflowState(pendingDecision("HOLD")).label).toBe("Requires attention");
    expect(workflowState(pendingDecision("HOLD")).explanation).toContain("Human authorization is locked");
    expect(workflowState(pendingDecision("ESCALATE")).label).toBe("Escalation required");
    expect(workflowState(pendingDecision("ESCALATE")).explanation).toContain("Human authorization is locked");
    expect(workflowState(pendingDecision("PAY")).label).toBe("Eligible for human authorization review");
    expect(workflowState(pendingDecision("PAY")).explanation).toContain("advisory");
    expect(workflowState(pendingDecision("PAY")).explanation).toContain("no execution authority");
    expect(workflowState(pendingDecision("PAY", "2")).label).toBe("Assessment required before authorization");
  });

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

  it("does not describe a simulated execution record as a genuine reconciled payment", () => {
    const simulated = {
      aggregate: { state: "RECONCILED", aggregate_version: 2, execution_state: "SETTLED" },
      execution: { status: "SETTLED", provider_ref: "FAKE-REF" },
      truth: {
        tameion_control_truth: { execution_release_authority: "CONSUMED" },
        settlement_truth: { runtime: "SIMULATED" },
      },
    } as Parameters<typeof workflowState>[0];
    expect(workflowState(simulated)).toEqual({
      label: "Simulated record — no Arc settlement",
      tone: "neutral",
      explanation: "The stored execution result used a simulated adapter and does not represent a vendor payment.",
    });
  });
});

import { authorizationBlockers, queueCompletionLabel, reconciliationLeadLine } from "../app/command-center";

describe("queue completion: incomplete assessment is never a completed no-candidate", () => {
  it("reports an incomplete assessment set with its count", () => {
    expect(queueCompletionLabel({ total: 5, unassessed: 5, hold: 0, escalate: 0, pay: 0 })).toContain("0 of 5 assessed");
  });

  it("reports a completed no-candidate result only when every obligation is assessed and none is PAY", () => {
    const label = queueCompletionLabel({ total: 5, unassessed: 0, hold: 4, escalate: 1, pay: 0 });
    expect(label).toContain("Assessment complete");
    expect(label).toContain("no PAY candidate");
  });

  it("reports PAY candidates as advisory, not authorized", () => {
    const label = queueCompletionLabel({ total: 5, unassessed: 0, hold: 3, escalate: 0, pay: 2 });
    expect(label).toContain("2 PAY recommendation");
    expect(label).toContain("Assessment complete");
    expect(label).not.toContain("Completed");
  });
});

describe("authorization blockers name the first unmet prerequisite in order", () => {
  it("starts with selection, then assessment, then review of the current assessment", () => {
    expect(authorizationBlockers({ hasSelection: false, allAssessed: false, hasCurrentPayAssessment: false, reviewed: false, killSwitchEngaged: false })[0]).toContain("Select an obligation");
    expect(authorizationBlockers({ hasSelection: true, allAssessed: false, hasCurrentPayAssessment: false, reviewed: false, killSwitchEngaged: false })[0]).toContain("Assess all");
    expect(authorizationBlockers({ hasSelection: true, allAssessed: true, hasCurrentPayAssessment: false, reviewed: false, killSwitchEngaged: false })[0]).toContain("PAY assessment");
    expect(authorizationBlockers({ hasSelection: true, allAssessed: true, hasCurrentPayAssessment: true, reviewed: false, killSwitchEngaged: false })[0]).toContain("Review");
  });

  it("names actual assurance facts and does not invent an owner or generic readiness task", () => {
    const blockers = authorizationBlockers({
      hasSelection: true, allAssessed: true, hasCurrentPayAssessment: true,
      routeAssuranceReady: false, destinationVerification: "PENDING_VERIFICATION",
      destinationOperational: "ON_HOLD", sourceWallet: "INACTIVE", reviewed: false, killSwitchEngaged: false,
      proxyPreparationAvailable: true,
    });
    expect(blockers[0]).toContain("Destination verification is pending verification");
    expect(blockers[0]).toContain("destination operations are on hold");
    expect(blockers[0]).toContain("source wallet is inactive");
    expect(blockers[0]).toContain("Owner: unavailable");
    expect(blockers[0]).toContain("External-evidence step");
    expect(blockers[0]).toContain("fresh assessment after preparation");
    expect(blockers[0]).not.toContain("no product action is available here");
    expect(blockers[0]).not.toContain("satisfy the existing readiness gate");
  });

  it("returns no blockers only when every prerequisite is met", () => {
    expect(authorizationBlockers({ hasSelection: true, allAssessed: true, hasCurrentPayAssessment: true, reviewed: true, killSwitchEngaged: false })).toEqual([]);
  });

  it("reports an engaged kill switch as a blocker", () => {
    expect(authorizationBlockers({ hasSelection: true, allAssessed: true, hasCurrentPayAssessment: true, reviewed: true, killSwitchEngaged: true }).join(" ")).toContain("Kill switch engaged");
  });
});

describe("reconciliation leads with the absence of submission", () => {
  it("says there is no Arc settlement when no execution exists", () => {
    expect(reconciliationLeadLine("loaded", null)).toBe("No Arc settlement to reconcile.");
  });

  it("labels a stored execution as simulated and not an Arc settlement", () => {
    expect(reconciliationLeadLine("loaded", { status: "SUBMITTED" })).toBe("Simulated execution SUBMITTED; no Arc settlement to reconcile.");
  });
});

import { queueHeaderLabel } from "../app/command-center";

describe("obligations queue header distinguishes incomplete from completed states", () => {
  const summary = (unassessed: number, pay = 0) => ({ total: 5, unassessed, hold: 5 - unassessed - pay, escalate: 0, pay });

  it("never claims completion while the genuine queue is loading, unavailable or empty", () => {
    expect(queueHeaderLabel("loading", summary(5))).not.toContain("Completed");
    expect(queueHeaderLabel("error", summary(5))).not.toContain("Completed");
    expect(queueHeaderLabel("empty", { total: 0, unassessed: 0, hold: 0, escalate: 0, pay: 0 })).not.toContain("Completed");
  });

  it("reports incomplete assessment while any obligation is unassessed", () => {
    expect(queueHeaderLabel("ready", summary(5))).toContain("Incomplete");
  });

  it("reports completed no-candidate only after every obligation is assessed with no PAY", () => {
    expect(queueHeaderLabel("ready", summary(0, 0))).toContain("Assessment complete — no PAY candidate");
  });
});

function race(overrides: Partial<{ evidence_ids: string[]; findings: Array<{ code: string; severity: "HOLD" | "ESCALATE"; reason: string }>; proposed: string[]; explanation: string }> = {}): RaceAssessment {
  const findings = overrides.findings ?? [];
  return {
    result: { decision: findings.length ? "HOLD" : "PAY", decision_summary: "summary", validated_findings: findings },
    action_taken: { summary: "checked", checks: [] },
    caveats: {
      missing_context: [],
      uncertainty_signal: false,
      model_proposed_findings: overrides.proposed ?? [],
      model_proposed_findings_authority: "NON_AUTHORITATIVE",
      model_explanation: overrides.explanation ?? "model text",
      model_explanation_authority: "NON_AUTHORITATIVE",
    },
    evidence: {
      evidence_ids: overrides.evidence_ids ?? ["SYN-EVD-001"],
      authoritative_facts: {
        obligation_id: "OBL-1", aggregate_version: "1", amount: "100.00", currency: "USD",
        due_date: "2026-02-01", due_date_status: "STATED_ON_SOURCE", due_date_position: "FUTURE",
        as_of_date: "2026-01-01", state_at_event_baseline: "OUTSTANDING", business_purpose_confirmed: true,
        source_evidence_present: true, destination_status: "READY",
      },
    },
    remediation: findings.map((f) => ({
      finding_code: f.code, reason: f.reason, required_action: `Resolve ${f.code}`, required_evidence: ["doc"],
      owner_role: "Treasury operations", reassess_after_resolution: true,
      ...(f.severity === "ESCALATE" ? { escalation_target: "Finance controller" } : {}),
    })),
    prompt_identity: null,
  } as unknown as RaceAssessment;
}

const stepNamed = (steps: AssessmentTraceStep[], step: AssessmentTraceStep["step"]) => steps.find((s) => s.step === step)!;

describe("assessment trace hierarchy derived from existing RACE fields", () => {
  it("orders the trace sourceIDs → facts → proposal → validated findings → catalog", () => {
    expect(buildAssessmentTrace(race()).map((s) => s.step)).toEqual([
      "SOURCE_IDS", "SUPPLIED_FACTS", "APPLICATION_OVERLAYS", "PROPOSAL", "VALIDATED_FINDINGS", "CATALOG",
    ]);
  });

  it("lists only the supplied evidence IDs and claims none when none were supplied", () => {
    expect(stepNamed(buildAssessmentTrace(race({ evidence_ids: ["SYN-EVD-001"] })), "SOURCE_IDS").items).toEqual(["SYN-EVD-001"]);
    const empty = stepNamed(buildAssessmentTrace(race({ evidence_ids: [] })), "SOURCE_IDS");
    expect(empty.items).toEqual([]);
    expect(empty.empty_reason).toContain("no evidence is claimed");
  });

  it("labels the model proposal as non-authoritative and never as a finding", () => {
    const proposal = stepNamed(buildAssessmentTrace(race({ explanation: "advisory text" })), "PROPOSAL");
    expect(proposal.authority).toBe("NON_AUTHORITATIVE");
    expect(proposal.items).toContain("advisory text");
  });

  it("shows proposed findings that the deterministic checks did not validate as rejected", () => {
    const proposal = stepNamed(buildAssessmentTrace(race({ proposed: ["DUPLICATE_SOURCE"], findings: [] })), "PROPOSAL");
    expect(proposal.items.join(" ")).toContain("DUPLICATE_SOURCE — not validated; rejected by deterministic checks");
  });

  it("maps each validated finding one-to-one onto a catalog remediation item", () => {
    const steps = buildAssessmentTrace(race({ findings: [{ code: "DUE_DATE_NOT_STATED", severity: "HOLD", reason: "no due date" }] }));
    const findings = stepNamed(steps, "VALIDATED_FINDINGS");
    const catalog = stepNamed(steps, "CATALOG");
    expect(findings.items).toHaveLength(1);
    expect(catalog.items).toHaveLength(1);
    expect(catalog.items[0]).toContain("DUE_DATE_NOT_STATED");
    expect(catalog.items[0]).toContain("Treasury operations");
  });

  it("makes no investigation, raw-document or invented-data claim anywhere in the trace", () => {
    const text = JSON.stringify(buildAssessmentTrace(race({ findings: [{ code: "DUE_DATE_NOT_STATED", severity: "HOLD", reason: "no due date" }] }))).toLowerCase();
    expect(text).not.toContain("investigat");
    expect(text).not.toContain("raw document");
    expect(text).not.toContain("independent");
  });
});

import { lifecycleStopLabel, killSwitchPresentation as ksp, reconciliationLeadLine as recon } from "../app/command-center";

describe("unknown truth never asserts inactive or no-submission", () => {
  it("does not assert inactive when the kill-switch field is absent", () => {
    expect(ksp("loaded", undefined)).toBe("unknown");
    expect(killSwitchLabel("unknown")).toContain("unknown");
  });

  it("does not assert inactive while detail is loading or failed", () => {
    expect(ksp("loading", undefined)).toBe("loading");
    expect(ksp("failed", undefined)).toBe("failed");
  });

  it("asserts inactive only from an explicit false on loaded detail", () => {
    expect(ksp("loaded", false)).toBe("inactive");
  });

  it("does not assert no submission while detail is loading, failed or absent", () => {
    for (const state of ["loading", "failed", "none"] as const) {
      expect(recon(state, undefined)).not.toContain("No submission");
    }
  });

  it("asserts no Arc settlement only from loaded detail with an explicit null execution", () => {
    expect(recon("loaded", null)).toBe("No Arc settlement to reconcile.");
    expect(recon("loaded", undefined)).not.toContain("No Arc settlement");
  });
});

describe("one lifecycle truth for the genuine path (STOP before all assessed)", () => {
  const ready = (total: number, assessed: number, pay = 0) => ({ presentation: "ready" as const, total, assessed, pay });

  it("never claims completion while loading, unavailable or empty", () => {
    expect(lifecycleStopLabel({ presentation: "loading", total: 0, assessed: 0, pay: 0 })).not.toContain("Completed");
    expect(lifecycleStopLabel({ presentation: "error", total: 0, assessed: 0, pay: 0 })).not.toContain("Completed");
    expect(lifecycleStopLabel({ presentation: "empty", total: 0, assessed: 0, pay: 0 })).not.toContain("Completed");
  });

  it("states STOP before all assessed, including zero of five", () => {
    expect(lifecycleStopLabel(ready(5, 0))).toContain("STOP");
    expect(lifecycleStopLabel(ready(5, 3))).toContain("STOP");
  });

  it("states completion only when all assessed and no PAY candidate exists", () => {
    expect(lifecycleStopLabel(ready(5, 5, 0))).toContain("Assessment complete");
    expect(lifecycleStopLabel(ready(5, 5, 2))).not.toContain("Assessment complete — no PAY");
  });
});

describe("financial oracles cover USD, AED and unsupported currency explicitly", () => {
  it("shows pre-intent USD settlement only as indicative with no payment intent", () => {
    const text = settlementDisplay({ currency: "USD", amount: "100.00" }, { amount: "100.000000", asset: "USDC" });
    expect(text).toContain("100.000000 USDC");
    expect(text).toContain("indicative only");
    expect(text).toContain("No payment intent exists");
    expect(text).not.toContain("Not applicable");
  });

  it("shows pre-intent AED settlement only as indicative with the fixed policy rate", () => {
    const text = settlementDisplay({ currency: "AED", amount: "5760.00" }, { amount: "1568.413887", asset: "USDC" });
    expect(text).toContain("indicative only");
    expect(text).toContain("1 USD = AED 3.6725");
    expect(text).toContain("No payment intent exists");
  });

  it("labels an intent-bound settlement amount separately from an indicative equivalent", () => {
    const text = settlementDisplay({ currency: "AED", amount: "5760.00" }, { amount: "1568.413887", asset: "USDC" }, true);
    expect(text).toContain("Intent-bound amount");
    expect(text).not.toContain("indicative only");
  });

  it("does not present an unsupported currency as a derived settlement or a zero amount", () => {
    const text = settlementDisplay({ currency: "EUR", amount: "300.00" }, { amount: "0.000000", asset: "USDC" });
    expect(text).toContain("unsupported source currency EUR");
    expect(text).not.toContain("0.000000 USDC");
  });
});

describe("Command Center advisory next action", () => {
  it("keeps PAY advisory until all genuine obligations are assessed", () => {
    expect(assessmentNextAction("PAY", false)).toContain("assess the remaining genuine obligations");
    expect(assessmentNextAction("PAY", true)).toContain("human authorization");
    expect(assessmentNextAction("PAY", true)).toContain("does not authorize payment");
  });

  it("provides a useful HOLD and ESCALATE next action without unlocking authority", () => {
    expect(assessmentNextAction("HOLD", true)).toContain("resolve the findings before reassessing");
    expect(assessmentNextAction("HOLD", true)).toContain("Authorization remains locked");
    expect(assessmentNextAction("ESCALATE", true)).toContain("escalate the findings for human review");
    expect(assessmentNextAction("ESCALATE", true)).toContain("Authorization remains locked");
  });
});

describe("judge-readable technical state labels", () => {
  it("expands internal enum separators without changing the underlying state", () => {
    expect(judgeReadableState("PENDING_VERIFICATION")).toBe("Pending Verification");
    expect(judgeReadableState("NOT_GRANTED")).toBe("Not Granted");
  });
});

describe("genuine-lane trust fixture separation", () => {
  it("recognizes simulated wallet provenance even when the trust status flag is false", () => {
    expect(hasSimulatedTrustFixture(false, "WALLET-SOURCE-P0-1-SIMULATED")).toBe(true);
    expect(hasSimulatedTrustFixture(true, "source-wallet-1")).toBe(true);
    expect(hasSimulatedTrustFixture(false, "verified-business-wallet")).toBe(false);
  });
});

describe("trace exposes due-date and readiness provenance and qualifies completeness as UNVERIFIED", () => {
  it("states the due-date status and the destination readiness source from the record", () => {
    const steps = buildAssessmentTrace(race());
    const facts = stepNamed(steps, "SUPPLIED_FACTS").items.join(" | ");
    expect(facts).toContain("Source due-date status: Stated on source");
    expect(stepNamed(steps, "APPLICATION_OVERLAYS").label).toBe("Application readiness overlay");
  });

  it("qualifies source-to-context completeness as UNVERIFIED", () => {
    const facts = stepNamed(buildAssessmentTrace(race()), "SUPPLIED_FACTS").items.join(" | ");
    expect(facts).toContain("Source-to-context completeness: UNVERIFIED");
  });

  it("separates raw and effective dates, basis, authority, and as-of date", () => {
    const attested = race();
    const facts = attested.evidence.authoritative_facts as Record<string, unknown>;
    facts.due_date = null;
    facts.due_date_status = "NOT_STATED_ON_SOURCE";
    facts.issue_date = "2026-01-01";
    facts.effective_due_date = "2026-01-31";
    facts.effective_due_date_basis = "INVOICE_DATE_CASH_TERM";
    facts.effective_due_date_provenance = { provenance_class: "AUTHORIZED_OPERATOR_ATTESTATION", authority_reference: "AUTH-REF-7" };
    const items = stepNamed(buildAssessmentTrace(attested), "SUPPLIED_FACTS").items.join(" | ");
    expect(items).toContain("Raw due date: Not captured on source");
    expect(items).toContain("Effective due date: 2026-01-31");
    expect(items).toContain("INVOICE_DATE_CASH_TERM");
    expect(items).toContain("authorized operator attestation");
    expect(items).toContain("AUTH-REF-7");
    expect(items).toContain("Assessment as of: 2026-01-01");
  });
});

describe("selected-but-loading or failed detail is named as such, never as no selection", () => {
  it("names a loading selected detail", () => {
    expect(killSwitchLabel(ksp("loading", undefined))).toContain("loading");
    expect(killSwitchLabel(ksp("loading", undefined))).not.toContain("No obligation selected");
  });
  it("names a failed selected detail", () => {
    expect(killSwitchLabel(ksp("failed", undefined))).toContain("unavailable");
    expect(killSwitchLabel(ksp("failed", undefined))).not.toContain("No obligation selected");
  });
  it("keeps no-selection only when nothing is selected", () => {
    expect(killSwitchLabel(ksp("none", undefined))).toBe("No obligation selected");
  });
});

describe("first unmet prerequisite is named for Execution and Reconciliation before assessment", () => {
  it("names assessment as the first unmet prerequisite before all are assessed", () => {
    expect(authorizationBlockers({ hasSelection: true, allAssessed: false, hasCurrentPayAssessment: false, reviewed: false, killSwitchEngaged: false })[0]).toContain("Assess all");
  });
});
