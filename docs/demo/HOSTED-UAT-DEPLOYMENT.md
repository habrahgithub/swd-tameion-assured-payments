# Hosted UAT deployment approval transport — Job 65

This runbook prepares a separately approved **Preview** deployment of the exact accepted candidate. Offline tests and local Next traces do not establish a deployed runtime. No production promotion, SQL, credential provisioning, payment execution, or retry of original 003 is admitted by this document.

## Approval bindings

The preferred ingress policy uses an independently approved exact deployment ID. A deployment environment snapshot is fixed at creation; the inspected Vercel 59.26.0 continuation sends files, not replacement environment variables. Package the owner-approved nonsecret record as private server build input after reserving the actual deployment. Never copy runtime facts into a generated approval, override `VERCEL_DEPLOYMENT_ID`, or substitute a custom Skew Protection ID.

When the Vercel team does not support manual deployment provisioning, AXIS may separately approve the bounded `git-sha-preview-v1` fallback below. It binds a normal Git Preview to one exact 40-character lowercase Git SHA, the approved Vercel project, the Preview environment, and the approved HTTPS origins. It cannot authorize Production and cannot contain a deployment ID. The preferred deployment-ID path remains unchanged.

The production parser remains the authority for both strict record schemas. The fixed server path is `.tameion/deployment-approval.json`, at most 16 KiB. Missing package permits an explicitly configured valid `TAMEION_INGRESS_RECORD`. A present malformed/unreadable/oversize package, invalid environment record, or conflicting sources fails closed. Identical records are permitted. Runtime project, selected exact identity, environment, direct-edge mode, allowed origins, and throttle-key checks remain mandatory. No repository or provider is constructed before ingress succeeds.

### Exact-Git-SHA Preview fallback

Use this only after manual provisioning has failed cleanly before deployment creation and AXIS/PRIME has approved this specific fallback. Configure the branch-scoped Preview `TAMEION_INGRESS_RECORD` with exact canonical JSON:

```json
{"approval_id":"OWNER_GIT_SHA_PREVIEW_APPROVAL","binding":"git-sha-preview-v1","project_id":"APPROVED_PROJECT_ID","git_commit_sha":"EXACT_40_CHARACTER_LOWERCASE_GIT_SHA","environment":"preview","direct_edge":true,"trusted_proxy_override":false,"origins":["https://owner-approved-new-private-alias"]}
```

Commit and verify the source before creating that record. Then redeploy the Git deployment for that same commit so the new environment snapshot is applied without changing `VERCEL_GIT_COMMIT_SHA`. The runtime admits access only when Vercel exposes `VERCEL=1`, `VERCEL_ENV=preview`, the exact project ID and the exact approved Git SHA. For request origin, it requires Vercel's HTTPS `host` and identical `x-forwarded-host` values rather than assuming the framework's internal request URL retains the public alias. Vercel may add the standard `forwarded` header; the application does not use it for identity and derives the rate-limit network digest only from the separately validated `x-vercel-forwarded-for` value. Wrong or missing SHA, Production, mixed `deployment_id` authority, project drift, origin drift, or malformed configuration fails closed. After READY, assign only the pre-approved private alias to that exact deployment and preserve authenticated alias-to-deployment/project/team/SHA readback plus anonymous SSO-denial evidence before login UAT. Do not select an unverified latest deployment or push an empty commit, because either breaks the exact-SHA approval.

## Retained owner prerequisites

Before any remote action, PRIME/AXIS must bind a separate effect packet to:

- exact accepted source SHA/tree, clean worktree, pinned Node 24.21.0/npm 11.19.0 and Vercel CLI 59.26.0;
- Vercel project `prj_SRsrBlbXY4GvrO8LONqbVW0yTFfg`, team `team_DA1HEA83u9lE98qhrLxLeRTn`, Preview target, private recipient/protection settings and bounded execution window;
- Mumbai application backend `wnaagidiisgsiwwomcdy` (`tameion-assured-payments-j0`, ap-south-1). Tokyo validation evidence is not application provisioning evidence;
- separately approved backend readiness, session/verifier setup, required secrets, Circle wallet/token/network/decimals and manual read-only balance scope. Do not print secrets or put them in the approval artifact;
- authorized executor, one reservation, cancellation/expired-window handling, and exact remote readback oracles. No autonomous replacement deployment on failure.

Configure required runtime secrets/origin mode before reservation under that separate authority. Neither the helpers nor this runbook create credentials, set hosted environment, or authorize database changes. Leave the legacy ingress record unset when using the package, unless the owner deliberately supplies the identical record.

