> **Release baseline:** [RC1 status](status/2026-09-10-rc1-status.md) (`v0.1.0-rc.1`, commit `60e3a250f98252735839816c8e0143bbdd7546bf`) remains the immutable tagged release-candidate baseline. The current development-tree evidence is recorded in [2026-09-15 current status](status/2026-09-15-current-status.md).

# Orgo — Documentation

## Scope

Orgo is an **Orgo-owned integrated subsystem/application** in the kOA Digital Ecosystem. It is a multi-tenant workflow and coordination system that turns signals into governed operational work through Organizations, Cases, Tasks, labels, profiles, workflows, audit and insights. Its implementation style is a modular monolith centered on Intake, Work and Orchestration.

Orgo owns **workflow state, business authorization and its business UI**. It can run standalone. When hosted by Koali Spaces it is contributed as a `local_module_surface`; Koali hosts/composes Orgo but does not become the owner of Orgo's Tasks, Cases, Signals, Workflows, tenant rules, RBAC or UI. Orgo does not absorb the business state of Konnaxion, the epistemic state of Kristal, the linguistic runtime of SemantiK Architect, or the host/platform state of kOA-Linux.

The repository is licensed under AGPL-3.0-or-later; ownership boundaries in this documentation describe runtime/domain authority, not a proprietary software license.

## Canonical reading order

1. `Technical-Reference/IMPLEMENTATION_STATUS.md` — current implementation and validation status.
2. `Technical-Reference/TARGET_ARCHITECTURE.md` — canonical target architecture and migration strategy.
3. `Technical-Reference/v3/1-Orgo v3 - Database Schema Reference.md` — historical v3 schema baseline; executable Prisma/migrations and `IMPLEMENTATION_STATUS.md` are current authority.
4. `Technical-Reference/v3/2-Orgo v3 - Architecture and Invariants.md`
5. `Technical-Reference/v3/3-Orgo v3 - Task Case and Workflow Contract.md`
6. `Technical-Reference/v3/4-Orgo v3 - Domain Modules.md`
7. `Technical-Reference/v3/5-Orgo v3 - Labels Profiles and Cyclic Overview.md`
8. `Technical-Reference/v3/6-Orgo v3 - Insights and Analytics.md`
9. `Technical-Reference/v3/7-Orgo v3 - API Surface.md`
10. `Technical-Reference/UI_AND_KOALI_INTEGRATION.md`
11. `Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md`
12. `Technical-Reference/GLOSSARY.md`
13. `Technical-Reference/INTERACTION_KERNEL.md` — target kOA interoperability profile for this snapshot; implementation is not claimed here.
14. `Technical-Reference/CODE_ALIGNMENT_NOTES.md`

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
- External systems are orchestrated through explicit contracts; Orgo does not write their internal stores. The current snapshot uses the generic bridge; the kOA target is Interaction Kernel (IK) with Da’at for Kristal-facing workflows.
- Workflow state is not epistemic, civic, linguistic or platform state.
- Orgo remains standalone-capable; Koali hosting is an integration mode, not a required business dependency.
- Koali capability projections may influence presentation but never replace Orgo authorization.
- Orgo presentation profiles compose shared UI capabilities; reduced surfaces are not implemented by cloning or merely hiding a monolithic Control Panel.

## Current code and validation reference

Executable source, Prisma schema/migrations and active tests are the implementation reference. `Technical-Reference/IMPLEMENTATION_STATUS.md` records the current implemented surface and the validation evidence available for it.

The tagged RC1 baseline remains `v0.1.0-rc.1` / `60e3a250f98252735839816c8e0143bbdd7546bf`. The development application baseline at commit `167f672998075b83ff72ac73f10d550f3ea73e9b` was exercised on 2026-09-15 with all 12 required `deep` levels passing and a separate 24/24 Chromium browser campaign passing. The `deep` wrapper itself reported target-protection `ERROR` because the successful Next.js build rewrote tracked `apps/web/next-env.d.ts`; see `status/2026-09-15-current-status.md` for the exact interpretation and remaining boundaries.

See `COMPLETION_DECISIONS.md` for durable processes, receipt predicates, Work scopes, identity and evidence semantics; `ARCHITECTURE_TO_CODE.md` for source ownership; and `LOCAL_VALIDATION.md` for the reproducible local acceptance procedure.
