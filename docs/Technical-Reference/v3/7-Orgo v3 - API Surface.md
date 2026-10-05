# Orgo v3 — API Surface

**Status:** current routing contract. `../API_IMPLEMENTED.md` is the generated route inventory and is authoritative for the exact implemented HTTP surface.

## 1. Routing convention

The active Nest application uses one global prefix:

```text
/api/v3
```

`apps/api/src/bootstrap.ts` applies that prefix globally and explicitly excludes health probes:

```text
/health/live
/health/ready
/health/dependencies
```

Controllers therefore define route fragments inside the common `/api/v3` boundary instead of mixing prefixed and unprefixed public APIs.

## 2. Implemented surface

The generated inventory in `../API_IMPLEMENTED.md` currently covers these product areas:

- organizations, people, users, roles and organization profile configuration;
- authentication, account lifecycle, API tokens and optional OIDC SSO;
- Tasks, Cases, comments, assignments and Case linkage;
- Work evidence, attachments, timelines and relations;
- Signals, email/webhook ingress and offline replay;
- workflow versions, import/export, simulation and execution;
- routing rules and SLA/orchestration operations;
- durable processes and external integration receipts;
- notifications, templates, outbox/redrive and audit;
- Maintenance, HR and Education product operations;
- insights, reports, system overview, metrics and retention.

Do not manually duplicate the full route table here. Regenerate or update `API_IMPLEMENTED.md` when controllers change.

## 3. Authentication and tenant boundary

Health probes and the explicitly public identity bootstrap flows are the exceptions documented by the implemented route inventory. Other product routes require authentication according to their controller/guard contract.

Tenant identity comes from resolved authentication context. Request headers or body fields do not grant organization authority. Protected operations must enter owner services with resolved execution context and current authorization.

Mutation routes use the repository's idempotency/revision rules where applicable. Work visibility and authorization are rechecked by the owning services rather than inferred from UI state.

## 4. Application boundary

HTTP, email, webhook and offline adapters enter the application through module APIs rather than owning tenant/workflow semantics:

```text
HTTP/email/webhook/offline adapter
→ ExecutionContext + DTO mapping
→ Intake / Work / Orchestration public API
→ owner transaction
```

`Work` owns canonical Case/Task mutation. `Intake` owns accepted Signals. `Orchestration` owns workflow/process decisions. Durable remote effects cross explicit integration/outbox boundaries.

## 5. Frontend and hosted-module boundary

Orgo owns its application routes and inner navigation in standalone and hosted modes. A host may provide outer composition/navigation, but it does not replace Orgo's internal router, tenant resolution or business authorization.

The hosted entry exposes the same Orgo application surface; do not maintain a second host-specific implementation of Orgo pages.

See `../UI_AND_KOALI_INTEGRATION.md` and `../BOUNDARIES_AND_OWNERSHIP.md` for composition and ownership rules.

## 6. Authority

When this document, older status material and executable source differ:

1. active controller/bootstrap source defines what the application can expose;
2. `../API_IMPLEMENTED.md` is the maintained route inventory;
3. `../IMPLEMENTATION_STATUS.md` records dated implementation/validation evidence;
4. this document defines the intended stable routing and ownership convention.
