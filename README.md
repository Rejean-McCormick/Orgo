Here is an improved `README.md` you can drop into the Orgo repo:

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

- Ingests signals from email, APIs, UIs and offline imports.
- Normalizes everything into a strict Case / Task schema.
- Routes work using a standardized label + role system.
- Tracks escalation, visibility and review cycles across organizations.
- Feeds an Insights layer (star schema + ETL) for analytics and cyclic reviews.

Instead of every department reinventing its own ticketing spreadsheet or inbox rules, Orgo provides one schema-driven engine that multiple domains can plug into.

---

## When you would use Orgo

Typical use-cases:

- Incident / safety / maintenance tracking across many sites.
- HR & wellbeing cases that must stay auditable and privacy-aware.
- Education or NGO workflows (student wellbeing, community incidents, campaigns).
- Cross-cutting “pattern detection” (repeated harassment, safety issues, failure modes).
- Any context where you want:
  - A single Case/Task model,
  - Strong routing and escalation rules,
  - Clear review loops and analytics.

---

## Core concepts (short version)

- **Multi-tenant backbone**  
  One deployment can serve many organizations. Everything is scoped by `organization_id` and governed by RBAC (roles, permissions, profiles).

- **Signals → Cases → Tasks**  
  Messy input (email, API call, form, offline import) becomes a structured Case plus one or more Tasks. Tasks are the atomic unit of work; Cases are long-lived containers for situations, incidents, audits, or patterns.

- **Labels & routing**  
  A structured label encodes “where this lives in the org” and “what kind of signal it is”, e.g.:

  ```text
  <BASE>.<CATEGORY><SUBCATEGORY>.<HORIZONTAL_ROLE?>
  # e.g. 1001.91.Operations.Safety
````

The label drives routing, default visibility and how analytics are grouped.

* **Profiles**
  Profiles tune behaviour per org type (friend group, school, hospital, NGO, retail chain, etc.): reactivity / escalation timings, privacy defaults, notification scope, logging depth, pattern sensitivity, and review cadence.

* **Insights & cyclic overview**
  A read-optimized layer (star schema + ETL jobs) powers dashboards and scheduled reviews (weekly/monthly/yearly). Thresholds (“≥ N similar incidents in X days”) can automatically open new audit or review Cases instead of being just charts.

For a deeper conceptual tour, see the [Orgo wiki](https://github.com/Rejean-McCormick/Orgo/wiki).

---

## High-level architecture

Orgo is implemented as a TypeScript monorepo:

* **API (`apps/api`)**
  NestJS backend, with modules for:

  * multi-tenant orgs, users and persons,
  * email gateway & workflow engine,
  * task and case services,
  * notifications, logging, and configuration.

* **Web UI (`apps/web`)**
  Next.js frontend using RTK Query for data access. It exposes:

  * queues / views over Tasks and Cases,
  * org / profile administration screens,
  * Insights and review dashboards.

* **Database / config**
  A relational database (PostgreSQL/SQLite) plus YAML-driven configuration under `/config` for environments, organizations, domain modules, and insights.

* **Insights**
  ETL jobs hydrate `insights.dim_*` and `insights.fact_*` tables used by reports and cyclic review logic.

The `Documentation/` directory contains the more formal Orgo v3 spec (schema reference, core services, insights config, profiles and cyclic overview).

---

## Repository layout

Common top-level paths:

* `apps/api/` – NestJS API (core services, domain modules).
* `apps/web/` – Next.js web UI (queues, cases, tasks, insights).
* `Documentation/` – Orgo v3 specification (DB schema, invariants, services, insights, profiles, cyclic overview).
* `config/` – Environment/org/module configuration (YAML), validated on startup.
* `package-scripts.js` – Monorepo scripts (dev, build, test).
* `turbo.json` – Turbo configuration for orchestrating tasks.
* `docker-compose.yml` – Draft Docker orchestration (WIP / may change).
* `ai_dumps/` – Internal AI planning / design artefacts (not required for usage).

---

## Getting started (local dev)

### Prerequisites

* Node.js (recent LTS).
* Yarn classic 1.x (the repo is wired to `yarn@1.22.x` as its package manager).
* A running PostgreSQL or SQLite instance for dev (depending on your local config).
* Git.

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

* Open the web app: `http://localhost:3000/`
* Open the API docs (Swagger): `http://localhost:5002/docs`

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

The ports are the same as above (5002 for API, 3000 for web).

---

## Configuration & environments

Orgo treats configuration as code and uses YAML files per environment and organization.

* **Environments**

  ```text
  dev, staging, prod, offline
  ```

* **Configuration layers**

  * Global defaults (logging, timezones, base reactivity windows).
  * Environment overrides (dev/staging/prod/offline).
  * Per-organization config (profile selection, routing ranges, label sets).
  * Domain module config (maintenance, HR, education, etc.).

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

Typical steps:

1. **Define labels & task types**
   Decide which label patterns and task types/subtypes the domain cares about.

2. **Add domain config**
   Under `domain_modules/<domain>/rules/*.yaml`, specify:

   * label matches,
   * default severity, reactivity windows and visibility,
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

* **Docs bundle (in-repo)**
  See `Documentation/` for:

  * Database schema reference,
  * Global invariants & enums (status, priority, severity, visibility, log categories),
  * Core services specification (workflow engine, email gateway, notification & logging),
  * Insights module configuration,
  * Profiles & cyclic overview.

* **Wiki (online)**
  The [Orgo wiki](https://github.com/Rejean-McCormick/Orgo/wiki) provides a narrative overview:

  * Conceptual model (multi-tenant backbone, signals → Cases → Tasks, labels, profiles),
  * Architecture overview and data contracts,
  * Cyclic review & pattern detection,
  * Example profiles and use cases.

* **External explainer**
  A broader civic/organizational context for Orgo lives on the public site that explains how Orgo fits into larger knowledge and coordination workflows.

---

## License

MIT. See [`LICENSE`](./LICENSE).

```

Notes (for you, not for the README text itself):

- The dev commands (`yarn install`, `yarn dev`, API on 5002, web on 3000) are taken from your Orgo setup notes, which specify Yarn classic as the canonical package manager and describe the Turbo-driven dev flow. :contentReference[oaicite:0]{index=0}  
- The description of Orgo as a multi-tenant nervous system, the label system, profiles, and the high-level architecture are aligned with the existing README and the Orgo wiki (conceptual overview, core concepts, architecture and data contracts). :contentReference[oaicite:1]{index=1}  
- The sections on environments (`dev`, `staging`, `prod`, `offline`), invariants, and configuration directory structure are condensed from the Orgo v3 documentation bundle (global invariants, config system, and schema reference). :contentReference[oaicite:2]{index=2} :contentReference[oaicite:3]{index=3}
::contentReference[oaicite:4]{index=4}
```
