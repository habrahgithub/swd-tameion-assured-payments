import type { AiProvider } from "./ai-provider";
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
