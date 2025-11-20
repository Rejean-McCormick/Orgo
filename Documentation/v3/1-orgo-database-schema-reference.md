Preface
1.1 Scope
1.2 Technology & naming assumptions
1.3 Multi‑tenancy conventions
1.4 Default audit columns
1.5 Enum implementation

Module 1 – Core Platform & Multi‑Tenancy
2.1 Organization (organizations)
2.2 Organization Profile (organization_profiles)

Module 2 – Identity & Access Control
3.1 User Accounts & Person Profiles (user_accounts, person_profiles)
3.2 Roles, Permissions & User Role Assignments (roles, permissions, role_permissions, user_role_assignments)
3.3 Sessions & API Tokens (login_sessions, api_tokens)

Module 3 – Communication & Email
4.1 Email Account Configuration (email_account_configs)
4.2 Role Inboxes (role_inboxes)
4.3 Email Threads & Messages (email_threads, email_messages)
4.4 Email Attachments (email_attachments)
4.5 Email Ingestion & Processing Events (email_ingestion_batches, email_processing_events)

Module 4 – Task & Workflow Engine
5.1 Tasks, Assignments, Events & Comments (tasks, task_assignments, task_events, task_comments)
5.2 Routing Rules (routing_rules)
5.3 Workflow Definitions & Instances (workflow_definitions, workflow_instances, workflow_transition_events)
5.4 Escalation Policies, Instances & Events (escalation_policies, escalation_instances, escalation_events)

Module 5 – Configuration, Parameters & Feature Flags
6.1 Parameter Overrides (parameter_overrides)
6.2 Feature Flags (feature_flags)

Module 6 – Labeling & Classification
7.1 Label Definitions (label_definitions)
7.2 Entity Labels (entity_labels)

Module 7 – Notifications
8.1 Notification Templates (notification_templates)
8.2 Notifications (notifications)

Module 8 – Logging, Audit & Observability
9.1 Activity Logs (activity_logs)
9.2 Security Events (security_events)
9.3 System Metric Snapshots (system_metric_snapshots)

Module 9 – Cases (Generic)
10.1 Cases (cases)

Module 10 – Domain: Operations & Maintenance
11.1 Maintenance Assets (maintenance_assets)
11.2 Maintenance Task Links (maintenance_task_links)
11.3 Maintenance Calendar Slots (maintenance_calendar_slots)

Module 11 – Domain: HR & Wellbeing
12.1 HR Cases & Participants (hr_cases, hr_case_participants)
12.2 HR Case Task Links (hr_case_task_links)
12.3 Wellbeing Check‑Ins (wellbeing_checkins)

Module 12 – Domain: Education & Groups
13.1 Learning Groups & Memberships (learning_groups, learning_group_memberships)
13.2 Education Task Links (education_task_links)

Module 13 – Offline & Sync
14.1 Offline Nodes & Sync Sessions (offline_nodes, sync_sessions)
14.2 Sync Conflicts (sync_conflicts)
14.3 Email Archive Imports & Message Mappings (email_archive_import_batches, imported_message_mappings)

Module 14 – Analytics / Insights Star‑Schema (insights.*)
15.1 Date & Organization Dimensions (insights.dim_dates, insights.dim_organizations)
15.2 Task, Case, Person & Group Dimensions (insights.dim_tasks, insights.dim_cases, insights.dim_persons, insights.dim_learning_groups)
15.3 Fact Tables (Tasks, Cases, Wellbeing Check‑Ins) (insights.fact_tasks, insights.fact_cases, insights.fact_wellbeing_checkins)
---

# Orgo v3 – Database Schema Reference (Custom Tables)

## Preface

### Scope

This document is the **canonical reference for all custom Orgo v3 database tables**:

* It covers both the **operational schema** and the **Insights/analytics star‑schema** used by Orgo v3.
* It **excludes**:

  * Database system/catalog tables.
  * Migration bookkeeping (e.g. Alembic tables).
  * Any third‑party auth/session tables we might adopt later.

Other documents (e.g. Foundations, Core Services, Domain Modules, Insights / Analytics specs) may describe **how** these tables are populated or queried, but **table names and core columns are defined here** and must not diverge.

### Technology & naming assumptions

 * **Operational database:** PostgreSQL **15+**.
   *This document defines the canonical shapes for both the operational schema and the analytics star‑schema. The analytics star‑schema MAY be implemented on PostgreSQL 15+ or mirrored into an external warehouse (e.g., BigQuery, Snowflake); when not on Postgres, the same column shapes and token sets apply with warehouse‑appropriate types.*
* **Back‑end stacks (implementation‑neutral spec):**

  * **Python reference implementation:** Python **3.11.x** + SQLAlchemy 2.x.
  * **TypeScript/NestJS implementation:** NestJS (TypeScript) + ORM (e.g. TypeORM/Prisma).
* This document is **language‑agnostic**: table names, column names, and enum values are canonical and must be respected by **all** backend implementations.
* **Table naming:**

  * Table names: `snake_case` plural, optionally qualified with a schema for analytics (e.g. `insights.fact_tasks`).
  * Model/class names in examples: `PascalCase`.

    * Example: `Task` → `tasks`.

### Multi‑tenancy conventions

* Every Orgo installation can host many **organizations** (tenants).
* **Tenancy key:** `organization_id` referencing `organizations.id`.
* Rules:

  * If a record is **org‑scoped**, it has a **non‑NULL `organization_id`**.
  * If a record is **global**, `organization_id` is **NULL**.
  * Some definitional tables (e.g. workflows, labels, templates) can be either:

    * Global (shared defaults, `organization_id IS NULL`), or
    * Overridden per organization (`organization_id` filled).

### Default audit columns

Unless stated otherwise, **all business tables** have:

* `created_at` (timestamptz, NOT NULL, default `now()`)
* `updated_at` (timestamptz, NOT NULL, auto‑updated)

We don’t repeat these in every “Key columns” list unless there’s something special (like `deleted_at`, `closed_at`, etc.).

### Enum implementation

