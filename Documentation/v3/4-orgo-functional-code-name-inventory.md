<!-- INDEX: Doc 4 – Functional Code‑Name Inventory (Services & Hooks) -->
Index

Document role (mapping product features → code artifacts)

Naming conventions (locked for Orgo v3)
2.1 Backend (NestJS) naming
2.2 Frontend (NextJS + RTK Query) naming
2.3 Cross‑cutting constants (functional IDs)

Main functional inventory table
3.1 Backbone: Multi‑tenant org, users & persons
3.2 Signals & ingestion (Email, API, offline)
3.3 Cases, Tasks, Workflow & labels
3.4 Configuration, profiles & global parameters
3.5 Interfaces (API, web, live updates)
3.6 Domain Modules (maintenance, HR, education, generic domain API)
3.7 Insights, analytics & cyclic overview
3.8 Infrastructure, monitoring & guardrails (health, metrics, alerts, security & compliance, validation)

How to use these code names
4.1 Backend services
4.2 Frontend hooks
4.3 Background jobs & queues
4.4 Cross‑module references
4.5 Governance for new features



# Orgo v3 – Functional Code‑Name Inventory (Services & Hooks)

**Document 4 of 8 – Orgo v3 Blueprint**

This document is the mapping for the Orgo v3 TypeScript implementation (NestJS + Prisma + NextJS + RTK Query). It does not redefine schemas or enums; those are locked in:

* **Doc 1 – Database Schema Reference** (all tables, including `tasks`, `cases`, labeling, offline & insights star‑schema). 
* **Doc 2 – Foundations, Locked Variables & Operational Checklists** (canonical enums, canonical Task field set, log and visibility enums, configuration and global checklists). 
* **Doc 3 – Domain Modules (Orgo v3)** (thin adapters over the central Task/Case engine). 
* **Doc 5 – Core Services Specification** (email gateway, task handler, workflow engine, notifier, logger, persistence). 
* **Doc 6 – Insights Module Config Parameters and the profiles YAML** (analytics & behavioural profiles). 
* **Doc 8 – Cyclic Overview & Universal Flow Rules** (label semantics, JSON contracts, cyclic reviews). 

---

## 1. Document Role

This document is the Rosetta stone between Orgo’s **conceptual features** and the TypeScript/NestJS/NextJS code that implements them:

* Multi‑tenant backbone (organizations, user accounts vs person profiles).
* Signals in → Cases & Tasks out (email/API/offline → workflow → Case/Task).
* Label system and routing (`<base>.<category><subcategory>.<horizontal_role>`).
* Domain modules as thin adapters over the global Task/Case engine.
* Profiles (friend_group, hospital, advocacy_group, retail_chain, etc.) that tune reactivity, transparency, reviews, and automation.
* Insights & cyclic overview (star schema, ETL/Airflow, pattern detection feeding back into new Cases/Tasks).
* Guardrails (VISIBILITY, logging, audit, compliance exports).
TypeScript examples assume Prisma as the ORM (`DatabaseService.getPrismaClient` etc.), but the functional inventory and the underlying schemas/enums remain ORM-neutral.


It maps:

* Product / UX feature names (“Route crisis email into a safety Case & Tasks”, “Run monthly pattern review”)
  to
* Backend services, background jobs, and frontend hooks in the Orgo v3 stack.

All modules, services, jobs, and hooks in Orgo v3 must use the code names defined here. If implementation diverges, this document is the source of truth. 

---

## 2. Naming Conventions (Locked for Orgo v3)

### 2.1 Backend (NestJS)

* **Service classes**: `PascalCaseService`
  Example: `EmailService`, `WorkflowEngineService`, `TaskService`, `CaseService`.

* **Controller classes**: `PascalCaseController`
  Example: `TaskController`, `CaseController`.

* **Public methods**: `camelCaseVerbNoun`
  Example: `sendEmail`, `parseEmail`, `executeWorkflow`, `createCaseFromSignal`.

