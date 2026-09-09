> Current delivery: [Implementation status](Technical-Reference/IMPLEMENTATION_STATUS.md), [adopted decisions](Technical-Reference/IMPLEMENTATION_DECISIONS.md), [implemented API](Technical-Reference/API_IMPLEMENTED.md).

# Orgo — Documentation

## Scope

Orgo is a **proprietary integrated subsystem/application** in the kOA Digital Ecosystem. It is a multi-tenant workflow and coordination system that turns signals into governed operational work through Organizations, Cases, Tasks, labels, profiles, workflows, audit and insights. Its target implementation style is a modular monolith centered on Intake, Work and Orchestration.

Orgo owns **workflow state, business authorization and its business UI**. It can run standalone. When hosted by Koali Spaces it is contributed as a `local_module_surface`; Koali hosts/composes Orgo but does not become the owner of Orgo's Tasks, Cases, Signals, Workflows, tenant rules, RBAC or UI. Orgo does not absorb the business state of Konnaxion, the epistemic state of Kristal, the linguistic runtime of SemantiK Architect, or the host/platform state of kOA-Linux.

## Canonical reading order

1. `Technical-Reference/TARGET_ARCHITECTURE.md` — canonical target architecture and migration strategy.
2. `Technical-Reference/v3/1-Orgo v3 - Database Schema Reference.md` — current physical schema reference.
3. `Technical-Reference/v3/2-Orgo v3 - Architecture and Invariants.md`
4. `Technical-Reference/v3/3-Orgo v3 - Task Case and Workflow Contract.md`
5. `Technical-Reference/v3/4-Orgo v3 - Domain Modules.md`
6. `Technical-Reference/v3/5-Orgo v3 - Labels Profiles and Cyclic Overview.md`
7. `Technical-Reference/v3/6-Orgo v3 - Insights and Analytics.md`
8. `Technical-Reference/v3/7-Orgo v3 - API Surface.md`
9. `Technical-Reference/UI_AND_KOALI_INTEGRATION.md`
10. `Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md`
11. `Technical-Reference/GLOSSARY.md`
12. `Technical-Reference/CODE_ALIGNMENT_NOTES.md`

## Core invariants

- `Organization` is the tenant boundary.
- `Work` is the central operational bounded context; it owns canonical Case/Task mutations.
- `Task` is the canonical executable unit of work.
- `Case` is the durable situation/context and primary operational workspace.
- `Signal` is a first-class accepted input/evidence object in the target architecture; the current schema still requires this persistence model to be added.
- Domain modules refine the Task/Case engine; they do not create competing core lifecycles.
- Canonical labels drive routing/classification but do not replace domain state.
- Broadcast labels are informational by default unless an explicit workflow creates work.
- Workflow evaluation is deterministic and side-effect free; an Action Executor applies resolved actions through owner services.
- Durable external/long-running effects use idempotency, an outbox/worker boundary and explicit receipts.
- Insights are read/analysis projections; actionable patterns re-enter Work as Cases/Tasks.
- External systems are orchestrated through explicit contracts; Orgo does not write their internal stores.
- Workflow state is not epistemic, civic, linguistic or platform state.
- Orgo remains standalone-capable; Koali hosting is an integration mode, not a required business dependency.
- Koali capability projections may influence presentation but never replace Orgo authorization.
- Orgo presentation profiles compose shared UI capabilities; reduced surfaces are not implemented by cloning or merely hiding a monolithic Control Panel.

## Current code reference

The supplied code snapshot contains the real Prisma schema, migrations, NestJS services/controllers, domain modules, charters and web application. The physical schema and executable code are the implementation reference; this documentation defines the aligned architecture those surfaces should implement.

## Completion delivery reference — 2026-09-09

The active implementation and its remaining external-contract boundaries are recorded in `IMPLEMENTATION_STATUS.md`. See `COMPLETION_DECISIONS.md` for durable processes, receipt predicates, Work scopes, identity and evidence semantics; `ARCHITECTURE_TO_CODE.md` for source ownership; `LOCAL_VALIDATION.md` for the final acceptance to run locally. Historical validation results do not validate the completion changes.
