import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";
import { privateJson } from "./operator-auth";
import { obligationReaders } from "./operator-obligation-routes";
import type { RecoveryWorkflowCapabilities } from "./supabase-demo-state-repository";
import { methodNotAllowed } from "./route-access-policy";

export const RUNTIME_DIAGNOSTIC_PAYABLE_IDS = [
  "OBL-J0C-001", "OBL-J0C-002", "OBL-J0C-003", "OBL-J0C-004", "OBL-J0C-005", "OBL-SWD-20261014-001",
] as const;
const ACTIONS = new Set(["CREATE_SOURCE", "EDIT_SOURCE", "OBSERVE_AI_REQUEST", "REQUEST_AI_ADVICE", "MANUAL_REVIEW", "PREPARE_CONTROLLED_INSTRUCTION"]);
const OBSERVATION_REASONS = new Set(["SOURCE_INGRESS_NOT_ADMITTED", "READ_LIMIT_EXCEEDED", "STATE_REVISION_CHANGED", "STATE_READ_UNAVAILABLE", "CAPABILITY_RPC_UNAVAILABLE", "BINDING_INCOMPLETE", "BUILD_IDENTITY_INCOMPLETE", "OBSERVATION_UNAVAILABLE"]);
const CAPABILITY_REASONS = new Set(["CAPABILITY_CONTRACT_READY", "CAPABILITY_RPC_MISSING", "CAPABILITY_RPC_UNAVAILABLE", "CAPABILITY_SCHEMA_VERSION_MISMATCH", "REQUIRED_CAPABILITY_MISSING", "CAPABILITY_RESULT_INCONSISTENT", "CAPABILITY_NOT_EVALUATED_FOR_LEGACY_PATH"]);
const BLOCKERS = new Set([
  "SOURCE_INGRESS_NOT_ADMITTED", "SOURCE_PERMISSION_REQUIRED", "INGRESS_EXPIRED", "SOURCE_BINDING_CHANGED", "SOURCE_HISTORY_LIMIT",
  "EXISTING_FINANCIAL_CLAIM", "UNRESOLVED_OPERATION", "CURRENT_HUMAN_REVIEW_REQUIRED", "SOURCE_NOT_FOUND",
  "ASSESSMENT_OUTCOME_UNKNOWN", "ASSESSMENT_CONTEXT_REQUIRED", "ASSESSMENT_ADMISSION_REQUIRED", "SETTLEMENT_OUTCOME_UNKNOWN", "HUMAN_REVIEW_CURRENT", "READY_FOR_REVIEW", "RECOVERY_MIGRATION_REQUIRED", "STATE_UNAVAILABLE", "PREDICATE_UNAVAILABLE", "PAYABLE_NOT_PRESENT",
]);

type InternalDiagnostic = {
  diagnostic_meta?: { observation_status?: string; observation_reason_code?: string | null; binding_namespaces?: unknown; source_path?: string; source_reason_codes?: unknown };
  capabilities?: RecoveryWorkflowCapabilities | null;
  obligations?: unknown;
  allowed_actions?: unknown;
};
type RuntimeDiagnosticDependencies = {
  evaluate: (request: Request) => Promise<Response>;
  env: Record<string, string | undefined>;
  now: () => Date;
};

function projectReference(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.pathname !== "" && url.pathname !== "/" || url.search || url.hash) return null;
    const match = /^([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname);
    return match?.[1] ?? null;
  } catch { return null; }
}

export function runtimeBindingFingerprint(projectRef: string | null, namespace: string | null): string | null {
  if (!projectRef || !namespace || namespace.length > 128) return null;
  const canonical = canonicalize({ project_ref: projectRef, namespace });
  return createHash("sha256").update("tameion/runtime-binding/v1\0").update(canonical).digest("hex");
}

