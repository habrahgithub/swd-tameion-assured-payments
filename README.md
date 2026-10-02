# Tameion

Tameion is an ERP-native assured payment control plane for the Canteen × Circle hackathon: AI proposes what should be paid, a human authorizes the exact intent, and deterministic, cryptographically bound controls decide what may execute.

**Branch status:** `main` holds the verified J0 baseline (app shell, provider connectivity evidence, genuine obligation dataset). The `prototype/claude-autonomy` branch (this branch, if you are reading it there) is an active prototype build covering J0-D through J3 under `DIR-TAMEION-PROTOTYPE-CLAUDE-001` — see "Prototype status" below before assuming anything here is production- or judged-demo-ready.

## ERP-native control-plane boundary

Tameion does not replace an ERP or accounting system. The upstream business system remains the system of record for vendors, invoices/obligations, source approvals and accounting state. The vendor-neutral canonical payment-obligation contract supports ERP, accounting-system, API, CSV-import and direct-evidence source records. Only the existing `DIRECT_EVIDENCE` adapter is implemented in the hackathon prototype; vendor-specific connectors are not. Tameion then owns AI assessment, exact-intent human authorization, deterministic assurance, execution orchestration, reconciliation and evidence. Circle Developer-Controlled Wallets and Arc are the target settlement rail/provider truth.

An upstream `APPROVED` state is descriptive input only. The canonical source contract cannot carry Tameion execution authority. **NO ASSURANCE, NO EXECUTION** remains the invariant, and a sealed Tameion PAE is still re-verified server-side by the Execution Worker before provider submission. The current J0-C obligations are truthfully labeled `DIRECT_EVIDENCE`; this prototype does not claim they originated from an ERP. Vendor-specific ERP connectors are outside the hackathon scope. Architecture authority: GitHub issue #20 (`ADR-TAMEION-ERP-001`); implementation directive: issue #21 (`TAMEION-ERP-BOUNDARY-001`).

## Runtime

- Node.js 24.21.0
- npm 11.19.0
- Next.js 16.3.6
- React 19.3.0
- TypeScript 7.0.2
- Tailwind CSS 4.3.3

Use the pinned Node version before installing dependencies:

```bash
nvm use
npm ci
npm run dev
```

The development server is available at `http://localhost:3000`.

## Verification

```bash
npm run check:hygiene
npm run typecheck
npm test
npm run build
```

`npm run verify` runs the same checks as one local command. CI performs a clean install and repeats the complete sequence.

## Environment boundary

Copy `.env.example` to `.env.local` only when local configuration is needed. The committed example contains variable names with empty values; never add real values to it.

- `NEXT_PUBLIC_*` variables are public and may be included in browser bundles. Only non-sensitive presentation configuration may use that prefix.
- Provider credentials, financial configuration, private keys, tokens, service-role keys, and database credentials are server-side only. They must never use the `NEXT_PUBLIC_*` prefix or be imported into Client Components.
- `.env*` files are ignored except for `.env.example`. Runtime secrets belong in the deployment provider's server-side secret store.

The repository hygiene check rejects tracked environment files, common credential signatures, generated output, and secret-like `NEXT_PUBLIC_*` names. It reports only the affected filename and rule; it does not print matching content.

The internal J1-D capability smoke route (`POST /api/internal/j1d/capability-smoke`) is preview-only, disabled unless `J1D_SMOKE_ENABLED=true`, and requires a deployment-managed `J1D_SMOKE_SECRET` of at least 32 bytes as a bearer token plus the fixed confirmation body. It sends only a server-built synthetic context to the pinned NVIDIA provider, does not read or persist obligation state, and must be invoked only under AXIS's separate one-request operational gate. Never put the secret in source, examples, logs, or client code.

## Current scope

The event-start record remains in [`docs/evidence/J0-EVENT-START-BASELINE.md`](docs/evidence/J0-EVENT-START-BASELINE.md).

## Prototype status (`prototype/claude-autonomy`)

Implemented and tested (full verification suite passing):

