import { describe, expect, it, vi } from "vitest";
import { createObligationReaders } from "../src/server/operator-obligation-routes";
import { DemoState } from "../src/server/demo-state";
import { syntheticSourceRecords } from "./test-support/synthetic-source-records";
import { isCurrentSourceEligible } from "../src/server/source-records";
import type { AuthContext } from "../src/server/operator-auth";
vi.unmock("../src/server/source-records");
describe("authenticated private VIEW admission, independent of financial source eligibility", () => {
  it("shows five explicitly supplied operator-view records after authentication without reviving finance", async () => {
    const records=syntheticSourceRecords();
    const state=new DemoState(undefined,undefined,undefined,undefined,{},records);
    const load=vi.fn(async()=>state);
    // Existing in-process factory seam; the new optional source capability is
    // read-only and does not alter the canonical financial eligibility module.
    const readers=createObligationReaders(async()=>({revalidate:async()=>{}} as AuthContext),load,()=>records);
    const response=await readers.list(new Request("https://operator.example.invalid/api/obligations"));
    expect(response.status).toBe(200);expect((await response.json()).total_count).toBe(5);expect(load).toHaveBeenCalledWith(records,undefined);
    expect(isCurrentSourceEligible("ORG-DEMO-001",records[2].obligation_id)).toBe(false);
    expect((await readers.detail(new Request("https://operator.example.invalid"),records[0].obligation_id)).status).toBe(200);
    expect((await readers.packet(new Request("https://operator.example.invalid"),records[2].obligation_id)).status).toBe(404);
  });
});

import { afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalize } from "json-canonicalize";
import { loadOperatorSourceRecords, parseOperatorSource, MAX_OPERATOR_SOURCE_BYTES } from "../src/server/operator-source-records";
import { loadExistingDemoState } from "../src/server/load-existing-demo-state";
import { AccessError } from "../src/server/route-access-policy";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { projectObligationDetail } from "../src/server/obligation-read-model";
let directory:string|undefined;
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();if(directory)rmSync(directory,{recursive:true,force:true});directory=undefined;});
function privateFixture(){
 const originals=syntheticSourceRecords();const state=new DemoState(undefined,undefined,undefined,undefined,{},originals);const snapshot=state.exportSnapshot();
 const records=originals.map(r=>({obligation_id:r.obligation_id,service_category:r.service_category,recurrence:r.recurrence,issue_date:r.issue_date,due_date:r.due_date,due_date_status:r.due_date_status,effective_due_date:r.effective_due_date,effective_due_date_basis:r.effective_due_date_basis,effective_due_date_provenance:r.effective_due_date_provenance,amount:r.amount,currency:r.currency,state_at_event_baseline:r.state_at_event_baseline,business_purpose_confirmed:r.business_purpose_confirmed,commercial_terms:r.commercial_terms,source_evidence:r.source_evidence.map(e=>({evidence_id:e.evidence_id,content_sha256:e.content_sha256})),candidate_readiness:r.candidate_readiness}));
 const packet={purpose:"OPERATOR_VIEW_ONLY",organization_id:"ORG-DEMO-001",state_binding:{namespace:"VIEW-NAMESPACE",revision:1,authority_sha256:createHash("sha256").update(canonicalize(snapshot.authority)).digest("hex")},records};
 const bytes=Buffer.from(JSON.stringify(packet));const hash=createHash("sha256").update(bytes).digest("hex");
 directory=mkdtempSync(join(tmpdir(),"operator-private-view-"));mkdirSync(join(directory,".tameion"));const path=join(directory,".tameion/operator-source.json");writeFileSync(path,bytes);vi.spyOn(process,"cwd").mockReturnValue(directory);vi.stubEnv("TAMEION_OPERATOR_SOURCE_SHA256",hash);
 const rpc={call:vi.fn(async(_name:string,_parameters:Record<string,unknown>)=>({revision:1,snapshot}))};const load=vi.fn((records:Parameters<typeof loadExistingDemoState>[2],binding:Parameters<typeof loadExistingDemoState>[3])=>loadExistingDemoState(rpc,"VIEW-NAMESPACE",records,binding));
 const readers=createObligationReaders(async()=>({revalidate:async()=>{}} as AuthContext),load);
 return {packet,bytes,hash,path,state,snapshot,rpc,load,readers};
}
describe("production private source/file/read-only restoration boundary",()=>{
 it("projects configured Circle runtime without constructing a provider or granting historical payment eligibility",async()=>{
  const f=privateFixture(),before=JSON.stringify(f.snapshot);
  vi.stubEnv("CIRCLE_API_KEY","SYNTHETIC_TEST_KEY");vi.stubEnv("CIRCLE_ENTITY_SECRET","a".repeat(64));
  const state=await loadExistingDemoState(f.rpc,"VIEW-NAMESPACE",f.packet.records,f.packet.state_binding);
  expect(state.providerAdapter.name).toBe("arc-circle-live");
  const response=await projectObligationDetail(state,f.packet.records[0].obligation_id,false).json();
  expect(response.financial_action_eligible).toBe(false);
  expect(response.execution_gate).toBe("LOCKED_UNTIL_CURRENT_AUTHORIZATION");
  expect(JSON.stringify(f.snapshot)).toBe(before);
  expect(f.rpc.call).toHaveBeenCalledExactlyOnceWith("tameion_state_load_existing",{namespace:"VIEW-NAMESPACE",expected_schema_version:2});
 });
 it.each([[undefined,undefined],["SYNTHETIC_TEST_KEY",undefined],[undefined,"a".repeat(64)]])("keeps incomplete Circle configuration non-live",async(apiKey,entitySecret)=>{
  const f=privateFixture();vi.stubEnv("CIRCLE_API_KEY",apiKey);vi.stubEnv("CIRCLE_ENTITY_SECRET",entitySecret);
  const state=await loadExistingDemoState(f.rpc,"VIEW-NAMESPACE",f.packet.records,f.packet.state_binding);
  expect(state.providerAdapter.name).toBe("fake-testnet");
 });
 it("validates exactly five approved canonical records and returns them only through authenticated existing-state projection",async()=>{
  const f=privateFixture();expect(parseOperatorSource(f.bytes,f.hash).records).toHaveLength(5);
  const response=await f.readers.list(new Request("https://operator.example.invalid"));expect(response.status).toBe(200);expect((await response.json()).total_count).toBe(5);
  expect(f.rpc.call).toHaveBeenCalledExactlyOnceWith("tameion_state_load_existing",{namespace:"VIEW-NAMESPACE",expected_schema_version:2});
  const detail=await f.readers.detail(new Request("https://operator.example.invalid"),f.packet.records[0].obligation_id);
  expect(detail.status).toBe(200);expect(await detail.json()).toMatchObject({financial_action_eligible:false});
  expect(isCurrentSourceEligible("ORG-DEMO-001",f.packet.records[2].obligation_id)).toBe(false);
  const before=f.state.store.exportSnapshot();expect(()=>approveAndSealPae(f.state.store,"NEVER-A-SIGNER",{organizationId:"ORG-DEMO-001",obligationId:f.packet.records[2].obligation_id,expectedVersion:1,reviewedAssessmentId:"NO_ASSESSMENT",reviewedAssessmentHash:"0".repeat(64),actorId:"NO_ACTOR",actorRole:"NO_ROLE",policyVersion:"NO_POLICY",reasonText:"private view cannot approve"})).toThrow(/source is withdrawn/);expect(f.state.store.exportSnapshot()).toEqual(before);
 });
 it("denies before private source/state reads and does not disclose IDs",async()=>{const f=privateFixture(),source=vi.fn(()=>loadOperatorSourceRecords()!);const readers=createObligationReaders(async()=>{throw new AccessError("SESSION_REQUIRED",401);},f.load,source);const response=await readers.list(new Request("https://operator.example.invalid"));expect(response.status).toBe(401);expect(source).not.toHaveBeenCalled();expect(f.load).not.toHaveBeenCalled();expect(JSON.stringify(await response.json())).not.toContain(f.packet.records[0].obligation_id);});
 it("requires both approved expected hash and actual artifact; absent pair preserves withdrawal",()=>{const f=privateFixture();vi.stubEnv("TAMEION_OPERATOR_SOURCE_SHA256",undefined);expect(()=>loadOperatorSourceRecords()).toThrow(/UNAVAILABLE/);rmSync(f.path);expect(loadOperatorSourceRecords()).toBeUndefined();vi.stubEnv("TAMEION_OPERATOR_SOURCE_SHA256",f.hash);expect(()=>loadOperatorSourceRecords()).toThrow(/UNAVAILABLE/);});
 it("rejects malformed/duplicate/unknown/wrong-count/identity/hash/UTF8/size input",()=>{
  const f=privateFixture();const examples:Buffer[]=[Buffer.from('{"purpose":"X","purpose":"OPERATOR_VIEW_ONLY"}'),Buffer.from("null"),Buffer.from("not json"),Buffer.from(JSON.stringify({...f.packet,extra:true})),Buffer.from(JSON.stringify({...f.packet,records:f.packet.records.slice(1)})),Buffer.from(JSON.stringify({...f.packet,records:[f.packet.records[0],...f.packet.records.slice(0,4)]})),Buffer.from([0xff]),Buffer.alloc(MAX_OPERATOR_SOURCE_BYTES+1,32)];
  for(const bytes of examples)expect(()=>parseOperatorSource(bytes,createHash("sha256").update(bytes).digest("hex"))).toThrow(/UNAVAILABLE/);expect(()=>parseOperatorSource(f.bytes,"0".repeat(64))).toThrow(/UNAVAILABLE/);
 });
 it("rejects symlink/non-file artifacts without public fallback",()=>{const f=privateFixture();rmSync(f.path);symlinkSync(join(directory!,"missing"),f.path);expect(()=>loadOperatorSourceRecords()).toThrow(/UNAVAILABLE/);rmSync(f.path);mkdirSync(f.path);expect(()=>loadOperatorSourceRecords()).toThrow(/UNAVAILABLE/);});
 it("rejects source swap/withdrawal across the existing-state await",async()=>{const f=privateFixture();f.rpc.call.mockImplementationOnce(async()=>{rmSync(f.path);return {revision:1,snapshot:f.snapshot};});const response=await f.readers.list(new Request("https://operator.example.invalid"));expect(response.status).toBe(503);expect(JSON.stringify(await response.json())).not.toContain(f.packet.records[0].obligation_id);});
 it("refuses namespace/revision/provenance/amount/currency mismatch without seed/hydration",async()=>{
  const f=privateFixture();for(const binding of [{...f.packet.state_binding,namespace:"OTHER"},{...f.packet.state_binding,revision:2},{...f.packet.state_binding,authority_sha256:"0".repeat(64)}])await expect(loadExistingDemoState(f.rpc,"VIEW-NAMESPACE",f.packet.records,binding)).rejects.toMatchObject({code:"STATE_UNAVAILABLE"});
  for(const field of ["amount","currency"] as const){const records=structuredClone(f.packet.records);records[0][field]=field==="amount"?"999.00":"USD";await expect(loadExistingDemoState(f.rpc,"VIEW-NAMESPACE",records,f.packet.state_binding)).rejects.toMatchObject({code:"STATE_UNAVAILABLE"});}
  expect(f.rpc.call.mock.calls.every(call=>call[0]==="tameion_state_load_existing")).toBe(true);
 });
});

