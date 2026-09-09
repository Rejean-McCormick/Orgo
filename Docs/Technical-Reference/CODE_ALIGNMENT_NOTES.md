# Orgo — Code Alignment Notes

> **Implementation update (2026-09-09):** The detailed findings below describe the supplied pre-migration snapshot, now retained under `legacy/`. They are not a list of defects claimed to remain in the new active runtime. See `IMPLEMENTATION_STATUS.md`, `IMPLEMENTATION_DECISIONS.md` and `API_IMPLEMENTED.md` for current delivery evidence.

## Purpose

This note identifies code areas that should be changed so the implementation matches the current Orgo architecture. It is not a project-management log.

The canonical target is `TARGET_ARCHITECTURE.md`. Migration is incremental: repair the existing snapshot first, then establish module boundaries and introduce new durable primitives without a rewrite.

## 1. Repair the Nest module/import graph first

The snapshot contains several imports that do not resolve to files in the supplied tree. These block reliable execution before higher-level alignment can be trusted.

### `apps/api/src/orgo/core/tasks/task.service.ts`

Current imports use paths shaped like:

```text
./././persistence/prisma/prisma.service
./././config/org-profile.service
```

They do not resolve from `core/tasks`. Wire them to the actual shared persistence/config services.

### `apps/api/src/orgo/core/cases/case.module.ts`

Imports `case-review.service` and `../database/database.module`, neither of which is present in the supplied tree. The actual CaseService already uses Prisma persistence. Rebuild CaseModule around the real persistence/core dependencies instead of phantom modules.

### `apps/api/src/orgo/core/logging/logger.module.ts`

References `log-rotation.service` and `log-query.service`, which are absent in the snapshot. Either add the real implementations or remove them from the active module contract.

### `apps/api/src/orgo/config/org-profile.service.ts`

Contains a malformed relative persistence import. Point it to the actual `apps/api/src/persistence/prisma/prisma.service.ts`.

## 2. Fix the public Task boundary mapping and tenant enforcement

### `apps/api/src/orgo/core/tasks/task.controller.ts`

The public DTO is snake_case (`organization_id`, `case_id`, etc.) while `TaskService` expects camelCase (`organizationId`, `caseId`, etc.). The controller currently passes objects through with `as any`.

Consequences include:

- list input may not populate `organizationId`;
- create input may fail core validation or map fields incorrectly;
- response shape can leak internal camelCase instead of the documented public shape.

Add explicit request/response mappers.

### Tenant isolation

`getTask()` currently calls an unscoped service lookup by Task ID. List/create also rely on DTO input rather than one consistent authenticated organization context.

Change Task HTTP paths to:

```text
resolve authenticated organization
→ map public DTO to internal input
→ call org-scoped service method
→ map internal DTO to public JSON
```

Use `getTaskById(organizationId, taskId)` for public single-task access.

## 3. Make Case API/service responsibilities explicit

`CaseService` implements `createCaseFromSignal()` and `updateCaseStatus()`, but `CaseController` exposes only list/detail in the snapshot.

Choose one stable contract:

- if Case create/status are intended public APIs, expose validated endpoints;
- if they are internal workflow operations, keep them internal and document only list/detail publicly.

Do not claim an endpoint exists just because a service method exists.

## 4. Unify API route prefixing

`main.ts` defines no global API prefix, while controllers mix:

```text
api/v3/tasks
api/v3/workflows
api/v3/organizations
v3/cases
signals
notifications
maintenance
domain/hr
domain/education
insights/reports
```

Select one public routing convention, ideally a single `/api/v3` boundary for Orgo APIs, and make reverse-proxy behavior explicit rather than relying on comments.

## 5. Update bootstrap identity

### `apps/api/src/main.ts`

Swagger currently identifies the API as:

```text
Leaves Tracker
Api Docs for leaves tracker
version 1.0
```

Replace with Orgo identity/version metadata and make the port/config environment-driven rather than hard-coded where appropriate.

## 6. Wire the core modules that exist in source

The current `AppModule`/`OrgoModule` wiring does not expose all implemented core areas.

Source contains Email, Signals, Notifications, Auth/RBAC, Offline and other modules, but several are not imported into the active module graph.

Examples:

