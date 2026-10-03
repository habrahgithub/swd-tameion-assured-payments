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

import { assessmentKeyDisposition, isSameIdentity } from "../src/client/command-center-requests";

describe("action results apply only to the still-selected obligation identity", () => {
  it("applies when the selection still equals the action's obligation", () => {
    expect(isSameIdentity("OBL-A", "OBL-A")).toBe(true);
  });

  it("drops a late result for A once the selection is B, even at equal aggregate version", () => {
    expect(isSameIdentity("OBL-B", "OBL-A")).toBe(false);
  });

  it("drops a late result after deselection", () => {
    expect(isSameIdentity("", "OBL-A")).toBe(false);
  });
});

describe("assessment recovery key is retained until identity-matched success or explicit terminal rejection", () => {
  const validSuccess = { assessment_id: "ASM-1", decision: { obligation_id: "OBL-A", decision: "HOLD" } };

  it("releases only on a valid, identity-matched 200 receipt", () => {
    expect(assessmentKeyDisposition({ status: 200, data: validSuccess, obligationId: "OBL-A" })).toBe("RELEASE");
  });

  it("retains on an empty 200 body", () => {
    expect(assessmentKeyDisposition({ status: 200, data: null, obligationId: "OBL-A" })).toBe("RETAIN");
  });

  it("retains on an HTML 200 body (parsed as null)", () => {
    expect(assessmentKeyDisposition({ status: 200, data: null, obligationId: "OBL-A" })).toBe("RETAIN");
  });

  it("retains on a structurally invalid 200 JSON body", () => {
    expect(assessmentKeyDisposition({ status: 200, data: { ok: true }, obligationId: "OBL-A" })).toBe("RETAIN");
  });

  it("retains on a 200 receipt bound to a different obligation", () => {
    expect(assessmentKeyDisposition({ status: 200, data: validSuccess, obligationId: "OBL-B" })).toBe("RETAIN");
  });

  it("retains on a network failure (status 0)", () => {
    expect(assessmentKeyDisposition({ status: 0, data: { error: "network" }, obligationId: "OBL-A" })).toBe("RETAIN");
  });

  it("retains on a transient server error", () => {
    expect(assessmentKeyDisposition({ status: 500, data: { error: "boom" }, obligationId: "OBL-A" })).toBe("RETAIN");
  });

  it("releases on the existing explicit terminal rejection ASM-001", () => {
    expect(assessmentKeyDisposition({ status: 409, data: { code: "ASM-001", error: "terminal" }, obligationId: "OBL-A" })).toBe("RELEASE");
  });
});
