import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join, relative, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { approvedInput, argumentsFor, sha256 } from "./package-deployment-approval.mjs";
import { DEPLOYMENT_APPROVAL_PATH } from "../src/server/deployment-approval.ts";
function files(root) {
  return readdirSync(root, { withFileTypes: true }).flatMap(entry => {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Symlink in inspected output");
    return entry.isDirectory() ? files(path) : [path];
  });
}
/** Local Next proof only. This does not certify a Vercel upload/runtime. */
export function verifyBuild({ root, approvalPath, expectedHash, reservationPath, contextPath, continueId, expectedTeam }) {
  const { bytes, record } = approvedInput(approvalPath, expectedHash, reservationPath, contextPath, continueId, expectedTeam);
  const base = resolve(root);
  const packaged = join(base, DEPLOYMENT_APPROVAL_PATH);
  if (sha256(readFileSync(packaged)) !== expectedHash) throw new Error("Packaged approval changed");
  const routes = JSON.parse(readFileSync(join(base, ".next/server/app-paths-manifest.json"), "utf8"));
  const serverRoutes = Object.entries(routes).filter(([route]) => route.startsWith("/api/") && route.endsWith("/route"));
  if (!serverRoutes.length) throw new Error("No API routes proven");
  const tracedRoutes = [];
  for (const [route, output] of serverRoutes) {
    const trace = join(base, ".next/server", output + ".nft.json");
    const paths = JSON.parse(readFileSync(trace, "utf8")).files;
    if (!Array.isArray(paths) || !paths.some(path => resolve(dirname(trace), path) === packaged)) throw new Error(`Approval missing in server trace: ${route}`);
    tracedRoutes.push(route);
  }
  const servedServerFiles = files(join(base, ".next/server/app")).filter(file => /\.(html|rsc|body|meta)$/.test(file));
  for (const file of servedServerFiles) {
    const data = readFileSync(file);
    if (data.includes(bytes) || data.includes(Buffer.from(record.approval_id))) throw new Error(`Approval exposed in served output: ${relative(base, file)}`);
  }
  const scanned = [];
  for (const directory of [join(base, ".next/static"), join(base, "public")]) {
    try { statSync(directory); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    for (const file of files(directory)) {
      const data = readFileSync(file);
      if (data.includes(bytes) || data.includes(Buffer.from(record.approval_id)) || relative(directory, file).includes("deployment-approval.json")) throw new Error(`Approval exposed in client/public output: ${relative(base, file)}`);
      scanned.push(relative(base, file));
    }
  }
  if (!scanned.some(path => path.startsWith(".next/static/"))) throw new Error("Client output not inspected");
  const outputSeal = files(join(base, ".next")).sort().map(file => ({ path: relative(base, file), sha256: sha256(readFileSync(file)) }));
  return { next_output_tree_sha256: sha256(JSON.stringify(outputSeal)), proof: "LOCAL_NEXT_BUILD_ONLY_NOT_UPLOADED", deployment_id: record.deployment_id, approval_sha256: expectedHash, server_routes: tracedRoutes, client_public_files_inspected: scanned.length, served_server_files_inspected: servedServerFiles.length };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = argumentsFor(process.argv.slice(2));
    if (Object.keys(args).sort().join() !== ["--approval", "--sha256", "--reservation", "--build-context", "--continue-id", "--team-id"].sort().join()) throw new Error("Required: --approval --sha256 --reservation --build-context --continue-id --team-id");
    console.log(JSON.stringify(verifyBuild({ root: process.cwd(), approvalPath: args["--approval"], expectedHash: args["--sha256"], reservationPath: args["--reservation"], contextPath: args["--build-context"], continueId: args["--continue-id"], expectedTeam: args["--team-id"] })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
