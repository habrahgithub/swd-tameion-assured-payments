import { describe, expect, it } from "vitest";

import { DEMO_ORGANIZATION_ID, DEMO_SIGNING_KEY_ID, DemoState } from "../src/server/demo-state";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { currentAssessmentReview, sealTestAssessment } from "./test-support/seal-assessment";

function assessEveryObligation(state: DemoState): void {
  for (const obligation of state.listObligations()) {
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, obligation.obligation_id);
    // This suite exercises persistence mechanics using an explicit trusted
    // test fixture; ordinary DemoState seeds remain simulated and fail closed.
    state.store.seed({
      ...aggregate,
      destination_ref: `DEST-${obligation.obligation_id}-TEST-EVIDENCED`,
      source_wallet_ref: "WALLET-SOURCE-TEST-EVIDENCED",
      product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
    });
    sealTestAssessment(state.store, DEMO_ORGANIZATION_ID, obligation.obligation_id, aggregate.aggregate_version);
  }
}

function authorize(state: DemoState, obligationId: string) {
  const result = approveAndSealPae(state.store, DEMO_SIGNING_KEY_ID, {
    organizationId: DEMO_ORGANIZATION_ID,
    obligationId,
    expectedVersion: state.store.get(DEMO_ORGANIZATION_ID, obligationId).aggregate_version,
    ...currentAssessmentReview(state.store, DEMO_ORGANIZATION_ID, obligationId),
    actorId: "USR-TEST-OPERATOR",
    actorRole: "FINANCE_APPROVER",
    policyVersion: "POLICY-P0-1",
    reasonText: "Reviewed in durability restart test.",
  });
  state.recordAuthorization({
    approval_record: result.approvalRecord.record,
    approval_record_hash: result.approvalRecord.approval_record_hash,
    assurance_record: result.assuranceRecord.record,
    assurance_hash: result.assuranceRecord.assurance_hash,
    sealed_pae: result.sealed,
  });
  return result.sealed;
}

describe("durable demo-state restart boundaries", () => {
  it("preserves assessment state across restart and permits exact-version authorization", () => {
    const firstProcess = new DemoState();
    assessEveryObligation(firstProcess);
    const obligationId = firstProcess.listObligations()[0]!.obligation_id;
    const secondProcess = new DemoState(firstProcess.exportSnapshot());
    expect(secondProcess.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, obligationId)).toBeDefined();
    expect(secondProcess.store.findUnassessedObligation(DEMO_ORGANIZATION_ID)).toBeNull();

    const sealed = authorize(secondProcess, obligationId);
    expect(sealed.payload.signing_key_id).toBe(DEMO_SIGNING_KEY_ID);
    expect(sealed.payload.obligation_ids).toEqual([obligationId]);
    expect(secondProcess.exportSnapshot().authorization_history).toHaveLength(1);
  });

  it("preserves authorization and sealed PAE across restart so execution remains idempotent", async () => {
    const beforeRestart = new DemoState();
    assessEveryObligation(beforeRestart);
    const obligationId = beforeRestart.listObligations()[0]!.obligation_id;
    const sealed = authorize(beforeRestart, obligationId);
    const afterRestart = new DemoState(beforeRestart.exportSnapshot());

    const result = await afterRestart.worker.execute(sealed);
    expect(result.status).toBe("SETTLED");
    expect(afterRestart.adapter.getSubmissionCount()).toBe(1);
    expect(afterRestart.exportSnapshot().authorization_history[0]?.sealed_pae.instruction_hash).toBe(sealed.instruction_hash);
  });

  it("preserves UNKNOWN across restart and reconciles provider truth without resubmitting", async () => {
    const beforeRestart = new DemoState();
    assessEveryObligation(beforeRestart);
    const obligationId = beforeRestart.listObligations()[0]!.obligation_id;
    const sealed = authorize(beforeRestart, obligationId);
    beforeRestart.adapter.queueOutcome("TIMEOUT");
    const unknown = await beforeRestart.worker.execute(sealed);
    expect(unknown.status).toBe("UNKNOWN");
    const afterRestart = new DemoState(beforeRestart.exportSnapshot());
    afterRestart.adapter.resolvePending(unknown.provider_ref!, "CONFIRMED");

    const reconciled = await afterRestart.worker.reconcilePendingByIdempotencyKey(sealed.payload.idempotency_key, DEMO_ORGANIZATION_ID);
    expect(reconciled.status).toBe("SETTLED");
    expect(afterRestart.adapter.getSubmissionCount()).toBe(1);
  });
});
