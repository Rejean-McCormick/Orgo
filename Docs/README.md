# Orgo — Documentation

## Scope

Orgo is an **ecosystem system** in the kOA Digital Ecosystem. It is a multi-tenant workflow and coordination system that turns signals into governed operational work through Organizations, Cases, Tasks, labels, profiles, workflows, audit and insights.

Orgo owns **workflow state**. It does not absorb the business state of Konnaxion, the epistemic state of Kristal, the linguistic runtime of SemantiK Architect, or the host/platform state of kOA-Linux.

## Canonical reading order

1. `Technical-Reference/v3/1-Orgo v3 - Database Schema Reference.md`
2. `Technical-Reference/v3/2-Orgo v3 - Architecture and Invariants.md`
3. `Technical-Reference/v3/3-Orgo v3 - Task Case and Workflow Contract.md`
4. `Technical-Reference/v3/4-Orgo v3 - Domain Modules.md`
5. `Technical-Reference/v3/5-Orgo v3 - Labels Profiles and Cyclic Overview.md`
6. `Technical-Reference/v3/6-Orgo v3 - Insights and Analytics.md`
7. `Technical-Reference/v3/7-Orgo v3 - API Surface.md`
8. `Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md`
9. `Technical-Reference/GLOSSARY.md`
10. `Technical-Reference/CODE_ALIGNMENT_NOTES.md`

## Core invariants

- `Organization` is the tenant boundary.
- `Task` is the canonical unit of work.
- `Case` is the durable container for related work/context.
- Domain modules refine the Task/Case engine; they do not create competing core lifecycles.
- Canonical labels drive routing/classification but do not replace domain state.
- Broadcast labels are informational by default unless an explicit workflow creates work.
- Insights are read/analysis projections; actionable patterns re-enter the core as Cases/Tasks.
- External systems are orchestrated through explicit contracts; Orgo does not write their internal stores.
- Workflow state is not epistemic, civic, linguistic or platform state.

## Current code reference

The supplied code snapshot contains the real Prisma schema, migrations, NestJS services/controllers, domain modules, charters and web application. The physical schema and executable code are the implementation reference; this documentation defines the aligned architecture those surfaces should implement.
