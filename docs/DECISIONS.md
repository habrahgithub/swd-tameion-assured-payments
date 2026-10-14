# Public architecture and source privacy boundary

This summary is independently written from the current implementation. It does
not reproduce withdrawn design documents or establish new architecture.

An upstream business system owns obligation facts. The payment control plane
reads a canonical obligation, produces advisory assessments, records human
authorization of an exact intent, checks deterministic safety conditions, and
binds the approved intent into a signed payment envelope. The execution worker
verifies those bindings again before any provider submission. Provider evidence
and reconciliation remain distinct from an advisory result or authorization.

The public genuine-source set and evidence ledger are withdrawn for privacy
review. Default runtime state has no genuine records and no synthetic fallback.
Withdrawal preserves retained durable state; it is not a reset or a claim that
business obligations do not exist. Reintroducing a source requires separate
authorization and a reviewed source boundary.

Independently invented regression records live under `tests/test-support`.
They are SIMULATED / NON-ECONOMIC / NOT_VENDOR_PAYMENT. Compatibility identifiers
in these cases are not genuine identities, traction, source evidence or proof of
real payments. Browser verification supplies mocked responses; it does not
populate the server's genuine queue.

AI cannot approve, sign or execute. Authorization, signing, deterministic safety
checks, idempotency, kill switches, provider uncertainty and no-blind-retry
controls remain enforced by their existing modules. A successful test or build
does not authorize live AI, database, wallet, provider or payment activity.

Current-tree withdrawal cannot erase historical public exposure. History,
credential triage, runtime advisories, independent review and release decisions
remain separate gates. No public push, deployment or release is implied.

Browser compatibility checks serve a fresh production build using Playwright's
recorded Chromium channel and a dedicated local server. They retain existing
timeouts, image tolerances and assertions. Disabled wallet-readiness guidance
wraps within its container at zoom; its wording, disabled state and authority
boundary remain unchanged. Font or image-baseline changes require separate
review of baseline provenance.

## 2026-10-10 — Private withdrawal and requester boundary correction

Under the existing writer admission, current source eligibility is required in the
authorization pipeline and worker, including its post-await provider-send guard.
Historical valid records cannot restore source eligibility. Existing signature,
expiry, packet binding, idempotency and durable authority checks are retained.

Approval and both kill-switch HTTP mutations fail closed before state access until
a verified requester boundary is separately admitted. No authentication architecture
or caller/server-selected actor fallback is introduced. Detail GET is observational
only; mock-only worker reconciliation tests preserve financial safety proofs.
Remaining design-derived commentary is withdrawn with its original retained privately.
No baseline replacement, dependency uplift, public action or live operation is admitted.

## 2026-10-10 — Local synthetic functional walkthrough

The new PRIME/AXIS admission permits a local interactive mock journey while
retaining genuine-source withdrawal and privileged mutation denials. A dedicated
`/local-demo` page checks loopback request shape and the actual browser independently
requires a secure, top-level loopback location without an opener. Hosted platform
markers additionally deny activation. Header checks are defense in depth, not a
remote authentication boundary: forged headers cannot give the mock model access
to any live adapter or source authority.

The model imports only the existing in-memory FakeProviderAdapter. Its UUID uses
the native Web Crypto API, available in both pinned Node and secure loopback
browsers. Production pipeline, signing, worker, provider and persistence modules
are not dependencies of this journey. No signing key, environment source override,
server mutation endpoint or production guard bypass is introduced.

Mock authorization binds an invented reviewer, case, version, assessment, amount
and destination into an unsigned presentation packet. It is not authentication,
a PAE or cryptographic assurance. Submission and reconciliation are separate real
interactions with in-memory fake records. Duplicate or unresolved submission cannot
retry; changed inputs and historical evidence do not establish current eligibility.
Every stage and retained audit entry stays explicitly non-economic. Existing image
baselines, tolerances and genuine financial negative assertions remain preserved.

## 2026-10-11 — Private operator and read-only balance boundary (#65)

The isolated private continuation adds digest-only operator sessions, one-use
prelogin CSRF challenges, finite durable budgets, fixed session expiry, and
version/revocation checks. Authentication grants no financial authority. All
unadmitted assessment/model, signing, execution and internal provider HTTP lanes
return constant denials before initialization. Their prior implementations remain
internal solely to preserve mocked core regression coverage; no HTTP route imports
them. Approval and kill-switch denials and all source withdrawals remain intact.

Enabled private reads authenticate before checking source eligibility. Existing
state may only be selected and restored; no request seeds actors, initializes a
worker/provider, migrates keys or backfills history. Empty source does not hydrate.
Missing state, schema or trust/bootstrap markers blocks the read.

Deployment must explicitly provision exact HTTPS origins and an approved
`vercel-direct-v1` project/deployment/environment topology record. Platform flags
alone do not establish ingress provenance. Absent or inconsistent configuration
blocks before any durable admission. Network budgets use a dedicated HMAC key;
raw IPs never enter persistence. No hosted test-mode or insecure cookie switch
exists. Session CSRF is domain-separated from an opaque random bearer, with only
a digest stored; bearer values remain solely in Secure/HttpOnly host cookies.

