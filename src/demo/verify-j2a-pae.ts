import type { SealedPae } from "../domain/schemas";
import { J2A_PAE_SIGNING_KEY_ID } from "./real-testnet-payment";
import { initializeServerTrustedKey, PaeKeyError } from "../pae/keys";
import { PaeVerificationError, verifySealedPae } from "../pae/sign-verify";

/** Verify J2A envelopes from the fixed server-controlled key boundary on cold runtimes. */
export function verifyJ2aSealedPae(sealed: SealedPae): void {
  if (sealed.payload.signing_key_id !== J2A_PAE_SIGNING_KEY_ID || sealed.payload.signing_algorithm !== "Ed25519") {
    throw new PaeVerificationError("PAE signing identity is not the configured J2A key", "PAE-015");
  }

  try {
    initializeServerTrustedKey(J2A_PAE_SIGNING_KEY_ID);
    verifySealedPae(sealed);
  } catch (error) {
    if (error instanceof PaeVerificationError) throw error;
    if (error instanceof PaeKeyError) {
      throw new PaeVerificationError("Configured J2A PAE trust is unavailable or inconsistent", error.code);
    }
    throw new PaeVerificationError("J2A PAE verification could not be completed", "PAE-016");
  }
}
