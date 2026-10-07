import {
  durableApprovalRecordSchema,
  durableAssuranceRecordSchema,
  sealedPaeSchema,
  REQUIRED_CONTROL_IDS_P0,
  type ControlResult,
  type DurableApprovalRecord,
  type DurableAssuranceRecord,
  type SealedPae,
} from "../domain/schemas";
import { canonicalBytes, sha256Hex } from "../pae/canonicalize";
import { PaeKeyError, TrustedKeyRegistry, type TrustedKeyEntry } from "../pae/keys";
import { PaeVerificationError, verifySealedPae } from "../pae/sign-verify";
import { verifyDurableApprovalRecordHash, verifyDurableAssuranceRecordHash } from "../pae/durable-records";
import { ZodError } from "zod";

export type AssuranceEvidenceState =
  | "NOT_CREATED"
  | "AVAILABLE_CURRENT_BINDING"
  | "AVAILABLE_HISTORICAL"
  | "UNAVAILABLE"
  | "INVALID";

export interface AssuranceEvidenceProjectionInput {
  organizationId: string;
  obligationId: string;
  aggregate: {
    aggregate_version: number;
    state: string;
    policy_version: string;
    pae_state: string;
    execution_state: string;
  };
  executionReleaseAuthority: string;
  executionKillSwitched: boolean;
  execution: { status: string } | null;
  sealedPae: SealedPae | null;
  authorizationArtifacts: unknown | null;
  trustedKeys: TrustedKeyEntry[];
  now: Date;
}

export type AssuranceEvidenceProjection =
  | { state: "NOT_CREATED" | "UNAVAILABLE" | "INVALID"; message: string; control_results: []; recorded_at?: never }
  | {
      state: "AVAILABLE_CURRENT_BINDING" | "AVAILABLE_HISTORICAL";
      message: string;
      control_results: ControlResult[];
      overall: "PASS";
      assurance_id: string;
      recorded_at: string;
      aggregate_version: string;
      policy_version: string;
    };

const MESSAGES: Record<AssuranceEvidenceState, string> = {
  NOT_CREATED: "No assurance PASS evidence exists for this state.",
  AVAILABLE_CURRENT_BINDING: "Recorded PASS evidence for this aggregate — evidence only; execution still requires all current gates.",
  AVAILABLE_HISTORICAL: "Historical PASS evidence — recorded at authorization; not permission to execute now.",
  UNAVAILABLE: "Assurance evidence is expected but unavailable.",
  INVALID: "Stored assurance evidence failed integrity validation and is not usable.",
};

export function assuranceEvidenceMessage(state: AssuranceEvidenceState): string {
  return MESSAGES[state];
}

