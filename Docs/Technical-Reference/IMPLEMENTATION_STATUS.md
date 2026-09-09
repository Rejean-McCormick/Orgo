# Orgo — implementation ledger, completion delivery 2026-09-09

This ledger describes active source in this archive. The user will perform final validation locally. Implemented source and supplied tests are distinct from executed acceptance results.

## Active capabilities

| Area | Implemented source and connected behavior |
| --- | --- |
| Architecture | One Nest API/worker release, one PostgreSQL database, modular Intake / Work / Orchestration; active imports enforced by architecture checks |
| Work | Canonical Cases/Tasks, lifecycle and optimistic revisions, assignment, comments, edits, Case attachment/detachment, additive labels, scoped reads and mutations, immutable events |
| Evidence | Work-owned file storage, content hashes, authorized download, tombstones, optional byte purge, typed relations, paged timelines and connected inspector controls |
| Intake | Durable Signals, deduplication/fingerprint conflicts, pinned workflow version, email/webhook/offline adapters |
| Email | EML and mbox import, TLS IMAP poller, bounded MIME parsing and attachments, durable normalized envelope, authorized attachment retrieval and UI; mark Seen after acceptance |
| Workflow | Immutable JSON/YAML versions, pure evaluation/simulation, synchronous actions, outbox integration/notifications and `START_PROCESS` |
| Long processes | Frozen plans, ordered external/human/timer steps, explicit receipt predicates, deadlines, blocking, revision-protected decisions, current-principal reauthorization, adoption, declared compensation processes |
| External operations | Per-provider bridge ports, accepted versus succeeded receipts, authenticated final callbacks, terminal-receipt conflict detection and preserved operation identity on retry |
| Worker | PostgreSQL claims/leases/heartbeats/fenced commit, bounded retries/dead messages/redrive, process advancement, SLA escalation, fleet heartbeat and housekeeping |
| Authentication | Local scrypt, opaque sessions, logout, password change/recovery/invitation, single-use links, token issuance/revocation and account disablement |
| SSO | Optional OIDC HTTPS authorization-code/PKCE flow, browser binding, nonce/issuer/audience/signature/time validation and explicit tenant/issuer/subject enrollment |
| Permissions | Global roles plus existing scoped assignments activated as explicit Work grants for team/location/unit/custom; dedicated Task/Case scope fields and parent constraints |
| Communications | In-app/SMTP, plain-text versioned templates, read state, optional fixed SMS/webhook gateways with explicit delivery receipt and idempotency key |
| Maintenance | Assets, linked Work tasks, calendar reservations, overlap rejection and status transitions; product forms and calendar view |
| HR | Restricted Work creation, participant lifecycle additions, review transitions, wellbeing records, product forms and detail view |
| Education | Groups, member add/remove with tenant checks, linked support tasks, product forms and member view |
| Read side | Scoped overview/workload queries, timeline/list pagination, bounded CSV export with formula neutralization and supporting database indexes |
| Operations | Authenticated fleet/backlog/process overview, Prometheus gauges, structured HTTP spans, explicit retention, backup/empty-database restore scripts and legacy preflight |
| Web | Shared product routes, profiles, operational forms, inspectors, identity/domains/process/communications/system/report views, account recovery and SSO entry |
| Offline | Explicit browser-local per-account/API queue, preview/export/replay, stable command IDs, visible conflicts and correction using new command IDs; tokens never stored in the queue |
| Public surface | Product-owned hosted entry, Orgo surface/route/profile export and permission-filtered command inventory; standalone has no Spaces dependency |
| Delivery | New additive migration, endpoint inventory, architecture-to-code map, runnable local validation command and examples |

## Checks and acceptance status

The implementation work includes Prisma client generation, TypeScript checking for API/tests/web, architecture dependency checks and Python/shell syntax checking. Current check output is under `validation/completion/`.

**Final tests, application execution against the new migration, Docker builds/runs, browser acceptance, real provider delivery, OIDC interoperability, load/recovery and restoration validation have not been run for this completion delivery.** They are intentionally left to the user. Run `npm run validate:local` with an isolated `TEST_DATABASE_URL` and follow `LOCAL_VALIDATION.md`.

The previous archive had 12 passing unit tests and 24 passing integration tests, with one native PostgreSQL test skipped in PGlite. Those are historical results only; they must not be read as results for the changes in this archive. New regression tests have been added for attachments, process gates/callbacks, scopes, maintenance overlap, MIME attachments and safe templates.

## Concrete boundaries

- Native Kristal/Konnaxion/Architect/kOA schemas and SDKs, and canonical Koali/Capsule contract packages, are absent from the supplied workspace. The shipped bridges and `orgo-surface/v1` are explicit Orgo contracts. Their existence does not assert native compatibility or host admission.
- A gateway must implement delivery/idempotency semantics for the chosen SMS or webhook provider. Browser push, a vendor-specific gateway and a built-in SMTP server are not claimed. The supplied email adapter consumes an existing IMAP server or mail archives.
- Core workflows, domain operations and UI are implemented to the documented generic contracts. Organization-specific HR/education processes, provider receipt predicates, routing rules and compensation operations must be configured with actual policy/content. Example plans are examples, not automatic deployment policy.
- Work scope identifiers are explicit authorization perimeters. A separate team/location hierarchy catalog or arbitrary policy language is not implied.
- Evidence is bounded to 1 MiB per Work file and 1 MiB total attachments per incoming message. Mail source parsing is bounded to 2 MiB. Large-file object storage is not bundled.
- The read side uses scoped operational queries and indexes. A separate analytical warehouse/materialized projection fleet is not required for this delivery and is not presented as implemented.
- Legacy data may require reconciliation and credential reenrollment. The preflight and migration notes address this; no blind automatic repair mutates existing business data.

These are the actual integration/configuration and acceptance boundaries. No endpoint fabricates external success or depends on Spaces to keep Orgo functional.
