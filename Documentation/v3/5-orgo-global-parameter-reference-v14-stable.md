# **Document 5/8: Core Services Specification** 

> (“Core Services” = everything headless and backend that powers workflows, tasks, emails, and logs.)

---

## 0. Scope & Status

* **Document ID**: `orgo-v3-core-services`
* **Role in set**: **5/8** (Core Services)
* **Version**: `3.0.1`
* **Applies to**: All Orgo v3 deployments (small teams → large orgs)
* **Non-goals**:

  * UI layouts (dashboards, web clients) – covered in **Interfaces**.
  * Low-level infra (containers, K8s, etc.) – covered in **Infrastructure**.
  * Domain-specific behavior beyond configuration (Maintenance, HR, etc.) – handled via **rules/templates**.

Core Services are **headless**. They expose APIs and internal services consumed by Interfaces, Domain Modules, and Infrastructure.

### 0.1 Alignment With Other Docs

This document **does not define** its own enums or table shapes. It assumes:

* **Canonical enums & task/case models**: defined in

  * **Doc 1 – Database Schema Reference**
  * **Doc 2 – Foundations / Enums**
* **Canonical task model**:

  * Fields & enums locked in **Global Alignment §0.1–0.6** (your cross‑doc spec).
* **Email schema**:

  * Canonical `email_messages` table from **Doc 1**.

Whenever this doc mentions TASK or EMAIL_MESSAGE, it is **referring to those canonical models**.

If anything in this file contradicts Docs 1/2, **Docs 1/2 win** and this doc must be updated.

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

   * Provides Postgres + SQLite connectors, CRUD helpers, and offline sync.

6. **Logging & Audit Service (`logger_service`)**

   * Unified logging, audit trails, and retention enforcement.

7. **Validation & Security Support (`validation_core`)**

   * Cross‑cutting validation utilities and basic auth/authorization hooks
     (full security spec lives in the Security doc, but Core Services must integrate cleanly).

All domain‑specific logic (HR, maintenance, education, etc.) must be expressed through:

* **Workflow rules** (`/config/workflows/*.yaml`)
* **Domain templates & rules** (`/domain_modules/<domain>/rules/*.yaml`, `/domain_modules/<domain>/templates/*.html`)

Core Services **must not** hardcode domain‑specific branches.

---

## 2. Shared Conventions (Locked for v3)

### 2.1 Naming & Case

* **Environment variables**: `ORGO_*` (all caps, snake_case).
* **Config keys (YAML/JSON)**: snake_case (`reactivity_time`, `notification_scope`).
* **Database columns**: snake_case (`task_id`, `created_at`).
* **Enum values in DB**: UPPER_SNAKE (`PENDING`, `HIGH`, `CRITICAL`).
* **JSON/UX representation**:

  * Lower‑case strings are permitted in API/JSON (e.g. `"pending"`, `"high"`).
  * They must map 1:1 to the DB enums (e.g. `"pending"` ↔ `PENDING`).
* **Service identifiers**: lower_snake (`task_handler`, `email_gateway`).

These are **locked** for v3; other documents assume these names.

### 2.2 Environments

Canonical environment values (as in Doc 2):

```text
ENVIRONMENT = { "dev", "staging", "prod", "offline" }
```

* All configuration examples in this doc use these values.
* Human‑readable descriptions may say “development” or “production”, but the value is always one of the four above.

### 2.3 Common Data Types

* `UUID`: canonical ID type for entities.
* `TIMESTAMP_UTC`: ISO8601 in UTC (e.g., `2025-11-18T10:30:00Z`).
* `JSONB`: arbitrary JSON (for Postgres); serialized JSON (for SQLite).
* `LABEL_CODE`: string like `100.34.Finance.Audit` (see Labeling System).

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

This shape is **locked** for v3.

### 2.5 Config Boundaries (Global vs Module)

* **Core Services config** in this doc:

  * Email gateway, DB connections, core logging, workflow engine, queues.
