# Job Contract — J1: Finance Agent Decision + Exact Human Authorization

**Status:** SUPERSEDED_BY_ISSUE_41
**Authority:** GitHub issue #41 now admits J1-A on PR #10 at exact base/head
`140959621e0181f077929527cc09f8149b92f1ae`. The older draft below is historical and does not
govern current scope or authorization. At the time it was written, J0 had not reached its exit gate,
J0-D (Arc connectivity spike) was classified as `EXTERNAL_CIRCLE_FAUCET_PERMISSION_BLOCKER`
(pending manual public-faucet funding), and J0-B's NVIDIA live-auth check was
`NVIDIA_LIVE = BLOCKED_AUTH` (deferred). Per the blueprint's
Admission Rule ("One primary job at a time... at event start admit J0 only") and Admission
Invariant `NO_SUMMARY_ONLY_JOB_MAY_ENTER_EXECUTING`, this contract may not enter `EXECUTING` and
no `execution_token` may be issued until AXIS/Prime runs `MILESTONE_EXIT_GATE` on J0 and explicitly
calls `ADMIT_NEXT_JOB`. This document exists to satisfy the template requirement that a full Job
Contract be instantiated *before* that admission, not to self-admit.

## Fields

- **job_id:** J1
- **milestone:** Milestone Conveyor — J1 (Sep 29–30 per frozen blueprint `tameion-full-blueprint.v1.md`)
- **title:** Finance Agent Decision + Exact Human Authorization
- **operating_mode:** CLAUDE_AUTONOMOUS / LOCAL_EXECUTOR, with CLOUD_COORDINATOR (read-only, GitHub-synced)
- **work_type:** feature implementation (agent reasoning pipeline + human authorization gate)
- **layer:** application (Finance Agent context/runner) — no product execution/payment authority
- **why:** meaningful event-period PAY/HOLD/ESCALATE reasoning is a P0 slip-priority item (blueprint
  Slip Priority #1); it must exist, evidence-grounded, before J2 can gate any real execution on it
- **outcome:** frozen READ/ANALYZE/PROPOSE allowlist reasoning over all 3–5 genuine obligations;
  post-assessment sole-candidate selection with recorded rationale; exact T1 review/authorization
  N→N+1; final Safety Kernel run after approval on N+1
- **in_scope:**
  - pinned `NvidiaProvider` config + a capability smoke test (does not resolve `NVIDIA_LIVE = BLOCKED_AUTH`;
    that stays a J0-B/parallel-lane blocker per comment `5866105456`)
  - `ContextBuilder` / static allowlist / `AgentRunner` (already partially present: `src/agent/*`)
  - evidence-grounded assessment of all 3–5 frozen genuine obligations (`docs/evidence/J0-C-GENUINE-USAGE.md`)
  - sole-candidate selection + recorded rationale
  - T1 exact-intent human approval binding reviewed N to atomically-created authorized N+1
  - Safety Kernel execution after approval, on N+1 only
- **out_of_scope:** PAE construction/signing (J2), any Arc/Circle execution call, UI/reconciliation (J3)
- **forbidden:**
  - Finance Agent must not gain payment/approval/signing/provider-selection/destination authority
    (P0 test #12)
  - no default-to-PAY on invalid/missing evidence or provider failure (P0 test #14)
  - no prompt-injected capability expansion (P0 test #13)
  - no NVIDIA credential probing/rotation/code changes while `NVIDIA_LIVE` is Prime-deferred
- **base_sha:** `69b904480afc93fb1ae61a1ae322958d5ac89985`
- **dependencies:**
  - J0-C genuine obligation set (frozen, `docs/evidence/J0-C-GENUINE-USAGE.md`)
  - `src/agent/ai-provider.ts`, `src/agent/schema.ts` (already present from J0 bootstrap)
  - NVIDIA live auth (soft dependency — J1 must be demonstrable via `DeterministicFallbackProvider`
    or a *recorded* live pass; it is not blocked on NVIDIA if the fallback path is explicitly labelled)
- **risk:** MEDIUM (agent-reasoning correctness + authorization-boundary risk; no funds movement in J1 itself)
- **affected_invariants:** Finance Agent capability ceiling (schema `.strict()` allowlist),
  NO_ASSURANCE_NO_EXECUTION (J1 proposes, never executes), human-authorization-binds-exact-version
- **acceptance:** P0 tests #12, #13, #14 (finance-agent authority ceiling, injection resistance,
  no-default-PAY) pass; T1 approval demonstrably binds N→N+1 atomically; Safety Kernel runs only
  post-approval on N+1
- **negative_edge_tests:**
  - obligation with missing evidence → never PAY
  - prompt-injected obligation text attempting to request approval/execution → schema rejects
    (unknown keys `.strict()`), Finance Agent output unaffected
  - approval submitted against stale/non-current N → rejected, N+1 not created
- **expected_economic_movement:** NONE — J1 produces a decision + an authorization record only;
  zero Arc/Circle calls
- **required_review:** Prime sprint-gate review before MILESTONE_EXIT_GATE on J1
- **verification:** `npm test` (vitest) green on new J1 test files; no live external calls added to
  the mandatory suite (NVIDIA/Circle stay opt-in/manual as J0-D's spike already is)
- **evidence_to_record:** `docs/evidence/J1-FINANCE-AGENT-DECISIONS.md` (per-obligation decision +
  reasons + evidence_ids), `docs/evidence/J1-AUTHORIZATION-LEDGER.md` (T1 N→N+1 binding record)
- **stop_conditions:**
  - any code path that lets Finance Agent output reach execution without T1 approval
  - any default-PAY on incomplete evidence
  - any real Arc/Circle/NVIDIA credential use beyond what J0 already established
- **provider:** Claude Code (local executor), Sonnet 5
- **runtime:** Node 22.15.1 / Next.js (this repo's existing stack)
- **writer_lineage:** this session (`session_01SvqoysKwX8bEdHPg3mg94w` acting as coordinator is
  read-only per the agreed topology; this local session is sole writer)
- **worktree_or_context:** `/home/habib/workspace/.worktrees/tameion-prototype-local`
- **branch:** `prototype/claude-autonomy`
- **pr_policy:** single PR (#10), continued
- **execution_token:** NOT_ISSUED — pending AXIS/Prime `MILESTONE_EXIT_GATE` on J0 and explicit `ADMIT_NEXT_JOB`
- **typed_stops:** `J0_NOT_EXITED`, `NVIDIA_LIVE_BLOCKED_AUTH` (soft — does not itself block J1 if
  fallback path is labelled), `FINANCE_AGENT_AUTHORITY_CEILING_VIOLATION`, `DEFAULT_PAY_ON_INCOMPLETE_EVIDENCE`

## Admission Gate (unresolved)

This contract is **drafted, not admitted**. Per Conveyor order
(`MILESTONE_OPEN → ADMIT_ONE_JOB → IMPLEMENT → VERIFY → CLOSE_JOB → ADMIT_NEXT_JOB → MILESTONE_EXIT_GATE → AXIS_ADJUDICATION → NEXT_MILESTONE`),
J0 must reach `CLOSE_JOB`/`MILESTONE_EXIT_GATE` before `ADMIT_NEXT_JOB` binds this contract's
`execution_token`. Until then, no J1 implementation code should be merged as "J1 work" — only J0-scoped
work (J0-D resumability hardening, failure-path evidence) proceeds under the existing J0 admission.
