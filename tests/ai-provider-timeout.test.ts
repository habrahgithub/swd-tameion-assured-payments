import { afterEach, describe, expect, it, vi } from "vitest";

import { CARE_PROMPT_SHA256, CARE_PROMPT_VERSION, CARE_SYSTEM_PROMPT, NvidiaProvider } from "../src/agent/ai-provider";
import type { FinanceAgentContext } from "../src/agent/schema";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.NVIDIA_API_KEY;

const context: FinanceAgentContext = {
  obligation_id: "OBL-TIMEOUT",
  aggregate_version: "1",
  as_of_date: "2026-09-29",
  service_category: "TEST",
  recurrence: "MONTHLY",
  due_date: "2026-09-30",
  due_date_status: "STATED_ON_SOURCE",
  amount: "10.00",
  currency: "USD",
  state_at_event_baseline: "OUTSTANDING",
  business_purpose_confirmed: true,
  evidence_present: true,
  evidence_ids: ["EVD-1"],
  destination_ready: false,
  destination_status: "PENDING_J0_D_TRUST_SEED",
  destination_readiness_source: "IMMUTABLE_SOURCE_EVIDENCE",
  due_date_position: "FUTURE",
  commercial_terms: "Test-only context.",
};

describe("NVIDIA assessment timeout", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = originalApiKey;
  });

  it("aborts the provider request before the route execution limit", async () => {
    const { maxDuration } = await import("../app/api/obligations/[id]/assess/route");
    process.env.NVIDIA_API_KEY = "test-only-key";
    let requestSignal: AbortSignal | null | undefined;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal | null | undefined;
      const body = JSON.parse(String(init?.body)) as Record<string, unknown> & { messages: Array<{ role: string; content: string }> };
      expect(body.messages[0]).toEqual({ role: "system", content: CARE_SYSTEM_PROMPT });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }), { status: 200 });
    }) as typeof fetch;

    const provider = new NvidiaProvider();
    await provider.assess(context);

    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(NvidiaProvider.REQUEST_TIMEOUT_MS).toBe(30_000);
    expect(maxDuration).toBeGreaterThanOrEqual(61);
    const request = JSON.parse(String((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1]?.body)) as Record<string, unknown>;
    expect(request).toMatchObject({
      model: "nvidia/nemotron-3-super-120b-a12b",
      temperature: 1.0,
      top_p: 0.95,
      max_tokens: 4096,
      reasoning_effort: "high",
      stream: false,
    });
    expect(request).not.toHaveProperty("max_output_tokens");
    expect(request).not.toHaveProperty("max_completion_tokens");
    expect(provider.promptIdentity).toEqual({ version: CARE_PROMPT_VERSION, sha256: CARE_PROMPT_SHA256 });
    expect(provider.runtimeIdentity).toMatchObject({
      provider_name: "NVIDIA Build",
      model_id: "nvidia/nemotron-3-super-120b-a12b",
      model_config_version: "p0-nvidia-nemotron3super-v1",
    });
    expect(provider.runtimeIdentity?.runtime_config_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(provider.runtimeIdentity).toEqual(new NvidiaProvider().runtimeIdentity);
  });

  it("retries one 5xx response and records a deterministic runtime config identity", async () => {
    process.env.NVIDIA_API_KEY = "test-only-key";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("provider busy", { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    await new NvidiaProvider().assess(context);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe("https://integrate.api.nvidia.com/v1/chat/completions");
  });

  it("does not retry 4xx responses or provider refusals", async () => {
    process.env.NVIDIA_API_KEY = "test-only-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response("forbidden", { status: 401 }));
    globalThis.fetch = fetchMock as typeof fetch;
    await expect(new NvidiaProvider().assess(context)).rejects.toThrow(/HTTP 401/);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const refusalFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { refusal: "refused", content: null } }] }), { status: 200 }));
    globalThis.fetch = refusalFetch as typeof fetch;
    await expect(new NvidiaProvider().assess(context)).rejects.toThrow(/refused/);
    expect(refusalFetch).toHaveBeenCalledTimes(1);

    const malformedFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "not JSON" } }] }), { status: 200 }));
    globalThis.fetch = malformedFetch as typeof fetch;
    await expect(new NvidiaProvider().assess(context)).rejects.toThrow(/not valid JSON/);
    expect(malformedFetch).toHaveBeenCalledTimes(1);
  });

  it("retries one pre-response transport failure", async () => {
    process.env.NVIDIA_API_KEY = "test-only-key";
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("connection reset before response"))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }));
    globalThis.fetch = fetchMock as typeof fetch;

    await new NvidiaProvider().assess(context);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("propagates batch cancellation to the transport and does not retry it", async () => {
    process.env.NVIDIA_API_KEY = "test-only-key";
    const controller = new AbortController();
    let transportSignal: AbortSignal | null | undefined;
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      transportSignal = init?.signal as AbortSignal | null | undefined;
      return await new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const pending = new NvidiaProvider().assess(context, { signal: controller.signal });
    controller.abort();

    await expect(pending).rejects.toThrow(/cancel/i);
    expect(transportSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
