import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { providerAssess } = vi.hoisted(() => ({ providerAssess: vi.fn() }));

vi.mock("../src/agent/ai-provider", () => ({
  NvidiaProvider: class {
    readonly runtimeIdentity = {
      provider_name: "NVIDIA Build",
      model_id: "nvidia/nemotron-3-super-120b-a12b",
      model_config_version: "p0-nvidia-nemotron3super-v1",
      runtime_config_sha256: "a".repeat(64),
    };
    assess = providerAssess;
  },
}));

import {
  DELETE,
  GET,
  HEAD,
  OPTIONS,
  PATCH,
  POST,
  PUT,
} from "../app/api/internal/j1d/capability-smoke/route";
import {
  buildJ1dSyntheticContext,
  J1D_SYNTHETIC_OBLIGATION_ID,
  runJ1dCapabilitySmoke,
} from "../src/agent/j1d-capability-smoke";
import { financeAgentContextSchema } from "../src/agent/schema";

const secret = "j1d-smoke-test-secret-0123456789abcdef";
const token = "j1d-smoke-test-token-0123456789abcdef";
const originalFetch = globalThis.fetch;
const runtimeIdentity = {
  provider_name: "NVIDIA Build",
  model_id: "nvidia/nemotron-3-super-120b-a12b",
  model_config_version: "p0-nvidia-nemotron3super-v1",
  runtime_config_sha256: "a".repeat(64),
};

function recommendation(overrides: Record<string, unknown> = {}) {
  return {
    obligation_id: J1D_SYNTHETIC_OBLIGATION_ID,
    decision: "PAY",
    finding_codes: [],
    evidence_ids: [],
    uncertainty_signal: false,
    explanation: "Synthetic proposal only.",
    ...overrides,
  };
}

function request(body: string, auth: string | null = `Bearer ${secret}`): Request {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (auth !== null) headers.set("Authorization", auth);
  return new Request("https://example.test/api/internal/j1d/capability-smoke", {
    method: "POST",
    headers,
    body,
  });
}

async function json(response: Response): Promise<Record<string, any>> {
  return response.json() as Promise<Record<string, any>>;
}