function capabilityProjection(value: RecoveryWorkflowCapabilities | null | undefined) {
  const keys = ["human_authorization_history", "shared_wallet_namespace_lock", "parent_child_retirement_lock", "immutable_recovery_receipts"] as const;
  if (!value || !["READY", "MISSING", "UNAVAILABLE", "INCONSISTENT"].includes(value.status)) {
    return { status: "UNAVAILABLE", reason_codes: ["CAPABILITY_RPC_UNAVAILABLE"], schema_version: null, required: Object.fromEntries(keys.map(key => [key, true])), available: Object.fromEntries(keys.map(key => [key, false])) };
  }
  const schemaVersion = Number.isSafeInteger(value.schema_version) && value.schema_version! >= 0 ? value.schema_version : null;
  return {
    status: value.status,
    reason_codes: Array.isArray(value.reason_codes) ? [...new Set(value.reason_codes.filter(code => CAPABILITY_REASONS.has(code)))].slice(0, 4) : ["CAPABILITY_RESULT_INCONSISTENT"],
    schema_version: schemaVersion,
    required: Object.fromEntries(keys.map(key => [key, true])),
    available: Object.fromEntries(keys.map(key => [key, value.available[key] === true])),
  };
}

function primaryBlocker(row: Record<string, unknown>): string {
  const rowBlockers = Array.isArray(row.blockers) ? row.blockers : [];
  const reconciliationUnknown = rowBlockers.find((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).stage === "RECONCILIATION" && (entry as Record<string, unknown>).code === "OUTCOME_UNKNOWN"));
  if (reconciliationUnknown) return "SETTLEMENT_OUTCOME_UNKNOWN";
  if (rowBlockers.some(entry => Boolean(entry && typeof entry === "object" && !Array.isArray(entry) && (entry as Record<string, unknown>).code === "SOURCE_HISTORY_LIMIT"))) return "SOURCE_HISTORY_LIMIT";
  const assessment = row.genuine_assessment;
  if (assessment && typeof assessment === "object" && "status" in assessment && ["UNKNOWN", "IN_PROGRESS"].includes(String(assessment.status))) return "ASSESSMENT_OUTCOME_UNKNOWN";
  const fresh = row.fresh_assessment_readiness;
  if (fresh && typeof fresh === "object" && "blocker" in fresh) {
    if (fresh.blocker === "SOURCE_ASSESSMENT_CONTEXT_REQUIRED") return "ASSESSMENT_CONTEXT_REQUIRED";
    if (fresh.blocker === "EXISTING_ASSESSMENT_ADMISSION_REQUIRED") return "ASSESSMENT_ADMISSION_REQUIRED";
  }
  const status = row.stage2_status;
  const stage = typeof status === "string" ? status : status && typeof status === "object" && "code" in status && typeof status.code === "string" ? status.code : "";
  if (stage === "SOURCE_PERMISSION_REQUIRED") return "SOURCE_PERMISSION_REQUIRED";
  if (["SOURCE_BINDING_CHANGED", "SOURCE_CHANGED"].includes(stage)) return "SOURCE_BINDING_CHANGED";
  if (["EXISTING_FINANCIAL_CLAIM", "FINANCIAL_HISTORY"].includes(stage)) return "EXISTING_FINANCIAL_CLAIM";
  if (stage === "OUTCOME_UNKNOWN") return "SETTLEMENT_OUTCOME_UNKNOWN";
  if (["UNRESOLVED_OPERATION", "UNKNOWN", "IN_PROGRESS", "RESERVED", "PROVIDER_RESULT_DURABLE"].includes(stage)) return "ASSESSMENT_OUTCOME_UNKNOWN";
  if (stage === "HUMAN_REVIEW_CURRENT") return "HUMAN_REVIEW_CURRENT";
  if (stage === "READY_FOR_REVIEW") return "READY_FOR_REVIEW";
  const first = rowBlockers.find((entry): entry is Record<string, unknown> => Boolean(entry && typeof entry === "object" && !Array.isArray(entry)));
  const code = typeof first?.code === "string" ? first.code : stage;
  return BLOCKERS.has(code) ? code : "PREDICATE_UNAVAILABLE";
}

