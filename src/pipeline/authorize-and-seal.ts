import { randomUUID } from "node:crypto";

import type { AuthorityAggregate, AuthorityStore } from "../authority/aggregate";
import { AuthorityError } from "../authority/aggregate";
import { runSafetyKernel, SAFETY_KERNEL_VERSION, type SafetyKernelResult } from "../safety-kernel/kernel";
import { hashApprovalReason, sealDurableApprovalRecord, sealDurableAssuranceRecord } from "../pae/durable-records";
import { loadServerSigningKey } from "../pae/keys";
import { sealPae } from "../pae/sign-verify";
import type { ControlResult, PaeUnsignedPayload, SealedPae } from "../domain/schemas";

export class AssuranceFailedError extends Error {
  constructor(
    message: string,
    public readonly overall: "HOLD" | "BLOCK",
    /** The real per-control breakdown from the Safety Kernel that produced
     * this failure — structured, not just embedded in the message string,
     * so callers can display exactly which control(s) failed. */
    public readonly controlResults: ControlResult[],
  ) {
    super(message);
    this.name = "AssuranceFailedError";
  }
}

export interface ApprovalInput {
  organizationId: string;
  obligationId: string;
  expectedVersion: number;
  actorId: string;
  actorRole: string;
  policyVersion: string;
  reasonText: string;
  now?: () => Date;
}

/**
 * The full P0 Golden Flow from human approval through a sealed PAE:
 *   1. atomic reviewed N -> authorized N+1 transition;
 *   2. durable approval record + hash;
 *   3. final Safety Kernel on authorized N+1 (must be PASS to proceed);
 *   4. durable assurance record + hash;
 *   5. build + sign the PAE bound to N+1.
 *
 * If the Safety Kernel does not return PASS, no PAE is built or signed —
 * there is no path from HOLD/BLOCK to a sealed envelope.
 */
export function approveAndSealPae(
  store: AuthorityStore,
  signingKeyId: string,
  input: ApprovalInput,
): {
  aggregate: AuthorityAggregate;
  sealed: SealedPae;
  safetyKernel: SafetyKernelResult;
  approvalRecord: ReturnType<typeof sealDurableApprovalRecord>;
  assuranceRecord: ReturnType<typeof sealDurableAssuranceRecord>;
} {
  const now = input.now ?? (() => new Date());
  const isoNow = now().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");
  const current = store.get(input.organizationId, input.obligationId);
  if (current.aggregate_version !== input.expectedVersion) {
    // Preserve the authority store's canonical STALE_STATE rejection before
    // checking assessment availability for an obsolete version.
    store.approve(input.organizationId, input.obligationId, input.expectedVersion);
  }
  const assessment = store.getCurrentAssessment(input.organizationId, input.obligationId);
  if (!assessment || assessment.record.aggregate_version !== String(input.expectedVersion)) {
    throw new AuthorityError("Cannot authorize without a current assessment bound to the reviewed aggregate version", "AUT-009");
  }

  const aggregate = store.approve(input.organizationId, input.obligationId, input.expectedVersion);

  const reasonHash = hashApprovalReason(input.reasonText);
  const approvalId = `APR-${randomUUID()}`;
  const { record: approvalRecord, approval_record_hash } = sealDurableApprovalRecord({
    approval_id: approvalId,
    organization_id: input.organizationId,
    obligation_id: input.obligationId,
    actor_id: input.actorId,
    actor_role: input.actorRole,
    action: "APPROVE",
    authority_version: "1",
    reviewed_aggregate_version: String(input.expectedVersion),
    authorized_aggregate_version: String(aggregate.aggregate_version),
    policy_version: input.policyVersion,
    previous_state: "APPROVAL_PENDING",
    new_state: "AUTHORIZED",
    approved_at: isoNow,
    reason_hash: reasonHash,
    assessment_id: assessment.record.assessment_id,
    assessment_hash: assessment.hash,
  });

  const safetyResult = runSafetyKernel(aggregate, store);
  if (safetyResult.overall !== "PASS") {
    throw new AssuranceFailedError(
      `Safety Kernel did not PASS (${safetyResult.overall}): ${JSON.stringify(safetyResult.controlResults)}`,
      safetyResult.overall,
      safetyResult.controlResults,
    );
  }

  const { record: assuranceRecord, assurance_hash } = sealDurableAssuranceRecord({
    assurance_id: `ASR-${randomUUID()}`,
    organization_id: input.organizationId,
    obligation_id: input.obligationId,
    aggregate_version: String(aggregate.aggregate_version),
    result: "PASS",
    policy_version: input.policyVersion,
    safety_kernel_version: SAFETY_KERNEL_VERSION,
    assessed_at: isoNow,
    control_results: safetyResult.controlResults,
  });

  store.markPaeSealed(input.organizationId, input.obligationId, aggregate.aggregate_version);

  const { privateKey } = loadServerSigningKey(signingKeyId);
  const expiry = new Date(now().getTime() + 30 * 60 * 1000).toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z");

  const unsignedPayload: PaeUnsignedPayload = {
    signing_key_id: signingKeyId,
    signing_algorithm: "Ed25519",
    pae_schema_version: "PAE-P0-1",
    instruction_id: `INSTR-${randomUUID()}`,
    organization_id: input.organizationId,
    obligation_ids: [input.obligationId],
    evidence_hashes: [...aggregate.evidence_hashes].sort(),
    counterparty_id: aggregate.counterparty_id,
    counterparty_version: String(aggregate.counterparty_version),
    source_wallet_ref: aggregate.source_wallet_ref,
    source_wallet_version: String(aggregate.source_wallet_version),
    destination_ref: aggregate.destination_ref,
    destination_version: String(aggregate.destination_version),
    destination_address: aggregate.destination_address,
    amount: aggregate.amount,
    atomic_amount: (() => {
      // exact atomic conversion is re-derived here, not trusted from elsewhere.
      const [whole, fractional] = aggregate.amount.split(".");
      return (BigInt(whole) * 1_000_000n + BigInt(fractional)).toString(10);
    })(),
    asset: aggregate.asset,
    network: aggregate.network,
    policy_version: input.policyVersion,
    approval_evidence: [
      {
        approval_id: approvalId,
        organization_id: input.organizationId,
        obligation_id: input.obligationId,
        actor_id: input.actorId,
        actor_role: input.actorRole,
        authority_version: "1",
        reviewed_aggregate_version: String(input.expectedVersion),
        authorized_aggregate_version: String(aggregate.aggregate_version),
        approved_at: isoNow,
        policy_version: input.policyVersion,
        approval_record_hash,
        assessment_id: assessment.record.assessment_id,
        assessment_hash: assessment.hash,
      },
    ],
    assurance_hash,
    aggregate_version: String(aggregate.aggregate_version),
    expiry,
    nonce: randomUUID(),
    idempotency_key: `idem-${input.organizationId}-${input.obligationId}-${aggregate.aggregate_version}`,
  };

  const sealed = sealPae(unsignedPayload, privateKey);
  return {
    aggregate,
    sealed,
    safetyKernel: safetyResult,
    approvalRecord: { record: approvalRecord, approval_record_hash },
    assuranceRecord: { record: assuranceRecord, assurance_hash },
  };
}

export { AuthorityError };
