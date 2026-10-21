# Recoverable payment workflow R1

This is a local code candidate for independent review. It does not activate a source, apply a hosted migration, authorize publication or establish real payment/service delivery. Existing live access restrictions and historical operations remain authoritative.

## Operator actions

An independently admitted V4 `RECOVERABLE_PAYMENT_SOURCE` envelope grants named source permissions to a current authenticated operator/credential and namespace actor. V1–V3 envelopes keep their existing behavior. A missing namespace is never seeded by the source commands. Organization, namespace baseline and source digest are checked before writes. The envelope is owner-controlled; the UI cannot grant these permissions.

Create payable accepts the nine invoice business fields: supplier, invoice number, issue date, payment terms, due date, description, exact positive amount, supported source currency and payer Circle Wallet ID. Existing evidence references and SHA256 values are required. Prepaid recharge instead uses legitimate service reference, purpose and service date, without invoice fields. Entered facts and payer text remain unverified; Save calls no AI or wallet provider. There is no upload/OCR/extraction service.

Edit payable saves an attributable revision in the original lineage. Expected versions, duplicate scope and idempotency prevent accidental replacement. Browser drafts retain all evidence references. Additional references can be explicitly added, corrected or removed; prior source versions remain readable, and material evidence hashes advance with the revision. Saved source facts and human decision/assignment/resolution history are available in read-only disclosures. A lost acknowledgement retains the original exact body and idempotency key, including its expected version; reload and Save read back/replay that identity rather than manufacturing another revision. Unsupported evidence identifiers are rejected before commit.

Manual review is available before AI, after outage/invalid advice, and after the bounded AI history limit. The record contains HUMAN provenance, source hash/version, current actor/role/authority version, rationale, evidence, mode and scoped finding dispositions. AI-assisted review uses the same authorization/assurance controls. Invalid model citations are invalid advice, not fabricated missing source evidence. Genuine missing/tampered source facts still require correction. AI uncertainty remains on its original operation; late results are retained separately and cannot replace a current human decision.

C1 retains pending command body/method/path/key and review/recovery rationale, mode, escalation owner and advisory dispositions in versioned tab storage, scoped to the full session token and selected payable. Reload restores this input outside source editing. Recover original pending command retries that exact transport only when current server capabilities or a visible retained review receipt permit the UI action; it never grants financial authority. Unchanged pending review input recovers the original receipt even when refreshed concurrency tokens have advanced. Changed input receives a different request key and remains subject to new-command gates. Selection/session changes clear the active draft and ignore late responses. Malformed, unversioned or wrong-scope browser data is ignored; unavailable storage blocks dispatch rather than promising reload recovery. There is no cross-session transfer of a pending command.

For source review, exact same-key/same-request-hash replay returns HTTP 200 with `replayed:true`, `historical:true`, `receipt_only:true`, and `current_authorization:false`. It reads the immutable original record/hash after later correction, replacement or a financial claim, without CAS, version change or approval restoration. Current authentication, ownership, ingress and reviewer permissions still apply, including final session revalidation. Different bodies conflict; a genuinely new stale request still rejects. Read current source/review state before any subsequent approval. Controlled financial routes retain their existing semantics.

Escalate assigns the current authorized operator by default. A current permitted namespace reviewer can be named explicitly; a revoked/unavailable assignee is rejected. Reassign by submitting ESCALATE with the expected previous review hash. Accept, request correction or decline creates a new immutable decision with `supersedes_review_hash`, which identifies the resolved assignment. This is not a required second approver. Controlled financial review currently uses the existing designated requester role; arbitrary approver enrollment remains unsupported.

Prepare linked testnet instruction creates a non-economic draft. An unused draft can be corrected and superseded while retaining the original link. It cannot activate itself. Independent exact controlled source/requester admission is still required. Before a linked financial command, an activation receipt is retained in the parent namespace. A possible payment keeps its original source snapshot and claim; source corrections remain pending. A safely retired child can permit a parent transition only with an exact child revision check under the migration's row locks. Old links fail current source/review validation.

Refresh payment readiness observes the same approved economics. The current Arc budget is principal plus the authorized fee ceiling in one USDC balance; readiness requires the full reserved ceiling. A balance covering only the current estimated fee is explicitly insufficient for this reserved budget. Top-ups and lower fees within unchanged ceilings can refresh observations without replacing valid signed authority. Changed amount/destination/token/ceilings require renewed authority. Final adapter checks re-read funds and fees and revalidate authority after awaited work.

Authorize exact payment records the current human decision or compatible historical AI reference, deterministic assurance and signed PAE. Release and Execute retain the existing exact-packet confirmation flow. No assurance means no execution. The current separately admitted controlled financial instruction remains the fixed USD 1 Arc Testnet path; source entry is not general merchant payment support.

Observe existing payment is a scoped authenticated read. It queries only the exact recorded operation and never posts settlement. Recover existing payment is a separately authenticated reconciliation command. Saved and lost-reference recovery use stored verified asset/network/preflight identity and do not read balance or fee endpoints. A verified reference discovered by idempotency lookup is persisted under the original operation. A failed principal outcome with unresolved fee effects retains exposure and can receive later exact fee evidence without another submission.

Prepare evidence-supported successor requires a reason and current authority. It accepts proven no-dispatch, a terminal matching provider failure with established fee effects, or an expired unused PAE whose exact durable state proves no dispatch under CAS. Original authorization, preflight, execution and effects remain archived. UNKNOWN, STUCK, missing transactions, expired leases or a requested cancellation never authorize a new key. Historical same-value outbound transactions are excluded from duplicate blocking only when their exact reference, ID, terminal state and fee match retained resolved-operation evidence. No generic duplicate override exists.

