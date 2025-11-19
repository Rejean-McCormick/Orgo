# Orgo v3 – Doc 2/8

**Foundations, Locked Variables & Operational Checklists** 

---

## 0. Role of this document in the Orgo set

This document is the **foundation layer** for Orgo v3. It defines:

* The **global invariants** Orgo relies on (multi‑tenancy, identity model).
* The **locked enums and canonical field sets** for Tasks, Cases, labels, logging, and notifications.
* How **configuration** is structured/validated across environments.
* The **contracts + checklists** that Core Services and Domain Modules must respect.
* How **profiles, insights, and guardrails** plug into the platform.

It is implementation‑agnostic (TS/NestJS, Python, etc.) and sits under Docs:

* **Doc 1 – Database Schema Reference (Custom Tables)** – physical schema and enums. 
* **Doc 3 – Domain Modules (Orgo v3)** – domain adapters over the core Task/Case engine. 
* **Doc 4 – Functional Code‑Name Inventory** – mapping from features to services/jobs/hooks. 
* **Doc 5 – Core Services Specification** – detailed headless services (email, tasks, workflows, logging). 
* **Doc 6 – Insights Module Config Parameters** and the **profiles YAML** – analytics & behavioural profiles.
* **Doc 8 – Cyclic Overview & Universal Flow Rules** – label semantics, JSON contracts, cyclic reviews. 

If anything here conflicts with **Doc 1** (schema) or the actual DB migrations, **Doc 1 wins** and this doc must be updated. 

---

## 1. Orgo mental model (non‑normative orientation)

This section explains how the rest of the spec hangs together. It is descriptive, not a place to introduce new enums.

### 1.1 Multi‑tenant backbone

* Orgo is **multi‑tenant** – one deployment serves many organizations.
* Every org is a row in `organizations`, identified by `organization_id` with timezone, locale, status, and a linked **organization profile**. 
* Every record that “belongs to” an org (email, task, case, profile, notification, log, etc.) carries `organization_id` for isolation.
* Two key identity concepts: 

  * **User accounts** (`user_accounts`) – who logs into Orgo.
  * **Person profiles** (`person_profiles`) – who things are *about* (students, players, employees, community members), regardless of login.

Permissions are expressed in terms of **roles** and **permissions** attached to user accounts, with optional scoping by team/location. 

### 1.2 Signals → Cases & Tasks

Orgo’s core job is to **ingest messy signals and turn them into structured work**:

* **Signals** come from:

  * Email (`email_messages` + `email_threads`), including attachments and classifier metadata. 
  * HTTP APIs / UIs (`TaskController.createTask`, domain endpoints).
  * Offline imports & sync (`offline_nodes`, `sync_sessions`, `email_archive_import_batches`). 

* Signals pass through the **Email Gateway** and **Workflow Engine**, which decide:

  * Whether to **open a Case** (`cases`),
  * Whether to **create a Task** (`tasks`),
  * Which **domain** (`type`), **category** (`request/incident/...`), and **role** should own it.

The **Task** is the **canonical unit of work**, defined once in Doc 1 and reused everywhere; **Cases** are long‑lived containers that group Tasks, context and patterns. 

### 1.3 Label system (how routing works)

Every Case and Task carries a **structured label**:

```text
<base>.<category><subcategory>.<horizontal_role>
```

Example: `100.94.Operations.Safety`:

* `100` = broadcast to department heads (vertical level).
* `.9` = Crisis & emergency information.
* `.4` = Report.
* `Operations.Safety` = horizontal role (functional area).

This label informs:

* **Routing** – which queues/roles the work goes to.
* **Visibility default** – how sensitive it is.
* **Analytics & patterns** – what “kind” of incident it is.

Special bases `10`, `100`, `1000` are **broadcasts**. They are **informational by default** – they do not automatically spawn mandatory Tasks unless a workflow rule says so.

### 1.4 Domain modules

