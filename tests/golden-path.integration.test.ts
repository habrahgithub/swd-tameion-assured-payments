import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { buildFinanceAgentContext, type LiveUsageObligationRecord } from "../src/agent/context-builder";
import { assessObligation, selectSoleCandidate } from "../src/agent/finance-agent";
import { DeterministicFallbackProvider } from "../src/agent/ai-provider";
import { AuthorityStore, type AuthorityAggregate } from "../src/authority/aggregate";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { ExecutionWorker } from "../src/execution/worker";
import { FakeProviderAdapter } from "../src/execution/fake-provider-adapter";
import { currentAssessmentReview, sealTestAssessment } from "./test-support/seal-assessment";

/**
 * End-to-end proof of the P0 Golden Flow using the ACTUAL genuine,
 * privacy-safe J0-C obligation dataset (data/live-usage/LIVE_USAGE_SET.json)
 * rather than synthetic test fixtures:
 *
 *   real obligations -> Finance Agent assessment (all 5) -> sole-candidate
 *   selection -> T1 human approval N->N+1 -> Safety Kernel PASS on N+1 ->
 *   signed PAE -> Execution Worker -> (mocked testnet) settlement ->
 *   one-to-one reconciliation.
 *
 * Execution is against FakeProviderAdapter because no live Circle/Arc
 * credentials exist in this build environment — this test proves the
 * product logic, not live testnet connectivity.
 */
describe("P0 Golden Flow — real J0-C obligations end to end (mocked execution)", () => {
  const fixturePath = path.join(__dirname, "../data/live-usage/LIVE_USAGE_SET.json");
  const liveUsageSet = JSON.parse(readFileSync(fixturePath, "utf8")) as {
    records: LiveUsageObligationRecord[];
  };

  it("assesses all genuine obligations, selects one candidate, and authorizes+executes it", async () => {
    expect(liveUsageSet.records.length).toBeGreaterThanOrEqual(3);
    expect(liveUsageSet.records.length).toBeLessThanOrEqual(5);

    const provider = new DeterministicFallbackProvider();
    const decisions = await Promise.all(
      liveUsageSet.records.map((record) => assessObligation(buildFinanceAgentContext(record), provider)),
    );

    // Obligation assessment cannot default to PAY without complete evidence
    // and a known due date. Payment-route assurance is evaluated separately.
    for (const decision of decisions) {
      if (decision.decision === "PAY") {
        expect(decision.missing_evidence).toHaveLength(0);
      }
    }

    const dueDates = Object.fromEntries(liveUsageSet.records.map((r) => [r.obligation_id, r.due_date]));
    const selection = selectSoleCandidate(decisions, dueDates);

    // The immutable J0-C source snapshot has pending historical destination
    // readiness, which does not suppress an otherwise eligible assessment.
    expect(selection.selected_obligation_id).toBe("OBL-J0C-005");

    // Prove the rest of the pipeline (approval -> Safety Kernel -> PAE ->
    // execution -> reconciliation) against a clearly test-only fixture with
    // current product-trust provenance set explicitly for this valid path.
    const candidateRecord = liveUsageSet.records.find((r) => r.obligation_id === selection.selected_obligation_id)!;
    const [wholePart, fractionalPart] = candidateRecord.amount.split(".");
    const sixDpAmount = `${wholePart}.${fractionalPart.padEnd(6, "0")}`;

    const store = new AuthorityStore();
    const aggregate: AuthorityAggregate = {
      organization_id: "ORG-DEMO-001",
      obligation_id: candidateRecord.obligation_id,
      aggregate_version: 1,
      state: "APPROVAL_PENDING",
      amount: sixDpAmount,
      asset: "USDC",
      network: "ARC_TESTNET",
      counterparty_id: "CP-J0C-003",
      counterparty_version: 1,
      counterparty_status: "VERIFIED",
      destination_ref: "DEST-J0C-003-SEEDED",
      destination_version: 1,
      product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
      // Test-only destination value; the test exercises the trusted path and
      // does not assert that J0-D established product destination trust.
      destination_address: `0x${"0".repeat(40)}`,
      destination_verification_status: "VERIFIED",
      destination_operational_status: "ACTIVE",
      source_wallet_ref: "WALLET-SOURCE-P0-1",
      source_wallet_version: 1,
      source_wallet_status: "ACTIVE",
      evidence_hashes: candidateRecord.source_evidence.map(() => "0".repeat(64)),
      policy_version: "POLICY-P0-1",
      business_hold: false,
      security_freeze: false,
      external_settlement_state: "NONE",
      pae_state: "UNUSED",
      execution_state: "NONE",
      execution_idempotency_key: null,
      reviewed_aggregate_version: null,
      source_amount: candidateRecord.amount,
      source_currency: candidateRecord.currency,
      settlement_conversion_rate: candidateRecord.currency === "USD" ? null : "3.6725",
    };
    store.seed(aggregate);
    // The explicit provenance above is test-only so this integration test can
    // continue exercising a valid approval/PAE/worker path.
    sealTestAssessment(store, "ORG-DEMO-001", candidateRecord.obligation_id, 1);

    const { sealed } = approveAndSealPae(store, "GOLDEN-PATH-TEST-KEY", {
      organizationId: "ORG-DEMO-001",
      obligationId: candidateRecord.obligation_id,
      expectedVersion: 1,
      ...currentAssessmentReview(store, "ORG-DEMO-001", candidateRecord.obligation_id),
      actorId: "USR-DEMO-OPERATOR",
      actorRole: "FINANCE_APPROVER",
      policyVersion: "POLICY-P0-1",
      reasonText: `Reviewed and approved ${candidateRecord.obligation_id} for one-obligation Arc Testnet product payment.`,
    });

    const adapter = new FakeProviderAdapter();
    adapter.queueOutcome("CONFIRMED");
    const worker = new ExecutionWorker(store, adapter);
    const record = await worker.execute(sealed);

    expect(record.status).toBe("SETTLED");
    expect(store.get("ORG-DEMO-001", candidateRecord.obligation_id).state).toBe("RECONCILED");
  });
});
