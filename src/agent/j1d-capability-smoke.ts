import type { AiProvider } from "./ai-provider";
import { assessObligation, wasProviderCallFailure } from "./finance-agent";
import {
  financeAgentContextSchema,
  financeAgentModelRecommendationSchema,
  type FinanceAgentContext,
  type FinanceAgentModelRecommendation,
} from "./schema";

export const J1D_SYNTHETIC_OBLIGATION_ID = "SYNTHETIC-J1D-CAPABILITY-001";

export type J1dCapabilitySmokeBlocker =
  | "PROVIDER_AUTH"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_TIMEOUT"
  | "PROVIDER_REFUSED"
  | "PROVIDER_RESPONSE_INVALID"
  | "PROVIDER_UNAVAILABLE"
  | "MODEL_OUTPUT_INVALID";

export type J1dCapabilitySmokeResult =
  | {
      status: "LIVE_AI";
      capability: "SYNTHETIC_PREVIEW_ONLY";
      authoritative: false;
      proposal: FinanceAgentModelRecommendation & { authority: "NON_AUTHORITATIVE" };
      runtime_identity: NonNullable<AiProvider["runtimeIdentity"]>;
    }
  | { status: "BLOCKED"; code: J1dCapabilitySmokeBlocker };

/**
 * A fixed, invented context used only to prove that the pinned model responds.
 * It contains no source record, customer data, or usable financial evidence.
 */
export function buildJ1dSyntheticContext(): FinanceAgentContext {
  return financeAgentContextSchema.parse({
    obligation_id: J1D_SYNTHETIC_OBLIGATION_ID,
    aggregate_version: "0",
    as_of_date: "2026-01-01",
    amount: "0.00",
    currency: "USD",
    service_category: "SYNTHETIC_CAPABILITY_TEST",
    recurrence: "ONE_TIME",
    due_date: null,
    due_date_status: "NOT_STATED_ON_SOURCE",
    state_at_event_baseline: "OUTSTANDING",
    business_purpose_confirmed: false,
    commercial_terms: "Synthetic capability test only; no real obligation or commercial terms.",
    evidence_ids: [],
    evidence_present: false,
    destination_ready: false,
    destination_status: "SYNTHETIC_NOT_A_REAL_DESTINATION",
    destination_readiness_source: "UNVERIFIED_CURRENT_TRUST",
    due_date_position: "NOT_STATED",
  });
}

function classifyProviderError(error: unknown): J1dCapabilitySmokeBlocker {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (error instanceof SyntaxError) return "PROVIDER_RESPONSE_INVALID";
  if (/http 401|http 403/.test(message)) return "PROVIDER_AUTH";
  if (/http 429/.test(message)) return "PROVIDER_RATE_LIMITED";
  if (/timeout|timed out|abort/.test(message)) return "PROVIDER_TIMEOUT";
  if (/refused/.test(message)) return "PROVIDER_REFUSED";
  if (/not valid json|no message content|no response/.test(message)) {
    return "PROVIDER_RESPONSE_INVALID";
  }
  return "PROVIDER_UNAVAILABLE";
}

/**
 * Calls the supplied provider once. The provider itself owns its frozen,
 * bounded transport retry policy. This helper has no storage or authority
 * dependencies and never interprets a proposal as authorization.
 */
export async function runJ1dCapabilitySmoke(
  provider: Pick<AiProvider, "assess" | "runtimeIdentity">,
): Promise<J1dCapabilitySmokeResult> {
  let rawOutput: unknown;
  try {
    rawOutput = await provider.assess(buildJ1dSyntheticContext());
  } catch (error) {
    return { status: "BLOCKED", code: classifyProviderError(error) };
  }

  const parsed = financeAgentModelRecommendationSchema.safeParse(rawOutput);
  if (!parsed.success || parsed.data.obligation_id !== J1D_SYNTHETIC_OBLIGATION_ID) {
    return { status: "BLOCKED", code: "MODEL_OUTPUT_INVALID" };
  }
  if (!provider.runtimeIdentity) return { status: "BLOCKED", code: "PROVIDER_UNAVAILABLE" };

  return {
    status: "LIVE_AI",
    capability: "SYNTHETIC_PREVIEW_ONLY",
    authoritative: false,
    proposal: {
      ...parsed.data,
      authority: "NON_AUTHORITATIVE",
    },
    runtime_identity: provider.runtimeIdentity,
  };
}

export const SYNTHETIC_EVALUATION_CASE_IDS = [
  "POSITIVE_COMPLETE",
  "NEGATIVE_TRUST",
  "NEGATIVE_DATE",
  "NEGATIVE_EVIDENCE",
] as const;

