# Orgo — Boundaries and Ownership

## 1. Orgo owns operational workflow state

Orgo owns:

- organizations and organization profiles;
- Orgo user/person/RBAC state;
- accepted/persisted Signals;
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

Orgo implements an **Orgo-owned generic HTTP bridge adapter** for Konnaxion operations (`publish`, `distribute`). This is not a claim of native Konnaxion API compatibility; a provider-side adapter must translate the Orgo bridge contract to the real Konnaxion contract.

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

## 5. Orgo ↔ Kristal v6 / Da’at

Orgo's active knowledge path is now the ecosystem-native boundary:

```text
Orgo owner transaction
  + immutable Case/Task snapshot
  + IntegrationOperation / OutboxMessage
        ↓ post-commit
Interaction Kernel
        ↓
Da’at mapping / ACL
        ↓
Kristal Standard 6.0.0
        ↓
Kristal ArtifactRef / kristal.artifact.ready/2.0.0
        ↓
Orgo Signal / optional local workflow
```

The `kristal` provider supports `build` and `revise` and targets Da’at through Interaction Kernel. Orgo no longer relies on the old direct `Kristal validate` compatibility bridge.

Orgo remains authoritative for mutable operational workflow state. Kristal is authoritative for the Kristal State artifact it produces. Da’at translates/maps; Interaction Kernel transports interactions and references.

A Kristal v6 artifact may represent `authoritative_constraint`, `observed_state`, `organizational_rule`, `derived_state`, `decision`, `action`, `reference_knowledge` or `structural` records, and may carry `actionability`. Those semantics do not transfer ownership:

```text
Task.status           ≠ Kristal artifact_status
Case.status           ≠ Kristal validation/recognition
Orgo approval         ≠ Kristal validation
Kristal actionability ≠ Orgo execution authority
automatic             ≠ permission to bypass Orgo RBAC/workflow admission
Operational DB        ≠ Kristal State ≠ derived projection
```

`actionability = automatic` can remove unnecessary human friction only after an Orgo-owned policy/workflow admits that route. `human_review` and `human_decision` remain explicit human gates. Returned human decisions and completed effects may later be exported as new evidence/observed state, allowing the Kristal corpus to improve without becoming Orgo's operational database.

Operational mutations commit locally first; no distributed transaction spans Orgo, Interaction Kernel, Da’at or Kristal.

## 6. Orgo ↔ SemantiK Architect

Orgo implements an **Orgo-owned generic HTTP bridge adapter** for Architect generation requests. This is not a claim of native SemantiK Architect API compatibility; a provider-side adapter must translate the Orgo bridge contract to the real provider contract.

A future boundary should pass semantic generation requests/results without making Architect the owner of Orgo Tasks/Cases and without encoding Architect internal planner objects in the Orgo core.

## 7. Orgo ↔ Koali Spaces

Orgo is an owner-managed subsystem/application and can run standalone. The current repository exports an Orgo-owned hosted entry/surface contract so a host can compose the same business application. Native Koali/Capsule admission or manifest compatibility is not claimed unless the real host contract packages are supplied and validated.

A host such as Koali may own:

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

Host capability projections are non-authoritative. A host may use them to shape presentation or navigation, but Orgo must revalidate identity, tenant, RBAC and policy before every protected mutation.

Do not assume that a Koali session is automatically an authorized Orgo session unless an explicit SSO/identity contract establishes that mapping.

Do not create a second host-specific implementation of Orgo. Host outer navigation and Orgo inner navigation intentionally coexist.

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

The owner transaction commits before remote delivery. Cross-system reliability is achieved with idempotent post-commit delivery, receipts and reconciliation, not with a distributed transaction or bidirectional database synchronization.

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

