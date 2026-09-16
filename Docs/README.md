> **Dated validation evidence:** [2026-09-15 current status](status/2026-09-15-current-status.md) records the most recent completed application validation campaign retained in this repository. [2026-09-16 ecosystem integration alignment](status/2026-09-16-ecosystem-integration-alignment.md) is documentation-only and does not claim a new validation run.

# Orgo — Documentation

## Scope

Orgo is an **Orgo-owned integrated subsystem/application** in the kOA Digital Ecosystem. It is a multi-tenant workflow and coordination system that turns signals into governed operational work through Organizations, Cases, Tasks, labels, profiles, workflows, audit and insights. Its implementation style is a modular monolith centered on Intake, Work and Orchestration.

Orgo owns **workflow state, business authorization and its business UI**. It can run standalone. When hosted, the host composes Orgo but does not become the owner of Orgo's Tasks, Cases, Signals, Workflows, tenant rules, RBAC or UI. Orgo does not absorb the business state of Konnaxion, the epistemic state of Kristal, the linguistic runtime of SemantiK Architect, or the host/platform state of kOA-Linux.

The repository is licensed under AGPL-3.0-or-later; ownership boundaries in this documentation describe runtime/domain authority, not a proprietary software license.

## Canonical reading order

1. `Technical-Reference/IMPLEMENTATION_STATUS.md` — implemented surface and dated validation evidence.
2. `Technical-Reference/TARGET_ARCHITECTURE.md` — canonical architectural target and invariants.
3. `Technical-Reference/ARCHITECTURE_TO_CODE.md` — ownership map from architecture to active source.
4. `Technical-Reference/API_IMPLEMENTED.md` — implemented HTTP route inventory.
5. `Technical-Reference/v3/1-Orgo v3 - Database Schema Reference.md` — physical schema reference; executable Prisma schema/migrations remain authority.
6. `Technical-Reference/v3/2-Orgo v3 - Architecture and Invariants.md`
7. `Technical-Reference/v3/3-Orgo v3 - Task Case and Workflow Contract.md`
8. `Technical-Reference/v3/4-Orgo v3 - Domain Modules.md`
9. `Technical-Reference/v3/5-Orgo v3 - Labels Profiles and Cyclic Overview.md`
10. `Technical-Reference/v3/6-Orgo v3 - Insights and Analytics.md`
11. `Technical-Reference/v3/7-Orgo v3 - API Surface.md`
12. `Technical-Reference/UI_AND_KOALI_INTEGRATION.md`
13. `Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md`
14. `Technical-Reference/GLOSSARY.md`
15. `Technical-Reference/LOCAL_VALIDATION.md`

## Core invariants

- `Organization` is the tenant boundary.
- `Work` is the central operational bounded context; it owns canonical Case/Task mutations.
- `Task` is the canonical executable unit of work.
- `Case` is the durable situation/context and primary operational workspace.
- `Signal` is a first-class durable accepted input/evidence object; persistence, deduplication/fingerprint conflict handling and pinned workflow-version behavior are implemented.
- Domain modules refine the Task/Case engine; they do not create competing core lifecycles.
- Canonical labels drive routing/classification but do not replace domain state.
- Broadcast labels are informational by default unless an explicit workflow creates work.
- Workflow evaluation is deterministic and side-effect free; an Action Executor applies resolved actions through owner services.
- Durable external/long-running effects use idempotency, an outbox/worker boundary and explicit receipts.
- Insights are read/analysis projections; actionable patterns re-enter Work as Cases/Tasks.
- External systems are orchestrated through explicit contracts; Orgo does not write their internal stores.
- Workflow state is not epistemic, civic, linguistic or platform state.
- Orgo remains standalone-capable; hosting is an integration mode, not a required business dependency.
- Host capability projections may influence presentation but never replace Orgo authorization.

## Current code and validation reference

Executable source, Prisma schema/migrations and active tests are the implementation reference. `Technical-Reference/IMPLEMENTATION_STATUS.md` records the implemented surface and the dated validation evidence available for it.

The repository now uses a single Prisma migration baseline under `apps/api/prisma/migrations/00000000000000_initial/`. Future schema changes should be represented by new migrations from that baseline rather than by restoring discarded migration history.

The 2026-09-15 validation evidence predates the repository-cleanup work that flattened migrations and removed obsolete historical material. Re-run `Technical-Reference/LOCAL_VALIDATION.md` after structural changes before treating the current working tree as validated.

See `Technical-Reference/COMPLETION_DECISIONS.md` for durable processes, receipt predicates, Work scopes, identity and evidence semantics; `Technical-Reference/ARCHITECTURE_TO_CODE.md` for source ownership; and `Technical-Reference/LOCAL_VALIDATION.md` for the reproducible local acceptance procedure.
