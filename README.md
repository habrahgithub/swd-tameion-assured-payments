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

## Private withdrawal safety boundary

Current source admission is checked before direct authorization and again at
execution and the final provider-send boundary. Restoring historical approvals,
PAEs or aggregates cannot admit a withdrawn source. Missing or unverifiable
eligibility blocks new authorization/submission; recorded evidence is retained.

Approval and both kill-switch HTTP mutations are disabled with
`REQUESTER_UNVERIFIED` before durable state access. No verified requester boundary
exists here: caller identity fields and a designated approver are not authentication.
This is a fail-closed demonstrator, not a usable live payment workflow.

Obligation-detail GET projects recorded evidence only. It does not recover an
in-flight marker, reconcile/persist state or query a provider. An unresolved recorded
outcome remains unresolved; this candidate supplies no live reconciliation workflow.

Withdrawn list/detail and approval-packet reads short-circuit before state hydration, whose legacy
durable loader can seed or migrate records. No database read-path extraction or
live reconciliation is introduced by this correction.

## Local synthetic walkthrough

The separately isolated walkthrough is at `http://127.0.0.1:3190/local-demo`
after a local build and `npm run start -- --hostname 127.0.0.1 --port 3190`.
It requires a top-level secure loopback browser context and rejects hosted,
embedded, cross-origin and hostile forwarded activation. It has no API mutation
endpoint, no credentials and no persistence. It never populates the genuine queue.

Choose an invented case, assess it with deterministic local rules, acknowledge
its exact mock intent, submit to the in-memory fake adapter, then separately
observe the recorded fake outcome. Authorization uses an invented reviewer and
an **unsigned mock packet**, not real authentication, a signed PAE, Safety Kernel
assurance or production execution. The UI keeps SIMULATED / NON-ECONOMIC /
NOT_VENDOR_PAYMENT labels visible. Reload discards browser-memory state.

Scenario choices cover advisory HOLD/ESCALATE, ineligible mock funding,
historical authority, packet mismatch, destination changes and UNKNOWN with no
retry. Changing inputs invalidates current assessment and packet binding while
retaining their mock audit history. Production withdrawal and requester guards
are unchanged. Automated mock checks are distinct from PRIME-observed UAT.

## Private operator continuation (#65)

The root dashboard requires a server-validated operator session. Login, session,
logout and manual read-only wallet balance routes fail closed until approved
exact-origin, ingress, auth database and balance-pin configuration is provisioned.
No values or credentials are supplied by this candidate. The new SQL migration
has not been executed; isolated grants/concurrency/security validation must precede
enablement. Existing privileged HTTP lanes are disabled and login does not grant
assessment, approval, signing, payment or reconciliation authority.

Read paths now use an existing-state-only loader, with no request-triggered seed,
migration or bootstrap. Source withdrawal short-circuits before state hydration.
Private responses are no-store. Mocked core tests retained in internal legacy
modules do not establish current HTTP admission or live proof.
