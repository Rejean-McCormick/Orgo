# Orgo Interaction Model

**Version:** 1.0  
**Date:** 2026-09-17  
**Status:** Canonical target interaction model  
**Product:** Orgo — *Organize and Go*

> This document defines the canonical human interaction model for Orgo. It is an interaction and presentation specification, not a claim that every surface described here is already implemented. Current implementation evidence remains governed by `IMPLEMENTATION_STATUS.md`, dated status records, executable source, the Prisma schema/migrations, and active tests.

---

## 0. Normative language and authority

The words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative in this document.

When documents disagree, use this precedence:

1. executable source and active persistence contracts for what currently exists;
2. `TARGET_ARCHITECTURE.md`, `CONTRACTS.md`, `BOUNDARIES_AND_OWNERSHIP.md`, and implementation decisions for domain/runtime ownership;
3. **this document for interaction composition, user-facing surfaces, navigation, lenses, and interaction behavior**;
4. `UI_AND_KOALI_INTEGRATION.md` for the hosting/shell relationship;
5. dated validation/status records for evidence at a specific point in time.

This model does **not** redefine Orgo's canonical persistence ownership:

- `Organization` remains the tenant boundary;
- `Work` remains the owner of canonical Case/Task mutations;
- `Case` remains the durable situation/context and primary operational workspace;
- `Task` remains the canonical executable unit of work;
- `Signal` remains first-class accepted input/evidence;
- Workflow evaluation remains deterministic;
- durable external effects remain explicit, idempotent, receipt-based operations;
- Insights remain projections, not operational write authority.

---

# Part I — Product interaction thesis

## 1. Orgo's interaction purpose

Orgo exists to move a situation from **something changed** to **people know what to do, why they are doing it, what happened, and what remains**.

The canonical interaction continuum is:

```text
SIGNAL
  ↓
QUALIFY
  ↓
WORKROOM / CONTEXT
  ├── DECIDE
  ├── PLAN
  └── ACT
       ↓
     VERIFY
       ↓
     OUTCOME
       ↓
     REVIEW
       ↺
```

The continuum is intentionally non-linear. New Signals can arrive at any time. Plans can change. Decisions can produce work. Work can produce evidence. Review can create corrective work.

The user should experience **one connected operational story**, not a collection of disconnected database screens.

## 2. The central interaction principle

> **Same work, different lens.**

A Case, Task, Signal, Process, attachment, external receipt, and actor do not become different records because the user changes interface.

A frontline worker, coordinator, supervisor, executive, administrator, and field user MAY see different compositions of the same underlying work, but:

- canonical IDs remain stable;
- history remains continuous;
- authorization remains authoritative at the backend;
- no presentation profile creates a parallel lifecycle;
- no specialized UI owns a private copy of operational truth.

## 3. The second interaction principle

> **Context travels with work.**

Every meaningful action SHOULD preserve enough context to answer:

```text
What is happening?
Why does this matter?
What am I expected to do?
Who else is involved?
What constrains the work?
What changed?
What evidence proves completion?
What happens next?
```

A Task without its Case context is an execution fragment. A Workroom MUST make the relationship visible without forcing the user to manually reconstruct it.

## 4. The third interaction principle

> **Simple first, depth on demand.**

Orgo MUST support progressive disclosure:

```text
Card / row
  → immediate summary

Inspector / quick view
  → context + safe actions

Workroom / full page
  → complete operational context

Control Panel
  → technical and administrative depth
```

The normal user experience MUST NOT be the Full Control Panel with menu items hidden.

The Full Control Panel is the maximal technical composition. User-facing surfaces are first-class compositions of shared primitives.

---

# Part II — Basis and conceptual alignment

## 5. Basis in the existing Orgo model

The active Orgo architecture already establishes the correct domain center:

```text
Intake
  → Signal

Work
  → Case
  → Task
  → Assignment
  → Comment
  → Evidence
  → Work Event

Orchestration
  → Workflow Definition / Version
  → Workflow Instance
  → Durable Process
  → Routing / Escalation
  → Action execution

External effects
  → Integration Operation
  → Outbox
  → Receipt/reference
```

The Interaction Model therefore **composes** these capabilities rather than introducing a competing "UX database."

## 6. Basis in the 120-scenario mosaic

The supplied 120 English Koali scenarios were reviewed as editorial design input.

They are marked `COMPOSED · runtime UNVERIFIED`; therefore they are **use-case evidence for interaction design**, not proof of deployed behavior.

The scenario families indicate where Orgo is intended to be strongest:

| Scenario family | Scenarios | Mean Orgo role* | Interaction implication |
| --- | ---: | ---: | --- |
| Organize & Act | 15 | 5.00 / 5 | Core Orgo territory: context, assignments, dependencies, execution, verification |
| Respond & Coordinate | 15 | 4.60 / 5 | Incident Workroom, situational awareness, field/offline, replanning |
| Collaborate & Create | 15 | 4.00 / 5 | Project/creation Workroom, commitments, prototype/action tracking |
| Choose & Govern | 15 | 3.60 / 5 | Decision lens, mandate, rationale, follow-up work |
| Remember & Improve | 15 | 3.07 / 5 | Review lens, timeline, corrective actions, lessons-to-work |
| Find & Understand | 15 | 2.60 / 5 | Investigation coordination; Orgo organizes investigation but does not replace knowledge systems |
| Learn & Share | 15 | 1.71 / 5** | Orgo coordinates learning-related work but is not the primary learning/knowledge product |
| Disseminate & Connect to the Public | 15 | 1.27 / 5 | Orgo tracks publication work/receipts but does not become the publishing platform |

\* Mean derived from the scenario component-role dots.  
\** One scenario contains no Orgo component-role line; the mean excludes that scenario.

The interaction model follows that signal: **Orgo is the operational coordination layer, not a universal knowledge, social, learning, or publishing application.**

## 7. External conceptual alignment

Orgo SHOULD align conceptually with established models without falsely claiming conformance.

### 7.1 CMMN alignment — adaptive Case work

The Orgo **Workroom** aligns conceptually with CMMN's case-centered, evolving, human-driven work:

- living case context;
- activities that may occur in an unpredictable order;
- event-driven evolution;
- human judgment retained;
- case information and work kept together.

