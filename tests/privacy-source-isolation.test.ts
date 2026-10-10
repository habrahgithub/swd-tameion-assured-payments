import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { DemoState } from "../src/server/demo-state";
import { GET as listObligations } from "../app/api/obligations/route";
import { GET as obligationDetail } from "../app/api/obligations/[id]/route";
import { syntheticSourceRecords } from "./test-support/synthetic-source-records";

vi.unmock("../src/server/source-records");

function json(relativePath: string) {
  return JSON.parse(readFileSync(new URL(relativePath, import.meta.url), "utf8"));
}

describe("public candidate privacy boundary", () => {
  it("withdraws genuine records and evidence rather than relabeling them synthetic", () => {
    for (const name of ["LIVE_USAGE_SET", "SOURCE_EVIDENCE_LEDGER"]) {
      const document = json(`../data/live-usage/${name}.json`);
      expect(document.status).toBe("WITHDRAWN_PRIVACY");
      expect(document.records).toHaveLength(0);
    }
  });

  it("does not seed default runtime state from private records or test fixtures", () => {
    const state = new DemoState();
    expect(state.liveUsageRecords).toHaveLength(0);
    expect(state.listObligations()).toHaveLength(0);
    expect(state.store.exportSnapshot().aggregates).toHaveLength(0);
  });

  it("permits explicit synthetic test injection without changing the default source", () => {
    const records = syntheticSourceRecords();
    const state = new DemoState(undefined, undefined, undefined, undefined, {}, records);
    expect(state.listObligations()).toHaveLength(5);
    records[0].amount = "999.00";
    expect(state.liveUsageRecords[0].amount).toBe("367.25");
    expect(new DemoState().listObligations()).toHaveLength(0);
  });

  it("does not expose restored legacy aggregates as genuine source records", () => {
    const testState = new DemoState(undefined, undefined, undefined, undefined, {}, syntheticSourceRecords());
    const restored = new DemoState(testState.exportSnapshot());
    expect(restored.listObligations()).toHaveLength(0);
    expect(restored.liveUsageRecords).toHaveLength(0);
    expect(restored.store.exportSnapshot().aggregates).toHaveLength(5);
  });

  it("returns no genuine list or detail for the withdrawn source set", async () => {
    const list = await listObligations();
    expect(list.status).toBe(200);
    expect((await list.json()).obligations).toHaveLength(0);
    const detail = await obligationDetail(new Request("http://localhost/api/obligations/OBL-J0C-001"), {
      params: Promise.resolve({ id: "OBL-J0C-001" }),
    });
    expect(detail.status).toBe(404);
  });

  it("replaces all eight private-origin design copies with non-disclosing stubs", () => {
    for (const stem of ["agent-runtime", "dependency", "full-blueprint", "verification"]) {
      const basename = stem === "full-blueprint" ? "tameion-full-blueprint.v1" : `tameion-${stem}-baseline.v1`;
      const root = `../docs/frozen-design/v1.4.22/${basename}`;
      expect(json(`${root}.json`).status).toBe("WITHDRAWN_PRIVATE_ORIGIN");
      const markdown = readFileSync(new URL(`${root}.md`, import.meta.url), "utf8");
      expect(markdown).toContain("WITHDRAWN_PRIVATE_ORIGIN");
      expect(markdown.length).toBeLessThan(1000);
    }
  });
});