## Pre-reservation access origin and separate post-assignment proof

Before init, PRIME must approve the exact planned private access origin and configure `TAMEION_ALLOWED_ORIGINS` to it under the separately admitted configuration permission. Preserve authenticated configuration readback; the plan's stage label is owner intent, **not proof configuration was actually set**. The generated deployment URL cannot be guessed in advance. A proposed new alias, scoped lookup404 or project-level protection policy proves neither global availability nor effective access protection. Existing/production aliases are excluded.

An independently approved, hash-bound plan has exactly these keys:

```json
{"approval_id":"OWNER_ACCESS_ORIGIN_APPROVAL","project_id":"APPROVED_PROJECT_ID","team_id":"APPROVED_TEAM_ID","environment":"preview","access_origin":"https://owner-approved-new-private-alias","stage":"PRE_RESERVATION_ACCESS_ORIGIN_APPROVAL"}
```

The owner supplies the approval identifier and expected exact byte hash; neither helper generates authority. The approval record's single access origin must equal this plan. Raw reservation/build receipts separately preserve `generated_origin`, which must match each other. Exact deployment/project/team/environment/continuation comparisons remain mandatory. Same-origin custody can still use the exact approved record alone; a distinct origin always requires the explicit plan. Duplicate/extra/malformed custody keys, wrong hashes or mismatched identities reject.

Packaging and local build verification always report `access_origin_mapping=NOT_YET_VERIFIED` and `hosted_uat=NOT_ADMITTED`. Neither a plan nor a successful local build proves alias routing or protection. Only after same-ID continuation reaches READY may the separately authorized executor assign **only the approved new alias** to that exact deployment (`vercel alias set ACTUAL_RESERVED_ID APPROVED_NEW_ALIAS`, with independently checked project/team custody). Never use latest-deployment selection. Conflicts, ambiguous409, existing alias ownership or unknown outcome stop without reassignment/retry/replacement.

Before any login/session/provider UAT, preserve authenticated exact alias→deployment/project/team/Preview readback and explicit anonymous-denial/protection evidence for both alias and generated URL. The exported production helper `requireHostedEvidence` in `scripts/verify-deployment-approval.mjs` rejects missing/ambiguous/wrong-ID/wrong-origin/unprotected supplied receipts. Mapping receipt keys are `deployment_id`, `project_id`, `team_id`, `environment`, `access_origin`, `generated_origin`, `authenticated_readback:true`, `evidence_sha256`; protection receipts have the same keys plus `anonymous_access_denied:true` and `anonymous_generated_denied:true`. Evidence hashes must refer to the actual retained readbacks/negative observations. Its result says `CONSISTENT_SUPPLIED_RECEIPTS_NOT_REMOTE_ATTESTATION` and `REQUIRES_SEPARATE_OWNER_AUTHORITY`: it checks supplied evidence consistency and cannot authenticate cloud facts or grant permission by itself. The executor/AXIS must independently establish provenance/currentness and owner window before invoking hosted actions. Fake receipt tests never certify live protection.

## One reservation, one build, one continuation

The following is executable shape, not permission to run remote commands. The owner executor must check pinned CLI help/source and capture command exit status and authenticated readbacks. Use the supported `vercel deploy init --json` flow only after the effect packet admits it. Preserve its actual ID and raw generated HTTPS URL, distinct from the planned access origin. The inspected CLI `getDeploymentOutputJson` emits `id`, `url`, `target`, and `readyState`; project/team ownership needs separate authenticated project/deployment readback. Do not infer ownership from a URL or project name. A missing/ambiguous field stops the transaction.

Normalize independently verified reservation facts into a local nonsecret JSON receipt with exactly these keys:

```json
{"deployment_id":"ACTUAL_RESERVED_ID","project_id":"APPROVED_PROJECT_ID","environment":"preview","generated_origin":"https://actual-reserved-preview-origin","team_id":"APPROVED_TEAM_ID"}
```

This is our custody input contract, not an invented Vercel API response shape. A null platform `target` is not by itself proof of Preview: require the admitted Preview command/context and authenticated readback. Preserve raw responses separately. Independent owner approval after reservation then supplies the existing strict schema's `approval_id`, `project_id`, `deployment_id`, `environment`, `direct_edge:true`, `trusted_proxy_override:false`, and the single canonical HTTPS planned access `origins` entry. Do not substitute the access alias into raw generated-origin receipts. Hash the exact approved bytes; the helper never manufactures an approval ID.

