Below is the current, integral, and cross‑doc‑aligned **Document 3/8 – Domain Modules (Orgo v3)**.
You can drop this in as the full contents of `3-orgo-full-stack-technical-spec.md`.

---

## 3/8 – Domain Modules (Orgo v3)

**Scope**

This document defines how each **domain module** (maintenance, HR, education, etc.) is structured, configured, and integrated with the **central task handler** and the **multi‑tenant backbone**.

Domain modules are **thin adapters** over the core Orgo platform:

* They do **not** own a task lifecycle.
* They do **not** maintain their own task tables.
* They **wrap** the canonical **Task** (and optionally **Case**) model with domain‑specific configuration, validation, and field mapping.
* They use the shared **label system** and **broadcast semantics** from Doc 8 for routing and visibility. 

Routing, lifecycle, escalation, and pattern detection always flow through:

* Core task handler – Doc 5 (`task_handler` service). 
* Workflow engine – Doc 5 (`workflow_engine` service). 
* Canonical Task/Case models and enums – Docs 1–2 and Doc 8.

This doc **supersedes** earlier informal notes on domain modules (e.g. Doc 2 §4 directory sketch). Where there is conflict, **Doc 3 wins** for module layout and handler contracts. 

---

## 0. Canonical Concepts (Shared with Other Docs)

Domain modules are not allowed to redefine global concepts. They must re‑use:

* The **canonical Task model** (DB + JSON).
* The **canonical Case model** (where needed).
* Global enums for **status, priority, severity, visibility**.
* The **labeling system** (vertical/horizontal axes, broadcast bases).

### 0.1 Global Task Model (Summary)

Canonical Task fields (logical view) are defined in Doc 1 §3.1 and Doc 2 §1.7.

Key fields (simplified):

* `task_id`: UUID (DB: `tasks.id`)
* `organization_id`: UUID – tenant / org isolation key
* `case_id`: UUID | null – optional link to a `Case`
* `type`: string – domain identifier, e.g. `"maintenance"`, `"hr_case"`, `"education_support"`, `"it_support"`, `"operations"`, `"generic"`
* `category`: string – global enum: `"request" | "incident" | "update" | "report" | "distribution"`
* `subtype`: string | null – domain‑specific label (e.g. `"plumbing"`, `"harassment"`, `"attendance"`)
* `label`: string – canonical information label `<base>.<category><subcategory>.<horizontal_role>`
* `status`: `TASK_STATUS` enum – `PENDING | IN_PROGRESS | ON_HOLD | COMPLETED | FAILED | ESCALATED | CANCELLED`
* `priority`: `TASK_PRIORITY` enum – `LOW | MEDIUM | HIGH | CRITICAL`
* `severity`: `TASK_SEVERITY` enum – `MINOR | MODERATE | MAJOR | CRITICAL`
* `visibility`: `VISIBILITY` enum – `PUBLIC | INTERNAL | RESTRICTED | ANONYMISED`
* `due_at`, `reactivity_time`, `escalation_level`
* `assignee_role`, `assignee_user_id` (plus `task_assignments` table for history)
* `metadata`: JSONB – domain‑specific, must **not duplicate** core fields

**Important alignment points for domain modules:**

* `organization_id` is the canonical multi‑tenant key (not `tenant_id`).
* `subtype` is a first‑class column in `tasks.subtype` and must hold the **domain subtype** used in configs (not just `metadata["domain_subtype"]`).
* `visibility` must be one of `PUBLIC/INTERNAL/RESTRICTED/ANONYMISED` (DB) and may be lower‑case equivalents in JSON/YAML. 

### 0.2 Cases and Labels (Context Only)

* **Case** is a long‑lived container that groups Tasks, patterns, and context. Cases use the same label and severity model as Tasks.
* `cases.label` and `tasks.label` hold the **canonical information label** `<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE>`.
* Classification tags (e.g. `self_harm_risk`, `equipment_failure`) are separate – `label_definitions` + `entity_labels`. 

Domain modules may **read** and **suggest** labels and tags, but they **do not change** the underlying label system; this is defined centrally in Doc 8. 

### 0.3 Domain Modules vs DomainTasks

* A **Domain Module** is a bundle of:

  * One YAML config file.
  * One handler module (`<domain>_handler.*`) with a fixed function interface.
  * Optional templates and helpers.

