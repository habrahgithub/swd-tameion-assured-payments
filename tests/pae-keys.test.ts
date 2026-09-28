import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PaeKeyError, exportPublicKeySpkiBase64Url, loadServerSigningKey, signingKeyEnvironmentVariableName } from "../src/pae/keys";

const LOGICAL_KEY_ID = "TAMEION-DEMO-PAE-KEY-1";
const ENV_KEY = "PAE_SIGNING_KEY_TAMEION_DEMO_PAE_KEY_1_PEM";
const priorEnvironment: Record<string, string | undefined> = {
  [ENV_KEY]: process.env[ENV_KEY],
  VERCEL_ENV: process.env.VERCEL_ENV,
};

afterEach(() => {
  for (const name of [ENV_KEY, "VERCEL_ENV"]) {
    if (priorEnvironment[name] === undefined) delete process.env[name];
    else process.env[name] = priorEnvironment[name];
  }
  vi.unstubAllEnvs();
});

describe("PAE signing-key environment mapping", () => {
  it("maps the logical demo key to the Vercel-safe name without changing its identity", () => {
    expect(signingKeyEnvironmentVariableName(LOGICAL_KEY_ID)).toBe(ENV_KEY);
    expect(ENV_KEY).toMatch(/^[A-Za-z0-9_]+$/);
    expect(LOGICAL_KEY_ID).toBe("TAMEION-DEMO-PAE-KEY-1");
  });

  it.each(["preview", "production"])("fails closed with PAE-015 when %s has no mapped key", (environment) => {
    delete process.env[ENV_KEY];
    vi.stubEnv("VERCEL_ENV", environment);

    try {
      loadServerSigningKey(LOGICAL_KEY_ID);
      expect.unreachable(`missing ${environment} signing secret must fail closed`);
    } catch (error) {
      expect(error).toBeInstanceOf(PaeKeyError);
      expect((error as PaeKeyError).code).toBe("PAE-015");
    }
  });

  it("reconstructs the same trusted public key from the configured secret after module restart", async () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    process.env[ENV_KEY] = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    delete process.env.VERCEL_ENV;

    const firstProcessKey = loadServerSigningKey(LOGICAL_KEY_ID);
    const firstPublicKey = exportPublicKeySpkiBase64Url(firstProcessKey.publicKey);

    vi.resetModules();
    const restartedKeys = await import("../src/pae/keys");
    const reconstructed = restartedKeys.loadServerSigningKey(LOGICAL_KEY_ID);
    const trustedAfterRestart = restartedKeys.resolveTrustedPublicKey(LOGICAL_KEY_ID, "Ed25519");

    expect(exportPublicKeySpkiBase64Url(reconstructed.publicKey)).toBe(firstPublicKey);
    expect(exportPublicKeySpkiBase64Url(trustedAfterRestart)).toBe(firstPublicKey);
  });
});