Orgo MUST NOT claim CMMN interchange or execution conformance unless an actual CMMN-compatible model/import/export contract is implemented and validated.

Reference: OMG CMMN 1.1.

### 7.2 BPMN alignment — prescriptive process/plan work

Orgo **Plan / Process** interactions align conceptually with BPMN where work is more prescriptive:

- ordered steps;
- dependencies;
- waits;
- external calls;
- human approvals;
- execution progress;
- explicit completion/blocking.

Current Orgo Workflows and Durable Processes remain the implementation authority. BPMN notation is an alignment model, not a requirement to replace the Orgo engine.

Reference: OMG BPMN 2.0.2 / ISO/IEC 19510.

### 7.3 DMN alignment — decision work

The **Decision lens** aligns conceptually with DMN:

- decision question;
- inputs/evidence;
- criteria/rules;
- alternatives;
- authority;
- result;
- traceable consequences.

Orgo MUST NOT claim to be a DMN engine unless DMN models/rules are actually supported.

Reference: OMG DMN 1.5.

### 7.4 ICS/NIMS alignment — incident work

The **Incident Workroom** SHOULD borrow proven incident-management concepts where applicable:

- shared situational awareness / Common Operating Picture;
- objectives;
- assignments;
- resources/constraints;
- operational periods when needed;
- action planning;
- execute → evaluate → revise;
- role-appropriate information sharing.

This is conceptual alignment. Orgo is not a certified Incident Command System product and MUST NOT impose US emergency-management terminology on unrelated domains.

---

# Part III — The Orgo interaction grammar

## 8. Canonical interaction objects

Interaction objects are user-facing concepts. They do not automatically imply a new database table.

| Interaction concept | Meaning to the user | Canonical Orgo anchor |
| --- | --- | --- |
| **Signal** | Something arrived or changed | `Signal` |
| **Workroom** | The durable place where a situation is coordinated | `Case` |
| **Action** | Something that must be done | `Task` |
| **Assignment** | Who owns or participates in an Action | `TaskAssignment`, ownership fields |
| **Update** | A factual change or operational note | `WorkEvent`, Task/Case changes, comments, Signals |
| **Evidence** | Material proving or informing work | `WorkAttachment`, Signal, external reference |
| **Plan** | A structured route through work | Workflow version/instance and/or `DurableProcess` |
| **Decision** | A traceable choice inside a Workroom | interaction projection over events/evidence/approval/process state; not necessarily a new persistence entity |
| **Outcome** | The operational result of work | terminal Task/Case state + evidence/events |
| **Review** | Structured reflection over history/outcomes | projection over timeline, Insights, Work events; corrective Tasks return to Work |
| **External operation** | Work requested from another system | `IntegrationOperation`, outbox, receipt/reference |
| **Notification** | Attention signal for a user | `Notification` |
| **Timeline** | The chronological operational record | `WorkEvent`, Task events, Activity/Audit records |
| **Person / Role** | Human accountability and access context | Person, User, Role, assignment records |

### 8.1 Workroom is not a new domain entity

**Workroom = the user-facing interaction representation of a Case.**

Do not create:

```text
Workroom table
+
Case table
```

unless a future requirement introduces truly distinct semantics.

The canonical relationship is:

```text
Case
  └── rendered as Workroom
```

### 8.2 Action is not a second Task model

The UI MAY say **Action**, **Next action**, or **My work** where that is clearer.

The canonical executable object remains `Task`.

### 8.3 Decision is initially a lens, not a competing lifecycle

A Decision view MUST preserve:

```text
question
decision status
decision authority
known inputs
options when applicable
criteria when applicable
rationale
decision/result
time
actor(s)
follow-up actions
linked evidence
```

The first implementation MAY compose this from existing Work Events, evidence, human-approval process steps, metadata, and Tasks.

If decision semantics become sufficiently rich or independently queryable, a dedicated first-class Decision model MAY later be proposed through the architecture/migration process. This document does not silently create one.

---

# Part IV — Universal work continuum

## 9. Universal stages

The following stages are interaction stages, not one mandatory database state machine:

### 9.1 Notice

A Signal arrives from:

- user report;
- API;
- email;
- integration;
- timer/system event;
- offline synchronization.

### 9.2 Qualify

The system/user determines:

- what is this;
- how urgent/severe is it;
- is it duplicate/related;
- does an existing Workroom already contain the situation;
- who should see it;
- what action, if any, is required.

### 9.3 Contextualize

The Signal is related to a Workroom, or a new Workroom is created.

The Workroom becomes the durable place for:

- situation;
- affected subject;
- people;
- Actions;
- Decisions;
- Plan;
- Evidence;
- external operations;
- history.

### 9.4 Decide

Where judgment is required:

```text
question
→ inputs
→ options
→ criteria
→ authority
→ decision
→ consequences
```

Not every Workroom needs a formal Decision interaction.

### 9.5 Plan

Where coordination benefits from an explicit route:

```text
objective
→ steps
→ dependencies
→ owners/resources
→ waits/conditions
→ execution
```

Not every Workroom needs a formal plan.

### 9.6 Act

Tasks are assigned, executed, updated, escalated, completed, failed, paused, or cancelled through canonical Work services.

### 9.7 Verify

Completion SHOULD be paired with evidence appropriate to the domain:

- attachment;
- measurement;
- confirmation;
- receipt;
- observation;
- comment;
- external validation;
- structured result.

### 9.8 Resolve

The Workroom can be resolved when its operational purpose is satisfied.

### 9.9 Review

A Review examines:

- what was known when;
- decisions;
- Actions;
- outcomes;
- deviations;
- lessons;
- follow-up Actions.

A Review MUST NOT rewrite historical uncertainty using facts that were only learned later.

---

# Part V — Surface architecture

## 10. Surface taxonomy

Orgo MUST have few top-level surfaces and rich contextual lenses.

Canonical surface classes:

```text
PERSONAL
  Today
  My Work

CONTEXTUAL
  Workrooms
  Workroom

INTAKE
  Intake / Triage
  Report something

CONTEXT LENSES
  Overview
  Actions
  Plan
  Decisions
  Evidence
  People
  Timeline
  Review

SPECIALIZED COMPOSITIONS
  Incident
  Investigation
  Project / Delivery
  domain overlays

TECHNICAL
  Full Control Panel
```

