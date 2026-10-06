import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { AuthorityStore, type AuthorityAggregate } from "../authority/aggregate";
import { ExecutionWorker, type ExecutionRecord } from "../execution/worker";
import type { ProviderAdapter } from "../execution/provider-adapter";
import type { StatusResult } from "../execution/provider-adapter";
import { FakeProviderAdapter, type FakeProviderAdapterSnapshot } from "../execution/fake-provider-adapter";
import { ArcCircleProviderAdapter } from "../execution/provider-adapter";
import type { LiveUsageObligationRecord } from "../agent/context-builder";
import {
  buildJ2aDemoAggregate,
  j2aPreflightResultSchema,
  type J2aPreflightResult,
} from "../demo/real-testnet-payment";
import { adaptDirectEvidenceObligation, type CanonicalPaymentObligation } from "../domain/payment-control-boundary";
import { convertSourceToSettlement, isSettleableCurrency } from "../domain/currency-conversion";
import {
  durableApprovalRecordSchema,
  durableAssuranceRecordSchema,
  durableAssessmentRecordSchema,
  sealedPaeSchema,
  type DurableApprovalRecord,
  type DurableAssuranceRecord,
  type DurableAssessmentRecord,
  type SealedPae,
} from "../domain/schemas";
import {
  verifyDurableApprovalRecordHash,
  verifyDurableAssuranceRecordHash,
} from "../pae/durable-records";
import { canonicalBytes, sha256Hex } from "../pae/canonicalize";
import {
  parseTrustedKeyRegistry,
  TrustedKeyRegistry,
  type TrustedKeyEntry,
} from "../pae/keys";
import { SupabaseDemoStateRepository } from "./supabase-demo-state-repository";

/**
 * Server-side demo/prototype state for the J3 UI. Vercel Preview and
 * Production load and compare-and-set this snapshot through Supabase on
 * every request. Local development/test may use the memory adapter.
 *
 * The seeded destination/source-wallet status below is a simulated demo
 * fixture only. J0-D completed a connectivity spike with disposable wallets;
 * it did not establish per-obligation product trust. J1 readiness therefore
 * requires separate current, non-simulated product-trust evidence. The
 * immutable J0-C source record retains its historical pending value.
 */
export const DEMO_ORGANIZATION_ID = "ORG-DEMO-001";
export const DEMO_SIGNING_KEY_ID = "TAMEION-DEMO-PAE-KEY-1";
export const DEMO_ARC_TRUST_SIMULATED = true;

export interface DemoObligationSummary {
  obligation_id: string;
  service_category: string;
  amount: string;
  currency: string;
  recurrence: string;
  due_date: string | null;
  commercial_terms: string;
}

export interface DemoAuthorizationArtifacts {
  approval_record: DurableApprovalRecord;
  approval_record_hash: string;
  assurance_record: DurableAssuranceRecord;
  assurance_hash: string;
  sealed_pae: SealedPae;
}

export interface DemoStateSnapshot {
  schema_version: 2;
  authority: ReturnType<AuthorityStore["exportSnapshot"]>;
  assessment_operations: AssessmentOperation[];
  sealed_paes: Array<[string, SealedPae]>;
  authorization_history: DemoAuthorizationArtifacts[];
  trusted_keys: TrustedKeyEntry[];
  execution_ledger: ExecutionRecord[];
  provider_adapter: FakeProviderAdapterSnapshot;
}

export interface AssessmentOperation {
  idempotency_key: string;
  obligation_id: string;
  aggregate_version: number;
  status: "RESERVED" | "PROVIDER_RESULT_DURABLE" | "COMPLETED" | "STALE" | "UNKNOWN";
  reserved_at?: number;
  provider_result?: DurableAssessmentRecord;
  assessment_hash?: string;
}

