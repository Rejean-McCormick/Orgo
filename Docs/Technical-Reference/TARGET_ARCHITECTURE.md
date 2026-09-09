# Orgo — Target Architecture

> **Delivery reference (2026-09-09):** `IMPLEMENTATION_STATUS.md` distinguishes implemented behavior from the remaining target; `IMPLEMENTATION_DECISIONS.md` defines the adopted action syntax and migration refinements.
**Status:** Canonical target architecture for Orgo vNext.

**Relationship to the current snapshot:** this document defines the desired architecture. It does not claim that every module, model, route or worker described here already exists. Current implementation gaps are tracked in `CODE_ALIGNMENT_NOTES.md`; the physical database remains authoritative for what is actually persisted today.

## 1. Architectural thesis

Orgo should evolve as a **modular monolith oriented around operational work**, with a deterministic transactional core and durable asynchronous boundaries for long-running or external effects.

```text
                         ORGO
                    Modular Monolith
                           │
       ┌───────────────────┼────────────────────┐
       │                   │                    │
     INTAKE               WORK             ORCHESTRATION
     Signals           Cases + Tasks          Workflow
     normalization     assignments            Routing
     deduplication     comments               Escalation
       │               work events            Actions
       └───────────────────┼────────────────────┘
                           │
                   Domain events + Outbox
                           │
              ┌────────────┼─────────────┐
              │            │             │
       Communications   Integrations   Insights
       notifications    Kristal        projections
       channels         Konnaxion      reports
                        Architect
                        kOA
```

Cross-cutting platform capabilities:

```text
Tenancy / Identity / RBAC
ExecutionContext
Configuration
Persistence / transactions
Idempotency
Audit
Observability
```

The target is **not** a network of Task/Case/Workflow microservices. Internal module boundaries are code and ownership boundaries first.

## 2. Primary bounded contexts

### 2.1 Intake

Intake owns receiving and normalizing incoming facts/requests before they become work.

Responsibilities:

- accept input from HTTP/UI, email, webhooks, timers, offline replay and external integrations;
- normalize source-specific envelopes into an Orgo Signal contract;
- enforce idempotency/deduplication;
- persist accepted Signals;
- invoke orchestration/evaluation without directly mutating Task/Case tables.

Target flow:

```text
external input
→ inbound adapter
→ normalize
→ deduplicate / idempotency
→ persist Signal
→ evaluate / route
→ explicit work actions
```

### 2.2 Work

`Work` is the central operational bounded context.

```text
Work
├── Cases
├── Tasks
├── Assignments
├── Comments
└── Work Events
```

`Case` and `Task` remain distinct concepts:

- **Case** = durable situation/context and primary operational workspace;
- **Task** = canonical executable unit of work.

They are grouped because they share transactional rules, tenant boundaries, actors, lifecycle evidence and domain-module integration.

### 2.3 Orchestration

Orchestration owns process decisions, not the work records themselves.

```text
Orchestration
├── Workflow evaluation
├── Workflow instances/versions
├── Routing
├── Escalation/SLA
└── Action dispatch
```

The Workflow evaluator remains deterministic and side-effect free:

```text
WorkflowContext
→ matching/version-pinned rules
→ ResolvedWorkflowAction[]
```

An Action Executor/Dispatcher applies the resolved actions through the owning modules.

### 2.4 Communications

Communications owns outbound notification intent and delivery coordination. Delivery channels are adapters.

```text
Notification
→ channel adapter
   ├── email
   ├── push
   └── other future channels
```

Inbound email does **not** belong to the same responsibility: inbound email is an Intake adapter that produces Signals.

### 2.5 Domain modules

Maintenance, HR, Education and future domains refine Work. They may own extension state but must enter canonical work mutations through Work public APIs.

```text
domain request
→ domain validation/context
→ Work public API
→ Case/Task
→ domain extension/link rows
```

### 2.6 Insights

