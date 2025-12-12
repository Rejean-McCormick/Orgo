# Orgo

> Multi-tenant “nervous system” for organizations: capture signals, turn them into structured Cases and Tasks, route work by labels & roles, and surface patterns over time.

-----

## Status

**Experimental / Pre-Alpha.**
APIs, schema, and UI are subject to change. Do not treat this as a stable product yet.

-----

## What Orgo does

Orgo is a shared backbone for operational work across many organizations and domains.

It:

  - **Ingests signals** from email, APIs, UIs, and offline imports.
  - **Normalizes** everything into a strict **Case** (situation) and **Task** (action) schema.
  - **Routes work** using a standardized **Label** + **Role** system.
  - **Tracks** escalation, visibility, and review cycles against configurable "Reactivity Time".
  - **Feeds Insights** (Star Schema + ETL) for analytics and cyclic pattern detection.

Instead of every department reinventing its own ticketing spreadsheet or inbox rules, Orgo provides one schema-driven engine that multiple domains can plug into.

-----

## When you would use Orgo

Typical use-cases:

  - **Operations:** Incident / safety / maintenance tracking across many sites.
  - **Care:** HR & wellbeing cases that must stay auditable and privacy-aware.
  - **Community:** Education or NGO workflows (student wellbeing, community incidents, campaigns).
  - **Pattern Detection:** Cross-cutting analysis (repeated harassment, safety issues, failure modes).

Use Orgo when you want:

  - A single Case/Task model.
  - Strong routing and escalation rules.
  - Clear review loops and analytics.

-----

## Core concepts

  - **Multi-tenant backbone**
    One deployment can serve many organizations. Everything is scoped by `organization_id` and governed by RBAC (roles, permissions, profiles).

  - **Signals → Cases → Tasks**
    Messy input (email, API call, form, offline import) becomes a structured Case plus one or more Tasks. Tasks are the atomic unit of work; Cases are long-lived containers for situations, incidents, audits, or patterns.

  - **Labels & routing**
    A structured label encodes "where this lives in the org" and "what kind of signal it is".

      * **Format:** `BASE.CATEGORY.SUBCATEGORY.HORIZONTAL_ROLE`
      * **Example:** `1001.91.Operations.Safety`
        The label drives routing, default visibility, and how analytics are grouped.

  - **Profiles**
    Profiles tune behavior per org type (e.g., "Friend Group" vs. "Hospital" vs. "Retail Chain"). They control:

      * Reactivity / Escalation timing (e.g., 1 hour vs. 3 days).
      * Privacy defaults (Open vs. Need-to-know).
      * Notification scope.
      * Pattern sensitivity.

  - **Insights & cyclic overview**
    A read-optimized layer (star schema + ETL jobs) powers dashboards and scheduled reviews (weekly / monthly / yearly). Thresholds (e.g., "≥ 5 similar incidents in 30 days") can automatically open new audit or review Cases instead of just generating charts.

-----

## High-level architecture

Orgo is implemented as a TypeScript monorepo:

  - **API (`apps/api`)** – NestJS backend with modules for:

      - Multi-tenant orgs, users, and persons.
      - Email gateway & Workflow engine.
      - Task and Case services.
      - Notifications, Logging, and Configuration.

  - **Web UI (`apps/web`)** – Next.js frontend using RTK Query:

      - Queues / Views over Tasks and Cases.
      - Org / Profile administration screens.
      - Insights and review dashboards.

  - **Database / Config** – Relational database (PostgreSQL/SQLite) plus YAML-driven configuration under `config/` for environments, organizations, domain modules, and insights.

  - **Insights** – ETL jobs hydrate `insights.dim_*` and `insights.fact_*` tables used by reports and cyclic review logic.

-----

## Repository layout

  - `apps/api/` – NestJS API (core services, domain modules)
  - `apps/web/` – Next.js web UI (queues, cases, tasks, insights)
  - `Docs/` – Orgo v3 specification (DB schema, invariants, services, insights, profiles)
  - `charters/` – Wikidata-based property definitions (`properties_core.json`, etc.)
  - `config/` – Environment/org/module configuration (YAML), validated on startup
  - `package-scripts.js` – Monorepo scripts (dev, build, test)
  - `turbo.json` – Turbo configuration for orchestrating tasks
  - `docker-compose.yml` – Draft Docker orchestration

-----

## Getting started (local dev)

### Prerequisites

  - Node.js (recent LTS)
  - Yarn classic 1.x (repo is wired to `yarn@1.22.x`)
  - A running PostgreSQL or SQLite instance
  - Git

### 1\. Clone and install

```bash
git clone https://github.com/Rejean-McCormick/Orgo.git
cd Orgo

# Install dependencies with Yarn 1.x
yarn install
```

### 2\. Run everything in dev

From the repo root:

```bash
# API + web in parallel (via Turbo)
yarn dev
```

This runs the monorepo dev scripts (Turbo) which start:

  - API on `http://localhost:5002`
  - Web UI on `http://localhost:3000`

Then:

  - Open the web app: `http://localhost:3000/`
  - Open the API docs (Swagger): `http://localhost:5002/docs`

### 3\. Run apps separately (optional)

If you prefer separate terminals:

**API (NestJS):**

```bash
cd apps/api
yarn dev
```

**Web UI (Next.js):**

```bash
cd apps/web
yarn dev
```

-----

## Configuration & environments

Orgo treats configuration as code and uses YAML files per environment and organization.

  - **Environments**: `dev`, `staging`, `prod`, `offline`
  - **Layers:**
    1.  Global defaults (logging, timezones).
    2.  Environment overrides.
    3.  Per-organization config (profile selection, label sets).
    4.  Domain module config.

Validation scripts enforce allowed environments, version ranges, and required metadata on startup.

-----

## Extending Orgo

You can extend Orgo without forking the whole engine.

### New domain workflow

1.  **Define labels & task types:** Decide which label patterns and task types/subtypes the domain cares about.
2.  **Add domain config:** Specify label matches, default severity, and assignment rules in `domain_modules/<domain>/rules/*.yaml`.
3.  **Hook into core services (optional):** Implement callbacks like `on_task_create` if the domain needs extra behavior.
4.  **Templates:** Add email/report templates.

### New profile

1.  **Start from reference:** Copy an existing profile (e.g., "Hospital").
2.  **Override:** Change reactivity windows, privacy defaults, and pattern sensitivity.
3.  **Attach:** Link the profile to an organization via its org config.

-----

## Documentation & Wiki

  - **Docs bundle (`Docs/`)**: Formal technical specs (schema, invariants, enums).
  - **Wiki (Online)**: Narrative overview of concepts and architecture.
  - **Charters (`charters/`)**: The JSON definitions of the semantic graph properties (Wikidata standards).

-----

## License

MIT. See [`LICENSE`](https://www.google.com/search?q=./LICENSE).