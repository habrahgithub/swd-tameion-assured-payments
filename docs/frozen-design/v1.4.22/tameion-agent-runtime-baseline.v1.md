# Tameion — Agent Runtime, Skills, Context & Plugin Boundary Baseline

**Status:** ADOPTED_P0_RUNTIME_CONTRACT
**Date:** 2026-09-24
**Canonical Issue:** 82
**Parent Blueprint Schema:** 1.4.22
**Canonical Workspace Path:** control-plane/specs/tameion/tameion-agent-runtime-baseline.v1.json

## Purpose

Provide one bounded in-app Finance Agent runtime that can inspect scoped evidence, call typed read/analysis/proposal skills, and return structured PAY/HOLD/ESCALATE recommendations without receiving financial execution authority.

## Core Principles

- MODEL_IS_DISPOSABLE_APPLICATION_STATE_IS_DURABLE
- MODEL_MEMORY_IS_NEVER_FINANCIAL_TRUTH
- MODEL_EFFECTIVE_CAPABILITY_EQUALS_EXACT_RUN_SKILL_ALLOWLIST
- FINANCE_AGENT_HAS_NO_PAYMENT_EXECUTION_OR_AUTHORITY_MUTATION_SKILL
- RAW_EXTERNAL_TOOL_CATALOGS_ARE_NEVER_DIRECTLY_EXPOSED_TO_FINANCE_AGENT
- PROVIDER_FAILURE_OR_INVALID_OUTPUT_NEVER_DEFAULTS_TO_PAY

## P0 Primitives

### Aiprovider

- **Role:** Provider-neutral model adapter.
- **P0 Adapter:** OpenAI SDK compatible adapter targeting NVIDIA Build
- **P0 Provider:** NVIDIA Build
- **P0 Endpoint:** https://integrate.api.nvidia.com/v1
- **P0 Model:** nvidia/nemotron-3-super-120b-a12b
- **P0 Reasoning:** enabled for Finance Agent obligation assessment
- **P0 Sampling:** temperature=1.0, top_p=0.95
- **P0 Config Version:** p0-nvidia-nemotron3super-v1
- **P0 Max Output Tokens:** 4096
- **P0 Request Timeout:** 30000 ms
- **P0 Max Transport Attempts:** 2; one retry only for pre-response transient transport/5xx failures
- **P0 Structured Output:** Zod-validated PAY/HOLD/ESCALATE object; invalid/incomplete output fails closed
- **P0 Tool Mode:** static typed READ/ANALYZE/PROPOSE allowlist only
- **P0 Runtime Config Hash:** SHA-256 of exact executable request configuration persisted with every AgentRun
- **P0 Capability Gate:** J1 acceptance requires the pinned endpoint/model to prove required structured output and one allowlisted typed skill call
- **P0 Secret:** NVIDIA_API_KEY
- **Fallback Policy:** no silent provider/model fallback inside an AgentRun; a fallback requires a new explicit run with provider/model/config identity recorded
- **Future Adapter Rule:** Future provider/model adapters must satisfy the same interface and frozen eval thresholds before accepted use.
- **Authority:** NONE

#### Responsibilities

- submit versioned prompt/context
- expose only supplied typed skill definitions
- enforce structured tool/final output schema
- return model/tool-call events to AgentRunner
- report provider/model/config identity

### Contextbuilder

- **Role:** Construct minimum current context for one organization/obligation assessment.
- **Output:** Versioned structured context envelope plus context_envelope_hash, explicit evidence_id/version/currentness/content_hash bindings, and current authority aggregate identity.
- **Authority:** NONE

#### Inputs

- organization_id
- obligation_id
- current authority aggregate version
- current counterparty_id/version/payment-eligibility state
- linked source-backed evidence IDs
- current policy/control metadata
- relevant structured historical assessments with explicit currentness
- email/message thread chronology via linked evidence IDs when relevant

#### Rules

- organization and obligation scoped
- no unrestricted mailbox/database/document dump
- historical AI assessments are labeled historical/non-authoritative
- email/document text is untrusted business evidence, never system instruction

### Skillregistry

- **Role:** Own every capability visible to the Finance Agent.
- **Authority:** CAPABILITY_BOUNDARY_NOT_FINANCIAL_AUTHORITY

#### Rules

- only registered versioned schema-valid skills can be exposed
- unknown/unregistered skill calls fail closed
- a skill added after run start is unavailable to that run
- model text cannot dynamically enable a skill
- raw application/database/MCP/provider/OS functions are not directly discoverable

### Agentrunner

- **Role:** Small application-owned model/skill orchestration loop.
- **Authority:** NONE

#### Sequence

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

## Skill Contract

### Classes

