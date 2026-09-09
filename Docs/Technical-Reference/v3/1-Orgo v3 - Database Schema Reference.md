# Orgo v3 — Database Schema Reference

## Authority

`apps/api/prisma/schema.prisma` and the applied migrations are the physical schema authority.

This document records ownership and the major table/model families rather than duplicating every column.

## 1. Multi-tenancy and identity

Core models:

```text
Organization
OrganizationProfile
UserAccount
PersonProfile
Role
Permission
RolePermission
UserRoleAssignment
LoginSession
ApiToken
```

`Organization` is the tenant root. Operational records that belong to an organization carry `organization_id`.

User and Person remain distinct:

```text
UserAccount = login/actor
PersonProfile = human subject
```

## 2. Communication/email

```text
EmailAccountConfig
RoleInbox
EmailThread
EmailMessage
EmailAttachment
EmailIngestionBatch
EmailProcessingEvent
```

Email state can generate/link operational work but does not replace Task/Case state.

## 3. Task core

### `Task`

Key fields:

- `id`;
- `organization_id`;
- optional `case_id`;
- `external_reference`;
- `type`, `category`, `subtype`, `label`;
- `title`, `description`;
- `status`, `priority`, `severity`, `visibility`, `source`;
- creator/requester/owner/assignee references;
- SLA/deadline/escalation fields;
- `metadata`;
- timestamps.

Related models:

```text
TaskAssignment
TaskEvent
TaskComment
```

These tables provide assignment history, lifecycle/audit events and comments without creating a second Task lifecycle.

## 4. Workflow/routing

```text
RoutingRule
WorkflowDefinition
WorkflowInstance
WorkflowTransitionEvent
EscalationPolicy
EscalationInstance
EscalationEvent
```

The DB workflow tables are operational state. Filesystem/YAML workflow rules used by the current engine must be reconciled with these models rather than treated as an unrelated second source of workflow truth.

## 5. Configuration

```text
ParameterOverride
FeatureFlag
LabelDefinition
EntityLabel
OrganizationProfile
```

Profiles/config tune behavior; they do not redefine core enums.

## 6. Notification, audit, security

```text
NotificationTemplate
Notification
ActivityLog
SecurityEvent
SystemMetricSnapshot
```

Audit/log state observes operations; it does not become owner of the work object observed.

## 7. Case core

### `Case`

Key fields:

- `id`;
- `organization_id`;
- `source_type`, `source_reference`;
- `label`;
- `title`, `description`;
- `status`, `severity`;
- `reactivity_time`;
- origin vertical/role;
- tags/location/metadata;
- timestamps.

Tasks link to a Case through `tasks.case_id`.

## 8. Maintenance extension

```text
MaintenanceAsset
MaintenanceTaskLink
MaintenanceCalendarSlot
```

The maintenance domain extends canonical Tasks by linking assets/schedule state. The extension must not create a separate canonical Task lifecycle.

## 9. HR extension

```text
HrCase
HrCaseParticipant
HrCaseTaskLink
WellbeingCheckin
```

`HrCase.case_id` links the HR domain record to the canonical Case. HR work links back to canonical Tasks.

## 10. Education/groups extension

```text
LearningGroup
LearningGroupMembership
EducationTaskLink
```

Education context links to canonical Tasks through `EducationTaskLink`.

## 11. Offline/sync

```text
OfflineNode
SyncSession
SyncConflict
EmailArchiveImportBatch
ImportedMessageMapping
```

Offline synchronization must preserve the same tenant, lifecycle, enum and audit invariants as online mutations.

## 12. Insights star schema

```text
DimDate
DimOrganization
DimTask
DimCase
DimPerson
DimLearningGroup
FactTask
FactCase
FactWellbeingCheckin
```

These are analytical projections. They are not the write authority for operational Task/Case state.

## 13. Core enums

Physical enums include:

```text
OrganizationStatus
TaskStatus
TaskPriority
TaskSeverity
Visibility
TaskSource
TaskCategory
CaseStatus
CommentVisibility
WorkflowInstanceStatus
NotificationChannel
NotificationStatus
TaskEventType
TaskEventOrigin
HrCaseStatus
HrCaseConfidentialityLevel
HrCaseParticipantRole
MaintenanceCalendarSlotStatus
SyncDirection
SyncStatus
SyncResolutionStrategy
```

Public JSON casing may differ at explicit boundaries, but each enum has one semantic vocabulary.
## 14. Target architecture additions (not yet physical schema authority)

The target architecture requires several models/records that are **not present as canonical Prisma models in the supplied snapshot**. They must be introduced by explicit migrations before code/docs may treat them as implemented.

### `Signal`

First-class accepted intake/evidence record, organization-scoped and idempotent at retry-prone boundaries. It should be linkable to the Case/Tasks/actions it caused or enriched.

### `WorkflowVersion`

Immutable/versioned runtime ruleset linked to `WorkflowDefinition`. `WorkflowInstance` should pin the exact version/hash used. YAML remains import/export/authoring material.

### `OutboxMessage`

Durable post-commit message written atomically with a business mutation. Used by the Orgo worker for notifications, integrations, retries and projection work.

### `IntegrationOperation`

Orgo-owned record of an external request/result/receipt. External lifecycle status must not be encoded into `Task.status` or `Case.status`.

### Idempotency storage

A dedicated record or equivalent unique constraints are required where a stable `(organization, operation/source, idempotency_key)` boundary cannot be enforced directly on the target aggregate.

`ExecutionContext` is primarily an application/platform contract and need not be a single database table; correlation/causation/idempotency fields should be persisted on the records that require durable traceability.