Balance is a separately pinned, manual read-only observation with exactly two GET
capabilities. Its narrow client needs no entity/signing secret and cannot list,
estimate fees, create or sign transactions. Wallet, wallet-set, source address,
Arc Testnet network and native USDC identity/precision must match exact approved
server configuration. Missing/duplicate/malformed responses never become zero.
Session revalidation surrounds each read; logout and expiry discard pending UI
results. No affordability or payment readiness is inferred. Circle endpoint
shapes follow the pinned installed SDK and the official
[wallet API reference](https://developers.circle.com/api-reference/w3s/developer-controlled-wallets/list-wallet-balance).

The additive migration is source only. Mock/static tests cannot prove SQL grants,
transactional serialization or deployed ingress. Isolated SQL/grant/concurrency,
protected Preview setup, out-of-band credentials, independent review, and one
operator-clicked live read smoke remain separately gated. No SQL or live call is
admitted here. Original003 UNKNOWN/no retry and the two existing visual failures
are preserved; browser-server consent remains a separate explicit gate.

### #65 review correction — selected balance precision and test boundaries

Balance collection rows retain bounded canonical decimal syntax; the six-decimal
limit applies only after unique pinned USDC identity is selected. Duplicate and
near-match identities still fail closed. No amounts are rescaled. Native versus
interface USDC representation remains unresolved pending AXIS adjudication;
unsupported precision/metadata is rejected and no live enablement is claimed.

Anonymous browser reads assert denial. Authenticated source-withdrawal checks
use the explicit in-process reader seam, including detail and approval packet;
operator read authentication grants no mutation authority. Screenshot baselines
and tolerances remain unchanged. Temporary mocked browser execution records
source/build/config identity, owned shutdown and network evidence privately.
Earlier missing supervisor evidence remains missing.

### #65 login-finish expected credential version correction

The SQL login-finish denial now explicitly rejects NULL and nonpositive expected
credential versions and compares the verifier version with IS DISTINCT FROM.
A nullable inequality could otherwise evaluate NULL and skip a denial; this is
a source finding, not proven HTTP exploitation. Ticket consumption order,
positive matching-version session minting, expiry and existing guards are retained.
Offline checks cover the SQL source contract, production password validation
and mocked handler denials; they do not establish PostgreSQL runtime behavior.
The separate SQL harness remains bound to frozen candidate93b and its original
migration hashes. It requires explicit independent rebinding before use with
this corrected migration; no SQL execution or enablement is authorized here.

### 2026-10-12 — Signer readiness and synchronous authorization failure

The shared authorization pipeline validates configured Ed25519 signing capability
and active matching trust before calling the authority approval transition.
Missing, malformed, wrong-algorithm, revoked or mismatched hosted signing material
fails with sanitized `PAE-015`; no key is provisioned by this correction.
The pipeline marks a PAE usable only after successful signing. Any synchronous
approval/kernel/payload/sealing failure restores the original request-local
aggregate using the existing store API, preserving assessment history and kill
switches. This helper performs no persistence or provider calls; local restoration
does not establish durable rollback, repair an uncertain flush, or authorize retry.

Regression tests use invented non-economic obligations and isolated cryptographic
fixtures through the shared production code. Withdrawn-source and requester
denials, retired synthetic HTTP routes, signing trust and execution guards remain
in force. Original003 remains `OUTCOME_UNVERIFIED / NO_RETRY`; the historical
hosted HTTP 500 outcome has not been inspected or resolved by this correction.

### 2026-10-14 — Genuine advisory and separately linked testnet drafts

Job #65 admits advisory assessment of genuine company records separately from
payment authority. V1/V2 private catalogs retain their exact revision/hash
read-only contract. Explicit V3 `GENUINE_ADVISORY_SOURCE` catalogs additionally
pin the canonical authority object with `assessments` removed; their approved
minimum revision permits assessment history and instruction-draft CAS writes
without permitting aggregate/source/version changes. The catalog bytes still
pin the genuine records. Changing those facts requires a new approved binding.

The advisory adapter reuses the durable assessment reservation/result engine
without constructing a signer, Circle adapter or payment worker. Existing
financial/recovery identities cannot be reopened through this capability.
New genuine assessment receipts also seal the exact source-record SHA256;
draft creation, activation and current-assessment projection require that hash.
Reapproved source text at an unchanged aggregate version cannot reuse an older
assessment. Missing commercial facts remain findings; no invoice, supplier or destination
verification is invented to obtain PAY.

The portal can append an immutable, separately identified Arc Testnet instruction
draft bound to source content/version and the exact current assessment. Creation
is idempotent and CAS-protected, performs no provider call, and grants no payment
permission. The additive CAS migration protects the complete linked-history
prefix against overlapping old writers. Application parse/restore/export retains
it on unrelated writes. Migration application and V3 catalog activation require
separate reviewed operational authority; shipping this code alone activates neither.

Linked financial admission still requires the existing exact controlled
source/requester packet and separate namespace. An additional gate verifies the
linked draft, current genuine source/version and current assessment before any
financial action or provider-send revalidation. Existing USD1 controlled-shape,
expiry, actor, signing, preflight, assurance, release and no-retry controls remain.
The draft is not another payable, and testnet activity never discharges the
genuine supplier liability. No automatic reset of historical attempts is added.
