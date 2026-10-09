import type { AuthorityAggregate, AuthorityStore } from "../authority/aggregate";
import { T1_SINGLE_APPROVAL, type ActorAuthorityRecord } from "../authority/actor-authority";
import { AuthorityError } from "../authority/aggregate";
import type { DurableApprovalRecord, DurableAssuranceRecord, SealedPae } from "../domain/schemas";
import { verifySealedPae } from "../pae/sign-verify";
import { verifyDurableApprovalRecordHash, verifyDurableAssuranceRecordHash } from "../pae/durable-records";
import { processTrustedKeyRegistry, TrustedKeyRegistry, type TrustedKeyEntry } from "../pae/keys";
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

export interface WorkerAuthorizationArtifacts {
  approval_record: DurableApprovalRecord;
  approval_record_hash: string;
  assurance_record: DurableAssuranceRecord;
  assurance_hash: string;
  sealed_pae: SealedPae;
}

export type CurrentActorAuthority = ActorAuthorityRecord;

export interface ExecutionWorkerOptions {
  /** Read the current durable authorization snapshot for the exact PAE identity. */
  loadAuthorizationArtifacts?: (
    organizationId: string,
    obligationId: string,
  ) => WorkerAuthorizationArtifacts | null | undefined;
  /** Re-read durable approval, assurance, and aggregate authority at the final pre-send boundary. */
  reloadDurableExecutionContext?: (
    organizationId: string,
    obligationId: string,
  ) => Promise<{
    authorization?: WorkerAuthorizationArtifacts | null;
    aggregate: AuthorityAggregate;
    trustedKeys: TrustedKeyEntry[];
    actorAuthorities: ActorAuthorityRecord[];
    /** Kill-switch decision derived from the same latest durable authority snapshot. */
    executionKillSwitched: boolean;
  }>;
  /** Resolve the approver against a current authority source; request fields are never a substitute. */
  resolveActorAuthority?: (
    actorId: string,
    organizationId: string,
  ) => CurrentActorAuthority | null | undefined;
  now?: () => Date;
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
    private readonly options: ExecutionWorkerOptions = {},
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

    const expiry = Date.parse(payload.expiry);
    const now = (this.options.now?.() ?? new Date()).getTime();
    if (!Number.isFinite(expiry) || expiry <= now) {
      throw new ExecutionBlockedError("PAE expiry has been reached; no execution claim or provider submission was made", "EXP-001");
    }

    this.validateCurrentExecutionAuthority(sealed, aggregate);

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

    // Re-resolve the durable human authority and business prerequisites at
    // the last worker-owned boundary after the reservation write. A stale
    // or unavailable authority source blocks before submitTransfer.
    let preSubmitAggregate = this.store.get(payload.organization_id, obligationId);
    try {
      const durableContext = await this.options.reloadDurableExecutionContext?.(payload.organization_id, obligationId);
      const latestAggregate = durableContext?.aggregate ?? this.store.get(payload.organization_id, obligationId);
      preSubmitAggregate = latestAggregate;
      if (durableContext) {
        const currentTrustedKeys = new TrustedKeyRegistry();
        currentTrustedKeys.restore(durableContext.trustedKeys);
        verifySealedPae(sealed, currentTrustedKeys);
      }
      this.validateCurrentExecutionAuthority(
        sealed,
        latestAggregate,
        durableContext ? durableContext.authorization ?? null : undefined,
        durableContext
          ? durableContext.actorAuthorities.find((record) =>
            record.organization_id === payload.organization_id && record.actor_id === payload.approval_evidence[0]?.actor_id,
          ) ?? null
          : undefined,
      );
      if (latestAggregate.aggregate_version !== Number(payload.aggregate_version)) {
        throw new ExecutionBlockedError("Aggregate version changed at the final pre-submit gate", "PAE-011");
      }
      const killSwitchActive = durableContext
        ? durableContext.executionKillSwitched
        : this.store.isExecutionKillSwitched(payload.organization_id, obligationId);
      if (killSwitchActive) {
        throw new ExecutionBlockedError("Kill switch became active at the final pre-submit gate", "WDG-001");
      }
      const latestDestinationCurrent = payload.destination_ref === latestAggregate.destination_ref &&
        Number(payload.destination_version) === latestAggregate.destination_version &&
        payload.destination_address === latestAggregate.destination_address &&
        latestAggregate.destination_verification_status === "VERIFIED" &&
        latestAggregate.destination_operational_status === "ACTIVE";
      if (!latestDestinationCurrent ||
          payload.source_wallet_ref !== latestAggregate.source_wallet_ref ||
          Number(payload.source_wallet_version) !== latestAggregate.source_wallet_version ||
          latestAggregate.source_wallet_status !== "ACTIVE") {
        throw new ExecutionBlockedError("Destination or source wallet changed at the final pre-submit gate", "PAE-011");
      }
    } catch (error) {
      this.store.markBlocked(payload.organization_id, obligationId, "final execution authority check failed");
      const blocked: ExecutionRecord = {
        obligation_id: obligationId,
        idempotency_key: payload.idempotency_key,
        provider_ref: null,
        status: "BLOCKED",
        atomic_amount: payload.atomic_amount,
        destination_address: payload.destination_address,
      };
      this.executionLedger.set(payload.idempotency_key, blocked);
      try {
        await this.onDurableStateChange?.();
      } catch (persistenceError) {
        this.store.restoreAggregateSnapshot(preSubmitAggregate);
        this.executionLedger.set(payload.idempotency_key, { ...submittingRecord });
        throw persistenceError;
      }
      throw error;
    }

