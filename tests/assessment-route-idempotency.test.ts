import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/obligations/[id]/assess/route";
import { getDemoState, DEMO_ORGANIZATION_ID } from "../src/server/demo-state";

const originalFetch = globalThis.fetch;
const originalEnv = {
  VERCEL_ENV: process.env.VERCEL_ENV,
  VERCEL_GIT_PULL_REQUEST_ID: process.env.VERCEL_GIT_PULL_REQUEST_ID,
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
};

const operationId = "c23a9d3a-39a1-4f36-9556-04f523969abb";

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
}

function createDurableFetch(options: { loseCompletionCas?: "unrelated" | "stale" | "all"; providerFailure?: boolean; legacyPending?: boolean } = {}) {
  let revision = 1;
  let snapshot: Record<string, any> | undefined;
  let providerCalls = 0;
  let lostCompletionCas = false;
  let completionCasFailures = 0;
  let signalProviderStarted!: () => void;
  let releaseProvider!: () => void;
  const providerStarted = new Promise<void>((resolve) => { signalProviderStarted = resolve; });
  const providerGate = new Promise<void>((resolve) => { releaseProvider = resolve; });

  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("/rest/v1/rpc/tameion_state_load_or_seed")) {
      const body = JSON.parse(String(init?.body)) as { p_initial_snapshot: Record<string, any> };
      snapshot ??= body.p_initial_snapshot;
      if (options.legacyPending && snapshot.assessment_operations.length === 0) {
        snapshot.assessment_operations.push({
          idempotency_key: operationId,
          obligation_id: "OBL-J0C-001",
          aggregate_version: 1,
          status: "PENDING",
        });
      }
      return jsonResponse({ revision, snapshot });
    }
    if (url.includes("/rest/v1/rpc/tameion_state_compare_and_set")) {
      const body = JSON.parse(String(init?.body)) as {
        p_expected_revision: number;
        p_next_snapshot: Record<string, any>;
      };
      if (body.p_expected_revision !== revision) return jsonResponse({ accepted: false, revision });

      const hasCompletedOperation = body.p_next_snapshot.assessment_operations?.some(
        (operation: { status: string }) => operation.status === "COMPLETED",
      );
      if (options.loseCompletionCas === "all" && hasCompletedOperation && completionCasFailures < 4) {
        completionCasFailures += 1;
        return jsonResponse({ accepted: false, revision });
      }
      if (options.loseCompletionCas && options.loseCompletionCas !== "all" && hasCompletedOperation && !lostCompletionCas) {
        lostCompletionCas = true;
        const competingSnapshot = structuredClone(snapshot!);
        if (options.loseCompletionCas === "unrelated") {
          competingSnapshot.authority.kill_switches.push("GLOBAL_EXECUTION_DISABLED");
        } else {
          competingSnapshot.authority.aggregates[0].aggregate_version += 1;
        }
        snapshot = competingSnapshot;
        revision += 1;
        return jsonResponse({ accepted: false, revision });
      }

      snapshot = body.p_next_snapshot;
      revision += 1;
      return jsonResponse({ accepted: true, revision });
    }
    if (url.includes("integrate.api.nvidia.com/v1/chat/completions")) {
      providerCalls += 1;
      signalProviderStarted();
      await providerGate;
      if (options.providerFailure) throw new TypeError("simulated provider connection loss");
      return jsonResponse({
        choices: [{ message: { content: JSON.stringify({
          obligation_id: "OBL-J0C-001",
          decision: "HOLD",
          reasons: ["Provider returned a valid test assessment."],
          evidence_ids: ["EVD-J0C-001"],
          missing_evidence: ["destination_trust_seed"],
          uncertainty_signal: true,
        }) } }],
      });
    }
    throw new Error(`Unexpected request URL: ${url}`);
  });

  return {
    fetcher,
    get providerCalls() { return providerCalls; },
    get snapshot() { return snapshot; },
    providerStarted,
    releaseProvider,
  };
}

function request() {
  return new Request("http://localhost/api/obligations/OBL-J0C-001/assess", {
    method: "POST",
    headers: { "Idempotency-Key": operationId },
  });
}

async function callAssessment() {
  return POST(request(), { params: Promise.resolve({ id: "OBL-J0C-001" }) });
}

