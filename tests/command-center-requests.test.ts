import { describe, expect, it } from "vitest";

import {
  interpretPostResponse,
  isCurrentRequest,
  parseJsonBody,
} from "../src/client/command-center-requests";

describe("command-center request safety", () => {
  it("applies a detail response only when its selection and generation are still current", () => {
    expect(isCurrentRequest({ requestId: 3, currentRequestId: 3, requestedSelection: "A", currentSelection: "A" })).toBe(true);
  });

  it("drops a late response for a superseded selection (A→B reversed resolution)", () => {
    expect(isCurrentRequest({ requestId: 1, currentRequestId: 2, requestedSelection: "A", currentSelection: "B" })).toBe(false);
  });

  it("drops a response after deselection", () => {
    expect(isCurrentRequest({ requestId: 4, currentRequestId: 5, requestedSelection: "A", currentSelection: "" })).toBe(false);
  });
});

describe("command-center POST recovery", () => {
  it("never throws on an empty body (upstream 500 with no body)", () => {
    const result = interpretPostResponse(500, "");
    expect(result.ok).toBe(false);
    expect(result.status).toBe(500);
    expect(result.data).toBeNull();
    expect(result.message).toContain("HTTP 500");
  });

  it("treats an HTML 401 login page as a typed refusal, not parsed JSON", () => {
    const result = interpretPostResponse(401, "<!DOCTYPE html><html>Sign in</html>");
    expect(result.ok).toBe(false);
    expect(result.data).toBeNull();
    expect(result.message).not.toContain("<!DOCTYPE");
  });

  it("surfaces a server-supplied error string from a JSON refusal", () => {
    const result = interpretPostResponse(409, JSON.stringify({ error: "Aggregate changed." }));
    expect(result).toMatchObject({ ok: false, status: 409, message: "Aggregate changed." });
  });

  it("reports a successful JSON body as ok without altering it", () => {
    const result = interpretPostResponse(200, JSON.stringify({ status: "PASS" }));
    expect(result).toMatchObject({ ok: true, status: 200, data: { status: "PASS" } });
  });

  it("parseJsonBody returns null for malformed input instead of throwing", () => {
    expect(parseJsonBody("{not json")).toBeNull();
    expect(parseJsonBody("")).toBeNull();
  });
});
