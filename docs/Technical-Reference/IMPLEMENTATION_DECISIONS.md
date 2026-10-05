# Orgo — implementation decisions

**Original delivery:** 2026-09-09  
**Current baseline update:** 2026-09-16

This file records implementation decisions that refine `TARGET_ARCHITECTURE.md`. `COMPLETION_DECISIONS.md`, `COMMON_IDENTITY.md` and `IMPLEMENTATION_STATUS.md` are authoritative where they define newer or more specific behavior.

## 1. One active application/runtime

The active repository has two application workspaces: `apps/api` and `apps/web`.

- `apps/api` contains the Nest API, worker, Prisma schema and database migrations.
- `apps/web` contains the shared Orgo web application.
- The API and worker use the same Prisma schema and release.
- There is one canonical Work model for Cases and Tasks and one active persistence stack.

Orgo's business UI is owned by Orgo. Hosted composition reuses the same application surface rather than maintaining a second host-specific implementation.

## 2. Signal acceptance is a separate committed transaction

`POST /signals` persists the normalized Signal and, when requested, an outbox message containing an immutable workflow-version reference. It does not synchronously execute retry-prone workflow effects. A later action failure therefore cannot erase accepted input.

The worker re-resolves the initiating user's current permissions, or the initiating API token's current scopes. A deactivated principal cannot execute an old privilege snapshot. Intake processing locks the Signal, creates Work/instance/link rows and acknowledges the message in one transaction. A failed action rolls these back; the accepted Signal remains available and the message exposes its retry/dead state.

External-reference uniqueness is organization + source + external reference. Reusing that identity with changed normalized input returns a conflict rather than silently changing evidence.

## 3. A workflow can start before any Task exists

`WorkflowInstance.task_id` is optional. New instances pin `workflow_version_id` and may refer to a Signal before any Task exists.

A definition's `definition_blob` is a compatibility mirror of its latest publication. Runtime evaluation reads `WorkflowVersion.content`. Published versions are immutable at the database layer. Definitions use organization-scoped codes; global workflow inheritance is not implemented.

Instance `completed / ACTIONS_COMMITTED` means internal actions committed and external requests were queued. It **does not mean** an external validation approved anything.

Durable process managers handle ordered external/human/timer steps, explicit receipt predicates, deadlines, blocking, decisions, adoption and declared compensation.

## 4. Idempotency and concurrency

Ordinary mutation routes require `Idempotency-Key`; login/logout use their own security lifecycle. Email may fall back to its message identity; offline replay supplies a UUID for each command.

Commands take a transaction-scoped PostgreSQL advisory lock on organization + operation + key. The request fingerprint includes input, principal and current authorization context. A replay returns the stored response; different input or a changed authorization context conflicts. Task/Case mutation routes also recheck current visibility before replay.

Work status/assignment/edit operations require `revision`. Compare-and-update prevents lost updates; accepted updates increment it. Case archival and task attachment share a Case lock. Case reopening and Task terminal states follow the canonical transition tables.

The outbox uses `FOR UPDATE SKIP LOCKED`, leases and fenced acknowledgements with bounded retries/backoff. Dead messages can be manually redriven. Delivery is at least once; external adapters must implement durable deduplication with the supplied operation identity.

## 5. Authorization and confidentiality

One HTTP guard resolves identity and organization from an opaque session token or organization-scoped API token. Headers/body values never grant tenancy. Sessions are stored by token hash; user roles and permissions are resolved from the database for every protected request. Local passwords use scrypt.

Global roles and explicit scoped Work grants are supported for team/location/unit/custom scopes. Task/Case scope fields and parent constraints enforce the authorization perimeter. `work:restricted` gates restricted Cases and sensitive people; HR creation forces restricted Case and Task visibility.

The API returns 404 for inaccessible Work references. Composite tenant constraints protect Task/Case ownership and Signal links.

Password recovery, invitations/account lifecycle and optional OIDC SSO use explicit identity contracts. SSO uses explicit `issuer + subject` enrollment and preserves Orgo-local authorization; see `COMMON_IDENTITY.md` and `COMPLETION_DECISIONS.md`.

## 6. Workflow authoring and action syntax

The implemented version payload is `{ "rules": [...] }`. Rules have unique `id`, optional `enabled` (default true), strict match criteria and ordered `actions`. Each action is `{ "type": "...", "target": "...", "input": {...} }`.

Supported actions include `CREATE_CASE`, `CREATE_TASK`, `UPDATE_TASK`, `ASSIGN_TASK`, `ROUTE`, `ESCALATE`, `SET_METADATA`, `ATTACH_TEMPLATE`, `ADD_LABEL`, `NOTIFY`, `REQUEST_INTEGRATION` and process-start behavior documented by `COMPLETION_DECISIONS.md`.

References such as `$signal.id`, `$signal.source`, `$signal.payload`, `$case` and `$task` are explicit bindings, never evaluated code. An unavailable binding rejects execution. Simulation evaluates matches and returns action intents without invoking handlers or writing state.

JSON publication and YAML import normalize into the persisted contract. Unsupported action shapes must be explicitly converted rather than interpreted heuristically.

## 7. Presentation and optional hosting

The React component is the same application in standalone and hosted modes. A host supplies path/navigation through the exported hosted boundary; the component retains Orgo login and authorization. Profiles select presentation composition but do not grant permissions or replace backend checks.

The repository exposes Orgo-owned hosted contracts. Native host/provider compatibility is only claimed when the corresponding real external contract has been supplied and validated.

## 8. Data and deployment

The repository now starts from one Prisma migration baseline:

```text
apps/api/prisma/migrations/
├── migration_lock.toml
└── 00000000000000_initial/
    └── migration.sql
```

`apps/api/prisma/schema.prisma` plus the migration SQL are the physical database definition for a fresh Orgo deployment. Future schema changes must add forward migrations from this baseline.

The project does not maintain an import path for an unrelated predecessor database. Backup/restore scripts are operational tools for Orgo databases, not a compatibility layer for discarded schemas.

Insights reads operational data through Prisma and cannot mutate canonical Work state. No second ORM, broker or mandatory warehouse is introduced.

## 9. Validation authority

`IMPLEMENTATION_STATUS.md` records dated evidence, not perpetual proof for later edits. `LOCAL_VALIDATION.md` defines the current repository-local acceptance procedure. Structural changes to migrations, Docker configuration, source or tests require a fresh validation run before the working tree is described as validated.