const authorizationArtifactsParser = (value: unknown): DemoAuthorizationArtifacts => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed persisted authorization artifact.");
  const item = value as Record<string, unknown>;
  const artifacts = {
    approval_record: durableApprovalRecordSchema.parse(item.approval_record),
    approval_record_hash: parseSha256(item.approval_record_hash),
    assurance_record: durableAssuranceRecordSchema.parse(item.assurance_record),
    assurance_hash: parseSha256(item.assurance_hash),
    sealed_pae: sealedPaeSchema.parse(item.sealed_pae),
  };
  if (!verifyDurableApprovalRecordHash(artifacts.approval_record, artifacts.approval_record_hash)) {
    throw new Error("Persisted approval record failed hash-integrity verification.");
  }
  if (!verifyDurableAssuranceRecordHash(artifacts.assurance_record, artifacts.assurance_hash)) {
    throw new Error("Persisted assurance record failed hash-integrity verification.");
  }
  if (sha256Hex(canonicalBytes(artifacts.sealed_pae.payload)) !== artifacts.sealed_pae.instruction_hash) {
    throw new Error("Persisted PAE failed instruction-hash verification.");
  }
  const approval = artifacts.approval_record;
  const assurance = artifacts.assurance_record;
  const evidence = artifacts.sealed_pae.payload.approval_evidence[0];
  if (
    artifacts.sealed_pae.payload.approval_evidence.length !== 1 ||
    !evidence ||
    approval.organization_id !== assurance.organization_id || approval.obligation_id !== assurance.obligation_id ||
    approval.organization_id !== artifacts.sealed_pae.payload.organization_id ||
    approval.obligation_id !== artifacts.sealed_pae.payload.obligation_ids[0] ||
    approval.assessment_id !== evidence.assessment_id || approval.assessment_hash !== evidence.assessment_hash ||
    approval.approval_id !== evidence.approval_id || artifacts.approval_record_hash !== evidence.approval_record_hash ||
    approval.actor_id !== evidence.actor_id || approval.actor_role !== evidence.actor_role ||
    approval.policy_version !== evidence.policy_version ||
    approval.authorized_aggregate_version !== evidence.authorized_aggregate_version ||
    assurance.aggregate_version !== approval.authorized_aggregate_version ||
    artifacts.sealed_pae.payload.aggregate_version !== approval.authorized_aggregate_version ||
    artifacts.sealed_pae.payload.assurance_hash !== artifacts.assurance_hash
  ) throw new Error("Persisted authorization artifacts are not consistently bound.");
  return artifacts;
};

function parseSha256(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error("Malformed persisted artifact hash.");
  return value;
}

