# Orgo

Orgo is a **proprietary, multi-tenant operational workflow and coordination system** in the kOA Digital Ecosystem. It turns incoming signals into governed operational work through organizations, cases, tasks, workflows, routing, evidence, permissions, communications, audit and insights.

Orgo is **standalone-first**. It owns its workflow state, business authorization and business UI. It can also be hosted inside Koali Spaces as an Orgo-managed `local_module_surface` without transferring ownership of Orgo business state or permissions to the host.

## Status

### Validated release baseline

The official validated baseline is:

| Item | Value |
| --- | --- |
| Release | **Release Candidate 1** |
| Tag | `v0.1.0-rc.1` |
| Commit | `60e3a250f98252735839816c8e0143bbdd7546bf` |
| Tag date | 2026-09-10 |
| Development branch | `master` |

RC1 passed the retained local automated gate and two consecutive Chromium campaigns. The browser validation completed **44/44 executions successfully** across the two runs. The RC tag is immutable and remains the reference to use when reproducing or diagnosing RC1.

Detailed evidence: [RC1 status report](docs/status/2026-09-10-rc1-status.md).

### Post-RC1 development

Development continued after the RC1 tag. In particular:

- common identity/OIDC behavior was aligned with the kOA common identity profile while preserving local login and Orgo-local authorization;
- dependency-security updates were prepared, including NestJS, Nodemailer, `js-yaml`, Express and Multer changes;
- the dependency update requires a regenerated lock file and final validation on the destination environment.

These changes **do not retroactively change the RC1 tag**. The current development tree must pass the applicable validation gates before it can be described as a newly validated release candidate.

See:

- [Common identity update](docs/status/2026-09-11-common-identity-update.md)
- [Common identity implementation profile](docs/Technical-Reference/COMMON_IDENTITY.md)
- [Implementation status](docs/Technical-Reference/IMPLEMENTATION_STATUS.md)

## What Orgo does

Orgo is centered on four operational concepts:

- **Signal** — accepted incoming evidence or input that can be normalized, deduplicated and processed.
- **Case** — the durable situation/context and primary operational workspace.
- **Task** — the canonical executable unit of work.
- **Workflow** — deterministic orchestration that evaluates rules and resolves actions without bypassing the owning domain services.

### Main capabilities

| Area | Capabilities |
| --- | --- |
| Work management | Cases, Tasks, lifecycle transitions, assignment, comments, edits, optimistic revisions, labels, Case/Task relationships and immutable work events |
| Intake | Durable Signals, deduplication, fingerprint conflict handling, manual/API intake, email, webhook and offline adapters |
| Evidence | File attachments, content hashes, authorized download, tombstones, typed relations and paged timelines |
| Workflows | Immutable JSON/YAML versions, import/export, simulation, execution, routing, escalation and synchronous/durable actions |
| Long-running processes | Human, timer and external steps; frozen plans; deadlines; blocking; decisions; adoption; compensation and explicit receipt predicates |
| Authentication | Local email/password authentication, opaque sessions, logout, password change/recovery, invitations and account disablement |
| Common identity / SSO | Optional OIDC Authorization Code + PKCE, explicit `issuer + subject` enrollment, configurable IdP label and Orgo-local RBAC |
| Authorization | Multi-tenant organization boundary, global roles and scoped Work grants for team/location/unit/custom scopes |
| Communications | In-app notifications, SMTP, versioned plain-text templates and optional fixed SMS/webhook gateways |
| Maintenance | Assets, linked Work tasks, calendar reservations, overlap rejection and status transitions |
| HR | Restricted Work creation, participant lifecycle, reviews and wellbeing records |
| Education | Groups, tenant-checked membership operations and linked support tasks |
| Offline work | Per-account browser-local command queue, preview/export/replay, stable command IDs and visible conflict correction |
| Reporting and operations | Scoped overview/workload queries, paged reads, safe CSV export, audit, system overview and Prometheus metrics |
| Hosted product surface | Standalone Orgo UI plus an Orgo-owned hosted surface/profile/route export for Koali integration |

## Architecture

Orgo is implemented as a **modular monolith**, not as a collection of Task/Case/Workflow microservices.

