## What is Orgo?

Orgo is a multi‑tenant “nervous system” for organizations.

It:

* **Ingests signals** from email, APIs, UIs and offline imports
* **Normalizes them into Cases and Tasks** with a strict, shared schema
* **Routes work to the right roles** using a structured label system
* **Tracks execution and escalation** across any domain (maintenance, HR, education, NGOs, etc.)
* **Continuously scans for patterns and risks** through an Insights module and cyclic reviews

The goal is a single, schema‑driven backbone that different organizations and domains can “plug into” without each reinventing ticketing, routing, and oversight.

---

## Core concepts

### Multi‑tenant backbone

Orgo is built for many organizations on one install:

* **Organizations (tenants)** with `organization_id`, profile, timezone, etc.
* **User accounts** (who logs in) vs **Person profiles** (who the work is *about* – students, employees, players, residents, etc.).
* **Roles and permissions** for RBAC.

Everything – emails, tasks, cases, analytics – is scoped by `organization_id`.

---

### Signals → Cases & Tasks

Orgo’s job is to capture messy real‑world signals and turn them into structured work.

**Signals in:**

* **Email**: via IMAP/SMTP into `email_messages` + threads, with attachments, flags, spam/sensitivity hints.
* **APIs / UIs**: REST endpoints and internal UIs that call into `create_task` / case creation.
* **Offline imports / sync**: e.g. PST/mbox imports, offline nodes syncing via SQLite.

Signals go through the **workflow engine** and **email gateway**, which decide:

* Do we open a **Case**?
* Do we create a **Task**?
* For which **domain** (maintenance, HR, education, etc.) and which **role**?

**Task = central unit of work**

* Global schema: `type` (domain), `category` (request / incident / update / report / distribution), subtype, `priority`, `severity`, `visibility`, `label`, assignee, due dates, escalation level, metadata, etc.
* Canonical lifecycle (simplified):
  `PENDING → IN_PROGRESS → ON_HOLD / COMPLETED / FAILED / ESCALATED / CANCELLED`.

**Case = long‑lived container**

* Groups tasks, tags, severity, location, participants, and related signals.
* Used for incidents, themes, investigations, audits, etc.
* Participates in weekly / monthly / yearly review cycles.

---

### Label system (how Orgo routes and contextualizes)

Orgo uses a structured “label” to encode **where** in the organization something lives and **what kind of information** it is:

```text
<base>.<category><subcategory>.<horizontal_role?>
```

Example: `100.94.Operations.Safety`

* `100`  → broadcast level (e.g. department heads)
* `.9`   → Crisis & emergency information
* `.4`   → Report
* `Operations.Safety` → horizontal role / functional area

The label drives:

* **Routing** – which queue / role receives the work
* **Visibility** – how sensitive it is by default
* **Analytics** – how incidents and patterns are grouped

Special bases like `10 / 100 / 1000` are **broadcast levels**: they are informational by default (no auto‑tasks) unless a workflow rule explicitly says “create work from this broadcast”.

---

### Domain modules: one engine, many domains

Domains (maintenance, HR, education, etc.) do **not** get their own task tables or lifecycles. They plug into a shared engine:

* **Config** (`<domain>_module.yaml`):

  * Which task categories the domain uses
  * Domain‑specific subtypes
  * Email patterns and routing hints
* **Handler module** (`<domain>_handler.py`):

  * Hooks like `on_task_create`, `on_task_update` for domain‑specific behavior

“Maintenance”, “HR”, “Education”, etc. all share the same Case/Task core and differ only via metadata + rules.

---

### Profiles: tuning Orgo to “type of organization”

A **Profile** describes how “intense” or “formal” an organization is (friend group vs hospital vs NGO vs retail chain). Per profile you can configure:

* **Reactivity & escalation timings**
* **Transparency model** (full / balanced / restricted / private)
* **Review cadence** (real‑time, weekly, monthly, yearly)
* **Notification scope** (assignee / team / department / org‑wide)
* **Pattern sensitivity** and time windows
* **Severity policy** (which severities escalate immediately)
* **Logging depth & retention**
* **Automation level** (manual to fully automated)

The same codebase can therefore behave like:

* A lightweight coordinator for a small group
* A high‑stakes incident system for a hospital
* A compliance‑heavy tracker for an NGO
* An ops platform for a multi‑site retail chain

without changing schemas or services – only configuration.

---

### Insights & cyclic overview

On top of the operational database, Orgo has an **Insights** layer:

* Star schema (`insights.dim_*`, `insights.fact_*`) for tasks, cases, persons, groups, wellbeing check‑ins, etc.
* ETL / DAGs to hydrate analytics tables.
* Reporting API + caching for dashboards and exports.

The **cyclic overview** system then:

* Reviews cases/tasks on **weekly / monthly / yearly** cycles
* Applies thresholds like “N similar incidents in X days” to open new **audit/review Cases**
* Surfaces patterns (recurring safety issues, repeated harassment in one team, drops in wellbeing scores) as *work items*, not just charts

Patterns and systemic risks get turned back into Cases and Tasks, closing the loop between operations and oversight.

---

### Guardrails: visibility, audit, compliance

Orgo is designed to be safe for sensitive domains (e.g. hospitals, HR) by default:

* **Visibility enum** (e.g. `PUBLIC`, `INTERNAL`, `RESTRICTED`, `ANONYMISED`) on Cases/Tasks drives who can see what, and what can be exported.
* **Logging** is normalized into categories (workflow, task, system, security, email) with per‑profile retention policies.
* **Security events & audit logs** cover sensitive changes and exports, with PII masking enforced in the Insights layer based on visibility rules.

---

### What Orgo is *not*

Orgo is **not**:

* A generic CRM / ERP / accounting system
* A simple kanban board or to‑do app

It is:

* A **unified, schema‑driven case & task platform** that many org types plug into
* With strong emphasis on **routing, escalation, and pattern detection over time**, across domains and organizations.
