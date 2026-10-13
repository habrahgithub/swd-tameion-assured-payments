import {existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {registerHooks} from "node:module";

const sourceUrl=new URL("../src/server/financial-source-admission.ts",import.meta.url).href;
const hook=registerHooks({resolve(specifier,context,next){
 if((specifier.startsWith("./")||specifier.startsWith("../"))&&context.parentURL?.startsWith(new URL("../src/",import.meta.url).href)){
  const candidate=new URL(specifier+".ts",context.parentURL);if(existsSync(fileURLToPath(candidate)))return next(candidate.href,context);
 }
 return next(specifier,context);
}});
let admission;
try{admission=await import(sourceUrl);}finally{hook.deregister();}
export const {parseFinancialSource,parseFinancialRequester,sameFinancialBinding}=admission;
export const FINANCIAL_SOURCE_PATH=".tameion/financial-source.json";
export const FINANCIAL_REQUESTER_PATH=".tameion/financial-requester.json";
export function inputArgs(argv){
 const values={};for(let index=0;index<argv.length;index+=2){const key=argv[index],value=argv[index+1];if(!key?.startsWith("--")||!value)throw new Error("Invalid arguments");values[key.slice(2)]=value;}
 for(const key of ["approved-source","source-sha256","approved-requester","requester-sha256"])if(!values[key])throw new Error("Missing financial authority input");
 return {sourcePath:values["approved-source"],sourceHash:values["source-sha256"],requesterPath:values["approved-requester"],requesterHash:values["requester-sha256"]};
}
