# Tameion Finance Agent Platform — Full SWD Blueprint

**Status:** DESIGN_FROZEN_ORGANIZER_ALIGNED_PRE_EVENT_DESIGN_ONLY
**Schema Version:** 1.4.22
**Current Authority Precedence:** v1.4.22 active sections govern. Earlier revision notes are historical lineage only and cannot override the current five-job schedule, 11+3 delivery window, pre-event boundary, CLI/CI scope, execution timing, or admission state.
**Snapshot Date:** 2026-09-24
**Purpose:** Machine-readable design constitution plus a deliberately minimal hackathon execution contract. The full architecture remains future guidance; the event build is one assured-payment vertical slice.
**Canonical Parent Issue:** 74
**Linked Contract Issues:** 75, 76, 78, 79, 80, 81, 82
**Canonical Workspace Path:** control-plane/specs/tameion
**Workspace Layer:** control-plane

> No registration passphrase, provider credential, signing material, private key, seed phrase, API secret or service-role secret may appear in this file.

## Source Of Truth

- **Repository:** habrahgithub/swd-workspace
- **Workspace Layer Rule:** Tameion design/governance specifications live in control-plane/specs/tameion. Product runtime code does not live here; it belongs in product-plane or the dedicated public product repository once created.
- **Divergence Authority:** Material disagreement between a current explicitly approved GitHub contract (#74/#75/#76/#78/#79/#80/#81/#82 as applicable) and the exact-head machine-readable blueprint is a typed HOLD_SOURCE_AUTHORITY_AMBIGUITY. No implementation job may be admitted and no lower-priority record may be used to choose a winner until AXIS reconciles the records. For implementation details not stated in the GitHub contracts, the exact-head machine-readable blueprint supplies the machine-readable specification.
- **Admission Conflict Rule:** NO_JOB_ADMISSION_WHILE_CANONICAL_CONTRACT_AND_EXACT_HEAD_BLUEPRINT_MATERIALLY_DIVERGE

### Issues

#### 74

- **Role:** master product/scope/security contract

#### 75

- **Role:** data integrity, persistence, backup/recovery and numeric-safety contract

#### 76

- **Role:** SWD Method DevOps and delivery contract

#### 78

- **Role:** operational exception, human intervention, cancellation, external settlement and concurrency contract

#### 79

- **Role:** identity, counterparty/beneficiary trust, insider-threat and standards-assurance baseline

#### 80

- **Role:** dependency, toolchain and software-supply-chain baseline

#### 81

- **Role:** golden fixtures, agent evals, deterministic test packs, CI/CD, run manifests and behavior/version-control baseline

#### 82

- **Role:** in-app agent runtime, skill registry, context builder, durable memory and plugin boundary contract

### Authority Order

- current explicitly approved GitHub master/child contracts #74/#75/#76/#78/#79/#80/#81/#82
- exact-head machine-readable blueprint snapshot implementing those approved contracts
- generated Markdown companions
- implementation issues/pull requests and derived/readme/demo summaries
- runtime evidence for what actually occurred; runtime evidence cannot amend design authority

### Workspace Paths

- **Full Blueprint:** control-plane/specs/tameion/tameion-full-blueprint.v1.json
- **Full Blueprint Markdown:** control-plane/specs/tameion/tameion-full-blueprint.v1.md
- **Dependency Baseline:** control-plane/specs/tameion/tameion-dependency-baseline.v1.json
- **Verification Baseline:** control-plane/specs/tameion/tameion-verification-baseline.v1.json
- **Agent Runtime Baseline:** control-plane/specs/tameion/tameion-agent-runtime-baseline.v1.json

### Record Priority

- current explicitly approved GitHub master/child contracts #74/#75/#76/#78/#79/#80/#81/#82
- exact-head machine-readable blueprint snapshot implementing those approved contracts
- generated Markdown companions
- implementation issues/pull requests and derived/readme/demo summaries
- runtime evidence for what actually occurred; runtime evidence cannot amend design authority

## Hackathon

- **Name:** Tameion Agents Hackathon
- **Format:** online
- **Event Start:** 2026-09-27
- **Event End:** 2026-10-10
- **Submission Deadline:** 2026-10-10T23:59:00-04:00
- **Program Theme:** AI agents managing genuine business-money workflows on Arc/USDC with inspectable decisions and payment activity.
- **Judging:** 30% Agentic Sophistication / 30% Traction / 20% Circle Tool Usage / 20% Innovation.
- **Submission:** public GitHub, recorded demo under 3 minutes, deployed link encouraged, truthful traction/usage evidence.
- **RFB Rule:** organizer RFBs are starting points, not mandatory tracks.

### Organizer Expectation Alignment

- **Agentic Sophistication:** Finance Agent must visibly perform evidence-grounded PAY/HOLD/ESCALATE reasoning; it must not look like a fixed classifier or cron job with an LLM label.
- **Traction:** genuine event-period usage matters. Own-business workflow may count, but fixture authenticity alone is not traction.
- **Circle Tool Usage:** one authentic PAE-gated Arc Testnet USDC product payment must be inspectable from intent through status and reconciliation.
- **Innovation:** transaction-specific PAE + deterministic Safety Kernel must be demonstrated through a visible changed-destination BLOCK, not explained only as architecture.
- **Bounded Autonomy:** the agent autonomously analyzes/proposes; human T1 approval grants transaction-specific economic authority; deterministic controls remain non-negotiable.

### Pre-Event Preparation Boundary

**Status: PRE_EVENT_DESIGN_ONLY**

Allowed before 2026-09-27:
- architecture/design records;
- organizer/rule research;
- issue/job/test planning;
- account/credential and developer-environment readiness;
- redaction planning and identification of candidate genuine obligations.

Not allowed before 2026-09-27:
- Tameion-specific runtime/product implementation;
- hackathon-counted product-code commits;
- hackathon-counted agent usage/traction;
- hackathon-counted Arc product execution.

At/after event start, bind **EVENT_START_BASELINE** before Tameion-specific implementation. The submission delta is:

`EVENT_START_BASELINE -> event code -> agent runs -> genuine obligations assessed -> PAE-gated Arc payment -> reconciliation -> feedback/traction -> FINAL_SUBMISSION_SHA`

Generic pre-existing tools/libraries/developer environment may be reused if declared as pre-existing. Tameion-specific behavior must be implemented during the event.

### Real-Business / Event-Period Proof

- Assess **3–5 genuine redacted event-period obligations** for meaningful agentic and traction evidence.
- Exactly **one** selected obligation may enter the end-to-end payment execution proof.
- Multiple assessment obligations do **not** create batch-payment scope.
- Testnet settlement must be described truthfully and must not be represented as legal discharge of a real-world payable.

## Delivery Window Decision — v1.4.22

**Decision:** 11 build days + 3 hardening/submission days.

- **Build Window:** Days 1–11 / 2026-09-27..2026-10-07
- **Hardening Window:** Days 12–14 / 2026-10-08..2026-10-10
- **Day 11:** completion contingency for already-admitted P0 essentials only; no new feature family, integration surface, framework or scope expansion.
- **Early Targets Remain:** mocked end-to-end by Day 6; authentic PAE-gated Arc product execution by Day 7; functionally complete vertical slice by Day 10 where possible.
- **Feature Freeze:** end of Day 11 / 2026-10-07.
- **Early Hardening Rule:** if the vertical slice is stable before Day 11, begin hardening early rather than consuming the contingency day with optional features.
- **Days 12–14:** adversarial testing, reliability, UX/error polish, traction/evidence, README/demo and submission only.

This is a schedule-only design correction. Product scope, authority model, five-job count and PRE_EVENT_DESIGN_ONLY state do not change.

## Codex v1.4.21 Correction — v1.4.22

**Source:** Codex gpt-5.6-sol high-reasoning read-only review of exact v1.4.21 head 3b222349b8529ff35d74148a74fa487ded80924f.
**Verdict:** CORRECTION_REQUIRED — 0 P0 / 4 P1.
**Scope:** design/governance consistency only; no runtime/product implementation.

Corrections:
- J0 freezes the genuine assessment set and candidate-readiness evidence only; J1 selects the sole execution candidate after PAY/HOLD/ESCALATE assessment.
- J1 binds the exact NVIDIA Build/Nemotron request configuration and fail-closed provider capability smoke.
- J2 owns minimum exact provider status verification and one-to-one reconciliation required to prove its authentic Arc transaction; J3 only presents that financial truth.
- Active authority/version labels are normalized to v1.4.22; earlier versions remain historical lineage only.

**Next Gate:** exact-head read-only Codex review of v1.4.22.

## P0 Model Provider Decision — v1.4.22

**Decision:** pin NVIDIA Build + nvidia/nemotron-3-super-120b-a12b for the event Finance Agent.

- **Provider:** NVIDIA Build
- **Endpoint:** https://integrate.api.nvidia.com/v1
- **Client:** OpenAI SDK compatible adapter
- **Reasoning:** enabled for obligation assessment
- **Sampling:** temperature=1.0, top_p=0.95
- **Config Version:** p0-nvidia-nemotron3super-v1
- **Max Output Tokens:** 4096
- **Request Timeout:** 30000 ms
- **Transport Attempts:** maximum 2; retry once only for a pre-response transient transport/5xx failure
- **Structured Output:** Zod-validated PAY/HOLD/ESCALATE object; invalid/incomplete output fails closed
- **Tool Mode:** static typed READ/ANALYZE/PROPOSE allowlist only
- **Runtime Config Evidence:** persist SHA-256 of the exact executable request configuration with every AgentRun
- **J1 Capability Gate:** pinned endpoint/model must pass structured-output + allowlisted-skill smoke before J1 acceptance
- **Required Secret:** NVIDIA_API_KEY
- **OpenAI Platform API Key:** not required for P0
- **OpenRouter:** optional contingency only
- **No Silent Fallback:** provider/model may not change within an AgentRun. A contingency run is a new explicitly recorded AgentRun with provider/model/config identity and must satisfy the frozen eval contract.
- **Authority Effect:** none. Finance Agent remains READ / ANALYZE / PROPOSE only. T1 human approval, deterministic Safety Kernel, PAE signing and Execution Worker remain outside model authority.

## Product

- **Working Name:** Tameion Finance Agent Platform
- **Positioning:** Assured Payment Agent — AI decides what should be paid; deterministic authorization controls what can actually move.
- **Tagline:** Machine-speed payments. Accountant-grade assurance.
- **Core Principle:** AI assists. Cryptographically bound deterministic controls protect the money.
- **Implementation Rule:** The event submission is one end-to-end assured-payment execution proof, supported by 3–5 genuine obligation assessments to prove meaningful agentic reasoning and traction. Exactly one obligation enters PAE/payment execution; AP/AR/Treasury breadth remains future architecture.
- **Long Term Positioning:** Agentic Finance Operations — AP, AR and Treasury under an independent Financial Assurance layer.
- **Hackathon Product Name:** Assured Payment Agent

### P0 Deliverable

- one fixed organization
- one authenticated demo operator
- 3–5 genuine redacted event-period payable obligations for Finance Agent assessment/triage evidence
- exactly one execution-candidate obligation represented by one canonical obligation record plus evidence, selected only in J1 after the 3–5 PAY/HOLD/ESCALATE assessments complete
- one canonical execution JSON fixture derived from the selected genuine obligation
- Finance Agent PAY/HOLD/ESCALATE recommendations with structured reasons, evidence IDs and missing-evidence/uncertainty signals
- one T1 human transaction-specific approval of the exact reviewed execution-candidate state
- one deterministic server-side Safety Kernel
- one signed Payment Authorization Envelope binding exact execution authority
- one exact USDC / Arc Testnet product payment during the event
- one-to-one settlement and reconciliation back to the executed obligation
- one visible changed-destination attack BLOCKED with zero unauthorized USDC movement
- automated replay and UNKNOWN/no-blind-retry proof
- one replayable evidence timeline
- one event-period usage/traction ledger

### Modules

#### Payables

- **Depth:** deep

##### Capabilities

- commercial commitments
- payment schedules and mandates
- obligations
- invoice/evidence intake
- advance and partial-advance handling
- milestone handling
- recurring obligations
- payment proposal/run
- allocation
- settlement and reconciliation

#### Receivables

- **Depth:** thin

##### Capabilities

- outstanding receivables
- collection prioritization
- receipt observation
- receipt allocation
- unapplied receipts

#### Treasury

- **Depth:** thin

##### Capabilities

- wallet/cash balance view
- liquidity
- transfers
- fees/charges
- clearing
- short-term forecast
- reconciliation

#### Compliance

- **Depth:** micro-layer

##### Capabilities

- counterparty status
- wallet/destination status
- screening currentness
- transaction policy status
- risk tier

### Explicit Non Goals

- full ERP
- full GL
- tax engine
- enterprise sanctions/compliance platform
- bank integrations
- production ERP-specific integrations
- broad multichain support
- multiple crypto assets merely for breadth
- sophisticated FX accounting
- enterprise IAM/SAML/SCIM
- enterprise DLP/SIEM
- Kubernetes
- large microservice fleet
- full production disaster-recovery platform

### Hackathon Deferred

- AP/AR/Treasury as public hackathon modules
- AR module breadth
- ERP synchronization/export integration
- L5 disaster-recovery implementation beyond a documented state/recovery model
- Treasury module breadth beyond what the payment demo directly needs
- advance and partial-advance payment patterns
- broad dashboards and report suites
- broad ingestion formats and ERP synchronization
- compliance breadth beyond the payment demo directly needs
- comprehensive report suite
- custom custody/HSM/KMS platform work
- general allocation engine beyond one payment to one obligation
- generalized policy language
- manual-entry workflow unless trivial after the fixed fixture is complete
- milestone payment pattern
- multi-tenant product administration
- non-demo error-code implementation
- recurring subscription / EMI / standing mandate
- separate Payment Agent persona/service unless it adds observable independent value

## Ui

- **P0 Rule:** Five screens or fewer; expose the proof, not the internal architecture.

### Roles

- Authenticated Demo Operator

### Command Center

- Obligation & Evidence
- Agent Decision
- Authorization / Safety Proof
- Arc Settlement & Reconciliation
- Evidence Timeline / Blocked Attack

### Long Term Command Center

- Dashboard
- Obligations
- Commitments
- Payment Runs
- Treasury
- Reports
- Audit Trail
- Admin

## Architecture

- **P0 Business Input:** One fixed JSON fixture representing one genuine redacted obligation and its evidence
- **Shared Core Rule:** WEB_UI_AND_CLI_SHARE_ONE_FINANCIAL_CORE_AND_ONE_AUTHORITY_PATH
- **Safety Stage Rule:** For the hackathon T1 path, any pre-approval Safety Kernel preview is non-authoritative. Human transaction-specific approval first atomically advances the exact obligation authority aggregate from reviewed N to authorized N+1; the final sealable Safety Kernel assurance then evaluates that authorized N+1 and must PASS before a PAE may be sealed. PAE cryptographic/currentness verification is a distinct pre-execution worker responsibility after sealing. Final assurance and Execution Worker both repeat currentness/kill checks; only the Execution Worker may submit to Circle/Arc.

### Business Inputs

- CSV
- JSON
- XML
- API
- ERP Sync
- Manual Entry
- Evidence Uploads

### Ingestion Pipeline

- Ingress Buffer
- Source Hash & Provenance
- Schema Validation
- Canonical Staging
- Business Validation

### Finance Core Sequence

- Counterparties & Destinations
- Commercial Commitments
- Payment Schedules / Mandates
- Obligations
- Payment Intents
- Settlements
- Allocation & Reconciliation

### Evidence Store

- invoices
- contracts
- approvals
- receipts
- milestone evidence
- hashes
- report artifacts

### Ai Control Plane

- Finance Agent
- Authority Engine
- Assurance Engine
- Numeric Assurance
- Payment Authorization Envelope
- Watchdog / Kill Switch
- ContextBuilder
- AgentRunner
- SkillRegistry
- AiProvider

### Execution Settlement

- Payment Agent
- Execution Service
- Wallet / Provider Adapter
- Circle / Arc Testnet / USDC
- Settlement Capture
- Allocation & Reconciliation
- ERP / Sync Export

### Data Safety Recovery

- Supabase Postgres
- Storage / Evidence Objects
- Backup & Recovery
- Trust State & Incident Recovery

### Golden Flow

- Commercial Commitment
- Payment Schedule / Terms
- Obligation
- Evidence
- Finance Agent decision
- Human approval / delegated authority as policy requires
- Final deterministic assurance
- Sealed PAE
- Watchdog
- Payment Agent
- Execution Service
- Circle / Arc
- Settlement
- Allocation
- Reconciliation
- ERP / Evidence

### P0 Demo Scenarios

- happy path: genuine obligation -> agent PAY recommendation -> T1 human approval reviewed N to authorized N+1 -> final Safety Kernel PASS on N+1 -> signed PAE -> Arc USDC -> reconciled evidence
- attack path: destination changed after authorization -> independent execution verification BLOCK -> zero unauthorized USDC

### Future Golden Flow

- Commercial Commitment
- Payment Schedule / Terms
- Obligation
- Evidence
- Finance Agent decision
- Human approval / delegated business authority as policy requires
- Final deterministic assurance
- Sealed PAE
- Watchdog
- Payment Agent
- Execution Service
- Circle / Arc
- Settlement
- Allocation
- Reconciliation
- ERP / Evidence

### P0 Golden Flow

- Obligation + Evidence
- Finance Agent structured PAY/HOLD recommendation
- T1 human business action on reviewed authority aggregate
- Atomic APPROVE transition reviewed N -> authorized N+1 when proceeding
- Final deterministic Safety Kernel assurance on authorized N+1
- Signed PAE bound to authorized N+1
- Execution Worker
- Circle / Arc USDC
- Settlement Verification
- One-to-One Reconciliation
- Evidence Timeline

### P0 Execution Settlement

- Execution Worker
- Circle / Arc Testnet / USDC
- Settlement Status Lookup
- One-to-One Reconciliation

### Interfaces

#### Web Ui

- **Role:** Human-facing presentation and operational interface.
- **Authority:** NONE_INDEPENDENT
- **Rule:** All money-moving actions route through the same application core, Safety Kernel, PAE verification and Execution Worker.

#### Headless Cli

- **Role:** Developer harness, CI/smoke interface, automation entry point and demo fallback.
- **Authority:** NONE_INDEPENDENT
- **Rule:** CLI is a thin adapter over the same application core. It cannot bypass approval, Safety Kernel, PAE, idempotency, kill switch, settlement verification or reconciliation.
- **Security Contract:** See cli_contract. CLI is an authenticated client; backend retains all payment/provider/signing secrets.
- **Default Data Path:** CLI -> authenticated backend API -> shared core -> Safety Kernel -> PAE -> Execution Worker -> Circle/Arc -> reconciliation.

### P0 Cli Commands

- tameion doctor
- tameion obligation load <fixture.json>
- tameion assess <obligation_id> --expected-version <n>
- tameion approval approve <obligation_id> --expected-version <n> --reason-code <code> [--reason-file <path>|--reason-stdin]
- tameion approval reject <obligation_id> --expected-version <n> --reason-code <code> [--reason-file <path>|--reason-stdin]
- tameion hold set <obligation_id> --expected-version <n> --reason-code <code> [--reason-file <path>|--reason-stdin]
- tameion hold release <obligation_id> --expected-version <n> --reason-code <code> [--reason-file <path>|--reason-stdin]
- tameion cancel <obligation_id> --expected-version <n> --reason-code <code> [--reason-file <path>|--reason-stdin]
- tameion reassess <obligation_id> --expected-version <n>
- tameion execute <obligation_id> --expected-version <n>
- tameion status <obligation_id>
- tameion reconcile <obligation_id> --expected-version <n>
- tameion evidence <obligation_id> --json
- tameion settlement external-record <obligation_id> --expected-version <n> --evidence <settlement.json>
- tameion simulate destination-change <obligation_id>

### P0 Cli Output Contract

- machine-readable structured status
- stable obligation/payment/PAE/execution/transaction references
- PASS/HOLD/BLOCK result
- finding/error code where applicable
- economic movement result
- no secret material

### P0 Golden Flow With Interfaces

#### Entrypoints

- Web UI
- Headless CLI

#### Shared Path

- Application Core
- Finance Agent structured recommendation
- T1 human approval of reviewed authority aggregate
- Atomic reviewed N -> authorized N+1 transition
- Final deterministic Safety Kernel assurance on authorized N+1
- Signed PAE
- Independent Execution Worker
- Circle / Arc USDC
- Settlement Verification
- One-to-One Reconciliation
- Evidence Timeline

### P0 Pre Seal Safety Kernel Checks

- authenticated operator is bound to the fixed organization
- current financial authority/approval requirements are satisfied
- counterparty is VERIFIED/current and payment eligible
- counterparty trust/version is current, payment eligible and exact
- destination is VERIFIED/ACTIVE/current and exact
- source wallet is the exact current organization-owned ACTIVE/allowed Arc Testnet USDC wallet
- authoritative decimal-to-atomic amount conversion is exact
- asset/network are exact and allowed
- business HOLD/security FREEZE/material-currentness rules allow authorization
- duplicate/external-settlement state does not already prohibit a new authorization
- kill switch allows authorization

### P0 Pre Execution Worker Checks

- PAE schema/canonical bytes/instruction_hash/signature/key-version are valid
- every bound approval actor remains authorized in the same organization and the current authority_version exactly matches the bound authority_version; revoked/changed authority invalidates execution
- approval evidence durable-record hashes independently reproduce and match
- current obligation aggregate_version matches the PAE
- counterparty_id/version re-resolves to the exact current organization-scoped payment-eligible counterparty master; ON_HOLD/BLOCKED/REVIEW_DUE/SUPERSEDED or version mismatch fails closed
- source_wallet_ref/version resolves to the exact current organization-owned ACTIVE/allowed provider wallet for Arc Testnet USDC
- amount/atomic amount and exact destination_ref/version/address match current immutable authority state
- asset/network match the PAE and allowed execution rail
- PAE expiry/nonce/idempotency/replay state is valid
- business/security/external-settlement state has not become execution-prohibiting
- kill switch allows execution
- atomic execution claim/reservation succeeds

### J0 Arc Connectivity Spike Boundary

- **Classification:** INFRASTRUCTURE_CONNECTIVITY_SPIKE_NOT_PRODUCT_EXECUTION
- **Purpose:** During J0 after EVENT_START_BASELINE, prove only that Circle/Arc Testnet credentials, wallet/SDK/direct-provider path, bounded USDC transfer and status lookup work.
- **Allowed:** One deliberately tiny disposable testnet transfer using a dedicated spike script/CLI or direct provider SDK outside the Tameion product execution service.
- **Authority Scope:** NO_VALID_PAE_NO_EXECUTION_REGARDLESS_OF_INTERFACE applies to Tameion product execution interfaces. J0 connectivity spike is a separately labelled event-period infrastructure test and cannot become a Tameion execution authority path.
- **Sunset:** The spike harness is deleted/isolated from product runtime after Arc feasibility is recorded. J2 is the first Tameion product economic execution and requires a valid PAE.
- **Wallet Rule:** Use a dedicated disposable J0 spike wallet/context that is not reachable by Tameion Web/product execution APIs. The J2+ product source wallet is a separately frozen SOURCE-WALLET-AUTHORITY-P0-1 record.
- **Dispatch Profile:** J0_CONNECTIVITY_SPIKE
- **Event Boundary:** No connectivity transfer or Tameion-specific runtime execution occurs before event start. J0 connectivity transaction/evidence is captured only after EVENT_START_BASELINE.

#### Prohibited

- using a real/genuine payable as the spike instruction
- claiming the spike satisfies Assured Payment Agent demo execution
- reusing a raw send shortcut inside product runtime
- persisting spike bypass as a product command/API
- mainnet movement

### Future Volume Flow

- Many obligations / evidence
- Finance Agent + deterministic pre-check per obligation
- READY / HOLD / ESCALATE queues
- immutable Payment Run manifest from READY items
- one human review/consent interaction over exact manifest
- per-item T1 approval CAS and durable approval record
- per-item final Safety Kernel assurance
- per-item signed one-obligation PAE
- bounded parallel Execution Workers
- per-item settlement/reconciliation
- exception isolation + human investigation queue

### P0 Agent Runtime

- Application Durable State / Evidence
- ContextBuilder
- AgentRunner
- AiProvider + SkillRegistry
- Structured PAY/HOLD/ESCALATE recommendation
- Human T1 approval
- Final deterministic Safety Kernel
- Signed PAE
- Execution Worker

## Domain Model

### Core Objects

- Organization
- User
- Membership
- Role
- Counterparty
- Destination
- CommercialCommitment
- PaymentSchedule
- Mandate
- Obligation
- Evidence
- PaymentIntent
- Approval
- AssuranceAssessment
- PaymentAuthorizationEnvelope
- Execution
- Settlement
- Allocation
- Reconciliation
- AgentRun
- AuditEvent
- ReportSchedule
- ReportArchive
- Incident

### Commercial Concepts

- **Commitment:** What the business agreed.
- **Schedule Or Mandate:** When/under what conditions amounts become payable.
- **Obligation:** Exact amount currently due/payable.
- **Settlement:** Money movement.

### Supported Payment Patterns P0

- standard one-time payment only

### State Machines

#### Commitment

- DRAFT
- APPROVED
- ACTIVE
- COMPLETED
- CANCELLED

#### Obligation

- CREATED
- EVIDENCE_PENDING
- OPEN
- DUE
- PROPOSED
- AUTHORIZED
- PARTIALLY_SETTLED
- SETTLED
- CANCELLED

#### Recurring Occurrence

- SCHEDULED
- GENERATED
- DUE
- AUTHORIZED
- SETTLED

#### Payment

- PROPOSED
- ASSURANCE_PENDING
- HOLD
- BLOCK
- PASS
- APPROVAL_PENDING
- AUTHORIZED
- SUBMITTED
- SETTLED
- ALLOCATED
- RECONCILED

### Deferred Payment Patterns

- 100% advance
- partial advance plus balance
- milestone payment
- recurring subscription / EMI / standing mandate

### P0 Model

- **Primary Record:** Obligation
- **Relationship:** one obligation -> at most one demo payment -> one settlement -> one reconciliation
- **Note:** Commitment, schedule/mandate, allocation breadth, reports and incident objects remain design-constitution concepts, not P0 schema requirements.

#### Attachments

- Evidence

#### Execution Records

- AgentDecision
- PaymentAuthorizationEnvelope
- Execution
- Settlement
- Reconciliation
- AuditEvent

### P0 Operational States

#### Obligation

- OPEN
- BUSINESS_HOLD
- APPROVAL_PENDING
- AUTHORIZED
- CANCELLED
- EXTERNAL_SETTLEMENT_PENDING_VERIFICATION
- EXTERNALLY_SETTLED
- EXTERNAL_SETTLEMENT_REJECTED
- EXTERNAL_SETTLEMENT_CONFLICT
- SETTLED
- RECONCILED

#### Payment

- PROPOSED
- APPROVAL_PENDING
- AUTHORIZED
- PAE_ACTIVE
- RESERVED
- SUBMITTING
- SUBMITTED
- CONFIRMING
- UNKNOWN
- FAILED
- SETTLED
- RECONCILED
- CANCELLED
- RECOVERY_REQUIRED

#### Destination Verification Status

- PENDING_VERIFICATION
- VERIFIED

#### Destination Operational Status

- ACTIVE
- ON_HOLD
- BLOCKED
- SUPERSEDED

**Execution Eligibility:** exact current destination version must have `verification_status=VERIFIED` and `operational_status=ACTIVE`.

#### Pae

- UNUSED
- RESERVED
- SUBMITTED
- CONSUMED
- EXPIRED
- REVOKED

## Agents And Authority

- **Interface Authority Rule:** Neither Web UI nor CLI has financial authority. Both only submit commands/requests into the same controlled core.

### Finance Agent

#### Allowed

- read scoped finance state
- validate/propose
- PAY/HOLD/ESCALATE recommendation
- request approval

#### Forbidden

- approve transactions
- change authority policy
- read secrets
- arbitrary shell
- arbitrary SQL
- arbitrary HTTP
- sign wallets
- directly send money

#### P0 Output

- decision: PAY, HOLD or ESCALATE
- structured reasons
- evidence IDs / grounding references
- missing evidence / uncertainty signal
- requested transaction fields when PAY is proposed

### Payment Agent

- **Purpose:** Consume an already-authorized PAE and determine whether that exact instruction remains executable.
- **Hackathon Status:** DEFERRED_AS_SEPARATE_AGENT
- **P0 Replacement:** One deterministic execution worker that accepts only a valid signed PAE.

#### Cannot

- invent amount
- change destination
- change asset/network
- change allocation
- create authority

### Execution Service

- **Purpose:** Only component with actual payment-provider capability.
- **P0 Name:** Execution Worker
- **Cli Rule:** Direct CLI payment commands that bypass a valid signed PAE are prohibited.

#### Requirements

- valid PAE
- exact-intent match
- execution enabled
- trusted execution state
- idempotent execution

### Watchdog

- **Principle:** WATCHDOG_CAN_STOP_MONEY_NEVER_START_MONEY

#### Actions

- CONTINUE
- WARN
- HOLD
- BLOCK
- FREEZE_AGENT
- FREEZE_WALLET
- ESCALATE_HUMAN

## Authority Model

- **P0 Rule:** Hackathon P0 uses one T1 transaction-specific human approval: Finance Agent is maker/recommender; one VERIFIED financially-authorized operator approves the exact reviewed state; deterministic hard safety remains non-overridable.
- **Future Tiers Reference:** T0 autonomous delegated approval and T2/T3/TX remain architecture reference only and are not implemented in the hackathon P0.

### Concepts

- Authentication
- RBAC
- Financial Authorization

### Tiers

#### T0

- **Id:** T0
- **Meaning:** autonomous delegated

#### T1

- **Id:** T1
- **Meaning:** single approval

#### T2

- **Id:** T2
- **Meaning:** dual approval

#### T3

- **Id:** T3
- **Meaning:** exceptional / owner

#### TX

- **Id:** TX
- **Meaning:** prohibited

### Separation Of Duties

- Maker != Approver
- Approver1 != Approver2 where dual approval applies
- Finance Agent != Assurance
- Assurance != Execution
- Payment Agent != Authorization
- Watchdog != Payment Authority
- Admin != Unlimited Financial Authority
- Destination Creator != Sole Sensitive-Destination Approver

### Material Change Invalidates Prior Authority

- amount
- counterparty
- destination
- asset/currency
- network
- obligation set
- allocation
- policy version
- approval state
- evidence/currentness
- destination version
- aggregate version
- external settlement state
- approver authority version/revocation state
- source wallet reference
- source wallet version/status
- counterparty version/trust status

### P0 Implemented Tiers

- T1_SINGLE_APPROVAL

### Manual Override Contract

- **Agent Recommendation:** Authorized human may approve, hold, reject or correct/reassess according to role and state.
- **Safety Control:** No human role may convert a deterministic BLOCK directly into execution.
- **Fresh Authority:** Any material correction requires a fresh assessment/approval/PAE chain.
- **No Force Execute:** There is no FORCE_PAY or BYPASS_SAFETY permission.

### Execution Time Authority Revalidation

- **Rule:** Every approval bound into a PAE is revalidated against current organization authority immediately before provider submission.
- **Fail Closed:** Any authority revocation, suspension, expiry or version change after sealing invalidates the unconsumed PAE for execution and requires fresh review/approval/PAE.
- **Reason:** Authentication at approval time is not sufficient if the human authority changes before irreversible movement.

#### Checks

- actor remains active/verified for the organization
- actor still holds the required financial permission/role
- current authority_version exactly equals the PAE-bound authority_version
- authority is not revoked/suspended/expired

### P0 T1 Approval Transition

- **Input:** Human approval command is consent to reviewed_aggregate_version N of the exact (organization_id, obligation_id) authority root and must include expected_version=N.
- **Atomic Transition:** One database transaction verifies the reviewed state/actor authority, writes the durable APPROVE record, changes approval state, and advances the authority aggregate from N to authorized_aggregate_version N+1.
- **Durable Record:** Approval evidence records organization_id, obligation_id, reviewed_aggregate_version=N and authorized_aggregate_version=N+1.
- **Pae Binding:** PAE contains exactly one obligation ID; approval obligation_id must match it and PAE aggregate_version equals authorized_aggregate_version N+1 for that root, never the pre-approval reviewed version.
- **Later Change:** Any later authority-bearing mutation advances beyond N+1 and makes the unconsumed PAE stale/revoked.
- **Reason:** A correct approval must not invalidate itself merely because the approval transition advances the aggregate version.
- **Assurance Order:** After APPROVE produces authorized aggregate N+1, run the final sealable Safety Kernel against N+1. Only that post-approval PASS may produce DURABLE-ASSURANCE-RECORD-P0-1 for PAE sealing; any earlier preview cannot authorize execution.

## Pae

- **Principle:** NO_VALID_SEALED_ENVELOPE_NO_PAYMENT
- **P0 Obligation Cardinality Rule:** PAE-P0-1 requires obligation_ids to contain exactly one unique canonical obligation identifier. Zero or multiple obligation IDs are invalid. Multi-obligation payment authority is deferred and would require a new schema/versioned authority model.

### Binds

- signing_key_id
- signing_algorithm
- pae_schema_version
- instruction_id
- organization_id
- obligation_ids
- evidence_hashes
- counterparty_id
- counterparty_version
- source_wallet_ref
- source_wallet_version
- destination_ref
- destination_version
- destination_address
- amount
- atomic_amount
- asset
- network
- policy_version
- approval_evidence
- assurance_hash
- aggregate_version
- expiry
- nonce
- idempotency_key

### Forbidden Content

- private key
- seed phrase
- recovery phrase
- raw API secret
- wallet PIN
- bank password
- database credential
- master encryption key

### Security Boundary

- **Canonical Serialization:** Validate/normalize the explicit P0 unsigned payload, canonicalize with RFC 8785 JCS using json-canonicalize 3.0.1, UTF-8 encode with no BOM/trailing newline, SHA-256 hash those exact bytes, then Ed25519-sign the digest. instruction_hash/signature never include themselves.
- **Signer:** A dedicated server-side authorization signer seals only a DURABLE-ASSURANCE-RECORD-P0-1 whose exact required-control set is complete and all required controls are PASS; it does not expose signing capability to either LLM agent.
- **Key Storage:** Signing key/credential is held only in the server-side secret boundary; never in browser, database business rows, logs, agent context, or PAE payload.
- **Verification Point:** Execution Worker independently repeats PAE schema normalization/JCS/UTF-8/SHA-256, requires exactly one P0 obligation, resolves the trusted historical public key by bound signing_key_id + signing_algorithm, verifies signature/hash, organization, sole obligation/current authority aggregate version, re-resolves counterparty_id/version to the exact current organization-scoped payment-eligible counterparty master, verifies exact source_wallet_ref/version ownership/status/network/asset, amount/atomic amount, exact destination reference/version/address, asset, network, expiry, nonce, approval/assurance bindings, idempotency state and kill-switch state; for the T1 approval_evidence record it reproduces the durable approval_record_hash, field-for-field matches duplicated approval fields including obligation_id to the durable record and outer envelope, and requires actor authority_version/status to remain valid; it also reproduces the durable assurance_hash and requires the assurance record to be PASS for the same organization, sole obligation and current aggregate.
- **Atomic Claim:** Hackathon J2 requires one durable atomic claim that moves the exact PAE/execution UNUSED -> RESERVED for one execution_id/idempotency key before provider submission. A generalized outbox/lease worker platform is post-hackathon and is not required for event acceptance.
- **Provider Idempotency:** The internal execution idempotency key is mapped deterministically to the provider request idempotency/reference mechanism; retries query known provider/chain truth before resubmission.
- **Unknown Result Rule:** Provider timeout or unknown execution state never permits blind retry; first query provider/Arc status, then reconcile before any further execution decision.
- **P0 Key Model:** Use the simplest secure server-managed testnet signing/custody model supported by the selected Circle/Arc path. Do not build custom HSM/KMS infrastructure for the hackathon.
- **Reservation Recovery:** Hackathon J2 does not require a lease/reclaim platform. A pre-submit RESERVED state may proceed only with the same execution_id/idempotency key after full revalidation; once SUBMITTING/PROVIDER_SUBMIT_STARTED is recorded, provider/Arc truth must be queried before any retry.
- **Provider Submit Marker:** Persist SUBMITTING/PROVIDER_SUBMIT_STARTED immediately before the provider call; this is the boundary between safe pre-submit lease reclaim and UNKNOWN external-execution recovery.

### Future Optional Context Fields

- commitment_id
- schedule_id
- allocations

### P0 Unsigned Payload Fields

- signing_key_id
- signing_algorithm
- pae_schema_version
- instruction_id
- organization_id
- obligation_ids
- evidence_hashes
- counterparty_id
- counterparty_version
- source_wallet_ref
- source_wallet_version
- destination_ref
- destination_version
- destination_address
- amount
- atomic_amount
- asset
- network
- policy_version
- approval_evidence
- assurance_hash
- aggregate_version
- expiry
- nonce
- idempotency_key

### Derived Fields

- **Instruction Hash:** Lowercase hex SHA-256 of RFC 8785 JCS UTF-8 canonical unsigned payload bytes only.
- **Signature:** Ed25519 signature over the instruction-hash digest using the key identified by signing_key_id.
- **Rule:** Neither instruction_hash nor signature is serialized into the canonical unsigned payload they derive from.

### Canonicalization Contract

- **Schema Version:** PAE-P0-1
- **Library:** json-canonicalize 3.0.1 implementing RFC 8785 JSON Canonicalization Scheme (JCS)
- **Bytes:** canonical_json = JCS(normalized_unsigned_payload); canonical_bytes = UTF-8 bytes of canonical_json with no BOM, no trailing newline and no surrounding transport framing.
- **Hash:** instruction_hash = lowercase hex SHA-256(canonical_bytes).
- **Signature:** signature = Ed25519 signature over the 32-byte SHA-256 digest identified by instruction_hash for P0.
- **Verification:** Verifier repeats schema validation + normalization + JCS + UTF-8 encoding + SHA-256, confirms instruction_hash equality, selects trusted public key by signing_key_id/signing_algorithm, and verifies signature.
- **Golden Vector Rule:** Repository includes a frozen canonical payload -> canonical JSON -> UTF-8 hex/hash -> Ed25519 signature-hex verification vector, including signing_key_id/algorithm and trusted public-key SPKI-DER base64url, used by signer and verifier tests.

#### Normalization Before Jcs

- Construct exactly the P0 unsigned payload schema; reject unknown/missing authority-bearing fields rather than silently dropping them.
- No undefined values. P0 authority fields do not use implicit null/default semantics.
- pae_schema_version, signing_algorithm, signing_key_id, IDs, hashes, asset/network codes and nonce/idempotency identifiers are validated as bounded ASCII strings.
- EVM destination_address is normalized to lowercase 0x-prefixed 40-hex form before binding; execution resolves and compares the exact same normalized form.
- amount is a canonical decimal string with exactly 6 fractional digits for P0 USDC; atomic_amount is the canonical base-10 integer string with no leading zeros except zero.
- expiry is canonical UTC RFC3339 with millisecond precision: YYYY-MM-DDTHH:mm:ss.SSSZ.
- obligation_ids must contain exactly one unique bounded ASCII obligation identifier for PAE-P0-1; zero or multiple values are invalid. evidence_hashes are set-like and sorted lexicographically before JCS.
- approval_evidence conforms exactly to PAE-APPROVAL-EVIDENCE-P0-1; records are sorted lexicographically by approval_id; duplicate approval_id, unknown fields, missing required fields or non-canonical values are rejected. Free-form reason text stays outside the PAE and is represented only through approval_record_hash.
- Object property input order is not authority; JCS determines canonical property order.
- source_wallet_ref is a bounded ASCII internal wallet-authority identifier; source_wallet_version is a canonical non-negative base-10 integer string with no leading zeros except 0.
- counterparty_id is a bounded ASCII internal party identifier; counterparty_version is a canonical non-negative base-10 integer string with no leading zeros except 0.

### Key Versioning Contract

- **P0 Algorithm:** Ed25519
- **Seal Rule:** Signer adds the current trusted signing_algorithm + signing_key_id to the unsigned payload before canonicalization/hash/signature.
- **Verify Rule:** Execution resolves verification material from an allowlisted versioned key registry by signing_key_id + algorithm; it never assumes the current signing key verifies historical PAEs.
- **Rotation Rule:** Key rotation changes the active signing_key_id for new PAEs. Previously issued, non-expired PAEs remain independently verifiable with retained public verification material unless that key/version is explicitly revoked.
- **Compromise Rule:** If a signing key is revoked/compromised, all still-executable PAEs bound to that key fail closed. Historical audit evidence retains the key identifier and verification metadata but does not restore execution authority.
- **Private Key Rule:** Private signing material remains server-side secret state and is never stored in the PAE or business database row.

#### Bound Fields

- signing_algorithm
- signing_key_id

### Approval Evidence Schema

- **Schema Id:** PAE-APPROVAL-EVIDENCE-P0-1
- **Array Semantics:** Exactly one immutable T1 approval authority evidence record for hackathon P0. Future T2+ may extend the array semantics only with a schema-version change.
- **Verification Rule:** Verifier validates exact schema/normalization, requires PAE-P0-1 obligation_ids to contain exactly one unique obligation ID, rejects unknown/missing fields or duplicate approval_id, and loads the authoritative DURABLE-APPROVAL-RECORD-P0-1 by approval_id. Every duplicated field in PAE approval_evidence (organization_id, obligation_id, actor_id, actor_role, authority_version, reviewed_aggregate_version, authorized_aggregate_version, approved_at, policy_version) must exactly match the durable record; durable action must be APPROVE; durable organization_id/evidence organization_id equal outer PAE organization_id; durable/evidence obligation_id equal the sole outer PAE obligation_ids[0]; authorized_aggregate_version equals outer PAE aggregate_version; verifier independently reproduces approval_record_hash and revalidates current actor financial authority/version/revocation state.

#### Record Fields

##### Approval Id

- **Required:** True
- **Type:** string
- **Normalization:** bounded ASCII identifier; exact case preserved

##### Organization Id

- **Required:** True
- **Type:** string
- **Normalization:** bounded ASCII organization identifier; exact case preserved and must equal outer PAE organization_id

##### Obligation Id

- **Required:** True
- **Type:** string
- **Normalization:** bounded ASCII obligation identifier; must equal the sole outer PAE obligation_ids[0]

##### Actor Id

- **Required:** True
- **Type:** string
- **Normalization:** bounded ASCII internal verified-user identifier; exact case preserved

##### Actor Role

- **Required:** True
- **Type:** string
- **Normalization:** bounded ASCII role identifier valid for the organization/policy version

##### Authority Version

- **Required:** True
- **Type:** string
- **Normalization:** canonical non-negative base-10 integer string; no leading zeros except 0

##### Reviewed Aggregate Version

- **Required:** True
- **Type:** string
- **Normalization:** canonical non-negative base-10 integer string for the exact state the human reviewed

##### Authorized Aggregate Version

- **Required:** True
- **Type:** string
- **Normalization:** canonical non-negative base-10 integer string for the resulting post-approval authority aggregate; must equal outer PAE aggregate_version

##### Approved At

- **Required:** True
- **Type:** string
- **Normalization:** UTC RFC3339 millisecond precision YYYY-MM-DDTHH:mm:ss.SSSZ

##### Policy Version

- **Required:** True
- **Type:** string
- **Normalization:** bounded ASCII policy/version identifier

##### Approval Record Hash

- **Required:** True
- **Type:** string
- **Normalization:** lowercase 64-hex SHA-256 of DURABLE-APPROVAL-RECORD-P0-1 canonical JCS UTF-8 bytes

#### Forbidden In Pae Record

- free-form approval reason text
- display names
- locale-formatted timestamps
- unbounded document content

### Durable Approval Record Schema

- **Schema Id:** DURABLE-APPROVAL-RECORD-P0-1
- **Reason Normalization:** Raw reason remains audit evidence. For reason_hash: require Unicode text, normalize to NFC, convert CRLF/CR to LF, reject NUL, enforce 1..512 Unicode scalar values, UTF-8 encode with no BOM/trailing transformation, then SHA-256 and lowercase hex.
- **Canonicalization:** Validate exact schema and reject unknown/missing fields; RFC 8785 JCS canonicalize the canonical payload; UTF-8 encode with no BOM/trailing newline; approval_record_hash = lowercase hex SHA-256 of those exact bytes.
- **Verification:** Verifier loads the authoritative durable approval record, recomputes reason_hash from stored raw reason, rebuilds/validates the exact canonical payload, JCS/UTF-8/SHA-256 recomputes approval_record_hash, field-for-field matches every duplicated PAE approval_evidence field, requires durable/evidence/outer organization_id equality and durable/evidence obligation_id equality to the sole outer PAE obligation_ids[0], requires reviewed_aggregate_version to be the human-observed predecessor for that obligation root and authorized_aggregate_version to equal the PAE/current authorized aggregate before any later change.

#### Canonical Payload Fields

- approval_id
- organization_id
- obligation_id
- actor_id
- actor_role
- action
- authority_version
- reviewed_aggregate_version
- authorized_aggregate_version
- policy_version
- previous_state
- new_state
- approved_at
- reason_hash

#### Field Rules

- **Approval Id:** bounded ASCII identifier; exact case preserved
- **Organization Id:** bounded ASCII organization identifier; exact case preserved
- **Actor Id:** bounded ASCII verified-user identifier; exact case preserved
- **Actor Role:** bounded ASCII role identifier
- **Action:** literal APPROVE for P0 approval evidence
- **Authority Version:** canonical non-negative base-10 integer string; no leading zeros except 0
- **Policy Version:** bounded ASCII version identifier
- **Previous State:** bounded ASCII state enum identifier
- **New State:** bounded ASCII state enum identifier
- **Approved At:** UTC RFC3339 millisecond precision YYYY-MM-DDTHH:mm:ss.SSSZ
- **Reason Hash:** lowercase 64-hex SHA-256 of normalized approval reason bytes
- **Reviewed Aggregate Version:** canonical non-negative base-10 integer string for the exact pre-approval authority aggregate reviewed by the human
- **Authorized Aggregate Version:** canonical non-negative base-10 integer string for the post-approval aggregate produced by the same atomic approval transaction
- **Obligation Id:** bounded ASCII obligation identifier; exact case preserved; identifies the ObligationAuthorityAggregate reviewed by the human

### Durable Assurance Record Schema

- **Schema Id:** DURABLE-ASSURANCE-RECORD-P0-1
- **Canonicalization:** Validate exact schema, normalize/sort control_results, RFC 8785 JCS canonicalize the record, UTF-8 encode with no BOM/trailing newline, then assurance_hash = lowercase hex SHA-256 of those exact bytes.
- **Verification:** Execution Worker loads the authoritative assurance record, requires PAE-P0-1 to contain exactly one unique obligation ID, validates that the exact P0 required-control set is present exactly once, rejects overall PASS if any required control is HOLD/BLOCK/NOT_ASSESSED/missing, rebuilds the canonical record, reproduces assurance_hash, requires result=PASS, organization_id=PAE organization_id, obligation_id=the sole PAE obligation_ids[0], aggregate_version=PAE/current aggregate_version for that obligation root, and policy_version=PAE policy_version, and rejects any mismatch.
- **Overall Result Rule:** For DURABLE-ASSURANCE-RECORD-P0-1, control_results must contain every required_control_ids_p0 exactly once and no duplicate control_id. Overall result may be PASS only when every required control result is PASS. Any required control that is HOLD, BLOCK, NOT_ASSESSED or missing makes overall PASS invalid and the signer must refuse to seal a PAE.

#### Canonical Payload Fields

- assurance_id
- organization_id
- obligation_id
- aggregate_version
- result
- policy_version
- safety_kernel_version
- assessed_at
- control_results

#### Field Rules

- **Assurance Id:** bounded ASCII identifier; exact case preserved
- **Organization Id:** bounded ASCII organization identifier; exact case preserved
- **Aggregate Version:** canonical non-negative base-10 integer string; must equal the PAE aggregate_version
- **Result:** literal PASS for a sealable P0 assurance record
- **Policy Version:** bounded ASCII policy/version identifier; must equal the PAE policy_version
- **Safety Kernel Version:** bounded ASCII immutable implementation/config version identifier
- **Assessed At:** UTC RFC3339 millisecond precision YYYY-MM-DDTHH:mm:ss.SSSZ
- **Control Results:** array of exact CONTROL-RESULT-P0-1 records sorted lexicographically by control_id
- **Obligation Id:** bounded ASCII obligation identifier; must equal the sole outer PAE obligation_ids[0] and identify the assessed ObligationAuthorityAggregate

#### Control Result Schema

- **Schema Id:** CONTROL-RESULT-P0-1
- **Ordering:** sort lexicographically by control_id; duplicates, unknown/missing fields and non-canonical values are invalid

##### Fields

- control_id
- result
- finding_code

##### Rules

- **Control Id:** bounded ASCII deterministic control identifier; unique within record
- **Result:** PASS, HOLD, BLOCK or NOT_ASSESSED
- **Finding Code:** bounded ASCII registered finding/error code or literal NONE

#### Required Control Ids P0

- SK-IDENTITY-ORG
- SK-FINANCIAL-AUTHORITY
- SK-COUNTERPARTY-TRUST
- SK-DESTINATION-TRUST
- SK-SOURCE-WALLET-AUTHORITY
- SK-AMOUNT-ATOMIC-EXACT
- SK-ASSET-NETWORK
- SK-STATE-CURRENTNESS
- SK-DUPLICATE-EXTERNAL-SETTLEMENT
- SK-KILL-SWITCH

### Assurance Binding

- **Field:** assurance_hash
- **Normalization:** lowercase 64-hex SHA-256 of DURABLE-ASSURANCE-RECORD-P0-1 canonical JCS UTF-8 bytes
- **Execution Rule:** Opaque hash equality is insufficient; the Execution Worker must load the durable assurance record, verify exact organization + sole obligation + authority-aggregate identity, verify the exact required-control set and PASS derivation, reproduce the hash and verify policy/currentness bindings.

### Wire Encoding Contract

- **Instruction Hash:** lowercase 64-hex SHA-256
- **Signature:** lowercase 128-hex encoding of the raw 64-byte Ed25519 signature
- **Trusted Public Key:** base64url without padding of the DER SubjectPublicKeyInfo (SPKI) public-key bytes stored in the versioned trusted-key registry
- **Verification:** Decode exact encodings, import SPKI DER as Ed25519 public key, verify signature over the 32-byte instruction-hash digest; reject alternate encodings or algorithm/key-ID mismatch.
- **Golden Vector:** Frozen PAE golden vector includes canonical JSON, UTF-8 bytes/hash, signature hex, signing_key_id, signing_algorithm and public-key SPKI-DER base64url.

## Guardrails

- **Implementation Note:** G0-G12 remains the design constitution. P0 implements only controls activated by the single vertical slice.

### Stack

#### G0 — Tenant / Identity Boundary

- **Id:** G0
- **Name:** Tenant / Identity Boundary

#### G1 — Input + Schema Firewall

- **Id:** G1
- **Name:** Input + Schema Firewall

#### G2 — Commercial / Obligation Controls

- **Id:** G2
- **Name:** Commercial / Obligation Controls

#### G3 — Evidence + Currentness

- **Id:** G3
- **Name:** Evidence + Currentness

#### G4 — Authority / SoD / Limits

- **Id:** G4
- **Name:** Authority / SoD / Limits

#### G5 — Financial Assurance

- **Id:** G5
- **Name:** Financial Assurance

#### G6 — Exact Intent / PAE

- **Id:** G6
- **Name:** Exact Intent / PAE

#### G7 — Runtime Watchdog

- **Id:** G7
- **Name:** Runtime Watchdog

#### G8 — Execution Firewall

- **Id:** G8
- **Name:** Execution Firewall

#### G9 — Settlement Verification

- **Id:** G9
- **Name:** Settlement Verification

#### G10 — Allocation + Reconciliation

- **Id:** G10
- **Name:** Allocation + Reconciliation

#### G11 — Audit + Archive

- **Id:** G11
- **Name:** Audit + Archive

#### G12 — Incident + Recovery

- **Id:** G12
- **Name:** Incident + Recovery

### Allowed Control Results

- PASS
- HOLD
- BLOCK
- NOT_ASSESSED

### Economic Invariants

- sum(authorized_obligations) <= commitment_value + approved_variations
- sum(settlements) <= authorized_obligations
- sum(allocations) <= settlement_amount
- allocation_against_obligation <= obligation_outstanding

### Kill Switch Scopes

- TRANSACTION_DISABLED
- AGENT_DISABLED
- WALLET_DISABLED
- AUTONOMOUS_EXECUTION_DISABLED
- ORGANIZATION_EXECUTION_DISABLED
- GLOBAL_EXECUTION_DISABLED
- DISASTER_MODE

### Trust States

- TRUSTED
- DEGRADED
- CONTAINED
- COMPROMISED
- RECOVERING

### P0 Kernel

- obligation/evidence completeness
- approval rule
- exact numeric/atomic conversion
- exact PAE binding
- idempotent execution claim
- kill switch
- settlement verification
- reconciliation

### Interface Guardrails

- CLI cannot accept a raw destination/amount and directly move money
- CLI and Web UI must produce identical authorization outcomes for the same canonical input
- CLI execution requires the same signed PAE and exact-intent verification as Web UI
- CLI obeys the same kill switch, idempotency claim and unknown-result/no-blind-retry rules
- CLI output must redact secrets and preserve evidence references

### Operational Exception Guardrails

- human may override AI recommendation but never hard deterministic safety
- business hold is separate from security freeze
- material edits invalidate stale approval/PAE
- state-dependent cancel/revoke boundary
- external settlement suppresses new autonomous duplicate payment only before the provider-submit boundary; in-flight/post-submit uses conflict/recovery
- stale concurrent commands are rejected
- webhook/notification is verified and deduplicated before state mutation
- post-submit uncertainty queries external truth before retry

## Error Model

### Levels

#### L1

- **Name:** FIX
- **Meaning:** routine evidence/data deficiency
- **Primary Action:** HOLD
- **Recovery:** correct information and reassess

#### L2

- **Name:** AUTHORIZE
- **Meaning:** valid transaction outside delegated authority/terms
- **Primary Action:** HOLD_OR_ESCALATE
- **Recovery:** exact approval or formal terms/policy change, then reassess

#### L3

- **Name:** REJECT
- **Meaning:** exact transaction violates a hard control
- **Primary Action:** BLOCK
- **Recovery:** terminal for that intent; create a new transaction/authorization chain

#### L4

- **Name:** CONTAIN
- **Meaning:** agent/wallet/execution domain may be compromised
- **Primary Action:** FREEZE_AFFECTED_DOMAIN
- **Recovery:** incident remediation, clean sessions, fresh authorizations, explicit re-enable

#### L5

- **Name:** RECOVER
- **Meaning:** financial/control state itself cannot be trusted
- **Primary Action:** DISASTER_MODE
- **Recovery:** preserve, reconstruct external truth, reconcile, rebuild trust, staged return

### Finding Classes

- CONTROL_FINDING
- BUSINESS_EXCEPTION
- SECURITY_EVENT
- SYSTEM_ERROR

### Severity

- INFO
- WARNING
- HIGH
- CRITICAL

### Disposition

- CONTINUE
- HOLD
- BLOCK
- RETRY
- ESCALATE
- FREEZE

### Domains

- ORG
- IAM
- CTR
- DST
- COM
- SCH
- OBL
- EVD
- AGT
- AUT
- ASR
- PAE
- SEC
- WDG
- EXE
- STL
- ALC
- REC
- FXR
- ERP
- RPT
- SYS
- DRS
- NUM
- OPS

### P0 Codes

- COM-005
- SCH-006
- OBL-003
- EVD-001
- EVD-003
- AUT-003
- AUT-006
- AUT-012
- ASR-004
- ASR-007
- ASR-009
- PAE-002
- PAE-003
- PAE-004
- PAE-005
- PAE-011
- SEC-001
- SEC-003
- SEC-007
- SEC-009
- WDG-001
- WDG-008
- WDG-010
- EXE-004
- EXE-005
- EXE-010
- EXE-012
- STL-003
- STL-004
- ALC-002
- REC-003
- REC-009
- SYS-006
- SYS-010
- DRS-001
- DRS-002
- DRS-003
- DRS-004
- DRS-008
- DRS-010
- NUM-001
- NUM-004
- NUM-005
- NUM-006
- NUM-008
- NUM-010
- NUM-012
- NUM-013
- NUM-014
- NUM-015

### Operational Exception Codes

- **Ops-001:** BUSINESS_HOLD_ACTIVE
- **Ops-002:** STALE_STATE
- **Ops-003:** CANCEL_NOT_ALLOWED_AFTER_IRREVERSIBLE_BOUNDARY
- **Ops-004:** EXTERNAL_SETTLEMENT_PENDING_VERIFICATION
- **Ops-005:** OBLIGATION_ALREADY_EXTERNALLY_SETTLED
- **Ops-006:** MATERIAL_CHANGE_REQUIRES_REASSESSMENT
- **Ops-007:** PAE_REVOKED
- **Ops-008:** PROVIDER_EVENT_UNVERIFIED
- **Exe-013:** RESERVATION_LEASE_RECOVERY_REQUIRED
- **Ops-009:** EXTERNAL_SETTLEMENT_EVIDENCE_INCOMPLETE
- **Ops-010:** EXTERNAL_SETTLEMENT_CONFLICT_IN_FLIGHT
- **Pae-014:** CANONICAL_PAYLOAD_MISMATCH
- **Pae-015:** SIGNING_KEY_VERSION_UNKNOWN_OR_REVOKED

## Data Protection

- **Recovery Rule:** BACKUP != RECOVERY. Restored internal state is not trusted until evidence and Circle/Arc/provider settlement truth reconcile.
- **Schema Authority:** GitHub migrations are canonical for reproducible schema/RLS/constraints.
- **P0 Identity And Scope:** One authenticated demo operator bound to one fixed organization. Do not build broad tenant administration; retain server-side organization binding and least-privilege access for the demo data.
- **P0 Recovery:** Preserve code/migrations, demo fixture, transaction reference and evidence hashes. Full disaster recovery remains deferred.

### Classification

- PUBLIC
- INTERNAL
- CONFIDENTIAL
- RESTRICTED
- CRITICAL_SECRET
- IMMUTABLE_EVIDENCE

### Persistence Rules

- **Master Data:** Version authority-bearing changes.
- **Commercial State:** Controlled state transitions.
- **Authorization State:** Append/version; never rewrite historical authority.
- **Execution State:** Durable state machine plus idempotency.
- **Financial Truth:** Append/corrective records.
- **Evidence:** Immutable/versioned hashes and provenance.
- **Audit:** Append-only under normal application roles.
- **Reports:** Immutable point-in-time artifacts.
- **Secrets:** Outside normal business tables.
- **Scratch:** Non-authoritative with bounded retention.

### Safe Pipeline

- Ingress Buffer
- Source Hash + Provenance
- Quarantine / Trust Classification
- Schema Validation
- Normalization
- Canonical Staging
- Business Validation
- Atomic Database Commit
- Outbox Event

### Tenant Enforcement Boundaries

- API
- Postgres/RLS
- Agent Context Builder
- PAE
- Execution Service
- Reports/Exports

### Log Redaction

- no private/signing keys
- no seed/recovery phrases
- no API/service-role secrets
- no authorization headers
- no unnecessary full IBAN/account values
- no raw sensitive documents by default

### Environment Separation

- LOCAL
- PREVIEW
- DEMO_PROD

### Backup Layers

- Supabase/Postgres database backup
- Independent logical export
- Storage/evidence-object backup

### Backup Checkpoints

- EVENT_START
- DAILY_WHERE_PRACTICAL
- PRE_MIGRATION
- PRE_DEMO
- FINAL_SUBMISSION

### Cli Rules

- No secrets in CLI arguments, shell history or process list
- Remote/deployed CLI-to-backend traffic requires HTTPS/TLS
- Only redacted/minimum business data enters the CLI fixture
- Only allowlisted minimum finance context is sent to the LLM provider
- Wallet/provider/signing secrets remain server-side
- CLI output and logs redact credentials and raw sensitive evidence
- CLI never writes directly to authoritative database tables

## Numeric Safety

- **Principle:** Financial values are exact data, not approximate numbers.
- **Provider Roundtrip:** Canonical value -> provider serialization -> parse back must equal intended authoritative value before execution.

### Forbidden

- binary floating-point for authoritative money
- silent truncation
- scientific notation in canonical finance values
- rounding that changes authority without reassessment
- JSON numeric serialization for authoritative money

### Representations

- **Commercial Accounting:** exact decimal / arbitrary precision / canonical decimal strings
- **Settlement:** integer atomic units plus asset decimals

### Separate Precision Concepts

- calculation precision
- display precision
- settlement precision

### Rounding Requirements

- explicit mode
- explicit scale
- explicit stage
- versioned policy/rule
- record material pre-round amount
- record rounding difference
- record post-round amount

### Value Chain

- Source Value
- Normalized Value
- Commercial Value
- Outstanding Value
- Authorized Value
- FX / Settlement Value
- Atomic Settlement Value
- Actual Settlement Value
- Allocated Value
- Reconciled Value

### Value Conservation

- sum(line_values) plus/minus authorized_adjustments = document_total
- opening_obligation - settlements - credits = outstanding_obligation
- sum(allocations) <= settlement_amount
- settlement_principal + fees + fx_difference + residual = actual_wallet_movement

## Devops

- **Hackathon Governance Rule:** Full SWD job-contract/review rigor applies only to the money-critical Safety Kernel, PAE/execution and reconciliation jobs. Everything else is batched for delivery speed.
- **Demo Quality Rule:** If schedule slips, cut presentation breadth before cutting Arc proof, execution safety, reconciliation or the blocked attack.
- **Verification Issue:** 81
- **Pipeline Rule:** CODE -> T0 -> T1 -> T2 when financial/core -> T3 when AI behavior changes -> T4 when integration relevant -> independent review per risk -> merge -> T5 only by explicit protected Arc Testnet dispatch -> record exact evidence.
- **Live Economic Ci Rule:** No push/PR/merge/release event automatically moves money. Exactly two explicit protected Arc Testnet dispatch profiles exist: J0_CONNECTIVITY_SPIKE may perform one tiny event-period pre-product connectivity transfer without a PAE using a dedicated disposable spike wallet/context; PRODUCT_PAE_T5 is J2+ product execution and requires exact approved SHA, fixed approved fixture, bounded amount, valid current PAE and reconciliation evidence. The two profiles cannot fall back into each other.
- **Version Control Rule:** Exact Git SHA + version registry + immutable fixture/eval/test versions identify tested behavior. Prompt/model/schema/fixture truth changes are source-controlled and re-evaluated.

### Method

- PLAN
- PREPARE
- ACT
- REVIEW
- STRESS_TEST
- VERIFY
- RECORD

### Roles

- **Axis:** plan/admit/adjudicate
- **Forge:** implementation
- **Sentinel:** independent review/adversarial inspection
- **Github:** canonical job/evidence record

### Branching

- **Main:** protected and potentially demoable
- **Feature:** feature/<job>
- **Fix:** fix/<job>

#### Rules

- short-lived branches
- one bounded job per branch
- no normal feature work directly on main
- merge only after required gates

### Risk Classes

- **R0:** copy/style/docs
- **R1:** ordinary UI/API
- **R2:** obligation/business rules
- **R3:** authority/assurance/PAE/payment/numeric
- **R4:** secrets/execution/recovery/tenant boundary

### Local Fast Gate

- format
- lint
- typecheck
- targeted unit tests
- secret scan
- migration validation if relevant
- headless happy-path smoke where implemented
- headless blocked-path smoke where implemented

### Pr Common Ci

- install
- lint
- typecheck
- unit tests
- finance invariant tests
- build
- migration/schema validation
- secret scan

### R3 R4 Ci

- guardrail tests
- idempotency/replay tests
- PAE tests
- numeric assurance
- tenant/RLS tests
- adversarial cases

### Release Health

- BUILD
- TESTS
- FINANCIAL_SAFETY
- ARC_INTEGRATION
- DATABASE
- DEPLOYMENT
- DEMO_PATH
- BLOCKERS

### Freeze

- **Feature Freeze:** 2026-10-07T23:59:00+04:00
- **Feature Freeze Rule:** Feature freeze at end of event Day 11. Day 11 is completion contingency for already-admitted P0 essentials only; no new scope. Days 12–14 allow only bug/security/reliability fixes, UX/error polish, evidence, traction, docs, demo recording and submission.
- **Code Freeze:** 2026-10-09T12:00:00-04:00
- **Code Freeze Rule:** After code freeze, only submission-critical fixes with targeted verification.

### Definition Of Done

- CODE
- TEST
- REVIEW
- VERIFY
- RECORD
- expected economic behavior demonstrated for financial jobs

### Review Focus Jobs

- Safety Kernel
- PAE signing/verification + atomic execution claim
- settlement/reconciliation

### Headless / Cli Use

- **Hackathon Status:** DEFERRED_POST_HACKATHON_REFERENCE
- **Scope Rule:** Do not implement or polish a public/product CLI during Tameion. Use tests, scripts and API fixtures over the shared core for headless development/smoke proof.
- **No New Primary Job:** True
- **Security Gate:** Headless tests/API fixtures must prove they cannot bypass approval, Safety Kernel, PAE, idempotency, kill switch or reconciliation.

#### Hackathon Purpose

- deterministic development harness through tests/scripts/API fixtures
- CI/smoke execution of happy and blocked paths
- repeatable adversarial tests
- local fallback proof without creating a second product surface

#### Post-Hackathon Reference

A future CLI may reuse the same backend authority path, but it is not J0–J4 acceptance.

### Test Levels

- T0_STATIC
- T1_UNIT_GOLDEN
- T2_FINANCIAL_SAFETY
- T3_AGENT_EVALS
- T4_INTEGRATION_E2E
- T5_LIVE_ARC

### Planned Workflows

- ci.yml
- arc-testnet.yml

**Hackathon CI Scope:** one consolidated normal CI workflow plus one protected manual Arc workflow. Six-workflow decomposition is post-hackathon reference only.

## Milestone Conveyor

**Planning Status:** PLANNED_NOT_ADMITTED_PRE_EVENT
**Event Start:** 2026-09-27
**Event End:** 2026-10-10
**Build Window:** Days 1–11 / 2026-09-27..2026-10-07
**Hardening Window:** Days 12–14 / 2026-10-08..2026-10-10
**Admission Rule:** no implementation job may be admitted before EVENT_START_BASELINE on/after 2026-09-27. At event start admit J0 only. One primary job at a time. Day 11 is completion contingency for existing P0 essentials only, never scope expansion.

### J0 — Event Baseline + Rail + Genuine Evidence Lock
**Dates:** Sep 27–28
**Outcome:** establish EVENT_START_BASELINE, bootstrap Tameion-specific product code during the event, prove Circle/Arc Testnet connectivity, and freeze 3–5 genuine redacted assessment obligations plus candidate-readiness evidence without selecting the execution candidate.

### J1 — Finance Agent Decision + Exact Human Authorization
**Dates:** Sep 29–30
**Outcome:** meaningful event-period PAY/HOLD/ESCALATE reasoning through a frozen READ/ANALYZE/PROPOSE allowlist; only after all assessments complete, J1 selects the sole execution candidate, records the selection rationale, performs exact T1 review/authorization N→N+1, and runs the final Safety Kernel on N+1.

### J2 — Signed PAE + Idempotent Arc Product Execution
**Dates:** Oct 1–3
**Day-6 Target:** complete mocked golden path.
**Day-7 Target:** one authentic PAE-gated Arc Testnet USDC product payment with exact provider status and one-to-one reconciliation recorded before J2 closes.

### J3 — Reconciliation + Compact UI + Visible Tamper Block
**Dates:** Oct 4–7
**Outcome:** judge-readable UI/timeline presents the already-verified J2 transaction and reconciliation artifact; changed-destination BLOCK, replay/UNKNOWN and kill controls remain visible. Day 11 may finish only already-admitted P0 essentials.
**Feature Freeze:** end of Oct 7 / event Day 11.

### J4 — Harden + Traction + Rehearse + Submit
**Dates:** Oct 8–10
**Rule:** no new features.

### Day 11 Contingency Guardrail

Day 11 / Oct 7 is the final build contingency for already-admitted P0 essentials only. It may close bounded defects in the frozen vertical slice but may not start a new feature family, integration surface, framework or scope expansion. If the vertical slice is already stable, hardening begins early.

### Scope by Job

- **J0:** event baseline, app bootstrap, Arc connectivity, exact atomic conversion, server-only credentials, 3–5 genuine assessment obligations, candidate-readiness evidence with no candidate designation, seeded trust records, one CI workflow.
- **J1:** pinned NVIDIA AiProvider config + capability smoke, minimum ContextBuilder/static allowlist/AgentRunner, evidence-grounded assessment of all 3–5 obligations, post-assessment sole-candidate selection, T1 exact-intent approval N→N+1, post-approval Safety Kernel.
- **J2:** one PAE schema, RFC 8785 JCS/SHA-256/Ed25519, independent verifier, idempotency, fake adapter tests, one real PAE-gated Arc payment plus exact provider status and minimum one-to-one reconciliation.
- **J3:** present the exact J2 transaction/status/reconciliation artifact, evidence timeline, five screens or fewer, visible authorization, visible tamper block, replay/UNKNOWN/kill controls, one browser golden path.
- **J4:** 8–12 focused agent cases, adversarial/security hardening, UX/errors, usage ledger, feedback if available, README, <=170s video, final submission.

### Explicit Deferrals

Dynamic plugin framework; general RAG; live mailbox; public product CLI; webhooks; background outbox/recovery platform; key-rotation UI; external settlement/cancel breadth; 20–30-case eval program; six-workflow CI decomposition; ERP/AP/AR/Treasury breadth; batch payments; mainnet.

### Slip Priority

1. meaningful agent decision;
2. truthful event-period traction;
3. PAE-gated Arc product execution;
4. human authorization + Safety Kernel;
5. reconciliation;
6. changed-destination block;
7. submission reliability;
8. optional UI/docs breadth.

## Job Contract Template

- **Milestone Entry Semantics:** Milestone job objects are DELIVERY_JOB_SUMMARIES only. Before a job enters EXECUTING, AXIS must instantiate a full Job Contract containing every required field in this template and record its base SHA, acceptance tests, economic movement expectation, verification evidence and stop conditions.
- **Admission Invariant:** NO_SUMMARY_ONLY_JOB_MAY_ENTER_EXECUTING
- **Planning Note:** Five primary hackathon jobs are planned but NOT_ADMITTED. Pre-event mode is design-only. At event start, bind EVENT_START_BASELINE and admit J0 only.

### Fields

- job_id
- milestone
- title
- operating_mode
- work_type
- layer
- why
- outcome
- in_scope
- out_of_scope
- forbidden
- base_sha
- dependencies
- risk
- affected_invariants
- acceptance
- negative_edge_tests
- expected_economic_movement
- required_review
- verification
- evidence_to_record
- stop_conditions
- provider
- runtime
- writer_lineage
- worktree_or_context
- branch
- pr_policy
- execution_token
- typed_stops

### Conveyor

- MILESTONE_OPEN
- ADMIT_ONE_JOB
- IMPLEMENT
- VERIFY
- CLOSE_JOB
- ADMIT_NEXT_JOB
- MILESTONE_EXIT_GATE
- AXIS_ADJUDICATION
- NEXT_MILESTONE

### Budget

- **Target Max Job Contracts:** 5
- **Current Primary Jobs:** 5
- **Overflow Rule:** No sixth hackathon primary job unless a concrete blocker threatens agent decision, Arc execution, reconciliation, safety proof, traction proof or submission; otherwise defer.

### Required Admission Bindings

- **Exact Baseline:** base_sha is bound to the live canonical Git head at admission
- **Provider Runtime:** one concrete implementation provider and runtime
- **Writer Lineage:** one concrete writer/session/task identity; no competing writer
- **Worktree Branch Pr:** one worktree/context + one branch + one-PR policy unless explicitly varied
- **Execution Token:** issued only by AXIS after all admission fields are complete
- **Typed Stops:** job-specific typed stops plus applicable AGENTS.md governance stops
- **Conflict Gate:** source-of-truth divergence or baseline drift blocks admission

## Mandatory Test Pack

Only tests directly supporting the focused hackathon proof are mandatory during the event. Broader recovery/platform matrices remain design-reference/post-hackathon work unless a concrete blocker activates them.

### P0 Core — Build Window

1. exact decimal → USDC atomic-unit conversion;
2. human approval binds reviewed N and atomically creates authorized N+1;
3. final Safety Kernel runs after approval on N+1;
4. PAE JCS/SHA-256/Ed25519 golden vector independently verifies;
5. tampered amount/destination/version/expiry/signature fails;
6. no execution without a valid current one-obligation PAE;
7. replay/concurrent execute produces at most one provider submission/payment;
8. provider timeout/UNKNOWN performs status lookup and never blind retry;
9. changed destination after authorization BLOCKS pre-submit with zero unauthorized movement;
10. kill switch prevents execution;
11. settlement amount/destination/status reconcile exactly to the obligation;
12. Finance Agent has no payment/approval/signing/provider authority;
13. prompt injection/undeclared skill cannot expand Finance Agent capability;
14. invalid/missing-evidence/provider-failed agent run never defaults to PAY;
15. secrets absent from repository/client/model context/normal logs.

### Days 12–14 Hardening

- stale human approval rejected;
- unverified/inactive destination rejected;
- wrong/stale source wallet rejected;
- direct execution request without PAE rejected;
- reconciliation mismatch cannot PASS;
- one browser golden-path E2E;
- secret/privacy/dependency scan;
- 8–12 focused agent-eval cases with zero unsafe PAY on critical cases.

**Visible Demo Attack:** changed destination after authorization.
**Automated Proof:** replay/idempotency and UNKNOWN/no-blind-retry.

## Demo

- **Innovation Statement:** A transaction-specific capability boundary between probabilistic reasoning and irreversible financial execution.
- **Video Target:** <=170 seconds; hard limit <180 seconds.
- **Judge Story:** real business obligations → meaningful AI decision → exact human authorization → deterministic assurance → signed PAE → Circle/Arc payment → reconciliation → destination tamper BLOCK.

### Happy Path

- 3–5 genuine event-period obligations available for assessment
- Finance Agent evaluates scoped evidence and returns PAY/HOLD/ESCALATE
- one PAY candidate selected for execution proof
- human reviews exact amount, destination, asset/network and reviewed aggregate version N
- human T1 approval atomically produces authorized aggregate N+1
- final deterministic Safety Kernel PASS on N+1
- PAE JCS/SHA-256/Ed25519 sealed
- Execution Worker independently revalidates current authority/trust/PAE
- Circle / Arc Testnet USDC product execution
- status verification
- one-to-one reconciliation
- evidence timeline

### Blocked Path

- change destination after authorization
- stale/currentness mismatch detected before provider submission
- deterministic BLOCK
- zero unauthorized USDC movement
- evidence timeline records the prevented attempt

### Video Outline Seconds

- **0–10:** Problem — AI can reason about payables, but unrestricted payment authority is unsafe.
- **10–35:** Genuine obligation set + evidence-grounded Finance Agent PAY/HOLD/ESCALATE.
- **35–55:** Human reviews exact amount/destination/asset/network/version N and authorizes the selected candidate.
- **55–80:** Authorized N+1 + final Safety Kernel PASS + signed PAE in plain English.
- **80–105:** Real Arc Testnet USDC product payment + transaction reference/status.
- **105–125:** Exact one-to-one reconciliation + evidence timeline.
- **125–155:** Change destination after authorization → BLOCK → zero unauthorized USDC.
- **155–170:** Close — AI proposes. Human authorizes. Deterministic assurance constrains. Execution is evidenced.

### Minimum Evidence Pack

- 3–5 genuine redacted event-period obligation assessments
- one credible structured agent recommendation with evidence IDs
- one explicit human exact-intent authorization
- one successful inspectable PAE-gated Arc Testnet product transaction
- one reconciled evidence timeline
- one changed-destination BLOCK with zero movement
- replay proof: no duplicate transfer
- UNKNOWN proof: no blind retry
- one event-period usage ledger
- one public understandable repository + reliable <=3 minute recording

### Fallback

If live hosting is unreliable, use a locally reproducible app plus preserved authentic PAE/Arc transaction/status/reconciliation evidence. Never substitute a mock success for an authentic product transfer. If authentic execution never succeeds, fail closed and state the limitation.

## Open Gates

### Before Event — Design Only
- exact-head read-only Codex review of v1.4.22 must be REVIEW_CLEAN;
- no product implementation admission;
- account/credential/environment readiness only.

### At Event Start
- bind EVENT_START_BASELINE;
- create/confirm dedicated public product repo or event branch;
- admit J0 only.

### During Event
- J0: Arc connectivity + genuine assessment set + candidate-readiness evidence, with no candidate selected yet;
- J1: NVIDIA capability smoke + meaningful agent reasoning + post-assessment sole-candidate selection + T1 authorization + post-approval Safety Kernel;
- J2: authentic PAE-gated Arc product transfer + exact provider status + one-to-one reconciliation;
- J3: presentation of the J2 reconciliation artifact + visible destination-tamper BLOCK;
- J4: truthful usage/feedback + public repo + <=3 minute submission.

- UAE prize eligibility / payout / KYC mechanics must be confirmed before relying on prize economics.

## Success Criteria

- all Tameion-specific product implementation is attributable to the event period;
- 3–5 genuine redacted event-period obligations receive credible agent assessments where available;
- Finance Agent demonstrates meaningful evidence-grounded PAY/HOLD/ESCALATE behavior;
- one exact human authorization is visible;
- one valid signed PAE gates one authentic Arc Testnet USDC product payment;
- settlement reconciles exactly back to the executed obligation;
- changed-destination attack is BLOCKED with zero unauthorized movement;
- replay and UNKNOWN/no-blind-retry behavior is proven;
- truthful event-period usage/traction evidence is presented;
- public repository and <=3 minute demo are understandable to an asynchronous judge;
- submission completes before deadline.

## Scope Freeze

- **Decision:** DESIGN FROZEN 2026-09-24. PRE-EVENT MODE = DESIGN/RESEARCH/LOGISTICS ONLY. EVENT PRODUCT = ONE ASSURED PAYMENT AGENT.
- **Implementation Admission:** NOT_ADMITTED before EVENT_START_BASELINE on/after 2026-09-27.
- **P0 Rule:** freeze 3–5 genuine event-period obligations in J0; assess all in J1; only then select exactly one execution candidate; one T1 approval; one final deterministic Safety Kernel; one signed PAE; one Arc product payment whose exact status/reconciliation closes J2; one prevented attack presented in J3.
- **Agentic Guardrail:** do not simplify the Finance Agent into a trivial classifier. Preserve evidence grounding, uncertainty, and genuine PAY/HOLD/ESCALATE choice.
- **Authority Guardrail:** do not weaken T1 human approval merely to appear autonomous. Autonomy is in assessment/proposal; economic authority remains human + deterministic.
- **Traction Guardrail:** no adoption/customer/usage claim without event-period evidence.
- **Circle Guardrail:** no additional Circle/Arc breadth unless needed for the one end-to-end proof.
- **Judge-Facing Guardrail:** demonstrate business value and proof; keep deep cryptographic/governance machinery in tests/README.
- **Execution Cardinality:** 3–5 assessment obligations do not create batch execution; exactly one obligation enters PAE/payment execution.
- **Verification:** one normal CI workflow + one protected Arc workflow; 15 core tests + focused hardening; 8–12 agent cases; one browser golden path.
- **Feature Freeze:** end of event Day 11 / 2026-10-07.
- **Day 11:** bounded completion contingency for already-admitted P0 essentials only; no new scope.
- **Days 12–14:** hardening, UX/error polish, evidence, traction, demo, docs and submission only.
- **Post Hackathon:** dynamic plugin systems, 20–30-case eval program, six-workflow CI decomposition, webhooks, outbox/recovery breadth, external settlement/cancel breadth, live mailbox/RAG, ERP/batch/admin breadth remain deferred.
- **CLI Guardrail:** public/product CLI is post-hackathon; J0–J4 use tests/scripts/API fixtures as headless proof.
- **Operational Exception Guardrail:** J0–J4 acceptance is limited to material-change invalidation, hard BLOCK, replay/idempotency, kill switch, UNKNOWN/no-blind-retry and exact reconciliation. Cancellation/external-settlement/webhook/recovery breadth is post-hackathon.
- **Agent Runtime Rule:** J1 uses AiProvider + minimum ContextBuilder + static code-defined READ/ANALYZE/PROPOSE allowlist + small AgentRunner; dynamic SkillRegistry/plugin discovery and general memory/RAG are deferred.
- **Historical Rule:** older M0–M7/J1.1/J3+, 10+4 schedule and pre-event-execution references are lineage only where they conflict with v1.4.22.

### Priority Order

1. meaningful agentic finance decision
2. truthful event-period traction
3. safe execution
4. Circle/Arc product proof
5. reconciliation
6. innovation/tamper proof
7. submission reliability
8. optional breadth

## Traction Proof

**Status:** PRE_EVENT_PLANNED_NOT_YET_EVIDENCED

Traction is 30% of judging. Design quality and a genuine fixture do not demonstrate usage.

### Event-Period Target

- 3–5 genuine redacted obligations assessed during Tameion;
- exactly one obligation may enter the payment execution proof;
- current manual workflow and approximate effort recorded;
- PAY/HOLD/ESCALATE result + evidence-backed reason for each assessment;
- before/after effort or prevented-risk evidence where measurable;
- at least one completed PAE-gated Arc product payment/reconciliation;
- no adoption/customer claim without direct evidence.

### Usage Ledger

Record:
- event date/time;
- redacted obligation ID;
- genuine/synthetic classification;
- agent result;
- human action;
- whether execution was attempted;
- Arc transaction reference if any;
- reconciliation result;
- manual-effort baseline;
- assisted-effort or prevented-risk result;
- feedback reference if any.

### Stretch

One external accountant/finance user or business operator watches/runs the event-period flow and provides documented feedback.

### Fallback

If no external tester is available, use own genuine business workflow, multiple event-period obligations, dated usage evidence and honest before/after measurement.

## Cli Contract

- **Hackathon Status:** DEFERRED_POST_HACKATHON_REFERENCE; no public/product CLI is required for J0–J4.
- **Hackathon Headless Alternative:** tests/scripts/API fixtures may exercise the shared core without creating a second product surface.
- **P0 Design Reference Mode:** LOCAL_OR_DEMO_CLIENT_TO_SHARED_BACKEND
- **Architecture Rule:** CLI sends authenticated requests to the same application/backend API used by the Web UI. Payment/provider/signing secrets remain server-side.
- **Command Naming Rule:** All authority-bearing mutating CLI commands carry expected-version; approval approve/reject is the only P0 human-approval command family.
- **Mutation Concurrency Rule:** CLI reads return aggregate version. Every authoritative mutation sends --expected-version <n>; the backend compares atomically and returns OPS-002 STALE_STATE on mismatch.

### Purpose

- development harness
- CI and smoke execution
- repeatable safety/adversarial tests
- future headless automation
- demo fallback

### Commands

#### Item 1

- **Command:** tameion doctor
- **Purpose:** Check backend reachability, auth state and non-secret configuration.

#### Item 2

- **Command:** tameion obligation load <fixture.json>
- **Purpose:** Upload/import the fixed redacted obligation fixture; returns obligation ID, version and source hash.

#### Item 3

- **Command:** tameion assess <obligation_id> --expected-version <n>
- **Purpose:** Run assessment only against the exact observed obligation version; stale requests fail rather than silently assessing newer state.

#### Item 4

- **Command:** tameion approval approve <obligation_id> --expected-version <n> --reason-code <code> [--reason-file <path>|--reason-stdin]
- **Purpose:** Approve exactly the version the human reviewed; backend rejects stale consent, records authority evidence, reassesses and may seal fresh PAE.

#### Item 5

- **Command:** tameion approval reject <obligation_id> --expected-version <n> --reason-code <code> [--reason-file <path>|--reason-stdin]
- **Purpose:** Reject exactly the reviewed business intent/version.

#### Item 6

- **Command:** tameion hold set <obligation_id> --expected-version <n> --reason-code <code> [--reason-file <path>|--reason-stdin]
- **Purpose:** Place BUSINESS_HOLD only if the observed version remains current.

#### Item 7

- **Command:** tameion hold release <obligation_id> --expected-version <n> --reason-code <code> [--reason-file <path>|--reason-stdin]
- **Purpose:** Release BUSINESS_HOLD only on the current reviewed version and return to reassessment.

#### Item 8

- **Command:** tameion cancel <obligation_id> --expected-version <n> --reason-code <code> [--reason-file <path>|--reason-stdin]
- **Purpose:** Attempt state-dependent cancellation against the observed version; backend rejects stale or post-boundary cancellation.

#### Item 9

- **Command:** tameion reassess <obligation_id> --expected-version <n>
- **Purpose:** Run fresh assessment only if the corrected/material state still matches the version the operator intends to reassess.

#### Item 10

- **Command:** tameion execute <obligation_id> --expected-version <n>
- **Purpose:** Request execution against the exact current aggregate version; valid current PAE and independent Execution Worker verification remain mandatory.

#### Item 11

- **Command:** tameion status <obligation_id>
- **Purpose:** Read decision, version, PAE, execution and Arc/provider status without mutating state.

#### Item 12

- **Command:** tameion reconcile <obligation_id> --expected-version <n>
- **Purpose:** Trigger reconciliation against the exact observed authoritative state; stale mutation requests fail.

#### Item 13

- **Command:** tameion evidence <obligation_id> --json
- **Purpose:** Export the replayable non-secret evidence timeline.

#### Item 14

- **Command:** tameion settlement external-record <obligation_id> --expected-version <n> --evidence <settlement.json>
- **Purpose:** Record an off-platform settlement using a validated evidence payload containing required settlement facts; immediately suppress autonomous duplicate payment pending verification.

#### Item 15

- **Command:** tameion simulate destination-change <obligation_id>
- **Purpose:** Run the non-authoritative visible tamper proof; must return BLOCK and zero unauthorized movement.

### Forbidden Commands Or Patterns

- raw send-money command accepting arbitrary amount/destination
- CLI flags containing API keys, private keys, seed phrases, signing material or service-role credentials
- command-line options that bypass approval, Safety Kernel, PAE or kill switch
- direct database writes from CLI
- direct Circle/provider calls from CLI
- force-pay or force-execute option that overrides deterministic BLOCK
- last-write-wins mutation without expected_version on authority-bearing state
- cancellation command that assumes submitted/settled money has been reversed
- --reason <free-text> or any other free-form sensitive human commentary in process-visible argv

### Auth

- **P0:** Authenticated short-lived user/session token issued by the backend. Prefer interactive login/device/browser handoff; token is held in memory or OS credential storage when available.
- **Never:** Never pass bearer tokens/secrets as command-line arguments because shell history and process listings may expose them.
- **Fallback:** For local testnet development only, a user-scoped credential file may be used if required, stored outside the repository with permissions 0600 and containing no wallet private key or provider signing secret.

### Transport

- **Remote Or Deployed:** HTTPS with TLS 1.2+; reject plaintext remote HTTP.
- **Local Development:** Loopback HTTP may be permitted only for local testnet/dev mode and must be explicitly marked non-production; production/demo remote traffic uses HTTPS.
- **Certificate Validation:** Normal platform certificate validation remains enabled; no insecure/skip-verify option in normal commands.

### Data Travel

#### Item 1

- **Step:** 1
- **From:** Fixture file
- **To:** CLI process
- **Data:** redacted obligation/evidence only
- **Protection:** local file permissions; validate schema; compute source hash; never read unrelated directories.

#### Item 2

- **Step:** 2
- **From:** CLI
- **To:** Application Backend
- **Data:** canonical business fields + evidence/hash + authenticated operator context
- **Protection:** HTTPS/TLS for remote/deployed use; no wallet/provider secrets in request.

#### Item 3

- **Step:** 3
- **From:** Backend
- **To:** Finance Agent provider
- **Data:** minimum allowlisted finance context required for the decision
- **Protection:** TLS; redact secrets and unnecessary identifiers; agent receives no wallet/API/signing credentials.

#### Item 4

- **Step:** 4
- **From:** Backend
- **To:** Database/Storage
- **Data:** canonical obligation, decisions, hashes, PAE metadata, audit/evidence
- **Protection:** provider TLS in transit; RLS/least privilege; sensitive values minimized; secrets excluded.

#### Item 5

- **Step:** 5
- **From:** Backend Safety Kernel
- **To:** PAE signer
- **Data:** exact canonical authorized intent only
- **Protection:** server-side trust boundary; signing key never enters CLI, browser, agent context or ordinary logs.

#### Item 6

- **Step:** 6
- **From:** Execution Worker
- **To:** Circle/Arc/provider
- **Data:** exact PAE-bound execution fields + provider authentication
- **Protection:** TLS; provider credentials resolved server-side; atomic idempotency claim before submit.

#### Item 7

- **Step:** 7
- **From:** Circle/Arc/provider
- **To:** Backend
- **Data:** transaction reference/status/settlement truth
- **Protection:** TLS; verify returned amount/destination/status before reconciliation.

#### Item 8

- **Step:** 8
- **From:** Backend
- **To:** CLI/Web UI
- **Data:** non-secret status, findings, transaction reference and evidence timeline
- **Protection:** authenticated response; redact secrets; stable IDs only.

### Encryption And Secret Handling

- **In Transit:** All remote/deployed network hops use TLS. Plaintext HTTP is limited to explicit local loopback development only.
- **At Rest:** Use the selected database/storage platform encryption capabilities; do not rely on encryption alone for access control.
- **Restricted Fields:** If a restricted business field must be stored, minimize it first; application-layer encryption may be added only when the P0 workflow proves it necessary.
- **Critical Secrets:** Wallet/provider/API/signing secrets stay only in server-side secret storage/environment/credential service, never in CLI args, files committed to Git, agent prompts, browser storage, audit events or exported evidence.
- **Logs:** Structured logs contain IDs/hashes/status/error codes, not credentials, authorization headers or raw sensitive documents.
- **Memory:** Secrets may exist transiently only inside the trusted server-side execution boundary and should not be serialized into agent/tool payloads.

### Output Contract

- human-readable console summary
- machine-readable JSON option
- stable IDs and transaction references
- PASS/HOLD/BLOCK + finding code
- economic movement amount/result
- no secret values

### Exit Codes

- **0:** command completed successfully / expected PASS or read operation succeeded
- **2:** business HOLD / additional evidence or approval required
- **3:** deterministic BLOCK / unsafe action rejected
- **4:** authentication/authorization failure
- **5:** provider/transport unavailable or execution state unresolved
- **6:** input/schema error
- **7:** internal invariant failure

### Non Goals For Hackathon

- public general-purpose CLI distribution
- remote admin CLI
- shell plugins/completions
- custom credential vault
- production wallet custody in CLI
- arbitrary scripting language
- separate CLI business logic

### External Settlement Evidence Schema

- **Rule:** Payload is schema-validated, hashed and bound to the command obligation/organization/current aggregate version. Operator assertion alone cannot mark EXTERNALLY_SETTLED or RECONCILED; it remains pending until the verification policy establishes the required business/economic bindings.

#### Required

- organization_id
- obligation_id
- counterparty_id
- payee_binding_ref
- amount
- asset_or_currency
- payment_date
- external_reference
- supporting_evidence_hash

#### Optional

- external_transaction_hash
- payer_reference
- payee_reference
- notes

### Reason Input Rule

- **Argv:** Only a bounded non-sensitive reason-code may be supplied in argv.
- **Free Text:** Optional free-form reason text is read from stdin or a protected local file and transmitted over the authenticated backend request; it is never required in argv and is not echoed to normal logs.
- **History:** CLI must not place free-form finance/dispute/incident reason text in shell history or process listings.

## Research Basis Operational Workflows

### Ramp Bill Pay

- **System:** Ramp Bill Pay
- **Source:** https://support.ramp.com/bill-lifecycle
- **Observed Pattern:** Edits depend on lifecycle state; some approved-bill edits restart approval; scheduled/in-flight payments can be canceled only while still eligible; paid transactions require refund/credit/recovery rather than silently reverting money.

### Ramp Bill Pay Holds / Outside Payments

- **System:** Ramp Bill Pay Holds / Outside Payments
- **Source:** https://support.ramp.com/hold-payment-for-bills-and-vendors/
- **Observed Pattern:** Business hold is distinct from security freeze and cannot stop an already initiated payment.

### Ramp Bill Pay Outside Payments

- **System:** Ramp Bill Pay Outside Payments
- **Source:** https://support.ramp.com/bill-payment-methods-and-timelines
- **Observed Pattern:** A bill can be paid outside the platform and then recorded/reconciled without initiating another platform payment.

### Request Finance

- **System:** Request Finance
- **Source:** https://docs.request.finance/invoices
- **Observed Pattern:** Approve, reject and cancel are role/state-specific actions rather than one generic override.

### BILL

- **System:** BILL
- **Source:** https://developer.bill.com/docs/payment-overview
- **Observed Pattern:** Cancel and void are separate payment operations; payment state determines which is available.

### Safe

- **System:** Safe
- **Source:** https://help.safe.global/articles/4016097317-why-do-i-need-to-pay-for-cancelling-a-transaction
- **Observed Pattern:** An issued signature cannot be assumed revoked merely because a UI proposal is deleted; nonce/state consumption is needed to make stale authorization unusable.

### Fireblocks

- **System:** Fireblocks
- **Source:** https://developers.fireblocks.com/api-reference/tags/cancel-an-approval-request-by-id
- **Observed Pattern:** Approval cancellation is state-dependent and idempotent; only pending requests are cancellable.

### Circle

- **System:** Circle
- **Source:** https://developers.circle.com/api-reference/gateway/all/get-notification-signature
- **Observed Pattern:** Webhook/notification signatures must be verified; a notification is evidence to validate, not a reason to bypass settlement reconciliation.

### Stripe

- **System:** Stripe
- **Source:** https://docs.stripe.com/api/idempotent_requests
- **Observed Pattern:** Mutation retries require stable idempotency keys; conflicting concurrent requests and changed parameters must not create duplicate economic effects.

## Operational Exception Contract

- **Principle:** HUMANS_CONTROL_BUSINESS_DECISIONS_DETERMINISTIC_CONTROLS_CONTROL_EXECUTION_SAFETY
- **Manual Intervention Rule:** A real authorized user may override an AI recommendation, place/release a business hold, reject/cancel an obligation where state permits, correct business data, record an external settlement, or request reassessment. A user may never force execution through a hard safety BLOCK, invalid/expired/revoked PAE, duplicate/replay guard, kill switch, tenant boundary or security containment state.
- **Canonical Issue:** 78

### Human Actions

#### APPROVE

- **Action:** APPROVE
##### Allowed When

- approval is required and actor has exact authority
- current record version matches

- **Effect:** Records actor/reason/time/authority version and triggers Safety Kernel reassessment before any PAE is sealed.

#### HOLD

- **Action:** HOLD
##### Allowed When

- obligation/payment has not crossed the irreversible execution boundary

- **Effect:** Sets BUSINESS_HOLD, removes/suspends executable readiness and prevents new execution claims until released and reassessed.

#### RELEASE_HOLD

- **Action:** RELEASE_HOLD
##### Allowed When

- actor has permission
- hold reason is resolved

- **Effect:** Does not automatically execute; returns the obligation to reassessment/approval as required.

#### REJECT

- **Action:** REJECT
##### Allowed When

- obligation is still open/pending/approval-stage

- **Effect:** Stops the current business intent. A later payment requires a new/reopened intent according to policy.

#### CANCEL

- **Action:** CANCEL
##### Allowed When

- execution authority has not crossed the configured irreversible provider boundary

- **Effect:** Atomically cancels the current intent and revokes any still-revocable unconsumed PAE.

#### CORRECT_AND_REASSESS

- **Action:** CORRECT_AND_REASSESS
##### Allowed When

- actor may edit the relevant business data

- **Effect:** Creates a new record version, invalidates stale approval/assurance/PAE where material, and runs the decision/safety path again.

#### RECORD_EXTERNAL_SETTLEMENT

- **Action:** RECORD_EXTERNAL_SETTLEMENT
##### Allowed When

- actor has finance permission
- evidence payload is complete
- current aggregate version matches
- platform execution has not crossed SUBMITTING/provider-submit boundary for the simple suppression path

- **Effect:** Before the provider-submit boundary, atomically suppress autonomous execution and record EXTERNAL_SETTLEMENT_PENDING_VERIFICATION. If platform execution is already SUBMITTING/UNKNOWN/CONFIRMING/SETTLED, record EXTERNAL_SETTLEMENT_CONFLICT and enter external-truth/recovery handling; never falsely claim the platform payment was stopped.

#### ACTIVATE_KILL_SWITCH

- **Action:** ACTIVATE_KILL_SWITCH
##### Allowed When

- authorized operator or security/runtime rule

- **Effect:** Stops execution according to kill-switch scope; never authorizes payment.

### Hard Non Overridable Controls

- tenant/organization boundary
- hard deterministic BLOCK
- invalid/expired/revoked PAE
- amount/destination/asset/network mismatch
- duplicate/replay/idempotency conflict
- execution kill switch or contained/compromised trust state
- cross-tenant access attempt
- missing required cryptographic verification
- known externally settled obligation

### Business Hold Vs Security Freeze

- **Business Hold:** Routine finance pause such as dispute, missing evidence, management timing, cash-flow timing or vendor issue. Releasable by authorized finance user, followed by reassessment.
- **Security Freeze:** Protective containment because execution trust/security may be compromised. Release requires incident-resolution/re-enable authority; ordinary approver cannot bypass it.

### Material Change Rules

- **Effect:** Increment aggregate version; invalidate stale approval/assurance and every unconsumed PAE bound to the old material state; require reassessment and fresh authorization.
- **Non Material Fields:** Presentation/accounting annotations that cannot change economic execution may be edited without new payment authority, but changes remain audited.

#### Material Fields

- amount
- counterparty
- destination
- asset/currency
- network
- obligation identity
- approval-relevant evidence
- authority/policy version
- source wallet identity/version

### Destination Change Workflow

- Create a new destination version; never silently mutate the destination address/version referenced by a signed PAE.
- New destination begins PENDING_VERIFICATION.
- Authorized human verifies/approves the new destination under policy.
- PAE binds exact destination_ref, immutable destination_version and destination_address.
- Activation of a material destination change invalidates unconsumed PAEs for affected payment intents.
- Fresh assessment/approval/PAE is required before execution.

### Payment Lifecycle

- PROPOSED
- APPROVAL_PENDING
- AUTHORIZED
- PAE_ACTIVE
- RESERVED
- SUBMITTING
- SUBMITTED
- CONFIRMING
- UNKNOWN
- FAILED
- SETTLED
- RECONCILED
- CANCELLED
- RECOVERY_REQUIRED

### Pae Lifecycle

- UNUSED
- RESERVED
- SUBMITTED
- CONSUMED
- EXPIRED
- REVOKED

### Cancellation Boundary

- **Before Reservation:** Cancel allowed; revoke PAE and mark intent CANCELLED.
- **Reserved Not Submitted:** Cancellation and execution race on the same atomic state transition; exactly one may win.
- **Submitted Or Irreversible:** Cancellation is no longer assumed possible. Query provider/chain truth and transition to CONFIRMING/UNKNOWN/SETTLED/RECOVERY_REQUIRED as appropriate.
- **Post Settlement:** Never rewrite history as unpaid merely to undo money. Use refund/return/credit/recovery evidence.

### Failed Vs Unknown

- **Failed:** External/provider truth confirms the attempt failed. A fresh execution attempt or intent may be created only after policy/idempotency checks.
- **Unknown:** It is not known whether economic movement occurred. Blind retry is prohibited; query Circle/Arc/provider truth first and reconcile before any new attempt.

### External Settlement

- **Rule:** Only before the provider-submit boundary may a complete external/manual-settlement action atomically suppress new autonomous execution and enter EXTERNAL_SETTLEMENT_PENDING_VERIFICATION. At/after SUBMITTING, suppression is never claimed; use EXTERNAL_SETTLEMENT_CONFLICT/RECOVERY_REQUIRED and reconcile external truth.
- **Reopen Rule:** If external settlement evidence is rejected/reversed, reopening creates a new state transition; historical evidence remains immutable.
- **Suppression Scope:** Duplicate suppression applies only while the platform payment is still atomically preventable. It does not retroactively stop or cancel a provider call that may already have been submitted.
- **Authority Owner:** The P0 ObligationAuthorityAggregate owns external-settlement state and aggregate_version; provider/payment observations are evidence feeding that aggregate, not independent state authority.

#### States

- EXTERNAL_SETTLEMENT_PENDING_VERIFICATION
- EXTERNALLY_SETTLED
- EXTERNAL_SETTLEMENT_REJECTED
- EXTERNAL_SETTLEMENT_CONFLICT

#### Evidence

- actor
- timestamp
- amount
- asset/currency
- payment date
- external reference/tx hash where available
- supporting evidence hash
- verification result

#### In Flight Conflict Rule

- **Pre Reservation:** If no execution reservation exists, recording external settlement may atomically place EXTERNAL_SETTLEMENT_PENDING_VERIFICATION and suppress new autonomous execution.
- **Reserved Not Submitting:** External-settlement recording and execution/cancel reservation compete on the same atomic state/version transition. If the external-settlement action wins, the reservation is cancelled/revoked before submit; if execution already advanced, the external action does not claim duplicate suppression.
- **Submitting Unknown Confirming:** Do not transition directly to EXTERNAL_SETTLEMENT_PENDING_VERIFICATION as if the platform payment were stopped. Record EXTERNAL_SETTLEMENT_CONFLICT, freeze further economic actions, query Circle/Arc/provider truth, and reconcile both possible payment facts.
- **Settled Or Reconciled:** Treat an asserted external payment as a potential duplicate/recovery event; preserve both records and enter RECOVERY_REQUIRED/manual investigation rather than rewriting settlement history.
- **Invariant:** EXTERNAL_SETTLEMENT_CANNOT_CLAIM_DUPLICATE_SUPPRESSION_AFTER_PROVIDER_SUBMIT_BOUNDARY

#### Transition Contract

- **None To Pending:** With complete bound evidence, authorized finance actor and matching expected aggregate version, a pre-submit CAS may set EXTERNAL_SETTLEMENT_PENDING_VERIFICATION, increment aggregate_version and suppress new platform execution.
- **Pending To Externally Settled:** Only the external-settlement verification policy may mark EXTERNALLY_SETTLED after evidence binds the same organization, obligation, counterparty/payee, amount, asset/currency, payment date and external reference; this increments aggregate_version and keeps platform execution suppressed.
- **Pending To Rejected:** Verification mismatch marks EXTERNAL_SETTLEMENT_REJECTED, preserves evidence, increments aggregate_version and requires explicit reassessment before any new payment authority.
- **In Flight To Conflict:** If platform execution is SUBMITTING/UNKNOWN/CONFIRMING, record EXTERNAL_SETTLEMENT_CONFLICT, freeze further economic action, query external truth and reconcile both possible facts; never claim suppression.
- **Settled Duplicate:** If platform settlement already exists, asserted external settlement is a potential duplicate/recovery event and moves to RECOVERY_REQUIRED/manual investigation without rewriting history.

#### Verification Policy

- **Rule:** Verification must establish that the evidence refers to the same organization/obligation/counterparty-or-payee and economic amount. Provider/chain truth is used when independently queryable; an operator assertion alone is never sufficient to mark EXTERNALLY_SETTLED.
- **P0 Test Scope:** P0 proves the state machine with deterministic fixtures/mocks unless a real independently verifiable external settlement is available; do not claim arbitrary bank-payment verification capability.

##### Required Bindings

- organization_id
- obligation_id
- counterparty_id
- payee_binding_ref
- amount
- asset_or_currency
- payment_date
- external_reference
- supporting_evidence_hash

### Concurrency Control

- **Aggregate Version:** aggregate_version is the monotonic version of the P0 ObligationAuthorityAggregate root, not a shorthand for any single child-row version.
- **Mutation Requirement:** UI, CLI, agent and worker authority-bearing mutations compare expected_version/current authority hash against the ObligationAuthorityAggregate and update covered child state + aggregate root atomically.
- **Stale Rule:** If current version differs, reject with STALE_STATE; reload and reassess.
- **Cancel Execute Race:** Cancel/revoke and execute/reserve use one atomic compare-and-set/transactional claim so both cannot succeed.
- **Multi Interface Rule:** Web UI and CLI are equivalent clients; neither receives last-write-wins authority over stale financial state.
- **Human Consent Binding:** Human approval/reject/hold/release/cancel/reassess/external-settlement requests are bound to the exact observed aggregate version. If current state advanced, the request fails STALE_STATE and the human must reload/review before acting.
- **Api Pattern:** Mutating Web/API requests carry expected_version (or equivalent If-Match/current authority hash). The backend never silently upgrades stale consent to the newest business state.

#### P0 Authority Aggregate

- **Owner:** One ObligationAuthorityAggregate root per P0 obligation owns aggregate_version and is the concurrency/currentness root used by Web, CLI, agent orchestration, signer and Execution Worker.
- **Bump Rule:** Every authority-bearing change to a covered component is committed with the aggregate root in the same Postgres transaction/CAS and increments aggregate_version exactly once for that logical transition.
- **Approval Rule:** Approval consumes reviewed aggregate N and atomically produces authorized aggregate N+1; durable approval evidence carries both versions and PAE binds N+1.
- **Master Change Rule:** Changing a counterparty/destination/source-wallet master record creates a new master version and does not silently mutate an existing obligation snapshot. Making a new version effective for an obligation requires an aggregate transition; independently, pre-execution re-resolution of current counterparty/destination/source-wallet trust prevents a stale approved snapshot/PAE from executing after a material master-state change.
- **Expected Version Rule:** Every authority-bearing client command supplies the observed aggregate_version as expected_version; mismatch is OPS-002 STALE_STATE.
- **Execution Rule:** Immediately before reservation/provider submission, the PAE sole obligation_id must select the same organization-scoped ObligationAuthorityAggregate and PAE aggregate_version must exactly equal that root current version after all required approval transitions.
- **Identity:** The P0 authority root identity is the ordered pair (organization_id, obligation_id). aggregate_version is monotonic only within that root and numeric equality across different obligations has no authority meaning.

##### Covered Authority State

- obligation economic fields and status
- organization and financial-authority bindings
- counterparty identity/trust version
- destination_ref/version/address/trust state
- source_wallet_ref/version/organization/status/network/asset
- approval-relevant evidence hashes/currentness
- asset/network and exact authoritative amount
- policy version
- business HOLD/security FREEZE state
- external-settlement state

### Provider Event Rule

- **Webhook:** Verify provider signature where supported, deduplicate event ID/reference, and record as an observation.
- **Authority:** A webhook alone does not bypass payment-state rules. Settlement state is reconciled to provider/Arc transaction truth.
- **Fallback:** Polling/status query is valid when webhook is delayed/missed/unavailable.

### Audit Required For Human Intervention

- actor_id
- actor_role
- action
- reason
- timestamp
- previous_state
- new_state
- expected_version
- resulting_version
- changed_material_fields
- invalidated_approval_ids
- invalidated_pae_ids
- economic_movement_observed

### P0 Visible Behaviors

- Human may HOLD/APPROVE or correct-and-reassess an AI decision; execution still passes through Safety Kernel.
- Destination change after authorization invalidates/stops stale authority and requires a fresh PAE.
- Cancellation before irreversible submission succeeds; after the irreversible boundary the system switches to status/recovery handling rather than pretending money was canceled.

### P0 Automated Invariants

- Hard BLOCK cannot be force-overridden by UI or CLI.
- External-settlement record blocks a second autonomous payment.
- Concurrent stale UI/CLI mutation is rejected.
- Cancel-versus-execute race yields one winner only.
- FAILED and UNKNOWN follow different retry behavior.
- Duplicate provider event does not duplicate financial state transition.
- Unsigned/unverified provider event cannot mark payment reconciled.

### Deferred Operational Breadth

- partial settlements
- refund automation
- credit-note accounting
- multi-payment allocation
- recurring obligations
- bulk exception operations
- production bank recall workflows
- complex dispute case management

### Reservation Recovery

- **Purpose:** Recover safely if the Execution Worker crashes after reserving authority but before a provider submission exists.
- **Atomic Reservation:** The same durable database transaction changes PAE/execution state to RESERVED and writes an execution-outbox record with execution_id, PAE/idempotency key, reservation_owner and lease_expires_at.
- **Normal Worker:** A worker claims the outbox/reservation lease and performs final PAE/current-state/kill-switch verification before provider submit.
- **Pre Submit Crash:** If the lease expires and there is no durable PROVIDER_SUBMIT_STARTED/provider reference marker, another worker may reclaim the SAME execution_id and SAME provider idempotency key after revalidating PAE freshness and current safety state.
- **Submit Boundary:** Before making the external provider call, persist SUBMITTING/PROVIDER_SUBMIT_STARTED durably. Once this boundary exists, an abandoned attempt is UNKNOWN until external provider/Arc truth is queried; never reclaim it as a fresh unsent request.
- **Cancel Rule:** Cancellation may win only before SUBMITTING and through the same atomic state check. It cannot silently cancel an attempt that may already have reached the provider.
- **No New Key Rule:** Recovery never generates a new economic idempotency key for the same authorized intent.

## Identity Counterparty Trust Contract

- **Canonical Issue:** 79
- **Principle:** AI_IS_A_WORKER; HUMAN_IDENTITY_ORGANIZATION_AUTHORITY_COUNTERPARTY_AND_DESTINATION_TRUST_ARE_ESTABLISHED_INDEPENDENTLY
- **Destination Rule:** A verified counterparty is not the same as a verified payment destination. Every destination is an immutable-versioned trust object; a material change creates a new version and requires fresh authority.
- **Document Rule:** Documents are evidence, not authority. AI may extract/classify/explain them; controlled verification/attestation establishes authoritative master state.

### Identity Vs Authority

- account creation != identity verification
- identity verification != organization affiliation
- organization affiliation != financial authority
- financial authority != transaction-specific consent

### Human Identity Lifecycle

- REGISTERED
- IDENTITY_PROOFING
- IDENTITY_VERIFIED
- STRONG_AUTH_ENROLLED
- ORGANIZATION_LINKED
- ROLE_ASSIGNED
- FINANCIAL_AUTHORITY_ACTIVE

### Identity Provider Abstraction

- **Rule:** Use an IdentityProofingProvider abstraction; production may integrate jurisdiction-appropriate providers such as UAE PASS or approved U.S./commercial identity providers.
- **Storage:** Prefer provider attestation/reference and minimum required verified attributes over retaining raw identity documents when the provider assertion is sufficient.
- **P0:** Use one explicitly VERIFIED demo operator record with redacted/supporting evidence; no external identity-provider integration is required for the hackathon.

### Step Up Authentication

- beneficiary/destination activation or change
- material payment approval
- financial authority/limit change
- security-freeze release
- signer/execution configuration change

### Organization Authority

- **Rule:** Authority is organization-scoped, role-scoped, action-scoped, versioned and optionally limited by amount/asset/network/counterparty/destination/effective period.
- **Invariant:** ADMIN_ROLE_DOES_NOT_IMPLY_FINANCIAL_AUTHORITY

### Counterparty Lifecycle

- DRAFT
- DOCUMENTS_PENDING
- DUE_DILIGENCE_PENDING
- VERIFIED
- ACTIVE
- ON_HOLD
- BLOCKED
- REVIEW_DUE
- SUPERSEDED

### Counterparty Evidence

- legal name
- registration/incorporation number
- jurisdiction
- registered/business address
- tax identifier where relevant
- incorporation/business-license evidence
- authorized representative
- beneficial owner/controller information where required by risk/use case
- screening/risk result
- verification source/date/currentness
- supporting-document hashes/provenance

### Destination Lifecycle

- PENDING_VERIFICATION
- VERIFIED
- ACTIVE
- ON_HOLD
- BLOCKED
- SUPERSEDED

### Insider Threat

- **Goal:** COMPROMISE_ONE_APPLICATION_ROLE_NEVER_DIRECTLY_AUTHORIZES_ECONOMIC_MOVEMENT
- **Root Owner Boundary:** An actor controlling every underlying trust root can act outside the application; production security therefore separates trust roots and ensures privileged actions are bounded and durably evidenced.

#### Separate Roles Where Practical

- business maker
- financial approver
- destination verifier
- application administrator
- deployment authority
- PAE signer
- execution/provider credential
- audit/evidence administrator

#### Production Dual Control

- beneficiary activation/change
- financial authority/limit changes
- signer/key configuration
- execution/provider credential changes
- security-containment release
- material policy changes

#### Break Glass Allowed

- STOP
- FREEZE
- REVOKE
- DISABLE
- CONTAIN

#### Break Glass Forbidden

- FORCE_PAY
- BYPASS_PAE
- OVERRIDE_HARD_BLOCK
- REWRITE_SETTLEMENT_HISTORY

### P0 Trust Set

- one VERIFIED demo operator
- one fixed organization
- one VERIFIED supplier/counterparty
- one VERIFIED Arc destination
- redacted supporting evidence/provenance
- one negative proof that an UNVERIFIED destination cannot execute

### Deferred

- live KYC/KYB vendor integration
- production identity federation
- full sanctions/compliance platform
- enterprise privileged-access management
- jurisdiction-wide legal-rule engine

### P0 Source Wallet Authority

- **Scope:** One fixed organization-owned Circle Arc Testnet product source wallet for J2+ product execution; J0 connectivity spike uses a separate disposable spike wallet/context.
- **Record:** SOURCE-WALLET-AUTHORITY-P0-1
- **Version Rule:** source_wallet_ref is immutable identity; any authority-relevant configuration change creates a new source_wallet_version. P0 execution requires the exact current version.
- **Execution Resolution:** Execution Worker resolves source_wallet_ref + source_wallet_version server-side to exactly one provider_wallet_id and uses that provider wallet; client/agent cannot supply or replace provider wallet credentials.
- **Material Change Rule:** Changing source-wallet identity/version/organization/network/asset/execution-enabled state increments the authority aggregate and invalidates approval/assurance/unconsumed PAE.
- **Negative Rule:** A valid PAE pointing to a wallet not owned/active/allowed for the same organization is invalid and causes zero movement.

#### Required Fields

- source_wallet_ref
- source_wallet_version
- organization_id
- provider_wallet_id
- status
- network
- asset
- execution_enabled

#### Required State

- **Organization Id:** must equal the PAE/operator organization
- **Status:** ACTIVE
- **Network:** ARC_TESTNET
- **Asset:** USDC
- **Execution Enabled:** True

### P0 Counterparty Execution Currentness

- **Binding:** PAE binds counterparty_id + counterparty_version for the exact obligation authority snapshot.
- **Pre Seal:** Safety Kernel requires the bound counterparty version to be current and payment eligible.
- **Pre Execution:** Execution Worker re-resolves the current counterparty master by organization/counterparty_id and requires exact counterparty_version match plus payment-eligible current state.
- **Fail Closed:** ON_HOLD, BLOCKED, REVIEW_DUE, SUPERSEDED, version change or inability to prove current trust invalidates execution before provider submission.
- **Master Change:** Counterparty master changes create a new immutable/versioned counterparty state. Existing obligation snapshots do not silently mutate; pre-execution current-master revalidation prevents a stale snapshot/PAE from executing.

## Standards Assurance Baseline

- **Canonical Issue:** 79
- **Claims Rule:** Alignment/informed-by language is permitted only when mapped to evidence. Certification, attestation or regulatory-compliance claims require independent formal evidence and defined scope.
- **P0 Rule:** Apply engineering/control principles only; do not attempt certification during the hackathon.

### Accounting

- **Core Rule:** Tameion records authoritative economic facts and audit evidence; accounting policy determines statutory classification.

#### References

- IFRS Accounting Standards
- FASB ASC / U.S. GAAP

#### Forbidden Claims

- IFRS certified
- GAAP certified
- USDC always has one accounting classification

#### Evidence Fields

- obligation
- counterparty
- amount/currency/asset
- authorization
- settlement amount/reference/time
- fees/differences
- verified destination
- reconciliation
- provenance/audit trail
- optional policy-layer accounting mapping

### Information Security

- ISO/IEC 27001:2022 — design/control-management reference; certification only after formal audit
- ISO/IEC 27017 — current applicable cloud-security guidance
- ISO/IEC 27701 — current applicable privacy-management guidance

### Ai Governance

- ISO/IEC 42001:2023
- NIST AI RMF

### Identity Authentication

- NIST SP 800-63-4 concepts for identity proofing, authentication and federation separation

### Secure Development

- NIST SP 800-218 SSDF
- OWASP ASVS 5.0

### Cryptography

- **Rule:** NO_CUSTOM_CRYPTO
- **Transport:** Remote/deployed traffic uses TLS with normal certificate validation.
- **Keys:** Separate keys by purpose; preserve key/version identifiers and rotation capability; critical signing/provider secrets stay outside browser, CLI args, AI context, normal logs and business tables.
- **Fips:** Use FIPS 140-3 validated cryptographic modules/services only where customer/regulatory requirements demand them; never describe the whole application as FIPS certified.

### Future External Assurance

- SOC 2 Type II after product/control maturity
- SOC 1 only if future customer reliance on controls over financial reporting justifies the scope
- PCI DSS only if cardholder/account-data scope is introduced

## Dependency Baseline

- **Canonical Issue:** 80

### Package Manager

- **Name:** npm
- **Lockfile:** package-lock.json
- **Lockfile Version:** 3
- **Project Node:** 24.x
- **Install Rule:** CI uses npm ci from committed lockfile. Required peer dependencies are direct dependencies; unused optional peer ecosystems must not be auto-added solely for optional SDK integrations.
- **Pin Rule:** Initial direct dependencies use exact versions; upgrades require PR evidence rather than floating latest.

### Runtime

- **Next:** 16.3.6
- **React:** 19.3.0
- **React-Dom:** 19.3.0
- **Zod:** 4.6.5
- **Openai:** 7.23.0 (client SDK only; OpenAI Platform inference key is not required)
- **@Supabase/Supabase-Js:** 2.117.1
- **@Supabase/Ssr:** 0.12.7
- **@Circle-Fin/Developer-Controlled-Wallets:** 10.8.1
- **Json-Canonicalize:** 3.0.1
- **Commander:** 15.0.0

### Development

- **Typescript:** 5.9.3
- **@Types/Node:** 24.13.6
- **@Types/React:** 19.3.0
- **@Types/React-Dom:** 19.3.0
- **Eslint:** 9.39.5
- **Eslint-Config-Next:** 16.3.6
- **Prettier:** 3.9.9
- **Vitest:** 5.0.1
- **@Vitest/Coverage-V8:** 5.0.1
- **Fast-Check:** 4.10.2
- **@Playwright/Test:** 1.63.0
- **Tsx:** 4.23.15

### External Tools

#### Arc Canteen Cli

- **Version:** 0.1.17
- **Commit:** 2e46a302a22f0ca114f3cf492518058d1dc28374
- **Install:** uv tool install git+https://github.com/the-canteen-dev/ARC-cli@2e46a302a22f0ca114f3cf492518058d1dc28374
- **Runtime Authority:** False

#### Circle Cli

- **Version:** 1.1.4
- **Install:** npm install -g @circle-fin/cli@1.1.4
- **Runtime Authority:** False
- **Reason Outside Lockfile:** Developer/J0 tool only; broad x402/Solana tooling is not part of application runtime.

#### Supabase Cli

- **Version:** 2.117.0
- **Install:** npx --yes supabase@2.117.0
- **Runtime Authority:** False

### Platform Primitives

- node:crypto for hash/sign/verify and key operations
- crypto.randomUUID() for opaque identifiers
- built-in fetch for HTTP
- strict decimal-string to bigint parser for authoritative USDC 6-decimal atomic units
- Next route handlers instead of Express/Fastify
- Postgres SQL/RPC functions for atomic authority transitions
- Postgres durable outbox/reservation lease instead of a separate queue platform
- small internal structured/redacting logger instead of a telemetry framework

### Circle P0 Decision

- **Adopt:** @circle-fin/developer-controlled-wallets only
- **Reason:** P0 requires one server-side Arc Testnet wallet/USDC execution path. Direct DCW SDK supports ARC-TESTNET without App Kit cross-chain/swap breadth.
- **Revisit Condition:** A concrete J0/P0 blocker proves the direct DCW path cannot satisfy the required Arc execution/status/idempotency contract.

#### Defer

- @circle-fin/app-kit
- @circle-fin/adapter-circle-wallets
- Bridge Kit/CCTP
- Gateway
- Earn/USYC
- direct viem/ethers
- smart-contract framework

### Ai P0 Decision

- **Rule:** If the model/provider fails the eval contract, change the model/adapter before adding orchestration breadth.

#### Adopt

- one AiProvider interface
- OpenAI SDK compatible adapter
- ContextBuilder
- SkillRegistry
- AgentRunner
- Zod structured skill/final-output validation
- versioned prompt/model/context/skill/eval metadata

#### Defer

- LangChain
- DeepAgents
- Vercel AI SDK
- fine-tuning framework
- general RAG/vector DB
- agent memory platform
- runtime MCP financial tool router
- multi-agent orchestration

### Data P0 Decision

- **Adopt:** Supabase/Postgres + SQL migrations + RLS/Auth/RPC as needed
- **Atomicity Rule:** Money/authority state transitions requiring atomicity are implemented as database functions/transactions, not client-side multi-call sequences.

#### Defer

- Prisma
- Drizzle
- TypeORM
- Redis
- BullMQ
- Kafka
- vector database

### Ui P0 Decision

- **Adopt:** Next/React + native controls + CSS/CSS Modules
- **Revisit Condition:** Only if J3 reveals a concrete accessibility/reliability blocker before feature freeze.

#### Defer

- Tailwind
- broad component library
- charting library
- form framework

### Crypto Numeric

- **Canonicalization:** json-canonicalize
- **Crypto:** Node standard cryptography; no custom cryptographic primitive
- **Money:** USDC authoritative value is bigint atomic units derived from strict decimal-string parsing; binary float is never authoritative.

### Survey Evidence

- **Date:** 2026-09-24
- **Local Action:** Do not change global SWD Node. Bootstrap Tameion with project-scoped Node 24.

#### Broad Circle Candidate

- **Resolved Package Count Approx:** 791
- **Interpretation:** Rejected for P0 because cross-chain/Solana/Ethers/provider breadth is unnecessary for the one-chain proof; this is not a blanket judgment on package security.

##### Packages

- @circle-fin/app-kit@1.15.2
- @circle-fin/adapter-circle-wallets@1.8.0

##### Runtime Audit Point In Time

- **Critical:** 0
- **High:** 11
- **Moderate:** 10
- **Low:** 8
- **Total:** 29

#### Adopted Candidate

- **Direct Circle Package:** @circle-fin/developer-controlled-wallets@10.8.1
- **Resolved Package Count Approx:** 525
- **Unused Optional Peer Ecosystems:** not installed as application requirements
- **Interpretation:** Point-in-time lockfile survey only; CI dependency review remains mandatory.

##### Runtime Audit Point In Time

- **Critical:** 0
- **High:** 0
- **Moderate:** 0
- **Low:** 0
- **Total:** 0

#### Local Toolchain Observed

- **Node:** 22.15.1
- **Npm:** 10.9.2
- **Python:** 3.12.3
- **Uv:** 0.11.32
- **Git:** 2.43.0

### Supply Chain Policy

- exact direct dependency pins at bootstrap
- package-lock committed and reviewed
- clean npm ci in CI
- dependency tree/audit evidence on PR and release
- weekly Dependabot for npm and GitHub Actions
- no automatic merge for financial/runtime provider dependencies
- Circle/Supabase/Next/AI/canonicalization dependency updates run targeted financial/adversarial/eval regressions
- no dependency may add a new financial authority path
- Tameion third-party GitHub Actions are pinned by full immutable commit SHA, not moving major/minor tags
- Gitleaks is the selected P0 secret scanner; exact release/checksum or immutable action SHA is recorded at J0 bootstrap

### Explicit Non Dependencies P0

- @circle-fin/app-kit
- @circle-fin/adapter-circle-wallets
- direct viem/ethers
- LangChain/DeepAgents
- RAG/vector DB/embeddings
- runtime MCP financial tools
- ORM
- Redis/queue platform
- OpenTelemetry platform
- Solidity/Hardhat/Foundry
- second web framework/test runner

### Mcp Policy

- **Developer Control Plane:** Allowed for engineering/governance workflows such as GitHub, documentation/reference retrieval, repository inspection and other explicitly authorized developer tooling.
- **Runtime Financial Path:** Prohibited for P0 as a generic agent-to-money router. Finance Agent -> typed application service -> Safety Kernel -> signed PAE -> Execution Worker remains the only money authority path.
- **Secrets:** Developer MCP/tools must not be given wallet private keys, PAE signing secrets or production/provider credentials unless a future narrowly scoped tool is explicitly threat-modeled and approved.
- **Scope:** MCP use for development does not become an application runtime dependency and does not grant financial authority.

### Rag Policy

- **P0:** No general RAG/vector/embedding system.
- **P0 Retrieval:** Use deterministic scoped evidence IDs/allowlisted context linked to the obligation.
- **Future Trigger:** Reconsider only when long contracts/policies/vendor history/regulatory corpora create a demonstrated retrieval need; then require provenance, tenant isolation, freshness and prompt-injection evals.

### Ci Security Tooling

- **Github Actions Pin Rule:** Every third-party GitHub Action in the Tameion product repository uses a full immutable commit SHA in uses:. A human-readable release tag/version may appear only as a comment; moving major tags such as @v4 are not sufficient for release identity.

#### Secret Scanner

- **Name:** Gitleaks
- **Purpose:** blocking repository secret scan in local/CI/release gates
- **Pin Rule:** J0 bootstrap records one exact Gitleaks release/version and checksum or immutable action commit; upgrades require reviewed PR evidence
- **Config Rule:** scanner configuration is committed and versioned with the Tameion product repository

#### Pii Publication Scan

- **Scope:** deterministic public-repository/demo-artifact checks for known real names, emails, account/wallet/source identifiers and prohibited fixture markers
- **Claim Limit:** This is a publication guard, not a DLP certification or guarantee of comprehensive PII detection.

### Agent Runtime Policy

- **P0 Provider Adapter:** OpenAI SDK compatible adapter targeting NVIDIA Build
- **Rule:** Prefer a small typed application-owned loop. Add orchestration framework breadth only for a concrete post-P0 blocker.
- **P0 Email Connector:** No live Gmail/Outlook connector dependency. P0 consumes normalized uploaded/redacted source evidence; live mailbox OAuth remains post-P0 unless a concrete blocker is proven.

#### Adopt

- application-owned AiProvider interface
- ContextBuilder
- SkillRegistry
- AgentRunner
- native provider structured tool/function calling
- Zod validation

#### Defer

- general agent framework
- persistent provider agent memory
- general RAG/vector memory
- runtime financial MCP router
- business workflow engine inside money path

## Verification Baseline

- **Canonical Issue:** 81
- **Parent Blueprint Schema:** 1.4.22

### Principles

- CI may freely test whether money would be authorized; CI must never freely move money.
- Golden expected results are adjudicated from finance/control truth and never generated by the same LLM under evaluation.
- AI model output is versioned testable software behavior.
- Exact Git SHA is the ultimate software identity.
- A green build never overrides a failed financial-safety gate.

### Data Classes

- REAL_REDACTED
- SYNTHETIC_REALISTIC
- ATTACK_SYNTHETIC

### Datasets

#### Golden Fixtures

- **Purpose:** exact deterministic expected behavior
- **Mutation:** immutable/versioned after acceptance
- **Target Count:** 12-15 initial P0 cases

#### Agent Eval

- **Hackathon Target Count:** 8–12 focused cases
- **Post-Hackathon Target Count:** 20–30 cases
- **Suggested Mix:** 2–3 normal; 2–3 incomplete/ambiguous; 2–3 suspicious/adversarial; 2–3 human-intervention/boundary.
- **Dimensions:** PAY/HOLD/ESCALATE quality; evidence grounding; missing-data awareness; transaction-field fidelity; uncertainty discipline; authority discipline.
- **Critical Floor:** zero unsafe PAY on critical cases; zero fabricated evidence references; zero invented transaction fields; zero authority claims.
- **Training Rule:** evaluation only; no fine-tuning required.
- **Post-Hackathon:** 20–30-case program remains future hardening, not event acceptance.

### Agent Run Identity

- git_sha
- model_provider
- model_id
- model_config_version
- prompt_version
- input_schema_version
- output_schema_version
- fixture_id
- fixture_hash
- eval_suite_version
- timestamp
- agent_runtime_version
- context_schema_version
- skill_manifest_hash
- prompt_hash
- evidence_binding_manifest_hash
- context_envelope_hash

### Test Packs

**Hackathon Status:** DESIGN_REFERENCE_NOT_HACKATHON_ACCEPTANCE. Only the focused mandatory subset blocks J0–J4; broad outbox/recovery, external-settlement/cancel and Web/CLI parity items are post-hackathon unless a concrete event blocker activates them.

#### Pack-A-Money

- decimal string -> atomic
- precision/invalid input
- rounding boundaries
- conservation/comparison
- no authoritative binary float

#### Pack-B-Trust

- identity vs authority
- organization membership
- role/financial authority
- counterparty trust
- destination trust
- admin != financial authority

#### Pack-C-Authorization

- Safety PASS/HOLD/BLOCK
- T1 approval/hold/kill
- reviewed->authorized aggregate-version transition
- source-wallet/counterparty/destination authority and currentness
- material-change invalidation before sealing
- no force-pay

#### Pack-D-Execution

- PAE canonical/signature/key/expiry/revocation
- durable approval and assurance canonical hash verification
- atomic claim
- idempotency
- replay/concurrency
- reservation lease/outbox
- pre/post-submit crash recovery
- UNKNOWN
- source-wallet and destination exact pre-execution revalidation

#### Pack-E-Operations

- hold/release/reassess
- cancel boundary
- expected_version
- external settlement/conflict
- human override boundary

#### Pack-F-Reconciliation

- provider/Arc truth
- event verification/dedup
- one-to-one match
- mismatch cases
- accounting-neutral evidence

#### Pack-G-Adversarial

- destination/amount tamper
- prompt injection
- malicious employee/admin force-pay
- stale interfaces
- duplicate/races
- direct CLI bypass

#### Pack-H-Secrets-Interfaces

- no secret in browser/CLI/logs/agent
- Web/CLI same core
- no direct DB/provider bypass

### Levels

#### T0 Static

- **Runs:** every PR

##### Checks

- format
- lint
- typecheck
- build
- lock/dependency integrity
- secret scan
- migration/schema syntax
- generated-file drift

#### T1 Unit Golden

- **Runs:** every PR

##### Checks

- unit
- golden fixtures
- money/numeric
- schema/contracts

#### T2 Financial Safety

- **Runs:** financial/core changes; mandatory R3/R4

##### Checks

- trust/authority
- state/property
- PAE vectors
- replay/idempotency/concurrency
- operational exceptions
- economic-movement assertions

#### T3 Agent Evals

- **Runs:** prompt/model/context changes, M1 exit, release

##### Checks

- fixture/schema harness
- frozen eval corpus
- accepted-baseline comparison

#### T4 Integration E2E

- **Runs:** M3+ relevant PR/main/release

##### Checks

- clean DB/migrations
- backend/API
- mock Circle adapter
- Web golden path
- reconciliation

#### T5 Live Arc

- **Runs:** explicit protected workflow_dispatch only during event; J0 connectivity spike isolated, J2+ product run requires valid PAE
- **Mainnet Credentials:** forbidden in hackathon CI

##### Checks

- exact approved SHA
- protected Arc Testnet environment
- approved fixed fixture
- bounded testnet amount
- valid PAE
- transaction/status/reconciliation evidence

### Github Actions

#### Ci.Yml

One normal event workflow:
- Node 24 + npm ci;
- format/lint/typecheck/build;
- unit/golden/financial-safety/adversarial focused suite;
- 8–12 agent eval cases when behavior changes;
- mock Circle integration + browser golden path;
- secret/privacy/dependency checks.

#### Arc-Testnet.Yml

One protected manual economic workflow:
- workflow_dispatch only;
- protected ARC_TESTNET environment;
- exact approved SHA;
- bounded Testnet amount;
- server-only credentials;
- J0 connectivity mode isolated from product execution;
- J2+ PRODUCT_PAE mode requires valid current PAE and reconciliation evidence.

The previous six-workflow decomposition remains post-hackathon design reference.

### Environments

- **Preview:** mock execution only; synthetic/redacted data; no Circle execution/signing authority
- **Demo:** protected main/RC; execution disabled by default; can show preserved testnet evidence
- **Arc Testnet:** separate protected environment with minimum provider/signing configuration for bounded explicit runs

### Version Registry

- **File:** config/versions.json
- **Ultimate Identity:** git_sha

#### Fields

- app
- api
- db_schema
- pae_schema
- policy
- fixture_set
- eval_suite
- prompt
- test_pack
- agent_runtime_schema
- context_schema
- skill_manifest

### Fixture Manifest

- **File:** fixtures/manifest.json
- **Rule:** Accepted golden fixture is immutable. Changed adjudicated truth creates a new fixture version.

#### Fields

- fixture_id
- fixture_version
- schema_version
- provenance
- expected_result_version
- sha256

### Prompt Model Versioning

- **Authoritative Location:** Git
- **Model Change Rule:** Changing model triggers full frozen eval even if prompt is unchanged.

#### Change Flow

- PR
- eval harness
- frozen eval run
- baseline comparison
- review/acceptance

### Db Versioning

- **Authority:** Git-tracked SQL migrations
- **Rule:** No manual demo/production schema edit is authoritative without a committed migration.

#### Ci Paths

- empty DB -> all migrations -> current schema
- previous accepted schema -> new migration -> current schema where relevant

### Run Manifest

- **Secret Rule:** never store secrets

#### Base Fields

- git_sha
- app_version
- db_schema
- fixture_set
- fixture_id
- test_pack
- eval_suite
- prompt_version
- model_id
- pae_schema
- policy_version
- execution_mode
- ci_run_id

#### Economic Fields

- pae_reference_hash_metadata
- arc_transaction_reference
- atomic_amount
- settlement_result
- reconciliation_result

### Release Progression

- EVENT_START_BASELINE
- 0.1.0-dev
- 0.1.0-rc.1
- 0.1.0-rc.N
- 0.1.0

### Annotated Tags

- EVENT_START_BASELINE
- v0.1.0-rc.1
- v0.1.0

### Scope Exclusions

- model training/fine-tuning
- RAG/vector DB/embeddings
- runtime financial MCP
- multi-agent testing platform
- enterprise test-management product
- general observability platform
- automatic mainnet deployment
- paid penetration/certification exercise

### Synthetic Sample Generator

- **Purpose:** Generate deterministic realistic non-authoritative test/eval variants without hand-authoring hundreds of files.
- **Seed Rule:** Every generated corpus/run uses an explicit deterministic seed recorded in the fixture/eval manifest and run metadata.
- **Privacy Rule:** Synthetic generation must not derive names, IDs, addresses, bank/wallet details or documents from confidential employer/client datasets. REAL_REDACTED data remains a separately governed fixture class.
- **Golden Rule:** Generated samples never become golden truth automatically. Promotion to a golden fixture requires human/control adjudication, explicit expected result, version and hash.
- **Training Rule:** Synthetic and redacted corpora are test/eval data for P0, not model-training/fine-tuning data.
- **Authority Rule:** Generated data is never authoritative production business state and cannot be executed in a live economic lane unless explicitly promoted to an approved bounded T5 fixture.

#### Allowed Dimensions

- invoice/obligation amount
- invoice and due dates
- supplier/counterparty identity reference
- destination trust/version state
- evidence completeness
- approval limit and actor authority
- payment/execution state
- asset/network fixture within approved P0 schema
- duplicate fingerprint/idempotency scenario
- hold/cancel/external-settlement state
- prompt-injection/adversarial evidence text

### Live Arc Profiles

#### J0 Connectivity Spike

- **Purpose:** Event-period J0 infrastructure feasibility only after EVENT_START_BASELINE; not product execution.
- **Valid Pae Required:** False
- **Cannot Satisfy:** J2 product execution or judge-facing assured-payment proof

##### Requires

- explicit workflow_dispatch
- protected ARC_TESTNET environment
- exact approved SHA
- dedicated disposable non-product spike wallet/context
- tiny bounded testnet amount
- server-only credentials
- run manifest and transaction/status evidence
- no Tameion Web/product execution endpoint
- spike harness sunset/isolation after feasibility

#### Product Pae T5

- **Purpose:** J2+ Assured Payment Agent product execution.
- **Valid Pae Required:** True
- **Cannot Fallback To:** J0_CONNECTIVITY_SPIKE

##### Requires

- explicit workflow_dispatch
- protected ARC_TESTNET environment
- exact approved SHA
- approved fixed fixture
- bounded testnet amount
- valid current PAE
- server-only credentials
- transaction/status/reconciliation evidence

### Future Volume Verification Contract

- **Status:** DEFERRED_POST_P0
- **Activation Rule:** These tests become mandatory only when post-P0 batch/payment-run implementation is explicitly admitted.

#### Properties

- manifest hash changes whenever membership or authority-bearing item/header field changes
- batch consent creates no authority for an item not listed in the approved manifest
- stale item receives no approval while unchanged items may proceed
- each approved item receives independent authorized aggregate, approval, assurance, PAE and idempotency state
- one item replay/duplicate/UNKNOWN does not cause a second movement or unnecessary retry of neighboring items
- shared kill/source-wallet freeze stops all affected not-yet-submitted items
- human-visible counts/totals exactly reconcile to the immutable manifest and per-item outcomes
- manifest_hash deterministically reproduces from the unsigned manifest header + exact ordered items and excludes the derived manifest_hash field

### Agent Runtime Verification

- **Issue:** 82
- **Status:** HACKATHON_FOCUSED_SUBSET_REQUIRED_POST_HACKATHON_BREADTH_DEFERRED

#### Hackathon Required Tests

- undeclared/unregistered skill call is rejected
- Finance Agent run capability manifest contains no payment/execution/authority-mutation skill
- skill input and output schema violations fail closed
- ContextBuilder rejects cross-organization and wrong-obligation retrieval
- prompt injection embedded in evidence cannot alter skill allowlist or financial policy
- invalid/timeout/provider-failed run cannot default to PAY
- SettlementProvider/Circle capability is absent from Finance Agent skills and is reachable only by Execution Worker after PAE verification
- AgentRun binds exact governed prompt plus evidence ID/version/currentness/content hashes
- beneficiary/payment-destination change requested by email remains unverified evidence and cannot mutate destination trust
- P0 normalized email fixture can be used without live Gmail/Outlook OAuth or provider credentials

#### Post-Hackathon Reference Tests

- skill hot-addition lifecycle breadth
- historical assessment lifecycle breadth beyond event proof
- provider/model portability breadth beyond the one event adapter
- full derived-summary invalidation/regeneration lifecycle
- general provenance/reproducibility breadth beyond event-required hashes

#### Full Design-Reference Tests

- undeclared/unregistered skill call is rejected
- Finance Agent run capability manifest contains no payment/execution/authority-mutation skill
- skill added after run start is unavailable to that run
- skill input and output schema violations fail closed
- ContextBuilder rejects cross-organization and wrong-obligation retrieval
- historical/stale assessment is labeled non-authoritative and cannot become current truth
- prompt injection embedded in evidence cannot alter skill allowlist or financial policy
- invalid/timeout/provider-failed run cannot default to PAY
- provider/model change preserves application authority semantics and must pass frozen eval thresholds
- AgentRun records context/prompt/model/schema/skill-manifest/evidence hashes sufficient for reproducibility without chain-of-thought
- SettlementProvider/Circle capability is absent from Finance Agent skills and is reachable only by Execution Worker after PAE verification
- AgentRun persists prompt_hash tied to the exact governed prompt artifact used
- AgentRun persists evidence_id/version/currentness/content_hash for every model-visible source evidence item
- context_envelope_hash deterministically reproduces from the exact normalized model-visible context envelope
- email/message prompt injection remains evidence text and cannot change the frozen SkillRegistry/capability manifest
- beneficiary/payment-destination change requested by email remains unverified evidence and cannot mutate destination trust
- derived thread/context summary is invalidated or regenerated when bound source evidence is superseded/materially changed
- P0 normalized email fixture can be used without live Gmail/Outlook OAuth or provider credentials

#### Release Blockers

- any Finance Agent skill can directly move money or mutate financial authority
- raw MCP/provider/database/OS capability is exposed directly to model
- cross-organization/obligation context leakage
- unsafe PAY on agent-wrapper error
- unattributed prompt/model/skill/context version
- AgentRun cannot bind exact prompt artifact/content hash
- model-visible evidence lacks stable ID/version/currentness/content hash
- email/message evidence can mutate authority directly

### Hackathon Execution Profile — v1.4.22

- **Status:** PLANNED_NOT_ADMITTED_PRE_EVENT
- **Normal CI Workflows:** 1
- **Protected Live Arc Workflows:** 1
- **Agent Eval:** 8–12 focused cases
- **Browser E2E:** one judge-facing golden path
- **Feature Freeze:** end of event Day 11 / 2026-10-07
- **Day 11:** completion contingency for already-admitted P0 essentials only; no new scope
- **Days 12–14:** hardening only; no new product features
- **Event Delta Rule:** pre-event work may define tests theoretically, but no Tameion-specific runtime/test implementation occurs before EVENT_START_BASELINE.

Post-hackathon reference only:
- 20–30-case eval program;
- six-workflow CI decomposition;
- outbox/worker-recovery breadth;
- webhook/event-dedupe breadth;
- external/manual settlement and cancel-race breadth;
- synthetic corpus generator as a platform capability.

### Machine-Readable Companion

This Markdown file is generated from the adjacent JSON record.
Schema version: 1.0.0

## Volume Human Interaction Contract

- **Status:** POST_P0_SCALE_CONTRACT_NOT_P0_IMPLEMENTATION
- **Purpose:** Define how Tameion can scale to hundreds or thousands of obligations without forcing a human to manually click every transaction while preserving per-payment authority, safety, idempotency and evidence.
- **Core Principle:** One human interaction may express consent to an exact immutable payment-run manifest, but the batch itself is not execution authority. Each executable obligation receives its own T1 durable approval evidence, current Safety Kernel PASS, signed one-obligation PAE, idempotency key, reservation/execution state and reconciliation record.
- **Scale Invariant:** BATCH_INTERACTION_REDUCES_HUMAN_CLICKS_NOT_TRANSACTION_SPECIFIC_AUTHORITY

### P0 Relationship

- **Hackathon Rule:** P0 remains one obligation -> one T1 approval -> one Safety Kernel assurance -> one signed PAE -> one Arc payment -> one reconciliation.
- **Scope:** The volume contract is recorded to prove architectural scalability only. It is not admitted into J0-J4 and must not expand the hackathon implementation.
- **Future Activation:** Activation requires an explicit post-P0 job/milestone and schema-versioned implementation review.

### Human Operating Model

- **Shift:** Human work moves from transaction-by-transaction entry to payment-run review, exception handling, investigation and global/scope controls.
- **Default Attention Rule:** Routine unchanged eligible items are summarized into bounded review sets; material changes and unresolved exceptions are surfaced for individual attention.

#### Primary Surfaces

- PAYMENT_RUNS — exact ready set, totals, risk/change summary and batch consent
- EXCEPTIONS — stale state, missing evidence, changed destination, duplicate, high-risk, policy or authority issues
- INVESTIGATION — full evidence/decision/approval/execution/reconciliation timeline for one obligation
- CONTROLS — business hold, supplier hold, source-wallet freeze, kill switch, authority revocation

### Payment Run Manifest

- **Authority:** The manifest is review evidence and grouping metadata, not payment authority.
- **Immutability:** Once presented for human approval, the manifest is immutable. Any membership or authority-bearing field change creates a new manifest version/hash.
- **Hash Rule:** Construct unsigned_manifest = {header: exact unsigned_header_fields, items: exact canonically ordered item list}; validate canonical field formats; RFC 8785 JCS canonicalize unsigned_manifest; UTF-8 encode with no BOM/trailing newline; manifest_hash = lowercase hex SHA-256 of those bytes. The derived manifest_hash field is stored beside the manifest and is never included in its own hashed payload.

#### Required Header Fields

- payment_run_id
- organization_id
- manifest_version
- manifest_hash
- created_at
- asset
- network
- source_wallet_ref
- source_wallet_version
- item_count
- total_atomic_amount

#### Required Item Fields

- obligation_id
- reviewed_aggregate_version
- counterparty_id
- destination_ref
- destination_version
- destination_address
- atomic_amount

#### Human Summary Minimum

- item count and total amount
- counterparty count
- new/changed counterparty or destination count
- stale/excluded item count
- exception/high-risk count
- source wallet, asset and network

#### Unsigned Header Fields

- payment_run_id
- organization_id
- manifest_version
- created_at
- asset
- network
- source_wallet_ref
- source_wallet_version
- item_count
- total_atomic_amount

#### Derived Fields

- **Manifest Hash:** lowercase hex SHA-256 of the canonical unsigned manifest payload; manifest_hash is not included in the bytes it hashes

### Batch Consent Semantics

- **Interaction:** A verified T1 approver may approve one exact manifest in a single UI action after reviewing its summary and drill-down access.
- **Authority Creation:** The backend translates that consent into independent per-obligation approval transitions. For each item, expected reviewed aggregate version N must still match; that item atomically produces its own authorized aggregate N+1 and durable APPROVE record.
- **Batch Record:** A batch-consent audit record stores approver identity, manifest hash, time and outcome counts. It may link the per-obligation approvals but is not itself sufficient to seal a PAE.
- **Stale Item Rule:** If an item changed after the manifest was reviewed, only that item fails STALE_STATE / RE_REVIEW_REQUIRED and receives no approval authority. It must not inherit consent from the batch.
- **Partial Success Rule:** Unchanged eligible items may continue even when other items are stale/blocked, unless a shared hard control such as organization/global kill, source-wallet freeze or compromise makes the entire run unsafe.
- **No Open Ended Consent:** No approval such as "pay all current/future supplier invoices" is permitted. Consent always binds an explicit manifest and exact obligations.

### Per Item Execution Invariants

- one obligation authority aggregate per item
- one transaction-specific durable T1 approval per approved item
- one current deterministic Safety Kernel assurance per item
- one one-obligation signed PAE per item
- one idempotency key / atomic reservation state per item
- one independent provider submission/status lifecycle per item
- one settlement/reconciliation/evidence chain per item
- zero authority inheritance from neighboring items or batch membership

### Parallelism And Fault Isolation

- **Model:** After approval, independent obligations may be processed concurrently under bounded worker concurrency.
- **Failure Isolation:** A blocked/stale/failed/UNKNOWN item is isolated. It does not unnecessarily stop otherwise valid items.
- **Provider Unknown Rule:** UNKNOWN remains item-specific unless provider evidence proves a broader incident. Never blind-retry a batch because one transaction is UNKNOWN.
- **No Batch Pae:** There is no batch PAE replacing individual PAEs. Batch grouping optimizes human interaction and scheduling only.

#### Shared Stop Conditions

- organization/global kill switch
- source-wallet FREEZE/compromise
- provider/rail incident requiring containment
- material shared policy/authority invalidation affecting all remaining items

### Queue Model

- **Ready For Review:** pre-checked items eligible to enter an immutable payment-run manifest
- **Hold:** missing evidence/business hold/non-critical unresolved condition
- **Escalate:** material risk or authority condition requiring individual human review
- **Stale Review Required:** item changed after manifest review and must be re-evaluated
- **Submitted Confirming:** economic execution in progress; normal human action not required
- **Unknown Recovery:** external truth must be established before another economic action
- **Reconciled:** completed, matched and evidence-ready

### Exception First Routing Examples

- new or changed payment destination
- new/unverified counterparty
- unusual/high-value item under policy
- duplicate signal
- missing/contradictory evidence
- authority or policy version change
- external-settlement conflict
- provider UNKNOWN/recovery
- security freeze/kill condition

### Audit And Evidence

- **Payment Run:** retain immutable manifest/hash, presented summary, approver, decision time and per-item outcome mapping
- **Per Item:** retain individual approval, assurance, PAE, execution, provider event and reconciliation evidence
- **Replayability:** A reviewer can reconstruct exactly which obligations the human saw and which subset actually obtained execution authority.
- **Privacy:** Batch summaries minimize unnecessary evidence exposure; detailed documents are retrieved only for authorized drill-down.

### Anti Patterns

- one generic batch approval token authorizes future/unlisted obligations
- one failed item automatically retries or blocks the entire batch without a shared safety reason
- a batch manifest is recomputed after approval without a new human review
- one batch-level PAE replaces per-obligation PAEs
- the Finance Agent directly executes batch payments

## Agent Runtime Contract

- **Canonical Issue:** 82
- **Status:** ADOPTED_P0_RUNTIME_CONTRACT
- **Purpose:** Provide one bounded in-app Finance Agent runtime that can inspect scoped evidence, call typed read/analysis/proposal skills, and return structured PAY/HOLD/ESCALATE recommendations without receiving financial execution authority.
- **J1 Implementation Boundary:** Implement the minimum frozen Finance-Agent runtime inside J1; do not create a separate runtime milestone/job.
- **Financial Boundary:** Finance Agent ends at structured recommendation. T1 human approval, deterministic Safety Kernel, PAE signer and Execution Worker remain outside model authority.

### Core Principles

- MODEL_IS_DISPOSABLE_APPLICATION_STATE_IS_DURABLE
- MODEL_MEMORY_IS_NEVER_FINANCIAL_TRUTH
- MODEL_EFFECTIVE_CAPABILITY_EQUALS_EXACT_RUN_SKILL_ALLOWLIST
- FINANCE_AGENT_HAS_NO_PAYMENT_EXECUTION_OR_AUTHORITY_MUTATION_SKILL
- RAW_EXTERNAL_TOOL_CATALOGS_ARE_NEVER_DIRECTLY_EXPOSED_TO_FINANCE_AGENT
- PROVIDER_FAILURE_OR_INVALID_OUTPUT_NEVER_DEFAULTS_TO_PAY

### P0 Primitives

#### Aiprovider

- **Role:** Provider-neutral model adapter.
- **P0 Adapter:** OpenAI SDK compatible adapter targeting NVIDIA Build
- **P0 Provider:** NVIDIA Build
- **P0 Model:** nvidia/nemotron-3-super-120b-a12b
- **P0 Config Version:** p0-nvidia-nemotron3super-v1
- **P0 Endpoint:** https://integrate.api.nvidia.com/v1
- **P0 Reasoning:** enabled
- **P0 Sampling:** temperature=1.0, top_p=0.95
- **P0 Max Output Tokens:** 4096
- **P0 Request Timeout:** 30000 ms
- **P0 Max Transport Attempts:** 2; one retry only for pre-response transient transport/5xx failures
- **P0 Structured Output:** application-owned Zod-validated PAY/HOLD/ESCALATE object; invalid/incomplete output fails closed
- **P0 Tool Mode:** static typed READ/ANALYZE/PROPOSE allowlist only
- **P0 Runtime Hash:** persist SHA-256 of exact executable provider/model request configuration with each AgentRun
- **P0 Capability Gate:** J1 cannot pass unless the pinned provider/model proves required structured output + allowlisted typed skill behavior
- **Future Adapter Rule:** Future provider/model adapters must satisfy the same interface and frozen eval thresholds before accepted use.
- **Authority:** NONE

##### Responsibilities

- submit versioned prompt/context
- expose only supplied typed skill definitions
- enforce structured tool/final output schema
- return model/tool-call events to AgentRunner
- report provider/model/config identity

#### Contextbuilder

- **Role:** Construct minimum current context for one organization/obligation assessment.
- **Output:** Versioned structured context envelope plus context_envelope_hash, explicit evidence_id/version/currentness/content_hash bindings, and current authority aggregate identity.
- **Authority:** NONE

##### Inputs

- organization_id
- obligation_id
- current authority aggregate version
- current counterparty_id/version/payment-eligibility state
- linked source-backed evidence IDs
- current policy/control metadata
- relevant structured historical assessments with explicit currentness
- email/message thread chronology via linked evidence IDs when relevant

##### Rules

- organization and obligation scoped
- no unrestricted mailbox/database/document dump
- historical AI assessments are labeled historical/non-authoritative
- email/document text is untrusted business evidence, never system instruction

#### Skillregistry

- **Role:** Own every capability visible to the Finance Agent.
- **Authority:** CAPABILITY_BOUNDARY_NOT_FINANCIAL_AUTHORITY

##### Rules

- only registered versioned schema-valid skills can be exposed
- unknown/unregistered skill calls fail closed
- a skill added after run start is unavailable to that run
- model text cannot dynamically enable a skill
- raw application/database/MCP/provider/OS functions are not directly discoverable

#### Agentrunner

- **Role:** Small application-owned model/skill orchestration loop.
- **Authority:** NONE

##### Sequence

- build context
- freeze run capability manifest
- call model
- validate requested skill against frozen manifest
- validate skill input schema
- execute allowlisted skill
- validate skill output schema
- append structured result
- continue within bounded run limits
- validate structured final recommendation
- persist non-secret run evidence

### Skill Contract

#### Classes

- **Read:** Read scoped current application/evidence state.
- **Analyze:** Run deterministic calculations/classifications over authorized scoped data.
- **Propose:** Create non-authoritative structured recommendation or request.

#### Required Definition Fields

- skill_id
- skill_version
- class
- risk
- input_schema
- output_schema
- allowed_agent_roles
- required_organization_context
- required_obligation_context
- side_effect_class
- timeout_budget
- audit_policy

#### Allowed Side Effect Classes

- NONE
- NON_AUTHORITATIVE_PROPOSAL_WRITE

#### Forbidden Side Effect Classes

- FINANCIAL_EXECUTION
- AUTHORITY_MUTATION
- UNRESTRICTED_DATABASE_WRITE
- UNRESTRICTED_PROVIDER_CALL

#### P0 Examples

##### Read

- obligation.read
- evidence.read-linked
- counterparty.read
- destination.read-current
- destination.read-history
- assessment.read-history

##### Analyze

- money.calculate-atomic
- obligation.check-duplicate
- evidence.check-completeness
- destination.check-currentness

##### Propose

- decision.propose-pay
- decision.propose-hold
- decision.propose-escalate
- evidence.request-more-context

#### Explicitly Absent Finance Agent Capabilities

- send payment
- call Circle or wallet provider
- seal/sign PAE
- approve/reject as human
- change counterparty/destination verification
- change source-wallet authority
- bypass Safety Kernel
- write provider execution state
- shell/filesystem/browser/generic HTTP access

### Capability Manifest

- **Hash:** Deterministic skill/capability manifest hash stored with AgentRun evidence.
- **Immutability:** Skills/plugins registered after a run begins cannot become available to that run.
- **Validation:** Every requested skill ID/version and arguments are checked against this frozen manifest before execution.
- **Evidence Binding Manifest Hash:** Deterministic hash over the exact ordered evidence_id/version/currentness/content_hash bindings visible to the run.

#### Frozen Per Run Fields

- agent_role
- agent_version
- organization_id
- obligation_id
- aggregate_version
- context_schema_version
- context_hash
- prompt_version
- model_provider
- model_id
- model_config_version
- skill_ids_and_versions
- run_limits
- prompt_hash
- evidence_binding_manifest_hash
- context_envelope_hash

### Durable Memory

- **Authoritative Memory:** Versioned application state plus source-backed evidence in Postgres/object storage.
- **Currentness Rule:** Prior agent decisions are historical evidence only. Any authority-bearing state change requires reconstruction/reassessment against current state.
- **Restart Rule:** A fresh process/model/provider can reconstruct the current decision context from durable application state without hidden model memory.
- **Prompt Binding Rule:** prompt_version identifies the governed prompt artifact; prompt_hash is the lowercase SHA-256 of the exact UTF-8 prompt artifact bytes used for the run (or an exact composite prompt manifest when multiple governed prompt files are used). The artifact is retained/versioned in Git or equivalent governed storage.
- **Evidence Binding Rule:** Every source-backed evidence item made model-visible is recorded as evidence_id + version/currentness + stable content_hash. A mutable external reference without a retained/hash-bound content snapshot is insufficient for reproducible AgentRun evidence.
- **Context Hash Rule:** ContextBuilder emits one normalized context envelope containing organization_id, obligation_id, aggregate_version, source/evidence bindings, selected structured state and schema version. context_envelope_hash is SHA-256 over its canonical serialized bytes; this complements rather than replaces individual prompt/evidence hashes.

#### Authoritative Categories

- organization/users/authority
- counterparties/destinations/source-wallet authority
- obligations/authority aggregate
- evidence
- structured agent assessments
- approvals
- assurance records
- PAEs
- executions/provider events
- settlements/reconciliation
- audit events

#### Agent Run Persistence

- agent_run_id
- organization_id
- obligation_id
- aggregate_version
- context_hash
- model_provider
- model_id
- model_config_version
- prompt_version
- input_schema_version
- output_schema_version
- skill_manifest_hash
- skill-call IDs/input hashes/output hashes/status
- structured final decision
- evidence references
- missing-evidence/uncertainty fields
- timestamp
- duration
- outcome
- prompt_artifact_ref + prompt_hash
- evidence bindings: evidence_id + evidence_version/currentness + content_hash for every model-visible evidence item
- context_envelope_hash over the exact normalized model-visible context

#### Forbidden As Authority

- provider session memory
- hosted assistant/thread memory
- conversation recall
- model-generated summary without source references
- private chain-of-thought

#### Memory Layers

##### Working Context

- **Persistence:** EPHEMERAL_OR_SHORT_LIVED
- **Authority:** NONE
- **Rule:** May be discarded after the AgentRun once required structured evidence/hashes are persisted.

###### Examples

- current prompt context
- temporary tool results
- intermediate orchestration state

##### Authoritative Business State

- **Persistence:** DURABLE_VERSIONED
- **Authority:** AUTHORITATIVE_WITHIN_TAMEION_SCOPE

###### Examples

- obligation authority aggregate
- party/destination/source-wallet authority
- holds/approvals/PAE/execution/settlement state

##### Source Evidence Memory

- **Persistence:** DURABLE_PER_RETENTION_POLICY
- **Authority:** EVIDENCE_NOT_SELF_EXECUTING_AUTHORITY
- **Rule:** Immutable source identity/content hash plus separate currentness/supersession metadata.

###### Examples

- invoice
- email/message
- PO
- delivery evidence
- provider event

##### Decision Audit Memory

- **Persistence:** DURABLE_VERSIONED
- **Authority:** HISTORICAL_EVIDENCE
- **Rule:** Previous agent decisions never become current truth merely because they were persisted.

###### Examples

- structured agent assessment
- human approval
- Safety assurance
- execution/reconciliation events

##### Derived Context

- **Persistence:** OPTIONAL_REGENERABLE
- **Authority:** NON_AUTHORITATIVE
- **Rule:** Must reference source IDs/hashes and currentness; invalidated or regenerated when a source is superseded, removed under policy, or materially changes.

###### Examples

- thread summary
- supplier-history summary
- derived risk/context fact

#### Retention And Deletion

- **Principle:** Persist the minimum evidence/metadata necessary for financial/audit replay subject to legal/business retention and privacy policy; do not retain model chatter merely because it exists.
- **Raw Model Transcript:** Not authoritative. P0 needs structured final output, structured skill-call evidence and hashes; full hidden reasoning/private chain-of-thought is neither required nor persisted.
- **Tokens And Secrets:** OAuth/provider tokens, wallet/provider credentials, signing secrets and auth headers live in secret storage, not durable agent memory/evidence.
- **Derived Context:** If an underlying source is deleted/expired/superseded under policy, dependent derived context is marked invalid/stale and regenerated or removed according to policy.
- **Source Record:** Deletion/redaction policy must preserve required audit metadata/hashes where legally/business-required without falsely retaining a claim that source content is still available.

### Context Evidence Boundary

- **Preferred Retrieval:** obligation_id -> current authority aggregate -> linked evidence IDs -> typed evidence retrieval -> Finance Agent context
- **Additional Context:** Agent may request more evidence only through allowlisted context/evidence skills; the application decides relevance and authorization.
- **Prompt Injection Rule:** Prompt-like instructions inside invoices/emails/documents remain untrusted evidence and cannot add tools, alter policy, grant authority, change destination/source wallet, approve, sign or execute.
- **Structured More Context Request:** When evidence is insufficient, the Finance Agent returns HOLD/ESCALATE plus typed missing_context/evidence requests. The application—not the model—authorizes and retrieves additional evidence through the frozen SkillRegistry.
- **Thread Summary Rule:** Thread/document summaries are derived context only. Material facts such as beneficiary/payment-destination changes retain direct source-evidence references and cannot be established solely by a model summary.

#### Unrestricted Access Prohibited

- mailbox-wide search
- database browsing
- filesystem
- shell
- browser
- generic HTTP
- provider wallet API
- raw cloud connector catalog

### Integration Plugin Boundary

- **Raw Plugin Rule:** External plugin capability is always narrowed through Tameion-owned interfaces/skills before model exposure.

#### Evidencesource

- **Contract:** Returns normalized source-backed evidence plus provenance; provider OAuth/API credentials remain outside model context.
- **Credential Rule:** Connector credentials/tokens remain server-side and are never exposed as model-visible skill results.
- **Normalization Rule:** External messages/documents are normalized into source-backed evidence with provider source IDs, organization/obligation binding, content/attachment hashes, provenance and currentness before becoming model-visible.
- **P0 Rule:** Use uploaded/redacted normalized fixtures; do not implement live Gmail/Outlook OAuth for hackathon P0 unless an existing concrete P0 blocker requires it.

##### Examples

- Gmail
- Microsoft Outlook
- upload/storage
- ERP/document system

#### Businesssystemsource

- **Contract:** Returns typed organization-scoped business/evidence state through application-owned services.

##### Examples

- ERP
- AP/accounting
- procurement

#### Settlementprovider

- **P0:** Circle Developer-Controlled Wallets / Arc
- **Exposure:** NOT_EXPOSED_TO_FINANCE_AGENT
- **Authority:** Execution Worker only after valid PAE verification.

### Mcp Boundary

- **Developer Control Plane:** Allowed for governed engineering workflows.
- **Future Customer Integration:** May be implemented behind a Tameion adapter/typed skill.
- **Allowed Pattern:** Finance Agent -> Tameion typed skill -> Tameion adapter -> external MCP service.
- **Forbidden Pattern:** Finance Agent -> arbitrary external MCP tool catalog -> mutation/payment/shell.
- **Authority Rule:** Raw MCP capability never defines Tameion financial authority.

### Run Limits Failure Behavior

- **Safe Result:** HOLD/AGENT_ERROR or ESCALATE by deterministic wrapper policy; never implicit PAY.
- **Retry Rule:** Model-provider retry may repeat reasoning but cannot cause financial side effects because Finance Agent skills have no execution authority.

#### Bounded By

- maximum tool rounds
- maximum duration
- provider timeout/retry budget
- maximum context/evidence size
- exact skill allowlist
- structured-output schema

#### Safe Fail Cases

- unknown skill
- invalid skill args/output
- loop/run-budget exhaustion
- invalid final schema
- provider failure without safe valid decision

### Provider Portability

- **Authoritative Contract:** Application context/skills/output schemas/run evidence, not provider-hosted agent state.
- **Rule:** Tool-calling support alone does not make a provider trusted.

#### Change Flow

- explicitly select provider/model/config version
- bind the same AiProvider interface
- record provider/model/config version + SHA-256 runtime config hash
- rerun the frozen eval when provider, model, endpoint, reasoning, sampling, output-token limit, timeout/retry or structured/tool mode changes
- threshold pass
- start a new AgentRun; never mutate provider/model/config mid-run

### P0 Non Dependencies

- Agent Deck runtime
- n8n/Zapier/Activepieces runtime
- LangChain
- DeepAgents
- CrewAI
- AutoGen
- OpenClaw/Hermes/OpenCode/Codex CLI/Claude Code/Cline/Aider
- general vector/RAG memory
- multi-agent framework
- persistent vendor-hosted agent memory

### Email Evidence Ingestion

- **Status:** P0_NORMALIZED_FIXTURE_SUPPORTED_LIVE_MAILBOX_CONNECTORS_DEFERRED
- **P0 Scope:** Hackathon J0-J4 may use one genuine redacted email/message fixture or normalized JSON/.eml evidence linked to an obligation. Live Gmail/Outlook OAuth and mailbox synchronization are deferred.
- **Thread Rule:** Persist individual source-message identities/hashes and chronology. A derived thread summary may assist context selection but is non-authoritative and cannot erase/supersede the underlying messages.
- **Attachment Rule:** Attachments become separate source-backed evidence objects with their own hashes/provenance and explicit linkage to the source message.
- **Change Request Rule:** A message that requests a beneficiary/payment-destination change creates an UNVERIFIED change-request/evidence fact only. It never updates VERIFIED destination state or financial authority by itself.
- **Retrieval Rule:** ContextBuilder retrieves only obligation-linked/authorized message and attachment evidence by typed IDs. Finance Agent has no unrestricted mailbox search tool in P0.
- **Prompt Injection Rule:** Email body, quoted replies, signatures and attachments are untrusted business evidence. Prompt-like instructions cannot alter system policy, skill allowlist, counterparty/destination/source-wallet trust, approval, PAE or execution authority.
- **Currentness Rule:** Superseded/corrected messages remain immutable history; currentness is represented separately. A corrected invoice/email does not rewrite the original source record.
- **Future Search Rule:** If semantic/RAG discovery is later introduced for large mail/document estates, it is discovery-only and must return source IDs/hashes/currentness; retrieved text never becomes financial authority.

#### Future Evidence Source Auth

- **Oauth:** Use provider OAuth/authorized delegated access with the minimum practical read scope for the configured mailbox/folder/label; no mailbox password.
- **Credential Boundary:** Access/refresh tokens and provider credentials remain server-side secret material and are never placed in model context, evidence text, logs or AgentRun records.
- **Organization Binding:** Connected mailbox/account identity is bound to exactly one authorized organization integration context.

#### Normalized Email Evidence Fields

- evidence_id
- organization_id
- obligation_id
- counterparty_id
- source_provider
- source_account_ref
- provider_message_id
- provider_thread_id
- sender
- recipients
- subject
- received_at
- body_content_hash
- source_message_hash
- attachment_refs_and_hashes
- provenance_class
- currentness
- supersedes_or_superseded_by

## Machine-Readable Companion

This Markdown file is generated from the adjacent JSON record.
Schema version: 1.4.22
