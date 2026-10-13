import {createHash} from "node:crypto";
import {mkdtempSync,mkdirSync,readFileSync,rmSync,statSync,writeFileSync} from "node:fs";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {afterEach,describe,expect,it,vi} from "vitest";
import {DemoState} from "../src/server/demo-state";
import {createObligationReaders} from "../src/server/operator-obligation-routes";
import {loadFinancialRequesterBinding,loadFinancialSourceAdmission,loadOptionalFinancialSourceAdmission} from "../src/server/financial-source-admission";
import {AccessError} from "../src/server/route-access-policy";
import type {AuthContext} from "../src/server/operator-auth";
import {syntheticSourceRecords} from "./test-support/synthetic-source-records";

const now=Date.parse("2026-10-13T19:30:00.000Z");
const gitSha="d".repeat(40),origin="https://uat.example.invalid",projectId="prj_SYNTHETIC";
let root:string|undefined;
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();vi.useRealTimers();if(root)rmSync(root,{recursive:true,force:true});root=undefined;});

function controlledRecord(){return {obligation_id:"TESTNET-CONTROLLED-UAT-20261013-001",service_category:"Controlled Arc Testnet settlement validation",recurrence:"ONE_TIME" as const,issue_date:null,due_date:null,due_date_status:"NOT_STATED_ON_SOURCE" as const,effective_due_date:null,effective_due_date_basis:null,effective_due_date_provenance:null,amount:"1.00",currency:"USD",state_at_event_baseline:"OUTSTANDING" as const,business_purpose_confirmed:false,commercial_terms:"TESTNET_ONLY NON_ECONOMIC NOT_VENDOR_PAYMENT",source_evidence:[{evidence_id:"PRIME-CONTROLLED-TESTNET-20261013-001",content_sha256:"a".repeat(64)}],candidate_readiness:{arc_product_destination_status:"NOT_VERIFIED"}};}
function fixture(){
 root=mkdtempSync(join(tmpdir(),"controlled-read-"));mkdirSync(join(root,".tameion"));vi.spyOn(process,"cwd").mockReturnValue(root);vi.useFakeTimers();vi.setSystemTime(now);
 const ingress={approval_id:"INGRESS-APPROVAL",binding:"git-sha-preview-v1",project_id:projectId,git_commit_sha:gitSha,environment:"preview",direct_edge:true,trusted_proxy_override:false,origins:[origin]};
 const ingressBytes=JSON.stringify(ingress),record=controlledRecord(),recordHash=createHash("sha256").update(JSON.stringify(record)).digest("hex");
 const binding={binding:"git-sha-preview-v1",git_commit_sha:gitSha,project_id:projectId,environment:"preview",origin,ingress_approval_id:ingress.approval_id,ingress_record_sha256:createHash("sha256").update(ingressBytes).digest("hex"),source_record_sha256:recordHash};
 const source={purpose:"TESTNET_FINANCIAL_SOURCE",approval_id:"SOURCE-APPROVAL",organization_id:"ORG-DEMO-001",...binding,namespace:"CONTROLLED-NAMESPACE",valid_from:"2026-10-13T19:00:00.000Z",expires_at:"2026-10-13T20:00:00.000Z",intent_id:"CONTROLLED-INTENT",classification:"TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT",principal:"1.000000",estimated_fee_ceiling:"0.002000",estimated_total_ceiling:"1.002000",source:record};
 const sourceBytes=JSON.stringify(source),sourceHash=createHash("sha256").update(sourceBytes).digest("hex");
 const requester={purpose:"FINANCIAL_REQUESTER_ACTOR_BINDING",approval_id:"REQUESTER-APPROVAL",organization_id:"ORG-DEMO-001",...binding,namespace:source.namespace,valid_from:source.valid_from,expires_at:source.expires_at,operator_key:"OPERATOR",credential_version:1,actor_id:"ACTOR",source_sha256:sourceHash,intent_id:source.intent_id};
 const requesterBytes=JSON.stringify(requester),requesterHash=createHash("sha256").update(requesterBytes).digest("hex");
 writeFileSync(join(root,".tameion/financial-source.json"),sourceBytes);writeFileSync(join(root,".tameion/financial-requester.json"),requesterBytes);
 const env={TAMEION_FINANCIAL_SOURCE_SHA256:sourceHash,TAMEION_FINANCIAL_REQUESTER_SHA256:requesterHash,TAMEION_INGRESS_RECORD:ingressBytes,VERCEL:"1",VERCEL_ENV:"preview",VERCEL_PROJECT_ID:projectId,VERCEL_GIT_COMMIT_SHA:gitSha,TAMEION_ALLOWED_ORIGINS:JSON.stringify([origin])};
 for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);
 return {source,requester,sourceBytes,requesterBytes,sourceHash,requesterHash,ingress,env,record};
}

