<!-- INDEX: Doc 6 – Insights Module Config Parameters (Orgo v3) -->
Index

Scope, dependencies and baseline
1.1 Scope of Insights module
1.2 Canonical enums overlay for Insights
1.3 Documentation dependencies & cross‑references
1.4 Orgo v3 Insights tech stack baseline

Configuration parameters and invariants
2.1 Data retention and purge (analytics layer)
2.2 Backup and recovery policies
2.3 Cache TTLs and aggregation windows
2.4 Export limits and privacy safeguards
2.5 Access control and routing invariants
2.6 Environment‑specific defaults overview

Insights config schema (/config/insights/config.yaml)
3.1 Top‑level structure (insights: subtree)
3.2 Profiles and pattern settings (default_profile_key, overrides_by_domain)

ETL and Airflow job configuration
4.1 DAG inventory (daily/weekly/monthly/yearly jobs, cache warmup)
4.2 Job‑level constraints and invariants

Environment variables and secrets (Insights slice)

Deployment, scaling and monitoring (Insights slice)
6.1 Runtime components
6.2 Scaling policies
6.3 Monitoring metrics and alerts

Cross‑document alignment notes
7.1 Tech stack alignment
7.2 Enum consistency
7.3 Profiles vs Insights config
7.4 Environment‑specific defaults vs global ENVIRONMENT


# Document 6 – Insights Module Config Parameters (Orgo v3)

This document defines configuration parameters and operational constraints for the **Insights / Analytics module** in Orgo v3.

It is a **module‑scoped parameter overlay** on top of:

* Doc 1 – Database Schema Reference (Custom Tables; includes the `insights.*` star schema).
* Doc 2 – Foundations, Locked Variables & Operational Checklists (enums, `ENVIRONMENT`, config invariants).
* Doc 7 – Organization Profiles & Cyclic Overview Settings (profiles schema and pre‑configured profiles).
* Doc 8 – Cyclic Overview, Labels & Universal Flow Rules (Case/Task JSON contracts, cyclic review semantics, pattern rules).

Core services (task ingestion, routing, workflow engine, email gateway, domain modules) are specified in Docs 3–5. This document **does not redefine core behaviour**; it only configures how Insights/analytics ingest, store, aggregate and expose data.

---

## 1. Scope, Dependencies and Baseline

### 1.1 Scope

The Insights module covers:

* Analytical storage (star schema, materialized views, pattern tables).
* ETL and Airflow jobs that hydrate the analytics warehouse / star schema.
* Pattern detection and cyclic overview computations.
* Read‑only reporting APIs and caches used by dashboards.
* Module‑specific retention, backup and export limits for analytics data.

Out of scope here:

* Core operational task/case tables (Doc 1).
* Global parameter matrix and environment definitions (Doc 2).
* UI page specifications and dashboard layouts (interface/UX and frontend documentation).
* API contracts for the reporting service (`reports-api`) (see code/API mapping in Doc 4 and related interface docs).
* Infrastructure and monitoring details beyond what is needed to parameterize Insights (Core Services / infrastructure & operations documentation, including Doc 5).

### 1.2 Canonical Enums Overlay for Insights

The Insights module **reuses** the global enums defined in Doc 2. For clarity, they are restated here and must remain identical to Doc 2.

**TASK_STATUS**

* `PENDING`
* `IN_PROGRESS`
* `ON_HOLD`
* `COMPLETED`
* `FAILED`
* `ESCALATED`
* `CANCELLED`

**TASK_PRIORITY**

* `LOW`
* `MEDIUM`
* `HIGH`
* `CRITICAL`

**TASK_SEVERITY**

* `MINOR`
* `MODERATE`
* `MAJOR`
* `CRITICAL`

**VISIBILITY**

* `PUBLIC`
* `INTERNAL`
* `RESTRICTED`
* `ANONYMISED`

**ENVIRONMENT**

* `"dev"`
* `"staging"`
* `"prod"`
* `"offline"`

Rules:


 * Analytics tables in the `insights.*` schema store the **same tokens** as the operational enums, but as **TEXT** columns (even on Postgres) to decouple the warehouse from OLTP enum DDL.
 * For non‑Postgres warehouses (`warehouse.type != "postgres"`), the values MUST appear as the **exact same tokens** at rest (upper‑snake), stored as generic string types.