export type SyntheticEvaluationCaseId = (typeof SYNTHETIC_EVALUATION_CASE_IDS)[number];

const EXPECTED_DECISION: Record<SyntheticEvaluationCaseId, "PAY" | "NOT_PAY"> = {
  POSITIVE_COMPLETE: "PAY",
  NEGATIVE_TRUST: "NOT_PAY",
  NEGATIVE_DATE: "NOT_PAY",
  NEGATIVE_EVIDENCE: "NOT_PAY",
};

/** Fixed, non-economic synthetic cases. The positive case is complete; each
 * negative removes exactly one of trust, due date, or source evidence. Trust is
 * labelled SYNTHETIC_EVALUATION_FIXTURE and never promoted to genuine trust. */
export function buildSyntheticEvaluationContext(id: SyntheticEvaluationCaseId): FinanceAgentContext {
  const complete = {
    obligation_id: `SYNTHETIC-EVAL-${id}`,
    aggregate_version: "0",
    as_of_date: "2026-01-01",
    amount: "100.00",
    currency: "USD",
    service_category: "SYNTHETIC_EVALUATION",
    recurrence: "ONE_TIME",
    due_date: "2026-02-01",
    due_date_status: "STATED_ON_SOURCE",
    state_at_event_baseline: "OUTSTANDING",
    business_purpose_confirmed: true,
    commercial_terms: "Synthetic non-economic evaluation case; no real obligation or commercial terms.",
    evidence_ids: ["SYN-EVD-001"],
    evidence_present: true,
    destination_ready: true,
    destination_status: "SYNTHETIC_EVALUATION_POLICY",
    destination_readiness_source: "SYNTHETIC_EVALUATION_FIXTURE",
    due_date_position: "FUTURE",
  } as const;

  const variants: Record<SyntheticEvaluationCaseId, Record<string, unknown>> = {
    POSITIVE_COMPLETE: {},
    NEGATIVE_TRUST: { destination_ready: false, destination_status: "SYNTHETIC_NOT_READY", destination_readiness_source: "UNVERIFIED_CURRENT_TRUST" },
    NEGATIVE_DATE: { due_date: null, due_date_status: "NOT_STATED_ON_SOURCE", due_date_position: "NOT_STATED" },
    NEGATIVE_EVIDENCE: { evidence_ids: [], evidence_present: false },
  };

  return financeAgentContextSchema.parse({ ...complete, ...variants[id] });
}

export type SyntheticEvaluationOutcome = {
  case_id: SyntheticEvaluationCaseId;
  expected: "PAY" | "NOT_PAY";
  decision: "PAY" | "HOLD" | "ESCALATE";
  codes: string[];
  expectation_met: boolean;
  authority: "NON_AUTHORITATIVE";
};

export type SyntheticEvaluationResult =
  | { status: "EVALUATED"; outcomes: SyntheticEvaluationOutcome[]; failures: number }
  | { status: "BLOCKED"; code: J1dCapabilitySmokeBlocker };

/** Runs the four fixed cases through the real provider path and the real
 * normalizer. Never preinserts PAY. A provider access, rate, or transport
 * boundary stops the batch with a typed blocker and no retry. */
export async function runSyntheticEvaluation(
  provider: Pick<AiProvider, "assess" | "runtimeIdentity">,
): Promise<SyntheticEvaluationResult> {
  const outcomes: SyntheticEvaluationOutcome[] = [];
  for (const id of SYNTHETIC_EVALUATION_CASE_IDS) {
    let thrown: unknown = null;
    const observed = {
      ...provider,
      assess: async (context: FinanceAgentContext) => {
        try {
          return await provider.assess(context);
        } catch (error) {
          thrown = error;
          throw error;
        }
      },
    } as AiProvider;
    const decision = await assessObligation(buildSyntheticEvaluationContext(id), observed);
    if (thrown) return { status: "BLOCKED", code: classifyProviderError(thrown) };
    if (wasProviderCallFailure(decision)) return { status: "BLOCKED", code: "PROVIDER_UNAVAILABLE" };

    const expected = EXPECTED_DECISION[id];
    outcomes.push({
      case_id: id,
      expected,
      decision: decision.decision,
      codes: decision.race.result.validated_findings.map((finding) => finding.code),
      expectation_met: expected === "PAY" ? decision.decision === "PAY" : decision.decision !== "PAY",
      authority: "NON_AUTHORITATIVE",
    });
  }
  return { status: "EVALUATED", outcomes, failures: outcomes.filter((o) => !o.expectation_met).length };
}
