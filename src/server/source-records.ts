import publicSourceSet from "../../data/live-usage/LIVE_USAGE_SET.json";
import type { LiveUsageObligationRecord } from "../agent/context-builder";

/** Public runtime source only. No test fixtures, private paths or fallback. */
export function loadPublicSourceRecords(): LiveUsageObligationRecord[] {
  if (publicSourceSet.status !== "WITHDRAWN_PRIVACY" || publicSourceSet.records.length !== 0) {
    throw new Error("Public source withdrawal boundary violated.");
  }
  return [];
}
