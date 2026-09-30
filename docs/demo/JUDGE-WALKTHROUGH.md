# Judge Walkthrough — Tameion Demo (Issue #42 / TAMEION-DEMO-PREP-001)

> Scope: judge-facing review of the Command Center state flow for Issue #42
> (TAMEION-DEMO-PREP-001). Describes what a judge observes at each gate under the
> **current** demo state — fail-closed on `SIMULATED_DEMO_FIXTURE` — plus the
> conditional PAY → PAE → execution → reconciled path, which is future/gated under
> proposed issue #44 and is **not** runnable now. Run from HEAD
> `448b66148b601a3f69e25a0eb2b071bce7eae1c6`, branch `demo/judge-pack-42`.

## 1. Truth framing — read before you click anything

The demo is intentionally bounded. Four boundaries are enforced in code and must
stay distinct in what you observe:

1. **NO ASSURANCE, NO EXECUTION.** AI *proposes*, a human *authorizes the exact
   intent*, a deterministic Safety Kernel *decides what may execute*. AI output is
   advisory-only — never shown as final payment authority. Sources:
   `src/safety-kernel/kernel.ts` (pure, no AI) and `README.md` (lines 3, 9, 66).
2. **J0-D testnet connectivity ≠ product trust.** At the exact base state
   (`448b661`) and current HEAD, the admitted J0-D Arc/Circle connectivity spike
   was **completed and reconciled exactly once** using *disposable* spike wallets.
   It is infrastructure/connectivity evidence only and **did not** establish
   per-obligation product destination or source-wallet trust. It is **not** a
   product-payment proof, must not be treated as J1/J2 authorization, and
   **must not be rerun** in the judge demo. The spike is isolated from
   `AuthorityStore`, the PAE signer, and `ExecutionWorker`
   (`src/j0d-spike/connectivity-spike.ts`). Note:
   `docs/evidence/J0-D-CONNECTIVITY-SPIKE.md` retains **historical** pre-
   completion status text; bind current status to README / GitHub closure rather
   than quoting that file's stale headline.
3. **Simulated demo state ≠ live provider truth.** This build runs
   `FakeProviderAdapter` (`adapter.name === "fake-testnet"`,
   `settlement_runtime: "SIMULATED"`) and `DEMO_ARC_TRUST_SIMULATED = true`
   (API field `demo_arc_trust_simulated: true`,
   `product_trust_provenance: "SIMULATED_DEMO_FIXTURE"`). All 5 obligations carry
   `arc_product_destination_status: "PENDING_J0_D_TRUST_SEED"`. Source:
   `src/server/demo-state.ts` and `app/api/obligations/[id]/route.ts`.
4. **J2 product payment is NOT demonstrated and must not be claimed.** Execution
   is simulated end-to-end. "View exact intent for a real J2 transfer" is a
   **read-only disclosure** for Prime's out-of-band approval; it submits nothing.
   A real J2 transfer closes only after an authentic PAE-gated Arc submission +
   exact provider status evidence + one-to-one reconciliation
   (`tameion-verification-baseline.v1.md`, `j2_transaction_proof`). Sources:
   `src/pipeline/prime-approval-packet.ts`, `src/execution/fake-provider-adapter.ts`.

## 2. What you are looking at

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

## 3. The five-panel golden path and expected states

### Panel 1 — Obligations
- **Action:** open Command Center; review the obligation list. The right pane shows
  authoritative amount/network/aggregate version and current destination + source-
  wallet trust.