Domain modules (Maintenance, HR, Education, etc.):

* Do **not** own their own task tables or lifecycles.
* Are thin adapters over the global `Task`/`Case` model:

  * A config file `<domain>_module.yaml` (allowed categories, subtypes, email patterns, routing hints).
  * A handler `<domain>_handler.py` with hooks such as `on_task_create`, `on_task_update`. 

They plug into the **central Task handler + Workflow Engine**; all domain behaviour is expressed via config, metadata and hooks, not separate schemas.

### 1.5 Profiles, Insights & guardrails

* **Profiles** (friend group, hospital, advocacy group, retail chain, military org, environmental group, artist collective, etc.) define **reactivity, transparency, review cadence, retention, pattern sensitivity, logging depth and automation** for an organization.
* **Insights** (star schema, ETL/Airflow, pattern detection) continuously scan Tasks/Cases, wellbeing check‑ins, groups, etc., and feed patterns back as work items and audit Cases.
* **Guardrails** – visibility enums, logging/audit tables, security events and export rules – ensure Orgo is safe for high‑sensitivity domains (e.g. HR, hospitals) while still usable for low‑stakes groups.

### 1.6 What Orgo is (and is not)

Orgo is:

* A **unified, schema‑driven case & task platform** that multiple orgs and domains plug into.
* A **routing + escalation + pattern‑detection engine** over signals and work.

Orgo is **not**:

* A generic CRM / ERP / accounting system.
* A stand‑alone kanban board toy.

---

## 2. Global invariants & enums (locked)

These enums and core concepts are **canonical** for Orgo v3. Other docs and code must reference them rather than introduce alternatives.

### 2.1 Environments

```text
ENVIRONMENT = { "dev", "staging", "prod", "offline" }
```

* `dev`      – local / developer environments.
* `staging`  – pre‑production staging.
* `prod`     – production.
* `offline`  – disconnected nodes that sync later.

Every config file must include:

```yaml
metadata:
  environment: "<dev|staging|prod|offline>"
  version: "3.x"
  last_updated: "YYYY-MM-DD"
```

### 2.2 Multi‑tenancy & identity invariants

* Every org has `organizations.id` → `organization_id` elsewhere.
* Every org may have **one active profile** (`organization_profiles`). 
* Every Task/Case/Email/Notification/Log:

  * Either belongs to exactly one org (`organization_id` NOT NULL),
  * Or is a global default/config row (`organization_id` NULL).

User vs Person:

* **User** (`user_accounts`) = login account in an org.
* **Person** (`person_profiles`) = a human subject (student, employee, player, community member), optionally linked to a user. 

### 2.3 Task lifecycle

Canonical DB enum: `task_status_enum`. 

```text
TASK_STATUS = {
  "PENDING",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "FAILED",
  "ESCALATED",
  "CANCELLED"
}
```

Semantics:

* `PENDING`     – created, not started.
* `IN_PROGRESS` – someone is actively working on it.
* `ON_HOLD`     – paused (waiting on dependency/decision).
* `COMPLETED`   – done successfully.
* `FAILED`      – attempted but unsuccessful; further action needed.
* `ESCALATED`   – escalated to higher authority/queue.
* `CANCELLED`   – explicitly stopped.

**Rules:**

* These are the **only** allowed values in DB, APIs, logs for Task status.
* State machine constraints and allowed transitions are specified in **Doc 5** and must be enforced everywhere.

### 2.4 Case lifecycle

Canonical DB enum: `cases.status`. 

```text
CASE_STATUS = {
  "open",
  "in_progress",
  "resolved",
  "archived"
}
```

* `open`        – new Case, not yet being actively worked.
* `in_progress` – actively being handled (has active Tasks).
* `resolved`    – outcome reached and communicated.
* `archived`    – closed; kept for history/compliance.

These are the only allowed values for `cases.status`.

### 2.5 Priority & severity