* **NestJS path** (convention, not enforced by framework):

  * `apps/api/src/orgo/<module>/<submodule>.service.ts`
  * `apps/api/src/orgo/<module>/<module>.controller.ts`

* **Queue job names (string IDs)**:

  * `orgo.<module>.<action>` (all lowercase, dot‑separated).
    Example: `orgo.email.poll`, `orgo.task.escalate`, `orgo.insights.weekly-pattern-review`.

### 2.2 Frontend (NextJS + RTK Query)

* **API slice**: `orgoApi`
  `apps/web/src/store/services/orgoApi.ts` (extends the existing RTK Query setup).

* **Query hooks**: `use<Entity>Query`
  Example: `useTasksQuery`, `useCasesQuery`, `useWorkflowExecutionHistoryQuery`.

* **Mutation hooks**: `useVerbEntityMutation`
  Example: `useCreateTaskMutation`, `useCreateCaseMutation`, `useUpdateTaskStatusMutation`.

### 2.3 Cross‑cutting constants

* **Stable function IDs** (for logs, analytics, configuration references):

  * `FN_<MODULE>_<ACTION>` – e.g., `FN_EMAIL_SEND`, `FN_WORKFLOW_EXECUTE`, `FN_CASE_CREATE`.

* Shared constants file:

  * `apps/api/src/orgo/core/functional-ids.ts`
  * `apps/web/src/orgo/core/functional-ids.ts` (mirrored).



---

## 3. Main Functional Inventory Table

Format per row:

* **Module** – Top‑level business area (Backbone, Core Services, Domain Modules, Insights, etc.).
* **Sub‑module** – Logical engine or feature group.
* **Display Name → Code Name** – Human feature name mapped to explicit code identifier(s).
* **Purpose / Behaviour** – 1–2 line description of what it does and how it fits the Orgo “nervous system”.

Where both backend and frontend artifacts exist, they are listed together in the “Code Name” part. 

---

### 3.1 Backbone: Multi‑Tenant Org, Users & Persons

| Module       | Sub‑module          | Display Name → Code Name                                                                                                                                                            | Purpose / Behaviour                                                                                                                                 |
| ------------ | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Backbone** | Organizations       | Manage organizations (tenants) → `OrganizationService.createOrganization`, `OrganizationService.updateOrganization`, hooks `useOrganizationsQuery`, `useCreateOrganizationMutation` | Creates and updates `organizations` rows (slug, display name, timezone, default profile linkage, status) and enforces one active profile per org.   |
| Backbone     | Persons             | Manage person profiles → `PersonProfileService.upsertPersonProfile`, hook `usePersonProfileQuery`                                                                                   | Manages `person_profiles` (people tasks/cases are about: students, players, employees, community members), whether or not they have login accounts. |
| Backbone     | Identity & RBAC     | Manage roles and permissions → `RoleService.createRole`, `PermissionService.assignPermission`, hook `useRolesQuery`                                                                 | Maintains `roles`, `permissions`, and `role_permissions`; powers RBAC decisions for tasks, cases, insights, and exports.                            |
| Backbone     | User–Person linking | Link user accounts to person profiles → `IdentityLinkService.linkUserToPerson`, hook `useLinkUserPersonMutation`                                                                    | Connects `user_accounts` and `person_profiles` so tasks/cases can refer to the human subject separately from the Orgo login identity.               |



---

### 3.2 Signals & Ingestion (Email, API, Offline)

