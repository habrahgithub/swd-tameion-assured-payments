import type { FinanceAgentContext } from "./schema";

/** Shape of one record in data/live-usage/LIVE_USAGE_SET.json (J0-C). */
export interface LiveUsageObligationRecord {
  obligation_id: string;
  service_category: string;
  recurrence: "MONTHLY" | "YEARLY" | "ONE_TIME";
  due_date: string | null;
  due_date_status: "STATED_ON_SOURCE" | "NOT_STATED_ON_SOURCE";
  amount: string;
  currency: "AED" | "USD";
  state_at_event_baseline: "OUTSTANDING";
  business_purpose_confirmed: boolean;
  commercial_terms: string;
  source_evidence: Array<{ evidence_id: string }>;
  candidate_readiness: {
    arc_product_destination_status: string;
  };
}

/**
 * Builds the minimal allowlisted, read-only context handed to the AI
 * provider from a J0-C LIVE_USAGE_SET record. Only decision-relevant
 * commercial fields cross this boundary — no raw source documents, no
 * private route fingerprints, no destination addresses.
 */
export function buildFinanceAgentContext(record: LiveUsageObligationRecord): FinanceAgentContext {
  return {
    obligation_id: record.obligation_id,
    amount: record.amount,
    currency: record.currency,
    service_category: record.service_category,
    recurrence: record.recurrence,
    due_date: record.due_date,
    due_date_status: record.due_date_status,
    state_at_event_baseline: record.state_at_event_baseline,
    business_purpose_confirmed: record.business_purpose_confirmed,
    commercial_terms: record.commercial_terms,
    evidence_ids: record.source_evidence.map((e) => e.evidence_id),
    evidence_present: record.source_evidence.length > 0,
    destination_ready: record.candidate_readiness.arc_product_destination_status === "READY",
  };
}
