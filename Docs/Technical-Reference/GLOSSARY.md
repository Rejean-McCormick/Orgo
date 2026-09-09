# Orgo — Architectural Glossary

## Orgo

**Orgo** is an ecosystem system and workflow/control platform. In a kOA-Linux deployment it may be called an integrated subsystem from the host scope, without transferring Orgo's internal authority.

## Module

`module` is not a sufficient architecture category by itself.

Within Orgo, prefer:

- **core service/module** — Task, Case, Workflow, Labels, Config, Logging, Email, Signals, Notifications, Offline Sync;
- **domain module** — Maintenance, HR, Education and other adapters around the core;
- **application/web surface** — UI/API presentation;
- **external ecosystem system** — Konnaxion, Kristal, SemantiK Architect, kOA-Linux.

## Organization

The tenant/operational boundary. Orgo work belongs to an organization unless a contract explicitly defines global configuration.

`organization_id` is an isolation key, not a generic universal scope shared with every external system.

## User vs Person

- **User account** — login/actor identity in Orgo.
- **Person profile** — human subject the work may concern, whether or not that person logs in.

These identities are not interchangeable.

## Work

The central operational bounded context that owns canonical Cases, Tasks, assignments, comments and work events. `Work` is an architecture/ownership boundary, not a new database row replacing Case or Task.

## Signal

An accepted incoming fact/request/evidence object that may lead to or enrich work. Examples include API input, email, UI input, offline synchronization or system/timer events.

In the target architecture Signal is persisted as a first-class Orgo object before retry-prone orchestration. The current Prisma snapshot does not yet contain that canonical Signal model. A Signal is not automatically a Task or Case.

## Task

The canonical unit of work.

A Task owns its Orgo lifecycle, classification, assignment, SLA/escalation and audit state. Domain-specific data belongs in typed domain extensions or metadata; it must not redefine the canonical Task lifecycle.

## Case

A durable container for related Tasks, context and treatment over time.

A Case is not identical to an external domain object. Example:

```text
Orgo Case ≠ Konnaxion Topic
```

## Workflow

The Orgo rule/process layer that evaluates signals/state and resolves actions. Workflow execution determines operational actions; it does not become the owner of an external system's domain state.

## Domain module

A domain-specific adapter/refinement over the common Task/Case core.

A domain module may own additional domain tables (for example HR case details or maintenance asset links) while preserving the canonical Orgo Task/Case records as the work backbone.

## DomainTask

A domain-centric **projection** of a canonical Task. It is not a second Task table or independent lifecycle.

## Label

The canonical routing/classification string:

```text
<BASE>.<CATEGORY><SUBCATEGORY>[.<HORIZONTAL_ROLE>]
```

Example:

```text
100.94.Operations.Safety
```

The label informs routing and classification. It does not replace explicit authorization or ownership.

## Broadcast label

A label using a reserved broadcast base such as `10`, `100` or `1000`. It is informational by default. A mandatory Task is created only if an explicit workflow rule says so.

## Organization profile

A versioned behavioral configuration for an organization, covering defaults such as reactivity, transparency, pattern sensitivity, retention and automation.

A profile tunes the core; it does not create a new Task/Case schema.

## Cyclic overview

Recurring review/pattern-detection behavior that analyses operational state. A detected pattern becomes governed work only through explicit Case/Task creation.

## Insight / report

A derived analytical/read model. It does not become the authoritative owner of the operational Task/Case records it summarizes.

## Charter

A semantic reference/configuration layer describing domain concepts and selected Wikidata mappings/refinements. It does not create a parallel operational ontology or lifecycle.

## External artifact reference

A reference to an artifact owned by another system. Orgo may store the reference/correlation/receipt needed for workflow without copying the external artifact's entire schema into the core Task/Case model.

## Receipt

Structured evidence that an operation was accepted, rejected or executed. A receipt supports workflow reconciliation; it is not the external system's authoritative state.


## ExecutionContext

The resolved tenant/actor/request context passed into protected application operations. It carries organization identity, actor identity/type, authorization reference, correlation/causation identifiers, source and optional idempotency key.

## OutboxMessage

A durable infrastructure record written atomically with a business transaction so a post-commit action/event can be processed reliably by the Orgo worker. It is not the business status of the external operation.

## IntegrationOperation

An Orgo-owned operational record for a request to an external system, including provider/operation, Orgo subject, idempotency/correlation identity, status, receipt and error. It prevents external lifecycle states from being folded into Task/Case status.

## Domain event

A business fact emitted after an accepted Orgo state transition, such as `TaskAssigned` or `CaseResolved`. Domain events are distinct from audit/security evidence and integration messages.
