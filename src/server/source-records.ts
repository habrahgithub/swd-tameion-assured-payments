import publicSourceSet from "../../data/live-usage/LIVE_USAGE_SET.json";
import type { LiveUsageObligationRecord } from "../agent/context-builder";

/** Public runtime source only. No test fixtures, private paths or fallback. */
export function loadPublicSourceRecords(): LiveUsageObligationRecord[] {
  if (publicSourceSet.status !== "WITHDRAWN_PRIVACY" || publicSourceSet.records.length !== 0) {
    throw new Error("Public source withdrawal boundary violated.");
  }
  return [];
}

/** Current source admission is independent of restored aggregates or PAEs.
 * This withdrawn demonstrator has no admitted source records. A future source
 * admission policy requires separate authority; historical IDs cannot revive it.
 */
export function isCurrentSourceEligible(organizationId: string, obligationId: string): boolean {
  try {
    return organizationId === "ORG-DEMO-001" &&
      loadPublicSourceRecords().some(record => record.obligation_id === obligationId);
  } catch {
    return false;
  }
}
