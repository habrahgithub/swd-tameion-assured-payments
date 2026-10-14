import {createHash} from 'node:crypto';
import {canonicalize} from 'json-canonicalize';
import {z} from 'zod';
const text=z.string().min(1).max(128),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const linkedInstructionSchema=z.object({
 schema_version:z.literal(1),kind:z.literal('ARC_TESTNET_SETTLEMENT_INSTRUCTION'),status:z.literal('DRAFT_AUTHORITY_REQUIRED'),
 organization_id:z.literal('ORG-DEMO-001'),source_obligation_id:text,source_record_sha256:hash,source_aggregate_version:z.number().int().positive(),
 assessment_id:text,assessment_hash:hash,instruction_id:text.regex(/^TESTNET-CONTROLLED-LINKED-[a-f0-9]{32}$/),attempt_id:z.uuid(),
 source_amount:z.string().regex(/^\d+\.\d{2}$/),source_currency:z.string().regex(/^[A-Z]{3}$/),
 network:z.literal('ARC_TESTNET'),classification:z.literal('TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT'),
 created_at:z.iso.datetime(),instruction_content_sha256:hash,
}).strict();
export type LinkedInstruction=z.infer<typeof linkedInstructionSchema>;
export const contentHash=(value:unknown)=>createHash('sha256').update(canonicalize(value)).digest('hex');
export function sealLinkedInstruction(value:Omit<LinkedInstruction,'instruction_content_sha256'>):LinkedInstruction{return linkedInstructionSchema.parse({...value,instruction_content_sha256:contentHash(value)});}
export function parseLinkedInstructions(value:unknown):LinkedInstruction[]{
 if(value===undefined)return [];
 const result=z.array(linkedInstructionSchema).max(1000).parse(value);
 for(const row of result){const {instruction_content_sha256,...body}=row;if(contentHash(body)!==instruction_content_sha256)throw new Error('LINK_INTEGRITY_FAILED');}
 if(new Set(result.map(r=>r.instruction_id)).size!==result.length||new Set(result.map(r=>r.attempt_id)).size!==result.length)throw new Error('LINK_DUPLICATE');
 return structuredClone(result);
}
export function assertLinkedHistoryAppend(previous:unknown,next:unknown){const before=parseLinkedInstructions(previous),after=parseLinkedInstructions(next);if(after.length<before.length||before.some((r,i)=>contentHash(r)!==contentHash(after[i])))throw new Error('LINK_HISTORY_CHANGED');}
