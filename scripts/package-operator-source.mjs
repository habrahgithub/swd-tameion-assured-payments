import { createHash } from "node:crypto";
import { constants, openSync, fstatSync, readSync, closeSync, lstatSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerHooks } from "node:module";
// Native Node24 strips TS. Resolve this one canonical production import without
// adding a transpiler/dependency or changing application module resolution.
const sourceUrl=new URL("../src/server/operator-source-records.ts",import.meta.url).href;
const hook=registerHooks({resolve(specifier,context,next){return next(specifier==="../domain/payment-control-boundary"&&context.parentURL===sourceUrl?new URL("../src/domain/payment-control-boundary.ts",import.meta.url).href:specifier,context);}});
let source;
try{source=await import(sourceUrl);}finally{hook.deregister();}
export const {parseOperatorSource,OPERATOR_SOURCE_PATH,MAX_OPERATOR_SOURCE_BYTES}=source;
export const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
export function approvedSource(path,expectedHash){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const stat=fstatSync(fd);if(!stat.isFile()||stat.size>MAX_OPERATOR_SOURCE_BYTES)throw new Error("Invalid source input");
  const bytes=Buffer.alloc(MAX_OPERATOR_SOURCE_BYTES+1);let size=0;
  while(size<bytes.length){const count=readSync(fd,bytes,size,bytes.length-size,null);if(!count)break;size+=count;}
  const approved=bytes.subarray(0,size);const view=parseOperatorSource(approved,expectedHash);
  return {bytes:approved,view};
 }finally{closeSync(fd);}
}
export function packageOperatorSource({root,approvalPath,expectedHash}){
 const {bytes,view}=approvedSource(approvalPath,expectedHash);const directory=join(resolve(root),".tameion");
 try{const stat=lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error("Unsafe source directory");}catch(error){if(error.code!=="ENOENT")throw error;mkdirSync(directory,{mode:0o700});}
 const path=join(resolve(root),OPERATOR_SOURCE_PATH);const fd=openSync(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
 try{writeFileSync(fd,bytes);}finally{closeSync(fd);}
 return {source_sha256:expectedHash,record_count:view.records.length,purpose:"OPERATOR_VIEW_ONLY",financial_eligibility:"UNCHANGED_NOT_GRANTED",provisioning:"LOCAL_BYTES_ONLY_NOT_HOSTED_APPROVAL"};
}
export function inputArgs(argv){if(argv.length!==4||argv[0]!=="--approved-source"||argv[2]!=="--sha256"||!argv[1]||!argv[3])throw new Error("Required: --approved-source FILE --sha256 OWNER_APPROVED_BYTES_HASH");return {approvalPath:argv[1],expectedHash:argv[3]};}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(packageOperatorSource({root:process.cwd(),...inputArgs(process.argv.slice(2))})));}catch{console.error("OPERATOR_SOURCE_PACKAGING_REJECTED");process.exitCode=1;}}