* Any change to these enums in Doc 2 must be mirrored in this section and in the analytics DDL in Doc 1 (Module 14 – Analytics / Insights Star‑Schema) and any derived warehouse schemas.

### 1.3 Documentation Dependencies and Cross‑References

This document assumes the following:

* **Doc 1 – Database Schema Reference (Custom Tables)**

  * Defines `insights.*` tables (facts, dimensions, pattern tables, materialized views).
  * Parameters in this document such as retention windows and partitioning assumptions apply to those tables.

* **Doc 2 – Foundations, Locked Variables & Operational Checklists**

  * Is the **canonical source** for enums listed in §1.2 and for `ENVIRONMENT`.
  * Defines global config structure/validation and guardrails (visibility, audit, exports).
  * This document only declares module‑specific defaults; it does not introduce new enum values.

* **Doc 7 – Organization Profiles & Cyclic Overview Settings**

  * Defines the **profiles schema** (YAML `profiles:`) and the pre‑configured profiles (`friend_group`, `hospital`, `advocacy_group`, `retail_chain`, etc.).
  * This document references those profile keys as configuration values (e.g. `default_profile_key`, overrides).

* **Doc 8 – Cyclic Overview, Labels & Universal Flow Rules**

  * Defines:

    * Label semantics and Case/Task JSON contracts at the API boundary.
    * Task and Case status lifecycles and allowed transitions.
    * Cyclic overview rules for weekly / monthly / yearly reviews.
    * Threshold semantics (e.g., “≥ N similar incidents in window_days”).

All pattern windows, thresholds and review frequencies in this document must be compatible with the cyclic definitions in Doc 8 and the profiles in Doc 7.

### 1.4 Orgo v3 Insights Tech Stack Baseline

The Insights module uses a **Python + Airflow + Postgres + Redis** stack dedicated to analytics. Core Orgo services may run on a different stack (e.g., NestJS + Prisma + Next.js + RTK Query + Postgres); that separation is intentional.

| Aspect                  | Orgo v3 Insights Baseline                          | Notes                                                                                     |
| ----------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Analytics runtime       | Python **3.11.6**                                  | Used by ETL workers and analytics services.                                               |
| Orchestration           | Apache Airflow **2.8.x**                           | Manages ETL DAGs and pattern detection jobs.                                              |
| Warehouse / DB          | PostgreSQL **15.x**                                | Same major version as core DB; may be a separate instance or host the `insights` schema.  |
| Cache                   | Redis **7.x**                                      | Used for report result caching and dashboard pre‑computation.                             |
| Reporting API (logical) | `reports-api` (read‑only service over star schema) | Implementation and code mapping described in Doc 4; this document constrains config only. |

Clarifications:

* **Core DB**: Doc 1/5 designate Postgres 15+ as the core OLTP engine; Insights uses Postgres 15+ for the analytics star schema (`insights.*`).
* **Redis & Airflow** in this document are **analytics‑specific components**. Core services may use Redis for other caching or queues, but the parameters here govern **only** the Insights use cases.

---

## 2. Configuration Parameters and Invariants

This section defines the main operational parameters for the Insights module, grouped by concern. These values are applied per‑environment as described in §2.6.

### 2.1 Data Retention and Purge (Analytics Layer)

These parameters apply to **analytics storage**, not to operational task/case tables. Profiles in Doc 7 may have their own `data_retention_policy`; that governs **operational** data, not necessarily analytics copies.

* **`analytics.raw_event_retention_days`**

  * Definition: Number of days to retain raw events in the base fact tables in the `insights` schema (e.g. `insights.fact_tasks`, `insights.fact_cases`, `insights.fact_wellbeing_checkins`).
  * Defaults:

    * `dev`: 730
    * `staging`: 730
    * `prod`: 730
  * Invariants:

    * Must be **≥ max** of all pattern windows defined in `insights.patterns.*.window_days` (§3.2).
    * Does **not** need to be ≥ all profile‑level retention values; analytics can keep a subset of long‑term history if storage is constrained.

