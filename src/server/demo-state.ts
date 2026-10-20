import {z} from 'zod';
import {parseSourceRevisions,type SourceRevision} from '../domain/source-revision';
import {assessmentBootstrapSchema,assessmentRecoverySchema,assertAssessmentLineage,type AssessmentBootstrap,type AssessmentRecovery} from "./genuine-assessment-recovery";
import {assessmentDispositionSchema,assertDispositionLineage,type AssessmentDisposition} from "./genuine-disposition";
import {AssessmentState,type LateAssessmentResult} from './assessment-state';
import {parseLinkedInstructions,type LinkedInstruction} from '../domain/linked-instruction';
import {parsePaymentReleases,type PaymentReleaseApproval} from '../domain/payment-release-approval';
import {loadFinancialSourceAdmission} from "./financial-source-admission";
import { createHash } from "node:crypto";

import { AuthorityStore, type AuthorityAggregate } from "../authority/aggregate";
import { ActorAuthorityRegistry, type ActorAuthorityRecord } from "../authority/actor-authority";
import { ExecutionWorker, type ExecutionRecord, type ExecutionWorkerOptions } from "../execution/worker";
import type { ProviderAdapter } from "../execution/provider-adapter";
import type { StatusResult } from "../execution/provider-adapter";
import { FakeProviderAdapter, type FakeProviderAdapterSnapshot } from "../execution/fake-provider-adapter";
import { ArcCircleProviderAdapter } from "../execution/provider-adapter";
import type { LiveUsageObligationRecord } from "../agent/context-builder";
import { loadPublicSourceRecords } from "./source-records";
import { selectSoleCandidate } from "../agent/finance-agent";
import {
  buildJ2aDemoAggregate,
  hashJ2aPreflightEvidence,
  j2aPreflightResultSchema,
  type GenuineSettlementProxyIntent,
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
  beneficiary_name?: string;
  beneficiary_provenance?: { provenance_class: "SOURCE_EVIDENCE"; evidence_id: string };
}

export interface DemoAuthorizationArtifacts {
  approval_record: DurableApprovalRecord;
  approval_record_hash: string;
  assurance_record: DurableAssuranceRecord;
  assurance_hash: string;
  sealed_pae: SealedPae;
}

export interface DemoStateSnapshot {
  linked_retirement_checks?:Array<{request_id:string;instruction_id:string;namespace:string;revision:number}>;
  linked_activation_receipts?:Array<{instruction_id:string;source_obligation_id:string;namespace:string;source_sha256:string;activated_at:string}>;
  source_revisions?:SourceRevision[];
  source_ingress_anchor?:string;
  readiness_observations?:Array<{obligation_id:string;aggregate_version:number;observed_at:string;result:J2aPreflightResult}>;
  recovery_events?:Array<{request_id:string;request_sha256:string;obligation_id:string;predecessor_key:string;predecessor_sha256:string;actor_id:string;reason:string;created_at:string;predecessor_pae:SealedPae;predecessor_preflight:StoredSettlementProxy}>;
  schema_version: 2;
  late_assessment_results?:LateAssessmentResult[];
  linked_settlement_instructions?: LinkedInstruction[];
  authority: ReturnType<AuthorityStore["exportSnapshot"]>;
  assessment_operations: AssessmentOperation[];
  sealed_paes: Array<[string, SealedPae]>;
  authorization_history: DemoAuthorizationArtifacts[];
  trusted_keys: TrustedKeyEntry[];
  actor_authorities: ActorAuthorityRecord[];
  actor_authority_registry_initialized: boolean;
  execution_ledger: ExecutionRecord[];
  provider_adapter: FakeProviderAdapterSnapshot;
  settlement_proxies?: StoredSettlementProxy[];
  payment_release_approvals?: PaymentReleaseApproval[];
}

export interface StoredSettlementProxy {
  preflight: Extract<J2aPreflightResult, { readiness: "READY" }>;
  source_aggregate_version: number;
  mapped_aggregate_version: number;
}

