import { sealDurableAssessmentRecord, verifyDurableAssessmentRecordHash } from "../pae/durable-records";
import type { DurableAssessmentRecord } from "../domain/schemas";

function cloneAssessmentRecord(record: DurableAssessmentRecord): DurableAssessmentRecord {
  return {
    ...record,
    reasons: [...record.reasons],
    evidence_ids: [...record.evidence_ids],
    missing_evidence: [...record.missing_evidence],
    ...(record.race ? { race: structuredClone(record.race) } : {}),
  };
}

function cloneSealedAssessment(assessment: SealedAssessment): SealedAssessment {
  return { record: cloneAssessmentRecord(assessment.record), hash: assessment.hash };
}

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

/** Kill Switch Scopes, per the frozen blueprint's Guardrails section. */
export type KillSwitchScope =
  | "TRANSACTION_DISABLED"
  | "AGENT_DISABLED"
  | "WALLET_DISABLED"
  | "AUTONOMOUS_EXECUTION_DISABLED"
  | "ORGANIZATION_EXECUTION_DISABLED"
  | "GLOBAL_EXECUTION_DISABLED"
  | "DISASTER_MODE";

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

export interface SealedAssessment {
  record: DurableAssessmentRecord;
  hash: string;
}

export interface AuthorityStoreSnapshot {
  aggregates: AuthorityAggregate[];
  kill_switches: string[];
  assessments: Array<{ organization_id: string; obligation_id: string; record: DurableAssessmentRecord; hash: string }>;
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
 * Request-local authority aggregate hydrated from the durable snapshot.
 * Local transitions preserve the expected_version contract; in Vercel,
 * the enclosing Supabase Postgres compare-and-set serializes and persists
 * each request's complete state transition before it can cross a provider
 * boundary.
 */
/** States that mean an obligation has already been selected as *the* execution
 * candidate (approved, or further along). Used to enforce "exactly one
 * candidate selection" — J1 requires the sole PAY candidate be chosen only
 * after all assessments complete, and this repo has exactly one execution
 * rail, so at most one obligation may hold one of these states at a time. */
const COMMITTED_CANDIDATE_STATES: ReadonlySet<ObligationState> = new Set([
  "AUTHORIZED",
  "EXTERNAL_SETTLEMENT_PENDING_VERIFICATION",
  "EXTERNALLY_SETTLED",
  "SETTLED",
  "RECONCILED",
]);

export class AuthorityStore {
  private readonly aggregates = new Map<string, AuthorityAggregate>();
  private readonly killSwitches = new Set<string>();
  /** obligation_id -> sealed, hash-addressable Finance Agent assessment
   * (J1 candidate-selection gate references this identity, not mutable
   * in-memory decision state). */
  private readonly sealedAssessments = new Map<string, SealedAssessment[]>();

  static fromSnapshot(snapshot: AuthorityStoreSnapshot): AuthorityStore {
    const store = new AuthorityStore();
    for (const aggregate of snapshot.aggregates) store.seed(aggregate);
    for (const key of snapshot.kill_switches) store.killSwitches.add(key);
    const assessmentIds = new Set<string>();
    for (const assessment of snapshot.assessments) {
      const validated = sealDurableAssessmentRecord(assessment.record);
      if (
        validated.assessment_hash !== assessment.hash ||
        validated.record.organization_id !== assessment.organization_id ||
        validated.record.obligation_id !== assessment.obligation_id ||
        assessmentIds.has(validated.record.assessment_id)
      ) {
        throw new AuthorityError("Persisted assessment history failed hash-integrity verification", "ASM-011");
      }
      assessmentIds.add(validated.record.assessment_id);
      const key = store.key(assessment.organization_id, assessment.obligation_id);
      const history = store.sealedAssessments.get(key) ?? [];
      history.push({ record: validated.record, hash: assessment.hash });
      store.sealedAssessments.set(key, history);
    }
    return store;
  }

  exportSnapshot(): AuthorityStoreSnapshot {
    return {
      aggregates: [...this.aggregates.values()].map((aggregate) => ({ ...aggregate, evidence_hashes: [...aggregate.evidence_hashes] })),
      kill_switches: [...this.killSwitches].sort(),
      assessments: [...this.sealedAssessments.entries()].flatMap(([key, history]) => {
        const separator = key.indexOf("::");
        return history.map(({ record, hash }) => ({
          organization_id: key.slice(0, separator),
          obligation_id: key.slice(separator + 2),
          record: cloneAssessmentRecord(record),
          hash,
        }));
      }),
    };
  }