* **Domain modules config** (Doc 3):

  * Maintenance/HR/education module configs (`domain_modules/.../config`).
* **Insights/analytics config** (Doc 6):

  * Analytics retention, reporting windows, star schema export schedules.

Where overlapping concepts exist (e.g. *retention*):

* **Global retention for core logs and tasks** → this doc (Core Services).
* **Analytics retention / reporting windows** → Insights doc (Doc 6).
* When in doubt: **domain‑specific or reporting‑specific parameters live outside this doc**; this doc only governs core, cross‑domain services.

---

## 3. Canonical Data Models

These are **logical views** of the canonical DB schemas from Doc 1, using the enums from Doc 2.

### 3.1 TASK

**DB table**: `tasks`

**Canonical model (aligned with global Task model & Doc 1):**

```text
task_id            UUID                PK
organization_id    UUID                NOT NULL
case_id            UUID                NULL        -- links to cases.case_id
created_at         TIMESTAMP_UTC       NOT NULL
updated_at         TIMESTAMP_UTC       NOT NULL

type               TEXT                NOT NULL    -- domain type: "maintenance", "hr_case", "it_support", etc.
category           TEXT                NOT NULL    -- "request" | "incident" | "update" | "report" | "distribution"
subtype            TEXT                NULL        -- e.g. "plumbing", "harassment", "attendance"

label              TEXT                NOT NULL    -- "<base>.<category><subcategory>.<horizontal_role>"
title              TEXT                NOT NULL
description        TEXT                NOT NULL

status             task_status_enum    NOT NULL    -- PENDING|IN_PROGRESS|ON_HOLD|COMPLETED|FAILED|ESCALATED|CANCELLED
priority           task_priority_enum  NOT NULL    -- LOW|MEDIUM|HIGH|CRITICAL
severity           task_severity_enum  NOT NULL    -- MINOR|MODERATE|MAJOR|CRITICAL

visibility         visibility_enum     NOT NULL    -- PUBLIC|INTERNAL|RESTRICTED|ANONYMISED

assignee_role      TEXT                NULL        -- e.g. "Ops.Maintenance"
assignee_user_id   UUID                NULL        -- concrete user (optional)

due_at             TIMESTAMP_UTC       NULL
reactivity_time    INTERVAL            NULL        -- derived from profiles/workflows
escalation_level   INTEGER             NOT NULL DEFAULT 0   -- 0 = none, 1+ depth in escalation path

metadata           JSONB               NOT NULL    -- domain-specific; must not duplicate core fields
```

#### 3.1.1 Task Status (locked enum)

`task_status_enum`:

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

#### 3.1.2 Priority & Severity (locked enums)

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

In this doc we sometimes show `priority` / `severity` as `TEXT` in examples; this must be read as **“backed by the enums above”**, not arbitrary strings.

#### 3.1.3 Visibility (locked enum)

`visibility_enum`:

```text
PUBLIC
INTERNAL
RESTRICTED
ANONYMISED
```

* **RESTRICTED** replaces older “PRIVATE” language:

  * “minimal set of users/roles who need access.”
* API/JSON MAY expose lower‑case (`"restricted"`, `"anonymised"`), but these map directly to the DB enum.

#### 3.1.4 Legacy `scope` Classification (non‑normative)

Earlier v2/v3 drafts used a conceptual classification:

```text
"UNIVERSAL" | "CROSS_INDUSTRY" | "SPECIFIC"
```

For v3:

* This classification is **optional metadata only**, not part of the canonical `tasks` schema.
* If you need it, store it under `metadata.scope` as a string.
* Core Services do **not** rely on it, and it is not used by profiles; it is purely descriptive or analytical.

---

### 3.2 EMAIL_MESSAGE

**DB table**: `email_messages`

Core Services treat email as canonical input/output; the schema must align with **Doc 1 – Email & Threads**.