## 11. Default simple navigation

For an ordinary user, the default navigation SHOULD be:

```text
ORGO
ORGANIZE AND GO

Today
My Work
Workrooms

────────────
+ Report something
```

Profile-specific entries MAY appear below, for example:

```text
Intake
Team
Situation
Reports
```

Technical object collections such as raw Signals, Workflow definitions, Routing, Integrations, Audit, and System SHOULD NOT be placed in the primary navigation for ordinary users.

## 12. Today

**Today** is the default personal operational landing page.

Its purpose is to answer:

> What requires my attention now?

It SHOULD show only actionable, relevant information:

```text
Needs attention
Due / overdue
In progress
Waiting / blocked
Recent mentions or updates
```

Each item MUST identify enough context to act:

- Action title;
- Workroom;
- why it needs attention;
- due/reactivity indicator when applicable;
- current state;
- primary next command.

Today is a **projection**, not a new queue database.

### 12.1 Attention ordering

Ordering SHOULD be deterministic and explainable.

Priority inputs MAY include:

1. critical severity/priority;
2. breached or near reactivity deadline;
3. overdue due date;
4. explicit escalation;
5. direct assignment;
6. blocker/wait needing user intervention;
7. recent relevant change.

An algorithmic score MUST NOT silently change the canonical Task priority or severity.

## 13. My Work

**My Work** is the user's complete transverse work list.

It answers:

> What work am I responsible for?

Filters SHOULD include:

- active;
- waiting;
- completed/recent;
- Workroom;
- priority;
- due date;
- role/team scope where permitted.

The list MUST deep-link into the appropriate Workroom context.

## 14. Workrooms list

**Workrooms** is the human-facing replacement for treating `Cases` as a technical concept in normal navigation.

It answers:

> What situations are we actively coordinating?

A row/card SHOULD expose:

- title;
- state;
- severity;
- owner/coordinator when available;
- next unresolved Actions;
- latest meaningful update;
- blockers;
- age / due context when relevant.

The underlying entity remains `Case`.

## 15. Workroom

The Workroom is the primary operational workspace.

Every Workroom MUST make the following five questions easy to answer:

```text
1. What is happening?
2. What are we trying to achieve?
3. What needs to happen next?
4. Who owns what?
5. What changed / what proves the result?
```

### 15.1 Canonical Workroom layout

```text
┌─────────────────────────────────────────────────────────────┐
│ WORKROOM HEADER                                             │
│ Title · status · severity · scope · owner · last update    │
│ [Primary action] [Add update] [More…]                      │
├─────────────────────────────────────────────────────────────┤
│ Situation / objective / current state                      │
├───────────────────────────────┬─────────────────────────────┤
│ NEXT ACTIONS                  │ PEOPLE / OWNERSHIP          │
│ blockers / due / assignments │ roles / participants       │
├───────────────────────────────┴─────────────────────────────┤
│ Context lenses                                               │
│ Overview | Actions | Plan | Decisions | Evidence | Timeline │
└─────────────────────────────────────────────────────────────┘
```

The exact responsive arrangement MAY differ.

### 15.2 Workroom header

The header SHOULD always preserve:

- Workroom title;
- canonical status;
- severity when relevant;
- access/restricted indicator when relevant;
- accountable owner/coordinator when available;
- last meaningful change;
- primary next command.

### 15.3 Workroom overview

Overview SHOULD contain:

- current situation;
- objective / desired outcome;
- next Actions;
- blockers;
- latest updates;
- current Plan state when one exists;
- pending Decision when one exists;
- key Evidence;
- people/ownership.

Overview MUST NOT become a dashboard of unrelated metrics.

## 16. Workroom lenses

### 16.1 Actions

Shows canonical Tasks in the Workroom.

Default grouping:

```text
Needs attention
In progress
Waiting
Done
```

Technical Task status remains authoritative.

### 16.2 Plan

Shows:

- objective;
- plan/version identity;
- steps;
- dependencies;
- current step;
- waits;
- blocked reason;
- external operations;
- human approvals;
- completion state.

The Plan lens SHOULD translate engine detail into operational language without hiding blocking conditions.

### 16.3 Decisions

Shows decision records in chronological/contextual form.

A Decision MUST visually distinguish:

- facts/inputs;
- option/choice;
- rationale;
- authority;
- follow-up Actions.

### 16.4 Evidence

Combines user-relevant evidence references without collapsing ownership boundaries:

- Orgo attachments;
- accepted Signals;
- external artifact references;
- external receipts;
- verification data.

External content MUST be clearly marked as external/provenanced state.

### 16.5 People

Shows:

- owner/coordinator;
- assigned people/roles;
- participants;
- scoped access where appropriate;
- contact/context references when permitted.

It MUST NOT imply access merely because a person is displayed.

### 16.6 Timeline

Timeline is the canonical human-readable chronology.

It SHOULD merge relevant Work events into a readable sequence while preserving links to exact records.

Important changes MUST identify:

- what;
- when;
- actor/origin when available;
- previous/new state where useful;
- causation/correlation where operationally relevant.

### 16.7 Review

Review is normally available after resolution or when explicitly started.

It SHOULD structure:

```text
Objective
What happened
What was known at key moments
Decisions
Results
Deviations
What worked
What did not
Lessons
Corrective Actions
```

Lessons that require action MUST become canonical Tasks/Work, not remain prose only.

---

# Part VI — Workroom modes

## 17. A mode is composition, not a new object type

Workroom modes change emphasis and default panels.

They MUST NOT create separate Case lifecycles.

Canonical modes:

```text
Standard
Investigation
Project / Delivery
Incident
Review
Domain overlay
```

## 18. Standard Workroom

Use when a situation needs durable coordination but no specialized interaction dominates.

Emphasis:

- situation;
- next Actions;
- owner;
- Evidence;
- timeline.

## 19. Investigation Workroom

Use for:

- faults;
- causes;
- complaints;
- anomalies;
- investigations;
- research-to-action handoffs.

Emphasis:

```text
Signals
Known facts
Unknowns
Hypotheses/questions
Checks / Actions
Evidence
Findings
Decision / next action
```