    // Expiry is time-sensitive and can be crossed while the reservation is
    // being persisted or the durable authorization context is reloaded. Make
    // this the last local gate, with no await before the provider boundary.
    const finalNow = (this.options.now?.() ?? new Date()).getTime();
    if (!Number.isFinite(expiry) || expiry <= finalNow) {
      const error = new ExecutionBlockedError(
        "PAE expiry was reached at the final pre-submit gate; the reserved instruction was refused",
        "EXP-001",
      );
      this.store.markBlocked(payload.organization_id, obligationId, "PAE expired at final pre-submit gate");
      const blocked: ExecutionRecord = {
        obligation_id: obligationId,
        idempotency_key: payload.idempotency_key,
        provider_ref: null,
        status: "BLOCKED",
        atomic_amount: payload.atomic_amount,
        destination_address: payload.destination_address,
      };
      this.executionLedger.set(payload.idempotency_key, blocked);
      // The reservation is already durable. A failed CAS while recording this
      // refusal must propagate and must never be represented as a persisted
      // BLOCKED outcome by the caller.
      try {
        await this.onDurableStateChange?.();
      } catch (persistenceError) {
        this.store.restoreAggregateSnapshot(preSubmitAggregate);
        this.executionLedger.set(payload.idempotency_key, { ...submittingRecord });
        throw persistenceError;
      }
      throw error;
    }

    let submission;
    try {
      submission = await this.adapter.submitTransfer({
        idempotencyKey: payload.idempotency_key,
        sourceWalletRef: payload.source_wallet_ref,
        destinationAddress: payload.destination_address,
        atomicAmount: payload.atomic_amount,
        asset: payload.asset,
        network: payload.network,
        beforeProviderSend: () => this.validateAtProviderSendBoundary(sealed),
      });
    } catch (error) {
      if (error instanceof ExecutionBlockedError) {
        const beforeRefusal = this.store.get(payload.organization_id, obligationId);
        this.store.markBlocked(payload.organization_id, obligationId, "final provider-send authority check failed");
        const blocked: ExecutionRecord = {
          obligation_id: obligationId,
          idempotency_key: payload.idempotency_key,
          provider_ref: null,
          status: "BLOCKED",
          atomic_amount: payload.atomic_amount,
          destination_address: payload.destination_address,
        };
        this.executionLedger.set(payload.idempotency_key, blocked);
        try {
          await this.onDurableStateChange?.();
        } catch (persistenceError) {
          this.store.restoreAggregateSnapshot(beforeRefusal);
          this.executionLedger.set(payload.idempotency_key, { ...submittingRecord });
          throw persistenceError;
        }
        throw error;
      }
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
    try {
      await this.onDurableStateChange?.();
    } catch (persistenceError) {
      // A persistence conflict after provider submission cannot cancel the
      // external effect. Restore only the last durable in-flight marker so a
      // follow-up resolves UNKNOWN/read-only rather than claiming cancellation
      // or permitting a second submit.
      this.store.restoreAggregateSnapshot(preSubmitAggregate);
      this.executionLedger.set(payload.idempotency_key, { ...submittingRecord });
      throw persistenceError;
    }
    return finalRecord;
  }

