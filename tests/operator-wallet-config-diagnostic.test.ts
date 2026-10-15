import http from 'node:http';
import https from 'node:https';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import type {OperatorAuthRepository,Session} from '../src/server/operator-auth-repository';

const gates=vi.hoisted(()=>({repository:vi.fn(),provider:vi.fn(()=>{throw new Error('Provider access forbidden');})}));
vi.mock('@circle-fin/developer-controlled-wallets',()=>({initiateDeveloperControlledWalletsClient:gates.provider}));
vi.mock('../src/server/operator-auth',async importOriginal=>{
 const actual=await importOriginal<typeof import('../src/server/operator-auth')>();
 return {...actual,operatorHandlers:actual.createOperatorHandlers({
  policy:()=>parseOperatorPolicy(),repository:gates.repository,operatorKey:()=>{throw new Error('Login forbidden');},
  verifyPassword:async()=>{throw new Error('Login forbidden');},balance:async()=>{throw new Error('Balance forbidden');},
 })};
});
import * as route from '../app/api/operator/diagnostics/wallet-config/route';
import * as wallet from '../src/server/operator-wallet-balance';
import {csrfForBearer} from '../src/server/operator-auth';
import {digest,parseOperatorPolicy} from '../src/server/route-access-policy';

// Invented offline fixtures only: no hosted configuration is consumed here.
const origin='https://operator.example.invalid',branch='codex/ui-ux-corrections-20261014';
const project='prj_SRsrBlbXY4GvrO8LONqbVW0yTFfg',sha='b'.repeat(40);
const bearer=Buffer.alloc(32,7).toString('base64url');
const pin={wallet_id:'SYNTHETIC-W',wallet_set_id:'SYNTHETIC-SET',source_address:'0x'+'1'.repeat(40),network:'ARC-TESTNET',token_id_sha256:'a'.repeat(64),token_address_sha256:null,decimals:18,native:true};
const key='SYNTHETIC_KEY_NOT_A_CREDENTIAL';
let repository:ReturnType<typeof makeRepository>;
const network=vi.fn(():never=>{throw new Error('Network access forbidden');});
let pinCheck:ReturnType<typeof vi.spyOn>;
let logs:ReturnType<typeof vi.spyOn>[];

function makeRepository(){
 const session:Session={valid:true,operator_key:'SYNTHETIC-USER',credential_version:1,expires_at:new Date(Date.now()+60000).toISOString(),csrf_digest:digest(Buffer.from(csrfForBearer(bearer),'base64url'))};
 const forbidden=vi.fn(async()=>{throw new Error('State mutation forbidden');});
 return {validateSession:vi.fn(async()=>({...session})),issueChallenge:forbidden,reserveLogin:forbidden,finishLogin:forbidden,revokeSession:forbidden,admitRefresh:forbidden} satisfies OperatorAuthRepository;
}
function request(body='{}',headers:Record<string,string>={},method='POST'){
 return new Request(origin+'/api/operator/diagnostics/wallet-config',{method,headers:{
  host:'operator.example.invalid','x-forwarded-host':'operator.example.invalid','x-forwarded-proto':'https',origin,
  'sec-fetch-site':'same-origin','sec-fetch-dest':'empty','x-vercel-forwarded-for':'192.0.2.1','content-type':'application/json',
  cookie:`__Host-tameion-session=${bearer}`,'x-tameion-csrf':csrfForBearer(bearer),...headers,
 },...(['GET','HEAD'].includes(method)?{}:{body})});
}
async function denied(response:Response,status:number){
 expect(response.status).toBe(status);
 expect(response.headers.get('cache-control')).toBe('no-store');
 expect(response.headers.get('pragma')).toBe('no-cache');
 const result=await response.json();
 expect(Object.keys(result)).toEqual(['code']);
 expect(JSON.stringify(result)).not.toContain(key);
 expect(JSON.stringify(result)).not.toContain(pin.wallet_id);
 return result;
}

