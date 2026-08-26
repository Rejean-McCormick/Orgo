# Orgo — Current Contract Surface

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
