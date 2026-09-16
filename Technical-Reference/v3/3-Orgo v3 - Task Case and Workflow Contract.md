# Orgo v3 — Signal, Work and Workflow Contract

> **Delivery reference (2026-09-09):** `IMPLEMENTATION_STATUS.md` distinguishes implemented behavior from the remaining target; `IMPLEMENTATION_DECISIONS.md` defines the adopted action syntax and migration refinements.
**Status:** Canonical semantic contract. Current code/schema gaps are explicitly marked.

## 1. Work boundary

`Work` is the ownership boundary for canonical Cases and Tasks.

```text
Work
├── Cases
├── Tasks
├── Assignments
├── Comments
└── Work Events
```

This does not merge Case and Task into one model. It defines where their canonical mutations belong.

## 2. Task contract

Task classification:

```text
type      domain-level type, e.g. maintenance | hr_case | education_support
category  request | incident | update | report | distribution
subtype   domain-specific optional refinement
label     canonical routing/classification label
```

Core lifecycle:

```text
PENDING
  ├─→ IN_PROGRESS
  │     ├─→ ON_HOLD ─→ IN_PROGRESS
  │     ├─→ COMPLETED
  │     ├─→ FAILED
  │     └─→ ESCALATED ─→ IN_PROGRESS | COMPLETED | FAILED
  └─→ CANCELLED

ON_HOLD ─→ CANCELLED
```

Terminal states:

```text
COMPLETED | FAILED | CANCELLED
```

## 3. Task creation/mutation

The Work owner controls:

- initial status;
- enum normalization;
- profile-derived SLA/defaults;
- timestamps;
- assignment/owner invariants;
- organization scoping;
- domain/work event creation;
- required outbox messages in the same transaction when a durable post-commit effect is requested.

All paths that change Task lifecycle, owner, assignment, deadline or core classification execute the same invariants. Offline replay and domain modules are not exemptions.

## 4. Case contract

Case lifecycle:

```text
open
  ├─→ in_progress
  ├─→ resolved
  └─→ archived

in_progress
  ├─→ resolved
  └─→ archived

resolved
  ├─→ in_progress
  └─→ archived

archived → terminal
```

Case is organization-scoped, contains/relates Tasks and is the primary operational workspace.

## 5. Signal contract

A Signal is an accepted input/evidence object that may create or enrich work.

Target logical contract:

```text
signal_id
organization_id
source
external_reference
idempotency_key
type / classification / severity
title
description
payload or payload_ref
status
received_at
processed_at
```

Target invariant:

```text
normalize
→ deduplicate/idempotency check
→ persist Signal
→ workflow/orchestration evaluation
```

A Signal is not automatically a Task or Case. Several Signals may relate to one Case.

**Implementation update:** the delivered Prisma schema persists Signal. The historical snapshot under `legacy/` did not.

## 6. Execution context

Protected Work/Intake operations receive resolved context rather than trusting request payload tenancy:

```text
organizationId
actorUserId / actor type
authorization reference
correlationId
causationId
idempotencyKey when applicable
source
```

The context is resolved at the entry boundary and propagated into owner services/events/audit.

## 7. Work/domain events

Important accepted transitions produce business facts such as:

```text
SignalReceived
TaskCreated
TaskAssigned
TaskStatusChanged
CaseCreated
CaseStatusChanged
```

Domain/work events are distinct from audit/security evidence and from integration messages.

An event does not independently mutate Task/Case; the owner mutation is authoritative.

## 8. Workflow evaluation context

Canonical evaluation input includes:

- `organizationId`;
- Signal reference when evaluation originates from persisted intake;
- source `EMAIL | API | SYSTEM | TIMER` plus future normalized adapters;
- optional type/category/severity/label;
- title/description;
- source-specific normalized metadata;
- correlation/causation identity.

## 9. Workflow actions

Current rule vocabulary includes:

```text
CREATE_TASK
UPDATE_TASK
ROUTE
ESCALATE
ATTACH_TEMPLATE
SET_METADATA
NOTIFY
```

The target Action Executor may add explicit actions such as Case creation/assignment and external integration actions as contracts become implemented.

The evaluator resolves actions; the executor applies them through the correct owner/port.

## 10. Internal vs external effects

### Internal transactional effects

Case/Task mutations, assignment, routing metadata and similar internal actions normally use owner services and ACID transactions.

### Durable external/long-running effects

Notifications and ecosystem operations should follow:

```text
business mutation
+ OutboxMessage
→ commit
→ worker
→ adapter
→ receipt/result
```

No remote operation should be required to succeed inside the same transaction that persists canonical Work state.

## 11. IntegrationOperation

Track an external operation independently from Work status.

```text
provider
operation
organization
Orgo subject
idempotency/correlation
status
external reference
receipt/error
```

Examples:

```text
Orgo Task.status ≠ Kristal validation status
Orgo Case.status ≠ external publication status
```

## 12. Workflow versioning

Target runtime relationship:

```text
WorkflowDefinition
→ immutable WorkflowVersion
→ WorkflowInstance pins exact version/hash
```

YAML/filesystem rules are authoring/import/export/seed material, not a parallel mutable runtime truth.

## 13. Simulation

Simulation uses the same version-pinned evaluation semantics and produces no state mutation, outbox message or integration operation.

```text
same version + same context
→ same resolved actions
```

## 14. Cases from workflow/patterns

If a rule/pattern needs to open a Case, that operation is explicit in the action/executor contract and performed through Work/Case ownership. It must not be hidden inside arbitrary metadata or direct SQL.

## 15. Idempotency

Retry-prone entry/effect paths require stable idempotency identity. Replaying the same accepted command/message must not create duplicate Work or duplicate external effects.
