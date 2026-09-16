# Orgo

Orgo is an Orgo-owned, multi-tenant workflow and coordination application in the kOA Digital Ecosystem. It turns accepted Signals into governed operational Work through Organizations, Cases, Tasks, workflows, routing, audit and insights.

Orgo owns its workflow state, business authorization and business UI. It can run standalone. Hosted composition does not transfer authority over Orgo Tasks, Cases, Signals, Workflows, tenant rules or RBAC to the host.

The repository is licensed under AGPL-3.0-or-later.

## Documentation

The canonical documentation entry point is [`docs/README.md`](docs/README.md).

Recommended reading:

1. [`docs/Technical-Reference/IMPLEMENTATION_STATUS.md`](docs/Technical-Reference/IMPLEMENTATION_STATUS.md) — implemented surface and dated validation evidence.
2. [`docs/Technical-Reference/TARGET_ARCHITECTURE.md`](docs/Technical-Reference/TARGET_ARCHITECTURE.md) — architectural target and invariants.
3. [`docs/Technical-Reference/ARCHITECTURE_TO_CODE.md`](docs/Technical-Reference/ARCHITECTURE_TO_CODE.md) — architecture-to-source ownership map.
4. [`docs/Technical-Reference/API_IMPLEMENTED.md`](docs/Technical-Reference/API_IMPLEMENTED.md) — implemented HTTP route inventory.
5. [`docs/Technical-Reference/LOCAL_VALIDATION.md`](docs/Technical-Reference/LOCAL_VALIDATION.md) — reproducible local validation procedure.
6. [`docs/Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md`](docs/Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md) — Orgo and ecosystem ownership boundaries.
7. [`docs/Technical-Reference/GLOSSARY.md`](docs/Technical-Reference/GLOSSARY.md) — shared terminology.

Dated release/development evidence is kept under [`docs/status/`](docs/status/).

## Core invariants

- `Organization` is the tenant boundary.
- `Work` owns canonical Case/Task mutations.
- `Task` is the canonical executable unit of work.
- `Case` is the durable situation/context and primary operational workspace.
- `Signal` is a first-class persisted accepted-input/evidence object.
- Workflow evaluation is deterministic and side-effect free; owner services apply resolved actions.
- Durable external or long-running effects use idempotency, outbox/worker boundaries and explicit receipts.
- Insights are read/analysis projections and do not own operational state.
- External systems are reached through explicit ports/adapters; Orgo does not write their internal stores.
- Koali hosting is optional and never replaces Orgo authorization.

## Implementation authority

Executable source, `apps/api/prisma/schema.prisma`, the current Prisma migration baseline, active tests and generated route inventory are the implementation authority. Architecture documents describe intended ownership and constraints; they are not proof that a feature exists unless the implementation/status documents and source support it.
