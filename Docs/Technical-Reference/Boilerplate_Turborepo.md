# Historical starter reference

> **HISTORICAL — NOT CURRENT RUNTIME DOCUMENTATION**

This path is retained only to record that earlier Orgo snapshots originated from a generic full-stack starter. Its former Yarn Classic, Turborepo, NPS, old Nginx and starter-package instructions are **not** valid setup or runtime instructions for the current Orgo repository.

## Current workspace

The active root workspace uses **npm workspaces** and contains:

- `apps/api` — NestJS API and worker;
- `apps/web` — Next.js web application.

The root `package.json` is the command source of truth. Current development commands are:

```text
npm run dev:api
npm run dev:web
```

Current default local ports are API `4000` and web `3000`.

The retained `packages/*` starter material is historical reference material and is not part of the active npm workspace or runtime dependency graph.

For current instructions use:

- `README.md`
- `docs/README.md`
- `docs/Technical-Reference/IMPLEMENTATION_STATUS.md`
- `docs/Technical-Reference/LOCAL_VALIDATION.md`

Do not use this file as an installation, build, validation or deployment guide.
