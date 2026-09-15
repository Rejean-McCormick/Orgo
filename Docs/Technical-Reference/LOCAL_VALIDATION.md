# Validation locale

This procedure separates the repository-local gate from the broader `LevelUpDiag-Orgo` campaigns. Always use disposable test data and a dedicated PostgreSQL database. Never point automated validation at production.

Current dated evidence is recorded in `docs/status/2026-09-15-current-status.md`; this file is the reusable procedure, not a historical result log.

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

The launcher generates Prisma, applies migrations, checks architecture and TypeScript, executes unit/integration tests and production builds, stops on the first failure and writes evidence under `validation/local-<date>/`.

The native `FOR UPDATE SKIP LOCKED` behavior must be exercised on PostgreSQL, not inferred from PGlite.

## Comprehensive LevelUpDiag-Orgo validation

`LevelUpDiag-Orgo` is a separate diagnostics application. It invokes Orgo's public validators without being copied into this repository.

For the broad automated local gate, prepare a dedicated PostgreSQL test database and run:

```text
deep
```

`deep` covers repository/context checks, security hygiene, Prisma generation, architecture, types, unit tests, native PostgreSQL migration/integration, production builds and npm audit.

For browser acceptance, start the disposable local Orgo test runtime and run:

```text
browser
```

The browser campaign requires explicit consent for test writes and validates the required Chromium journeys against the local API. Browser evidence does not by itself prove real external-provider or OIDC-provider interoperability.

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
- standalone mode and, when available, hosted mode against the real Koali contracts.

## Existing-data migration

Historical migrations are preserved. Do not replay them blindly on an already populated database. Back up and inspect Prisma migration history first.

```bash
export DATABASE_URL='postgresql://.../orgo_existing'
npm run migration:preflight
bash scripts/operations/backup.sh /private/path/orgo-before.dump
```

The preflight is non-mutating and reports inconsistent tenant links, invalid intervals and accounts requiring credential reenrollment. Reconcile existing data/history before `prisma migrate deploy`. Constraints introduced as `NOT VALID` protect new writes but require explicit `VALIDATE CONSTRAINT` after historical rows are reconciled.

Restore into a dedicated empty database and verify the restored application behavior:

```bash
export RESTORE_DATABASE_URL='postgresql://.../orgo_restore_test'
bash scripts/operations/restore.sh --restore-to-empty-database /private/path/orgo-before.dump
```

## Operations and external contracts

Exercise failure behavior appropriate to the deployment: unavailable SMTP/providers, late/duplicate/contradictory callbacks, worker death after send-before-acknowledgement and restart with backlog. Provider-side idempotency remains required for externally unique effects.

`GET /api/v3/system/overview` exposes queue/process/worker state. `GET /api/v3/system/metrics` exposes authenticated Prometheus gauges. Deployment collectors, alerts, scheduled backups and retention policy remain operator responsibilities.

Native Kristal/Konnaxion/Architect/kOA and Koali/Capsule contracts must be supplied and validated separately. The shipped Orgo bridge/public contracts do not claim native compatibility that has not been demonstrated.
