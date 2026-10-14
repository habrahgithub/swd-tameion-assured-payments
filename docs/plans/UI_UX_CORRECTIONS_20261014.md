# UI/UX correction bundle — 14 October 2026

## Status and priority

PRIME requested a separate PR at 21:34 Dubai. This branch starts at e007a0effca1d41b8476728a82cc9e238375d7e0, the observed published head of PR #70. Initial change is this scope document only; no product corrections or unpublished writer changes have been transferred.

E2E workflow evidence remains first priority in Job #65 / PR #70. This separate UI/UX bundle replaces earlier instructions to append the following presentation corrections to that same candidate. Issue #71 (richer AI assessment process and visual experience) remains deferred and outside this bundle.

## Ownership and transfer

Preserve the existing writer and all unpublished work. The controller must reconcile its exact head, changed paths and ownership before transferring isolated UI/UX changes to this branch. Do not launch a competing writer, reset the original worktree, force-push, discard mixed changes, or claim a transfer from GitHub recording alone. Separate mixed changes with reviewed scope/diff evidence. Already admitted source-catalog/security work is not automatically moved here.

The PR is stacked on codex/m1-m2-uat-01a13166 so reviewers see only this bundle's delta. Rebind/rebase through normal review when the underlying candidate changes; do not merge ahead of its dependency.

## Consolidated scope

| Area | Acceptance |
| --- | --- |
| Company identity | Star Wealth Dynamics LLC, Internal pilot; Tameion remains the product. Remove current-company demonstration placeholders consistently. Preserve Arc Testnet and actual synthetic/test labels. |
| Supplier identity | Protected payable views show source-backed supplier identity and provenance. Missing/conflicting identity is explicit. Never infer names from chat or expose private data publicly. |
| Receiver identity | Clearly show recorded account name when available, receiver wallet ID, exact address at final confirmation, asset and network. Bind them to the exact payment instruction; distinguish supplier from controlled testnet recipient. |
| Funding clarity | Present balance/freshness, payment requirement, applicable fee/total debit evidence and supported shortfall together. Insufficient funds or unverified funding must not appear ready. |
| Minimal dashboard | Fresh login → Dashboard → Review payables. Returning sessions retain admitted privacy entry/revalidation. Show existing wallet observation, reliable payable count and one primary navigation action; no new analytics or charts. |
| Terminology | Payables, Review payables, Total payables, Selected payable, Payable details. Keep Test payments distinct. Remove recommendation/recommended wording from user-facing presentation. |
| Assessment result | PAY / HOLD / ESCALATE under Assessment result. PAY is not authorization, submission, settlement or proof of funding. Preserve actual blockers and outcome states. |
| Information hierarchy | Context → compact decision facts → primary status/blocker → one primary action. Supporting evidence/history/technical records are expandable. |
| Deduplication | Each fact has one primary location per screen. Consolidate repeated prose, warnings, badges, fields, panels and same-action buttons. Preserve exact final confirmation and self-contained receipts. |
| Disclosure restraint | Required notices appear at the relevant decision only. Remove generic boilerplate and unnecessary acknowledgments. Keep essential approval, testnet context and uncertainty/no-retry facts. No unsupported claim of legal necessity. |

## Critical boundary: E2E defects

The reported low balance versus payment amount is not yet reproduced. Supplier and recipient gaps also require exact-candidate reconciliation. If inspection verifies a financial-control or identity defect blocking safe E2E evidence, adjudicate it in the existing E2E job; do not hide or defer a necessary safety correction as cosmetic work. This UI PR does not authorize new backend financial policy, source-schema expansion, provider lookup or live operation.

Private supplier metadata may require an independently scoped source/projection change. UI placeholders are not a substitute for trusted data. Never label display names as proof of legal identity or wallet ownership.

## Implementation limits

Reuse existing components, private data paths and controls. Preserve authentication, privacy curtain, expiry/logout, CSRF, manual selection, immutable history, idempotency/no-retry and exact payment bindings. No duplicated fetch/state pipeline or automatic provider call on navigation. Preserve technical IDs, API contracts, database fields, prompt/schema bytes and signed/historical records.

No new dependencies, database migrations/writes, credentials, live provider/payment actions, deployment or merge permission is granted. No private supplier facts or real payment identifiers in public code, fixtures or captures.

## Verification and completion

- [ ] Reconcile source and target heads, existing WIP and writer ownership before implementation transfer.
- [ ] Record transferred commits/hunks and verify no unrelated security/source/financial work was moved or lost.
- [ ] Inspect all owned desktop/mobile workflow surfaces for stale company terminology and duplicate information.
- [ ] Verify fresh login/dashboard/payables and returning-session privacy flow without duplicate refresh, private-data flash or lost selection.
- [ ] Cover PAY/HOLD/ESCALATE, unknown/missing identity, insufficient/unverified funding, pending/unknown outcome and historical receipt states.
- [ ] Verify exact receiver ID/address/name behavior and supplier/proxy distinction with fictional fixtures.
- [ ] Preserve meaningful existing controls/tests; verify copy/accessibility and reduced information density without hiding critical facts.
- [ ] Provide exact-candidate before/after captures, focused regression results and existing required build/typecheck/CI evidence.
- [ ] Independent review and AXIS adjudication precede acceptance; deployed verification is separate from code completion.

Final report: base/head, transferred scope, changed paths, checks, captures, unresolved dependencies, actual versus mocked evidence, and implementation/deployment status.

## Authority references

Job #65 comment anchors:
- Priority: 6173910832
- Supplier: 6173922974
- Company: 6173962627
- Receiver wallet: 6174000645
- Text hierarchy/funding observation: 6174125957
- Deduplication: 6174148174
- Assessment wording: 6174188642
- Dashboard: 6174218693
- Payables terminology: 6174293946
- Disclosure restraint: 6174354631

These requirements remain substantive; PRIME's latest separate-PR instruction supersedes their same-candidate placement.