```text
email_message_id       UUID           PK
organization_id        UUID           NOT NULL

raw_source_id          TEXT           NULL        -- IMAP UID, file path, PST id, etc.
message_id_header      TEXT           NULL        -- RFC822 Message-ID

direction              email_direction_enum NOT NULL  -- INBOUND | OUTBOUND

from_address           TEXT           NOT NULL
to_addresses           TEXT[]         NOT NULL       -- array of RFC822 strings
cc_addresses           TEXT[]         NULL
bcc_addresses          TEXT[]         NULL

subject                TEXT           NOT NULL
received_at            TIMESTAMP_UTC  NULL          -- for inbound
sent_at                TIMESTAMP_UTC  NULL          -- for outbound

raw_headers            TEXT           NULL
text_body              TEXT           NULL          -- normalized plain text
html_body              TEXT           NULL          -- may be truncated; full content may live in blob storage

parsed_metadata        JSONB          NOT NULL      -- e.g. classifier results, label candidates
attachments_meta       JSONB          NOT NULL      -- array of attachment metadata objects

linked_task_id         UUID           NULL          -- FK → tasks.task_id
security_flags         JSONB          NOT NULL      -- e.g. { "pgp_encrypted": true, "spam_score": 0.1 }
```

`email_direction_enum`:

```text
INBOUND
OUTBOUND
```

Core Services (email_gateway, workflow_engine, task_handler) must rely on **this structure** and **not** define alternative shapes for email.

---

### 3.3 LOG_EVENT (logical)

Log entries may be stored in files or a table such as `log_events`, but the logical schema is:

```json
{
  "timestamp": "2025-11-18T10:30:00Z",
  "log_level": "INFO",
  "category": "WORKFLOW",
  "message": "Task created",
  "identifier": "task_id:7b45-...",
  "metadata": {
    "workflow_name": "maintenance_default",
    "actor": "system"
  }
}
```

* `log_level` must be one of the canonical levels (Doc 2).
* `category` must be one of the canonical categories (Doc 2), e.g. `WORKFLOW`, `TASK`, `SYSTEM`, `SECURITY`, `EMAIL`.

---

## 4. Email Gateway Service (`email_gateway`)

### 4.1 Responsibilities

* Fetch incoming messages via IMAP/POP or offline files.
* Validate and parse messages into `email_messages` entities.
* Sanitize content & enforce plain‑text‑first processing.
* Send outgoing notifications via SMTP.
* Handle errors gracefully with retries and backoff.

### 4.2 Configuration (Locked Keys)

**YAML file**: `/config/email/email_config.yaml`

```yaml
metadata:
  config_name: "email_config"
  version: "3.0.0"
  last_updated: "2025-11-18T00:00:00Z"
  environment: "dev"    # one of: dev | staging | prod | offline
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

**Notes:**

* Environment is always one of `dev|staging|prod|offline`.
* Credentials are **never** stored as raw strings here; only via `*_env`.

### 4.3 Public Functions (Conceptual Signatures)

```python
def fetch_incoming_emails(max_count: int) -> dict:
    """
    Fetches up to `max_count` raw email messages from IMAP.
    Returns standard result shape with a list of raw messages in data.
    """

def parse_email(raw_email: dict) -> dict:
    """
    Parses a raw email into a structured EMAIL_MESSAGE payload
    matching the canonical email_messages model.
    Required keys in result: subject, from_address, to_addresses, text_body.
    """

def validate_email(parsed_email: dict) -> dict:
    """
    Validates the email payload; fails if required fields missing or too large.
    Respects limits.max_email_size_mb and allowed_attachment_mimetypes.
    """

def send_email(to: list[str], subject: str, body: str,
               cc: list[str] | None = None,
               bcc: list[str] | None = None) -> dict:
    """
    Sends an email via SMTP.
    """
