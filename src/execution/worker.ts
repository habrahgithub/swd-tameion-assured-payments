import type { AuthorityStore } from "../authority/aggregate";
import { AuthorityError } from "../authority/aggregate";
import type { SealedPae } from "../domain/schemas";
import { verifySealedPae } from "../pae/sign-verify";
import { processTrustedKeyRegistry, type TrustedKeyRegistry } from "../pae/keys";
import { ProviderPreSubmitBlockedError, type ProviderAdapter, type StatusResult } from "./provider-adapter";

export class ExecutionBlockedError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "ExecutionBlockedError";
  }
}

export interface ExecutionRecord {
  obligation_id: string;
  idempotency_key: string;
  provider_ref: string | null;
  status: "SUBMITTING" | "SETTLED" | "FAILED" | "UNKNOWN" | "BLOCKED";
  atomic_amount: string;
  destination_address: string;
  provider_evidence?: StatusResult | null;
}

/**
 * The only component with actual payment-provider capability ("Execution
 * Service" / "P0 Name: Execution Worker" in the blueprint). Accepts only a
 * valid signed PAE; cannot invent amount, change destination, or create
 * authority. Every pre-execution check re-resolves current state rather
 * than trusting the PAE snapshot, so a change after authorization is
 * caught here even if it slipped past an earlier stage.
 *
 * The execution ledger is keyed by idempotency_key throughout — that key,
 * not obligation_id, is the economic-effect boundary the no-blind-retry and
 * at-most-one-submission rules are built on.
 */
export class ExecutionWorker {
  private readonly executionLedger = new Map<string, ExecutionRecord>();
  private readonly inFlight = new Map<string, Promise<ExecutionRecord>>();

  constructor(
    private readonly store: AuthorityStore,
    private readonly adapter: ProviderAdapter,
    private readonly onDurableStateChange?: () => Promise<void>,
    private readonly trustedKeys: TrustedKeyRegistry = processTrustedKeyRegistry,
  ) {}

  restoreSnapshot(records: ExecutionRecord[]): void {
    this.executionLedger.clear();
    for (const record of records) this.executionLedger.set(record.idempotency_key, { ...record });
  }

  exportSnapshot(): ExecutionRecord[] {
    return [...this.executionLedger.values()].map((record) => ({ ...record }));
  }

  getExecutionRecord(idempotencyKey: string): ExecutionRecord | undefined {
    return this.executionLedger.get(idempotencyKey);
  }

  /**
   * Executes exactly one PAE. Idempotent: calling this again with the same
   * PAE/idempotency_key after a prior terminal result returns the existing
   * record rather than submitting to the provider a second time.
   */
  async execute(sealed: SealedPae): Promise<ExecutionRecord> {
    // (6) No execution without a valid current one-obligation PAE.
    verifySealedPae(sealed, this.trustedKeys);

    const key = sealed.payload.idempotency_key;
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const operation = this.executeOnce(sealed);
    this.inFlight.set(key, operation);
    try {
      return await operation;
    } finally {
      this.inFlight.delete(key);
    }
  }