function invalid(): AssuranceEvidenceProjection {
  return { state: "INVALID", message: MESSAGES.INVALID, control_results: [] };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function artifactsFrom(value: unknown): {
  approval: DurableApprovalRecord;
  approvalHash: string;
  assurance: DurableAssuranceRecord;
  assuranceHash: string;
  sealed: SealedPae;
} | null {
  if (!isObject(value)) return null;
  const approval = durableApprovalRecordSchema.safeParse(value.approval_record);
  const assurance = durableAssuranceRecordSchema.safeParse(value.assurance_record);
  const sealed = sealedPaeSchema.safeParse(value.sealed_pae);
  if (!approval.success || !assurance.success || !sealed.success ||
      typeof value.approval_record_hash !== "string" || !/^[0-9a-f]{64}$/.test(value.approval_record_hash) ||
      typeof value.assurance_hash !== "string" || !/^[0-9a-f]{64}$/.test(value.assurance_hash)) return null;
  return {
    approval: approval.data,
    approvalHash: value.approval_record_hash,
    assurance: assurance.data,
    assuranceHash: value.assurance_hash,
    sealed: sealed.data,
  };
}

export function projectAssuranceEvidence(input: AssuranceEvidenceProjectionInput): AssuranceEvidenceProjection {
  const artifactValue = input.authorizationArtifacts;
  // The aggregate may reflect a refusal after proxy preparation even when no
  // approval ever produced a signed assurance record. That is not revoked PAE.
  if (!artifactValue && !input.sealedPae && !input.execution) {
    return { state: "NOT_CREATED", message: MESSAGES.NOT_CREATED, control_results: [] };
  }
  if (!artifactValue) return { state: "UNAVAILABLE", message: MESSAGES.UNAVAILABLE, control_results: [] };

  try {
    const artifacts = artifactsFrom(artifactValue);
    if (!artifacts) return invalid();
    const { approval, approvalHash, assurance, assuranceHash, sealed } = artifacts;
    const parsedSealed = sealedPaeSchema.safeParse(input.sealedPae);
    if (!parsedSealed.success) return invalid();
    const currentSealed = parsedSealed.data;
    const payload = sealed.payload;
    const evidence = payload.approval_evidence[0];

    if (!verifyDurableApprovalRecordHash(approval, approvalHash) ||
        !verifyDurableAssuranceRecordHash(assurance, assuranceHash) ||
        sha256Hex(canonicalBytes(payload)) !== sealed.instruction_hash ||
        currentSealed.instruction_hash !== sealed.instruction_hash || currentSealed.signature !== sealed.signature ||
        payload.organization_id !== input.organizationId || payload.obligation_ids[0] !== input.obligationId ||
        approval.organization_id !== input.organizationId || approval.obligation_id !== input.obligationId ||
        assurance.organization_id !== input.organizationId || assurance.obligation_id !== input.obligationId ||
        approval.organization_id !== assurance.organization_id || approval.obligation_id !== assurance.obligation_id ||
        approval.authorized_aggregate_version !== assurance.aggregate_version ||
        approval.authorized_aggregate_version !== payload.aggregate_version ||
        BigInt(approval.authorized_aggregate_version) !== BigInt(approval.reviewed_aggregate_version) + 1n ||
        approval.policy_version !== assurance.policy_version || approval.policy_version !== payload.policy_version ||
        approval.new_state !== "AUTHORIZED" ||
        payload.assurance_hash !== assuranceHash ||
        !evidence || payload.approval_evidence.length !== 1 ||
        evidence.approval_id !== approval.approval_id || evidence.organization_id !== approval.organization_id ||
        evidence.obligation_id !== approval.obligation_id || evidence.actor_id !== approval.actor_id ||
        evidence.actor_role !== approval.actor_role || evidence.authority_version !== approval.authority_version ||
        evidence.reviewed_aggregate_version !== approval.reviewed_aggregate_version ||
        evidence.authorized_aggregate_version !== approval.authorized_aggregate_version ||
        evidence.approved_at !== approval.approved_at || evidence.policy_version !== approval.policy_version ||
        evidence.approval_record_hash !== approvalHash || evidence.assessment_id !== approval.assessment_id ||
        evidence.assessment_hash !== approval.assessment_hash ||
        assurance.result !== "PASS" ||
        assurance.control_results.length !== REQUIRED_CONTROL_IDS_P0.length) return invalid();

    const controls = assurance.control_results;
    const controlIds = controls.map((control) => control.control_id);
    if (new Set(controlIds).size !== REQUIRED_CONTROL_IDS_P0.length ||
        REQUIRED_CONTROL_IDS_P0.some((id) => !controlIds.includes(id)) ||
        controls.some((control) => control.result !== "PASS")) return invalid();

    const trustedKey = input.trustedKeys.find((entry) => entry.signing_key_id === payload.signing_key_id);
    if (!trustedKey || trustedKey.signing_algorithm !== payload.signing_algorithm) return invalid();
    // Historical evidence still requires cryptographic verification. A temporary
    // isolated registry uses the stored public material for signature validation;
    // currentness below still requires the authoritative key to be ACTIVE.
    const verificationKeys = new TrustedKeyRegistry();
    verificationKeys.register({ ...trustedKey, status: "ACTIVE" });
    verifySealedPae(sealed, verificationKeys);

    const current =
      input.aggregate.state === "AUTHORIZED" &&
      input.aggregate.aggregate_version.toString() === assurance.aggregate_version &&
      input.aggregate.policy_version === assurance.policy_version &&
      input.aggregate.pae_state === "UNUSED" &&
      input.aggregate.execution_state === "NONE" &&
      input.execution === null &&
      input.executionReleaseAuthority === "TAMEION_PAE_REVERIFY_REQUIRED" &&
      input.executionKillSwitched === false &&
      trustedKey.status === "ACTIVE" &&
      Date.parse(payload.expiry) > input.now.getTime();

    return {
      state: current ? "AVAILABLE_CURRENT_BINDING" : "AVAILABLE_HISTORICAL",
      message: current ? MESSAGES.AVAILABLE_CURRENT_BINDING : MESSAGES.AVAILABLE_HISTORICAL,
      control_results: controls.map((control) => ({ ...control })),
      overall: "PASS",
      assurance_id: assurance.assurance_id,
      recorded_at: assurance.assessed_at,
      aggregate_version: assurance.aggregate_version,
      policy_version: assurance.policy_version,
    };
  } catch (error) {
    if (error instanceof ZodError || error instanceof PaeKeyError || error instanceof PaeVerificationError) return invalid();
    // Durable loading happens before projection and is not caught here. Unexpected
    // implementation errors also remain visible instead of being mislabeled as data.
    throw error;
  }
}