- **Read:** Read scoped current application/evidence state.
- **Analyze:** Run deterministic calculations/classifications over authorized scoped data.
- **Propose:** Create non-authoritative structured recommendation or request.

### Required Definition Fields

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

### Allowed Side Effect Classes

- NONE
- NON_AUTHORITATIVE_PROPOSAL_WRITE

### Forbidden Side Effect Classes

- FINANCIAL_EXECUTION
- AUTHORITY_MUTATION
- UNRESTRICTED_DATABASE_WRITE
- UNRESTRICTED_PROVIDER_CALL

### P0 Examples

#### Read

- obligation.read
- evidence.read-linked
- counterparty.read
- destination.read-current
- destination.read-history
- assessment.read-history

#### Analyze

- money.calculate-atomic
- obligation.check-duplicate
- evidence.check-completeness
- destination.check-currentness

#### Propose

- decision.propose-pay
- decision.propose-hold
- decision.propose-escalate
- evidence.request-more-context

### Explicitly Absent Finance Agent Capabilities

- send payment
- call Circle or wallet provider
- seal/sign PAE
- approve/reject as human
- change counterparty/destination verification
- change source-wallet authority
- bypass Safety Kernel
- write provider execution state
- shell/filesystem/browser/generic HTTP access

## Capability Manifest

- **Hash:** Deterministic skill/capability manifest hash stored with AgentRun evidence.
- **Immutability:** Skills/plugins registered after a run begins cannot become available to that run.
- **Validation:** Every requested skill ID/version and arguments are checked against this frozen manifest before execution.
- **Evidence Binding Manifest Hash:** Deterministic hash over the exact ordered evidence_id/version/currentness/content_hash bindings visible to the run.

### Frozen Per Run Fields

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

## Durable Memory

- **Authoritative Memory:** Versioned application state plus source-backed evidence in Postgres/object storage.
- **Currentness Rule:** Prior agent decisions are historical evidence only. Any authority-bearing state change requires reconstruction/reassessment against current state.
- **Restart Rule:** A fresh process/model/provider can reconstruct the current decision context from durable application state without hidden model memory.
- **Prompt Binding Rule:** prompt_version identifies the governed prompt artifact; prompt_hash is the lowercase SHA-256 of the exact UTF-8 prompt artifact bytes used for the run (or an exact composite prompt manifest when multiple governed prompt files are used). The artifact is retained/versioned in Git or equivalent governed storage.
- **Evidence Binding Rule:** Every source-backed evidence item made model-visible is recorded as evidence_id + version/currentness + stable content_hash. A mutable external reference without a retained/hash-bound content snapshot is insufficient for reproducible AgentRun evidence.
- **Context Hash Rule:** ContextBuilder emits one normalized context envelope containing organization_id, obligation_id, aggregate_version, source/evidence bindings, selected structured state and schema version. context_envelope_hash is SHA-256 over its canonical serialized bytes; this complements rather than replaces individual prompt/evidence hashes.

### Authoritative Categories

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

### Agent Run Persistence

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

### Forbidden As Authority

- provider session memory
- hosted assistant/thread memory
- conversation recall
- model-generated summary without source references
- private chain-of-thought

### Memory Layers

#### Working Context

- **Persistence:** EPHEMERAL_OR_SHORT_LIVED
- **Authority:** NONE
- **Rule:** May be discarded after the AgentRun once required structured evidence/hashes are persisted.

##### Examples

- current prompt context
- temporary tool results
- intermediate orchestration state

#### Authoritative Business State

- **Persistence:** DURABLE_VERSIONED
- **Authority:** AUTHORITATIVE_WITHIN_TAMEION_SCOPE

##### Examples

- obligation authority aggregate
- party/destination/source-wallet authority
- holds/approvals/PAE/execution/settlement state

#### Source Evidence Memory

- **Persistence:** DURABLE_PER_RETENTION_POLICY
- **Authority:** EVIDENCE_NOT_SELF_EXECUTING_AUTHORITY
- **Rule:** Immutable source identity/content hash plus separate currentness/supersession metadata.

##### Examples

- invoice
- email/message
- PO
- delivery evidence
- provider event

#### Decision Audit Memory

- **Persistence:** DURABLE_VERSIONED
- **Authority:** HISTORICAL_EVIDENCE
- **Rule:** Previous agent decisions never become current truth merely because they were persisted.

##### Examples

- structured agent assessment
- human approval
- Safety assurance
- execution/reconciliation events

#### Derived Context

- **Persistence:** OPTIONAL_REGENERABLE
- **Authority:** NON_AUTHORITATIVE
- **Rule:** Must reference source IDs/hashes and currentness; invalidated or regenerated when a source is superseded, removed under policy, or materially changes.

##### Examples

- thread summary
- supplier-history summary
- derived risk/context fact