describe("controlled obligation read isolation",()=>{
 it("combines five view-only obligations with exactly one controlled obligation and routes detail by namespace",async()=>{
  const f=fixture(),historical=syntheticSourceRecords(),historicalState=new DemoState(undefined,undefined,undefined,undefined,{},historical),controlledState=new DemoState(undefined,undefined,undefined,undefined,{},[f.record]);
  const load=vi.fn(async(records:readonly {obligation_id:string}[],_binding?:unknown,namespace?:string)=>namespace===f.source.namespace?controlledState:historicalState);
  const readers=createObligationReaders(async()=>({revalidate:async()=>{}} as AuthContext),load as never,()=>historical,()=>loadFinancialSourceAdmission());
  const list=await readers.list(new Request("https://operator.example.invalid")),body=await list.json();
  expect(body.total_count).toBe(6);expect(body.obligations.map((item:{obligation_id:string})=>item.obligation_id)).toEqual([...historical.map(item=>item.obligation_id),f.record.obligation_id]);
  const controlled=await readers.detail(new Request("https://operator.example.invalid"),f.record.obligation_id);expect(await controlled.json()).toMatchObject({financial_action_eligible:true});
  const old=await readers.detail(new Request("https://operator.example.invalid"),historical[0].obligation_id);expect(await old.json()).toMatchObject({financial_action_eligible:false});
  expect(load.mock.calls.some(call=>call[2]===f.source.namespace&&call[0].length===1)).toBe(true);
  expect(load.mock.calls.some(call=>call[2]===f.source.namespace&&call[0].some((item:{obligation_id:string})=>item.obligation_id===historical[0].obligation_id))).toBe(false);
  expect(historicalState.exportSnapshot()).toEqual(new DemoState(undefined,undefined,undefined,undefined,{},historical).exportSnapshot());expect(controlledState.exportSnapshot()).toEqual(new DemoState(undefined,undefined,undefined,undefined,{},[f.record]).exportSnapshot());
 });
 it("denies unauthenticated requests before either source or state is read",async()=>{const operator=vi.fn(),controlled=vi.fn(),load=vi.fn();const readers=createObligationReaders(async()=>{throw new AccessError("SESSION_REQUIRED",401);},load,operator,controlled);expect((await readers.list(new Request("https://operator.example.invalid"))).status).toBe(401);expect(operator).not.toHaveBeenCalled();expect(controlled).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled();});
});