| Module            | Sub‑module       | Display Name → Code Name                                                                                                          | Purpose / Behaviour                                                                                                                                    |
| ----------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Core Services** | Email Handling   | Send notification email → `EmailService.sendEmail` (Nest), job `orgo.email.send`, hook `useSendTestEmailMutation`                 | Sends transactional and workflow‑related emails via SMTP using organization‑specific configuration.                                                    |
| Core Services     | Email Handling   | Parse incoming email → `EmailParserService.parseIncoming`, job `orgo.email.parse`                                                 | Parses raw incoming email payloads into normalized Orgo email objects (`email_messages` + attachments) for routing.                                    |
| Core Services     | Email Handling   | Validate email payload → `EmailValidatorService.validateEmailPayload`                                                             | Ensures subject, sender, body, and attachments respect validation rules and size/type limits from email config.                                        |
| Core Services     | Email Handling   | Poll mailbox for new messages → `EmailIngestService.pollMailbox`, job `orgo.email.poll`                                           | Connects to IMAP, fetches new messages, stores them in `email_messages`, and enqueues parsing + workflow routing.                                      |
| Core Services     | Email Handling   | Route email to workflow → `EmailRouterService.routeToWorkflow`                                                                    | Maps parsed emails to workflow contexts using org/domain patterns, labels, and profile hints.                                                          |
| Core Services     | API / Signals    | Ingest API / UI signal → `SignalIngestService.ingest`, controller `SignalController.createSignal`, hook `useCreateSignalMutation` | Normalizes non‑email signals (REST, UI forms, webhooks) into a common “signal” shape that workflows can turn into Cases/Tasks.                         |
| Core Services     | Offline & Import | Import email archive (PST/mbox) → `EmailArchiveImportService.importArchive`, job `orgo.email.import-archive`                      | Processes offline mail archives (`email_archive_import_batches`, `imported_message_mappings`) into `email_messages` for historical analysis and cases. |
| Core Services     | Offline & Sync   | Sync offline node → `SyncService.syncOfflineNode`, job `orgo.sync.run-node`                                                       | Reconciles SQLite‑backed offline nodes with central Postgres using `offline_nodes`, `sync_sessions`, and `sync_conflicts`.                             |
| Core Services     | Offline & Sync   | Sync offline task cache → `SyncService.syncOfflineTasks`, job `orgo.db.sync-offline`                                              | Applies queued offline task changes into the online `tasks` table, then hydrates local caches with authoritative state.                                |



---

### 3.3 Cases, Tasks, Workflow & Labels

