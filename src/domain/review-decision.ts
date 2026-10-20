import {z} from 'zod';
import {contentHash} from './linked-instruction';

const text=(max=128)=>z.string().trim().min(1).max(max);
export const reviewInputSchema=z.object({
  expected_version:z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expected_review_hash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  mode:z.enum(['MANUAL_REVIEW','AI_EXCEPTION_REVIEW','AI_ASSISTED_REVIEW']),
  decision:z.enum(['ACCEPT_FOR_AUTHORIZATION','NEEDS_CORRECTION','ESCALATE','DECLINE']),
  escalation_owner_actor_id:text().optional(),
  rationale:text(1024), evidence_ids:z.array(text()).min(1).max(32),
  finding_dispositions:z.array(z.object({finding_code:text(),disposition:z.enum(['ACCEPT_ADVISORY','CORRECTED']),rationale:text(1024),evidence_ids:z.array(text()).min(1).max(16)}).strict()).max(32),
}).strict();
export const reviewDecisionSchema=reviewInputSchema.omit({expected_version:true,expected_review_hash:true}).extend({
  schema_version:z.literal('HUMAN-REVIEW-1'), provenance:z.literal('HUMAN'),
  decision_id:text(),request_id:z.uuid(),request_sha256:z.string().regex(/^[a-f0-9]{64}$/),
  organization_id:text(),obligation_id:text(),aggregate_version:z.number().int().positive(),
  source_record_sha256:z.string().regex(/^[a-f0-9]{64}$/),
  actor_id:text(),actor_role:text(),authority_version:text(),
  operator_key:text(),credential_version:z.number().int().positive(),
  supersedes_review_hash:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  policy_version:text(),created_at:z.iso.datetime({precision:3}),expires_at:z.iso.datetime({precision:3}),
}).strict();
export type ReviewDecision=z.infer<typeof reviewDecisionSchema>;
export type SealedReviewDecision={record:ReviewDecision;hash:string};
export function sealReviewDecision(value:unknown):SealedReviewDecision {
  const record=reviewDecisionSchema.parse(value);
  if(Date.parse(record.expires_at)<=Date.parse(record.created_at))throw new Error('Invalid review window');
  return {record,hash:contentHash(record)};
}
