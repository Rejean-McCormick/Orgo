You’re right: the fenced code block inside the list is what’s confusing GitHub’s parser. Below is a cleaned-up **full README** where the example label is in its own top-level code block (not nested inside the list), so formatting after `1001.91.Operations.Safety` will render correctly.

````markdown
# Orgo

> Multi-tenant “nervous system” for organizations: capture signals, turn them into structured Cases and Tasks, route work by labels & roles, and surface patterns over time.

---

## Status

Orgo is early-stage / experimental.  
APIs, schema and UI are subject to change; do not treat this as a stable product yet.

---

## What Orgo does

Orgo is a shared backbone for operational work across many organizations and domains.

It:

- ingests signals from email, APIs, UIs and offline imports;
- normalizes everything into a strict Case / Task schema;
- routes work using a standardized label + role system;
- tracks escalation, visibility and review cycles across organizations;
- feeds an Insights layer (star schema + ETL) for analytics and cyclic reviews.

Instead of every department reinventing its own ticketing spreadsheet or inbox rules, Orgo provides one schema-driven engine that multiple domains can plug into.

---

## When you would use Orgo

Typical use-cases:

- incident / safety / maintenance tracking across many sites;
- HR & wellbeing cases that must stay auditable and privacy-aware;
- education or NGO workflows (student wellbeing, community incidents, campaigns);
- cross-cutting “pattern detection” (repeated harassment, safety issues, failure modes);
- any context where you want:
  - a single Case/Task model,
  - strong routing and escalation rules,
  - clear review loops and analytics.

---

## Core concepts (short version)

- **Multi-tenant backbone**  
  One deployment can serve many organizations. Everything is scoped by `organization_id` and governed by RBAC (roles, permissions, profiles).

- **Signals → Cases → Tasks**  
  Messy input (email, API call, form, offline import) becomes a structured Case plus one or more Tasks. Tasks are the atomic unit of work; Cases are long-lived containers for situations, incidents, audits, or patterns.

- **Labels & routing**  
  A structured label encodes “where this lives in the org” and “what kind of signal it is”.

Example label format:

```txt
BASE.CATEGORY.SUBCATEGORY.HORIZONTAL_ROLE
# e.g. 1001.91.Operations.Safety
````

The label drives routing, default visibility and how analytics are grouped.

* **Profiles**
  Profiles tune behaviour per org type (friend group, school, hospital, NGO, retail chain, etc.): reactivity / escalation timings, privacy defaults, notification scope, logging depth, pattern sensitivity, and review cadence.

* **Insights & cyclic overview**
  A read-optimized layer (star schema + ETL jobs) powers dashboards and scheduled reviews (weekly / monthly / yearly). Thresholds (“≥ N similar incidents in X days”) can automatically open new audit or review Cases instead of being just charts.

For a deeper conceptual tour, see the Orgo wiki.

---

## High-level architecture

Orgo is implemented as a TypeScript monorepo:

* **API (`apps/api`)** – NestJS backend with modules for:

  * multi-tenant orgs, users and persons;
  * email gateway & workflow engine;
  * task and case services;
  * notifications, logging, and configuration.

* **Web UI (`apps/web`)** – Next.js frontend using RTK Query:

  * queues / views over Tasks and Cases;
  * org / profile administration screens;
  * Insights and review dashboards.

* **Database / config** – relational database (PostgreSQL/SQLite) plus YAML-driven configuration under `config/` for environments, organizations, domain modules, and insights.

* **Insights** – ETL jobs hydrate `insights.dim_*` and `insights.fact_*` tables used by reports and cyclic review logic.

The `Documentation/` directory contains the more formal Orgo v3 spec (schema reference, core services, insights config, profiles and cyclic overview).

---

## Repository layout

Common top-level paths:

* `apps/api/` – NestJS API (core services, domain modules)
* `apps/web/` – Next.js web UI (queues, cases, tasks, insights)
* `Documentation/` – Orgo v3 specification (DB schema, invariants, services, insights, profiles, cyclic overview)
* `config/` – Environment/org/module configuration (YAML), validated on startup
* `package-scripts.js` – Monorepo scripts (dev, build, test)
* `turbo.json` – Turbo configuration for orchestrating tasks
* `docker-compose.yml` – Draft Docker orchestration (WIP / may change)
* `ai_dumps/` – Internal AI planning / design artefacts (not required for usage)

---

## Getting started (local dev)

### Prerequisites

* Node.js (recent LTS)
* Yarn classic 1.x (the repo is wired to `yarn@1.22.x`)
* A running PostgreSQL or SQLite instance for dev (depending on your local config)
* Git

### 1. Clone and install

```bash
git clone https://github.com/Rejean-McCormick/Orgo.git
cd Orgo

