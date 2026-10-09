import { describe, expect, it } from "vitest";
import { POST } from "../app/api/obligations/[id]/simulate-attack/route";

describe("legacy changed-destination route", () => {
  it("is retired without touching genuine obligation state", async () => {
    const response = await POST();
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: "This legacy attack route is disabled because it targeted genuine obligation state. Use the isolated synthetic demo lane.",
      code: "DEMO-004",
    });
  });
});
