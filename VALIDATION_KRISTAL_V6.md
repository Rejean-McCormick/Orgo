# Orgo Kristal v6 migration validation

Date: 2026-10-01

## Passed in this SmartSnap

- `node scripts/check-architecture.mjs` — PASS;
- TypeScript syntax/transpile check for all modified API/web/test files using the installed TypeScript compiler — PASS;
- `node --test tools/scenario-injector/tests/lib.test.mjs` — 11/11 PASS;
- all JSON documents parse — PASS;
- Docker Compose YAML parses — PASS;
- Orgo_Worlds `node scripts/check-worlds.mjs` — PASS;
- active Kristal integration text contains no remaining v5/SES/direct-bridge contract references outside the explicitly historical 2026-09-16 note;
- relative Markdown link comparison shows no new broken links. The same 15 missing screenshot image links already existed in the input SmartSnap.

## Not rerun here

The SmartSnap does not include `node_modules` or generated Prisma client artifacts. A dependency installation attempt did not complete in the sandbox, so full `npm run typecheck`, API unit/integration suites, Prisma migration/database tests, production builds and browser acceptance were not rerun here.

The latest retained full application acceptance evidence therefore remains the repository's 2026-09-17 campaign; this file is migration-specific validation, not a replacement for that full campaign.

## Migration-specific assertions

- Kristal builds target `kristal.build.request/2.0.0` and contract set `6.0.0`;
- Kristal revisions target `kristal.revision.request/2.0.0`;
- builds capture a content-digested Orgo Case/Task snapshot before post-commit delivery;
- `kristal.artifact.ready/2.0.0` is admitted as a local Signal;
- returned assertion roles/actionability are summarized for workflow routing;
- actionability never bypasses Orgo authorization or owner-local mutations.
