import { afterEach, describe, expect, it, vi } from "vitest";

import { POST } from "../app/api/obligations/[id]/assess/route";
import { DEMO_ORGANIZATION_ID, DEMO_SIGNING_KEY_ID, DemoState, getDemoState } from "../src/server/demo-state";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { currentAssessmentReview, sealTestAssessment } from "./test-support/seal-assessment";

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

function createDurableFetch(options: {
  loseCompletionCas?: "unrelated" | "stale" | "all";
  loseProviderResultResponse?: boolean;
  providerFailure?: boolean;
  legacyPending?: boolean;
  seedSnapshot?: Record<string, any>;
} = {}) {
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
      snapshot ??= options.seedSnapshot ? structuredClone(options.seedSnapshot) : body.p_initial_snapshot;
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
      const hasDurableProviderResult = body.p_next_snapshot.assessment_operations?.some(
        (operation: { status: string }) => operation.status === "PROVIDER_RESULT_DURABLE",
      );
      if (options.loseProviderResultResponse && hasDurableProviderResult) {
        snapshot = body.p_next_snapshot;
        revision += 1;
        throw new TypeError("simulated committed provider-result checkpoint with lost response");
      }
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
          finding_codes: [],
          evidence_ids: ["EVD-J0C-001"],
          uncertainty_signal: true,
          explanation: "Provider returned a valid test assessment.",
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
    expect(completedData).toMatchObject({
      provider_used: "NVIDIA Build",
      provider_mode: "LIVE_AI",
      model_id: "nvidia/nemotron-3-super-120b-a12b",
      model_config_version: "p0-nvidia-nemotron3super-v1",
    });
    expect(completedData.runtime_config_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(repeatedData.assessment_hash).toBe(completedData.assessment_hash);
    expect(repeatedData.runtime_config_sha256).toBe(completedData.runtime_config_sha256);
    expect(completedData.race.result.validated_findings.map((finding: { code: string }) => finding.code)).not.toContain("DESTINATION_NOT_READY");
    expect(completedData.race.evidence.authoritative_facts.destination_status).toBe("NOT_READY_SIMULATED_FIXTURE");
    expect(completedData.race.evidence.authoritative_facts.destination_readiness_source).toBe("SIMULATED_DEMO_FIXTURE");
    expect(repeatedData.race).toEqual(completedData.race);
    expect(completedData.decision.reasons.join(" ")).not.toContain("Provider returned a valid test assessment.");
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
    const recovered = await replay.json();
    expect(recovered.race.result.validated_findings.map((finding: { code: string }) => finding.code)).not.toContain("DESTINATION_NOT_READY");
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
    expect(durable.providerCalls).toBe(2);
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

  it("transitions an aged RESERVED operation to UNKNOWN when observed through a different key", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_PULL_REQUEST_ID = "10";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
    process.env.NVIDIA_API_KEY = "test-only-nvidia-key";
    const seed = new DemoState().exportSnapshot() as unknown as Record<string, any>;
    const aggregate = seed.authority.aggregates.find((item: { obligation_id: string }) => item.obligation_id === "OBL-J0C-001");
    aggregate.aggregate_version = 2;
    seed.assessment_operations.push({
      idempotency_key: operationId,
      obligation_id: "OBL-J0C-001",
      aggregate_version: 1,
      status: "RESERVED",
      reserved_at: Date.now() - 90_000,
    });
    const durable = createDurableFetch({ seedSnapshot: seed });
    globalThis.fetch = durable.fetcher as typeof fetch;

    const call = POST(new Request("http://localhost/api/obligations/OBL-J0C-001/assess", {
      method: "POST",
      headers: { "Idempotency-Key": "d13e1a83-3541-4bd0-8fbf-095047bc29c3" },
    }), { params: Promise.resolve({ id: "OBL-J0C-001" }) });
    await Promise.race([durable.providerStarted, new Promise<void>((resolve) => setTimeout(resolve, 30))]);
    durable.releaseProvider();
    const response = await call;

    expect(response.status).toBe(409);
    expect((await response.json()).status).toBe("UNKNOWN");
    expect(durable.snapshot?.assessment_operations).toHaveLength(1);
    expect(durable.snapshot?.assessment_operations[0].status).toBe("UNKNOWN");
    expect(durable.providerCalls).toBe(0);
  });

  it("recovers a checkpoint after its commit response is lost with the original key", async () => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_PULL_REQUEST_ID = "10";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
    process.env.NVIDIA_API_KEY = "test-only-nvidia-key";
    const durable = createDurableFetch({ loseProviderResultResponse: true });
    globalThis.fetch = durable.fetcher as typeof fetch;

    const first = callAssessment();
    await durable.providerStarted;
    durable.releaseProvider();
    await expect(first).rejects.toThrow("simulated committed provider-result checkpoint with lost response");
    expect(durable.snapshot?.assessment_operations[0].status).toBe("PROVIDER_RESULT_DURABLE");

    const replay = await callAssessment();
    expect(replay.status).toBe(200);
    expect(durable.providerCalls).toBe(1);
    expect(durable.snapshot?.authority.assessments).toHaveLength(1);
    expect(durable.snapshot?.assessment_operations[0].status).toBe("COMPLETED");
  });

  it("refuses assessment before provider submission when PAE authority is already live", async () => {
    const previousEnvironment = process.env.VERCEL_ENV;
    delete process.env.VERCEL_ENV;
    const seeded = new DemoState();
    for (const obligation of seeded.listObligations()) {
      const aggregate = seeded.store.get(DEMO_ORGANIZATION_ID, obligation.obligation_id);
      // Test-only genuine-provenance marker for the authorization/idempotency boundary.
      seeded.store.seed({
        ...aggregate,
        destination_ref: `DEST-${obligation.obligation_id}-TEST-EVIDENCED`,
        source_wallet_ref: "WALLET-SOURCE-TEST-EVIDENCED",
        product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
      });
      sealTestAssessment(seeded.store, DEMO_ORGANIZATION_ID, obligation.obligation_id, aggregate.aggregate_version);
    }
    const obligationId = "OBL-J0C-001";
    const version = seeded.store.get(DEMO_ORGANIZATION_ID, obligationId).aggregate_version;
    const authorization = approveAndSealPae(seeded.store, DEMO_SIGNING_KEY_ID, {
      organizationId: DEMO_ORGANIZATION_ID,
      obligationId,
      expectedVersion: version,
      ...currentAssessmentReview(seeded.store, DEMO_ORGANIZATION_ID, obligationId),
      actorId: "USR-TEST-OPERATOR",
      actorRole: "FINANCE_APPROVER",
      policyVersion: "POLICY-P0-1",
      reasonText: "Test fixture only.",
    });
    seeded.recordAuthorization({
      approval_record: authorization.approvalRecord.record,
      approval_record_hash: authorization.approvalRecord.approval_record_hash,
      assurance_record: authorization.assuranceRecord.record,
      assurance_hash: authorization.assuranceRecord.assurance_hash,
      sealed_pae: authorization.sealed,
    });
    if (previousEnvironment === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previousEnvironment;
    process.env.VERCEL_GIT_PULL_REQUEST_ID = "10";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
    process.env.NVIDIA_API_KEY = "test-only-nvidia-key";
    const before = seeded.exportSnapshot();
    const durable = createDurableFetch({ seedSnapshot: before as unknown as Record<string, any> });
    globalThis.fetch = durable.fetcher as typeof fetch;

    const call = POST(new Request(`http://localhost/api/obligations/${obligationId}/assess`, {
      method: "POST",
      headers: { "Idempotency-Key": "d13e1a83-3541-4bd0-8fbf-095047bc29c3" },
    }), { params: Promise.resolve({ id: obligationId }) });
    await Promise.race([durable.providerStarted, new Promise<void>((resolve) => setTimeout(resolve, 30))]);
    durable.releaseProvider();
    const response = await call;
    const after = durable.snapshot!;

    expect(response.status).toBe(409);
    expect(durable.providerCalls).toBe(0);
    expect(after.authority.assessments).toHaveLength(before.authority.assessments.length);
    expect(after.authority.aggregates).toEqual(before.authority.aggregates);
    expect(after.sealed_paes).toEqual(before.sealed_paes);
    expect(after.assessment_operations).toEqual(before.assessment_operations);
  });

  it.each([
    ["operation id", { assessment_id: "ASM-other" }],
    ["obligation id", { obligation_id: "OBL-J0C-002" }],
    ["aggregate version", { aggregate_version: "2" }],
  ])("rejects a stored provider result whose %s differs from the operation", async (_label, mismatch) => {
    process.env.VERCEL_ENV = "preview";
    process.env.VERCEL_GIT_PULL_REQUEST_ID = "10";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only-service-role";
    const seed = new DemoState().exportSnapshot() as unknown as Record<string, any>;
    const valid = {
      ...sealTestAssessment(new DemoState().store, DEMO_ORGANIZATION_ID, "OBL-J0C-001", 1).record,
      assessment_id: `ASM-${operationId}`,
    };
    const changed = mismatch as { assessment_id?: string; obligation_id?: string; aggregate_version?: string };
    seed.assessment_operations.push({
      idempotency_key: operationId,
      obligation_id: "OBL-J0C-001",
      aggregate_version: 1,
      status: "PROVIDER_RESULT_DURABLE",
      provider_result: {
        ...valid,
        ...changed,
        ...(changed.obligation_id || changed.aggregate_version ? {
          race: {
            ...valid.race!,
            evidence: {
              ...valid.race!.evidence,
              authoritative_facts: {
                ...valid.race!.evidence.authoritative_facts,
                ...(changed.obligation_id ? { obligation_id: changed.obligation_id } : {}),
                ...(changed.aggregate_version ? { aggregate_version: changed.aggregate_version } : {}),
              },
            },
          },
        } : {}),
      },
    });
    const durable = createDurableFetch({ seedSnapshot: seed });
    globalThis.fetch = durable.fetcher as typeof fetch;

    await expect(callAssessment()).rejects.toThrow(/Provider result identity does not match its assessment operation/);
    expect(durable.providerCalls).toBe(0);
    expect(durable.snapshot?.authority.assessments).toHaveLength(0);
  });
});
