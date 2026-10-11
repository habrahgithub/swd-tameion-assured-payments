import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ state: vi.fn() }));
vi.mock("../src/server/demo-state", async original => ({
  ...await original<typeof import("../src/server/demo-state")>(), getDemoState: mocks.state,
}));
import { POST as approve } from "../app/api/obligations/[id]/approve/route";
import { POST as killSwitch } from "../app/api/obligations/[id]/kill-switch/route";
import * as source from "../src/server/source-records";
import { GET as list } from "../app/api/obligations/route";
import { GET as packet } from "../app/api/obligations/[id]/prime-approval-packet/route";
import { GET as detail } from "../app/api/obligations/[id]/route";
import { DemoState } from "../src/server/demo-state";

describe("unverified requester mutation boundary", () => {
  it.each([undefined, "USR-DEMO-OPERATOR", "USR-ATTACKER"])("rejects approval for unverified actor %s before state access", async actor => {
    const state = new DemoState(); mocks.state.mockResolvedValue(state);
    const before = state.exportSnapshot(); mocks.state.mockClear();
    const response = await approve(new Request("http://localhost/approve", {method: "POST",
      headers: {"Content-Type":"application/json", "x-actor-id": actor ?? ""},
      body: JSON.stringify({actor_id:actor, expected_version:1, reviewed_assessment_id:"forged", reviewed_assessment_hash:"a".repeat(64)}),
    }), {params: Promise.resolve({id:"OBL-J0C-001"})});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({code:"REQUESTER_UNVERIFIED"});
    expect(mocks.state).not.toHaveBeenCalled(); expect(state.exportSnapshot()).toEqual(before);
  });
  it.each([
    ["ACTIVATE", undefined], ["DEACTIVATE", undefined],
    ["ACTIVATE", "USR-DEMO-OPERATOR"], ["DEACTIVATE", "USR-DEMO-OPERATOR"],
    ["ACTIVATE", "USR-ATTACKER"], ["DEACTIVATE", "USR-ATTACKER"],
  ] as const)("rejects unverified kill-switch %s actor %s without changing protected state", async (action, actor) => {
    for (const scope of ["TRANSACTION", "GLOBAL"] as const) {
      const state = new DemoState();
      state.store.activateKillSwitch("GLOBAL_EXECUTION_DISABLED");
      state.store.activateKillSwitch("TRANSACTION_DISABLED", "OBL-J0C-001");
      const before = state.exportSnapshot(); mocks.state.mockResolvedValue(state).mockClear();
      const response = await killSwitch(new Request("http://localhost/kill-switch", {method:"POST",
        headers:{"Content-Type":"application/json", "x-actor-id":actor ?? ""},
        body:JSON.stringify({action,scope,actor_id:actor}),
      }), {params:Promise.resolve({id:"OBL-J0C-001"})});
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({code:"REQUESTER_UNVERIFIED"});
      expect(mocks.state).not.toHaveBeenCalled(); expect(state.exportSnapshot()).toEqual(before);
    }
  });
});

it("withdrawn list and detail do not hydrate a state loader that can seed or migrate durable records", async () => {
  vi.spyOn(source, "loadPublicSourceRecords").mockReturnValue([]);
  vi.mocked(source.isCurrentSourceEligible).mockReturnValue(false);
  mocks.state.mockResolvedValue(new DemoState()).mockClear();
  const response = await list(new Request("http://localhost/api/obligations"));
  expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ obligations: [], total_count: 0 });
  const absent = await detail(new Request("http://localhost/detail"), {params:Promise.resolve({id:"OBL-J0C-001"})});
  expect(absent.status).toBe(404);
  const disclosure = await packet(new Request("http://localhost/packet"), {params:Promise.resolve({id:"OBL-J0C-001"})});
  expect(disclosure.status).toBe(404); expect(mocks.state).not.toHaveBeenCalled();
});

vi.mock("../src/server/operator-obligation-routes", async original => {
 const actual=await original<typeof import("../src/server/operator-obligation-routes")>();
 const {getDemoState}=await import("../src/server/demo-state");
 return {...actual,obligationReaders:actual.createObligationReaders(async()=>({revalidate:async()=>{}} as import("../src/server/operator-auth").AuthContext),getDemoState)};
});