| Module            | Sub‑module      | Display Name → Code Name                                                                                       | Purpose / Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------- | --------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core Services** | Case Management | Create Case from signal → `CaseService.createCaseFromSignal`, hook `useCreateCaseMutation`                     | Creates a `cases` row from an incoming signal or pattern, assigning `source_type`, `label`, CASE_STATUS (`open`,`in_progress`,`resolved`,`archived`), severity, and reactivity fields according to org profile.                                                                                                                                                                                                                                                                                                                                                           |
| Core Services     | Case Management | Fetch Case with linked Tasks → `CaseService.getCaseWithTasks`, hook `useCaseDetailsQuery`                      | Returns a Case plus its linked `tasks`, labels, and participants, used by generic Case UIs and domain‑specific case views (e.g. HR).                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Core Services     | Case Management | Run cyclic Case review → `CaseReviewService.runCyclicReview`, job `orgo.cases.cyclic-review`                   | Implements weekly/monthly/yearly Case review passes defined in Doc 8, creating audit/review Cases when thresholds are crossed instead of just emitting metrics.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Core Services     | Workflow Engine | Execute workflow → `WorkflowEngineService.executeWorkflow`, job `orgo.workflow.execute`                        | Executes workflow definitions over tasks/cases (routing, metadata updates, escalation), logging each action via the `WORKFLOW` log category.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Core Services     | Workflow Engine | Validate workflow definition → `WorkflowEngineService.validateWorkflow`                                        | Ensures workflow rules only use canonical enums (TASK_STATUS, TASK_PRIORITY, TASK_SEVERITY, VISIBILITY) and valid actions.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Core Services     | Workflow Engine | Simulate workflow run → `WorkflowEngineService.simulate`, hook `useWorkflowSimulationMutation`                 | Runs a dry‑run of a workflow on sample data to preview created Tasks, routing, and escalations without persisting changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Core Services     | Workflow Engine | Evaluate escalation rules → `EscalationService.evaluateEscalations`, job `orgo.workflow.check-escalations`     | Periodically checks Tasks against `reactivity_deadline_at` and escalation policies, then drives status `ESCALATED` transitions and notifications.                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Core Services     | Task Management | Create Task from event → `TaskService.createTask`, hook `useCreateTaskMutation`                                | Creates a Task from a signal/workflow using the canonical Task field set (`task_id`, `organization_id`, `case_id`, `type`, `category`, `subtype`, `label`, `title`, `description`, `status`, `priority`, `severity`, `visibility`, `source`, `created_by_user_id`, `requester_person_id`, `owner_role_id`, `owner_user_id`, `assignee_role`, `due_at`, `reactivity_time`, `reactivity_deadline_at`, `escalation_level`, `closed_at`, `metadata`); initializes `status = PENDING` and computes `reactivity_deadline_at` from `reactivity_time` and the active org profile. |
| Core Services     | Task Management | Update Task status → `TaskService.updateTaskStatus`, hook `useUpdateTaskStatusMutation`                        | Changes a Task’s status using the TASK_STATUS enum (`PENDING`,`IN_PROGRESS`,`ON_HOLD`,`COMPLETED`,`FAILED`,`ESCALATED`,`CANCELLED`), enforcing the canonical state machine and logging transitions as `task_events`.                                                                                                                                                                                                                                                                                                                                                      |
| Core Services     | Task Management | Escalate Task → `TaskService.escalateTask`, job `orgo.task.escalate`                                           | Increments `escalation_level`, sets `status = ESCALATED`, attaches escalation events, and triggers notifications to higher‑level roles defined in policies and profiles.                                                                                                                                                                                                                                                                                                                                                                                                  |
| Core Services     | Task Management | Add Task comment → `TaskService.addComment`, hook `useAddTaskCommentMutation`                                  | Appends structured comments in `task_comments`, respecting per‑comment visibility (`internal_only`,`requester_visible`,`org_wide`) and audit requirements.                                                                                                                                                                                                                                                                                                                                                                                                                |
| Core Services     | Task Management | Fetch Task details → `TaskService.getTaskById`, hook `useTaskDetailsQuery`                                     | Returns a Task plus metadata, label, workflow history, escalation status, comments, and linked Case/Persons for detailed views.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Core Services     | Label & Routing | Resolve canonical label & routing → `LabelRoutingService.resolveLabel`, `RoutingRuleService.applyRoutingRules` | Given a signal or Task draft, computes the canonical label (`<base>.<category><subcategory>.<horizontal_role>`) and applies `routing_rules` to choose an owning role/queue.                                                                                                                                                                                                                                                                                                                                                                                               |
| Core Services     | Label & Routing | Manage classification labels → `LabelService.createLabelDefinition`, hook `useLabelDefinitionsQuery`           | Manages `label_definitions`/`entity_labels` used for risk/topics tags and pattern detection, separate from the single canonical information label on Cases/Tasks.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Core Services     | Database Ops    | Connect to primary DB → `DatabaseService.getPrismaClient`                                                      | Central entry to Prisma backed by validated `database_connection` config (Postgres 15+, optional SQLite for offline dev).                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Core Services     | Database Ops    | Run CRUD on entity → `RepositoryFactory.getRepository(entity).<op>`                                            | Generic repositories for create/read/update/delete over Orgo entities (Tasks, Cases, Persons, etc.), always using parameterized queries.                                                                                                                                                                                                                                                                                                                                                                                                                                  |



---

### 3.4 Configuration, Profiles & Global Parameters

