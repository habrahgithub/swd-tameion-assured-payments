import { financeAgentDecisionSchema, type FinanceAgentContext, type FinanceAgentDecision } from "./schema";
import type { AiProvider } from "./ai-provider";

/**
 * Finance Agent (J1). Allowed: read scoped finance state, propose a
 * PAY/HOLD/ESCALATE recommendation. Forbidden (enforced structurally, not
 * just by prompt): approve transactions, change authority policy, read
 * secrets, sign wallets, directly send money — none of those capabilities
 * exist anywhere in this module; it has no reference to AuthorityStore,
 * the PAE signer, or the Execution Worker.
 *
 * Fail-closed contract (P0 core test 14): any provider error or output that
 * does not parse as a well-formed FinanceAgentDecision becomes HOLD, never
 * a default PAY. Prompt injection / undeclared "skills" cannot expand this
 * agent's capability (P0 core test 13) because the only thing that leaves
 * this module is a `financeAgentDecisionSchema`-validated object — there is
 * no field in that schema an injected instruction could use to request
 * approval, signing, or execution.
 */
/** Prefix used only for the "the provider call itself failed" HOLD reason —
 * distinct from a schema-validation failure or a genuine model HOLD. Used
 * by callers (the assess API route) to tell "we tried live AI and the call
 * failed" apart from "the model itself decided HOLD/ESCALATE", so the UI's
 * runtime badge can show BLOCKED_EXTERNAL instead of claiming live success. */
export const PROVIDER_CALL_FAILURE_REASON_PREFIX = "AI provider call failed:";

export function wasProviderCallFailure(decision: FinanceAgentDecision): boolean {
  return decision.reasons.some((reason) => reason.startsWith(PROVIDER_CALL_FAILURE_REASON_PREFIX));
}

export async function assessObligation(
  context: FinanceAgentContext,
  provider: AiProvider,
): Promise<FinanceAgentDecision> {
  let rawOutput: unknown;
  try {
    rawOutput = await provider.assess(context);
  } catch (error) {
    return holdOnFailure(context, `${PROVIDER_CALL_FAILURE_REASON_PREFIX} "${provider.name}": ${(error as Error).message}`);
  }

  const parsed = financeAgentDecisionSchema.safeParse(rawOutput);
  if (!parsed.success) {
    return holdOnFailure(
      context,
      `AI provider "${provider.name}" returned output that failed strict schema validation: ${parsed.error.message}`,
    );
  }

  const decision = parsed.data;
  if (decision.obligation_id !== context.obligation_id) {
    return holdOnFailure(context, "AI provider output obligation_id did not match the requested obligation");
  }

  const suppliedEvidenceIds = new Set(context.evidence_ids);
  if (decision.evidence_ids.some((evidenceId) => !suppliedEvidenceIds.has(evidenceId))) {
    return holdOnFailure(
      context,
      "AI provider output cited evidence that was not supplied for this obligation",
      ["evidence_reference_integrity"],
    );
  }

  // Never trust a PAY recommendation over missing/uncertain evidence, even
  // if the model claims otherwise — this is a deterministic backstop, not
  // something the model can talk its way around.
  if (decision.decision === "PAY") {
    const blockers = [...decision.missing_evidence];
    if (!context.evidence_present || decision.evidence_ids.length === 0) blockers.push("source_evidence");
    if (context.due_date_status !== "STATED_ON_SOURCE" || !context.due_date) blockers.push("due_date");
    if (!context.business_purpose_confirmed) blockers.push("business_purpose");
    if (!context.destination_ready) blockers.push("destination_trust_seed");
    if (blockers.length > 0) {
      const uniqueBlockers = [...new Set(blockers)];
      return holdOnFailure(
        context,
        `Refusing PAY: required evidence/readiness is missing or incomplete (${uniqueBlockers.join(", ")})`,
        uniqueBlockers,
      );
    }
  }

  return decision;
}

function holdOnFailure(context: FinanceAgentContext, reason: string, missingEvidence?: string[]): FinanceAgentDecision {
  return {
    obligation_id: context.obligation_id,
    decision: "HOLD",
    reasons: [reason],
    evidence_ids: context.evidence_ids,
    missing_evidence: missingEvidence ?? (context.evidence_present ? [] : ["source_evidence"]),
    uncertainty_signal: true,
  };
}

export interface CandidateSelection {
  selected_obligation_id: string | null;
  rationale: string;
}

/**
 * Selects the sole execution candidate only after every obligation has been
 * assessed (PAE-P0-1 permits exactly one obligation_id). Deterministic
 * tie-break: among PAY decisions, the earliest stated due date wins, then
 * lowest obligation_id lexicographically — never model preference.
 */
export function selectSoleCandidate(
  decisions: FinanceAgentDecision[],
  dueDatesByObligationId: Record<string, string | null>,
): CandidateSelection {
  const payCandidates = decisions.filter((d) => d.decision === "PAY");
  if (payCandidates.length === 0) {
    return { selected_obligation_id: null, rationale: "No obligation received a PAY decision; no candidate selected." };
  }

  const sorted = [...payCandidates].sort((a, b) => {
    const dueA = dueDatesByObligationId[a.obligation_id];
    const dueB = dueDatesByObligationId[b.obligation_id];
    if (dueA && dueB && dueA !== dueB) return dueA < dueB ? -1 : 1;
    if (dueA && !dueB) return -1;
    if (!dueA && dueB) return 1;
    return a.obligation_id < b.obligation_id ? -1 : 1;
  });

  const winner = sorted[0];
  return {
    selected_obligation_id: winner.obligation_id,
    rationale:
      payCandidates.length === 1
        ? `Sole PAY decision among ${decisions.length} assessed obligations.`
        : `${payCandidates.length} obligations received PAY; selected ${winner.obligation_id} by earliest stated due date, then lowest obligation_id as tie-break.`,
  };
}
