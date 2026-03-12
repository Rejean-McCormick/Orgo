Updated Doc 5 with the requested changes is below.

````markdown
﻿<!-- INDEX: Doc 5 – Core Services Specification -->
Index

Scope & status
0.1 Alignment with other docs

Core Services – high‑level overview
1.1 Email Gateway Service (email_gateway)
1.2 Task Handler Service (task_handler)
1.3 Workflow Engine Service (workflow_engine)
1.4 Notification Service (notifier_service)
1.5 Persistence Service (persistence)
1.6 Logging & Audit Service (logger_service)
1.7 Validation & Security Support (validation_core)

Shared conventions (locked for v3)
2.1 Naming & case conventions
2.2 Environments (ENVIRONMENT)
2.3 Common data types
2.4 Standard result shape (ok / data / error)
2.5 Config boundaries (Core vs Domain vs Insights)

Canonical data models (logical views)
3.1 TASK (logical view over tasks)
– Status, priority, severity, visibility enums
3.2 EMAIL_MESSAGE (logical envelope over email tables)
3.3 LOG_EVENT (logical log entry schema)

Email Gateway Service (email_gateway)
4.1 Responsibilities
4.2 Configuration (email_config.yaml)
4.3 Public functions (fetch, parse, validate, send)
4.4 Validation rules & error codes

Task Handler Service (task_handler)
5.1 Responsibilities
5.2 Core state machine (allowed transitions)
5.3 SLA derivation & escalation checks
5.4 Public functions (create, update status, escalate, assign, add comment)
5.5 Required task attributes & validation

Workflow Engine Service (workflow_engine)
6.1 Responsibilities
6.2 Rule structure & matching semantics
6.3 Supported action types
6.4 API surface (execute, validate rules)

Notification Service (notifier_service)
7.1 Responsibilities
7.2 Configuration (notification_config.yaml)
7.3 Public functions (send_task_notification)

Persistence Service (persistence)
8.1 Responsibilities
8.2 Configuration (database_connection.yaml) & invariants
8.3 Core functions (connect, fetch, insert, update)

Logging & Audit Service (logger_service)
9.1 Responsibilities
9.2 Logging configuration (logging_config.yaml)
9.3 Public functions (log_event, rotate_logs)
9.4 Example log entry

Validation & Security Support (validation_core)
10.1 Responsibilities
10.2 Config validation
10.3 Input validation examples

Cross‑service flow example (email → task → escalation)

Non‑functional requirements (performance, reliability, testing)

Extensibility guidelines (new domains, notification channels, analytics jobs)


# **Document 5/8: Core Services Specification**

> (“Core Services” = everything headless and backend that powers workflows, tasks, emails, logs, and core config.)

---

## 0. Scope & Status

* **Document ID**: `orgo-v3-core-services`
* **Role in set**: **5/8** (Core Services)
* **Version**: `3.0.1`
* **Applies to**: All Orgo v3 deployments (small teams → large orgs)
* **Non-goals**:

  * UI layouts (dashboards, web clients) – covered in **Interfaces / Frontend docs**.
  * Low-level infra (containers, K8s, etc.) – covered in **Infrastructure / Ops docs**.
  * Domain-specific behavior beyond configuration (Maintenance, HR, etc.) – handled via **domain modules + workflow rules**.

Core Services are **headless**. They expose APIs and internal services consumed by Interfaces, Domain Modules, Insights, and Infrastructure.

### 0.1 Alignment With Other Docs

This document **does not define** its own enums or physical table shapes. It assumes:

* **Physical schemas**:

  * `tasks`, `cases`, `email_messages`, `activity_logs`, `security_events`, `offline_nodes`, `sync_sessions`, etc. – from **Doc 1 – Database Schema Reference (Custom Tables)**.
* **Canonical enums & Task/Case field sets**:

  * `TASK_STATUS`, `TASK_PRIORITY`, `TASK_SEVERITY`, `VISIBILITY`, `ENVIRONMENT`, canonical Task/Case JSON shapes – from **Doc 2 – Foundations, Locked Variables & Operational Checklists** and **Doc 8 – Cyclic Overview, Labels & Universal Flow Rules**.
* **Domain module contracts**:

  * Directory layout, `<domain>_module.yaml`, `<domain>_handler.py`, and DomainTask mapping – from **Doc 3 – Domain Modules (Orgo v3)**.
* **Functional code names** (NestJS/NextJS implementation):

  * Service / controller / job names – from **Doc 4 – Functional Code‑Name Inventory**.
* **Insights & analytics behaviour**:

  * Star‑schema, analytics retention, ETL DAGs, export limits – from **Doc 6 – Insights Module Config Parameters** and profiles in **Doc 7 – Profiles YAML**.

Whenever this doc mentions **TASK**, **CASE**, or **EMAIL_MESSAGE**, it is referring to those canonical models.

If anything in this file contradicts **Docs 1/2/8**, those docs **win** and this document must be updated.

---

## 1. Core Services – High-Level Overview

Core Services are the “backend spine” of Orgo v3:

1. **Email Gateway Service (`email_gateway`)**

   * Receives and sends emails; parses and validates email payloads.