  private key(organizationId: string, obligationId: string): string {
    return `${organizationId}::${obligationId}`;
  }

  /**
   * Seals a Finance Agent assessment as an immutable, hash-addressable
   * artifact. Fails closed (ASM-001) if the record's bound aggregate_version
   * does not match the obligation's actual current version — an assessment
   * can only be sealed against the exact state it was computed from, the
   * same version-binding discipline already used for approval/PAE sealing.
   * This is the server-side enforcement point for "AI proposes, never
   * approves": approve() below requires this sealed artifact to exist,
   * still be bound to the current version, and pass hash-integrity
   * verification before a human can even attempt the T1 transition.
   */
  sealAssessment(record: DurableAssessmentRecord): { record: DurableAssessmentRecord; assessment_hash: string } {
    const current = this.get(record.organization_id, record.obligation_id);
    if (record.aggregate_version !== String(current.aggregate_version)) {
      throw new AuthorityError(
        `Cannot seal assessment: record aggregate_version ${record.aggregate_version} does not match current ${current.aggregate_version}`,
        "ASM-001",
      );
    }
    const sealed = sealDurableAssessmentRecord(record);
    const key = this.key(record.organization_id, record.obligation_id);
    const history = this.sealedAssessments.get(key) ?? [];
    history.push({ record: sealed.record, hash: sealed.assessment_hash });
    this.sealedAssessments.set(key, history);
    return { record: cloneAssessmentRecord(sealed.record), assessment_hash: sealed.assessment_hash };
  }

  getSealedAssessment(
    organizationId: string,
    obligationId: string,
  ): { record: DurableAssessmentRecord; hash: string } | undefined {
    const history = this.sealedAssessments.get(this.key(organizationId, obligationId));
    const latest = history?.at(-1);
    return latest ? cloneSealedAssessment(latest) : undefined;
  }

  getAssessmentHistory(organizationId: string, obligationId: string): SealedAssessment[] {
    return (this.sealedAssessments.get(this.key(organizationId, obligationId)) ?? []).map(cloneSealedAssessment);
  }

  getCurrentAssessment(organizationId: string, obligationId: string): SealedAssessment | undefined {
    const current = this.get(organizationId, obligationId);
    return this.getAssessmentHistory(organizationId, obligationId)
      .reverse()
      .find((assessment) => assessment.record.aggregate_version === String(current.aggregate_version));
  }

  /** Returns the obligation_id of the first obligation in this organization
   * that has no sealed assessment yet, or null if every obligation the
   * store knows about for this organization has one. J1 requires the sole
   * candidate be selected only after all obligations are assessed — this
   * is that check, evaluated against every obligation this store holds for
   * the organization (the same set the demo/product seeds up front). */
  findUnassessedObligation(organizationId: string): string | null {
    for (const aggregate of this.aggregates.values()) {
      if (
        aggregate.organization_id === organizationId &&
        aggregate.state !== "CANCELLED" &&
        !COMMITTED_CANDIDATE_STATES.has(aggregate.state) &&
        !this.getCurrentAssessment(organizationId, aggregate.obligation_id)
      ) {
        return aggregate.obligation_id;
      }
    }
    return null;
  }

