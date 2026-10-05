import type { AuthorityStore, SealedAssessment } from "../authority/aggregate";
import type { SealedPae } from "../domain/schemas";
import type { DemoAuthorizationArtifacts } from "../server/demo-state";

/** Resolve only the immutable assessment that the current authorized PAE reviewed. */
export function getAuthorizedReviewedAssessment(
  store: Pick<AuthorityStore, "getAssessmentHistory">,
  organizationId: string,
  obligationId: string,
  currentAggregateVersion: number,
  authorization: DemoAuthorizationArtifacts | undefined,
  sealedPae: SealedPae | null | undefined,
): SealedAssessment | undefined {
  if (!authorization || !sealedPae || !sealedPae.payload || !Array.isArray(sealedPae.payload.approval_evidence)) return undefined;

  const approval = authorization.approval_record;
  const assurance = authorization.assurance_record;
  const payload = sealedPae.payload;
  const [evidence] = payload.approval_evidence;
  const currentVersion = String(currentAggregateVersion);

  if (
    !approval || !assurance || payload.approval_evidence.length !== 1 || !evidence ||
    approval.organization_id !== organizationId || approval.obligation_id !== obligationId ||
    evidence.organization_id !== organizationId || evidence.obligation_id !== obligationId ||
    payload.organization_id !== organizationId || payload.obligation_ids.length !== 1 || payload.obligation_ids[0] !== obligationId ||
    approval.approval_id !== evidence.approval_id ||
    approval.actor_id !== evidence.actor_id || approval.actor_role !== evidence.actor_role ||
    approval.authority_version !== evidence.authority_version || approval.policy_version !== evidence.policy_version ||
    approval.approved_at !== evidence.approved_at ||
    authorization.approval_record_hash !== evidence.approval_record_hash ||
    approval.reviewed_aggregate_version !== evidence.reviewed_aggregate_version ||
    approval.authorized_aggregate_version !== evidence.authorized_aggregate_version ||
    approval.assessment_id !== evidence.assessment_id || approval.assessment_hash !== evidence.assessment_hash ||
    evidence.authorized_aggregate_version !== currentVersion ||
    approval.authorized_aggregate_version !== currentVersion ||
    payload.aggregate_version !== currentVersion ||
    assurance.organization_id !== organizationId || assurance.obligation_id !== obligationId ||
    assurance.result !== "PASS" || assurance.aggregate_version !== currentVersion ||
    authorization.sealed_pae.instruction_hash !== sealedPae.instruction_hash ||
    authorization.sealed_pae.signature !== sealedPae.signature
  ) return undefined;

  const assessment = store.getAssessmentHistory(organizationId, obligationId).find((candidate) =>
    candidate.record.assessment_id === evidence.assessment_id && candidate.hash === evidence.assessment_hash,
  );
  if (
    !assessment || assessment.record.organization_id !== organizationId ||
    assessment.record.obligation_id !== obligationId ||
    assessment.record.aggregate_version !== evidence.reviewed_aggregate_version
  ) return undefined;

  return assessment;
}
