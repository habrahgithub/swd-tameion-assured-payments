import { describe, expect, it } from "vitest";

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
});
