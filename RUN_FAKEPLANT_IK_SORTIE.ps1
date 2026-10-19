[CmdletBinding()]
param([switch]$Apply)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
# The operator explicitly chooses the WRITE launcher. No interactive prompts.
$orgo = Split-Path -Parent $MyInvocation.MyCommand.Path
$kxEnv = 'C:\mycode\Konnaxion\Konnaxion\backend\.env'
$root = Join-Path $orgo 'tools\fakeplant_ik'
$sourceJs = Join-Path $root 'bootstrap.cjs'
$sourceJson = Join-Path $root 'workflow.json'
$expectedHash = '8DB9A3BE1BE875CE9CF99845D0EFB6AB54E34A39E9248BDFA C0901527A1D527D'.Replace(' ','')
$expectedOrg = '0c2d7244-a0c0-4a10-8f11-0389f275f133'
$tokenKey = 'IK_ORGO_TOKEN'
$apiBase = 'http://127.0.0.1:4000/api/v3'
$containerId = ''
$remoteJs = ''
$remoteJson = ''
$publisherHash = ''
$outboundHash = ''
$publisherIssued = $false
$outboundIssued = $false
$committed = $false

function Assert-KonnaxionEnv {
  if (-not (Test-Path -LiteralPath $kxEnv -PathType Leaf)) {throw 'backend/.env Konnaxion absent : aucune ecriture autorisee'}
  $content = [IO.File]::ReadAllText($kxEnv)
  foreach ($pair in @(
      @('IK_ORGO_INTERACTIONS_URL','http://127.0.0.1:4000/api/v3/ik/interactions'),
      @('IK_ORGO_TARGET_ORGANIZATION',$expectedOrg))) {
    $lines = @([regex]::Matches($content, '(?m)^\s*' + [regex]::Escape($pair[0]) + '\s*=([^\r\n]*)'))
    if ($lines.Count -ne 1) {throw "Configuration $($pair[0]) absente ou repetee"}
    $value = $lines[0].Groups[1].Value.Trim().Trim('"').Trim("'")
    if ($value -cne $pair[1]) {throw "Configuration $($pair[0]) non conforme; aucune ecriture"}
  }
  $tokenLines = @([regex]::Matches($content,'(?m)^\s*IK_ORGO_TOKEN\s*=([^\r\n]*)'))
  if ($tokenLines.Count -gt 1) {throw 'IK_ORGO_TOKEN defini plusieurs fois : refus'}
  if ($tokenLines.Count -eq 1 -and $tokenLines[0].Groups[1].Value.Trim().Trim('"').Trim("'")) {
    throw 'IK_ORGO_TOKEN existe deja : aucune substitution automatique'
  }
}
function New-Secret {
  return [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(48)).TrimEnd('=').Replace('+','-').Replace('/','_')
}
function Sha256([string]$value) {
  return [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($value))).ToLowerInvariant()
}
function Invoke-Boot([string]$mode,[string]$hash='') {
  $arguments = @('compose','exec','-T')
  if ($hash) { $arguments += @('-e',"KOA_IK_TOKEN_SHA256=$hash") }
  $arguments += @('api','node',$remoteJs,$mode,$remoteJson)
  $lines = @(& docker @arguments 2>&1)
  $exitCode = $LASTEXITCODE
  $marker = @($lines | Where-Object {$_ -is [string] -and $_.StartsWith('__KOA_FP_IK__=')}) | Select-Object -Last 1
  if (-not $marker) {throw "Conteneur Orgo : diagnostic $mode sans reponse structuree (code $exitCode)"}
  $obj = $marker.Substring('__KOA_FP_IK__='.Length) | ConvertFrom-Json
  if ($exitCode -ne 0 -or $obj.ok -ne $true) {throw "Operation Orgo $mode refusee : $($obj.error)"}
  return $obj
}
function Remove-RemoteFiles {
  if (-not $containerId) {return}
  $js = 'const fs=require("node:fs"); for (const p of process.argv.slice(1)) { if (/^\/app\/\.koa-fp-ik-[a-f0-9]{12}\.(cjs|json)$/.test(p)) fs.rmSync(p,{force:true}); }'
  & docker exec -u 0 $containerId node -e $js $remoteJs $remoteJson 2>$null | Out-Null
}
function Test-OrgoBearer([string]$bearer) {
  $headers = @{ Authorization="Bearer $bearer"; 'X-Organization-ID'=$expectedOrg }
  $response = Invoke-RestMethod -Method Get -Uri "$apiBase/auth/me" -Headers $headers -TimeoutSec 15
  if ($response.ok -ne $true -or $response.data.organizationId -cne $expectedOrg) {throw 'Le jeton IK ne cible pas le bon tenant'}
  $permissions = @($response.data.permissions | Sort-Object)
  if (($permissions -join ',') -cne 'signals:write,workflows:execute') {throw 'Permissions du jeton IK trop larges ou insuffisantes'}
}
function Save-KonnaxionToken([string]$bearer) {
  Assert-KonnaxionEnv
  $content = [IO.File]::ReadAllText($kxEnv)
  $count = [regex]::Matches($content,'(?m)^\s*IK_ORGO_TOKEN\s*=([^\r\n]*)').Count
  if ($count -eq 1) {
    $newContent = [regex]::Replace($content,'(?m)^(\s*IK_ORGO_TOKEN\s*=)[^\r\n]*$',{param($match) $match.Groups[1].Value + $bearer})
  } else {
    $sep = if ($content.EndsWith("`n")) {''} else {"`r`n"}
    $newContent = $content + $sep + 'IK_ORGO_TOKEN=' + $bearer + "`r`n"
  }
  $temp = "$kxEnv.tmp-$([guid]::NewGuid().ToString('N'))"
  try {
    [IO.File]::WriteAllText($temp,$newContent,[Text.UTF8Encoding]::new($false))
    # Replace in the same volume, no blank backup pathname (PS7 File.Replace regression).
    [IO.File]::Move($temp,$kxEnv,$true)
  } finally { if (Test-Path -LiteralPath $temp) {Remove-Item -LiteralPath $temp -Force} }
}

