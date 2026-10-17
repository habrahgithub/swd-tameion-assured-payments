import { createHash } from "node:crypto";
import { canonicalize } from "json-canonicalize";

/**
 * RFC 8785 JCS canonicalization + SHA-256, exactly as required by the PAE
 * "Canonicalization Contract": canonical_json = JCS(payload); canonical_bytes
 * = UTF-8 bytes of canonical_json with no BOM, no trailing newline, no
 * transport framing; hash = lowercase hex SHA-256(canonical_bytes).
 */
export function canonicalBytes(value: unknown): Buffer {
  const canonicalJson = canonicalize(value);
  return Buffer.from(canonicalJson, "utf8");
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function canonicalHash(value: unknown): string {
  return sha256Hex(canonicalBytes(value));
}
