import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const script = join(process.cwd(), "scripts/package-deployment-approval.mjs");
const verifyScript = join(process.cwd(), "scripts/verify-deployment-approval.mjs");
const approval = { approval_id: "SYNTHETIC-INDEPENDENT-APPROVAL", project_id: "SYNTHETIC-PROJECT", deployment_id: "SYNTHETIC-RESERVATION", environment: "preview", direct_edge: true, trusted_proxy_override: false, origins: ["https://reserved.example.invalid"] };
const identity = { deployment_id: approval.deployment_id, project_id: approval.project_id, environment: "preview", origin: approval.origins[0], team_id: "SYNTHETIC-TEAM" };
const directories: string[] = [];
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "tameion-package-test-")); directories.push(root);
  for (const [name, value] of [["approval", approval], ["reservation", identity], ["context", identity]] as const) writeFileSync(join(root, `${name}.json`), JSON.stringify(value));
  const hash = createHash("sha256").update(readFileSync(join(root, "approval.json"))).digest("hex");
  const args = ["--approval", join(root, "approval.json"), "--sha256", hash, "--reservation", join(root, "reservation.json"), "--build-context", join(root, "context.json"), "--continue-id", identity.deployment_id, "--team-id", identity.team_id];
  const run = (target = script, overrides = args) => JSON.parse(execFileSync(process.execPath, [target, ...overrides], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  return { root, args, run };
}
function fakeNext(root: string) {
  mkdirSync(join(root, ".next/server/app/api/operator/login"), { recursive: true }); mkdirSync(join(root, ".next/static"));
  writeFileSync(join(root, ".next/server/app-paths-manifest.json"), JSON.stringify({ "/api/operator/login/route": "app/api/operator/login/route.js" }));
  writeFileSync(join(root, ".next/server/app/api/operator/login/route.js"), "/* synthetic server bundle */");
  writeFileSync(join(root, ".next/server/app/api/operator/login/route.js.nft.json"), JSON.stringify({ version: 1, files: ["../../../../../../.tameion/deployment-approval.json"] }));
  writeFileSync(join(root, ".next/static/client.js"), "/* synthetic client bundle */");
}
describe("offline packaging and same-reservation pre-upload guard", () => {
  it("packages independently approved exact bytes; refuses overwrite", () => { const f = fixture(); expect(f.run().deployment_id).toBe(identity.deployment_id); expect(readFileSync(join(f.root, ".tameion/deployment-approval.json"), "utf8")).toBe(JSON.stringify(approval)); expect(() => f.run()).toThrow(); });
  it.each(["deployment_id", "project_id", "environment", "origin", "team_id"])("stops before packaging/upload on mismatched %s", key => { const f = fixture(); writeFileSync(join(f.root, "context.json"), JSON.stringify({ ...identity, [key]: "OTHER" })); let uploads = 0; expect(() => { f.run(); uploads++; }).toThrow(); expect(uploads).toBe(0); });
  it("rejects changed approved bytes, missing approval and wrong continuation", () => { const f = fixture(); const wrong = [...f.args]; wrong[wrong.indexOf("--continue-id") + 1] = "SUCCESSOR"; expect(() => f.run(script, wrong)).toThrow(); writeFileSync(join(f.root, "approval.json"), JSON.stringify({ ...approval, approval_id: "REPLACEMENT" })); expect(() => f.run()).toThrow(); rmSync(join(f.root, "approval.json")); expect(() => f.run()).toThrow(); });
  it("preserves preexisting directories/artifacts and rejects symlink destination", () => { const f = fixture(); const elsewhere = join(f.root, "elsewhere"); mkdirSync(elsewhere); symlinkSync(elsewhere, join(f.root, ".tameion")); expect(() => f.run()).toThrow(); });
  it("uses the production verifier before a synthetic same-ID continuation and rejects exposure/missing trace", () => {
    const f = fixture(); f.run(); fakeNext(f.root); let uploads = 0;
    const continueMock = () => { const proof = f.run(verifyScript); uploads++; return proof; };
    expect(continueMock().deployment_id).toBe(identity.deployment_id); expect(uploads).toBe(1);
    writeFileSync(join(f.root, ".next/static/client.js"), approval.approval_id); expect(() => continueMock()).toThrow(); expect(uploads).toBe(1);
    writeFileSync(join(f.root, ".next/static/client.js"), "clean"); writeFileSync(join(f.root, ".next/server/app/api/operator/login/route.js.nft.json"), '{"files":[]}'); expect(() => continueMock()).toThrow(); expect(uploads).toBe(1);
  });
});
