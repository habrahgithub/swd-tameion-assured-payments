import {contentHash,parseLinkedInstructions} from '../domain/linked-instruction';
import {AuthorityStore} from '../authority/aggregate';
import type {DemoStateSnapshot} from './demo-state';
import type {FinancialSourceAdmission} from './financial-source-admission';
import {loadOperatorSourceRecords,type OperatorSourceView} from './operator-source-records';
import {validateOperatorBinding} from './load-existing-demo-state';
import {SupabaseDemoStateRepository} from './supabase-demo-state-repository';
import {AccessError} from './route-access-policy';
/** Linked drafts never activate themselves. This is an additional rejection gate
 * after the existing exact source/requester admission has passed. */
export function validateLinkedActivation(source:FinancialSourceAdmission,view:OperatorSourceView,snapshot:DemoStateSnapshot,revision:number){
 if(!source.linked_instruction)return;
 if(!view.state_binding.workflow_base_sha256||source.namespace===view.state_binding.namespace)throw new AccessError('LINK_SOURCE_UNVERIFIED',403);
 validateOperatorBinding(snapshot,revision,view.state_binding.namespace,view.state_binding);
 const ref=source.linked_instruction,record=view.records.find(r=>r.obligation_id===ref.source_obligation_id);
 const draft=parseLinkedInstructions(snapshot.linked_settlement_instructions).find(r=>r.instruction_id===source.source.obligation_id);
 if(!record||!draft||draft.instruction_content_sha256!==ref.instruction_content_sha256||draft.source_record_sha256!==contentHash(record)||draft.source_obligation_id!==record.obligation_id||draft.source_amount!==record.amount||draft.source_currency!==record.currency||source.source.amount!==record.amount||source.source.currency!==record.currency)throw new AccessError('LINK_SOURCE_UNVERIFIED',403);
 const store=AuthorityStore.fromSnapshot(snapshot.authority),aggregate=store.get(source.organization_id,record.obligation_id),assessment=store.getCurrentAssessment(source.organization_id,record.obligation_id);
 if(aggregate.aggregate_version!==draft.source_aggregate_version||!assessment||assessment.hash!==draft.assessment_hash||assessment.record.assessment_id!==draft.assessment_id||assessment.record.source_record_sha256!==draft.source_record_sha256)throw new AccessError('LINK_SOURCE_STALE',409);
}
export async function verifyLinkedActivation(source:FinancialSourceAdmission){
 if(!source.linked_instruction)return;
 const view=loadOperatorSourceRecords(),url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!view||!url||!key)throw new AccessError('LINK_SOURCE_UNVERIFIED',403);
 const stored=await new SupabaseDemoStateRepository(url,key).loadExisting(view.state_binding.namespace);
 validateLinkedActivation(source,view,stored.snapshot as unknown as DemoStateSnapshot,stored.revision);
}