```

### 4.4 Validation Rules (Email)

* Required fields: `subject`, `from_address`, `to_addresses`, `text_body` (or `html_body` convertible to text).
* Max total size: **10MB** (configurable).
* Allowed attachment extensions: configured via `limits.allowed_attachment_mimetypes`.
* Sanitize:

  * Strip dangerous HTML/JS.
  * Normalize to plain text in `text_body`.

Error codes:

* `EMAIL_VALIDATION_ERROR`
* `EMAIL_PARSING_ERROR`
* `EMAIL_SEND_FAILED`

---

## 5. Task Handler Service (`task_handler`)

### 5.1 Responsibilities

* Create tasks from email/API/workflow events.
* Manage the **canonical state machine** for task status.
* Trigger escalations and notifications.
* Provide a consistent API for all modules & interfaces.

### 5.2 Core State Machine (Locked)

Allowed transitions:

* `PENDING` → `IN_PROGRESS`, `CANCELLED`
* `IN_PROGRESS` → `ON_HOLD`, `COMPLETED`, `FAILED`, `ESCALATED`
* `ON_HOLD` → `IN_PROGRESS`, `CANCELLED`
* `ESCALATED` → `IN_PROGRESS`, `COMPLETED`, `FAILED`
* `COMPLETED`, `FAILED`, `CANCELLED` → (terminal)

Any invalid transition must return:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_TASK_STATE_TRANSITION",
    ...
  }
}
```

### 5.3 Public Functions (Logical)

```python
def create_task(payload: dict) -> dict:
    """
    Creates a new task.
    Required (core) fields in payload:
      - type (str)           # domain-type, e.g. "maintenance"
      - category (str)       # "request" | "incident" | "update" | "report" | "distribution"
      - title (str)
      - description (str)
      - priority (str)       # "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" (or lower-case JSON forms)
      - severity (str)       # "MINOR" | "MODERATE" | "MAJOR" | "CRITICAL"
      - label (str)
      - metadata (dict)
    Derived:
      - status = PENDING
      - reactivity_time, escalation_level based on profiles/workflows.
    """

def update_task_status(task_id: str, new_status: str,
                       *, reason: str | None = None,
                       actor_user_id: str | None = None) -> dict:
    """
    Updates the status of a task, enforcing the state machine rules.
    """

def escalate_task(task_id: str, *,
                  reason: str,
                  actor_user_id: str | None = None) -> dict:
    """
    Escalates the task along its defined escalation path.
    Increments escalation_level and sets status = ESCALATED.
    """

def assign_task(task_id: str,
                assignee_role: str | None = None,
                assignee_user_id: str | None = None,
                *,
                actor_user_id: str | None = None) -> dict:
    """
    Assigns or reassigns a task to a role and/or user.
    """

def add_task_comment(task_id: str, comment: str, author_user_id: str) -> dict:
    """
    Appends a comment to task_comments for auditability.
    """
```

### 5.4 Required Task Attributes (Validation)

Minimal required keys for `create_task`:

* `type`
* `category`
* `title`
* `description`
* `priority`
* `severity`
* `label`
* `metadata`

On validation failure:

* `code = "TASK_VALIDATION_ERROR"`

---

## 6. Workflow Engine Service (`workflow_engine`)

### 6.1 Responsibilities

* Load and merge global + organization + domain‑specific rules.
* Validate rule structure and enums.
* Evaluate rules based on context (email, task, profile).
* Produce a deterministic list of actions (`CREATE_TASK`, `ROUTE`, `ESCALATE`, etc.).

### 6.2 Rule Structure (Locked Keys)

Each rule:

