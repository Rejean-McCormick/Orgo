# Orgo — Interaction Model surfaces implementation, 2026-09-17

This record describes the implementation overlay built from the 2026-09-17 Orgo snapshot and the canonical `ORGO_INTERACTION_MODEL.md`.

## Implemented interaction surfaces

The web application now includes first-class human-oriented surfaces on top of the existing canonical Work APIs:

- **Today** — personal attention view over assigned canonical Tasks plus unread notifications.
- **Workrooms** — human presentation of canonical Cases.
- **Workroom Overview** — situation, objective, next Actions, operational state and recent updates.
- **Actions** — contextual Task execution with quick lifecycle transitions and Action creation.
- **Plan** — durable process projection plus a simple builder for approval, timer and external-operation steps.
- **Decisions** — pending durable approvals plus explicit decision records stored in Case metadata and audited through the canonical Case patch path.
- **Evidence** — Case attachments, linked Signals and external operation/receipt context.
- **People** — current Action ownership inside the Workroom.
- **Timeline** — human-readable projection of canonical Work events.
- **Review** — structured review notes plus a direct path to corrective Actions.
- **Intake** — human triage queue and `Report something` form backed by canonical Signals.
- **Team** — supervisor projection over active Tasks grouped by owner.
- **Situation** — leadership view over active/critical Workrooms and blocked Actions.

Workroom presentation modes are **Standard**, **Investigation**, **Project / Delivery**, **Incident**, and **Review**. The selected mode is stored as `metadata.oim_mode` on the canonical Case; it does not create a second Case lifecycle.

## Compatibility and ownership

The implementation does not add a second operational database model. `Case`, `Task`, `Signal`, durable processes, Work events, attachments and integration operations remain authoritative. Presentation profiles remain separate from permissions.

Legacy technical `Cases`, `Tasks`, and `Signals` routes are intentionally retained in the current Operations profile during migration so existing deep links and the established browser acceptance journeys remain usable. The Full Control Panel continues to expose technical/admin surfaces.

## Validation performed while producing the overlay

- TypeScript/TSX parser/transpilation check: PASS for changed frontend sources.
- Static TypeScript check with local framework stubs: no Interaction Model source errors after excluding framework-stub limitations in unchanged files.
- CSS brace balance: PASS.
- No Prisma schema or migration change.
- No canonical backend mutation path bypass introduced.

A real Docker/Chromium acceptance run was **not** executed in the artifact-generation environment. After applying the overlay, rerun Orgo's browser/acceptance campaign on the Windows Docker host before treating these new interaction surfaces as release evidence.