export interface AssessmentOperation {
  recovery?: AssessmentRecovery;
  bootstrap?: AssessmentBootstrap;
  legacy_disposition?: AssessmentDisposition;
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
    approval.review_decision_id !== evidence.review_decision_id || approval.review_decision_hash !== evidence.review_decision_hash ||
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
  if (snapshot.actor_authority_registry_initialized !== undefined && typeof snapshot.actor_authority_registry_initialized !== "boolean") {
    throw new Error("Malformed actor-authority registry bootstrap marker.");
  }
  const actorAuthorityRegistryInitialized = snapshot.actor_authority_registry_initialized ?? Array.isArray(snapshot.actor_authorities);
  const actorAuthorities = snapshot.actor_authorities === undefined
    ? []
    : new ActorAuthorityRegistry(snapshot.actor_authorities).export();
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
  const reviewStore=AuthorityStore.fromSnapshot(snapshot.authority as DemoStateSnapshot["authority"]);
  for (const authorization of authorizationHistory) {
    const approval=authorization.approval_record;
    if(approval.review_decision_id){
      const review=reviewStore.exportSnapshot().review_decisions?.find(r=>r.record.decision_id===approval.review_decision_id&&r.hash===approval.review_decision_hash);
      if(!review||review.record.organization_id!==approval.organization_id||review.record.obligation_id!==approval.obligation_id||String(review.record.aggregate_version)!==approval.reviewed_aggregate_version||review.record.decision!=="ACCEPT_FOR_AUTHORIZATION")throw new Error("Authorization references invalid human review");
      continue;
    }
    const assessment = assessmentsByHash.get(authorization.approval_record.assessment_hash!);
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
    const retired=parseRecoveryEvents(snapshot.recovery_events??[]).some(e=>e.obligation_id===obligationId&&e.predecessor_pae.instruction_hash===authorization.sealed_pae.instruction_hash&&e.predecessor_pae.signature===authorization.sealed_pae.signature&&(snapshot.execution_ledger as unknown[]).some(value=>{const r=parseExecutionRecord(value);return r.idempotency_key===e.predecessor_key&&sha256Hex(canonicalBytes(r))===e.predecessor_sha256&&((r.status==='BLOCKED'&&r.dispatch_evidence==='PROVEN_NOT_DISPATCHED'&&r.provider_ref===null)||(r.status==='FAILED'&&r.provider_evidence?.status==='FAILED'&&typeof r.provider_evidence.network_fee==='string'));}));
    if ((!currentPae || currentPae.instruction_hash !== authorization.sealed_pae.instruction_hash)&&!retired) {
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
  assertAssessmentLineage(assessmentOperations);
  assertDispositionLineage(assessmentOperations, [...assessmentsByHash.values()].map((assessment) => assessment.assessment_id));
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
  const rawSettlementProxies = snapshot.settlement_proxies ?? [];
  if (!Array.isArray(rawSettlementProxies)) throw new Error("Malformed persisted settlement-proxy evidence.");
  const settlementProxies = rawSettlementProxies.map((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed persisted settlement-proxy evidence.");
    const item = value as Record<string, unknown>;
    const preflight = j2aPreflightResultSchema.parse(item.preflight);
    if (preflight.readiness !== "READY" || preflight.organization_id !== DEMO_ORGANIZATION_ID ||
        !Number.isSafeInteger(item.source_aggregate_version) || (item.source_aggregate_version as number) < 1 ||
        !Number.isSafeInteger(item.mapped_aggregate_version) || (item.mapped_aggregate_version as number) !== (item.source_aggregate_version as number) + 1) {
      throw new Error("Persisted settlement-proxy identity or aggregate binding is invalid.");
    }
    return {
      preflight,
      source_aggregate_version: item.source_aggregate_version as number,
      mapped_aggregate_version: item.mapped_aggregate_version as number,
    };
  });
  if (new Set(settlementProxies.map(({ preflight }) => preflight.obligation_id)).size !== settlementProxies.length) {
    throw new Error("Persisted settlement-proxy evidence contains duplicate obligation identities.");
  }
  return {
    schema_version: 2,
    ...(snapshot.linked_retirement_checks!==undefined?{linked_retirement_checks:z.array(z.object({request_id:z.uuid(),instruction_id:z.string().min(1),namespace:z.string().min(1),revision:z.number().int().positive()}).strict()).max(1000).parse(snapshot.linked_retirement_checks)}:{}),
    ...(snapshot.linked_activation_receipts!==undefined?{linked_activation_receipts:z.array(z.object({instruction_id:z.string().min(1),source_obligation_id:z.string().min(1),namespace:z.string().min(1),source_sha256:z.string().regex(/^[a-f0-9]{64}$/),activated_at:z.iso.datetime()}).strict()).max(1000).parse(snapshot.linked_activation_receipts)}:{}),
    ...(snapshot.late_assessment_results!==undefined?{late_assessment_results:parseLateAssessmentResults(snapshot.late_assessment_results,assessmentOperations)}:{}),
    ...(snapshot.readiness_observations!==undefined?{readiness_observations:parseReadinessObservations(snapshot.readiness_observations)}:{}),
    ...(snapshot.recovery_events!==undefined?{recovery_events:parseRecoveryEvents(snapshot.recovery_events)}:{}),
    ...(snapshot.source_ingress_anchor!==undefined?{source_ingress_anchor:parseSha256(snapshot.source_ingress_anchor)}:{}),
    ...(snapshot.source_revisions!==undefined?{source_revisions:parseSourceRevisions(snapshot.source_revisions)}:{}),
    ...(snapshot.linked_settlement_instructions !== undefined ? {linked_settlement_instructions:parseLinkedInstructions(snapshot.linked_settlement_instructions)} : {}),
    authority: snapshot.authority as DemoStateSnapshot["authority"],
    assessment_operations: assessmentOperations,
    sealed_paes: sealedPaes,
    authorization_history: authorizationHistory,
    trusted_keys: trustedKeys,
    actor_authorities: actorAuthorities,
    actor_authority_registry_initialized: actorAuthorityRegistryInitialized,
    execution_ledger: executionLedger,
    provider_adapter: providerAdapter,
    settlement_proxies: settlementProxies,
    payment_release_approvals: parsePaymentReleases(snapshot.payment_release_approvals, authorizationHistory.map(a=>a.sealed_pae)),
  };
}

function parseLateAssessmentResults(value:unknown,operations:AssessmentOperation[]):LateAssessmentResult[]{
 if(!Array.isArray(value)||value.length>1000)throw new Error('Late result history invalid');
 const keys=new Set<string>();
 return value.map(v=>{const record=durableAssessmentRecordSchema.parse(v.record),hash=sha256Hex(canonicalBytes(record));const op=operations.find(o=>o.idempotency_key===v.idempotency_key);if(!op||record.assessment_id!==`ASM-${op.idempotency_key}`||record.obligation_id!==op.obligation_id||record.aggregate_version!==String(op.aggregate_version)||v.assessment_hash!==hash||keys.has(v.idempotency_key))throw new Error('Late result identity invalid');keys.add(v.idempotency_key);return {idempotency_key:v.idempotency_key,record,assessment_hash:hash};});
}

function parseReadinessObservations(value:unknown):NonNullable<DemoStateSnapshot['readiness_observations']>{
  if(!Array.isArray(value)||value.length>1000)throw new Error('Readiness history invalid');
  return value.map(v=>{if(!v||typeof v!=='object'||typeof v.obligation_id!=='string'||!Number.isSafeInteger(v.aggregate_version)||typeof v.observed_at!=='string')throw new Error('Readiness observation invalid');return {...v,result:j2aPreflightResultSchema.parse(v.result)};});
}

function parseRecoveryEvents(value:unknown):NonNullable<DemoStateSnapshot['recovery_events']>{
  if(!Array.isArray(value)||value.length>1000)throw new Error('Recovery history invalid');
  const requests=new Set<string>();
  for(const event of value){if(!event||typeof event!=='object'||typeof event.request_id!=='string'||requests.has(event.request_id)||!event.predecessor_pae||!event.predecessor_preflight||!/^[a-f0-9]{64}$/.test(event.predecessor_sha256))throw new Error('Recovery history invalid');sealedPaeSchema.parse(event.predecessor_pae);j2aPreflightResultSchema.parse(event.predecessor_preflight.preflight);requests.add(event.request_id);}
  return structuredClone(value);
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
  const recovery=operation.recovery===undefined?undefined:assessmentRecoverySchema.parse(operation.recovery);
  const bootstrap=operation.bootstrap===undefined?undefined:assessmentBootstrapSchema.parse(operation.bootstrap);
  if(bootstrap&&(!recovery||recovery.generation!==0||recovery.source_record_sha256!==bootstrap.source_record_sha256||recovery.binding_sha256!==bootstrap.binding_sha256||
    bootstrap.aggregate_version!==operation.aggregate_version||bootstrap.unmatched_reference_key===operation.idempotency_key||
    status==="COMPLETED"&&!Number.isSafeInteger(operation.reserved_at)))throw new Error("Malformed assessment bootstrap metadata.");
  const disposition=operation.legacy_disposition===undefined?undefined:assessmentDispositionSchema.parse(operation.legacy_disposition);
  if(disposition&&(!recovery||recovery.generation!==0||bootstrap))throw new Error("Malformed assessment disposition metadata.");
  return { ...operation, status, ...(recovery?{recovery}:{}), ...(bootstrap?{bootstrap}:{}), ...(disposition?{legacy_disposition:disposition}:{}), ...(providerResult?{provider_result:providerResult}:{}) } as unknown as AssessmentOperation;
}

function parseExecutionRecord(value: unknown): ExecutionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Malformed persisted execution record.");
  const record = value as Record<string, unknown>;
  if(record.provider_observations!==undefined){if(!Array.isArray(record.provider_observations)||record.provider_observations.length>1000)throw new Error('Provider observation history malformed');for(const evidence of record.provider_observations)parseExecutionRecord({...record,provider_observations:undefined,provider_evidence:evidence});}
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

function toUsdcAmount(rawAmount: string, currency: string): string {
  // During DemoState seeding, unsupported currencies (e.g. EUR in fixtures) fail
  // closed to a zero settlement — they cannot proceed to authorization.
  if (!isSettleableCurrency(currency)) return "0.000000";
  return convertSourceToSettlement(rawAmount, currency).settlementAmount;
}

export class DemoState extends AssessmentState {
  readonly trustedKeys = new TrustedKeyRegistry();
  readonly actorAuthorities: ActorAuthorityRegistry;
  private actorAuthorityRegistryInitialized: boolean;
  private readonly linkedRetirementChecks:DemoStateSnapshot['linked_retirement_checks'];
  private readonly linkedActivationReceipts:DemoStateSnapshot['linked_activation_receipts'];
  private readonly sourceRevisions:SourceRevision[];
  private readonly sourceIngressAnchor?:string;
  private readonly readinessObservations:NonNullable<DemoStateSnapshot["readiness_observations"]>;
  private readonly recoveryEvents:NonNullable<DemoStateSnapshot["recovery_events"]>;
  readonly worker: ExecutionWorker;
  readonly adapter: FakeProviderAdapter;
  readonly providerAdapter: ProviderAdapter;
  readonly liveUsageRecords: LiveUsageObligationRecord[];
  private readonly sealedPaeByObligation: Map<string, SealedPae>;
  private readonly authorizationHistory: DemoAuthorizationArtifacts[];
  private readonly paymentReleaseApprovals: PaymentReleaseApproval[];
  private readonly settlementProxies: Map<string, StoredSettlementProxy>;
  private repository?: SupabaseDemoStateRepository;
  private revision?: number;

  constructor(
    snapshot?: DemoStateSnapshot,
    repository?: SupabaseDemoStateRepository,
    revision?: number,
    adapter?: ProviderAdapter,
    workerOptions: ExecutionWorkerOptions = {},
    sourceRecords: readonly LiveUsageObligationRecord[] = loadPublicSourceRecords(),
  ) {
    super(snapshot ? AuthorityStore.fromSnapshot(snapshot.authority) : new AuthorityStore(), new Map((snapshot?.assessment_operations ?? []).map(operation=>[operation.idempotency_key,structuredClone(operation)])),snapshot?.late_assessment_results??[]);
    this.linkedInstructions = snapshot?.linked_settlement_instructions===undefined?undefined:parseLinkedInstructions(snapshot.linked_settlement_instructions);
    this.linkedRetirementChecks=snapshot?.linked_retirement_checks;
    this.linkedActivationReceipts=snapshot?.linked_activation_receipts;
    this.sourceRevisions=parseSourceRevisions(snapshot?.source_revisions);
    this.sourceIngressAnchor=snapshot?.source_ingress_anchor;
    this.recoveryEvents=parseRecoveryEvents(snapshot?.recovery_events??[]);
    this.readinessObservations=parseReadinessObservations(snapshot?.readiness_observations??[]);
    this.liveUsageRecords = structuredClone([...sourceRecords]);
    this.repository = repository;
    this.revision = revision;
    this.actorAuthorityRegistryInitialized = snapshot?.actor_authority_registry_initialized ?? !snapshot;
    this.actorAuthorities = new ActorAuthorityRegistry(snapshot?.actor_authorities ?? (snapshot ? [] : [ActorAuthorityRegistry.seedP0Approver(DEMO_ORGANIZATION_ID)]));
    this.trustedKeys.restore(snapshot?.trusted_keys ?? []);
    this.adapter = new FakeProviderAdapter(snapshot?.provider_adapter);
    this.sealedPaeByObligation = new Map(snapshot?.sealed_paes.map(([id, pae]) => [id, sealedPaeSchema.parse(pae)]) ?? []);
    this.authorizationHistory = (snapshot?.authorization_history ?? []).map(authorizationArtifactsParser);
    this.paymentReleaseApprovals = parsePaymentReleases(snapshot?.payment_release_approvals,this.authorizationHistory.map(a=>a.sealed_pae));
    this.settlementProxies = new Map((snapshot?.settlement_proxies ?? []).map((item) => [item.preflight.obligation_id, structuredClone(item)]));
    this.providerAdapter = adapter ?? this.adapter;
    this.worker = new ExecutionWorker(this.store, this.providerAdapter, () => this.flush(), this.trustedKeys, {
      ...workerOptions,
      walletBudgetForIntent:workerOptions.walletBudgetForIntent??(id=>{const observed=this.readinessObservations.findLast(o=>o.obligation_id===id)?.result;const p=observed?.readiness==='READY'?observed:this.getSettlementProxy(id)?.preflight;return p?{balance:p.source_balance,total:p.max_total_debit,observed_at:p.captured_at}:undefined;}),
      loadAuthorizationArtifacts: workerOptions.loadAuthorizationArtifacts ?? ((organizationId, obligationId) =>
        organizationId === DEMO_ORGANIZATION_ID ? this.getAuthorizationArtifacts(obligationId) : undefined),
      resolveActorAuthority: workerOptions.resolveActorAuthority ?? ((actorId, organizationId) => this.actorAuthorities.resolve(organizationId, actorId)),
      reloadDurableExecutionContext: workerOptions.reloadDurableExecutionContext ?? (async (organizationId, obligationId) => {
        if (!this.repository || !this.namespace) {
          return {
            authorization: this.getAuthorizationArtifacts(obligationId) ?? null,
            aggregate: this.store.get(organizationId, obligationId),
            trustedKeys: this.trustedKeys.export(),
            actorAuthorities: this.actorAuthorities.export(),
            executionKillSwitched: this.store.isExecutionKillSwitched(organizationId, obligationId),
          };
        }
        const stored = await this.repository.loadOrSeed(this.namespace, this.exportSnapshot() as unknown as Record<string, unknown>);
        const current = parseDemoStateSnapshot(stored.snapshot);
        const currentStore = AuthorityStore.fromSnapshot(current.authority);
        const authorization = current.authorization_history.map(authorizationArtifactsParser).reverse().find((entry) =>
          entry.sealed_pae.payload.organization_id === organizationId &&
          entry.sealed_pae.payload.obligation_ids[0] === obligationId,
        ) ?? null;
        return {
          authorization,
          aggregate: currentStore.get(organizationId, obligationId),
          trustedKeys: current.trusted_keys,
          actorAuthorities: current.actor_authorities,
          executionKillSwitched: currentStore.isExecutionKillSwitched(organizationId, obligationId),
        };
      }),
    });
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
      ...(r.beneficiary_name !== undefined ? { beneficiary_name: r.beneficiary_name, beneficiary_provenance: r.beneficiary_provenance } : {}),
    }));
  }

  getRecord(obligationId: string): LiveUsageObligationRecord | undefined {
    return this.liveUsageRecords.find((r) => r.obligation_id === obligationId);
  }

  getCanonicalObligation(obligationId: string): CanonicalPaymentObligation | undefined {
    const record = this.getRecord(obligationId);
    return record ? adaptDirectEvidenceObligation(record) : undefined;
  }

  getSolePayCandidateId(): string | null {
    const decisions = this.liveUsageRecords.map((record) => this.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, record.obligation_id));
    if (decisions.some((assessment) => !assessment)) return null;
    const selection = selectSoleCandidate(
      decisions.map((assessment) => ({ obligation_id: assessment!.record.obligation_id, decision: assessment!.record.decision })),
      Object.fromEntries(this.liveUsageRecords.map((record) => [record.obligation_id, record.effective_due_date ?? null])),
    );
    return selection.selected_obligation_id;
  }

  createSettlementProxyIntent(obligationId: string): GenuineSettlementProxyIntent {
    const record = this.getRecord(obligationId);
    if (!record) throw new Error("Selected ID is not in the frozen genuine obligation set.");
    const aggregate = this.store.get(DEMO_ORGANIZATION_ID, obligationId);
    const conversion = convertSourceToSettlement(record.amount, record.currency);
    const controlled = obligationId.startsWith("TESTNET-CONTROLLED-") ? loadFinancialSourceAdmission() : undefined;
    if (controlled && (controlled.source.obligation_id !== obligationId || JSON.stringify(controlled.source) !== JSON.stringify(record))) throw new Error("Controlled source admission changed.");
    if (!controlled && (!record.issue_date || !record.effective_due_date || !record.effective_due_date_basis || !record.commercial_terms)) {
      throw new Error("Selected source record lacks the dated commercial facts required for a truthful settlement proxy instruction.");
    }
    if (aggregate.source_amount !== record.amount || aggregate.source_currency !== record.currency || aggregate.amount !== conversion.settlementAmount) {
      throw new Error("Source amount or settlement conversion is stale; refresh the selected obligation before proxy preflight.");
    }
    return {
      resolved_outbound_proofs:this.worker.exportSnapshot().flatMap(record=>{const e=record.provider_evidence;return e&&record.provider_ref&&e.ref_id&&e.transaction_id===record.provider_ref&&typeof e.network_fee==='string'&&['COMPLETE','FAILED','DENIED','CANCELLED'].includes(e.transaction_state??'')&&((record.status==='SETTLED'&&e.status==='CONFIRMED')||(record.status==='FAILED'&&e.status==='FAILED'))?[{ref_id:e.ref_id,transaction_id:e.transaction_id,transaction_state:e.transaction_state!,network_fee:e.network_fee}]:[];}),
      organization_id: DEMO_ORGANIZATION_ID,
      obligation_id: obligationId,
      source_amount: record.amount,
      source_currency: record.currency,
      settlement_amount: conversion.settlementAmount,
      source_evidence_ids: record.source_evidence.map((evidence) => evidence.evidence_id),
      classification: controlled?.classification ?? "Genuine business obligation · Arc Testnet settlement proxy · testnet execution does not discharge the real-world payable.",
      invoice_reference: controlled ? null : obligationId,
      invoice_date: controlled ? null : record.issue_date!,
      effective_due_date: controlled ? null : record.effective_due_date!,
      payment_basis: controlled ? "EXACT_OWNER_CONTROLLED_TESTNET_INSTRUCTION" : record.effective_due_date_basis!,
      particulars: record.commercial_terms,
    };
  }

  getSettlementProxy(obligationId: string): StoredSettlementProxy | undefined {
    const found = this.settlementProxies.get(obligationId);
    return found ? structuredClone(found) : undefined;
  }

  getSettlementProxyByIdempotencyKey(idempotencyKey: string): StoredSettlementProxy | undefined {
    for (const sealed of this.sealedPaeByObligation.values()) {
      if (sealed.payload.idempotency_key === idempotencyKey){const proxy=this.getSettlementProxy(sealed.payload.obligation_ids[0]);return proxy&&sealed.payload.evidence_hashes.includes(proxy.preflight.evidence_sha256)&&hashJ2aPreflightEvidence(proxy.preflight as unknown as Record<string,unknown>)===proxy.preflight.evidence_sha256&&proxy.preflight.source_wallet.id===sealed.payload.source_wallet_ref&&proxy.preflight.amount===sealed.payload.amount&&proxy.preflight.destination_wallet.address.toLowerCase()===sealed.payload.destination_address.toLowerCase()?proxy:undefined;}
    }
    return undefined;
  }

  bindSettlementProxy(
    preflight: Extract<J2aPreflightResult, { readiness: "READY" }>,
    expectedVersion: number,
  ): StoredSettlementProxy {
    const intent = this.createSettlementProxyIntent(preflight.obligation_id);
    const current = this.store.get(DEMO_ORGANIZATION_ID, preflight.obligation_id);
    if (current.aggregate_version !== expectedVersion) throw new Error("Settlement proxy preflight is stale; refresh the selected aggregate version.");
    if (preflight.organization_id !== DEMO_ORGANIZATION_ID || preflight.profile !== "GENUINE_OBLIGATION_ARC_TESTNET_PROXY" ||
        preflight.source_amount !== intent.source_amount || preflight.source_currency !== intent.source_currency ||
        preflight.amount !== intent.settlement_amount || preflight.source_evidence_ids.join("\0") !== intent.source_evidence_ids.join("\0") ||
        preflight.business_payment_instruction.payer.organization_id !== DEMO_ORGANIZATION_ID ||
        preflight.business_payment_instruction.commercial.obligation_id !== preflight.obligation_id ||
        preflight.business_payment_instruction.commercial.source_amount !== intent.source_amount ||
        preflight.business_payment_instruction.commercial.source_currency !== intent.source_currency ||
        preflight.business_payment_instruction.commercial.settlement_amount !== intent.settlement_amount ||
        preflight.business_payment_instruction.commercial.source_evidence_ids?.join("\0") !== intent.source_evidence_ids.join("\0") ||
        hashJ2aPreflightEvidence(preflight as unknown as Record<string, unknown>) !== preflight.evidence_sha256) {
      throw new Error("Arc Testnet proxy preflight does not bind the selected genuine source identity and derived amount.");
    }
    if (this.settlementProxies.has(preflight.obligation_id) || this.hasLivePaeAuthority(preflight.obligation_id)) {
      throw new Error("A proxy intent or authorization already exists for this source obligation; refresh and reconcile its current state.");
    }
    const humanAccepted=this.store.getCurrentReviewDecision(DEMO_ORGANIZATION_ID,preflight.obligation_id)?.record.decision==="ACCEPT_FOR_AUTHORIZATION";
    const assessment = this.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, preflight.obligation_id);
    if (!humanAccepted && (!assessment || assessment.record.provider_mode !== "LIVE_AI" || assessment.record.decision !== "PAY" ||
        assessment.record.missing_evidence.length !== 0 || !assessment.record.race ||
        assessment.record.race.result.decision !== "PAY" || assessment.record.race.result.validated_findings.length !== 0 ||
        assessment.record.race.remediation.length !== 0)) {
      throw new Error("Only a current LIVE_AI PAY assessment with no findings or missing evidence can prepare an Arc Testnet proxy.");
    }
    const unassessed = this.store.findUnassessedObligation(DEMO_ORGANIZATION_ID);
    if (!humanAccepted && unassessed) throw new Error(`Assess every frozen genuine obligation before preparing a proxy (${unassessed} is not current).`);
    const otherCandidate = this.store.findCommittedCandidateExcluding(DEMO_ORGANIZATION_ID, preflight.obligation_id);
    if (!humanAccepted && otherCandidate) throw new Error(`Another genuine obligation already has a committed proxy or live PAE (${otherCandidate}).`);
    const versioned = this.store.applyMaterialChange(DEMO_ORGANIZATION_ID, preflight.obligation_id, expectedVersion, {
      counterparty_id: preflight.beneficiary_id,
      counterparty_version: current.counterparty_version + 1,
      destination_ref: `ARC-TESTNET-SETTLEMENT-PROXY:${preflight.destination_wallet.id}`,
      destination_version: current.destination_version + 1,
      destination_address: preflight.destination_wallet.address,
      destination_verification_status: "VERIFIED",
      destination_operational_status: "ACTIVE",
      source_wallet_ref: preflight.source_wallet.id,
      source_wallet_version: current.source_wallet_version + 1,
      source_wallet_status: "ACTIVE",
    });
    const sourceEvidenceHashes = this.getRecord(preflight.obligation_id)!.source_evidence
      .map((evidence) => evidence.content_sha256)
      .filter((hash): hash is string => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash));
    const mapped = {
      ...versioned,
      product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE" as const,
      evidence_hashes: [...new Set([...current.evidence_hashes, ...sourceEvidenceHashes, preflight.evidence_sha256])].sort(),
    };
    this.store.seed(mapped);
    const stored: StoredSettlementProxy = {
      preflight: structuredClone(preflight),
      source_aggregate_version: expectedVersion,
      mapped_aggregate_version: versioned.aggregate_version,
    };
    this.settlementProxies.set(preflight.obligation_id, stored);
    return structuredClone(stored);
  }

  hasLivePaeAuthority(obligationId: string): boolean {
    const aggregate = this.store.get(DEMO_ORGANIZATION_ID, obligationId);
    const hasSealedPae = Boolean(this.getSealedPae(obligationId));
    const retiredKeys=new Set(this.recoveryEvents.filter(e=>e.obligation_id===obligationId).map(e=>e.predecessor_key));
    const hasAuthorizationHistory = this.authorizationHistory.some(a=>a.approval_record.obligation_id===obligationId&&!retiredKeys.has(a.sealed_pae.payload.idempotency_key));
    const executionRecords = this.worker.exportSnapshot().filter((record) => record.obligation_id === obligationId&&!retiredKeys.has(record.idempotency_key));
    const hasExecutionAuthority = aggregate.execution_state !== "NONE" || aggregate.execution_idempotency_key !== null || executionRecords.length > 0;
    if (aggregate.state === "AUTHORIZED" || hasSealedPae || hasAuthorizationHistory || hasExecutionAuthority) return true;

    // Proxy binding advances the aggregate and marks any earlier PAE state
    // REVOKED. Before authorization, that marker records the material change;
    // it is not proof that a signed instruction or human approval ever existed.
    // Permit fresh assessment only when the durable proxy mapping proves this
    // exact preauthorization transition and no current/historical authority or
    // execution evidence exists. Keep the REVOKED marker unchanged.
    const proxy = this.settlementProxies.get(obligationId);
    const preauthorizationMaterialChange = aggregate.state === "APPROVAL_PENDING" &&
      aggregate.pae_state === "REVOKED" &&
      proxy?.preflight.obligation_id === obligationId &&
      proxy.mapped_aggregate_version === aggregate.aggregate_version &&
      aggregate.execution_state === "NONE" && aggregate.execution_idempotency_key === null;
    if (preauthorizationMaterialChange||retiredKeys.size>0&&aggregate.state==="APPROVAL_PENDING"&&aggregate.execution_state==="NONE"&&aggregate.execution_idempotency_key===null) return false;

    return aggregate.pae_state !== "UNUSED";
  }

  setSealedPae(obligationId: string, sealed: SealedPae): void {
    this.sealedPaeByObligation.set(obligationId, sealed);
  }

  getSealedPae(obligationId: string): SealedPae | undefined {
    return this.sealedPaeByObligation.get(obligationId);
  }

  getAuthorizationArtifacts(obligationId: string): DemoAuthorizationArtifacts | undefined {
    return [...this.authorizationHistory].reverse().find((entry) =>
      entry.sealed_pae.payload.organization_id === DEMO_ORGANIZATION_ID &&
      entry.sealed_pae.payload.obligation_ids.length === 1 && entry.sealed_pae.payload.obligation_ids[0] === obligationId);
  }

  getPaymentReleaseApproval(id: string): PaymentReleaseApproval | undefined {
    const pae=this.getSealedPae(id);
    const approval=this.paymentReleaseApprovals.find(a=>a.record.pae_instruction_hash===pae?.instruction_hash);
    return approval ? structuredClone(approval) : undefined;
  }

  recordPaymentReleaseApproval(approval: PaymentReleaseApproval): void {
    const parsed=parsePaymentReleases([approval],this.authorizationHistory.map(a=>a.sealed_pae))[0];
    if(this.paymentReleaseApprovals.some(a=>a.record.pae_instruction_hash===parsed.record.pae_instruction_hash))throw new Error("Release approval already recorded");
    this.paymentReleaseApprovals.push(parsed);
  }

  resolveDesignatedApprover(organizationId = DEMO_ORGANIZATION_ID, now = new Date()): ActorAuthorityRecord {
    return this.actorAuthorities.resolveDesignatedApprover(organizationId, now);
  }

  bootstrapP0ApproverIfUninitialized(now = new Date()): boolean {
    if (this.actorAuthorityRegistryInitialized) return false;
    if (this.actorAuthorities.export().length === 0) {
      this.actorAuthorities.restore([ActorAuthorityRegistry.seedP0Approver(DEMO_ORGANIZATION_ID, now)]);
    }
    this.actorAuthorityRegistryInitialized = true;
    return true;
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

  private readonly linkedInstructions: LinkedInstruction[]|undefined;

  exportSnapshot(): DemoStateSnapshot {
    return {
      schema_version: 2,
      ...(this.readinessObservations.length?{readiness_observations:structuredClone(this.readinessObservations)}:{}),
      ...(this.recoveryEvents.length?{recovery_events:structuredClone(this.recoveryEvents)}:{}),
      ...(this.sourceIngressAnchor?{source_ingress_anchor:this.sourceIngressAnchor}:{}),
      ...(this.linkedRetirementChecks?{linked_retirement_checks:structuredClone(this.linkedRetirementChecks)}:{}),
      ...(this.linkedActivationReceipts?{linked_activation_receipts:structuredClone(this.linkedActivationReceipts)}:{}),
      ...(this.sourceRevisions.length?{source_revisions:structuredClone(this.sourceRevisions)}:{}),
      ...(this.linkedInstructions!==undefined ? {linked_settlement_instructions:structuredClone(this.linkedInstructions)} : {}),
      authority: this.store.exportSnapshot(),
      assessment_operations: [...this.assessmentOperations.values()].map((operation) => ({ ...operation })),
      ...(this.lateAssessmentResults.length?{late_assessment_results:this.getLateAssessmentResults()}:{}),
      sealed_paes: [...this.sealedPaeByObligation.entries()].map(([id, pae]) => [id, pae]),
      authorization_history: this.authorizationHistory.map((entry) => authorizationArtifactsParser(entry)),
      ...(this.paymentReleaseApprovals.length ? {payment_release_approvals:structuredClone(this.paymentReleaseApprovals)} : {}),
      trusted_keys: this.trustedKeys.export(),
      actor_authorities: this.actorAuthorities.export(),
      actor_authority_registry_initialized: this.actorAuthorityRegistryInitialized,
      execution_ledger: this.worker.exportSnapshot(),
      provider_adapter: this.adapter.exportSnapshot(),
      settlement_proxies: [...this.settlementProxies.values()].map((item) => structuredClone(item)),
    };
  }

  getReadinessObservations(){return structuredClone(this.readinessObservations);}
  recordReadinessObservation(id:string,result:J2aPreflightResult){if(this.readinessObservations.length>=1000)throw new Error('Readiness history capacity reached');this.readinessObservations.push({obligation_id:id,aggregate_version:this.store.get(DEMO_ORGANIZATION_ID,id).aggregate_version,observed_at:new Date().toISOString(),result:structuredClone(result)});}
  getRecoveryEvents(){return structuredClone(this.recoveryEvents);}
  getSealedPaeForOperation(key:string){return this.authorizationHistory.find(a=>a.sealed_pae.payload.idempotency_key===key)?.sealed_pae;}
  prepareExecutionSuccessor(id:string,expectedVersion:number,requestId:string,requestHash:string,actorId:string,reason:string){
    const previous=this.recoveryEvents.find(e=>e.request_id===requestId);
    if(previous){if(previous.request_sha256!==requestHash||previous.obligation_id!==id)throw new Error('Successor request conflict');return previous;}
    const pae=this.getSealedPae(id),proxy=this.getSettlementProxy(id);
    let execution=pae?this.worker.getExecutionRecord(pae.payload.idempotency_key):undefined;
    if(pae&&!execution&&Date.parse(pae.payload.expiry)<=Date.now())execution=this.worker.retireUnusedExpiredAuthority(pae);
    const provenNoDispatch=execution?.status==='BLOCKED'&&execution.provider_ref===null&&execution.dispatch_evidence==='PROVEN_NOT_DISPATCHED';
    const finalEffects=execution?.status==='FAILED'&&execution.provider_evidence?.status==='FAILED'&&['FAILED','DENIED','CANCELLED'].includes(execution.provider_evidence.transaction_state??'')&&typeof execution.provider_evidence.network_fee==='string'&&/^\d+(?:\.\d{1,18})?$/.test(execution.provider_evidence.network_fee);
    if(!pae||!proxy||!execution||(!provenNoDispatch&&!finalEffects))throw new Error('Original operation effects are unverified; reconcile original identity');
    const event={request_id:requestId,request_sha256:requestHash,obligation_id:id,predecessor_key:execution.idempotency_key,predecessor_sha256:sha256Hex(canonicalBytes(execution)),actor_id:actorId,reason,created_at:new Date().toISOString(),predecessor_pae:pae,predecessor_preflight:proxy};
    this.store.prepareFinancialSuccessor(DEMO_ORGANIZATION_ID,id,expectedVersion,execution.idempotency_key);
    this.recoveryEvents.push(event);this.sealedPaeByObligation.delete(id);this.settlementProxies.delete(id);return structuredClone(event);
  }

  async flush(): Promise<void> {
    if (!this.repository || this.revision === undefined || this.namespace === undefined) return;
    const snapshot=this.exportSnapshot();if(Buffer.byteLength(JSON.stringify(snapshot))>1_750_000)throw new Error("Durable state capacity reached");
    this.revision = await this.repository.compareAndSet(this.namespace, this.revision, snapshot as unknown as Record<string, unknown>);
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
  readonly actorAuthorities: ActorAuthorityRegistry;
  private actorAuthorityRegistryInitialized: boolean;
  private readonly linkedInstructions: LinkedInstruction[]|undefined;
  readonly store: AuthorityStore;
  readonly worker: ExecutionWorker;
  private readonly sealedPaeByObligation: Map<string, SealedPae>;
  private readonly authorizationHistory: DemoAuthorizationArtifacts[];
  private readonly paymentReleaseApprovals: PaymentReleaseApproval[];
  private repository?: SupabaseDemoStateRepository;
  private revision?: number;
  private namespace?: string;
  lastPreflight: J2aPreflightResult | null;

  constructor(
    snapshot?: DemoStateSnapshot & { j2a_preflight?: J2aPreflightResult | null },
    repository?: SupabaseDemoStateRepository,
    revision?: number,
    providerAdapter?: ProviderAdapter,
    workerOptions: ExecutionWorkerOptions = {},
  ) {
    this.linkedInstructions = snapshot?.linked_settlement_instructions===undefined?undefined:parseLinkedInstructions(snapshot.linked_settlement_instructions);
    this.store = snapshot ? AuthorityStore.fromSnapshot(snapshot.authority) : new AuthorityStore();
    this.actorAuthorityRegistryInitialized = snapshot?.actor_authority_registry_initialized ?? !snapshot;
    this.actorAuthorities = new ActorAuthorityRegistry(snapshot?.actor_authorities ?? (snapshot ? [] : [ActorAuthorityRegistry.seedP0Approver("ORG-TAMEION-TESTNET-DEMO")]));
    this.trustedKeys.restore(snapshot?.trusted_keys ?? []);
    this.sealedPaeByObligation = new Map(snapshot?.sealed_paes.map(([id, pae]) => [id, sealedPaeSchema.parse(pae)]) ?? []);
    this.authorizationHistory = (snapshot?.authorization_history ?? []).map(authorizationArtifactsParser);
    this.paymentReleaseApprovals = parsePaymentReleases(snapshot?.payment_release_approvals,this.authorizationHistory.map(a=>a.sealed_pae));
    this.lastPreflight = snapshot?.j2a_preflight ?? null;
    this.repository = repository;
    this.revision = revision;
    this.worker = new ExecutionWorker(
      this.store,
      providerAdapter ?? new ArcCircleProviderAdapter(undefined, () => this.lastPreflight),
      () => this.flush(),
      this.trustedKeys,
      {
        ...workerOptions,
        loadAuthorizationArtifacts: workerOptions.loadAuthorizationArtifacts ?? ((organizationId, obligationId) =>
          organizationId === "ORG-TAMEION-TESTNET-DEMO" ? this.getAuthorizationArtifacts(obligationId) : undefined),
        resolveActorAuthority: workerOptions.resolveActorAuthority ?? ((actorId, organizationId) => this.actorAuthorities.resolve(organizationId, actorId)),
        reloadDurableExecutionContext: workerOptions.reloadDurableExecutionContext ?? (async (organizationId, obligationId) => {
          if (!this.repository || !this.namespace) {
            return {
              authorization: this.getAuthorizationArtifacts(obligationId) ?? null,
              aggregate: this.store.get(organizationId, obligationId),
              trustedKeys: this.trustedKeys.export(),
              actorAuthorities: this.actorAuthorities.export(),
              executionKillSwitched: this.store.isExecutionKillSwitched(organizationId, obligationId),
            };
          }
          const stored = await this.repository.loadOrSeed(this.namespace, this.exportSnapshot() as unknown as Record<string, unknown>);
          const current = parseJ2aSnapshot(stored.snapshot);
          const currentStore = AuthorityStore.fromSnapshot(current.authority);
          const authorization = current.authorization_history.map(authorizationArtifactsParser).reverse().find((entry) =>
            entry.sealed_pae.payload.organization_id === organizationId &&
            entry.sealed_pae.payload.obligation_ids[0] === obligationId,
          ) ?? null;
          return {
            authorization,
            aggregate: currentStore.get(organizationId, obligationId),
            trustedKeys: current.trusted_keys,
            actorAuthorities: current.actor_authorities,
            executionKillSwitched: currentStore.isExecutionKillSwitched(organizationId, obligationId),
          };
        }),
      },
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

  resolveDesignatedApprover(organizationId = "ORG-TAMEION-TESTNET-DEMO", now = new Date()): ActorAuthorityRecord {
    return this.actorAuthorities.resolveDesignatedApprover(organizationId, now);
  }

  bootstrapP0ApproverIfUninitialized(now = new Date()): boolean {
    if (this.actorAuthorityRegistryInitialized) return false;
    if (this.actorAuthorities.export().length === 0) {
      this.actorAuthorities.restore([ActorAuthorityRegistry.seedP0Approver("ORG-TAMEION-TESTNET-DEMO", now)]);
    }
    this.actorAuthorityRegistryInitialized = true;
    return true;
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
      ...(this.linkedInstructions!==undefined?{linked_settlement_instructions:structuredClone(this.linkedInstructions)}:{}),
      authority: this.store.exportSnapshot(),
      assessment_operations: [],
      sealed_paes: [...this.sealedPaeByObligation.entries()].map(([id, pae]) => [id, pae]),
      authorization_history: this.authorizationHistory.map((entry) => authorizationArtifactsParser(entry)),
      ...(this.paymentReleaseApprovals.length ? {payment_release_approvals:structuredClone(this.paymentReleaseApprovals)} : {}),
      trusted_keys: this.trustedKeys.export(),
      actor_authorities: this.actorAuthorities.export(),
      actor_authority_registry_initialized: this.actorAuthorityRegistryInitialized,
      execution_ledger: this.worker.exportSnapshot(),
      provider_adapter: new FakeProviderAdapter().exportSnapshot(),
      j2a_preflight: this.lastPreflight,
    };
  }

  async flush(): Promise<void> {
    if (!this.repository || this.revision === undefined || this.namespace === undefined) return;
    const snapshot=this.exportSnapshot();if(Buffer.byteLength(JSON.stringify(snapshot))>1_750_000)throw new Error("Durable state capacity reached");
    this.revision = await this.repository.compareAndSet(this.namespace, this.revision, snapshot as unknown as Record<string, unknown>);
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
    actor_authorities: [ActorAuthorityRegistry.seedP0Approver("ORG-TAMEION-TESTNET-DEMO")],
    actor_authority_registry_initialized: true,
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
  if (state.bootstrapP0ApproverIfUninitialized()) await state.flush();
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
  // Deterministic placeholder for the simulated lane, not source authority.
  // The public genuine evidence ledger is withdrawn for privacy review.
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
  const state = createRuntimeDemoState(parseDemoStateSnapshot(stored.snapshot), repository, stored.revision);
  state.attachRepository(repository, namespace, stored.revision);
  if (state.bootstrapP0ApproverIfUninitialized()) await state.flush();
  await migrateLegacyTrustedKeys(stored.snapshot, state);
  return state;
}

function createRuntimeDemoState(
  snapshot?: DemoStateSnapshot,
  repository?: SupabaseDemoStateRepository,
  revision?: number,
): DemoState {
  if (!process.env.CIRCLE_API_KEY || !process.env.CIRCLE_ENTITY_SECRET) return new DemoState(snapshot, repository, revision);
  let state: DemoState;
  const adapter = new ArcCircleProviderAdapter(undefined, (idempotencyKey) =>
    state?.getSettlementProxyByIdempotencyKey(idempotencyKey)?.preflight ?? null);
  state = new DemoState(snapshot, repository, revision, adapter);
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
    globalThis.__tameionDemoState = createRuntimeDemoState();
  }
  return globalThis.__tameionDemoState;
}

/** Financial runtime restoration only: no seed, actor bootstrap or key migration.
 * Source and requester authority are checked by the authenticated caller. */
export async function loadExistingFinancialState(
  repository: SupabaseDemoStateRepository,
  namespace: string,
  sourceRecords: readonly LiveUsageObligationRecord[],
  workerOptions: ExecutionWorkerOptions,
  suppliedAdapter?: ProviderAdapter,
): Promise<DemoState> {
  const load = async () => {
    const stored = await repository.loadExisting(namespace);
    if (stored.snapshot.schema_version !== 2 || stored.snapshot.actor_authority_registry_initialized !== true) throw new Error("STATE_UNAVAILABLE");
    const snapshot = parseDemoStateSnapshot(stored.snapshot);
    const store = AuthorityStore.fromSnapshot(snapshot.authority);
    for (const record of sourceRecords) {
      const aggregate = store.get(DEMO_ORGANIZATION_ID, record.obligation_id);
      if (aggregate.source_amount !== record.amount || aggregate.source_currency !== record.currency) throw new Error("STATE_UNAVAILABLE");
    }
    return {stored,snapshot,store};
  };
  const {stored,snapshot} = await load();
  const keys = new TrustedKeyRegistry(); keys.restore(snapshot.trusted_keys);
  let state: DemoState;
  const adapter = suppliedAdapter ?? new ArcCircleProviderAdapter(undefined,key=>state?.getSettlementProxyByIdempotencyKey(key)?.preflight??null);
  state = new DemoState(snapshot,repository,stored.revision,adapter,{
    ...workerOptions,
    reloadDurableExecutionContext: async (organizationId,obligationId) => {
      const current=await load();
      return {authorization:current.snapshot.authorization_history.slice().reverse().find(a=>a.sealed_pae.payload.organization_id===organizationId&&a.sealed_pae.payload.obligation_ids[0]===obligationId)??null,
        aggregate:current.store.get(organizationId,obligationId),trustedKeys:current.snapshot.trusted_keys,
        paymentReleaseApproval:current.snapshot.payment_release_approvals?.find(a=>a.record.obligation_id===obligationId&&a.record.pae_instruction_hash===current.snapshot.sealed_paes.find(([id])=>id===obligationId)?.[1].instruction_hash),
        actorAuthorities:current.snapshot.actor_authorities,executionKillSwitched:current.store.isExecutionKillSwitched(organizationId,obligationId)};
    },
  },sourceRecords);
  state.attachRepository(repository,namespace,stored.revision);
  return state;
}