```yaml
id: "maintenance_default_v3"
version: "3.0.0"
match:
  source: "EMAIL"             # EMAIL | API | SYSTEM
  type: "maintenance"         # domain-level type (NOT the category enum)
  category: "request"         # optional; one of canonical categories
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

**Important fix**:
Where earlier examples used `category: "maintenance"` in `match`, that is now corrected to `type: "maintenance"`.

* `category` is reserved for `"request" | "incident" | "update" | "report" | "distribution"`.

### 6.3 Supported ACTION Types

* `CREATE_TASK`
* `UPDATE_TASK`
* `ROUTE`
* `ESCALATE`
* `ATTACH_TEMPLATE`
* `SET_METADATA`
* `NOTIFY`

### 6.4 API Surface (Logical)

```python
def execute_workflow(context: dict) -> dict:
    """
    Given a context (email / task event / system timer),
    evaluates all matching rules and returns ordered actions to apply.
    """

def validate_workflow_rules() -> dict:
    """
    Validates rule files (YAML/JSON) for required keys and enum correctness.
    """
```

---

## 7. Notification Service (`notifier_service`)

### 7.1 Responsibilities

* Implement the **Notifications** portion of Core Services.
* Send email + in‑app notifications for:

  * Task creation
  * Assignment
  * Escalation
  * Completion
* Respect `notification_scope` & `visibility` from tasks + org profiles.

### 7.2 Configuration (Locked Keys)

Core notification config lives in **Core Services**; analytics/reporting notifications live in **Insights** (Doc 6).

```yaml
metadata:
  config_name: "notification_config"
  version: "3.0.0"
  last_updated: "2025-11-18T00:00:00Z"
  environment: "prod"
  organization_id: "default"

