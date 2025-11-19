# Doc 8 – Cyclic Overview, Labels & Universal Flow Rules (Orgo v3)

**Document ID**: `orgo-v3-doc-8`
**Role in set**: 8/8 (Labels, Case/Task JSON, Cyclic Overview, Flow Rules)
**Version**: `3.0.0`

**Depends on and must align with**:

* **Doc 1 – Database Schema Reference (Custom Tables)** – `cases`, `tasks`, label fields, and analytics tables. 
* **Doc 2 – Foundations, Locked Variables & Operational Checklists** – canonical enums (`TASK_STATUS`, `CASE_STATUS`, `TASK_PRIORITY`, `TASK_SEVERITY`, `VISIBILITY`), canonical Task field set. 
* **Doc 3 – Domain Modules (Orgo v3)** – domain adapters over the central Task/Case engine. 
* **Doc 5 – Core Services Specification** – task handler, workflow engine, state machine, email gateway. 
* **Doc 6 – Insights Module Config Parameters** – analytics retention, pattern windows, DAGs, reporting cache. 
* **Doc 7 – Organization Profiles & Cyclic Overview Settings** – reactivity, transparency, pattern sensitivity, cyclic review schedules. 

> **Normative note**
>
> * **Doc 2** is the source of truth for enums and the canonical Task field set; **Doc 1** is canonical for physical schemas.
> * This document is canonical for:
>
>   * Labeling system semantics (vertical & horizontal axes).
>   * Case and Task JSON contracts at the boundary (aligned to Doc 1/2).
>   * Status lifecycles and allowed transitions.
>   * Cyclic review / pattern‑recognition semantics and flow rules.
> * If you find conflicts, Doc 1/2 win for schemas/enums; this doc must be updated.

---

## 8.1 Purpose & Scope

This document defines:

1. How Orgo **labels and routes** information across vertical (hierarchy/broadcast) and horizontal (functional) axes.
2. The **canonical JSON contracts** for Case and Task at API / message boundaries (consistent with DB and enums).
3. The **status lifecycles and allowed transitions** for Cases and Tasks (consumed by Core Services and domain modules).
4. The **cyclic overview system** that turns repeated incidents into audit/review Cases instead of just charts.

It assumes the multi‑tenant backbone, Task/Case model, domain modules, profiles, Insights star schema, and guardrails defined in Docs 1–7.

---

## 8.2 Core Concepts & Glossary

* **Organization (tenant)**
  Logical owner of data (`organization_id`), profiles, workflows, and configuration.

* **User vs Person**
  *User* = has an Orgo login (`user_accounts`).
  *Person* = who things are about (`person_profiles` – students, players, employees, community members). 

* **Case**
  Long‑lived container for an incident, situation, pattern, or theme. It aggregates Tasks, labels, severity, participants, and context (location, groups, persons). Cases are what the cyclic overview reviews over time.

* **Task**
  The central unit of work. Tasks are created from signals (email/API/offline), live in a canonical global table, and have a strict, shared schema: type, category, subtype, label, status, priority, severity, visibility, assignee, deadlines, escalation level, metadata.

* **Label**
  A structured “information label” encoding *where* in the organization and *what kind of information* something is:

  ```text
  <BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE?>
  ```

  Example: `100.94.Operations.Safety`

  * `100` – broadcast level (department heads / vertical tier).
  * `.9` – Crisis & emergency info.
  * `.4` – Report (structured reporting).
  * `Operations.Safety` – horizontal role. 

* **Profile**
  A template (“friend_group”, “hospital”, “advocacy_group”, “retail_chain”, etc.) describing how intense/urgent/private things are: reactivity seconds, transparency level, review cadence, notification scope, pattern sensitivity, severity policy, logging depth, automation level. Profiles plug into task creation, escalation logic, cyclic reviews, logging, and privacy.

* **Insights / Cyclic overview**
  An analytics module on top of star‑schema tables (`insights.dim_*`, `insights.fact_*`) plus Airflow DAGs. It continuously computes patterns and cyclic reviews and turns threshold crossings into new Cases.

---

## 8.3 Labeling System (Vertical & Horizontal Axes)

### 8.3.1 Label Structure (Canonical)

Canonical label format:

```text
<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE?>
```