* **`analytics.aggregated_retention_days`**

  * Definition: Days to retain aggregated snapshots and materialized views (e.g., monthly summary tables).
  * Defaults:

    * `dev`: 90
    * `staging`: 730
    * `prod`: 3650 (10 years)
  * Invariants:

    * Must be ≥ `analytics.raw_event_retention_days` for any aggregate that depends only on those events.
    * Large aggregates may be down‑sampled (e.g., yearly rollups) without violating profile‑level `data_retention_policy`.

* **`analytics.pattern_result_retention_days`**

  * Definition: Days to retain computed pattern records (pattern tables and pattern snapshot tables produced by cyclic overview jobs).
  * Defaults:

    * `dev`: 90
    * `staging`: 730
    * `prod`: 1825 (5 years)
  * Invariants:

    * Must be ≥ the longest review horizon in Doc 8 (yearly systemic review).

### 2.2 Backup and Recovery Policies

These parameters govern the analytics warehouse and ETL metadata (Airflow database). They are independent of core DB backup policies.

* **`analytics.backup.rpo_minutes`**

  * Definition: Recovery Point Objective for analytics data (maximum acceptable data loss).
  * Defaults:

    * `dev`: 1440 (daily backup)
    * `staging`: 60
    * `prod`: 15
  * Invariants:

    * Must be ≤ the shortest cyclic overview window used for critical compliance patterns.

* **`analytics.backup.rto_minutes`**

  * Definition: Recovery Time Objective for analytics services.
  * Defaults:

    * `dev`: 1440 (best effort)
    * `staging`: 240
    * `prod`: 60

*Backup strategy (descriptive)*

* Warehouse backups:

  * Nightly full backup for `staging` and `prod`.
  * Hourly WAL/LSN‑based incremental for `prod`.
* Airflow metadata:

  * Snapshot at least daily in `staging`, every 4 hours in `prod`.
* Offline / `offline` environment:

  * No automatic backups; manual exports only.

### 2.3 Cache TTLs and Aggregation Windows

These parameters drive Redis caching and derived aggregation behaviour.

* **`analytics.cache.ttl_seconds.dashboard_default`**

  * Definition: Default cache TTL for dashboard queries in `reports-api`.
  * Default: `300` seconds (5 minutes) in all environments.
  * Invariants:

    * `reports-api` must use this as its default TTL for non‑streaming endpoints.

* **`analytics.cache.ttl_seconds.dashboard_slow`**

  * Definition: TTL for expensive aggregated dashboards.
  * Defaults:

    * `dev`: 60
    * `staging`: 600
    * `prod`: 900

* **`analytics.cache.ttl_seconds.streaming_like`**

  * Definition: TTL for endpoints that mimic near‑real‑time behaviour (if any).
  * Default: `30` seconds.

* **`analytics.cache.max_keys_per_dashboard`**

  * Definition: Upper bound on the number of distinct cache keys per dashboard per environment.
  * Defaults:

    * `dev`: 100
    * `staging`: 1_000
    * `prod`: 5_000

### 2.4 Export Limits and Privacy Safeguards

These parameters guard against over‑large exports and enforce privacy requirements.

* **`analytics.export.max_rows_per_export`**

  * `dev`: 100_000
  * `staging`: 100_000
  * `prod`: 50_000

* **`analytics.export.max_parallel_exports_per_user`**

  * `dev`: 5
  * `staging`: 3
  * `prod`: 2

* **`analytics.export.pii_masking_enabled`**

  * Boolean, default `true` for all environments.
  * Semantics:

    * When `true`, the reporting layer masks or hashes columns designated as PII by the schemas and guardrails in Doc 1/Doc 2 (and any dedicated security/privacy documentation).
    * The masking rules must be compatible with `VISIBILITY` semantics in Doc 2 and case/task metadata visibility in Doc 8.

* **`analytics.export.allowed_visibilities`**

  * Array of `VISIBILITY` values allowed to appear in exports:

    * Default: `["PUBLIC", "INTERNAL"]`.
  * Tasks/cases with `RESTRICTED` or `ANONYMISED` visibility may only be exported in aggregated or anonymised form.

### 2.5 Access Control and Routing Invariants

These rules define how visibility, roles and profiles interact in the analytics slice.