| Module                       | Sub‑module    | Display Name → Code Name                                                                                  | Purpose / Behaviour                                                                                                                                                               |
| ---------------------------- | ------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Configuration & Profiles** | Org Profiles  | Load organization profile → `OrgProfileService.loadProfile`                                               | Loads each org’s active profile (`friend_group`, `hospital`, `advocacy_group`, `retail_chain`, etc.), including reactivity, transparency, pattern sensitivity, and logging depth. |
| Configuration & Profiles     | Org Profiles  | Apply profile defaults → `OrgProfileService.applyDefaults`                                                | Applies profile‑driven defaults (priority, severity, visibility, SLA, automation) when creating Tasks/Cases and when scheduling cyclic reviews.                                   |
| Configuration & Profiles     | Org Profiles  | Preview profile impact → `OrgProfileService.previewProfileDiff`, hook `useProfilePreviewMutation`         | Simulates profile changes and shows impact on escalation timings, notification scope, retention, and insights pattern sensitivity.                                                |
| Configuration & Profiles     | Config Store  | Fetch global configuration → `ConfigService.getGlobalConfig`, hook `useGlobalConfigQuery`                 | Returns merged base + environment + org config from `parameter_overrides`, email/logging/DB configs, and module overlays.                                                         |
| Configuration & Profiles     | Config Store  | Update service configuration → `ConfigService.updateServiceConfig`, hook `useUpdateServiceConfigMutation` | Persists configuration changes (email, workflows, insights, notifications), validates them, and writes audit records.                                                             |
| Configuration & Profiles     | Config Store  | Import configuration bundle → `ConfigService.importConfigBundle`, job `orgo.config.import-bundle`         | Imports YAML/JSON config bundles (including profiles and insights settings), validates against schema, and activates as a single atomic change set.                               |
| Configuration & Profiles     | Feature Flags | Toggle feature flags → `FeatureFlagService.setFlag`, hook `useFeatureFlagsQuery`                          | Manages `feature_flags` to gradually roll out new modules (e.g. new insights dashboards, domain modules) per org.                                                                 |



---

### 3.5 Interfaces (API, Web, Live Updates)

| Module                     | Sub‑module    | Display Name → Code Name                                                                                                       | Purpose / Behaviour                                                                                     |
| -------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| **Interfaces (API & Web)** | Public API    | Get Tasks (list) → `TaskController.listTasks`, hook `useTasksQuery`                                                            | `GET /api/v3/tasks` with filters for status, label, domain, assignee, severity, visibility.             |
| Interfaces (API & Web)     | Public API    | Get single Task → `TaskController.getTask`, hook `useTaskDetailsQuery`                                                         | `GET /api/v3/tasks/:id` returning full Task + related Case metadata.                                    |
| Interfaces (API & Web)     | Public API    | Create Task via API → `TaskController.createTask`, hook `useCreateTaskMutation`                                                | `POST /api/v3/tasks` for direct Task creation (not email‑backed), using canonical Task model and enums. |
| Interfaces (API & Web)     | Public API    | Get Cases (list) → `CaseController.listCases`, hook `useCasesQuery`                                                            | `GET /api/v3/cases` for listing Cases, including filters for CASE_STATUS, label, severity.              |
| Interfaces (API & Web)     | Public API    | Get single Case → `CaseController.getCase`, hook `useCaseDetailsQuery`                                                         | `GET /api/v3/cases/:id` returning Case + linked Tasks, labels, and participants.                        |
| Interfaces (API & Web)     | Public API    | Trigger workflow execution → `WorkflowController.execute`, hook `useExecuteWorkflowMutation`                                   | `POST /api/v3/workflows/:id/execute` for manual workflow runs over a Case/Task context.                 |
| Interfaces (API & Web)     | Admin UI      | Admin Task overview → component `AdminTaskOverviewPage`, hook `useAdminTaskOverviewQuery`                                      | Cross‑domain Task queues with filters by status, domain type, label, role, priority, severity.          |
| Interfaces (API & Web)     | Admin UI      | Case overview → component `AdminCaseOverviewPage`, hook `useAdminCaseOverviewQuery`                                            | High‑level Case list used for cyclic reviews and systemic pattern follow‑up.                            |
| Interfaces (API & Web)     | Admin UI      | Profile configuration screen → `AdminProfileConfigController`, hooks `useOrgProfilesQuery`, component `OrgProfileSettingsPage` | Admin view to inspect and edit org profiles and preview their operational & insights impact.            |
| Interfaces (API & Web)     | Notifications | Send in‑app notification → `NotificationService.sendInApp`, hook `useNotificationsFeedQuery`                                   | Delivers notifications into Orgo UI (banner/toast) alongside email/SMS channels.                        |
| Interfaces (API & Web)     | Notifications | Subscribe to live Task updates → `TaskEventsGateway` (WebSocket), hook `useTaskEventStream`                                    | Streams Task events (status changes, comments, escalations) to the UI in near real‑time.                |