Before building, obtain the intended build context for **that same reserved ID** from authenticated reservation/project/team readbacks and the owner-approved Preview invocation. Normalize those independently checked intended facts with the same five-key generated-origin contract. This is a pre-build context receipt, not proof a build has already run. Do not run `vercel build --id` merely to obtain metadata: it actually builds. Do not fabricate a receipt by copying approval fields. The helpers compare supplied receipts; they do not authenticate the remote facts behind those receipts.

With the fixed source checkout as cwd, package the approved input (local command only):

```sh
node scripts/package-deployment-approval.mjs \
  --approval /owner-custody/approved-record.json \
  --sha256 OWNER_APPROVED_EXACT_FILE_SHA256 \
  --reservation /owner-custody/reservation.json \
  --build-context /owner-custody/build-context.json \
  --continue-id ACTUAL_RESERVED_ID \
  --team-id APPROVED_TEAM_ID \
  --access-origin-plan /owner-custody/approved-access-origin-plan.json \
  --access-origin-plan-sha256 OWNER_APPROVED_ACCESS_ORIGIN_PLAN_SHA256
```

The six reservation/approval arguments are mandatory. The two access-origin-plan arguments must be supplied together and are mandatory whenever access origin differs from the actual generated origin. The helper checks the canonical schema, approved byte hash and exact reservation/build/continuation identities before exclusive creation. It refuses an existing artifact or symlink destination directory; it does not overwrite earlier approvals. Only the authorized owner may reconcile an earlier artifact. No helper uploads anything.

After packaging, the separately admitted executor runs one `vercel build --id ACTUAL_RESERVED_ID` using the checked context and records its exit status and emitted metadata. Reconcile actual build identity to the pre-build context; any mismatch stops before upload. For the offline local Next proof only, run `npm run build`, then:

```sh
node scripts/verify-deployment-approval.mjs \
  --approval /owner-custody/approved-record.json \
  --sha256 OWNER_APPROVED_EXACT_FILE_SHA256 \
  --reservation /owner-custody/reservation.json \
  --build-context /owner-custody/build-context.json \
  --continue-id ACTUAL_RESERVED_ID \
  --team-id APPROVED_TEAM_ID \
  --access-origin-plan /owner-custody/approved-access-origin-plan.json \
  --access-origin-plan-sha256 OWNER_APPROVED_ACCESS_ORIGIN_PLAN_SHA256
```

The verifier checks every emitted API route's real Next NFT trace, exact packaged bytes, static/public files and served HTML/RSC/body/meta exclusion, and hashes the complete local `.next` tree. Output explicitly states `LOCAL_NEXT_BUILD_ONLY_NOT_UPLOADED`.

**Mandatory remote execution gate:** local NFT inclusion is not proof of actual Vercel Build Output packaging. Before any continuation upload, inspect and seal the actual `.vercel/output` emitted by the pinned reserved-ID build: prove the approved file is present with the exact hash in every protected function at its runtime cwd, absent from all client/public/static/served outputs, and preserve all output file hashes. Independently bind this seal and build metadata to the reserved ID/project/team/Preview origin. Missing proof stops before upload; no inference from this local verifier's result is allowed. This actual Vercel packaging/runtime verification remains unperformed in the offline correction.

Only then, under the separate execution window, continue **the same reserved ID** using `vercel deploy continue --id ACTUAL_RESERVED_ID` through the supported pinned CLI path. Recompute the sealed output immediately before upload. Capture continuation and authenticated final deployment readbacks proving no successor identity, correct source/build/project/team/target/generated origin and intended protection. Do not run ordinary `vercel deploy` as a substitute.

## Hosted acceptance after separate authorization

Verify actual runtime identity equals the independently approved record, and reject mismatch before repository/provider access. Check fail-closed unauthenticated protected routes and cache headers before authorized login. Then perform the bounded owner login, one automatic balance refresh after session verification, retained manual refresh and logout checks, including expiry/revocation and desktop/mobile UAT. Auth/session/throttle writes and read-only provider calls require explicit coverage in the effect packet. Record exact wallet/network/token/decimals and observation time without exposing credentials.

Financial routes stay disabled. Mock receipts and UI screenshots are non-economic evidence. Original 003 remains OUTCOME_UNVERIFIED / NO_RETRY: no attempt, reassessment, preflight, reset, authorization or execution. A failed or missing live proof means UAT remains unaccepted; do not repair by weakening identity checks.

