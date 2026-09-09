# Orgo v3 — API Surface

> **Historical snapshot route inventory.** The active API now uses a single `/api/v3` prefix. Use `../API_IMPLEMENTED.md` for the implemented routes; the older mixed-route analysis below is retained for migration reference.

## 1. Routing note

The current NestJS application has no global `api` prefix in `main.ts`. Controller decorators therefore matter directly. Some controllers already include `api/v3`, while others use shorter paths and assume reverse-proxy mapping.

The code should converge on one routing convention; see `CODE_ALIGNMENT_NOTES.md`.

## 2. Core routes represented in current controllers

### Organizations

```text
GET    /api/v3/organizations
GET    /api/v3/organizations/:id
POST   /api/v3/organizations
PATCH  /api/v3/organizations/:id
```

### Tasks

```text
GET    /api/v3/tasks
GET    /api/v3/tasks/:id
POST   /api/v3/tasks
PATCH  /api/v3/tasks/:id/status
```

### Cases

Controller path in code:

```text
GET /v3/cases
GET /v3/cases/:caseId
```

Comments expect external reverse-proxy paths under `/api/v3/cases`. Case creation/status mutation exist at service level but are not exposed by the current CaseController.

### Workflow

```text
POST /api/v3/workflows/:workflowId/execute
```

Supports execute/simulate behavior.

### Configuration

The snapshot contains controllers for `/api/v3/config` plus additional Orgo config/profile/feature-flag routes. These should be normalized to one public convention.

### Domain APIs

Controllers exist for:

```text
/domain/hr/*
/domain/education/*
/maintenance/*
```

Their current module wiring is not fully aligned; treat these as code surfaces requiring the fixes in `CODE_ALIGNMENT_NOTES.md` before describing them as stable production contracts.

### Insights

Controller implementation exists under the reporting slice for endpoints such as:

```text
/insights/reports/tasks/volume
/insights/reports/tasks/sla-breaches
/insights/reports/profiles/score
```

The current module import paths need alignment.

## 3. Present but not fully wired core surfaces

The snapshot also contains code for:

- signals;
- email;
- notifications;
- RBAC/auth;
- offline sync;
- health.

Their existence in source does not mean the current `AppModule` exposes every controller. Module wiring must be corrected explicitly.

## 4. Tenant rule

Every Task/Case API operation must resolve and enforce the organization consistently. Public API DTO casing and internal service casing must be explicitly mapped rather than passed through `as any`.


## 5. Frontend and hosted-module route boundary

Orgo owns its application routes and inner navigation in both standalone and Koali-hosted modes.

Koali's canonical outer application route family is `/apps/[moduleId]/...`; this is a hosting/navigation boundary, not a replacement for Orgo's internal router or business authorization.

The hosted Orgo entry must expose the same business application through the canonical Koali module/interface manifest as a `local_module_surface`. Do not maintain a second Koali-specific implementation of Orgo pages.

See `../UI_AND_KOALI_INTEGRATION.md` for the UI composition and authorization boundary.


## 6. Target application boundary

As the modular-monolith migration proceeds, controllers/adapters should enter application modules rather than owning tenant/workflow semantics themselves:

```text
HTTP/email/webhook/offline adapter
→ ExecutionContext + DTO mapping
→ Intake / Work / Orchestration public API
→ owner transaction
```

Signal persistence, idempotency, outbox processing and integration-operation APIs are target contracts and must not be advertised as implemented until their schema/services/routes exist.
