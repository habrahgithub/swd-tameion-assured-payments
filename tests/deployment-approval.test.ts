import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOperatorPolicy } from "../src/server/route-access-policy";
import { createOperatorHandlers } from "../src/server/operator-auth";
const record = { approval_id: "SYNTHETIC-OWNER-APPROVAL", project_id: "SYNTHETIC-PROJECT", deployment_id: "SYNTHETIC-RESERVATION", environment: "preview", direct_edge: true, trusted_proxy_override: false, origins: ["https://synthetic.example.invalid"] };
const env = { TAMEION_ALLOWED_ORIGINS: JSON.stringify(record.origins), TAMEION_INGRESS_MODE: "vercel-direct-v1", TAMEION_THROTTLE_HMAC_KEY: "a".repeat(64), VERCEL: "1", VERCEL_ENV: "preview", VERCEL_PROJECT_ID: record.project_id, VERCEL_DEPLOYMENT_ID: record.deployment_id };
const gitRecord = { approval_id: "SYNTHETIC-GIT-SHA-APPROVAL", binding: "git-sha-preview-v1", project_id: "SYNTHETIC-PROJECT", git_commit_sha: "b".repeat(40), environment: "preview", direct_edge: true, trusted_proxy_override: false, origins: ["https://synthetic.example.invalid"] };
const gitEnv = { ...env, VERCEL_GIT_COMMIT_SHA: gitRecord.git_commit_sha, TAMEION_INGRESS_RECORD: JSON.stringify(gitRecord) };
let root: string | undefined;
afterEach(() => { vi.restoreAllMocks(); if (root) rmSync(root, { recursive: true, force: true }); root = undefined; });
function packaged(contents: string) { root = mkdtempSync(join(tmpdir(), "tameion-approval-test-")); mkdirSync(join(root, ".tameion")); writeFileSync(join(root, ".tameion/deployment-approval.json"), contents); vi.spyOn(process, "cwd").mockReturnValue(root); }
describe("independently approved packaged deployment record", () => {
  it("admits the owner-approved package only against exact runtime identity", () => { packaged(JSON.stringify(record)); expect(parseOperatorPolicy(env).deployment.approval_id).toBe(record.approval_id); });
  it("retains explicit legacy environment approval when package is absent", () => { expect(parseOperatorPolicy({ ...env, TAMEION_INGRESS_RECORD: JSON.stringify(record) }).deployment).toEqual(record); });
  it.each(["not json", "null", "{}", " ".repeat(16385)])("does not fall back from a present invalid package", (contents) => { packaged(contents); expect(() => parseOperatorPolicy({ ...env, TAMEION_INGRESS_RECORD: JSON.stringify(record) })).toThrow(/AUTH_UNAVAILABLE/); });
  it("rejects conflicting approval sources even when runtime matches the environment record", () => { packaged(JSON.stringify({ ...record, approval_id: "OTHER-APPROVAL" })); expect(() => parseOperatorPolicy({ ...env, TAMEION_INGRESS_RECORD: JSON.stringify(record) })).toThrow(/AUTH_UNAVAILABLE/); });
  it("rejects symlink and non-file package paths", () => { packaged(JSON.stringify(record)); const path = join(root!, ".tameion/deployment-approval.json"); rmSync(path); symlinkSync(join(root!, "missing"), path); expect(() => parseOperatorPolicy(env)).toThrow(/AUTH_UNAVAILABLE/); rmSync(path); mkdirSync(path); expect(() => parseOperatorPolicy(env)).toThrow(/AUTH_UNAVAILABLE/); });
  it("rejects invalid approval before any repository, password verifier, or balance provider", async () => {
    packaged("malformed"); const repository = vi.fn(() => { throw new Error("repository must not be constructed"); }); const verifyPassword = vi.fn(); const balance = vi.fn();
    const handlers = createOperatorHandlers({ policy: () => parseOperatorPolicy({ ...env, TAMEION_INGRESS_RECORD: JSON.stringify(record) }), repository, operatorKey: () => "SYNTHETIC-OPERATOR", verifyPassword, balance });
    for (const handler of [handlers.csrf, handlers.login, handlers.session, handlers.refresh]) {
      const response = await handler(new Request("https://synthetic.example.invalid/api/operator/session", { method: handler === handlers.session ? "GET" : "POST", ...(handler === handlers.session ? {} : { headers: { "content-type": "application/json" }, body: "{}" }) }));
      expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: "AUTH_UNAVAILABLE" });
    }
    expect(repository).not.toHaveBeenCalled(); expect(verifyPassword).not.toHaveBeenCalled(); expect(balance).not.toHaveBeenCalled();
  });
  it("accepts identical approval sources", () => { packaged(JSON.stringify(record)); expect(parseOperatorPolicy({ ...env, TAMEION_INGRESS_RECORD: JSON.stringify(record) }).deployment).toEqual(record); });
  it("rejects stale identity and origin mismatches without synthesizing authority", () => { packaged(JSON.stringify(record)); for (const overrides of [{ VERCEL_DEPLOYMENT_ID: "OTHER" }, { VERCEL_PROJECT_ID: "OTHER" }, { VERCEL_ENV: "production" }, { TAMEION_ALLOWED_ORIGINS: '["https://other.example.invalid"]' }, { VERCEL: "0" }]) expect(() => parseOperatorPolicy({ ...env, ...overrides })).toThrow(/AUTH_UNAVAILABLE/); });
});

describe("owner-approved exact Git SHA Preview record", () => {
  it("admits only the exact Git commit in the approved Preview project and origin", () => {
    expect(parseOperatorPolicy(gitEnv).deployment).toEqual(gitRecord);
  });

  it.each([
    { VERCEL_GIT_COMMIT_SHA: undefined },
    { VERCEL_GIT_COMMIT_SHA: "c".repeat(40) },
    { VERCEL_PROJECT_ID: "OTHER" },
    { VERCEL_ENV: "production" },
    { TAMEION_ALLOWED_ORIGINS: '["https://other.example.invalid"]' },
    { VERCEL: "0" },
  ])("fails closed when the exact Preview binding does not match: %o", (overrides) => {
    expect(() => parseOperatorPolicy({ ...gitEnv, ...overrides })).toThrow(/AUTH_UNAVAILABLE/);
  });

  it.each([
    { ...gitRecord, environment: "production" },
    { ...gitRecord, git_commit_sha: "B".repeat(40) },
    { ...gitRecord, git_commit_sha: "b".repeat(39) },
    { ...gitRecord, deployment_id: "MIXED-AUTHORITY" },
  ])("rejects malformed or widened Git SHA authority: %o", (invalidRecord) => {
    expect(() => parseOperatorPolicy({ ...gitEnv, TAMEION_INGRESS_RECORD: JSON.stringify(invalidRecord) })).toThrow(/AUTH_UNAVAILABLE/);
  });
});