C2 preserves established SETTLED provider proof by JSON equality and freezes the complete execution predecessor once a retained recovery event retires it, including a null provider reference. A retirement CAS cannot rewrite an already existing predecessor at admission. UNKNOWN/pending observations and supported FAILED fee enrichment remain possible before retirement. Snapshot readback checks every retired record against its retained digest and verifies each R1 posting against its matching SETTLED execution/proof, amount, destination and digest. Legacy snapshots without R1 posting fields remain readable without invented receipts.

AI-only execution packets omit the inapplicable `review_decision` field, matching the pre-R1 constructor and original exact approval hash. HUMAN packets still include the sealed HUMAN record. No alternate hash, saved-approval rewrite or financial reset is accepted. The R1 null-inclusive local synthetic packet was never an activated live format.

Provider observations, application disposition, reservation and settlement posting are separate facts. Repeated reconciliation is idempotent. A post-movement mismatch remains unresolved with its evidence; it is not a successful settlement or pre-submit prevention. Expiry removes send authority while retained HUMAN/PAE/provider evidence remains readable. Controlled child settlement never discharges the genuine parent or proves prepaid service delivery.

## Persistence and release preflight

`20261020062018_recoverable_payment_workflow.sql` is additive. It preserves earlier bootstrap/disposition, assessment, authorization and execution guards. It adds separate human authorization history without weakening old AI-history columns, append-only source/review/activation/retirement/recovery/late/provider-observation receipts, nested `authority.settlement_postings` retention, monotonic reservation states, private RLS tables and service-only CAS access. Older writers cannot omit protected history once present.

A durable payer-wallet admission table serializes new reservation creation across namespaces. A wallet has one admitted financial namespace; there is no expiry takeover. Installation aborts on conflicting existing RESERVED/EXPOSURE_UNKNOWN namespaces. New conflicting namespaces are rejected before dispatch, while exact historical recovery retains its identity. No automatic namespace handoff or lease-based release is provided. Independent C0 review sampled the migration, two-connection wallet exclusion and stale child-revision rejection in disposable PostgreSQL. C1 changed no SQL or namespace admission. C2 strengthens only the existing unreleased R1 proof/retired-record guard, with no new schema or namespace semantics. Current C2 writer-owned disposable SQL replays cover the cases listed in the verification receipt; they do not imply a full retirement-race matrix.

New production source/financial writers require the service-only `tameion_recovery_capabilities` RPC to attest the R1 schema and wallet/retirement/receipt guards. Missing capability returns `RECOVERY_MIGRATION_REQUIRED` before source mutation or financial preflight; legacy history reads remain available. Synthetic in-process repositories explicitly stand in for that database boundary and do not prove its installation.

Before any separately authorized release: independently review the exact candidate; inventory active claims and schema compatibility; stop incompatible writers; apply migrations only in the authorized environment after backup/roll-forward planning; prove the disposable SQL gates; admit exact owner source/requester/actor/configuration bindings; retain branch deployment guards. None of those production actions is performed by this job. Removing the additive migration is not a safe rollback after HUMAN authorization or new receipts exist. Roll forward or stop financial writes while preserving history.

## Verification and limits

See [142-scenario map](RECOVERABLE-PAYMENT-R1-SCENARIOS.md) and [verification receipt](RECOVERABLE-PAYMENT-R1-VERIFICATION.md). Handler/adapter tests use canonical production modules with synthetic snapshots and closure-held CAS repositories. They prove application behavior, not PostgreSQL durability, locking, permissions or cross-namespace exclusion. Browser tests bridge network-fenced local handlers into the built UI; their source/review path does not activate a real controlled source or send money. Full financial journeys and faults use the actual authorization/worker/real-adapter paths with injected synthetic clients.

The disposable SQL gate requires both `TAMEION_RECOVERY_DISPOSABLE_PG_CONFIRMED=1` and `TAMEION_RECOVERY_DISPOSABLE_PG_URL`, an explicit loopback host/port and an empty database named `tameion_recovery_disposable_*` in a disposable cluster. It applies all actual migrations and uses two independent PostgreSQL connections. Never point it at a hosted or populated database. C1 did not rerun PostgreSQL. C2 executes fresh and representative populated verification in a new credential-free, network-isolated writer-owned PG17.11 cluster; host-suite database skips are reported separately from actual SQL executions. Full retirement/upgrade/receipt parity and scale coverage remain incomplete; changed candidate identity requires separate assurance.

Unsupported capabilities include genuine merchant settlement, arbitrary controlled payment amounts, new FX/rails, batching/partials/refunds/reorg processing, user-controlled wallets, contract approvals, account unfreezing, acceleration/cancellation, source uploads/extraction and service-fulfillment verification. Operational owners must repair actual external restrictions; local timers or AI cannot remove them.


### Source assessment context rejection

For a genuine payable, only the advisory command's exact HTTP 409 singleton
`GENUINE_ASSESSMENT_BASIS_INVALID` response is presented as a rejected new
attempt: source assessment context failed validation before a new reservation
or provider dispatch. The exact failing source fact is not established by this
code. The workspace owner must review the admitted source assessment context;
the message does not identify a missing invoice field or an AI outage.

The original request key and history remain retained. This presentation grants
no resend, new assessment, approval or payment authority. A separately recorded
UNKNOWN remains unresolved. Wrong-context/status, malformed, extra/conflicting
responses and transport failures remain unconfirmed. NOT_FOUND alone is not
retry permission. The observed rejection is scoped to the current key, source,
version and component lifetime; it is not reconstructed as authority after reload.

This local correction does not change the source packet, activate source-review
capabilities, or verify hosted schema, Stage 2 completion or financial UAT.
