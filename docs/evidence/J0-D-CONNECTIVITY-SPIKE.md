# J0-D — Arc/Circle Connectivity Spike: Live Evidence

**Status:** IN_PROGRESS — `EXTERNAL_CIRCLE_FAUCET_PERMISSION_BLOCKER`
**Not COMPLETE.** No transaction has been submitted. This document records the real state
honestly; it does not mark J0-D resolved.

## Exact head at time of this record

`69b904480afc93fb1ae61a1ae322958d5ac89985` (branch `prototype/claude-autonomy`, PR #10)

## What actually happened

1. A real invocation of `runConnectivitySpike()` (pre-hardening code, commit `69b9044`) against
   the live Circle Developer-Controlled Wallets API created:
   - Wallet set `tameion-j0d-spike-2026-09-28T07:54:40.100Z` (id `2b72f116-16da-591a-9212-5382388a35c4`)
   - Two `ARC-TESTNET` EOA wallets, both `LIVE`:
     - Source: id `9fe9c001-a044-5f9a-8997-165474887952`, address `0x8a5ec63c8bc7a4d4b4f0134e034bda4c24043e95`
     - Destination: id `01769e53-cfbe-57aa-ba88-c787b8cba2d3`, address `0x591a1002127b1605d9dbb51348787bbe3014b2b9`
2. The subsequent `requestTestnetTokens` (Circle faucet, `/v1/faucet/drips`) call failed with
   `HTTP 403`, stage `FAUCET_REQUEST`. No transfer was ever attempted.
3. This context was independently recovered (read-only) via `client.listWalletSets()` and
   `client.listWallets({ walletSetId, blockchain: "ARC-TESTNET" })` against the live API —
   confirmed both wallets exist, are `LIVE`, and hold zero token balance.
4. **Hypothesis tested and disproven:** that the `native: true` request flag itself was causing
   the 403. Re-tested the funding call with `usdc: true, native: false` against the recovered
   source wallet address. Result: identical `403`, with SDK-extracted provider body
   `{"code":3,"message":"Forbidden"}`. This shows the 403 is not caused by that request flag; it
   does **not** imply native Arc USDC funding is unnecessary for gas.

## Root cause classification

`EXTERNAL_CIRCLE_FAUCET_PERMISSION_BLOCKER` — the authenticated `/v1/faucet/drips` endpoint is
returning a generic, parameter-independent `Forbidden` for this API key/account against
`ARC-TESTNET`. Most consistent with an account/API-key scope gap (faucet access not enabled for
this key, or ARC-TESTNET faucet support not enabled for this account tier) rather than a code
defect in this repository. Not fixable by changing `runConnectivitySpike`'s request parameters.

## Read-only recovered-wallet preflight

Directive #22 adds a separate read-only preflight at `POST /api/j0d/preflight`. It accepts the
previously recovered wallet context and uses only non-submitting Circle provider operations:
`getWallet`, `getWalletTokenBalance`, and `estimateTransferFee`. It cannot create wallets, request
faucet funds, sign, or submit a transaction, and it has no import path into the product
PAE/ExecutionWorker pipeline.

The route requires the explicit literal `READ_J0D_PREFLIGHT_ONLY` and returns one of:

- `READY_FOR_EXPLICIT_AUTHORIZATION` — both wallets still match the recovered Arc Testnet
  context and are `LIVE`; exactly one **native `ARC-TESTNET` USDC** balance is pinned from Circle
  metadata; and the source balance covers both the 0.01 USDC transfer and Circle's current
  `MEDIUM` estimated network fee. The response includes that token identity, fee estimate, and the
  exact contemplated intent. This is **not authorization** and cannot auto-submit it.
- `FUNDING_REQUIRED` — provider wallet/token truth is valid but the source wallet does not cover
  the transfer plus estimated network fee; the response identifies the funding address. It does
  not call the faucet.
- `BLOCKED_EXTERNAL` — credentials/provider truth/context validation failed; no transfer is
  attempted and no provider result is fabricated.

Local WSL currently has no Circle credentials, so the live recovered-wallet balance must be checked
from a credentialed deployment/runtime after this change is deployed. J0-D remains
`IN_PROGRESS` until a separately authorized testnet transfer reaches a truthful terminal state.

Recorded on #26 (not re-run by this change): the deployed read-only preflight reported
`FUNDING_REQUIRED` because the recovered source wallet balance is 0.

## Intent-bound execution (#26)

Invariant: **NO APPROVED PREFLIGHT INTENT, NO J0-D TRANSFER.**

- `src/j0d-spike/intent.ts` is the single exact-intent contract. The preflight's
  `READY_FOR_EXPLICIT_AUTHORIZATION` result carries `exact_intent` (intent version, classification,
  `ARC-TESTNET`, native USDC provider token id/decimals/native flag, amount `0.01`, fee level
  `MEDIUM`, estimated network fee, minimum required total, wallet set, source/destination wallet
  id/address, `preflight_captured_at`) and `intent_fingerprint` = SHA-256 over its RFC 8785
  canonical JSON. The fingerprint is an integrity binding, not authorization.
- `POST /api/j0d/run-connectivity-spike` is resume-only. Its strict body requires the
  confirmation literal, `resumeFrom`, the exact `approvedIntent`, and the matching
  `intentFingerprint`. A bare confirmation, a missing field, an extra field, a fingerprint mismatch,
  or a resume context that disagrees with the intent is refused before any provider call.
- Wallet-set/wallet creation and the faucet were removed from `runConnectivitySpike`, and its
  Circle capability (`createCircleArcSpikeExecutionClient`) does not expose them. A resumed
  transfer with insufficient native USDC stops with `FUNDING_REQUIRED`; no faucet call is possible.
- Immediately before submission the spike re-runs the same read-only preflight against current
  provider truth and stops (`PROVIDER_TRUTH_BLOCKED`, `FUNDING_REQUIRED`, `STALE_INTENT`, or
  `FEE_ESTIMATE_CHANGED`) unless every material intent field is identical. A different current
  `MEDIUM` fee estimate — in either direction — requires a fresh preflight and fresh Prime
  authorization; no tolerance band exists.
- Immediately before submission it queries Circle for prior outbound existence with
  `walletIds: [sourceWalletId]`, `blockchain: ARC-TESTNET`, `txType: OUTBOUND`, `pageSize: 1`,
  and `order: DESC`. Zero rows means only that no outbound is visible in Circle's current provider
  truth at query time. Exactly one valid outbound blocks with
  `PRIOR_OUTBOUND_TRANSACTION_EXISTS`. A malformed response, missing id, wrong or missing
  direction, more than one row, or provider error fails closed. This existence query is not a
  durable ledger or lock and does not guarantee production exactly-once execution.
- Only then does it call `createTransaction` once, with exactly the approved source wallet,
  provider token id, `["0.01"]`, destination address, and `MEDIUM`, using a Circle idempotency key
  derived deterministically from the stable execution identity. A thrown or malformed submission response
  is `SUBMISSION_OUTCOME_UNKNOWN` and is never retried. Errors carry only application-owned text.

### Residual at-most-once risk (not resolved)

There is no durable cross-serverless J0-D ledger or lock. Concurrent invocations can both pass the
prior-outbound existence check before Circle's provider truth exposes either transaction. The
stable execution identity and its idempotency key improve same-transfer replay consistency while
excluding volatile fee, minimum-total, and preflight-timestamp fields; Circle's provider-side
idempotency semantics have not been live-verified. This spike is intended for one deliberately
invoked J0-D testnet connectivity run, not as a production exactly-once guarantee. Invoke once,
only after a fresh `READY_FOR_EXPLICIT_AUTHORIZATION` preflight and Prime's explicit approval of
that exact intent.

## Continuation path (not yet executed)

1. Fund the recovered source wallet address (`0x8a5e...3e95`) with native Arc Testnet USDC through
   the public faucet (`faucet.circle.com`). The code never requests faucet funds.
2. Run the read-only preflight (`POST /api/j0d/preflight`) until it returns
   `READY_FOR_EXPLICIT_AUTHORIZATION`, and present its `exact_intent` + `intent_fingerprint`
   to Prime as the authorization evidence. The separate `execution_identity` and
   `idempotency_key` bind the immutable transfer identity for provider replay handling.
3. Only after an independent review of this code and Prime's explicit approval of that exact intent:
   `POST /api/j0d/run-connectivity-spike` once with the confirmation literal, `resumeFrom`,
   `approvedIntent`, and `intentFingerprint`. Any provider-truth change stops before submission.
4. Poll to terminal state; on `UNKNOWN`, do not resubmit — reconcile from provider truth.
5. Update this document with the final `provider_transaction_id` / `provider_tx_hash` / `status`.

## Earlier resumability hardening (superseded by #26)

The first recovery pass added `resumeFrom`, wallet-context stage evidence before the faucet call,
and a balance check before the faucet. #26 replaces that flow: fresh wallet creation and all faucet
calls are gone from the spike, and stage evidence is now emitted as `PRE_SUBMISSION_VERIFIED`
immediately before submission with the intent fingerprint, stable execution identity, and
idempotency key recorded separately.

## Replay guard and residual concurrency

Immediately before submission, the spike makes one provider-filtered Circle `OUTBOUND`
existence query: `walletIds: [sourceWalletId]`, `blockchain: ARC-TESTNET`, `txType: OUTBOUND`,
`pageSize: 1`, `order: DESC`. Zero rows means no outbound is visible in current Circle provider
truth at that time; exactly one valid outbound blocks. Malformed or ambiguous responses, missing
ids, wrong or missing directions, more than one row, and provider errors fail closed.

The stable execution identity hashes the immutable classification, network, native USDC token
identity/scale, exact amount, MEDIUM fee level, wallet set, and source/destination identifiers
and addresses. It excludes volatile fee estimate, minimum total, and preflight timestamp fields.
The full `intent_fingerprint` binds the exact Prime authorization evidence and includes those
freshness fields; any fee change stops execution pending fresh preflight and authorization. The
Circle idempotency key derives from the separate stable execution identity. This can improve
same-transfer replay consistency, but does not remove the race or establish provider idempotency
semantics, which have not been live-verified.

## What has NOT happened

- No transfer has been submitted at any point.
- No `provider_transaction_id` or `provider_tx_hash` exists.
- No new wallet set or wallets have been created beyond the single one above.
- No J2 product execution has occurred or been attempted.