Sources inspected: installed Vercel CLI 59.26.0 `dist/commands/deploy/index.js` (`handleInitDeployment`, `getDeploymentOutputJson`, `handleContinueDeployment`) and `dist/chunks/chunk-42C7M2DD.js` (`postContinue` files-only payload). Upstream reference: https://github.com/vercel/vercel/blob/main/packages/client/src/continue.ts .

## Authenticated operator VIEW source (separate privacy permission)

The public source set and financial `isCurrentSourceEligible` stay withdrawn/false. Operator VIEW admission never revives authorization, payment, original003 or financial HTTP lanes. Actual source disclosure/provisioning requires separate owner privacy permission; no historical file/screenshot/test fixture becomes genuine input.

A separately approved canonical JSON packet at fixed `.tameion/operator-source.json` contains `purpose:"OPERATOR_VIEW_ONLY"`, `organization_id:"ORG-DEMO-001"`, exactly five strict canonical commercial records and `state_binding:{namespace,revision,authority_sha256}`. The binding identifies an independently existing compatible namespace, exact read-only RPC revision and SHA256 of the existing authority snapshot serialized by the repository's JSON canonicalizer. Owner approval covers exact source/state association; it is not an aggregate migration/seed permission. Canonical byte serialization is `JSON.stringify` with no surrounding whitespace; duplicate/unknown keys, invalid UTF8, oversized/nonfile/symlink input, duplicate IDs or wrong count reject. Each record uses the established LiveUsageObligationRecord fields; only evidence_id/content_sha256 are permitted in source_evidence. Raw documents, routes, account credentials and arbitrary extra fields are excluded.

Independently approved expected bytes SHA must be configured privately as `TAMEION_OPERATOR_SOURCE_SHA256`; the artifact cannot approve itself. `TAMEION_STATE_NAMESPACE` must name the same independently existing namespace. Missing both private input and approval keeps the public empty withdrawal. Any present invalid/unapproved artifact or missing approved input fails closed. Authentication/exact deployment policy precedes source reading, and session/source is revalidated across the state await. Anonymous responses do not reveal file existence or IDs.

Restoration uses only tameion_state_load_existing, checks namespace/revision/canonical authority hash and existing aggregate source_amount/source_currency, and refuses missing or inconsistent aggregates with STATE_UNAVAILABLE. It never hydrates/seeds/CAS-rewrites state or creates a DemoState/provider/signer/worker. List/detail use the same admitted records; a private VIEW alone cannot expose a prime-approval packet or grant financial eligibility.

Local packaging shape after independent byte approval: `node scripts/package-operator-source.mjs --approved-source OWNER_APPROVED_CANONICAL_FILE --sha256 OWNER_APPROVED_SOURCE_SHA256`. It reuses the production parser, creates only the fixed ignored server artifact exclusively and never uploads/overwrites. For a clean hosted build, separately configured secret `TAMEION_OPERATOR_SOURCE_DOCUMENT` bytes are materialized at that same fixed path only when the independent `TAMEION_OPERATOR_SOURCE_SHA256` matches the production parser; incomplete, malformed, mismatched or pre-existing input rejects the build. `node scripts/verify-operator-source.mjs` with those same arguments proves real local Next server traces and static/public/served-output exclusion. Neither helper certifies actual Vercel packaging, privacy approval or hosted readiness. Inspect actual Vercel functions and anonymous output separately before any approved upload/UAT. Genuine source bytes are not committed or provisioned by the offline admission.

## Wallet completeness contract remains independently required

The official Circle balance endpoint documents pageAfter/pageBefore/pageSize (default10,max50), while the inspected installed response schema exposes amount/token/updateDate without an explicit next cursor or terminal marker. Do not infer token.id as the collection cursor, certify a first-page match, or treat generic ARC native18/ERC206 facts as Circle-specific native6 proof. The bounded owner discovery packet is external evidence, not an admitted live provider call. Actual positive complete-set balance acceptance requires primary/adjudicated cursor/terminal/representation proof and the separately approved bounded GET capability; a synthetic fixture cannot supply that proof.

### Controlled testnet financial candidate (offline engineering only)