---

### 3.6 Domain Modules (Maintenance, HR, Education, …)

| Module             | Sub‑module         | Display Name → Code Name                                                                                                   | Purpose / Behaviour                                                                                                                |
| ------------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Domain Modules** | Maintenance        | Register maintenance incident → `MaintenanceModuleService.registerIncident`, hook `useRegisterMaintenanceIncidentMutation` | Thin wrapper around `TaskService.createTask` for `type = "maintenance"`, setting domain_subtype and asset metadata.                |
| Domain Modules     | Maintenance        | List maintenance incidents → `MaintenanceModuleService.listIncidents`, hook `useMaintenanceIncidentsQuery`                 | Domain‑filtered Task list for `type = "maintenance"`, including asset links and inspection tickets.                                |
| Domain Modules     | HR                 | Register HR report → `HrModuleService.registerReport`, hook `useRegisterHrReportMutation`                                  | Creates Task(s) + optional HR Case with anonymisation/visibility rules appropriate for HR workflows.                               |
| Domain Modules     | HR                 | List HR Cases → `HrModuleService.listCases`, hook `useHrCasesQuery`                                                        | Returns HR‑scoped Cases/Tasks and escalation history for compliance and review.                                                    |
| Domain Modules     | Education          | Register student incident → `EducationModuleService.registerStudentIncident`, hook `useRegisterStudentIncidentMutation`    | Wraps Task creation for education incidents, attaching `learning_group`/person context metadata.                                   |
| Domain Modules     | Education          | List classroom incidents → `EducationModuleService.listIncidents`, hook `useEducationIncidentsQuery`                       | Returns Tasks scoped to education domain, enriched with group/person context for dashboards and reviews.                           |
| Domain Modules     | Generic Domain API | Generic domain Task factory → `DomainTaskFactory.createDomainTask`                                                         | Shared abstraction used by all domain modules to construct domain‑specific Task metadata views on top of the canonical Task model. |
| Domain Modules     | Generic Domain API | Domain workflow override → `DomainWorkflowService.applyOverrides`                                                          | Applies domain‑specific overrides (e.g. tighter HR reactivity, different escalation levels) on top of global workflow rules.       |



---

### 3.7 Insights, Analytics & Cyclic Overview

