# Tameion

Tameion is an assured AI payment agent for the Canteen × Circle hackathon: AI decides what should be paid; deterministic, cryptographically bound controls decide what can actually move.

**Branch status:** `main` holds the verified J0 baseline (app shell, provider connectivity evidence, genuine obligation dataset). The `prototype/claude-autonomy` branch (this branch, if you are reading it there) is an active prototype build covering J0-D through J3 under `DIR-TAMEION-PROTOTYPE-CLAUDE-001` — see "Prototype status" below before assuming anything here is production- or judged-demo-ready.

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

Implemented and tested (`npm test`, 35 passing):

- **Numeric safety** (`src/domain/numeric.ts`): exact decimal <-> atomic USDC conversion, no floating point, no silent truncation.
- **PAE-P0-1** (`src/pae/`): RFC 8785 JCS canonicalization, SHA-256, Ed25519 sign/verify, a versioned trusted-key registry, and durable approval/assurance record hashing — matches the blueprint's Canonicalization Contract field-for-field.
- **Safety Kernel** (`src/safety-kernel/kernel.ts`): deterministic evaluation of all 10 required P0 controls; a PAE can only be sealed when every control PASSes.
- **Authority aggregate** (`src/authority/aggregate.ts`): one `ObligationAuthorityAggregate` per obligation with `expected_version` CAS semantics and the atomic reviewed-N -> authorized-N+1 approval transition.
- **Execution Worker** (`src/execution/worker.ts`): idempotent claim (UNUSED -> RESERVED), replay/concurrency safety, pre-submit BLOCK on a destination changed after authorization, kill switch, UNKNOWN/no-blind-retry handling, and one-to-one settlement reconciliation.
- **Finance Agent** (`src/agent/`): strict PAY/HOLD/ESCALATE output schema with no field an injected instruction could use to request approval/signing/execution; fails closed (HOLD) on provider failure, malformed output, or missing evidence; NVIDIA provider pinned to the frozen model, with a clearly-labeled deterministic fallback used only when no model API key is configured.
- **J3 UI** (`app/command-center.tsx` + `app/api/obligations/**`): one page, five sections (Obligation & Evidence / Agent Decision / Authorization & Safety Proof / Arc Settlement & Reconciliation / Evidence Timeline & Blocked Attack), driving the real pipeline above against the actual `data/live-usage/LIVE_USAGE_SET.json` obligations.

**Known limitations / not yet done:**

- **No live provider credentials in this build environment.** `NVIDIA_API_KEY`, `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `ARC_API_KEY` and Supabase credentials are Vercel Production-scoped secrets this session cannot read (see [`docs/evidence/J0-B-CONNECTIVITY.md`](docs/evidence/J0-B-CONNECTIVITY.md)). Consequently:
  - **J0-D has not run.** `src/j0d-spike/connectivity-spike.ts` fails closed; no real testnet connectivity transfer has been made. The real J0-C dataset still correctly shows every obligation's Arc destination readiness as `PENDING_J0_D_TRUST_SEED`, and the Finance Agent honestly HOLDs all five obligations on that basis (see `tests/golden-path.integration.test.ts`).
  - **J2 execution is simulated.** `ExecutionWorker` runs against `FakeProviderAdapter`, not real Circle/Arc calls. `ArcCircleProviderAdapter` is a fail-closed stub, not a real integration.
  - **Finance Agent reasoning defaults to a deterministic rule-based fallback**, not real NVIDIA model reasoning, whenever `NVIDIA_API_KEY` is absent (it is, here).
- **No durable persistence.** `AuthorityStore` and the UI's demo state are in-memory singletons — correct for demonstrating the mechanism, not durable across restarts, and not safe across multiple serverless instances. Swapping in Supabase-backed storage should not change the version/CAS contract any caller depends on.
- **No adversarial/eval test bank yet** (the blueprint's 8-12 focused agent-eval cases and Days-12-14 hardening tests are not implemented).
- **UI has not been visually verified in a browser** by this session (no browser tool available here) — it has been exercised end-to-end via `curl` against a running `next dev` server (list -> assess -> approve -> execute -> settle/reconcile, and the changed-destination attack -> blocked with zero provider submissions) and `next build` passes, but a human/browser pass is still owed.

None of the above is silently glossed over: every one of these limitations throws a clear, typed error (or is a clearly-labeled UI simulation banner) rather than fabricating a result.
