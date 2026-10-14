import { z } from 'zod';
import { canonicalHash } from '../pae/canonicalize';
import type { SealedPae } from './schemas';

const text = z.string().min(1).max(128).regex(/^[\x20-\x7e]+$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const integer = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const releaseFields = z.object({
  organization_id: text, obligation_id: text, aggregate_version: integer,
  namespace: text, packet_sha256: hash, pae_instruction_hash: hash,
  idempotency_key: z.string().min(1).max(256),
  actor_id: text, actor_role: text, authority_version: z.string().regex(/^[1-9][0-9]*$/),
  operator_key: text, credential_version: integer,
  approved_at: z.iso.datetime({precision:3}), expires_at: z.iso.datetime({precision:3}),
}).strict();
export const paymentReleaseRecordSchema = z.discriminatedUnion('schema_version',[
 releaseFields.extend({schema_version:z.literal('PORTAL-RELEASE-1')}).strict(),
 releaseFields.extend({schema_version:z.literal('PORTAL-RELEASE-2'),source_binding_sha256:hash,requester_binding_sha256:hash}).strict(),
]).refine(r => Date.parse(r.expires_at) > Date.parse(r.approved_at), 'Invalid release window');
export type PaymentReleaseBinding = {source_binding_sha256:string;requester_binding_sha256:string};
export function paymentReleaseBindings(source:unknown,requester:unknown):PaymentReleaseBinding {
 return {source_binding_sha256:canonicalHash(source),requester_binding_sha256:canonicalHash(requester)};
}
export type PaymentReleaseRecord = z.infer<typeof paymentReleaseRecordSchema>;
export type PaymentReleaseApproval = {record:PaymentReleaseRecord; record_sha256:string};
const approvalSchema = z.object({record:paymentReleaseRecordSchema,record_sha256:hash}).strict();
export function sealPaymentRelease(record:PaymentReleaseRecord):PaymentReleaseApproval {
  const parsed = paymentReleaseRecordSchema.parse(record);
  return {record:parsed,record_sha256:canonicalHash(parsed)};
}
export function parsePaymentRelease(value:unknown):PaymentReleaseApproval {
  const parsed=approvalSchema.parse(value);
  if(canonicalHash(parsed.record)!==parsed.record_sha256)throw new Error('Release approval hash mismatch');
  return parsed;
}
/** Archive validation does not discard expired approvals. Runtime matching does. */
export function parsePaymentReleases(value:unknown,paes:readonly SealedPae[]):PaymentReleaseApproval[] {
  if(value===undefined)return [];
  if(!Array.isArray(value))throw new Error('Malformed release approvals');
  const releases=value.map(parsePaymentRelease),seen=new Set<string>();
  for(const {record:r} of releases){
    const pae=paes.find(p=>p.instruction_hash===r.pae_instruction_hash);
    if(!pae||pae.payload.organization_id!==r.organization_id||pae.payload.obligation_ids.length!==1||pae.payload.obligation_ids[0]!==r.obligation_id||pae.payload.idempotency_key!==r.idempotency_key||pae.payload.aggregate_version!==String(r.aggregate_version)||pae.payload.approval_evidence[0].actor_id!==r.actor_id||pae.payload.approval_evidence[0].actor_role!==r.actor_role||pae.payload.approval_evidence[0].authority_version!==r.authority_version||Date.parse(r.approved_at)<Date.parse(pae.payload.approval_evidence[0].approved_at)||Date.parse(r.expires_at)>Date.parse(pae.payload.expiry)||seen.has(r.pae_instruction_hash))throw new Error('Release approval instruction mismatch');
    seen.add(r.pae_instruction_hash);
  }
  return releases;
}
export function matchesPaymentRelease(approval:PaymentReleaseApproval|undefined,expected:Partial<PaymentReleaseRecord> & Partial<PaymentReleaseBinding>,now=Date.now()):boolean {
  if(!approval||!Number.isSafeInteger(now))return false;
  try{
    const {record:r}=parsePaymentRelease(approval);
    return r.schema_version==='PORTAL-RELEASE-2'&&now>=Date.parse(r.approved_at)&&now<Date.parse(r.expires_at)&&Object.entries(expected).every(([key,value])=>(r as Record<string,unknown>)[key]===value);
  }catch{return false;}
}
