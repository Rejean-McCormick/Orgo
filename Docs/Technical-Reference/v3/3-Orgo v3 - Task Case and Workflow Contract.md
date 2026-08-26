# Orgo v3 — Task, Case and Workflow Contract

## 1. Task contract

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

## 2. Task creation

The core service owns:

- initial status;
- enum normalization;
- profile-derived SLA/defaults;
- timestamps;
- event recording;
- organization scoping.

Domain/API callers provide intention and domain context, not derived core state.

## 3. Task mutation

All paths that change Task lifecycle, owner, assignment, deadline or core classification should execute the same invariants and emit the appropriate TaskEvent/audit evidence.

Offline sync and domain modules are not exemptions.

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

Case is organization-scoped and can contain Tasks.

## 5. Case creation

The current core service exposes an internal `createCaseFromSignal(...)` path. Case creation normalizes source/severity, applies profile defaults and persists through the core owner.

Public HTTP exposure is separate from the existence of the service operation.

## 6. Task events

Important Task transitions create Task events. Event history records facts about Task evolution and supports reconciliation/audit.

An event does not mutate the Task by itself; the mutation is committed by the Task owner service.

## 7. Workflow context

Canonical evaluation input includes:

- `organizationId`;
- source `EMAIL | API | SYSTEM | TIMER`;
- optional type/category/severity/label;
- title/description;
- email fields where applicable;
- metadata/payload.

## 8. Workflow actions

Current rule vocabulary:

```text
CREATE_TASK
UPDATE_TASK
ROUTE
ESCALATE
ATTACH_TEMPLATE
SET_METADATA
NOTIFY
```

The evaluator resolves actions. A dispatcher/executor is responsible for applying them through the correct service.

## 9. Simulation

Simulation uses the same rule evaluation semantics but produces no state mutation.

```text
same rules + same context
→ same resolved actions
```

subject to the same pinned configuration/ruleset.

## 10. Cases from workflow/patterns

If a rule/pattern needs to open a Case, that operation must be explicit in the action/executor contract and performed through CaseService. It must not be hidden inside arbitrary metadata or direct SQL.
