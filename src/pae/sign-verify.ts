import { type KeyObject, sign as nodeSign, verify as nodeVerify } from "node:crypto";

import { paeUnsignedPayloadSchema, type PaeUnsignedPayload, type SealedPae } from "../domain/schemas";
import { canonicalBytes, sha256Hex } from "./canonicalize";
import { resolveTrustedPublicKey } from "./keys";

export class PaeVerificationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "PaeVerificationError";
  }
}

/**
 * Seals a PAE: validates the unsigned payload, canonicalizes it (RFC 8785
 * JCS, UTF-8, no BOM/trailing newline), computes instruction_hash =
 * SHA-256(canonical bytes), then Ed25519-signs that 32-byte digest.
 * instruction_hash/signature are never part of the payload they derive from.
 */
export function sealPae(unsignedPayload: PaeUnsignedPayload, privateKey: KeyObject): SealedPae {
  const validated = paeUnsignedPayloadSchema.parse(unsignedPayload);
  const bytes = canonicalBytes(validated);
  const instructionHash = sha256Hex(bytes);
  const digest = Buffer.from(instructionHash, "hex");
  const signature = nodeSign(null, digest, privateKey);
  return {
    payload: validated,
    instruction_hash: instructionHash,
    signature: signature.toString("hex"),
  };
}

/**
 * Independently repeats schema validation, JCS canonicalization, UTF-8
 * encoding and SHA-256, then verifies the Ed25519 signature over that exact
 * digest using the trusted public key resolved by signing_key_id/algorithm.
 * This is the "verifier" half of the Canonicalization Contract — it must
 * never trust a pre-computed instruction_hash/signature without recomputing
 * both from the payload bytes.
 */
export function verifySealedPae(sealed: SealedPae): void {
  const parseResult = paeUnsignedPayloadSchema.safeParse(sealed.payload);
  if (!parseResult.success) {
    throw new PaeVerificationError(
      `PAE payload schema invalid: ${parseResult.error.message}`,
      "PAE-002",
    );
  }
  const validated = parseResult.data;

  const bytes = canonicalBytes(validated);
  const recomputedHash = sha256Hex(bytes);
  if (recomputedHash !== sealed.instruction_hash) {
    throw new PaeVerificationError(
      "PAE-014: recomputed instruction_hash does not match sealed instruction_hash (canonical payload mismatch)",
      "PAE-014",
    );
  }

  const publicKey = resolveTrustedPublicKey(validated.signing_key_id, validated.signing_algorithm);
  const digest = Buffer.from(sealed.instruction_hash, "hex");
  const signature = Buffer.from(sealed.signature, "hex");
  const signatureValid = nodeVerify(null, digest, publicKey, signature);
  if (!signatureValid) {
    throw new PaeVerificationError("PAE signature verification failed", "PAE-003");
  }
}