  /**
   * Last worker-owned authority check, invoked by the provider adapter only
   * after its awaited read-only Circle preflight and exact intent comparison.
   * No provider operation may be awaited between this check and create.
   */
  private async validateAtProviderSendBoundary(sealed: SealedPae): Promise<void> {
    const { payload } = sealed;
    const obligationId = payload.obligation_ids[0];
    let durableContext: Awaited<ReturnType<NonNullable<ExecutionWorkerOptions["reloadDurableExecutionContext"]>>> | undefined;
    try {
      durableContext = await this.options.reloadDurableExecutionContext?.(payload.organization_id, obligationId);
    } catch {
      throw new ExecutionBlockedError("Current durable execution authority could not be reloaded after provider preflight", "AUTH-001");
    }
    if (this.adapter.name === "arc-circle-live" && !durableContext) {
      throw new ExecutionBlockedError("Current durable execution authority is unavailable at the provider-send boundary", "AUTH-001");
    }

    const latestAggregate = durableContext?.aggregate ?? this.store.get(payload.organization_id, obligationId);
    if (durableContext) {
      try {
        const currentTrustedKeys = new TrustedKeyRegistry();
        currentTrustedKeys.restore(durableContext.trustedKeys);
        verifySealedPae(sealed, currentTrustedKeys);
      } catch {
        throw new ExecutionBlockedError("PAE signer trust was revoked or changed during provider preflight", "PAE-015");
      }
    }
    this.validateCurrentExecutionAuthority(
      sealed,
      latestAggregate,
      durableContext ? durableContext.authorization ?? null : undefined,
      durableContext
        ? durableContext.actorAuthorities.find((record) =>
          record.organization_id === payload.organization_id && record.actor_id === payload.approval_evidence[0]?.actor_id,
        ) ?? null
        : undefined,
    );

    if (latestAggregate.aggregate_version !== Number(payload.aggregate_version)) {
      throw new ExecutionBlockedError("Aggregate version changed during provider preflight", "PAE-011");
    }
    const [whole, fractional] = latestAggregate.amount.split(".");
    const expectedAtomic = /^\d+\.\d{6}$/.test(latestAggregate.amount)
      ? (BigInt(whole!) * 1_000_000n + BigInt(fractional!)).toString(10)
      : null;
    if (!expectedAtomic || payload.amount !== latestAggregate.amount || payload.atomic_amount !== expectedAtomic ||
        payload.asset !== latestAggregate.asset || payload.network !== latestAggregate.network ||
        payload.counterparty_id !== latestAggregate.counterparty_id ||
        Number(payload.counterparty_version) !== latestAggregate.counterparty_version) {
      throw new ExecutionBlockedError("Exact PAE amount, asset, network, or counterparty binding changed during provider preflight", "PAE-011");
    }
    const killSwitchActive = durableContext
      ? durableContext.executionKillSwitched
      : this.store.isExecutionKillSwitched(payload.organization_id, obligationId);
    if (killSwitchActive) {
      throw new ExecutionBlockedError("Durable kill switch became active during provider preflight", "WDG-001");
    }
    const destinationCurrent = payload.destination_ref === latestAggregate.destination_ref &&
      Number(payload.destination_version) === latestAggregate.destination_version &&
      payload.destination_address === latestAggregate.destination_address &&
      latestAggregate.destination_verification_status === "VERIFIED" &&
      latestAggregate.destination_operational_status === "ACTIVE";
    const sourceCurrent = payload.source_wallet_ref === latestAggregate.source_wallet_ref &&
      Number(payload.source_wallet_version) === latestAggregate.source_wallet_version &&
      latestAggregate.source_wallet_status === "ACTIVE";
    if (!destinationCurrent || !sourceCurrent) {
      throw new ExecutionBlockedError("Source wallet or proxy destination changed during provider preflight", "PAE-011");
    }

    // Time is sampled after the durable reload and synchronous binding checks,
    // so equality at expiry refuses before createTransaction.
    const expiry = Date.parse(payload.expiry);
    const now = (this.options.now?.() ?? new Date()).getTime();
    if (!Number.isFinite(expiry) || expiry <= now) {
      throw new ExecutionBlockedError("PAE expired during provider preflight; the reserved instruction was refused", "EXP-001");
    }
  }