For Orgo v3, all enums listed here are implemented as PostgreSQL ENUM types on the **operational schema** with the exact value sets given in this document (not just free‑text columns). For the **Insights/analytics star‑schema** (`insights.*`), the same token sets are stored as `TEXT` columns containing the canonical values, to decouple the warehouse from OLTP enums (see Module 14 and the Insights config).

Key examples:

* `organization_status_enum = 'active' | 'suspended' | 'archived'`
* `task_status_enum = 'PENDING' | 'IN_PROGRESS' | 'ON_HOLD' | 'COMPLETED' | 'FAILED' | 'ESCALATED' | 'CANCELLED'`
* `task_priority_enum = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'`
* `task_severity_enum = 'MINOR' | 'MODERATE' | 'MAJOR' | 'CRITICAL'`
* `visibility_enum = 'PUBLIC' | 'INTERNAL' | 'RESTRICTED' | 'ANONYMISED'`
* `task_source_enum = 'email' | 'api' | 'manual' | 'sync'`
* `notification_channel_enum = 'email' | 'sms' | 'in_app' | 'webhook'`

> Historical data where `severity = 'info'` SHALL be treated as `severity = 'MINOR'` on read.
> Historical Task/Case `source` values:
>
> * `ui` → `manual`
> * `import` → `sync`
> * `insight` → `api` (with extra metadata indicating system‑generated origin)

**JSON / API representation:**

* API payloads use lower‑case representations, e.g. `"pending"`, `"high"`, `"anonymised"`, but they MUST map 1:1 to the enums above.
* For visibility, the canonical stored value is `ANONYMISED`; JSON uses `"anonymised"` (always with an **s**, never `"anonymized"`).

---

## Module 1 – Core Platform & Multi‑Tenancy

### Organization & Profile

**Organization → Organization (table: organizations)**
Purpose: Represents a tenant using Orgo (company, school, community, team, etc.).
Key columns:

* `id` (UUID PK)
* `slug` (text, unique; short code for URLs/config, e.g. `northside-hospital`)
* `display_name` (text; human name)
* `legal_name` (text, nullable)
* `primary_domain` (text, nullable; email/web domain)
* `status` (`organization_status_enum`: `active` | `suspended` | `archived`)
* `timezone` (text; IANA TZ, e.g. `"America/New_York"`)
* `default_locale` (text; e.g. `"en"`, `"fr-CA"`)

**Organization Profile → OrganizationProfile (table: organization_profiles)**
Purpose: Stores high‑level behavioural profile for an organization (reactivity, transparency, retention, pattern sensitivity). Profile codes correspond to entries in the profiles YAML (friend_group, hospital, advocacy_group, retail_chain, military_organization, environmental_group, artist_collective, etc.). 
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id, UNIQUE; one active profile per org)
* `profile_code` (text; e.g. `friend_group`, `hospital`, `school_basketball`, `advocacy_group`)
* `reactivity_profile` (JSONB; per‑task‑type SLA targets, minutes for `LOW`/`MEDIUM`/`HIGH`/`CRITICAL`)
* `transparency_profile` (JSONB; defaults for who can see what)
* `pattern_sensitivity_profile` (JSONB; thresholds for insights/alerts)
* `retention_profile` (JSONB; log & data retention periods per category)
* `version` (integer; increments on profile changes)

---

## Module 2 – Identity & Access Control

### Users & Persons

**User Account → UserAccount (table: user_accounts)**
Purpose: Login account for a human user within a specific organization.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `email` (text; UNIQUE within organization)
* `display_name` (text)
* `password_hash` (text, nullable for SSO‑only accounts)
* `auth_provider` (enum: `local` | `sso` | `external_only`)
* `status` (enum: `active` | `invited` | `disabled`)
* `locale` (text; optional user‑level override)
* `timezone` (text; optional user‑level override)
* `last_login_at` (timestamptz, nullable)

**Person Profile → PersonProfile (table: person_profiles)**
Purpose: Represents a person tasks are about (players, students, employees, community members) regardless of whether they have an Orgo login.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `linked_user_id` (UUID FK → user_accounts.id, nullable; when this person also has a UserAccount)
* `external_reference` (text, nullable; e.g. student ID, employee number)
* `full_name` (text)
* `date_of_birth` (date, nullable)
* `primary_contact_email` (text, nullable)
* `primary_contact_phone` (text, nullable)
* `confidentiality_level` (enum: `normal` | `sensitive` | `highly_sensitive`; used by higher‑level visibility rules)

### Roles & Permissions

**Role → Role (table: roles)**
Purpose: Named role within an organization (e.g. `maintenance_coordinator`, `hr_officer`, `coach`, `monk`).
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id, nullable for global/system roles)
* `code` (text; unique per organization when `organization_id` NOT NULL, e.g. `ops_maintenance_coordinator`)
* `display_name` (text)
* `description` (text)
* `is_system_role` (boolean; true for built‑in, protected roles)

**Permission → Permission (table: permissions)**
Purpose: Atomic capabilities used across Orgo (e.g. `task.view_sensitive`, `workflow.edit_rules`).
Key columns:

* `id` (UUID PK)
* `code` (text; UNIQUE; stable identifier used in code)
* `description` (text)

**Role Permission → RolePermission (table: role_permissions)**
Purpose: Many‑to‑many linking roles to permissions.
Key columns:

* `id` (UUID PK)
* `role_id` (UUID FK → roles.id)
* `permission_id` (UUID FK → permissions.id)
* `granted_by_user_id` (UUID FK → user_accounts.id, nullable)
* `granted_at` (timestamptz)

**User Role Assignment → UserRoleAssignment (table: user_role_assignments)**
Purpose: Assigns roles to user accounts, optionally scoped (e.g. specific team or site).
Key columns:

* `id` (UUID PK)
* `user_id` (UUID FK → user_accounts.id)
* `role_id` (UUID FK → roles.id)
* `organization_id` (UUID FK → organizations.id)
* `scope_type` (enum: `global` | `team` | `location` | `unit` | `custom`)
* `scope_reference` (text, nullable; semantics depend on `scope_type`)
* `assigned_at` (timestamptz)
* `revoked_at` (timestamptz, nullable)

