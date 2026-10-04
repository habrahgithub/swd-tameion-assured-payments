import { randomUUID } from "node:crypto";

import { AuthorityStore, type AuthorityAggregate, type ObligationState } from "../authority/aggregate";
import { approveAndSealPae, AssuranceFailedError } from "../pipeline/authorize-and-seal";
import { ExecutionWorker, type ExecutionRecord } from "../execution/worker";
import { FakeProviderAdapter } from "../execution/fake-provider-adapter";
import type { ControlResult, DurableAssessmentRecord } from "../domain/schemas";
import type { RaceAssessment } from "../agent/schema";

/**
 * #44 admitted isolated synthetic demonstration slice: exercises the real
 * AuthorityStore / assessment sealing / Safety Kernel / PAE signing /
 * ExecutionWorker / FakeProviderAdapter pipeline against an obligation
 * identity that can never collide with a genuine OBL-J0C-* obligation, and
 * that never touches Supabase, Circle/Arc, J0-D, or any wallet/network
 * client. Everything here is in-memory, non-durable, and scoped to a
 * dedicated synthetic organization id.
 */

export const SIMULATED_HAPPY_PATH_LABEL = "SIMULATED_HAPPY_PATH" as const;
export const FAKE_PROVIDER_LABEL = "FAKE_TESTNET_ADAPTER" as const;
export const NOT_VENDOR_PAYMENT_LABEL = "NOT_VENDOR_PAYMENT" as const;

export const SIMULATED_HAPPY_PATH_OBLIGATION_ID = "DEMO-SIMULATED-HAPPY-001";
export const SIMULATED_BLOCKED_OBLIGATION_ID = "DEMO-SIMULATED-BLOCKED-001";
export const SIMULATED_ORGANIZATION_ID = "ORG-DEMO-SIMULATED";

/** Logical PAE signing key id for this isolated demo slice only; resolved
 * via the production signing-key loader (src/pae/keys.ts), never modified
 * or bypassed here. */
const SIMULATED_SIGNING_KEY_ID = "TAMEION-DEMO-SIMULATED-HAPPY-KEY-1";

/** Any obligation id matching the genuine J0-C pattern must never be used
 * by this synthetic demo path, under any circumstance. */
const GENUINE_OBLIGATION_ID_PATTERN = /^OBL-J0C-/;

export class SimulatedDemoGuardError extends Error {
  constructor(
    message: string,
    public readonly code: string = "DEMO-001",
  ) {
    super(message);
    this.name = "SimulatedDemoGuardError";
  }
}

function assertSyntheticObligationId(obligationId: string): void {
  if (GENUINE_OBLIGATION_ID_PATTERN.test(obligationId)) {
    throw new SimulatedDemoGuardError(
      `Refusing to operate on a genuine-pattern obligation id in the isolated simulated demo path: ${obligationId}`,
      "DEMO-001",
    );
  }
}

interface SeedOptions {
  destinationRef: string;
  sourceWalletRef: string;
  destinationVerified: boolean;
}

/**
 * Note: destination_ref/source_wallet_ref deliberately never contain the
 * substring "SIMULATED" — AuthorityAggregate.hasCurrentProductTrustEvidence
 * treats that substring in those two fields as a demo-fixture marker and
 * fails closed on it. The *obligation id* (which does carry the SIMULATED
 * label) is a separate field the production authority/safety-kernel code
 * never inspects for that marker.
 */
function buildSeedAggregate(obligationId: string, options: SeedOptions): AuthorityAggregate {
  return {
    organization_id: SIMULATED_ORGANIZATION_ID,
    obligation_id: obligationId,
    aggregate_version: 1,
    state: "APPROVAL_PENDING",
    amount: "10.000000",
    asset: "USDC",
    network: "ARC_TESTNET",
    counterparty_id: `CP-${obligationId}`,
    counterparty_version: 1,
    counterparty_status: "VERIFIED",
    destination_ref: options.destinationRef,
    destination_version: 1,
    product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
    destination_address: `0x${"1".repeat(40)}`,
    destination_verification_status: options.destinationVerified ? "VERIFIED" : "PENDING_VERIFICATION",
    destination_operational_status: "ACTIVE",
    source_wallet_ref: options.sourceWalletRef,
    source_wallet_version: 1,
    source_wallet_status: "ACTIVE",
    evidence_hashes: ["0".repeat(64)],
    policy_version: "POLICY-DEMO-SIMULATED-1",
    business_hold: false,
    security_freeze: false,
    external_settlement_state: "NONE",
    pae_state: "UNUSED",
    execution_state: "NONE",
    execution_idempotency_key: null,
    reviewed_aggregate_version: null,
    source_amount: "10.00",
    source_currency: "USD",
    settlement_conversion_rate: null,
  };
}