Orgo coordinates investigation work; it MUST NOT pretend to own external knowledge/provenance that belongs to Kristal or another authoritative knowledge system.

## 20. Project / Delivery Workroom

Use when execution and dependencies dominate.

Emphasis:

```text
Objective
Milestones / plan
Actions
Dependencies
Owners
Constraints
Risks/blockers
Evidence of delivery
```

This composition directly serves the scenario families "Coordinate roles and dependencies", "Carry a plan through execution", and "Deliver work with its context."

## 21. Incident Workroom

Incident is a high-velocity specialization of Workroom.

It MUST optimize for:

```text
Current situation
Objectives
Critical Actions
Roles
Blockers / constraints
Latest verified updates
Decisions
Resources/references
Plan / operational period when used
Timeline
```

### 21.1 Common Operating Picture behavior

The Incident overview SHOULD function as a role-appropriate shared operational picture:

- continuously updated;
- source-aware;
- focused on decision/action relevance;
- permission-filtered;
- not automatically public.

### 21.2 Information circles / restricted context

Incident work often contains information that not everyone may see.

The UI MUST:

- preserve Work/Case scope enforcement;
- avoid leaking restricted titles/content through counters or previews;
- clearly indicate that a user is seeing a scoped view;
- never use UI hiding as the authorization boundary.

### 21.3 Incident command actions

High-frequency commands SHOULD include:

```text
Add situation update
Create critical Action
Assign / reassign
Report blocker
Record Decision
Add Evidence
Start / revise Plan
Resolve
```

## 22. Review Workroom mode

Review mode changes the temporal orientation from "what next?" to "what happened and what must change?"

It MUST use the same historical record.

It MUST NOT duplicate the Case into a separate postmortem database.

## 23. Domain overlays

Maintenance, HR, Education, care, programs, operations, groups, incidents, and future domains MAY provide:

- labels;
- vocabulary;
- forms;
- specialized panels;
- domain validation;
- domain-linked state.

They MUST NOT introduce a competing canonical Work lifecycle.

Semantic Charters MAY guide domain vocabulary/classification.

---

# Part VII — Intake and signal interaction

## 24. Report something

The universal user entry action SHOULD be phrased in human language:

```text
+ Report something
```

rather than:

```text
Create Signal
```

unless the user is in a technical/intake profile.

The shortest useful report SHOULD require only what is necessary, typically:

- title/what happened;
- description/context;
- optional urgency/location/evidence depending on domain.

The system MAY progressively request classification after initial capture.

## 25. Intake / Triage

Intake is a specialist surface.

It answers:

> What arrived, and what should happen to it?

Default interaction is one Signal at a time or a compact queue.

Triage commands MAY include:

```text
Open existing Workroom
Link to Workroom
Create Workroom
Create Action
Classify
Assign/reroute
Reject
Mark duplicate / related
```

Every command MUST use canonical Intake/Work/Orchestration APIs.

## 26. Signal status language

The UI MAY translate canonical Signal states:

```text
RECEIVED  → New
PROCESSED → Processed / Routed
REJECTED  → Rejected
```

Any friendly label MUST have one clear canonical mapping.

---

# Part VIII — Actions and execution

## 27. Human-facing Task vocabulary

Ordinary surfaces SHOULD say **Action** where it improves comprehension.

Technical surfaces MAY say **Task**.

Canonical state mapping:

| Canonical Task status | Human label |
| --- | --- |
| `PENDING` | To do |
| `IN_PROGRESS` | In progress |
| `ON_HOLD` | Waiting |
| `COMPLETED` | Done |
| `FAILED` | Failed |
| `ESCALATED` | Escalated |
| `CANCELLED` | Cancelled |

The user label MUST NOT imply a different lifecycle.

## 28. Action card

An Action card SHOULD expose:

- verb-oriented title;
- Workroom;
- owner;
- state;
- due/reactivity context;
- priority/severity only when useful;
- blocker/wait reason;
- expected evidence if defined;
- one primary next action.

## 29. Action completion

Completion SHOULD make expected evidence explicit.

Examples:

```text
Complete
Complete + attach evidence
Complete + enter result
Complete after external confirmation
```

The system MUST NOT fabricate proof merely because a Task entered `COMPLETED`.

---

# Part IX — Plans, workflows, and durable processes

## 30. Plan interaction model

The user-facing Plan represents coordinated execution.

A Plan SHOULD answer:

```text
What is the objective?
What are the steps?
What is happening now?
What are we waiting for?
Who must act?
What is blocked?
What external operation is pending?
What proves completion?
```

## 31. Reusable rule vs running plan

The UI MUST distinguish:

```text
Workflow definition/version
  = reusable, versioned orchestration logic

Workflow instance / Durable Process
  = a specific running execution

Workroom Plan lens
  = human-facing projection of the relevant running plan
```

## 32. Plan immutability and revision

Published workflow versions remain immutable.

A running plan MUST identify the exact version/hash/ruleset it is using where relevant.

A user SHOULD see a human-readable "Plan version" rather than raw hashes by default; exact identifiers remain available in technical detail.

## 33. Waiting states

Durable waiting MUST be visible and explainable.

Friendly mapping MAY include:

```text
RUNNING          → Running
WAITING_EXTERNAL → Waiting for external system
WAITING_HUMAN    → Waiting for approval
WAITING_TIMER    → Waiting until <time>
BLOCKED          → Blocked
COMPLETED        → Completed
CANCELLED        → Cancelled
```

A "waiting" plan MUST show **what it is waiting for**.

---

# Part X — Decisions

## 34. Decision interaction contract

A formal Decision view MUST contain, when applicable:

```text
Decision question
Status
Authority / decision owner
Decision deadline
Inputs / Evidence
Options
Criteria
Risks / trade-offs
Discussion reference
Decision/result
Rationale
Conditions / constraints
Follow-up Actions
Review trigger
```

## 35. Decision states

The interaction model SHOULD use a small understandable vocabulary:

```text
Draft
Ready
Pending decision
Decided
Superseded
Cancelled
```

This is an interaction concept. Persistence representation is an implementation decision until a first-class Decision model exists.

## 36. Decision → work invariant

