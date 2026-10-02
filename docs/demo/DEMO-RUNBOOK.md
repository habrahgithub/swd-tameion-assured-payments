# Demo Runbook — Tameion (Issue #42 / TAMEION-DEMO-PREP-001; Gate 4 reconciliation — issue #50)

Operator guide to stand up, verify, and replay **two separate** demo surfaces.
Current exact deployed carrier: HEAD `ebd74b8855755f6cedbe24f09d2956fea3468c33`,
branch `prototype/claude-autonomy` (PR #52 merged). Vercel deployment
`dpl_DX4zcw74x3boSsMn8FDoH26fqrHR` was verified `READY`/HTTP 200 at this exact
head at the most recent AXIS adjudication (`GATE3_PASS_WITH_DEFERRED_FINDINGS`,
issue #50 comment 5948433512 — see "Gate status" below):

- **Surface A — genuine J3 Command Center golden path.** Real obligations,
  real pipeline, fail-closed. Terminal state: `J1_NO_CANDIDATE / STOP`. Now
  includes a sixth, read-only **Operational Report** panel (issue #15-A; see
  Step 6 below) alongside the original five panels.
- **Surface B — isolated synthetic happy-path demo** (admitted #44, merged
  PR #47). Explicitly labeled `SIMULATED_HAPPY_PATH` / `FAKE_TESTNET_ADAPTER` /
  `NOT_VENDOR_PAYMENT` in every response field. Demonstrates real application
  control flow on synthetic, non-economic fixture data only.

Never present Surface B as proof of a genuine J1 candidate, genuine trust
evidence, or a real vendor/Circle/Arc transaction. Never present the
Operational Report (Surface A, Step 6) as proof of a paid/settled or executed
obligation — it is a read-only HOLD/ESCALATE projection only.
**Paid/Reconciled and Execution Register remain deferred** until authoritative
settled/execution truth exists (issue #50 roadmap).

## Gate status (bind before demo)

- Deferred, not submission-blocking (issue #50 comment 5948433512): `--color-accent`
  and the reserved `--color-attestation` token (`app/globals.css`) currently
  share the same value (`#c5a059`). No current UI consumes
  `--color-attestation`, so there is no present visual ambiguity with a live
  attestation/irrevocable-action signal.
- A true rendered-browser desktop + compact-responsive QA pass has not yet
  been completed (Chromium was unavailable in the Gate 3 review environment).
  Vercel independently confirms the exact deployment above is `READY`. This
  pass remains required before Gate 5 submission freeze — do not claim it as
  done.

## Truth boundary — operator must assert these before demo

- **NO ASSURANCE, NO EXECUTION:** AI proposes → human authorizes exact intent →
  deterministic Safety Kernel decides what may execute. AI output is advisory.
- **J0-D connectivity spike is infrastructure evidence only — completed and
  reconciled exactly once with disposable spike wallets** (bind current status to
  README; not a product-payment proof; not J1/J2 authority; NOT rerun in the
  demo). Do NOT run the J0-D spike or its submit route
  (`POST /api/j0d/run-connectivity-spike`) during the demo. Read-only preflight
  (`POST /api/j0d/preflight`) may be shown only as a non-submitting probe.
  `docs/evidence/J0-D-CONNECTIVITY-SPIKE.md` is historical pre-completion text.
- **Genuine path is fail-closed (terminal state `J1_NO_CANDIDATE / STOP`):**
  every genuine demo aggregate carries `product_trust_provenance:
  "SIMULATED_DEMO_FIXTURE"` (J1-A → `NOT_READY_SIMULATED_FIXTURE`). Assessments
  resolve HOLD/ESCALATE (no executable PAY candidate); authorization refuses
  **AUT-016** (`SK-DESTINATION-TRUST` / `SK-SOURCE-WALLET-AUTHORITY` blocked)
  and **no PAE is sealed** — zero execution release. All obligations show
  `PENDING_J0_D_TRUST_SEED`.
- **Synthetic happy-path demo (Surface B) is separate and explicitly
  labeled:** it runs against a dedicated synthetic organization
  (`ORG-DEMO-SIMULATED`) and synthetic obligation ids that can never collide
  with genuine `OBL-J0C-*` ids. It reaches `PASS` / `SETTLED` / `RECONCILED`
  with exactly one `FakeProviderAdapter` submission — on synthetic fixture
  data only. `FakeProviderAdapter` (`adapter.name "fake-testnet"`,
  `settlement_runtime "SIMULATED"`) is the in-repo simulated provider, never
  live Circle/Arc truth.
- **J2 payment NOT proven on either surface:** no PAE/execution release on the
  genuine path. The Prime approval-packet view is read-only and submits
  nothing. The synthetic surface never calls a real provider, wallet, or
  network.

## Prerequisites

- Node.js 24.21.0 (`nvm use`), npm 11.19.0; Next 16.3.6 / React 19.3.0 /
  TypeScript 7.0.2 (see `.nvmrc` and `package.json`).
- Local dev needs **no** provider credentials. Only `.env.example` is committed
  (variable names, empty values). Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  only if you want Supabase-backed state locally; otherwise the app falls back to
  the in-memory adapter (fine for the demo).
- Surface B's route requires a configured PAE signing key when run on Preview
  (`npm run dev` locally resolves this via the production signing-key loader);
  if unavailable it fails closed with `503 SIGNING_KEY_UNAVAILABLE` rather than
  weakening `src/pae/keys.ts`.

## Cold start & verification gate

```bash
nvm use
npm ci
npm run verify   # hygiene -> typecheck -> test -> build, all from a clean tree
npm run dev      # http://localhost:3000
```

**Pre-demo gate:** `npm run verify` must be GREEN (hygiene, typecheck, tests, build).
CI runs the same sequence on every push to `main` (`.github/workflows/ci.yml`).

## Surface A — genuine golden path (scripted operator steps)

### Start
1. Open `http://localhost:3000` → Command Center, **Obligations** panel.
2. Confirm all 5 obligations load; the coverage counter shows `0/5` assessed.
3. Inspect the truth layer (right pane → "Raw evidence / response"):
   `demo_arc_trust_simulated: true`, `settlement_runtime: "SIMULATED"`,
   `product_trust_provenance: "SIMULATED_DEMO_FIXTURE"`. **Observe the
   simulated/non-current trust disclosure** — this is what drives the fail-closed
   path below (no PAY candidate, no PAE, no execution release).

### Step 1 — Obligations
Pick any obligation; the right pane shows authoritative amount, network,
aggregate version, and current destination/source-wallet trust (simulated fixture).

### Step 2 — Assessment (run on ALL 5 — fail-closed, `J1_NO_CANDIDATE`)
For each obligation, **Assessment** panel → **"Run assessment"**. The Finance Agent
advisory provider runs (deterministic fallback locally). Observe the
**simulated/non-current trust disclosure**: because `product_trust_provenance` is
`SIMULATED_DEMO_FIXTURE` (J1-A → `NOT_READY_SIMULATED_FIXTURE`), the result resolves
to **HOLD/ESCALATE — no executable PAY candidate is produced**. A sealed
`assessment_hash` is still recorded (authorization is gated on that hash, not the
on-screen decision).

The sole-candidate-selection gate is **server-enforced** (`approve()` in
`src/authority/aggregate.ts`). Assess all 5 for coverage `5/5`, but the
non-executable HOLD/ESCALATE results mean authorization is **not** enabled — the
refusal occurs at the trust/authority gate next. Any incomplete evidence or
provider failure fails closed to HOLD/ESCALATE, **never** default-to-PAY (P0 tests
#13/#14).

### Step 3 — Authorization (refused — `STOP`)
Click **"Authorize this exact intent"** to observe the refusal (this is the
truthful result, not a success). `POST /api/obligations/[id]/approve` runs the
real reviewed-N → authorized-(N+1) compare-and-swap transition, then the real
Safety Kernel (`runSafetyKernel`, `src/safety-kernel/kernel.ts`). A PAE is sealed
**only** if every required control (`REQUIRED_CONTROL_IDS_P0`,
`src/domain/schemas.ts`) returns `PASS` — and that requires genuine current
non-simulated product trust, which this build's genuine fixture does not supply.

`hasCurrentProductTrustEvidence()` is false, so `SK-DESTINATION-TRUST` /
`SK-SOURCE-WALLET-AUTHORITY` **block**; approval is refused with **AUT-016** and
a **visible red refused banner**; **no PAE is sealed**, zero execution release.
This is the terminal state for every genuine obligation in this build:
`J1_NO_CANDIDATE / STOP`.

### Step 4 — Assurance & Execution (not attainable — genuine path stopped)
- **"Submit for execution (simulated)"** is **not attainable**: with no sealed
  PAE (refused at the trust gate, Step 3) the Execution Worker has no execution-
  release authority to consume; the action is gated on `detail.pae_sealed` and
  stays disabled. **Do not** click it expecting a `Reconciled` result.
- **"View exact intent for a real J2 transfer (Prime approval packet)"** → read-
  only disclosure (`GET /api/obligations/[id]/prime-approval-packet` →
  `buildJ2PrimeApprovalPacket`, `src/pipeline/prime-approval-packet.ts`):
  obligation/version, amount, asset, network, source/destination identity +
  fingerprint, PAE instruction id/hash/signing key/expiry. **Submits nothing.**
  Available only *after* a PAE is sealed — not reached on the genuine path in
  this build.

### Step 5 — Reconciliation & Evidence (attack — not reachable, no PAE)
"Simulate changed-destination attack" requires a **sealed PAE** (button disabled
otherwise), so it is **not reachable** on the genuine path in this build —
correct, since no PAE is sealed.

### Step 6 — Operational Report (read-only, HOLD/ESCALATE Attention Required)
The sixth panel, **Operational Report**, is independent of the PAE/authorization
state above — it is reachable and populated regardless of whether any PAE is
sealed. Source: `src/client/hold-escalate-report.ts`, wired into
`app/command-center.tsx` (issue #15/#14, PR #51).

1. Open the **Operational Report** panel. The aggregate summary shows total
   obligations, `HOLD`, `ESCALATE`, `Unassessed`, and `PAY (out of scope)`
   counts across all 5 genuine obligations.
2. Select any obligation to see its report line: supplier/source reference
   (source system, record id/type, source approval state, execution
   authority), obligation amount, effective decision, and assessment truth
   (status, assessment id/hash, assessment time, provider mode/used).
3. Before an obligation is assessed, the report defaults **fail-closed to
   `HOLD`** with an explicit "Fail-closed — default HOLD" banner and reason
   (`UNASSESSED`). After assessment, it reflects the actual sealed `HOLD`/
   `ESCALATE` decision; a `PAY` decision is shown truthfully but labeled
   **out of scope** — "Advisory only... has not been settled or authorized."
4. **Judge check:** this report never shows a settled, paid, or executed
   state. It reads only sealed-assessment and obligation truth; it has no
   code path into execution, PAE, or reconciliation state. Paid/Reconciled
   and Execution Register are **not** implemented and remain deferred
   (issue #50 roadmap) until authoritative settled/execution truth exists.

## Surface B — isolated synthetic happy-path demo (`SIMULATED_HAPPY_PATH`)

> Separate from Surface A. Never run this to "show the real path completing" —
> it demonstrates control flow on synthetic fixture data, not a genuine
> candidate or real trust evidence.

### Trigger
```bash
curl -s -X POST http://localhost:3000/api/internal/demo/simulated-happy-path \
  -H 'Content-Type: application/json' \
  -d '{"confirm":"RUN_SIMULATED_HAPPY_PATH"}'
```

- Local dev or Vercel Preview only. In production (`VERCEL_ENV === "production"`)
  the route returns `404 { status: "BLOCKED", code: "PRODUCTION_BLOCKED" }`
  without executing anything.
- Any non-`POST` method returns `405 METHOD_NOT_ALLOWED` without executing.
- A malformed body returns `400 MALFORMED_REQUEST`.
- If Preview has no configured PAE signing key, the route fails closed with
  `503 SIGNING_KEY_UNAVAILABLE`.

### Expected response shape
- `status: "PASS"`, `label: "SIMULATED_HAPPY_PATH"`,
  `provider_label: "FAKE_TESTNET_ADAPTER"`, `vendor_notice: "NOT_VENDOR_PAYMENT"`.
- `happy_path`: seeds synthetic obligation `DEMO-SIMULATED-HAPPY-001` with
  verified synthetic destination/source-wallet trust, seals a synthetic `PAY`
  assessment, runs the real `approveAndSealPae` pipeline (real Safety Kernel,
  real PAE signing), then the real `ExecutionWorker` against a
  `FakeProviderAdapter` queued `CONFIRMED`. Expect
  `safety_kernel_overall: "PASS"`, aggregate `SETTLED`, execution
  `RECONCILED`, **`provider_submission_count: 1`** — exactly one fake-provider
  submission.
- `blocked_variant`: seeds synthetic obligation `DEMO-SIMULATED-BLOCKED-001`
  with destination readiness deliberately **not** verified, then attempts the
  same real pipeline. Production assurance **BLOCKs before any PAE is
  sealed**; expect `blocked: true`, `safety_kernel_overall: "HOLD" | "BLOCK"`,
  and **`provider_submission_count: 0`** — zero provider submissions.
- Isolation guard: both synthetic obligation ids are hardcoded and distinct
  from genuine `OBL-J0C-*` ids; `assertSyntheticObligationId()` refuses any id
  matching that genuine pattern (`SimulatedDemoGuardError`, code `DEMO-001`).

### Operator script
1. Run the `curl` trigger above (or exercise the route from an internal tool /
   test harness — there is no judge-facing UI button for this route in this
   build).
2. Point out `happy_path.provider_submission_count === 1` and
   `blocked_variant.provider_submission_count === 0` as the hard evidence of
   "exactly one submission on PASS, zero on BLOCK."
3. Reiterate explicitly: this never touches Supabase, Circle/Arc, J0-D, or any
   genuine `OBL-J0C-*` obligation, and the genuine path's
   `J1_NO_CANDIDATE / STOP` result (Surface A) is unaffected by running this.

## Restart / reset

- Local dev: `Ctrl+C` then `npm run dev`; in-memory state resets on restart.
- Idempotency is enforced by idempotency key; re-running a completed flow returns
  the existing record rather than re-submitting.
- Surface B's `AuthorityStore` instance is created fresh inside each route
  invocation — every run is independent in-memory state, nothing persists.
- For a full clean slate, stop the server and restart (no durable local state to
  clear for the in-memory adapter).

## Operator must NOT do these (out of scope for the demo)

- Run `POST /api/j0d/run-connectivity-spike` (J0-D submit) — gated on Prime
  out-of-band approval; not part of the judge demo.
- Trigger any real provider call, wallet creation, faucet funding, or money
  movement, on either surface.
- Claim a J2 product payment on either surface; the genuine path stops at
  `J1_NO_CANDIDATE`, and Surface B's execution is simulated throughout.
- Describe Surface B as proving genuine candidate readiness or genuine trust
  evidence — it proves control-flow correctness on synthetic fixtures only.
- Push, merge, deploy, or take any financial/wallet action.

## Evidence docs cross-reference

- J0-D connectivity (historical pre-completion status; bind current status to
  README/GitHub closure — completed once, disposable wallets, not product trust):
  `docs/evidence/J0-D-CONNECTIVITY-SPIKE.md`
- Live provider connectivity (J0-B): `docs/evidence/J0-B-CONNECTIVITY.md`
- Genuine obligations (J0-C): `docs/evidence/J0-C-GENUINE-USAGE.md`,
  `data/live-usage/LIVE_USAGE_SET.json`
- Isolated synthetic happy-path demo source (admitted #44, merged PR #47):
  `src/demo/simulated-happy-path.ts`,
  `app/api/internal/demo/simulated-happy-path/route.ts`,
  `tests/simulated-happy-path.test.ts`
- Operational Report — HOLD/ESCALATE Attention Required (issue #15/#14, merged
  PR #51): `src/client/hold-escalate-report.ts`,
  `tests/hold-escalate-report.test.ts`
- Gate 3/Gate 4 adjudication and deferred findings: issue #50 comments
  5948433512 (Gate 3) and 5948610225 (Gate 4 writer rebind)
- This demo pack: `docs/demo/JUDGE-WALKTHROUGH.md`,
  `docs/demo/DEMO-RUNBOOK.md`, `docs/demo/DEMO-EVIDENCE-CHECKLIST.md`