function buildAssessmentRecord(obligationId: string, aggregateVersion: number): DurableAssessmentRecord {
  const race: RaceAssessment = {
    result: {
      decision: "PAY",
      decision_summary: "Simulated demo: synthetic obligation has complete synthetic evidence for the isolated #44 prototype slice.",
      validated_findings: [],
    },
    action_taken: {
      summary: "Simulated demo checks completed against synthetic fixture evidence only.",
      checks: ["Synthetic evidence completeness and simulated destination readiness checks completed."],
    },
    caveats: {
      missing_context: [],
      uncertainty_signal: false,
      model_proposed_findings: [],
      model_proposed_findings_authority: "NON_AUTHORITATIVE",
      model_explanation: "Deterministic simulated demo fixture; no live model reasoning was used.",
      model_explanation_authority: "NON_AUTHORITATIVE",
    },
    evidence: {
      evidence_ids: ["EVID-DEMO-SIMULATED-1"],
      authoritative_facts: {
        obligation_id: obligationId,
        aggregate_version: String(aggregateVersion),
        amount: "10.00",
        currency: "USD",
        issue_date: "2099-01-01",
        due_date: "2099-01-01",
        due_date_status: "STATED_ON_SOURCE",
        effective_due_date: "2099-01-01",
        effective_due_date_basis: "INVOICE_DATE_CASH_TERM",
        effective_due_date_provenance: { provenance_class: "SOURCE_INVOICE_DATE", evidence_id: "EVID-DEMO-SIMULATED-1" },
        due_date_position: "FUTURE",
        as_of_date: "2026-01-01",
        state_at_event_baseline: "OUTSTANDING",
        business_purpose_confirmed: true,
        source_evidence_present: true,
        destination_status: "SIMULATED_READY",
        destination_readiness_source: "SIMULATED_DEMO_FIXTURE",
      },
    },
    remediation: [],
    prompt_identity: null,
  };

  return {
    assessment_id: `ASM-DEMO-SIMULATED-${randomUUID()}`,
    organization_id: SIMULATED_ORGANIZATION_ID,
    obligation_id: obligationId,
    aggregate_version: String(aggregateVersion),
    decision: "PAY",
    reasons: ["Simulated demo: synthetic fixture evidence complete; isolated non-economic prototype slice only (#44)."],
    evidence_ids: ["EVID-DEMO-SIMULATED-1"],
    missing_evidence: [],
    uncertainty_signal: false,
    race,
    provider_name: "simulated-demo-fixture",
    provider_mode: "NOT_LIVE_AI",
    assessed_at: new Date().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z"),
  };
}

export interface SimulatedHappyPathResult {
  label: typeof SIMULATED_HAPPY_PATH_LABEL;
  provider_label: typeof FAKE_PROVIDER_LABEL;
  vendor_notice: typeof NOT_VENDOR_PAYMENT_LABEL;
  organization_id: string;
  obligation_id: string;
  obligation: {
    obligation_id: string;
    state: ObligationState;
  };
  aggregate_state: ObligationState;
  assessment: {
    decision: DurableAssessmentRecord["decision"];
    provider_mode: DurableAssessmentRecord["provider_mode"];
  };
  human_authorization: {
    state: string;
  };
  assurance: {
    pae_state: AuthorityAggregate["pae_state"];
    safety_kernel_overall: "PASS" | "HOLD" | "BLOCK";
  };
  reconciliation: {
    aggregate_state: ObligationState;
    execution_status: ExecutionRecord["status"];
  };
  safety_kernel_overall: "PASS" | "HOLD" | "BLOCK";
  execution: ExecutionRecord & { provider_label: typeof FAKE_PROVIDER_LABEL };
  provider_submission_count: number;
}

/**
 * Runs the full synthetic happy path in-memory: seed -> seal assessment
 * (PAY) -> production approval/Safety Kernel/PAE sealing -> ExecutionWorker
 * -> FakeProviderAdapter -> reconciled/settled evidence. Produces exactly
 * one FakeProviderAdapter submission.
 */