### Sessions & API Tokens

**Login Session → LoginSession (table: login_sessions)**
Purpose: Tracks user login sessions for audit and security.
Key columns:

* `id` (UUID PK)
* `user_id` (UUID FK → user_accounts.id)
* `organization_id` (UUID FK → organizations.id)
* `ip_address` (inet, nullable)
* `user_agent` (text, nullable)
* `started_at` (timestamptz)
* `ended_at` (timestamptz, nullable)
* `termination_reason` (enum: `logout` | `timeout` | `forced` | `unknown`)

**API Token → ApiToken (table: api_tokens)**
Purpose: Long‑lived tokens for programmatic access (bots, integrations).
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `owner_user_id` (UUID FK → user_accounts.id, nullable)
* `label` (text; e.g. “Maintenance monitor bot”)
* `token_hash` (text; hashed token, not plaintext)
* `scopes` (JSONB; list of permission codes or resource patterns)
* `expires_at` (timestamptz, nullable)
* `revoked_at` (timestamptz, nullable)
* `last_used_at` (timestamptz, nullable)

---

## Module 3 – Communication & Email

### Email Accounts & Role Inboxes

**Email Account Configuration → EmailAccountConfig (table: email_account_configs)**
Purpose: Connection settings for IMAP/SMTP accounts Orgo uses to read/send email.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `label` (text; e.g. “Main HR mailbox”)
* `imap_host` (text), `imap_port` (integer), `imap_use_ssl` (boolean)
* `smtp_host` (text), `smtp_port` (integer), `smtp_use_ssl` (boolean)
* `username` (text)
* `encrypted_password` (text; encrypted at rest)
* `polling_interval_seconds` (integer; default polling cadence)
* `last_successful_poll_at` (timestamptz, nullable)
* `is_active` (boolean)

**Role Inbox → RoleInbox (table: role_inboxes)**
Purpose: Maps roles to incoming email addresses that should create/route tasks.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `role_id` (UUID FK → roles.id)
* `email_account_config_id` (UUID FK → email_account_configs.id)
* `display_address` (text; e.g. `maintenance@org.example`)
* `is_primary` (boolean; one primary per role)
* `accept_anonymous` (boolean; if true, tasks created without a known PersonProfile)

### Messages, Threads, Attachments

**Email Thread → EmailThread (table: email_threads)**
Purpose: Logical conversation thread; groups related messages and links to primary task.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `external_thread_key` (text; provider thread id or synthetic)
* `subject_snapshot` (text; canonical subject)
* `primary_task_id` (UUID FK → tasks.id, nullable)
* `last_message_at` (timestamptz)

**Email Message → EmailMessage (table: email_messages)**
Purpose: Normalized metadata and body for individual emails Orgo ingests or sends. Logical use in Core Services follows the EMAIL_MESSAGE model in the Core Services spec; this table is the physical storage. 
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `email_account_config_id` (UUID FK → email_account_configs.id, nullable)
* `thread_id` (UUID FK → email_threads.id, nullable)
* `message_id_header` (text, nullable; RFC822 `Message-ID`)
* `direction` (enum: `inbound` | `outbound`)
* `from_address` (text)
* `to_addresses` (text[]; array of RFC822 addresses)
* `cc_addresses` (text[], nullable)
* `bcc_addresses` (text[], nullable)
* `subject` (text)
* `received_at` (timestamptz, nullable)
* `sent_at` (timestamptz, nullable)
* `raw_headers` (text)
* `text_body` (text, nullable)
* `html_body` (text, nullable; may be truncated; full body can live in blob storage)
* `related_task_id` (UUID FK → tasks.id, nullable)
* `sensitivity` (enum: `normal` | `sensitive` | `highly_sensitive`)

**Email Attachment → EmailAttachment (table: email_attachments)**
Purpose: Metadata for email attachments, with content in external storage.
Key columns:

* `id` (UUID PK)
* `email_message_id` (UUID FK → email_messages.id)
* `file_name` (text)
* `mime_type` (text)
* `size_bytes` (bigint)
* `storage_key` (text; key/path in object store)
* `checksum` (text; e.g. SHA256)

### Email Ingestion

**Email Ingestion Batch → EmailIngestionBatch (table: email_ingestion_batches)**
Purpose: Tracks each IMAP/POP/Archive poll job for observability and retry.
Key columns:

* `id` (UUID PK)
* `email_account_config_id` (UUID FK → email_account_configs.id)
* `started_at` (timestamptz)
* `finished_at` (timestamptz, nullable)
* `message_count` (integer; messages seen in this batch)
* `status` (enum: `running` | `completed` | `failed`)
* `error_summary` (text, nullable)

**Email Processing Event → EmailProcessingEvent (table: email_processing_events)**
Purpose: Logs processing steps for an email: parsed, classified, linked, or dropped.
Key columns:

* `id` (UUID PK)
* `email_message_id` (UUID FK → email_messages.id)
* `event_type` (enum: `parsed` | `classification_succeeded` | `classification_failed` | `task_created` | `linked_to_existing_task` | `dropped`)
* `details` (JSONB; e.g. classifier scores, matching rules)
* `created_at` (timestamptz)

---

## Module 4 – Task & Workflow Engine

### Tasks & Comments

