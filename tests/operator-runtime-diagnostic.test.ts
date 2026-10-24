import { describe, expect, it, vi } from "vitest";
import { createRuntimeDiagnosticHandler, runtimeBindingFingerprint, RUNTIME_DIAGNOSTIC_PAYABLE_IDS } from "../src/server/operator-runtime-diagnostic";
import type { RecoveryWorkflowCapabilities } from "../src/server/supabase-demo-state-repository";

const ready: RecoveryWorkflowCapabilities = {
  status: "READY", reason_codes: ["CAPABILITY_CONTRACT_READY"], schema_version: 1,
  available: { human_authorization_history: true, shared_wallet_namespace_lock: true, parent_child_retirement_lock: true, immutable_recovery_receipts: true },
};
const caps = (status: RecoveryWorkflowCapabilities["status"]): RecoveryWorkflowCapabilities => ({ ...ready, status, reason_codes: [status === "READY" ? "CAPABILITY_CONTRACT_READY" : "REQUIRED_CAPABILITY_MISSING"] });
const internal = (overrides: Record<string, unknown> = {}) => Response.json({
  diagnostic_meta: { observation_status: "CONSISTENT", observation_reason_code: null, binding_namespaces: ["SYNTHETIC-SECRET-NAMESPACE"], source_path: "RECOVERABLE_SOURCE_INGRESS", source_reason_codes: ["RECOVERABLE_INGRESS_SELECTED"] },
  capabilities: ready,
  obligations: [{ obligation_id: "OBL-SWD-20261014-001", diagnostic_binding_namespace: "SYNTHETIC-SECRET-NAMESPACE", amount: "SECRET-AMOUNT", beneficiary: "SECRET-BENEFICIARY", allowed_actions: ["MANUAL_REVIEW", "PAYMENT_EXECUTE", "CREATE_SOURCE"], stage2_status: "READY_FOR_REVIEW", source_document: "SECRET-SOURCE" }],
  ...overrides,
});
function handler(evaluate: () => Promise<Response>, env: Record<string, string | undefined> = { SUPABASE_URL: "https://project-ref.supabase.co", VERCEL_DEPLOYMENT_ID: "dpl-synthetic", VERCEL_GIT_COMMIT_SHA: "a".repeat(40), VERCEL_ENV: "production" }) {
  return { handle: createRuntimeDiagnosticHandler({ evaluate: async () => evaluate(), env, now: () => new Date("2026-10-24T10:00:00.000Z") }) };
}