2. **Task Handler Service (`task_handler`)**

   * Creates, updates, escalates, and tracks tasks (unified, metadata‑driven).

3. **Workflow Engine Service (`workflow_engine`)**

   * Evaluates routing & escalation rules; orchestrates workflow steps.

4. **Notification Service (`notifier_service`)**

   * Delivers email / in‑app notifications based on events and rules.

5. **Persistence Service (`persistence`)**

   * Provides Postgres + SQLite connectors, CRUD helpers, and offline sync hooks.

6. **Logging & Audit Service (`logger_service`)**

   * Unified logging, audit trails, and retention enforcement.

7. **Validation & Security Support (`validation_core`)**

   * Cross‑cutting config & payload validation utilities plus basic auth/authorization hooks
     (full security spec lives in the Security / RBAC docs, but Core Services must integrate cleanly).

All domain‑specific logic (HR, maintenance, education, etc.) must be expressed through:

* **Workflow rules** (`/config/workflows/*.yaml`)
* **Domain module configs & handlers** (`domain_modules/<domain>/<domain>_module.yaml`, `<domain>_handler.py`)
* **Templates** (`/templates/email/*.html`, domain templates)

Core Services **must not** hardcode domain‑specific branches.

---

## 2. Shared Conventions (Locked for v3)

### 2.1 Naming & Case

* **Environment variables**: `ORGO_*` (all caps, snake_case).

* **Config keys (YAML/JSON)**: snake_case (`reactivity_time`, `notification_scope`).

* **Database columns**: snake_case (`organization_id`, `created_at`).

* **Enum values in DB**: canonical tokens from Doc 2 (`PENDING`, `HIGH`, `CRITICAL`, `PUBLIC`, `ANONYMISED`, etc.).

* **JSON/UX representation**:

  * Lower‑case strings are permitted in API/JSON (e.g. `"pending"`, `"high"`, `"anonymised"`).
  * They must map 1:1 to DB enums (e.g. `"pending"` ↔ `PENDING`).

* **Service identifiers** (internal registry, logs): lower_snake (`task_handler`, `email_gateway`).

These conventions are **locked** for v3; the rest of the docs assume them.

### 2.2 Environments

Canonical environment values (Doc 2):

```text
ENVIRONMENT = { "dev", "staging", "prod", "offline" }
````

* All configuration examples in this doc use these values.
* Human‑readable prose may say “development” or “production”, but config values are always one of the four above.

### 2.3 Common Data Types

* `UUID`: canonical ID type for entities.
* `TIMESTAMP_UTC`: ISO8601 in UTC (e.g., `2025-11-18T10:30:00Z`).
* `JSONB`: arbitrary JSON (for Postgres); serialized JSON (for SQLite).
* `LABEL_CODE`: string like `100.34.Finance.Audit` (see labels in Doc 8).

### 2.4 Standard Result Shape (Internal / API)

All Core Service functions that can fail synchronously **should** return:

```json
{
  "ok": true,
  "data": { /* result payload */ },
  "error": null
}
```

or

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Missing required field 'subject'",
    "details": { "field": "subject" }
  }
}
```

The shape (`ok`, `data`, `error`) is **locked** for v3.

### 2.5 Config Boundaries (Global vs Module vs Insights)

* **Core Services config** in this doc:

  * Email gateway, DB connections, core logging, workflow engine, queues, Core notification config.

* **Domain modules config** (Doc 3):

  * Maintenance/HR/education module configs (`domain_modules/.../*_module.yaml`) and their handler logic.

* **Insights/analytics config** (Doc 6):

  * Analytics retention, reporting windows, pattern windows, export limits, DAG schedules.

Where overlapping concepts exist (e.g. *retention*):

* **Operational log & task retention / rotation** → this doc (Core Services).
* **Analytics retention / reporting windows** → Insights doc (Doc 6).
* **Profile‑driven behaviour** (reactivity, transparency, cyclic overview) → Profiles / Doc 7 with parameters consumed by both Core Services and Insights.

When in doubt: domain‑specific or reporting‑specific parameters live outside this doc; this doc governs **cross‑domain, headless services**.

---

## 3. Canonical Data Models (Logical Views)

These are **logical views** of the canonical DB schemas from Doc 1, using the enums and JSON contracts from Docs 2 and 8.

### 3.1 TASK (Logical View)

**Physical table**: `tasks` (Doc 1; PK column is `id`).

**Logical view (fields Core Services care about):**