beforeEach(()=>{
 gates.repository.mockReset();gates.provider.mockClear();
 repository=makeRepository();gates.repository.mockReturnValue(repository);
 const env={VERCEL:'1',VERCEL_ENV:'preview',VERCEL_PROJECT_ID:project,VERCEL_GIT_COMMIT_REF:branch,VERCEL_GIT_COMMIT_SHA:sha,
  TAMEION_ALLOWED_ORIGINS:JSON.stringify([origin]),TAMEION_INGRESS_MODE:'vercel-direct-v1',TAMEION_THROTTLE_HMAC_KEY:'c'.repeat(64),
  TAMEION_INGRESS_RECORD:JSON.stringify({approval_id:'SYNTHETIC',binding:'git-sha-preview-v1',project_id:project,git_commit_sha:sha,environment:'preview',direct_edge:true,trusted_proxy_override:false,origins:[origin]}),
  TAMEION_BALANCE_PIN:JSON.stringify(pin),CIRCLE_API_KEY:key};
 for(const [name,value] of Object.entries(env))vi.stubEnv(name,value);
 network.mockClear();
 vi.stubGlobal('fetch',network);
 vi.spyOn(http,'request').mockImplementation(network);vi.spyOn(http,'get').mockImplementation(network);
 vi.spyOn(https,'request').mockImplementation(network);vi.spyOn(https,'get').mockImplementation(network);
 pinCheck=vi.spyOn(wallet,'isBalancePinValid');
 logs=[vi.spyOn(console,'log').mockImplementation(()=>{}),vi.spyOn(console,'warn').mockImplementation(()=>{}),vi.spyOn(console,'error').mockImplementation(()=>{})];
});
afterEach(()=>{
 try{
  expect(gates.provider).not.toHaveBeenCalled();expect(network).not.toHaveBeenCalled();
  expect(repository.issueChallenge).not.toHaveBeenCalled();expect(repository.reserveLogin).not.toHaveBeenCalled();
  expect(repository.finishLogin).not.toHaveBeenCalled();expect(repository.revokeSession).not.toHaveBeenCalled();expect(repository.admitRefresh).not.toHaveBeenCalled();
  for(const log of logs)expect(log).not.toHaveBeenCalled();
 }finally{vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();}
});