export async function runSimulatedHappyPath(): Promise<SimulatedHappyPathResult> {
  const obligationId = SIMULATED_HAPPY_PATH_OBLIGATION_ID;
  assertSyntheticObligationId(obligationId);

  const store = new AuthorityStore();
  store.seed(
    buildSeedAggregate(obligationId, {
      destinationRef: "DEST-DEMO-HAPPY-001-SEEDED",
      sourceWalletRef: "WALLET-SOURCE-DEMO-HAPPY-001",
      destinationVerified: true,
    }),
  );
  const seededObligation = store.get(SIMULATED_ORGANIZATION_ID, obligationId);
  store.sealAssessment(buildAssessmentRecord(obligationId, 1));

  const current = store.getCurrentAssessment(SIMULATED_ORGANIZATION_ID, obligationId);
  if (!current) {
    throw new SimulatedDemoGuardError("Failed to seal the synthetic happy-path assessment fixture", "DEMO-002");
  }

  const { aggregate, sealed, safetyKernel, approvalRecord } = approveAndSealPae(store, SIMULATED_SIGNING_KEY_ID, {
    organizationId: SIMULATED_ORGANIZATION_ID,
    obligationId,
    expectedVersion: 1,
    reviewedAssessmentId: current.record.assessment_id,
    reviewedAssessmentHash: current.hash,
    actorId: "USR-DEMO-SIMULATED-OPERATOR",
    actorRole: "FINANCE_APPROVER",
    policyVersion: "POLICY-DEMO-SIMULATED-1",
    reasonText: `Simulated demo happy-path approval for isolated synthetic obligation ${obligationId} (#44).`,
  });

  const adapter = new FakeProviderAdapter();
  adapter.queueOutcome("CONFIRMED");
  const worker = new ExecutionWorker(store, adapter);
  const execution = await worker.execute(sealed);

  return {
    label: SIMULATED_HAPPY_PATH_LABEL,
    provider_label: FAKE_PROVIDER_LABEL,
    vendor_notice: NOT_VENDOR_PAYMENT_LABEL,
    organization_id: SIMULATED_ORGANIZATION_ID,
    obligation_id: obligationId,
    obligation: {
      obligation_id: seededObligation.obligation_id,
      state: seededObligation.state,
    },
    aggregate_state: store.get(SIMULATED_ORGANIZATION_ID, obligationId).state,
    assessment: {
      decision: current.record.decision,
      provider_mode: current.record.provider_mode,
    },
    human_authorization: {
      state: approvalRecord.record.new_state,
    },
    assurance: {
      pae_state: store.get(SIMULATED_ORGANIZATION_ID, obligationId).pae_state,
      safety_kernel_overall: safetyKernel.overall,
    },
    reconciliation: {
      aggregate_state: store.get(SIMULATED_ORGANIZATION_ID, obligationId).state,
      execution_status: execution.status,
    },
    safety_kernel_overall: safetyKernel.overall,
    execution: { ...execution, provider_label: FAKE_PROVIDER_LABEL },
    provider_submission_count: adapter.getSubmissionCount(),
  };
}

export interface SimulatedBlockedVariantResult {
  label: "SIMULATED_BLOCKED_VARIANT";
  provider_label: typeof FAKE_PROVIDER_LABEL;
  vendor_notice: typeof NOT_VENDOR_PAYMENT_LABEL;
  organization_id: string;
  obligation_id: string;
  blocked: true;
  safety_kernel_overall: "HOLD" | "BLOCK";
  control_results: ControlResult[];
  provider_submission_count: number;
}

/**
 * Companion synthetic variant: destination readiness is deliberately not
 * verified, so production assurance (the Safety Kernel, via
 * approveAndSealPae) must BLOCK before any PAE is sealed. The
 * FakeProviderAdapter instantiated here is never invoked — this proves zero
 * provider submissions occur for a blocked assurance outcome.
 */
export function runSimulatedBlockedVariant(): SimulatedBlockedVariantResult {
  const obligationId = SIMULATED_BLOCKED_OBLIGATION_ID;
  assertSyntheticObligationId(obligationId);

  const store = new AuthorityStore();
  store.seed(
    buildSeedAggregate(obligationId, {
      destinationRef: "DEST-DEMO-BLOCKED-001-SEEDED",
      sourceWalletRef: "WALLET-SOURCE-DEMO-BLOCKED-001",
      destinationVerified: false,
    }),
  );
  store.sealAssessment(buildAssessmentRecord(obligationId, 1));

  const current = store.getCurrentAssessment(SIMULATED_ORGANIZATION_ID, obligationId);
  if (!current) {
    throw new SimulatedDemoGuardError("Failed to seal the synthetic blocked-variant assessment fixture", "DEMO-002");
  }

  const adapter = new FakeProviderAdapter();

  try {
    approveAndSealPae(store, SIMULATED_SIGNING_KEY_ID, {
      organizationId: SIMULATED_ORGANIZATION_ID,
      obligationId,
      expectedVersion: 1,
      reviewedAssessmentId: current.record.assessment_id,
      reviewedAssessmentHash: current.hash,
      actorId: "USR-DEMO-SIMULATED-OPERATOR",
      actorRole: "FINANCE_APPROVER",
      policyVersion: "POLICY-DEMO-SIMULATED-1",
      reasonText: `Simulated demo blocked-variant approval attempt for isolated synthetic obligation ${obligationId} (#44); destination readiness intentionally not verified.`,
    });
  } catch (error) {
    if (error instanceof AssuranceFailedError) {
      return {
        label: "SIMULATED_BLOCKED_VARIANT",
        provider_label: FAKE_PROVIDER_LABEL,
        vendor_notice: NOT_VENDOR_PAYMENT_LABEL,
        organization_id: SIMULATED_ORGANIZATION_ID,
        obligation_id: obligationId,
        blocked: true,
        safety_kernel_overall: error.overall,
        control_results: error.controlResults,
        provider_submission_count: adapter.getSubmissionCount(),
      };
    }
    throw error;
  }

  throw new SimulatedDemoGuardError(
    "Simulated blocked variant unexpectedly passed assurance; this indicates a fixture defect, not a real PASS",
    "DEMO-003",
  );
}
