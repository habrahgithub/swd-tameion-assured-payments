# Demo Evidence & Screenshots Checklist (Issue #42 / TAMEION-DEMO-PREP-001)

Evidence-capture map tied to PASS/HOLD/BLOCK states. Mark each item **PASS**
before declaring the demo honest. A checked box means the screenshot/evidence was
captured **and** matches the stated expectation.

## Pre-flight — verification gates (must be green)

- [ ] `npm run check:hygiene` passes (no tracked `.env`, no credential
      signatures, no `NEXT_PUBLIC_*SECRET*`)
- [ ] `npm run typecheck` passes
- [ ] `npm test` green — incl. `golden-path.integration`, `negative-paths`,
      `payment-control-boundary`, and `j0d-*` suites
- [ ] `npm run build` succeeds
- [ ] Dev server reachable at `http://localhost:3000` (record the URL; if using a
      Vercel preview, record that URL instead and confirm it serves production
      state, not local memory)

## Truth-boundary evidence — capture once

- [ ] Obligation detail truth layer showing simulated markers:
      `demo_arc_trust_simulated: true`, `settlement_runtime: "SIMULATED"`,
      `product_trust_provenance: "SIMULATED_DEMO_FIXTURE"`, and obligations with
      `arc_product_destination_status: "PENDING_J0_D_TRUST_SEED"`.
- [ ] J0-C dataset summary (`data/live-usage/LIVE_USAGE_SET.json`): 5 records,
      `candidate_selection_performed: false`, product payments executed `0`,
      USD value 122.60 / AED value 5,760.00.
- [ ] J0-D evidence: `docs/evidence/J0-D-CONNECTIVITY-SPIKE.md` is **historical**
      pre-completion text; do not quote its status headline as current truth.
      Current status (bind to README/GitHub closure): the spike was **completed and
      reconciled exactly once** using disposable wallets; infrastructure evidence
      only, not per-obligation product trust; not rerun in the demo. Capture a note
      that the doc is historical.

## J0-D connectivity proof — SEPARATE from product trust

- [ ] Evidence doc `docs/evidence/J0-D-CONNECTIVITY-SPIKE.md` is **historical**;
      current status binds to README/GitHub closure: the spike was **completed and
      reconciled exactly once** using **disposable** connectivity-spike wallets —
      not a per-obligation product-trust seed, and **not rerun** in the judge demo.
- [ ] Boundary preserved in docs: J0-D is infrastructure evidence only; it is
      isolated from `AuthorityStore`/PAE/`ExecutionWorker` (no code path into the
      product runtime), so it cannot feed J1/J2 product decisions.
- [ ] Read-only preflight (`POST /api/j0d/preflight`, literal
      `READ_J0D_PREFLIGHT_ONLY`) is a non-submitting probe returning a readiness
      result from the v2 preflight schema. Show only if demonstrated; **never**
      invoke the submit route `POST /api/j0d/run-connectivity-spike`.

## Judge golden path — panel by panel

### Panel 1 — Obligations
- [ ] List shows all 5 genuine J0-C obligations; coverage counter `0/5`.
- [ ] Selected obligation: amount, network, aggregate version, and
      destination/source-wallet trust visible in the right pane.

### Panel 2 — Assessment (repeat for ALL 5 — current path is fail-closed)
- [ ] Decision visible: `PAY` / `HOLD` / `ESCALATE`; model explanation labeled
      **non-authoritative**.
- [ ] `assessment_hash` present (sealed artifact is the authorization gate, not
      the on-screen decision text).
- [ ] RACE remediation + catalog findings visible.
- [ ] Simulated/non-current trust disclosure observed (`product_trust_provenance:
      SIMULATED_DEMO_FIXTURE`).
- [ ] Coverage reaches `5/5`. Expected: with `SIMULATED_DEMO_FIXTURE` (J1-A →
      NOT_READY_SIMULATED_FIXTURE), results resolve `HOLD`/`ESCALATE` — **no
      executable PAY candidate**; "Authorize this exact intent" stays refused.
      Never default-to-PAY (P0 tests #13/#14).

### Panel 3 — Authorization (currently refused — fail-closed)
- [ ] "Authorize this exact intent" → **red refused banner**; **no PAE sealed**.
- [ ] Refusal code **AUT-016**; truth-layer value:
      `execution_release_authority = NOT_GRANTED` (not `TAMEION_PAE_REVERIFY_REQUIRED`).
- [ ] Safety Kernel shows `SK-DESTINATION-TRUST` and `SK-SOURCE-WALLET-AUTHORITY`
      as **BLOCK** (finding codes `DST-003`/`WDG-008`) because
      `hasCurrentProductTrustEvidence()` is false (`SIMULATED_DEMO_FIXTURE`).
      (Conditional, issue #44: with genuine trust, all 10 could PASS:
      `SK-AMOUNT-ATOMIC-EXACT`, `SK-ASSET-NETWORK`, `SK-COUNTERPARTY-TRUST`,
      `SK-DESTINATION-TRUST`, `SK-DUPLICATE-EXTERNAL-SETTLEMENT`,
      `SK-FINANCIAL-AUTHORITY`, `SK-IDENTITY-ORG`, `SK-KILL-SWITCH`,
      `SK-SOURCE-WALLET-AUTHORITY`, `SK-STATE-CURRENTNESS` → "Authorized — PAE
      Sealed". Not reached in the current demo.)

### Panel 4 — Assurance & Execution (not attainable in the current demo)
- [ ] "Submit for execution (simulated)" is **disabled/not attainable** (no sealed
      PAE → `detail.pae_sealed` false → no execution release).
- [ ] `submission_count` unchanged (no execution release = no simulated
      submission); provider adapter name = `fake-testnet` (in-repo fake, never live
      Circle/Arc truth).
- [ ] "View exact intent for a real J2 transfer (Prime approval packet)" is
      **read-only** (obligation/version, amount, asset, network, source/
      destination identity + fingerprint, PAE instruction id/hash/signing key/
      expiry); states **not submitted**; available only after a sealed PAE.
- [ ] Conditional (issue #44, not reached now): intended sequence
      `Authorized — PAE Sealed` → `Execution reserved` → `Submitted to provider` →
      `Reconciled` (one-to-one match). Gated on genuine current product trust.

### Panel 5 — Attack (not reachable now — requires a sealed PAE)
- [ ] "Simulate changed-destination attack" button is **disabled** (no sealed PAE).
- [ ] Conditional (issue #44, not reached now): with a sealed PAE it mutates the
      destination then the Execution Worker **BLOCKs before any provider call** →
      `Blocked` banner; zero submissions, `submission_count` unchanged, no
      `provider_ref` created.

## Acceptance criteria — demo is honest only if all hold

- [ ] NO real provider calls, wallet creation, faucet funding, or money movement.
- [ ] J2 payment **not** claimed; execution marked `SIMULATED` throughout.
- [ ] J0-D connectivity evidence shown as historical infrastructure (completed once,
      disposable wallets), **never** as product trust.
- [ ] Simulated trust markers visible in the truth layer (section above).
- [ ] Attack blocked before any provider call with zero submissions.
- [ ] All `npm run verify` gates green.

## Sign-off

- Operator asserted truth-boundary (§2) before start: __ / __
- `npm run verify` green: __ / __
- J0-D NOT run as a demo step: __ / __
- J2 payment NOT claimed (simulated only): __ / __
