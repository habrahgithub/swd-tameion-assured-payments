import { raceAssessmentSchema, type RaceAssessment } from "../agent/schema";

export type ProviderMode = "LIVE_AI" | "NOT_LIVE_AI" | "BLOCKED_EXTERNAL";

/** Advisory-only provider/runtime provenance attached to a review snapshot.
 * Never authority-bearing; the real execution/PAE authority lives only in
 * server-derived truth layers (src/domain/payment-control-boundary.ts). */
export interface ProviderRuntimeTruth {
  provider_used: string;
  provider_mode: ProviderMode;
  model_id?: string;
  model_config_version?: string;
  runtime_config_sha256?: string;
}

export interface AssessmentReviewSnapshot {
  obligation_id: string;
  assessment_id: string;
  assessment_hash: string;
  aggregate_version: string;
  decision: "PAY" | "HOLD" | "ESCALATE";
  reasons: string[];
  race?: RaceAssessment;
  provider_truth?: ProviderRuntimeTruth;
}

function isValidProviderMode(value: unknown): value is ProviderMode {
  return value === "LIVE_AI" || value === "NOT_LIVE_AI" || value === "BLOCKED_EXTERNAL";
}

function parseProviderTruth(record: Record<string, unknown>): ProviderRuntimeTruth | undefined {
  const providerUsed = record.provider_used;
  const providerMode = record.provider_mode;
  if (typeof providerUsed !== "string" || providerUsed.length === 0) return undefined;
  if (!isValidProviderMode(providerMode)) return undefined;
  return {
    provider_used: providerUsed,
    provider_mode: providerMode,
    ...(typeof record.model_id === "string" && record.model_id.length > 0 ? { model_id: record.model_id } : {}),
    ...(typeof record.model_config_version === "string" && record.model_config_version.length > 0
      ? { model_config_version: record.model_config_version }
      : {}),
    ...(typeof record.runtime_config_sha256 === "string" && /^[0-9a-f]{64}$/.test(record.runtime_config_sha256)
      ? { runtime_config_sha256: record.runtime_config_sha256 }
      : {}),
  };
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
  const providerTruth = parseProviderTruth(record);
  return {
    obligation_id: record.obligation_id,
    assessment_id: record.assessment_id,
    assessment_hash: record.assessment_hash,
    aggregate_version: record.aggregate_version,
    decision: record.decision as AssessmentReviewSnapshot["decision"],
    reasons: [...record.reasons] as string[],
    ...(parsedRace?.success ? { race: parsedRace.data } : {}),
    ...(providerTruth ? { provider_truth: providerTruth } : {}),
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
    JSON.stringify(current.race) !== JSON.stringify(displayed.race) ||
    JSON.stringify(current.provider_truth) !== JSON.stringify(displayed.provider_truth)
  ) return null;
  return displayed;
}

export function shouldKeepAssessmentRecoveryKey(status: number, code?: string): boolean {
  return status !== 200 && code !== "ASM-001";
}