A Decision that creates commitments MUST create or link canonical Work.

Example:

```text
Decision: approve supplier with conditions
  ↓
Action: negotiate clause
Action: establish backup supplier
Action: review risk in 90 days
```

The Decision screen MUST NOT become a dead-end document.

## 37. Decision provenance

The Decision timeline SHOULD preserve what information was available at decision time.

Later evidence MAY be linked as later evidence, but MUST NOT silently rewrite the historical input set.

---

# Part XI — Personal, team, and executive lenses

## 38. Team / Supervisor view

Supervisor composition SHOULD answer:

```text
What is at risk?
What is blocked?
Who is overloaded?
What is unassigned?
What is due soon?
Which Workrooms need intervention?
```

It SHOULD provide drill-down into Workrooms rather than a separate management truth.

## 39. Executive / Situation view

Executive composition SHOULD emphasize:

- active critical Workrooms;
- objectives/outcomes;
- decisions required;
- systemic blockers;
- operational indicators;
- major changes;
- accountable owners.

It SHOULD NOT expose technical queue detail by default.

## 40. Cross-Workroom Plans / Decisions

Specialist and management profiles MAY have transverse lists:

```text
Plans
Decisions
```

These are projections across Workrooms, not independent applications.

---

# Part XII — Presentation profiles

## 41. Presentation is not authorization

This invariant is absolute:

```text
presentation profile ≠ permission
```

A profile determines what is convenient to see.

The API determines what the actor is allowed to read or mutate.

## 42. Canonical profile evolution

The existing profile vocabulary can evolve without discarding compatibility.

| Existing profile | OIM default composition |
| --- | --- |
| **Operations** | Today, My Work, Workrooms, profile-specific operational views |
| **My Work** | Today, My Work, Workrooms |
| **Supervisor** | Team, Workrooms, Plans, Reviews/Reports |
| **Intake** | Intake, Workrooms |
| **Workflow Admin** | Workflow/Plan design, Processes, Routing, Integrations, Settings |
| **Executive** | Situation, Decisions, Workrooms, Reports |
| **Embedded** | focused Workroom/entity composition |
| **Full Control Panel** | all technical/admin sections |

A separate "Field" profile is optional. Field behavior can usually be a responsive/low-connectivity rendering of the actor's normal profile.

## 43. Full Control Panel

The Full Control Panel remains necessary for power users and administrators.

It MAY expose canonical technical collections:

```text
Cases
Tasks
Signals
Workflows
Processes
Routing
People
Organizations / Access
Insights
Audit
Integrations
System
Configuration
Domain modules
```

It MUST NOT be the default ordinary-user experience.

---

# Part XIII — Navigation and routing

## 44. Navigation levels

Orgo has three interaction navigation levels:

```text
LEVEL 1 — Product surface
Today / My Work / Workrooms / Intake / Control

LEVEL 2 — Workroom lens
Overview / Actions / Plan / Decisions / Evidence / People / Timeline / Review

LEVEL 3 — Inspector / focused object
Task / Signal / Person / Evidence / Receipt / Process step
```

## 45. Stable deep links

Every meaningful Workroom and Action MUST support stable direct linking.

A direct link after authentication/session restoration MUST reopen the requested context, not dump the user on a generic home page.

## 46. Browser history

Navigation MUST behave like a web application:

- back/forward preserve context;
- refresh preserves the authenticated session when valid;
- deep links restore the target;
- modals/inspectors SHOULD NOT make history unusable.

## 47. Search

Search SHOULD search only objects the actor may access.

Results SHOULD be grouped by user meaning:

```text
Workrooms
Actions
People
Signals
Plans / Processes
```

Technical entity names MAY appear in Control mode.

## 48. Command launcher

The existing Orgo command-system direction remains valid.

Human-oriented commands include:

```text
Open Workroom…
Report something…
Create Action…
Assign…
Add update…
Record Decision…
Start Plan…
Add Evidence…
Escalate…
Resolve Workroom…
```

Command availability MUST be permission-filtered but backend authorization remains authoritative.

---

# Part XIV — Inspector and interaction depth

## 49. Three-depth rule

### Card / row

For recognition and selection.

### Inspector

For:

- quick context;
- safe edits;
- one-step commands;
- relationship visibility;
- deep link.

### Full Workroom / page

For:

- complex coordination;
- full history;
- structured planning;
- decision work;
- review;
- configuration.

The Inspector MUST NOT embed a miniature copy of the entire Workroom.

---

# Part XV — Offline and field interaction

## 50. Field rendering

Field mode is a **rendering strategy**, not a separate domain model.

It SHOULD optimize for:

```text
What do I need to do now?
What changed?
Can I update status?
Can I attach evidence?
Am I synchronized?
```

Default field commands:

```text
Update
Start
Complete
Attach
Report blocker
```

## 51. Offline truth

The UI MUST distinguish:

```text
Saved on this device
Queued for sync
Syncing
Committed to Orgo
Conflict
Failed
```

A local queued mutation MUST NOT be presented as server-committed success.

## 52. Offline security

Offline queues MUST NOT store authentication tokens.

Sensitive data SHOULD respect the minimum necessary local retention and current Orgo offline/security policy.

## 53. Conflict interaction

A conflict MUST explain:

- what changed locally;
- what changed remotely;
- what object/version is current;
- safe choices to resolve.

"Last write wins" MUST NOT be silently applied to protected work where revision semantics exist.

---

# Part XVI — Notifications and attention

## 54. Notification principle

Notifications exist to route attention back to Work.

A notification SHOULD answer:

```text
What changed?
Why do I care?
Where do I act?
```

The primary interaction is a deep link to the exact Workroom/Action.

## 55. Notification noise control

The UI SHOULD favor meaningful state change over raw event spam.

Multiple low-value events MAY be grouped as long as audit/history remains intact.

---

# Part XVII — Security, privacy, and trust

## 56. Authorization invariants

Every protected read/mutation MUST independently enforce:

```text
identity
organization
RBAC / explicit permission
work scope
policy
```

UI visibility is not authorization.

## 57. Restricted information

Restricted Workrooms/Actions MUST avoid side-channel disclosure.

Unauthorized users SHOULD NOT receive:

