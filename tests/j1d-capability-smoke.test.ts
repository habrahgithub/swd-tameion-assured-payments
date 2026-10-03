import { describe as describeEval, expect as expectEval, it as itEval } from "vitest";

import type { AiProvider } from "../src/agent/ai-provider";
import {
  SYNTHETIC_EVALUATION_CASE_IDS,
  buildSyntheticEvaluationContext,
  runSyntheticEvaluation,
} from "../src/agent/j1d-capability-smoke";

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

function fakeProvider(decide: (ctx: { obligation_id: string; evidence_ids: string[] }) => unknown): AiProvider & { calls: number } {
  const provider = {
    calls: 0,
    runtimeIdentity: { provider_used: "FAKE_SYNTHETIC", provider_mode: "NOT_LIVE_AI", model_id: "fake", model_config_version: "t", runtime_config_sha256: "0".repeat(64) },
    async assess(ctx: { obligation_id: string; evidence_ids: string[] }) {
      provider.calls += 1;
      return decide(ctx);
    },
  };
  return provider as unknown as AiProvider & { calls: number };
}

describeEval("synthetic evaluation cases are fixed, schema-valid and single-factor", () => {
  itEval("defines exactly the four admitted cases", () => {
    expectEval([...SYNTHETIC_EVALUATION_CASE_IDS]).toEqual(["POSITIVE_COMPLETE", "NEGATIVE_TRUST", "NEGATIVE_DATE", "NEGATIVE_EVIDENCE"]);
  });

  itEval("builds every case through the strict context schema with explicit synthetic provenance", () => {
    for (const id of SYNTHETIC_EVALUATION_CASE_IDS) {
      const ctx = buildSyntheticEvaluationContext(id);
      expectEval(financeAgentContextSchema.safeParse(ctx).success).toBe(true);
      expectEval(ctx.destination_readiness_source === "SYNTHETIC_EVALUATION_FIXTURE" || ctx.destination_readiness_source === "UNVERIFIED_CURRENT_TRUST").toBe(true);
      expectEval(ctx.obligation_id.startsWith("SYNTHETIC-EVAL-")).toBe(true);
    }
  });

  itEval("each negative differs from the positive on exactly one trust, date or evidence factor", () => {
    const positive = buildSyntheticEvaluationContext("POSITIVE_COMPLETE");
    expectEval(positive.destination_ready && positive.evidence_present && positive.due_date_position === "FUTURE").toBe(true);

    const trust = buildSyntheticEvaluationContext("NEGATIVE_TRUST");
    expectEval(trust.destination_ready).toBe(false);
    expectEval(trust.evidence_present).toBe(positive.evidence_present);
    expectEval(trust.due_date_position).toBe(positive.due_date_position);

    const date = buildSyntheticEvaluationContext("NEGATIVE_DATE");
    expectEval(date.due_date_position).toBe("NOT_STATED");
    expectEval(date.destination_ready).toBe(positive.destination_ready);
    expectEval(date.evidence_present).toBe(positive.evidence_present);

    const evidence = buildSyntheticEvaluationContext("NEGATIVE_EVIDENCE");
    expectEval(evidence.evidence_present).toBe(false);
    expectEval(evidence.evidence_ids).toEqual([]);
    expectEval(evidence.destination_ready).toBe(positive.destination_ready);
    expectEval(evidence.due_date_position).toBe(positive.due_date_position);
  });
});

