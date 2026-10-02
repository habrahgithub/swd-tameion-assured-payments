# Judge Walkthrough — Tameion Demo (Issue #42 / TAMEION-DEMO-PREP-001; Gate 4 reconciliation — issue #50)

> Scope: judge-facing review of two **separate** demo surfaces at the current
> exact deployed carrier, HEAD `ebd74b8855755f6cedbe24f09d2956fea3468c33`,
> branch `prototype/claude-autonomy` (PR #52 merged). Vercel deployment
> `dpl_DX4zcw74x3boSsMn8FDoH26fqrHR` was verified `READY`/HTTP 200 at this exact
> head at the most recent AXIS adjudication (`GATE3_PASS_WITH_DEFERRED_FINDINGS`,
> issue #50 comment 5948433512):
>
> 1. **The genuine J3 Command Center golden path** — real obligations, real
>    pipeline, fail-closed. Terminal state: `J1_NO_CANDIDATE / STOP` — no
>    executable `PAY` candidate, no PAE sealed, no execution release. Now six
>    panels: the original five plus a read-only **Operational Report** panel
>    (issue #15-A; see §2.6).
> 2. **The isolated synthetic happy-path demo** (admitted #44, merged PR #47) —
>    labeled explicitly `SIMULATED_HAPPY_PATH` / `FAKE_TESTNET_ADAPTER` /
>    `NOT_VENDOR_PAYMENT` everywhere it appears. It demonstrates real
>    application control flow end-to-end on synthetic, non-economic fixture
>    data only. It is **not** a real vendor payment, not a Circle/Arc
>    transaction, and not a genuine J1 candidate.
>
> These two surfaces must never be conflated. Keep them in separate panels of
> your notes as you go. The Operational Report (§2.6) is part of Surface A; it
> is a read-only HOLD/ESCALATE projection and never implies a paid, settled, or
> executed obligation — **Paid/Reconciled and Execution Register remain
> deferred** (issue #50 roadmap) until authoritative settled/execution truth
> exists.
>
> **Deferred, not submission-blocking, Gate 3 findings (issue #50 comment
> 5948433512):** `--color-accent` and the reserved `--color-attestation` token
> (`app/globals.css`) currently share the same value (`#c5a059`); no current UI
> consumes `--color-attestation`, so there is no present visual ambiguity with a
> live attestation/irrevocable-action signal. Separately, a true
> rendered-browser desktop + compact-responsive QA pass has not yet been
> completed (Chromium was unavailable in the Gate 3 review environment) and
> remains required before Gate 5 submission freeze; Vercel independently
> confirms the exact deployment above is `READY`.

## 1. Truth framing — read before you click anything

The demo is intentionally bounded. These boundaries are enforced in code and
must stay distinct in what you observe:

1. **NO ASSURANCE, NO EXECUTION.** AI *proposes*, a human *authorizes the exact
   intent*, a deterministic Safety Kernel *decides what may execute*. AI output is
   advisory-only — never shown as final payment authority. Sources:
   `src/safety-kernel/kernel.ts` (pure, no AI) and `README.md`.
2. **J0-D testnet connectivity ≠ product trust.** The admitted J0-D Arc/Circle
   connectivity spike was **completed and reconciled exactly once** using
   *disposable* spike wallets. It is infrastructure/connectivity evidence only
   and **did not** establish per-obligation product destination or source-wallet
   trust. It is **not** a product-payment proof, must not be treated as J1/J2
   authorization, and **must not be rerun** in the judge demo. The spike is
   isolated from `AuthorityStore`, the PAE signer, and `ExecutionWorker`
   (`src/j0d-spike/connectivity-spike.ts`). `docs/evidence/J0-D-CONNECTIVITY-SPIKE.md`
   retains **historical** pre-completion status text; bind current status to
   README / GitHub closure rather than quoting that file's stale headline.
3. **Genuine-path simulated trust markers ≠ live provider truth.** The genuine
   J3 Command Center build runs `FakeProviderAdapter`
   (`adapter.name === "fake-testnet"`, `settlement_runtime: "SIMULATED"`) and
   `DEMO_ARC_TRUST_SIMULATED = true` (API field `demo_arc_trust_simulated: true`,
   `product_trust_provenance: "SIMULATED_DEMO_FIXTURE"`). All 5 genuine
   obligations carry `arc_product_destination_status: "PENDING_J0_D_TRUST_SEED"`.
   Source: `src/server/demo-state.ts` and `app/api/obligations/[id]/route.ts`.
4. **Genuine J1 result is `J1_NO_CANDIDATE / STOP` — this is a fail-closed
   demonstration, not a dead end.** Because every genuine aggregate carries
   `product_trust_provenance: "SIMULATED_DEMO_FIXTURE"`, assessment resolves
   `HOLD`/`ESCALATE` (no executable `PAY` candidate), and authorization refuses
   with `AUT-016` — **no PAE is sealed, zero execution release.** This is the
   correct, truthful terminal state for the genuine path in this build. It is
   **not** a bug and must not be worked around.
5. **The isolated synthetic happy-path demo is a separate, clearly-labeled
   surface — not a continuation of the genuine path.** It runs on an internal
   route (`POST /api/internal/demo/simulated-happy-path`, local/Preview only,
   404 in production), against a dedicated synthetic organization
   (`ORG-DEMO-SIMULATED`) and synthetic obligation ids
   (`DEMO-SIMULATED-HAPPY-001`, `DEMO-SIMULATED-BLOCKED-001`) that can never
   collide with a genuine `OBL-J0C-*` obligation. Every response is tagged
   `label: "SIMULATED_HAPPY_PATH"`, `provider_label: "FAKE_TESTNET_ADAPTER"`,
   `vendor_notice: "NOT_VENDOR_PAYMENT"`. Source: `src/demo/simulated-happy-path.ts`,
   `app/api/internal/demo/simulated-happy-path/route.ts`.
6. **J2 real product payment is NOT demonstrated anywhere and must not be
   claimed.** Neither surface submits a real vendor/Circle/Arc transaction.
   On the genuine path, "View exact intent for a real J2 transfer" is a
   **read-only disclosure** for Prime's out-of-band approval; it submits
   nothing and is unreachable in this build (no PAE is sealed). On the
   synthetic surface, `FakeProviderAdapter` is an in-repo, in-memory fake —
   never live Circle/Arc truth, regardless of how many times the happy path
   is run.

## 2. Surface A — genuine J3 Command Center (fail-closed, `J1_NO_CANDIDATE / STOP`)

- **UI:** the J3 Command Center, one page, five panels. Source:
  `app/command-center.tsx`.
- **Data:** the genuine, privacy-safe J0-C dataset — 5 real business obligations
  in `data/live-usage/LIVE_USAGE_SET.json` (all
  `state_at_event_baseline: "OUTSTANDING"`):
  - `OBL-J0C-001` — yearly business-license/flexi-desk, AED 5,760.00
    (source currency; blocked-rail sentinel `0.000000` USDC at settlement)
  - `OBL-J0C-002` — monthly AI software subscription, USD 21.00
  - `OBL-J0C-003` — monthly cloud infrastructure, USD 5.00
  - `OBL-J0C-004` — monthly AI software subscription, USD 21.00
  - `OBL-J0C-005` — yearly productivity-suite subscription, USD 75.60
- **Runtime:** `http://localhost:3000` (local dev) or a Vercel Preview deployment.
  Local dev needs no provider credentials; it uses the deterministic fallback
  Finance Agent provider and the in-memory fake adapter.
- **State banners:** every obligation renders an explicit **text** state label
  (color is never the only signal). Banner text is computed server-side from the
  truth layer (`buildPaymentTruthLayers` → `execution_release_authority` →
  `workflowState()` in `app/command-center.tsx`), not recomputed in the browser.

### Panel 1 — Obligations
- **Action:** open Command Center; review the obligation list. The right pane shows
  authoritative amount/network/aggregate version and current destination + source-
  wallet trust.
- **Judge check:** the truth layer shows the simulated markers from §1 (boundary
  #3) — `demo_arc_trust_simulated: true`, `settlement_runtime: "SIMULATED"`,
  `product_trust_provenance: "SIMULATED_DEMO_FIXTURE"`. This is the honest framing:
  the genuine demo trust set is a fixture, not live provider trust.
- **Expected state:** banner `OPEN` per obligation; coverage `0/5`.

### Panel 2 — Assessment
- **Action:** for **every** obligation, click **"Run assessment"**. The Finance Agent
  advisory provider runs (deterministic fallback locally; a configured NVIDIA model
  when present) and returns a decision.
- **Judge check:** decision is `PAY` / `HOLD` / `ESCALATE`. Model explanation is
  labeled non-authoritative. The **full** RACE result is sealed into an immutable,
  hash-addressable artifact (`assessment_hash` in the response) — authorization is
  gated on that sealed hash, **not** on the on-screen decision text. Findings are
  application-owned codes with catalog-derived remediation.
- **Expected PASS/HOLD/BLOCK (current HEAD, fail-closed — `J1_NO_CANDIDATE`):**
  because every demo aggregate carries `product_trust_provenance:
  "SIMULATED_DEMO_FIXTURE"` (mapped by J1-A to `NOT_READY_SIMULATED_FIXTURE`),
  the assessment surfaces the simulated/non-current trust disclosure and
  resolves to `HOLD`/`ESCALATE` — **no executable `PAY` candidate is
  produced.** This is a fail-closed default on incomplete provider-trust
  evidence, never a default-to-PAY (P0 tests #13/#14: invalid/timeout/
  provider-failed runs cannot default to PAY).
- **Gate:** sole-candidate-selection is enforced **server-side** (`approve()` in
  `src/authority/aggregate.ts`). Assessing all 5 is required for coverage `5/5`,
  but the non-executable HOLD/ESCALATE results mean authorization is **not**
  enabled — the refusal occurs at the trust/authority gate next.

### Panel 3 — Authorization (refused — `STOP`)
- **Action:** click **"Authorize this exact intent"** to observe the refusal
  (this is the truthful result, not a success).
- **Code path:** `POST /api/obligations/[id]/approve` runs the real reviewed-N →
  authorized-(N+1) compare-and-swap transition, then the real Safety Kernel
  (`runSafetyKernel`, `src/safety-kernel/kernel.ts`). A PAE is sealed **only** if
  every required control (`REQUIRED_CONTROL_IDS_P0`, `src/domain/schemas.ts`)
  returns `PASS`. There is **no** path from HOLD/BLOCK to submission.
- **Current HEAD (fail-closed — terminal state `J1_NO_CANDIDATE / STOP`):** with
  `product_trust_provenance: SIMULATED_DEMO_FIXTURE`,
  `hasCurrentProductTrustEvidence()` is false, so the Safety Kernel's
  destination/source-wallet trust controls **block** (`SK-DESTINATION-TRUST`,
  `SK-SOURCE-WALLET-AUTHORITY`); approval is refused with **AUT-016** and a
  **visible red refused banner** with the exact finding codes, and **no PAE is
  sealed** — zero execution release is granted. This is the judge-facing
  terminal result for every genuine obligation in this build.
- **Judge check:** there is **no** "authorize and execute" single step, and no PAE
  or execution release is granted for the genuine path in this build.

### Panel 4 — Assurance & Execution (not attainable — genuine path stopped)
- **Current HEAD:** "Submit for execution (simulated)" is **not attainable** — with
  no sealed PAE (refused at the trust gate, §3), the Execution Worker has no
  execution-release authority to consume; the action is gated on
  `detail.pae_sealed` and stays disabled. **Do not** click it expecting a
  `Reconciled` result.
- **Code path (not reached on the genuine path in this build):**
  `POST /api/obligations/[id]/execute` runs the real `ExecutionWorker`
  (`src/execution/worker.ts`) — idempotent claim (UNUSED→RESERVED), PAE
  re-verification, and a **simulated** provider (`FakeProviderAdapter`,
  `adapter.name "fake-testnet"`, `settlement_runtime "SIMULATED"`) — the in-repo
  fake, **not** live Circle/Arc truth. For the genuine path to reach this step
  would require genuine, non-simulated product trust evidence, which this
  build's demo fixture does not provide; it is not reachable now.
- **Action B — Prime packet (read-only, submits nothing):** "View exact intent for
  a real J2 transfer" (`GET /api/obligations/[id]/prime-approval-packet` →
  `buildJ2PrimeApprovalPacket`, `src/pipeline/prime-approval-packet.ts`) shows
  obligation/version, amount, asset, network, source/destination identity +
  fingerprint, and PAE instruction id/hash/signing key/expiry. Available only
  *after* a PAE is sealed (not reached on the genuine path in this build).
- **Critical judge check:** the Prime packet performs no settlement at all. A
  real J2 transfer requires Prime's explicit out-of-band approval of the exact
  packet and is **not** a payment until then.

### Panel 5 — Reconciliation & Evidence (attack — not reachable, no PAE)
- **Current HEAD:** "Simulate changed-destination attack" requires a **sealed PAE**
  (its button is disabled otherwise), so it is **not reachable** in this build.
  This is correct and expected: no PAE ⇒ no execution path to attack.
- The raw truth layer (showing `product_trust_provenance: SIMULATED_DEMO_FIXTURE`,
  `settlement_runtime: "SIMULATED"`) and sealed assessment artifacts are also
  shown here ("Raw evidence / response") — confirm the simulated/non-current trust
  disclosure and the AUT-016 refusal, with no PAE sealed and no execution release.

### Panel 6 — Operational Report (read-only, HOLD/ESCALATE Attention Required)
- **What it is:** a read-only report derived only from authoritative current
  assessment and obligation state. Source: `src/client/hold-escalate-report.ts`
  (`buildHoldEscalateReport` / `buildHoldEscalateSummary`), wired into the
  "Operational Report" panel of `app/command-center.tsx` (issue #15/#14,
  merged PR #51). Unlike Panels 3-5, it is reachable and populated regardless
  of whether any PAE is sealed.
- **Aggregate summary:** total obligations, `HOLD`, `ESCALATE`, `Unassessed`,
  and `PAY (out of scope)` counts across the obligation set.
- **Per-obligation line:** supplier/source reference (source system, record
  id/type, source approval state, execution authority), obligation amount,
  effective decision, and assessment truth (status, assessment id/hash, time,
  provider mode/used — provider explanation remains non-authoritative).
- **Fail-closed rule:** when the sealed assessment is absent (`UNASSESSED`) or
  stale (aggregate-version mismatch), the report defaults to `HOLD` and shows
  an explicit "Fail-closed — default HOLD" banner with the reason. It uses the
  actual sealed decision only when current.
- **`PAY` is shown but out of scope:** a `PAY` decision is displayed truthfully
  but labeled "Advisory only — PAY is outside the HOLD/ESCALATE report scope
  and has not been settled or authorized." The report never fabricates a
  settled, paid, or executed state.
- **Judge check — what this does and does not prove:** it proves a truthful,
  fail-closed read projection of current assessment/obligation state. It has
  **no** code path into execution, PAE, or reconciliation state, and does
  **not** prove any payment occurred. **Paid/Reconciled and Execution
  Register are not implemented here and remain deferred** (issue #50 roadmap)
  until authoritative settled/execution truth exists.

## 3. Surface B — isolated synthetic happy-path demo (`SIMULATED_HAPPY_PATH`)

> This is a **separate, explicitly-labeled** demonstration slice, admitted under
> #44 and merged via PR #47. It never touches the genuine J0-C obligations, the
> genuine `AuthorityStore` organization, Supabase, Circle/Arc, J0-D, or any
> wallet/network client. It exists to demonstrate that the **application control
> flow** — `AuthorityStore` → assessment sealing → authorization → the
> deterministic Safety Kernel → PAE signing → `ExecutionWorker` →
> `FakeProviderAdapter` — works end-to-end, on synthetic data, when destination
> trust evidence is present. It is **not vendor payment proof** of any kind.

- **Trigger:** `POST /api/internal/demo/simulated-happy-path` with body
  `{ "confirm": "RUN_SIMULATED_HAPPY_PATH" }`. Source: `src/demo/simulated-happy-path.ts`,
  `app/api/internal/demo/simulated-happy-path/route.ts`.
- **Environment scope:** local dev and Vercel Preview only. On
  `process.env.VERCEL_ENV === "production"` the route returns `404` with
  `{ status: "BLOCKED", code: "PRODUCTION_BLOCKED" }` without executing
  anything. Any non-`POST` method returns `405 METHOD_NOT_ALLOWED` without
  executing. A malformed body returns `400 MALFORMED_REQUEST`. If no PAE
  signing key is configured in Preview, the route fails closed with
  `503 SIGNING_KEY_UNAVAILABLE` rather than weakening or bypassing
  `src/pae/keys.ts`.
- **Isolation guard:** `assertSyntheticObligationId()` refuses to run against
  any obligation id matching the genuine pattern `^OBL-J0C-` (`SimulatedDemoGuardError`,
  code `DEMO-001`). Both synthetic obligation ids
  (`DEMO-SIMULATED-HAPPY-001`, `DEMO-SIMULATED-BLOCKED-001`) and the synthetic
  organization id (`ORG-DEMO-SIMULATED`) are hardcoded constants distinct from
  any genuine identifier space.

### B1 — Happy path (`happy_path` in the response)
- Seeds a fresh, in-memory `AuthorityStore` aggregate with synthetic but
  **verified** destination and source-wallet trust (`destinationVerified: true`),
  seals a deterministic synthetic `PAY` assessment, then runs the real
  `approveAndSealPae` pipeline (authorization + the real Safety Kernel +
  real PAE signing against the production signing-key loader) — all controls
  `PASS` because the synthetic evidence is complete — then runs the real
  `ExecutionWorker` against a `FakeProviderAdapter` queued with a `CONFIRMED`
  outcome.
- **Expected result:** Safety Kernel `overall: "PASS"`; aggregate reaches
  `SETTLED` state and the execution record reaches `RECONCILED`; **exactly one**
  `FakeProviderAdapter` submission (`provider_submission_count: 1`).
- **Labels on every field of the response:** `label: "SIMULATED_HAPPY_PATH"`,
  `provider_label: "FAKE_TESTNET_ADAPTER"`, `vendor_notice: "NOT_VENDOR_PAYMENT"`.

### B2 — Blocked variant (`blocked_variant` in the response)
- Seeds a second synthetic aggregate (`DEMO-SIMULATED-BLOCKED-001`) with
  destination readiness **deliberately not verified**
  (`destinationVerified: false`), seals a synthetic `PAY` assessment, then
  attempts the same real `approveAndSealPae` pipeline.
- **Expected result:** production assurance **BLOCKs** before any PAE is
  sealed (`AssuranceFailedError`); the route surfaces `safety_kernel_overall`
  as the Safety Kernel's `HOLD`/`BLOCK` result and the specific
  `control_results`. The `FakeProviderAdapter` instantiated for this variant is
  **never invoked** — `provider_submission_count: 0`.
- This proves the synthetic demo's "happy path" is not a fixed PASS: the same
  real pipeline fails closed on incomplete synthetic evidence, exactly as the
  genuine path does on incomplete genuine evidence.

### Judge check — what this surface does and does not prove
- **Proves:** the real application control flow (store → assessment sealing →
  authorization → Safety Kernel → PAE signing → execution worker → provider
  adapter interface) functions correctly end-to-end, and fails closed
  correctly, independent of whether the underlying evidence is genuine or
  synthetic.
- **Does not prove:** any real vendor payment, any Circle/Arc transaction, or
  readiness of a genuine J1 candidate. `FakeProviderAdapter` never calls a
  network. No Supabase row is written. No wallet is touched. Nothing here
  changes the genuine path's `J1_NO_CANDIDATE / STOP` result in §2.

## 4. States quick reference

| Stage | Terminal states you may see | Code source |
|---|---|---|
| Genuine-path assessment decision | `PAY` / `HOLD` / `ESCALATE` | `DurableAssessmentRecord.decision` |
| Genuine-path Safety Kernel overall | `PASS` / `HOLD` / `BLOCK` | `SafetyKernelResult.overall` |
| Genuine-path post-auth banner | `Authorized — PAE Sealed` · `Reconciled` · `Blocked` · `Provider response unknown` · `Execution failed` · `PAE expired` · `Submitted to provider` · `Submission state in doubt` · `Execution reserved` · `Execution suspended` · `PAE consumed` · `Awaiting human authorization` · `Loading` | `workflowState()` in `app/command-center.tsx` |
| Genuine-path execution release authority | `TAMEION_PAE_REVERIFY_REQUIRED` · `RESERVED_FOR_EXECUTION` · `SUBMITTED_TO_PROVIDER` · `IN_DOUBT_PROVIDER_SUBMISSION` · `CONSUMED` · `REVOKED` · `EXPIRED` · `SUSPENDED_KILL_SWITCH` · `BLOCKED` · `NOT_GRANTED` | `buildPaymentTruthLayers` / `deriveExecutionReleaseAuthority` |
| J0-D preflight (separate; **not** either demo surface) | `READY_FOR_EXPLICIT_AUTHORIZATION` · `FUNDING_REQUIRED` · `AUTHORIZATION_CEILING_EXCEEDED` · `BLOCKED_EXTERNAL` | `j0dPreflightResultSchema` |
| Synthetic happy-path result | `status: "PASS"`, `happy_path.safety_kernel_overall: "PASS"`, `happy_path.execution.status: "RECONCILED"`, `happy_path.provider_submission_count: 1` | `runSimulatedHappyPath()` |
| Synthetic blocked variant | `blocked_variant.blocked: true`, `blocked_variant.safety_kernel_overall: "HOLD" \| "BLOCK"`, `blocked_variant.provider_submission_count: 0` | `runSimulatedBlockedVariant()` |
| Operational Report line status | `CURRENT` · `STALE` · `UNASSESSED` (fail-closed default `HOLD` when not `CURRENT`); decision `HOLD` · `ESCALATE` · `PAY` (`PAY` flagged out of scope) | `HoldEscalateReportLine` in `src/client/hold-escalate-report.ts` |

> A **BLOCK** anywhere stops the line. A failed Safety Kernel means **no PAE is
> sealed** — there is no path from HOLD/BLOCK to submission.
>
> On the **genuine** path in this build, only the fail-closed branch is
> reached: assessments resolve `HOLD`/`ESCALATE`, authorization refuses
> (`AUT-016`, `NOT_READY_SIMULATED_FIXTURE`; `SK-DESTINATION-TRUST` /
> `SK-SOURCE-WALLET-AUTHORITY` blocked), and no `Authorized — PAE Sealed` or
> `Reconciled` state is produced. That terminal state is `J1_NO_CANDIDATE / STOP`.
>
> On the **isolated synthetic** surface, the same production code paths can
> reach `PASS` / `SETTLED` / `RECONCILED` because the synthetic fixture
> supplies complete, verified evidence — this demonstrates control-flow
> correctness, not vendor-payment capability.

## 5. What does NOT happen in this demo (and must not be claimed)

- The J0-D connectivity spike is **not rerun** as part of the judge demo (it was
  completed and reconciled once under J0 with disposable wallets; §1 boundary #2).
  It is infrastructure evidence only and is not J1/J2 authority. Read-only preflight
  may be shown **only** as a non-submitting probe; the submit route is gated on
  Prime's out-of-band approval and is **not** exercised here.
- No real J2 product payment, on either surface. On the genuine path, no PAE is
  sealed and no execution release is granted — terminal state
  `J1_NO_CANDIDATE / STOP`. On the synthetic surface, `FakeProviderAdapter` is
  the in-repo simulated provider, never live Circle/Arc truth, no matter how
  many times `RUN_SIMULATED_HAPPY_PATH` is confirmed.
- No live provider calls, wallet creation, faucet funding, or money movement on
  either surface. Local dev uses a deterministic fallback + an ephemeral dev
  signing key, which is explicitly **not** for J2.
- The synthetic happy-path demo must never be presented as evidence that a
  genuine J1 candidate exists, or that genuine destination/source-wallet trust
  has been established. It is a control-flow demonstration on fixture data.
- The Operational Report (§2, Panel 6) must never be presented as a paid,
  settled, or executed state. **Paid/Reconciled and Execution Register are
  not implemented and remain deferred** (issue #50 roadmap) until
  authoritative settled/execution truth exists.

## 6. Where the proof lives

- J0-D connectivity evidence (historical pre-completion status; current status
  binds to README/GitHub closure — completed once, disposable wallets, not product
  trust): `docs/evidence/J0-D-CONNECTIVITY-SPIKE.md`
- Live provider connectivity (J0-B): `docs/evidence/J0-B-CONNECTIVITY.md`
- Genuine obligations (J0-C): `docs/evidence/J0-C-GENUINE-USAGE.md`,
  `data/live-usage/LIVE_USAGE_SET.json`
- Event-start baseline: `docs/evidence/J0-EVENT-START-BASELINE.md`
- Verification baseline / J2 transaction-proof rule: `docs/frozen-design/v1.4.22/`
- Isolated synthetic happy-path demo source: `src/demo/simulated-happy-path.ts`,
  `app/api/internal/demo/simulated-happy-path/route.ts`,
  `tests/simulated-happy-path.test.ts` (PR #47, admitted under #44)
- Operational Report — HOLD/ESCALATE Attention Required (issue #15/#14, merged
  PR #51): `src/client/hold-escalate-report.ts`,
  `tests/hold-escalate-report.test.ts`
- Automated negative-path coverage: `tests/` (golden-path, negative-paths,
  payment-control-boundary, j0d-*, simulated-happy-path, hold-escalate-report
  suites)
- Gate 3/Gate 4 adjudication and deferred findings: issue #50 comments
  5948433512 (Gate 3) and 5948610225 (Gate 4 writer rebind)
- This demo pack: `DEMO-RUNBOOK.md`, `DEMO-EVIDENCE-CHECKLIST.md` (same directory)