* `<BASE>` – integer vertical base (level / broadcast scope).
* `<CATEGORY>` – first decimal: information category (1–9).
* `<SUBCATEGORY>` – second decimal: intent (1–5).
* `<HORIZONTAL_ROLE>` – optional functional role (e.g. `Ops.Maintenance`, `HR.Recruitment`).

Examples:

* `1.32` – CEO‑level compliance update.
* `11.51.HR.Recruitment` – department‑head level training request for HR Recruitment.
* `100.94.Operations.Safety` – department‑head broadcast of a crisis‑related safety report. 

Tasks and Cases each have exactly one **canonical label** string (`tasks.label`, `cases.label`) in this format; additional classification is done via `label_definitions` / `entity_labels`. 

### 8.3.2 Vertical Axis – Levels & Broadcast Bases

Examples of vertical bases:

* **Individual / level‑scoped**

  * `1` – CEO.
  * `2` – C‑level leadership.
  * `11` – department head.
  * `101` – team lead.
  * `1001` – individual staff member.

* **Reserved broadcast bases**

  * `10` – broadcast for top management.
  * `100` – broadcast for department heads.
  * `1000` – broadcast for operational staff.

The base defines **who is in scope**, not what the information is.

### 8.3.3 Categories (First Decimal)

Categories (1–9) define the type of information:

1. Operational information
2. Strategic information
3. Compliance & reporting
4. Customer / client information
5. Training & development
6. Communication & coordination
7. Financial information
8. Technical & infrastructure information
9. Crisis & emergency information

Example: `100.94.Operations.Safety` → category `9` (“Crisis & Emergency”), subcategory `4` (“Report”).

### 8.3.4 Subcategories (Second Decimal)

Subcategories (1–5) define intent:

1. Requests – asking for resources, action, approval.
2. Updates – informing about progress or changes.
3. Decisions – approvals, rejections, policy changes.
4. Reports – structured reporting (audit, incident, performance).
5. Distribution – broadcast/distribution only.

### 8.3.5 Horizontal Roles (Functional Axis)

Horizontal roles are dot‑separated domain labels:

* IT: `IT.Support`, `IT.Network`, `IT.Security`, `IT.Development`
* HR: `HR.Recruitment`, `HR.Payroll`, `HR.Policy`, `HR.Training`
* Finance: `Finance.Audit`, `Finance.Reporting`, `Finance.Budgeting`
* Operations: `Ops.Maintenance`, `Ops.Logistics`, `Ops.Procurement`, `Ops.Scheduling`
* Customer: `Customer.Support`, `Customer.Feedback`

These are **descriptive** and extensible; they do not change the base routing semantics.

### 8.3.6 Broadcast Bases (10/100/1000) – Informational by Default

Labels whose base is `10`, `100`, or `1000` are **broadcasts**:

* `10.x` – executive broadcast.
* `100.x` – department head broadcast.
* `1000.x` – staff‑wide broadcast.

**Default rule**:

* Broadcast labels are **informational by default**: they do not automatically spawn mandatory Tasks.
* Tasks from broadcast labels are created **only** when a workflow rule explicitly says so (e.g. `auto_create_tasks: true` for a specific pattern).

Core services and domain modules must treat broadcasts as “distribute information” unless configuration overrides this.

---

## 8.4 Canonical JSON Contracts (Case & Task)

This section defines the JSON shape used at API boundaries. It must map cleanly to:

* Table `cases` and `tasks` in Doc 1. 
* Enums and canonical Task field set in Doc 2. 

### 8.4.1 Case JSON Schema

Operationally, Cases are stored in `cases` with the columns defined in Doc 1; this is their JSON contract. 

