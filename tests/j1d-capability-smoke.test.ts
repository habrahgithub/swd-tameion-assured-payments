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

  itEval("each variant differs from the positive on exactly one trust, date or evidence factor", () => {
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

describeEval("synthetic evaluation grades model usefulness and deterministic safety separately", () => {
  const rawFor = (ctx: { obligation_id: string; evidence_ids: string[] }, decision: string, codes: string[] = []) => ({
    obligation_id: ctx.obligation_id,
    decision,
    finding_codes: codes,
    evidence_ids: decision === "PAY" ? ctx.evidence_ids : [],
    uncertainty_signal: false,
    explanation: "synthetic fake",
  });

  itEval("passes when the model is useful and the deterministic layer is safe", async () => {
    const provider = fakeProvider((ctx) => rawFor(ctx, /POSITIVE_COMPLETE|NEGATIVE_TRUST/.test(ctx.obligation_id) ? "PAY" : "HOLD"));
    const result = await runSyntheticEvaluation(provider, { now: () => 0 });
    if (result.status !== "EVALUATED") throw new Error("expected evaluation");
    expectEval(result.model_failures).toBe(0);
    expectEval(result.safety_failures).toBe(0);
    expectEval(provider.calls).toBe(4);
  });

  itEval("fails the model on date and evidence negatives while route-not-ready remains assessment-eligible", async () => {
    const provider = fakeProvider((ctx) => rawFor(ctx, "PAY"));
    const result = await runSyntheticEvaluation(provider, { now: () => 0 });
    if (result.status !== "EVALUATED") throw new Error("expected evaluation");
    expectEval(result.model_failures).toBe(2);
    expectEval(result.safety_failures).toBe(0);
    const routeNotReady = result.outcomes.find((o) => o.case_id === "NEGATIVE_TRUST");
    expectEval(routeNotReady?.expected).toBe("PAY");
    expectEval(routeNotReady?.normalized.decision).toBe("PAY");
    expectEval(routeNotReady?.model_usefulness_met).toBe(true);
    expectEval(routeNotReady?.deterministic_safety_met).toBe(true);
    for (const outcome of result.outcomes.filter((o) => o.case_id === "NEGATIVE_DATE" || o.case_id === "NEGATIVE_EVIDENCE")) {
      expectEval(outcome.raw.decision).toBe("PAY");
      expectEval(outcome.normalized.decision).not.toBe("PAY");
      expectEval(outcome.model_usefulness_met).toBe(false);
      expectEval(outcome.deterministic_safety_met).toBe(true);
    }
  });

  itEval("fails the model on a malformed raw output while retaining that it was invalid", async () => {
    const provider = fakeProvider(() => ({ decision: "MAYBE" }));
    const result = await runSyntheticEvaluation(provider, { now: () => 0 });
    if (result.status !== "EVALUATED") throw new Error("expected evaluation");
    for (const outcome of result.outcomes) {
      expectEval(outcome.raw.schema_valid).toBe(false);
      expectEval(outcome.model_usefulness_met).toBe(false);
      expectEval(outcome.deterministic_safety_met).toBe(true);
    }
  });

  itEval("keeps the raw unsupported proposal and its normalized rejection side by side", async () => {
    const provider = fakeProvider((ctx) => rawFor(ctx, "PAY", ["DUPLICATE_SOURCE"]));
    const result = await runSyntheticEvaluation(provider, { now: () => 0 });
    if (result.status !== "EVALUATED") throw new Error("expected evaluation");
    for (const outcome of result.outcomes) {
      expectEval(outcome.raw.finding_codes).toEqual(["DUPLICATE_SOURCE"]);
      expectEval(outcome.normalized.decision).not.toBe("PAY");
    }
  });

  itEval("records provider, model, configuration and prompt provenance per case", async () => {
    const provider = fakeProvider((ctx) => rawFor(ctx, "HOLD"));
    const result = await runSyntheticEvaluation(provider, { now: () => 0 });
    if (result.status !== "EVALUATED") throw new Error("expected evaluation");
    expectEval(result.outcomes[0].provenance?.model_id).toBe("fake");
    expectEval(result.outcomes[0].provenance?.runtime_config_sha256).toBe("0".repeat(64));
  });

  itEval("stops at a mid-batch authentication boundary and retains the completed partial evidence", async () => {
    let call = 0;
    const provider = fakeProvider((ctx) => {
      call += 1;
      if (call === 3) throw new Error("NVIDIA request failed with HTTP 401");
      return rawFor(ctx, "HOLD");
    });
    const result = await runSyntheticEvaluation(provider, { now: () => 0 });
    expectEval(result.status).toBe("BLOCKED");
    if (result.status !== "BLOCKED") return;
    expectEval(result.code).toBe("PROVIDER_AUTH");
    expectEval(result.outcomes.map((o) => o.case_id)).toEqual(["POSITIVE_COMPLETE", "NEGATIVE_TRUST"]);
    expectEval(provider.calls).toBe(3);
  });
});

describeEval("one orchestrator deadline for the full batch; each case gets only the remaining budget", () => {
  itEval("starts no later case when the first case completes exactly at the batch deadline", async () => {
    const now = vi.fn()
      .mockReturnValueOnce(0)   // batch start
      .mockReturnValueOnce(0)   // first case receives the full budget
      .mockReturnValueOnce(25); // exact deadline before the next case
    const provider = fakeProvider((ctx) => ({
      obligation_id: ctx.obligation_id,
      decision: "PAY",
      finding_codes: [],
      evidence_ids: ctx.evidence_ids,
      uncertainty_signal: false,
      explanation: "synthetic boundary fixture",
    }));

    const result = await runSyntheticEvaluation(provider, { now, budgetMs: 25 });

    expectEval(result).toMatchObject({ status: "INCOMPLETE", reason: "DEADLINE" });
    if (result.status !== "INCOMPLETE") return;
    expectEval(result.outcomes.map((outcome) => outcome.case_id)).toEqual(["POSITIVE_COMPLETE"]);
    expectEval(provider.calls).toBe(1);
    expectEval(now).toHaveBeenCalledTimes(3);
  });

  itEval("returns a typed INCOMPLETE result with partial evidence when a case outlives the remaining budget", async () => {
    let calls = 0;
    const provider = fakeProvider((ctx) => {
      calls += 1;
      if (calls === 1) return { obligation_id: ctx.obligation_id, decision: "HOLD", finding_codes: [], evidence_ids: [], uncertainty_signal: false, explanation: "fast" };
      return new Promise(() => {});
    });
    const started = Date.now();
    const result = await runSyntheticEvaluation(provider, { budgetMs: 150 });
    expectEval(result.status).toBe("INCOMPLETE");
    if (result.status !== "INCOMPLETE") return;
    expectEval(result.reason).toBe("DEADLINE");
    expectEval(result.outcomes.map((o) => o.case_id)).toEqual(["POSITIVE_COMPLETE"]);
    expectEval(Date.now() - started).toBeLessThan(2000);
  });

  itEval("aborts the in-flight provider call at the batch deadline and starts no later case", async () => {
    let calls = 0;
    let receivedSignal: AbortSignal | undefined;
    const provider = {
      ...fakeProvider(() => undefined),
      async assess(_ctx: { obligation_id: string; evidence_ids: string[] }, options?: { signal?: AbortSignal }) {
        calls += 1;
        receivedSignal = options?.signal;
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(new Error("transport aborted")), { once: true });
        });
      },
    } as unknown as AiProvider;
    const result = await runSyntheticEvaluation(provider, { budgetMs: 20 });
    expectEval(result.status).toBe("INCOMPLETE");
    expectEval(calls).toBe(1);
    expectEval(receivedSignal?.aborted).toBe(true);
  });
});

