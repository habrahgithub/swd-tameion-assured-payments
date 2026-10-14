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

## Pre-UAT correction R1

Authority: [AXIS adjudication](https://github.com/habrahgithub/swd-tameion-assured-payments/issues/65#issuecomment-6169098517), baseline `2315ccb58d042d502222ad78bd7b0585206c8588`.

RCA: the first projection collapsed missing consent, stale consent and unavailable runtime into the same actionable state. The release route also returned a plain access refusal when readback failed after a successful save. The final requester callback ran before an awaited durable reload, leaving its earlier expiry observation stale at the send boundary. These defects arose at the read-projection, save/readback and final-send seams; fixing presentation alone would leave the underlying decisions inconsistent.

R1 distinguishes current, renewal-required and unavailable release states, exposes only approval time/expiry/actor metadata to the browser, and reports post-save failures as unverified outcomes requiring read-only confirmation. It does not renew or replace consent for the same PAE. Approval remains separate from submission and uses a checkbox.

New `PORTAL-RELEASE-2` records bind the canonical financial source and requester envelopes. Those verified envelopes include the deployment/origin/ingress binding. Version-1 records remain readable archival evidence and grant no execution capability; missing consent on old snapshots remains missing. Nothing silently upgrades historic authority. The optional existing snapshot field and CAS are reused without SQL changes.

The digest is unkeyed integrity evidence, not author authentication. Authenticity relies on the authenticated server, verified operator/requester and actor authority, server-only repository capability, protected database grants, and the signed PAE. A privileged database writer could fabricate an additional release record for a signed instruction. Direct envelope binding prevents stale or foreign-envelope reuse but does not remove that trusted-database risk. Independent/AXIS security disposition is required before live release; no production risk acceptance or new signing architecture is implied.

After the last awaited durable reload, the canonical worker invokes a synchronous requester capability that verifies current source/requester envelopes and validity plus the freshly loaded exact release record. Expiry equality refuses before `createTransaction`. This addresses time spent in the RPC, but no software check promises zero latency between validation and network arrival. Existing claim, PAE, fee, actor and at-most-once semantics remain authoritative.

Regression evidence covers all-provider-method denial during approval, stale/legacy/credential/actor/envelope/read-context/runtime cases, post-save authentication loss, old snapshot load/flush, concurrent release versus execute, and final expiry crossing with a just-before-expiry control. Source inspection confirms snapshot RPCs return/store the full JSON object; a live database roundtrip remains unverified. Existing legacy env-gated handlers remain internal test fixtures; the HTTP route census and import constraints must continue to show no hosted bypass.


### Independent review follow-up

The independent R1 review returned bounded offline PASS, with no P0/P1 path found. API post-save uncertainty was correct, but the client did not render release/execute failures. Both fresh and duplicate POST approvals also returned the full server record despite the minimized GET projection. The follow-up renders selection-bound action feedback even if refreshed detail becomes unavailable, and returns only the same three display fields on fresh/replayed approvals. Lifecycle rollup and workspace copy reuse the authoritative renewal/unavailable guidance. The synchronous final-send capability now refuses a missing required release instead of silently returning.

Additional regressions invoke the production GET reader with the actual verified source/requester files to prove binding parity, and advance real release validity at the final durable reload before calling the production matcher. Equality refuses; the just-before-expiry control submits once through the mocked provider. No automatic renewal or live effect is added. Separate missing-row visibility after the financial source window expires remains open and is not claimed corrected by this work. Live DB roundtrip, N4 trusted-database security disposition, hosted exact-head proof and original003 NO_RETRY remain unchanged gates.

### Job65 consolidated offline correction

Under [the consolidated admission](https://github.com/habrahgithub/swd-tameion-assured-payments/issues/65#issuecomment-6170447368), execute uncertainty now explains that payment may have been submitted, prohibits retry, and directs the operator to refresh and read-only reconciliation. HTTP 202 with an UNKNOWN/reconciliation-only outcome also retains visible feedback even though its HTTP receipt succeeded; lost GET cannot turn that outcome into a resolved payment. An unresolved execute response suppresses another Pay or release action within the mounted session even when GET returns an unchanged pre-send gate. This is an additional client guard; durable server idempotency remains the financial boundary.

Financial response feedback retains its obligation, instruction hash, packet hash and version across selection changes, including a late A→B→A response. A release uncertainty banner is superseded only when fresh GET confirms current release approval for that exact instruction, packet and version. Execute uncertainty is superseded only by a matching validated historical packet and a resolved durable execution record. UNKNOWN/SUBMITTING, absent historical binding, changed identity and lost GET retain uncertainty. Confirmation does not turn an HTTP failure into HTTP success or establish settlement by itself. No browser storage, automatic POST, renewal or reconciliation call is added.

Renewal-required and unavailable release gates are blocked in the lifecycle rollup and share the existing Payment/recovery guidance, including production AUTHORIZED N+1 records whose current stage remains Assurance. Assurance evidence remains visible alongside the blocked release guidance; the contextual action strip also explains that gate. Recorded executions, terminal authority and emergency stops retain priority. Tests restore a real V2 snapshot through `loadExistingDemoState` and the production GET reader using only mocked `tameion_state_load_existing` RPC, including namespace filtering, credential/operator/actor changes, envelope mismatches, expiration, missing Circle runtime presence and tampering. These prove offline parsing and projection parity, not live persistence or hosted configuration.

The production route's synchronous send callback requires release context; a regression proves absent context yields PAYMENT_RELEASE_REQUIRED with no write/provider effect. The generic worker's optional callback remains unchanged: its supported callers include simulated demos and the nonportal J2a real-testnet state. Adapter name alone cannot distinguish admitted portal and nonportal semantics. A generic API requirement needs a separately scoped caller/authority decision.

### Historical controlled-source viewing: retained architecture decision

The active-only financial source reader intentionally stops returning the controlled row at financial expiry. That is not evidence of deletion or payment. Expired financial authorization cannot authorize a continuing view. The existing OPERATOR_VIEW_ONLY packet is exactly five records in one revision/hash-bound namespace; it cannot add a sixth row in another namespace by configuration alone.

The minimal proposed change requires AXIS/owner approval for a separate finite historical-view packet, explicitly binding the historical obligation, original source provenance, existing financial namespace, snapshot revision/authority digest, current operator/access context and permitted read projection. It would reuse existing-state restoration with `financial_action_eligible=false`, no provider I/O, no seeding and no source/requester renewal. A historical reader must not invoke the active financial admission path or expose an actionable release/execute capability. Names and schema for that packet are proposals, not current configuration or authorized implementation.

Affected seams for a future admission: source-view parser/packager and server-only provisioning, authenticated obligation membership/loading, existing-state binding verification and historical projections, then UI display and negative tests. Source/requester expiry enforcement and all POST financial gates remain unchanged. The owner must decide permitted record fields, namespace membership, access expiry/revocation and snapshot binding lifecycle. This bundle returns AXIS_REQUIRED for that viewing seam and a private RCA/design/owner packet; it does not implement historical access or claim restored visibility.

The release digest remains unkeyed integrity. A privileged writer controlling the trusted snapshot/CAS boundary can fabricate release consent for an already signed instruction and can alter actor/trusted-key material. Before live release, the security owner must explicitly adjudicate that trust boundary and protected DB grants, or require a separately admitted authenticity design. There is no security waiver in this candidate.