```yaml
Case:
  type: object
  required:
    - case_id
    - organization_id
    - source_type
    - label
    - title
    - description
    - status
    - severity
  properties:
    case_id:
      type: string
      format: uuid
      description: Stable external identifier (maps from cases.id).
    organization_id:
      type: string
      format: uuid
    source_type:
      type: string
      enum: [email, api, manual, sync]
      description: Origin channel (maps to task_source_enum / cases.source_type).
    source_reference:
      type: string
      nullable: true
      description: Channel-specific reference (e.g. email message-id, external URI).
    label:
      type: string
      description: Canonical information label "<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE>".
    title:
      type: string
      maxLength: 512
    description:
      type: string
    status:
      type: string
      enum: [open, in_progress, resolved, archived]
      description: Case lifecycle; see §8.5.1 for transitions.
    severity:
      type: string
      enum: [minor, moderate, major, critical]
      description: JSON form of TASK_SEVERITY; maps to MINOR/MODERATE/MAJOR/CRITICAL.
    reactivity_time:
      type: string
      nullable: true
      description: ISO‑8601 duration (e.g. "PT2H"); DB uses interval.
    origin_vertical_level:
      type: integer
      nullable: true
      description: Base part of original label (e.g. 100, 1001).
    origin_role:
      type: string
      nullable: true
      description: Horizontal role of origin (e.g. "Ops.Maintenance").
    tags:
      type: array
      items:
        type: string
      nullable: true
    location:
      type: object
      additionalProperties: true
      nullable: true
      description: Structured location (site, building, GPS, etc.).
    metadata:
      type: object
      additionalProperties: true
      description: Case-level metadata (pattern_sensitivity, review settings, etc.).
    created_at:
      type: string
      format: date-time
      readOnly: true
    updated_at:
      type: string
      format: date-time
      readOnly: true
```

* `severity` piggybacks on `task_severity_enum` (`MINOR`/`MODERATE`/`MAJOR`/`CRITICAL`) at DB level; JSON uses the lower‑case forms.

### 8.4.2 Task JSON Schema

Task JSON reuses the canonical Task fields from Doc 2 and adds source/actor fields from Doc 1.

```yaml
Task:
  type: object
  required:
    - task_id
    - organization_id
    - type
    - category
    - label
    - status
    - priority
    - severity
    - visibility
  properties:
    task_id:
      type: string
      format: uuid
      description: Stable external identifier (maps from tasks.id).
    organization_id:
      type: string
      format: uuid
    case_id:
      type: string
      format: uuid
      nullable: true
      description: Case this task belongs to (if any).
    source:
      type: string
      enum: [email, api, manual, sync]
      description: Origin channel (task_source_enum).
    type:
      type: string
      description: Domain-level type, e.g. "maintenance", "hr_case", "education_support".
    category:
      type: string
      enum: [request, incident, update, report, distribution]
      description: Global category enum.
    subtype:
      type: string
      nullable: true
      description: Domain-specific subtype (often mirrored into metadata).
    label:
      type: string
      description: Canonical information label.
    title:
      type: string
      maxLength: 512
    description:
      type: string
    status:
      type: string
      enum: [PENDING, IN_PROGRESS, ON_HOLD, COMPLETED, FAILED, ESCALATED, CANCELLED]
      description: TASK_STATUS; JSON MAY also use lower-case forms that map 1:1.
    priority:
      type: string
      enum: [LOW, MEDIUM, HIGH, CRITICAL]
    severity:
      type: string
      enum: [MINOR, MODERATE, MAJOR, CRITICAL]
    visibility:
      type: string
      enum: [PUBLIC, INTERNAL, RESTRICTED, ANONYMISED]
      description: VISIBILITY enum; governs access and export semantics.
    assignee_role:
      type: string
      nullable: true
      description: Routing role (e.g. "Ops.Maintenance").
    assignee_user_id:
      type: string
      format: uuid
      nullable: true
    created_by_user_id:
      type: string
      format: uuid
      nullable: true
      description: User that created the task (system actor).
    requester_person_id:
      type: string
      format: uuid
      nullable: true
      description: Person the work is for (student, player, employee, etc.).
    due_at:
      type: string
      format: date-time
      nullable: true
    reactivity_time:
      type: string
      nullable: true
      description: ISO‑8601 duration; SLA window from creation.
    escalation_level:
      type: integer
      description: 0 = none; 1+ = depth in escalation path.
    metadata:
      type: object
      additionalProperties: true
      description: Domain-specific fields; must not duplicate core fields.
    created_at:
      type: string
      format: date-time
      readOnly: true
    updated_at:
      type: string
      format: date-time
      readOnly: true
```

* Core services must reject unknown enum values and treat `status`, `priority`, `severity`, and `visibility` as the canonical enums from Doc 2.

