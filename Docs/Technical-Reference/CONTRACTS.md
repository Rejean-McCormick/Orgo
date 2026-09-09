# Orgo — Contract Surface

> **Delivery reference (2026-09-09):** `IMPLEMENTATION_STATUS.md` distinguishes implemented behavior from the remaining target; `IMPLEMENTATION_DECISIONS.md` defines the adopted action syntax and migration refinements.
## 1. Public Task JSON boundary

The intended public JSON contract uses snake_case:

```text
task_id
organization_id
case_id
source
type
category
subtype
label
title
description
status
priority
severity
visibility
assignee_role
created_by_user_id
requester_person_id
owner_role_id
owner_user_id
due_at
reactivity_time
reactivity_deadline_at
escalation_level
closed_at
metadata
created_at
updated_at
```

Canonical Task enums:

```text
status     PENDING | IN_PROGRESS | ON_HOLD | COMPLETED | FAILED | ESCALATED | CANCELLED
priority   LOW | MEDIUM | HIGH | CRITICAL
severity   MINOR | MODERATE | MAJOR | CRITICAL
visibility PUBLIC | INTERNAL | RESTRICTED | ANONYMISED
source     email | api | manual | sync
category   request | incident | update | report | distribution
```

Lower-case JSON representations may be accepted at selected boundaries and normalized explicitly. The stored/core enum remains unambiguous.

## 2. Task lifecycle

Allowed transitions implemented by the core service:

```text
PENDING     → IN_PROGRESS | CANCELLED
IN_PROGRESS → ON_HOLD | COMPLETED | FAILED | ESCALATED
ON_HOLD     → IN_PROGRESS | CANCELLED
ESCALATED   → IN_PROGRESS | COMPLETED | FAILED
COMPLETED   → terminal
FAILED      → terminal
CANCELLED   → terminal
```

`closed_at` is set when entering a terminal state.

## 3. Case boundary

Canonical Case status:

```text
open | in_progress | resolved | archived
```

Canonical Case source:

```text
email | api | manual | sync
```

Canonical Case severity uses the Task severity vocabulary, represented lower-case at the public JSON boundary.

Implemented lifecycle:

```text
open        → in_progress | resolved | archived
in_progress → resolved | archived
resolved    → in_progress | archived
archived    → terminal
```

## 4. Labels

Canonical shape:

```text
<BASE>.<CATEGORY><SUBCATEGORY>[.<HORIZONTAL_ROLE>]
```

Constraints implemented in the label routing service:

- base: positive integer;
- category digit: 1–9;
- subcategory digit: 1–5;
- optional role: dot-separated alphanumeric segments;
- reserved broadcast bases: `10`, `100`, `1000`.

Task categories remain:

```text
request | incident | update | report | distribution
```

## 5. Workflow rule contract

Current Workflow Engine recognizes event sources:

```text
EMAIL | API | SYSTEM | TIMER
```

and action types:

```text
CREATE_TASK
UPDATE_TASK
ROUTE
ESCALATE
ATTACH_TEMPLATE
SET_METADATA
NOTIFY
```

The Workflow Engine itself is intentionally evaluation-oriented: it resolves ordered actions. Callers/executors perform side effects through the correct owner services.

## 6. Standard service result

Core services use the result envelope:

```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

Failure:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "Human-readable explanation",
    "details": {}
  }
}
```

## 7. Tenant boundary

Any Task/Case mutation or sensitive lookup must resolve an organization explicitly and enforce it in the service query.

A caller-provided header/body organization ID is an input to tenant scoping, not proof of authorization by itself.


## 8. Koali hosting and capability-projection contract

Orgo must support standalone operation and Koali-hosted presentation without duplicating the business application.

When hosted by Koali:

```text
installed/admitted module manifest
  -> Koali GlobalShell
  -> Orgo local_module_surface
  -> Orgo router/UI
```

Koali capability projections are presentation data, not mutation authorization. A protected Orgo command must independently resolve and validate:

```text
identity
organization/tenant
RBAC
policy
```

The Orgo-to-Koali boundary may contribute routes, sidebar entries, widgets, required capability references and surface references using the canonical Koali module interface. It must not redefine a parallel global `Product/SurfaceProfile/Capability` taxonomy.

## 9. Orgo presentation-profile contract

Presentation profiles are Orgo-internal UX compositions. They may select:

- a home route;
- navigation groups;
- exposed actions/widgets;
- search or command scopes;
- Inspector policy;
- density/presentation defaults.

They do not grant business permission.

Canonical initial profile vocabulary:

```text
Full Control Panel
Operations
My Work
Supervisor
Intake
Workflow Admin
Executive
Embedded
```

Exact profile names/configuration may evolve, but the composition-vs-authorization separation is invariant.
## 10. Execution-context contract

Protected entry paths resolve a common application context before invoking owner services:

```text
organization_id
actor_user_id / actor_type
authorization reference
correlation_id
causation_id
idempotency_key (when applicable)
source
```

The exact transport representation may differ by adapter. The semantic context must not be independently reconstructed with different rules in every controller.

## 11. Target Signal contract

Signal is a first-class accepted intake object in the target architecture. The delivered Prisma schema now provides the canonical model; the historical snapshot did not.

Target public/internal mappings should preserve at least:

```text
signal_id
organization_id
source
external_reference
idempotency_key
type/classification/severity
title/description
payload or payload_ref
status
received_at
processed_at
```

Acceptance flow:

```text
normalize -> idempotency/deduplication -> persist -> orchestrate
```

## 12. Reliable-effect contract

Internal transactional effects execute through owner services. External or long-running effects are committed durably before execution.

```text
business mutation + OutboxMessage
→ commit
→ worker
→ adapter
→ receipt
```

An `IntegrationOperation` tracks the Orgo-side lifecycle of an external request independently of Task/Case status.

## 13. Event taxonomy contract

Do not conflate:

- domain/work event — accepted business fact;
- audit/security event — actor/compliance/security evidence;
- integration message — durable request/result across an async/external boundary.

## 14. Workflow-version contract

The target runtime truth is persisted and version-pinned:

```text
WorkflowDefinition -> WorkflowVersion -> WorkflowInstance
```

A WorkflowInstance identifies the exact immutable version/hash used. YAML/filesystem definitions are import/export/authoring/seed artifacts, not a second runtime authority.


## Completion delivery reference — 2026-09-09

The active implementation and its remaining external-contract boundaries are recorded in `IMPLEMENTATION_STATUS.md`. See `COMPLETION_DECISIONS.md` for durable processes, receipt predicates, Work scopes, identity and evidence semantics; `ARCHITECTURE_TO_CODE.md` for source ownership; `LOCAL_VALIDATION.md` for the final acceptance to run locally. Historical validation results do not validate the completion changes.