| Module                   | Sub‑module      | Display Name → Code Name                                                                                           | Purpose / Behaviour                                                                                      |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **Insights / Analytics** | Reporting API   | Get Task volume report → `ReportsService.getTaskVolumeReport`, hook `useTaskVolumeReportQuery`                     | Aggregates `insights.fact_tasks` into time buckets by domain/status for dashboards.                      |
| Insights / Analytics     | Reporting API   | Get escalation SLA breaches → `ReportsService.getSlaBreaches`, hook `useSlaBreachReportQuery`                      | Returns Tasks that breached profile‑defined SLAs (reactivity or completion), grouped by domain.          |
| Insights / Analytics     | Reporting API   | Get profile effectiveness score → `ReportsService.getProfileScore`, hook `useProfileScoreQuery`                    | Computes how well an org profile meets its reaction/resolution targets using insights fact tables.       |
| Insights / Analytics     | Star Schema     | Export facts to warehouse → `AnalyticsExportService.exportFacts`, job `orgo.analytics.export-facts`                | Periodically exports `fact_*` tables (tasks, cases, escalations, wellbeing) to analytics DB/warehouse.   |
| Insights / Analytics     | Star Schema     | Refresh materialized views → `AnalyticsExportService.refreshMaterializedViews`, job `orgo.analytics.refresh-views` | Refreshes derived views over `insights.fact_*` and `insights.dim_*` for fast dashboard queries.          |
| Insights / Analytics     | Cyclic Patterns | Run weekly pattern review → `PatternDetectionService.runWeekly`, job `orgo.insights.weekly-pattern-review`         | Implements the weekly cyclic overview: detects short‑window patterns and creates new audit/review Cases. |
| Insights / Analytics     | Cyclic Patterns | Run monthly trend report → `PatternDetectionService.runMonthly`, job `orgo.insights.monthly-trend-report`          | Implements monthly pattern detection for trends by label, domain, location, severity.                    |
| Insights / Analytics     | Cyclic Patterns | Run yearly systemic review → `PatternDetectionService.runYearly`, job `orgo.insights.yearly-systemic-review`       | Implements yearly systemic pattern detection; results are turned into leadership‑level review Cases.     |
| Insights / Analytics     | Dashboard UI    | Overview dashboard → component `InsightsOverviewPage`, hook `useInsightsOverviewQuery`                             | Frontend entry point summarizing workload, SLAs, patterns, and cross‑domain risks per organization.      |
| Insights / Analytics     | Cache Warmup    | Warm dashboard caches → `InsightsCacheWarmupService.warmDashboards`, job `orgo.insights.cache-warmup-dashboards`   | Pre‑warms Redis caches for high‑traffic dashboards using TTLs from insights config.                      |

---

### 3.8 Infrastructure, Monitoring & Guardrails

| Module                          | Sub‑module         | Display Name → Code Name                                                                                           | Purpose / Behaviour                                                               |
| ------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| **Infrastructure & Monitoring** | Health & Readiness | API healthcheck endpoint → `HealthController.getHealth` (`GET /api/v3/health`)                                     | Returns aggregated status of DB, queues, config loader, domain modules, insights. |
| Infrastructure & Monitoring     | Health & Readiness | Worker heartbeat job → `WorkerHealthService.heartbeat`, job `orgo.worker.heartbeat`                                | Sends heartbeats from workers and logs anomalies for ops dashboards.              |
| Infrastructure & Monitoring     | Metrics            | Collect workflow latency metrics → `MetricsService.recordWorkflowLatency`                                          | Records per‑workflow latency metrics and sends them to Prometheus/observability.  |
| Infrastructure & Monitoring     | Metrics            | Collect Task queue depth → `MetricsService.recordQueueDepth`                                                       | Measures per‑queue depth (email, workflow, Task) for autoscaling and alerting.    |
| Infrastructure & Monitoring     | Alerts             | Trigger escalation delay alert → `AlertingService.triggerEscalationDelayAlert`, job `orgo.alerts.escalation-delay` | Emits alerts when escalations fall behind SLAs from profiles/config.              |
| Infrastructure & Monitoring     | Alerts             | Trigger error‑rate alert → `AlertingService.triggerErrorRateAlert`, job `orgo.alerts.error-rate`                   | Emits alerts when error rates across services exceed configured thresholds.       |

