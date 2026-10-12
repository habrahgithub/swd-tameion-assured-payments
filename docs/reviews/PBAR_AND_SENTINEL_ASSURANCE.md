# Tameion review methods: PBAR and SENTINEL

**Status:** Terminology clarification (2026-10-12) — documentation only. This file does **not** amend the frozen product blueprint, admit new work, certify a deployed build, or authorize live provider/database/financial actions.

## Naming correction

**PBAR means Pattern-Based Architecture Review.** It is a lightweight evaluation of software **architecture patterns** and their effect on **quality attributes**. It does **not** mean "Perspective-Based Assurance Review."

Tameion's existing seven-perspective independent assessment is called **SENTINEL Assurance Review**. These are complementary and not interchangeable.

| Method | Main focus | Review evidence |
| --- | --- | --- |
| **PBAR — Pattern-Based Architecture Review** | Architecture patterns, their interactions and quality-attribute tradeoffs | Exact architecture snapshot, design decisions, pattern/quality matrix, risk-ranked findings |
| **SENTINEL Assurance Review** | Seven Tameion-specific safety/evidence perspectives | Exact source/packet/reviewer identities, negative tests, contracts and runtime receipts |
| **RCA / 5 Whys** | Cause of a reproduced defect | Reproduction, supported explanation, corrected behavior and regressions |
| **Deterministic verification / UAT** | Actual correctness in tests and operator workflow | Case-by-case PASS/FAIL/NOT_RUN, exact environment, live/simulated provenance |

## PBAR evaluation for the Tameion architecture

Review the actual design and source version against its declared requirements and the relevant established patterns—not against a generic AWS service checklist.

| Tameion boundary | Architecture/pattern questions | Quality attributes |
| --- | --- | --- |
| **Next.js / Vercel API** | Are server/client boundaries, privileged-route access, trusted ingress and request authorization consistently enforced? | Security, operability, reliability |
| **PostgreSQL / durable authority** | Are transactions, constrained state transitions, immutable receipts, failure/partial-state handling and row/role access properly separated? | Data integrity, reliability, auditability |
| **ERP input / obligation contracts** | Is the source system authoritative for its business facts while Tameion separately decides assurance eligibility? | Modifiability, data integrity, consistency |
| **Circle Developer-Controlled Wallets / Arc** | Are provider reads, idempotent writes, evidence provenance, wallet/asset/network identity, decimal precision, pagination completeness and reconciliation handled as distinct contracts? | Security, correctness, reliability |
| **AI assessment / deterministic Safety Kernel / signed PAE** | Are advisory PAY/HOLD/ESCALATE decisions separated from current human authorization, deterministic gates, evidence and execution permissions? | Safety, separation of duties, explainability |
| **Local/cloud DevOps runners** | Are writer ownership, artifact identity, secrets/egress restrictions, reproducible checks and independent reviews maintained? | Operational excellence, supply-chain integrity, cost |

When assessing provider balance: an **incomplete paginated response must not be represented as a verified zero**. A verified snapshot does not grant payment or preflight authority. No assurance means no execution.

PBAR's report should include the reviewed baseline, architectural patterns and quality objectives, assumptions, concrete evidence, **High/Medium/Low** findings, remediation owner and verification path. An architecture-only PASS is not proof of a working preview or a genuine Arc transaction.

## Seven SENTINEL assurance perspectives

1. **Authority:** current human grant, expiry/revocation and exact effect scope.
2. **Ownership:** one accountable writer, independent reviewer and unambiguous escalation.
3. **Identity:** source obligation/version, selected intent, wallet/asset, packet/hash, environment and evidence identity.
4. **Logic:** legal state transitions, deterministic outcomes and final authority rechecks.
5. **Contradiction:** mismatch between UI, API, database, historical artifacts and provider truth.
6. **Regression:** focused negative tests, replay/concurrency cases and prior accepted behavior.
7. **Risk:** unintended payment, partial/unknown effects, privacy/credential exposure, recovery uncertainty and safety margins.

A SENTINEL PASS is **scoped evidence**, not standing operational approval. Preserve the separation of architecture review, exact-head implementation review, owner UAT and provider-backed financial proof. Historical Safety Kernel PASS/PAE evidence is not current permission to execute.

## Review and delivery authority

Within Tameion's current project-specific routing, **PRIME → AXIS → FORGE → independent SENTINEL**, with AXIS adjudicating and PRIME retaining owner-only security, SQL, protected deployment, credential, live provider and financial gates as recorded in the active issues. **ATLAS is out of commission.** Naming these actors does not itself reserve a runner or prove the handoff.

Preserve existing task-specific one-run restrictions and the unresolved original obligation 003 authorization state. No review report, code-only candidate, simulated demo, CI PASS or screenshot substitutes for end-to-end PRIME acceptance or real provider reconciliation.

**Reference:** Neil B. Harrison and Paris Avgeriou, "Pattern-Based Architecture Reviews," *IEEE Software* 28(6), 66–71 (2011), https://doi.org/10.1109/MS.2010.156.