describe("operator runtime diagnostic", () => {
  it("uses a stable domain-separated project/namespace fingerprint without returning either value", () => {
    const a = runtimeBindingFingerprint("project-ref", "NAMESPACE-A");
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(runtimeBindingFingerprint("project-ref", "NAMESPACE-A")).toBe(a);
    expect(runtimeBindingFingerprint("other-project", "NAMESPACE-A")).not.toBe(a);
    expect(runtimeBindingFingerprint("project-ref", "NAMESPACE-B")).not.toBe(a);
    expect(runtimeBindingFingerprint(null, "NAMESPACE-A")).toBeNull();
    expect(a).not.toContain("project-ref");
    expect(a).not.toContain("NAMESPACE-A");
  });

  it("keeps the composed evaluator authentication failure fail-closed without adding diagnostics", async () => {
    const evaluate = vi.fn(async () => Response.json({ code: "SESSION_REQUIRED" }, { status: 401, headers: { "Cache-Control": "no-store" } }));
    const { handle } = handler(evaluate);
    const response = await handle(new Request("https://tameion.invalid/api/operator/runtime-diagnostic"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "SESSION_REQUIRED" });
    expect(evaluate).toHaveBeenCalledOnce();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns only the six fixed rows and redacted command-admitted actions", async () => {
    const { handle } = handler(async () => internal());
    const response = await handle(new Request("https://tameion.invalid/api/operator/runtime-diagnostic"));
    const body = await response.json();
    expect(body.observation_status).toBe("CONSISTENT");
    expect(body.build).toMatchObject({ deployment_id: "dpl-synthetic", commit_sha: "a".repeat(40), environment: "production" });
    expect(body.payables).toHaveLength(6);
    expect(body.payables.map((row: { obligation_id: string }) => row.obligation_id)).toEqual([...RUNTIME_DIAGNOSTIC_PAYABLE_IDS]);
    expect(body.payables[0]).toMatchObject({ blocking_reason_code: "PAYABLE_NOT_PRESENT", permitted_next_actions: [] });
    expect(body.payables[5].permitted_next_actions).toEqual([]);
    const serialized = JSON.stringify(body);
    for (const secret of ["SECRET-AMOUNT", "SECRET-BENEFICIARY", "SECRET-SOURCE", "SYNTHETIC-SECRET-NAMESPACE", "project-ref"]) expect(serialized).not.toContain(secret);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("does not promote read-model affordances into command admission", async () => {
    const { handle } = handler(async () => internal({ obligations: [{ obligation_id: "OBL-SWD-20261014-001", diagnostic_binding_namespace: "SYNTHETIC-SECRET-NAMESPACE", allowed_actions: ["MANUAL_REVIEW", "CREATE_SOURCE"] }] }));
    const body = await (await handle(new Request("https://tameion.invalid/api/operator/runtime-diagnostic"))).json();
    expect(body.payables[5].permitted_next_actions).toEqual([]);
  });

  it("links rows to distinct redacted bindings and preserves an ambiguous selected path", async () => {
    const { handle } = handler(async () => internal({
      diagnostic_meta: { observation_status: "CONSISTENT", observation_reason_code: null, binding_namespaces: ["SYNTHETIC-SECRET-NAMESPACE", "SECOND-SECRET-NAMESPACE"], source_path: "AMBIGUOUS", source_reason_codes: ["SOURCE_PATH_AMBIGUOUS"] },
      obligations: [
        { obligation_id: "OBL-J0C-001", diagnostic_binding_namespace: "SYNTHETIC-SECRET-NAMESPACE", stage2_status: "READY_FOR_REVIEW", command_admitted_actions: ["MANUAL_REVIEW", "PAYMENT_EXECUTE"] },
        { obligation_id: "OBL-SWD-20261014-001", diagnostic_binding_namespace: "SECOND-SECRET-NAMESPACE", stage2_status: "SOURCE_PERMISSION_REQUIRED", command_admitted_actions: [] },
      ],
    }));
    const body = await (await handle(new Request("https://tameion.invalid/api/operator/runtime-diagnostic"))).json();
    expect(body.source_path).toEqual({ selected: "AMBIGUOUS", reason_codes: ["SOURCE_PATH_AMBIGUOUS"] });
    expect(body.binding.bindings).toHaveLength(2);
    const first = body.payables[0];
    const second = body.payables[5];
    expect(first.binding_fingerprint).toBe(body.binding.bindings[0].fingerprint);
    expect(second.binding_fingerprint).toBe(body.binding.bindings[1].fingerprint);
    expect(first.permitted_next_actions).toEqual(["MANUAL_REVIEW"]);
    expect(second.permitted_next_actions).toEqual([]);
    expect(body.payables[0].permitted_next_actions).not.toContain("PAYMENT_EXECUTE");
    for (const secret of ["SYNTHETIC-SECRET-NAMESPACE", "SECOND-SECRET-NAMESPACE"]) expect(JSON.stringify(body)).not.toContain(secret);
  });

  it("marks a row without exactly one binding as inconsistent and clears actions", async () => {
    const { handle } = handler(async () => internal({ obligations: [{ obligation_id: "OBL-SWD-20261014-001", stage2_status: "READY_FOR_REVIEW", command_admitted_actions: ["MANUAL_REVIEW"] }] }));
    const body = await (await handle(new Request("https://tameion.invalid/api/operator/runtime-diagnostic"))).json();
    expect(body.observation_status).toBe("INCONSISTENT");
    expect(body.payables.every((row: { permitted_next_actions: string[] }) => row.permitted_next_actions.length === 0)).toBe(true);
  });

  it("does not merge duplicate payable identities across namespaces", async () => {
    const { handle } = handler(async () => internal({ obligations: [
      { obligation_id: "OBL-SWD-20261014-001", diagnostic_binding_namespace: "SYNTHETIC-SECRET-NAMESPACE", stage2_status: "READY_FOR_REVIEW", command_admitted_actions: ["MANUAL_REVIEW"] },
      { obligation_id: "OBL-SWD-20261014-001", diagnostic_binding_namespace: "SECOND-SECRET-NAMESPACE", stage2_status: "READY_FOR_REVIEW", command_admitted_actions: ["MANUAL_REVIEW"] },
    ] }));
    const body = await (await handle(new Request("https://tameion.invalid/api/operator/runtime-diagnostic"))).json();
    expect(body.observation_status).toBe("INCONSISTENT");
    expect(body.payables.every((row: { permitted_next_actions: string[] }) => row.permitted_next_actions.length === 0)).toBe(true);
  });

  it("does not advertise commands when the capability gate is missing", async () => {
    const { handle } = handler(async () => internal({ capabilities: caps("MISSING") }));
    const response = await handle(new Request("https://tameion.invalid/api/operator/runtime-diagnostic"));
    const body = await response.json();
    expect(body.capabilities.status).toBe("MISSING");
    expect(body.payables[5]).toMatchObject({ blocking_reason_code: "RECOVERY_MIGRATION_REQUIRED", permitted_next_actions: [] });
  });

  it("reports the legacy-path ingress gap separately from an unavailable capability read", async () => {
    const { handle } = handler(async () => internal({ diagnostic_meta: { observation_status: "CONSISTENT", observation_reason_code: null, binding_namespaces: ["SYNTHETIC-LEGACY-NAMESPACE"], source_path: "LEGACY_ADVISORY", source_reason_codes: ["LEGACY_ADVISORY_SELECTED"] }, capabilities: null, obligations: [] }));
    const body = await (await handle(new Request("https://tameion.invalid/api/operator/runtime-diagnostic"))).json();
    expect(body.source_path).toMatchObject({ selected: "LEGACY_ADVISORY", reason_codes: ["LEGACY_ADVISORY_SELECTED"] });
    expect(body.capabilities).toMatchObject({ status: "UNAVAILABLE", reason_codes: ["CAPABILITY_RPC_UNAVAILABLE"] });
    expect(body.payables.every((row: { blocking_reason_code: string; permitted_next_actions: string[] }) => row.blocking_reason_code === "PAYABLE_NOT_PRESENT" && row.permitted_next_actions.length === 0)).toBe(true);
  });

  it("fails closed on an inconsistent read vector", async () => {
    const { handle } = handler(async () => internal({ diagnostic_meta: { observation_status: "INCONSISTENT", observation_reason_code: "STATE_REVISION_CHANGED", binding_namespaces: ["NAMESPACE"], source_path: "RECOVERABLE_SOURCE_INGRESS", source_reason_codes: ["RECOVERABLE_INGRESS_SELECTED"] }, obligations: [{ obligation_id: "OBL-SWD-20261014-001", diagnostic_binding_namespace: "NAMESPACE", stage2_status: "UNRESOLVED_OPERATION" }] }));
    const body = await (await handle(new Request("https://tameion.invalid/api/operator/runtime-diagnostic"))).json();
    expect(body.observation_status).toBe("INCONSISTENT");
    expect(body.observation_reason_code).toBe("STATE_REVISION_CHANGED");
    expect(body.payables.every((row: { permitted_next_actions: string[] }) => row.permitted_next_actions.length === 0)).toBe(true);
  });

  it("distinguishes unresolved assessment from uncertain settlement", async () => {
    const { handle } = handler(async () => internal({ obligations: [
      { obligation_id: "OBL-J0C-001", diagnostic_binding_namespace: "SYNTHETIC-SECRET-NAMESPACE", stage2_status: "UNKNOWN" },
      { obligation_id: "OBL-SWD-20261014-001", diagnostic_binding_namespace: "SYNTHETIC-SECRET-NAMESPACE", blockers: [{ code: "OUTCOME_UNKNOWN", stage: "RECONCILIATION" }] },
      { obligation_id: "OBL-J0C-002", diagnostic_binding_namespace: "SYNTHETIC-SECRET-NAMESPACE", stage2_status: "READY_FOR_REVIEW", blockers: [{ code: "SOURCE_HISTORY_LIMIT" }] },
      { obligation_id: "OBL-J0C-003", diagnostic_binding_namespace: "SYNTHETIC-SECRET-NAMESPACE", fresh_assessment_readiness: { ready: false, blocker: "SOURCE_ASSESSMENT_CONTEXT_REQUIRED" } },
    ] }));
    const body = await (await handle(new Request("https://tameion.invalid/api/operator/runtime-diagnostic"))).json();
    expect(body.payables[0].blocking_reason_code).toBe("ASSESSMENT_OUTCOME_UNKNOWN");
    expect(body.payables[0].stage).toBe("ASSESSMENT");
    expect(body.payables[5].blocking_reason_code).toBe("SETTLEMENT_OUTCOME_UNKNOWN");
    expect(body.payables[5].stage).toBe("RECONCILIATION");
    expect(body.payables[1].blocking_reason_code).toBe("SOURCE_HISTORY_LIMIT");
    expect(body.payables[2].blocking_reason_code).toBe("ASSESSMENT_CONTEXT_REQUIRED");
  });

  it("does not treat display affordances as admitted commands and requires valid build identity", async () => {
    const { handle } = handler(async () => internal(), { SUPABASE_URL: "https://project-ref.supabase.co", VERCEL_DEPLOYMENT_ID: "bad value", VERCEL_GIT_COMMIT_SHA: "not-a-sha", VERCEL_ENV: "production" });
    const body = await (await handle(new Request("https://tameion.invalid/api/operator/runtime-diagnostic"))).json();
    expect(body.observation_status).toBe("UNAVAILABLE");
    expect(body.observation_reason_code).toBe("BUILD_IDENTITY_INCOMPLETE");
    expect(body.build).toMatchObject({ deployment_id: null, commit_sha: null, environment: "production", reason_code: "BUILD_IDENTITY_INCOMPLETE" });
    expect(body.payables.every((row: { permitted_next_actions: string[] }) => row.permitted_next_actions.length === 0)).toBe(true);
  });

  it("rejects non-GET requests without evaluating data", async () => {
    const evaluate = vi.fn(async () => internal());
    const { handle } = handler(evaluate);
    expect((await handle(new Request("https://tameion.invalid", { method: "POST" }))).status).toBe(405);
    expect(evaluate).not.toHaveBeenCalled();
  });
});