# Install dependencies with Yarn 1.x
yarn install
```

### 2. Run everything in dev

From the repo root:

```bash
# API + web in parallel (via Turbo)
yarn dev
```

This runs the monorepo dev scripts (Turbo) which start:

* API on `http://localhost:5002`
* Web UI on `http://localhost:3000`

Then:

* open the web app: `http://localhost:3000/`
* open the API docs (Swagger): `http://localhost:5002/docs`

### 3. Run apps separately (optional)

If you prefer separate terminals:

```bash
# API (NestJS)
cd apps/api
yarn dev

# Web UI (Next.js)
cd apps/web
yarn dev
```

Ports are the same as above (5002 for API, 3000 for web).

---

## Configuration & environments

Orgo treats configuration as code and uses YAML files per environment and organization.

* **Environments**

```txt
dev, staging, prod, offline
```

* **Configuration layers**

  * global defaults (logging, timezones, base reactivity windows);
  * environment overrides (dev / staging / prod / offline);
  * per-organization config (profile selection, routing ranges, label sets);
  * domain module config (maintenance, HR, education, etc.).

Each YAML config typically includes metadata like:

```yaml
metadata:
  config_name: "email_config"
  version: "3.x"
  environment: "<dev|staging|prod|offline>"
  last_updated: "YYYY-MM-DD"
  owner: "team-or-role"
  organization_id: "default"  # or specific org slug/id
```

Validation scripts enforce allowed environments, version ranges and required metadata, and will fail fast or fall back to safe defaults if something is invalid.

---

## Extending Orgo

You can extend Orgo without forking the whole engine.

### New domain workflow

1. **Define labels & task types**
   Decide which label patterns and task types/subtypes the domain cares about.

2. **Add domain config**
   Under `domain_modules/<domain>/rules/*.yaml`, specify:

   * label matches;
   * default severity, reactivity windows and visibility;
   * assignment rules and optional auto-created tasks.

3. **Hook into core services (optional)**
   Implement callbacks like `on_task_create`, `on_task_update`, `on_escalation` if the domain needs extra behaviour.

4. **Templates & notifications**
   Add email/report templates under `domain_modules/<domain>/templates`.

5. **Tests**
   Add unit tests for rule matching and integration tests for end-to-end flows (signal → case → tasks → escalation → resolution).

### New profile

1. Start from a reference profile (e.g. “hospital”, “school”, “retail chain”).
2. Override:

   * reactivity windows,
   * privacy defaults,
   * notification scope,
   * logging depth,
   * pattern sensitivity.
3. Attach the profile to an organization via its org config.

---

## Documentation & wiki

* **Docs bundle (in-repo)** – see `Documentation/` for:

  * database schema reference;
  * global invariants & enums (status, priority, severity, visibility, log categories);
  * core services specification (workflow engine, email gateway, notification & logging);
  * insights module configuration;
  * profiles & cyclic overview.

* **Wiki (online)** – the Orgo wiki provides a narrative overview:

  * conceptual model (multi-tenant backbone, signals → Cases → Tasks, labels, profiles);
  * architecture overview and data contracts;
  * cyclic review & pattern detection;
  * example profiles and use cases.

* **External explainer** – a broader civic/organizational context for Orgo lives on the public site that explains how Orgo fits into larger knowledge and coordination workflows.

---

## License

MIT. See [`LICENSE`](./LICENSE).

```
::contentReference[oaicite:0]{index=0}
```