- `SignalsModule` is not imported and currently declares no imports despite `SignalIngestService` requiring WorkflowEngineService and TaskService;
- `EmailModule` exists but is not mounted by AppModule/OrgoModule, and its controller is not registered in the module;
- `NotificationController` exists but `NotificationModule` does not register it as a controller;
- Auth/RBAC code exists but AppModule does not establish one consistent authenticated tenant context for the core APIs.

Wire only the capabilities intended to be active, but make the module graph truthful.

## 7. Preserve WorkflowEngine purity and add an explicit action executor

`WorkflowEngineService` is already architecturally strong: it loads/validates rules and resolves ordered actions without performing all side effects itself.

Preserve that separation.

Current `SignalIngestService` applies `CREATE_TASK` actions, but the rule vocabulary also includes UPDATE_TASK, ROUTE, ESCALATE, ATTACH_TEMPLATE, SET_METADATA and NOTIFY. The docs also expect workflows/patterns to be able to open Cases.

Add a clear executor/dispatcher layer:

```text
resolved action
→ action executor
   ├── internal action -> Work/owner service -> ACID transaction
   └── external/long action -> OutboxMessage -> worker -> adapter -> receipt
```

Do not put persistence side effects back into the pure evaluator and do not synchronously couple a Work transaction to a remote integration.

## 8. Reconcile filesystem workflow rules with DB workflow models

Prisma contains:

```text
WorkflowDefinition
WorkflowInstance
WorkflowTransitionEvent
```

while the active Workflow Engine loads rules from the filesystem/YAML.

Converge on the target relationship:

```text
WorkflowDefinition
→ immutable WorkflowVersion
→ WorkflowInstance pins exact version/hash
```

Use YAML/filesystem definitions for authoring/import/export/seed/test fixtures. Do not keep them as an unrelated mutable runtime source of truth.

## 9. Fix Maintenance before treating it as an active domain module

### `apps/api/src/orgo/domain/maintenance/maintenance.module.ts`

The file is not a Nest `@Module`; it contains another `MaintenanceController`, duplicating `maintenance.controller.ts` with a different API/authorization shape.

### `maintenance.service.ts`

The service creates its own `PrismaClient` and performs raw Task-table operations/transactions directly.

Align Maintenance to:

```text
MaintenanceModule
→ one controller
→ MaintenanceService
→ TaskService for canonical Task mutations
→ MaintenanceAsset/MaintenanceTaskLink/MaintenanceCalendarSlot for domain extension
```

The module should then be explicitly imported if Maintenance is intended active.

## 10. Fix Education to use the core work owner

### `education.module.ts` / `education.controller.ts`

They import `education-module.service`, while the supplied file is `education.service.ts`.

### `education.service.ts`

It has a malformed persistence import and directly writes/queries canonical Task rows through raw SQL.

Refactor creation/status mutations through TaskService. Keep `EducationTaskLink`, LearningGroup and person context as Education-owned extensions.

## 11. Fix HR integration with TaskService/CaseService

HR has the correct architectural intention — create a canonical Case, create a canonical Task, then add `HrCase`/participants/links — but the current code does not match the core service APIs.

Issues include:

- imports from nonexistent `core/task`, `core/case`, `core/label` paths;
- `CaseService.createCase(...)` is called but the supplied CaseService exposes `createCaseFromSignal(...)`;
- TaskService/CaseService are called with a transaction client argument their current signatures do not accept.

Align the service APIs and transaction boundary so the canonical Task/Case plus HR extension commit consistently.

Remove `hr.service.ts.BAK` from the active source tree.

## 12. Consolidate Insights layout/imports

`InsightsModule` imports root-level files such as:

```text
./reports.controller
./reports.service
./analytics-export.service
```

while the supplied tree also places implementations under subfolders such as:

```text
insights/reports/
insights/export/
insights/patterns/
insights/cache/
```

There are duplicate root/subfolder pattern/cache implementations in the snapshot.

Choose one canonical folder layout, update imports, and keep Insights read-oriented. Pattern actions should re-enter the core through TaskService/CaseService.

## 13. Keep enums/contracts in one semantic source

Task/Case/visibility/category enums are repeated in controllers, services, web types and domain services.

The values are mostly aligned now, which is good, but duplication creates drift risk.

Prefer a shared contract package/generated API types or strict conversion layer so:

- DB enum casing;
- internal service casing;
- public JSON casing;
- web client types

remain mechanically aligned.

## 14. Align offline sync with Task invariants

`core/offline/sync.service.ts` writes Task rows directly during merge/sync.