describeEval("usefulness uses normalized application truth, rejecting unsupported schema-valid proposals", () => {
  itEval("does not count a positive PAY whose finding is unsupported as useful", async () => {
    const provider = fakeProvider((ctx) => ({ obligation_id: ctx.obligation_id, decision: "PAY", finding_codes: ["DUPLICATE_SOURCE"], evidence_ids: ctx.evidence_ids, uncertainty_signal: false, explanation: "x" }));
    const result = await runSyntheticEvaluation(provider, { now: () => 0 });
    if (result.status !== "EVALUATED") throw new Error("expected evaluation");
    expectEval(result.outcomes.find((o) => o.case_id === "POSITIVE_COMPLETE")?.model_usefulness_met).toBe(false);
  });

  itEval("does not count a wrong-identity schema-valid proposal as useful", async () => {
    const provider = fakeProvider((ctx) => ({ obligation_id: "SOMEONE-ELSE", decision: ctx.obligation_id.includes("POSITIVE") ? "PAY" : "HOLD", finding_codes: [], evidence_ids: ctx.evidence_ids, uncertainty_signal: false, explanation: "x" }));
    const result = await runSyntheticEvaluation(provider, { now: () => 0 });
    if (result.status !== "EVALUATED") throw new Error("expected evaluation");
    expectEval(result.outcomes.every((o) => o.model_usefulness_met === false)).toBe(true);
  });

  itEval("retains privacy-safe proposal fields separately from the normalized result", async () => {
    const provider = fakeProvider((ctx) => ({ obligation_id: ctx.obligation_id, decision: "HOLD", finding_codes: [], evidence_ids: [], uncertainty_signal: true, explanation: "synthetic reason" }));
    const result = await runSyntheticEvaluation(provider, { now: () => 0 });
    if (result.status !== "EVALUATED") throw new Error("expected evaluation");
    const outcome = result.outcomes[1];
    expectEval(outcome.raw.explanation).toBe("synthetic reason");
    expectEval(outcome.raw.uncertainty_signal).toBe(true);
    expectEval(outcome.normalized.decision).toBeDefined();
    expectEval(outcome.raw).not.toBe(outcome.normalized);
  });
});