* `analytics.access.public_roles` – roles allowed to see **PUBLIC** analytics.
* `analytics.access.internal_roles` – roles allowed to see **INTERNAL** analytics.
* `analytics.access.restricted_roles` – roles allowed to see **RESTRICTED** analytics.
* `analytics.access.anonymised_roles` – roles allowed to see fully anonymised pattern outputs even from sensitive domains.

Invariants:

* For any given dashboard:

  * The minimum required `VISIBILITY` for every underlying task/case determines the minimum role required to view that dashboard.
* Access rules must be **consistent** with:

  * Case access control in Doc 8.
  * Role definitions and RBAC/guardrails in Doc 2 and the Core Services/security specs (Doc 5 and any dedicated security documentation).

### 2.6 Environment‑Specific Defaults Overview

For quick reference, the main environment‑dependent values from §§2.1–2.4 are summarized here:

* **`ENVIRONMENT = "dev"`**

  * Small data volumes, rapid schema evolution.
  * `analytics.raw_event_retention_days = 730`
  * `analytics.aggregated_retention_days = 90`
  * `analytics.pattern_result_retention_days = 90`
  * `analytics.backup.rpo_minutes = 1440`
  * `analytics.backup.rto_minutes = 1440`
  * `analytics.export.max_rows_per_export = 100_000`

* **`ENVIRONMENT = "staging"`**

  * Near‑prod realistic loads.
  * `analytics.raw_event_retention_days = 730`
  * `analytics.aggregated_retention_days = 730`
  * `analytics.pattern_result_retention_days = 730`
  * `analytics.backup.rpo_minutes = 60`
  * `analytics.backup.rto_minutes = 240`
  * `analytics.export.max_rows_per_export = 100_000`

* **`ENVIRONMENT = "prod"`**

  * Authoritative analytics environment.
  * `analytics.raw_event_retention_days = 730`
  * `analytics.aggregated_retention_days = 3650`
  * `analytics.pattern_result_retention_days = 1825`
  * `analytics.backup.rpo_minutes = 15`
  * `analytics.backup.rto_minutes = 60`
  * `analytics.export.max_rows_per_export = 50_000`

* **`ENVIRONMENT = "offline"`**

  * Used when analytics jobs must run in a disconnected environment.
  * No automated backups; ETL and exports may be disabled or run only on manually imported snapshots.

Doc 2 remains the canonical reference for allowed environment names; this section only provides module‑specific default values.

---

## 3. Insights Config Schema

This section defines a machine‑readable schema for Insights configuration, typically serialized as YAML in e.g. `/config/insights/config.yaml`.

All general config expectations (metadata, validation, per‑environment handling) are defined in Doc 2; this section defines the **`insights:`** subtree.

### 3.1 Top‑Level Structure

```yaml
insights:
  environment: "prod"             # must be one of: dev, staging, prod, offline

  warehouse:
    type: "postgres"              # "postgres" | "bigquery" | "snowflake"
    connection_url: "${INSIGHTS_WAREHOUSE_URL}"
    schema: "insights"
    read_only_user: "orgo_insights_ro"
    write_user: "orgo_insights_etl"

  etl:
    owner_email: "data-team@example.org"
    default_batch_size: 1000
    max_batch_size: 10000
    concurrency: 4

  cache:
    backend: "redis"
    url: "${INSIGHTS_REDIS_URL}"
    ttl_seconds:
      dashboard_default: 300
      dashboard_slow: 900
      streaming_like: 30
    max_keys_per_dashboard:
      dev: 100
      staging: 1000
      prod: 5000

  retention:
    raw_event_retention_days:
      dev: 730
      staging: 730
      prod: 730
    aggregated_retention_days:
      dev: 90
      staging: 730
      prod: 3650
    pattern_result_retention_days:
      dev: 90
      staging: 730
      prod: 1825

  backups:
    rpo_minutes:
      dev: 1440
      staging: 60
      prod: 15
    rto_minutes:
      dev: 1440
      staging: 240
      prod: 60

  exports:
    max_rows_per_export:
      dev: 100000
      staging: 100000
      prod: 50000
    max_parallel_exports_per_user:
      dev: 5
      staging: 3
      prod: 2
    pii_masking_enabled: true
    allowed_visibilities:
      - "PUBLIC"
      - "INTERNAL"

  patterns:
    default_profile_key: "default"   # must exist in Doc 7 profiles
    overrides_by_domain:
      maintenance: "hospital"
      hr_case: "advocacy_group"
      education_support: "retail_chain"
    weekly:
      window_days: 28
      min_events: 3
      min_distinct_sources: 1
    monthly:
      window_days: 180
      min_events: 5
      min_distinct_sources: 2
    yearly:
      window_days: 730
      min_events: 10
      min_distinct_sources: 3
    # Keys under `overrides_by_domain` MUST match canonical Task.type values
    # (for example: "maintenance", "hr_case", "education_support"), not arbitrary labels.


```