- **Numeric safety** (`src/domain/numeric.ts`): exact decimal <-> atomic USDC conversion, no floating point, no silent truncation.
- **PAE-P0-1** (`src/pae/`): RFC 8785 JCS canonicalization, SHA-256, Ed25519 sign/verify, a versioned trusted-key registry, and durable approval/assurance record hashing — matches the blueprint's Canonicalization Contract field-for-field.
- **Safety Kernel** (`src/safety-kernel/kernel.ts`): deterministic evaluation of all 10 required P0 controls; a PAE can only be sealed when every control PASSes.
- **Authority aggregate** (`src/authority/aggregate.ts`): one `ObligationAuthorityAggregate` per obligation with `expected_version` CAS semantics and the atomic reviewed-N -> authorized-N+1 approval transition.
- **Execution Worker** (`src/execution/worker.ts`): idempotent claim (UNUSED -> RESERVED), replay/concurrency safety, pre-submit BLOCK on a destination changed after authorization, kill switch, UNKNOWN/no-blind-retry handling, and one-to-one settlement reconciliation.
- **Finance Agent** (`src/agent/`): CARE-bounded advisory prompt and strict recommendation schema; application-owned finding codes and deterministic facts normalize into durable RACE sections and catalog-derived remediation. Model explanation is explicitly non-authoritative. The provider cannot approve/sign/execute; malformed output or unmet readiness fails closed. Backed by the existing eval bank and #17 grounding regressions.
- **J3 Command Center UI** (`app/command-center.tsx` + `app/api/obligations/**`): one page, six sections (Obligations / Assessment / Authorization / Assurance & Execution / Reconciliation & Evidence / Operational Report) matching the blueprint's Command Center, driving the real pipeline above against the actual `data/live-usage/LIVE_USAGE_SET.json` obligations. Restrained financial-operator visual language (no gradients/glassmorphism/AI-SaaS clichés); explicit text state labels, never colour alone.
- **Operational Report — HOLD/ESCALATE Attention Required** (`src/client/hold-escalate-report.ts`, wired into the "Operational Report" panel of `app/command-center.tsx`; issue #15/#14, PR #51): a read-only report derived from authoritative current assessment and obligation state. Defaults fail-closed to `HOLD` when the sealed assessment is absent (`UNASSESSED`) or stale (aggregate-version mismatch); otherwise uses the actual sealed decision. `PAY` is shown truthfully but flagged out of scope and never implies a settled or executed payment. It never reads or mutates execution, PAE, or reconciliation state. **Paid/Reconciled and Execution Register remain deferred** (issue #50 roadmap) until authoritative settled/execution truth exists.
- **J2 Prime approval packet** (`src/pipeline/prime-approval-packet.ts`, wired into the Assurance & Execution panel): renders the exact-intent disclosure (obligation/version, amount, asset, network, source wallet identity/fingerprint, destination identity/fingerprint, PAE instruction id/hash/signing key/expiry) that a real J2 transfer requires Prime to explicitly approve before submission. Building this packet never submits anything; it is a read-only artifact for the human decision.
- **Real J0-D connectivity spike + read-only preflight** (`src/j0d-spike/`, `app/api/j0d/**`): the preflight validates recovered Circle wallet/provider truth, pins native `ARC-TESTNET` USDC, includes a non-submitting `MEDIUM` fee estimate, and returns a versioned v2 intent plus its SHA-256 `intent_fingerprint` without wallet creation, faucet calls, or transaction submission. Every v2 intent requires the exact fixed literals `max_network_fee: "0.002"` and `max_total_debit: "0.012"` USDC. The strict schema rejects v1, missing caps, tighter or larger caps, and zero caps. Preflight returns READY only when the current fee is at most 0.002 USDC and current total debit is at most 0.012 USDC. The intent binds the immutable transfer tuple and point-in-time fee evidence. The resume-only spike requires the recovered context and Prime's approval of that exact intent; it reruns preflight, blocks immutable transfer changes, and permits fee changes below or above the original estimate only while current fee and total debit remain within those fixed caps. These are pre-submit Circle fee-estimate ceilings, not guarantees of the final network fee charged: the installed Circle SDK's `feeLevel: MEDIUM` is incompatible with Circle manual `maxFee`/`priorityFee` parameters. This issue preserves `MEDIUM` and does not switch to manual gas parameters. Immediately before submission it queries Circle for prior `OUTBOUND` existence using the source wallet, `ARC-TESTNET`, `OUTBOUND`, page size 1, and descending order. Zero rows means no outbound is visible in Circle's current provider truth at that moment; any returned outbound blocks, and malformed or ambiguous responses fail closed. The full `intent_fingerprint` binds Prime's exact authorization evidence. The Circle idempotency key instead derives from a v2 stable execution identity that excludes fee estimate, minimum total, fixed caps, and preflight timestamp, and includes the fuller v2 provider-token identity. The resulting v2 key may differ from the v1 J0-D identity/key; this migration is accepted because no live v1 J0-D transfer occurred. No durable cross-serverless ledger or lock exists. The spike cannot create wallets or call the faucet. All orchestration has fake-client coverage; the admitted J0-D spike was separately completed and reconciled; no J1/J2 product payment has been run.

**Known limitations / not yet done:**

- **External capability and settlement gates:**
  - **NVIDIA live reasoning: `UNVERIFIED_FOR_J1`.** A historical credential check returned HTTP 401 before the frozen J1 runtime configuration was implemented. The J1 adapter now fails closed on configured provider errors; deployment credential validity and live inference still require the separately admitted J1-D capability proof.
  - **J0-D connectivity: completed. Product destination/source-wallet trust remains separately gated.** The J0-D spike used disposable wallets and did not establish per-obligation product trust. Demo aggregate trust values are simulated fixtures and cannot make J1 readiness READY; current, non-simulated product-trust evidence is required. The J0-C dataset intentionally retains its historical `PENDING_J0_D_TRUST_SEED` source value. J1 has not authorized a product payment.
  - **Settlement amount is distinct from source truth.** The source obligation amount/currency remains authoritative for the obligation. The aggregate amount is the settlement/execution-rail amount; for unsupported non-USD currency its `0.000000` value is a blocked-rail sentinel, not a converted source amount.
  - **J2 execution is still simulated** (`FakeProviderAdapter`) — unchanged, and intentionally so pending Prime's exact-intent approval for a real transfer.
- **P0 demo-state persistence:** Vercel Preview and Production load and compare-and-set authority, append-only assessments and approvals, sealed PAE, kill switches, execution/idempotency status, and provider simulator state through Supabase Postgres. SQL migrations are in `supabase/migrations/`; the tables are private, and only the server-side service role can call their RPCs. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in both Vercel environments. If either is missing in Preview or Production, the app fails closed instead of using process-local state. Local development and tests may use the memory adapter.
- **J0-D connectivity-spike state remains separate:** the admitted spike was completed and reconciled under J0. Its process-local resume context is historical; do not rerun it or treat it as J1/J2 product-payment authorization.

None of the above is silently glossed over: provider failures are surfaced as typed blockers, while execution remains simulated until a separate product-transfer gate.

## Gate status (issue #50)

Deployed carrier at the most recent AXIS adjudication (`GATE3_PASS_WITH_DEFERRED_FINDINGS`, issue #50 comment 5948433512): merged head `ebd74b8855755f6cedbe24f09d2956fea3468c33` (PR #52), Vercel deployment `dpl_DX4zcw74x3boSsMn8FDoH26fqrHR`, verified `READY`/HTTP 200 at that exact head.

Two findings remain open, deferred rather than submission-blocking:

- **Visual token collision (`DEFER_POST_HACKATHON`):** `--color-accent` and the reserved `--color-attestation` token in `app/globals.css` currently share the same value (`#c5a059`). No current UI consumes `--color-attestation`, so there is no present ambiguity between an ordinary affordance and a live cryptographic-attestation/irrevocable-action signal. Before any attestation or irrevocable-action UI consumes that reserved token, the two must be made visually distinct or the token contract re-adjudicated.
- **Rendered-browser QA pass:** a true rendered-browser desktop + compact-responsive pass has not yet been completed (Chromium was unavailable in the Gate 3 review environment). This is a visual/UAT evidence gap, not a runtime or deployment failure — Vercel independently confirms the exact deployment is `READY`. This pass remains required before Gate 5 submission freeze.

## Demo runbook

Cold start:

```bash
nvm use && npm ci
npm run verify   # hygiene -> typecheck -> test -> build, all from a clean tree
npm run dev      # http://localhost:3000
```

Judge flow (all 5 obligations are the genuine, privacy-safe J0-C dataset):

1. **Obligations** — pick any obligation; the right pane shows its authoritative amount/network/aggregate version and current destination/wallet trust.
2. **Assessment** — "Run assessment" calls the configured advisory provider (deterministic fallback only when no model key is configured; see limitations above) and shows its PAY/HOLD/ESCALATE result, application-owned findings, and catalog-derived remediation. Any model explanation is labeled non-authoritative. The full RACE result is sealed in the immutable, hash-addressable assessment artifact (`assessment_hash` in the response) — this, not any client claim, is what authorization is gated on. **Visit every obligation and run its assessment before trying to authorize any one of them** — the sole-candidate-selection gate refuses approval while any obligation in the set is still unassessed (this is enforced server-side, not just a UI suggestion).
3. **Authorization** — "Authorize this exact intent" performs the real T1 approval CAS transition (refusing unless this obligation's sealed assessment is PAY, still bound to the current version, and no other obligation is already the committed candidate), runs the real Safety Kernel, and — only on all-PASS — seals a real signed PAE. Watch the state banner change to "Authorized — PAE Sealed". A refused attempt now surfaces a visible red banner with the exact reason, not just a raw JSON blob.
4. **Assurance & Execution** — "Submit for execution (simulated)" runs the real Execution Worker (idempotent claim, re-verification, simulated provider) end to end to "Reconciled". The separate "View exact intent for a real J2 transfer" link shows the Prime approval packet that would gate an actual transfer — it does not submit anything.
5. **Reconciliation & Evidence** — on a *different* obligation you have authorized, "Simulate changed-destination attack" mutates the destination as if compromised and proves the Execution Worker BLOCKs before any provider call, with zero submissions.

Negative/demo evidence already covered by the automated suite (not just the UI): replay/duplicate execute, provider UNKNOWN with no blind retry, kill switch, tampered PAE fields (amount/destination/version/expiry/signature), asset/network/amount-scale rejection, and an obligation that never passed approval.