---

## 8.5 Status Lifecycles & Allowed Transitions

Any service that mutates `cases.status` or `tasks.status` must enforce these state machines. Invalid transitions must be rejected and logged as validation errors (`INVALID_TASK_STATE_TRANSITION`, similar for Cases). 

### 8.5.1 Case Status Lifecycle

**CASE_STATUS** (from Doc 2): `open`, `in_progress`, `resolved`, `archived`.

Semantics:

* `open` – newly created, not yet actively being worked.
* `in_progress` – actively being handled; typically has open Tasks.
* `resolved` – underlying issue addressed; still available for reviews and follow‑ups.
* `archived` – fully closed; retained only for history/compliance.

**Allowed transitions:**

* `open` → `in_progress`
* `open` → `resolved` (immediate resolution)
* `open` → `archived` (triaged as out‑of‑scope / duplicate / spam with reason in metadata)
* `in_progress` → `resolved`
* `in_progress` → `archived` (dropped/invalidated with reason)
* `resolved` → `archived`
* `resolved` → `in_progress` (re‑opened due to recurrence or new information)

`archived` is terminal in normal flows; reopening an archived Case should be treated as an exceptional governance action and recorded in audit logs.

**Unresolved Cases (for cyclic overview)**

A Case is considered **unresolved** if its status is `open` or `in_progress`. Cyclic overview jobs focus thresholds on unresolved Cases plus recently resolved ones.

### 8.5.2 Task Status Lifecycle

Canonical `TASK_STATUS` (Doc 2/Doc 5):

```text
PENDING
IN_PROGRESS
ON_HOLD
COMPLETED
FAILED
ESCALATED
CANCELLED
```

Semantics:

* `PENDING` – created, not started.
* `IN_PROGRESS` – actively being worked.
* `ON_HOLD` – paused, waiting on dependency/decision.
* `COMPLETED` – done successfully.
* `FAILED` – attempted but unsuccessful; further work may require new Task/Case.
* `ESCALATED` – escalated to higher authority or different queue.
* `CANCELLED` – explicitly stopped; no further work.

**Allowed transitions** (locked to Core Services state machine):

* `PENDING` → `IN_PROGRESS`

* `PENDING` → `CANCELLED`

* `IN_PROGRESS` → `ON_HOLD`

* `IN_PROGRESS` → `COMPLETED`

* `IN_PROGRESS` → `FAILED`

* `IN_PROGRESS` → `ESCALATED`

* `ON_HOLD` → `IN_PROGRESS`

* `ON_HOLD` → `CANCELLED`

* `ESCALATED` → `IN_PROGRESS`

* `ESCALATED` → `COMPLETED`

* `ESCALATED` → `FAILED`

* `COMPLETED`, `FAILED`, `CANCELLED` – terminal (no further transitions).

**Unresolved Tasks (for escalation & patterns)**

For escalation logic and cyclic overview, a Task is **unresolved** if status ∈ {`PENDING`, `IN_PROGRESS`, `ON_HOLD`, `ESCALATED`}. Only Tasks in unresolved states contribute to “overdue” calculations; all states contribute to patterns.

---

## 8.6 Cyclic Overview System (Pattern Recognition)

The cyclic overview system ensures that individual Cases/Tasks feed into **weekly, monthly, and yearly review loops**, driving new audit/review Cases when thresholds are crossed.

Pattern windows and thresholds are parameterized via:

* Insights config (`insights.patterns.*`) – technical window lengths and thresholds. 
* Organization profiles (`profiles.*.cyclic_overview.*`) – behavioural knobs per archetype (friend_group, hospital, advocacy_group, etc.). 

### 8.6.1 Review Frequencies

By default (subject to org profile and Insights config):

* **Weekly review**

  * Focus: critical/unresolved Cases and short‑window patterns.
  * Scope: all `CRITICAL` severity Cases plus unresolved Cases and high‑sensitivity domains (e.g., hospitals, HR).

* **Monthly review**

  * Focus: trends by department, label base, category, and location.
  * Scope: Cases from the last 1–6 months depending on `pattern_window_days` (profile + insights).

* **Yearly review**

  * Focus: systemic issues and long‑term risk.
  * Scope: Cases in the last 12–24 months (configurable; must fit within analytics retention). 

