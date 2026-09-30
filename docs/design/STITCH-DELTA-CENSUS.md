# Stitch UI Package — Delta Census vs. Current Implementation

**Source:** `stitch_tameion_assured_payments_ui.zip` (5 screens + `tameion_design_system/DESIGN.md`), inspected 2026-09-28.
**Status:** Visual reference only. Nothing in the ZIP has been copied into the codebase. This document is the requested census — implementation is a separate, deliberately bounded next step, not part of this pass.

## What the package actually is

Five static HTML exports (Tailwind CDN + inline JS, `<script src="https://cdn.tailwindcss.com">`) plus `screen.png` renders and one `DESIGN.md` token/style spec. Each screen corresponds to one of `CommandCenter`'s existing five panels — the mapping is nearly 1:1 already:

| Stitch screen | Current `app/command-center.tsx` panel |
|---|---|
| `1._obligations_treasury_queue` | `obligations` |
| `2._assessment_ai_advisory` | `assessment` |
| `3._authorization_human_boundary` | `authorization` |
| `4._assurance_execution_safety_gate` | `assurance` |
| `5._reconciliation_evidence_audit_proof` | `reconciliation` |

The architectural sequencing the design encodes — AI proposes (advisory-only, visibly non-authoritative) → human authorization is a separate mandatory boundary → deterministic Safety Kernel gate → execution → reconciliation as the final truth layer — matches the real system's actual control flow (`src/agent` → `src/authority`/`src/pipeline/authorize-and-seal` → `src/safety-kernel` → `src/execution` → reconciliation). That structural agreement is the strongest thing about the package and the reason to truth-bind it rather than discard it.

## Confirmed fabrications (must never become product truth)

Grepped and visually confirmed across all five screens:

- **Fictional signer/operator:** "Sarah Jenkins" (Chief Treasury Controller, Level 3 Signing Authority) appears as the authorizing human on every screen. The real system has no named-operator concept — `approveAndSealPae` takes an arbitrary `actorId`/`actorRole` string from the request body (currently hardcoded to `"USR-DEMO-OPERATOR"` / `"FINANCE_APPROVER"` in the approve route).
- **Fabricated infrastructure claims:** "hardware HSM execution path", "isolated hardware HSM enclave", "distributed atomic memory store" for idempotency leases. The real system has none of these — signing uses `src/pae/keys.ts` (an in-process Ed25519 key, explicitly documented as a prototype limitation), and idempotency is enforced via `AuthorityStore`'s in-memory `pae_state`/`execution_idempotency_key`, not any distributed store.
- **Fabricated vendors/amounts/contracts:** "Al Shams Logistics & Trade" (with a fake LEI number), "Anthropic PBC", "OpenAI LLC", "Railway Corp", "Microsoft 365 Enterprise" and their dollar amounts, due dates, and contract refs are entirely invented. The real, frozen obligation set is the 5 genuine, privacy-redacted J0-C records in `data/live-usage/LIVE_USAGE_SET.json`.
- **Fabricated cryptographic/settlement detail:** specific fake tx hashes (`0x7d91e84a...`, `0x3c499c542c...`), a fake Circle provider ref (`circle_tx_8829011_arc`), a fake on-chain block confirmation count (`Block #4,819,204 (12 Confirms)`), fake nonce/idempotency values, fake key IDs and curve names (`ED25519-SHA512` — the real system uses plain Ed25519 per `src/pae/sign-verify.ts`).
- **Reconciliation screen depicts a fully completed, confirmed on-chain settlement.** The J0-D infrastructure spike has completed and reconciled, but no J2 product transaction has occurred. This screen as-drawn must never be shown as anything but an explicitly labeled demo fixture until the retained Prime J2 gate is actually exercised.
- **Assessment screen shows NVIDIA reasoning as live and successful** ("NVIDIA Nemotron-3 synthesized advisory posture: PAY, Confidence: 99.4%"). The HTTP 401 cited here is historical pre-J1-A evidence; current live NVIDIA capability remains `UNVERIFIED_FOR_J1` until the separately admitted J1-D proof. The exact J1 provider identity is now retained on each new durable assessment record.

## What's structurally strong and worth truth-binding