```text
                         ORGO
                    Modular Monolith
                           │
       ┌───────────────────┼────────────────────┐
       │                   │                    │
     INTAKE               WORK             ORCHESTRATION
     Signals           Cases + Tasks          Workflow
     normalization     assignments            Routing
     deduplication     comments               Escalation
       │               work events            Actions
       └───────────────────┼────────────────────┘
                           │
                   Domain events + Outbox
                           │
              ┌────────────┼─────────────┐
              │            │             │
       Communications   Integrations   Insights
```

Cross-cutting concerns include tenancy, identity, RBAC, execution context, configuration, persistence/transactions, idempotency, audit and observability.

### Architectural invariants

- `Organization` is the tenant boundary.
- `Work` owns canonical Case/Task mutations.
- `Case` is the primary operational workspace.
- `Task` is the canonical executable unit of work.
- `Signal` is a first-class persisted intake object.
- Workflow evaluation is deterministic and side-effect free; resolved actions are applied through owner services.
- External and long-running effects use explicit idempotency, durable outbox/worker boundaries and receipts.
- Domain modules refine Work rather than creating competing Case/Task lifecycles.
- Koali hosting affects composition/presentation only; Orgo remains authoritative for Orgo authorization and business state.
- Orgo must remain usable without Koali Spaces.

Architecture reference: [Target Architecture](docs/Technical-Reference/TARGET_ARCHITECTURE.md).

## User interface

The web application exposes shared Orgo product routes and presentation profiles. The operational model is Case-centered while keeping transverse views for Tasks, Signals and personal work.

Typical Orgo navigation includes:

`My Work` · `Cases` · `Tasks` · `Signals` · `Workflows` · `Routing` · `People` · `Organizations` · `Insights` · `Integrations` · `Audit` · `System`

Presentation profiles may compose different subsets of the product surface, including Full Control Panel, Operations, My Work, Supervisor, Intake, Workflow Admin, Executive and Embedded profiles. Presentation never grants business permission; backend authorization remains authoritative.

See [UI Architecture and Koali Integration](docs/Technical-Reference/UI_AND_KOALI_INTEGRATION.md).

## API

The API is implemented with NestJS and exposes the `/api/v3` product surface plus health endpoints. Implemented route groups cover:

- authentication, recovery and SSO;
- organizations, people, users, roles and scopes;
- Cases, Tasks, comments, attachments, relations and timelines;
- Signals and ingress adapters;
- workflows and routing;
- processes and external-operation receipts;
- notifications, templates and outbox operations;
- maintenance, HR and education modules;
- insights, reports, audit, system overview and metrics;
- offline replay/synchronization.

The current endpoint inventory is maintained in [API Implemented](docs/Technical-Reference/API_IMPLEMENTED.md).

## Common identity and login

Orgo supports both local authentication and optional common-identity federation.

```text
local login
+ optional OIDC login
+ explicit issuer/subject mapping
+ Orgo-local roles and permissions
```

Federated identities are resolved from the validated `issuer + subject` pair. Email and display name are attributes only: Orgo does not auto-link or auto-provision users by email.

A successful OIDC login identifies an Orgo user; authorization is still derived from the user's Orgo organization memberships, roles, scopes and permissions. Konnaxion or Moodle roles are not implicitly accepted as Orgo permissions.

Minimal OIDC configuration:

```dotenv
ORGO_PUBLIC_URL=https://orgo.example.org
OIDC_ISSUER=https://identity.example.org
OIDC_CLIENT_ID=orgo
OIDC_CLIENT_SECRET=
OIDC_DISPLAY_NAME=kOA Identity
```

Production OIDC/public URLs require HTTPS. Local non-production development may use `http://localhost` or `http://127.0.0.1`.

See [Common Identity](docs/Technical-Reference/COMMON_IDENTITY.md).

## Requirements

For the current local validation path:

- **Node.js 22+**
- **npm**
- **PostgreSQL 16**

Use an isolated database for tests and validation. Never point automated validation at a production database.

## Installation

From the repository root, configure the environment from `.env.example` and install dependencies.

For a clean checkout whose `package-lock.json` already matches the current source:

