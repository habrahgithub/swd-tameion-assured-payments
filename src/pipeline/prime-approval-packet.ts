import { sha256Hex } from "../pae/canonicalize";
import type { SealedPae } from "../domain/schemas";

/**
 * The exact-intent disclosure Prime must see and explicitly approve before
 * ANY real J2 Arc Testnet product transfer, per the retained Prime gate in
 * DIR-TAMEION-PROTOTYPE-CLAUDE-001 ("Actual J2 product testnet transfer"):
 *   obligation/version; amount; asset; network; source wallet identity/
 *   fingerprint; destination identity/fingerprint; authorization/PAE
 *   identity.
 *
 * This module only builds and renders that disclosure from an already-
 * sealed PAE — it never submits anything and has no reference to the
 * Execution Worker or any provider adapter. Producing a packet is not an
 * approval and not a submission; it is the artifact a human reviews before
 * either happens.
 */
export interface J2PrimeApprovalPacket {
  obligation_id: string;
  obligation_version: string;
  amount: string;
  asset: string;
  network: string;
  source_wallet_identity: string;
  source_wallet_fingerprint: string;
  destination_identity: string;
  destination_fingerprint: string;
  pae_instruction_id: string;
  pae_instruction_hash: string;
  pae_signing_key_id: string;
  pae_expiry: string;
  generated_at: string;
}

export function buildJ2PrimeApprovalPacket(sealed: SealedPae, now: () => Date = () => new Date()): J2PrimeApprovalPacket {
  const { payload } = sealed;
  return {
    obligation_id: payload.obligation_ids[0],
    obligation_version: payload.aggregate_version,
    amount: `${payload.amount} ${payload.asset}`,
    asset: payload.asset,
    network: payload.network,
    source_wallet_identity: `${payload.source_wallet_ref} v${payload.source_wallet_version}`,
    source_wallet_fingerprint: sha256Hex(Buffer.from(`${payload.source_wallet_ref}:${payload.source_wallet_version}`, "utf8")),
    destination_identity: `${payload.destination_ref} v${payload.destination_version} (${payload.destination_address})`,
    destination_fingerprint: sha256Hex(
      Buffer.from(`${payload.destination_ref}:${payload.destination_version}:${payload.destination_address}`, "utf8"),
    ),
    pae_instruction_id: payload.instruction_id,
    pae_instruction_hash: sealed.instruction_hash,
    pae_signing_key_id: payload.signing_key_id,
    pae_expiry: payload.expiry,
    generated_at: now().toISOString().replace(/(\.\d{3})\d*Z$/, "$1Z"),
  };
}

/** Human-readable rendering for a Prime approval request (chat/GitHub comment/UI). */
export function renderJ2PrimeApprovalPacketText(packet: J2PrimeApprovalPacket): string {
  return [
    "J2 REAL TESTNET TRANSFER — EXACT INTENT FOR PRIME APPROVAL",
    "This is a request to approve ONE real Arc Testnet USDC transfer. Nothing is submitted until Prime explicitly approves this exact intent.",
    "",
    `Obligation:            ${packet.obligation_id} (authority version ${packet.obligation_version})`,
    `Amount:                ${packet.amount}`,
    `Network:               ${packet.network}`,
    `Source wallet:         ${packet.source_wallet_identity}`,
    `Source fingerprint:    ${packet.source_wallet_fingerprint}`,
    `Destination:           ${packet.destination_identity}`,
    `Destination fingerprint: ${packet.destination_fingerprint}`,
    `PAE instruction id:    ${packet.pae_instruction_id}`,
    `PAE instruction hash:  ${packet.pae_instruction_hash}`,
    `PAE signing key id:    ${packet.pae_signing_key_id}`,
    `PAE expiry:            ${packet.pae_expiry}`,
    `Generated at:          ${packet.generated_at}`,
    "",
    "Approving this packet is not the same as approving any other obligation, amount, destination, or PAE — a changed value requires a new packet.",
  ].join("\n");
}