```text
TASK_PRIORITY = { "LOW", "MEDIUM", "HIGH", "CRITICAL" }
TASK_SEVERITY = { "MINOR", "MODERATE", "MAJOR", "CRITICAL" }
```

* **Priority** – how fast we want to act (SLA / scheduling).
* **Severity** – how bad it is if we don’t (impact / risk).

All Task and Case severity fields MUST use `TASK_SEVERITY` (DB: `task_severity_enum`). 

### 2.6 Visibility & privacy

Canonical DB enum: `visibility_enum`. 

```text
VISIBILITY = {
  "PUBLIC",       # visible across the org (subject to RBAC)
  "INTERNAL",     # limited to org‑internal teams/roles
  "RESTRICTED",   # minimal set of users/roles
  "ANONYMISED"    # pseudonymised or fully anonymised content
}
```

Examples:

* Public safety broadcast → `PUBLIC`.
* HR or clinical report → often `RESTRICTED` or `ANONYMISED` depending on profile and policies.

Visibility interacts with exports and analytics per Doc 6 (e.g. only `PUBLIC`/`INTERNAL` rows can be raw‑exported by default). 

### 2.7 Log categories & levels

```text
LOG_CATEGORY = {
  "WORKFLOW",
  "TASK",
  "SYSTEM",
  "SECURITY",
  "EMAIL"
}

LOG_LEVEL = {
  "DEBUG",
  "INFO",
  "WARNING",
  "ERROR",
  "CRITICAL"
}
```

Minimum fields per log entry:

```jsonc
{
  "timestamp": "2025-11-18T10:01:02Z",
  "level": "INFO",
  "category": "WORKFLOW",
  "message": "Task routed to maintenance queue",
  "identifier": "task_id:12345"
}
```

Logging and audit tables (`activity_logs`, `security_events`, `system_metric_snapshots`) store structured data aligned with these enums.

### 2.8 Notification channels & scope

```text
NOTIFICATION_CHANNEL = {
  "EMAIL",
  "SMS",
  "PUSH",
  "IN_APP",
  "WEBHOOK"
}
```

* `EMAIL` is mandatory; others are optional per deployment.
* DB `notifications.channel` stores lower‑case versions (`email`, `in_app`, `sms`, `webhook`).

Notification scope (metadata / workflow rules):

```text
NOTIFICATION_SCOPE = {
  "user",        # single user
  "team",        # owning team
  "department",  # functional group / department
  "org_wide"     # whole org
}
```

JSON/YAML store these as shown; UIs may map to friendlier labels.

### 2.9 Canonical label string format

Canonical label format (for `tasks.label`, `cases.label`):

```text
<label> = "<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE>"
```

* `BASE` – numeric vertical base (e.g. `1`, `11`, `100`, `1000`).
* `CATEGORY` – 1–9 classification (operational, strategic, compliance, etc.).
* `SUBCATEGORY` – 1–5 intent (request, update, decision, report, distribution).
* `HORIZONTAL_ROLE` – functional role (`Ops.Maintenance`, `HR.Recruitment`, `Finance.Audit`, etc.).

Broadcast bases:

* `10`, `100`, `1000` → informational broadcasts (non‑actionable unless workflow rules explicitly say otherwise).

Doc 8 carries the full label taxonomy and vertical/horizontal semantics; this document only locks the **string shape** and broadcast default behaviour. 

### 2.10 Canonical Task field set (JSON contract)

This is the **minimum canonical Task representation** used in APIs and logs. DB tables may have additional columns, but these fields must always be present and aligned with Doc 1.