Exact windows (e.g. 28 days / 180 days / 730 days) are defined in Doc 6 and profile templates in Doc 7; this document defines their semantics.

### 8.6.2 Case Lifecycle in the Cyclic System

1. **Signal → Case/Task**

   * Email/API/offline imports create Tasks in the central engine; some Tasks create or attach to Cases via workflow rules.
   * Each Case receives:

     * `label` (e.g. `100.94.Operations.Safety`).
     * `severity` (`MINOR`–`CRITICAL`).
     * `reactivity_time` derived from the org profile, task/category, and severity.

2. **Immediate handling**

   * Local Tasks are created and worked through the Task state machine.
   * Case status is `open` or `in_progress` until the underlying situation is addressed.

3. **Resolution**

   * Once core work is done:

     * Tasks end in `COMPLETED` / `FAILED` / `CANCELLED`.
     * Case moves to `resolved` (still reviewable) or `archived` (for triaged/rejected items).

4. **Weekly roll‑up**

   * Weekly DAG (`insights_weekly_pattern_review`) reads operational `tasks` and `cases` into `insights.fact_*` tables.
   * It flags:

     * Overdue unresolved Cases (past `reactivity_time`).
     * Short‑window clusters (e.g. 2–3 similar high‑severity incidents in 7 days for a hospital profile).

5. **Monthly roll‑up**

   * Monthly DAG aggregates patterns by label base, category, location, and domain.
   * When thresholds are crossed (see 8.6.3), it creates **audit Cases** (e.g. `11.94.Operations.Safety.Audit`) via Core Services.

6. **Yearly roll‑up**

   * Yearly DAG computes systemic patterns (e.g. repeated “near misses” or chronic workload hotspots).
   * It opens **review Cases** for leadership (e.g. `2.94.Leadership.Safety.Review`), which themselves have Tasks.

### 8.6.3 Threshold Triggers (Semantic Rules)

Thresholds are configured (per environment & profile) via Doc 6/7; this section defines their meaning.

Typical triggers:

* **Incident frequency**

  * Example: “≥ N similar incidents in window_days” (e.g. 5 wet‑floor incidents in 180 days in the same lobby) → open an audit Case.

* **Cross‑department trends**

  * Same label category across multiple vertical bases (e.g. repeated safety incidents in different departments) → leadership review Case.

* **High‑risk indicators**

  * Specific tags/labels (e.g. self‑harm risk, serious harassment) with low `pattern_min_events` thresholds → rapid pattern Cases.

**Normative rule**:
When a threshold fires, the system **must** create a Case (usually audit/review) and optionally Tasks; it is not sufficient to just mark a dashboard. This keeps patterns in the same operational loop as regular work.

### 8.6.4 Example: Wet Floor Pattern

* **Week 1** – 3 Tasks: `PENDING/IN_PROGRESS` for wet floor in lobby; one Case `open`.
* **Month end** – 5 Cases labeled `100.94.Operations.Safety` about wet floors in same location → crosses configured `incident_frequency` threshold.

Result:

* New Case: `11.94.Operations.Safety.Audit` created by Insights/cyclic job.
* Tasks: inspection, root‑cause analysis, signage policy review.

---

## 8.7 Universal Rules for Information Flow

These rules apply regardless of domain (maintenance, HR, education, NGOs, etc.). Domain modules plug into this by mapping their own metadata and subtypes onto the shared label and Task/Case system.

### 8.7.1 Flow Types

* **Vertical**

  * Upward: incident reports, escalations, approvals.
  * Downward: policies, decisions, directives.

* **Horizontal**

  * Within a function (e.g. Ops team) or between functions (e.g. HR ↔ IT).

* **Cyclic**

  * Periodic loops (weekly/monthly/yearly) that take aggregated patterns and push them back into Cases/Tasks.

### 8.7.2 Rule 1 – Function‑Based Routing

Routing is based on **role/responsibility**, not individuals:

* Label base + category + horizontal role → which role queue initially owns a Case/Task.
* Domain modules may add further hints (subtype, domain metadata), but cannot bypass canonical label semantics.

Example:

* Harassment report → Case labeled `100.94.HR.CaseOfficer`, Task(s) assigned by routing rules to HR case officer roles.

