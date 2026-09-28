/**
 * The P0 ObligationAuthorityAggregate: one root per (organization_id,
 * obligation_id) that owns aggregate_version and is the single concurrency/
 * currentness root used by every authority-bearing mutation (Concurrency
 * Control / P0 Authority Aggregate in the frozen blueprint).
 */

export type ObligationState =
  | "OPEN"
  | "BUSINESS_HOLD"
  | "APPROVAL_PENDING"
  | "AUTHORIZED"
  | "CANCELLED"
  | "EXTERNAL_SETTLEMENT_PENDING_VERIFICATION"
  | "EXTERNALLY_SETTLED"
  | "SETTLED"
  | "RECONCILED";

export type PaeLifecycleState = "UNUSED" | "RESERVED" | "SUBMITTED" | "CONSUMED" | "EXPIRED" | "REVOKED";

export type ExecutionState =
  | "NONE"
  | "RESERVED"
  | "SUBMITTING"
  | "SUBMITTED"
  | "CONFIRMING"
  | "UNKNOWN"
  | "FAILED"
  | "SETTLED"
  | "BLOCKED";

export interface AuthorityAggregate {
  organization_id: string;
  obligation_id: string;
  aggregate_version: number;
  state: ObligationState;
  amount: string;
  asset: "USDC";
  network: "ARC_TESTNET";
  counterparty_id: string;
  counterparty_version: number;
  counterparty_status: "VERIFIED" | "ON_HOLD" | "BLOCKED";
  destination_ref: string;
  destination_version: number;
  destination_address: string;
  destination_verification_status: "PENDING_VERIFICATION" | "VERIFIED";
  destination_operational_status: "ACTIVE" | "ON_HOLD" | "BLOCKED" | "SUPERSEDED";
  source_wallet_ref: string;
  source_wallet_version: number;
  source_wallet_status: "ACTIVE" | "INACTIVE";
  evidence_hashes: string[];
  policy_version: string;
  business_hold: boolean;
  security_freeze: boolean;
  external_settlement_state: "NONE" | "PENDING_VERIFICATION" | "SETTLED" | "REJECTED" | "CONFLICT";
  pae_state: PaeLifecycleState;
  execution_state: ExecutionState;
  execution_idempotency_key: string | null;
  reviewed_aggregate_version: number | null;
}

export class StaleStateError extends Error {
  constructor(public readonly code = "OPS-002") {
    super("STALE_STATE: expected_version does not match current aggregate_version");
    this.name = "StaleStateError";
  }
}

export class AuthorityError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AuthorityError";
  }
}

/**
 * Single-process, single-threaded in-memory authority store. JavaScript's
 * run-to-completion semantics give every method here true atomicity for
 * this prototype; a production build swaps this for one Postgres
 * transaction/CAS per method, matching the same expected_version contract.
 *
 * KNOWN PROTOTYPE LIMITATION: not durable across process restarts (no
 * Supabase credentials are available in this build environment). Swapping
 * the storage backend does not change the authority/version contract any
 * caller depends on.
 */
export class AuthorityStore {
  private readonly aggregates = new Map<string, AuthorityAggregate>();
  private readonly globalKillSwitches = new Set<string>();

  private key(organizationId: string, obligationId: string): string {
    return `${organizationId}::${obligationId}`;
  }

  seed(aggregate: AuthorityAggregate): void {
    this.aggregates.set(this.key(aggregate.organization_id, aggregate.obligation_id), { ...aggregate });
  }

  get(organizationId: string, obligationId: string): AuthorityAggregate {
    const found = this.aggregates.get(this.key(organizationId, obligationId));
    if (!found) {
      throw new AuthorityError(`No authority aggregate for ${organizationId}/${obligationId}`, "OBL-003");
    }
    return { ...found };
  }

  activateKillSwitch(scope: string): void {
    this.globalKillSwitches.add(scope);
  }

  deactivateKillSwitch(scope: string): void {
    this.globalKillSwitches.delete(scope);
  }

  isKillSwitchActive(scope: string): boolean {
    return this.globalKillSwitches.has(scope) || this.globalKillSwitches.has("GLOBAL_EXECUTION_DISABLED");
  }

  private write(next: AuthorityAggregate): AuthorityAggregate {
    this.aggregates.set(this.key(next.organization_id, next.obligation_id), { ...next });
    return { ...next };
  }

  private requireVersion(current: AuthorityAggregate, expectedVersion: number): void {
    if (current.aggregate_version !== expectedVersion) {
      throw new StaleStateError();
    }
  }

