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

export class TrustedKeyRegistry {
  private readonly entries = new Map<string, TrustedKeyEntry>();

  register(entry: TrustedKeyEntry): void {
    const existing = this.entries.get(entry.signing_key_id);
    if (existing?.status === "REVOKED" && entry.status === "ACTIVE") {
      throw new PaeKeyError(`Revoked signing_key_id "${entry.signing_key_id}" cannot be reactivated`, "PAE-015");
    }
    if (existing && (
      existing.signing_algorithm !== entry.signing_algorithm ||
      existing.public_key_spki_base64url !== entry.public_key_spki_base64url
    )) {
      throw new PaeKeyError(`Conflicting trusted material for "${entry.signing_key_id}"`, "PAE-015");
    }
    this.entries.set(entry.signing_key_id, { ...entry });
  }

  /** Public verification material is durable state; private signing bytes never enter this snapshot. */
  export(): TrustedKeyEntry[] {
    return [...this.entries.values()]
      .map((entry) => ({ ...entry }))
      .sort((left, right) => left.signing_key_id.localeCompare(right.signing_key_id));
  }

  /** Restore durable entries without allowing stale snapshots to reactivate local revocations. */
  restore(value: unknown): void {
    for (const entry of parseTrustedKeyRegistry(value)) {
      const existing = this.entries.get(entry.signing_key_id);
      if (existing && (
        existing.signing_algorithm !== entry.signing_algorithm ||
        existing.public_key_spki_base64url !== entry.public_key_spki_base64url ||
        (existing.status === "REVOKED" && entry.status === "ACTIVE")
      )) {
        throw new PaeKeyError(`Persisted trust conflicts with current key state for "${entry.signing_key_id}"`, "PAE-015");
      }
      this.entries.set(entry.signing_key_id, { ...entry });
    }
  }

  resolve(signingKeyId: string, signingAlgorithm: string): KeyObject {
    const entry = this.entries.get(signingKeyId);
    if (!entry) throw new PaeKeyError(`Unknown signing_key_id "${signingKeyId}"`, "PAE-015");
    if (entry.signing_algorithm !== signingAlgorithm) {
      throw new PaeKeyError(`signing_algorithm mismatch for "${signingKeyId}"`, "PAE-015");
    }
    if (entry.status !== "ACTIVE") throw new PaeKeyError(`signing_key_id "${signingKeyId}" is ${entry.status}`, "PAE-015");
    return importPublicKeySpkiBase64Url(entry.public_key_spki_base64url);
  }

  revoke(signingKeyId: string): void {
    const entry = this.entries.get(signingKeyId);
    if (!entry) throw new PaeKeyError(`Unknown signing_key_id "${signingKeyId}"`, "PAE-015");
    this.entries.set(signingKeyId, { ...entry, status: "REVOKED" });
  }

  initializeServerTrustedKey(signingKeyId: string): void {
    const envVar = signingKeyEnvironmentVariableName(signingKeyId);
    const pem = process.env[envVar];
    if (!pem) throw new PaeKeyError(`No server signing key configured for "${signingKeyId}"`, "PAE-015");
    let publicKeySpki: string;
    try {
      const privateKey = importPrivateKeyPem(pem);
      const publicKey = createPublicKey(privateKey);
      if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Unexpected key type");
      publicKeySpki = exportPublicKeySpkiBase64Url(publicKey);
    } catch {
      throw new PaeKeyError("Configured server signing key is invalid", "PAE-015");
    }
    const existing = this.entries.get(signingKeyId);
    if (existing) {
      if (existing.status !== "ACTIVE" || existing.public_key_spki_base64url !== publicKeySpki) {
        throw new PaeKeyError(`Configured server key does not match active trust for "${signingKeyId}"`, "PAE-015");
      }
      return;
    }
    this.register({
      signing_key_id: signingKeyId,
      signing_algorithm: "Ed25519",
      public_key_spki_base64url: publicKeySpki,
      status: "ACTIVE",
    });
  }

  loadServerSigningKey(signingKeyId: string): Ed25519KeyPair {
    return loadServerSigningKey(signingKeyId, this);
  }
}

export function parseTrustedKeyRegistry(value: unknown): TrustedKeyEntry[] {
  if (!Array.isArray(value)) throw new PaeKeyError("Persisted trusted-key registry is malformed", "PAE-015");
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new PaeKeyError("Persisted trusted-key entry is malformed", "PAE-015");
    }
    const entry = item as Record<string, unknown>;
    const allowedProperties = new Set(["signing_key_id", "signing_algorithm", "public_key_spki_base64url", "status"]);
    if (Object.keys(entry).some((key) => !allowedProperties.has(key)) ||
        typeof entry.signing_key_id !== "string" || !entry.signing_key_id ||
        entry.signing_algorithm !== "Ed25519" || typeof entry.public_key_spki_base64url !== "string" ||
        !/^[A-Za-z0-9_-]+$/.test(entry.public_key_spki_base64url) ||
        (entry.status !== "ACTIVE" && entry.status !== "REVOKED") || seen.has(entry.signing_key_id)) {
      throw new PaeKeyError("Persisted trusted-key entry is invalid or duplicated", "PAE-015");
    }
    try {
      const publicKey = importPublicKeySpkiBase64Url(entry.public_key_spki_base64url);
      if (publicKey.asymmetricKeyType !== "ed25519") throw new Error("Unexpected key type");
    } catch {
      throw new PaeKeyError("Persisted trusted-key public material is invalid", "PAE-015");
    }
    seen.add(entry.signing_key_id);
    return {
      signing_key_id: entry.signing_key_id,
      signing_algorithm: "Ed25519",
      public_key_spki_base64url: entry.public_key_spki_base64url,
      status: entry.status,
    };
  });
}

