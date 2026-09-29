import { describe, expect, it } from "vitest";

import { POST } from "../app/api/j0d/preflight/route";
import { j0dPreflightHttpStatus, type J0dPreflightResult } from "../src/j0d-spike/preflight";

const resumeFrom = {
  walletSetId: "2b72f116-16da-591a-9212-5382388a35c4",
  sourceWallet: { id: "9fe9c001-a044-5f9a-8997-165474887952", address: "0x8a5ec63c8bc7a4d4b4f0134e034bda4c24043e95" },
  destinationWallet: { id: "01769e53-cfbe-57aa-ba88-c787b8cba2d3", address: "0x591a1002127b1605d9dbb51348787bbe3014b2b9" },
};

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("J0-D preflight API", () => {
  it("refuses a request without the read-only confirmation literal", async () => {
    const response = await POST(new Request("http://localhost/api/j0d/preflight", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resumeFrom }),
    }));
    expect(response.status).toBe(400);
  });

  it("rejects extra request fields because the preflight request is strict", async () => {
    const response = await POST(new Request("http://localhost/api/j0d/preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "READ_J0D_PREFLIGHT_ONLY", resumeFrom, execute: true }),
    }));
    expect(response.status).toBe(400);
  });

  it("rejects a self-transfer context", async () => {
    const response = await POST(new Request("http://localhost/api/j0d/preflight", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirm: "READ_J0D_PREFLIGHT_ONLY", resumeFrom: { ...resumeFrom, destinationWallet: resumeFrom.sourceWallet } }),
    }));
    expect(response.status).toBe(400);
  });

  it("maps provider/context blockers to explicit HTTP statuses", () => {
    const blocked = (blocker: Extract<J0dPreflightResult, { readiness: "BLOCKED_EXTERNAL" }>["blocker"]): J0dPreflightResult => ({
      dispatch_profile: "J0_CONNECTIVITY_SPIKE",
      action: "READ_ONLY_PREFLIGHT",
      readiness: "BLOCKED_EXTERNAL",
      blocker,
      message: "blocked",
      captured_at: "2026-09-29T06:10:00.000Z",
    });

    expect(j0dPreflightHttpStatus(blocked("CIRCLE_NOT_CONFIGURED"))).toBe(503);
    expect(j0dPreflightHttpStatus(blocked("SOURCE_WALLET_CONTEXT_MISMATCH"))).toBe(409);
    expect(j0dPreflightHttpStatus(blocked("DESTINATION_WALLET_NOT_LIVE"))).toBe(409);
    expect(j0dPreflightHttpStatus(blocked("PROVIDER_QUERY_FAILED"))).toBe(502);
    expect(j0dPreflightHttpStatus(blocked("INVALID_PROVIDER_TOKEN"))).toBe(422);
    expect(j0dPreflightHttpStatus(blocked("INVALID_FEE_ESTIMATE"))).toBe(422);
  });


  it("fails closed when the runtime has no Circle credentials", async () => {
    const apiKey = process.env.CIRCLE_API_KEY;
    const entitySecret = process.env.CIRCLE_ENTITY_SECRET;
    delete process.env.CIRCLE_API_KEY;
    delete process.env.CIRCLE_ENTITY_SECRET;
    try {
      const response = await POST(new Request("http://localhost/api/j0d/preflight", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "READ_J0D_PREFLIGHT_ONLY", resumeFrom }),
      }));
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.result.readiness).toBe("BLOCKED_EXTERNAL");
      expect(body.result.blocker).toBe("CIRCLE_NOT_CONFIGURED");
    } finally {
      restoreEnv("CIRCLE_API_KEY", apiKey);
      restoreEnv("CIRCLE_ENTITY_SECRET", entitySecret);
    }
  });
});