### 8.7.3 Rule 2 – Time‑Based Escalation

Every Task and Case gets a **reactivity_time** derived from:

* Organization profile (friend_group vs hospital vs military). 
* Task category, severity, domain, and sometimes label.

If unresolved when `reactivity_time` elapses:

* Workflow/Task Handler must trigger escalation:

  * Increase `escalation_level`.
  * Move Task to `ESCALATED` or reassign to higher vertical base.
  * Notify appropriate roles/teams according to profile and notification config.

Example:

* Hospital profile: critical safety Task → `reactivity_seconds = 300` (5 minutes). If still `PENDING`/`IN_PROGRESS` after 5 minutes, escalate to on‑call clinical safety team.

### 8.7.4 Rule 3 – Broadcast Semantics

Broadcast bases (`10`, `100`, `1000`) are used for *awareness*:

* Downward flows: leadership → departments → staff.
* Sideways flows: cross‑department info distribution.

Default behaviour:

* Broadcast‑labeled items do **not** create Tasks.
* If a policy or safety pattern needs follow‑up, workflows explicitly create Tasks or Cases from those broadcasts.

### 8.7.5 Rule 4 – Role‑Driven Collaboration

Horizontal handoffs are expressed via labels and routing rules:

* e.g. HR onboarding Case/Task leads to IT setup Task:

  ```text
  11.51.HR.Recruitment   →   11.11.IT.Support
  ```

Domain modules for HR and IT plug into the same Task engine and label semantics; they do not own separate task tables or lifecycles.

### 8.7.6 Rule 5 – Categorization‑Based Handling

Subcategories (`.1`–`.5`) drive default handling patterns:

* `.1` **Requests** – flow upward or laterally for approval/action; typically spawn Tasks.
* `.2` **Updates** – flow horizontally/downward for awareness; usually do **not** create Tasks unless configured.
* `.3` **Decisions** – flow downward once approvals/rejections are made.
* `.4` **Reports** – flow upward into cyclic overview and analytics.
* `.5` **Distribution** – pure broadcasts; no Tasks unless explicitly configured.

Workflow rules in Doc 3/5 encode the actual behaviour per organization and domain.

---

## 8.8 Implementation & Cross‑Document Rules

### 8.8.1 JSON vs DB Naming

* DB primary keys: typically `id`; API/JSON must expose them as `task_id` / `case_id`. 
* DB enums: stored as canonical uppercase (`PENDING`, `ANONYMISED`); JSON may use either uppercase or lower‑case; mapping is 1:1 and enforced on input.

### 8.8.2 State Enforcement

* Task Handler (`task_handler`) and domain handlers must enforce the Task state machine in §8.5.2 / Doc 5 and reject invalid transitions.
* Any service that updates `cases.status` must enforce §8.5.1 and log state changes in `activity_logs` / `task_events`.

### 8.8.3 Broadcast Handling

* Domain modules must treat broadcast labels as non‑actionable unless a rule explicitly sets `auto_create_tasks: true` (or equivalent) for that pattern.
* Reasons for exceptions (e.g. mandated safety drills) should be documented in domain configs.

### 8.8.4 Cyclic Reviews as Work

* Cyclic overview jobs must create **real Cases and Tasks** (e.g. audits, systemic reviews) for patterns, not merely dashboards.
* These Cases use labels such as:

  * `11.94.Operations.Safety.Audit` – departmental safety audit.
  * `2.94.Leadership.Safety.Review` – leadership‑level safety review.

These Cases then follow the same Case/Task lifecycles and visibility rules as any other work.

---

## 8.9 Scope Cleanup – Replacement of “Site Navigation Map”

Earlier drafts used “site navigation map” as the title and mixed UI navigation content into this document.

For Orgo v3:

* **Doc 8 is purely back‑end/process level**:

  * Labeling semantics.
  * Case/Task JSON contracts.
  * Status lifecycles and transitions.
  * Cyclic overview and pattern semantics.

* Any UI or navigation diagrams must live in separate Interface/UX documentation and reference this document only for data and flow semantics. 

This version supersedes all previous “Doc 8” drafts and is the integral, updated specification for labels, JSON contracts, and cyclic overview in Orgo v3.