**Task → Task (table: tasks)**
Purpose: Central unit of work in Orgo; all workflows (maintenance, HR, education, etc.) map to tasks with metadata. The canonical Task field set and enums are locked in the Foundations doc and reused by domain modules and core services.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `case_id` (UUID FK → cases.id, nullable; ties this task to a generic Case)
* `type` (text; domain‑level type, e.g. `maintenance`, `hr_case`, `education_support`, `it_support`, `operations`, `generic`)
* `category` (enum: `request` | `incident` | `update` | `report` | `distribution`)
* `subtype` (text; domain‑specific, e.g. `plumbing`, `harassment`, `attendance`)
* `label` (text; canonical information label `<base>.<category><subcategory>.<horizontal_role>`)
* `title` (text)
* `description` (text)
* `status` (`task_status_enum`: `PENDING` | `IN_PROGRESS` | `ON_HOLD` | `COMPLETED` | `FAILED` | `ESCALATED` | `CANCELLED`)
* `priority` (`task_priority_enum`: `LOW` | `MEDIUM` | `HIGH` | `CRITICAL`)
* `severity` (`task_severity_enum`: `MINOR` | `MODERATE` | `MAJOR` | `CRITICAL`; **NOT NULL**, default `MINOR` if unspecified)
* `visibility` (`visibility_enum`: `PUBLIC` | `INTERNAL` | `RESTRICTED` | `ANONYMISED`)
* `source` (`task_source_enum`: `email` | `api` | `manual` | `sync`)
* `created_by_user_id` (UUID FK → user_accounts.id, nullable)
* `requester_person_id` (UUID FK → person_profiles.id, nullable)
* `owner_role_id` (UUID FK → roles.id, nullable; primary owning role)
* `owner_user_id` (UUID FK → user_accounts.id, nullable; direct owner)
* `assignee_role` (text, nullable; denormalized role identifier such as `"Ops.Maintenance"`, aligned with the label system)
* `reactivity_time` (interval, nullable; SLA/expected response time)
* `reactivity_deadline_at` (timestamptz, nullable; typically `created_at + reactivity_time` under the active org profile)
* `due_at` (timestamptz, nullable)
* `escalation_level` (integer, NOT NULL, default 0; 0 = no escalation, 1+ = escalation depth)
* `closed_at` (timestamptz, nullable)
* `metadata` (JSONB; domain‑specific fields, e.g. asset_id, group_id, location)

> `owner_role_id` / `owner_user_id` are normalized FKs; `assignee_role` is a denormalized label string used for routing/label semantics and cross‑system references.
> Confidentiality is handled via **visibility + org/person/case confidentiality**, not a task‑local `confidentiality_level` field.

**Task Assignment → TaskAssignment (table: task_assignments)**
Purpose: History of which roles/users have been assigned to a task (primary & secondary).
Key columns:

* `id` (UUID PK)
* `task_id` (UUID FK → tasks.id)
* `assigned_role_id` (UUID FK → roles.id, nullable)
* `assigned_user_id` (UUID FK → user_accounts.id, nullable)
* `is_primary` (boolean)
* `assigned_at` (timestamptz)
* `unassigned_at` (timestamptz, nullable)
* `assignment_reason` (text, nullable)

**Task Event → TaskEvent (table: task_events)**
Purpose: Append‑only event log for task lifecycle, used for audit and analytics.
Key columns:

* `id` (UUID PK)
* `task_id` (UUID FK → tasks.id)
* `organization_id` (UUID FK → organizations.id)
* `event_type` (enum: `created` | `status_changed` | `priority_changed` | `ownership_changed` | `comment_added` | `email_linked` | `escalated` | `deadline_updated` | `metadata_updated`)
* `old_value` (JSONB, nullable)
* `new_value` (JSONB, nullable)
* `actor_user_id` (UUID FK → user_accounts.id, nullable)
* `actor_role_id` (UUID FK → roles.id, nullable)
* `origin` (enum: `ui` | `api` | `email` | `system_rule`)
* `created_at` (timestamptz)

**Task Comment → TaskComment (table: task_comments)**
Purpose: Comment/discussion entries attached to tasks, with visibility control.
Key columns:

* `id` (UUID PK)
* `task_id` (UUID FK → tasks.id)
* `author_user_id` (UUID FK → user_accounts.id, nullable for system notes)
* `visibility` (enum: `internal_only` | `requester_visible` | `org_wide`)
* `body` (text)

> `TaskComment.visibility` is a **comment‑level audience flag**, distinct from the global `visibility_enum` used on Tasks/Cases.

### Routing Rules

**Routing Rule → RoutingRule (table: routing_rules)**
Purpose: Declarative rules to decide **who** initially owns new tasks (by role or user) based on type/category/labels.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id, nullable for global defaults)
* `name` (text; human label, e.g. “Default HR sensitive complaints routing”)
* `task_type` (text, nullable; e.g. `maintenance`, `hr_case`)
* `task_category` (enum: `request` | `incident` | `update` | `report` | `distribution`, nullable)
* `label_codes` (text[]; optional required labels, e.g. `['anonymous']`)
* `priority_min` (`task_priority_enum`, nullable)
* `target_role_id` (UUID FK → roles.id, nullable)
* `target_user_id` (UUID FK → user_accounts.id, nullable)
* `is_fallback` (boolean; used when no more specific rule matches)
* `weight` (integer; for tie‑breaking between matching rules)

### Workflow Definitions & Instances

**Workflow Definition → WorkflowDefinition (table: workflow_definitions)**
Purpose: Canonical definition of a workflow (states, transitions, guards) stored as JSON, optionally org‑specific.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id, nullable; NULL = global default)
* `code` (text; UNIQUE within org or globally, e.g. `maintenance_default`, `hr_sensitive_case`)
* `name` (text)
* `description` (text)
* `definition_blob` (JSONB; normalized workflow spec: states, transitions, actions)
* `is_active` (boolean)
* `version` (integer)

**Workflow Instance → WorkflowInstance (table: workflow_instances)**
Purpose: Runtime instance of a workflow bound to a task.
Key columns:

* `id` (UUID PK)
* `workflow_definition_id` (UUID FK → workflow_definitions.id)
* `task_id` (UUID FK → tasks.id)
* `organization_id` (UUID FK → organizations.id)
* `current_state` (text; key from definition)
* `status` (enum: `running` | `completed` | `cancelled`)
* `started_at` (timestamptz)
* `finished_at` (timestamptz, nullable)

**Workflow Transition Event → WorkflowTransitionEvent (table: workflow_transition_events)**
Purpose: Logs transitions between workflow states, including who triggered them.
Key columns:

* `id` (UUID PK)
* `workflow_instance_id` (UUID FK → workflow_instances.id)
* `task_id` (UUID FK → tasks.id)
* `from_state` (text, nullable when first state)
* `to_state` (text)
* `trigger` (text; e.g. `submit`, `approve`, `close`)
* `actor_user_id` (UUID FK → user_accounts.id, nullable)
* `actor_role_id` (UUID FK → roles.id, nullable)
* `reason` (text, nullable)
* `occurred_at` (timestamptz)

