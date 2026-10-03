export function parseJsonBody(text: string): unknown | null {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export interface PostInterpretation {
  ok: boolean;
  status: number;
  data: unknown | null;
  message: string;
}

import { assessmentReviewSnapshot, type AssessmentReviewSnapshot } from "./assessment-review-snapshot";

export function interpretPostResponse(status: number, text: string): PostInterpretation {
  const data = parseJsonBody(text);
  const ok = status >= 200 && status < 300 && data !== null;
  if (ok) return { ok: true, status, data, message: "" };
  const serverError =
    data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string"
      ? (data as { error: string }).error
      : null;
  return {
    ok: false,
    status,
    data,
    message: serverError ?? `The request did not succeed (HTTP ${status}).`,
  };
}

/** A response may be applied only if it still answers the current selection and
 * the latest request generation. Late responses for a superseded or cleared
 * selection are dropped so they can never render or act on another identity. */
export function isCurrentRequest(args: {
  requestId: number;
  currentRequestId: number;
  requestedSelection: string;
  currentSelection: string;
}): boolean {
  return args.requestId === args.currentRequestId && args.requestedSelection === args.currentSelection && args.currentSelection !== "";
}

/** An action or detail result may mutate state only when it still belongs to the
 * selected obligation. An empty selection never matches. */
export function isSameIdentity(currentSelection: string, requestedSelection: string): boolean {
  return currentSelection !== "" && currentSelection === requestedSelection;
}

/** Generation binding: an action started under an earlier selection generation
 * cannot mutate state, even when the same obligation is selected again (A→B→A). */
export function isCurrentGeneration(requestGeneration: number, currentGeneration: number): boolean {
  return requestGeneration === currentGeneration;
}

/** Maps an assessment receipt into the input the snapshot validator accepts. The
 * same validator gates display and key release, so a receipt that cannot become
 * a snapshot can never release the recovery key. */
export function assessmentReceiptSnapshot(data: unknown): AssessmentReviewSnapshot | null {
  if (!data || typeof data !== "object") return null;
  const r = data as {
    assessment_id?: unknown; aggregate_version?: unknown; assessment_hash?: unknown;
    decision?: { obligation_id?: unknown; decision?: unknown; reasons?: unknown };
    race?: unknown; provider_used?: unknown; provider_mode?: unknown;
    model_id?: unknown; model_config_version?: unknown; runtime_config_sha256?: unknown;
  };
  return assessmentReviewSnapshot({
    obligation_id: r.decision?.obligation_id,
    assessment_id: r.assessment_id,
    assessment_hash: r.assessment_hash,
    aggregate_version: r.aggregate_version,
    decision: r.decision?.decision,
    reasons: r.decision?.reasons,
    race: r.race,
    provider_used: r.provider_used,
    provider_mode: r.provider_mode,
    ...(r.model_id ? { model_id: r.model_id } : {}),
    ...(r.model_config_version ? { model_config_version: r.model_config_version } : {}),
    ...(r.runtime_config_sha256 ? { runtime_config_sha256: r.runtime_config_sha256 } : {}),
  });
}

export function assessmentReceiptIdentity(data: unknown): { obligation_id: string | null; aggregate_version: string | null } {
  const r = (data && typeof data === "object" ? data : {}) as { aggregate_version?: unknown; decision?: { obligation_id?: unknown } };
  return {
    obligation_id: typeof r.decision?.obligation_id === "string" ? r.decision.obligation_id : null,
    aggregate_version: typeof r.aggregate_version === "string" ? r.aggregate_version : null,
  };
}

/** The recovery key is released only when the complete receipt validator succeeds
 * and the receipt is bound to the requested obligation and the expected aggregate
 * version. An explicit terminal ASM-001 is also a release. Everything else keeps
 * the key so an operator retry reuses it. */
export function assessmentKeyDisposition(args: {
  status: number;
  data: unknown | null;
  obligationId: string;
  expectedAggregateVersion: string;
}): "RELEASE" | "RETAIN" {
  if (args.data && typeof args.data === "object" && (args.data as { code?: unknown }).code === "ASM-001") return "RELEASE";
  if (args.status !== 200) return "RETAIN";
  const snapshot = assessmentReceiptSnapshot(args.data);
  if (!snapshot) return "RETAIN";
  const identity = assessmentReceiptIdentity(args.data);
  if (identity.obligation_id !== args.obligationId) return "RETAIN";
  if (args.expectedAggregateVersion === "" || identity.aggregate_version !== args.expectedAggregateVersion) return "RETAIN";
  return "RELEASE";
}