describe("assessment request idempotency across durable CAS races", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("runs one provider call for overlapping requests with the same key and stores one assessment", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_PULL_REQUEST_ID = "10";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
    process.env.NVIDIA_API_KEY = "test-only-nvidia-key";
    const durable = createDurableFetch();
    globalThis.fetch = durable.fetcher as typeof fetch;

    const first = callAssessment();
    await durable.providerStarted;
    const duplicatePromise = callAssessment();
    const duplicateBeforeProviderCompletes = await Promise.race([
      duplicatePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 30)),
    ]);
    durable.releaseProvider();
    const completed = await first;
    const duplicate = duplicateBeforeProviderCompletes ?? await duplicatePromise;
    const repeated = await callAssessment();

    expect(duplicate.status).toBe(202);
    expect(completed.status).toBe(200);
    expect(repeated.status).toBe(200);
    expect(durable.providerCalls).toBe(1);
    expect(durable.snapshot?.authority.assessments).toHaveLength(1);
    const completedData = await completed.json();
    const repeatedData = await repeated.json();
    expect(repeatedData.assessment_hash).toBe(completedData.assessment_hash);
  });

  it("reapplies an obtained provider result after an unrelated CAS winner without calling the provider again", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_PULL_REQUEST_ID = "10";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
    process.env.NVIDIA_API_KEY = "test-only-nvidia-key";
    const durable = createDurableFetch({ loseCompletionCas: "unrelated" });
    globalThis.fetch = durable.fetcher as typeof fetch;

    const call = callAssessment();
    await durable.providerStarted;
    durable.releaseProvider();
    const response = await call;

    expect(response.status).toBe(200);
    expect(durable.providerCalls).toBe(1);
    expect(durable.snapshot?.authority.assessments).toHaveLength(1);
    expect(durable.snapshot?.authority.kill_switches).toContain("GLOBAL_EXECUTION_DISABLED");
  });

  it("rejects persistence when the aggregate changed while the provider was running", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_PULL_REQUEST_ID = "10";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
    process.env.NVIDIA_API_KEY = "test-only-nvidia-key";
    const durable = createDurableFetch({ loseCompletionCas: "stale" });
    globalThis.fetch = durable.fetcher as typeof fetch;

    const call = callAssessment();
    await durable.providerStarted;
    durable.releaseProvider();
    const response = await call;

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("ASM-001");
    expect(durable.providerCalls).toBe(1);
    expect(durable.snapshot?.authority.assessments).toHaveLength(0);
    expect(durable.snapshot?.assessment_operations[0].status).toBe("STALE");
    expect(durable.snapshot?.assessment_operations[0].provider_result).toBeUndefined();
    expect((await getDemoState()).store.get(DEMO_ORGANIZATION_ID, "OBL-J0C-001").aggregate_version).toBe(2);
  });

  it("recovers a durably checkpointed provider result on same-key replay without another provider call", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_PULL_REQUEST_ID = "10";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
    process.env.NVIDIA_API_KEY = "test-only-nvidia-key";
    const durable = createDurableFetch({ loseCompletionCas: "all" });
    globalThis.fetch = durable.fetcher as typeof fetch;

    const first = callAssessment();
    await durable.providerStarted;
    durable.releaseProvider();
    const interrupted = await first;
    expect(interrupted.status).toBe(202);
    expect(durable.snapshot?.assessment_operations[0].status).toBe("PROVIDER_RESULT_DURABLE");

    const replay = await callAssessment();
    expect(replay.status).toBe(200);
    expect(durable.providerCalls).toBe(1);
    expect(durable.snapshot?.authority.assessments).toHaveLength(1);
    expect(durable.snapshot?.assessment_operations[0].status).toBe("COMPLETED");
  });

  it("blocks a different key while an assessment operation is unresolved", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_PULL_REQUEST_ID = "10";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
    process.env.NVIDIA_API_KEY = "test-only-nvidia-key";
    const durable = createDurableFetch();
    globalThis.fetch = durable.fetcher as typeof fetch;

    const first = callAssessment();
    await durable.providerStarted;
    const differentKey = new Request("http://localhost/api/obligations/OBL-J0C-001/assess", {
      method: "POST",
      headers: { "Idempotency-Key": "d13e1a83-3541-4bd0-8fbf-095047bc29c3" },
    });
    const blockedPromise = POST(differentKey, { params: Promise.resolve({ id: "OBL-J0C-001" }) });
    durable.releaseProvider();
    await Promise.all([first, blockedPromise]);
    const blocked = await blockedPromise;

    expect(blocked.status).toBe(409);
    expect((await blocked.json()).code).toBe("ASM-OPERATION-UNRESOLVED");
    expect(durable.providerCalls).toBe(1);
  });

  it("leaves ambiguous provider completion UNKNOWN and blocks a fresh key", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_PULL_REQUEST_ID = "10";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
    process.env.NVIDIA_API_KEY = "test-only-nvidia-key";
    const durable = createDurableFetch({ providerFailure: true });
    globalThis.fetch = durable.fetcher as typeof fetch;

    const first = callAssessment();
    await durable.providerStarted;
    durable.releaseProvider();
    const response = await first;
    const differentKey = new Request("http://localhost/api/obligations/OBL-J0C-001/assess", {
      method: "POST",
      headers: { "Idempotency-Key": "d13e1a83-3541-4bd0-8fbf-095047bc29c3" },
    });
    const blocked = await POST(differentKey, { params: Promise.resolve({ id: "OBL-J0C-001" }) });

    expect(response.status).toBe(409);
    expect(durable.snapshot?.assessment_operations[0].status).toBe("UNKNOWN");
    expect(blocked.status).toBe(409);
    expect(durable.providerCalls).toBe(1);
    expect(durable.snapshot?.authority.assessments).toHaveLength(0);
  });

  it("fails closed on a legacy stranded PENDING operation without calling the provider", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_PULL_REQUEST_ID = "10";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
    process.env.NVIDIA_API_KEY = "test-only-nvidia-key";
    const durable = createDurableFetch({ legacyPending: true });
    globalThis.fetch = durable.fetcher as typeof fetch;

    const response = await callAssessment();
    const data = await response.json();

    expect(response.status).toBe(409);
    expect(data.status).toBe("UNKNOWN");
    expect(data.code).toBe("ASM-UNKNOWN");
    expect(durable.providerCalls).toBe(0);

    const freshKeyResponse = await POST(new Request("http://localhost/api/obligations/OBL-J0C-001/assess", {
      method: "POST",
      headers: { "Idempotency-Key": "d13e1a83-3541-4bd0-8fbf-095047bc29c3" },
    }), { params: Promise.resolve({ id: "OBL-J0C-001" }) });
    expect(freshKeyResponse.status).toBe(409);
    expect((await freshKeyResponse.json()).code).toBe("ASM-OPERATION-UNRESOLVED");
    expect(durable.providerCalls).toBe(0);
  });
});
