Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

Write-Host "`n=== ORGO COMMON LOGIN VALIDATION ===" -ForegroundColor Cyan

Write-Host "`n[1/2] Typecheck + unit tests" -ForegroundColor Cyan
& npm run typecheck
if ($LASTEXITCODE -ne 0) { throw 'typecheck failed' }
& npm run test
if ($LASTEXITCODE -ne 0) { throw 'unit tests failed' }

Write-Host "`n[2/2] Full local gate" -ForegroundColor Cyan
if ([string]::IsNullOrWhiteSpace($env:TEST_DATABASE_URL)) {
    Write-Host 'TEST_DATABASE_URL is not set; integration/build gate not run.' -ForegroundColor Yellow
    Write-Host 'Use a dedicated PostgreSQL database whose name contains test or validation, then run npm run validate:local.'
    exit 0
}

& npm run validate:local
if ($LASTEXITCODE -ne 0) { throw 'validate:local failed' }

Write-Host "`nCOMMON LOGIN VALIDATION = PASS" -ForegroundColor Green