```text
task_id               UUID                PK (logical; maps to tasks.id)
organization_id       UUID                NOT NULL
case_id               UUID                NULL        -- links to cases.id

created_at            TIMESTAMP_UTC       NOT NULL
updated_at            TIMESTAMP_UTC       NOT NULL

type                  TEXT                NOT NULL    -- domain type: "maintenance", "hr_case", "it_support", etc.
category              TEXT                NOT NULL    -- "request" | "incident" | "update" | "report" | "distribution"
subtype               TEXT                NULL        -- e.g. "plumbing", "harassment", "attendance"

label                 TEXT                NOT NULL    -- "<base>.<category><subcategory>.<horizontal_role>"
title                 TEXT                NOT NULL
description           TEXT                NOT NULL

status                task_status_enum    NOT NULL    -- PENDING|IN_PROGRESS|ON_HOLD|COMPLETED|FAILED|ESCALATED|CANCELLED
priority              task_priority_enum  NOT NULL    -- LOW|MEDIUM|HIGH|CRITICAL
severity              task_severity_enum  NOT NULL    -- MINOR|MODERATE|MAJOR|CRITICAL

visibility            visibility_enum     NOT NULL    -- PUBLIC|INTERNAL|RESTRICTED|ANONYMISED
source                task_source_enum    NOT NULL    -- email|api|manual|sync (stored lower-case in DB)

created_by_user_id    UUID                NULL        -- FK → user_accounts.id
requester_person_id   UUID                NULL        -- FK → person_profiles.id

owner_role_id         UUID                NULL        -- FK → roles.id (primary owning role)
owner_user_id         UUID                NULL        -- FK → user_accounts.id (primary owner)
assignee_role         TEXT                NULL        -- e.g. "Ops.Maintenance" (denormalized routing label; current primary routing label)

due_at                TIMESTAMP_UTC       NULL
reactivity_time       INTERVAL            NULL        -- derived from profiles/workflows
reactivity_deadline_at TIMESTAMP_UTC      NULL        -- usually created_at + reactivity_time
escalation_level      INTEGER             NOT NULL DEFAULT 0   -- 0 = none, 1+ depth in escalation path
closed_at             TIMESTAMP_UTC       NULL

metadata              JSONB               NOT NULL    -- domain-specific; must not duplicate core fields
```

* JSON representation for Tasks at the API boundary is given in **Doc 8 §8.4.2** (Task JSON Schema); this doc only fixes the **service‑side expectations**.
* `source` in this doc always refers to `task_source_enum` (`email` | `api` | `manual` | `sync`), not to workflow event sources (`EMAIL` | `API` | `SYSTEM`), which are separate.
* Assignment history (including concrete assignee users) lives in `task_assignments`; the `Task` row only carries the current `owner_role_id` / `owner_user_id` and a denormalised `assignee_role` convenience field.

#### 3.1.1 Task Status (Locked Enum)

`task_status_enum` (Doc 1/2):

```text
PENDING
IN_PROGRESS
ON_HOLD
COMPLETED
FAILED
ESCALATED
CANCELLED
```

* JSON representation MAY use lower‑case (e.g. `"pending"`), but must map to these values.

#### 3.1.2 Priority & Severity (Locked Enums)

`task_priority_enum`:

```text
LOW
MEDIUM
HIGH
CRITICAL
```

`task_severity_enum`:

```text
MINOR
MODERATE
MAJOR
CRITICAL
```

In examples we sometimes show `priority` / `severity` as `TEXT`; read that as **“backed by these enums”**, not arbitrary strings.

#### 3.1.3 Visibility (Locked Enum)

`visibility_enum`:

```text
PUBLIC
INTERNAL
RESTRICTED
ANONYMISED
```

* **RESTRICTED** replaces earlier “PRIVATE” terminology (“minimal set of users/roles who need access”).
* API/JSON MAY expose lower‑case (`"restricted"`, `"anonymised"`), but these map directly to the DB enum.

#### 3.1.4 Legacy `scope` Classification (Non‑Normative)

Earlier v2/v3 drafts used a conceptual classification:

```text
"UNIVERSAL" | "CROSS_INDUSTRY" | "SPECIFIC"
```

For v3:

* This classification is **optional metadata only**, not part of the canonical `tasks` schema.
* If needed, store under `metadata.scope` as a string.
* Core Services do **not** rely on it, and profiles do not use it; it is purely descriptive/analytical.

---

### 3.2 EMAIL_MESSAGE (Logical Envelope)

**Physical tables** (Doc 1, Module 3):

* `email_messages` (core metadata and bodies)
* `email_attachments` (attachments)
* `email_processing_events` (parsing/classification/linkage events)

Core Services operate on a logical `EMAIL_MESSAGE` envelope that wraps the main row in `email_messages` plus selected derived fields:

```text
email_message_id        UUID           PK (logical; maps to email_messages.id)
organization_id         UUID           NOT NULL
email_account_config_id UUID           NULL        -- FK → email_account_configs.id
thread_id               UUID           NULL        -- FK → email_threads.id

message_id_header       TEXT           NULL        -- RFC822 Message-ID

direction               email_direction_enum NOT NULL  -- 'inbound' | 'outbound' (lower-case in DB)

from_address            TEXT           NOT NULL
to_addresses            TEXT[]         NOT NULL
cc_addresses            TEXT[]         NULL
bcc_addresses           TEXT[]         NULL

subject                 TEXT           NOT NULL
received_at             TIMESTAMP_UTC  NULL        -- for inbound
sent_at                 TIMESTAMP_UTC  NULL        -- for outbound

raw_headers             TEXT           NULL
text_body               TEXT           NULL        -- normalized plain text
html_body               TEXT           NULL        -- may be truncated; full content may live in blob storage

related_task_id         UUID           NULL        -- FK → tasks.id
sensitivity             TEXT           NOT NULL    -- 'normal' | 'sensitive' | 'highly_sensitive'

parsed_metadata         JSONB          NOT NULL    -- classifier results, label candidates, extraction, etc.
attachments_meta        JSONB          NOT NULL    -- array of attachment metadata objects, aggregated from email_attachments
security_flags          JSONB          NOT NULL    -- e.g. { "pgp_encrypted": true, "spam_score": 0.1 }
```

