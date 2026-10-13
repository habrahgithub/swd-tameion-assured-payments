import {readFileSync,readdirSync,statSync} from "node:fs";
import {resolve,join,dirname,relative} from "node:path";
import {pathToFileURL} from "node:url";
import {approvedSource,OPERATOR_SOURCE_PATH,sha256,inputArgs} from "./package-operator-source.mjs";
function files(root){return readdirSync(root,{withFileTypes:true}).flatMap(entry=>{const path=join(root,entry.name);if(entry.isSymbolicLink())throw new Error("Symlink output");return entry.isDirectory()?files(path):[path];});}
export function verifyOperatorSource({root,approvalPath,expectedHash}){
 const {bytes,view}=approvedSource(approvalPath,expectedHash);const base=resolve(root),packaged=join(base,OPERATOR_SOURCE_PATH);
 if(sha256(readFileSync(packaged))!==expectedHash)throw new Error("Source changed");
 const paths=JSON.parse(readFileSync(join(base,".next/server/app-paths-manifest.json"),"utf8"));const routes=Object.entries(paths).filter(([name])=>name.startsWith("/api/")&&name.endsWith("/route"));if(!routes.length)throw new Error("No server routes");
 for(const [name,path]of routes){const trace=join(base,".next/server",path+".nft.json");const listed=JSON.parse(readFileSync(trace,"utf8")).files;if(!Array.isArray(listed)||!listed.some(file=>resolve(dirname(trace),file)===packaged))throw new Error("Source absent in server trace: "+name);}
 const needles=[bytes,...view.records.flatMap(record=>[Buffer.from(record.obligation_id),...record.source_evidence.map(item=>Buffer.from(item.evidence_id))])];
 let clientCount=0,servedCount=0;
 for(const directory of [join(base,".next/static"),join(base,"public"),join(base,".next/server/app")]){
  try{statSync(directory);}catch(error){if(error.code==="ENOENT")continue;throw error;}
  for(const file of files(directory)){const served=directory.endsWith("/server/app");if(served&&!/\.(html|rsc|body|meta)$/.test(file))continue;const data=readFileSync(file);if(needles.some(needle=>data.includes(needle))||relative(directory,file).includes("operator-source.json"))throw new Error("Source exposed in served/client output");if(served)servedCount++;else clientCount++;}
 }
 if(!clientCount)throw new Error("No client output inspected");
 return {proof:"LOCAL_NEXT_SOURCE_PRIVACY_ONLY_NOT_HOSTED",source_sha256:expectedHash,server_routes:routes.map(([name])=>name),client_public_files_inspected:clientCount,served_files_inspected:servedCount,financial_eligibility:"UNCHANGED_NOT_GRANTED"};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){try{console.log(JSON.stringify(verifyOperatorSource({root:process.cwd(),...inputArgs(process.argv.slice(2))})));}catch{console.error("OPERATOR_SOURCE_VERIFICATION_REJECTED");process.exitCode=1;}}