### Escalation & SLA

**Escalation Policy → EscalationPolicy (table: escalation_policies)**
Purpose: Multi‑step escalation plans for certain task types/categories.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id, nullable for global policies)
* `task_type` (text, nullable)
* `category` (enum: `request` | `incident` | `update` | `report` | `distribution`, nullable)
* `policy_code` (text; e.g. `standard_hr_sensitive`, unique per org)
* `definition` (JSONB; steps with timing + target roles/users/channels)
* `is_default` (boolean)
* `version` (integer)

**Escalation Instance → EscalationInstance (table: escalation_instances)**
Purpose: Runtime execution of an escalation policy for a particular task.
Key columns:

* `id` (UUID PK)
* `task_id` (UUID FK → tasks.id)
* `escalation_policy_id` (UUID FK → escalation_policies.id)
* `current_step_index` (integer)
* `status` (enum: `idle` | `scheduled` | `in_progress` | `completed` | `cancelled`)
* `next_fire_at` (timestamptz, nullable)
* `started_at` (timestamptz)
* `completed_at` (timestamptz, nullable)

**Escalation Event → EscalationEvent (table: escalation_events)**
Purpose: Logs each concrete escalation action taken for a task.
Key columns:

* `id` (UUID PK)
* `escalation_instance_id` (UUID FK → escalation_instances.id)
* `task_id` (UUID FK → tasks.id)
* `step_index` (integer)
* `action_type` (enum: `notify_role` | `notify_user` | `auto_reassign` | `auto_close` | `raise_severity`)
* `action_payload` (JSONB; details: which role/user, which channel)
* `executed_at` (timestamptz)
* `success` (boolean)
* `error_message` (text, nullable)

---

## Module 5 – Configuration, Parameters & Feature Flags

**Parameter Override → ParameterOverride (table: parameter_overrides)**
Purpose: Physical storage of configuration knobs (parameters) per org, aligned with the Global Parameter Reference. 
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id, nullable for global defaults)
* `module_code` (text; e.g. `core`, `maintenance`, `hr`, `education`, `insights`)
* `parameter_key` (text; stable identifier, e.g. `reactivity.hr.critical_sla_minutes`)
* `value` (JSONB; typed via param spec: number/string/enum/object)
* `source` (enum: `default` | `org_override` | `profile` | `runtime`)
* `effective_from` (timestamptz)

**Feature Flag → FeatureFlag (table: feature_flags)**
Purpose: Toggles to roll out or restrict features per organization.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id, nullable for global flags)
* `code` (text; e.g. `insights_cyclic_reviews_v2`)
* `description` (text)
* `enabled` (boolean)
* `rollout_strategy` (JSONB; e.g. percentage, subset of roles)
* `enabled_from` (timestamptz, nullable)
* `disabled_at` (timestamptz, nullable)

---

## Module 6 – Labeling & Classification

### Canonical labels vs classification tags

* `tasks.label` and `cases.label` store the **canonical information label** of the form
  `<base>.<category><subcategory>.<horizontal_role>`,
  as defined in the cross‑document Orgo v3 semantics.
* The `label_definitions` and `entity_labels` tables are used for **additional classification tags** (e.g. `self_harm_risk`, `equipment_failure`, `conflict`) that are attached to tasks, people, groups, and cases.
* Canonical labels are 1‑per‑entity (Task/Case); classification tags are 0‑to‑many per entity.

**Label Definition → LabelDefinition (table: label_definitions)**
Purpose: Standardized labels used for classification/pattern detection.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id, nullable for global labels)
* `code` (text; unique per org/global, e.g. `anonymous`, `equipment_failure`)
* `display_name` (text)
* `description` (text)
* `category` (text; e.g. `risk`, `topic`, `visibility`)
* `color_hint` (text, nullable; hex or name for UI)

**Entity Label → EntityLabel (table: entity_labels)**
Purpose: Attaches labels to different entities (tasks, people, groups, cases) in a uniform way.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `label_id` (UUID FK → label_definitions.id)
* `entity_type` (text; e.g. `task`, `person`, `learning_group`, `case`, `hr_case`)
* `entity_id` (UUID; ID in the corresponding table)
* `applied_by_user_id` (UUID FK → user_accounts.id, nullable)
* `applied_at` (timestamptz)

---

## Module 7 – Notifications

**Notification Template → NotificationTemplate (table: notification_templates)**
Purpose: Templates for notifications per org and channel (subject/body or payload format).
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id, nullable for global templates)
* `code` (text; unique per org, e.g. `task_created_requester`, `task_escalated_owner`)
* `channel` (`notification_channel_enum`: `email` | `sms` | `in_app` | `webhook`)
* `subject_template` (text, nullable; email‑only)
* `body_template` (text; text or JSON payload template)
* `is_active` (boolean)
* `version` (integer)

**Notification → Notification (table: notifications)**
Purpose: Individual notification instances queued/sent to users or external targets.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `channel` (`notification_channel_enum`: `email` | `sms` | `in_app` | `webhook`)
* `recipient_user_id` (UUID FK → user_accounts.id, nullable)
* `recipient_address` (text, nullable; email/phone/webhook URL/device token)
* `template_id` (UUID FK → notification_templates.id, nullable if custom payload)
* `payload` (JSONB; merged data ready for the channel)
* `status` (enum: `queued` | `sent` | `failed` | `cancelled`)
* `related_task_id` (UUID FK → tasks.id, nullable)
* `queued_at` (timestamptz)
* `sent_at` (timestamptz, nullable)
* `failed_at` (timestamptz, nullable)
* `error_message` (text, nullable)

  Channel values in both tables are stored as lower-case tokens and map 1:1 to the global `NOTIFICATION_CHANNEL` enum (`EMAIL`, `SMS`, `IN_APP`, `WEBHOOK`) used in configs and services. Mobile push, if implemented, is modelled via `IN_APP` plus client-side delivery rather than a separate `PUSH` channel.

