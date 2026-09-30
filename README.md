# Tameion

Tameion is an ERP-native assured-payment control plane being developed for the Canteen × Circle hackathon. The upstream ERP/accounting system remains the business system of record; Tameion provides assessment, exact human authorization, deterministic assurance, and evidence. Circle/Arc is a settlement-provider boundary, not a substitute for source-system truth.

**Core invariant: NO ASSURANCE, NO EXECUTION.** AI may **READ / ANALYZE / PROPOSE**, but may not authorize, sign, assure, or execute payments. Upstream approval alone never releases a payment.

**Branch distinction:** This default `main` branch still contains the event-start application shell and typed contract skeleton. The substantially more advanced implementation exists on **unmerged draft [PR #10](https://github.com/habrahgithub/swd-tameion-assured-payments/pull/10)** (`prototype/claude-autonomy`). Statements about features and tests on that branch are *not* assertions that those features already exist on `main` or are production-ready.

## Verified project status (30 September 2026)

This is a dated evidence snapshot, not a live status feed. The current [J1 authority (#41)](https://github.com/habrahgithub/swd-tameion-assured-payments/issues/41), [demo-prep authority (#42)](https://github.com/habrahgithub/swd-tameion-assured-payments/issues/42), and PR/CI records supersede this section if they change.

| Milestone | Evidence and current boundary |
| --- | --- |
| **J0 — infrastructure/connectivity** | The admitted Arc **Testnet** connectivity spike completed and reconciled once using disposable spike wallets. This proves a bounded connectivity path, **not** product counterparty trust, J1 authority, or J2 product execution. Historical J0-C evidence is not rewritten. |
| **J1-A/B/C — entry corrections, assurance review, reviewed push** | Independently reviewed **SENTINEL S3 PASS, M1=0/M2=0**, with **400/400 tests passing** plus typecheck, build, hygiene and diff-check. Pushed to draft PR #10 at `448b66148b601a3f69e25a0eb2b071bce7eae1c6`; exact-head **CI #48, CodeRabbit and Vercel SUCCESS**. These validate the reviewed candidate and deployment checks, *not* the next live-provider gate. |
| **J1-D — live NVIDIA capability** | **NOT YET VERIFIED FOR J1.** A separate bounded provider/model/config/runtime-hash live capability proof must pass before assessments. No inference success should be claimed solely from build/CI or server-side key configuration. |
| **J1-E/F — assessments and selection** | Five genuine, privacy-safe source obligations require current, append-only live assessments before one lawful candidate can be considered. **No current J1 candidate is selected.** An AI recommendation cannot override deterministic findings or missing trust. |
| **J1-G/H — Prime authorization and assurance** | **NOT AUTHORIZED.** The exact T1 N→N+1 packet must be presented and explicitly authorized by Prime, then independently pass the deterministic Safety Kernel. No schedule or prior consent substitutes for the current gate. |
| **J2 — payment execution** | **NOT AUTHORIZED / NOT PROVEN AS A PRODUCT TRANSFER.** A completed J0-D connectivity spike does not authorize any Circle/Arc J2 product transfer, and mainnet is out of scope. |
| **Demo preparation (#42)** | Documentation-only pack in a separate branch/worktree. The first candidate required corrections for stale J0-D wording and an impossible demo PAY→PAE→execution path; it is **not yet an accepted judge script**. |

### Product-truth and demo restrictions

- **No simulated-to-live trust promotion.** Demo aggregates with `product_trust_provenance=SIMULATED_DEMO_FIXTURE` are demonstration fixtures, not product-ready destinations or source wallets. Absent independently evidenced **current product trust**, live J1 assessments must fail closed to HOLD/ESCALATE, and approval/assurance must remain blocked (`AUT-016` and Safety Kernel trust controls).
- **Historical evidence stays historical.** The immutable J0-C record's `PENDING_J0_D_TRUST_SEED` state is retained as source history. J0-D completion does not magically verify product wallet identities or counterparties.
- **USD-only settlement eligibility.** Non-USD source obligations remain visible/assessable but cannot be authorized for the hackathon Arc USDC execution rail. Any `0.000000` unsupported-currency settlement field is a **blocked-rail sentinel**, *not* an FX conversion or the original source amount.
- **Do not promise the happy path.** With today's simulated trust fixtures, judges should see authentic HOLD/ESCALATE/BLOCKED behavior rather than being told they can select PAY, authorize T1, seal a live product PAE, or reach a genuinely reconciled product transfer. The UI and server-side safety gates must tell the same story.
- **Technical implementation is not authorization.** The prototype includes a deterministic Safety Kernel, signed PAE machinery, append-only evidence and an execution-worker simulation. Their existence does not imply permission for actual financial movement. Never disclose provider credentials, wallet secrets, or private financial records.

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

## Current scope on `main`

The only domain code currently committed to this branch is a Zod-backed contract metadata skeleton under `src/domain/contracts`. It establishes a typed location for later admitted work without defining payment decisions, provider behavior, persistence, or J1 semantics. Those later capabilities are confined to the separate, still-draft prototype carrier until independently authorized for integration.

The event-start record remains in [`docs/evidence/J0-EVENT-START-BASELINE.md`](docs/evidence/J0-EVENT-START-BASELINE.md).