/** Process-local registry reserved for callers without persisted state ownership. */
export const processTrustedKeyRegistry = new TrustedKeyRegistry();

export function registerTrustedKey(entry: TrustedKeyEntry, registry = processTrustedKeyRegistry): void {
  registry.register(entry);
}

export function exportTrustedKeyRegistry(registry = processTrustedKeyRegistry): TrustedKeyEntry[] {
  return registry.export();
}

export function restoreTrustedKeyRegistry(value: unknown, registry = processTrustedKeyRegistry): void {
  registry.restore(value);
}

export function resolveTrustedPublicKey(signingKeyId: string, signingAlgorithm: string, registry = processTrustedKeyRegistry): KeyObject {
  return registry.resolve(signingKeyId, signingAlgorithm);
}

/**
 * Initialize verification trust from the server-managed signing key without
 * replacing an existing trust decision. Unlike the signing loader, this has
 * no development-key fallback and never reactivates a revoked key.
 */
export function initializeServerTrustedKey(signingKeyId: string, registry = processTrustedKeyRegistry): void {
  registry.initializeServerTrustedKey(signingKeyId);
}

export function revokeTrustedKey(signingKeyId: string, registry = processTrustedKeyRegistry): void {
  registry.revoke(signingKeyId);
}

const signingKeyEnvironmentNameOverrides: Readonly<Record<string, string>> = {
  "TAMEION-DEMO-PAE-KEY-1": "PAE_SIGNING_KEY_TAMEION_DEMO_PAE_KEY_1_PEM",
};

/**
 * Resolve a logical PAE key identity to a deployable environment-variable
 * name. The explicit demo mapping stays readable; other IDs use an
 * injective UTF-8 hex encoding so punctuation cannot create invalid names
 * or collide with a different logical key ID.
 */
export function signingKeyEnvironmentVariableName(signingKeyId: string): string {
  const mapped = signingKeyEnvironmentNameOverrides[signingKeyId];
  if (mapped) return mapped;
  const encodedId = Buffer.from(signingKeyId, "utf8").toString("hex").toUpperCase();
  return `PAE_SIGNING_KEY_HEX_${encodedId}_PEM`;
}

/**
 * Loads the server-side private signing key for `signingKeyId` from the
 * server secret boundary, registering its public half as trusted if not
 * already known. The environment-variable name is resolved separately from
 * the logical key ID embedded in the PAE.
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

export function loadServerSigningKey(signingKeyId: string, registry = processTrustedKeyRegistry): Ed25519KeyPair {
  const envVar = signingKeyEnvironmentVariableName(signingKeyId);
  const pem = process.env[envVar];
  if (pem) {
    const privateKey = importPrivateKeyPem(pem);
    const publicKey = createPublicKey(privateKey);
    const publicKeySpki = exportPublicKeySpkiBase64Url(publicKey);
    const existing = registry.export().find((entry) => entry.signing_key_id === signingKeyId);
    if (existing && (
      existing.status !== "ACTIVE" || existing.signing_algorithm !== "Ed25519" ||
      existing.public_key_spki_base64url !== publicKeySpki
    )) {
      throw new PaeKeyError(`Configured server key does not match active trust for "${signingKeyId}"`, "PAE-015");
    }
    if (!existing) registry.register({
      signing_key_id: signingKeyId,
      signing_algorithm: "Ed25519",
      public_key_spki_base64url: publicKeySpki,
      status: "ACTIVE",
    });
    return { privateKey, publicKey };
  }

  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "preview" || process.env.VERCEL_ENV === "production") {
    throw new PaeKeyError(
      `No signing key configured for "${signingKeyId}" (expected ${envVar}); refusing to fabricate one in production`,
      "PAE-015",
    );
  }

  let pair = devSigningKeys.get(signingKeyId);
  if (!pair) {
    pair = generateEd25519KeyPair();
    devSigningKeys.set(signingKeyId, pair);
    // eslint-disable-next-line no-console
    console.warn(
      `[pae/keys] PROTOTYPE ONLY: generated an ephemeral dev signing key for "${signingKeyId}" ` +
        `because ${envVar} is not set. Never use this outside mocked/testnet-fixture execution.`,
    );
  }
  const publicKeySpki = exportPublicKeySpkiBase64Url(pair.publicKey);
  const existing = registry.export().find((entry) => entry.signing_key_id === signingKeyId);
  if (existing && (existing.status !== "ACTIVE" || existing.public_key_spki_base64url !== publicKeySpki)) {
    throw new PaeKeyError(`Configured server key does not match active trust for "${signingKeyId}"`, "PAE-015");
  }
  if (!existing) {
    registry.register({
      signing_key_id: signingKeyId,
      signing_algorithm: "Ed25519",
      public_key_spki_base64url: publicKeySpki,
      status: "ACTIVE",
    });
  }
  return pair;
}
