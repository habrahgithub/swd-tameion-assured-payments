# Demo Evidence & Screenshots Checklist (Issue #42 / TAMEION-DEMO-PREP-001; Gate 4 reconciliation — issue #50)

Evidence-capture map tied to PASS/HOLD/BLOCK states across **two separate
surfaces**, at current exact deployed carrier HEAD
`ebd74b8855755f6cedbe24f09d2956fea3468c33` (branch `prototype/claude-autonomy`,
PR #52 merged; Vercel deployment `dpl_DX4zcw74x3boSsMn8FDoH26fqrHR` verified
`READY`/HTTP 200 at this exact head — issue #50 comment 5948433512):

- **Surface A** — genuine J3 Command Center golden path. Terminal state:
  `J1_NO_CANDIDATE / STOP`. Now six panels: the original five plus a
  read-only Operational Report panel (issue #15-A).
- **Surface B** — isolated synthetic happy-path demo (admitted #44, merged
  PR #47), labeled `SIMULATED_HAPPY_PATH` / `FAKE_TESTNET_ADAPTER` /
  `NOT_VENDOR_PAYMENT`. Reaches `PASS` / `SETTLED` / `RECONCILED` with exactly
  one fake-provider submission; the companion blocked variant fails assurance
  with zero submissions.

Mark each item **PASS** before declaring the demo honest. A checked box means
the screenshot/evidence was captured **and** matches the stated expectation.

Deferred, not submission-blocking (issue #50 comment 5948433512): the
`--color-accent` / reserved `--color-attestation` token collision in
`app/globals.css`, and the still-outstanding true rendered-browser QA pass
(Chromium was unavailable in the Gate 3 review environment) — required before
Gate 5 submission freeze, independent of Vercel's confirmed `READY` state.

## Pre-flight — verification gates (must be green)

- [ ] `npm run check:hygiene` passes (no tracked `.env`, no credential
      signatures, no `NEXT_PUBLIC_*SECRET*`)
- [ ] `npm run typecheck` passes
- [ ] `npm test` green — incl. `golden-path.integration`, `negative-paths`,
      `payment-control-boundary`, `j0d-*`, and `simulated-happy-path` suites
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

## Surface A — genuine golden path, panel by panel (fail-closed, `J1_NO_CANDIDATE / STOP`)

### Panel 1 — Obligations
- [ ] List shows all 5 genuine J0-C obligations; coverage counter `0/5`.
- [ ] Selected obligation: amount, network, aggregate version, and
      destination/source-wallet trust visible in the right pane.

### Panel 2 — Assessment (repeat for ALL 5 — fail-closed)
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

### Panel 3 — Authorization (refused — terminal `J1_NO_CANDIDATE / STOP`)
- [ ] "Authorize this exact intent" → **red refused banner**; **no PAE sealed**.
- [ ] Refusal code **AUT-016**; truth-layer value:
      `execution_release_authority = NOT_GRANTED` (not `TAMEION_PAE_REVERIFY_REQUIRED`).
- [ ] Safety Kernel shows `SK-DESTINATION-TRUST` and `SK-SOURCE-WALLET-AUTHORITY`
      as **BLOCK** (finding codes `DST-003`/`WDG-008`) because
      `hasCurrentProductTrustEvidence()` is false (`SIMULATED_DEMO_FIXTURE`).

### Panel 4 — Assurance & Execution (not attainable — genuine path stopped)
- [ ] "Submit for execution (simulated)" is **disabled/not attainable** (no sealed
      PAE → `detail.pae_sealed` false → no execution release).
- [ ] `submission_count` unchanged (no execution release = no simulated
      submission); provider adapter name = `fake-testnet` (in-repo fake, never live
      Circle/Arc truth).
- [ ] "View exact intent for a real J2 transfer (Prime approval packet)" is
      **read-only** (obligation/version, amount, asset, network, source/
      destination identity + fingerprint, PAE instruction id/hash/signing key/
      expiry); states **not submitted**; available only after a sealed PAE
      (not reached on the genuine path in this build).

### Panel 5 — Attack (not reachable — requires a sealed PAE)
- [ ] "Simulate changed-destination attack" button is **disabled** (no sealed PAE).

### Panel 6 — Operational Report (read-only, HOLD/ESCALATE Attention Required)
- [ ] Aggregate summary shows total obligations, `HOLD`, `ESCALATE`,
      `Unassessed`, and `PAY (out of scope)` counts.
- [ ] Before assessment, selected obligation shows the "Fail-closed — default
      HOLD" banner with an `UNASSESSED` reason.
- [ ] After assessment, the report line reflects the actual sealed `HOLD`/
      `ESCALATE` decision; any `PAY` decision is labeled "Advisory only... has
      not been settled or authorized."
- [ ] Supplier/source reference (source system, record id/type, source
      approval state, execution authority) and assessment truth
      (status/assessment id/hash/time/provider mode) are visible per
      obligation.
- [ ] Confirm no execution, PAE, or reconciliation state is read or implied by
      this panel (source: `src/client/hold-escalate-report.ts` imports only
      obligation/assessment types).
- [ ] `tests/hold-escalate-report.test.ts` run and passing (fail-closed
      defaults, summary aggregation, out-of-scope PAY labeling).

## Surface B — isolated synthetic happy-path demo (`SIMULATED_HAPPY_PATH`)

- [ ] Trigger confirmed local/Preview-only: production (`VERCEL_ENV ===
      "production"`) returns `404 { status: "BLOCKED", code:
      "PRODUCTION_BLOCKED" }` without executing.
- [ ] Non-`POST` method returns `405 METHOD_NOT_ALLOWED` without executing.
- [ ] Malformed body returns `400 MALFORMED_REQUEST`.
- [ ] Response carries `label: "SIMULATED_HAPPY_PATH"`,
      `provider_label: "FAKE_TESTNET_ADAPTER"`,
      `vendor_notice: "NOT_VENDOR_PAYMENT"` at the top level.
- [ ] `happy_path.safety_kernel_overall === "PASS"`.
- [ ] `happy_path.aggregate_state === "SETTLED"` and
      `happy_path.execution.status === "RECONCILED"`.
- [ ] `happy_path.provider_submission_count === 1` — **exactly one**
      fake-provider submission on PASS.
- [ ] `blocked_variant.blocked === true` and
      `blocked_variant.safety_kernel_overall` is `"HOLD"` or `"BLOCK"`.
- [ ] `blocked_variant.provider_submission_count === 0` — **zero** provider
      submissions on the blocked variant.
- [ ] Obligation ids used (`DEMO-SIMULATED-HAPPY-001`,
      `DEMO-SIMULATED-BLOCKED-001`) and organization id
      (`ORG-DEMO-SIMULATED`) are synthetic, never match genuine `OBL-J0C-*`
      pattern, and `assertSyntheticObligationId()` guard is documented
      (`SimulatedDemoGuardError`, code `DEMO-001`).
- [ ] `tests/simulated-happy-path.test.ts` run and passing (covers the
      synthetic-id guard, the full happy-path pipeline result, the blocked
      variant, and independence across repeated in-memory runs).
- [ ] No Supabase write, no Circle/Arc call, no J0-D call, no wallet/network
      client invoked anywhere in this surface (confirmed by reading
      `src/demo/simulated-happy-path.ts` imports: only `AuthorityStore`,
      `approveAndSealPae`, `ExecutionWorker`, `FakeProviderAdapter`).

## Acceptance criteria — demo is honest only if all hold

- [ ] NO real provider calls, wallet creation, faucet funding, or money movement
      on either surface.
- [ ] J2 payment **not** claimed on either surface: genuine path terminal state
      is `J1_NO_CANDIDATE / STOP`; Surface B execution is simulated throughout
      and labeled `NOT_VENDOR_PAYMENT`.
- [ ] J0-D connectivity evidence shown as historical infrastructure (completed once,
      disposable wallets), **never** as product trust.
- [ ] Simulated trust markers visible in the genuine-path truth layer (section
      above).
- [ ] Genuine-path attack panel blocked before any provider call reachability
      (no sealed PAE); Surface B's blocked variant separately shows zero
      submissions.
- [ ] Surface B is never described as proving a genuine J1 candidate or
      genuine trust evidence — only real application control-flow correctness
      on synthetic fixtures.
- [ ] The Operational Report (Panel 6) is never described as a paid, settled,
      or executed state — Paid/Reconciled and Execution Register are not
      implemented and remain deferred (issue #50 roadmap).
- [ ] All `npm run verify` gates green.

## Sign-off

- Operator asserted truth-boundary (§ above) before start: __ / __
- `npm run verify` green: __ / __
- J0-D NOT run as a demo step: __ / __
- J2 payment NOT claimed on either surface (genuine = `J1_NO_CANDIDATE / STOP`;
  synthetic = simulated only): __ / __
- Surface A and Surface B kept visibly distinct throughout the walkthrough: __ / __