describe("git-sha Preview financial authority binding",()=>{
 it("accepts matching canonical source/requester bytes and exact ingress identity",()=>{const f=fixture();expect(loadFinancialSourceAdmission()).toMatchObject({source:{obligation_id:f.record.obligation_id},binding:"git-sha-preview-v1"});expect(loadFinancialRequesterBinding()).toMatchObject({source_sha256:f.sourceHash,binding:"git-sha-preview-v1"});});
 it.each([
  {VERCEL_GIT_COMMIT_SHA:"e".repeat(40)},
  {VERCEL_PROJECT_ID:"OTHER"},
  {VERCEL_ENV:"production"},
  {TAMEION_ALLOWED_ORIGINS:'["https://other.example.invalid"]'},
  {TAMEION_INGRESS_RECORD:JSON.stringify({approval_id:"OTHER"})},
 ])("rejects stale or swapped runtime binding before state/provider work: %o",override=>{fixture();for(const [key,value] of Object.entries(override))vi.stubEnv(key,value);expect(()=>loadFinancialSourceAdmission()).toThrow(/UNAVAILABLE/);expect(()=>loadFinancialRequesterBinding()).toThrow(/UNAVAILABLE/);});
 it("rejects swapped source/requester packet binding",()=>{const f=fixture();const requester={...f.requester,git_commit_sha:"e".repeat(40)};const bytes=JSON.stringify(requester);writeFileSync(join(root!,".tameion/financial-requester.json"),bytes);vi.stubEnv("TAMEION_FINANCIAL_REQUESTER_SHA256",createHash("sha256").update(bytes).digest("hex"));expect(()=>loadFinancialRequesterBinding()).toThrow(/UNAVAILABLE/);});
 it("treats partial financial authority as invalid instead of silently hiding it",()=>{fixture();rmSync(join(root!,".tameion/financial-requester.json"));expect(()=>loadOptionalFinancialSourceAdmission()).toThrow(/UNAVAILABLE/);});
});

describe("server-only financial authority build input",()=>{
 it("materializes exact hash-verified source and requester bytes with private permissions",()=>{
  const f=fixture();rmSync(join(root!,".tameion"),{recursive:true});
  const output=execFileSync(process.execPath,[join(import.meta.dirname,"../scripts/materialize-operator-source-env.mjs")],{cwd:root,env:{...process.env,...f.env,TAMEION_FINANCIAL_SOURCE_DOCUMENT:f.sourceBytes,TAMEION_FINANCIAL_REQUESTER_DOCUMENT:f.requesterBytes},encoding:"utf8"});
  expect(JSON.parse(output)).toMatchObject({financial_source:{purpose:"TESTNET_FINANCIAL_SOURCE"},financial_requester:{purpose:"FINANCIAL_REQUESTER_ACTOR_BINDING"}});
  for(const [name,bytes] of [["financial-source.json",f.sourceBytes],["financial-requester.json",f.requesterBytes]] as const){const path=join(root!,".tameion",name);expect(readFileSync(path,"utf8")).toBe(bytes);expect(statSync(path).mode&0o777).toBe(0o600);}
 });
 it("proves server trace inclusion and rejects client disclosure",()=>{
  const f=fixture(),route="app/api/obligations/[id]/approve/route.js",trace=join(root!,".next/server",route+".nft.json");
  mkdirSync(join(root!,".next/server/app/api/obligations/[id]/approve"),{recursive:true});mkdirSync(join(root!,".next/static"),{recursive:true});
  writeFileSync(join(root!,".next/server/app-paths-manifest.json"),JSON.stringify({"/api/obligations/[id]/approve/route":route}));writeFileSync(trace,JSON.stringify({files:["../../../../../../../.tameion/financial-source.json","../../../../../../../.tameion/financial-requester.json"]}));writeFileSync(join(root!,".next/static/client.js"),"/* public */");
  const args=["--approved-source",join(root!,".tameion/financial-source.json"),"--source-sha256",f.sourceHash,"--approved-requester",join(root!,".tameion/financial-requester.json"),"--requester-sha256",f.requesterHash];
  const run=()=>execFileSync(process.execPath,[join(import.meta.dirname,"../scripts/verify-financial-authority.mjs"),...args],{cwd:root,env:{...process.env,...f.env},encoding:"utf8",stdio:["ignore","pipe","pipe"]});
  expect(JSON.parse(run())).toMatchObject({proof:"LOCAL_NEXT_FINANCIAL_AUTHORITY_PRIVACY_ONLY_NOT_HOSTED",source_sha256:f.sourceHash,requester_sha256:f.requesterHash});writeFileSync(join(root!,".next/static/client.js"),f.record.obligation_id);expect(run).toThrow();
 });
});
