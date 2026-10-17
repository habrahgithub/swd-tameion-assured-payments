import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
const script = join(process.cwd(), "scripts/package-deployment-approval.mjs");
const verifyScript = join(process.cwd(), "scripts/verify-deployment-approval.mjs");
const approval = { approval_id: "SYNTHETIC-INDEPENDENT-APPROVAL", project_id: "SYNTHETIC-PROJECT", deployment_id: "SYNTHETIC-RESERVATION", environment: "preview", direct_edge: true, trusted_proxy_override: false, origins: ["https://reserved.example.invalid"] };
const identity = { deployment_id: approval.deployment_id, project_id: approval.project_id, environment: "preview", generated_origin: approval.origins[0], team_id: "SYNTHETIC-TEAM" };
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
function accessFixture() {
  const f = fixture(); const generated = "https://generated-reservation.example.invalid";
  for (const name of ["reservation", "context"]) writeFileSync(join(f.root, `${name}.json`), JSON.stringify({ ...identity, generated_origin: generated }));
  const plan = { approval_id: "SYNTHETIC-ORIGIN-PLAN", project_id: identity.project_id, team_id: identity.team_id, environment: "preview", access_origin: approval.origins[0], stage: "PRE_RESERVATION_ACCESS_ORIGIN_APPROVAL" };
  const planPath = join(f.root, "access-plan.json"); writeFileSync(planPath, JSON.stringify(plan));
  const planHash = createHash("sha256").update(readFileSync(planPath)).digest("hex");
  return { ...f, generated, plan, planPath, planHash, planArgs: [...f.args, "--access-origin-plan", planPath, "--access-origin-plan-sha256", planHash] };
}
describe("offline packaging and same-reservation pre-upload guard", () => {
  it("packages a truthful generated origin distinct from the independently approved preconfigured access origin", () => {
    const f = fixture(); const generated = "https://generated-reservation.example.invalid";
    for (const name of ["reservation", "context"]) writeFileSync(join(f.root, `${name}.json`), JSON.stringify({ ...identity, generated_origin: generated }));
    const plan = { approval_id: "SYNTHETIC-ORIGIN-PLAN", project_id: identity.project_id, team_id: identity.team_id, environment: "preview", access_origin: approval.origins[0], stage: "PRE_RESERVATION_ACCESS_ORIGIN_APPROVAL" };
    const planPath = join(f.root, "access-plan.json"); writeFileSync(planPath, JSON.stringify(plan));
    const planHash = createHash("sha256").update(readFileSync(planPath)).digest("hex");
    const invocation = `import { packageApproval } from ${JSON.stringify(script)}; console.log(JSON.stringify(packageApproval(${JSON.stringify({ root: f.root, approvalPath: join(f.root,"approval.json"), expectedHash: f.args[f.args.indexOf("--sha256")+1], reservationPath: join(f.root,"reservation.json"), contextPath: join(f.root,"context.json"), continueId: identity.deployment_id, expectedTeam: identity.team_id, accessPlanPath: planPath, accessPlanHash: planHash })})));`;
    const result = JSON.parse(execFileSync(process.execPath, ["--input-type=module", "-e", invocation], { cwd: f.root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    expect(result.generated_origin).toBe(generated); expect(result.access_origin).toBe(approval.origins[0]); expect(result.access_origin_mapping).toBe("NOT_YET_VERIFIED");
  });

  it("packages independently approved exact bytes; refuses overwrite", () => { const f = fixture(); expect(f.run().deployment_id).toBe(identity.deployment_id); expect(readFileSync(join(f.root, ".tameion/deployment-approval.json"), "utf8")).toBe(JSON.stringify(approval)); expect(() => f.run()).toThrow(); });
  it.each(["deployment_id", "project_id", "environment", "generated_origin", "team_id"])("stops before packaging/upload on mismatched %s", key => { const f = fixture(); writeFileSync(join(f.root, "context.json"), JSON.stringify({ ...identity, [key]: "OTHER" })); let uploads = 0; expect(() => { f.run(); uploads++; }).toThrow(); expect(uploads).toBe(0); });
  it("rejects changed approved bytes, missing approval and wrong continuation", () => { const f = fixture(); const wrong = [...f.args]; wrong[wrong.indexOf("--continue-id") + 1] = "SUCCESSOR"; expect(() => f.run(script, wrong)).toThrow(); writeFileSync(join(f.root, "approval.json"), JSON.stringify({ ...approval, approval_id: "REPLACEMENT" })); expect(() => f.run()).toThrow(); rmSync(join(f.root, "approval.json")); expect(() => f.run()).toThrow(); });
  it("preserves preexisting directories/artifacts and rejects symlink destination", () => { const f = fixture(); const elsewhere = join(f.root, "elsewhere"); mkdirSync(elsewhere); symlinkSync(elsewhere, join(f.root, ".tameion")); expect(() => f.run()).toThrow(); });
  it("uses the production verifier before a synthetic same-ID continuation and rejects exposure/missing trace", () => {
    const f = fixture(); f.run(); fakeNext(f.root); let uploads = 0;
    const continueMock = () => { const proof = f.run(verifyScript); uploads++; return proof; };
    expect(continueMock().deployment_id).toBe(identity.deployment_id); expect(uploads).toBe(1);
    writeFileSync(join(f.root, ".next/static/client.js"), approval.approval_id); expect(() => continueMock()).toThrow(); expect(uploads).toBe(1);
    writeFileSync(join(f.root, ".next/static/client.js"), "clean"); writeFileSync(join(f.root, ".next/server/app/api/operator/login/route.js.nft.json"), '{"files":[]}'); expect(() => continueMock()).toThrow(); expect(uploads).toBe(1);
  });
  it.each(["approval_id", "project_id", "team_id", "environment", "access_origin", "stage"])("rejects an unapproved access plan field %s with package/verifier parity", key => {
    const f = accessFixture(); const broken = { ...f.plan, [key]: key === "approval_id" ? "" : "OTHER" };
    writeFileSync(f.planPath, JSON.stringify(broken)); const hash = createHash("sha256").update(readFileSync(f.planPath)).digest("hex"); const args = [...f.planArgs]; args[args.indexOf("--access-origin-plan-sha256")+1] = hash;
    expect(() => f.run(script, args)).toThrow(); expect(() => f.run(verifyScript, args)).toThrow();
  });
  it("rejects missing, changed, malformed, duplicate and extra-key plan authority without writes", () => {
    for (const contents of ["null", "{", JSON.stringify({ ...accessFixture().plan, extra: true }), '{"approval_id":"A","approval_id":"B"}']) {
      const f = accessFixture(); writeFileSync(f.planPath, contents); const args = [...f.planArgs]; args[args.indexOf("--access-origin-plan-sha256")+1] = createHash("sha256").update(contents).digest("hex"); expect(() => f.run(script,args)).toThrow(); expect(() => f.run(verifyScript,args)).toThrow();
    }
    const f = accessFixture(); expect(() => f.run()).toThrow(); const wrong = [...f.planArgs]; wrong[wrong.indexOf("--access-origin-plan-sha256")+1] = "0".repeat(64); expect(() => f.run(script,wrong)).toThrow(); expect(() => f.run(verifyScript,wrong)).toThrow();
    rmSync(f.planPath); expect(() => f.run(script,f.planArgs)).toThrow();
  });
  it("keeps generated and access facts distinct in package and real verifier output", () => {
    const f = accessFixture(); const packaged = f.run(script,f.planArgs); fakeNext(f.root); const proof = f.run(verifyScript,f.planArgs);
    for (const result of [packaged,proof]) { expect(result.generated_origin).toBe(f.generated); expect(result.access_origin).toBe(approval.origins[0]); expect(result.access_origin_mapping).toBe("NOT_YET_VERIFIED"); expect(result.hosted_uat).toBe("NOT_ADMITTED"); }
    writeFileSync(join(f.root,"context.json"),JSON.stringify({ ...identity, generated_origin:"https://different.example.invalid" })); expect(() => f.run(verifyScript,f.planArgs)).toThrow();
  });
  it("blocks fake hosted auth/provider actions until exact mapping and effective protection receipts exist", () => {
    const f = accessFixture();
    const common = { deployment_id: identity.deployment_id, project_id: identity.project_id, team_id: identity.team_id, environment:"preview", access_origin:approval.origins[0], generated_origin:f.generated, authenticated_readback:true, evidence_sha256:"a".repeat(64) };
    const protection = { ...common, anonymous_access_denied:true, anonymous_generated_denied:true };
    function gate(mapping: unknown, protectionInput: unknown) {
      const invocation = `import { requireHostedEvidence } from ${JSON.stringify(verifyScript)}; const result=requireHostedEvidence(${JSON.stringify({record:approval,reservation:{...identity,generated_origin:f.generated},expectedTeam:identity.team_id,mapping,protection:protectionInput})}); console.log(JSON.stringify({...result,fakeAuthCalls:1,fakeProviderCalls:1}));`;
      return JSON.parse(execFileSync(process.execPath,["--input-type=module","-e",invocation],{cwd:f.root,encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
    }
    for (const missing of [undefined,null,{},[common],{...common,extra:true},{...common,deployment_id:"SUCCESSOR"},{...common,authenticated_readback:false}]) expect(() => gate(missing,protection)).toThrow();
    for (const missing of [undefined,null,{}, {...protection,anonymous_access_denied:false},{...protection,anonymous_generated_denied:false},{...protection,team_id:"OTHER"}]) expect(() => gate(common,missing)).toThrow();
    expect(gate(common,protection)).toEqual({hosted_evidence_inputs:"CONSISTENT_SUPPLIED_RECEIPTS_NOT_REMOTE_ATTESTATION",hosted_uat:"REQUIRES_SEPARATE_OWNER_AUTHORITY",fakeAuthCalls:1,fakeProviderCalls:1});
    // Fourteen sequential Node processes need bounded startup headroom on CI.
  }, 15_000);

});
