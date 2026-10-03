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

/** The assessment recovery key is released only by a valid, identity-matched
 * success receipt or the explicit terminal rejection ASM-001. Every other
 * outcome (empty, HTML, malformed, structurally invalid, mismatched, network,
 * transient server error) retains it so the same request can be retried. */
export function assessmentKeyDisposition(args: {
  status: number;
  data: unknown | null;
  obligationId: string;
}): "RELEASE" | "RETAIN" {
  const data = args.data;
  if (args.status === 200 && data && typeof data === "object") {
    const record = data as { assessment_id?: unknown; decision?: unknown };
    const decision = record.decision as { obligation_id?: unknown } | undefined;
    if (
      typeof record.assessment_id === "string" &&
      decision && typeof decision === "object" &&
      decision.obligation_id === args.obligationId
    ) {
      return "RELEASE";
    }
  }
  if (data && typeof data === "object" && (data as { code?: unknown }).code === "ASM-001") return "RELEASE";
  return "RETAIN";
}