Insights is a read/projection boundary. It may use materialized views, reporting tables or a separate warehouse when justified, but it is never the write authority for operational state.

### 2.7 Integrations

Each external system receives its own explicit port/adapter and Anti-Corruption Layer (ACL).

```text
Orgo core
  ↓ port
KristalPort
  ↓ adapter + mapper
Kristal
```

The same rule applies to Konnaxion, SemantiK Architect and kOA-facing operational integrations.

## 3. Signal becomes a first-class persisted object

The supplied historical snapshot lacked a canonical persisted `Signal`. The delivered runtime now adds it; see `IMPLEMENTATION_STATUS.md` for tested coverage.

A Signal represents accepted incoming evidence/input before or alongside the work it causes.

Target logical fields include:

```text
id
organization_id
source
external_reference
idempotency_key
type / classification / severity
title / description
payload or payload_ref
received_at
processed_at
status
```

Relationships should make the operational chain visible:

```text
Signal ──► Case
   └─────► resulting Tasks (directly or through Case/action evidence)
```

A Case may accumulate several Signals over time. A Signal need not always create a new Case.

## 4. Workflow source of truth and versioning

The target source of runtime truth is persisted, version-pinned workflow configuration.

```text
WorkflowDefinition
  └── WorkflowVersion 1
  └── WorkflowVersion 2
  └── WorkflowVersion 3
             │
             └── WorkflowInstance pins version 3
```

Filesystem/YAML remains useful as:

- authoring format;
- import/export format;
- seed/configuration artifact;
- test fixture.

It must not remain an unrelated second runtime source of truth.

A running WorkflowInstance must be able to identify the exact immutable ruleset/version/hash it used.

## 5. Action execution model

Resolved workflow actions are classified by effect type.

### 5.1 Internal transactional actions

Examples:

```text
CREATE_CASE
CREATE_TASK
UPDATE_TASK
ASSIGN_TASK
SET_METADATA
ADD_LABEL
```

These normally execute synchronously inside Orgo through owner services and, when required, one database transaction.

### 5.2 Durable asynchronous actions

Examples:

```text
NOTIFY
KRISTAL_*
KONNAXION_*
ARCHITECT_*
publish/distribute
other long-running external effects
```

These use the transactional outbox pattern:

```text
business mutation
+ OutboxMessage
      │ same DB transaction
      ▼
commit
      ↓
Orgo worker
      ↓
external/channel adapter
      ↓
receipt / retry / terminal failure
```

Do not perform a remote side effect between an operational database mutation and its commit.

## 6. OutboxMessage and IntegrationOperation are different concepts

### OutboxMessage

Infrastructure delivery record answering:

> What must be delivered/processed reliably after this transaction commits?

Target fields include event/message type, aggregate reference, payload, status, attempt count, availability time, correlation/causation IDs and timestamps.

### IntegrationOperation

Operational record answering:

> What external operation did Orgo request and what happened to it?

Target fields include:

```text
organization_id
provider
operation
subject_type / subject_id
external_reference
status
idempotency_key
correlation_id
request metadata
receipt/error
started_at / completed_at
```

This prevents external states from leaking into `Task.status` or `Case.status`.

## 7. ExecutionContext is a platform primitive

Every protected entry path resolves one execution context before application logic:

```text
ExecutionContext
  organizationId
  actorUserId / actor type
  permissions or authorization reference
  correlationId
  causationId
  idempotencyKey
  source
```

Rules:

- caller-supplied organization IDs are never authorization by themselves;
- application services receive tenant/actor context explicitly;
- controllers/adapters do not invent different tenant resolution rules per endpoint;
- correlation/causation identity propagates into work events, audit and integration operations.

## 8. Idempotency is a first-class invariant

Idempotency is required at retry-prone boundaries:

- Signal ingestion;
- email/webhook ingestion;
- offline replay;
- workflow external actions;
- outbox consumers;
- external integration operations.

