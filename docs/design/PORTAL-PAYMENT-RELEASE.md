# Portal payment release — Job 65 / PR 70

Status: implementation candidate; independent assurance and deployment remain separate gates.
Baseline: `18ec4c750698c639214aaacf022988bc69ee9857`.
Authority: [Job 65 scoped admission](https://github.com/habrahgithub/swd-tameion-assured-payments/issues/65#issuecomment-6166701634).

## Research and root cause

1. Why did Payment end without an action? The UI suppressed submission while final release authority was absent.
2. Why was authority absent after instruction authorization? Authorization sealed a PAE; final release required another exact-packet approval.
3. Why could the operator not record that approval? No authenticated portal release action existed.
4. Why did this require configuration and redeployment? Execution used `J2A_EXECUTION_AUTHORIZED_PACKET_SHA256` as the final release gate.
5. Why was this a persistent usability defect? An operational deployment control was serving as a per-instruction business approval mechanism.

The violated journey invariant was that an eligible, authenticated approver must have a visible action for the next permissible decision. The causal owner is the financial route/read projection/UI boundary. The correction retains separate instruction authorization, deterministic controls, final release consent and submission.

## Design and implementation

On Payment, review the full source wallet and recipient, testnet principal, fee estimate and planning limits. Check confirmation and choose **Approve payment release**. The server derives identity from the authenticated operator and existing designated approver. It derives timestamps and expiry, verifies current instruction provenance, and persists a canonical, hash-protected release record using the existing snapshot compare-and-set operation. This action neither queries Circle nor submits payment.

Only a refreshed detail response confirming durable approval exposes **Pay testnet USDC**. Consent resets when the obligation, packet, PAE or gate changes. Confirm again before submitting once. Approval never automatically submits. The execution worker retains the existing authoritative PAE, source, requester, session, idempotency, fee and reconciliation checks. Its requester callback additionally reloads the durable release immediately before provider submission.

Release records bind organization, obligation/version, namespace, packet and PAE hashes, idempotency key, actor role/authority version, operator credential version and approval window. Expiry cannot exceed the instruction, source, requester or actor window. Duplicate matching approvals are idempotent; conflicting replacements are refused. A recorded execution is reconciliation-only. Missing, stale, expired, tampered or changed approval never grants execution authority.

## Compatibility and deployment boundary

The optional `payment_release_approvals` field uses the existing version-2 snapshot. Old snapshots restore without release authority; no table or migration is added. Both state implementations preserve archived approvals when exporting. The read-only loader performs no provider I/O or writes. An environment hash alone no longer opens the hosted execution gate. Internal legacy test-only route modules retain their historical fixtures and are not HTTP entry points.

A new candidate deployment still needs valid ingress, source and requester provisioning and independent exact-head assurance. Existing deployment approval is not transferred to a new head. Existing sealed instructions and packet provenance must not be silently rebound across deployment identities. This implementation does not deploy, change the live snapshot, submit or retry a payment. Original commercial obligation 003 remains UNKNOWN / NO_RETRY.

## Verification and stop

RED demonstrated environment-only execution succeeding without a durable portal release. Regression coverage requires release persistence and cold reload, exact identity and expiry, forged body rejection, duplicate/concurrent approval, CAS uncertainty, revocation before send, no provider calls during approval, and at-most-once submission. UI checks cover CSRF, explicit consent, reset after approval, no automatic payment, mobile/desktop visibility, stale/blocked/revoked states and contrast.

Stop at one review-ready candidate on the existing branch/PR. Local mocked verification is supporting evidence; live UAT, provider-backed settlement and independent financial/security assurance remain unverified until separately performed.