* A **DomainTask** is a **projection** of a canonical `Task` for a given domain:

  * DomainTask has no table.
  * It is constructed from `Task` (+ assignments + classification labels).
  * It may expose computed/curated fields for UI.
  * All writes flow back to the canonical `Task` model via the core task handler.

---

## 1. Domain Module Directory Layout

All domain modules live under a single root:

```text
domain_modules/
  maintenance/
    maintenance_module.yaml
    maintenance_handler.py
    templates/
      ...
  hr/
    hr_module.yaml
    hr_handler.py
    templates/
      ...
  education/
    education_module.yaml
    education_handler.py
    templates/
      ...
```

Constraints:

* Directory name = **domain name** and must match `Task.type`.
  Example: directory `domain_modules/maintenance/` ↔ `Task.type = "maintenance"`.

* Each domain has **exactly one** main config and one main handler:

  * `<domain>_module.yaml`
  * `<domain>_handler.py`

* Optional assets (`templates/`, additional YAML files) are referenced **via the main config** (no extra implicit conventions).

---

## 2. Domain Module Config Spec (`<domain>_module.yaml`)

Each domain module has one canonical config loaded by `core_services/config_loader`. Config values must respect enums and conventions from Docs 1–2 and Doc 5.

### 2.1 Top‑Level Structure

Minimum canonical structure:

```yaml
domain: "maintenance"            # must match directory name and Task.type
version: "3.0.0"                 # semantic version of the module
enabled: true                    # if false, module is ignored

allowed_categories:              # global Task.category values
  - "request"
  - "incident"
default_category: "request"      # must be in allowed_categories

allowed_subtypes:                # domain-specific Task.subtype values
  - "ticket"
  - "inspection"

default_visibility: "internal"   # maps to VISIBILITY.INTERNAL
allowed_visibility:
  - "internal"
  - "restricted"                 # subset of {public, internal, restricted, anonymised}

email_patterns:                  # how emails are mapped (see 2.4)
  from_addresses:
    - "maintenance@tenant.example"
  to_addresses:
    - "maintenance@tenant.example"
  subject_keywords:
    - "[MAINT]"
    - "maintenance"
    - "repair"
  body_keywords:
    - "leak"
    - "broken"
    - "malfunction"

routing_rules:                   # domain-specific routing hints (passed to workflows)
  default_assignee_group: "maintenance_team"
  escalation_group: "maintenance_leads"
```

Validation invariants:

* `domain` = directory name and will be used as `Task.type`.
* `allowed_categories` ⊆ global enum `{request, incident, update, report, distribution}`.
* `default_category ∈ allowed_categories`.
* `default_visibility ∈ allowed_visibility ⊆ {public, internal, restricted, anonymised}`.
* Visibility values are in **JSON/Config form** (lowercase), but must map to DB enum `VISIBILITY`. 

### 2.2 Category vs Type vs Subtype (Alignment)

To eliminate ambiguity:

* `Task.type` = **domain identifier** (e.g. `"maintenance"`, `"hr_case"`, `"education_support"`).
* `Task.category` = **global category** (`"request"`, `"incident"`, `"update"`, `"report"`, `"distribution"`).
* `Task.subtype` = **domain‑specific label** (e.g. `"ticket"`, `"inspection"`, `"harassment"`, `"attendance"`).

Therefore:

* The old config key `allowed_types` is **removed** in v3.
* Domain modules must use:

  * `allowed_categories`: allowed values for `Task.category`.
  * `allowed_subtypes`: allowed values for `Task.subtype`.

Mapping to DB and JSON:

* `category` → `tasks.category` (enum) and Task JSON `category`.
* `subtype` → `tasks.subtype` (TEXT) and Task JSON `subtype`.
* Domain‑specific extra flags stay in `tasks.metadata`.

Example (Maintenance):

```yaml
domain: "maintenance"
allowed_categories:
  - "request"
  - "incident"
default_category: "request"
allowed_subtypes:
  - "ticket"
  - "inspection"
```

A “maintenance ticket” with category `request`:

* `task.type = "maintenance"`
* `task.category = "request"`
* `task.subtype = "ticket"`

Domain modules must **not** redefine category semantics via subtypes.

### 2.3 Subtype Semantics (`allowed_subtypes`)

`allowed_subtypes` is purely **domain‑local**:

* Validation:

  * Loader ensures uniqueness and that configured subtypes are strings.
  * No global enum is enforced; they live in `tasks.subtype`.

* Storage:

  * On creation, if a subtype is chosen it must be:

    * `payload.subtype ∈ allowed_subtypes` (or `None`).