- **Judge check:** the truth layer shows the simulated markers from §1 (boundary
  #3) — `demo_arc_trust_simulated: true`, `settlement_runtime: "SIMULATED"`,
  `product_trust_provenance: "SIMULATED_DEMO_FIXTURE"`. This is the honest framing:
  the demo trust set is a fixture, not live provider trust.
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
- **Expected PASS/HOLD/BLOCK (current HEAD, fail-closed):** because every demo
  aggregate carries `product_trust_provenance: "SIMULATED_DEMO_FIXTURE"` (mapped
  by J1-A to `NOT_READY_SIMULATED_FIXTURE`), the assessment surfaces the
  simulated/non-current trust disclosure and resolves to `HOLD`/`ESCALATE` —
  **no executable `PAY` candidate is produced**. This is a fail-closed default on
  incomplete provider-trust evidence, never a default-to-PAY (P0 tests #13/#14:
  invalid/timeout/provider-failed runs cannot default to PAY).
- **Gate:** sole-candidate-selection is enforced **server-side** (`approve()` in
  `src/authority/aggregate.ts`). Assessing all 5 is required for coverage `5/5`,
  but the non-executable HOLD/ESCALATE results mean authorization is **not**
  enabled — the refusal occurs at the trust/authority gate next.

### Panel 3 — Authorization (currently refused — fail-closed)
- **Action:** click **"Authorize this exact intent"** to observe the current
  refusal (this is the truthful result, not a success).
- **Code path:** `POST /api/obligations/[id]/approve` runs the real reviewed-N →
  authorized-(N+1) compare-and-swap transition, then the real Safety Kernel
  (`runSafetyKernel`, `src/safety-kernel/kernel.ts`). A PAE is sealed **only** if
  every required control (`REQUIRED_CONTROL_IDS_P0`, `src/domain/schemas.ts`)
  returns `PASS`. There is **no** path from HOLD/BLOCK to submission.
- **Current HEAD (fail-closed):** with `product_trust_provenance: SIMULATED_DEMO_FIXTURE`,
  `hasCurrentProductTrustEvidence()` is false, so the Safety Kernel's
  destination/source-wallet trust controls **block** (`SK-DESTINATION-TRUST`,
  `SK-SOURCE-WALLET-AUTHORITY`); approval is refused with **AUT-016** and a
  **visible red refused banner** with the exact finding codes, and **no PAE is
  sealed** — zero execution release is granted. This is the judge-facing result.
- **Conditional future path (issue #44; NOT runnable now):** with genuine current
  non-simulated product trust, an all-`PASS` kernel would seal a real signed PAE →
  banner **"Authorized — PAE Sealed"** (`execution_release_authority =
  TAMEION_PAE_REVERIFY_REQUIRED`), with execution as a separate later action.
- **Judge check:** there is **no** "authorize and execute" single step, and no PAE
  or execution release is granted in the current demo state.

### Panel 4 — Assurance & Execution (not attainable in the current demo)
- **Current HEAD:** "Submit for execution (simulated)" is **not attainable** — with
  no sealed PAE (refused at the trust gate, §3), the Execution Worker has no
  execution-release authority to consume; the action is gated on
  `detail.pae_sealed` and stays disabled. **Do not** click it expecting a
  `Reconciled` result.
- **Code path (conditional):** `POST /api/obligations/[id]/execute` runs the real
  `ExecutionWorker` (`src/execution/worker.ts`) — idempotent claim (UNUSED→RESERVED),
  PAE re-verification, and a **simulated** provider (`FakeProviderAdapter`,
  `adapter.name "fake-testnet"`, `settlement_runtime "SIMULATED"`) — the in-repo
  fake, **not** live Circle/Arc truth. Conditional intended sequence with genuine
  trust: `Authorized — PAE Sealed` → `Execution reserved` → `Submitted to provider`
  → **`Reconciled`** (one-to-one settlement match). Not reachable now.
- **Action B — Prime packet (read-only, submits nothing):** "View exact intent for
  a real J2 transfer" (`GET /api/obligations/[id]/prime-approval-packet` →
  `buildJ2PrimeApprovalPacket`, `src/pipeline/prime-approval-packet.ts`) shows
  obligation/version, amount, asset, network, source/destination identity +
  fingerprint, and PAE instruction id/hash/signing key/expiry. Available only
  *after* a PAE is sealed (not reached now).
- **Critical judge check:** "Submit for execution (simulated)" settles to
  `Reconciled` only via the **fake** provider **if** the prior gates pass; the
  Prime packet performs no settlement at all. A real J2 transfer requires Prime's
  explicit out-of-band approval of the exact packet and is **not** a payment until
  then.

### Panel 5 — Reconciliation & Evidence (attack — not reachable now)
- **Current HEAD:** "Simulate changed-destination attack" requires a **sealed PAE**
  (its button is disabled otherwise), so it is **not reachable** in the current
  demo state. This is correct and expected: no PAE ⇒ no execution path to attack.
- **Conditional code path (issue #44; NOT reachable now):**
  `POST /api/obligations/[id]/simulate-attack` mutates the destination as if a
  compromised session changed it, then runs the Execution Worker, which **BLOCKs
  before any provider call** — `Blocked` banner — with zero submissions
  (idempotency-key / economic-effect boundary; `src/execution/worker.ts`). Only
  reachable after a sealed PAE exists.
- The raw truth layer (showing `product_trust_provenance: SIMULATED_DEMO_FIXTURE`,
  `settlement_runtime: "SIMULATED"`) and sealed assessment artifacts are also
  shown here ("Raw evidence / response") — confirm the simulated/non-current trust
  disclosure and the AUT-016 refusal, with no PAE sealed and no execution release.

## 4. States quick reference

| Stage | Terminal states you may see | Code source |
|---|---|---|
| Assessment decision | `PAY` / `HOLD` / `ESCALATE` | `DurableAssessmentRecord.decision` |
| Safety Kernel overall | `PASS` / `HOLD` / `BLOCK` | `SafetyKernelResult.overall` |
| Post-auth banner | `Authorized — PAE Sealed` · `Reconciled` · `Blocked` · `Provider response unknown` · `Execution failed` · `PAE expired` · `Submitted to provider` · `Submission state in doubt` · `Execution reserved` · `Execution suspended` · `PAE consumed` · `Awaiting human authorization` · `Loading` | `workflowState()` in `app/command-center.tsx` |
| Execution release authority | `TAMEION_PAE_REVERIFY_REQUIRED` · `RESERVED_FOR_EXECUTION` · `SUBMITTED_TO_PROVIDER` · `IN_DOUBT_PROVIDER_SUBMISSION` · `CONSUMED` · `REVOKED` · `EXPIRED` · `SUSPENDED_KILL_SWITCH` · `BLOCKED` · `NOT_GRANTED` | `buildPaymentTruthLayers` / `deriveExecutionReleaseAuthority` |
| J0-D preflight (separate; **not** the demo) | `READY_FOR_EXPLICIT_AUTHORIZATION` · `FUNDING_REQUIRED` · `AUTHORIZATION_CEILING_EXCEEDED` · `BLOCKED_EXTERNAL` | `j0dPreflightResultSchema` |

> A **BLOCK** anywhere stops the line. A failed Safety Kernel means **no PAE is
> sealed** — there is no path from HOLD/BLOCK to submission.
>
> In the **current** demo state (`SIMULATED_DEMO_FIXTURE`), only the fail-closed
> branch is reached: assessments resolve `HOLD`/`ESCALATE`, authorization refuses
> (`AUT-016`, `NOT_READY_SIMULATED_FIXTURE`; `SK-DESTINATION-TRUST` /
> `SK-SOURCE-WALLET-AUTHORITY` blocked), and no `Authorized — PAE Sealed` or
> `Reconciled` state is produced. The success sequence is conditional on issue #44.

## 5. What does NOT happen in this demo (and must not be claimed)

- The J0-D connectivity spike is **not rerun** as part of the judge demo (it was
  completed and reconciled once under J0 with disposable wallets; §1 boundary #2).
  It is infrastructure evidence only and is not J1/J2 authority. Read-only preflight
  may be shown **only** as a non-submitting probe; the submit route is gated on
  Prime's out-of-band approval and is **not** exercised here.
- No real J2 product payment. In the current demo state no PAE is sealed and no
  execution release is granted; `FakeProviderAdapter` is the in-repo simulated
  provider, never live Circle/Arc truth. The `Reconciled` path is a conditional
  future/gated path (issue #44), not reachable now.
- No live provider calls, wallet creation, faucet funding, or money movement.
  Local dev uses a deterministic fallback + an ephemeral dev signing key
  (`TAMEION-DEMO-PAE-KEY-1`), which is explicitly **not** for J2.

## 6. Where the proof lives

- J0-D connectivity evidence (historical pre-completion status; current status
  binds to README/GitHub closure — completed once, disposable wallets, not product
  trust): `docs/evidence/J0-D-CONNECTIVITY-SPIKE.md`
- Live provider connectivity (J0-B): `docs/evidence/J0-B-CONNECTIVITY.md`
- Genuine obligations (J0-C): `docs/evidence/J0-C-GENUINE-USAGE.md`,
  `data/live-usage/LIVE_USAGE_SET.json`
- Event-start baseline: `docs/evidence/J0-EVENT-START-BASELINE.md`
- Verification baseline / J2 transaction-proof rule: `docs/frozen-design/v1.4.22/`
- Automated negative-path coverage: `tests/` (golden-path, negative-paths,
  payment-control-boundary, j0d-* suites)
- This demo pack: `DEMO-RUNBOOK.md`, `DEMO-EVIDENCE-CHECKLIST.md` (same directory)
