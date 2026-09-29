import { afterEach, describe, expect, it, vi } from "vitest";

import { CARE_PROMPT_SHA256, CARE_PROMPT_VERSION, CARE_SYSTEM_PROMPT, NvidiaProvider } from "../src/agent/ai-provider";
import type { FinanceAgentContext } from "../src/agent/schema";
import { maxDuration } from "../app/api/obligations/[id]/assess/route";

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
    process.env.NVIDIA_API_KEY = "test-only-key";
    let requestSignal: AbortSignal | null | undefined;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal | null | undefined;
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      expect(body.messages[0]).toEqual({ role: "system", content: CARE_SYSTEM_PROMPT });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }), { status: 200 });
    }) as typeof fetch;

    const provider = new NvidiaProvider();
    await provider.assess(context);

    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(NvidiaProvider.REQUEST_TIMEOUT_MS).toBeLessThan(maxDuration * 1_000);
    expect(provider.promptIdentity).toEqual({ version: CARE_PROMPT_VERSION, sha256: CARE_PROMPT_SHA256 });
  });
});
