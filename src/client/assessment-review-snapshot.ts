import { raceAssessmentSchema, type RaceAssessment } from "../agent/schema";

export interface AssessmentReviewSnapshot {
  obligation_id: string;
  assessment_id: string;
  assessment_hash: string;
  aggregate_version: string;
  decision: "PAY" | "HOLD" | "ESCALATE";
  reasons: string[];
  race?: RaceAssessment;
}

export function assessmentReviewSnapshot(value: unknown): AssessmentReviewSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (
    typeof record.obligation_id !== "string" || record.obligation_id.length === 0 ||
    typeof record.assessment_id !== "string" || record.assessment_id.length === 0 ||
    typeof record.assessment_hash !== "string" || !/^[0-9a-f]{64}$/.test(record.assessment_hash) ||
    typeof record.aggregate_version !== "string" || !/^[1-9][0-9]*$/.test(record.aggregate_version) ||
    !["PAY", "HOLD", "ESCALATE"].includes(String(record.decision)) ||
    !Array.isArray(record.reasons) || record.reasons.length === 0 || record.reasons.some((reason) => typeof reason !== "string")
  ) return null;
  const parsedRace = record.race === undefined ? undefined : raceAssessmentSchema.safeParse(record.race);
  if (parsedRace && !parsedRace.success) return null;
  return {
    obligation_id: record.obligation_id,
    assessment_id: record.assessment_id,
    assessment_hash: record.assessment_hash,
    aggregate_version: record.aggregate_version,
    decision: record.decision as AssessmentReviewSnapshot["decision"],
    reasons: [...record.reasons] as string[],
    ...(parsedRace?.success ? { race: parsedRace.data } : {}),
  };
}

export function currentReviewedAssessment(
  displayed: AssessmentReviewSnapshot | null,
  current: AssessmentReviewSnapshot | null,
  selectedObligationId: string,
  aggregateVersion: number | undefined,
): AssessmentReviewSnapshot | null {
  if (!displayed || !current || !displayed.race || !current.race || aggregateVersion === undefined) return null;
  if (
    displayed.obligation_id !== selectedObligationId ||
    displayed.aggregate_version !== String(aggregateVersion) ||
    current.obligation_id !== displayed.obligation_id ||
    current.assessment_id !== displayed.assessment_id ||
    current.assessment_hash !== displayed.assessment_hash ||
    current.aggregate_version !== displayed.aggregate_version ||
    current.decision !== displayed.decision ||
    current.reasons.length !== displayed.reasons.length ||
    current.reasons.some((reason, index) => reason !== displayed.reasons[index]) ||
    JSON.stringify(current.race) !== JSON.stringify(displayed.race)
  ) return null;
  return displayed;
}

export function shouldKeepAssessmentRecoveryKey(status: number, code?: string): boolean {
  return status !== 200 && code !== "ASM-001";
}
