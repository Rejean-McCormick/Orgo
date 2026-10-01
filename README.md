# Orgo

Orgo is an Orgo-owned, multi-tenant workflow and coordination application in the kOA Digital Ecosystem. It turns accepted Signals into governed operational Work through Organizations, Cases, Tasks, workflows, routing, audit and insights.

Orgo owns its workflow state, business authorization and business UI. It can run standalone. Hosted composition does not transfer authority over Orgo Tasks, Cases, Signals, Workflows, tenant rules or RBAC to the host.

The repository is licensed under AGPL-3.0-or-later.

## Documentation

The canonical documentation entry point is [`docs/README.md`](docs/README.md).

Recommended reading:

1. [`docs/Technical-Reference/IMPLEMENTATION_STATUS.md`](docs/Technical-Reference/IMPLEMENTATION_STATUS.md) — implemented surface and dated validation evidence.
2. [`docs/status/2026-10-01-kristal-v6-integration.md`](docs/status/2026-10-01-kristal-v6-integration.md) — Kristal v6 / IK v2 integration update.
3. [`docs/status/2026-09-17-acceptance-status.md`](docs/status/2026-09-17-acceptance-status.md) — latest full production-acceptance campaign retained in the repository.
4. [`docs/Technical-Reference/TARGET_ARCHITECTURE.md`](docs/Technical-Reference/TARGET_ARCHITECTURE.md) — architectural target and invariants.
5. [`docs/Technical-Reference/ARCHITECTURE_TO_CODE.md`](docs/Technical-Reference/ARCHITECTURE_TO_CODE.md) — architecture-to-source ownership map.
6. [`docs/Technical-Reference/API_IMPLEMENTED.md`](docs/Technical-Reference/API_IMPLEMENTED.md) — implemented HTTP route inventory.
7. [`docs/Technical-Reference/LOCAL_VALIDATION.md`](docs/Technical-Reference/LOCAL_VALIDATION.md) — reproducible local validation procedure.
8. [`docs/Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md`](docs/Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md) — Orgo and ecosystem ownership boundaries.
9. [`docs/Technical-Reference/GLOSSARY.md`](docs/Technical-Reference/GLOSSARY.md) — shared terminology.

Dated release/development evidence is kept under [`docs/status/`](docs/status/). The current development-tree acceptance record is [`docs/status/2026-09-17-acceptance-status.md`](docs/status/2026-09-17-acceptance-status.md); the immutable tagged RC baseline remains documented separately in the historical status records.

## Current validation status

The Kristal v6 migration has migration-specific validation recorded in [`VALIDATION_KRISTAL_V6.md`](VALIDATION_KRISTAL_V6.md): architecture checks pass, all modified TypeScript files pass syntax/transpile validation, scenario-injector tests pass 11/11, JSON/YAML parse, and no new broken documentation links were introduced.

The supplied SmartSnap does not contain installed npm dependencies or generated Prisma client artifacts, so the complete application typecheck/database/build/browser campaign was not rerun in this sandbox. The latest retained full automated application acceptance evidence remains the 2026-09-17 campaign documented under `docs/status/`.

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

## Kristal v6 integration

Orgo's `kristal` provider now uses the ecosystem-native path **Orgo → Interaction Kernel → Da’at → Kristal Standard 6.0.0**. A knowledge build freezes the selected Case/Task into an immutable ArtifactRef inside the IntegrationOperation, then delivers it post-commit through `kristal.build.request/2.0.0`. Returned `kristal.artifact.ready/2.0.0` events enter Orgo as Signals.

Kristal v6 `actionability` is preserved as input to Orgo routing; it never bypasses Orgo authorization or mutates Case/Task state directly.
