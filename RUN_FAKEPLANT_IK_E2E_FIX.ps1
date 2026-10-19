[CmdletBinding()]
param([switch]$Apply)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$orgo = Split-Path -Parent $MyInvocation.MyCommand.Path
$kxEnv = 'C:\mycode\Konnaxion\Konnaxion\backend\.env'
$root = Join-Path $orgo 'tools\fakeplant_ik_e2e_fix'
$js = Join-Path $root 'audit-and-fix.cjs'
$oldWorkflow = Join-Path $root 'workflow-v1.expected.json'
$newWorkflow = Join-Path $root 'workflow-v2.json'
$tenant = '0c2d7244-a0c0-4a10-8f11-0389f275f133'
$code = 'konnaxion_decision_v1'
$remote = @()
$containerId = ''
$publisherDigest = ''
$publisherSecret = $null
$publisherCreated = $false

function Sha256([string]$value) {
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($value))).ToLowerInvariant()
}
function New-Secret {
  return [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48)).TrimEnd('=').Replace('+','-').Replace('/','_')
}
function Read-IkDigest {
  if (-not (Test-Path -LiteralPath $kxEnv -PathType Leaf)) { throw 'Fichier Django backend/.env absent.' }
  $raw = [IO.File]::ReadAllText($kxEnv)
  $found = @([regex]::Matches($raw, '(?m)^\s*IK_ORGO_TOKEN\s*=([^\r\n]*)'))
  if ($found.Count -ne 1) {throw 'IK_ORGO_TOKEN absent ou repete.'}
  $value = $found[0].Groups[1].Value.Trim().Trim('"').Trim("'")
  if ($value.Length -lt 30 -or $value -match '\s') {throw 'Jeton IK Django absent ou format inattendu.'}
  $uuidLines = @([regex]::Matches($raw, '(?m)^\s*IK_ORGO_TARGET_ORGANIZATION\s*=([^\r\n]*)'))
  if ($uuidLines.Count -ne 1 -or $uuidLines[0].Groups[1].Value.Trim().Trim('"').Trim("'") -cne $tenant) {throw 'UUID IK Django non conforme.'}
  return (Sha256 $value)
}
function Invoke-Db([string]$mode, [string]$tempHash = '') {
  $argsList = @('compose','exec','-T', '-e', "KOA_EXPECTED_OUTBOUND_HASH=$script:ikDigest")
  if ($tempHash) { $argsList += @('-e', "KOA_TEMP_PUBLISHER_HASH=$tempHash") }
  $argsList += @('api','node',$script:remote[0],$mode,$script:remote[1],$script:remote[2])
  $lines = @(& docker @argsList 2>&1)
  $exit = $LASTEXITCODE
  $hits = @($lines | Where-Object { "$($_)".StartsWith('__KOA_E2E_FIX_JSON__=') })
  if ($hits.Count -ne 1) { throw "Diagnostic $mode sans reponse JSON; code=$exit" }
  $payload = ("$($hits[0])".Substring('__KOA_E2E_FIX_JSON__='.Length) | ConvertFrom-Json)
  if ($exit -ne 0 -or $payload.ok -ne $true) {throw "Operation $mode refusee : $($payload.error)"}
  return $payload
}