---

## Module 8 – Logging, Audit & Observability

**Activity Log → ActivityLog (table: activity_logs)**
Purpose: Generic, non‑security activity log for user/system actions (for audit & insights).
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `user_id` (UUID FK → user_accounts.id, nullable)
* `session_id` (UUID FK → login_sessions.id, nullable)
* `actor_type` (enum: `user` | `system`)
* `action` (text; e.g. `task_viewed`, `config_updated`, `report_run`)
* `target_type` (text; e.g. `task`, `workflow_definition`, `person`)
* `target_id` (UUID, nullable)
* `details` (JSONB)

**Security Event → SecurityEvent (table: security_events)**
Purpose: High‑importance security events (failed logins, permission changes, suspicious exports).
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id, nullable for system‑wide events)
* `user_id` (UUID FK → user_accounts.id, nullable)
* `event_type` (enum: `failed_login` | `permission_escalation` | `api_abuse` | `data_export` | `config_change`)
* `ip_address` (inet, nullable)
* `user_agent` (text, nullable)
* `details` (JSONB)
* `severity` (enum: `low` | `medium` | `high` | `critical`)

**System Metric Snapshot → SystemMetricSnapshot (table: system_metric_snapshots)**
Purpose: Periodic snapshots of aggregated metrics for long‑term trends at low cardinality.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id, nullable)
* `period_start` (timestamptz)
* `period_end` (timestamptz)
* `metrics` (JSONB; e.g. `tasks_created`, `escalations_triggered`, `avg_response_time_minutes`)

---

## Module 9 – Cases (Generic)

**Case → Case (table: cases)**
Purpose: Generic case container that groups tasks, patterns, and context across domains (HR, maintenance incidents, education support, advocacy, etc.). JSON contracts and lifecycle semantics are defined in the Cyclic Overview / JSON doc; this table is the physical backing.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `source_type` (enum: `email` | `api` | `manual` | `sync`; same semantics as `tasks.source`)
* `source_reference` (text, nullable; external id or URI)
* `label` (text; canonical information label `<base>.<category><subcategory>.<horizontal_role>`)
* `title` (text)
* `description` (text)
* `status` (enum: `open` | `in_progress` | `resolved` | `archived`; canonical case lifecycle)
* `severity` (`task_severity_enum`: `MINOR` | `MODERATE` | `MAJOR` | `CRITICAL`)
* `reactivity_time` (interval, nullable; expected responsiveness window for the case)
* `origin_vertical_level` (integer; e.g. 1, 10, 100, 1000)
* `origin_role` (text; e.g. `"Ops.Maintenance"`, `"HR.CaseOfficer"`)
* `tags` (text[]; high‑level tags, e.g. `['harassment','classroom']`)
* `location` (JSONB; structure holding physical/organizational location info)
* `metadata` (JSONB; includes `pattern_sensitivity`, `review_frequency`, `notification_scope`, `visibility`, `escalation_path[]`, `profile_id`, and other case‑level settings)

> Links from cases to tasks and related cases are represented via join tables and domain‑specific link tables (e.g. `tasks.case_id`, `hr_case_task_links`, and optional generic `case_case_links` if introduced later).
> Historical `source_type` values such as `email_thread`, `import`, `insight` SHOULD be mapped during migration to `email`, `sync`, or `api` respectively.

---

## Module 10 – Domain: Operations & Maintenance

**Maintenance Asset → MaintenanceAsset (table: maintenance_assets)**
Purpose: Assets that can have maintenance tasks (buildings, rooms, vehicles, equipment).
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `code` (text; unique per org, e.g. `BLDG_A_F2_R210`)
* `name` (text)
* `category` (text; e.g. `building` | `room` | `vehicle` | `equipment`)
* `location_description` (text, nullable)
* `metadata` (JSONB; vendor, serial, capacity, etc.)
* `is_active` (boolean)

**Maintenance Task Link → MaintenanceTaskLink (table: maintenance_task_links)**
Purpose: Connects generic tasks to maintenance context (asset and optional external work order).
Key columns:

* `id` (UUID PK)
* `task_id` (UUID FK → tasks.id)
* `asset_id` (UUID FK → maintenance_assets.id)
* `work_order_reference` (text, nullable; external CMMS id)
* `priority_override` (`task_priority_enum`, nullable)

**Maintenance Calendar Slot → MaintenanceCalendarSlot (table: maintenance_calendar_slots)**
Purpose: Scheduled work slots for maintenance tasks (for planning, scheduling, and pattern analysis).
Key columns:

* `id` (UUID PK)
* `task_id` (UUID FK → tasks.id)
* `assigned_user_id` (UUID FK → user_accounts.id, nullable)
* `start_at` (timestamptz)
* `end_at` (timestamptz)
* `status` (enum: `planned` | `in_progress` | `completed` | `cancelled`)

---

## Module 11 – Domain: HR & Wellbeing

**HR Case → HrCase (table: hr_cases)**
Purpose: HR‑specific extension of a generic Case for sensitive matters (harassment, conflict, performance, etc.).
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `case_id` (UUID FK → cases.id, UNIQUE; 1‑to‑1 refinement of a generic Case)
* `case_code` (text; unique per org, e.g. `HR-2025-0043`)
* `title` (text)
  *(usually mirrors `cases.title`, but HR can override or anonymise)*
* `description` (text)
  *(HR‑specific narrative; may be more detailed or more anonymised than generic `cases.description`)*
* `status` (enum: `open` | `under_review` | `resolved` | `dismissed`; HR pipeline state, distinct from generic `cases.status`)
* `confidentiality_level` (enum: `sensitive` | `highly_sensitive`; drives stricter visibility and handling rules)
* `case_owner_role_id` (UUID FK → roles.id)
* `case_owner_user_id` (UUID FK → user_accounts.id, nullable)
* `primary_task_id` (UUID FK → tasks.id, nullable)
* `opened_at` (timestamptz)
* `closed_at` (timestamptz, nullable)