- **Segregation-of-duties framing** (AI proposes / human authorizes / kernel gates / execution / reconciliation) matches real control flow closely — the "10-Point Deterministic Verification Matrix" on screen 4 even numbers to 10, matching `REQUIRED_CONTROL_IDS_P0`'s real 10 control IDs (though Stitch's control *names* don't map 1:1 to the real ones — a real per-control mapping would need to replace Stitch's invented labels/descriptions with the actual `SK-*` control IDs and their real `finding_code`s from `runSafetyKernel`).
- **Explicit non-authority disclosure banners** ("AI ASSESSMENT IS STRICTLY ADVISORY... cannot authorize or execute", "DOES NOT DIRECTLY AUTHORIZE OR DISBURSE FUNDS") — this is good practice already partially present in the current UI's copy and worth strengthening.
- **Kill switch as a persistent, always-visible header control** (not buried in one panel) — stronger than the current implementation, which only surfaces kill-switch controls inside the Assurance & Execution panel (added in `e043e52`).
- **Explicit truncated-hash-with-copy pattern, monospaced tabular figures for all monetary/crypto values, status chips that always pair color with a text label** — good, directly adoptable component conventions, and don't require any fabricated data to implement (they're presentation rules, not content).
- **Design tokens** (`DESIGN.md` frontmatter: colors, typography scale, spacing, radii) are a coherent, ready-to-port Tailwind theme extension — mechanical work, no invented-data risk.

## Delta census by panel (highest-value real gaps only, no invented-data items)

| Panel | Current state | Stitch delta worth adopting | Fabrication to strip |
|---|---|---|---|
| Obligations | Flat list, no aggregate stat tiles | Summary stat tiles (outstanding count, due-within-N, ready-for-assessment count) computed from real `GET /api/obligations` + per-obligation detail — all real, no invented numbers needed | None if built from real data |
| Assessment | One obligation at a time, no coverage indicator | "N/5 obligations assessed" coverage indicator (now directly backed by `findUnassessedObligation` added in `25190e0`) + explicit `LIVE_AI` / `NOT_LIVE_AI` / `BLOCKED_AUTH` runtime badge per assessment (backed by real `provider_mode` on the sealed record) | Confidence percentages (NVIDIA doesn't return a confidence score in the real schema — `financeAgentDecisionSchema` has no such field); the "5/5 validated" language must reflect real assessment state, not a canned demo number |
| Authorization | Single-obligation approve button + raw JSON | The three-stage "Proposal → Sovereign Will → Deterministic Gate" framing as a visual sequence, built from real `pae_sealed`/aggregate state; the fiduciary-checklist pattern *could* be adopted as UI-only affordance but must not claim to be a recorded control the backend enforces (it currently isn't one) | Named signer identity, LEI numbers, fake key/curve labels |
| Assurance & Execution | Execute button + now a kill-switch control (`e043e52`) | Per-control PASS/BLOCK breakdown surfaced from the real `SafetyKernelResult.controlResults` (already returned by `runSafetyKernel`, just not displayed control-by-control in the UI today) — this is a genuinely real, valuable delta since the data already exists server-side | Hardware HSM/enclave language, fabricated telemetry feed lines, fake dispatch nonces |
| Reconciliation & Evidence | Raw JSON evidence panel + attack simulation | A curated timeline view driven by real state transitions (already partially named "PENDING evidence timeline curation" in the J1/J3 census) instead of raw `<details>` JSON | The entire "10-Stage Granular Chain of Custody" with fake timestamps/hashes/block confirmations — until a real J2 settlement exists, this panel must show real UNSETTLED/simulated state, explicitly labeled, never a fabricated completed settlement |

## Recommended implementation shape (not done in this pass)

1. Port `DESIGN.md`'s color/type/spacing tokens into a Tailwind theme extension (mechanical, no data risk) — smallest first slice.
2. Add the per-control Safety Kernel breakdown to the Assurance panel — real data already exists (`SafetyKernelResult.controlResults`), purely a display change.
3. Add the assessment coverage indicator + `LIVE_AI`/`NOT_LIVE_AI`/`BLOCKED_AUTH` badge — real data already exists (`findUnassessedObligation`, `provider_mode`).
4. Only after 1–3: consider the larger structural changes (persistent header kill switch, stat tiles, curated evidence timeline) as their own scoped slices, each verified independently the way every other change this session has been.

Each of 1–3 is independently small, real-data-backed, and testable without inventing anything — recommended as the next concrete increment(s), in that order.
