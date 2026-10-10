# Tameion

Tameion is an assured payment control-plane prototype. AI produces advice, a
human authorizes an exact intent, and deterministic controls and a signed
payment envelope govern any execution. See the independently written
[public architecture summary](docs/DECISIONS.md).

## Source privacy status

**Genuine source data is withdrawn from this candidate.** The public source set
and evidence ledger contain no records or private-evidence fingerprints. An
empty queue does not imply that underlying business obligations do not exist.
The runtime has no synthetic fallback and no private-source import. Existing
durable state is preserved rather than reset.

Tests use independently invented SIMULATED / NON-ECONOMIC / NOT_VENDOR_PAYMENT
fixtures. Compatibility identifiers are not genuine usage, source evidence or
traction. Browser tests supply mocked responses; those fixtures never populate
the server queue. Full private-origin design copies have been replaced by
non-disclosing stubs. This withdrawal does not erase historical public exposure.

## Runtime and local verification

Node.js **24.21.0** and npm **11.19.0** are required. Select the pinned native Node
executable before using repository scripts. Dependency versions remain governed
by `package.json` and the lockfile.

```bash
npm run check:hygiene
npm run typecheck
npm test
npm run build
npm run test:visual
```

Verification must use mocked providers and no live credentials. Test/build
success is not authorization for live AI, database, wallet, provider or payment
activity. The separate synthetic demonstration uses the existing isolated fake
provider lane; it cannot confer authority on genuine obligations.

Browser verification builds and serves the production candidate with the
Chromium revision recorded by Playwright. It starts its own local server;
an unrelated running server is not reused. Image comparisons require the
reviewed baseline's browser and font environment; do not replace baselines
solely to clear an environment mismatch.

## Safety and release boundary

The upstream business system remains the source of obligation facts. Source
approval does not grant execution authority. Human exact-intent approval,
Safety Kernel checks, signed-envelope verification, idempotency, kill switches,
provider UNKNOWN and no-blind-retry controls remain required. No controls are
weakened by source withdrawal.

Secrets belong in approved server-side configuration. `.env.example` contains
names with empty values only. Never expose secrets through `NEXT_PUBLIC_*`.
Generated builds, reports, local receipts and artifacts are not committed.

Historical source exposure, secret triage, runtime advisories, independent
review, scenario UAT and release strategy remain separate gates. This candidate
claims no public release, merge, deployment, financial execution or submission.