Notes:

* `insights.environment` must match both:

  * The `INSIGHTS_ENV` environment variable, and
  * One of the canonical `ENVIRONMENT` values from Doc 2.

* `warehouse.schema` is set to `"insights"` to match the canonical star schema in Doc 1; when an external warehouse is used, this schema may be mirrored there.

### 3.2 Profiles and Pattern Settings

* `default_profile_key` and values under `overrides_by_domain` must correspond to profile keys defined in Doc 7 (e.g. `friend_group`, `hospital`, `advocacy_group`, `retail_chain`, etc.).
* The value used in `default_profile_key` (e.g. `"default"`) **must** be defined as a real profile entry in the profiles YAML (Doc 7) alongside the other named profiles.
* Each profile defines (see Doc 2/7):

  * Reactivity time.
  * Transparency.
  * Escalation granularity.
  * Review frequency.
  * Notification scope.
  * Pattern sensitivity.
  * Severity escalation threshold.
  * Logging and traceability depth.
  * Data retention policy.

Relationship between profiles and Insights config:

* **Profiles** describe **behavioural expectations** and default metadata at the operational level.
* **Insights config** describes **how much data** is kept, how often analytics run, and which profile is used by default per domain.

If a profile includes a long `data_retention_policy` (e.g. hospital = 10 years) while `analytics.raw_event_retention_days` is shorter, analytics will not capture the full operational horizon but must, at minimum, retain data long enough to satisfy the cyclic pattern windows from Doc 8.

---

## 4. ETL and Airflow Job Configuration

This section defines the DAGs that populate the `insights.*` schema and compute patterns.

### 4.1 DAG Inventory (YAML‑Style)

```yaml
etl_dags:

  daily_events_load:
    id: "insights_daily_events_load"
    schedule: "0 2 * * *"   # daily at 02:00 UTC
    description: "Load operational tasks/cases into the insights fact tables (insights.fact_tasks, insights.fact_cases, insights.fact_wellbeing_checkins, etc.)"
    enabled_environments: ["staging", "prod"]
	queue_job_id: "orgo.analytics.export-facts"

  daily_dimensions_sync:
    id: "insights_daily_dimensions_sync"
    schedule: "30 2 * * *"
    description: "Sync dimension tables (organizations, roles, labels) into insights.dim_*"
    enabled_environments: ["staging", "prod"]
	queue_job_id: "orgo.analytics.export-facts"

  weekly_pattern_review:
    id: "insights_weekly_pattern_review"
    schedule: "0 3 * * 1"   # every Monday at 03:00 UTC
    description: "Compute weekly patterns based on patterns.weekly.window_days"
    enabled_environments: ["staging", "prod"]
	queue_job_id: "orgo.insights.weekly-pattern-review"

  monthly_trend_report:
    id: "insights_monthly_trend_report"
    schedule: "0 4 1 * *"   # first of each month
    description: "Generate monthly trend aggregates and store in summary tables / materialized views"
    enabled_environments: ["staging", "prod"]
	queue_job_id: "orgo.insights.monthly-trend-report"

  yearly_systemic_review:
    id: "insights_yearly_systemic_review"
    schedule: "0 5 1 1 *"   # January 1st
    description: "Compute yearly systemic patterns used by leadership overviews"
    enabled_environments: ["prod"]
	queue_job_id: "orgo.insights.yearly-systemic-review"

  cache_warmup_dashboards:
    id: "insights_cache_warmup_dashboards"
    schedule: "*/15 * * * *"  # every 15 minutes
    description: "Pre‑warm caches for high‑traffic dashboards"
    enabled_environments: ["staging", "prod"]
	queue_job_id: "orgo.insights.cache-warmup-dashboards"
```

