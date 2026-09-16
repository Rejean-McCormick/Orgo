# Engineering Profile

> Generated deterministically by RepoSurveyor from the current local project files. 
> This is a scale/engineering-surface characterization, not a quality score or release-readiness claim.

## Engineering Footprint

- **193** files in the active engineering surface
- **90** active source files
- **84** production source files
- **6** test source files
- **50** active documentation files
- **15,025** production nonblank physical source lines
- **1,580** test nonblank physical source lines
- **2** migration-related files
- **2** schema-related files
- **114** probable HTTP route declarations *(medium-confidence framework scan)*
- **49** statically detected test declarations *(not executed-test count)*

## Language Footprint

| Language | Nonblank physical source lines |
|---|---:|
| TypeScript | 12,926 |
| SQL | 1,741 |
| CSS | 841 |
| JavaScript | 690 |
| Python | 358 |
| PowerShell | 31 |
| Shell | 18 |

Method: RepoSurveyor extension classification + nonblank physical line count. Comments are included in this fallback measure.

## Structural Surface

| Area | Files | Source files | Docs | Nonblank source lines |
|---|---:|---:|---:|---:|
| `apps` | 90 | 78 | 2 | 15,522 |
| `tools` | 7 | 4 | 2 | 518 |
| `scripts` | 7 | 7 | 0 | 324 |
| `(root)` | 11 | 1 | 4 | 241 |
| `docs` | 40 | 0 | 40 | 0 |
| `charters` | 19 | 0 | 0 | 0 |
| `validation` | 16 | 0 | 2 | 0 |
| `examples` | 2 | 0 | 0 | 0 |
| `.github` | 1 | 0 | 0 | 0 |

## Complexity

- Functions analyzed by Lizard: **685**
- Median cyclomatic complexity (CCN): **1**
- 95th percentile CCN: **13.8**
- Maximum CCN: **255**
- Functions with CCN > 15: **27**
- Method: Lizard XML function measure / CCN column

## Verification Surface

- Static test declarations: **49** — static language-aware declaration scan; not collected/executed/passed tests
- No supported existing coverage report detected.

## Detected Engineering Controls

- **CI configuration** — configured/detected via `.github/workflows/ci.yml`
- **Containerization** — configured/detected via `apps/api/Dockerfile`, `apps/web/Dockerfile`, `docker-compose.yml`
- **Static typing** — configured/detected via `apps/api/tsconfig.json`, `apps/web/tsconfig.json`

## Analysis Scope

- Active surface: **193** files
- Excluded `dependency-lock`: **1** files
- Excluded `generated-file`: **1** files
- Excluded `local-ignore`: **1** files
- Excluded `private-local`: **3** files
- Pruned dependency/cache/generated directories: **5**

## Measurement Notes

- Generated: `2026-09-16T16:55:10.013898+00:00`
- RepoSurveyor survey schema: `1.0`
- Source model: current local filesystem; Git state/history is intentionally irrelevant.
- Archive copies, diagnostics, dependency caches, generated output, lockfiles and private local configuration are excluded from the active engineering surface.
- Tool/configuration presence is evidence of configured engineering infrastructure, not evidence that its latest run passed.
- Static test declarations are not the same as collected, executed or passing tests.
- Existing coverage reports are not treated as freshly measured coverage.
- RepoSurveyor never converts these measurements into a synthetic quality, maturity or architecture score.