  /**
   * "P0 T1 Approval Transition": one atomic step that consumes reviewed
   * aggregate N (expectedVersion) and produces authorized aggregate N+1.
   */
  approve(organizationId: string, obligationId: string, expectedVersion: number): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    this.requireVersion(current, expectedVersion);
    if (current.state !== "APPROVAL_PENDING" && current.state !== "OPEN") {
      throw new AuthorityError(`Cannot approve obligation in state ${current.state}`, "AUT-006");
    }
    if (current.business_hold || current.security_freeze) {
      throw new AuthorityError("Cannot approve while HOLD or security freeze is active", "OPS-001");
    }
    return this.write({
      ...current,
      state: "AUTHORIZED",
      aggregate_version: current.aggregate_version + 1,
      reviewed_aggregate_version: expectedVersion,
    });
  }

  hold(organizationId: string, obligationId: string, expectedVersion: number): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    this.requireVersion(current, expectedVersion);
    if (current.execution_state === "SUBMITTING" || current.execution_state === "SUBMITTED") {
      throw new AuthorityError("Cannot HOLD after the provider-submit boundary", "OPS-003");
    }
    return this.write({
      ...current,
      state: "BUSINESS_HOLD",
      business_hold: true,
      aggregate_version: current.aggregate_version + 1,
    });
  }

  cancel(organizationId: string, obligationId: string, expectedVersion: number): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    this.requireVersion(current, expectedVersion);
    if (current.execution_state === "SUBMITTING" || current.execution_state === "SUBMITTED") {
      throw new AuthorityError("Cannot cancel after the provider-submit boundary", "OPS-003");
    }
    return this.write({
      ...current,
      state: "CANCELLED",
      pae_state: current.pae_state === "UNUSED" || current.pae_state === "RESERVED" ? "REVOKED" : current.pae_state,
      aggregate_version: current.aggregate_version + 1,
    });
  }

  /** Any material-field mutation invalidates stale approval/assurance/PAE and bumps the version. */
  applyMaterialChange(
    organizationId: string,
    obligationId: string,
    expectedVersion: number,
    patch: Partial<
      Pick<
        AuthorityAggregate,
        | "amount"
        | "counterparty_id"
        | "counterparty_version"
        | "destination_ref"
        | "destination_version"
        | "destination_address"
        | "destination_verification_status"
        | "destination_operational_status"
        | "source_wallet_ref"
        | "source_wallet_version"
        | "source_wallet_status"
        | "policy_version"
      >
    >,
  ): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    this.requireVersion(current, expectedVersion);
    return this.write({
      ...current,
      ...patch,
      state: "APPROVAL_PENDING",
      pae_state: current.pae_state === "UNUSED" || current.pae_state === "RESERVED" ? "REVOKED" : current.pae_state,
      aggregate_version: current.aggregate_version + 1,
    });
  }

  markPaeSealed(organizationId: string, obligationId: string, expectedVersion: number): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    this.requireVersion(current, expectedVersion);
    if (current.state !== "AUTHORIZED") {
      throw new AuthorityError("Cannot seal a PAE unless the obligation is AUTHORIZED", "PAE-004");
    }
    return this.write({ ...current, pae_state: "UNUSED" });
  }

  /** Atomic claim: PAE UNUSED -> RESERVED for exactly one execution_id/idempotency key. */
  reserveForExecution(
    organizationId: string,
    obligationId: string,
    expectedVersion: number,
    idempotencyKey: string,
  ): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    this.requireVersion(current, expectedVersion);
    if (current.pae_state !== "UNUSED") {
      throw new AuthorityError(
        `Refusing to reserve: PAE state is ${current.pae_state}, not UNUSED (replay/duplicate-claim guard)`,
        "EXE-004",
      );
    }
    return this.write({
      ...current,
      pae_state: "RESERVED",
      execution_state: "RESERVED",
      execution_idempotency_key: idempotencyKey,
    });
  }

  markSubmitting(organizationId: string, obligationId: string): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    if (current.pae_state !== "RESERVED") {
      throw new AuthorityError("Cannot mark SUBMITTING without a RESERVED claim", "EXE-005");
    }
    return this.write({ ...current, execution_state: "SUBMITTING" });
  }

  markSubmitted(organizationId: string, obligationId: string): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    return this.write({ ...current, pae_state: "SUBMITTED", execution_state: "SUBMITTED" });
  }

  markUnknown(organizationId: string, obligationId: string): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    return this.write({ ...current, execution_state: "UNKNOWN" });
  }

  markBlocked(organizationId: string, obligationId: string, reason: string): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    // eslint-disable-next-line no-console
    console.warn(`[authority] BLOCKED ${organizationId}/${obligationId}: ${reason}`);
    return this.write({ ...current, execution_state: "BLOCKED", pae_state: "REVOKED" });
  }

  markSettled(organizationId: string, obligationId: string): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    return this.write({
      ...current,
      pae_state: "CONSUMED",
      execution_state: "SETTLED",
      state: "SETTLED",
    });
  }

  markReconciled(organizationId: string, obligationId: string): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    if (current.state !== "SETTLED") {
      throw new AuthorityError("Cannot reconcile an obligation that is not SETTLED", "REC-003");
    }
    return this.write({ ...current, state: "RECONCILED" });
  }
}
