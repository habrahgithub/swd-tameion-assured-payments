import { afterEach, describe, expect, it, vi } from "vitest";

import { NvidiaProvider } from "../src/agent/ai-provider";
import type { FinanceAgentContext } from "../src/agent/schema";
import { maxDuration } from "../app/api/obligations/[id]/assess/route";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.NVIDIA_API_KEY;

const context: FinanceAgentContext = {
  obligation_id: "OBL-TIMEOUT",
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
  commercial_terms: "Test-only context.",
};

describe("NVIDIA assessment timeout", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalApiKey === undefined) delete process.env.NVIDIA_API_KEY;
    else process.env.NVIDIA_API_KEY = originalApiKey;
  });

  it("aborts the provider request before the route execution limit", async () => {
    process.env.NVIDIA_API_KEY = "test-only-key";
    let requestSignal: AbortSignal | null | undefined;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal | null | undefined;
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }), { status: 200 });
    }) as typeof fetch;

    await new NvidiaProvider().assess(context);

    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(NvidiaProvider.REQUEST_TIMEOUT_MS).toBeLessThan(maxDuration * 1_000);
  });
});