The effective uniqueness boundary should normally include organization + operation/source + idempotency key.

Retries must not create duplicate business effects.

## 9. Event taxonomy

Do not collapse every record into one generic event stream.

### Domain event

A business fact produced by an accepted state transition.

Examples:

```text
SignalReceived
TaskAssigned
CaseResolved
```

### Audit/security event

Evidence of who/what performed or attempted an operation, including compliance/security context.

### Integration message

A durable request/result crossing an asynchronous or external boundary.

Examples:

```text
KristalValidationRequested
NotificationDeliveryRequested
```

Orgo may persist all three categories, but they have different semantics and retention/processing rules.

## 10. Persistence and CQRS policy

Orgo remains state-oriented, not Event-Sourced.

Canonical operational state lives in PostgreSQL/Prisma-backed models, with immutable history where useful.

Use **light CQRS** only where read shapes differ materially from write shapes:

```text
operational Work state
      ↓ events/projection update
read projections
      ├── My Work
      ├── Supervisor workload
      ├── Operations dashboard
      └── Insights/reporting
```

A separate warehouse, ORM or broker is an implementation option, not an architectural requirement.

## 11. Runtime/deployment shape

The expected deployment may contain multiple processes without becoming microservices:

```text
orgo-web
orgo-api
orgo-worker
postgres
```

`orgo-api` and `orgo-worker` share:

- the same domain/application code;
- the same module ownership rules;
- the same release/version;
- the same operational database contract.

The worker handles outbox processing, retries, scheduled escalation, projection updates and long-running integrations.

Start with a PostgreSQL-backed outbox worker. Introduce Redis/RabbitMQ/Kafka only when measured scale or delivery requirements justify a broker.

## 12. Resilience policy

Apply resilience at faillible boundaries, not indiscriminately inside the monolith:

```text
timeout
bounded retry
exponential backoff + jitter
circuit breaker
concurrency/bulkhead limits
idempotency
DLQ/manual intervention when async processing cannot progress
```

Graceful degradation must preserve business meaning. Example: failure of a required Kristal validation cannot be converted into implicit approval; the workflow must remain waiting/blocked/degraded according to policy.

## 13. Observability policy

Operational flows should propagate structured identifiers when available:

```text
request_id
correlation_id
causation_id
organization_id
actor_id
signal_id
case_id
task_id
workflow_instance_id
integration_operation_id
```

Use three complementary signals:

- logs explain individual behavior;
- metrics detect system behavior;
- traces connect distributed/async behavior.

Health must distinguish at least liveness and readiness. Optional hosts such as Koali Spaces must not make standalone Orgo unhealthy merely because the host is absent.

## 14. Selective hexagonal architecture

Do not create ports/repositories/facades for every CRUD table.

Use explicit ports/adapters where they protect a meaningful boundary:

- inbound HTTP/email/webhook/offline replay;
- Kristal/Konnaxion/Architect/kOA integrations;
- notification delivery channels;
- persistence interfaces where domain tests/transaction ownership benefit;
- optional infrastructure such as broker/warehouse implementations.

External SDK/domain types must stop at the ACL/adapter boundary.

## 15. Dependency rules

The dependency graph is more important than the folder names.

```text
Domains ───────► Work public API
Intake ────────► Orchestration public API
Orchestration ─► Work public API
Insights ──────► read/projection interfaces
Integrations ──► Orgo application ports
```

Forbidden examples:

```text
domain module ─X→ raw Task/Case persistence
integration    ─X→ Orgo DB mutation
Insights       ─X→ operational state mutation
Work           ─X→ HR/Maintenance/Education internals
Orgo core      ─X→ external provider model
```

Enforce these rules with architecture tests/linting, not documentation alone.

## 16. Target code organization

A possible physical layout:

