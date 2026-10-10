import { DemoState } from "../src/server/demo-state";
import { GET as list } from "../app/api/obligations/route";
import { GET as detail } from "../app/api/obligations/[id]/route";
import { syntheticSourceRecords } from "../tests/test-support/synthetic-source-records";

/** Producer-shaped browser mocks, isolated in the test runner process. */
export async function syntheticSourceResponse(pathname: string): Promise<Response> {
  const state = new DemoState(undefined, undefined, undefined, undefined, {}, syntheticSourceRecords());
  (globalThis as typeof globalThis & { __tameionDemoState?: DemoState }).__tameionDemoState = state;
  if (pathname === "/api/obligations") return list();
  const match = /^\/api\/obligations\/([^/]+)$/.exec(pathname);
  if (!match) throw new Error("Only synthetic list/detail reads are supported by this fixture.");
  return detail(new Request(`http://localhost${pathname}`), { params: Promise.resolve({ id: match[1] }) });
}