```bash
npm ci
```

If applying the post-RC1 dependency-security update to an older lock file, run `npm install` **once** to regenerate `package-lock.json`, review and commit the resulting lock file, then return to `npm ci` for subsequent clean installations.

Do not use `npm audit fix --force` as a substitute for the project validation gates.

## Development

Run API and web development tasks from the repository root:

```bash
npm run dev
```

Typical local endpoints are:

- Web UI: `http://localhost:3000/`
- API / Swagger: `http://localhost:5002/docs`

The API and web applications can also be started from their respective workspace directories when working on one surface at a time.

## Validation

### Local acceptance gate

Use a fresh, isolated PostgreSQL validation database:

```bash
npm ci
export TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/orgo_test?connection_limit=5'
npm run validate:local
```

The validation launcher generates Prisma, applies migrations, checks architectural boundaries and types, runs automated tests and builds, and writes evidence under `validation/local-<date>/`.

On Windows, follow the repository's validation documentation for shell requirements.

Full instructions: [Local Validation](docs/Technical-Reference/LOCAL_VALIDATION.md).

### Common identity update gate

After identity changes, run the normal Orgo gates:

```bash
npm run typecheck
npm run test
npm run test:integration
npm run build
```

Integration tests require a dedicated PostgreSQL test/validation database.

### Dependency-security gate

The post-RC1 dependency update must be validated after the lock file is regenerated. When using the separate `LevelUpDiag-Orgo` diagnostic repository, run the expected campaigns in this order:

1. `quick`
2. `embedded`
3. `build`
4. `security`

The intended security result is **zero moderate, high or critical vulnerabilities**. The actual LevelUpDiag security report is authoritative for that campaign.

## RC1 validation summary

The retained RC1 evidence includes:

- clean Git state before the RC gate;
- two consecutive Chromium runs at 22/22 each;
- Prisma generation and migrations on isolated PostgreSQL 16;
- architecture checks;
- TypeScript checks;
- unit and integration tests;
- API/web builds;
- dependency audit at the configured RC threshold;
- versioned local validation evidence committed with the RC baseline.

The local RC1 gate explicitly left **external-provider** and **restore** validation outside its automated scope. Those are not known failures; they must be exercised when required by the deployment context.

For reproduction or comparison of RC1, check out `v0.1.0-rc.1` rather than assuming the current `master` head is equivalent to the validated RC state.

## Repository documentation

Start with [docs/README.md](docs/README.md). The most important technical references are:

- [Implementation Status](docs/Technical-Reference/IMPLEMENTATION_STATUS.md)
- [Target Architecture](docs/Technical-Reference/TARGET_ARCHITECTURE.md)
- [Architecture to Code](docs/Technical-Reference/ARCHITECTURE_TO_CODE.md)
- [Boundaries and Ownership](docs/Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md)
- [Implemented API](docs/Technical-Reference/API_IMPLEMENTED.md)
- [Contracts](docs/Technical-Reference/CONTRACTS.md)
- [Common Identity](docs/Technical-Reference/COMMON_IDENTITY.md)
- [UI and Koali Integration](docs/Technical-Reference/UI_AND_KOALI_INTEGRATION.md)
- [Local Validation](docs/Technical-Reference/LOCAL_VALIDATION.md)
- [Glossary](docs/Technical-Reference/GLOSSARY.md)

Status history:

- [2026-09-10 — Beta status](docs/status/2026-09-10-beta-status.md)
- [2026-09-10 — RC1 status](docs/status/2026-09-10-rc1-status.md)
- [2026-09-11 — Common identity update](docs/status/2026-09-11-common-identity-update.md)

## Integration boundaries

Orgo integrates with external systems through explicit contracts and adapters. It does not write directly into the internal stores of other kOA subsystems.

Native provider/host compatibility must be validated against the real external contracts available in the deployment environment. Shipped Orgo bridge contracts do not by themselves prove interoperability with every Kristal, Konnaxion, SemantiK Architect, kOA or Koali/Capsule deployment.

## License

Orgo is **proprietary software**. This repository and its documentation should not be treated as an open-source distribution unless an explicit license states otherwise.
