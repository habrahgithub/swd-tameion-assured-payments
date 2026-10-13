import { constants, closeSync, lstatSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OPERATOR_SOURCE_PATH, parseOperatorSource } from "./package-operator-source.mjs";

function materialize(root = process.cwd(), env = process.env) {
  const document = env.TAMEION_OPERATOR_SOURCE_DOCUMENT;
  const expectedHash = env.TAMEION_OPERATOR_SOURCE_SHA256;
  if (document === undefined && expectedHash === undefined) return { provisioning: "HOSTED_BUILD_SOURCE_ABSENT" };
  if (!document || !expectedHash) throw new Error("Incomplete hosted source input");
  const bytes = Buffer.from(document, "utf8");
  const view = parseOperatorSource(bytes, expectedHash);
  const directory = join(resolve(root), ".tameion");
  try {
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsafe source directory");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    mkdirSync(directory, { mode: 0o700 });
  }
  const path = join(resolve(root), OPERATOR_SOURCE_PATH);
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
  return { record_count: view.records.length, purpose: "OPERATOR_VIEW_ONLY", provisioning: "HOSTED_BUILD_BYTES_ONLY" };
}

try { console.log(JSON.stringify(materialize())); }
catch { console.error("HOSTED_OPERATOR_SOURCE_MATERIALIZATION_REJECTED"); process.exitCode = 1; }
