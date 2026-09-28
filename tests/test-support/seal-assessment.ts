import type { AuthorityStore } from "../../src/authority/aggregate";
import type { DurableAssessmentRecord } from "../../src/domain/schemas";

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
  const record: DurableAssessmentRecord = {
    assessment_id: `ASM-TEST-${counter}`,
    organization_id: organizationId,
    obligation_id: obligationId,
    aggregate_version: String(aggregateVersion),
    decision: "PAY",
    reasons: ["Test fixture: complete evidence and confirmed business purpose."],
    evidence_ids: ["EVID-TEST-1"],
    missing_evidence: [],
    uncertainty_signal: false,
    provider_name: "test-fixture-provider",
    provider_mode: "NOT_LIVE_AI",
    assessed_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
  return store.sealAssessment(record);
}
