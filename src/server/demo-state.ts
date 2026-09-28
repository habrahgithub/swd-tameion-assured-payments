import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { AuthorityStore, type AuthorityAggregate } from "../authority/aggregate";
import { ExecutionWorker } from "../execution/worker";
import { FakeProviderAdapter } from "../execution/fake-provider-adapter";
import type { LiveUsageObligationRecord } from "../agent/context-builder";
import type { SealedPae } from "../domain/schemas";

/**
 * Server-side demo/prototype state for the J3 UI. This is a single-process
 * in-memory singleton — correct for demoing the P0 golden flow, NOT durable
 * across restarts and NOT safe across multiple serverless instances. A
 * hardening pass should replace this with the Supabase-backed store the
 * blueprint specifies once live database credentials are available in this
 * environment (see docs/evidence/J0-B-CONNECTIVITY.md).
 *
 * DEMO_ARC_TRUST_SEEDED: the real J0-C dataset marks every obligation's Arc
 * destination readiness as PENDING_J0_D_TRUST_SEED (J0-D has not run — see
 * src/j0d-spike/connectivity-spike.ts). To keep the golden path
 * demonstrable with mocks per DIR-TAMEION-PROTOTYPE-CLAUDE-001 ("Claude may
 * implement and test the complete execution flow using mocks/simulators/
 * test fixtures before the retained J2 testnet-transfer approval"), this
 * demo seeds a SIMULATED post-J0-D destination trust state. The UI must
 * always show this simulation banner so nobody mistakes it for a completed
 * J0-D or a real payment.
 */
export const DEMO_ORGANIZATION_ID = "ORG-DEMO-001";
export const DEMO_SIGNING_KEY_ID = "TAMEION-DEMO-PAE-KEY-1";
export const DEMO_ARC_TRUST_SEEDED = true;

export interface DemoObligationSummary {
  obligation_id: string;
  service_category: string;
  amount: string;
  currency: "AED" | "USD";
  recurrence: string;
  due_date: string | null;
  commercial_terms: string;
}

function loadLiveUsageSet(): LiveUsageObligationRecord[] {
  const fixturePath = path.join(process.cwd(), "data/live-usage/LIVE_USAGE_SET.json");
  const parsed = JSON.parse(readFileSync(fixturePath, "utf8")) as { records: LiveUsageObligationRecord[] };
  return parsed.records;
}

function toUsdcAmount(rawAmount: string): string {
  const [whole, fractional] = rawAmount.split(".");
  return `${whole}.${fractional.padEnd(6, "0")}`;
}

class DemoState {
  readonly store = new AuthorityStore();
  readonly worker: ExecutionWorker;
  readonly adapter = new FakeProviderAdapter();
  readonly liveUsageRecords: LiveUsageObligationRecord[];
  private readonly sealedPaeByObligation = new Map<string, SealedPae>();

  constructor() {
    this.liveUsageRecords = loadLiveUsageSet();
    this.worker = new ExecutionWorker(this.store, this.adapter);
    for (const record of this.liveUsageRecords) {
      const aggregate: AuthorityAggregate = {
        organization_id: DEMO_ORGANIZATION_ID,
        obligation_id: record.obligation_id,
        aggregate_version: 1,
        state: "APPROVAL_PENDING",
        amount: toUsdcAmount(record.amount),
        asset: "USDC",
        network: "ARC_TESTNET",
        counterparty_id: `CP-${record.obligation_id}`,
        counterparty_version: 1,
        counterparty_status: "VERIFIED",
        destination_ref: `DEST-${record.obligation_id}-SIMULATED`,
        destination_version: 1,
        destination_address: simulatedDestinationAddress(record.obligation_id),
        destination_verification_status: DEMO_ARC_TRUST_SEEDED ? "VERIFIED" : "PENDING_VERIFICATION",
        destination_operational_status: DEMO_ARC_TRUST_SEEDED ? "ACTIVE" : "ON_HOLD",
        source_wallet_ref: "WALLET-SOURCE-P0-1-SIMULATED",
        source_wallet_version: 1,
        source_wallet_status: "ACTIVE",
        evidence_hashes: record.source_evidence.map((e) => syntheticEvidenceHash(e.evidence_id)),
        policy_version: "POLICY-P0-1",
        business_hold: false,
        security_freeze: false,
        external_settlement_state: "NONE",
        pae_state: "UNUSED",
        execution_state: "NONE",
        execution_idempotency_key: null,
        reviewed_aggregate_version: null,
      };
      this.store.seed(aggregate);
    }
  }

  listObligations(): DemoObligationSummary[] {
    return this.liveUsageRecords.map((r) => ({
      obligation_id: r.obligation_id,
      service_category: r.service_category,
      amount: r.amount,
      currency: r.currency,
      recurrence: r.recurrence,
      due_date: r.due_date,
      commercial_terms: r.commercial_terms,
    }));
  }

  getRecord(obligationId: string): LiveUsageObligationRecord | undefined {
    return this.liveUsageRecords.find((r) => r.obligation_id === obligationId);
  }

  setSealedPae(obligationId: string, sealed: SealedPae): void {
    this.sealedPaeByObligation.set(obligationId, sealed);
  }

  getSealedPae(obligationId: string): SealedPae | undefined {
    return this.sealedPaeByObligation.get(obligationId);
  }
}

function syntheticEvidenceHash(evidenceId: string): string {
  // Deterministic 64-hex placeholder derived from the evidence id, distinct
  // per obligation. Not a real content hash — the real ones live only in
  // data/live-usage/SOURCE_EVIDENCE_LEDGER.json and are not re-derivable
  // without the private source documents.
  return createHash("sha256").update(`demo-placeholder:${evidenceId}`).digest("hex");
}

function simulatedDestinationAddress(obligationId: string): string {
  const digits = obligationId.replace(/[^0-9]/g, "").padStart(4, "0").slice(-4);
  return `0x${"5".repeat(36)}${digits}`;
}

declare global {
  // eslint-disable-next-line no-var
  var __tameionDemoState: DemoState | undefined;
}

export function getDemoState(): DemoState {
  if (!globalThis.__tameionDemoState) {
    globalThis.__tameionDemoState = new DemoState();
  }
  return globalThis.__tameionDemoState;
}