describe('temporary authenticated Preview wallet configuration diagnostic',()=>{
 it('returns exactly two local predicates through the real guard, without provider or state mutation',async()=>{
  const response=await route.POST(request());
  expect(response.status).toBe(200);expect(await response.json()).toEqual({pin_valid:true,api_key_present:true});
  expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('pragma')).toBe('no-cache');
  expect(response.headers.get('set-cookie')).toBeNull();expect(repository.validateSession).toHaveBeenCalledTimes(3);
  expect(pinCheck).toHaveBeenCalledOnce();
 });
 it.each([undefined,'','{','null','[]','{}',JSON.stringify({...pin,decimals:6}),JSON.stringify({...pin,extra:key})])('reports invalid pin syntax only (%#)',async raw=>{
  vi.stubEnv('TAMEION_BALANCE_PIN',raw);
  const response=await route.POST(request());expect(response.status).toBe(200);
  expect(await response.json()).toEqual({pin_valid:false,api_key_present:true});
 });
 it.each([undefined,''])('reports missing/empty key without attempting credential verification (%#)',async raw=>{
  vi.stubEnv('CIRCLE_API_KEY',raw);
  const response=await route.POST(request());expect(response.status).toBe(200);
  expect(await response.json()).toEqual({pin_valid:true,api_key_present:false});
 });
 it('treats any nonempty key as present, without inventing a credential-format check',async()=>{
  vi.stubEnv('CIRCLE_API_KEY',' ');
  expect(await (await route.POST(request())).json()).toEqual({pin_valid:true,api_key_present:true});
 });
 it.each([
  ['VERCEL_ENV','production'],['VERCEL_ENV','development'],['VERCEL_ENV',undefined],
  ['VERCEL_PROJECT_ID','OTHER-PROJECT'],['VERCEL_PROJECT_ID',undefined],
  ['VERCEL_GIT_COMMIT_REF','main'],['VERCEL_GIT_COMMIT_REF',undefined],
 ])('hard-denies wrong or missing Preview identity %s (%#)',async(name,value)=>{
  vi.stubEnv(name,value);await denied(await route.POST(request()),403);
  expect(gates.repository).not.toHaveBeenCalled();expect(pinCheck).not.toHaveBeenCalled();
 });
 it.each([['VERCEL','0'],['VERCEL_GIT_COMMIT_SHA','a'.repeat(40)],['TAMEION_INGRESS_RECORD','{}']])('preserves existing deployment ingress policy for %s',async(name,value)=>{
  vi.stubEnv(name,value);await denied(await route.POST(request()),503);expect(pinCheck).not.toHaveBeenCalled();
 });
 it.each(['GET','HEAD','PUT','PATCH','DELETE','OPTIONS'] as const)('denies %s without authorization or config evaluation',async method=>{
  await denied(route[method](),405);expect(gates.repository).not.toHaveBeenCalled();expect(pinCheck).not.toHaveBeenCalled();
 });
 it('also rejects a non-POST request passed directly to POST',async()=>{
  await denied(await route.POST(request('{}',{},'GET')),405);expect(pinCheck).not.toHaveBeenCalled();
 });
 it.each([
  ['{"extra":true}',{},400],['[]',{},400],['null',{},400],['{',{},400],['',{},400],
  [' '.repeat(129),{},413],['{}',{'content-length':'129'},413],['{}',{'content-type':'text/plain'},415],
 ] as const)('requires bounded empty JSON (%#)',async(body,headers,status)=>{
  await denied(await route.POST(request(body,headers)),status);expect(gates.repository).not.toHaveBeenCalled();expect(pinCheck).not.toHaveBeenCalled();
 });
 it.each([
  {origin:'https://evil.invalid'},{origin:''},{'sec-fetch-site':'cross-site'},{'sec-fetch-dest':'document'},
  {'x-forwarded-host':'evil.invalid'},{'x-forwarded-proto':'http'},
 ] as Record<string,string>[])('preserves same-origin enforcement (%#)',async headers=>{
  await denied(await route.POST(request('{}',headers)),403);expect(gates.repository).not.toHaveBeenCalled();expect(pinCheck).not.toHaveBeenCalled();
 });
 it.each(['','__Host-tameion-session=invalid',`__Host-tameion-session=${bearer}; __Host-tameion-session=${bearer}`])('denies missing, malformed or duplicate sessions (%#)',async cookie=>{
  await denied(await route.POST(request('{}',{cookie})),401);expect(pinCheck).not.toHaveBeenCalled();
 });
 it.each(['',bearer])('denies absent or incorrect CSRF (%#)',async csrf=>{
  await denied(await route.POST(request('{}',{'x-tameion-csrf':csrf})),403);expect(pinCheck).not.toHaveBeenCalled();
 });
 it.each([
  {valid:false},{expires_at:new Date(0).toISOString()},{credential_version:undefined},{operator_key:undefined},
 ])('denies revoked, expired or incomplete stored sessions (%#)',async change=>{
  repository.validateSession.mockResolvedValueOnce({...await repository.validateSession(),...change});
  await denied(await route.POST(request()),401);expect(pinCheck).not.toHaveBeenCalled();
 });
 it.each([2,3])('withholds booleans when session is revoked at validation %s',async boundary=>{
  const active=await repository.validateSession();repository.validateSession.mockClear();
  for(let call=1;call<boundary;call++)repository.validateSession.mockResolvedValueOnce(active);
  repository.validateSession.mockResolvedValueOnce({valid:false});
  await denied(await route.POST(request()),401);
  expect(pinCheck).toHaveBeenCalledTimes(boundary===2?0:1);
 });
 it.each([2,3])('rechecks Preview scope after validation %s awaits',async boundary=>{
  const active=await repository.validateSession();repository.validateSession.mockClear();
  for(let call=1;call<boundary;call++)repository.validateSession.mockResolvedValueOnce(active);
  repository.validateSession.mockImplementationOnce(async()=>{vi.stubEnv('VERCEL_GIT_COMMIT_REF','main');return active;});
  await denied(await route.POST(request()),403);expect(pinCheck).toHaveBeenCalledTimes(boundary===2?0:1);
 });
 it('returns only a generic failure if session storage throws a sensitive error',async()=>{
  repository.validateSession.mockRejectedValueOnce(new Error(JSON.stringify(pin)+key));
  expect(await denied(await route.POST(request()),503)).toEqual({code:'AUTH_UNAVAILABLE'});expect(pinCheck).not.toHaveBeenCalled();
 });
});
