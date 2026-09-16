# Orgo — AI working rules

Use this file for persistent repository-working rules, not as a project overview.
For task-oriented routing, start with `docs/ai/INDEX.md`.

## Authority and navigation

Start from `docs/README.md` for the documentation authority model and canonical reading order.

Choose authority by question:

- **Current runtime behavior:** executable code under `apps/api/` and `apps/web/`, active tests, and runtime configuration.
- **Physical database state:** `apps/api/prisma/schema.prisma` plus `apps/api/prisma/migrations/`.
- **Current implementation/status evidence:** `docs/Technical-Reference/IMPLEMENTATION_STATUS.md`. It is dated evidence, not proof that the present working tree passes.
- **Target architecture and invariants:** `docs/Technical-Reference/TARGET_ARCHITECTURE.md`.
- **Architecture-to-code ownership:** `docs/Technical-Reference/ARCHITECTURE_TO_CODE.md` and `docs/Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md`.
- **Implemented HTTP surface:** `docs/Technical-Reference/API_IMPLEMENTED.md`, then verify the controllers under `apps/api/src/orgo/adapters/inbound/http/`.
- **Semantic contracts:** `docs/Technical-Reference/CONTRACTS.md` and the relevant documents under `docs/Technical-Reference/v3/`.
- **Validation procedure:** `docs/Technical-Reference/LOCAL_VALIDATION.md` and `validation/README.md`.

Documentation is not implementation evidence by itself. When a document conflicts with executable code, physical schema, or a more specific authority source, follow the source that owns the question and flag the mismatch.

## Persistent architectural constraints

- `Organization` is the tenant boundary.
- `Work` owns canonical Case/Task mutations and lifecycle invariants.
- `Intake` owns accepted Signals and inbound normalization.
- `Orchestration` owns deterministic workflow evaluation, routing, escalation and process decisions; evaluation stays side-effect free.
- Domain modules may own extension state but must enter canonical Work mutations through Work-owned APIs.
- Retry-prone boundaries require stable idempotency; retries must not duplicate Work or external effects.
- Durable external or long-running effects cross explicit outbox/worker/integration-operation boundaries and are receipt-driven.
- Insights/read models are not write authority for operational state.
- External systems retain authority over their own state and stay behind explicit ports/adapters/ACLs.
- Koali hosting is optional. Host capability or presentation projections never replace Orgo tenant, identity, RBAC or policy checks.

## Database editing boundary

`apps/api/prisma/migrations/00000000000000_initial/migration.sql` is the fresh-deployment baseline. Future physical schema changes should add forward migrations.

Do not replace or regenerate the baseline from `schema.prisma` alone. Migration SQL may contain database-only constraints, indexes, triggers or invariants that Prisma cannot model.

For persisted reality, Prisma schema plus migrations outrank prose schema references.

## Known documentation traps

- `docs/Technical-Reference/v3/1-Orgo v3 - Database Schema Reference.md` contains a stale section that describes `Signal`, `WorkflowVersion`, `OutboxMessage` and `IntegrationOperation` as not yet present. Do not use that claim for current physical-schema status; inspect Prisma and the implementation-status evidence.
- `docs/Technical-Reference/IMPLEMENTATION_STATUS.md` records a validation campaign from 2026-09-15 that predates later repository cleanup. Treat its PASS results as dated evidence until validation is rerun.
- Target architecture, examples, route inventories and configuration files do not prove a feature is implemented or currently passing.
- Generic integration bridges do not prove provider-native interoperability, provider acceptance or host admission.

## Editing boundaries

- Do not bypass Work ownership with direct Task/Case persistence from domain, integration or read-side code.
- Do not let external provider/domain types leak into Orgo core contracts.
- Do not map external lifecycle state into `Task.status` or `Case.status` by implication.
- Preserve tenant/actor resolution at protected entry boundaries; caller-supplied organization identifiers are not authorization.
- Preserve deterministic workflow evaluation and separate remote effects from the transaction that commits canonical Work state.
- Do not introduce microservices, Event Sourcing, a mandatory broker, a separate BFF, sharding/cell architecture or a service mesh without a new measured requirement and architectural decision.

## Validation

Run checks appropriate to the change from the repository root:

- `npm run check:architecture` — dependency and ownership rules.
- `npm run typecheck` — API and web TypeScript checks.
- `npm run test` — API unit tests.
- `npm run test:integration` — API integration tests; follow repository test-database requirements.
- `npm run test:pglite` — repository-provided PGlite validation path.
- `npm run build` — API and web production builds.
- `npm run validate:local` — broad repository-provided local validation.
- `npm run db:generate` — regenerate Prisma Client after schema changes.
- `npm run db:migrate` — apply Prisma migrations to the configured database.

Do not report a command as passing unless it was actually executed successfully in the current environment.