### 4.2 Job‑Level Constraints and Invariants

* `weekly_pattern_review`:

  * Must use `patterns.weekly.window_days` from §3.1 and cyclic review semantics from Doc 8.
* `monthly_trend_report` and `yearly_systemic_review`:

  * Must derive thresholds and labels in a way compatible with the labels and categorization rules in Doc 8.
* All ETL DAGs:

  * Must treat `ENVIRONMENT = "offline"` as **no‑op**, unless explicitly enabled in offline deployments.
  * Must not mutate operational tables; they are read‑only consumers of the canonical Task and Case models.

---

## 5. Environment Variables and Secrets

These are the primary configuration variables for the Insights module. Values come from environment variables, secret managers (e.g., Vault, KMS) or config maps.

| Environment Variable              | Used By                       | Default / Example                      | Source & Notes                                                                               |
| --------------------------------- | ----------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------- |
| `INSIGHTS_ENV`                    | All insights components       | `dev` / `staging` / `prod` / `offline` | Must match `ENVIRONMENT` enum; used to select per‑environment defaults.                      |
| `INSIGHTS_WAREHOUSE_URL`          | ETL workers, `reports-api`    | `postgresql://.../orgo_analytics`      | Stored in secret manager; must point at the DB/warehouse hosting the `insights` star schema. |
| `INSIGHTS_REDIS_URL`              | `reports-api`, cache warmers  | `redis://redis:6379/1`                 | May share Redis instance with core, but uses separate DB/namespace.                          |
| `AIRFLOW__CORE__SQL_ALCHEMY_CONN` | Airflow scheduler & webserver | `postgresql+psycopg2://.../airflow`    | Airflow’s internal metadata DB.                                                              |
| `AIRFLOW__CORE__FERNET_KEY`       | Airflow                       | Random 32‑byte base64 key              | Key rotation rules defined in security/DevOps docs; secrets‑backed in prod.                  |
| `INSIGHTS_DEFAULT_PROFILE_KEY`    | `reports-api`, ETL            | `default`                              | Must match a profile in Doc 7; fallback when no domain override applies.                     |
| `INSIGHTS_PATTERN_CONFIG_PATH`    | ETL, pattern DAGs             | `/config/insights/patterns.yaml`       | Optional override for pattern thresholds; must respect schema in §3.1–3.2.                   |
| `INSIGHTS_EXPORT_S3_BUCKET`       | Export workers (if used)      | `orgo-insights-exports-prod`           | Required only when exports are stored in object storage.                                     |

Additional environment variables and secrets for monitoring and logging are covered in the core infrastructure / monitoring / security documentation (e.g. Docs 4–5 and any dedicated ops or security specs) and must be consistent with the base infrastructure configuration.

---

## 6. Deployment, Scaling and Monitoring (Insights Slice)

### 6.1 Runtime Components

Typical components (Kubernetes or equivalent):

* `reports-api` deployment
* `insights-etl-worker` deployment(s)
* `airflow-webserver`, `airflow-scheduler`, `airflow-worker` deployments
* `analytics-db` (Postgres 15.x) hosting the `insights.*` star schema, or a logical `insights` schema within the core Postgres instance
* `insights-redis` (Redis 7.x) cache

Recommended prod baseline:

| Component             | Replicas (prod) | CPU (req/limit) | RAM (req/limit) | Notes                                                 |
| --------------------- | --------------- | --------------- | --------------- | ----------------------------------------------------- |
| `reports-api`         | 3–8             | 250m / 1000m    | 512Mi / 2Gi     | HPA on CPU + request latency.                         |
| `insights-etl-worker` | 2–4             | 500m / 2000m    | 1Gi / 4Gi       | Scales with ETL backlog and DAG durations.            |
| `airflow-scheduler`   | 1               | 250m / 500m     | 512Mi / 1Gi     | Usually single instance.                              |
| `airflow-webserver`   | 1–2             | 250m / 500m     | 512Mi / 1Gi     | Primarily operator UI.                                |
| `airflow-worker`      | 2–6             | 500m / 2000m    | 1Gi / 4Gi       | Scales with number and duration of running tasks.     |
| `insights-redis`      | 1–3 (cluster)   | 250m / 1000m    | 512Mi / 2Gi     | May be a shared Redis cluster with logical isolation. |

