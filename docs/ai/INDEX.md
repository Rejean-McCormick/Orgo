# Orgo — AI Navigation Index

This index routes by intent. It does not replace the referenced authority source, and documentation is not proof that runtime behavior exists.

## Authority model

Use the source that owns the question:

- **Implemented runtime behavior:** `apps/api/`, `apps/web/`, active tests and runtime configuration.
- **Physical persistence:** `apps/api/prisma/schema.prisma` and `apps/api/prisma/migrations/`.
- **Dated implementation/validation ledger:** `docs/Technical-Reference/IMPLEMENTATION_STATUS.md`.
- **Target architecture:** `docs/Technical-Reference/TARGET_ARCHITECTURE.md`.
- **Ownership/dependency boundaries:** `docs/Technical-Reference/ARCHITECTURE_TO_CODE.md` and `docs/Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md`.
- **Implemented HTTP inventory:** `docs/Technical-Reference/API_IMPLEMENTED.md`, verified against controllers.
- **Semantic contracts:** `docs/Technical-Reference/CONTRACTS.md` and the relevant v3 reference.
- **Validation procedure:** `docs/Technical-Reference/LOCAL_VALIDATION.md` and `validation/README.md`.

If sources disagree, do not silently reconcile them. Follow the source with authority for the specific question and record the conflict.

## Route by task

| Question / task | Start here | Implementation / evidence | Verification | Authority / status caveat |
|---|---|---|---|---|
| What is implemented now? | `docs/Technical-Reference/IMPLEMENTATION_STATUS.md` | `apps/api/`, `apps/web/` | relevant tests, `npm run typecheck`, `npm run build` | Status evidence is dated; source and current test results determine the present tree. |
| What architecture must a change preserve? | `docs/Technical-Reference/TARGET_ARCHITECTURE.md` | `docs/Technical-Reference/ARCHITECTURE_TO_CODE.md`, `apps/api/src/orgo/` | `npm run check:architecture` plus relevant tests | Target architecture is normative intent, not proof of implementation. |
| Who owns Cases, Tasks, Signals and domain mutations? | `docs/Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md` | `apps/api/src/orgo/modules/work/`, `apps/api/src/orgo/modules/intake/`, `apps/api/src/orgo/modules/domains/` | `npm run check:architecture`, integration tests | Work owns canonical Case/Task mutations; Intake owns accepted Signals. |
| What are Signal / Work / Workflow semantics? | `docs/Technical-Reference/v3/3-Orgo v3 - Task Case and Workflow Contract.md` | `apps/api/src/orgo/modules/intake/`, `work/`, `orchestration/` | `apps/api/test/integration/runtime.test.ts` | Semantic contracts and runtime evidence have different authority. |
| What is actually persisted? | `apps/api/prisma/schema.prisma` | `apps/api/prisma/migrations/00000000000000_initial/migration.sql` | `npm run db:generate`; migration/integration validation | Prisma schema plus migration SQL are physical authority. The v3 schema reference contains stale implementation-status text. |
| How should the database evolve? | `docs/Technical-Reference/TARGET_ARCHITECTURE.md` § Database evolution | Prisma schema and migrations | `npm run db:generate`, migration validation | Add forward migrations. Do not rebuild the initial baseline from Prisma alone because DB-only invariants may live in SQL. |
| What HTTP/API surface exists? | `docs/Technical-Reference/API_IMPLEMENTED.md` | `apps/api/src/orgo/adapters/inbound/http/` | `apps/api/test/unit/contracts.test.ts`, integration tests | A documented endpoint is not proof of a mounted/current route; verify controller wiring. |
| How do authentication, SSO and permissions work? | `docs/Technical-Reference/IMPLEMENTATION_STATUS.md` | `apps/api/src/orgo/modules/identity/`, `auth.controller.ts`, `sso.controller.ts`, `boundary.ts` | `oidc-url.test.ts`, integration tests | UI/browser evidence with mocked public SSO config does not prove real OIDC-provider interoperability. |
| How do workflows, long processes and external operations behave? | `docs/Technical-Reference/COMPLETION_DECISIONS.md` | `apps/api/src/orgo/modules/orchestration/`, `modules/integrations/`, `platform/outbox/` | integration tests | Remote effects are durable/receipt-driven; bridge presence does not prove provider-native compatibility. |
| How should Maintenance, HR or Education change Work? | `docs/Technical-Reference/v3/4-Orgo v3 - Domain Modules.md` | `apps/api/src/orgo/modules/domains/`, Work APIs | `npm run check:architecture`, integration tests | Domain extensions must not create a competing canonical Case/Task lifecycle. |
| How should Insights/reporting be treated? | `docs/Technical-Reference/v3/6-Orgo v3 - Insights and Analytics.md` | `apps/api/src/orgo/modules/insights/` and read-side code | relevant integration tests | Read/projection surfaces are not write authority for operational state. |
| What are the UI and Koali boundaries? | `docs/Technical-Reference/UI_AND_KOALI_INTEGRATION.md` | `apps/web/` | `npm run typecheck`, `npm run build` | Orgo remains standalone-capable; host capability projection is not Orgo authorization. |
| How are ecosystem integrations bounded? | `docs/Technical-Reference/BOUNDARIES_AND_OWNERSHIP.md` | `apps/api/src/orgo/integrations/`, `modules/integrations/operations.service.ts` | integration tests | External systems own their own state; generic bridges do not prove native interoperability. |
| What validation should I run? | `docs/Technical-Reference/LOCAL_VALIDATION.md` | `scripts/validate-local.mjs`, `scripts/check-architecture.mjs`, `scripts/test-pglite.mjs` | `npm run validate:local` or the narrowest relevant command | Presence of a script/configuration is not PASS evidence. Record what actually ran. |
| What does the latest retained validation evidence prove? | `docs/status/2026-09-15-current-status.md` and `docs/Technical-Reference/IMPLEMENTATION_STATUS.md` | compare against the current tree | rerun relevant commands | The retained 2026-09-15 results predate later repository cleanup. |
| How is local deployment wired? | `docker-compose.yml` | `apps/api/Dockerfile`, `apps/web/Dockerfile`, root `.env.example` | Docker health/readiness plus relevant application checks | Compose configuration proves wiring, not successful deployment. |
| How does the scenario injector work? | `tools/scenario-injector/README.md` | `tools/scenario-injector/cli.mjs`, `lib.mjs` | `tools/scenario-injector/tests/lib.test.mjs` | Treat generated scenarios/examples as tooling artifacts, not runtime authority. |
| I need terminology | `docs/Technical-Reference/GLOSSARY.md` | verify runtime enums/fields in code/schema | relevant tests when behavior depends on it | Vocabulary documentation does not prove physical representation. |

## Fast verification choices

Use the narrowest evidence that can falsify the change, then broaden when needed:

- Dependency or ownership change: `npm run check:architecture`.
- Type-level API/web change: `npm run typecheck`.
- API business-rule change: `npm run test`, then `npm run test:integration`.
- Prisma/schema change: `npm run db:generate`, then migration/integration validation.
- Migration-baseline behavior: `npm run test:pglite` and the repository validation procedure.
- Build/runtime packaging change: `npm run build`.
- Broad local acceptance: `npm run validate:local`.

Never convert a previous PASS, configured tool, route scan, static test count or documentation claim into a statement that the current tree passes.
