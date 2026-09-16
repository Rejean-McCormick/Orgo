# Orgo v3 — Domain Modules

## 1. Purpose

Domain modules adapt specialized work to the common Orgo **Work** bounded context (Case + Task ownership).

Implemented domain families in the current snapshot include Maintenance, HR and Education.

## 2. Invariant

```text
domain work object
≠ independent Task lifecycle
```

A domain module may own domain-specific extension tables, validation and projections. The canonical executable unit remains `Task`; durable shared context remains `Case` when used. Canonical mutations enter through Work public APIs.

## 3. DomainTask

`DomainTaskFactory` defines a domain-centric projection of canonical Task data.

Mappings include:

```text
domain     = Task.type
category   = Task.category
subtype    = Task.subtype
label      = Task.label
status     = Task.status
priority   = Task.priority
severity   = Task.severity
visibility = Task.visibility
case_id    = Task.caseId
```

This projection is a view, not a second table.

## 4. Maintenance

Schema extension:

- `MaintenanceAsset`;
- `MaintenanceTaskLink`;
- `MaintenanceCalendarSlot`.

Correct architectural flow:

```text
maintenance request
→ Work/Task public API creates canonical Task(type=maintenance)
→ maintenance link/asset/calendar extension
→ Task lifecycle remains core-owned
```

Maintenance-specific completion/reassignment APIs must delegate core Task status/ownership changes rather than update Task rows through a parallel state machine.

## 5. HR

HR is structurally close to the desired pattern:

```text
HR report
→ canonical Case
→ canonical primary Task(type=hr_case)
→ HrCase extension
→ participants + task links
```

`HrCase.status` is a domain-specific case-handling status and is distinct from canonical `Case.status`; their relationship must be explicit.

Confidentiality and participants remain HR domain concerns while Task/Case workflow fields remain core concerns.

## 6. Education

Education context links through `EducationTaskLink` to canonical Tasks.

Correct flow:

```text
education incident/support request
→ Work/Task public API
→ canonical Task(type=education_support)
→ EducationTaskLink + learning-group/person context
```

Education code must not insert/update the canonical Task table through a second raw-SQL lifecycle.

## 7. Future domain modules

A new domain module declares:

- domain `Task.type`;
- allowed categories/subtypes;
- default/allowed labels;
- domain metadata/schema;
- extension tables if needed;
- hooks/adapters around core services;
- authorization and visibility requirements.

It does not declare a new global Task status enum.


## 8. Dependency rule

Domain modules must not import raw Work persistence or external integration implementations.

```text
Domain module -> Work public API
Domain module -X-> Prisma Task/Case writes
Work -X-> domain-internal service/model
```

When a domain operation must atomically create canonical Work and domain extension state, define an explicit transaction/application boundary rather than passing arbitrary Prisma clients through mismatched service signatures.