function stageProjection(row: Record<string, unknown>, blocker: string): string {
  const allowed = new Set(["OBLIGATION", "ASSESSMENT", "AUTHORIZATION", "ASSURANCE", "PAYMENT", "RECONCILIATION"]);
  if (blocker === "SETTLEMENT_OUTCOME_UNKNOWN") return "RECONCILIATION";
  return typeof row.stage === "string" && allowed.has(row.stage) ? row.stage : "ASSESSMENT";
}

export function createRuntimeDiagnosticHandler(deps: RuntimeDiagnosticDependencies) {
  return async function GET(request: Request): Promise<Response> {
    if (request.method !== "GET") return methodNotAllowed();
    try {
      const internalResponse = await deps.evaluate(request);
      // The shared evaluator authenticates before reading any source or state.
      // Preserve its standard fail-closed response without adding diagnostics.
      const internal = await internalResponse.clone().json() as InternalDiagnostic;
      if (!internalResponse.ok && !internal.diagnostic_meta) return internalResponse;
      const meta = internal.diagnostic_meta;
      const projectRef = projectReference(deps.env.SUPABASE_URL);
      const rawNamespaces = Array.isArray(meta?.binding_namespaces) ? meta.binding_namespaces : [];
      const namespaces = [...new Set(rawNamespaces.filter((value): value is string => typeof value === "string" && value.length > 0 && value.length <= 128))];
      const fingerprintByNamespace = new Map<string, string | null>(namespaces.map(namespace => [namespace, runtimeBindingFingerprint(projectRef, namespace)]));
      const bindings = namespaces.length
        ? namespaces.map(namespace => ({ fingerprint: fingerprintByNamespace.get(namespace) ?? null, reason_code: fingerprintByNamespace.get(namespace) ? "BINDING_READY" : "BINDING_INCOMPLETE" }))
        : [{ fingerprint: null, reason_code: "BINDING_INCOMPLETE" }];
      const bindingReady = bindings.length > 0 && bindings.every(binding => binding.fingerprint !== null);
      const deploymentCandidate = deps.env.VERCEL_DEPLOYMENT_ID;
      const commitCandidate = deps.env.VERCEL_GIT_COMMIT_SHA;
      const build = {
        deployment_id: deploymentCandidate && /^[A-Za-z0-9_-]{1,128}$/.test(deploymentCandidate) ? deploymentCandidate : null,
        commit_sha: commitCandidate && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(commitCandidate) ? commitCandidate.toLowerCase() : null,
        environment: ["production", "preview", "development"].includes(deps.env.VERCEL_ENV ?? "") ? deps.env.VERCEL_ENV! : "unknown",
      };
      const buildReady = build.deployment_id !== null && build.commit_sha !== null && build.environment !== "unknown";
      const capabilities = capabilityProjection(internal.capabilities);
      const rawRows = Array.isArray(internal.obligations) ? internal.obligations : [];
      const byId = new Map<string, Record<string, unknown>>();
      const duplicateIds = new Set<string>();
      for (const value of rawRows) {
        if (!value || typeof value !== "object" || Array.isArray(value)) continue;
        const row = value as Record<string, unknown>;
        if (typeof row.obligation_id === "string" && (RUNTIME_DIAGNOSTIC_PAYABLE_IDS as readonly string[]).includes(row.obligation_id)) {
          if (byId.has(row.obligation_id)) duplicateIds.add(row.obligation_id);
          else byId.set(row.obligation_id, row);
        }
      }
      const rowBindingMismatch = [...byId.values()].some(row => {
        const ns = row.diagnostic_binding_namespace;
        return typeof ns !== "string" || !fingerprintByNamespace.has(ns);
      }) || duplicateIds.size > 0;
      const internallyConsistent = meta?.observation_status === "CONSISTENT" && bindingReady && buildReady && !rowBindingMismatch;
      const observationStatus = meta?.observation_status === "INCONSISTENT" || rowBindingMismatch ? "INCONSISTENT" : !internallyConsistent ? "UNAVAILABLE" : "CONSISTENT";
      const actionsEnabled = observationStatus === "CONSISTENT" && capabilities.status === "READY";
      const payables = RUNTIME_DIAGNOSTIC_PAYABLE_IDS.map(obligation_id => {
        const row = byId.get(obligation_id);
        if (!row) return { obligation_id, binding_fingerprint: null, stage: "ASSESSMENT", blocking_reason_code: "PAYABLE_NOT_PRESENT", permitted_next_actions: [] };
        // The shared read model's allowed_actions are display affordances. This
        // endpoint does not execute mutation admission and must not present them
        // as approved commands.
        const actions = Array.isArray(row.command_admitted_actions) ? row.command_admitted_actions.filter((action): action is string => typeof action === "string" && ACTIONS.has(action)) : [];
        const namespace = typeof row.diagnostic_binding_namespace === "string" ? row.diagnostic_binding_namespace : null;
        const fingerprint = namespace === null ? null : fingerprintByNamespace.get(namespace) ?? null;
        const blockingReason = capabilities.status === "READY" ? primaryBlocker(row) : "RECOVERY_MIGRATION_REQUIRED";
        return {
          obligation_id,
          binding_fingerprint: fingerprint,
          stage: stageProjection(row, blockingReason),
          blocking_reason_code: blockingReason,
          permitted_next_actions: actionsEnabled ? [...new Set(actions)] : [],
        };
      });
      const missingBuild = !buildReady;
      const body = {
        schema_version: 1,
        observation_status: observationStatus,
        observation_reason_code: observationStatus === "CONSISTENT" ? null : typeof meta?.observation_reason_code === "string" && OBSERVATION_REASONS.has(meta.observation_reason_code) ? meta.observation_reason_code : (rowBindingMismatch ? "STATE_REVISION_CHANGED" : !bindingReady ? "BINDING_INCOMPLETE" : !buildReady ? "BUILD_IDENTITY_INCOMPLETE" : "OBSERVATION_UNAVAILABLE"),
        observed_at: deps.now().toISOString(),
        build: { ...build, reason_code: missingBuild ? "BUILD_IDENTITY_INCOMPLETE" : null },
        binding: {
          fingerprint_algorithm: "sha256-canonical-v1",
          bindings,
          project_ref_present: projectRef !== null,
          namespace_present: namespaces.length > 0,
          namespace_source: namespaces.length > 0 ? "operator_source" : "unavailable",
        },
        capabilities,
        source_path: {
          selected: ["RECOVERABLE_SOURCE_INGRESS", "LEGACY_ADVISORY", "PUBLIC_SOURCE", "CONTROLLED_FINANCIAL", "NONE", "AMBIGUOUS"].includes(meta?.source_path ?? "") ? meta!.source_path : "NONE",
          reason_codes: Array.isArray(meta?.source_reason_codes) ? meta!.source_reason_codes.filter((code): code is string => typeof code === "string" && ["RECOVERABLE_INGRESS_SELECTED", "INGRESS_ABSENT", "SOURCE_DOCUMENT_UNAVAILABLE", "LEGACY_ADVISORY_SELECTED", "CONTROLLED_SOURCE_SELECTED", "SOURCE_PATH_AMBIGUOUS"].includes(code)).slice(0, 4) : ["SOURCE_DOCUMENT_UNAVAILABLE"],
        },
        payables,
      };
      return privateJson(body, internalResponse.ok ? 200 : internalResponse.status);
    } catch {
      return privateJson({ code: "DIAGNOSTIC_UNAVAILABLE" }, 503);
    }
  };
}

export const runtimeDiagnosticHandler = createRuntimeDiagnosticHandler({
  evaluate: request => obligationReaders.diagnostic(request),
  env: process.env,
  now: () => new Date(),
});
