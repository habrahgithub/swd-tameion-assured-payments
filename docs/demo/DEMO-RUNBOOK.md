# Demo Runbook — Tameion (Issue #42 / TAMEION-DEMO-PREP-001)

Operator guide to stand up, verify, and replay the **simulated** judge golden path.
Run from HEAD `448b66148b601a3f69e25a0eb2b071bce7eae1c6`, branch `demo/judge-pack-42`.

## Truth boundary — operator must assert these before demo

- **NO ASSURANCE, NO EXECUTION:** AI proposes → human authorizes exact intent →
  deterministic Safety Kernel decides what may execute. AI output is advisory.
- **J0-D connectivity spike is infrastructure evidence only — completed and
  reconciled exactly once with disposable spike wallets (bind current status to
  README; not a product-payment proof; not J1/J2 authority; NOT rerun in the
  demo).** Do NOT run the J0-D spike or its submit route
  (`POST /api/j0d/run-connectivity-spike`) during the demo. Read-only preflight
  (`POST /api/j0d/preflight`) may be shown only as a non-submitting probe.
  `docs/evidence/J0-D-CONNECTIVITY-SPIKE.md` is historical pre-completion text.
- **Current fail-closed (HEAD `448b661`):** every demo aggregate carries
  `product_trust_provenance: "SIMULATED_DEMO_FIXTURE"` (J1-A →
  `NOT_READY_SIMULATED_FIXTURE`). Assessments resolve HOLD/ESCALATE (no executable
  PAY candidate); authorization refuses **AUT-016** (`SK-DESTINATION-TRUST` /
  `SK-SOURCE-WALLET-AUTHORITY` blocked) and **no PAE is sealed** — zero execution
  release. `FakeProviderAdapter` (`adapter.name "fake-testnet"`, `settlement_runtime
  "SIMULATED"`) is the in-repo simulated provider, never live Circle/Arc truth.
  All obligations show `PENDING_J0_D_TRUST_SEED`.
