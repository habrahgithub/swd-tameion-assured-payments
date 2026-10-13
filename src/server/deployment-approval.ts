import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/** Private server build input. Never import this module into a client component. */
export const DEPLOYMENT_APPROVAL_PATH = ".tameion/deployment-approval.json";
export const MAX_APPROVAL_BYTES = 16_384;
export function canonicalApprovalOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.origin !== value || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname.includes("*") || url.hostname.endsWith(".")) throw new Error("origin");
  return url.origin;
}
const approvalBase = {
  approval_id: z.string().min(1).max(128),
  project_id: z.string().min(1).max(128),
  direct_edge: z.literal(true),
  trusted_proxy_override: z.literal(false),
  origins: z.array(z.string()).min(1).max(8),
};
function canonicalOrigins(record: { origins: string[] }, context: z.RefinementCtx): void {
  try {
    record.origins.forEach(canonicalApprovalOrigin);
    if (new Set(record.origins).size !== record.origins.length) throw new Error("duplicate origin");
  } catch { context.addIssue({ code: "custom", message: "Canonical unique HTTPS origins required" }); }
}
const reservedDeploymentApprovalSchema = z.object({
  ...approvalBase,
  deployment_id: z.string().min(1).max(128),
  environment: z.enum(["preview", "production"]),
}).strict().superRefine(canonicalOrigins);
const gitShaPreviewApprovalSchema = z.object({
  ...approvalBase,
  binding: z.literal("git-sha-preview-v1"),
  git_commit_sha: z.string().regex(/^[0-9a-f]{40}$/),
  environment: z.literal("preview"),
}).strict().superRefine(canonicalOrigins);
export const deploymentApprovalSchema = z.union([reservedDeploymentApprovalSchema, gitShaPreviewApprovalSchema]);
export type DeploymentApproval = z.infer<typeof deploymentApprovalSchema>;
export function parseDeploymentApproval(contents: string): DeploymentApproval {
  if (Buffer.byteLength(contents, "utf8") > MAX_APPROVAL_BYTES) throw new Error("Approval too large");
  return deploymentApprovalSchema.parse(JSON.parse(contents));
}
/** O_NOFOLLOW and a bounded read reject symlinks, nonfiles, and growth after stat.
 * Only ENOENT means absent. Any present/unreadable artifact fails closed. */
export function readPackagedApproval(): DeploymentApproval | undefined {
  let fd: number;
  try { fd = openSync(join(process.cwd(), DEPLOYMENT_APPROVAL_PATH), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_APPROVAL_BYTES) throw new Error("Invalid approval file");
    const bytes = Buffer.alloc(MAX_APPROVAL_BYTES + 1);
    let size = 0;
    while (size < bytes.length) { const count = readSync(fd, bytes, size, bytes.length - size, null); if (!count) break; size += count; }
    if (size > MAX_APPROVAL_BYTES) throw new Error("Approval too large");
    return parseDeploymentApproval(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, size)));
  } finally { closeSync(fd); }
}
export function loadDeploymentApproval(env: Record<string, string | undefined>): DeploymentApproval {
  const packaged = readPackagedApproval();
  const legacy = env.TAMEION_INGRESS_RECORD === undefined ? undefined : parseDeploymentApproval(env.TAMEION_INGRESS_RECORD);
  if (!packaged && !legacy) throw new Error("Approval absent");
  // Schema parsing establishes stable key order; origin order is not authority.
  const fingerprint = (record: DeploymentApproval) => JSON.stringify({ ...record, origins: [...record.origins].sort() });
  if (packaged && legacy && fingerprint(packaged) !== fingerprint(legacy)) throw new Error("Conflicting approval sources");
  return packaged ?? legacy!;
}
