# Orgo v3 — Architecture and Invariants

**Status:** Canonical architectural summary. For the complete target design and migration sequence, see `../TARGET_ARCHITECTURE.md`.

## 1. Identity

Orgo is a multi-tenant workflow and operational coordination system.

Its job is to turn accepted Signals and existing operational state into governed, auditable Work.

```text
input/evidence
  ↓
Intake / Signal
  ↓
Orchestration evaluation
  ↓
Work = Cases + Tasks
  ↓
assign / execute / escalate / review
  ↓
events / receipts / projections
```

## 2. Primary architecture

Orgo evolves as a **modular monolith**, not as a Task/Case/Workflow microservice mesh.

```text
                         Orgo
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
      Intake             Work           Orchestration
      Signals        Cases + Tasks       Workflow
      adapters       assignments         Routing
      normalize      comments            Escalation
        │            work events          Actions
        └─────────────────┼──────────────────┘
                          │
                  Domain events + Outbox
                          │
              ┌───────────┼────────────┐
              │           │            │
       Communications  Integrations  Insights
```

Cross-cutting platform capabilities include tenancy, identity/RBAC, ExecutionContext, persistence/transactions, configuration, idempotency, audit and observability.

## 3. Work is the central operational bounded context

`Work` owns canonical Case/Task mutations and the evidence directly attached to those lifecycles.

```text
Work
├── Case
├── Task
├── Assignment
├── Comment
└── Work Event
```

`Work` is an ownership boundary, not a replacement table.

## 4. Task is the executable unit of work

Task is defined once and reused everywhere.

Domain modules may add domain metadata or extension rows but they do not create competing status/priority/severity/visibility systems for canonical work.

## 5. Case is durable situation/context

Case groups related work, Signals and operational context over time. It is the primary operational workspace in the target UX.

A Case can hold several Tasks and may accumulate several Signals. It can reference an external subject/object without becoming that external object's owner.

## 6. Signal is a first-class accepted input

A Signal may originate from:

- email;
- API/UI input;
- webhook/external integration;
- system/timer event;
- offline/sync replay.

The target flow is:

```text
source input
→ inbound adapter
→ normalization
→ idempotency/deduplication
→ persist Signal
→ orchestration
→ explicit Case/Task/action effects
```

**Current-state note:** the supplied Prisma snapshot does not yet contain the canonical persisted Signal model; adding it is part of the migration plan.

## 7. Multi-tenancy and ExecutionContext

Every operational access is scoped to an Organization.

Protected entry paths resolve a common execution context before application logic:

```text
organization
actor
permissions/authorization reference
correlation_id
causation_id
idempotency_key when applicable
source
```

Tenant rules:

- organization identity is resolved before sensitive access;
- data queries include organization scope;
- cross-organization IDs do not bypass scope;
- a body/header organization ID is validated against authenticated/authorized context;
- analytics and exports preserve organization isolation.

## 8. Workflow Engine stays deterministic and pure

The Workflow Engine resolves decisions:

```text
WorkflowContext
→ version-pinned rules
→ ordered ResolvedWorkflowActions
```

It does not directly absorb all side effects. An Action Executor/Dispatcher applies resolved actions through Work, Communications or integration ports.

Simulation uses the same evaluator and persists nothing.

## 9. Workflow runtime truth is persisted/versioned

Target relationship:

```text
WorkflowDefinition
  └── WorkflowVersion
         └── WorkflowInstance pins exact version/hash
```

YAML/filesystem rules remain valid as authoring/import/export/seed artifacts, but they must not remain an unrelated second runtime source of truth.

## 10. Internal actions vs durable external actions

Internal actions such as Case/Task creation or assignment normally execute synchronously through owner services and ACID transactions.

External or long-running effects use a durable post-commit boundary:

```text
business transaction + OutboxMessage
→ commit
→ Orgo worker
→ adapter
→ receipt/result
```

External operation state is tracked separately through `IntegrationOperation`; it must not be encoded implicitly into Task or Case status.

## 11. Events are typed by purpose

Keep distinct:

- **domain events** — business facts such as TaskAssigned or CaseResolved;
- **audit/security events** — actor/compliance/security evidence;
- **integration messages** — durable cross-boundary requests/results.

Orgo is state-oriented and does not use Event Sourcing as the canonical persistence model.

## 12. Labels and profiles

Labels support routing/classification but do not replace authorization.

Broadcast bases `10`, `100`, `1000` are informational by default.

Organization profiles tune defaults such as SLA/reactivity, transparency, pattern sensitivity, retention and automation. Profile defaults flow through owner services; they do not fork the schema.

## 13. Domain modules

Domain modules are extensions around Work:

```text
domain request
→ domain validation/context
→ Work public API
→ canonical Case/Task
→ domain extension/link rows
```

A domain module may be substantial in business logic, but it does not own a parallel work engine and does not mutate raw Task/Case persistence directly.

## 14. Insights uses light CQRS/read projections

Insights is read/analysis oriented.

Operational state remains authoritative. Read projections may support My Work, Supervisor workload, dashboards and analytical reporting.

A separate warehouse/ORM/broker is an implementation option, not an invariant. Pattern detection becomes operational only by re-entering Work through explicit Case/Task actions.

## 15. External systems use ports + Anti-Corruption Layers

Konnaxion, Kristal, SemantiK Architect and kOA remain independent owners of their domains.

Each integration should have an explicit port/adapter/mapper boundary. External provider/domain types must not leak into Orgo core models.

## 16. Runtime shape

Orgo may run multiple processes while remaining one modular monolith/release:

```text
orgo-web
orgo-api
orgo-worker
postgres
```

The worker handles outbox processing, retries, scheduled work, integration operations and projection updates. A separate message broker is not required initially.

## 17. Resilience and observability

Apply timeout, bounded retry, exponential backoff/jitter, circuit breaker, concurrency limits and DLQ/manual redrive where external/asynchronous boundaries justify them.

Graceful degradation must preserve semantics; a required external validation cannot silently become approval.

Propagate structured correlation/causation and entity IDs through logs, metrics and traces. Distinguish liveness and readiness.

## 18. UI ownership and presentation

Orgo owns its business UI and inner navigation. The frontend is composed from shared Orgo primitives, routes, actions and panels into internal presentation profiles such as Operations, My Work, Supervisor, Intake, Workflow Admin, Executive and Embedded.

The maximal Control Panel is one composition, not the physical parent of every smaller surface. `Case` is the primary operational workspace; Task and Signal remain first-class transverse views.

## 19. Koali hosting invariant

Orgo can run standalone and can be hosted by Koali Spaces as a `local_module_surface` inside the existing Koali `GlobalShell`.

Koali hosting/capability projections never replace Orgo business authorization. Orgo revalidates identity, organization/tenant, RBAC and policy for protected mutations.

See `../UI_AND_KOALI_INTEGRATION.md`.

## 20. Patterns explicitly not selected now

Do not introduce these as default Orgo architecture without a measured requirement and a new decision record:

- Task/Case/Workflow microservices;
- Event Sourcing;
- mandatory Kafka/RabbitMQ/Redis broker;
- separate BFF service;
- sharding/cell architecture/service mesh.
