import { describe,expect,it,vi } from "vitest";
import { createOperatorHandlers, csrfForBearer } from "../src/server/operator-auth";
import { parseOperatorPolicy, digest } from "../src/server/route-access-policy";
import type { OperatorAuthRepository } from "../src/server/operator-auth-repository";
const origin="https://operator.example.invalid";
const policy=parseOperatorPolicy({TAMEION_ALLOWED_ORIGINS:JSON.stringify([origin]),TAMEION_INGRESS_MODE:"vercel-direct-v1",TAMEION_INGRESS_RECORD:JSON.stringify({approval_id:"MOCK",project_id:"P",deployment_id:"D",environment:"preview",direct_edge:true,trusted_proxy_override:false,origins:[origin]}),TAMEION_THROTTLE_HMAC_KEY:"a".repeat(64),VERCEL:"1",VERCEL_ENV:"preview",VERCEL_PROJECT_ID:"P",VERCEL_DEPLOYMENT_ID:"D"});
const token=Buffer.alloc(32,4).toString('base64url');
const verifier={algorithm:"scrypt-v1",salt_hex:"a".repeat(32),verifier_hex:"b".repeat(128),work_n:131072,work_r:8,work_p:1,maxmem:167772160,credential_version:1};
function repo(){const expires=new Date(Date.now()+3600000).toISOString();return {issueChallenge:vi.fn(async(_input:Record<string,unknown>)=>({accepted:true,expires_at:new Date(Date.now()+300000).toISOString()})),reserveLogin:vi.fn(async(_input:Record<string,unknown>)=>({admitted:true,verifier})),finishLogin:vi.fn(async(_input:Record<string,unknown>)=>({accepted:true,expires_at:expires})),validateSession:vi.fn(async(_input:Record<string,unknown>)=>({valid:true,operator_key:"MOCK-OPERATOR",credential_version:1,expires_at:expires,csrf_digest:digest(Buffer.from(csrfForBearer(token),'base64url'))})),revokeSession:vi.fn(async(_input:Record<string,unknown>)=>({revoked:true})),admitRefresh:vi.fn(async(_input:Record<string,unknown>)=>({accepted:true}))} satisfies OperatorAuthRepository;}
function request(path:string,body:unknown={},extra:Record<string,string>={},method="POST") {return new Request(origin+path,{method,headers:{host:"operator.example.invalid","x-forwarded-host":"operator.example.invalid","x-forwarded-proto":"https",origin,"sec-fetch-site":"same-origin","sec-fetch-dest":"empty","x-vercel-forwarded-for":"192.0.2.1","content-type":"application/json",...extra},...(method==='POST'?{body:JSON.stringify(body)}:{})});}
function harness(){const r=repo(),factory=vi.fn(()=>r),verify=vi.fn(async()=>true),balance=vi.fn(async()=>({amount:"12.345678",asset:"USDC",captured_at:new Date().toISOString()}));const handlers=createOperatorHandlers({policy:()=>policy,repository:factory,operatorKey:()=>"MOCK-OPERATOR",verifyPassword:verify,balance});return {r,factory,verify,balance,...handlers};}
describe("#65 auth before effect",()=>{
 it("denies unverified origin before repository construction",async()=>{
  const h=harness();const response=await h.csrf(request('/api/operator/csrf',{}, {'x-tameion-csrf-bootstrap':'1',origin:'https://evil.invalid'}));
  expect(response.status).toBe(403);expect(h.factory).not.toHaveBeenCalled();
 });
 it("issues only a CSRF token after durable budget, with secure host-only nonce cookie",async()=>{
  const h=harness();const response=await h.csrf(request('/api/operator/csrf',{}, {'x-tameion-csrf-bootstrap':'1'}));
  expect(response.status).toBe(200);const data=await response.json();expect(Object.keys(data).sort()).toEqual(['csrf_token','expires_at']);
  expect(response.headers.get('set-cookie')).toMatch(/__Host-tameion-prelogin=.*HttpOnly; Secure; SameSite=Lax/);
  expect(response.headers.get('set-cookie')).not.toContain('Domain=');expect(response.headers.get('cache-control')).toContain('no-store');
  const call=h.r.issueChallenge.mock.calls[0][0];expect(call.binding_digest).toMatch(/^[0-9a-f]{64}$/);expect(JSON.stringify(call)).not.toContain('192.0.2.1');
 });
 it("does not issue a token/cookie on budget or store failure",async()=>{
  const h=harness();h.r.issueChallenge.mockResolvedValueOnce({accepted:false,retry_after:60} as never);
  const response=await h.csrf(request('/api/operator/csrf',{}, {'x-tameion-csrf-bootstrap':'1'}));expect(response.status).toBe(429);expect((await response.json()).csrf_token).toBeUndefined();
  h.r.issueChallenge.mockRejectedValueOnce(new Error('sensitive backend body'));const failed=await h.csrf(request('/api/operator/csrf',{}, {'x-tameion-csrf-bootstrap':'1'}));expect(failed.status).toBe(503);expect(await failed.text()).not.toContain('sensitive');
 });
 it("requires bound nonce/token before password ticket, never accepts caller session fixation",async()=>{
  const h=harness();const denied=await h.login(request('/api/operator/login',{username:'MOCK-OPERATOR',password:'invented'}));expect(denied.status).toBe(403);expect(h.factory).not.toHaveBeenCalled();expect(h.verify).not.toHaveBeenCalled();
  const accepted=await h.login(request('/api/operator/login',{username:'MOCK-OPERATOR',password:'invented'},{cookie:`__Host-tameion-prelogin=${token}; __Host-tameion-session=${token}`,'x-tameion-csrf':token}));
  expect(accepted.status).toBe(200);expect(h.r.reserveLogin).toHaveBeenCalledOnce();expect(h.verify).toHaveBeenCalledOnce();expect(h.r.finishLogin.mock.calls[0][0].expected_credential_version).toBe(verifier.credential_version);
  const data=await accepted.json();expect(data.authenticated).toBe(true);expect(data.session_token).toBeUndefined();
  expect(accepted.headers.get('set-cookie')).not.toContain(`__Host-tameion-session=${token};`);
  expect(accepted.headers.get('set-cookie')).toContain('__Host-tameion-prelogin=;');
 });
 it("does not verify password when challenge is replayed or budget denied",async()=>{
  const h=harness();h.r.reserveLogin.mockResolvedValueOnce({admitted:false,retry_after:900} as never);
  const response=await h.login(request('/api/operator/login',{username:'MOCK-OPERATOR',password:'invented'},{cookie:`__Host-tameion-prelogin=${token}`,'x-tameion-csrf':token}));expect(response.status).toBe(429);expect(h.verify).not.toHaveBeenCalled();expect(h.r.finishLogin).not.toHaveBeenCalled();
 });
 it("unknown username cannot authorize even if password verifier injection returns true",async()=>{
  const h=harness();h.r.finishLogin.mockResolvedValueOnce({accepted:false} as never);
  const response=await h.login(request('/api/operator/login',{username:'UNKNOWN',password:'invented'},{cookie:`__Host-tameion-prelogin=${token}`,'x-tameion-csrf':token}));expect(response.status).toBe(401);
  expect(h.r.reserveLogin.mock.calls[0][0].operator_key).toBe('MOCK-OPERATOR');expect(h.r.finishLogin.mock.calls[0][0].verified).toBe(false);
 });
 it.each([false,null,undefined])('a mocked login-finish denial/missing acceptance %s never issues a session',async accepted=>{const h=harness();h.r.finishLogin.mockResolvedValueOnce({accepted} as never);const response=await h.login(request('/api/operator/login',{username:'MOCK-OPERATOR',password:'INVENTED-UNIT-ONLY'},{cookie:`__Host-tameion-prelogin=${token}`,'x-tameion-csrf':token}));expect(response.status).toBe(401);expect((await response.json()).code).toBe('LOGIN_REJECTED');expect(response.headers.get('set-cookie')).not.toContain('__Host-tameion-session=');expect(h.r.finishLogin.mock.calls[0][0].expected_credential_version).toBe(1);expect(h.r.finishLogin).toHaveBeenCalledOnce();expect(h.balance).not.toHaveBeenCalled();});
 it("rejects expired/revoked/version-stale durable session before refresh budget/provider",async()=>{
  const h=harness();h.r.validateSession.mockResolvedValueOnce({valid:false} as never);
  const response=await h.refresh(request('/api/wallet/balance/refresh',{}, {cookie:`__Host-tameion-session=${token}`,'x-tameion-csrf':csrfForBearer(token)}));expect(response.status).toBe(401);expect(h.r.admitRefresh).not.toHaveBeenCalled();expect(h.balance).not.toHaveBeenCalled();
 });
 it("requires CSRF and atomic durable refresh budget before balance capability",async()=>{
  const h=harness();const headers={cookie:`__Host-tameion-session=${token}`,'x-tameion-csrf':csrfForBearer(token)};
  const wrong=await h.refresh(request('/api/wallet/balance/refresh',{}, {...headers,'x-tameion-csrf':token}));expect(wrong.status).toBe(403);expect(h.r.admitRefresh).not.toHaveBeenCalled();
  h.r.admitRefresh.mockResolvedValueOnce({accepted:false,retry_after:5} as never);expect((await h.refresh(request('/api/wallet/balance/refresh',{},headers))).status).toBe(429);expect(h.balance).not.toHaveBeenCalled();
  expect((await h.refresh(request('/api/wallet/balance/refresh',{},headers))).status).toBe(200);expect(h.balance).toHaveBeenCalledOnce();
 });
 it("durable revocation failure clears local cookie and says logout unverified",async()=>{
  const h=harness();h.r.revokeSession.mockRejectedValueOnce(new Error('store unavailable'));
  const response=await h.logout(request('/api/operator/logout',{}, {cookie:`__Host-tameion-session=${token}`,'x-tameion-csrf':csrfForBearer(token)}));expect(response.status).toBe(503);expect((await response.json()).code).toBe('LOGOUT_UNVERIFIED');expect(response.headers.get('set-cookie')).toContain('__Host-tameion-session=;');
 });
 it("session GET is pure validation with reproducible CSRF and no expiry refresh",async()=>{
  const h=harness();const response=await h.session(request('/api/operator/session',{}, {cookie:`__Host-tameion-session=${token}`},'GET'));expect(response.status).toBe(200);expect((await response.json()).csrf_token).toBe(csrfForBearer(token));expect(response.headers.get('set-cookie')).toBeNull();expect(h.r.issueChallenge).not.toHaveBeenCalled();expect(h.r.admitRefresh).not.toHaveBeenCalled();
 });
});