export function parseDemoStateSnapshot(value: unknown): DemoStateSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed Supabase demo-state snapshot.");
  const snapshot = value as Record<string, unknown>;
  if (
    (snapshot.schema_version !== 1 && snapshot.schema_version !== 2) ||
    !snapshot.authority || typeof snapshot.authority !== "object" || Array.isArray(snapshot.authority) ||
    !Array.isArray(snapshot.sealed_paes) || !Array.isArray(snapshot.authorization_history) ||
    !Array.isArray(snapshot.execution_ledger) || !snapshot.provider_adapter ||
    typeof snapshot.provider_adapter !== "object" || Array.isArray(snapshot.provider_adapter) ||
    (snapshot.schema_version === 2 && !Array.isArray(snapshot.trusted_keys))
  ) {
    throw new Error("Malformed Supabase demo-state snapshot.");
  }
  const authority = snapshot.authority as Record<string, unknown>;
  if (!Array.isArray(authority.aggregates) || !Array.isArray(authority.kill_switches) || !Array.isArray(authority.assessments)) {
    throw new Error("Malformed persisted authority snapshot.");
  }
  const sealedPaes = snapshot.sealed_paes.map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") throw new Error("Malformed persisted PAE entry.");
    return [entry[0], sealedPaeSchema.parse(entry[1])] as [string, SealedPae];
  });
  const trustedKeys = snapshot.schema_version === 1
    ? []
    : parseTrustedKeyRegistry(snapshot.trusted_keys);
  const authorizationHistory = snapshot.authorization_history.map(authorizationArtifactsParser);
  const assessmentsByHash = new Map<string, {
    assessment_id: string;
    organization_id: string;
    obligation_id: string;
    aggregate_version: string;
  }>();
  for (const assessment of authority.assessments) {
    if (!assessment || typeof assessment !== "object" || Array.isArray(assessment)) throw new Error("Malformed persisted assessment.");
    const item = assessment as Record<string, unknown>;
    if (typeof item.hash !== "string") throw new Error("Malformed persisted assessment hash.");
    const record = item.record as Record<string, unknown> | undefined;
    if (!record || typeof record.assessment_id !== "string" || typeof record.organization_id !== "string" || typeof record.obligation_id !== "string") {
      throw new Error("Malformed persisted assessment identity.");
    }
    assessmentsByHash.set(parseSha256(item.hash), {
      assessment_id: record.assessment_id,
      organization_id: record.organization_id,
      obligation_id: record.obligation_id,
      aggregate_version: String(record.aggregate_version),
    });
  }
  for (const authorization of authorizationHistory) {
    const assessment = assessmentsByHash.get(authorization.approval_record.assessment_hash);
    if (
      !assessment ||
      assessment.assessment_id !== authorization.approval_record.assessment_id ||
      assessment.organization_id !== authorization.approval_record.organization_id ||
      assessment.obligation_id !== authorization.approval_record.obligation_id
    ) {
      throw new Error("Persisted authorization references missing assessment history.");
    }
  }
  const latestAuthorizationByObligation = new Map<string, DemoAuthorizationArtifacts>();
  for (const authorization of authorizationHistory) {
    latestAuthorizationByObligation.set(authorization.approval_record.obligation_id, authorization);
  }
  for (const [obligationId, pae] of sealedPaes) {
    const latestAuthorization = latestAuthorizationByObligation.get(obligationId);
    if (
      pae.payload.obligation_ids.length !== 1 || pae.payload.obligation_ids[0] !== obligationId ||
      !latestAuthorization || latestAuthorization.sealed_pae.instruction_hash !== pae.instruction_hash ||
      latestAuthorization.sealed_pae.signature !== pae.signature
    ) throw new Error("Persisted current PAE pointer does not match authorization history.");
  }
  for (const [obligationId, authorization] of latestAuthorizationByObligation) {
    const currentPae = sealedPaes.find(([id]) => id === obligationId)?.[1];
    if (!currentPae || currentPae.instruction_hash !== authorization.sealed_pae.instruction_hash) {
      throw new Error("Persisted authorization is missing its current sealed PAE pointer.");
    }
  }
  const executionLedger = snapshot.execution_ledger.map((value) => parseExecutionRecord(value));
  const executionKeys = executionLedger.map((entry) => entry.idempotency_key);
  if (new Set(executionKeys).size !== executionKeys.length) throw new Error("Persisted execution ledger contains duplicate idempotency keys.");
  const aggregateIdentities = (authority.aggregates as Array<Record<string, unknown>>).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) ||
        typeof entry.organization_id !== "string" || typeof entry.obligation_id !== "string" ||
        !Number.isSafeInteger(entry.aggregate_version) || (entry.aggregate_version as number) < 1) {
      throw new Error("Malformed persisted authority aggregate.");
    }
    return `${entry.organization_id}::${entry.obligation_id}`;
  });
  if (new Set(aggregateIdentities).size !== aggregateIdentities.length) throw new Error("Persisted authority snapshot contains duplicate aggregates.");
  const providerAdapter = snapshot.provider_adapter as FakeProviderAdapterSnapshot;
  if (
    !Array.isArray(providerAdapter.transfers_by_ref) || !Array.isArray(providerAdapter.refs_by_idempotency_key) ||
    !Array.isArray(providerAdapter.outcome_queue) || !Number.isSafeInteger(providerAdapter.submission_count)
  ) throw new Error("Malformed persisted provider simulator snapshot.");
  const rawAssessmentOperations = snapshot.assessment_operations ?? [];
  if (!Array.isArray(rawAssessmentOperations)) throw new Error("Malformed persisted assessment operations.");
  const assessmentOperations = rawAssessmentOperations.map(parseAssessmentOperation);
  if (new Set(assessmentOperations.map((operation) => operation.idempotency_key)).size !== assessmentOperations.length) {
    throw new Error("Persisted assessment operations contain duplicate idempotency keys.");
  }
  for (const operation of assessmentOperations) {
    if (operation.status === "COMPLETED") {
      const assessment = assessmentsByHash.get(operation.assessment_hash!);
      if (
        !assessment || assessment.assessment_id !== `ASM-${operation.idempotency_key}` ||
        assessment.obligation_id !== operation.obligation_id ||
        assessment.aggregate_version !== String(operation.aggregate_version)
      ) throw new Error("Persisted assessment operation does not match its sealed assessment.");
    }
  }
  return {
    schema_version: 2,
    authority: snapshot.authority as DemoStateSnapshot["authority"],
    assessment_operations: assessmentOperations,
    sealed_paes: sealedPaes,
    authorization_history: authorizationHistory,
    trusted_keys: trustedKeys,
    execution_ledger: executionLedger,
    provider_adapter: providerAdapter,
  };
}

function parseAssessmentOperation(value: unknown): AssessmentOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed persisted assessment operation.");
  const operation = value as Record<string, unknown>;
  if (
    typeof operation.idempotency_key !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(operation.idempotency_key) ||
    typeof operation.obligation_id !== "string" ||
    !Number.isSafeInteger(operation.aggregate_version) || (operation.aggregate_version as number) < 1 ||
    !["PENDING", "RESERVED", "PROVIDER_RESULT_DURABLE", "COMPLETED", "STALE", "UNKNOWN"].includes(String(operation.status))
  ) throw new Error("Malformed persisted assessment operation.");
  const status = operation.status === "PENDING" ? "UNKNOWN" : operation.status;
  const providerResult = operation.provider_result === undefined
    ? undefined
    : durableAssessmentRecordSchema.parse(operation.provider_result);
  if (status === "COMPLETED") {
    if (typeof operation.assessment_hash !== "string" || !/^[0-9a-f]{64}$/.test(operation.assessment_hash)) {
      throw new Error("Malformed completed assessment operation.");
    }
    if (providerResult) throw new Error("Completed assessment operation cannot retain an unsealed provider result.");
  } else if (operation.assessment_hash !== undefined) {
    throw new Error("Incomplete assessment operation cannot contain an assessment hash.");
  }
  if (status === "PROVIDER_RESULT_DURABLE" && !providerResult) {
    throw new Error("Provider-result-durable operation is missing its validated result.");
  }
  if (providerResult && (
    providerResult.assessment_id !== `ASM-${operation.idempotency_key}` ||
    providerResult.obligation_id !== operation.obligation_id ||
    providerResult.aggregate_version !== String(operation.aggregate_version) ||
    providerResult.organization_id !== DEMO_ORGANIZATION_ID
  )) {
    throw new Error("Provider result identity does not match its assessment operation.");
  }
  if (status !== "PROVIDER_RESULT_DURABLE" && providerResult) {
    throw new Error("Assessment operation has a provider result in an invalid state.");
  }
  if (status === "RESERVED" && (!Number.isSafeInteger(operation.reserved_at) || (operation.reserved_at as number) < 0)) {
    throw new Error("Reserved assessment operation is missing its reservation time.");
  }
  return { ...operation, status, provider_result: providerResult } as unknown as AssessmentOperation;
}

