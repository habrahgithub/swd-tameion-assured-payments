import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { AccessError, digest, methodNotAllowed, parseOperatorPolicy, readBoundedJson, requireJson, resolveRequestIdentity, type OperatorPolicy } from "./route-access-policy";
import { runtimeRpc, SupabaseOperatorAuthRepository, type OperatorAuthRepository, type Session, type Verifier } from "./operator-auth-repository";

const sessionCookie="__Host-tameion-session",preloginCookie="__Host-tameion-prelogin";
const opaque=/^[A-Za-z0-9_-]{43}$/;
const fresh=()=>randomBytes(32).toString("base64url");
const tokenDigest=(token:string)=>digest(Buffer.from(token,"base64url"));
export const csrfForBearer=(bearer:string)=>Buffer.from(digest(`tameion/session-csrf/v1\0${bearer}`),"hex").toString("base64url");
function cookie(request:Request,name:string):string {
  const found=(request.headers.get("cookie")??"").split(";").map(v=>v.trim()).filter(v=>v.startsWith(name+"="));
  const value=found.length===1?found[0].slice(name.length+1):"";
  if(!opaque.test(value)||Buffer.from(value,"base64url").toString("base64url")!==value)throw new AccessError("SESSION_REQUIRED",401);
  return value;
}
function setCookie(name:string,value:string,maxAge:number){return `${name}=${value}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;}
function equal(a:string,b:string){return /^[a-f0-9]{64}$/.test(a)&&/^[a-f0-9]{64}$/.test(b)&&timingSafeEqual(Buffer.from(a,"hex"),Buffer.from(b,"hex"));}
export function privateJson(body:unknown,status=200):Response {return Response.json(body,{status,headers:{"Cache-Control":"no-store",Pragma:"no-cache"}});}
export function accessFailure(error:unknown):Response {return privateJson({code:error instanceof AccessError?error.code:"AUTH_UNAVAILABLE"},error instanceof AccessError?error.status:503);}
function retry(value:number|undefined):never {throw new AccessError(`RATE_LIMITED:${Math.max(1,Math.min(900,Number.isFinite(value)?value!:900))}`,429);}
function failure(error:unknown):Response {
  if(error instanceof AccessError&&error.code.startsWith("RATE_LIMITED:")){const response=privateJson({code:"RATE_LIMITED",retry_after:Number(error.code.split(":")[1])},429);response.headers.set("Retry-After",error.code.split(":")[1]);return response;}
  return accessFailure(error);
}
export interface AuthContext {repository:OperatorAuthRepository;sessionDigest:string;session:Session;revalidate:()=>Promise<void>;networkDigest:string}
interface Dependencies {
  policy:()=>OperatorPolicy;repository:()=>OperatorAuthRepository;operatorKey:()=>string;
  verifyPassword:(password:string,verifier:Verifier)=>Promise<boolean>;
  balance:(revalidate:()=>Promise<void>)=>Promise<unknown>;
}
/** The only injection seam is an in-process factory. No hosted testing switch. */
export function createOperatorHandlers(deps:Dependencies) {
  async function guard(request:Request,post:boolean):Promise<AuthContext>{
    const identity=resolveRequestIdentity(request,deps.policy(),post);
    const bearer=cookie(request,sessionCookie),sessionDigest=tokenDigest(bearer),repository=deps.repository();
    const session=await repository.validateSession({session_digest:sessionDigest});
    function valid(current:Session){if(current.valid!==true||!current.operator_key||!Number.isSafeInteger(current.credential_version)||!current.expires_at||!Number.isFinite(Date.parse(current.expires_at))||Date.parse(current.expires_at)<=Date.now()||!current.csrf_digest)throw new AccessError("SESSION_REQUIRED",401);}
    valid(session);
    if(post){const claimed=request.headers.get("x-tameion-csrf")??"";if(!opaque.test(claimed)||!equal(tokenDigest(claimed),session.csrf_digest!))throw new AccessError("CSRF_REJECTED");}
    return {repository,sessionDigest,session,networkDigest:identity.networkDigest,revalidate:async()=>{const current=await repository.validateSession({session_digest:sessionDigest});valid(current);if(current.operator_key!==session.operator_key||current.credential_version!==session.credential_version||current.expires_at!==session.expires_at||current.csrf_digest!==session.csrf_digest)throw new AccessError("SESSION_REQUIRED",401);}};
  }
  async function emptyBody(request:Request){requireJson(request);const body=await readBoundedJson(request,128);if(Object.keys(body).length)throw new AccessError("BODY_REJECTED",400);}
  return {
    guard,
    csrf:async(request:Request)=>{
      if(request.method!=="POST")return methodNotAllowed();
      try {
        const identity=resolveRequestIdentity(request,deps.policy(),true);
        if(request.headers.get("x-tameion-csrf-bootstrap")!=="1")throw new AccessError("CSRF_REJECTED");
        await emptyBody(request);
        const nonce=fresh(),csrf=fresh(),r=await deps.repository().issueChallenge({challenge_id:randomBytes(16).toString("hex"),binding_digest:tokenDigest(nonce),csrf_digest:tokenDigest(csrf),network_digest:identity.networkDigest,origin_digest:identity.originDigest});
        if(r.accepted!==true)retry(r.retry_after);
        if(!r.expires_at||!Number.isFinite(Date.parse(r.expires_at))||Date.parse(r.expires_at)<=Date.now()||Date.parse(r.expires_at)>Date.now()+300000)throw new AccessError("AUTH_UNAVAILABLE",503);
        const response=privateJson({csrf_token:csrf,expires_at:r.expires_at});response.headers.append("Set-Cookie",setCookie(preloginCookie,nonce,300));return response;
      }catch(error){return failure(error);}
    },
    login:async(request:Request)=>{
      if(request.method!=="POST")return methodNotAllowed();
      try {
        const identity=resolveRequestIdentity(request,deps.policy(),true);requireJson(request);
        let nonce:string;try{nonce=cookie(request,preloginCookie);}catch{throw new AccessError("CSRF_REJECTED");}
        const csrf=request.headers.get("x-tameion-csrf")??"";if(!opaque.test(csrf))throw new AccessError("CSRF_REJECTED");
        const body=await readBoundedJson(request,2048);
        if(Object.keys(body).some(k=>!['username','password'].includes(k))||typeof body.username!=="string"||body.username.length>128||typeof body.password!=="string"||!body.password||Buffer.byteLength(body.password)>1024)throw new AccessError("BODY_REJECTED",400);
        const operatorKey=deps.operatorKey();if(!operatorKey||operatorKey.length>128)throw new AccessError("AUTH_UNAVAILABLE",503);
        const repository=deps.repository(),attempt=fresh();
        const r=await repository.reserveLogin({operator_key:operatorKey,network_digest:identity.networkDigest,origin_digest:identity.originDigest,binding_digest:tokenDigest(nonce),csrf_digest:tokenDigest(csrf),attempt_digest:tokenDigest(attempt)});
        if(r.admitted!==true){if(r.retry_after)retry(r.retry_after);throw new AccessError("LOGIN_REJECTED",401);}
        if(!r.verifier)throw new AccessError("AUTH_UNAVAILABLE",503);
        const matches=await deps.verifyPassword(body.password,r.verifier);
        const bearer=fresh(),sessionCsrf=csrfForBearer(bearer);
        const finished=await repository.finishLogin({attempt_digest:tokenDigest(attempt),expected_credential_version:r.verifier.credential_version,verified:matches&&body.username===operatorKey,session_digest:tokenDigest(bearer),csrf_digest:tokenDigest(sessionCsrf)});
        if(finished.accepted!==true)throw new AccessError("LOGIN_REJECTED",401);
        if(!finished.expires_at||!Number.isFinite(Date.parse(finished.expires_at))||Date.parse(finished.expires_at)<=Date.now()||Date.parse(finished.expires_at)>Date.now()+3600000)throw new AccessError("AUTH_UNAVAILABLE",503);
        const response=privateJson({authenticated:true,expires_at:finished.expires_at,csrf_token:sessionCsrf});response.headers.append("Set-Cookie",setCookie(sessionCookie,bearer,Math.floor((Date.parse(finished.expires_at)-Date.now())/1000)));response.headers.append("Set-Cookie",setCookie(preloginCookie,"",0));return response;
      }catch(error){const response=failure(error);response.headers.append("Set-Cookie",setCookie(preloginCookie,"",0));return response;}
    },
    session:async(request:Request)=>{
      if(request.method!=="GET")return methodNotAllowed();
      try{const ctx=await guard(request,false);return privateJson({authenticated:true,expires_at:ctx.session.expires_at,csrf_token:csrfForBearer(cookie(request,sessionCookie))});}catch(error){return failure(error);}
    },
    logout:async(request:Request)=>{
      if(request.method!=="POST")return methodNotAllowed();
      let attempted=false;
      try{await emptyBody(request);const ctx=await guard(request,true);attempted=true;if((await ctx.repository.revokeSession({session_digest:ctx.sessionDigest})).revoked!==true)throw new Error();const response=privateJson({authenticated:false,revoked:true});response.headers.append("Set-Cookie",setCookie(sessionCookie,"",0));return response;}
      catch(error){const response=attempted?privateJson({code:"LOGOUT_UNVERIFIED"},503):failure(error);if(attempted)response.headers.append("Set-Cookie",setCookie(sessionCookie,"",0));return response;}
    },
    refresh:async(request:Request)=>{
      if(request.method!=="POST")return methodNotAllowed();
      try{await emptyBody(request);const ctx=await guard(request,true);const r=await ctx.repository.admitRefresh({session_digest:ctx.sessionDigest,network_digest:ctx.networkDigest});if(r.accepted!==true)retry(r.retry_after);await ctx.revalidate();const value=await deps.balance(ctx.revalidate);await ctx.revalidate();return privateJson(value);}catch(error){return failure(error);}
    },
  };
}
/** Bounded, reviewed work parameters only. No provisioned or default password. */
export async function verifyScrypt(password:string,v:Verifier):Promise<boolean>{
  if(v.algorithm!=="scrypt-v1"||v.work_n!==131072||v.work_r!==8||v.work_p!==1||v.maxmem!==167772160||!/^([a-f0-9]{2}){16,64}$/.test(v.salt_hex)||!/^[a-f0-9]{128}$/.test(v.verifier_hex)||!Number.isSafeInteger(v.credential_version)||v.credential_version<1)throw new AccessError("AUTH_UNAVAILABLE",503);
  const derived=await new Promise<Buffer>((resolve,reject)=>scrypt(password,Buffer.from(v.salt_hex,"hex"),64,{N:v.work_n,r:v.work_r,p:v.work_p,maxmem:v.maxmem},(error,key)=>error?reject(error):resolve(key)));
  return timingSafeEqual(derived,Buffer.from(v.verifier_hex,"hex"));
}
export const operatorHandlers=createOperatorHandlers({policy:parseOperatorPolicy,repository:()=>new SupabaseOperatorAuthRepository(runtimeRpc()),operatorKey:()=>process.env.TAMEION_OPERATOR_KEY??"",verifyPassword:verifyScrypt,balance:async(revalidate)=>{const {readOperatorBalance}=await import("./operator-wallet-balance");return readOperatorBalance(revalidate);}});
