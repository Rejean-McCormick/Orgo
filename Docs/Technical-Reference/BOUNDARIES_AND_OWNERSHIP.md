# Orgo — Boundaries and Ownership

## 1. Orgo owns operational workflow state

Orgo owns:

- organizations and organization profiles;
- Orgo user/person/RBAC state;
- Cases;
- Tasks;
- assignments/comments/events;
- labels/routing rules;
- workflow definitions/executions/transitions within Orgo;
- escalation/SLA state;
- notifications/audit/security events in the Orgo scope;
- offline/sync state in the Orgo scope;
- domain-extension records that are explicitly part of Orgo;
- insights/read models derived from Orgo operational state.

## 2. Task/Case ownership

`Task` is the shared work backbone. `Case` is the shared durable context/work container.

Domain modules must not create a second competing Task/Case lifecycle. Domain tables may extend a Task/Case through explicit foreign keys/links.

Examples already present in the physical schema:

- `maintenance_task_links` → canonical Task;
- `hr_cases` → canonical Case;
- `hr_case_task_links` → canonical Task;
- `education_task_links` → canonical Task.

## 3. Insights ownership

Insights owns analytical projections and reporting outputs. It does not own operational Tasks/Cases.

When a pattern requires action:

```text
insight/pattern
→ explicit core Case/Task creation
→ normal Orgo lifecycle
```

## 4. Orgo ↔ Konnaxion

There is no implemented Konnaxion adapter in the current Orgo snapshot.

No implicit identity is allowed:

```text
Orgo Case ≠ Konnaxion Topic
Orgo Task ≠ Konnaxion Consultation
Orgo label ≠ Konnaxion taxonomy
Orgo workflow status ≠ civic decision status
```

Future interaction pattern:

```text
Orgo workflow
→ command/job/proposal/artifact ref
→ Konnaxion validates/authorizes
→ Konnaxion mutates its own state
→ receipt/event/result
→ Orgo reconciles its Task/Case
```

If Konnaxion requests governed work, Orgo creates/updates its own Tasks/Cases; Konnaxion does not write the Orgo database.

## 5. Orgo ↔ Kristal

There is no implemented Kristal adapter in the current Orgo snapshot.

Orgo may eventually orchestrate Kristal operations and keep artifact references/receipts, but:

```text
Task.status ≠ Kristal assertion_status
Case.status ≠ Kristal validation_status
Orgo approval ≠ Kristal validation
Orgo approval ≠ Kristal authority recognition
```

A workflow approval becomes a Kristal epistemic decision only through an explicit Kristal operation/artifact.

## 6. Orgo ↔ SemantiK Architect

No SemantiK Architect adapter is implemented in the current Orgo snapshot.

A future boundary should pass semantic generation requests/results without making Architect the owner of Orgo Tasks/Cases and without encoding Architect internal planner objects in the Orgo core.

## 7. Orgo ↔ kOA-Linux

When Orgo is hosted/integrated by kOA-Linux:

- Orgo keeps Task/Case/workflow/domain authority;
- kOA-Linux owns host resources, trust, privilege mediation, local service lifecycle, artifact admission/activation and recovery in its platform scope.

Host/platform state must not be represented as ordinary Orgo business state unless a real use case requires an Orgo Task to track that operation.

## 8. External system rule

Orgo may orchestrate an external system but does not absorb it.

The boundary should carry only what is needed:

- external object/artifact reference;
- intended operation;
- organization/tenant mapping when required;
- actor/authorization context;
- correlation/idempotency identity;
- result/error/receipt;
- provenance/audit references.
