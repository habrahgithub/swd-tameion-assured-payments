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

## Safe continuation path (not yet executed)

Circle's public web faucet (`faucet.circle.com`) supports Arc Testnet USDC, is permissionless,
and provides 20 testnet USDC per address every two hours. Continuation plan once manually funded:

1. Fund the existing recovered source wallet address (`0x8a5e...3e95`) via the public faucet.
2. Re-invoke `runConnectivitySpike({ resumeFrom: { walletSetId, sourceWallet, destinationWallet } })`
   (hardening added in this same change — see "Resumability hardening" below) so no new
   disposable wallet set is created.
3. The balance-check-first ordering (also added in this hardening pass) will detect the existing
   funded balance and skip the faucet call entirely, proceeding straight to the one authorized
   0.01 USDC transfer.
4. Poll to terminal state; on `UNKNOWN`, do not resubmit.
5. Update this document with the final `provider_transaction_id` / `provider_tx_hash` / `status`.

## Resumability hardening (this change)

`runConnectivitySpike` previously had no way to resume after a post-wallet-creation failure other
than manually querying Circle's API out-of-band (as done in step 3 above) and had no mechanism to
avoid re-hitting the faucet if a wallet was already funded. This change adds:

- `options.resumeFrom` — skip wallet-set/wallet creation entirely when a prior context is supplied.
- `options.onStageEvidence` — invoked with the wallet-set/wallet IDs as soon as they're known
  (fresh or resumed), before the faucet call, so a mid-run failure still leaves durable evidence
  (logged via Vercel function logs from the API route) instead of requiring a manual
  `listWalletSets()`/`listWallets()` recovery.
- Balance is now checked *before* the faucet call; if the source wallet already holds USDC
  (e.g. a resumed, already-funded context), the faucet is skipped entirely.

See `tests/j0d-spike.test.ts` for the corresponding fake-client orchestration tests (resume skips
creation calls; already-funded wallet skips the faucet call; `onStageEvidence` fires with the
wallet context before a simulated faucet failure).

## What has NOT happened

- No transfer has been submitted at any point.
- No `provider_transaction_id` or `provider_tx_hash` exists.
- No new wallet set or wallets have been created beyond the single one above.
- No J2 product execution has occurred or been attempted.