### Retention And Deletion

- **Principle:** Persist the minimum evidence/metadata necessary for financial/audit replay subject to legal/business retention and privacy policy; do not retain model chatter merely because it exists.
- **Raw Model Transcript:** Not authoritative. P0 needs structured final output, structured skill-call evidence and hashes; full hidden reasoning/private chain-of-thought is neither required nor persisted.
- **Tokens And Secrets:** OAuth/provider tokens, wallet/provider credentials, signing secrets and auth headers live in secret storage, not durable agent memory/evidence.
- **Derived Context:** If an underlying source is deleted/expired/superseded under policy, dependent derived context is marked invalid/stale and regenerated or removed according to policy.
- **Source Record:** Deletion/redaction policy must preserve required audit metadata/hashes where legally/business-required without falsely retaining a claim that source content is still available.

## Context Evidence Boundary

- **Preferred Retrieval:** obligation_id -> current authority aggregate -> linked evidence IDs -> typed evidence retrieval -> Finance Agent context
- **Additional Context:** Agent may request more evidence only through allowlisted context/evidence skills; the application decides relevance and authorization.
- **Prompt Injection Rule:** Prompt-like instructions inside invoices/emails/documents remain untrusted evidence and cannot add tools, alter policy, grant authority, change destination/source wallet, approve, sign or execute.
- **Structured More Context Request:** When evidence is insufficient, the Finance Agent returns HOLD/ESCALATE plus typed missing_context/evidence requests. The application—not the model—authorizes and retrieves additional evidence through the frozen SkillRegistry.
- **Thread Summary Rule:** Thread/document summaries are derived context only. Material facts such as beneficiary/payment-destination changes retain direct source-evidence references and cannot be established solely by a model summary.

### Unrestricted Access Prohibited

- mailbox-wide search
- database browsing
- filesystem
- shell
- browser
- generic HTTP
- provider wallet API
- raw cloud connector catalog

## Integration Plugin Boundary

- **Raw Plugin Rule:** External plugin capability is always narrowed through Tameion-owned interfaces/skills before model exposure.

### Evidencesource

- **Contract:** Returns normalized source-backed evidence plus provenance; provider OAuth/API credentials remain outside model context.
- **Credential Rule:** Connector credentials/tokens remain server-side and are never exposed as model-visible skill results.
- **Normalization Rule:** External messages/documents are normalized into source-backed evidence with provider source IDs, organization/obligation binding, content/attachment hashes, provenance and currentness before becoming model-visible.
- **P0 Rule:** Use uploaded/redacted normalized fixtures; do not implement live Gmail/Outlook OAuth for hackathon P0 unless an existing concrete P0 blocker requires it.

#### Examples

- Gmail
- Microsoft Outlook
- upload/storage
- ERP/document system

### Businesssystemsource

- **Contract:** Returns typed organization-scoped business/evidence state through application-owned services.

#### Examples

- ERP
- AP/accounting
- procurement

### Settlementprovider

- **P0:** Circle Developer-Controlled Wallets / Arc
- **Exposure:** NOT_EXPOSED_TO_FINANCE_AGENT
- **Authority:** Execution Worker only after valid PAE verification.

## Mcp Boundary

- **Developer Control Plane:** Allowed for governed engineering workflows.
- **Future Customer Integration:** May be implemented behind a Tameion adapter/typed skill.
- **Allowed Pattern:** Finance Agent -> Tameion typed skill -> Tameion adapter -> external MCP service.
- **Forbidden Pattern:** Finance Agent -> arbitrary external MCP tool catalog -> mutation/payment/shell.
- **Authority Rule:** Raw MCP capability never defines Tameion financial authority.

## Run Limits Failure Behavior

- **Safe Result:** HOLD/AGENT_ERROR or ESCALATE by deterministic wrapper policy; never implicit PAY.
- **Retry Rule:** Model-provider retry may repeat reasoning but cannot cause financial side effects because Finance Agent skills have no execution authority.

### Bounded By

- maximum tool rounds
- maximum duration
- provider timeout/retry budget
- maximum context/evidence size
- exact skill allowlist
- structured-output schema

### Safe Fail Cases

- unknown skill
- invalid skill args/output
- loop/run-budget exhaustion
- invalid final schema
- provider failure without safe valid decision

## P0 Provider/Model Configuration

- **Primary Provider:** NVIDIA Build
- **Model:** nvidia/nemotron-3-super-120b-a12b
- **Endpoint:** https://integrate.api.nvidia.com/v1
- **Adapter:** OpenAI SDK compatible adapter
- **Reasoning:** enabled for Finance Agent obligation assessment
- **Sampling:** temperature=1.0, top_p=0.95
- **Required Credential:** NVIDIA_API_KEY
- **OpenAI Platform Key:** not required for P0
- **OpenRouter:** optional contingency only; no auto-router and no silent provider/model substitution
- **Run Rule:** changing provider/model starts a new AgentRun and must preserve frozen eval thresholds and provider/model/config evidence