```jsonc
{
  "task_id": "uuid-v4-string",                 // PK (DB: tasks.id)
  "organization_id": "uuid-v4-string",         // tenant isolation
  "case_id": "uuid-v4-string | null",          // optional Case link

  "created_at": "ISO-8601 (UTC)",
  "updated_at": "ISO-8601 (UTC)",

  "type": "string",                            // domain type: "maintenance" | "hr_case" | "education_support" | "it_support" | "operations" | "generic" ...
  "category": "string",                        // "request" | "incident" | "update" | "report" | "distribution"
  "subtype": "string | null",                  // domain subtype ("plumbing", "harassment", ...)

  "title": "string",                           // short human label
  "description": "string",                     // free-text body

  "label": "string",                           // canonical label "<base>.<category><subcategory>.<horizontal_role>"

  "status": "PENDING",                         // TASK_STATUS (enum)
  "priority": "MEDIUM",                        // TASK_PRIORITY
  "severity": "MODERATE",                      // TASK_SEVERITY

  "visibility": "INTERNAL",                    // VISIBILITY
  "source": "email",                           // "email" | "api" | "manual" | "sync"

  "created_by_user_id": "uuid-v4-string | null",
  "requester_person_id": "uuid-v4-string | null",

  "owner_role_id": "uuid-v4-string | null",
  "owner_user_id": "uuid-v4-string | null",
  "assignee_role": "string | null",            // denormalised role label, for routing/UX

  "due_at": "ISO-8601 or null",                // deadline
  "reactivity_time": "ISO-8601 duration or null",   // SLA window ("PT2H")
  "reactivity_deadline_at": "ISO-8601 or null",     // resolved from created_at + reactivity_time
  "escalation_level": 0,                       // 0 = none, 1+ escalation depth
  "closed_at": "ISO-8601 or null",

  "metadata": { }                              // domain-specific payload; no duplication of core fields
}
```

Notes:

* `task_id` is the canonical external name; older docs using `id` must be interpreted as `task_id`.
* `status`, `priority`, `severity`, `visibility`, `source` MUST be from the enums defined above/Doc 1.
* Domain‑specific values (asset IDs, harassment categories, class codes, etc.) go under `metadata` or domain link tables (`maintenance_task_links`, `education_task_links`, etc.).

### 2.11 Canonical Case field skeleton

For Cases, Doc 1 defines the physical schema (`cases`); this doc only fixes the minimum JSON shape.

```jsonc
{
  "case_id": "uuid-v4-string",                // PK (DB: cases.id)
  "organization_id": "uuid-v4-string",

  "source_type": "email",                     // "email" | "api" | "manual" | "sync"
  "source_reference": "string | null",

  "label": "string",                          // canonical label
  "title": "string",
  "description": "string",

  "status": "open",                           // CASE_STATUS
  "severity": "MAJOR",                        // TASK_SEVERITY

  "reactivity_time": "ISO-8601 duration or null",

  "origin_vertical_level": 1000,
  "origin_role": "Ops.Maintenance",

  "tags": [ "safety", "wet_floor" ],
  "location": { },                            // structured, free-form
  "metadata": { },                            // includes profile, pattern_sensitivity, review_frequency, etc.

  "created_at": "ISO-8601 (UTC)",
  "updated_at": "ISO-8601 (UTC)"
}
```

---

## 3. Configuration system (YAML‑based, environment‑aware)

Configuration is stored under `/config`, is **validated on startup**, and is composed from:

* Global defaults.
* Organization overrides.
* Environment selection (`dev` / `staging` / `prod` / `offline`).

### 3.1 Directory layout (illustrative)

```text
/config/
  database/
    database_connection.yaml
  email/
    email_config.yaml
  logging/
    logging_config.yaml
  workflows/
    global_workflow_rules.yaml
  insights/
    config.yaml
  profiles/
    organization_profiles.yaml
  organizations/
    default_organization_config.yaml
    <org-slug>.yaml
```

Modules (Core, Domain, Insights) may contribute their own subtrees, but all follow the same metadata & validation rules.

### 3.2 Common metadata & validation

Every YAML config file:

```yaml
metadata:
  version: "3.0"
  environment: "<dev|staging|prod|offline>"
  last_updated: "YYYY-MM-DD"
  owner: "team-or-responsible-role"
```

