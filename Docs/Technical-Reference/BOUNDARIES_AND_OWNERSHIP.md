# Orgo — Boundaries and Ownership

## 1. Orgo owns operational workflow state

Orgo owns:

- organizations and organization profiles;
- Orgo user/person/RBAC state;
- accepted/persisted Signals (target architecture; model not yet present in current Prisma snapshot);
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

## 2. Work / Task / Case ownership

`Work` is the central operational bounded context. `Task` is the canonical executable unit of work. `Case` is the shared durable situation/context container.

`Work` owns canonical Case/Task mutations, assignments/comments and work events. It is an ownership boundary, not a replacement database object.

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

## 7. Orgo ↔ Koali Spaces

Orgo is an owner-managed subsystem/application. It can run standalone. When installed in Koali Spaces, it is exposed as a `local_module_surface` through the canonical module/interface manifest mechanism.

Koali owns:

- the `GlobalShell`;
- Space composition;
- module selection and outer navigation;
- module hosting;
- capability projection used for presentation.

Orgo retains ownership of:

- Cases, Tasks, Signals, Workflows and Routing;
- tenant/business rules and Orgo RBAC;
- Orgo routes and inner navigation;
- the Orgo Control Panel, Inspector, commands and presentation profiles.

Capability snapshots/projections are non-authoritative. Koali may use them to show/hide/enable/disable UI or choose a safe route, but Orgo must revalidate identity, tenant, RBAC and policy before every protected mutation.

Do not assume that a Koali session is automatically an authorized Orgo session unless an explicit SSO/identity contract establishes that mapping.

Do not create a second global Koali shell inside Orgo. Koali outer navigation and Orgo inner navigation intentionally coexist.

## 8. Orgo ↔ kOA-Linux

When Orgo is hosted/integrated by kOA-Linux:

- Orgo keeps Task/Case/workflow/domain authority;
- kOA-Linux owns host resources, trust, privilege mediation, local service lifecycle, artifact admission/activation and recovery in its platform scope.

Host/platform state must not be represented as ordinary Orgo business state unless a real use case requires an Orgo Task to track that operation.


## 9. Durable effects and integration ownership

Orgo distinguishes the decision to perform an effect from the execution of a remote/long-running effect.

```text
owner business transaction
+ OutboxMessage
→ commit
→ Orgo worker
→ adapter
→ receipt/result
```

`OutboxMessage` is delivery infrastructure. `IntegrationOperation` is Orgo-owned operational state for a request to an external system. Neither replaces the external system's authoritative state.

External operation status must not be folded into Task/Case lifecycle by implication.

## 10. Integration boundary rule

Use one explicit port/adapter/Anti-Corruption Layer per independently owned external system. External provider/domain types stop at that boundary.

The boundary should carry only what is needed:

- external object/artifact reference;
- intended operation;
- organization/tenant mapping when required;
- actor/authorization context;
- correlation/causation/idempotency identity;
- result/error/receipt;
- provenance/audit references.

