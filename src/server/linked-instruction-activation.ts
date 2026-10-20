import {parseDemoStateSnapshot} from './demo-state';
import {ActorAuthorityRegistry} from '../authority/actor-authority';
import {effectiveSourceRecords,parseSourceRevisions} from '../domain/source-revision';
import {contentHash,parseLinkedInstructions} from '../domain/linked-instruction';
import {AuthorityStore} from '../authority/aggregate';
import type {DemoStateSnapshot} from './demo-state';
import type {FinancialSourceAdmission} from './financial-source-admission';
import {loadOperatorSourceRecords,type OperatorSourceView} from './operator-source-records';
import {validateOperatorBinding} from './load-existing-demo-state';
import {SupabaseDemoStateRepository} from './supabase-demo-state-repository';
import {AccessError} from './route-access-policy';
import {dispositionReceiptCurrent,unresolvedAssessmentOperations} from './genuine-disposition';
/** Linked drafts never activate themselves. This is an additional rejection gate
 * after the existing exact source/requester admission has passed. */
export function validateLinkedActivation(source:FinancialSourceAdmission,view:OperatorSourceView,snapshot:DemoStateSnapshot,revision:number){
 if(!source.linked_instruction)return;
 if((!view.state_binding.workflow_base_sha256&&!view.source_ingress)||source.namespace===view.state_binding.namespace)throw new AccessError('LINK_SOURCE_UNVERIFIED',403);
 if(view.source_ingress){if(snapshot.source_ingress_anchor!==contentHash({binding:view.state_binding,records:view.records}))throw new AccessError("LINK_SOURCE_UNVERIFIED",403);}else validateOperatorBinding(snapshot,revision,view.state_binding.namespace,view.state_binding);
 const ref=source.linked_instruction,record=effectiveSourceRecords(view.records,parseSourceRevisions(snapshot.source_revisions)).find(r=>r.obligation_id===ref.source_obligation_id);
 const draft=parseLinkedInstructions(snapshot.linked_settlement_instructions).find(r=>r.instruction_id===source.source.obligation_id);
 if(!record||!draft||draft.instruction_content_sha256!==ref.instruction_content_sha256||draft.source_record_sha256!==contentHash(record)||draft.source_obligation_id!==record.obligation_id||draft.source_amount!==record.amount||draft.source_currency!==record.currency||source.source.amount!==record.amount||source.source.currency!==record.currency)throw new AccessError('LINK_SOURCE_UNVERIFIED',403);
 const store=AuthorityStore.fromSnapshot(snapshot.authority),aggregate=store.get(source.organization_id,record.obligation_id),assessment=store.getCurrentAssessment(source.organization_id,record.obligation_id);
 if(draft.review_decision_id){const review=store.getCurrentReviewDecision(source.organization_id,record.obligation_id);let actor;try{actor=new ActorAuthorityRegistry(snapshot.actor_authorities).resolveDesignatedApprover(source.organization_id);}catch{throw new AccessError('LINK_SOURCE_STALE',409);}if(aggregate.aggregate_version!==draft.source_aggregate_version||!review||review.record.decision_id!==draft.review_decision_id||review.hash!==draft.review_decision_hash||review.record.source_record_sha256!==draft.source_record_sha256||review.record.decision!=='ACCEPT_FOR_AUTHORIZATION'||!snapshot.actor_authority_registry_initialized||actor.actor_id!==review.record.actor_id||actor.authority_version!==review.record.authority_version||actor.actor_role!==review.record.actor_role)throw new AccessError('LINK_SOURCE_STALE',409);return;}
 if(aggregate.aggregate_version!==draft.source_aggregate_version||!assessment||assessment.hash!==draft.assessment_hash||assessment.record.assessment_id!==draft.assessment_id||assessment.record.source_record_sha256!==draft.source_record_sha256)throw new AccessError('LINK_SOURCE_STALE',409);
 // Parity with draft creation: the same relation helper, so activation can never rely on a receipt that a separate unresolved operation
 // or a stale disposition binding would have refused at draft time.
 const operations=snapshot.assessment_operations??[];
 try{
  if(unresolvedAssessmentOperations(operations,record.obligation_id).length)throw new AccessError('LINK_SOURCE_STALE',409);
  if(!dispositionReceiptCurrent(operations,record.obligation_id,assessment,contentHash(record),contentHash(view.state_binding),aggregate.aggregate_version))throw new AccessError('LINK_SOURCE_STALE',409);
 }catch(error){if(error instanceof AccessError)throw error;throw new AccessError('LINK_SOURCE_UNVERIFIED',403);}
}
export async function verifyLinkedActivation(source:FinancialSourceAdmission){
 if(!source.linked_instruction)return;
 const view=loadOperatorSourceRecords(),url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!view||!url||!key)throw new AccessError('LINK_SOURCE_UNVERIFIED',403);
 const repository=new SupabaseDemoStateRepository(url,key);
 const stored=await repository.loadExisting(view.state_binding.namespace),snapshot=parseDemoStateSnapshot(stored.snapshot);
 validateLinkedActivation(source,view,snapshot,stored.revision);
 if(view.source_ingress){
  const receipts=snapshot.linked_activation_receipts??[];
  const existing=receipts.find(r=>r.instruction_id===source.source.obligation_id);
  if(existing){if(existing.namespace!==source.namespace||existing.source_sha256!==contentHash(source))throw new AccessError('LINK_ACTIVATION_CHANGED',409);}
  else {
   snapshot.linked_activation_receipts=[...receipts,{instruction_id:source.source.obligation_id,source_obligation_id:source.linked_instruction.source_obligation_id,namespace:source.namespace,source_sha256:contentHash(source),activated_at:new Date().toISOString()}];
   await repository.compareAndSet(view.state_binding.namespace,stored.revision,snapshot as unknown as Record<string,unknown>);
   const committed=await repository.loadExisting(view.state_binding.namespace);
   validateLinkedActivation(source,view,parseDemoStateSnapshot(committed.snapshot),committed.revision);
   if(!parseDemoStateSnapshot(committed.snapshot).linked_activation_receipts?.some(r=>r.instruction_id===source.source.obligation_id&&r.source_sha256===contentHash(source)))throw new AccessError('LINK_ACTIVATION_UNVERIFIED',409);
  }
 }
}