- restricted titles;
- descriptions;
- counts that reveal hidden objects where sensitive;
- participant identities;
- evidence metadata;
- search snippets.

## 58. Scope visibility

When the actor sees a scoped subset, the UI SHOULD communicate that the view is scoped when this prevents misunderstanding.

It MUST NOT imply that "no results" means "no objects exist" if policy requires non-disclosure.

## 59. Auditability

Meaningful commands SHOULD be traceable to:

- actor/origin;
- organization;
- time;
- subject;
- previous/new state when applicable;
- correlation/causation when available.

---

# Part XVIII — External systems and ecosystem composition

## 60. Ownership rule

Orgo MAY coordinate external work but MUST NOT impersonate external ownership.

Examples:

```text
Kristal knowledge artifact
Konnaxion social/participation state
Architect linguistic/semantic runtime state
kOA-Linux platform/runtime state
external provider delivery state
```

The Workroom MAY show references and receipts.

It MUST clearly label them as external/provenanced state.

## 61. External operation interaction

An external operation SHOULD show:

```text
Provider
Requested action
Requested at
State
Last receipt/update
Correlation/reference
Failure/blocking reason
Retry/new-request policy where authorized
```

"Request accepted" MUST NOT be presented as "external outcome validated."

## 62. Ecosystem fit implied by the scenario mosaic

The interaction model intentionally avoids making Orgo:

- a knowledge graph editor;
- a social network;
- an LMS;
- a CMS/publication platform;
- a media authoring platform.

Orgo coordinates the work around those activities when coordination is required.

---

# Part XIX — Semantic Charters and domain language

## 63. Charter role

Semantic Charters MAY influence:

- terminology;
- classification;
- form choices;
- suggested relationships;
- search/disambiguation;
- domain overlays.

They MUST NOT replace canonical Work entities/lifecycles.

## 64. Domain labels vs core semantics

A domain may display:

```text
Patient support case
Maintenance intervention
Student support
Incident
Program activity
Association request
```

while still mapping to the same canonical Case/Task/Signal semantics underneath.

This allows Orgo to feel native to the user's world without fragmenting the core.

---

# Part XX — Content design

## 65. Human language first

Normal UI labels SHOULD express user intent:

Prefer:

```text
Workrooms
Actions
Report something
Needs attention
Waiting for approval
Waiting for external system
```

over:

```text
Case entities
Task records
Create Signal
DurableProcess WAITING_HUMAN
IntegrationOperation RUNNING
```

Technical terminology remains available in Control/diagnostic contexts.

## 66. Verb-oriented actions

Buttons SHOULD use explicit verbs:

```text
Assign
Start
Complete
Add update
Record decision
Attach evidence
Resolve
Reopen
```

Avoid ambiguous buttons such as `OK`, `Submit`, or `Process` when a specific verb is possible.

## 67. State explanations

A state SHOULD answer "why" when the reason is actionable.

Example:

```text
Waiting
Waiting for Facilities approval
```

is better than:

```text
ON_HOLD
```

---

# Part XXI — Visual and responsive model

## 68. Brand

Canonical brand identity:

```text
Orgo
Organize and Go
#1e6864
```

Brand color SHOULD identify navigation, primary action, focus/selection, and brand elements.

Semantic colors for error, warning, success, severity, and destructive actions MUST remain distinguishable from brand color.

## 69. Density

Default density SHOULD optimize for ordinary operational use.

Control Panel MAY offer denser tables.

Incident/field modes SHOULD prioritize scanability over data density.

## 70. Mobile

Responsive behavior MUST preserve the interaction model rather than merely shrink desktop.

On narrow screens:

- one primary column;
- Workroom header remains visible/compact;
- primary Action is obvious;
- lenses become tabs/menu;
- inspector becomes full-screen sheet/page;
- tables become cards or horizontal-safe lists;
- destructive actions remain deliberate.

## 71. Accessibility

All core interactions SHOULD meet WCAG 2.2 AA expectations:

- keyboard operability;
- visible focus;
- semantic headings/landmarks;
- accessible names;
- sufficient contrast;
- status not communicated by color alone;
- form errors associated to fields;
- reduced-motion respect where animation exists.

---

# Part XXII — Loading, empty, error, and destructive states

## 72. Loading

Loading states SHOULD preserve layout and context.

Avoid blank screens for ordinary data transitions.

## 73. Empty states

An empty state MUST say what the emptiness means and what the user can do.

Examples:

```text
No Actions need your attention.
No Workrooms match these filters.
No Evidence has been added yet. [Add evidence]
```

## 74. Errors

Errors SHOULD identify:

- what failed;
- whether work was committed;
- whether retry is safe;
- what the user can do.

The UI MUST NOT imply success if the server rejected a mutation.

## 75. Destructive actions

Archive, cancel, delete/tombstone, revoke, or other destructive commands MUST:

- name the object;
- explain material consequence;
- require confirmation when consequence is non-trivial;
- avoid dark patterns;
- show resulting state.

---

# Part XXIII — Scenario-to-interaction coverage

## 76. Pattern family coverage

The scenario mosaic contains the following reusable interaction patterns.

| Pattern family | Primary OIM support |
| --- | --- |
| Investigate a signal | Intake + Investigation Workroom + Actions + Evidence |
| Reconstruct context and provenance | Workroom Timeline/Evidence + external knowledge references |
| Find the right expertise | People lens + assignments + Konnaxion references |
| Turn practice into transferable knowledge | corrective/learning Actions; external learning/knowledge systems remain owners |
| Connect learning, practice, and evidence | Workroom + Actions + Evidence |
| Teach across language/connectivity constraints | offline/field work coordination; external content/learning owner |
| Move an idea to a prototype | Project Workroom + Plan + Actions + Evidence |
| Assemble a team around a problem | Workroom People + assignments |
| Co-create without losing the why | Workroom + Timeline + Decisions + Evidence |
| Connect decision, mandate, and consequences | Decision lens + follow-up Actions |
| Compare and prioritize explicitly | Decision lens / Insights input; explicit criteria |
| Deliberate across perspectives | Decision lens + referenced discussion/evidence |
| Deliver work with its context | Workroom + My Work + Evidence |
| Coordinate roles and dependencies | Plan + Actions + People |
| Carry a plan through execution | Plan + Durable Process + Actions |
| Turn an incident into coordinated response | Incident Workroom |
| Keep working in field/offline mode | Field rendering + offline queue |
| Maintain a changing shared situation | Incident Workroom + updates + replanning |
| Turn action into a lesson | Review lens + corrective Actions |
| See patterns over time | Insights → Workroom/Actions |
| Preserve capability beyond individuals | Review + evidence + external knowledge reference |
| Explain publicly without severing sources | publication Tasks + receipts; external publisher owns media |
| Turn knowledge into media or learning | publication/production coordination only |
| Keep media aligned with knowledge | external change signal → Workroom/Action → publication receipt |

