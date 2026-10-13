# Hosted UAT deployment approval transport — Job 65

This runbook prepares a separately approved **Preview** deployment of the exact accepted candidate. Offline tests and local Next traces do not establish a deployed runtime. No production promotion, SQL, credential provisioning, payment execution, or retry of original 003 is admitted by this document.

## Why approval is packaged

The ingress policy requires an independently approved exact deployment ID. A deployment environment snapshot is fixed at creation; the inspected Vercel 59.26.0 continuation sends files, not replacement environment variables. Package the owner-approved nonsecret record as private server build input after reserving the actual deployment. Never copy runtime facts into a generated approval, override `VERCEL_DEPLOYMENT_ID`, or substitute a custom Skew Protection ID.

The production parser remains the authority for the strict record schema. The fixed server path is `.tameion/deployment-approval.json`, at most 16 KiB. Missing package permits an explicitly configured valid `TAMEION_INGRESS_RECORD` for legacy environments. A present malformed/unreadable/oversize package, invalid environment record, or conflicting sources fails closed. Identical records are permitted. Runtime project, deployment, environment, direct-edge mode, allowed origins, and throttle-key checks remain mandatory. No repository or provider is constructed before ingress succeeds.

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

Verify actual runtime identity equals the independently approved record, and reject mismatch before repository/provider access. Check fail-closed unauthenticated protected routes and cache headers before authorized login. Then perform the bounded owner login, manual balance refresh and logout checks, including expiry/revocation and desktop/mobile UAT. Auth/session/throttle writes and read-only provider calls require explicit coverage in the effect packet. Record exact wallet/network/token/decimals and observation time without exposing credentials.

Financial routes stay disabled. Mock receipts and UI screenshots are non-economic evidence. Original 003 remains OUTCOME_UNVERIFIED / NO_RETRY: no attempt, reassessment, preflight, reset, authorization or execution. A failed or missing live proof means UAT remains unaccepted; do not repair by weakening identity checks.

Sources inspected: installed Vercel CLI 59.26.0 `dist/commands/deploy/index.js` (`handleInitDeployment`, `getDeploymentOutputJson`, `handleContinueDeployment`) and `dist/chunks/chunk-42C7M2DD.js` (`postContinue` files-only payload). Upstream reference: https://github.com/vercel/vercel/blob/main/packages/client/src/continue.ts .