Validation (hard rules):

* `metadata.environment` ∈ `ENVIRONMENT`.
* `metadata.version` matches `^3\.[0-9]+$` for Orgo v3 configs.
* `metadata.last_updated` is a valid `YYYY-MM-DD` date.

On failure:

* Emit `LOG_CATEGORY = SYSTEM`, `LOG_LEVEL = ERROR`.
* Either refuse to start or fall back to safe defaults, depending on module.

### 3.3 Database config

`/config/database/database_connection.yaml` (Core Services spec covers the detailed keys).

Invariants:

* Only one of `postgres.enabled` / `sqlite.enabled` may be `true`.
* For Postgres, connection pool bounds `min_connections <= max_connections`.
* For SQLite, `file_path` must be writable in the environment.

### 3.4 Email config

`/config/email/email_config.yaml` defines SMTP/IMAP endpoints, timeouts, and attachment limits.

Hard checks:

* At least one of SMTP/IMAP configured.
* `limits.max_email_size_mb > 0`.
* Attachment lists are non‑empty and constrained to allowed types.

### 3.5 Logging config

`/config/logging/logging_config.yaml` binds log categories to sinks, levels, rotation and retention.

* All categories in config must map to `LOG_CATEGORY`.
* Levels must be from `LOG_LEVEL`.
* Retention and rotation policies must be consistent with org profiles and compliance requirements.

---

## 4. Core Services – contracts & checklists

Core Services are the headless backbone: email gateway, task handler, workflow engine, notifications, persistence, logging, validation/security. Full details in Doc 5; this section defines cross‑cutting expectations.

### 4.1 Workflow Engine

Responsibilities:

* Load and validate workflow rules (`/config/workflows/*.yaml`).
* Evaluate rules on events (email, task updates, timers).
* Emit a deterministic action list (CREATE_TASK, ROUTE, ESCALATE, NOTIFY, etc.).
* Log steps under `WORKFLOW` / `TASK`.

Checklist:

* [ ] Rules validated at startup (required keys, enum usage).
* [ ] Uses `Task.type` (domain) vs `Task.category` (request/incident/...) correctly.
* [ ] Never hardcodes domain‑specific branches; domain behaviour is via config/metadata.
* [ ] Emits structured logs with identifiers for traceability.

### 4.2 Email Gateway

Responsibilities:

* Poll mailboxes; ingest, parse, and normalise emails into `email_messages`. 
* Validate size, attachments, minimal fields.
* Link emails to Tasks/Cases via workflow + domain rules.
* Send outbound email as part of notifications.

Checklist:

* [ ] Connection validated on startup.
* [ ] Transient failures retried with backoff.
* [ ] Logs redacted (no raw bodies, minimal headers).
* [ ] Enforces configured limits and attachment policies.

### 4.3 Task Handler

Responsibilities:

* Implement the canonical Task lifecycle using `TASK_STATUS`.
* Enforce allowed state transitions and escalation rules.
* Expose create/update/assign/escalate APIs used by domain modules and interfaces. 

Checklist:

* [ ] `create_task` enforces required fields and enums.
* [ ] `update_task_status` validates transitions.
* [ ] `escalate_task` increments `escalation_level`, sets `ESCALATED`, and records events.
* [ ] Uses `organization_id` + visibility + RBAC for every Task read/write.

### 4.4 Notification Service

Responsibilities:

* Route events (CREATED, ASSIGNED, ESCALATED, COMPLETED) into channel‑specific notifications.
* Respect `NOTIFICATION_SCOPE` and Profiles (`notification_scope` in profile YAML). 

Checklist:

* [ ] Supports at least `EMAIL` + optional `IN_APP`.
* [ ] Chooses recipients based on owner/assignee roles + scope.
* [ ] Logs all attempts and failures with structured identifiers.
* [ ] Applies PII masking rules for certain channels (e.g. exports, webhooks).