function parseExecutionRecord(value: unknown): ExecutionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed persisted execution record.");
  const record = value as Record<string, unknown>;
  const providerEvidence = record.provider_evidence;
  if (providerEvidence !== undefined && providerEvidence !== null) {
    if (!providerEvidence || typeof providerEvidence !== "object" || Array.isArray(providerEvidence)) {
      throw new Error("Malformed persisted provider reconciliation evidence.");
    }
    const evidence = providerEvidence as Record<string, unknown>;
    if (!(["PENDING", "CONFIRMED", "FAILED", "UNKNOWN"] as unknown[]).includes(evidence.status)) {
      throw new Error("Malformed persisted provider reconciliation status.");
    }
    for (const key of ["transaction_id", "transaction_state", "wallet_id", "source_address", "destination_address", "token_id", "network", "atomic_amount", "operation", "ref_id", "reconciled_at"]) {
      if (evidence[key] !== undefined && typeof evidence[key] !== "string") throw new Error("Malformed persisted provider reconciliation field.");
    }
    for (const key of ["tx_hash", "explorer_reference", "network_fee", "provider_created_at", "provider_updated_at"]) {
      if (evidence[key] !== undefined && evidence[key] !== null && typeof evidence[key] !== "string") throw new Error("Malformed persisted provider reconciliation field.");
    }
    if (evidence.amounts !== undefined && (!Array.isArray(evidence.amounts) || evidence.amounts.some((amount) => typeof amount !== "string"))) {
      throw new Error("Malformed persisted provider reconciliation amounts.");
    }
  }
  if (
    typeof record.obligation_id !== "string" || typeof record.idempotency_key !== "string" ||
    record.idempotency_key.length === 0 ||
    !(record.provider_ref === null || typeof record.provider_ref === "string") ||
    !["SUBMITTING", "SETTLED", "FAILED", "UNKNOWN", "BLOCKED"].includes(String(record.status)) ||
    typeof record.atomic_amount !== "string" || typeof record.destination_address !== "string"
  ) throw new Error("Malformed persisted execution record.");
  return record as unknown as ExecutionRecord & { provider_evidence?: StatusResult | null };
}

function loadLiveUsageSet(): LiveUsageObligationRecord[] {
  const fixturePath = path.join(process.cwd(), "data/live-usage/LIVE_USAGE_SET.json");
  const parsed = JSON.parse(readFileSync(fixturePath, "utf8")) as { records: LiveUsageObligationRecord[] };
  return parsed.records;
}

function toUsdcAmount(rawAmount: string, currency: string): string {
  // During DemoState seeding, unsupported currencies (e.g. EUR in fixtures) fail
  // closed to a zero settlement — they cannot proceed to authorization.
  if (!isSettleableCurrency(currency)) return "0.000000";
  return convertSourceToSettlement(rawAmount, currency).settlementAmount;
}

export class DemoState {
  readonly trustedKeys = new TrustedKeyRegistry();
  readonly store: AuthorityStore;
  readonly worker: ExecutionWorker;
  readonly adapter: FakeProviderAdapter;
  readonly liveUsageRecords: LiveUsageObligationRecord[];
  private readonly sealedPaeByObligation: Map<string, SealedPae>;
  private readonly authorizationHistory: DemoAuthorizationArtifacts[];
  private readonly assessmentOperations: Map<string, AssessmentOperation>;
  private repository?: SupabaseDemoStateRepository;
  private revision?: number;