* Usage:

  * Filters in domain UIs (e.g. “show only `inspection`”).
  * Domain routing/handling logic in `<domain>_handler`.
  * Domain‑scoped reports (via Insights star schema).

### 2.4 Email Mapping (`email_patterns`)

`email_patterns` describes how incoming email is matched to a domain:

```yaml
email_patterns:
  from_addresses:
    - "maintenance@tenant.example"
  to_addresses:
    - "maintenance@tenant.example"
  cc_addresses:
    - "maintenance-cc@tenant.example"
  subject_keywords:
    - "[MAINT]"
    - "maintenance"
    - "repair"
  body_keywords:
    - "leak"
    - "broken"
    - "malfunction"
```

Resolution (high‑level):

1. `to`/`cc` matches domain addresses → direct match.
2. Else if subject contains any `subject_keywords` → probable match.
3. Else if body contains `body_keywords` → fallback match.
4. If multiple domains match, the core handler resolves based on workflow rules and priorities (Doc 5 + Doc 2).

The mapping logic lives in the **Email Gateway + Workflow Engine**; domain modules only supply configuration.

### 2.5 Labels & Broadcast Semantics

Domain modules must respect the global **label system** and **broadcast bases** from Doc 8. 

Key points:

* `Task.label` and `Case.label` hold the canonical label like `100.94.Operations.Safety`.

* Vertical base (`10`, `100`, `1000`) indicates broadcast scope:

  * `10.x`: executive broadcast.
  * `100.x`: department‑head broadcast.
  * `1000.x`: staff‑level broadcast.

* Broadcast labels are **non‑actionable by default**:

  * They must **not** automatically create Tasks.
  * They exist for information and alignment.

Domain modules:

* May define **label‑aware rules** (typically in workflow configs, not in the module YAML) such as:

  ```yaml
  - match_label_base: 1000
    category: 9
    subcategory: 5
    auto_create_tasks: false
  ```

* Must treat broadcast‑labeled items as informational unless an explicit workflow rule enables `auto_create_tasks: true` and that behaviour is documented for the domain.

This constraint is normative: domain modules **must not** override global broadcast semantics in ad‑hoc code.

---

## 3. DomainTask Model and Mapping to Task

`DomainTask` is a view‑layer construct used by domain APIs and UIs.

### 3.1 Shape of DomainTask

Python‑style sketch:

```python
@dataclass
class DomainTask:
    task_id: UUID
    organization_id: UUID

    domain: str            # == Task.type
    category: str          # == Task.category (global)
    subtype: str | None    # == Task.subtype (domain-local)

    label: str             # == Task.label (canonical label code)

    status: str            # == Task.status
    visibility: str        # == Task.visibility

    title: str             # == Task.title
    description: str       # == Task.description

    case_id: UUID | None   # == Task.case_id

    created_at: datetime
    updated_at: datetime

    assignee_user_ids: list[UUID]   # from TaskAssignment history
    assignee_roles: list[str]       # e.g. ["Ops.Maintenance"]

    classification_labels: list[str]  # codes from label_definitions/entity_labels
    metadata: dict[str, Any]          # curated subset of Task.metadata for this domain
```

Constraints:

* `domain == Task.type`
* `category == Task.category`
* `subtype == Task.subtype`
* `label == Task.label`
* `status == Task.status` (global enum)
* `visibility == Task.visibility` (global enum)

DomainTask is **read‑only** with respect to the DB; updates must go through the core task handler APIs.

### 3.2 Construction Rules

Given a `Task` row (plus assignments and labels):

1. `organization_id = task.organization_id`
2. `domain = task.type`
3. `category = task.category`
4. `subtype = task.subtype`
5. `label = task.label`
6. `status = task.status`
7. `visibility = task.visibility`
8. `title = task.title`
9. `description = task.description`
10. `case_id = task.case_id`
11. `assignee_user_ids` and `assignee_roles` derived from `task_assignments` + `assignee_role`/`assignee_user_id`. 
12. `classification_labels` from `entity_labels` for that task. 
13. `metadata` = curated view returned by `get_domain_fields` (handler).

Domain modules **never** talk directly to the DB; they work through the domain API and core services defined in Doc 5. 

---

## 4. Domain Handler Interface (`<domain>_handler.py`)

Each domain module exports a handler implementing the following interface. The core task handler calls these hooks at specific points in the Task lifecycle.

