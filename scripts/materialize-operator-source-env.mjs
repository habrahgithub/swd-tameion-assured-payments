import { constants, closeSync, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OPERATOR_SOURCE_PATH, parseOperatorSource } from "./package-operator-source.mjs";
const FINANCIAL_SOURCE_PATH=".tameion/financial-source.json",FINANCIAL_REQUESTER_PATH=".tameion/financial-requester.json";

async function materialize(root = process.cwd(), env = process.env) {
  const document = env.TAMEION_OPERATOR_SOURCE_DOCUMENT;
  const expectedHash = env.TAMEION_OPERATOR_SOURCE_SHA256;
  const financialDocument=env.TAMEION_FINANCIAL_SOURCE_DOCUMENT,financialHash=env.TAMEION_FINANCIAL_SOURCE_SHA256;
  const requesterDocument=env.TAMEION_FINANCIAL_REQUESTER_DOCUMENT,requesterHash=env.TAMEION_FINANCIAL_REQUESTER_SHA256;
  const operatorPresent=document!==undefined||expectedHash!==undefined,financialPresent=financialDocument!==undefined||financialHash!==undefined||requesterDocument!==undefined||requesterHash!==undefined;
  if(!operatorPresent&&!financialPresent)return { provisioning: "HOSTED_BUILD_SOURCE_ABSENT" };
  if(operatorPresent&&(!document||!expectedHash))throw new Error("Incomplete hosted operator source input");
  if(financialPresent&&(!financialDocument||!financialHash||!requesterDocument||!requesterHash))throw new Error("Incomplete hosted financial authority input");
  const bytes=document===undefined?undefined:Buffer.from(document,"utf8");
  const view=bytes===undefined?undefined:parseOperatorSource(bytes,expectedHash);
  const financialBytes=financialDocument===undefined?undefined:Buffer.from(financialDocument,"utf8");
  const requesterBytes=requesterDocument===undefined?undefined:Buffer.from(requesterDocument,"utf8");
  const parser=financialPresent?await import("./package-financial-authority.mjs"):undefined;
  const financial=financialBytes===undefined?undefined:parser.parseFinancialSource(financialBytes,financialHash,env);
  const requester=requesterBytes===undefined?undefined:parser.parseFinancialRequester(requesterBytes,requesterHash,env);
  if(financial&&requester&&(requester.source_sha256!==financialHash||financial.organization_id!==requester.organization_id||financial.namespace!==requester.namespace||financial.intent_id!==requester.intent_id||!parser.sameFinancialBinding(financial,requester)))throw new Error("Financial authority pair mismatch");
  const directory = join(resolve(root), ".tameion");
  try {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe source directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    mkdirSync(directory, { mode: 0o700 });
  }
  const write=(path,contents)=>{const fd=openSync(join(resolve(root),path),constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);try{writeFileSync(fd,contents);}finally{closeSync(fd);}};
  if(bytes)write(OPERATOR_SOURCE_PATH,bytes);
  if(financialBytes&&requesterBytes){write(FINANCIAL_SOURCE_PATH,financialBytes);write(FINANCIAL_REQUESTER_PATH,requesterBytes);}
  return {provisioning:"HOSTED_BUILD_BYTES_ONLY",...(view?{record_count:view.records.length,purpose:"OPERATOR_VIEW_ONLY",operator_source:{record_count:view.records.length,purpose:"OPERATOR_VIEW_ONLY"}}:{}),...(financial?{financial_source:{record_count:1,purpose:financial.purpose}}:{}),...(requester?{financial_requester:{purpose:requester.purpose}}:{})};
}

try { console.log(JSON.stringify(await materialize())); }
catch { console.error("HOSTED_PRIVATE_SOURCE_MATERIALIZATION_REJECTED"); process.exitCode = 1; }
