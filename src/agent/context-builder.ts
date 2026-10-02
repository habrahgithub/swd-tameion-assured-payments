import type { FinanceAgentContext } from "./schema";

/** Shape of one record in data/live-usage/LIVE_USAGE_SET.json (J0-C). */
export interface LiveUsageObligationRecord {
  obligation_id: string;
  service_category: string;
  recurrence: "MONTHLY" | "YEARLY" | "ONE_TIME";
  due_date: string | null;
  due_date_status: "STATED_ON_SOURCE" | "NOT_STATED_ON_SOURCE";
  amount: string;
  currency: string;
  state_at_event_baseline: "OUTSTANDING";
  business_purpose_confirmed: boolean;
  commercial_terms: string;
  source_evidence: Array<{ evidence_id: string }>;
  candidate_readiness: {
    arc_product_destination_status: string;
  };
}

export interface CurrentReadinessOverlay {
  destination_status: string;
  source: "CURRENT_PRODUCT_TRUST_EVIDENCE" | "SIMULATED_DEMO_FIXTURE" | "UNVERIFIED_CURRENT_TRUST";
}

/**
 * Builds the minimal allowlisted, read-only context handed to the AI
 * provider from a J0-C LIVE_USAGE_SET record. Only decision-relevant
 * commercial fields cross this boundary — no raw source documents, no
 * private route fingerprints, no destination addresses.
 */
export function buildFinanceAgentContext(
  record: LiveUsageObligationRecord,
  aggregateVersion: number | string = 0,
  asOfDate = new Date().toISOString().slice(0, 10),
  currentReadiness?: CurrentReadinessOverlay,
): FinanceAgentContext {
  const trustedCurrentReadiness = currentReadiness?.source === "CURRENT_PRODUCT_TRUST_EVIDENCE" &&
    currentReadiness.destination_status === "READY";
  const sourceDestinationStatus = record.candidate_readiness.arc_product_destination_status;
  const destinationStatus = currentReadiness
    ? trustedCurrentReadiness ? "READY" : currentReadiness.destination_status === "READY" ? "NOT_READY_SIMULATED_FIXTURE" : currentReadiness.destination_status
    : sourceDestinationStatus === "READY" ? "NOT_READY_SOURCE_EVIDENCE_ONLY" : sourceDestinationStatus;
  if (!isCalendarDate(asOfDate)) throw new Error("Application assessment as-of date is invalid.");
  const dueDatePosition = record.due_date_status === "NOT_STATED_ON_SOURCE" && record.due_date === null
    ? "NOT_STATED"
    : record.due_date_status !== "STATED_ON_SOURCE" || !record.due_date || !isCalendarDate(record.due_date)
      ? "INVALID"
      : record.due_date < asOfDate
        ? "OVERDUE"
        : record.due_date === asOfDate
          ? "DUE_TODAY"
          : "FUTURE";
  return {
    obligation_id: record.obligation_id,
    aggregate_version: String(aggregateVersion),
    as_of_date: asOfDate,
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
    destination_ready: trustedCurrentReadiness,
    destination_status: destinationStatus,
    destination_readiness_source: currentReadiness?.source ?? "IMMUTABLE_SOURCE_EVIDENCE",
    due_date_position: dueDatePosition,
  };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
