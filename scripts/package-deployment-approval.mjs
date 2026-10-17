import { createHash } from "node:crypto";
import { constants, closeSync, mkdirSync, openSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEPLOYMENT_APPROVAL_PATH, parseDeploymentApproval, canonicalApprovalOrigin } from "../src/server/deployment-approval.ts";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
/** Normalized custody inputs must be transcribed/read back from the SAME init
 * reservation and build --id context. This validates them, not their provenance. */
export function verifyIdentity(record, reservation, context, continueId, expectedTeam, accessPlan) {
  const keys = ["deployment_id", "project_id", "environment", "generated_origin", "team_id"];
  if (typeof expectedTeam !== "string" || !expectedTeam || expectedTeam.length > 128) throw new Error("Explicit approved team required");
  for (const value of [reservation, context]) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error("Exact reservation/build identity required");
    for (const key of keys) if (typeof value[key] !== "string" || !value[key] || value[key].length > 2048) throw new Error("Invalid identity");
    if (value.team_id !== expectedTeam || value.environment !== record.environment || value.project_id !== record.project_id || value.deployment_id !== record.deployment_id || record.origins.length !== 1) throw new Error("Reservation/build/approval identity mismatch");
    canonicalApprovalOrigin(value.generated_origin);
  }
  if (reservation.generated_origin !== context.generated_origin) throw new Error("Generated origin mismatch");
  if (continueId !== record.deployment_id) throw new Error("Continuation identity mismatch");
  if (accessPlan) {
    const keys = ["approval_id", "project_id", "team_id", "environment", "access_origin", "stage"];
    if (!accessPlan || typeof accessPlan !== "object" || Array.isArray(accessPlan) || Object.keys(accessPlan).sort().join() !== [...keys].sort().join()) throw new Error("Exact approved access-origin plan required");
    if (typeof accessPlan.approval_id !== "string" || !accessPlan.approval_id || accessPlan.approval_id.length > 128 || accessPlan.project_id !== record.project_id || accessPlan.team_id !== expectedTeam || accessPlan.environment !== record.environment || accessPlan.access_origin !== record.origins[0] || accessPlan.stage !== "PRE_RESERVATION_ACCESS_ORIGIN_APPROVAL") throw new Error("Access-origin plan mismatch");
    canonicalApprovalOrigin(accessPlan.access_origin);
  } else if (reservation.generated_origin !== record.origins[0]) throw new Error("Missing approved access-origin plan for distinct origin");
}
function readCustodyJson(path, expectedHash) {
  const bytes = readFileSync(path);
  if (bytes.length > 16_384 || (expectedHash !== undefined && sha256(bytes) !== expectedHash)) throw new Error("Custody input hash/size mismatch");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  // These custody records are flat objects. Reject duplicate JSON property
  // tokens rather than silently adopting JSON.parse's last-value behavior.
  const keys = new Set();
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '\"') continue;
    const start = i++;
    while (i < text.length && text[i] !== '\"') { if (text[i] === "\\") i++; i++; }
    const end = i; let next = i + 1;
    while (/\s/.test(text[next] ?? "") && next < text.length) next++;
    if (text[next] === ":") { const key = JSON.parse(text.slice(start, end + 1)); if (keys.has(key)) throw new Error("Duplicate custody key"); keys.add(key); }
  }
  return JSON.parse(text);
}
export function approvedInput(approvalPath, expectedHash, reservationPath, contextPath, continueId, expectedTeam, accessPlanPath, accessPlanHash) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("Explicit approved SHA256 required");
  const bytes = readFileSync(approvalPath);
  if (sha256(bytes) !== expectedHash) throw new Error("Approved bytes hash mismatch");
  const record = parseDeploymentApproval(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const reservation = readCustodyJson(reservationPath);
  const context = readCustodyJson(contextPath);
  let accessPlan;
  if (accessPlanPath !== undefined || accessPlanHash !== undefined) {
    if (!accessPlanPath || !/^[a-f0-9]{64}$/.test(accessPlanHash ?? "")) throw new Error("Explicit approved access-origin plan hash required");
    accessPlan = readCustodyJson(accessPlanPath, accessPlanHash);
    if (!accessPlan) throw new Error("Invalid access-origin plan");
  }
  verifyIdentity(record, reservation, context, continueId, expectedTeam, accessPlan);
  return { bytes, record, reservation, context, accessPlan };
}
export function packageApproval({ root, approvalPath, expectedHash, reservationPath, contextPath, continueId, expectedTeam, accessPlanPath, accessPlanHash }) {
  const { bytes, record, reservation } = approvedInput(approvalPath, expectedHash, reservationPath, contextPath, continueId, expectedTeam, accessPlanPath, accessPlanHash);
  const directory = join(resolve(root), ".tameion");
  try { if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error("Unsafe package directory"); }
  catch (error) { if (error.code !== "ENOENT") throw error; mkdirSync(directory, { mode: 0o700 }); }
  const destination = join(resolve(root), DEPLOYMENT_APPROVAL_PATH);
  // Exclusive creation: never replace an earlier reservation or owner artifact.
  const fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
  return { generated_origin: reservation.generated_origin, access_origin: record.origins[0], access_origin_mapping: "NOT_YET_VERIFIED", hosted_uat: "NOT_ADMITTED", deployment_id: record.deployment_id, approval_sha256: expectedHash, packaged_path: destination };
}
export function argumentsFor(argv) {
  if (argv.length % 2) throw new Error("Expected named argument/value pairs");
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!key.startsWith("--") || key in result || !argv[index + 1]) throw new Error("Invalid/duplicate argument");
    result[key] = argv[index + 1];
  }
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args = argumentsFor(process.argv.slice(2));
    if (Object.keys(args).filter(key => !["--access-origin-plan", "--access-origin-plan-sha256"].includes(key)).sort().join() !== ["--approval", "--sha256", "--reservation", "--build-context", "--continue-id", "--team-id"].sort().join()) throw new Error("Required: --approval --sha256 --reservation --build-context --continue-id --team-id");
    console.log(JSON.stringify(packageApproval({ root: process.cwd(), approvalPath: args["--approval"], expectedHash: args["--sha256"], reservationPath: args["--reservation"], contextPath: args["--build-context"], continueId: args["--continue-id"], expectedTeam: args["--team-id"], accessPlanPath: args["--access-origin-plan"], accessPlanHash: args["--access-origin-plan-sha256"] })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