  constructor(snapshot?: DemoStateSnapshot, repository?: SupabaseDemoStateRepository, revision?: number) {
    this.liveUsageRecords = loadLiveUsageSet();
    this.repository = repository;
    this.revision = revision;
    this.store = snapshot ? AuthorityStore.fromSnapshot(snapshot.authority) : new AuthorityStore();
    this.trustedKeys.restore(snapshot?.trusted_keys ?? []);
    this.adapter = new FakeProviderAdapter(snapshot?.provider_adapter);
    this.sealedPaeByObligation = new Map(snapshot?.sealed_paes.map(([id, pae]) => [id, sealedPaeSchema.parse(pae)]) ?? []);
    this.authorizationHistory = (snapshot?.authorization_history ?? []).map(authorizationArtifactsParser);
    this.assessmentOperations = new Map(
      (snapshot?.assessment_operations ?? []).map((operation) => [operation.idempotency_key, { ...operation }]),
    );
    this.worker = new ExecutionWorker(this.store, this.adapter, () => this.flush(), this.trustedKeys);
    if (snapshot) this.worker.restoreSnapshot(snapshot.execution_ledger);

    if (!snapshot) for (const record of this.liveUsageRecords) {
      const aggregate: AuthorityAggregate = {
        organization_id: DEMO_ORGANIZATION_ID,
        obligation_id: record.obligation_id,
        aggregate_version: 1,
        state: "APPROVAL_PENDING",
        amount: toUsdcAmount(record.amount, record.currency),
        asset: "USDC",
        network: "ARC_TESTNET",
        counterparty_id: `CP-${record.obligation_id}`,
        counterparty_version: 1,
        counterparty_status: "VERIFIED",
        destination_ref: `DEST-${record.obligation_id}-SIMULATED`,
        destination_version: 1,
        product_trust_provenance: "SIMULATED_DEMO_FIXTURE",
        destination_address: simulatedDestinationAddress(record.obligation_id),
        destination_verification_status: DEMO_ARC_TRUST_SIMULATED ? "VERIFIED" : "PENDING_VERIFICATION",
        destination_operational_status: DEMO_ARC_TRUST_SIMULATED ? "ACTIVE" : "ON_HOLD",
        source_wallet_ref: "WALLET-SOURCE-P0-1-SIMULATED",
        source_wallet_version: 1,
        source_wallet_status: DEMO_ARC_TRUST_SIMULATED ? "ACTIVE" : "INACTIVE",
        evidence_hashes: record.source_evidence.map((e) => syntheticEvidenceHash(e.evidence_id)),
        policy_version: "POLICY-P0-1",
        business_hold: false,
        security_freeze: false,
        external_settlement_state: "NONE",
        pae_state: "UNUSED",
        execution_state: "NONE",
        execution_idempotency_key: null,
        reviewed_aggregate_version: null,
        source_amount: record.amount,
        source_currency: record.currency,
        settlement_conversion_rate: !isSettleableCurrency(record.currency) ? null : record.currency === "USD" ? null : convertSourceToSettlement(record.amount, record.currency).conversionRate,
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

  getCanonicalObligation(obligationId: string): CanonicalPaymentObligation | undefined {
    const record = this.getRecord(obligationId);
    return record ? adaptDirectEvidenceObligation(record) : undefined;
  }

  getAssessmentOperation(idempotencyKey: string): AssessmentOperation | undefined {
    const operation = this.assessmentOperations.get(idempotencyKey);
    return operation ? { ...operation } : undefined;
  }

  findUnresolvedAssessmentOperation(obligationId: string, aggregateVersion: number): AssessmentOperation | undefined {
    const operation = this.findUnresolvedAssessmentOperations(obligationId)
      .find((item) => item.aggregate_version === aggregateVersion);
    return operation ? { ...operation } : undefined;
  }

  findUnresolvedAssessmentOperations(obligationId: string): AssessmentOperation[] {
    return [...this.assessmentOperations.values()]
      .filter((item) => item.obligation_id === obligationId && ["RESERVED", "PROVIDER_RESULT_DURABLE", "UNKNOWN"].includes(item.status))
      .map((item) => ({ ...item }));
  }

  hasLivePaeAuthority(obligationId: string): boolean {
    const aggregate = this.store.get(DEMO_ORGANIZATION_ID, obligationId);
    return aggregate.state === "AUTHORIZED" || aggregate.pae_state !== "UNUSED" || Boolean(this.getSealedPae(obligationId));
  }

  reserveAssessmentOperation(idempotencyKey: string, obligationId: string, aggregateVersion: number, reservedAt = Date.now()): AssessmentOperation {
    const existing = this.assessmentOperations.get(idempotencyKey);
    if (existing) {
      if (existing.obligation_id !== obligationId) throw new Error("Idempotency key is already bound to a different assessment request.");
      return { ...existing };
    }
    const aggregate = this.store.get(DEMO_ORGANIZATION_ID, obligationId);
    if (aggregate.aggregate_version !== aggregateVersion) {
      throw new Error("Assessment aggregate changed before provider submission.");
    }
    if (this.hasLivePaeAuthority(obligationId)) throw new Error("Assessment is closed after authorization or PAE creation.");
    const unresolved = this.findUnresolvedAssessmentOperation(obligationId, aggregateVersion);
    if (unresolved) throw new Error("Another assessment operation is unresolved for this obligation and aggregate version.");
    const operation: AssessmentOperation = {
      idempotency_key: idempotencyKey,
      obligation_id: obligationId,
      aggregate_version: aggregateVersion,
      status: "RESERVED",
      reserved_at: reservedAt,
    };
    this.assessmentOperations.set(idempotencyKey, operation);
    return { ...operation };
  }

  checkpointAssessmentResult(idempotencyKey: string, record: DurableAssessmentRecord): AssessmentOperation {
    const operation = this.assessmentOperations.get(idempotencyKey);
    if (!operation || operation.status !== "RESERVED") throw new Error("Assessment operation is not reserved for a provider result.");
    const aggregate = this.store.get(DEMO_ORGANIZATION_ID, operation.obligation_id);
    if (aggregate.aggregate_version !== operation.aggregate_version || this.hasLivePaeAuthority(operation.obligation_id)) {
      operation.status = "STALE";
      delete operation.reserved_at;
      return { ...operation };
    }
    const validated = durableAssessmentRecordSchema.parse(record);
    if (validated.obligation_id !== operation.obligation_id || validated.aggregate_version !== String(operation.aggregate_version) ||
        validated.assessment_id !== `ASM-${operation.idempotency_key}`) {
      throw new Error("Provider result does not match its reserved assessment operation.");
    }
    operation.status = "PROVIDER_RESULT_DURABLE";
    operation.provider_result = validated;
    return { ...operation };
  }

  markAssessmentUnknown(idempotencyKey: string): AssessmentOperation {
    const operation = this.assessmentOperations.get(idempotencyKey);
    if (!operation || operation.status !== "RESERVED") throw new Error("Assessment operation is not reserved for UNKNOWN transition.");
    operation.status = "UNKNOWN";
    return { ...operation };
  }

  completeAssessmentOperation(idempotencyKey: string): AssessmentOperation {
    const operation = this.assessmentOperations.get(idempotencyKey);
    if (!operation || operation.status !== "PROVIDER_RESULT_DURABLE" || !operation.provider_result) {
      throw new Error("Assessment operation has no durable provider result to seal.");
    }
    const aggregate = this.store.get(DEMO_ORGANIZATION_ID, operation.obligation_id);
    if (aggregate.aggregate_version !== operation.aggregate_version || this.hasLivePaeAuthority(operation.obligation_id)) {
      operation.status = "STALE";
      delete operation.provider_result;
      delete operation.reserved_at;
      return { ...operation };
    }
    const sealed = this.store.sealAssessment(operation.provider_result);
    operation.status = "COMPLETED";
    operation.assessment_hash = sealed.assessment_hash;
    delete operation.provider_result;
    delete operation.reserved_at;
    return { ...operation };
  }

  setSealedPae(obligationId: string, sealed: SealedPae): void {
    this.sealedPaeByObligation.set(obligationId, sealed);
  }

  getSealedPae(obligationId: string): SealedPae | undefined {
    return this.sealedPaeByObligation.get(obligationId);
  }

  recordAuthorization(artifacts: DemoAuthorizationArtifacts): void {
    this.authorizationHistory.push(authorizationArtifactsParser(artifacts));
    this.setSealedPae(artifacts.sealed_pae.payload.obligation_ids[0], artifacts.sealed_pae);
  }

  async revokeTrustedKey(signingKeyId: string): Promise<void> {
    if (!this.repository || this.revision === undefined || this.namespace === undefined) {
      throw new Error("A durable repository is required to persist trusted-key revocation.");
    }
    this.trustedKeys.revoke(signingKeyId);
    await this.flush();
  }

  exportSnapshot(): DemoStateSnapshot {
    return {
      schema_version: 2,
      authority: this.store.exportSnapshot(),
      assessment_operations: [...this.assessmentOperations.values()].map((operation) => ({ ...operation })),
      sealed_paes: [...this.sealedPaeByObligation.entries()].map(([id, pae]) => [id, pae]),
      authorization_history: this.authorizationHistory.map((entry) => authorizationArtifactsParser(entry)),
      trusted_keys: this.trustedKeys.export(),
      execution_ledger: this.worker.exportSnapshot(),
      provider_adapter: this.adapter.exportSnapshot(),
    };
  }

  async flush(): Promise<void> {
    if (!this.repository || this.revision === undefined || this.namespace === undefined) return;
    this.revision = await this.repository.compareAndSet(this.namespace, this.revision, this.exportSnapshot() as unknown as Record<string, unknown>);
  }

  private namespace?: string;

  attachRepository(repository: SupabaseDemoStateRepository, namespace: string, revision: number): void {
    this.repository = repository;
    this.namespace = namespace;
    this.revision = revision;
  }
}

/** Separate persistence namespace and authority root for the real Arc
 * Testnet demonstration. It intentionally has no genuine-obligation list
 * and never shares the simulated provider adapter. */
export class J2aRealTestnetDemoState {
  readonly trustedKeys = new TrustedKeyRegistry();
  readonly store: AuthorityStore;
  readonly worker: ExecutionWorker;
  private readonly sealedPaeByObligation: Map<string, SealedPae>;
  private readonly authorizationHistory: DemoAuthorizationArtifacts[];
  private repository?: SupabaseDemoStateRepository;
  private revision?: number;
  private namespace?: string;
  lastPreflight: J2aPreflightResult | null;

  constructor(
    snapshot?: DemoStateSnapshot & { j2a_preflight?: J2aPreflightResult | null },
    repository?: SupabaseDemoStateRepository,
    revision?: number,
    providerAdapter?: ProviderAdapter,
  ) {
    this.store = snapshot ? AuthorityStore.fromSnapshot(snapshot.authority) : new AuthorityStore();
    this.trustedKeys.restore(snapshot?.trusted_keys ?? []);
    this.sealedPaeByObligation = new Map(snapshot?.sealed_paes.map(([id, pae]) => [id, sealedPaeSchema.parse(pae)]) ?? []);
    this.authorizationHistory = (snapshot?.authorization_history ?? []).map(authorizationArtifactsParser);
    this.lastPreflight = snapshot?.j2a_preflight ?? null;
    this.repository = repository;
    this.revision = revision;
    this.worker = new ExecutionWorker(
      this.store,
      providerAdapter ?? new ArcCircleProviderAdapter(undefined, () => this.lastPreflight),
      () => this.flush(),
      this.trustedKeys,
    );
    if (snapshot) this.worker.restoreSnapshot(snapshot.execution_ledger);
  }

  getSealedPae(obligationId: string): SealedPae | undefined {
    return this.sealedPaeByObligation.get(obligationId);
  }

  getAuthorizationArtifacts(obligationId: string): DemoAuthorizationArtifacts | undefined {
    return [...this.authorizationHistory].reverse().find((entry) =>
      entry.sealed_pae.payload.organization_id === "ORG-TAMEION-TESTNET-DEMO" &&
      entry.sealed_pae.payload.obligation_ids[0] === obligationId,
    );
  }

  setSealedPae(obligationId: string, sealed: SealedPae): void {
    this.sealedPaeByObligation.set(obligationId, sealed);
  }

  recordAuthorization(artifacts: DemoAuthorizationArtifacts): void {
    const validated = authorizationArtifactsParser(artifacts);
    this.authorizationHistory.push(validated);
    this.setSealedPae(validated.sealed_pae.payload.obligation_ids[0], validated.sealed_pae);
  }

  async revokeTrustedKey(signingKeyId: string): Promise<void> {
    if (!this.repository || this.revision === undefined || this.namespace === undefined) {
      throw new Error("A durable repository is required to persist trusted-key revocation.");
    }
    this.trustedKeys.revoke(signingKeyId);
    await this.flush();
  }

  recordPreflight(result: J2aPreflightResult): void {
    this.lastPreflight = result;
    if (result.readiness !== "READY") return;
    const organizationId = result.organization_id;
    const obligationId = result.obligation_id;
    try {
      const current = this.store.get(organizationId, obligationId);
      if (current.evidence_hashes[0] === result.evidence_sha256) return;
      const advanced = this.store.applyMaterialChange(organizationId, obligationId, current.aggregate_version, {
        destination_version: current.destination_version + 1,
      });
      this.store.seed({ ...advanced, evidence_hashes: [result.evidence_sha256] });
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error && (error as { code?: unknown }).code === "OBL-003")) throw error;
      this.store.seed(buildJ2aDemoAggregate(result));
    }
  }

  exportSnapshot(): DemoStateSnapshot & { j2a_preflight: J2aPreflightResult | null } {
    return {
      schema_version: 2,
      authority: this.store.exportSnapshot(),
      assessment_operations: [],
      sealed_paes: [...this.sealedPaeByObligation.entries()].map(([id, pae]) => [id, pae]),
      authorization_history: this.authorizationHistory.map((entry) => authorizationArtifactsParser(entry)),
      trusted_keys: this.trustedKeys.export(),
      execution_ledger: this.worker.exportSnapshot(),
      provider_adapter: new FakeProviderAdapter().exportSnapshot(),
      j2a_preflight: this.lastPreflight,
    };
  }

  async flush(): Promise<void> {
    if (!this.repository || this.revision === undefined || this.namespace === undefined) return;
    this.revision = await this.repository.compareAndSet(this.namespace, this.revision, this.exportSnapshot() as unknown as Record<string, unknown>);
  }

  attachRepository(repository: SupabaseDemoStateRepository, namespace: string, revision: number): void {
    this.repository = repository;
    this.namespace = namespace;
    this.revision = revision;
  }
}

function emptyJ2aSnapshot(): DemoStateSnapshot & { j2a_preflight: null } {
  return {
    schema_version: 2,
    authority: new AuthorityStore().exportSnapshot(),
    assessment_operations: [],
    sealed_paes: [],
    authorization_history: [],
    trusted_keys: [],
    execution_ledger: [],
    provider_adapter: new FakeProviderAdapter().exportSnapshot(),
    j2a_preflight: null,
  };
}

function parseJ2aSnapshot(value: unknown): DemoStateSnapshot & { j2a_preflight: J2aPreflightResult | null } {
  const parsed = parseDemoStateSnapshot(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed J2A demo-state snapshot.");
  const rawPreflight = (value as Record<string, unknown>).j2a_preflight;
  return {
    ...parsed,
    j2a_preflight: rawPreflight === null || rawPreflight === undefined ? null : j2aPreflightResultSchema.parse(rawPreflight),
  };
}

async function createPersistentJ2aState(url: string, serviceRoleKey: string): Promise<J2aRealTestnetDemoState> {
  const namespace = `${stateNamespace()}-j2a-real-testnet-demo`;
  const repository = new SupabaseDemoStateRepository(url, serviceRoleKey);
  const stored = await repository.loadOrSeed(namespace, emptyJ2aSnapshot() as unknown as Record<string, unknown>);
  const state = new J2aRealTestnetDemoState(parseJ2aSnapshot(stored.snapshot), repository, stored.revision);
  state.attachRepository(repository, namespace, stored.revision);
  await migrateLegacyTrustedKeys(stored.snapshot, state);
  return state;
}

async function migrateLegacyTrustedKeys(
  snapshot: Record<string, unknown>,
  state: { flush(): Promise<void> },
): Promise<void> {
  if (snapshot.schema_version !== 1) return;
  // Legacy snapshots contain no authoritative trust or revocation status.
  // Their PAEs remain non-executable; current signing secrets do not prove
  // that a legacy key was never revoked.
  await state.flush();
}

export async function getJ2aRealTestnetDemoState(): Promise<J2aRealTestnetDemoState> {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const mustBeDurable = process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production";
  if (Boolean(url) !== Boolean(serviceRoleKey)) {
    throw new Error("Both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for durable J2A demo state.");
  }
  if (url && serviceRoleKey) return createPersistentJ2aState(url, serviceRoleKey);
  if (mustBeDurable) throw new Error("Vercel Preview/Production requires durable J2A demo state; in-memory state is disabled.");
  if (!globalThis.__tameionJ2aDemoState) globalThis.__tameionJ2aDemoState = new J2aRealTestnetDemoState(emptyJ2aSnapshot());
  return globalThis.__tameionJ2aDemoState;
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
  // eslint-disable-next-line no-var
  var __tameionJ2aDemoState: J2aRealTestnetDemoState | undefined;
}

function stateNamespace(): string {
  const deploymentEnvironment = process.env.VERCEL_ENV;
  if (deploymentEnvironment === "production") return "production-demo";
  if (deploymentEnvironment === "preview") {
    const pullRequest = process.env.VERCEL_GIT_PULL_REQUEST_ID;
    if (pullRequest && /^\d+$/.test(pullRequest)) return `preview-pr${pullRequest}`;
    const branch = (process.env.VERCEL_GIT_COMMIT_REF ?? "unknown-branch").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return `preview-${(branch || "unknown-branch").slice(0, 88)}`;
  }
  return "local-development";
}

async function createPersistentDemoState(url: string, serviceRoleKey: string): Promise<DemoState> {
  const namespace = stateNamespace();
  const repository = new SupabaseDemoStateRepository(url, serviceRoleKey);
  const initial = new DemoState();
  const stored = await repository.loadOrSeed(namespace, initial.exportSnapshot() as unknown as Record<string, unknown>);
  const state = new DemoState(parseDemoStateSnapshot(stored.snapshot), repository, stored.revision);
  state.attachRepository(repository, namespace, stored.revision);
  await migrateLegacyTrustedKeys(stored.snapshot, state);
  return state;
}

export async function getDemoState(): Promise<DemoState> {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const mustBeDurable = process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production";

  if (Boolean(url) !== Boolean(serviceRoleKey)) {
    throw new Error("Both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for durable demo state.");
  }
  if (url && serviceRoleKey) return createPersistentDemoState(url, serviceRoleKey);
  if (mustBeDurable) {
    throw new Error("Vercel Preview/Production requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY; in-memory state is disabled.");
  }

  if (!globalThis.__tameionDemoState) {
    globalThis.__tameionDemoState = new DemoState();
  }
  return globalThis.__tameionDemoState;
}