* In the physical DB, `direction` is a PostgreSQL ENUM with values `'inbound'` / `'outbound'` (lower‑case) as per Doc 1; services may expose upper‑case constants, but persisted values must match the schema.
* Any additional ingestion metadata (e.g. raw archive IDs) may live in `email_ingestion_batches` / `imported_message_mappings`; services may surface it via `parsed_metadata` if needed.

Core Services (`email_gateway`, `workflow_engine`, `task_handler`) must use this logical envelope and **must not** invent a divergent email schema.

---

### 3.3 LOG_EVENT (Logical)

Log entries may be stored in files or in tables such as `activity_logs` and `security_events`, but the logical schema emitted by `logger_service` is:

```json
{
  "timestamp": "2025-11-18T10:30:00Z",
  "level": "INFO",
  "category": "WORKFLOW",
  "message": "Task created",
  "identifier": "task_id:7b45-...",
  "metadata": {
    "workflow_name": "maintenance_default",
    "actor": "system"
  }
}
```

* `level` must be one of `LOG_LEVEL = { "DEBUG","INFO","WARNING","ERROR","CRITICAL" }` (Doc 2).
* `category` must be one of `LOG_CATEGORY = { "WORKFLOW","TASK","SYSTEM","SECURITY","EMAIL" }` (Doc 2).

---

## 4. Email Gateway Service (`email_gateway`)

### 4.1 Responsibilities

* Fetch incoming messages via IMAP/POP or offline files/archives.
* Validate and parse messages into `EMAIL_MESSAGE` envelopes.
* Sanitize content & enforce plain‑text‑first processing.
* Send outgoing notifications via SMTP.
* Handle errors with retries and exponential backoff.
* Append ingestion/processing events (`email_ingestion_batches`, `email_processing_events`).

### 4.2 Configuration (Locked Keys & Metadata)

**YAML file**: `/config/email/email_config.yaml`

```yaml
metadata:
  config_name: "email_config"
  version: "3.0"                 # must match ^3\.[0-9]+$ (Doc 2)
  environment: "dev"             # dev | staging | prod | offline
  last_updated: "2025-11-18"     # YYYY-MM-DD
  owner: "core-services-team"
  organization_id: "default"

smtp:
  host: "smtp.example.org"
  port: 587
  use_tls: true
  use_ssl: false
  username_env: "ORGO_SMTP_USERNAME"
  password_env: "ORGO_SMTP_PASSWORD"
  connection_timeout_secs: 10
  send_timeout_secs: 30
  max_retries: 3
  retry_backoff_secs: 2

imap:
  host: "imap.example.org"
  port: 993
  use_ssl: true
  username_env: "ORGO_IMAP_USERNAME"
  password_env: "ORGO_IMAP_PASSWORD"
  connection_timeout_secs: 10
  read_timeout_secs: 60
  folder: "INBOX"

limits:
  max_email_size_mb: 10
  allowed_attachment_mimetypes:
    - "application/pdf"
    - "image/png"
    - "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
```

Notes / invariants (aligning with Doc 2 §3.4):

* `metadata.environment` ∈ `{dev,staging,prod,offline}`.
* `metadata.version` matches `^3\.[0-9]+$`.
* `metadata.last_updated` is `YYYY-MM-DD`.
* Credentials are **never** stored as raw strings here; only via `*_env`.
* `limits.max_email_size_mb > 0` and `allowed_attachment_mimetypes` is non‑empty.

### 4.3 Public Functions (Conceptual Signatures)

```python
def fetch_incoming_emails(max_count: int) -> dict:
    """
    Fetches up to `max_count` raw email messages from IMAP/POP.
    Returns standard result shape with a list of raw messages in data.
    """

def parse_email(raw_email: dict) -> dict:
    """
    Parses a raw email into a structured EMAIL_MESSAGE-like payload
    matching the canonical email_messages + attachments model.
    Required keys in result: subject, from_address, to_addresses, text_body.
    """

def validate_email(parsed_email: dict) -> dict:
    """
    Validates the email payload; fails if required fields are missing
    or the message exceeds configured size / attachment limits.
    Respects limits.max_email_size_mb and allowed_attachment_mimetypes.
    """

def send_email(to: list[str], subject: str, body: str,
               cc: list[str] | None = None,
               bcc: list[str] | None = None) -> dict:
    """
    Sends an email via SMTP using the configured account.
    """
```

### 4.4 Validation Rules (Email)

* Required fields: `subject`, `from_address`, `to_addresses`, **and** either `text_body` or `html_body` convertible to text.
* Max total size: **10MB** (configurable via `limits.max_email_size_mb`).
* Allowed attachment types: `limits.allowed_attachment_mimetypes`.
* Sanitization:

  * Strip dangerous HTML/JS.
  * Normalize to plain text in `text_body` for downstream processing.

Common error codes:

* `EMAIL_VALIDATION_ERROR`
* `EMAIL_PARSING_ERROR`
* `EMAIL_SEND_FAILED`