### 4.5 Persistence & offline sync

Responsibilities:

* Abstract DB connections (Postgres for online, SQLite for offline).
* Provide safe CRUD helpers for Tasks, Cases, Emails, Logs, etc.
* Coordinate offline sync (`offline_nodes`, `sync_sessions`, `sync_conflicts`). 

Checklist:

* [ ] All queries parameterised.
* [ ] Multi‑tenant filters enforced (`organization_id`).
* [ ] Sync conflicts recorded and resolvable.
* [ ] Analytics readers treat operational tables as read‑only.

### 4.6 Logging & security hooks

Responsibilities:

* Provide unified `log_event` entry point.
* Integrate with security policies for sensitive operations (logins, exports, config changes).

Checklist:

* [ ] All security‑relevant operations go to `security_events`.
* [ ] Task/Case status changes are logged in `task_events` + `activity_logs`.
* [ ] Export requests log who, what, when, and result.

---

## 5. Domain Modules – position & invariants

Domain modules are thin adapters over the core backbone. Canonical spec in **Doc 3**; this section fixes cross‑module rules.

### 5.1 Directory & naming

* Root: `domain_modules/<domain>/`.

* Must contain:

  * `<domain>_module.yaml` – config (categories, subtypes, email patterns, routing hints).
  * `<domain>_handler.py` – code hooks for create/update and domain views.

* `<domain>` string must match `Task.type`.

### 5.2 Domain config rules

In `<domain>_module.yaml`:

* `allowed_categories` is a subset of the global enum `{request, incident, update, report, distribution}`.
* Domain subtypes live in `allowed_subtypes` and are stored under `Task.subtype` / `metadata["domain_subtype"]`.
* `email_patterns` define how inbound emails are recognised as belonging to the domain.
* Defaults for `visibility`, `category`, routing are allowed, but domain configs **must not** redefine global enums. 

### 5.3 Handler hooks (behaviour)

Handlers implement, at minimum:

* `on_task_create(ctx, payload)` – validate and enrich before Task persists.
* `on_task_created(ctx, task_id)` – fire notifications, side‑effects.
* `on_task_update(ctx, payload)` – validate before updates.
* `on_task_updated(ctx, task_id)` – follow‑up side‑effects.
* `get_domain_fields(ctx, task_id)` – domain‑specific view of metadata. 

Constraints:

* Must not write directly to DB; always go through the Task Handler.
* Must use canonical enums for status, priority, severity, visibility.
* Must not weaken visibility or bypass guardrails.

---

## 6. Organization profiles & behavioural tuning

Profiles describe **how intense/urgent/private** a deployment is. Physical storage is in a YAML file (`profiles:`) and in `organization_profiles`.

### 6.1 Profile schema (summary)

Per profile:

* `reactivity_seconds`, `max_escalation_seconds`.
* `transparency_level` (full/balanced/restricted/private).
* `escalation_granularity` (relaxed/moderate/detailed/aggressive).
* `review_frequency` (real_time/daily/weekly/monthly/quarterly/yearly/ad_hoc).
* `notification_scope` (individual/small_team/department/org_wide).
* `pattern_sensitivity`, `pattern_window_days`, `pattern_min_events`.
* `severity_threshold` + `severity_policy` (immediate escalation per severity).
* `logging_level` + `log_retention_days`.
* `automation_level` (manual/low/medium/high/full).
* `default_task_metadata` (visibility, default_priority, default_reactivity_seconds).
* `cyclic_overview` settings (enabled, schedules, threshold_triggers).

Profiles are **templates**; Orgo ties them to orgs via `organization_profiles.profile_code`.

### 6.2 Example profile mapping

Examples (keys from profiles YAML): `friend_group`, `hospital`, `advocacy_group`, `retail_chain`, `military_organization`, `environmental_group`, `artist_collective`. 

Core Services & Insights:

