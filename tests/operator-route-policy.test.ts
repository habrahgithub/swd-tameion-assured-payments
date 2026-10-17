import { describe, expect, it } from "vitest";
import { parseOperatorPolicy, resolveRequestIdentity, readBoundedJson } from "../src/server/route-access-policy";
import {computeProductionConfigurationSha256,PRODUCTION_CONFIGURATION_INPUT_NAMES} from "../src/server/production-config-identity";
const env={TAMEION_ALLOWED_ORIGINS:'["https://operator.example.invalid"]',TAMEION_INGRESS_MODE:"vercel-direct-v1",TAMEION_INGRESS_RECORD:JSON.stringify({approval_id:"MOCK-APPROVAL",project_id:"MOCK-PROJECT",deployment_id:"MOCK-DEPLOYMENT",environment:"preview",direct_edge:true,trusted_proxy_override:false,origins:["https://operator.example.invalid"]}),TAMEION_THROTTLE_HMAC_KEY:"a".repeat(64),VERCEL:"1",VERCEL_ENV:"preview",VERCEL_PROJECT_ID:"MOCK-PROJECT",VERCEL_DEPLOYMENT_ID:"MOCK-DEPLOYMENT"};
function request(overrides:Record<string,string>={},method="POST") {return new Request("https://operator.example.invalid/api/operator/csrf",{method,headers:{host:"operator.example.invalid","x-forwarded-host":"operator.example.invalid","x-forwarded-proto":"https",origin:"https://operator.example.invalid","sec-fetch-site":"same-origin","sec-fetch-dest":"empty","x-vercel-forwarded-for":"192.0.2.1",...overrides},...(method==="POST"?{body:"{}"}:{})});}
describe("#65 direct ingress before reservation",()=>{
 it("requires complete verified topology/configuration; never derives origin from request",()=>{
  expect(()=>parseOperatorPolicy({})).toThrow(/UNAVAILABLE/);
  for(const key of Object.keys(env)) {const broken={...env};delete broken[key as keyof typeof broken];expect(()=>parseOperatorPolicy(broken)).toThrow();}
  for(const origin of ['[]','["http://localhost:3190"]','["https://*.example.invalid"]','["https://operator.example.invalid/"]','["https://user:password@example.invalid"]'])expect(()=>parseOperatorPolicy({...env,TAMEION_ALLOWED_ORIGINS:origin})).toThrow();
  expect(()=>parseOperatorPolicy({...env,VERCEL_DEPLOYMENT_ID:"OTHER"})).toThrow();
 });
 it("produces only a domain-separated digest from one verified canonical IP",()=>{
  const p=parseOperatorPolicy(env);const identity=resolveRequestIdentity(request(),p,true);
  expect(identity.networkDigest).toMatch(/^[0-9a-f]{64}$/);expect(JSON.stringify(identity)).not.toContain("192.0.2.1");
  const equivalent=resolveRequestIdentity(request({"x-vercel-forwarded-for":"::ffff:192.0.2.1"}),p,true);expect(equivalent.networkDigest).toBe(identity.networkDigest);
 });
 it("rejects forged/multiple IPs, origin swaps and missing Fetch Metadata",()=>{
  const p=parseOperatorPolicy(env);
  for(const [key,value] of [["origin","null"],["origin","https://evil.invalid"],["origin","https://operator.example.invalid, https://evil.invalid"],["host","evil.invalid"],["x-forwarded-host","evil.invalid"],["x-forwarded-proto","http"],["sec-fetch-site","cross-site"],["sec-fetch-dest","document"],["x-vercel-forwarded-for","192.0.2.1,192.0.2.2"],["x-vercel-forwarded-for","192.0.2.1:443"],["x-vercel-forwarded-for","fe80::1%eth0"],["x-vercel-forwarded-for",""]])expect(()=>resolveRequestIdentity(request({[key]:value}),p,true)).toThrow();
  expect(()=>resolveRequestIdentity(request({"x-vercel-forwarded-for":"","x-forwarded-for":"192.0.2.1"}),p,true)).toThrow();
 });
 it("uses the verified Vercel host when the framework request URL carries the immutable deployment host",()=>{
  const p=parseOperatorPolicy(env);
  const hosted=new Request("https://generated-deployment.example.invalid/api/operator/session",{headers:{host:"operator.example.invalid",forwarded:'for=192.0.2.1;host=operator.example.invalid;proto=https',"x-forwarded-host":"operator.example.invalid","x-forwarded-proto":"https","sec-fetch-site":"same-origin","sec-fetch-dest":"empty","x-vercel-forwarded-for":"192.0.2.1"}});
  expect(resolveRequestIdentity(hosted,p,false).origin).toBe("https://operator.example.invalid");
 });
 it("does not treat environment mode alone as ingress approval",()=>{
  const record=JSON.parse(env.TAMEION_INGRESS_RECORD);record.trusted_proxy_override=true;
  expect(()=>parseOperatorPolicy({...env,TAMEION_INGRESS_RECORD:JSON.stringify(record)})).toThrow();
 });
 it("bounds actual streamed bytes and rejects nonobjects or trailing fields",async()=>{
  await expect(readBoundedJson(new Request("https://operator.example.invalid",{method:"POST",body:'{"x":"'+'a'.repeat(130)+'"}'}),128)).rejects.toThrow(/BODY/);
  await expect(readBoundedJson(new Request("https://operator.example.invalid",{method:"POST",body:'[]'}),128)).rejects.toThrow(/BODY/);
 });
});