import { execFileSync } from "node:child_process";
const productRoot=join(import.meta.dirname,"..");
describe("owner-approved source packaging uses the canonical production parser",()=>{
 it("materializes exact independently hashed secret bytes during a clean hosted build",()=>{
  const f=privateFixture();rmSync(f.path);
  const script=join(productRoot,"scripts/materialize-operator-source-env.mjs");
  const run=(env:Record<string,string|undefined>)=>execFileSync(process.execPath,[script],{cwd:directory,env:{...process.env,...env},encoding:"utf8",stdio:["ignore","pipe","pipe"]});
  expect(JSON.parse(run({TAMEION_OPERATOR_SOURCE_DOCUMENT:f.bytes.toString("utf8"),TAMEION_OPERATOR_SOURCE_SHA256:f.hash}))).toMatchObject({record_count:5,purpose:"OPERATOR_VIEW_ONLY",provisioning:"HOSTED_BUILD_BYTES_ONLY"});
  expect(readFileSync(f.path)).toEqual(f.bytes);expect(statSync(f.path).mode&0o777).toBe(0o600);
  expect(()=>run({TAMEION_OPERATOR_SOURCE_DOCUMENT:f.bytes.toString("utf8"),TAMEION_OPERATOR_SOURCE_SHA256:f.hash})).toThrow();
  rmSync(f.path);expect(()=>run({TAMEION_OPERATOR_SOURCE_DOCUMENT:f.bytes.toString("utf8"),TAMEION_OPERATOR_SOURCE_SHA256:undefined})).toThrow();
 });
 it("packages approved bytes exclusively and proves server trace/client exclusion",()=>{
  const f=privateFixture();const approved=join(directory!,"approved-source.json");writeFileSync(approved,f.bytes);rmSync(f.path);
  const args=["--approved-source",approved,"--sha256",f.hash];const invoke=(name:string)=>JSON.parse(execFileSync(process.execPath,[join(productRoot,"scripts",name),...args],{cwd:directory,encoding:"utf8",stdio:["ignore","pipe","pipe"]}));
  expect(invoke("package-operator-source.mjs")).toMatchObject({record_count:5,purpose:"OPERATOR_VIEW_ONLY",financial_eligibility:"UNCHANGED_NOT_GRANTED"});expect(()=>invoke("package-operator-source.mjs")).toThrow();
  mkdirSync(join(directory!,".next/server/app/api/operator/session"),{recursive:true});mkdirSync(join(directory!,".next/static"));writeFileSync(join(directory!,".next/server/app-paths-manifest.json"),JSON.stringify({"/api/operator/session/route":"app/api/operator/session/route.js"}));writeFileSync(join(directory!,".next/server/app/api/operator/session/route.js.nft.json"),JSON.stringify({files:["../../../../../../.tameion/operator-source.json"]}));const client=join(directory!,".next/static/client.js");writeFileSync(client,"/* public empty */");
  expect(invoke("verify-operator-source.mjs")).toMatchObject({proof:"LOCAL_NEXT_SOURCE_PRIVACY_ONLY_NOT_HOSTED",client_public_files_inspected:1});writeFileSync(client,f.packet.records[0].obligation_id);expect(()=>invoke("verify-operator-source.mjs")).toThrow();
 });
});