### 6.2 Scaling Policies

Example HPA rules:

* `reports-api`:

  * Target: P95 latency ≤ 1000 ms, error rate ≤ 1%.
  * Scale out when CPU > 70% or P95 latency > 1000 ms for 5 minutes.
* `insights-etl-worker`:

  * Scale based on:

    * Number of runnable tasks in Airflow.
    * ETL job delay vs schedule (lag metrics defined below).

### 6.3 Monitoring and Alerts

Key Prometheus/Grafana metrics:

* `insights_etl_dag_failures_total{dag_id=...}`
* `insights_etl_dag_delay_minutes{dag_id=...}`
* `reports_api_request_duration_seconds{quantile="0.95"}`
* `reports_api_error_rate`
* `insights_redis_cache_hit_ratio`
* `analytics_db_cpu_usage`, `analytics_db_connections`

Suggested alerts:

* **ETL Failure**:

  * Condition: `insights_etl_dag_failures_total` increases for any critical DAG.
  * Action: Page on‑call data engineer; re‑run failed DAG if safe.

* **ETL Delay**:

  * Condition: `insights_etl_dag_delay_minutes > 60` for `daily_events_load` in `prod`.
  * Action: Investigate source system health, DB performance, and worker capacity.

* **Reporting Latency**:

  * Condition: `reports_api_request_duration_seconds{quantile="0.95"} > 1.0` for 10 min.
  * Action: Trigger autoscale and inspect slow queries.

* **Cache Hit Ratio Low**:

  * Condition: `insights_redis_cache_hit_ratio < 0.7` for 30 min.
  * Action: Review cache key strategy and TTLs in §2.3.

---

## 7. Cross‑Document Alignment Notes

This section encodes explicitly the alignment guidance so the document is self‑contained.

### 7.1 Tech Stack Alignment

* Insights uses **Python 3.11.6 + Airflow 2.8 + Postgres 15 + Redis 7** (§1.4).
* Core Orgo may use another stack (e.g., NestJS/Next.js/Prisma/Postgres) as defined in Docs 3–5.
* Postgres 15+ is common across both:

  * Core OLTP tables (Doc 1).
  * Analytics star schema (`insights.*` in Doc 1, Module 14 – Analytics / Insights Star‑Schema).
* Redis and Airflow parameters in this document apply **only to the Insights module** unless Doc 5 explicitly states shared usage.

### 7.2 Enum Consistency

* `TASK_STATUS`, `TASK_PRIORITY`, `TASK_SEVERITY`, `VISIBILITY` and `ENVIRONMENT` values in §1.2 are **exactly the same** as in Doc 2.
* If Doc 2 is updated (e.g. a new status or visibility value), §1.2 and any analytics DDL that depends on these enums must be updated in lockstep.

### 7.3 Profiles vs Config

* Profiles (Doc 7) define **behavioural defaults** (reactivity, transparency, pattern sensitivity, logging, data retention).
* Insights config (this document) defines **technical parameters**:

  * How long analytics data is stored.
  * When and how often pattern detection runs.
  * Export and cache limits.
* Where parameters need to align:

  * Pattern windows (`patterns.weekly/monthly/yearly.window_days`) must be consistent with Doc 8’s cyclic review semantics.
  * Profile‑level `log_retention_days` or `data_retention_policy` may be longer than analytics warehouse retention. This is allowed, but analytics retention must always be ≥ the maximum pattern window.

### 7.4 Environment‑Specific Defaults and Global ENVIRONMENT

* `ENVIRONMENT` is globally defined and constrained in Doc 2 as `"dev"`, `"staging"`, `"prod"`, `"offline"`.
* This document shows how **Insights** uses those values to select retention, backup, cache and export defaults (§2.6).
* Other modules may:

  * Use the same environments without per‑environment variation (e.g., core services with mostly static config).
  * Or define their own environment‑specific defaults (e.g., Core Services in Doc 5).
* The important invariant is that **every module interprets environment names consistently**, but parameter values per environment can differ by module; this document captures the Insights slice.
