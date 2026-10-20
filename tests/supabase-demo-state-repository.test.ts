import { describe, expect, it,vi } from "vitest";

import { DemoStateConflictError, SupabaseDemoStateRepository } from "../src/server/supabase-demo-state-repository";

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("Supabase durable-state repository", () => {
  it("uses the service credential only in authenticated RPC headers and parses seed state", async () => {
    const observed: RequestInit[] = [];
    const repository = new SupabaseDemoStateRepository("https://example.supabase.co/", "test-only-secret", async (_url, init) => {
      observed.push(init ?? {});
      return jsonResponse({ revision: 1, snapshot: { schema_version: 1 } });
    });
    await expect(repository.loadOrSeed("preview-pr10", { schema_version: 1 })).resolves.toEqual({
      revision: 1,
      snapshot: { schema_version: 1 },
    });
    expect(observed[0]?.method).toBe("POST");
    expect(new Headers(observed[0]?.headers).get("Authorization")).toBe("Bearer test-only-secret");
    expect(observed[0]?.cache).toBe("no-store");
  });

  it("turns a stale compare-and-set into the explicit conflict error", async () => {
    const repository = new SupabaseDemoStateRepository("https://example.supabase.co", "test-only-secret", async () =>
      jsonResponse({ accepted: false, revision: 2 }),
    );
    await expect(repository.compareAndSet("preview-pr10", 1, {})).rejects.toBeInstanceOf(DemoStateConflictError);
  });

  it("allows only one of two writers with the same stale revision", async () => {
    let revision = 1;
    const repository = new SupabaseDemoStateRepository("https://example.supabase.co", "test-only-secret", async () => {
      if (revision !== 1) return jsonResponse({ accepted: false, revision });
      revision += 1;
      return jsonResponse({ accepted: true, revision });
    });
    const results = await Promise.allSettled([
      repository.compareAndSet("preview-pr10", 1, { update: "first" }),
      repository.compareAndSet("preview-pr10", 1, { update: "second" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected" && result.reason instanceof DemoStateConflictError)).toHaveLength(1);
    expect(revision).toBe(2);
  });

  it("propagates caller cancellation to an in-flight compare-and-set transport", async () => {
    const controller = new AbortController();
    let transportSignal: AbortSignal | null | undefined;
    const repository = new SupabaseDemoStateRepository("https://example.supabase.co", "test-only-secret", async (_url, init) => {
      transportSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      });
    });
    const pending = repository.compareAndSet("preview-pr10", 1, { update: "cancelled" }, controller.signal);
    controller.abort(new Error("test deadline"));
    await expect(pending).rejects.toThrow("compare-and-set failed");
    expect(transportSignal).toBeInstanceOf(AbortSignal);
    expect(transportSignal?.aborted).toBe(true);
  });
});

it('requires the installed R1 write capabilities without treating a legacy/missing capability as admission',async()=>{
 const {SupabaseDemoStateRepository}=await import('../src/server/supabase-demo-state-repository');
 const expected={schema_version:1,human_authorization_history:true,shared_wallet_namespace_lock:true,parent_child_retirement_lock:true,immutable_recovery_receipts:true};
 const fetcher=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>Response.json(expected));const repository=new SupabaseDemoStateRepository('https://synthetic.invalid','SYNTHETIC-NOT-A-CREDENTIAL',fetcher);
 await expect(repository.assertRecoveryWorkflowCapability()).resolves.toBeUndefined();expect(String(fetcher.mock.calls[0]?.[0])).toContain('/rpc/tameion_recovery_capabilities');
 const missing=new SupabaseDemoStateRepository('https://synthetic.invalid','SYNTHETIC-NOT-A-CREDENTIAL',async()=>Response.json({...expected,shared_wallet_namespace_lock:false}));
 await expect(missing.assertRecoveryWorkflowCapability()).rejects.toThrow('capability unavailable');
});