Push-Location $orgo
try {
  foreach ($file in @($js,$oldWorkflow,$newWorkflow)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {throw "Fichier du correctif absent : $file"}
  }
  # Ensure that the reference comes from the published V1 package, not an edited fixture.
  $installedV1 = Join-Path $orgo 'tools\fakeplant_ik\workflow.json'
  if (-not (Test-Path -LiteralPath $installedV1 -PathType Leaf)) {throw 'Workflow source IK V1 absent.'}
  if ((Get-FileHash $installedV1 -Algorithm SHA256).Hash -cne '8DB9A3BE1BE875CE9CF99845D0EFB6AB54E34A39E9248BDFAC0901527A1D527D') {throw 'Workflow source IK V1 modifie : refus.'}
  $ikDigest = Read-IkDigest
  $services = @(& docker compose ps --services --status running 2>&1)
  if ($LASTEXITCODE -ne 0 -or $services -notcontains 'api' -or $services -notcontains 'worker' -or $services -notcontains 'postgres') { throw 'Orgo Docker API, Worker et PostgreSQL doivent etre demarres.' }
  $containerId = ((& docker compose ps -q api) | Out-String).Trim()
  if (-not $containerId) {throw 'Conteneur API introuvable.'}
  $suffix = ([guid]::NewGuid().ToString('N')).Substring(0,12)
  $remote = @("/app/.koa-fp-e2e-$suffix.cjs", "/app/.koa-fp-e2e-$suffix-old.json", "/app/.koa-fp-e2e-$suffix-new.json")
  $local = @($js,$oldWorkflow,$newWorkflow)
  for ($i=0;$i -lt $local.Count;$i++) {
    & docker cp $local[$i] "${containerId}:$($remote[$i])" 2>$null | Out-Null
    if ($LASTEXITCODE -ne 0) {throw 'Copie temporaire vers Orgo Docker echouee.'}
  }
  Write-Host '=== TANDEM FAKEPLANT : CORRECTION IK E2E ==='
  $state = Invoke-Db 'audit'
  Write-Host "[OK] Tenant FakePlant : $($state.disabled) personas disabled; UUID conforme."
  Write-Host "[ETAT] Workflow $($state.workflow) ; droits jeton : $($state.scopes) ; expiration UTC : $($state.expires_at)"
  if (-not $Apply) {
    Write-Host '[PREVIEW] Rien modifie en base. Pour la correction : FIX_FAKEPLANT_IK_E2E.cmd'
    return
  }
  if ($state.workflow -eq 'v1') {
    $publisherSecret = New-Secret
    $publisherDigest = Sha256 $publisherSecret
    $publisher = Invoke-Db 'publish-token-create' $publisherDigest
    $publisherCreated = $true
    Write-Host '[OK] Jeton provisoire workflows:write emis (15 minutes).'
    try {
      $headers = @{Authorization="Bearer $publisherSecret"; 'X-Organization-ID'=$tenant; 'Idempotency-Key'=[guid]::NewGuid().ToString()}
      $body = [IO.File]::ReadAllText($newWorkflow)
      $response = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:4000/api/v3/workflows/$code/versions" -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 30
      if ($response.ok -ne $true -or [int]$response.data.version -ne 2) {throw 'Recu publication V2 invalide.'}
      Write-Host '[OK] Workflow FakePlant version 2 publie via API Orgo.'
    } finally {
      $publisherSecret = $null
      if ($publisherCreated) {
        $revoked = Invoke-Db 'publish-token-delete' $publisherDigest
        $publisherCreated = $false
        Write-Host '[OK] Jeton provisoire revoque.'
      }
    }
  }
  $afterPublish = Invoke-Db 'audit'
  if ($afterPublish.workflow -ne 'v2') {throw 'Version 2 absente : aucun droit IK change.'}
  $fixed = Invoke-Db 'scopes-update'
  Write-Host "[OK] Permissions du jeton IK : $($fixed.scopes). Expiration inchangée."
  $final = Invoke-Db 'audit'
  if ($final.workflow -ne 'v2' -or $final.scopes -ne 'e2e') {throw 'Verification finale non conforme.'}
  Write-Host '[OK] PREPARATION E2E : workflow V2 et droits limites verifies.'
  Write-Host '[FIN] Ne cree aucune decision, aucun signal, dossier ou impact. Aucune confirmation a retaper.'
} finally {
  if ($publisherCreated) {
    try {
      $revoked = Invoke-Db 'publish-token-delete' $publisherDigest
      Write-Warning 'Jeton provisoire revoque apres erreur.'
    } catch { Write-Warning 'ATTENTION : verification et revocation du jeton provisoire requises.' }
  }
  $publisherSecret = $null
  if ($containerId -and $remote.Count) {
    $removeJs = 'const fs=require("node:fs");for(const p of process.argv.slice(1)){if(/^\/app\/\.koa-fp-e2e-[a-f0-9]{12}(\.cjs|-old\.json|-new\.json)$/.test(p))fs.rmSync(p,{force:true});}'
    try { & docker exec $containerId node -e $removeJs @remote 2>$null | Out-Null } catch {}
  }
  Pop-Location
}
