import type { FinanceAgentContext, FinanceAgentModelContext } from "./schema";

/** Shape of one record in data/live-usage/LIVE_USAGE_SET.json (J0-C). */
export interface LiveUsageObligationRecord {
  obligation_id: string;
  service_category: string;
  recurrence: "MONTHLY" | "YEARLY" | "ONE_TIME";
  issue_date?: string | null;
  due_date: string | null;
  due_date_status: "STATED_ON_SOURCE" | "NOT_STATED_ON_SOURCE";
  effective_due_date?: string | null;
  effective_due_date_basis?: "INVOICE_DATE_CASH_TERM" | null;
  effective_due_date_provenance?:
    | { provenance_class: "SOURCE_INVOICE_DATE"; evidence_id: string }
    | { provenance_class: "AUTHORIZED_OPERATOR_ATTESTATION"; authority_reference: string }
    | null;
  amount: string;
  currency: string;
  state_at_event_baseline: "OUTSTANDING";
  business_purpose_confirmed: boolean;
  commercial_terms: string;
  source_evidence: Array<{ evidence_id: string; content_sha256?: string }>;
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
  const hasEffectiveDateFields = record.issue_date !== undefined || record.effective_due_date !== undefined ||
    record.effective_due_date_basis !== undefined || record.effective_due_date_provenance !== undefined;
  const requiresEffectiveDateContract = /^OBL-J0C-[0-9]{3}$/.test(record.obligation_id) || hasEffectiveDateFields;
  const rawDueDateConsistent = record.due_date_status === "NOT_STATED_ON_SOURCE"
    ? record.due_date === null
    : record.due_date_status === "STATED_ON_SOURCE" && !!record.due_date && isCalendarDate(record.due_date);
  const provenance = record.effective_due_date_provenance;
  const effectiveDateProvenanceValid = record.due_date === record.issue_date && record.due_date_status === "STATED_ON_SOURCE"
    ? provenance?.provenance_class === "SOURCE_INVOICE_DATE" &&
      record.source_evidence.some((evidence) => evidence.evidence_id === provenance.evidence_id)
    : provenance?.provenance_class === "AUTHORIZED_OPERATOR_ATTESTATION" && !!provenance.authority_reference;
  const effectiveDateValid = !!record.issue_date && isCalendarDate(record.issue_date) &&
    !!record.effective_due_date && isCalendarDate(record.effective_due_date) &&
    record.effective_due_date === record.issue_date &&
    record.effective_due_date_basis === "INVOICE_DATE_CASH_TERM" && effectiveDateProvenanceValid;
  const legacyDueDatePosition = record.due_date_status === "NOT_STATED_ON_SOURCE" && record.due_date === null
    ? "NOT_STATED"
    : record.due_date_status !== "STATED_ON_SOURCE" || !record.due_date || !isCalendarDate(record.due_date)
      ? "INVALID"
      : record.due_date < asOfDate
        ? "OVERDUE"
        : record.due_date === asOfDate
          ? "DUE_TODAY"
          : "FUTURE";
  const dueDatePosition = !requiresEffectiveDateContract
    ? legacyDueDatePosition
    : !rawDueDateConsistent || !effectiveDateValid
      ? "INVALID"
      : record.effective_due_date! < asOfDate
        ? "OVERDUE"
        : record.effective_due_date === asOfDate
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
    issue_date: record.issue_date,
    due_date: record.due_date,
    due_date_status: record.due_date_status,
    effective_due_date: record.effective_due_date,
    effective_due_date_basis: record.effective_due_date_basis,
    effective_due_date_provenance: record.effective_due_date_provenance,
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

/** Projects obligation-assessment facts for model input without exposing payment-route state. */
export function toFinanceAgentModelContext(context: FinanceAgentContext): FinanceAgentModelContext {
  const {
    destination_ready: _destinationReady,
    destination_status: _destinationStatus,
    destination_readiness_source: _destinationReadinessSource,
    ...modelContext
  } = context;
  return modelContext;
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