notifications:
  default_channel: "EMAIL"
  channels:
    email:
      enabled: true
      sender_name: "Orgo System"
      sender_address: "no-reply@example.org"
    in_app:
      enabled: true

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
    event_type: "CREATED" | "ASSIGNED" | "ESCALATED" | "COMPLETED"
    Channel selection & scope determined by notification config,
    task.visibility, and org profile.
    """
```

---

## 8. Persistence Service (`persistence`)

### 8.1 Responsibilities

* Manage connections to **Postgres** (online) and **SQLite** (offline).
* Provide safe CRUD helpers with parameterized queries.
* Support conflict resolution between offline and online stores.

### 8.2 Configuration (Locked Keys)

**YAML file**: `/config/database/database_connection.yaml`

```yaml
metadata:
  config_name: "database_connection"
  version: "3.0.0"
  last_updated: "2025-11-18T00:00:00Z"
  environment: "staging"
  organization_id: "default"

postgres:
  enabled: true
  url_env: "DATABASE_URL"          # full URI (for ORM)
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
  enabled: true
  file_path: "./data/orgo_offline.db"
  timeout_seconds: 5
```

### 8.3 Core Functions (Logical)

```python
def connect_to_database(*, mode: str = "ONLINE") -> object:
    """
    mode: "ONLINE" for Postgres, "OFFLINE" for SQLite.
    Returns a connection / pool object or raises on failure.
    """

def fetch_records(table: str, where: dict | None = None,
                  *, mode: str = "ONLINE") -> dict:
    """
    Parameterized SELECT based on `where` conditions.
    """

def insert_record(table: str, data: dict, *, mode: str = "ONLINE") -> dict:
    """
    INSERT with validation; returns primary key.
    """

def update_record(table: str, key: dict, updates: dict,
                  *, mode: str = "ONLINE") -> dict:
    """
    Parameterized UPDATE.
    """
```

All queries must be parameterized to prevent SQL injection.

---

## 9. Logging & Audit Service (`logger_service`)

### 9.1 Responsibilities

* Provide a single `log_event` entry point.
* Support categories: `WORKFLOW`, `TASK`, `SYSTEM`, `SECURITY`, `EMAIL`.
* Enforce retention policies and rotation.

### 9.2 Configuration

Core logging config:

```yaml
metadata:
  config_name: "logging_config"
  version: "3.0.0"
  last_updated: "2025-11-18T00:00:00Z"
  environment: "prod"
  organization_id: "default"

logging:
  level: "INFO"                # DEBUG|INFO|WARN|ERROR
  format: "json"               # json|text
  log_dir: "./logs"

categories:
  WORKFLOW:
    file: "workflow_activity.log"
    retention_days: 180
    rotation: "weekly"         # daily|weekly|size
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

Analytics‑specific log/metric retention is configured in **Insights (Doc 6)**, not here.

### 9.3 Public Functions

```python
def log_event(
    *,
    category: str,    # "WORKFLOW" | "TASK" | "SYSTEM" | "SECURITY" | "EMAIL"
    log_level: str,   # "DEBUG" | "INFO" | "WARN" | "ERROR"
    message: str,
    identifier: str | None = None,
    metadata: dict | None = None
) -> None:
    """
    Writes a structured log entry according to the standard schema.
    """

def rotate_logs() -> None:
    """
    Performs rotation based on retention policies.
    """
```

### 9.4 Example Log Entry (Fixed Casing)

```json
{
  "timestamp": "2025-11-18T10:30:00Z",
  "log_level": "INFO",
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

* Validate configuration files for required keys and types.
* Provide reusable input validators (emails, tasks, workflows).
* Provide hooks for auth checks (role‑based, token‑based).

### 10.2 Config Validation

```python
def validate_config(config: dict, required_keys: list[str]) -> dict:
    """
    Ensures required_keys are present and not null.
    On failure: ok=false, code="CONFIG_VALIDATION_ERROR".
    """
```

Applies to (non‑exhaustive):

* `email_config.yaml`
* `database_connection.yaml`
* `logging_config.yaml`
* `workflow_rules.yaml`
* Org profile configs.

### 10.3 Input Validation Examples

* `validate_email(parsed_email)`
* `validate_task_payload(payload)` – checks fields against canonical task model.
* `validate_workflow_rule(rule_obj)`

Each returns the standard result shape.

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
   * `logger_service.log_event(category="EMAIL", log_level="INFO",
       message="Email received", identifier=email_message_id)`

3. **Workflow Execution**

   * Build context: `{ "source": "EMAIL", "email": parsed_email }`
   * `workflow_engine.execute_workflow(context) → actions`

4. **Apply Actions**

   * For `CREATE_TASK`: `task_handler.create_task(task_payload)`
   * For `ROUTE`: `task_handler.assign_task(task_id, assignee_role=...)`
   * For `NOTIFY`: `notifier_service.send_task_notification(...)`

5. **Escalation**

   * Background job checks overdue tasks based on `reactivity_time`.
   * If overdue:

     * `task_handler.escalate_task(task_id, reason="Reactivity time exceeded")`
     * `notifier_service.send_task_notification(event_type="ESCALATED")`
     * `logger_service.log_event(
         category="WORKFLOW",
         log_level="WARN",
         message="Task escalated",
         identifier=task_id
       )`

This flow is **canonical** and reused across domains.

---

## 12. Non-Functional Requirements

* **Performance**

  * Core Services should support:

    * ≥ 50k tasks/day on a mid‑range server.
    * Email parsing throughput ≥ 10 messages/s sustained.
* **Reliability**

  * Critical operations (task creation, escalation, logging) should be idempotent where possible.
* **Testing**

  * Unit tests for each core function (parse_email, create_task, execute_workflow, etc.).
  * Integration tests for full email → task → escalation workflows.

---

## 13. Extensibility Guidelines (v3)

To add new behavior without touching core logic:

1. **New Task Types**

   * Add domain types in workflow rules (`type: "maintenance"` etc.).
   * Use `metadata` for domain‑specific fields.
   * **Do not** add category‑based branching to `task_handler`; rely on workflows.

2. **New Domain Modules**

   * Add under `/domain_modules/<domain>/templates` and `/domain_modules/<domain>/rules`.
   * Reuse shared workflow engine and task handler.

3. **New Notification Templates**

   * Add HTML templates under `/templates/email/`.
   * Reference them via `template_id` in workflow actions.

---
