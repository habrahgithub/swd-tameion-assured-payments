// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { openLocalWalkthrough, localRequestAllowed, localNextRequestAllowed } from "../src/demo/local-walkthrough";

function local() { vi.stubGlobal("window", { location: { href: "http://127.0.0.1:3190/local-demo" }, isSecureContext: true, top: null, self: null, opener: null }); return openLocalWalkthrough(); }

describe("enforced local synthetic journey", () => {
  it("rejects hosted, forwarded and malformed request activation", () => {
    expect(localRequestAllowed(new Headers({ host: "127.0.0.1:3190" }), false)).toBe(true);
    for (const host of ["example.com", "127.0.0.1.evil.test", "localhost@evil.test", "0.0.0.0", "127.1", "localhost:65536"]) expect(localRequestAllowed(new Headers({host}), false)).toBe(false);
    for (const key of ["forwarded", "x-forwarded-host", "x-forwarded-for", "x-vercel-id"]) expect(localRequestAllowed(new Headers({host:"localhost:3190",[key]:"localhost"}),false)).toBe(false);
    expect(localRequestAllowed(new Headers({host:"localhost:3190"}),true)).toBe(false);
  });
  it("accepts only Next's exact loopback forwarding defaults and rejects hostile forwarding", () => {
    const h=new Headers({host:"127.0.0.1:3190","x-forwarded-host":"127.0.0.1:3190","x-forwarded-port":"3190","x-forwarded-proto":"http","x-forwarded-for":"127.0.0.1"});
    expect(localNextRequestAllowed(h,false)).toBe(true);
    for(const [key,value] of [["x-forwarded-for","203.0.113.4"],["x-forwarded-host","evil.test"],["x-forwarded-proto","gopher"],["forwarded","for=127.0.0.1"]]) {
      const bad=new Headers(h);bad.set(key,value);expect(localNextRequestAllowed(bad,false)).toBe(false);
    }
    expect(localNextRequestAllowed(h,true)).toBe(false);
  });
  it("rejects non-loopback, embedded and insecure browser contexts", () => {
    for (const href of ["https://example.com/local-demo", "http://127.0.0.1.evil.test/local-demo", "file:///local-demo"]) {
      vi.stubGlobal("window", { location:{href}, isSecureContext:true, top:null,self:null,opener:null });
      expect(() => openLocalWalkthrough()).toThrow(/LOCAL_ONLY/);
    }
    vi.stubGlobal("window", {location:{href:"http://localhost:3190/local-demo"},isSecureContext:true,top:{},self:{},opener:null});
    expect(() => openLocalWalkthrough()).toThrow(/LOCAL_ONLY/);
  });
  it("records an actual fake submission and separate reconciliation with exact lineage", async () => {
    const journey=local(); const initial=journey.view();
    expect(initial.stage).toBe("OBLIGATION"); expect(initial.assessment).toBeNull();
    const a=journey.assess(); expect(a.assessment?.decision).toBe("PAY");
    const authorized=journey.authorize(a.caseId,a.version,a.assessment!.id);
    expect(authorized.packet?.signed).toBe(false); expect(authorized.stage).toBe("ASSURED_MOCK");
    expect((await journey.execute()).stage).toBe("SUBMITTED_MOCK");
    expect(journey.view().submissions).toBe(1);
    const settled=await journey.reconcile(); expect(settled.stage).toBe("RECONCILED_MOCK");
    expect(settled.events.map(e=>e.action)).toEqual(["CREATED","ASSESSED","AUTHORIZED_MOCK","SUBMITTED_MOCK","RECONCILED_MOCK"]);
    expect(settled.events.every(e=>e.caseId===initial.caseId)).toBe(true);
    expect(settled.packet?.assessmentId).toBe(a.assessment!.id);
    expect(settled.packet?.intent).toEqual({caseId:a.caseId,version:a.version,amount:a.amount,destination:a.destination});
  });
  it.each(["HOLD","ESCALATE","FUNDING_HOLD"] as const)("blocks %s before fake submission", async scenario=>{
    const j=local();j.scenario(scenario);const a=j.assess();
    expect(()=>j.authorize(a.caseId,a.version,a.assessment!.id)).toThrow(/BLOCKED/);
    await expect(j.execute()).rejects.toThrow(/BLOCKED/); expect(j.view().submissions).toBe(0);
  });
  it("invalidates assessment on input changes and preserves audit history",()=>{
    const j=local(); const a=j.assess();j.changeAmount();
    expect(()=>j.authorize(a.caseId,a.version,a.assessment!.id)).toThrow(/STALE/);
    expect(j.view().assessment).toBeNull();expect(j.view().events).toHaveLength(3);
  });
  it("rejects different case and assessment identity",()=>{
    const j=local();const a=j.assess();
    expect(()=>j.authorize("MOCK-CASE-B",a.version,a.assessment!.id)).toThrow(/IDENTITY/);
    expect(()=>j.authorize(a.caseId,a.version,"old-assessment")).toThrow(/IDENTITY/);
    j.select("MOCK-CASE-B");expect(j.view().assessment).toBeNull();
    j.select("MOCK-CASE-A");expect(j.view().assessment?.id).toBe(a.assessment!.id);
  });
  it.each(["DESTINATION_CHANGED","PACKET_MISMATCH","HISTORICAL_AUTHORITY"] as const)("does not restore or send %s",async scenario=>{
    const j=local();j.scenario(scenario);const a=j.assess();j.authorize(a.caseId,a.version,a.assessment!.id);
    if(scenario==="DESTINATION_CHANGED")j.changeDestination();
    await expect(j.execute()).rejects.toThrow(/BLOCKED/);expect(j.view().submissions).toBe(0);
    expect(j.view().events.some(e=>e.action==="AUTHORIZED_MOCK")).toBe(true);
  });
  it("keeps UNKNOWN unresolved, forbids retry and reconciles only recorded fake evidence",async()=>{
    const j=local();j.scenario("UNKNOWN");const a=j.assess();j.authorize(a.caseId,a.version,a.assessment!.id);
    expect((await j.execute()).stage).toBe("UNKNOWN");
    await expect(j.execute()).rejects.toThrow(/NO_RETRY/);expect((await j.reconcile()).stage).toBe("UNKNOWN");
    expect(j.view().submissions).toBe(1);
  });
  it("never records reconciliation completion when an UNKNOWN outcome is merely observed",async()=>{
    const j=local();j.scenario("UNKNOWN");const assessed=j.assess();
    j.authorize(assessed.caseId,assessed.version,assessed.assessment!.id);
    await j.execute();const count=j.view().submissions;
    const observed=await j.reconcile();
    expect(observed.stage).toBe("UNKNOWN");expect(observed.reconciliation).toBe("UNKNOWN");
    expect(observed.events.at(-1)?.action).toBe("OBSERVED_MOCK");
    expect(observed.events.some(e=>e.action==="RECONCILED_MOCK")).toBe(false);
    await expect(j.execute()).rejects.toThrow(/NO_RETRY/);
    expect((await j.reconcile()).events.at(-1)?.action).toBe("OBSERVED_MOCK");
    expect(j.view().submissions).toBe(count);expect(count).toBe(1);
  });
  it("prevents duplicate concurrent submissions and case changes while submission is in flight",async()=>{
    const j=local();const a=j.assess();j.authorize(a.caseId,a.version,a.assessment!.id);
    const first=j.execute();await expect(j.execute()).rejects.toThrow(/NO_RETRY/);await first;
    expect(j.view().submissions).toBe(1);
    const k=local();const b=k.assess();k.authorize(b.caseId,b.version,b.assessment!.id);
    const pending=k.execute();expect(()=>k.select("MOCK-CASE-B")).toThrow(/NO_RETRY/);await pending;
    expect(k.view().caseId).toBe("MOCK-CASE-A");expect(k.view().submissions).toBe(1);
  });
  it("retains full mock packet and assessment identity in audit after changed inputs",()=>{
    const j=local();const a=j.assess();const p=j.authorize(a.caseId,a.version,a.assessment!.id).packet!;
    j.changeDestination();j.assess();const current=j.view();
    const historic=current.events.find(e=>e.action==="AUTHORIZED_MOCK")!;
    expect(historic.packet).toEqual(p);expect(historic.assessment?.id).toBe(a.assessment!.id);
    expect(historic.packet!.intent.destination).not.toBe(current.destination);
  });
  it("returns defensive snapshots and refuses activation after leaving loopback",()=>{
    const j=local();const a=j.assess();a.amount="999";a.events.length=0;
    expect(j.view().amount).toBe("125.00");expect(j.view().events).toHaveLength(2);
    window.location.href="https://example.com/local-demo";expect(()=>j.assess()).toThrow(/LOCAL_ONLY/);
  });
});