The financial HTTP adapters require the existing approved deployment/origin/session/CSRF policy before loading state or constructing provider capabilities. An authenticated viewer has no financial actor authority. Independently approve canonical server-only `.tameion/financial-requester.json` bytes and configure `TAMEION_FINANCIAL_REQUESTER_SHA256`; the strict `FINANCIAL_REQUESTER_ACTOR_BINDING` record binds approval ID, organization, exact deployment, namespace, operator key and credential version, registry actor ID, independent source SHA, intent ID and half-open UTC execution window. Existing registry actor permission/status/expiry remain authoritative. No body-supplied actor identity is accepted.

Independently approve canonical `.tameion/financial-source.json` bytes and configure `TAMEION_FINANCIAL_SOURCE_SHA256`. `TESTNET_FINANCIAL_SOURCE` binds exactly one fresh `TESTNET-CONTROLLED-*` record, approval/intent/organization/deployment/namespace and a UTC millisecond window of at most one hour. The admitted source has `amount: "1.00"`, `currency: "USD"`, `principal: "1.000000"`, `estimated_fee_ceiling: "0.002000"`, `estimated_total_ceiling: "1.002000"`, classification `TESTNET_ONLY_NON_ECONOMIC_NOT_VENDOR_PAYMENT`, hashed source evidence, null invoice/due/effective dates, and `business_purpose_confirmed: false`. Its approved controlled purpose and timestamp window are represented as `CONTROLLED_OWNER_INSTRUCTION` facts; they never become fabricated business/invoice facts. Model advice still passes canonical normalization and persisted assessment reservation. Prompt v5 identifies this distinction. UTC timestamp precision is exactly milliseconds; higher precision input is rejected rather than rounded.

Both authority inputs are fixed-path, immutable expected-hash inputs with canonical JSON, strict unknown-key rejection, bounded64KiB regular-file/no-symlink reads. They cannot self-approve. Provision only reviewed bytes, exclusively, after separate setup/config permission; do not derive authority from runtime identity or copy a VIEW approval. Expected hashes and actual deployment/namespace must independently match. The existing packaging/build sequence must include both files in protected server traces and exclude their bytes/approval IDs from static/public/served content. A local Next trace is not actual Vercel runtime evidence.

Financial restoration uses the explicit `TAMEION_STATE_NAMESPACE`, existing schema2 state and existing actor/key registries through `tameion_state_load_existing` plus canonical CAS. It never seeds, bootstraps actors or migrates keys. Missing/uninitialized state is unavailable. The loader enforces existing source amount/currency compatibility. The state RPC has a5second deadline, no redirects/retries and a2MiB response bound. Fresh source/intent setup still requires independently reviewed exact snapshot/setup bytes and effect permission. An alternate namespace must never evade original003/shared-wallet committed or unknown state. Public source withdrawal and private VIEW independence remain intact.

The admitted action sequence is authenticated assessment → selected preflight → fresh assessment for the proxy's new aggregate version → human approval with exact reviewed assessment ID/hash/version and reason → review exact returned packet → separately approve that exact packet hash → execute once. Execution revalidates session, source/admission and current registry actor at the provider-send boundary, in addition to all canonical worker/signature/SafetyKernel/currentness checks. `POST /api/obligations/[id]/reconcile` accepts only the exact stored idempotency identity and PAE instruction hash; it never submits. GET remains a projection. Unknown persistence/provider outcomes return `OUTCOME_UNVERIFIED`/`RECONCILIATION_ONLY`, never a claimed retryable refusal.

The controlled ceilings are planning limits, not a guarantee of the final network fee. Circle's actual complete balance pagination contract and native/token representation remain unverified; do not admit live preflight, verified balance or transfer until the bounded primary-contract/provider evidence is adjudicated. Synthetic finite fake responses do not establish account completeness or native precision. Existing original003 remains `OUTCOME_UNVERIFIED / NO_RETRY`.

Retained Preview deployment permission does not waive SQL/config/source/actor provisioning, actual reservation identity/approval, alias protection, login/requester verification, provider call limits or final exact payment approval. Reuse gate5a-demo-readiness-56's existing environment opaquely through the platform; do not extract or duplicate payment/signing keys. Hosted execution, transaction hash and durable reconciliation receipt remain NOT_RUN until their separate actual effect boundary.

Current production binding explicitly refuses preflight, execute and provider reconciliation with `PROVIDER_BALANCE_NOT_VERIFIED` before state/provider construction. It has no hosted flag that can bypass this boundary. The in-process factory accepts trusted capabilities for network-denied synthetic verification only. Proved Circle completeness/precision and a concrete correction are required before the production capability can be admitted; this candidate does not complete the live-flow or wallet objective.