Offline operation is not exempt from core invariants. Ensure synchronized Task changes execute the same:

- tenant checks;
- enum/lifecycle rules;
- ownership rules;
- event/audit semantics;
- conflict resolution evidence.

If direct persistence is necessary for replay, isolate it behind a dedicated replay/import boundary with equivalent validation.

## 15. Build the frontend as an Orgo-owned application with composable presentation profiles

The supplied web route tree currently has a root page that renders `InsightsOverviewPage`; it does not evidence a complete UI route set for Tasks, Cases, admin, HR, Education, etc. Keep current-state documentation truthful while implementing the target architecture.

The target is one Orgo UI codebase with two entry modes:

```text
Orgo UI
├── standalone entry
└── Koali module entry -> local_module_surface
```

Do not create separate standalone and Koali page implementations.

Internally, compose the UI from shared routes/components/actions/panels into Orgo presentation profiles (Full Control Panel, Operations, My Work, Supervisor, Intake, Workflow Admin, Executive, Embedded). A reduced profile must not be implemented merely by mounting the full Control Panel and hiding most of it.

Treat `Case` as the primary operational workspace and Tasks/Signals as first-class transverse views. Add a contextual Orgo Inspector for quick context/actions, with deep links to full workspaces for complex work.

Konnaxion may be reused selectively for layout mechanics, sidebar/header/drawer/page-shell patterns and ergonomics. Do not extract Konnaxion into a new global Koali shell; Koali already owns `GlobalShell`.

Also verify `_app.tsx` style import and other web imports against files actually present in the repo.

## 16. External ecosystem adapters are not implemented

No concrete Konnaxion, Kristal or SemantiK Architect adapter is present in the current snapshot.

When added:

### Koali Spaces

Integrate Orgo as a removable/standalone-capable owner-managed module surface. Use the canonical Module Interface Manifest and `local_module_surface` model. Preserve Orgo routing, state and business authorization.

Koali capability projections may influence presentation only. Every protected mutation must be reauthorized by Orgo. Do not assume global SSO unless an explicit identity contract exists. Do not build a second `KoaliShell`.

### Konnaxion

Use commands/events/receipts; never map Case↔Topic or Task↔Consultation by identity.

### Kristal

Orchestrate explicit Kristal operations/artifact references. Orgo approval is not Kristal validation/recognition unless an explicit Kristal operation produces it.

### SemantiK Architect

Use generation request/result contracts; do not store Architect internal planner objects as Orgo core models.

### kOA-Linux

Treat host trust/resources/lifecycle as platform concerns. Track them in Orgo only when a real operational Task/Case is required.

## 17. Patterns that are already strong and should be preserved

- Organization-scoped service methods in Task/Case core.
- Explicit Task lifecycle transition table.
- Explicit Case lifecycle transition table.
- TaskEvent recording for important mutations.
- `DomainTaskFactory` as a projection rather than a second Task table.
- Label parser/routing service with explicit broadcast semantics.
- Workflow evaluator separated from side effects.
- Workflow simulation using the same evaluation semantics.
- Profile-derived Task defaults.
- Prisma schema linking domain extensions back to canonical Tasks/Cases.
- Insights as a distinct read/analytics layer.

## 18. Refactor physical boundaries toward Intake / Work / Orchestration

The current `Backbone / Core / Domain / Insights` tree is useful documentation but does not enforce ownership strongly enough in code. Migrate incrementally toward these logical boundaries:

```text
Intake        -> Signals and inbound normalization
Work          -> Cases + Tasks + assignments/comments/events
Orchestration -> Workflow + routing + escalation + action dispatch
```

Do not perform a repository-wide rewrite. Move ownership/public APIs first, then relocate files only when it clarifies dependency direction.

## 19. Persist Signal as a first-class intake object

The current snapshot contains Signal ingestion code but no canonical Prisma `Signal` model. Add an organization-scoped persisted Signal model with source/external reference/idempotency identity, normalized classification, payload/reference, processing status and timestamps.

Target intake flow:

```text
raw source
→ adapter/normalize
→ deduplicate/idempotency
→ persist Signal
→ orchestration evaluation
→ explicit Work actions
```

Link Signal to the Case/Tasks/actions it creates or enriches. Several Signals may relate to one Case.

## 20. Introduce one ExecutionContext boundary