Push-Location $orgo
try {
  foreach ($p in @($sourceJs,$sourceJson)) {if (-not (Test-Path -LiteralPath $p -PathType Leaf)) {throw "Fichier du correctif absent : $p"}}
  if ((Get-FileHash -LiteralPath $sourceJson -Algorithm SHA256).Hash -cne $expectedHash) {throw 'Workflow de test modifie : empreinte inattendue'}
  Assert-KonnaxionEnv
  $running = @(& docker compose ps --services --status running)
  if ($LASTEXITCODE -ne 0 -or $running -notcontains 'api' -or $running -notcontains 'postgres' -or $running -notcontains 'worker') {throw 'Services Orgo Docker api/postgres/worker non demarres'}
  $containerId = ((& docker compose ps -q api) | Out-String).Trim()
  if (-not $containerId) {throw 'Conteneur API Orgo introuvable'}
  $suffix = ([guid]::NewGuid().ToString('N')).Substring(0,12)
  $remoteJs = "/app/.koa-fp-ik-$suffix.cjs"
  $remoteJson = "/app/.koa-fp-ik-$suffix.json"
  & docker cp $sourceJs "${containerId}:$remoteJs" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {throw 'Copie du script dans Orgo Docker echouee'}
  & docker cp $sourceJson "${containerId}:$remoteJson" 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) {throw 'Copie du workflow dans Orgo Docker echouee'}
  Write-Host '=== TANDEM / IK : SORTIE KONNAXION -> ORGO ==='
  $base = Invoke-Boot 'audit'
  Write-Host "[OK] Orgo FakePlant : $($base.users) comptes, tous disabled; 900 profils"
  Write-Host "[INFO] Workflow : $($base.workflow_code) ; etat : $($base.workflow_status)"
  Write-Host "[INFO] Jetons dedies existants : outbound=$($base.outbound_tokens), publication=$($base.publisher_tokens)"
  if ($base.workflow_status -eq 'CONFLIT') {throw 'Workflow de meme code deja present avec un contenu different'}
  if ($base.outbound_tokens -ne 0 -or $base.publisher_tokens -ne 0) {throw 'Jeton IK ou publisher deja present : arret sans doublon'}
  if (-not $Apply) {
    Write-Host '[OK] APERCU SEUL : lecture seule PostgreSQL; aucun jeton ni workflow publie.'
    Write-Host 'Le lanceur INSTALL_FAKEPLANT_IK_SORTIE.cmd est reserve a l ecriture.'
    return
  }
  if ($base.workflow_status -eq 'absent') {
    $publisher = New-Secret
    $publisherHash = Sha256 $publisher
    $issued=Invoke-Boot 'publisher-create' $publisherHash
    $publisherIssued=$true
    Write-Host '[OK] Jeton de publication provisoire cree (15 min, workflows:write seulement).'
    try {
      $body=[IO.File]::ReadAllText($sourceJson)
      $headers=@{Authorization="Bearer $publisher";'X-Organization-ID'=$expectedOrg;'Idempotency-Key'=[guid]::NewGuid().ToString()}
      $workflowCode=[string]$base.workflow_code
      $response=Invoke-RestMethod -Uri "$apiBase/workflows/$workflowCode/versions" -Method Post -Headers $headers -ContentType 'application/json' -Body $body -TimeoutSec 30
      if ($response.ok -ne $true -or -not $response.data.id) {throw 'Publication API sans recu valide'}
      Write-Host "[OK] Workflow publie par l API Orgo : code=$workflowCode version=$($response.data.version)"
    } finally {
      $publisher=$null
      if ($publisherIssued) {
        $revoked=Invoke-Boot 'publisher-delete' $publisherHash
        $publisherIssued=$false
        Write-Host '[OK] Jeton de publication supprime dans Orgo.'
      }
    }
  } else {
    Write-Host '[OK] Workflow identique deja publie; aucune nouvelle version creee.'
  }
  $check=Invoke-Boot 'audit'
  if ($check.workflow_status -ne 'identique' -or $check.publisher_tokens -ne 0) {throw 'Workflow non valide apres publication'}
  $outbound = New-Secret
  $outboundHash = Sha256 $outbound
  $issued=Invoke-Boot 'outbound-create' $outboundHash
  $outboundIssued=$true
  Test-OrgoBearer $outbound
  Write-Host '[OK] Jeton IK authentifie sur l API Orgo ; scopes stricts verifies.'
  Save-KonnaxionToken $outbound
  $committed = $true
  $outboundIssued = $false
  $outbound = $null
  Write-Host '[OK] IK_ORGO_TOKEN ajoute a Konnaxion/backend/.env (valeur masquee).'
  Write-Host '[FIN] Redemarrer Uvicorn. Aucun evenement IK envoye, aucune migration ni import.'
} finally {
  if (-not $committed -and $outboundIssued) {
    try { $revoke = Invoke-Boot 'outbound-delete' $outboundHash;Write-Warning 'Jeton sortant annule apres erreur.' }
    catch {Write-Warning 'Revoquer manuellement le jeton sortant; ne pas continuer : annulation echouee.'}
  }
  if ($publisherIssued) {
    try { $revoke = Invoke-Boot 'publisher-delete' $publisherHash; Write-Warning 'Jeton de publication temporaire annule.' }
    catch {Write-Warning 'Revoquer manuellement le jeton de publication; ne pas continuer.'}
  }
  try { Remove-RemoteFiles } catch { Write-Warning 'Fichiers temporaires Docker non nettoyes.' }
  Pop-Location
}