### 4.1 Required Functions

```python
# <domain>_handler.py

from core_services.domain_api import DomainContext, DomainTaskInput, DomainTaskUpdate

def on_task_create(ctx: DomainContext, payload: DomainTaskInput) -> DomainTaskInput:
    """
    Called before a new Task is persisted for this domain.
    Responsibilities:
      - Enforce Task.type (domain).
      - Validate/normalize category and subtype.
      - Apply default visibility and metadata defaults.
    Must not write to the DB directly.
    Returns the payload that the core task handler will persist.
    """

def on_task_created(ctx: DomainContext, domain_task_id: str) -> None:
    """
    Called after the Task has been created and committed.
    Used for domain-specific notifications, logging, or webhooks.
    """

def on_task_update(ctx: DomainContext, payload: DomainTaskUpdate) -> DomainTaskUpdate:
    """
    Called before Task updates are persisted.
    Can enforce domain rules on category/subtype/visibility/metadata.
    Returns the updated payload.
    """

def on_task_updated(ctx: DomainContext, domain_task_id: str) -> None:
    """
    Called after updates are committed.
    Used for follow-up actions (e.g. notify on ESCALATED or COMPLETED).
    """

def get_domain_fields(ctx: DomainContext, task_id: str) -> dict:
    """
    Returns a domain-centric view of Task.metadata (plus some core fields)
    for UI/API use, e.g. location, asset_id, person references.
    """
```

`DomainContext` provides:

* `organization_id`
* Domain config (parsed `<domain>_module.yaml`)
* Repository/Service interfaces for Tasks, Cases, and labels
* Logger, clock, and profile information (Org’s behaviour profile for reactivity, transparency, etc.).

The central `task_handler`:

* Controls DB transactions.
* Calls these hooks inside transactions where appropriate.
* Enforces global invariants (enums, visibility rules, label semantics).

### 4.2 Optional Functions

Standard optional functions:

```python
def suggest_category_and_subtype(ctx: DomainContext, email_payload: dict) -> tuple[str, str | None]:
    """
    Given a parsed email, suggest (category, subtype).
    - category must be in config.allowed_categories
    - subtype must be in config.allowed_subtypes or None
    Used by the email gateway + workflow engine.
    """

def get_domain_filters(ctx: DomainContext) -> dict:
    """
    Returns domain-specific filter metadata for UI:
      - available subtypes
      - common labels or classification tags
      - suggested saved searches
    """
```

---

## 5. Domain Module Lifecycle

This section describes how domain modules are discovered and used across the stack.

### 5.1 Module Discovery

On startup, `config_loader`:

1. Scans `domain_modules/`.

2. For each directory containing `<domain>_module.yaml` and `<domain>_handler.py`:

   * Loads and validates YAML (using global config validation). 
   * Imports the handler module.
   * Registers the module in an in‑memory `DomainRegistry`.

3. If `enabled: false`, the module is skipped.

### 5.2 Email → DomainTask Creation Flow

1. Email Gateway ingests email → `email_messages` row is created (Doc 1).

2. Workflow engine evaluates rules, including domain `email_patterns`.

3. If a domain matches:

   * Core builds a `DomainTaskInput`:

     * `type = <domain>`
     * `category = default_category` (override via `suggest_category_and_subtype`)
     * `subtype` from suggestion if valid.
     * `visibility` initially unset.
     * `metadata` including email linkage.

4. Core calls `on_task_create(domain_handler, ctx, payload)`.

5. Central `task_handler` persists the new `Task` and links it to the email/thread and, if configured, to a `Case`.

6. After commit, core calls `on_task_created`.

### 5.3 API / UI Listing Flow

Example endpoint: `GET /domain/<domain>/tasks`

1. API validates `<domain>` exists in `DomainRegistry`.

2. Queries `tasks` with:

   * `tasks.type = <domain>`
   * `tasks.organization_id = <current org>`
   * Visibility filters based on `VISIBILITY` and RBAC.

3. For each Task:

   * Builds a `DomainTask` view.
   * Augments with `get_domain_fields`.

4. Frontend filters by:

   * `category` (global),
   * `subtype` (domain),
   * `status`, `priority`, `severity`,
   * `label` (canonical) and classification tags,
   * assignee, date ranges, org profile‑driven “hot” filters.

### 5.4 Status, Visibility, Profiles