**HR Case Participant → HrCaseParticipant (table: hr_case_participants)**
Purpose: People involved in an HR case (complainant, respondent, witnesses, advocates).
Key columns:

* `id` (UUID PK)
* `hr_case_id` (UUID FK → hr_cases.id)
* `person_id` (UUID FK → person_profiles.id)
* `role_in_case` (enum: `complainant` | `respondent` | `witness` | `advocate` | `other`)
* `notes` (text, nullable)

**HR Case Task Link → HrCaseTaskLink (table: hr_case_task_links)**
Purpose: Links generic tasks (meetings, investigations, communications) to an HR case.
Key columns:

* `id` (UUID PK)
* `hr_case_id` (UUID FK → hr_cases.id)
* `task_id` (UUID FK → tasks.id)
* `link_type` (text; e.g. `investigation`, `communication`, `followup`, `support`)

**Wellbeing Check‑In → WellbeingCheckin (table: wellbeing_checkins)**
Purpose: Structured wellbeing check‑ins (survey or manual) tied to people/groups for early risk detection.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `person_id` (UUID FK → person_profiles.id, nullable for anonymous)
* `submitted_by_user_id` (UUID FK → user_accounts.id, nullable)
* `context` (text; e.g. `basketball_team`, `residence`, `study_group`)
* `score` (integer; e.g. 1–10)
* `tags` (text[]; e.g. `['stress', 'sleep']`)
* `notes` (text, nullable)
* `related_task_id` (UUID FK → tasks.id, nullable)

---

## Module 12 – Domain: Education & Groups

**Learning Group → LearningGroup (table: learning_groups)**
Purpose: Represents a class/team/group of learners (school class, basketball team, study group).
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `code` (text; unique per org, e.g. `CLASS_6A`, `BASKETBALL_U15`)
* `name` (text)
* `description` (text, nullable)
* `category` (text; e.g. `school_class` | `sports_team` | `study_circle`)
* `advisor_role_id` (UUID FK → roles.id, nullable)

**Learning Group Membership → LearningGroupMembership (table: learning_group_memberships)**
Purpose: Links people to learning groups with roles (student, player, coach, parent).
Key columns:

* `id` (UUID PK)
* `learning_group_id` (UUID FK → learning_groups.id)
* `person_id` (UUID FK → person_profiles.id)
* `role` (enum: `student` | `player` | `parent` | `coach` | `teacher` | `mentor`)
* `joined_at` (timestamptz)
* `left_at` (timestamptz, nullable)

**Education Task Link → EducationTaskLink (table: education_task_links)**
Purpose: Associates tasks with educational context (groups, individuals, education‑related events).
Key columns:

* `id` (UUID PK)
* `task_id` (UUID FK → tasks.id)
* `learning_group_id` (UUID FK → learning_groups.id, nullable)
* `person_id` (UUID FK → person_profiles.id, nullable)
* `context_note` (text, nullable; e.g. `attendance`, `performance`, `conflict`)

---

## Module 13 – Offline & Sync

**Offline Node → OfflineNode (table: offline_nodes)**
Purpose: Represents a node/device that can operate offline (SQLite) and sync with central Orgo.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `node_identifier` (text; unique, e.g. hostname + install id)
* `description` (text, nullable)
* `status` (enum: `active` | `inactive` | `retired`)
* `last_sync_at` (timestamptz, nullable)

**Sync Session → SyncSession (table: sync_sessions)**
Purpose: Tracks each synchronization session between an offline node and central Postgres.
Key columns:

* `id` (UUID PK)
* `offline_node_id` (UUID FK → offline_nodes.id)
* `direction` (enum: `upload` | `download` | `bidirectional`)
* `started_at` (timestamptz)
* `finished_at` (timestamptz, nullable)
* `status` (enum: `running` | `completed` | `failed`)
* `summary` (JSONB; counts of records created/updated/deleted)
* `error_message` (text, nullable)

**Sync Conflict → SyncConflict (table: sync_conflicts)**
Purpose: Conflicts discovered during sync (e.g. concurrent edits); used for manual or automated resolution.
Key columns:

* `id` (UUID PK)
* `sync_session_id` (UUID FK → sync_sessions.id)
* `entity_type` (text; e.g. `task`, `task_event`, `person_profile`)
* `entity_id` (UUID)
* `server_version` (JSONB; snapshot before resolution)
* `client_version` (JSONB; snapshot from offline node)
* `resolution_strategy` (enum: `server_wins` | `client_wins` | `manual_review` | `merged`)
* `resolved` (boolean)
* `resolved_at` (timestamptz, nullable)
* `resolved_by_user_id` (UUID FK → user_accounts.id, nullable)

**Email Archive Import Batch → EmailArchiveImportBatch (table: email_archive_import_batches)**
Purpose: Tracks imports of offline email archives (.pst/.mbox) into Orgo.
Key columns:

* `id` (UUID PK)
* `organization_id` (UUID FK → organizations.id)
* `source_type` (enum: `pst` | `mbox` | `eml_folder`)
* `source_path` (text; path/URI to archive)
* `started_at` (timestamptz)
* `finished_at` (timestamptz, nullable)
* `status` (enum: `running` | `completed` | `failed`)
* `messages_imported` (integer)
* `error_summary` (text, nullable)

**Imported Message Mapping → ImportedMessageMapping (table: imported_message_mappings)**
Purpose: Maps original archive message identifiers to Orgo `email_messages` IDs.
Key columns:

* `id` (UUID PK)
* `email_archive_import_batch_id` (UUID FK → email_archive_import_batches.id)
* `external_message_identifier` (text; e.g. PST entry ID)
* `email_message_id` (UUID FK → email_messages.id)

---

## Module 14 – Analytics / Insights Star‑Schema

All analytics tables live in the **`insights` schema** of the primary PostgreSQL database (or a dedicated analytics database with the same schema names). This module defines the **canonical fact and dimension tables** used by the Insights layer; configuration and retention are defined in the Insights Module Config.

In line with the Insights config, **enum‑like fields in this schema are stored as `TEXT` columns** whose values are the canonical enum tokens from the operational schema (`TASK_STATUS`, `TASK_PRIORITY`, `TASK_SEVERITY`, `VISIBILITY`, etc.). They are not Postgres ENUMs in the warehouse.

