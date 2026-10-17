import {createHash,timingSafeEqual} from "node:crypto";

/** Production configuration identity contract. Server-only: never expose inputs. */
export const PRODUCTION_CONFIGURATION_SCHEMA = "tameion-production-config-v1" as const;
export const PRODUCTION_CONFIGURATION_INPUT_NAMES = [
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_URL",
  "TAMEION_ALLOWED_ORIGINS",
  "TAMEION_INGRESS_MODE",
  "TAMEION_OPERATOR_KEY",
  "TAMEION_OPERATOR_SOURCE_DOCUMENT",
  "TAMEION_OPERATOR_SOURCE_SHA256",
  "TAMEION_THROTTLE_HMAC_KEY",
] as const;
const MAX_FRAMED_BYTES=262_144;
const HEADER=Buffer.from(`${PRODUCTION_CONFIGURATION_SCHEMA}\0`,"ascii");
const unavailable=():never=>{throw new Error("PRODUCTION_CONFIGURATION_UNAVAILABLE");};

function rejectUnpairedSurrogates(value:string):void{
 for(let i=0;i<value.length;i++){
  const unit=value.charCodeAt(i);
  if(unit>=0xd800&&unit<=0xdbff){const next=value.charCodeAt(i+1);if(!(next>=0xdc00&&next<=0xdfff))unavailable();i++;}
  else if(unit>=0xdc00&&unit<=0xdfff)unavailable();
 }
}

export function computeProductionConfigurationSha256(env: Record<string, string | undefined>): string {
 try{
  const parts:Buffer[]=[HEADER];let total=BigInt(HEADER.length);
  for(const name of PRODUCTION_CONFIGURATION_INPUT_NAMES){
   const value=env[name];if(typeof value!=="string")throw new Error("configuration");if(value.length===0)unavailable();rejectUnpairedSurrogates(name);rejectUnpairedSurrogates(value);
   const nameBytes=Buffer.from(name,"utf8"),valueBytes=Buffer.from(value,"utf8");
   if(nameBytes.length>0xffff||BigInt(valueBytes.length)>0xffff_ffff_ffff_ffffn)unavailable();
   const nameLength=Buffer.alloc(2),valueLength=Buffer.alloc(8);nameLength.writeUInt16BE(nameBytes.length);valueLength.writeBigUInt64BE(BigInt(valueBytes.length));
   total+=BigInt(2+nameBytes.length+8+valueBytes.length);if(total>BigInt(MAX_FRAMED_BYTES))unavailable();parts.push(nameLength,nameBytes,valueLength,valueBytes);
  }
  return createHash("sha256").update(Buffer.concat(parts,Number(total))).digest("hex");
 }catch{return unavailable();}
}

export function assertProductionConfigurationIdentity(
  env: Record<string, string | undefined>,
  schema: string,
  expectedSha256: string,
): void {
 try{
  if(schema!==PRODUCTION_CONFIGURATION_SCHEMA||!/^[a-f0-9]{64}$/.test(expectedSha256))unavailable();
  const actual=computeProductionConfigurationSha256(env);
  if(!timingSafeEqual(Buffer.from(actual,"hex"),Buffer.from(expectedSha256,"hex")))unavailable();
 }catch{return unavailable();}
}