Controllers and adapters currently resolve organization/actor context inconsistently. Add a common application context carrying at least organization, actor, authorization reference, correlation/causation IDs, source and optional idempotency key.

Resolve it once at the entry boundary and pass it into application services. Do not allow DTO/body tenancy to become authorization.

## 21. Add first-class idempotency for retry-prone operations

Apply stable idempotency semantics to:

- Signal/email/webhook intake;
- offline replay;
- outbox consumers;
- external integration operations;
- workflow actions that can be retried.

Prefer unique constraints/records scoped by organization + operation/source + idempotency key. Retries must not create duplicate Work or external effects.

## 22. Add a transactional outbox and Orgo worker

External or long-running effects should not run inline inside the Work transaction. Introduce an `OutboxMessage` model and worker process sharing the same Orgo code/release/database contract.

```text
business mutation + outbox row
→ commit
→ worker claim/process
→ retry/backoff
→ completed or terminal/manual state
```

Start with a Postgres-backed poller (`FOR UPDATE SKIP LOCKED` or equivalent). Do not introduce Kafka/RabbitMQ/Redis solely to satisfy the pattern.

## 23. Add IntegrationOperation and per-system ACLs

Add an Orgo-owned external-operation record for provider, operation, Work subject, idempotency/correlation, status, external reference, receipt/error and timestamps.

Implement separate ports/adapters/Anti-Corruption Layers for Kristal, Konnaxion, Architect and other independently owned systems. External SDK/domain models must stop at the adapter boundary.

Never overload Task/Case status with external lifecycle state.

## 24. Separate inbound email from outbound communications

The current Email area mixes ingestion and delivery concerns. Target split:

```text
inbound email -> Intake adapter -> Signal
Notification -> outbound email channel adapter
```

This removes avoidable coupling between parsing/intake and notification delivery.

## 25. Normalize event semantics

The snapshot contains TaskEvent, WorkflowTransitionEvent, ActivityLog, SecurityEvent and logger-only event recording patterns. Define and enforce three categories:

```text
domain/work event
audit/security event
integration message
```

Unify important Task/Case transition persistence so equivalent mutations do not sometimes create durable events and sometimes only write logs.

## 26. Keep Insights as light CQRS/read projections

Consolidate the current duplicate Insights implementations and define a read/projection interface. Do not require a separate ORM/warehouse for architectural purity. Use the existing database/materialized views first when sufficient; separate storage is an optimization when measured needs justify it.

Read models may optimize My Work, Supervisor, Operations dashboards and reporting, but must never write operational state directly.

## 27. Apply resilience only at faillible boundaries

For external/async adapters use, as appropriate:

- timeouts;
- bounded retry;
- exponential backoff with jitter;
- circuit breakers;
- concurrency/bulkhead limits;
- DLQ/manual redrive for poison/permanent async failures.

Fallback/degradation must preserve semantics. Required validation/recognition may become waiting/blocked/degraded, never silently approved.

## 28. Add structured observability and health semantics

Propagate request/correlation/causation and relevant organization/Signal/Case/Task/workflow/integration-operation identifiers across logs and traces. Add metrics for queues/outbox, failures, retries and workflow/integration latency.

Expose distinct liveness/readiness semantics. Optional hosts such as Koali Spaces must not make standalone Orgo unhealthy when absent.

## 29. Enforce architecture boundaries in CI

Documentation alone will not preserve a modular monolith. Add dependency tests/lint rules that reject patterns such as:

```text
domain -> raw Task/Case persistence
Insights -> operational mutation
integration -> Prisma mutation of Orgo core
Work -> domain-internal implementation
core -> external provider model
```

Permit modules to depend on explicit public contracts/APIs rather than internal implementation paths.

## 30. Do not prematurely distribute the monolith

Do not introduce Task, Case, Workflow or Notification network services, Event Sourcing, mandatory broker infrastructure, service mesh, sharding or cell architecture as part of the current alignment. Reconsider them only after measured scale/reliability requirements show that the modular monolith is the limiting factor.

## Recommended implementation order

```text
0  build/test/boot truth + imports/routes/config
1  Work ownership + module dependency enforcement
2  ExecutionContext + persisted Signal + idempotency
3  ActionExecutor + WorkflowVersion + Outbox/worker
4  IntegrationOperation + ACL adapters
5  Insights/read projections + observability/resilience
6  Case-centered product UI + external ecosystem workflows
```