  private async executeOnce(sealed: SealedPae): Promise<ExecutionRecord> {

    const payload = sealed.payload;
    const obligationId = payload.obligation_ids[0];
    const aggregate = this.store.get(payload.organization_id, obligationId);

    // Idempotent replay handling first: if this exact idempotency key
    // already has a record (any status), return it without re-checking
    // currentness against a since-changed aggregate.
    const existing = this.executionLedger.get(payload.idempotency_key);
    if (existing) {
      if (existing.status === "SUBMITTING") {
        // A persisted submit marker without a persisted response is
        // ambiguous after restart. Resolve it as UNKNOWN and never replay
        // the provider submission.
        this.store.markUnknown(payload.organization_id, obligationId);
        const recovered = { ...existing, status: "UNKNOWN" as const };
        this.executionLedger.set(payload.idempotency_key, recovered);
        await this.onDurableStateChange?.();
        return recovered;
      }
      return existing;
    }

    // (10) Kill switch prevents execution — checked at the exact org/
    // obligation scope, not just the unscoped global switch, so an
    // ORGANIZATION_EXECUTION_DISABLED or TRANSACTION_DISABLED switch
    // activated after approval still stops this exact submission.
    if (this.store.isExecutionKillSwitched(payload.organization_id, obligationId)) {
      this.store.markBlocked(payload.organization_id, obligationId, "kill switch active");
      throw new ExecutionBlockedError("Kill switch is active; execution refused", "WDG-001");
    }

    // (6) PAE aggregate_version must exactly equal the current authority root version.
    if (Number(payload.aggregate_version) !== aggregate.aggregate_version) {
      this.store.markBlocked(payload.organization_id, obligationId, "aggregate_version mismatch");
      throw new ExecutionBlockedError(
        "PAE aggregate_version does not match current authority aggregate (stale/replayed authority)",
        "PAE-011",
      );
    }

    // (9) Changed destination after authorization: re-resolve current
    // destination trust/version/address and BLOCK on any mismatch, before
    // any provider submission.
    const destinationCurrent =
      payload.destination_ref === aggregate.destination_ref &&
      Number(payload.destination_version) === aggregate.destination_version &&
      payload.destination_address === aggregate.destination_address &&
      aggregate.destination_verification_status === "VERIFIED" &&
      aggregate.destination_operational_status === "ACTIVE";
    if (!destinationCurrent) {
      this.store.markBlocked(payload.organization_id, obligationId, "destination changed after authorization");
      throw new ExecutionBlockedError(
        "Destination reference/version/address/trust no longer matches the authorized PAE; execution BLOCKED with zero movement",
        "DST-003",
      );
    }

    if (
      payload.source_wallet_ref !== aggregate.source_wallet_ref ||
      Number(payload.source_wallet_version) !== aggregate.source_wallet_version ||
      aggregate.source_wallet_status !== "ACTIVE"
    ) {
      this.store.markBlocked(payload.organization_id, obligationId, "source wallet no longer current/active");
      throw new ExecutionBlockedError("Source wallet reference/version/status is no longer current", "WDG-008");
    }

    // (7) Atomic claim: PAE UNUSED -> RESERVED for exactly one execution_id/idempotency key.
    try {
      this.store.reserveForExecution(
        payload.organization_id,
        obligationId,
        aggregate.aggregate_version,
        payload.idempotency_key,
      );
    } catch (error) {
      if (error instanceof AuthorityError) {
        // Someone already reserved/consumed this PAE — concurrent/replayed
        // execute must not produce a second provider submission.
        const record = this.executionLedger.get(payload.idempotency_key);
        if (record) {
          return record;
        }
        throw new ExecutionBlockedError(`Execution already claimed: ${error.message}`, error.code);
      }
      throw error;
    }

    this.store.markSubmitting(payload.organization_id, obligationId);
    const submittingRecord: ExecutionRecord = {
      obligation_id: obligationId,
      idempotency_key: payload.idempotency_key,
      provider_ref: null,
      status: "SUBMITTING",
      atomic_amount: payload.atomic_amount,
      destination_address: payload.destination_address,
    };
    this.executionLedger.set(payload.idempotency_key, submittingRecord);
    // The durable submit marker is committed before control crosses the
    // provider boundary. A restart can therefore never turn an uncertain
    // submission into a fresh submission.
    await this.onDurableStateChange?.();

    let submission;
    try {
      submission = await this.adapter.submitTransfer({
        idempotencyKey: payload.idempotency_key,
        sourceWalletRef: payload.source_wallet_ref,
        destinationAddress: payload.destination_address,
        atomicAmount: payload.atomic_amount,
        asset: payload.asset,
        network: payload.network,
      });
    } catch (error) {
      if (error instanceof ProviderPreSubmitBlockedError) {
        this.store.markBlocked(payload.organization_id, obligationId, error.message);
        const record: ExecutionRecord = {
          obligation_id: obligationId,
          idempotency_key: payload.idempotency_key,
          provider_ref: null,
          status: "BLOCKED",
          atomic_amount: payload.atomic_amount,
          destination_address: payload.destination_address,
        };
        this.executionLedger.set(payload.idempotency_key, record);
        await this.onDurableStateChange?.();
        return record;
      }
      // A rejected transport promise does not prove that the provider did
      // not receive the request. Persist an in-process UNKNOWN record and
      // never let replay submit this PAE again. The provider reference is
      // unavailable, so automatic status reconciliation is not possible.
      this.store.markUnknown(payload.organization_id, obligationId);
      const record: ExecutionRecord = {
        obligation_id: obligationId,
        idempotency_key: payload.idempotency_key,
        provider_ref: null,
        status: "UNKNOWN",
        atomic_amount: payload.atomic_amount,
        destination_address: payload.destination_address,
      };
      this.executionLedger.set(payload.idempotency_key, record);
      await this.onDurableStateChange?.();
      return record;
    }
    this.store.markSubmitted(payload.organization_id, obligationId);

    // (8) Provider timeout/UNKNOWN: query status; never blind-retry submit.
    if (submission.status === "UNKNOWN") {
      this.store.markUnknown(payload.organization_id, obligationId);
      const record: ExecutionRecord = {
        obligation_id: obligationId,
        idempotency_key: payload.idempotency_key,
        provider_ref: submission.providerRef,
        status: "UNKNOWN",
        atomic_amount: payload.atomic_amount,
        destination_address: payload.destination_address,
      };
      this.executionLedger.set(payload.idempotency_key, record);
      await this.onDurableStateChange?.();
      return record;
    }

    const status = await this.adapter.getStatus(submission.providerRef, payload.idempotency_key);
    const finalRecord = this.finalizeFromStatus(
      {
        obligation_id: obligationId,
        idempotency_key: payload.idempotency_key,
        provider_ref: submission.providerRef,
        status: "UNKNOWN",
        atomic_amount: payload.atomic_amount,
        destination_address: payload.destination_address,
        provider_evidence: null,
      },
      status,
      payload.organization_id,
    );
    this.executionLedger.set(payload.idempotency_key, finalRecord);
    await this.onDurableStateChange?.();
    return finalRecord;
  }

