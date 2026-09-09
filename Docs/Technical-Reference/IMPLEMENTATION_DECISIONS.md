# Orgo — Implementation decisions, 2026-09-09

This file refines `TARGET_ARCHITECTURE.md` for the delivered code. It does not replace product ownership or lifecycle contracts.

## 1. Replace broken runtime slices; preserve physical state

The user authorized prioritizing documentation over negligible legacy code. The snapshot's active Nest graph referenced nonexistent modules, mixed two persistence stacks and exposed incompatible tenant/DTO conventions. Instead of preserving those as live parallel code, the supplied API/web source is retained under `legacy/`; new active modules use the **same Task, Case, organization, role and domain-extension tables**. This is an authorized implementation change from the earlier repair-first migration sequence, not a second operational model.

Root workspaces now contain `apps/api` and `apps/web`. The former starter `packages/*` remain reference material and are not runtime dependencies. The shared application UI is owned by Orgo.

## 2. Signal acceptance is a separate committed transaction

`POST /signals` persists the normalized Signal and, when requested, an outbox message containing an immutable workflow-version reference. It does not synchronously execute workflow effects. This ensures a later invalid action cannot erase accepted input.

The worker re-resolves the initiating user's current permissions, or the initiating API token's current scopes. A deactivated principal cannot execute an old privilege snapshot. Intake processing locks the Signal, creates Work/instance/link rows and acknowledges the message in one transaction. A failed action rolls these back; the accepted Signal remains `RECEIVED` and the message exposes its retry/dead state. `REJECTED` is reserved; there is currently no rejection endpoint.

External-reference uniqueness is organization + source + external reference. Reusing that identity with changed normalized input returns a conflict rather than silently changing evidence.

## 3. A workflow can start before any Task exists

The old `WorkflowInstance.task_id` was required. It is now nullable; new instances always pin `workflow_version_id`, and may also refer to a Signal. Existing rows retain nullable version references for explicit legacy migration. No version is fabricated from an incompatible old YAML/blob.

A definition's `definition_blob` remains a compatibility mirror of its latest publication. Runtime evaluation reads `WorkflowVersion.content` only. Published versions have an SQL immutability trigger. Definitions use organization-scoped codes; global workflow inheritance is not implemented.

Instance `completed / ACTIONS_COMMITTED` means internal actions committed and external requests were queued. It **does not mean** an external validation approved anything. Long-running business process managers that wait for external receipts remain separate future work.

## 4. Idempotency and concurrency

All ordinary mutation routes require `Idempotency-Key`; login/logout do not. Email may fall back to its message identity; offline replay supplies a UUID for each command.

Commands take a transaction-scoped PostgreSQL advisory lock on organization + operation + key. The request fingerprint includes input, principal and current authorization context. A replay returns the stored response; different input or a changed authorization context conflicts. Task/Case mutation routes also recheck current visibility before replay.

Work status/assignment/edit operations require `revision`. Compare-and-update prevents lost updates; accepted updates increment it. Case archival and task attachment share a Case lock. Case reopening and Task terminal states follow the canonical transition tables.

The outbox uses `FOR UPDATE SKIP LOCKED`, a 60-second lease, a token that fences acknowledgements, heartbeat renewal, eight attempts and bounded exponential backoff with jitter. Dead messages can be manually redriven. Delivery is at least once; an external adapter must implement durable deduplication with the supplied operation identity. SMTP cannot guarantee exactly-once delivery; a crash after SMTP acceptance can produce a duplicate despite the stable Message-ID.

## 5. Authorization and confidentiality

One HTTP guard resolves the identity and organization from an opaque session token or organization-scoped API token. Headers/body values never grant tenancy. Sessions are stored by token hash; user roles and permissions are resolved from the database for every protected request. Local passwords use scrypt; legacy password hashes are not automatically converted.

The initial authorization implementation admits organization-wide roles only (`global` or absent scope). It fails closed for unimplemented team/location/custom scopes. `work:restricted` gates restricted Cases and sensitive people. Restricted Tasks additionally admit their assigned user/role, subject to their parent Case remaining visible. HR creation forces restricted Case and Task visibility.

The API returns 404 for inaccessible Work references. Composite tenant foreign keys protect Task Case/owner/requester references and Signal links. Cross-organization dirty legacy references must be corrected before the additive migration can apply; the migration does not silently reassign them.

Login throttling is per API process and IP. Distributed rate limiting, SSO, password recovery and user invitations are not included. Seed supplies initial administration. Existing credentials are never overwritten implicitly.

## 6. Workflow authoring and action syntax

The implemented version payload is `{ "rules": [...] }`. Rules have unique `id`, optional `enabled` (default true), strict match criteria and ordered `actions`. Each action is `{ "type": "...", "target": "...", "input": {...} }`.

Supported actions: `CREATE_CASE`, `CREATE_TASK`, `UPDATE_TASK` (status only), `ASSIGN_TASK`, `ROUTE`, `ESCALATE`, `SET_METADATA`, `ATTACH_TEMPLATE`, `ADD_LABEL`, `NOTIFY`, `REQUEST_INTEGRATION`.

`ROUTE` with empty input applies persisted routing rules; an explicit owner input uses the same Work assignment API. Routing resolves matching non-fallback rules first, then fallback rules; weight descending and ID break ties deterministically. `ADD_LABEL` adds an EntityLabel and leaves the primary classification label unchanged. `ATTACH_TEMPLATE` records a template reference; it does not call a document-generation engine.

References are exact strings: `$signal.id`, `$signal.source`, `$signal.title`, `$signal.description`, `$signal.label`, `$signal.type`, `$signal.category`, `$signal.severity`, `$signal.payload`, `$case`, `$task`. The latter two refer to the latest result (or linked Case). They are explicit bindings, never evaluated code. An unavailable binding rejects execution. Simulation evaluates matches and returns action intents without invoking handlers or writing state; it is not a promise that every eventual effect will succeed.

JSON publication and YAML import normalize into the same persisted contract. Historical action syntax must be explicitly converted; it is not silently interpreted as the new shape.

## 7. Presentation and optional hosting

The React component is the same application in standalone and hosted modes. A host supplies path/navigation through `OrgoAppProps`; the component retains Orgo login and authorization. Profiles select a home and a composition of routes. They do not grant permissions or replace backend checks.

`hosted-entry.tsx` is a code-level embedding boundary. The supplied files do not contain the executable canonical Koali/Capsule schema packages; no native manifest compatibility or admission is claimed. Wiring the exported surface into those actual contracts remains an integration step. No second global shell, private provider frontend import, or required Spaces dependency was introduced.

## 8. Data and deployment

The new migration is additive to the supplied migration history. Test it against a restored copy of any existing database before applying it there. Historical migrations are preserved as provided, including their original legacy User-table removal; they are not a recommended import path for an unrelated existing database.

API and worker use the same Prisma schema, modules and release. Insights reads grouped operational data through Prisma and cannot mutate it. The existing star schema remains available for later projections; no second ORM, broker or mandatory warehouse is introduced. Observability currently supplies correlation identifiers, history, error logs and liveness/readiness; full metrics/tracing export remains a documented gap.

## Completion supersession

For the 2026-09-09 completion delivery, `COMPLETION_DECISIONS.md` supersedes earlier limitations concerning global-only Work permissions, completed-only bridges, missing process managers, identity administration, email ingress, offline UI and supplemental domain screens. The original architectural boundaries remain unchanged. Do not treat historical test counts as acceptance of the new code.
