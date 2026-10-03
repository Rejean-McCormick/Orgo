# Konvergence seed + Kor ↔ Orgo E2E

This qualification path does two things without bypassing repository boundaries:

1. converts the Konvergence `koa-orgo-sim/v1` case fixture into the existing controlled `orgo.scenario.v1` importer and loads five Cases + nineteen Tasks into Orgo;
2. runs a real Kor queued interaction using `orgo.work.status.submit/1.1.0`, delivered by Kor's pinned Orgo binding to `POST /api/v3/ik/interactions`, and verifies the resulting Orgo Task comment, semantic replay and divergent idempotency conflict.

## Preconditions

- Orgo API/database is running and migrated/seeded.
- The patched Kor repository has its Python dependencies installed.
- The Konvergence Universe 1.0.0 package is extracted.
- The Orgo admin account is available.

Example on Windows PowerShell (paths may be changed):

```powershell
$env:ORGO_E2E_PASSWORD = '<local Orgo admin password>'
.\validation\kor-orgo-konvergence\run-e2e.ps1 `
  -KorRoot C:\mycode\Kor\kor `
  -KonvergenceRoot C:\path\Konnaxion-Koali-Konvergence-Universe-1.0.0
```

The runner rebuilds the scenario from `orgo/examples/cases.json`, applies it idempotently through the Orgo Scenario Injector, issues a short-lived Orgo API token scoped to `work:read` + `work:comment`, starts Kor in-process with a temporary encrypted local store, sends the canonical IK command, verifies one owner-side effect, tests replay/conflict behavior, then revokes the temporary Orgo token.

Use `-SkipSeed` with the PowerShell wrapper (or `--skip-seed` with `run_e2e.py`) to run only the Kor ↔ Orgo portion against an already loaded seed.