  private validateCurrentExecutionAuthority(
    sealed: SealedPae,
    aggregate: AuthorityAggregate,
    reloadedAuthorization?: WorkerAuthorizationArtifacts | null,
    reloadedActorAuthority?: CurrentActorAuthority | null,
  ): void {
    const { payload } = sealed;
    const obligationId = payload.obligation_ids[0];
    if (!this.options.loadAuthorizationArtifacts) {
      throw new ExecutionBlockedError("Current durable approval and assurance source is unavailable; no provider submission was made", "AUTH-001");
    }
    let authorization = reloadedAuthorization;
    if (authorization === undefined) {
      try {
        authorization = this.options.loadAuthorizationArtifacts(payload.organization_id, obligationId);
      } catch {
        throw new ExecutionBlockedError("Current durable approval and assurance could not be reloaded", "AUTH-001");
      }
    }
    if (!authorization) {
      throw new ExecutionBlockedError("Current durable approval is missing or revoked", "AUTH-001");
    }

    const approval = authorization.approval_record;
    const evidence = payload.approval_evidence[0];
    let approvalHashValid = false;
    try {
      approvalHashValid = verifyDurableApprovalRecordHash(approval, authorization.approval_record_hash);
    } catch {
      approvalHashValid = false;
    }
    if (!approvalHashValid || !evidence || payload.approval_evidence.length !== 1 ||
        authorization.approval_record_hash !== evidence.approval_record_hash ||
        approval.approval_id !== evidence.approval_id ||
        approval.organization_id !== payload.organization_id || evidence.organization_id !== payload.organization_id ||
        approval.obligation_id !== obligationId || evidence.obligation_id !== obligationId ||
        approval.actor_id !== evidence.actor_id || approval.actor_role !== evidence.actor_role ||
        approval.authority_version !== evidence.authority_version || approval.policy_version !== evidence.policy_version ||
        approval.reviewed_aggregate_version !== evidence.reviewed_aggregate_version ||
        approval.authorized_aggregate_version !== evidence.authorized_aggregate_version ||
        approval.approved_at !== evidence.approved_at ||
        approval.assessment_id !== evidence.assessment_id || approval.assessment_hash !== evidence.assessment_hash ||
        approval.action !== "APPROVE" || approval.authorized_aggregate_version !== payload.aggregate_version ||
        authorization.sealed_pae.instruction_hash !== sealed.instruction_hash ||
        authorization.sealed_pae.signature !== sealed.signature) {
      throw new ExecutionBlockedError("Durable approval hash or signed PAE approval evidence does not match", "AUTH-002");
    }

    let assuranceHashValid = false;
    try {
      assuranceHashValid = verifyDurableAssuranceRecordHash(authorization.assurance_record, authorization.assurance_hash);
    } catch {
      assuranceHashValid = false;
    }
    const assurance = authorization.assurance_record;
    if (!assuranceHashValid || assurance.result !== "PASS" ||
        authorization.assurance_hash !== payload.assurance_hash ||
        assurance.organization_id !== payload.organization_id || assurance.obligation_id !== obligationId ||
        assurance.aggregate_version !== payload.aggregate_version ||
        assurance.policy_version !== payload.policy_version || assurance.policy_version !== aggregate.policy_version) {
      throw new ExecutionBlockedError("Durable Safety Kernel assurance is invalid, stale, or not PASS", "ASR-001");
    }

    if (!this.options.resolveActorAuthority) {
      throw new ExecutionBlockedError("Current actor authority source is unavailable; approver status cannot be independently confirmed", "ACT-002");
    }
    let actor = reloadedActorAuthority;
    if (actor === undefined) {
      try {
        actor = this.options.resolveActorAuthority(approval.actor_id, payload.organization_id);
      } catch {
        throw new ExecutionBlockedError("Current actor authority source could not resolve the recorded approver", "ACT-002");
      }
    }
    const now = (this.options.now?.() ?? new Date()).getTime();
    const approvedAt = Date.parse(approval.approved_at);
    const authorityWasValidAtApproval = actor !== null && actor !== undefined &&
      Date.parse(actor.valid_from) <= approvedAt &&
      (actor.expires_at === null || approvedAt < Date.parse(actor.expires_at));
    if (!actor || actor.organization_id !== payload.organization_id || actor.actor_id !== approval.actor_id ||
        actor.actor_role !== approval.actor_role || actor.authority_version !== approval.authority_version ||
        actor.status !== "ACTIVE" || !actor.permissions.includes(T1_SINGLE_APPROVAL) ||
        Date.parse(actor.valid_from) > now || (actor.expires_at !== null && now >= Date.parse(actor.expires_at)) ||
        !authorityWasValidAtApproval) {
      throw new ExecutionBlockedError("Recorded approver is missing, inactive, expired, revoked, or no longer holds T1_SINGLE_APPROVAL authority", "ACT-001");
    }

    if (payload.counterparty_id !== aggregate.counterparty_id ||
        Number(payload.counterparty_version) !== aggregate.counterparty_version ||
        aggregate.counterparty_status !== "VERIFIED") {
      throw new ExecutionBlockedError("Current counterparty version/status is not payment eligible", "CPY-001");
    }
    if (aggregate.business_hold) {
      throw new ExecutionBlockedError("Current business hold blocks execution", "OPS-001");
    }
    if (aggregate.security_freeze) {
      throw new ExecutionBlockedError("Current security freeze blocks execution", "SEC-001");
    }
    if (aggregate.external_settlement_state !== "NONE") {
      throw new ExecutionBlockedError("A current external settlement record blocks execution", "OPS-005");
    }
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