## 77. Representative scenario loops

The following supplied loops directly shaped the model:

```text
report → building context → affected people → intervention
→ handoff → proof of restoration

report → verified facts → roles → decisions → authorized actions
→ new facts → resolution → after-action review

need → criteria → suppliers → risks → deliberation
→ mandate → decision → follow-up

timeline → state of knowledge → decisions → consequences
→ lessons → changes → future exercise
```

These become one Orgo grammar:

```text
Signal → Workroom → Decide/Plan → Action → Evidence/Outcome → Review
```

---

# Part XXIV — Interaction architecture in the frontend

## 78. Component architecture

Target organization may be implemented in the existing framework without mandatory filename changes:

```text
apps/web/src/orgo/
├── app/
├── shell/
├── presentation/
├── surfaces/
│   ├── today/
│   ├── my-work/
│   ├── workrooms/
│   ├── intake/
│   └── control/
├── workroom/
│   ├── overview/
│   ├── actions/
│   ├── plan/
│   ├── decisions/
│   ├── evidence/
│   ├── people/
│   ├── timeline/
│   └── review/
├── modes/
│   ├── investigation/
│   ├── project/
│   └── incident/
├── inspectors/
├── commands/
└── integration/
```

These are conceptual boundaries, not mandatory directories.

## 79. Current `profiles.ts` evolution

The current profile mechanism SHOULD evolve from:

```text
profile → list of technical sections
```

toward:

```text
profile
  → home surface
  → navigation composition
  → Workroom lens defaults
  → command scopes
  → inspector policy
  → density / field policy
```

The existing section routes may remain as technical/control routes during migration.

## 80. Shared primitives

The following SHOULD be reusable primitives:

```text
WorkroomHeader
SituationSummary
ActionCard
ActionList
AttentionBadge
PersonAssignment
EvidenceItem
DecisionCard
PlanStep
ExternalOperationStatus
TimelineEvent
StatusPill
ScopeIndicator
SyncIndicator
Inspector
Command
```

---

# Part XXV — Migration from the current UI

## 81. Preserve working routes while introducing human surfaces

Migration SHOULD be additive first.

Suggested sequence:

### Phase A — establish the Workroom language

- keep `/cases` operational;
- introduce Workroom presentation for Case detail;
- expose "Workrooms" label in ordinary profiles;
- preserve technical "Cases" in Full Control Panel.

### Phase B — Today and My Work

- introduce `/today`;
- enrich existing My Work;
- make Today the Operations/My Work default home.

### Phase C — Workroom lenses

- Actions;
- Evidence;
- People;
- Timeline;
- Plan;
- Decisions;
- Review.

### Phase D — Intake simplification

- universal `Report something`;
- specialist Intake/Triage surface.

### Phase E — specialized compositions

- Investigation;
- Project/Delivery;
- Incident;
- Field rendering.

### Phase F — technical separation

- consolidate raw object/admin collections in Full Control Panel;
- ordinary profiles no longer depend on technical navigation.

## 82. No forced database migration for presentation alone

The first Interaction Model implementation SHOULD reuse existing canonical records.

A schema migration is justified only where required semantics cannot be represented correctly and durably with current authoritative models.

---

# Part XXVI — Acceptance model

## 83. Interaction acceptance gates

The Interaction Model is not complete until automated browser evidence covers the following.

### OIM-01 — authenticated deep link

Given a valid session, opening a Workroom/Action deep link restores the target directly.

### OIM-02 — Today

A user can identify and open work needing attention without navigating technical collections.

### OIM-03 — My Work context

Every personal Action opens with its Workroom context.

### OIM-04 — Workroom comprehension

A Workroom exposes situation, next Actions, ownership, and recent changes on one surface.

### OIM-05 — Report something

An ordinary user can create a valid intake report without learning the word "Signal."

### OIM-06 — Triage

An authorized Intake user can relate a Signal to existing/new Work through canonical APIs.

### OIM-07 — Action lifecycle

Action labels and commands map correctly to canonical Task transitions and revision handling.

### OIM-08 — Evidence

Evidence can be attached/opened/removed according to current Work evidence rules and permissions.

### OIM-09 — Plan

A running process exposes current step, wait reason, blocked state, external operation, and final result accurately.

### OIM-10 — Decision

A decision can be recorded with authority/rationale and can produce linked follow-up Work.

### OIM-11 — Incident

Incident composition shows current situation, objectives, critical Actions, roles, updates, Decisions, and timeline without bypassing access scope.

### OIM-12 — Restricted scope

Unauthorized actors cannot infer protected Work through lists, search, counts, notifications, or direct URLs.

### OIM-13 — Offline

Queued vs committed state is visibly distinct; replay is idempotent; conflicts are surfaced.

### OIM-14 — Review

A resolved Workroom can reconstruct chronology and create corrective Actions without rewriting history.

### OIM-15 — External state

External accepted/succeeded/failed states and receipts are displayed without misrepresenting external ownership.

### OIM-16 — Profiles

The same canonical Work renders through multiple profiles without changing permissions or creating duplicate state.

### OIM-17 — Responsive field use

Core Action update/complete/evidence interactions work on a narrow/mobile viewport.

### OIM-18 — Keyboard/accessibility

Primary flows are keyboard-operable with visible focus and accessible labels.

### OIM-19 — Full Control Panel

Power users retain access to technical/admin surfaces without making them the default user experience.

### OIM-20 — Existing acceptance preservation

Existing security, Work, workflow, offline, integration, and browser acceptance journeys remain green or are intentionally updated with equivalent coverage.