```text
apps/api/src/orgo/
  platform/
    execution-context/
    persistence/
    transaction/
    observability/
    idempotency/
    outbox/
    config/

  modules/
    tenancy/
    identity/
    intake/
      signals/
    work/
      cases/
      tasks/
      assignments/
      comments/
      events/
    orchestration/
      workflow/
      routing/
      escalation/
      actions/
    communications/
      notifications/
    domains/
      maintenance/
      hr/
      education/
    sync/
    insights/

  adapters/
    inbound/
      http/
      email/
      webhook/
    outbound/
      email/

  integrations/
    kristal/
    konnaxion/
    architect/
    koa/
```

This tree is illustrative. Ownership and dependency rules are normative; exact folder names may change during migration.

## 17. Patterns selected from the Senior Architect corpus

| Pattern | Decision |
|---|---|
| Modular Monolith | **Primary architecture** |
| Hexagonal Architecture | **Selective at meaningful boundaries** |
| Anti-Corruption Layer | **Required for external systems** |
| Idempotency | **Required at retry-prone boundaries** |
| Transactional Outbox | **Required for durable post-commit effects** |
| CQRS | **Light/read-side only** |
| Circuit Breaker / timeout / backoff | **External/faillible boundaries** |
| Bulkhead | **External/AI/high-cost workloads when needed** |
| Graceful Degradation | **When semantically safe** |
| DLQ/manual redrive | **Async poison/permanent failures when needed** |
| Saga/process manager | **Only for long-running cross-system workflows** |
| Broker Pub/Sub | **Not required initially** |
| Event Sourcing | **Not selected** |
| Microservices | **Not selected at current scale/shape** |
| BFF as separate service | **Not selected currently** |
| Sharding / Cell architecture / Service mesh | **Not selected currently** |

## 18. Migration strategy

Use incremental replacement rather than a rewrite.

### Phase 0 — Make the snapshot truthful

- repair imports/module graph/dependencies/config;
- establish build/test/boot baseline;
- normalize API routing;
- remove/retire phantom and duplicate active implementations.

### Phase 1 — Establish module boundaries

- group Task/Case under Work ownership;
- establish Intake and Orchestration public APIs;
- prevent domain modules from bypassing Work;
- introduce architecture tests.

### Phase 2 — Durable intake/platform primitives

- add persisted Signal;
- add ExecutionContext;
- add idempotency records/constraints where required;
- propagate correlation/causation identifiers.

### Phase 3 — Reliable effects

- add Action Executor/Dispatcher;
- add OutboxMessage + worker;
- reconcile WorkflowDefinition/Version/Instance;
- make YAML import/export rather than competing runtime truth.

### Phase 4 — External integrations

- add IntegrationOperation;
- implement per-system ACL/ports/adapters;
- add retry/circuit/resilience policy according to external semantics.

### Phase 5 — Read projections and product UI

- consolidate Insights/read projections;
- build Case-centered Orgo UI from composable presentation profiles;
- preserve standalone + Koali-hosted modes.

## 19. Non-negotiable architectural invariants

1. Orgo stays organization/tenant scoped.
2. Work owns canonical Case/Task mutations.
3. Signal is accepted/persisted before retry-prone orchestration causes duplicate effects.
4. Workflow evaluation stays deterministic and side-effect free.
5. Internal ACID transactions are preferred over internal sagas.
6. External/long-running effects are durable, idempotent and receipt-driven.
7. External state never becomes Orgo Task/Case status by implication.
8. Insights/read models cannot mutate operational state directly.
9. Koali hosting remains optional; Orgo stays standalone-capable.
10. Module dependency rules are enforced in code/CI.

## Completion delivery reference — 2026-09-09

The active implementation and its remaining external-contract boundaries are recorded in `IMPLEMENTATION_STATUS.md`. See `COMPLETION_DECISIONS.md` for durable processes, receipt predicates, Work scopes, identity and evidence semantics; `ARCHITECTURE_TO_CODE.md` for source ownership; `LOCAL_VALIDATION.md` for the final acceptance to run locally. Historical validation results do not validate the completion changes.
