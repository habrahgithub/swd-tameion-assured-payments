import { describe, expect, it } from "vitest";

import { AuthorityStore, type AuthorityAggregate } from "../src/authority/aggregate";
import { approveAndSealPae } from "../src/pipeline/authorize-and-seal";
import { buildJ2PrimeApprovalPacket, renderJ2PrimeApprovalPacketText } from "../src/pipeline/prime-approval-packet";
import { currentAssessmentReview, sealTestAssessment } from "./test-support/seal-assessment";

function baseAggregate(): AuthorityAggregate {
  return {
    organization_id: "ORG-DEMO-001",
    obligation_id: "OBL-J0C-003",
    aggregate_version: 1,
    state: "APPROVAL_PENDING",
    amount: "5.000000",
    asset: "USDC",
    network: "ARC_TESTNET",
    counterparty_id: "CP-J0C-003",
    counterparty_version: 1,
    counterparty_status: "VERIFIED",
    destination_ref: "DEST-J0C-003",
    destination_version: 1,
    product_trust_provenance: "CURRENT_PRODUCT_EVIDENCE",
    destination_address: `0x${"7".repeat(40)}`,
    destination_verification_status: "VERIFIED",
    destination_operational_status: "ACTIVE",
    source_wallet_ref: "WALLET-SOURCE-P0-1",
    source_wallet_version: 1,
    source_wallet_status: "ACTIVE",
    evidence_hashes: [],
    policy_version: "POLICY-P0-1",
    business_hold: false,
    security_freeze: false,
    external_settlement_state: "NONE",
    pae_state: "UNUSED",
    execution_state: "NONE",
    execution_idempotency_key: null,
    reviewed_aggregate_version: null,
  };
}

describe("J2 Prime approval packet", () => {
  it("discloses exact obligation/version/amount/network/wallet/destination/PAE identity", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate());
    sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-003", 1);
    const { sealed } = approveAndSealPae(store, "PACKET-TEST-KEY", {
      organizationId: "ORG-DEMO-001",
      obligationId: "OBL-J0C-003",
      expectedVersion: 1,
      ...currentAssessmentReview(store, "ORG-DEMO-001", "OBL-J0C-003"),
      actorId: "USR-1",
      actorRole: "FINANCE_APPROVER",
      policyVersion: "POLICY-P0-1",
      reasonText: "Reviewed for the Prime approval packet test.",
    });

    const packet = buildJ2PrimeApprovalPacket(sealed, () => new Date("2026-09-28T12:00:00.000Z"));

    expect(packet.obligation_id).toBe("OBL-J0C-003");
    expect(packet.obligation_version).toBe("2"); // post-approval N+1
    expect(packet.amount).toBe("5.000000 USDC");
    expect(packet.network).toBe("ARC_TESTNET");
    expect(packet.source_wallet_identity).toContain("WALLET-SOURCE-P0-1");
    expect(packet.destination_identity).toContain("0x7777777777777777777777777777777777777777");
    expect(packet.pae_instruction_hash).toBe(sealed.instruction_hash);
    expect(packet.pae_signing_key_id).toBe("PACKET-TEST-KEY");

    // fingerprints are deterministic hashes, not raw secrets, and differ
    // for different wallet/destination identities.
    expect(packet.source_wallet_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(packet.destination_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(packet.source_wallet_fingerprint).not.toBe(packet.destination_fingerprint);

    const text = renderJ2PrimeApprovalPacketText(packet);
    expect(text).toContain("EXACT INTENT FOR PRIME APPROVAL");
    expect(text).toContain(packet.pae_instruction_hash);
    expect(text).toContain("Nothing is submitted until Prime explicitly approves");
  });

  it("produces a different fingerprint if the destination version changes (material change detectability)", () => {
    const store = new AuthorityStore();
    store.seed(baseAggregate());
    sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-003", 1);
    const { sealed: first } = approveAndSealPae(store, "PACKET-TEST-KEY-2", {
      organizationId: "ORG-DEMO-001",
      obligationId: "OBL-J0C-003",
      expectedVersion: 1,
      ...currentAssessmentReview(store, "ORG-DEMO-001", "OBL-J0C-003"),
      actorId: "USR-1",
      actorRole: "FINANCE_APPROVER",
      policyVersion: "POLICY-P0-1",
      reasonText: "First approval.",
    });
    const packetA = buildJ2PrimeApprovalPacket(first);

    store.applyMaterialChange("ORG-DEMO-001", "OBL-J0C-003", 2, {
      destination_ref: "DEST-J0C-003-V2",
      destination_version: 2,
      destination_address: `0x${"8".repeat(40)}`,
    });
    // The material change invalidated the version-1 sealed assessment
    // (fail-closed tamper detection) — a fresh assessment bound to the new
    // version is required before this obligation can be re-approved.
    sealTestAssessment(store, "ORG-DEMO-001", "OBL-J0C-003", 3);
    const latest = currentAssessmentReview(store, "ORG-DEMO-001", "OBL-J0C-003");
    store.approve("ORG-DEMO-001", "OBL-J0C-003", 3, latest.reviewedAssessmentId, latest.reviewedAssessmentHash);
    // Re-seal manually isn't needed; just prove the fingerprint function is
    // sensitive to destination identity by comparing to a hand-built payload.
    expect(packetA.destination_fingerprint).not.toBe(
      buildJ2PrimeApprovalPacket({
        ...first,
        payload: { ...first.payload, destination_ref: "DEST-J0C-003-V2", destination_version: "2" },
      }).destination_fingerprint,
    );
  });
});
