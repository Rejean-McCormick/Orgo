# Target architecture → active code → local acceptance

Paths are relative to `apps/api/src/orgo/` unless otherwise specified. This is an architecture coverage map, not a claim of exhaustive acceptance for every historical draft.

| Requirement | Active implementation | UI/API entry | Local verification |
| --- | --- | --- | --- |
| Transactional core / Work owner | `modules/work/work.service.ts`, `platform/database.ts` | Cases, Tasks | Tenant, revision, lifecycle tests |
| Persist Signal before effects | `modules/intake/intake.service.ts` | Signals, ingress | Durable acceptance / rollback tests |
| Pure evaluator | `modules/orchestration/evaluator.ts` | Workflow simulation | Pure unit tests, architecture rule |
| Frozen runtime versions | `modules/orchestration/workflow.service.ts` | Workflow versions | Version pinning / immutable SQL trigger |
| Internal and external action split | `modules/orchestration/actions.ts` | Workflow execution | Transaction rollback / queued operation tests |
| Durable process managers | `modules/orchestration/process-manager.service.ts` | Processes; `START_PROCESS` | Human revision / async callback tests; timers/restarts locally |
| External ACLs | `integrations/*`, `modules/integrations/operations.service.ts` | Operations / receipts | Bridge tests; native provider contracts still required |
| Tenant + actor context | `platform/contracts.ts`, `modules/identity/*` | Auth boundary | Spoofed tenant and revoked actor tests |
| Scoped Work authorization | `WorkService` filters/assertions; `IdentityService.workGrants` | Access / Work scope fields | Team alpha/beta regression test |
| Idempotency | `platform/database.ts` | Mutation keys / offline command IDs | Repeated/concurrent commands, conflicts |
| Outbox reliability | `platform/outbox/worker.service.ts` | System / redrive | Lease fencing, native skip-locked test |
| Signal/email evidence | HTTP ingress + `scripts/email-ingress.py` | Signal inspector | Attachment isolation test; IMAP/mbox fixture runs locally |
| Work evidence/history | `modules/work/evidence.service.ts` | Work inspector | Upload/replay/tenant/tombstone tests |
| Operational relationships | `WorkService.linkCase`, `EvidenceService.relate` | Work editor / relations | Scope, visibility and revision checks locally |
| Routing and SLA | `modules/orchestration/routing.service.ts`, `escalation.service.ts` | Routing / worker | Routing / canonical escalation tests |
| Identity administration | `modules/identity/identity-admin.service.ts` | Access, account page | Token/recovery/revocation acceptance locally |
| Optional SSO | `modules/identity/oidc.service.ts` | Login / subject enrollment | Provider + negative JWT/state/nonce cases locally |
| Notifications/templates | `modules/communications/*` | Messages / notifications | In-app and template tests; SMTP/gateway locally |
| Maintenance | `modules/domains/domain-management.service.ts`, `domains.service.ts` | Maintenance | Task-link and overlap tests |
| HR | Same domain owner services | HR | Atomic creation tests; review/participants locally |
| Education | Same domain owner services | Education | Extension tests; membership lifecycle locally |
| Read queries and export | `modules/insights/*`, operations HTTP controller | Insights, Reports | Visibility tests; CSV boundary/browser locally |
| Offline resilience | `apps/web/src/orgo/offline.ts`, HTTP sync | Offline | Replay tests; browser disconnect/conflicts locally |
| Optional hosted composition | `apps/web/src/orgo/hosted-entry.tsx`, `public-contract.ts` | Shared Orgo app | Real host + CSS/bundling/admission when contracts supplied |
| Observability | `platform/telemetry.ts`, worker heartbeat, system endpoints | System / metrics | Collector/failure/load acceptance locally |
| Lifecycle / preservation | SQL migrations, retention endpoint, operations scripts | Admin commands / deployment | Native migrations + backup/restore locally |
| Packaging / enforcement | RuntimeModule, package scripts, Dockerfiles, CI | Same-release API/worker/web | `validate:local`, Compose and browser locally |

`API_IMPLEMENTED.md` inventories routes. `COMPLETION_DECISIONS.md` defines process, scope, account, bridge and evidence semantics. `LOCAL_VALIDATION.md` is the owner's executable acceptance procedure.