| Module                    | Sub‑module             | Display Name → Code Name                                                                                      | Purpose / Behaviour                                                                                                           |
| ------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Security & Compliance** | Authentication & RBAC  | Authenticate API request → `AuthGuard.validateAccessToken`                                                    | Validates tokens for API requests, attaches user/org context, and enforces multi‑tenant scoping.                              |
| Security & Compliance     | Authentication & RBAC  | Enforce role permissions → `RbacService.checkPermission`                                                      | Checks that a role may perform a given action on a resource (Task, Case, workflow, config).                                   |
| Security & Compliance     | Privacy                | Anonymise sensitive fields → `PrivacyService.anonymizePayload`                                                | Applies org/profile‑specific anonymisation rules for HR and other sensitive workflows, consistent with VISIBILITY enum.       |
| Security & Compliance     | Privacy                | Generate audit trail entry → `AuditTrailService.recordAuditEvent`                                             | Writes security‑relevant audit events (config changes, permission changes, exports) to dedicated audit logs/tables.           |
| Security & Compliance     | Compliance             | Export audit log for regulator → `ComplianceExportService.exportAuditLog`, job `orgo.compliance.export-audit` | Prepares filtered, visibility/PII‑respecting audit log exports for regulators and external reviewers.                         |
| Security & Compliance     | Data Export Guardrails | Export analytics slice → `InsightsExportService.exportAnalytics`, job `orgo.insights.export-analytics`        | Runs controlled exports from analytics views enforcing `allowed_visibilities` and row limits from insights config.            |
| Security & Compliance     | Logging                | Log system event → `LogService.logEvent`, constant `FN_LOG_SYSTEM_EVENT`                                      | Writes normalized log entries (`timestamp`,`level`,`category`,`message`,`identifier`) with categories from LOG_CATEGORY enum. |
| Security & Compliance     | Logging                | Log security event → `LogService.logSecurityEvent`                                                            | Logs authentication, RBAC, escalation, and export events to `security_events` for long‑term retention.                        |
| Security & Compliance     | Logging                | Rotate logs → `LogRotationService.rotateLogs`, job `orgo.logs.rotate`                                         | Enforces log retention/rotation policies per category (WORKFLOW,TASK,SYSTEM,SECURITY,EMAIL).                                  |
| Security & Compliance     | Logging                | Fetch activity log for entity → `LogQueryService.getActivityForEntity`, hook `useEntityLogQuery`              | Returns `activity_logs` / `task_events` for a specific entity for troubleshooting and reviews.                                |
| Security & Compliance     | Validation             | Validate configuration set → `ConfigValidatorService.validateConfigBundle`                                    | Validates configuration bundles (workflow rules, insights config, profiles) against required keys and enums.                  |
| Security & Compliance     | Validation             | Validate incoming API payload → `PayloadValidationPipe`                                                       | Validates DTOs for Tasks, Cases, workflows, and imports at controller boundaries.                                             |
| Security & Compliance     | Validation             | Normalize Task metadata → `MetadataService.normalizeMetadata`                                                 | Normalizes free‑form Task metadata to avoid conflicts with canonical Task fields and enums.                                   |



---

## 4. How To Use These Code Names

1. **Backend services**

   * When adding a new method to a service, choose the Module/Sub‑module from this document and reuse or extend an existing naming pattern (`TaskService.updateTaskStatus` rather than inventing `changeTaskState`).
   * When creating a new service, ensure the class and file name follow the conventions in §2 and add a row here.

2. **Frontend hooks**

   * All Orgo v3 data fetching must be implemented as RTK Query endpoints in `orgoApi` using the hook naming patterns listed above.
   * When designing a new screen, first identify the needed hooks in this inventory (for example, “Admin Case overview → `useAdminCaseOverviewQuery`”) and implement those; do not invent one‑off fetchers.

3. **Background jobs and queues**

   * Queue job identifiers must match the `orgo.<module>.<action>` names listed in the tables.
   * Worker handlers (Bull, RabbitMQ, etc.) and Airflow DAG wrappers must reference these job IDs and be documented against them.

4. **Cross‑module references**

   * When configuration, tests, or docs refer to a feature, they should use:

     * The **display name** in human‑facing docs (“Run monthly trend report”).
     * The **code name** (`PatternDetectionService.runMonthly`, job `orgo.insights.monthly-trend-report`) in technical references (logs, config keys, test names).

5. **Governance**

   * Any new feature that introduces:

     * A new backend service method,
     * A new RTK Query endpoint/hook, or
     * A new background job or Airflow DAG,

     must add a corresponding row to this inventory as part of the pull request. Code review should block merges until the inventory remains consistent with the implementation and with the canonical schemas/enums in Docs 1–2. 