- **J2 payment NOT proven:** no PAE/execution release in the current demo; the
  simulated Reconciled path is a conditional future/gated path (issue #44), not
  runnable now. The Prime approval-packet view is read-only and submits nothing.

## Prerequisites

- Node.js 24.21.0 (`nvm use`), npm 11.19.0; Next 16.3.6 / React 19.3.0 /
  TypeScript 7.0.2 (see `.nvmrc` and `package.json`).
- Local dev needs **no** provider credentials. Only `.env.example` is committed
  (variable names, empty values). Set `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
  only if you want Supabase-backed state locally; otherwise the app falls back to
  the in-memory adapter (fine for the demo).

## Cold start & verification gate

```bash
nvm use
npm ci
npm run verify   # hygiene -> typecheck -> test -> build, all from a clean tree
npm run dev      # http://localhost:3000
```

**Pre-demo gate:** `npm run verify` must be GREEN (hygiene, typecheck, tests, build).
CI runs the same sequence on every push to `main` (`.github/workflows/ci.yml`).

## Start the demo

1. Open `http://localhost:3000` → Command Center, **Obligations** panel.
2. Confirm all 5 obligations load; the coverage counter shows `0/5` assessed.
3. Inspect the truth layer (right pane → "Raw evidence / response"):
   `demo_arc_trust_simulated: true`, `settlement_runtime: "SIMULATED"`,
   `product_trust_provenance: "SIMULATED_DEMO_FIXTURE"`. **Observe the
   simulated/non-current trust disclosure** — this is what drives the fail-closed
   path below (no PAY candidate, no PAE, no execution release).

## Golden path (scripted operator steps)

### Step 1 — Obligations
Pick any obligation; the right pane shows authoritative amount, network,
aggregate version, and current destination/source-wallet trust (simulated fixture).

### Step 2 — Assessment (run on ALL 5 — current path is fail-closed)
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

### Step 3 — Authorization (currently refused — fail-closed)
Click **"Authorize this exact intent"** to observe the current refusal (this is
the truthful result, not a success). `POST /api/obligations/[id]/approve` runs the
real reviewed-N → authorized-(N+1) compare-and-swap transition, then the real
Safety Kernel (`runSafetyKernel`, `src/safety-kernel/kernel.ts`). A PAE is sealed
**only** if every required control (`REQUIRED_CONTROL_IDS_P0`,
`src/domain/schemas.ts`) returns `PASS` — and that requires genuine current
non-simulated product trust.

- **Current state (SIMULATED_DEMO_FIXTURE):** `hasCurrentProductTrustEvidence()`
  is false, so `SK-DESTINATION-TRUST` / `SK-SOURCE-WALLET-AUTHORITY` **block**;
  approval is refused with **AUT-016** and a **visible red refused banner**;
  **no PAE is sealed**, zero execution release.
- **Conditional future path (issue #44; NOT runnable now):** with genuine current
  non-simulated product trust, an all-`PASS` kernel would seal a real signed PAE →
  banner **"Authorized — PAE Sealed"** (`execution_release_authority =
  TAMEION_PAE_REVERIFY_REQUIRED`); execution is then a separate later action.

### Step 4 — Assurance & Execution (not attainable in the current demo)
- **"Submit for execution (simulated)"** is **not attainable now**: with no sealed
  PAE (refused at the trust gate, Step 3) the Execution Worker has no execution-
  release authority to consume; the action is gated on `detail.pae_sealed` and
  stays disabled. **Do not** click it expecting a `Reconciled` result.
- **Conditional code path:** `POST /api/obligations/[id]/execute` runs the real
  `ExecutionWorker` (`src/execution/worker.ts`) — idempotent claim (UNUSED→RESERVED),
  PAE re-verification, and a **simulated** provider (`FakeProviderAdapter`,
  `adapter.name "fake-testnet"`, `settlement_runtime "SIMULATED"` — the in-repo fake,
  **not** live Circle/Arc truth). Intended sequence with genuine trust:
  `Authorized — PAE Sealed` → `Execution reserved` → `Submitted to provider` →
  **`Reconciled`** (one-to-one settlement match). Gated on genuine current
  non-simulated product trust + later J2/Prime gates; not reachable now.
- **"View exact intent for a real J2 transfer (Prime approval packet)"** → read-
  only disclosure (`GET /api/obligations/[id]/prime-approval-packet` →
  `buildJ2PrimeApprovalPacket`, `src/pipeline/prime-approval-packet.ts`):
  obligation/version, amount, asset, network, source/destination identity +
  fingerprint, PAE instruction id/hash/signing key/expiry. **Submits nothing.**
  Available only *after* a PAE is sealed (not reached now).

### Step 5 — Reconciliation & Evidence (attack — not reachable now)
"Simulate changed-destination attack" requires a **sealed PAE** (button disabled
otherwise), so it is **not reachable** in the current demo state — correct, since
no PAE is sealed. **Conditional code path:** `POST /api/obligations/[id]/simulate-attack`
mutates the destination as if compromised, then the Execution Worker **BLOCKs
before any provider call** with zero submissions (idempotency-key / economic-effect
boundary; `src/execution/worker.ts`). Only reachable after a sealed PAE exists.

## Restart / reset

- Local dev: `Ctrl+C` then `npm run dev`; in-memory state resets on restart.
- Idempotency is enforced by idempotency key; re-running a completed flow returns
  the existing record rather than re-submitting.
- For a full clean slate, stop the server and restart (no durable local state to
  clear for the in-memory adapter).

## Operator must NOT do these (out of scope for the demo)

- Run `POST /api/j0d/run-connectivity-spike` (J0-D submit) — gated on Prime
  out-of-band approval; not part of the judge demo.
- Trigger any real provider call, wallet creation, faucet funding, or money
  movement.
- Claim a J2 product payment; execution is simulated throughout.
- Push, merge, deploy, or take any financial/wallet action.

## Evidence docs cross-reference

- J0-D connectivity (historical pre-completion status; bind current status to
  README/GitHub closure — completed once, disposable wallets, not product trust):
  `docs/evidence/J0-D-CONNECTIVITY-SPIKE.md`
- Live provider connectivity (J0-B): `docs/evidence/J0-B-CONNECTIVITY.md`
- Genuine obligations (J0-C): `docs/evidence/J0-C-GENUINE-USAGE.md`,
  `data/live-usage/LIVE_USAGE_SET.json`
- This demo pack: `docs/demo/JUDGE-WALKTHROUGH.md`,
  `docs/demo/DEMO-RUNBOOK.md`, `docs/demo/DEMO-EVIDENCE-CHECKLIST.md`