---

# Part XXVII — Anti-patterns and hard prohibitions

## 84. Orgo MUST NOT

- create separate operational truth per surface;
- create a `Workroom` persistence model merely to rename Case;
- create a second Task lifecycle for "Actions";
- use presentation profiles as authorization;
- expose technical/admin navigation to every ordinary user;
- create a universal generic Overview page disconnected from role/work;
- duplicate external system state as if Orgo owned it;
- report accepted external transport as validated external outcome;
- hide offline failure behind optimistic success;
- silently overwrite revision conflicts;
- bury the reason/context for an Action;
- make a user manually correlate Signal → Case → Task in order to understand one situation;
- require users to understand BPMN/CMMN/DMN terminology to use Orgo;
- claim standards conformance merely because concepts are aligned;
- turn Orgo into a knowledge graph, social network, LMS, CMS, or media platform;
- duplicate Koali's outer shell when hosted.

---

# Part XXVIII — Canonical diagrams

## 85. Domain-to-interaction map

```text
                    USER EXPERIENCE

        ┌──────────── TODAY / MY WORK ────────────┐
        │                                          │
        │             WORKROOM (Case)              │
Signal ─┼─> Overview                               │
        │   ├── Actions ────────────────> Task     │
        │   ├── Plan ──────> Workflow / Process   │
        │   ├── Decisions ─> Events/approval/work │
        │   ├── Evidence ──> Attachment/Signal    │
        │   ├── People ────> Assignment/Role      │
        │   ├── Timeline ──> Work Events          │
        │   └── Review ────> Insights + new Work  │
        │                                          │
        └──────────────────────────────────────────┘

External system
        ↑ request / receipt / reference
        └── IntegrationOperation / Outbox
```

## 86. Surface composition

```text
ORGO
│
├── Today
├── My Work
├── Workrooms
│   └── Workroom
│       ├── Overview
│       ├── Actions
│       ├── Plan
│       ├── Decisions
│       ├── Evidence
│       ├── People
│       ├── Timeline
│       └── Review
│
├── Intake                  [profile-dependent]
├── Team / Situation        [profile-dependent]
└── Full Control Panel      [power/admin]
```

## 87. Specialized Workroom modes

```text
                   WORKROOM
                      │
      ┌───────────────┼────────────────┐
      │               │                │
Investigation      Project          Incident
      │               │                │
questions          plan            situation
checks             dependencies    objectives
evidence           delivery        critical work
findings           blockers        rapid updates
      └───────────────┼────────────────┘
                      │
                    Review
```

---

# Part XXIX — Canonical glossary additions

## 88. Workroom

The human-facing operational workspace for one canonical Case.

## 89. Lens

A context-preserving view of the same Workroom optimized for one question, such as Actions, Plan, Decisions, Evidence, or Review.

## 90. Mode

A composition policy that changes the prominence/default arrangement of lenses for a class of work such as Investigation or Incident. It does not create a new Case lifecycle.

## 91. Action

Human-facing term for a canonical executable Task.

## 92. Today

Personal projection of work requiring near-term attention.

## 93. Decision

A traceable choice in context, including authority, inputs, rationale, result, and consequences. It is an interaction concept unless/until promoted to a dedicated persistence entity.

## 94. Outcome

The evidenced operational result of completed/resolved work; not merely a terminal status.

## 95. Review

A structured lens over historical Work that connects chronology, decisions, outcomes, lessons, and corrective work.

---

# Part XXX — Final canonical rules

## 96. The final Orgo interaction model in twelve rules

1. **Case is presented as Workroom.**
2. **Task is presented as Action where human language benefits.**
3. **Signal is the accepted input; ordinary users report something rather than create a Signal.**
4. **Today and My Work are personal projections, not new stores.**
5. **Workroom is the center of operational context.**
6. **Plan, Decision, Evidence, People, Timeline, and Review are lenses on the same work.**
7. **Investigation, Project, and Incident are Workroom modes, not separate applications.**
8. **Field/offline is a rendering/execution condition, not a second domain model.**
9. **Presentation profiles compose surfaces; permissions authorize behavior.**
10. **External systems remain authoritative for their own state; Orgo tracks requests, references, and receipts.**
11. **Every important action preserves context, accountability, and evidence.**
12. **Orgo's promise is one continuous path from signal to coordinated action to verified outcome and learning.**

Canonical shorthand:

```text
NOTICE → CONTEXT → DECIDE / PLAN → ACT → VERIFY → REVIEW
```

Brand shorthand:

```text
ORGO
ORGANIZE AND GO
```

---

# Appendix A — Standards references

These references explain conceptual alignment; they are not implementation claims.

- Object Management Group — Case Management Model and Notation (CMMN) 1.1: https://www.omg.org/spec/CMMN/1.1/
- Object Management Group — Business Process Model and Notation (BPMN) 2.0.2: https://www.omg.org/spec/BPMN/2.0.2/
- Object Management Group — Decision Model and Notation (DMN) 1.5: https://www.omg.org/spec/DMN/1.5/
- FEMA / NIMS / ICS Resource Center and incident action planning materials: https://training.fema.gov/emiweb/is/icsresource/

# Appendix B — Repository documents this model depends on

- `docs/Technical-Reference/TARGET_ARCHITECTURE.md`
- `docs/Technical-Reference/UI_AND_KOALI_INTEGRATION.md`
- `docs/Technical-Reference/CONTRACTS.md`
- `docs/Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md`
- `docs/Technical-Reference/IMPLEMENTATION_DECISIONS.md`
- `docs/Technical-Reference/COMPLETION_DECISIONS.md`
- `docs/Technical-Reference/GLOSSARY.md`
- `docs/Technical-Reference/Semantic-Charters.md`
- executable `apps/api/prisma/schema.prisma`
- active frontend composition/profile source
- supplied 120-scenario English Koali scenario mosaic

# Appendix C — Implementation-status warning

This document is a canonical target interaction model.

It does **not** by itself prove that:

- Today exists;
- Workroom lenses exist;
- Decision interactions exist;
- Incident composition exists;
- field/mobile acceptance is complete;
- external standards are natively implemented;
- hosted Koali execution is validated.

Those claims require executable implementation and fresh validation evidence.
