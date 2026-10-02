import type { AuthorityStore } from "../../src/authority/aggregate";
import type { DurableAssessmentRecord } from "../../src/domain/schemas";
import { remediationFor } from "../../src/agent/finding-catalog";
import type { RaceAssessment } from "../../src/agent/schema";

let counter = 0;

/**
 * Test-only helper: seals a minimal, valid DurableAssessmentRecord for a
 * fixture, mirroring what app/api/obligations/[id]/assess/route.ts does in
 * production. Kept here rather than duplicated per test file since most of
 * the P0 execution/authorization test suites need a sealed PAY assessment
 * as a precondition and don't otherwise care about assessment content.
 */
export function sealTestAssessment(
  store: AuthorityStore,
  organizationId: string,
  obligationId: string,
  aggregateVersion: number,
  overrides: Partial<DurableAssessmentRecord> = {},
): { record: DurableAssessmentRecord; assessment_hash: string } {
  counter += 1;
  const decision = overrides.decision ?? "PAY";
  const code: "MODEL_OUTPUT_INVALID" | "OTHER_REQUIRES_HUMAN_REVIEW" | null = decision === "PAY" ? null : decision === "HOLD" ? "MODEL_OUTPUT_INVALID" : "OTHER_REQUIRES_HUMAN_REVIEW";

  // F1: derive authoritative facts from the aggregate's source truth so that
  // authorize() can verify the assessment matches the aggregate's source.
  const aggregate = store.get(organizationId, obligationId);
  const sourceAmount = aggregate?.source_amount ?? "10.00";
  const sourceCurrency = aggregate?.source_currency ?? "USD";

  const defaultRace: RaceAssessment = {
    result: {
      decision,
      decision_summary: "Test fixture: application-owned decision evidence.",
      validated_findings: code ? [{ code, severity: code === "OTHER_REQUIRES_HUMAN_REVIEW" ? "ESCALATE" : "HOLD", reason: "Test fixture finding." }] : [],
    },
    action_taken: { summary: "Test fixture checks completed.", checks: ["Evidence and readiness checks completed."] },
    caveats: {
      missing_context: code ? [code === "OTHER_REQUIRES_HUMAN_REVIEW" ? "HUMAN_DECISION" : "PROVIDER_RESPONSE"] : [],
      uncertainty_signal: decision !== "PAY",
      model_proposed_findings: [],
      model_proposed_findings_authority: "NON_AUTHORITATIVE",
      model_explanation: "Test fixture.",
      model_explanation_authority: "NON_AUTHORITATIVE" as const,
    },
    evidence: {
      evidence_ids: ["EVID-TEST-1"],
      authoritative_facts: {
        obligation_id: obligationId,
        aggregate_version: String(aggregateVersion),
        amount: sourceAmount,
        currency: sourceCurrency as "USD",
        due_date: "2026-01-01",
        due_date_status: "STATED_ON_SOURCE" as const,
        due_date_position: "FUTURE" as const,
        as_of_date: "2025-01-01",
        state_at_event_baseline: "OUTSTANDING" as const,
        business_purpose_confirmed: true,
        source_evidence_present: true,
        destination_status: "READY",
      },
    },
    remediation: code ? [remediationFor(code)] : [],
    prompt_identity: { version: "test-care-v1", sha256: "a".repeat(64) },
  };
  const record: DurableAssessmentRecord = {
    assessment_id: `ASM-TEST-${counter}`,
    organization_id: organizationId,
    obligation_id: obligationId,
    aggregate_version: String(aggregateVersion),
    decision,
    reasons: ["Test fixture: complete evidence and confirmed business purpose."],
    evidence_ids: ["EVID-TEST-1"],
    missing_evidence: [],
    uncertainty_signal: false,
    race: defaultRace,
    provider_name: "test-fixture-provider",
    provider_mode: "NOT_LIVE_AI",
    assessed_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  return store.sealAssessment(record);
}

export function currentAssessmentReview(store: AuthorityStore, organizationId: string, obligationId: string) {
  const assessment = store.getCurrentAssessment(organizationId, obligationId);
  if (!assessment) throw new Error(`No current assessment exists for ${obligationId}.`);
  return {
    reviewedAssessmentId: assessment.record.assessment_id,
    reviewedAssessmentHash: assessment.hash,
  };
}
