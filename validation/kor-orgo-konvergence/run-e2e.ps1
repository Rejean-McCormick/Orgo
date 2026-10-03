param(
  [Parameter(Mandatory = $true)][string]$KorRoot,
  [Parameter(Mandatory = $true)][string]$KonvergenceRoot,
  [string]$OrgoUrl = 'http://127.0.0.1:4000',
  [string]$Organization = 'orgo',
  [string]$Email = 'admin@example.test',
  [switch]$SkipSeed
)

$ErrorActionPreference = 'Stop'
if (-not $env:ORGO_E2E_PASSWORD) {
  throw 'Set ORGO_E2E_PASSWORD before running the qualification.'
}

$args = @(
  "$PSScriptRoot\run_e2e.py",
  '--kor-root', $KorRoot,
  '--konvergence-root', $KonvergenceRoot,
  '--orgo-url', $OrgoUrl,
  '--orgo-organization', $Organization,
  '--orgo-email', $Email
)
if ($SkipSeed) { $args += '--skip-seed' }

python @args
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
