import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseOperatorPolicy } from "../src/server/route-access-policy";
import { createOperatorHandlers } from "../src/server/operator-auth";
import { createHash } from "node:crypto";
import { computeProductionConfigurationSha256,PRODUCTION_CONFIGURATION_INPUT_NAMES } from "../src/server/production-config-identity";
import { syntheticSourceRecords } from "./test-support/synthetic-source-records";
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

function productionFixture(){
 const records=syntheticSourceRecords().map(r=>({obligation_id:r.obligation_id,service_category:r.service_category,recurrence:r.recurrence,issue_date:r.issue_date,due_date:r.due_date,due_date_status:r.due_date_status,effective_due_date:r.effective_due_date,effective_due_date_basis:r.effective_due_date_basis,effective_due_date_provenance:r.effective_due_date_provenance,amount:r.amount,currency:r.currency,state_at_event_baseline:r.state_at_event_baseline,business_purpose_confirmed:r.business_purpose_confirmed,commercial_terms:r.commercial_terms,source_evidence:r.source_evidence.map(e=>({evidence_id:e.evidence_id,content_sha256:e.content_sha256})),candidate_readiness:r.candidate_readiness}));
 const source=JSON.stringify({purpose:"OPERATOR_VIEW_ONLY",organization_id:"ORG-DEMO-001",state_binding:{namespace:"PRODUCTION-VIEW",revision:1,authority_sha256:"c".repeat(64)},records});
 const origin="https://production.example.invalid",sha="d".repeat(40);
 const values={SUPABASE_SERVICE_ROLE_KEY:"synthetic-service-role",SUPABASE_URL:"https://db.example.invalid",TAMEION_ALLOWED_ORIGINS:JSON.stringify([origin]),TAMEION_INGRESS_MODE:"vercel-direct-v1",TAMEION_OPERATOR_KEY:"synthetic-user",TAMEION_OPERATOR_SOURCE_DOCUMENT:source,TAMEION_OPERATOR_SOURCE_SHA256:createHash("sha256").update(source).digest("hex"),TAMEION_THROTTLE_HMAC_KEY:"e".repeat(64)};
 const configuration_sha256=computeProductionConfigurationSha256(values);
 const approval={approval_id:"SYNTHETIC-PRODUCTION-APPROVAL",binding:"git-sha-production-v1",project_id:"SYNTHETIC-PRODUCTION-PROJECT",git_commit_sha:sha,environment:"production",direct_edge:true,trusted_proxy_override:false,origins:[origin],configuration_schema:"tameion-production-config-v1",configuration_sha256};
 return {approval,env:{...values,TAMEION_INGRESS_RECORD:JSON.stringify(approval),VERCEL:"1",VERCEL_ENV:"production",VERCEL_PROJECT_ID:approval.project_id,VERCEL_GIT_COMMIT_SHA:sha}};
}

describe("configuration-bound Git SHA Production record",()=>{
 it("admits only an exact environment record",()=>{const f=productionFixture();expect(parseOperatorPolicy(f.env).deployment).toEqual(f.approval);});
 it("rejects packaged-only and mixed packaged Production authority",()=>{const f=productionFixture();packaged(JSON.stringify(f.approval));expect(()=>parseOperatorPolicy({...f.env,TAMEION_INGRESS_RECORD:undefined})).toThrow(/AUTH_UNAVAILABLE/);expect(()=>parseOperatorPolicy(f.env)).toThrow(/AUTH_UNAVAILABLE/);});
 it("rejects same-SHA drift in every bound configuration input",()=>{const f=productionFixture();for(const name of PRODUCTION_CONFIGURATION_INPUT_NAMES)expect(()=>parseOperatorPolicy({...f.env,[name]:f.env[name]+"x"})).toThrow(/AUTH_UNAVAILABLE/);});
 it("rejects project, SHA, environment, origin and discriminator swaps",()=>{const f=productionFixture();for(const override of [{VERCEL_PROJECT_ID:"OTHER"},{VERCEL_GIT_COMMIT_SHA:"0".repeat(40)},{VERCEL_ENV:"preview"},{TAMEION_ALLOWED_ORIGINS:'["https://other.example.invalid"]'}])expect(()=>parseOperatorPolicy({...f.env,...override})).toThrow(/AUTH_UNAVAILABLE/);const previewDiscriminator={...f.approval,binding:"git-sha-preview-v1"};expect(()=>parseOperatorPolicy({...f.env,TAMEION_INGRESS_RECORD:JSON.stringify(previewDiscriminator)})).toThrow(/AUTH_UNAVAILABLE/);});
 it("validates the canonical source before repository, password or balance capabilities",async()=>{
  const f=productionFixture(),repository=vi.fn(),verifyPassword=vi.fn(),balance=vi.fn();
  const malformedDocument='{"broken":true}',malformed={...f.env,TAMEION_OPERATOR_SOURCE_DOCUMENT:malformedDocument,TAMEION_OPERATOR_SOURCE_SHA256:createHash("sha256").update(malformedDocument).digest("hex")};const approval={...f.approval,configuration_sha256:computeProductionConfigurationSha256(malformed)};malformed.TAMEION_INGRESS_RECORD=JSON.stringify(approval);
  const handlers=createOperatorHandlers({policy:()=>parseOperatorPolicy(malformed),repository,operatorKey:()=>"synthetic-user",verifyPassword,balance});
  const response=await handlers.session(new Request("https://production.example.invalid/api/operator/session"));expect(response.status).toBe(503);expect(await response.json()).toEqual({code:"AUTH_UNAVAILABLE"});expect(repository).not.toHaveBeenCalled();expect(verifyPassword).not.toHaveBeenCalled();expect(balance).not.toHaveBeenCalled();
  const mismatched={...f.env,TAMEION_OPERATOR_SOURCE_SHA256:"f".repeat(64)};const mismatchApproval={...f.approval,configuration_sha256:computeProductionConfigurationSha256(mismatched)};mismatched.TAMEION_INGRESS_RECORD=JSON.stringify(mismatchApproval);expect(()=>parseOperatorPolicy(mismatched)).toThrow(/AUTH_UNAVAILABLE/);
 });
});
