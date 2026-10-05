# Validation locale

This procedure separates the repository-local gate from broader diagnostic/browser campaigns. Always use disposable test data and a dedicated PostgreSQL test database. Never point automated validation at production.

Dated evidence is recorded under `docs/status/`; this file is the reusable procedure, not a historical result log.

## Repository-local gate

Requirements:

- Node.js 22+
- npm
- PostgreSQL 16

From a clean checkout:

```bash
npm ci
export TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/orgo_test?connection_limit=5'
npm run validate:local
```

`TEST_DATABASE_URL` is mandatory and the database name must contain `test` or `validation`. The launcher maps it to `DATABASE_URL`, generates Prisma, applies migrations, checks architecture and TypeScript, executes unit/integration tests and production builds, stops on the first failure and writes evidence under `validation/local-<date>/`.

The native `FOR UPDATE SKIP LOCKED` behavior must be exercised on PostgreSQL, not inferred from PGlite.

## Fast disposable integration check

For a quick local integration run without provisioning a PostgreSQL database:

```bash
npm run test:pglite
```

This applies the current migration set to a disposable PGlite instance and runs the integration tests. It is useful for fast feedback, but it does not replace the native PostgreSQL gate.

## Fresh database baseline

Orgo now uses one initial Prisma migration baseline:

```text
apps/api/prisma/migrations/
├── migration_lock.toml
└── 00000000000000_initial/
    └── migration.sql
```

For a disposable Docker Compose environment, `.env` must define a URL-safe `POSTGRES_PASSWORD`. A full local reset destroys the Compose database volume:

```bash
docker compose down -v --remove-orphans
docker compose up -d --build
docker compose run --rm seed
```

Use this only for disposable local data. The repository does not provide an automatic migration/import path from an unrelated predecessor schema.

## Comprehensive diagnostic/browser validation

If `LevelUpDiag-Orgo` is available separately, it may invoke Orgo's public validators without being copied into this repository.

For the broad automated local gate, prepare a dedicated PostgreSQL test database and run the diagnostic application's `deep` selection. Browser acceptance requires a disposable local Orgo runtime plus explicit consent for test writes.

Browser evidence does not by itself prove real external-provider or OIDC-provider interoperability.

## Browser and functional review boundaries

Where deployment context requires it, verify:

- connection/logout and immediate effect of revoked roles/permissions;
- Case/Task creation, edits, transitions, revision conflicts, Case linkage, restricted visibility and scope behavior;
- attachment upload/download/removal, timeline/relations and tenant isolation;
- manual/email Signals, pinned workflow versions and worker restart between acceptance and processing;
- durable processes waiting on human/timer/external receipts, predicate mismatch, timeout, adoption and declared compensation;
- users/roles/tokens, invitations and password recovery with a test SMTP service;
- real OIDC on HTTPS with a test IdP, including invalid state/nonce, wrong issuer/audience/signature, disabled account and reused code;
- Maintenance overlap behavior, HR confidentiality and Education membership/support work;
- notifications/templates and selected SMTP/SMS/webhook gateways;
- offline queue replay/conflict correction and account isolation;
- CSV safety, pagination, keyboard navigation and deployment-specific responsive/accessibility requirements;
- standalone mode and, when available, hosted mode against real host contracts.

## Operations and external contracts

Exercise failure behavior appropriate to the deployment: unavailable SMTP/providers, late/duplicate/contradictory callbacks, worker death after send-before-acknowledgement and restart with backlog. Provider-side idempotency remains required for externally unique effects.

`GET /api/v3/system/overview` exposes queue/process/worker state. `GET /api/v3/system/metrics` exposes authenticated Prometheus gauges. Deployment collectors, alerts, scheduled backups and retention policy remain operator responsibilities.

Native Kristal/Konnaxion/Architect/kOA and host contracts must be supplied and validated separately. The shipped Orgo bridge/public contracts do not claim native compatibility that has not been demonstrated.
