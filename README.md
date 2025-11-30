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
  Example label format: `BASE.CATEGORY.SUBCATEGORY.HORIZONTAL_ROLE`  
  Example value: `1001.91.Operations.Safety`  

  The label drives routing, default visibility and how analytics are grouped.

- **Profiles**  
  Profiles tune behaviour per org type (friend group, school, hospital, NGO, retail chain, etc.): reactivity / escalation timings, privacy defaults, notification scope, logging depth, pattern sensitivity, and review cadence.

- **Insights & cyclic overview**  
  A read-optimized layer (star schema + ETL jobs) powers dashboards and scheduled reviews (weekly / monthly / yearly). Thresholds (“≥ N similar incidents in X days”) can automatically open new audit or review Cases instead of being just charts.

For a deeper conceptual tour, see the Orgo wiki.

---

## High-level architecture

Orgo is implemented as a TypeScript monorepo:

- **API (`apps/api`)** – NestJS backend with modules for:
  - multi-tenant orgs, users and persons;
  - email gateway & workflow engine;
  - task and case services;
  - notifications, logging, and configuration.

- **Web UI (`apps/web`)** – Next.js frontend using RTK Query:
  - queues / views over Tasks and Cases;
  - org / profile administration screens;
  - Insights and review dashboards.

- **Database / config** – relational database (PostgreSQL/SQLite) plus YAML-driven configuration under `config/` for environments, organizations, domain modules, and insights.

- **Insights** – ETL jobs hydrate `insights.dim_*` and `insights.fact_*` tables used by reports and cyclic review logic.

The `Documentation/` directory contains the more formal Orgo v3 spec (schema reference, core services, insights config, profiles and cyclic overview).

---

## Repository layout

Common top-level paths:

- `apps/api/` – NestJS API (core services, domain modules)
- `apps/web/` – Next.js web UI (queues, cases, tasks, insights)
- `Documentation/` – Orgo v3 specification (DB schema, invariants, services, insights, profiles, cyclic overview)
- `config/` – Environment/org/module configuration (YAML), validated on startup
- `package-scripts.js` – Monorepo scripts (dev, build, test)
- `turbo.json` – Turbo configuration for orchestrating tasks
- `docker-compose.yml` – Draft Docker orchestration (WIP / may change)
- `ai_dumps/` – Internal AI planning / design artefacts (not required for usage)

---

## Getting started (local dev)

### Prerequisites

- Node.js (recent LTS)
- Yarn classic 1.x (the repo is wired to `yarn@1.22.x`)
- A running PostgreSQL or SQLite instance for dev (depending on your local config)
- Git

### 1. Clone and install

```bash
git clone https://github.com/Rejean-McCormick/Orgo.git
cd Orgo

# Install dependencies with Yarn 1.x
yarn install
