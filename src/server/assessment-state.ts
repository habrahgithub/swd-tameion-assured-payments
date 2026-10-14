import {AuthorityStore} from '../authority/aggregate';
import {durableAssessmentRecordSchema,type DurableAssessmentRecord} from '../domain/schemas';
import type {LiveUsageObligationRecord} from '../agent/context-builder';
import type {AssessmentOperation} from './demo-state';
const DEMO_ORGANIZATION_ID='ORG-DEMO-001';
/** Shared durable reservation/result engine; no signer, wallet or execution dependency. */
export abstract class AssessmentState {
 constructor(readonly store:AuthorityStore,protected readonly assessmentOperations:Map<string,AssessmentOperation>){}
 abstract getRecord(id:string):LiveUsageObligationRecord|undefined;
 abstract hasLivePaeAuthority(id:string):boolean;
 abstract flush():Promise<void>;
 sourceRecordHash(_id:string):string|undefined{return undefined;}
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
    if(this.sourceRecordHash(operation.obligation_id)&&validated.source_record_sha256!==this.sourceRecordHash(operation.obligation_id))throw new Error("ASSESSMENT_SOURCE_CHANGED");
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
    if(this.sourceRecordHash(operation.obligation_id)&&operation.provider_result.source_record_sha256!==this.sourceRecordHash(operation.obligation_id)){operation.status="STALE";delete operation.provider_result;return {...operation};}
    const sealed = this.store.sealAssessment(operation.provider_result);
    operation.status = "COMPLETED";
    operation.assessment_hash = sealed.assessment_hash;
    delete operation.provider_result;
    delete operation.reserved_at;
    return { ...operation };
  }

}
