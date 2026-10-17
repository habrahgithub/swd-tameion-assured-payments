import { z } from "zod";
import { AccessError } from "./route-access-policy";

export interface Verifier { algorithm: string; salt_hex: string; verifier_hex: string; work_n: number; work_r: number; work_p: number; maxmem: number; credential_version: number }
export interface Admission { accepted?: boolean; admitted?: boolean; retry_after?: number; expires_at?: string; verifier?: Verifier }
export interface Session { valid: boolean; operator_key?: string; credential_version?: number; expires_at?: string; csrf_digest?: string }
export interface OperatorAuthRepository {
  issueChallenge(input: Record<string, string>): Promise<Admission>;
  reserveLogin(input: Record<string, string>): Promise<Admission>;
  finishLogin(input: Record<string, string | number | boolean>): Promise<Admission>;
  validateSession(input: Record<string,string>): Promise<Session>;
  revokeSession(input: Record<string,string>): Promise<{revoked:boolean}>;
  admitRefresh(input: Record<string,string>): Promise<Admission>;
}
const resultSchema=z.record(z.string(),z.unknown());
/** One bounded RPC per operation. Never retries an uncertain admission. */
export class RpcClient {
  constructor(private readonly url:string,private readonly key:string,private readonly fetcher:typeof fetch=fetch) {
    const parsed=new URL(url);if(parsed.protocol!=="https:"||parsed.username||parsed.password||parsed.origin!==url.replace(/\/+$/,"")||!key)throw new AccessError("AUTH_UNAVAILABLE",503);
  }
  async call(name:string,input:Record<string,unknown>):Promise<Record<string,unknown>> {
    const body=Object.fromEntries(Object.entries(input).map(([key,value])=>[`p_${key}`,key.endsWith("_digest")&&typeof value==="string"?`\\x${value}`:value]));
    try {
      const response=await this.fetcher(`${this.url.replace(/\/+$/,"")}/rest/v1/rpc/${name}`,{method:"POST",cache:"no-store",redirect:"error",signal:AbortSignal.timeout(5000),headers:{apikey:this.key,Authorization:`Bearer ${this.key}`,"Content-Type":"application/json"},body:JSON.stringify(body)});
      if(!response.ok)throw new Error();
      return resultSchema.parse(await response.json());
    }catch {throw new AccessError("AUTH_UNAVAILABLE",503);}
  }
}
export class SupabaseOperatorAuthRepository implements OperatorAuthRepository {
  constructor(private readonly rpc:RpcClient){}
  async issueChallenge(input:Record<string,string>){return await this.rpc.call("tameion_operator_csrf_issue",input) as Admission;}
  async reserveLogin(input:Record<string,string>){return await this.rpc.call("tameion_operator_login_reserve",input) as Admission;}
  async finishLogin(input:Record<string,string|number|boolean>){return await this.rpc.call("tameion_operator_login_finish",input) as Admission;}
  async validateSession(input:Record<string,string>){const r=await this.rpc.call("tameion_operator_session_validate",input);if(typeof r.csrf_digest==="string")r.csrf_digest=r.csrf_digest.replace(/^\\x/,"");return r as unknown as Session;}
  async revokeSession(input:Record<string,string>){return await this.rpc.call("tameion_operator_session_revoke",input) as unknown as {revoked:boolean};}
  async admitRefresh(input:Record<string,string>){return await this.rpc.call("tameion_operator_refresh_admit",input) as Admission;}
}
export function runtimeRpc():RpcClient {
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new AccessError("AUTH_UNAVAILABLE",503);
  return new RpcClient(url,key);
}
