# Tameion Dependency Baseline.V1

**Status:** ADOPTED
**Date:** 2026-09-24
**Canonical Issue:** 80
**Parent Blueprint Schema:** 1.4.22
**Canonical Workspace Path:** control-plane/specs/tameion/tameion-dependency-baseline.v1.json

## Package Manager

- **Name:** npm
- **Lockfile:** package-lock.json
- **Lockfile Version:** 3
- **Project Node:** 24.x
- **Install Rule:** CI uses npm ci from committed lockfile. Required peer dependencies are direct dependencies; unused optional peer ecosystems must not be auto-added solely for optional SDK integrations.
- **Pin Rule:** Initial direct dependencies use exact versions; upgrades require PR evidence rather than floating latest.

## Runtime

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

## Development

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

## External Tools

### Arc Canteen Cli

- **Version:** 0.1.17
- **Commit:** 2e46a302a22f0ca114f3cf492518058d1dc28374
- **Install:** uv tool install git+https://github.com/the-canteen-dev/ARC-cli@2e46a302a22f0ca114f3cf492518058d1dc28374
- **Runtime Authority:** False

### Circle Cli

- **Version:** 1.1.4
- **Install:** npm install -g @circle-fin/cli@1.1.4
- **Runtime Authority:** False
- **Reason Outside Lockfile:** Developer/J0 tool only; broad x402/Solana tooling is not part of application runtime.

### Supabase Cli

- **Version:** 2.117.0
- **Install:** npx --yes supabase@2.117.0
- **Runtime Authority:** False

## Platform Primitives

- node:crypto for hash/sign/verify and key operations
- crypto.randomUUID() for opaque identifiers
- built-in fetch for HTTP
- strict decimal-string to bigint parser for authoritative USDC 6-decimal atomic units
- Next route handlers instead of Express/Fastify
- Postgres SQL/RPC functions for atomic authority transitions
- Postgres durable outbox/reservation lease instead of a separate queue platform
- small internal structured/redacting logger instead of a telemetry framework

## Circle P0 Decision

- **Adopt:** @circle-fin/developer-controlled-wallets only
- **Reason:** P0 requires one server-side Arc Testnet wallet/USDC execution path. Direct DCW SDK supports ARC-TESTNET without App Kit cross-chain/swap breadth.
- **Revisit Condition:** A concrete J0/P0 blocker proves the direct DCW path cannot satisfy the required Arc execution/status/idempotency contract.

### Defer

- @circle-fin/app-kit
- @circle-fin/adapter-circle-wallets
- Bridge Kit/CCTP
- Gateway
- Earn/USYC
- direct viem/ethers
- smart-contract framework

## Ai P0 Decision

- **Rule:** If the model/provider fails the eval contract, change the model/adapter before adding orchestration breadth.

### Adopt

- one AiProvider interface
- OpenAI SDK compatible adapter
- NVIDIA Build as P0 hosted inference provider
- nvidia/nemotron-3-super-120b-a12b as pinned P0 Finance Agent model
- ContextBuilder
- SkillRegistry
- AgentRunner
- Zod structured skill/final-output validation
- versioned prompt/provider/model/context/skill/eval metadata

### Defer

- LangChain
- DeepAgents
- Vercel AI SDK
- fine-tuning framework
- general RAG/vector DB
- agent memory platform
- runtime MCP financial tool router
- multi-agent orchestration

### P0 Inference Configuration

- **Primary Provider:** NVIDIA Build
- **Pinned Model:** nvidia/nemotron-3-super-120b-a12b
- **Base URL:** https://integrate.api.nvidia.com/v1
- **Client:** OpenAI SDK compatible adapter
- **Reasoning:** enabled
- **Sampling:** temperature=1.0, top_p=0.95
- **Config Version:** p0-nvidia-nemotron3super-v1
- **Max Output Tokens:** 4096
- **Request Timeout:** 30000 ms
- **Max Transport Attempts:** 2; retry once only for pre-response transient transport/5xx failures
- **Structured Output:** Zod-validated PAY/HOLD/ESCALATE object; invalid/incomplete output fails closed
- **Tool Mode:** static typed READ/ANALYZE/PROPOSE allowlist only
- **Runtime Config Hash:** persist SHA-256 of exact executable request configuration with every AgentRun
- **Capability Smoke:** required before J1 acceptance
- **Credential:** NVIDIA_API_KEY
- **OpenAI Platform API Key:** not required
- **OpenRouter:** optional contingency only; no automatic router or silent fallback
- **Change Rule:** provider/model/endpoint/reasoning/sampling/output-token/timeout-retry/structured-output/tool-mode changes create a new config version, new run identity and require the frozen eval contract

## Data P0 Decision

- **Adopt:** Supabase/Postgres + SQL migrations + RLS/Auth/RPC as needed
- **Atomicity Rule:** Money/authority state transitions requiring atomicity are implemented as database functions/transactions, not client-side multi-call sequences.

### Defer

- Prisma
- Drizzle
- TypeORM
- Redis
- BullMQ
- Kafka
- vector database