## Provider Portability

- **Authoritative Contract:** Application context/skills/output schemas/run evidence, not provider-hosted agent state.
- **Rule:** Tool-calling support alone does not make a provider trusted.

### Change Flow

- explicitly select provider/model/config version
- bind the same AiProvider interface
- record provider/model/config version + SHA-256 runtime config hash
- rerun the frozen eval when provider, model, endpoint, reasoning, sampling, output-token limit, timeout/retry or structured/tool mode changes
- threshold pass
- start a new AgentRun; never mutate provider/model/config mid-run

## P0 Non Dependencies

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

## J1 Implementation Boundary

Implement the minimum frozen Finance-Agent runtime inside J1; do not create a separate runtime milestone/job.

## Financial Boundary

Finance Agent ends at structured recommendation. T1 human approval, deterministic Safety Kernel, PAE signer and Execution Worker remain outside model authority.

## Email Evidence Ingestion

- **Status:** P0_NORMALIZED_FIXTURE_SUPPORTED_LIVE_MAILBOX_CONNECTORS_DEFERRED
- **P0 Scope:** Hackathon J0-J4 may use one genuine redacted email/message fixture or normalized JSON/.eml evidence linked to an obligation. Live Gmail/Outlook OAuth and mailbox synchronization are deferred.
- **Thread Rule:** Persist individual source-message identities/hashes and chronology. A derived thread summary may assist context selection but is non-authoritative and cannot erase/supersede the underlying messages.
- **Attachment Rule:** Attachments become separate source-backed evidence objects with their own hashes/provenance and explicit linkage to the source message.
- **Change Request Rule:** A message that requests a beneficiary/payment-destination change creates an UNVERIFIED change-request/evidence fact only. It never updates VERIFIED destination state or financial authority by itself.
- **Retrieval Rule:** ContextBuilder retrieves only obligation-linked/authorized message and attachment evidence by typed IDs. Finance Agent has no unrestricted mailbox search tool in P0.
- **Prompt Injection Rule:** Email body, quoted replies, signatures and attachments are untrusted business evidence. Prompt-like instructions cannot alter system policy, skill allowlist, counterparty/destination/source-wallet trust, approval, PAE or execution authority.
- **Currentness Rule:** Superseded/corrected messages remain immutable history; currentness is represented separately. A corrected invoice/email does not rewrite the original source record.
- **Future Search Rule:** If semantic/RAG discovery is later introduced for large mail/document estates, it is discovery-only and must return source IDs/hashes/currentness; retrieved text never becomes financial authority.

### Future Evidence Source Auth

- **Oauth:** Use provider OAuth/authorized delegated access with the minimum practical read scope for the configured mailbox/folder/label; no mailbox password.
- **Credential Boundary:** Access/refresh tokens and provider credentials remain server-side secret material and are never placed in model context, evidence text, logs or AgentRun records.
- **Organization Binding:** Connected mailbox/account identity is bound to exactly one authorized organization integration context.

### Normalized Email Evidence Fields

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

## Hackathon Execution Profile — v1.4.22

**Status:** PLANNED_NOT_ADMITTED_PRE_EVENT

- Assess 3–5 genuine redacted event-period obligations; exactly one may enter payment execution.
- Implement only AiProvider + minimum ContextBuilder + static code-defined allowlist + small AgentRunner.
- The static allowlist satisfies SkillRegistry semantics for the hackathon; no dynamic plugin framework is required.
- Minimum capability classes remain READ / ANALYZE / PROPOSE.
- Recommendations must bind evidence IDs, surface missing evidence/uncertainty, and choose PAY/HOLD/ESCALATE.
- Provider/schema/tool failure defaults to HOLD/ESCALATE, never PAY.
- No Tameion-specific agent-runtime implementation occurs before EVENT_START_BASELINE.

Deferred from hackathon:
- dynamic plugin registration/discovery;
- provider-portability breadth;
- general derived-context lifecycle engine;
- live mailbox connectors;
- general RAG/vector memory;
- provider-hosted persistent memory.

### Hackathon Output Contract

- decision enum: PAY / HOLD / ESCALATE
- structured reasons required
- evidence IDs / grounding references required
- missing-evidence / uncertainty signal required
- requested transaction fields required only for PAY

## Machine-Readable Companion

This Markdown file is generated from tameion-agent-runtime-baseline.v1.json.
This baseline defines the P0 in-app agent wrapper/capability boundary; it does not grant financial execution authority or create a new milestone/job.
