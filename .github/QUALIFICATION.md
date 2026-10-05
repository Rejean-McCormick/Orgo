# GitHub qualification model for Orgo

This overlay keeps the existing native Orgo CI and adds an independent
LevelUpDiag-Orgo execution layer.

## Repositories

- Orgo: primary product repository. Default branch is `master`.
- LevelUpDiag-Orgo: separate diagnostic authority. Its GitHub repository was
  empty when this overlay was generated; sync its local source before pushing
  the Orgo overlay.
- Orgo-Worlds: standalone Worlds boundary repository. GitHub repository name is
  `Rejean-McCormick/Orgo-Worlds`; the local folder may remain `Orgo_Worlds`.

## Automatic checks

`ci.yml` keeps the direct product proof:
locked install, Prisma generation/migration, architecture, types, unit tests,
native PostgreSQL integration, and production builds.

`levelupdiag.yml` adds:
1. LevelUpDiag-Orgo self-test.
2. Orgo-Worlds standalone boundary validation at pinned commit
   `4b77594874792a3733f64c21621cfcb353458da9`.
3. LevelUpDiag `standard` against the exact Orgo event commit.

Every diagnostic artifact records the exact resolved LevelUpDiag commit SHA.

## Manual deep qualification

`deep-qualification.yml` creates a disposable PostgreSQL 16 service and runs
LevelUpDiag `deep`, including native database integration, builds and dependency
audit.

## Not automated yet

`acceptance` (N14) is intentionally left manual for the next phase because it
owns a specifically named `orgo-test-postgres` container, performs real
backup/restore, builds an isolated production Compose stack and runs the
24-journey Playwright suite.

`ecosystem` (N16) is also deferred because its contract explicitly includes Kor
and Android emulator/physical-device evidence.

Those are excellent later GitHub/manual gates, but they should not be mixed
into the first hosted-CI bootstrap.

## Bootstrap note for LevelUpDiag-Orgo

The Orgo workflow temporarily resolves `Rejean-McCormick/LevelUpDiag-Orgo@main`
because the GitHub repository is currently empty.

After the first successful source sync:
1. read the resolved SHA from the CI `components.txt` artifact;
2. replace `LEVELUPDIAG_ORGO_REF: "main"` in the Orgo workflows with that SHA;
3. intentionally update the SHA whenever the diagnostic authority changes.
