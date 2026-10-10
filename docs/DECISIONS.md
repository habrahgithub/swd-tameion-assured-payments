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
