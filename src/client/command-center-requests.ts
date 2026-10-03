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