---

## 5. Task Handler Service (`task_handler`)

### 5.1 Responsibilities

* Create tasks from email/API/workflow events.
* Manage the **canonical Task state machine** (Doc 8 §8.5.2).
* Trigger escalations and notifications.
* Provide a consistent API for all modules & interfaces.
* Enforce multi‑tenant isolation and visibility rules on every operation.

### 5.2 Core State Machine (Locked)

Allowed transitions (must match Doc 8 §8.5.2 exactly):

* `PENDING` → `IN_PROGRESS`, `CANCELLED`
* `IN_PROGRESS` → `ON_HOLD`, `COMPLETED`, `FAILED`, `ESCALATED`
* `ON_HOLD` → `IN_PROGRESS`, `CANCELLED`
* `ESCALATED` → `IN_PROGRESS`, `COMPLETED`, `FAILED`
* `COMPLETED`, `FAILED`, `CANCELLED` → (terminal)

Any invalid transition must return (standard result shape):

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "INVALID_TASK_STATE_TRANSITION",
    "message": "Transition IN_PROGRESS → PENDING is not allowed"
  }
}
```

### 5.2.1 SLA derivation and escalation checks

Core Services derive `reactivity_time` and `reactivity_deadline_at` when creating a Task by combining:

* the organization’s active profile (reactivity_seconds, severity_policy),
* workflow rules, and
* any domain-specific hints.

The canonical rule is:

```text
reactivity_deadline_at = created_at + reactivity_time
```

Escalation jobs MUST compare the current time against the stored `reactivity_deadline_at` for unresolved Tasks, rather than recomputing SLA deadlines on the fly from profile values. This keeps operational behaviour aligned with analytics and cyclic overview semantics in Doc 8.

### 5.3 Public Functions (Logical)

```python
def create_task(payload: dict) -> dict:
    """
    Creates a new task.

    Required (core) fields in payload (canonical Task JSON):
      - organization_id (UUID)
      - type (str)         # domain-type, e.g. "maintenance"
      - category (str)     # "request" | "incident" | "update" | "report" | "distribution"
      - title (str)
      - description (str)
      - priority (str)     # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" (or lower-case JSON forms)
      - severity (str)     # "MINOR" | "MODERATE" | "MAJOR" | "CRITICAL"
      - visibility (str)   # PUBLIC|INTERNAL|RESTRICTED|ANONYMISED (or lower-case)
      - label (str)        # canonical label "<base>.<category><subcategory>.<horizontal_role>"
      - source (str)       # "email" | "api" | "manual" | "sync"
      - metadata (dict)

    Optional:
      - case_id, subtype, due_at,
        created_by_user_id, requester_person_id,
        owner_role_id, owner_user_id,
        assignee_role

    Derived:
      - status = PENDING
      - escalation_level = 0
      - reactivity_time, reactivity_deadline_at based on org profile + workflows.
    """

def update_task_status(task_id: str, new_status: str,
                       *, reason: str | None = None,
                       actor_user_id: str | None = None) -> dict:
    """
    Updates the status of a task, enforcing the state machine rules
    and appending a TaskEvent row.
    """

def escalate_task(task_id: str, *,
                  reason: str,
                  actor_user_id: str | None = None) -> dict:
    """
    Escalates the task along its defined escalation path.

    Effects:
      - increments escalation_level (>= 1),
      - sets status = ESCALATED,
      - records escalation events (task_events, escalation_* tables),
      - may trigger notifications (via notifier_service).
    """

def assign_task(task_id: str,
                assignee_role: str | None = None,
                *,
                actor_user_id: str | None = None,
                assignee_user_id: str | None = None) -> dict:
    """
    Assigns or reassigns a task to a role and/or user.

    If provided, assignee_user_id is recorded only in TaskAssignment history;
    the Task logical view and canonical Task JSON remain free of assignee_user_id
    and carry only owner_* and assignee_role.

    Effects:
      - updates tasks.assignee_role (denormalised routing label),
      - appends a TaskAssignment row (records any user-level assignment),
      - records a TaskEvent (ownership_changed).
    """

def add_task_comment(task_id: str,
                  comment: str,
                  author_user_id: str,
                  visibility: str = "internal_only") -> dict:
    """
    Appends a comment to task_comments for auditability and collaboration.

    `visibility` must be one of the COMMENT_VISIBILITY enum values
    (`internal_only`, `requester_visible`, `org_wide`) defined in Doc 2.
    """
