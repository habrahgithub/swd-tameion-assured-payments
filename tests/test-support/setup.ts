import { afterEach, beforeEach, vi } from "vitest";
import { isCurrentSourceEligible } from "../../src/server/source-records";
import { syntheticSourceRecords } from "./synthetic-source-records";

// Test-only source injection exercises existing production paths. The runtime
// module has no environment selector or path that can load these fixtures.
vi.mock("../../src/server/source-records", () => ({
  loadPublicSourceRecords: () => syntheticSourceRecords(),
  // Mock current source admission for isolated financial fixtures only.
  // The real withdrawn runtime source never admits these fixtures.
  isCurrentSourceEligible: vi.fn(() => true),
}));

// Unmocked network requests are forbidden throughout the unit suite.
beforeEach(() => {
  if (vi.isMockFunction(isCurrentSourceEligible)) isCurrentSourceEligible.mockReset().mockReturnValue(true);
  vi.stubGlobal("fetch", async () => {
    throw new Error("External network is forbidden in mock-only verification.");
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