describe("Production configuration identity framing",()=>{
 const known=()=>({
  SUPABASE_SERVICE_ROLE_KEY:"service-role-α",
  SUPABASE_URL:"https://db.example.invalid",
  TAMEION_ALLOWED_ORIGINS:'["https://tameion.example.invalid"]',
  TAMEION_INGRESS_MODE:"vercel-direct-v1",
  TAMEION_OPERATOR_KEY:"operator",
  TAMEION_OPERATOR_SOURCE_DOCUMENT:'{"label":"café"}',
  TAMEION_OPERATOR_SOURCE_SHA256:"a".repeat(64),
  TAMEION_THROTTLE_HMAC_KEY:"b".repeat(64),
 });
 const independentFramedSize=(values:Record<string,string>)=>Buffer.byteLength("tameion-production-config-v1\0","ascii")+PRODUCTION_CONFIGURATION_INPUT_NAMES.reduce((total,name)=>total+2+Buffer.byteLength(name,"utf8")+8+Buffer.byteLength(values[name],"utf8"),0);

 it("matches the independent multibyte known-answer vector and every input affects the aggregate",()=>{
  const values=known();expect(independentFramedSize(values)).toBe(541);
  const expected="befb6f231e9fa7c808838feaaf7af88f0d3ce86aa22a08166374dad521957455";
  expect(computeProductionConfigurationSha256(values)).toBe(expected);
  for(const name of PRODUCTION_CONFIGURATION_INPUT_NAMES)expect(computeProductionConfigurationSha256({...values,[name]:values[name]+"x"})).not.toBe(expected);
 });

 it("uses UTF-8 bytes, accepts valid scalar pairs and rejects unpaired surrogates",()=>{
  const values=known();expect(Buffer.byteLength(values.SUPABASE_SERVICE_ROLE_KEY,"utf8")).toBeGreaterThan(values.SUPABASE_SERVICE_ROLE_KEY.length);
  expect(computeProductionConfigurationSha256({...values,TAMEION_OPERATOR_KEY:"user-😀"})).toMatch(/^[a-f0-9]{64}$/);
  for(const invalid of ["\ud800","\udc00","x\ud800y","x\udc00y"])expect(()=>computeProductionConfigurationSha256({...values,TAMEION_OPERATOR_KEY:invalid})).toThrow("PRODUCTION_CONFIGURATION_UNAVAILABLE");
 });

 it("accepts exactly 262144 framed bytes and rejects 262145",()=>{
  const values=known(),current=independentFramedSize(values),currentDocument=Buffer.byteLength(values.TAMEION_OPERATOR_SOURCE_DOCUMENT,"utf8");
  const exact={...values,TAMEION_OPERATOR_SOURCE_DOCUMENT:"x".repeat(262144-(current-currentDocument))};
  expect(independentFramedSize(exact)).toBe(262144);expect(computeProductionConfigurationSha256(exact)).toMatch(/^[a-f0-9]{64}$/);
  expect(()=>computeProductionConfigurationSha256({...exact,TAMEION_OPERATOR_SOURCE_DOCUMENT:exact.TAMEION_OPERATOR_SOURCE_DOCUMENT+"x"})).toThrow("PRODUCTION_CONFIGURATION_UNAVAILABLE");
 });

 it("fails generically for missing or empty inputs without disclosing values",()=>{
  const values=known();for(const name of PRODUCTION_CONFIGURATION_INPUT_NAMES){const missing={...values} as Record<string,string|undefined>;delete missing[name];expect(()=>computeProductionConfigurationSha256(missing)).toThrow("PRODUCTION_CONFIGURATION_UNAVAILABLE");expect(()=>computeProductionConfigurationSha256({...values,[name]:""})).toThrow("PRODUCTION_CONFIGURATION_UNAVAILABLE");}
 });
});