### Dimensions

**Analytics Date Dimension → DimDate (table: insights.dim_dates)**
Purpose: Calendar/date dimension used for grouping facts by day.
Key columns:

* `date_key` (date PK; e.g. `2025-03-14`)
* `year` (integer)
* `quarter` (integer; 1–4)
* `month` (integer; 1–12)
* `month_name` (text)
* `week_of_year` (integer)
* `day_of_week` (integer; 1=Monday–7=Sunday)
* `day_name` (text)
* `is_weekend` (boolean)

**Analytics Organization Dimension → DimOrganization (table: insights.dim_organizations)**
Purpose: Organization attributes used in reports.
Key columns:

* `organization_id` (UUID PK; FK → organizations.id)
* `slug` (text)
* `display_name` (text)
* `org_type` (text; optional, e.g. `hospital`, `school`, `club`)
* `timezone` (text)
* `active_from` (date)
* `active_to` (date, nullable)

**Analytics Task Dimension → DimTask (table: insights.dim_tasks)**
Purpose: Denormalized view of tasks for reporting (slowly changing dimension).
Key columns:

* `task_id` (UUID PK; FK → tasks.id)
* `organization_id` (UUID FK → organizations.id)
* `case_id` (UUID FK → cases.id, nullable)
* `label` (text; canonical label)
* `type` (text)
* `category` (text)
* `subtype` (text, nullable)
* `priority` (text; one of `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`)
* `severity` (text; one of `MINOR`, `MODERATE`, `MAJOR`, `CRITICAL`)
* `visibility` (text; one of `PUBLIC`, `INTERNAL`, `RESTRICTED`, `ANONYMISED`)
* `source` (text; one of `email`, `api`, `manual`, `sync`)
* `assignee_role` (text, nullable)
* `created_at` (timestamptz)
* `closed_at` (timestamptz, nullable)
* `current_status` (text; one of `PENDING`, `IN_PROGRESS`, `ON_HOLD`, `COMPLETED`, `FAILED`, `ESCALATED`, `CANCELLED`)

**Analytics Case Dimension → DimCase (table: insights.dim_cases)**
Purpose: Denormalized view of cases for reporting.
Key columns:

* `case_id` (UUID PK; FK → cases.id)
* `organization_id` (UUID FK → organizations.id)
* `label` (text)
* `title` (text)
* `status` (text; one of `open`, `in_progress`, `resolved`, `archived`)
* `severity` (text; one of `MINOR`, `MODERATE`, `MAJOR`, `CRITICAL`)
* `origin_vertical_level` (integer)
* `origin_role` (text)
* `opened_at` (timestamptz)
* `closed_at` (timestamptz, nullable)

**Analytics Person Dimension → DimPerson (table: insights.dim_persons)**
Purpose: Basic person attributes for reporting on individuals.
Key columns:

* `person_id` (UUID PK; FK → person_profiles.id)
* `organization_id` (UUID FK → organizations.id)
* `full_name` (text)
* `external_reference` (text, nullable)
* `confidentiality_level` (enum: `normal` | `sensitive` | `highly_sensitive`)

**Analytics Group Dimension → DimLearningGroup (table: insights.dim_learning_groups)**
Purpose: Group attributes (class/team/etc.) used in Insights.
Key columns:

* `learning_group_id` (UUID PK; FK → learning_groups.id)
* `organization_id` (UUID FK → organizations.id)
* `code` (text)
* `name` (text)
* `category` (text)

### Facts

**Task Fact → FactTask (table: insights.fact_tasks)**
Purpose: One row per task capturing core lifecycle metrics for reporting.
Key columns:

* `id` (bigserial PK)
* `task_id` (UUID FK → tasks.id)
* `organization_id` (UUID FK → organizations.id)
* `created_date_key` (date FK → insights.dim_dates.date_key)
* `closed_date_key` (date FK → insights.dim_dates.date_key, nullable)
* `current_status` (text; one of `PENDING`, `IN_PROGRESS`, `ON_HOLD`, `COMPLETED`, `FAILED`, `ESCALATED`, `CANCELLED`)
* `priority` (text; one of `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`)
* `severity` (text; one of `MINOR`, `MODERATE`, `MAJOR`, `CRITICAL`)
* `source` (text; one of `email`, `api`, `manual`, `sync`)
* `time_to_first_response_seconds` (bigint, nullable)
* `time_to_completion_seconds` (bigint, nullable)
* `escalation_count` (integer, default 0)
* `comment_count` (integer, default 0)

**Case Fact → FactCase (table: insights.fact_cases)**
Purpose: One row per case with lifecycle metrics and link counts.
Key columns:

* `id` (bigserial PK)
* `case_id` (UUID FK → cases.id)
* `organization_id` (UUID FK → organizations.id)
* `opened_date_key` (date FK → insights.dim_dates.date_key)
* `closed_date_key` (date FK → insights.dim_dates.date_key, nullable)
* `status` (text; one of `open`, `in_progress`, `resolved`, `archived`)
* `severity` (text; one of `MINOR`, `MODERATE`, `MAJOR`, `CRITICAL`)
* `linked_task_count` (integer, default 0)
* `escalation_count` (integer, default 0)
* `review_count` (integer, default 0)

**Wellbeing Check‑In Fact → FactWellbeingCheckin (table: insights.fact_wellbeing_checkins)**
Purpose: One row per wellbeing check‑in, tied to person/group and time.
Key columns:

* `id` (bigserial PK)
* `checkin_id` (UUID FK → wellbeing_checkins.id)
* `organization_id` (UUID FK → organizations.id)
* `person_id` (UUID FK → person_profiles.id, nullable)
* `learning_group_id` (UUID FK → learning_groups.id, nullable)
* `date_key` (date FK → insights.dim_dates.date_key)
* `score` (integer)
* `tags` (text[])
* `related_case_id` (UUID FK → cases.id, nullable)
* `related_task_id` (UUID FK → tasks.id, nullable)
