# Orgo v3 — Insights and Analytics

## 1. Role

Insights is Orgo's analytical/read-model layer.

It provides reports, exports, cacheable dashboards and pattern detection over operational state.

## 2. Physical analytics model

The Prisma schema includes dimensions/facts such as:

```text
DimDate
DimOrganization
DimTask
DimCase
DimPerson
DimLearningGroup
FactTask
FactCase
FactWellbeingCheckin
```

## 3. Read-only principle

Reports and dashboards do not directly become operational owners.

A report may show SLA breaches, volume or profile score without changing the underlying Task/Case simply because it computed a metric.

## 4. Pattern detection

Pattern detection can produce an operational proposal:

```text
pattern detected
→ proposed work
→ CaseService / TaskService
→ canonical work object
```

Pattern code must not create an alternative Case/Task persistence path.

## 5. Current web surface

The current Next.js web entrypoint routes `/` to `InsightsOverviewPage`. The supplied snapshot does not contain a mature route tree for all Orgo functions; documentation must not present unimplemented pages as active routes.

## 6. Data warehouse connection

The current `AppModule` configures a TypeORM datasource for Insights using `INSIGHTS_WAREHOUSE_URL` with `DATABASE_URL` fallback, while operational core persistence is Prisma-based.

This is a deliberate read/analytics separation if both paths are wired consistently.
