# Orgo — implementation status (2026-09-15)

This document describes the current development implementation and distinguishes **implemented source**, **automated validation evidence**, **browser evidence** and **remaining external/manual acceptance boundaries**.

The immutable tagged release-candidate baseline remains `v0.1.0-rc.1` at commit `60e3a250f98252735839816c8e0143bbdd7546bf`. The current development evidence below was collected against application commit `167f672998075b83ff72ac73f10d550f3ea73e9b` before the documentation-only alignment that updates these files.

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

## Current validation evidence

### Automated `deep` campaign — 2026-09-15

LevelUpDiag run `20260915T131608Z-acda063b` executed the `deep` selection against a clean `master` working tree at application commit `167f672998075b83ff72ac73f10d550f3ea73e9b`.

All **12/12 required levels passed**:

| Evidence area | Result |
| --- | --- |
| Diagnostic/context/inventory/hygiene | PASS |
| Security hygiene scan | PASS — 209 files scanned; no configured secret-pattern hits or high-risk sensitive filenames |
| Prisma generation | PASS |
| Architecture checks | PASS |
| API + web TypeScript checks | PASS |
| LevelUpDiag npm-launcher safeguards | PASS — 3/3 |
| Orgo unit tests | PASS — 16/16 |
| PostgreSQL migration | PASS |
| Native PostgreSQL integration | PASS — 33/33, 0 skipped |
| API + web production builds | PASS |
| npm dependency audit | PASS — 0 info/low/moderate/high/critical vulnerabilities reported |

The campaign summary verdict was **`ERROR` only at target-protection level** because the successful Next.js production build rewrote tracked `apps/web/next-env.d.ts`. No required validation level failed, warned, skipped or blocked. This is a build/repository-cleanliness issue, not evidence of a failed application test.

### Browser campaign — 2026-09-15

LevelUpDiag run `20260915T144942Z-2f927d7b` passed **24/24 required Chromium journeys** using one worker against the real local Orgo API, with:

- 0 skipped;
- 0 unexpected;
- 0 flaky;
- successful coverage of local login/common-login UI behavior, Work creation and lifecycle, stale revisions, comments, assignments, attachments, workflow publication/simulation, offline replay, CSV safety, permissions/team scope, Maintenance, Education and confidential HR work.

E17 mocks only the public SSO configuration response to validate the UI option. It does **not** prove real OIDC discovery/JWKS/authorization-code interoperability.

## Acceptance interpretation

The current source has strong automated evidence for the local application/runtime scope above. It is **not** a claim that every deployment or external integration is accepted. In particular, provider-specific interoperability, real OIDC-provider exchange, backup/restore execution, deployment/load characteristics and native Koali/Capsule admission remain separate evidence boundaries.

RC1 remains the official immutable tagged release baseline until a new release candidate is intentionally cut. See `docs/status/2026-09-15-current-status.md` for the dated status report.

## Ecosystem integration alignment — 2026-09-16

The current kOA Digital Ecosystem target uses Interaction Kernel for Konnaxion↔Orgo and Da’at for new Kristal v5 workflows. **This supplied Orgo snapshot does not claim those IK adapters are implemented.** Its generic per-provider bridge remains the implemented compatibility boundary.

The target migration is documented in `INTERACTION_KERNEL.md`. Until implementation/conformance evidence exists, do not report `governance.decision.execute`, `accountability.impact.publish`, Da’at/Kristal build/revision Profiles, or kOA Build/Release v2 support as active Orgo capabilities.

## Concrete boundaries


- Native Kristal/Konnaxion/Architect/kOA schemas and SDKs, and canonical Koali/Capsule contract packages, are absent from the supplied workspace. The shipped bridges and `orgo-surface/v1` are explicit Orgo contracts. Their existence does not assert native compatibility or host admission.
- A gateway must implement delivery/idempotency semantics for the chosen SMS or webhook provider. Browser push, a vendor-specific gateway and a built-in SMTP server are not claimed. The supplied email adapter consumes an existing IMAP server or mail archives.
- Core workflows, domain operations and UI are implemented to the documented generic contracts. Organization-specific HR/education processes, provider receipt predicates, routing rules and compensation operations must be configured with actual policy/content. Example plans are examples, not automatic deployment policy.
- Work scope identifiers are explicit authorization perimeters. A separate team/location hierarchy catalog or arbitrary policy language is not implied.
- Evidence is bounded to 1 MiB per Work file and 1 MiB total attachments per incoming message. Mail source parsing is bounded to 2 MiB. Large-file object storage is not bundled.
- The read side uses scoped operational queries and indexes. A separate analytical warehouse/materialized projection fleet is not required for this delivery and is not presented as implemented.
- Legacy data may require reconciliation and credential reenrollment. The preflight and migration notes address this; no blind automatic repair mutates existing business data.

These are the actual integration/configuration and acceptance boundaries. No endpoint fabricates external success or depends on Spaces to keep Orgo functional.
