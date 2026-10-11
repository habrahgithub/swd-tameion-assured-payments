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
