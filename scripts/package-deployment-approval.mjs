import { createHash } from "node:crypto";
import { constants, closeSync, mkdirSync, openSync, readFileSync, writeFileSync, lstatSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { DEPLOYMENT_APPROVAL_PATH, parseDeploymentApproval, canonicalApprovalOrigin } from "../src/server/deployment-approval.ts";

export const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
/** Normalized custody inputs must be transcribed/read back from the SAME init
 * reservation and build --id context. This validates them, not their provenance. */
export function verifyIdentity(record, reservation, context, continueId, expectedTeam) {
  const keys = ["deployment_id", "project_id", "environment", "origin", "team_id"];
  if (typeof expectedTeam !== "string" || !expectedTeam || expectedTeam.length > 128) throw new Error("Explicit approved team required");
  for (const value of [reservation, context]) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error("Exact reservation/build identity required");
    for (const key of keys) if (typeof value[key] !== "string" || !value[key] || value[key].length > 2048) throw new Error("Invalid identity");
    if (value.team_id !== expectedTeam || value.environment !== record.environment || value.project_id !== record.project_id || value.deployment_id !== record.deployment_id || record.origins.length !== 1 || canonicalApprovalOrigin(value.origin) !== record.origins[0]) throw new Error("Reservation/build/approval identity mismatch");
  }
  if (continueId !== record.deployment_id) throw new Error("Continuation identity mismatch");
}
export function approvedInput(approvalPath, expectedHash, reservationPath, contextPath, continueId, expectedTeam) {
  if (!/^[a-f0-9]{64}$/.test(expectedHash)) throw new Error("Explicit approved SHA256 required");
  const bytes = readFileSync(approvalPath);
  if (sha256(bytes) !== expectedHash) throw new Error("Approved bytes hash mismatch");
  const record = parseDeploymentApproval(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  const reservation = JSON.parse(readFileSync(reservationPath, "utf8"));
  const context = JSON.parse(readFileSync(contextPath, "utf8"));
  verifyIdentity(record, reservation, context, continueId, expectedTeam);
  return { bytes, record };
}
export function packageApproval({ root, approvalPath, expectedHash, reservationPath, contextPath, continueId, expectedTeam }) {
  const { bytes, record } = approvedInput(approvalPath, expectedHash, reservationPath, contextPath, continueId, expectedTeam);
  const directory = join(resolve(root), ".tameion");
  try { if (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink()) throw new Error("Unsafe package directory"); }
  catch (error) { if (error.code !== "ENOENT") throw error; mkdirSync(directory, { mode: 0o700 }); }
  const destination = join(resolve(root), DEPLOYMENT_APPROVAL_PATH);
  // Exclusive creation: never replace an earlier reservation or owner artifact.
  const fd = openSync(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
  return { deployment_id: record.deployment_id, approval_sha256: expectedHash, packaged_path: destination };
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
    if (Object.keys(args).sort().join() !== ["--approval", "--sha256", "--reservation", "--build-context", "--continue-id", "--team-id"].sort().join()) throw new Error("Required: --approval --sha256 --reservation --build-context --continue-id --team-id");
    console.log(JSON.stringify(packageApproval({ root: process.cwd(), approvalPath: args["--approval"], expectedHash: args["--sha256"], reservationPath: args["--reservation"], contextPath: args["--build-context"], continueId: args["--continue-id"], expectedTeam: args["--team-id"] })));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
