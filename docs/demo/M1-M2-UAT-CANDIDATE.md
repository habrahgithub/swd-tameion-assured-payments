# Combined M1/M2 UAT candidate

This is one local candidate under Job #65, on `codex/m1-m2-uat-01a13166`,
branched from `c0eb1a1c4f849e73ad2e8113da80451dfe995fa6`. Resolve the candidate
with `git rev-parse HEAD`; the controller receipt binds that exact commit to
verification artifacts. M1 is protected operator access and read-only balance;
M2 is lifecycle acceptance preparation. Local tests do not establish hosted
or financial acceptance. The current Tameion-only independent-review waiver
supersedes the older independent-review prerequisite in the demo documents;
AXIS exact-head acceptance and owner effect permissions remain required.

## Local owner walkthrough

Use Node24.21.0/npm11.19.0 and the approved project-local lockfile install.
Keep actual credentials absent. Run `npm run build`, then
`npm run start -- --hostname 127.0.0.1 --port 3190`. Do not expose this local
server publicly. Stop with Ctrl+C when finished.

1. Open `http://127.0.0.1:3190/`: expect operator access, Sign in and no private
   queue. Open Sign in: password is masked. Missing deployment configuration
   must deny access rather than manufacture a local login bypass.
2. Open `http://127.0.0.1:3190/local-demo` on desktop1365×951 and mobile390×844
   (also320×640 and zoom): the notice must say
   **SIMULATED / NON-ECONOMIC / NOT_VENDOR_PAYMENT**.
3. Assess mock case A, acknowledge the exact mock intent, submit once to fake
   adapter, then observe the recorded outcome. Selection, amount/destination,
   version and next action must remain tied to that mock case.
4. Repeat with HOLD, ESCALATE and FUNDING_HOLD: acknowledgment is unavailable.
   Change amount after assessment: assessment is no longer current. Changed
   destination, historical authority and mismatched packet must block.
5. On RECONCILED_MOCK, use Review receipt: the compact SIMULATED toolbar
   must leave the recorded mock outcome readable at320×640 and200% zoom.
   Show actions restores focus to Review receipt. Choose another mock case
   shows that case's own submission count; returning to A retains its single
   fake submission and completed state.
6. UNKNOWN must show **OUTCOME_UNVERIFIED / NO RETRY**, disable submission and
   keep fake submission count1 after observation. Never retry original003.

The browser-local walkthrough uses an unsigned toy packet. It is a UX check,
not the actual Safety Kernel/PAE execution proof. The repository tests below
exercise the real production modules with test keys and FakeProviderAdapter.

## Acceptance map and evidence modes

| Transition / surface | Existing evidence owner | Local proof | Remaining live gate |
|---|---|---|---|
| Login/session/CSRF/throttle/logout | operator-auth, operator-route-policy, operator-boundaries tests; operator-access browser | isolated repositories, mocked session and true unconfigured denial | provisioned verifier, exact hosted ingress, expiry/revocation and owner login |
| Read-only balance | operator-wallet-balance tests; operator-access browser | pinned identity/precision validation; manual mock refresh; logout clears view | actual read-only provider tuple and complete response, owner approval |
| Obligation | synthetic source fixtures; golden-path.integration | invented identity/version and source evidence | privacy-cleared genuine payable, no replacement of withdrawn records |
| Assessment | finance-agent, assessment-evidence and simulated-happy-path tests | advisory output with deterministic evidence; NOT_LIVE_AI | explicit live AI access and current assessment provenance; UNKNOWN recovery policy |
| Human authorization | authorize-and-seal production path; authorization-signing-precondition tests | current test review/actor, exact N→N+1; failed assurance restores state | authenticated authorized human action, financial lane admission |
| Assurance / signed PAE | Safety Kernel and PAE production modules; simulated-happy-path / pae / durable-records | PASS bound to exact intent, test-only signing/verification | actual signing custody, current actor/trust authority and exact approved packet |
| Execution | ExecutionWorker / FakeProviderAdapter; execution-worker-final-gates | kill/expiry/current authority checks; accepted-reference persistence; no duplicate submission | exact testnet execution permission and historical003 reconciliation |
| Reconciliation | ExecutionWorker; execution and provider-adapter tests | identity/amount-bound fake settlement, STUCK pending, CAS conflict restores UNKNOWN | genuine provider/chain truth, exact one-to-one result; newest50 cold-search limit |

## Deployment/configuration handoff — values deliberately absent

