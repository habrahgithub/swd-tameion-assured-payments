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
- **J3 Command Center UI** (`app/command-center.tsx` + `app/api/obligations/**`): one page, five sections (Obligations / Assessment / Authorization / Assurance & Execution / Reconciliation & Evidence) matching the blueprint's Command Center, driving the real pipeline above against the actual `data/live-usage/LIVE_USAGE_SET.json` obligations. Restrained financial-operator visual language (no gradients/glassmorphism/AI-SaaS clichés); explicit text state labels, never colour alone.
- **J2 Prime approval packet** (`src/pipeline/prime-approval-packet.ts`, wired into the Assurance & Execution panel): renders the exact-intent disclosure (obligation/version, amount, asset, network, source wallet identity/fingerprint, destination identity/fingerprint, PAE instruction id/hash/signing key/expiry) that a real J2 transfer requires Prime to explicitly approve before submission. Building this packet never submits anything; it is a read-only artifact for the human decision.
- **Real J0-D connectivity spike + read-only preflight** (`src/j0d-spike/`, `app/api/j0d/**`): the preflight validates recovered Circle wallet/provider truth, pins native `ARC-TESTNET` USDC, includes a non-submitting `MEDIUM` fee estimate, and returns an exact intent plus its SHA-256 `intent_fingerprint` without wallet creation, faucet calls, or transaction submission. The resume-only spike requires the recovered context and Prime's approval of that exact intent; it reruns preflight and stops on material changes. Immediately before submission it queries Circle for prior `OUTBOUND` existence using the source wallet, `ARC-TESTNET`, `OUTBOUND`, page size 1, and descending order. Zero rows means no outbound is visible in Circle's current provider truth at that moment; any returned outbound blocks, and malformed or ambiguous responses fail closed. The full `intent_fingerprint` binds Prime's exact authorization evidence. The Circle idempotency key instead derives from a separate stable execution identity that excludes volatile fee, minimum-total, and preflight-timestamp fields. No durable cross-serverless ledger or lock exists. The spike cannot create wallets or call the faucet. All orchestration has fake-client coverage; no live transfer has been run.

**Known limitations / not yet done:**

- **Live provider verification has now actually run, from a local executor session with real network access and real credentials. Neither result is a clean pass:**
  - **NVIDIA live reasoning: `NVIDIA_LIVE = BLOCKED_AUTH`.** A real call to `NvidiaProvider` against `https://integrate.api.nvidia.com/v1/chat/completions` (model `nvidia/nemotron-3-super-120b-a12b`) returned genuine `HTTP 401 Unauthorized` — confirmed real network I/O, not the deterministic fallback. Repeated across three independently-sourced credential values with the same result. Structural check confirmed the configured key does not match the `nvapi-*` hosted-inference-key format NVIDIA documents for this endpoint (a different NVIDIA credential type, e.g. an NGC/container key, was likely provisioned instead). The Finance Agent still automatically prefers `NvidiaProvider` whenever `NVIDIA_API_KEY` is present, and falls back to `DeterministicFallbackProvider` only when it is absent — but a *present-and-invalid* key currently throws `AiProviderError` rather than falling back, so the assess route will surface a 500 until the key is repaired. This is deferred pending a corrected hosted-inference API key from build.nvidia.com.
  - **J0-D Arc/Circle connectivity: `EXTERNAL_CIRCLE_FAUCET_PERMISSION_BLOCKER`, not complete.** A real invocation created a disposable wallet set and two `ARC-TESTNET` EOA wallets via the live Circle Developer-Controlled Wallets API, then failed at the funding step: the authenticated `/v1/faucet/drips` call returns `HTTP 403 {"code":3,"message":"Forbidden"}`. The "unnecessary `native:true`" hypothesis was tested directly against the recovered wallet and disproven (`usdc:true, native:false` produces the identical 403) — this is an account/API-key permission scope issue on Circle's side, not a request-shape defect in this repo. No transfer has been submitted; no transaction/provider id exists. Full evidence, the recovered wallet-set/wallet IDs, and the safe continuation path (manual funding via `faucet.circle.com`, then resume) are in `docs/evidence/J0-D-CONNECTIVITY-SPIKE.md`. `runConnectivitySpike` is now resume-only and bound to an approved preflight intent (#26); it can no longer create wallets or call the faucet.
  - **J2 execution is still simulated** (`FakeProviderAdapter`) — unchanged, and intentionally so pending Prime's exact-intent approval for a real transfer.
  - The real J0-C dataset still correctly shows every obligation's Arc destination readiness as `PENDING_J0_D_TRUST_SEED` until J0-D actually completes (reaches a terminal transfer state); the Finance Agent honestly HOLDs all five obligations on that basis (see `tests/golden-path.integration.test.ts`).
  - **To run the real spike** once the source wallet is funded: first `POST /api/j0d/preflight` until it returns `READY_FOR_EXPLICIT_AUTHORIZATION`; after independent review and Prime's explicit approval of that exact intent, `POST /api/j0d/run-connectivity-spike` once with `{"confirm":"RUN_J0D_CONNECTIVITY_SPIKE_ONCE","resumeFrom":{...},"approvedIntent":{...exact_intent...},"intentFingerprint":"..."}`. A bare confirmation is refused, and a fresh disposable context can no longer be minted. There is still no durable at-most-once ledger across serverless invocations; see `docs/evidence/J0-D-CONNECTIVITY-SPIKE.md` for the residual race.
- **P0 demo-state persistence:** Vercel Preview and Production load and compare-and-set authority, append-only assessments and approvals, sealed PAE, kill switches, execution/idempotency status, and provider simulator state through Supabase Postgres. SQL migrations are in `supabase/migrations/`; the tables are private, and only the server-side service role can call their RPCs. Set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in both Vercel environments. If either is missing in Preview or Production, the app fails closed instead of using process-local state. Local development and tests may use the memory adapter.
- **J0-D connectivity-spike state remains separate:** the intent-bound spike is outside this persistence slice and still has no durable cross-invocation at-most-once ledger. Do not treat its process-local resume context as reliable across Vercel instances.

None of the above is silently glossed over: every one of these limitations throws a clear, typed error (or is a clearly-labeled UI simulation banner) rather than fabricating a result.

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
