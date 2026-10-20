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

/** Presentation evidence only. GenuineAssessmentState emits this exact response
 * before creating a NEW reservation; existing keys are resolved first. No other
 * denial, timeout or status-not-found establishes non-submission. */
export function isAssessmentHistoryLimitRejection(result:{status:number;data:unknown}):boolean {
  return result.status===409&&result.data!==null&&typeof result.data==='object'&&!Array.isArray(result.data)&&
    Object.keys(result.data).length===1&&(result.data as {code?:unknown}).code==='GENUINE_ASSESSMENT_HISTORY_LIMIT';
}

/** Do not surface raw error/provider bodies. These are existing public typed
 * read failures; an unknown code or a transport failure establishes no cause. */
export function observedReadFailure(status:number,body:unknown):string {
  const code=body&&typeof body==='object'&&!Array.isArray(body)?(body as {code?:unknown}).code:undefined;
  const safe=typeof code==='string'&&['AUTH_UNAVAILABLE','SESSION_REQUIRED','SOURCE_BINDING_CHANGED','STATE_UNAVAILABLE',
    'OPERATOR_SOURCE_UNAVAILABLE','FINANCIAL_AUTHORITY_UNAVAILABLE','ORIGIN_REJECTED','INGRESS_UNVERIFIED','SRC-001'].includes(code)?code:null;
  return `Obligations unavailable (HTTP ${status}${safe?`; ${safe}`:''}).`;
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

/** The execute route never returns a permission to retry after effects start.
 * Treat every unrecognised/transport/success response as reconciliation-only.
 * These narrow status/code pairs are emitted strictly before effectsStarted in
 * createFinancialHandlers (or its initial CSRF/body/method validation). Dynamic
 * session/requester/worker failures are deliberately excluded: they can occur
 * during later revalidation. This is presentation containment, not authority. */
export function executionResponseNeedsReconciliation(result: { status: number; data: unknown }): boolean {
  if (result.status < 400 || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) return true;
  const reply = result.data as Record<string, unknown>;
  // Production pre-effect refusals are exactly {code}. Extra fields cannot
  // contradict or masquerade as that contract and release an uncertainty lock.
  if (Object.keys(reply).length !== 1) return true;
  switch (reply.code) {
    // The read-only wallet boundary precedes effectsStarted; later failures are
    // wrapped as OUTCOME_UNVERIFIED. This never grants financial authority.
    case "BALANCE_NOT_VERIFIED": return result.status !== 503 || !Object.hasOwn(reply, "code");
    case "BODY_REJECTED": return ![400, 408, 413].includes(result.status);
    case "CONTENT_TYPE_REJECTED": return result.status !== 415;
    case "METHOD_NOT_ALLOWED": return result.status !== 405;
    case "CSRF_REJECTED":
    case "CONTROLLED_SOURCE_REQUIRED":
    case "EXACT_PACKET_NOT_APPROVED": return result.status !== 403;
    case "CURRENT_PAE_REQUIRED": return result.status !== 409;
    default: return true;
  }
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
  if (!data || typeof data !== "object" || (data as {code?:unknown}).code === "ASM-001") return null;
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
 * version. Error codes, including ASM-001 after provider work, cannot prove
 * non-submission. Everything else retains the key for read-only reconciliation. */
export function assessmentKeyDisposition(args: {
  status: number;
  data: unknown | null;
  obligationId: string;
  expectedAggregateVersion: string;
}): "RELEASE" | "RETAIN" {
  if (args.status !== 200) return "RETAIN";
  const snapshot = assessmentReceiptSnapshot(args.data);
  if (!snapshot) return "RETAIN";
  const identity = assessmentReceiptIdentity(args.data);
  if (identity.obligation_id !== args.obligationId) return "RETAIN";
  if (args.expectedAggregateVersion === "" || identity.aggregate_version !== args.expectedAggregateVersion) return "RETAIN";
  return "RELEASE";
}


/** Presentation hint from existing authenticated assessment replies only.
 * This reference is not independently bound to the current source/version and
 * must never replace the attempted key or authorize any recovery request. */
export function assessmentEarlierReference(result: {status:number;data:unknown}, attemptedKey:string): string | null {
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if(result.status!==409||!uuid.test(attemptedKey)||!result.data||typeof result.data!=='object'||Array.isArray(result.data))return null;
  const reply=result.data as Record<string,unknown>;
  if(typeof reply.error!=='string'||!reply.error.length||typeof reply.idempotency_key!=='string'||!uuid.test(reply.idempotency_key)||reply.idempotency_key===attemptedKey)return null;
  if(reply.code==='ASM-OPERATION-UNRESOLVED'){
    if(Object.keys(reply).some(key=>!['code','error','idempotency_key','operation_status'].includes(key)))return null;
    if(reply.operation_status!==undefined&&(typeof reply.operation_status!=='string'||!['RESERVED','PROVIDER_RESULT_DURABLE','UNKNOWN'].includes(reply.operation_status)))return null;
  }else if(reply.code==='ASM-UNKNOWN'){
    if(reply.status!=='UNKNOWN'||Object.keys(reply).some(key=>!['code','error','idempotency_key','status'].includes(key)))return null;
  }else return null;
  return reply.idempotency_key;
}