Owner must approve the precise project, environment, deployment, origins and
operations. No upload, public push, deployment, provisioning or live call is
performed by this candidate. Supply private values through the approved host
secret controls, never this document or a public issue.

- `TAMEION_ALLOWED_ORIGINS`: exact HTTPS origins; `TAMEION_INGRESS_MODE`:
  `vercel-direct-v1`; `TAMEION_INGRESS_RECORD`: approval id, project id,
  environment, `direct_edge=true`, `trusted_proxy_override=false`, exactly
  matching origins, and either the preferred exact deployment id or the
  separately approved Preview-only `git-sha-preview-v1` exact commit SHA.
  Runtime `VERCEL_PROJECT_ID`, `VERCEL_ENV` and the selected identity must
  match. No wildcard or branch-only identity is accepted.
- `TAMEION_THROTTLE_HMAC_KEY`: private compliant hex key;
  `TAMEION_OPERATOR_KEY`: existing operator identity backed by a separately
  provisioned password verifier. DDL alone does not provision that verifier.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`: explicitly approved backend,
  not an inferred permission to connect to the disposable validation database.
- `TAMEION_BALANCE_PIN`: approved wallet/set/source/network/token/address,
  precision and native-token tuple; `CIRCLE_API_KEY`: separately authorized
  read-only capability. Actual provider tuple/completeness remains unverified.

SQL migration and rollback receipts remain evidence for unchanged SQL bytes;
head movement requires exact-byte rebinding, never replay. Committed race
validation, live hosted ingress/login/balance, genuine financial lifecycle,
privacy clearance, owner desktop/mobile UAT and release decisions remain gates.
Original obligation003 remains OUTCOME_UNVERIFIED / NO_RETRY. Keep payment HTTP
lanes disabled; mock proof never enables them. Currency policy and assessment
UNKNOWN recovery are not changed in this candidate.

## Command Center UI correction acceptance

The isolated browser suite supplies invented queue/session/balance/stage data;
these fixtures do not enable real operator access. Once the separate hosted
prerequisites are approved and provisioned, owner UAT should confirm:

- The permanent action strip keeps the selected obligation, source amount,
  viewed/current stage and one existing legal action visible while scrolling.
  A payment stop or unknown stop state offers no approval. A sealed instruction
  shows recorded authorization rather than asking for another PAY review.
- Wallet balance status is visible before opening Operator. One automatic refresh after verified login, with a retained manual refresh
  shows amount, network and observation time with its read-only caveat; it does
  not establish affordability, fees or payment readiness. Expiry/logout clears
  the private view and rejects a late observation.
- Authorization distinguishes the source payable/beneficiary from the testnet
  proxy. The concise summary shows amount, recognizable destination, network,
  reason/currentness and next owner/step. View exact instruction and source
  evidence exposes the full exact destination address before approval.
- Queue amount/currency and complete due date remain readable. Inspect desktop,
 390px and320px widths and keyboard focus. Stored screenshots are intentionally
  reviewed local Chromium baselines; they are not hosted UAT evidence.

### Operator private VIEW readiness amendment

Authenticated private VIEW admission is distinct from financial source eligibility. The fixed ignored source packet and independently configured SHA bind exactly five owner-approved records to an existing namespace/revision/canonical authority snapshot; public withdrawal, source eligibility and every financial HTTP lane remain unchanged. No original003 operation is authorized. Missing/inconsistent source/state remains unavailable without seeding. See HOSTED-UAT-DEPLOYMENT.md for exact packaging/privacy gates.

The wallet completeness correction remains dependent on an adjudicated Circle pagination/terminal contract and actual native/token representation; first-page or mock success is not verified live balance. External read-only discovery requires its own owner consent/custody. Real hosted login/balance/full-flow and owner UAT remain unaccepted until their exact current runtime evidence exists.

The current offline correction adds a guarded fresh controlled testnet financial path alongside the preserved five-record VIEW capability. Its independently approved source/requester authority is separate from viewing and public withdrawal; invoice facts remain null and genuine business purpose remains false. The canonical controlled timestamp/purpose context, persisted AI assessment, proxy preparation/reassessment, human review, SafetyKernel/PAE, durable one-submit worker and explicit reconciliation POST are exercised only by network-denied synthetic fixtures. No synthetic result establishes hosted readiness, actual provider pagination/precision, a transfer, or original003's outcome. See HOSTED-UAT-DEPLOYMENT.md for strict authority formats and retained effect prerequisites.