```

### 5.4 Required Task Attributes (Validation)

Minimal required keys for `create_task` (beyond `organization_id`):

* `type`
* `category`
* `title`
* `description`
* `priority`
* `severity`
* `visibility`
* `label`
* `source`
* `metadata`

On validation failure:

* Return `ok=false` and `error.code = "TASK_VALIDATION_ERROR"`.

---

## 6. Workflow Engine Service (`workflow_engine`)

### 6.1 Responsibilities

* Load and merge global + organization + domain‑specific workflow rules.
* Validate rule structure and enum usage.
* Evaluate rules on context (email, task events, timers).
* Produce a deterministic list of actions (`CREATE_TASK`, `ROUTE`, `ESCALATE`, `NOTIFY`, etc.).
* Log workflow execution steps under `LOG_CATEGORY = WORKFLOW`.

Broadcast labels (bases `10`, `100`, `1000`) are informational by default.

### 6.2 Rule Structure (Locked Keys)

Each rule (conceptual YAML):

```yaml
id: "maintenance_default_v3"
version: "3.0.0"
match:
  source: "EMAIL"             # EMAIL | API | SYSTEM | TIMER (workflow event source, not task_source_enum)
  type: "maintenance"         # domain-level type (NOT the category enum)
  category: "request"         # optional; one of canonical task categories
  severity: "CRITICAL"        # optional; canonical severity enum
  keywords_any:
    - "hvac"
    - "heat"
    - "cooling"
actions:
  - type: "CREATE_TASK"
    set:
      priority: "CRITICAL"
      reactivity_time: "1 hour"
  - type: "ROUTE"
    to_role: "Ops.Maintenance"
  - type: "NOTIFY"
    channel: "EMAIL"
    template_id: "task_assignment"
```

Important points:

* Where earlier drafts used `category: "maintenance"` under `match`, that is **fixed** to `type: "maintenance"`.
* `category` is reserved for `"request" | "incident" | "update" | "report" | "distribution"` (global Task categories).
* Rule evaluation must respect canonical enums from Doc 2 / Doc 8; invalid enum values must cause rule validation errors.

### 6.3 Supported ACTION Types

Core action types the engine must support:

* `CREATE_TASK`
* `UPDATE_TASK`
* `ROUTE`
* `ESCALATE`
* `ATTACH_TEMPLATE`
* `SET_METADATA`
* `NOTIFY`

Implementations may add more **internal** action types, but configuration and logs should stick to this set unless extended and documented.

### 6.4 API Surface (Logical)

```python
def execute_workflow(context: dict) -> dict:
    """
    Given a context (email / task event / system timer, including organization_id),
    evaluates all matching rules in deterministic order and returns an ordered list
    of actions to apply (without side-effects).

    The caller (e.g. task_handler, email_gateway) is responsible for applying actions
    transactionally and logging outcomes.
    """

def validate_workflow_rules() -> dict:
    """
    Validates workflow rule files (YAML/JSON) for:
      - required top-level keys (id, version, match, actions),
      - canonical enums (status, category, priority, severity, visibility),
      - internal consistency (no unknown action types, required fields per action).
    Returns the standard result shape.
    """
```

---

## 7. Notification Service (`notifier_service`)

### 7.1 Responsibilities

* Implement the **Task‑driven notifications** portion of Core Services.

* Send email + in‑app notifications for:

  * Task creation
  * Assignment / reassignment
  * Escalation
  * Completion

* Respect:

  * `NOTIFICATION_CHANNEL` + `NOTIFICATION_SCOPE` from Doc 2, and
  * `visibility` and org profiles (`notification_scope`, transparency) from Doc 7.

### 7.2 Configuration (Locked Keys)

Core notification config lives in Core Services; analytics/reporting notifications (e.g. “report ready”) live in **Insights** (Doc 6).

**YAML file**: `/config/notifications/notification_config.yaml`

```yaml
metadata:
  config_name: "notification_config"
  version: "3.0"
  environment: "prod"
  last_updated: "2025-11-18"
  owner: "core-services-team"
  organization_id: "default"

notifications:
  default_channel: "EMAIL"     # EMAIL is mandatory; others optional
  channels:
    email:
      enabled: true
      sender_name: "Orgo System"
      sender_address: "no-reply@example.org"
    in_app:
      enabled: true
    # sms / webhook channels can be added as needed; mobile push is modelled via IN_APP plus client delivery

  templates:
    task_created: "task_created.html"
    task_assignment: "task_assignment.html"
    task_escalation: "task_escalation.html"
    task_completed: "task_completed.html"
```

### 7.3 Public Functions

```python
def send_task_notification(task: dict, event_type: str) -> dict:
    """
    Sends notifications for a task lifecycle event.

    event_type: "CREATED" | "ASSIGNED" | "ESCALATED" | "COMPLETED"

    Channel selection & recipient set are determined by:
      - notification_config (default_channel, enabled channels),
      - task.visibility,
      - org profile notification_scope,
      - task ownership/assignment (owner_role_id, owner_user_id, assignee_*).

    Returns the standard result shape with delivery metadata.
    """
```

---

## 8. Persistence Service (`persistence`)

### 8.1 Responsibilities

* Manage connections to **Postgres** (online OLTP) and **SQLite** (offline nodes).
* Provide safe CRUD helpers with parameterized queries.
* Enforce multi‑tenant filters (`organization_id`).
* Support conflict resolution & coordination with offline sync tables (`offline_nodes`, `sync_sessions`, `sync_conflicts`) defined in Doc 1.

### 8.2 Configuration (Locked Keys & Invariants)

**YAML file**: `/config/database/database_connection.yaml`

```yaml
metadata:
  config_name: "database_connection"
  version: "3.0"
  environment: "staging"
  last_updated: "2025-11-18"
  owner: "core-services-team"
  organization_id: "default"

