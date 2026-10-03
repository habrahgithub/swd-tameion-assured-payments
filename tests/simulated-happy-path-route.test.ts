import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { POST } from "../app/api/internal/demo/simulated-happy-path/route";

const SAVED = { VERCEL_ENV: process.env.VERCEL_ENV, PAE_KEY: process.env.PAE_SIGNING_KEY_HEX_54414D45494F4E2D44454D4F2D53494D554C415445442D48415050592D4B45592D31_PEM };

function post(body: unknown, raw?: string) {
  return POST(new Request("http://localhost/api/internal/demo/simulated-happy-path", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  }));
}

describe("simulated happy-path route: isolated, non-economic, typed negatives", () => {
  beforeEach(() => {
    delete process.env.VERCEL_ENV;
  });

  afterEach(() => {
    if (SAVED.VERCEL_ENV === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = SAVED.VERCEL_ENV;
    if (SAVED.PAE_KEY === undefined) delete process.env.PAE_SIGNING_KEY_HEX_54414D45494F4E2D44454D4F2D53494D554C415445442D48415050592D4B45592D31_PEM;
    else process.env.PAE_SIGNING_KEY_HEX_54414D45494F4E2D44454D4F2D53494D554C415445442D48415050592D4B45592D31_PEM = SAVED.PAE_KEY;
  });

  it("returns a fake happy path with one provider submission and a blocked variant with zero", async () => {
    const response = await post({ confirm: "RUN_SIMULATED_HAPPY_PATH" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.status).toBe("PASS");
    expect(body.provider_label).toBe("FAKE_TESTNET_ADAPTER");
    expect(body.vendor_notice).toBe("NOT_VENDOR_PAYMENT");
    expect(body.happy_path.provider_submission_count).toBe(1);
    expect(body.blocked_variant.blocked).toBe(true);
    expect(body.blocked_variant.provider_submission_count).toBe(0);
  });

  it("refuses a missing or wrong confirmation with a typed 400 before any execution", async () => {
    const response = await post({});
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("MALFORMED_REQUEST");
  });

  it("refuses non-JSON bodies with the same typed 400", async () => {
    const response = await post(undefined, "<html>not json</html>");
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("MALFORMED_REQUEST");
  });

  it("returns a typed 503 for the dedicated simulated key when it is unavailable in Preview, without fabricating a key", async () => {
    process.env.VERCEL_ENV = "preview";
    delete process.env.PAE_SIGNING_KEY_HEX_54414D45494F4E2D44454D4F2D53494D554C415445442D48415050592D4B45592D31_PEM;
    const response = await post({ confirm: "RUN_SIMULATED_HAPPY_PATH" });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "BLOCKED", code: "SIGNING_KEY_UNAVAILABLE" });
  });

  it("is blocked as production with a 404 and never runs the pipeline", async () => {
    process.env.VERCEL_ENV = "production";
    const response = await post({ confirm: "RUN_SIMULATED_HAPPY_PATH" });
    expect(response.status).toBe(404);
    expect((await response.json()).code).toBe("PRODUCTION_BLOCKED");
  });
});