  /**
   * Queries provider/chain truth for a PAE previously left UNKNOWN and
   * reconciles it. This is the only allowed path forward from UNKNOWN —
   * never a fresh submit with a new idempotency key.
   */
  async reconcilePendingByIdempotencyKey(idempotencyKey: string, organizationId: string): Promise<ExecutionRecord> {
    const record = this.executionLedger.get(idempotencyKey);
    if (!record || record.status !== "UNKNOWN") {
      throw new ExecutionBlockedError("No pending UNKNOWN execution for this idempotency key", "OPS-008");
    }
    const status = record.provider_ref
      ? await this.adapter.getStatus(record.provider_ref, idempotencyKey)
      : this.adapter.getStatusByIdempotencyKey
        ? await this.adapter.getStatusByIdempotencyKey(idempotencyKey)
        : { status: "UNKNOWN" as const };
    if (status.status === "UNKNOWN") {
      const unresolved = { ...record, provider_evidence: status };
      this.executionLedger.set(idempotencyKey, unresolved);
      await this.onDurableStateChange?.();
      return unresolved; // still unknown; caller may poll again later, never resubmit.
    }
    const finalRecord = this.finalizeFromStatus(record, status, organizationId);
    this.executionLedger.set(idempotencyKey, finalRecord);
    await this.onDurableStateChange?.();
    return finalRecord;
  }

  /** Recover an interrupted durable SUBMITTING marker without crossing the
   * provider boundary. A read-only status request must never re-enter execute. */
  async recoverSubmittingByIdempotencyKey(idempotencyKey: string, organizationId: string): Promise<ExecutionRecord | undefined> {
    const record = this.executionLedger.get(idempotencyKey);
    if (!record || record.status !== "SUBMITTING") return record;
    this.store.markUnknown(organizationId, record.obligation_id);
    const recovered: ExecutionRecord = { ...record, status: "UNKNOWN", provider_evidence: null };
    this.executionLedger.set(idempotencyKey, recovered);
    await this.onDurableStateChange?.();
    return recovered;
  }

  private finalizeFromStatus(
    record: ExecutionRecord,
    status: StatusResult,
    organizationId: string,
  ): ExecutionRecord {
    if (status.status === "PENDING" || status.status === "UNKNOWN") {
      this.store.markUnknown(organizationId, record.obligation_id);
      return { ...record, status: "UNKNOWN", provider_evidence: status };
    }
    if (status.status === "CONFIRMED") {
      // (11) One-to-one reconciliation: settlement amount/destination must
      // exactly match the authorized obligation before marking RECONCILED.
      const amountMatches = (status.atomic_amount ?? status.atomicAmount) === record.atomic_amount;
      const destinationMatches = (status.destination_address ?? status.destinationAddress) === record.destination_address;
      if (!amountMatches || !destinationMatches) {
        this.store.markBlocked(organizationId, record.obligation_id, "settlement does not reconcile to authorized obligation");
        return { ...record, status: "BLOCKED", provider_evidence: status };
      }
      this.store.markSettled(organizationId, record.obligation_id);
      this.store.markReconciled(organizationId, record.obligation_id);
      return { ...record, status: "SETTLED", provider_evidence: status };
    }

    return { ...record, status: "FAILED", provider_evidence: status };
  }
}