postgres:
  enabled: true
  url_env: "DATABASE_URL"          # full URI (for ORM / drivers)
  host: "postgres"
  port: 5432
  database: "orgo"
  schema: "public"
  user_env: "ORGO_DB_USER"
  password_env: "ORGO_DB_PASSWORD"
  pool:
    min_connections: 1
    max_connections: 20
    idle_timeout_seconds: 300

sqlite:
  enabled: false                    # invariant: NOT (postgres.enabled and sqlite.enabled)
  file_path: "./data/orgo_offline.db"
  timeout_seconds: 5
```

Invariants (aligning with Doc 2 §3.3):

* Exactly one of `postgres.enabled` / `sqlite.enabled` may be `true` in a given process.
* For Postgres, `pool.min_connections <= pool.max_connections`.
* For SQLite, `file_path` must be writable in the environment.

### 8.3 Core Functions (Logical)

```python
def connect_to_database(*, mode: str = "ONLINE") -> object:
    """
    mode:
      - "ONLINE": use Postgres (requires postgres.enabled = true),
      - "OFFLINE": use SQLite (requires sqlite.enabled = true).

    Returns a connection / pool object or raises on failure.
    """

def fetch_records(table: str,
                  where: dict | None = None,
                  *,
                  mode: str = "ONLINE") -> dict:
    """
    Executes a parameterized SELECT based on `where` conditions.

    Returns:
      - ok: true/false
      - data: list of rows (as dicts)
    """

def insert_record(table: str,
                  data: dict,
                  *,
                  mode: str = "ONLINE") -> dict:
    """
    Executes an INSERT with validation; returns the inserted primary key
    (e.g. task_id) in data on success.
    """

def update_record(table: str,
                  key: dict,
                  updates: dict,
                  *,
                  mode: str = "ONLINE") -> dict:
    """
    Executes a parameterized UPDATE based on a primary key / unique key filter.
    """
```

All queries must be **parameterized** to prevent SQL injection.

---

## 9. Logging & Audit Service (`logger_service`)

### 9.1 Responsibilities

* Provide a single `log_event` entry point for structured logs.
* Support categories: `WORKFLOW`, `TASK`, `SYSTEM`, `SECURITY`, `EMAIL`.
* Enforce retention policies and rotation at the file/sink layer.
* Feed security‑relevant events to dedicated tables (`security_events`, `activity_logs`) as appropriate.

### 9.2 Configuration

Core logging config:

```yaml
metadata:
  config_name: "logging_config"
  version: "3.0"
  environment: "prod"
  last_updated: "2025-11-18"
  owner: "core-services-team"
  organization_id: "default"

logging:
  level: "INFO"                # DEBUG | INFO | WARNING | ERROR | CRITICAL
  format: "json"               # json | text
  log_dir: "./logs"

categories:
  WORKFLOW:
    file: "workflow_activity.log"
    retention_days: 180
    rotation: "weekly"         # daily | weekly | size
    max_file_size_mb: 50
  TASK:
    file: "task_execution.log"
    retention_days: 365
    rotation: "weekly"
    max_file_size_mb: 50
  SYSTEM:
    file: "system_activity.log"
    retention_days: 180
    rotation: "weekly"
    max_file_size_mb: 50
  SECURITY:
    file: "security_events.log"
    retention_days: 730
    rotation: "weekly"
    max_file_size_mb: 20
  EMAIL:
    file: "email_events.log"
    retention_days: 180
    rotation: "weekly"
    max_file_size_mb: 50
```

Analytics‑specific log/metric retention (for Insights / dashboards) is configured in **Doc 6 – Insights Module Config**, not here.

### 9.3 Public Functions

```python
def log_event(
    *,
    category: str,    # "WORKFLOW" | "TASK" | "SYSTEM" | "SECURITY" | "EMAIL"
    log_level: str,   # "DEBUG" | "INFO" | "WARNING" | "ERROR" | "CRITICAL"
    message: str,
    identifier: str | None = None,
    metadata: dict | None = None
) -> None:
    """
    Writes a structured log entry according to the standard schema
    (timestamp, level, category, message, identifier, metadata).

    The persisted JSON field name for the level MUST be `level`
    to align with Doc 2 / Doc 8 examples.
    """

def rotate_logs() -> None:
    """
    Performs log rotation and deletion based on per-category retention policies.
    """
```

### 9.4 Example Log Entry (Fixed Casing + Field Names)

```json
{
  "timestamp": "2025-11-18T10:30:00Z",
  "level": "INFO",
  "category": "WORKFLOW",
  "message": "Task created",
  "identifier": "task_id:f9e6fc7d-12ab-4b9f-a4db-3f1ecf3f2a89",
  "metadata": {
    "workflow_name": "maintenance_default",
    "actor": "system"
  }
}
```

---

## 10. Validation & Security Support (`validation_core`)

### 10.1 Responsibilities

* Validate configuration files for required keys and basic schema.
* Provide reusable input validators (emails, tasks, workflows).
* Provide hooks for auth checks (role‑based, token‑based) consumed by higher‑level security modules.

### 10.2 Config Validation

```python
def validate_config(config: dict, required_keys: list[str]) -> dict:
    """
    Ensures required_keys are present and not null in the config object.

    Must also enforce:
      - metadata.environment ∈ ENVIRONMENT
      - metadata.version matches ^3\\.[0-9]+$
      - metadata.last_updated is a valid YYYY-MM-DD date

    On failure:
      - returns ok=false, error.code="CONFIG_VALIDATION_ERROR"
      - logs a SYSTEM-level error via logger_service.
    """