* Status transitions:

  * Must follow the global Task state machine (Doc 8 §8.5.2). 
  * Domain modules may **restrict** transitions but cannot introduce new states.

* Visibility:

  * Domain handler may set a default `visibility` within the allowed subset.
  * Global rules (e.g. HR confidentiality, org profile transparency) are enforced by core services.

* Profiles:

  * Reactivity, escalation timing, logging depth, and pattern sensitivity are determined primarily by the org’s **profile** (Doc 7/Profile configs) and global parameters (Doc 2 + Doc 6). Domain modules provide hints (e.g. “HR incidents are usually `high` severity”), but do not hard‑code SLA logic.

### 5.5 Case Linkage (Optional)

Some domains (especially HR and compliance) treat Cases as primary:

* HR module may create or attach to an `HrCase` (Doc 1 Module 11) when certain subtypes appear (e.g. `harassment`). 
* Domain handler itself does **not** write to `hr_cases` or `cases` directly; it triggers workflows that create/link Cases using core services.

General rule:

* **Tasks first** – domain modules always produce Tasks.
* **Cases via workflows** – Case creation/linkage is orchestrated by workflows and core services, using domain metadata and labels.

---

## 6. Worked Example – Maintenance Module

### 6.1 Config (`domain_modules/maintenance/maintenance_module.yaml`)

```yaml
domain: "maintenance"
version: "3.0.0"
enabled: true

allowed_categories:
  - "request"
  - "incident"
default_category: "request"

allowed_subtypes:
  - "ticket"
  - "inspection"

default_visibility: "internal"
allowed_visibility:
  - "internal"
  - "restricted"

email_patterns:
  from_addresses:
    - "maintenance@tenant.example"
  to_addresses:
    - "maintenance@tenant.example"
  subject_keywords:
    - "[MAINT]"
    - "maintenance"
    - "repair"
  body_keywords:
    - "leak"
    - "broken"
    - "malfunction"

routing_rules:
  default_assignee_group: "maintenance_team"
  escalation_group: "maintenance_leads"
```

Behaviour:

* All Maintenance tasks have:

  * `Task.type = "maintenance"`.
  * `Task.category ∈ {"request","incident"}`.
  * `Task.subtype ∈ {"ticket","inspection"} or null`.

* Defaults:

  * If no category → `request`.
  * If subtype missing or invalid → normalized to `"ticket"` or left `null` per policy.
  * Visibility defaults to `"internal"` (INTERNAL), may be raised to `"restricted"` by rules.

### 6.2 Handler Outline (`maintenance_handler.py`)

```python
from core_services.domain_api import DomainContext, DomainTaskInput, DomainTaskUpdate

ALLOWED_CATEGORIES = {"request", "incident"}
ALLOWED_SUBTYPES = {"ticket", "inspection"}

def on_task_create(ctx: DomainContext, payload: DomainTaskInput) -> DomainTaskInput:
    # Enforce domain
    payload.type = "maintenance"

    # Category normalization
    if payload.category not in ALLOWED_CATEGORIES:
        payload.category = ctx.config.default_category  # "request"

    # Subtype normalization
    if payload.subtype is not None and payload.subtype not in ALLOWED_SUBTYPES:
        payload.subtype = "ticket"

    # Default visibility
    if payload.visibility is None:
        payload.visibility = ctx.config.default_visibility  # "internal"

    return payload

def on_task_created(ctx: DomainContext, domain_task_id: str) -> None:
    # Notify maintenance_team defined in routing_rules
    ...

def on_task_update(ctx: DomainContext, payload: DomainTaskUpdate) -> DomainTaskUpdate:
    # Prevent illegal category changes
    if payload.category is not None and payload.category not in ALLOWED_CATEGORIES:
        raise ValueError("Invalid category for maintenance domain")
    # Subtype change validation
    if payload.subtype is not None and payload.subtype not in ALLOWED_SUBTYPES:
        raise ValueError("Invalid subtype for maintenance domain")
    return payload

def on_task_updated(ctx: DomainContext, domain_task_id: str) -> None:
    # Example: notify escalation_group on ESCALATED status
    ...

def get_domain_fields(ctx: DomainContext, task_id: str) -> dict:
    task = ctx.tasks_repo.get(task_id)
    return {
        "subtype": task.subtype,
        "location": task.metadata.get("location"),
        "asset_id": task.metadata.get("asset_id"),
    }
```

---

## 7. Worked Example – HR Module (Outline)

### 7.1 Config (`domain_modules/hr/hr_module.yaml`)

