import {
  type KeyObject,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
} from "node:crypto";

export class PaeKeyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "PaeKeyError";
  }
}

export interface Ed25519KeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKey };
}

/** base64url (no padding) of the DER SubjectPublicKeyInfo bytes, per the PAE Wire Encoding Contract. */
export function exportPublicKeySpkiBase64Url(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.toString("base64url");
}

export function importPublicKeySpkiBase64Url(base64url: string): KeyObject {
  const der = Buffer.from(base64url, "base64url");
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

export function importPrivateKeyPem(pem: string): KeyObject {
  return createPrivateKey(pem);
}

export function exportPrivateKeyPem(privateKey: KeyObject): string {
  return privateKey.export({ type: "pkcs8", format: "pem" }).toString();
}

/**
 * Versioned trusted-key registry entry: what the Execution Worker looks up
 * by signing_key_id + signing_algorithm to verify a PAE it did not sign.
 * Public keys are not secret and may live in normal (non-secret) config.
 */
export interface TrustedKeyEntry {
  signing_key_id: string;
  signing_algorithm: "Ed25519";
  public_key_spki_base64url: string;
  status: "ACTIVE" | "REVOKED";
}

const registry = new Map<string, TrustedKeyEntry>();

export function registerTrustedKey(entry: TrustedKeyEntry): void {
  registry.set(entry.signing_key_id, entry);
}

export function resolveTrustedPublicKey(signingKeyId: string, signingAlgorithm: string): KeyObject {
  const entry = registry.get(signingKeyId);
  if (!entry) {
    throw new PaeKeyError(`Unknown signing_key_id "${signingKeyId}"`, "PAE-015");
  }
  if (entry.signing_algorithm !== signingAlgorithm) {
    throw new PaeKeyError(
      `signing_algorithm mismatch for "${signingKeyId}": expected ${entry.signing_algorithm}`,
      "PAE-015",
    );
  }
  if (entry.status !== "ACTIVE") {
    throw new PaeKeyError(`signing_key_id "${signingKeyId}" is ${entry.status}`, "PAE-015");
  }
  return importPublicKeySpkiBase64Url(entry.public_key_spki_base64url);
}

export function revokeTrustedKey(signingKeyId: string): void {
  const entry = registry.get(signingKeyId);
  if (entry) {
    registry.set(signingKeyId, { ...entry, status: "REVOKED" });
  }
}

/**
 * Loads the server-side private signing key for `signingKeyId` from the
 * server secret boundary (env var `PAE_SIGNING_KEY_<ID>_PEM`), registering
 * its public half as trusted if not already known.
 *
 * KNOWN PROTOTYPE LIMITATION: no live signing key is provisioned in this
 * environment (no Vercel/production secret access from this build). When
 * no key is configured and NODE_ENV is not "production", an ephemeral
 * Ed25519 key is generated once per process and cached, so the golden path
 * and tests run end-to-end without live secrets. This ephemeral key must
 * never be used for J2 (governs only mocked/testnet-fixture execution) and
 * must be replaced with a real server-managed key before any live PAE is
 * sealed against a genuine obligation.
 */
const devSigningKeys = new Map<string, Ed25519KeyPair>();

export function loadServerSigningKey(signingKeyId: string): Ed25519KeyPair {
  const envVar = `PAE_SIGNING_KEY_${signingKeyId}_PEM`;
  const pem = process.env[envVar];
  if (pem) {
    const privateKey = importPrivateKeyPem(pem);
    const publicKey = createPublicKey(privateKey);
    registerTrustedKey({
      signing_key_id: signingKeyId,
      signing_algorithm: "Ed25519",
      public_key_spki_base64url: exportPublicKeySpkiBase64Url(publicKey),
      status: "ACTIVE",
    });
    return { privateKey, publicKey };
  }

  if (process.env.NODE_ENV === "production") {
    throw new PaeKeyError(
      `No signing key configured for "${signingKeyId}" (expected ${envVar}); refusing to fabricate one in production`,
      "PAE-015",
    );
  }

  let pair = devSigningKeys.get(signingKeyId);
  if (!pair) {
    pair = generateEd25519KeyPair();
    devSigningKeys.set(signingKeyId, pair);
    registerTrustedKey({
      signing_key_id: signingKeyId,
      signing_algorithm: "Ed25519",
      public_key_spki_base64url: exportPublicKeySpkiBase64Url(pair.publicKey),
      status: "ACTIVE",
    });
    // eslint-disable-next-line no-console
    console.warn(
      `[pae/keys] PROTOTYPE ONLY: generated an ephemeral dev signing key for "${signingKeyId}" ` +
        `because ${envVar} is not set. Never use this outside mocked/testnet-fixture execution.`,
    );
  }
  return pair;
}
