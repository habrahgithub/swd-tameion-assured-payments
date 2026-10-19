# Six-stage readiness — issue 77 / draft PR 78

This code candidate and preparation guide authorize no production migration,
configuration/source change, deployment, live AI, provider call or payment.
AXIS owns release/publication; SENTINEL reviews the frozen candidate independently.
Local fixtures/providers are synthetic and network-denied, not live proof.

## Release and source preparation

Keep the previous five migrations unchanged. Independently execute and review
`supabase/migrations/20261019190000_assessment_disposition_guard.sql` offline
through the full public CAS. Only after separately authorized application to the
target may the controller attest the existing
`TAMEION_ASSESSMENT_BOOTSTRAP_GUARD` as **`APPLIED_DISPOSITION_V1`**. The old
`APPLIED` covers bootstrap only. Missing/unknown values never enable disposition.
There is no second secret/provisioning surface.

The optional `owner_admission` belongs outside `records` in the existing canonical
V3 `GENUINE_ADVISORY_SOURCE` envelope. The existing approved packet byte digest
covers it. `ownerAdmissionSchema` in `src/server/operator-source-records.ts`
defines exactly ten fields: `kind`, `approval_id`, `obligation_id`,
`aggregate_version`, `source_record_sha256`, `binding_sha256`, `predecessor_key`,
`predecessor_sha256`, `valid_from`, `expires_at`. Kind is
`CURRENT_SOURCE_REASSESSMENT_ADMISSION`. Hash record, binding and predecessor
using the repository JSON canonicalizer; hash the complete packet's exact bytes
for source approval. UTC timestamps have millisecond precision; the half-open
window is at most one hour. Invalid admission disables this capability while
valid source view/auth remain available. Expired/future admission cannot start.

Value-free preparation slots below are requirements, not an activatable packet:

| Slot | Owner evidence required |
| --- | --- |
| Supplier | Verified name; `beneficiary_provenance` with `provenance_class:"SOURCE_EVIDENCE"` and an `evidence_id` already cited in the record. Legacy absence stays explicitly unrecorded. |
| Classification | Existing `INVOICE`, `PREPAID_NO_INVOICE` or `RECURRING_OTHER` classification plus evidence ID/hash. Supplier identity establishes no classification. |
| Timing | Approved timing basis/date and cited evidence. Invoice issue/effective date, cash-term basis and provenance must satisfy the full deterministic normalizer. Matching declared dates alone are insufficient. |
| Historical simulation | Approved historical as-of date, evidence ID/hash and owner authority reference. No current-clock substitution or invented historical approval. |
| Admission | Exact current record/version/binding, unbound UNKNOWN predecessor UUID/canonical hash, approval ID and bounded window. |
| Financial activation | Independent exact controlled source/requester pair, matching windows, namespace, current session/credential/actor and deployment/config/ingress bindings, plus validated linked draft. |

Missing owner classification and historically approved as-of facts remain
activation blockers. Supplier preparation is separate from those missing
decisions. Private source, wallet, credentials, preparation, backups and actual
financial packets stay outside public fixtures/docs. Updating supplier/timing
changes record hashes; old advice cannot silently become current for new bytes.

## Operator sequence

1. **Obligation:** review current source and supplier provenance. Preserve old
   operations, HOLD receipts and browser request references.
2. **Assessment:** use **Request admitted current-source disposition** only for
   the expressly admitted unbound UNKNOWN. Authenticated, CSRF-protected
   `POST /api/obligations/[id]/advisory/disposition` selects approved source
   evidence; request fields cannot authorize themselves. Full deterministic
   source validity precedes CAS/provider effects. A distinct UUID stores immutable
   admission evidence and verified generation-0 current binding. The clock is
   checked after final awaited revalidation immediately before dispatch. Expiry
   there consumes the reservation with zero providers and no replacement UUID.
   Once lawfully started, same-key durable-result sealing may finish after expiry
   with no new provider dispatch. Legitimate AI HOLD remains HOLD.
3. **Linked draft / authorization:** **Confirm current disposition assessment**
   separately checks a retained original as historical superseded UNKNOWN and
   the exact current child through status and independent detail reads. Unrelated
   UUIDs cannot be acknowledged. The original browser entry remains intact.
   Review the child, then explicitly create its linked testnet draft. A draft
   grants no financial eligibility. Separately approved controlled packets and
   current human actor remain required for exact authorization. Activation
   revalidates source/version/binding, receipt and all unresolved-operation gates.
4. **Assurance:** existing signed PAE, amount/token/destination, current actor,
   policy, replay and exact release checks remain. No PAY is fabricated.
5. **Payment:** new assessment/preflight/approve/release/execute paths require
   ACTIVE financial authority. Submission remains at most once per exact intent.
   Never resubmit an uncertain payment to discover its outcome.
6. **Reconciliation:** **Reconcile this same intent** sends authenticated CSRF
   `POST /api/obligations/[id]/reconcile` with the recorded key and PAE hash.
   Only exact existing execution recovery accepts ACTIVE or actually EXPIRED
   source/requester windows. FUTURE is denied before provider access. Expired GET
   retains instructions only with execution history and is read-only: no provider,
   persistence, bootstrap, authority renewal or new submission.

Recovery revalidates current session/credential/actor, exact source/requester,
namespace and deployment/config/ingress before/after provider reads and before
persisting. Native-token identity checks, including balance-row identification,
remain; recovery needs no renewed pre-payment funding. Genuine advisory changes
after send do not grant new actions or prevent otherwise valid exact recovery.
Cross-deployment recovery is excluded. Persistence uncertainty/conflict never
proves settlement. A same-identity retry may reconcile with zero new submits.

UI success requires independent durable readback matching selected obligation,
recorded execution key and PAE hash, a `RECONCILED` aggregate and verified exact
settlement evidence. Historical evidence supports expired authority without
restoring release eligibility. Missing/contradictory evidence and A→B→A stale
selection results cannot show success. The genuine parent remains outstanding.

## Limits and publication

The four-operation budget and one-disposition-per-obligation limit survive
source/version changes. The old UUID stays UNKNOWN and late `ASM-<old UUID>`
sealing is refused. An UNKNOWN disposition child admits no ordinary generation-1
successor, second disposition or implicit attempt. Ordinary valid recovery and
absent-reference bootstrap retain distinct semantics. Any separate unresolved
operation blocks current use and linked activation.

`vercel.json` disables native Git deployments for exactly
`claude/stage2-assessment-admission-20261019`, with no wildcard/global disable.
AXIS verifies exact published bytes and deployment readback. This is no release
approval; unspecified branches retain Vercel defaults. See the
[Vercel Git configuration contract](https://vercel.com/docs/project-configuration/git-configuration).

Required local gates: Node 24.21.0 hygiene, typecheck, focused integrated tests,
full Vitest with moderate workers, build and Playwright. Record actual outcomes
and omissions in the control report. Independent SQL/SENTINEL review, exact-head
CI, factual owner approval and live rollout/AI/payment proof remain separate gates.