```yaml
domain: "hr_case"
version: "3.0.0"
enabled: true

allowed_categories:
  - "request"
  - "update"
  - "report"
default_category: "request"

allowed_subtypes:
  - "onboarding"
  - "offboarding"
  - "harassment"
  - "policy_question"

default_visibility: "restricted"
allowed_visibility:
  - "restricted"
  - "anonymised"

email_patterns:
  to_addresses:
    - "hr@tenant.example"
  subject_keywords:
    - "onboarding"
    - "offboarding"
    - "harassment"
    - "benefits"

routing_rules:
  default_assignee_group: "hr_officers"
  escalation_group: "hr_leadership"
```

Behaviour:

* `Task.type` for HR module = `"hr_case"`.
* Only `request`, `update`, `report` categories allowed.
* Subtypes: `"onboarding"`, `"offboarding"`, `"harassment"`, `"policy_question"`.
* Default visibility: `"restricted"` (RESTRICTED). Harassment‑related items may be auto‑upgraded to `"anonymised"` via handler logic and/or profiles.

### 7.2 Handler Sketch

```python
def on_task_create(ctx: DomainContext, payload: DomainTaskInput) -> DomainTaskInput:
    payload.type = "hr_case"

    if payload.category not in ctx.config.allowed_categories:
        payload.category = ctx.config.default_category  # "request"

    if payload.subtype not in ctx.config.allowed_subtypes:
        payload.subtype = "policy_question"

    # Harassment → anonymised visibility
    if payload.subtype == "harassment":
        payload.visibility = "anonymised"
    elif payload.visibility is None:
        payload.visibility = ctx.config.default_visibility  # "restricted"

    return payload

def get_domain_fields(ctx: DomainContext, task_id: str) -> dict:
    task = ctx.tasks_repo.get(task_id)
    return {
        "subtype": task.subtype,
        "employee_id": task.metadata.get("employee_id"),
        "reported_by_person_id": task.metadata.get("reported_by_person_id"),
        "target_person_id": task.metadata.get("target_person_id"),
    }
```

HR workflows may also:

* Trigger or link to `HrCase` rows (Doc 1 Module 11) based on subtype/label. 
* Use broadcast labels only for high‑level updates, not for work creation.

---

## 8. Checklist for Domain Modules (Doc 3 Compliance)

For **each** domain module, the following must hold:

* [ ] Directory `domain_modules/<domain>/` exists; `<domain>` matches `Task.type`.

* [ ] `<domain>_module.yaml`:

  * [ ] `domain` field = directory name.
  * [ ] `allowed_categories` ⊆ `{request, incident, update, report, distribution}`.
  * [ ] `default_category ∈ allowed_categories`.
  * [ ] `allowed_subtypes` present (may be empty) and used as `Task.subtype` values.
  * [ ] `default_visibility` and `allowed_visibility` ⊆ `{public, internal, restricted, anonymised}` and align with org profile constraints.
  * [ ] `email_patterns` defined if the domain handles email.
  * [ ] No redefinition of global enums (TASK_STATUS, TASK_PRIORITY, TASK_SEVERITY, VISIBILITY, CASE_STATUS).

* [ ] `<domain>_handler.py`:

  * [ ] Implements required functions: `on_task_create`, `on_task_created`, `on_task_update`, `on_task_updated`, `get_domain_fields`.
  * [ ] Uses Only canonical Task/Case fields and enums.
  * [ ] Reads/writes `subtype` via `Task.subtype` (not hidden metadata).
  * [ ] Does not bypass visibility rules; only suggests defaults within allowed range.
  * [ ] Does not directly manipulate DB; uses core services.

* [ ] Broadcast labels:

  * [ ] Domain‑specific behaviour for broadcast bases (10/100/1000) is configured in workflow rules, not ad‑hoc code.
  * [ ] Broadcast‑labeled items are non‑actionable unless a documented rule explicitly enables `auto_create_tasks: true`.

* [ ] Multi‑tenancy:

  * [ ] All queries/operations are scoped by `organization_id` as provided in `DomainContext`.

This version of **Doc 3 – Domain Modules (Orgo v3)** is aligned with:

* Canonical DB schema (Doc 1),
* Global enums and Task/Case models (Doc 2),
* Core Services (Doc 5),
* Labeling + broadcast semantics and state machines (Doc 8),
* Profiles and Insights behaviour (Docs 6–7 and profile configs).
