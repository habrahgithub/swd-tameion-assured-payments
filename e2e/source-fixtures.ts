import { DemoState } from "../src/server/demo-state";
import { projectObligationList, projectObligationDetail } from "../src/server/obligation-read-model";
import { syntheticSourceRecords } from "../tests/test-support/synthetic-source-records";

/** Producer-shaped browser mocks, isolated in the test runner process. */
export async function syntheticSourceResponse(pathname: string): Promise<Response> {
  const state = new DemoState(undefined, undefined, undefined, undefined, {}, syntheticSourceRecords());
  if (pathname === "/api/obligations") return projectObligationList(state);
  const match = /^\/api\/obligations\/([^/]+)$/.exec(pathname);
  if (!match) throw new Error("Only synthetic list/detail reads are supported by this fixture.");
  return projectObligationDetail(state, match[1]);
}
