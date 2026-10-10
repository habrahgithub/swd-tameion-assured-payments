import { afterEach, beforeEach, vi } from "vitest";
import { syntheticSourceRecords } from "./synthetic-source-records";

// Test-only source injection exercises existing production paths. The runtime
// module has no environment selector or path that can load these fixtures.
vi.mock("../../src/server/source-records", () => ({
  loadPublicSourceRecords: () => syntheticSourceRecords(),
}));

// Unmocked network requests are forbidden throughout the unit suite.
beforeEach(() => vi.stubGlobal("fetch", async () => {
  throw new Error("External network is forbidden in mock-only verification.");
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
