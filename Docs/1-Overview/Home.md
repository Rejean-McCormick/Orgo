# Orgo System Overview

This document provides a conceptual and technical map of the Orgo platform. It details how the system functions as a multi-tenant "nervous system" for organizations, distinct from standard ticketing systems or CRMs.

**Reference:** [[Orgo Overview Presentation](https://administrative-efficienc-0u6vhrh.gamma.site/)](https://administrative-efficienc-0u6vhrh.gamma.site/)

-----

## Conceptual Model

Orgo is designed to solve the "messy signal" problem. Organizations receive inputs from dozens of channels (emails, chats, forms, sensors), often losing context or failing to spot patterns.

Orgo standardizes this flow:

1.  **Listen:** Ingest signals from any source.
2.  **Structure:** Convert signals into **Cases** (situations) and **Tasks** (actions).
3.  **Route:** Assign work using a universal labeling syntax.
4.  **Track:** Monitor execution against "Reactivity Time" (not just deadlines).
5.  **Learn:** Feed data into an **Insights** layer for cyclic review and pattern detection.

Instead of hard-coding workflows for every department, Orgo provides a shared schema engine. A "Hospital" and a "Basketball Team" run on the same code, differentiated only by their **Profile** configuration.

-----

## Core Entities

The system is strictly multi-tenant.

  * **Organization:** The top-level tenant (e.g., "Acme Corp" or "Local Shelter"). It owns all data, configuration, and policies.
  * **User:** An authenticated account (staff, volunteer, admin) capable of logging in and performing work.
  * **Person:** A profile representing a human subject (student, patient, employee). A Person is often the *subject* of a Case but may never log in.

-----

## The Workflow Pipeline: Signals → Cases → Tasks

### 1\. Signals

Inputs enter the system via the **Gateway**.

  * **Email:** Parsed via IMAP/SMTP (stripping signatures, normalizing threads).
  * **API:** Direct POST requests from external tools.
  * **Offline:** Batched imports from local nodes (supporting the "Offline Bubble" requirement).

### 2\. The Engine

The Workflow Engine evaluates the Signal against **Flow Rules**. It determines:

  * Does this require a new **Case**?
  * Does this spawn specific **Tasks**?
  * What is the **Label** (routing address)?
  * What is the **Severity** and **Reactivity Time**?

### 3\. Objects

  * **Case:** A container for a specific situation (e.g., "Water Leak in Sector 7" or "Harassment Complaint \#99"). It holds the narrative, location, tags, and aggregate status.
  * **Task:** An atomic unit of work linked to a Case. It follows a strict state machine (`pending` → `in_progress` → `completed`).

-----

## Routing System: The Label

Orgo uses a deterministic labeling system to route information. A label is a single string that encodes **Scope**, **Topic**, **Intent**, and **Role**.

**Format:** `<BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE>`

### The Base (Vertical Scope)

Defines *who* needs to see this.

  * `1` - CEO / Executive
  * `11` - Department Head
  * `101` - Team Lead
  * `1001` - Staff / Operative
  * *(Broadcast variants: `10`, `100`, `1000`)*

### The Taxonomy (Decimal)

  * **Category (1st digit):** The domain (e.g., `9` = Crisis, `5` = Training, `1` = Ops).
  * **Subcategory (2nd digit):** The intent (e.g., `1` = Request, `4` = Report, `5` = Broadcast).

### Example

> **`1001.91.Operations.Safety`**
>
>   * **1001:** Staff level.
>   * **9:** Crisis/Emergency category.
>   * **1:** Request (Action required).
>   * **Operations.Safety:** The functional team responsible.

-----

## Profiles & Configuration

Orgo avoids custom code for every client by using **Profiles**. A Profile is a bundle of YAML configuration parameters that dictates system behavior.

**Configurable Knobs:**

  * **Reactivity Windows:** Does "High Priority" mean 1 hour (Hospital) or 3 days (Volunteer Group)?
  * **Privacy:** Default visibility (Open-by-default vs. Need-to-know).
  * **Escalation:** How quickly does an ignored task jump to the next vertical level?
  * **Retention:** Log storage duration.

**Standard Profiles:**

1.  **Friend Group:** Low automation, high privacy, slow reactivity.
2.  **Retail Ops:** High automation, open visibility, fast reactivity.
3.  **Crisis Response:** Maximum reactivity, strict hierarchy, aggressive escalation.

-----

## Technical Architecture

The codebase is organized into four distinct layers.

### 1\. Core Services

The monolithic engine that powers the platform.

  * `TaskHandler`: Enforces state machines and SLA tracking.
  * `WorkflowEngine`: Matches signals to rules.
  * `Notifier`: Handles outbound communication (Email, Push).
  * `Logger`: Centralized, normalized audit logging.

### 2\. Domain Modules

Thin adapters that define domain-specific logic without owning separate databases.

  * **Maintenance:** Defines assets, locations, and repair workflows.
  * **Care/HR:** Defines personnel, privacy rules, and intake flows.
  * **Groups:** Defines classes, rosters, and schedules.

### 3\. Insights Module

The analytical brain. It uses a Star Schema (`fact_cases`, `dim_time`, `dim_location`) to answer questions like "Which department creates the most critical alerts?"

### 4\. Infrastructure

Handles the "plumbing": Database connections (Postgres/SQLite), offline synchronization logic, and Docker containerization.

-----

## Data Contracts

Orgo enforces strict JSON schemas for its primary objects to ensure interoperability between modules.

**The Case Contract (Simplified):**

```jsonc
{
  "case_id": "uuid",
  "label": "1001.91.Operations.Safety",
  "status": "open",
  "severity": "high",
  "reactivity_time": "PT1H", // ISO 8601 Duration
  "origin_role": "Operations.Safety",
  "location": { "site": "Main", "area": "Lobby" },
  "metadata": { "incident_type": "slip_fall" }
}
```

**The Task Contract (Simplified):**

```jsonc
{
  "task_id": "uuid",
  "case_id": "uuid",
  "type": "maintenance", // Domain
  "subtype": "cleaning", // Specifics
  "status": "pending",
  "owner_role_id": "uuid", // Who is responsible
  "due_at": "2025-12-12T14:00:00Z"
}
```

-----

## Cyclic Review System

Orgo is not just for "doing work"; it is for **improving operations**. The system enforces a **Cyclic Overview** process driven by the Insights module.

1.  **Weekly Loop:** Review all `critical` and `unresolved` items. Immediate tactical fixes.
2.  **Monthly Loop:** Review trends by Department and Location. Detect resource imbalances.
3.  **Yearly Loop:** Strategic review. Input for next year's Profile configuration.

**Pattern Detection:**
The engine can be configured to auto-escalate "soft signals." For example: *"If 5 tasks of subtype 'leak' occur in 'Building A' within 30 days, auto-create a Case titled 'Infrastructure Audit: Building A'."*

-----

## Status and Scope

**What Orgo IS:**

  * A unified Case & Task routing platform.
  * A pattern detection engine.
  * A structured communication tool using Wikidata standards for interoperability.

**What Orgo is NOT:**

  * An ERP (It does not do payroll or inventory accounting).
  * A Chat App (It is for structured work, not casual conversation).
  * A Kanban Toy (It enforces rigorous routing rules).