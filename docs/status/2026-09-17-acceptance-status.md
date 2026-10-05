# Orgo — production acceptance status, 2026-09-17

## Scope

This report records the current automated production-acceptance evidence for the Orgo development tree after the validation work completed on 2026-09-17.

It extends the status series that includes:

- `2026-09-10-beta-status.md`;
- `2026-09-10-rc1-status.md`;
- `2026-09-11-common-identity-update.md`;
- `2026-09-15-current-status.md`;
- `2026-09-16-ecosystem-integration-alignment.md`.

The immutable tagged release baseline remains `v0.1.0-rc.1`. This report does not create, move or promote a release tag.

## Acceptance campaign

LevelUpDiag campaign:

- **Run:** `20260917T124220Z-b3066c93`
- **Selection:** `acceptance`
- **Required levels:** 9
- **Verdict:** **PASS**
- **Level results:** **9 PASS, 0 WARN, 0 FAIL, 0 ERROR, 0 BLOCKED**

The acceptance campaign completed the local production-like validation path that had previously remained outside the automated boundary.

## Automated evidence

| Area | Result |
| --- | --- |
| Diagnostic integrity and target context | PASS |
| Repository / security validation | PASS |
| Native PostgreSQL migration and integration | PASS |
| Production API/web builds | PASS |
| Dependency audit | PASS — 0 vulnerabilities reported |
| Backup execution | PASS |
| Restore execution | PASS |
| Restored schema coverage | PASS — 70/70 tables |
| Restored migration history | PASS — 1/1 migration |
| Isolated production Docker deployment | PASS |
| API health | PASS |
| Web health | PASS |
| Worker health | PASS |
| Seed / test account preparation | PASS |
| Browser acceptance on production-like stack | PASS — 24/24 Chromium |
| Acceptance environment cleanup | PASS |

## Backup and restore acceptance

The repository-shipped operational scripts were exercised against the disposable PostgreSQL acceptance environment.

Validation confirmed:

- the shipped backup script completed successfully;
- the shipped restore script completed successfully;
- the restored database contained the expected **70/70 tables**;
- the restored database contained the expected **1/1 Prisma migration record**;
- the restore target was isolated from the normal development database.

A defect discovered during this work was corrected in the shipped scripts: PostgreSQL connection URLs are now passed explicitly to `pg_dump` and `pg_restore` through `--dbname=...` rather than being assigned to `PGDATABASE`.

## Production-like Docker deployment

The acceptance campaign started Orgo from the repository production Compose definition in an isolated project with disposable resources.

The validated runtime included:

- PostgreSQL;
- API;
- web application;
- worker.

The acceptance harness selected free loopback ports dynamically rather than requiring the normal development ports `3000` and `4000` to be unused.

For the successful run:

- **API host port:** `61906`
- **Web host port:** `61907`

The dynamic ports are an acceptance-harness concern only. They do not change the normal Orgo development or deployment defaults.

## Browser acceptance

After the production-like stack became healthy and the disposable account was seeded, the Chromium browser suite ran against that stack.

Result:

- **24/24 PASS**
- **0 skipped**
- **0 unexpected**
- **0 flaky**

The browser coverage remains aligned with the current development baseline and includes local login/common-login UI behavior, Work object creation and persistence, task lifecycle, stale-revision rejection, attachments, workflow publication/simulation, offline replay, CSV export, permissions/team scoping, maintenance, education and confidential HR journeys.

## Cleanup and isolation

The acceptance environment was disposable.

After validation, LevelUpDiag removed the temporary Compose resources, including the acceptance containers, network and volume.

The normal Orgo database was not used as a destructive acceptance target.

## External-provider boundary

No external providers were configured for the successful acceptance run.

Accordingly, this report does **not** claim real interoperability or delivery acceptance for deployment-specific external systems such as:

- SMTP / SMS;
- external webhooks;
- a real OIDC Identity Provider;
- Konnaxion / kOA ecosystem services;
- Kristal / Da’at integrations;
- other deployment-specific provider credentials.

Those remain separate acceptance boundaries when a deployment actually enables them.

## Relationship to previous status records

`2026-09-15-current-status.md` identified backup/restore execution and deployment-specific acceptance as remaining boundaries.

This 2026-09-17 acceptance run closes the local automated portion of those boundaries:

- backup and restore are now executed automatically;
- a production-like Docker stack is started and health-checked automatically;
- the browser suite is executed against that isolated stack;
- cleanup is verified automatically.

The 2026-09-16 ecosystem-integration note remains applicable: documentation of target ecosystem contracts is not by itself evidence of live native-provider interoperability.

## Release interpretation

The current development tree now has complete local automated evidence across the main validation chain:

- `database` — PASS;
- `deep` — PASS;
- `browser` — PASS;
- `acceptance` — PASS.

This is stronger evidence than the original RC1 local baseline, particularly because backup/restore and production-like Docker acceptance are now included.

However, `v0.1.0-rc.1` remains the official immutable tagged RC baseline until a new release candidate is intentionally cut from an identified clean commit and its evidence is retained with that release decision.

This report does not claim that a real production environment has been deployed, nor that deployment-specific external providers have been exercised.

## Current status

**Orgo's current development tree has passed the complete local automated production-acceptance chain available in LevelUpDiag as of 2026-09-17.**

The next release step is to identify the exact clean commit intended for release, retain the acceptance evidence for that commit, and intentionally decide whether to cut a new RC or production release.
