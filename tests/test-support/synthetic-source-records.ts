import sourceSet from "./synthetic-source-records.json";
import type { LiveUsageObligationRecord } from "../../src/agent/context-builder";

/** Invented regression cases only; never imported by application runtime. */
export function syntheticSourceRecords(): LiveUsageObligationRecord[] {
  return structuredClone(sourceSet.records) as LiveUsageObligationRecord[];
}