describeEval("synthetic evaluation harness calls the real provider path and never forces PAY", () => {
  itEval("retains the model-chosen outcome and passes when it matches the fixed expectation", async () => {
    const provider = fakeProvider((ctx) => ({
      obligation_id: ctx.obligation_id,
      decision: ctx.obligation_id.includes("POSITIVE") ? "PAY" : "HOLD",
      finding_codes: [],
      evidence_ids: ctx.obligation_id.includes("POSITIVE") ? ["SYN-EVD-001"] : [],
      uncertainty_signal: false,
      explanation: "synthetic fake",
    }));
    const result = await runSyntheticEvaluation(provider);
    expectEval(result.status).toBe("EVALUATED");
    if (result.status !== "EVALUATED") return;
    expectEval(provider.calls).toBe(4);
    expectEval(result.outcomes.every((o) => o.expectation_met)).toBe(true);
  });

  itEval("records an unexpected outcome as a failure rather than passing it", async () => {
    const provider = fakeProvider((ctx) => ({
      obligation_id: ctx.obligation_id,
      decision: "HOLD",
      finding_codes: [],
      evidence_ids: [],
      uncertainty_signal: false,
      explanation: "synthetic fake",
    }));
    const result = await runSyntheticEvaluation(provider);
    if (result.status !== "EVALUATED") throw new Error("expected evaluation");
    const positive = result.outcomes.find((o) => o.case_id === "POSITIVE_COMPLETE");
    expectEval(positive?.expectation_met).toBe(false);
    expectEval(result.failures).toBeGreaterThan(0);
  });

  itEval("rejects an unsupported proposal through the normalizer, never as PAY", async () => {
    const provider = fakeProvider((ctx: { obligation_id: string; evidence_ids: string[] }) => ({
      obligation_id: ctx.obligation_id,
      decision: "PAY",
      finding_codes: ["DUPLICATE_SOURCE"],
      evidence_ids: ctx.evidence_ids,
      uncertainty_signal: false,
      explanation: "unsupported duplicate claim",
    }));
    const result = await runSyntheticEvaluation(provider);
    if (result.status !== "EVALUATED") throw new Error("expected evaluation");
    for (const outcome of result.outcomes) {
      expectEval(outcome.decision).not.toBe("PAY");
    }
    // A PAY with no supplied evidence is rejected earlier by SOURCE_EVIDENCE_MISSING;
    // every case that reaches the unsupported-finding check must be MODEL_OUTPUT_INVALID.
    const reachedUnsupportedCheck = result.outcomes.filter((o) => o.case_id !== "NEGATIVE_EVIDENCE");
    for (const outcome of reachedUnsupportedCheck) {
      expectEval(outcome.codes).toContain("MODEL_OUTPUT_INVALID");
    }
  });

  itEval("stops the batch on an authentication boundary with a typed blocker and no retry", async () => {
    const provider = fakeProvider(() => {
      throw new Error("NVIDIA request failed with HTTP 401");
    });
    const result = await runSyntheticEvaluation(provider);
    expectEval(result).toEqual({ status: "BLOCKED", code: "PROVIDER_AUTH" });
    expectEval(provider.calls).toBe(1);
  });
});

describe("capability-smoke route: batch confirmation is gated by the same Preview, enablement and auth boundaries", () => {
  const ROUTE = "../app/api/internal/j1d/capability-smoke/route";
  const ENV_KEYS = ["VERCEL_ENV", "J1D_SMOKE_ENABLED", "J1D_SMOKE_SECRET"] as const;
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
    for (const k of ENV_KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("refuses the batch outside Preview with a 404 and never reaches the provider", async () => {
    const { POST } = await import(ROUTE);
    const response = await POST(new Request("http://x/", { method: "POST", body: JSON.stringify({ confirm: "RUN_SYNTHETIC_NVIDIA_EVALUATION_BATCH" }) }));
    expect(response.status).toBe(404);
    expect(providerAssess).not.toHaveBeenCalled();
  });

  it("returns a typed configuration blocker for the batch when enablement or secret is missing in Preview", async () => {
    process.env.VERCEL_ENV = "preview";
    const { POST } = await import(ROUTE);
    const response = await POST(new Request("http://x/", { method: "POST", headers: { authorization: "Bearer x" }, body: JSON.stringify({ confirm: "RUN_SYNTHETIC_NVIDIA_EVALUATION_BATCH" }) }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "BLOCKED", code: "BLOCKED_CONFIG" });
    expect(providerAssess).not.toHaveBeenCalled();
  });

  it("rejects an unknown confirmation before any provider call", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.J1D_SMOKE_ENABLED = "true";
    process.env.J1D_SMOKE_SECRET = "s".repeat(40);
    const { POST } = await import(ROUTE);
    const response = await POST(new Request("http://x/", { method: "POST", headers: { authorization: `Bearer ${"s".repeat(40)}` }, body: JSON.stringify({ confirm: "RUN_ANYTHING" }) }));
    expect(response.status).toBe(400);
    expect(providerAssess).not.toHaveBeenCalled();
  });
});
