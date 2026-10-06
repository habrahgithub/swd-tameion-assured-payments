import { NextResponse } from "next/server";

import { runJ2aReadOnlyPreflight } from "../../../../../../src/demo/real-testnet-payment";
import { DEMO_ORGANIZATION_ID, getDemoState } from "../../../../../../src/server/demo-state";
import { DemoStateConflictError } from "../../../../../../src/server/supabase-demo-state-repository";

export const dynamic = "force-dynamic";

/** Read-only Circle preflight for the currently selected frozen source
 * obligation. Binding the returned proxy updates only the settlement aggregate;
 * the immutable genuine source record and its vendor route remain untouched. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { obligation_id?: unknown; expected_version?: unknown };
  if (typeof body.obligation_id !== "string" || !Number.isSafeInteger(body.expected_version)) {
    return NextResponse.json({ error: "Selected frozen obligation ID and current aggregate version are required." }, { status: 400 });
  }

  const state = await getDemoState();
  try {
    const obligationId = body.obligation_id;
    const aggregate = state.store.get(DEMO_ORGANIZATION_ID, obligationId);
    if (aggregate.aggregate_version !== body.expected_version) {
      return NextResponse.json({ error: "Selected obligation changed; reload before proxy preflight." }, { status: 409 });
    }
    const assessment = state.store.getCurrentAssessment(DEMO_ORGANIZATION_ID, obligationId);
    if (!assessment || assessment.record.provider_mode !== "LIVE_AI" || assessment.record.decision !== "PAY" ||
        assessment.record.missing_evidence.length || (assessment.record.race?.result.validated_findings.length ?? 0) ||
        (assessment.record.race?.remediation.length ?? 0)) {
      return NextResponse.json({ error: "A current LIVE_AI PAY assessment with zero findings and zero missing evidence is required." }, { status: 409 });
    }
    const unassessed = state.store.findUnassessedObligation(DEMO_ORGANIZATION_ID);
    if (unassessed) return NextResponse.json({ error: `Assess every frozen genuine obligation first; ${unassessed} is not current.` }, { status: 409 });
    const solePayCandidate = state.getSolePayCandidateId();
    if (solePayCandidate !== obligationId) {
      return NextResponse.json({ error: `The existing sole-candidate gate selected ${solePayCandidate ?? "no obligation"}; select that current PAY obligation before provider preflight.` }, { status: 409 });
    }
    const otherCandidate = state.store.findCommittedCandidateExcluding(DEMO_ORGANIZATION_ID, obligationId);
    if (otherCandidate) return NextResponse.json({ error: `Another obligation is already the sole PAY candidate: ${otherCandidate}.` }, { status: 409 });
    if (state.hasLivePaeAuthority(obligationId) || state.getSettlementProxy(obligationId)) {
      return NextResponse.json({ error: "This selected intent already has proxy or authorization authority; reconcile its existing identity." }, { status: 409 });
    }

    const intent = state.createSettlementProxyIntent(obligationId);
    const preflight = await runJ2aReadOnlyPreflight(undefined, undefined, intent);
    if (preflight.readiness !== "READY") return NextResponse.json(preflight, { status: 409 });
    const stored = state.bindSettlementProxy(preflight, aggregate.aggregate_version);
    await state.flush();
    return NextResponse.json({
      ...preflight,
      source_identity_disclosure: intent.classification,
      source_aggregate_version: stored.source_aggregate_version,
      aggregate_version: stored.mapped_aggregate_version,
      next_step: "The proxy is prepared. Its aggregate changed, so run a fresh LIVE_AI assessment before authorization.",
    });
  } catch (error) {
    if (error instanceof DemoStateConflictError) return NextResponse.json({ error: error.message, code: "OPS-002" }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : "Settlement proxy preparation failed." }, { status: 409 });
  }
}
