# Orgo v3 — Architecture and Invariants

## 1. Identity

Orgo is a multi-tenant workflow and coordination system.

Its job is to turn incoming signals and existing operational state into structured, auditable work.

```text
signals
  ↓
classification / routing / workflow evaluation
  ↓
Cases + Tasks
  ↓
assign / execute / escalate / review
  ↓
events / receipts / insights
```

## 2. Core architecture

```text
                         Orgo
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
    Backbone           Core work          Insights
 organization          Task / Case        read models
 identity/RBAC         Workflow           patterns
 profiles              Labels             exports
        │                 │                  │
        └────────── domain adapters ─────────┘
                   Maintenance / HR / Education
```

## 3. Multi-tenancy

Every operational access is scoped to an Organization.

Tenant rules:

- organization identity is resolved before sensitive access;
- data queries include organization scope;
- cross-organization IDs do not bypass scope;
- a body/header organization ID is validated against authentication/authorization context;
- analytics and exports preserve organization isolation.

## 4. Task is the unit of work

Task is defined once and reused everywhere.

Domain modules may add domain metadata or extension rows but they do not create competing status/priority/severity/visibility systems for work.

## 5. Case is durable context

Case groups related work over time.

A Case can hold several Tasks and domain extensions. It can reference an external subject/object without becoming that external object's owner.

## 6. Signals become work through explicit evaluation

A signal may be:

- email;
- API/UI input;
- system/timer event;
- offline/sync input;
- external integration event.

The signal itself is not yet a Task or Case. Workflow/routing rules determine what work is created.

## 7. Workflow Engine

The current core Workflow Engine is best treated as a deterministic rule evaluator:

```text
WorkflowContext
→ matching rules
→ ordered ResolvedWorkflowActions
```

The engine should not directly absorb every side effect. Side-effect executors call TaskService, CaseService, NotificationService or external adapters as appropriate.

This separation makes simulation meaningful: `simulate` uses the same evaluation rules but applies no side effects.

## 8. Labels

Labels combine a vertical base, category/subcategory and optional horizontal role.

They support routing/classification but do not replace authorization.

Broadcast bases `10`, `100`, `1000` are informational by default.

## 9. Profiles

Organization profiles tune defaults such as:

- reactivity/SLA;
- transparency;
- pattern sensitivity;
- retention;
- automation/review cadence.

Profile defaults flow into Tasks/Cases through core services. They do not fork the schema.

## 10. Domain modules

Domain modules are thin around the core in the architectural sense:

```text
domain request
→ domain validation/context
→ TaskService / CaseService
→ canonical Task/Case
→ domain extension/link rows
```

A domain module may be substantial in business logic; "thin" means it does not own a parallel work engine.

## 11. Insights

Insights is read/analysis oriented.

Pattern detection becomes operational only by creating governed Cases/Tasks through core services.

## 12. External systems

Orgo orchestrates rather than absorbs. Konnaxion, Kristal, SemantiK Architect and kOA-Linux remain external owners of their domains.