describe("J1-D protected synthetic NVIDIA capability smoke", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("J1D_SMOKE_ENABLED", "true");
    vi.stubEnv("J1D_SMOKE_SECRET", secret);
    providerAssess.mockReset();
    providerAssess.mockResolvedValue(recommendation());
    globalThis.fetch = vi.fn() as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    globalThis.fetch = originalFetch;
  });

  it("builds a fixed schema-valid context with no source evidence or real obligation data", () => {
    const context = buildJ1dSyntheticContext();

    expect(financeAgentContextSchema.parse(context)).toEqual(context);
    expect(context).toMatchObject({
      obligation_id: J1D_SYNTHETIC_OBLIGATION_ID,
      aggregate_version: "0",
      amount: "0.00",
      currency: "USD",
      service_category: "SYNTHETIC_CAPABILITY_TEST",
      evidence_ids: [],
      evidence_present: false,
      destination_ready: false,
      destination_status: "SYNTHETIC_NOT_A_REAL_DESTINATION",
    });
    expect(JSON.stringify(context)).not.toContain("OBL-J0C");
  });

  it.each([
    ["production deployment", { VERCEL_ENV: "production", J1D_SMOKE_ENABLED: "true", J1D_SMOKE_SECRET: secret }],
    ["non-preview deployment", { VERCEL_ENV: "development", J1D_SMOKE_ENABLED: "true", J1D_SMOKE_SECRET: secret }],
    ["disabled flag", { VERCEL_ENV: "preview", J1D_SMOKE_ENABLED: "false", J1D_SMOKE_SECRET: secret }],
    ["missing secret", { VERCEL_ENV: "preview", J1D_SMOKE_ENABLED: "true", J1D_SMOKE_SECRET: undefined }],
    ["weak secret", { VERCEL_ENV: "preview", J1D_SMOKE_ENABLED: "true", J1D_SMOKE_SECRET: "too-short" }],
  ])("denies before provider invocation for %s", async (_label, env) => {
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) vi.stubEnv(name, "");
      else vi.stubEnv(name, value);
    }

    const response = await POST(request(JSON.stringify({ confirm: "RUN_SYNTHETIC_NVIDIA_CAPABILITY_SMOKE" })));

    expect(response.status).toBe(env.VERCEL_ENV === "preview" ? 503 : 404);
    expect(providerAssess).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects missing, incorrect, and malformed bearer credentials before the provider", async () => {
    for (const auth of [null, "Bearer incorrect-secret", "Basic " + token, `Bearer ${token}`]) {
      const response = await POST(request(
        JSON.stringify({ confirm: "RUN_SYNTHETIC_NVIDIA_CAPABILITY_SMOKE" }),
        auth,
      ));
      expect(response.status).toBe(401);
    }

    expect(providerAssess).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON, extra fields, caller prompts, and caller obligation IDs before the provider", async () => {
    const malformed = await POST(request("{"));
    const extra = await POST(request(JSON.stringify({
      confirm: "RUN_SYNTHETIC_NVIDIA_CAPABILITY_SMOKE",
      prompt: "caller prompt",
    })));
    const callerId = await POST(request(JSON.stringify({
      confirm: "RUN_SYNTHETIC_NVIDIA_CAPABILITY_SMOKE",
      obligation_id: "CALLER-SUPPLIED-ID",
    })));

    expect(malformed.status).toBe(400);
    expect(extra.status).toBe(400);
    expect(callerId.status).toBe(400);
    expect(providerAssess).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["GET", GET],
    ["HEAD", HEAD],
    ["PUT", PUT],
    ["PATCH", PATCH],
    ["DELETE", DELETE],
    ["OPTIONS", OPTIONS],
  ])(
    "rejects %s before provider invocation",
    async (_method, handler) => {
      const response = await handler(new Request("https://example.test/api/internal/j1d/capability-smoke"));
      expect(response.status).toBe(405);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(providerAssess).not.toHaveBeenCalled();
    },
  );

  it("calls the provider once with the fixed context and marks even PAY as non-authoritative", async () => {
    const response = await POST(request(JSON.stringify({ confirm: "RUN_SYNTHETIC_NVIDIA_CAPABILITY_SMOKE" })));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(providerAssess).toHaveBeenCalledTimes(1);
    expect(providerAssess).toHaveBeenCalledWith(buildJ1dSyntheticContext());
    expect(body).toEqual({
      status: "LIVE_AI",
      capability: "SYNTHETIC_PREVIEW_ONLY",
      authoritative: false,
      proposal: {
        ...recommendation(),
        authority: "NON_AUTHORITATIVE",
      },
      runtime_identity: runtimeIdentity,
    });
    expect(body).not.toHaveProperty("authorization");
    expect(body).not.toHaveProperty("approved");
    expect(body).not.toHaveProperty("execute");
    expect(body).not.toHaveProperty("intent");
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong synthetic ID", recommendation({ obligation_id: "CALLER-SUPPLIED-ID" })],
    ["schema expansion", recommendation({ authorization: true })],
    ["malformed proposal", { decision: "PAY" }],
  ])("blocks %s output after exactly one provider call", async (_case, modelOutput) => {
    providerAssess.mockResolvedValueOnce(modelOutput);
    const response = await POST(request(JSON.stringify({ confirm: "RUN_SYNTHETIC_NVIDIA_CAPABILITY_SMOKE" })));

    expect(response.status).toBe(502);
    expect(await json(response)).toEqual({ status: "BLOCKED", code: "MODEL_OUTPUT_INVALID" });
    expect(providerAssess).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["provider auth", new Error("NVIDIA API returned HTTP 401"), "PROVIDER_AUTH"],
    ["rate limit", new Error("NVIDIA API returned HTTP 429"), "PROVIDER_RATE_LIMITED"],
    ["timeout", new Error("NVIDIA transport failed: operation timed out"), "PROVIDER_TIMEOUT"],
    ["refusal", new Error("NVIDIA provider refused the assessment"), "PROVIDER_REFUSED"],
    ["malformed provider response", new Error("NVIDIA API response content was not valid JSON"), "PROVIDER_RESPONSE_INVALID"],
    ["unknown provider error", new Error("private provider response"), "PROVIDER_UNAVAILABLE"],
  ])("returns a typed, sanitized blocker for %s", async (_case, error, code) => {
    providerAssess.mockRejectedValueOnce(error);
    const response = await POST(request(JSON.stringify({ confirm: "RUN_SYNTHETIC_NVIDIA_CAPABILITY_SMOKE" })));

    expect(response.status).toBe(502);
    const body = await json(response);
    expect(body).toEqual({ status: "BLOCKED", code });
    expect(providerAssess).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(body)).not.toContain("private provider response");
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("does not expose an output unless the direct helper sees an exact synthetic ID", async () => {
    const assess = vi.fn().mockResolvedValue(recommendation({ obligation_id: "OTHER" }));
    const result = await runJ1dCapabilitySmoke({ assess, runtimeIdentity });

    expect(result).toEqual({ status: "BLOCKED", code: "MODEL_OUTPUT_INVALID" });
    expect(assess).toHaveBeenCalledTimes(1);
    expect(assess).toHaveBeenCalledWith(buildJ1dSyntheticContext());
  });
});