## Ui P0 Decision

- **Adopt:** Next/React + native controls + CSS/CSS Modules
- **Revisit Condition:** Only if J3 reveals a concrete accessibility/reliability blocker before feature freeze.

### Defer

- Tailwind
- broad component library
- charting library
- form framework

## Crypto Numeric

- **Canonicalization:** json-canonicalize
- **Crypto:** Node standard cryptography; no custom cryptographic primitive
- **Money:** USDC authoritative value is bigint atomic units derived from strict decimal-string parsing; binary float is never authoritative.

## Survey Evidence

- **Date:** 2026-09-24
- **Local Action:** Do not change global SWD Node. Bootstrap Tameion with project-scoped Node 24.

### Broad Circle Candidate

- **Resolved Package Count Approx:** 791
- **Interpretation:** Rejected for P0 because cross-chain/Solana/Ethers/provider breadth is unnecessary for the one-chain proof; this is not a blanket judgment on package security.

#### Packages

- @circle-fin/app-kit@1.15.2
- @circle-fin/adapter-circle-wallets@1.8.0

#### Runtime Audit Point In Time

- **Critical:** 0
- **High:** 11
- **Moderate:** 10
- **Low:** 8
- **Total:** 29

### Adopted Candidate

- **Direct Circle Package:** @circle-fin/developer-controlled-wallets@10.8.1
- **Resolved Package Count Approx:** 525
- **Unused Optional Peer Ecosystems:** not installed as application requirements
- **Interpretation:** Point-in-time lockfile survey only; CI dependency review remains mandatory.

#### Runtime Audit Point In Time

- **Critical:** 0
- **High:** 0
- **Moderate:** 0
- **Low:** 0
- **Total:** 0

### Local Toolchain Observed

- **Node:** 22.15.1
- **Npm:** 10.9.2
- **Python:** 3.12.3
- **Uv:** 0.11.32
- **Git:** 2.43.0

## Supply Chain Policy

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

## Explicit Non Dependencies P0

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

## Mcp Policy

- **Developer Control Plane:** Allowed for engineering/governance workflows such as GitHub, documentation/reference retrieval, repository inspection and other explicitly authorized developer tooling.
- **Runtime Financial Path:** Prohibited for P0 as a generic agent-to-money router. Finance Agent -> typed application service -> Safety Kernel -> signed PAE -> Execution Worker remains the only money authority path.
- **Secrets:** Developer MCP/tools must not be given wallet private keys, PAE signing secrets or production/provider credentials unless a future narrowly scoped tool is explicitly threat-modeled and approved.
- **Scope:** MCP use for development does not become an application runtime dependency and does not grant financial authority.

## Rag Policy

- **P0:** No general RAG/vector/embedding system.
- **P0 Retrieval:** Use deterministic scoped evidence IDs/allowlisted context linked to the obligation.
- **Future Trigger:** Reconsider only when long contracts/policies/vendor history/regulatory corpora create a demonstrated retrieval need; then require provenance, tenant isolation, freshness and prompt-injection evals.

## Ci Security Tooling

- **Github Actions Pin Rule:** Every third-party GitHub Action in the Tameion product repository uses a full immutable commit SHA in uses:. A human-readable release tag/version may appear only as a comment; moving major tags such as @v4 are not sufficient for release identity.

### Secret Scanner

- **Name:** Gitleaks
- **Purpose:** blocking repository secret scan in local/CI/release gates
- **Pin Rule:** J0 bootstrap records one exact Gitleaks release/version and checksum or immutable action commit; upgrades require reviewed PR evidence
- **Config Rule:** scanner configuration is committed and versioned with the Tameion product repository

### Pii Publication Scan

- **Scope:** deterministic public-repository/demo-artifact checks for known real names, emails, account/wallet/source identifiers and prohibited fixture markers
- **Claim Limit:** This is a publication guard, not a DLP certification or guarantee of comprehensive PII detection.

## Agent Runtime Policy

- **P0 Provider Adapter:** OpenAI SDK compatible adapter targeting NVIDIA Build
- **P0 Provider:** NVIDIA Build
- **P0 Model:** nvidia/nemotron-3-super-120b-a12b
- **Fallback:** OpenRouter contingency only; no silent fallback inside an AgentRun
- **Rule:** Prefer a small typed application-owned loop. Add orchestration framework breadth only for a concrete post-P0 blocker.
- **P0 Email Connector:** No live Gmail/Outlook connector dependency. P0 consumes normalized uploaded/redacted source evidence; live mailbox OAuth remains post-P0 unless a concrete blocker is proven.

### Adopt

- application-owned AiProvider interface
- ContextBuilder
- SkillRegistry
- AgentRunner
- native provider structured tool/function calling
- Zod validation

### Defer

- general agent framework
- persistent provider agent memory
- general RAG/vector memory
- runtime financial MCP router
- business workflow engine inside money path

## Machine-Readable Companion

This Markdown file is generated from the adjacent JSON record.
Schema version: 1.0.0