  /** Returns the obligation_id of another obligation already committed as
   * the sole execution candidate for this organization, or null if none. */
  findCommittedCandidateExcluding(organizationId: string, obligationId: string): string | null {
    for (const aggregate of this.aggregates.values()) {
      if (
        aggregate.organization_id === organizationId &&
        aggregate.obligation_id !== obligationId &&
        COMMITTED_CANDIDATE_STATES.has(aggregate.state)
      ) {
        return aggregate.obligation_id;
      }
    }
    return null;
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

  private killSwitchKey(scope: KillSwitchScope, targetId?: string): string {
    return targetId ? `${scope}:${targetId}` : scope;
  }

  /**
   * Activates one of the blueprint's Kill Switch Scopes. GLOBAL_EXECUTION_DISABLED
   * and DISASTER_MODE take no targetId (they are unscoped); ORGANIZATION_EXECUTION_DISABLED
   * takes an organization_id; TRANSACTION_DISABLED takes an obligation_id.
   */
  activateKillSwitch(scope: KillSwitchScope, targetId?: string): void {
    this.killSwitches.add(this.killSwitchKey(scope, targetId));
  }

  deactivateKillSwitch(scope: KillSwitchScope, targetId?: string): void {
    this.killSwitches.delete(this.killSwitchKey(scope, targetId));
  }

  /**
   * The single kill-switch check both the Safety Kernel (pre-approval) and
   * the Execution Worker (pre-submit) must use — checking only the
   * unscoped global switch here would silently miss an
   * ORGANIZATION_EXECUTION_DISABLED or TRANSACTION_DISABLED switch that a
   * caller activated for this exact organization/obligation.
   */
  isExecutionKillSwitched(organizationId: string, obligationId: string): boolean {
    return (
      this.killSwitches.has("GLOBAL_EXECUTION_DISABLED") ||
      this.killSwitches.has("DISASTER_MODE") ||
      this.killSwitches.has(this.killSwitchKey("ORGANIZATION_EXECUTION_DISABLED", organizationId)) ||
      this.killSwitches.has(this.killSwitchKey("TRANSACTION_DISABLED", obligationId))
    );
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
  approve(
    organizationId: string,
    obligationId: string,
    expectedVersion: number,
    reviewedAssessmentId: string,
    reviewedAssessmentHash: string,
  ): AuthorityAggregate {
    const current = this.get(organizationId, obligationId);
    this.requireVersion(current, expectedVersion);
    if (current.state !== "APPROVAL_PENDING" && current.state !== "OPEN") {
      throw new AuthorityError(`Cannot approve obligation in state ${current.state}`, "AUT-006");
    }
    if (current.business_hold || current.security_freeze) {
      throw new AuthorityError("Cannot approve while HOLD or security freeze is active", "OPS-001");
    }
    const sealed = this.getCurrentAssessment(organizationId, obligationId);
    if (!sealed) {
      const previous = this.getSealedAssessment(organizationId, obligationId);
      if (previous) {
        throw new AuthorityError(
          `Cannot approve: latest sealed assessment is bound to aggregate_version ${previous.record.aggregate_version}; a fresh assessment is required`,
          "AUT-009",
        );
      }
      throw new AuthorityError("Cannot approve: no sealed Finance Agent assessment exists for this obligation", "AUT-007");
    }
    if (sealed.record.assessment_id !== reviewedAssessmentId || sealed.hash !== reviewedAssessmentHash) {
      throw new AuthorityError("Cannot approve: reviewed assessment is no longer current; refresh and review the latest assessment", "AUT-013");
    }
    if (!verifyDurableAssessmentRecordHash(sealed.record, sealed.hash)) {
      throw new AuthorityError("Cannot approve: sealed assessment failed hash-integrity verification", "AUT-011");
    }
    const race = sealed.record.race;
    if (
      !race ||
      race.result.decision !== sealed.record.decision ||
      race.evidence.authoritative_facts.obligation_id !== obligationId ||
      race.evidence.authoritative_facts.aggregate_version !== sealed.record.aggregate_version ||
      race.evidence.authoritative_facts.aggregate_version !== String(current.aggregate_version) ||
      JSON.stringify(race.evidence.evidence_ids) !== JSON.stringify(sealed.record.evidence_ids) ||
      (sealed.record.decision === "PAY" && (race.result.validated_findings.length > 0 || race.remediation.length > 0))
    ) {
      throw new AuthorityError("Cannot approve: assessment is missing valid application-owned RACE findings or readiness proof; reassess before authorization", "AUT-014");
    }
    if (sealed.record.aggregate_version !== String(current.aggregate_version)) {
      throw new AuthorityError(
        `Cannot approve: sealed assessment is bound to aggregate_version ${sealed.record.aggregate_version}, but the obligation is now at ${current.aggregate_version} — it changed since assessment; a fresh assessment is required`,
        "AUT-009",
      );
    }
    if (sealed.record.decision !== "PAY") {
      throw new AuthorityError(`Cannot approve: sealed assessment decision is ${sealed.record.decision}, not PAY`, "AUT-007");
    }
    const unassessed = this.findUnassessedObligation(organizationId);
    if (unassessed) {
      throw new AuthorityError(
        `Cannot approve: ${unassessed} has not been assessed yet — candidate selection requires every obligation to be assessed first`,
        "AUT-012",
      );
    }
    const otherCandidate = this.findCommittedCandidateExcluding(organizationId, obligationId);
    if (otherCandidate) {
      throw new AuthorityError(
        `Cannot approve: ${otherCandidate} is already the committed sole execution candidate for this organization`,
        "AUT-008",
      );
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