* Read profile to derive defaults for Task priority, severity, visibility, reactivity_time.
* Adjust escalation policies and notification scopes.
* Tune logging/audit retention and pattern windows.

---

## 7. Insights & cyclic overview integration

Insights and the cyclic overview transform the operational DB into **pattern sensing**. Normative definitions in Docs 6 & 8; this section only fixes integration points.

### 7.1 Analytics schema & ETL

* Star schema in `insights.*` (dimensions: dates, organizations, tasks, cases, persons, groups; facts: tasks, cases, wellbeing check‑ins).
* ETL jobs (Airflow DAGs) populate `fact_tasks`, `fact_cases`, `fact_wellbeing_checkins`, etc., under controlled retention windows and backup policies. 

### 7.2 Patterns as work

Cyclic overview logic:

* Weekly/monthly/yearly jobs detect patterns (incident frequency, cross‑department trends, high‑risk indicators).
* Crossing a threshold **must** create new Cases (often labelled as audits or systemic reviews), not just charts.

This doc locks:

* That patterns become **Cases and Tasks**, not “just dashboards”.
* That pattern detection respects profiles (pattern_sensitivity, pattern_window_days) and visibility.

---

## 8. Guardrails – visibility, audit, compliance

Guardrails apply across the stack:

* Visibility enums (`VISIBILITY`) control who can see raw content and exports.
* Logging/audit tables are canonical (`activity_logs`, `security_events`, `system_metric_snapshots`).
* Security events track sensitive operations (failed logins, permission escalation, exports, config changes).
* Exports in Insights enforce rows‑per‑export limits, PII masking, and allowed visibilities. 

Invariants:

* Sensitive domains (HR cases, clinical incidents) must use `RESTRICTED` or `ANONYMISED` visibility and/or specialised domain tables (`hr_cases`, `wellbeing_checkins`, etc.).
* All Task/Case status changes and escalations must be logged and traceable back to actors (user/role/profile) and origin (UI/API/email/system).

---

## 9. Testing & operational checklists (cross‑cutting)

Minimum testing structure:

```text
/tests/
  core_services/
  domain_modules/
  interfaces/
  integration/
```

Expectations:

* Core Services: ~80%+ coverage for critical functions.
* Config loaders: ~90%+ coverage (success and failure paths).
* Integration tests for end‑to‑end flows (email → Task → escalation → notification).
* Smoke tests per environment for configuration validity.

Operational checklists:

* Each service must start with valid config or fail fast.
* Each domain module must pass Doc 3 compliance checklist.
* Each environment must have working logging, notifications and health checks.

---

## 10. Summary – what this document locks

This document **locks** the following for Orgo v3:

* **Multi‑tenant invariants** around `organization_id`, Users vs Persons, and Roles.

* **Core enums**:

  * `ENVIRONMENT`
  * `TASK_STATUS`
  * `CASE_STATUS`
  * `TASK_PRIORITY`
  * `TASK_SEVERITY`
  * `VISIBILITY`
  * `LOG_CATEGORY`
  * `LOG_LEVEL`
  * `NOTIFICATION_CHANNEL`
  * `NOTIFICATION_SCOPE`

* **Canonical label format**: `<base>.<category><subcategory>.<horizontal_role>` and broadcast bases (`10/100/1000` informational by default).

* **Canonical Task field set** and minimal **Case field skeleton**.

* **Config expectations** (metadata, validation, per‑environment decomposition).

* **Core Services contracts & checklists** (workflow, email, task handler, notifications, persistence, logging).

* **Domain module invariants** (thin adapters, no custom lifecycles).

* **Profile + Insights integration**: behaviour tuning plus pattern‑detection feeding back as work.

* **Guardrails** for visibility, logging, audit, and exports.

All other docs in Orgo v3 (Docs 1, 3, 4, 5, 6, 8, etc.) must **reference and remain aligned to these definitions**, not redefine them.
