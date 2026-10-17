import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { canonicalApprovalOrigin, loadDeploymentApproval, type DeploymentApproval } from "./deployment-approval";
import {assertProductionConfigurationIdentity} from "./production-config-identity";
import {parseOperatorSource} from "./operator-source-records";

export class AccessError extends Error {
  constructor(public readonly code: string, public readonly status = 403) { super(code);this.name="AccessError"; }
}
export interface OperatorPolicy { origins: readonly string[]; deployment: DeploymentApproval; throttleKey: Buffer }
export interface RequestIdentity { origin: string; originDigest: string; networkDigest: string }
export function digest(value: string | Uint8Array):string {return createHash("sha256").update(value).digest("hex");}
/** Config is an approved deployment record, not inferred provenance from flags.
 * No constructor, auth repository or provider access occurs here. */
export function parseOperatorPolicy(env:Record<string,string|undefined> = process.env):OperatorPolicy {
  try {
    const origins=z.array(z.string()).min(1).max(8).parse(JSON.parse(env.TAMEION_ALLOWED_ORIGINS??"null")).map(canonicalApprovalOrigin);
    if(new Set(origins).size!==origins.length||env.TAMEION_INGRESS_MODE!=="vercel-direct-v1")throw new Error("policy");
    const deployment=loadDeploymentApproval(env);
    const runtimeIdentityMatches="deployment_id" in deployment
      ? env.VERCEL_DEPLOYMENT_ID===deployment.deployment_id
      : env.VERCEL_GIT_COMMIT_SHA===deployment.git_commit_sha;
    if(JSON.stringify([...origins].sort())!==JSON.stringify(deployment.origins.map(canonicalApprovalOrigin).sort())||env.VERCEL!=="1"||env.VERCEL_ENV!==deployment.environment||env.VERCEL_PROJECT_ID!==deployment.project_id||!runtimeIdentityMatches)throw new Error("mapping");
    if("binding" in deployment&&deployment.binding==="git-sha-production-v1"){
      assertProductionConfigurationIdentity(env,deployment.configuration_schema,deployment.configuration_sha256);
      parseOperatorSource(Buffer.from(env.TAMEION_OPERATOR_SOURCE_DOCUMENT!,"utf8"),env.TAMEION_OPERATOR_SOURCE_SHA256!);
    }
    if(!/^[0-9a-f]{64,128}$/.test(env.TAMEION_THROTTLE_HMAC_KEY??"")||(env.TAMEION_THROTTLE_HMAC_KEY!.length%2)!==0)throw new Error("key");
    return {origins,deployment,throttleKey:Buffer.from(env.TAMEION_THROTTLE_HMAC_KEY!,"hex")};
  } catch {throw new AccessError("AUTH_UNAVAILABLE",503);}
}
function canonicalIp(value:string):string {
  if(!value||value!==value.trim()||value.includes(",")||value.includes("%")||isIP(value)===0)throw new AccessError("INGRESS_UNVERIFIED");
  if(isIP(value)===4)return value;
  const normalized=new URL(`http://[${value}]/`).hostname.slice(1,-1).toLowerCase();
  if(normalized.startsWith("::ffff:")) {
    const parts=normalized.slice(7).split(":");
    if(parts.length===2) {const a=parseInt(parts[0],16),b=parseInt(parts[1],16);return `${a>>>8}.${a&255}.${b>>>8}.${b&255}`;}
  }
  return normalized;
}
export function resolveRequestIdentity(request:Request,policy:OperatorPolicy,post:boolean):RequestIdentity {
  const host=request.headers.get("host")??"";
  let target:URL;try{target=new URL(`https://${host}/`);}catch{throw new AccessError("ORIGIN_REJECTED");}
  const origin=target.origin;
  if(target.host!==host||!policy.origins.includes(origin)||request.headers.get("x-forwarded-host")!==host||request.headers.get("x-forwarded-proto")!=="https"||request.headers.get("sec-fetch-site")!=="same-origin"||request.headers.get("sec-fetch-dest")!=="empty")throw new AccessError("ORIGIN_REJECTED");
  const claimed=request.headers.get("origin");
  if((post&&!claimed)||(claimed!==null&&claimed!==origin))throw new AccessError("ORIGIN_REJECTED");
  const ip=canonicalIp(request.headers.get("x-vercel-forwarded-for")??"");
  return {origin,originDigest:digest(`tameion/origin/v1\0${origin}`),networkDigest:createHmac("sha256",policy.throttleKey).update(`tameion/network/vercel-direct-v1\0${ip}`).digest("hex")};
}
export async function readBoundedJson(request:Request,limit:number):Promise<Record<string,unknown>> {
  const length=request.headers.get("content-length");
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))throw new AccessError("BODY_REJECTED",413);
  const reader=request.body?.getReader();if(!reader)throw new AccessError("BODY_REJECTED",400);
  const chunks:Uint8Array[]=[];let size=0;let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const read=async()=>{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit)throw new AccessError("BODY_REJECTED",413);chunks.push(next.value);}};
    await Promise.race([read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new AccessError("BODY_REJECTED",408)),2000);})]);
    const value:unknown=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("object required");
    return value as Record<string,unknown>;
  }catch(error){void reader.cancel().catch(()=>undefined);if(error instanceof AccessError)throw error;throw new AccessError("BODY_REJECTED",400);}
  finally{if(timer)clearTimeout(timer);}
}
export function requireJson(request:Request):void {
  if(!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers.get("content-type")??""))throw new AccessError("CONTENT_TYPE_REJECTED",415);
}
export function methodNotAllowed():Response {return Response.json({code:"METHOD_NOT_ALLOWED"},{status:405,headers:{"Cache-Control":"no-store",Pragma:"no-cache"}});}
export function disabledLane(code="LANE_NOT_ADMITTED",status=403):Response {return Response.json({code},{status,headers:{"Cache-Control":"no-store",Pragma:"no-cache"}});}