```

Applies to (non‑exhaustive):

* `email_config.yaml`
* `database_connection.yaml`
* `logging_config.yaml`
* `notification_config.yaml`
* Workflow rule bundles (`/config/workflows/*.yaml`)
* Org profile configs (profiles YAML / Doc 7) and Insights config (`/config/insights/config.yaml`).

### 10.3 Input Validation Examples

Typical validators (all returning the standard result shape):

* `validate_email(parsed_email)` – against EMAIL_MESSAGE logical schema.
* `validate_task_payload(payload)` – checks fields against canonical Task JSON (Doc 8 §8.4.2).
* `validate_workflow_rule(rule_obj)` – structure, enums, actions.
* `validate_notification_payload(payload)` – correct channels and visibility.

---

## 11. Cross-Service Flow Example (Locked Pattern)

Example: **Maintenance request via email → Task → Escalation**

1. **Email Reception**

   * `email_gateway.fetch_incoming_emails(max_count=50)`
   * For each raw email:

     * `parse_email(raw) → parsed_email`
     * `validate_email(parsed_email)`

2. **Persist + Log**

   * `persistence.insert_record("email_messages", parsed_email)`
     (plus attachments and processing events as needed)
   * `logger_service.log_event(
       category="EMAIL",
       log_level="INFO",
       message="Email received",
       identifier=f"email_message_id:{parsed_email['email_message_id']}"
     )`

3. **Workflow Execution**

   * Build context: `{ "source": "EMAIL", "organization_id": <org>, "email": parsed_email }`
   * `workflow_engine.execute_workflow(context) → actions`

4. **Apply Actions**

   * For `CREATE_TASK`: `task_handler.create_task(task_payload)`
   * For `ROUTE`: `task_handler.assign_task(task_id, assignee_role=...)`
   * For `NOTIFY`: `notifier_service.send_task_notification(task, event_type="CREATED")`

5. **Escalation**

   * Background job checks unresolved tasks whose `reactivity_deadline_at` has passed.
   * If overdue:

     * `task_handler.escalate_task(task_id, reason="Reactivity time exceeded")`
     * `notifier_service.send_task_notification(task, event_type="ESCALATED")`
     * `logger_service.log_event(
         category="WORKFLOW",
         log_level="WARNING",
         message="Task escalated",
         identifier=f"task_id:{task_id}"
       )`

This pattern is **canonical** and reused across domains; domain modules plug in only through config and handlers, not by changing this flow.

---

## 12. Non-Functional Requirements

* **Performance**

  * Core Services should support at least:

    * ~50k tasks/day on a mid‑range server.
    * Email parsing throughput ≥ 10 messages/s sustained on reference hardware.

* **Reliability**

  * Critical operations (task creation, escalation, logging) should be idempotent where possible.
  * Failed external calls (SMTP, IMAP, webhooks) must be retried with backoff and logged with `LOG_LEVEL >= WARNING`.

* **Testing**

  * Unit tests for each core function (`parse_email`, `create_task`, `execute_workflow`, etc.).
  * Integration tests for end‑to‑end flows:

    * email → Task → notification → escalation,
    * API Task creation → workflow routing → Insights ingestion.

---

## 13. Extensibility Guidelines (v3)

To add new behaviour without touching core logic:

1. **New Task Types / Domains**

   * Add domain types in workflow rules (`type: "maintenance"`, `"hr_case"`, etc.).
   * Extend or add domain modules under `domain_modules/<domain>/` with `<domain>_module.yaml` and `<domain>_handler.py` (Doc 3).
   * Use `metadata` and domain link tables (`maintenance_task_links`, `education_task_links`, etc.) for domain‑specific fields (Doc 1).

2. **New Domain Modules**

   * Directory: `domain_modules/<domain>/`.

   * Provide:

     * `<domain>_module.yaml` – config (categories, subtypes, email patterns, routing hints).
     * `<domain>_handler.py` – hooks (`on_task_create`, `on_task_created`, `on_task_update`, `on_task_updated`, `get_domain_fields`).
     * Any templates / additional rule files referenced from the module config (no implicit paths).

   * Reuse shared **task_handler** and **workflow_engine**; do not implement your own lifecycles.

3. **New Notification Templates / Channels**

   * Add templates under `/templates/email/` or equivalent.
   * Reference them via `template_id` in workflow `NOTIFY` actions and notification config.
   * For new channels (SMS, webhook, push), extend `notifications.channels` and ensure they honour `VISIBILITY` and `NOTIFICATION_SCOPE`.

4. **New Analytics / Pattern Jobs**

   * Must use the existing Insights star schema and config (Doc 6) and feed back into Cases/Tasks via Core Services in a way that respects cyclic overview semantics (Doc 8).

Core Services remain the **single shared backbone**; all extensions must plug into it rather than bypass it.

```

:contentReference[oaicite:0]{index=0}
```
