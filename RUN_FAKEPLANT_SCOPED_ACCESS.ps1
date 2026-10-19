param([switch]$Create, [switch]$CheckApi)
$ErrorActionPreference='Stop'
Set-StrictMode -Version Latest
$orgo=(Split-Path -Parent $MyInvocation.MyCommand.Path)
$expected='0c2d7244-a0c0-4a10-8f11-0389f275f133'
$secretDir='C:\mycode\Konnaxion\Tandem_Local'
$secretFile=Join-Path $secretDir 'fakeplant-orgo-work-token.DPAPI.txt'

function Check-Api {
  if (-not (Test-Path -LiteralPath $secretFile -PathType Leaf)) {throw 'Jeton DPAPI absent; creation non effectuee.'}
  $secret=Get-Content -Raw -LiteralPath $secretFile | ConvertTo-SecureString
  $ptr=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
  try {$raw=[Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)}
  try {
    $headers=@{'Authorization'="Bearer $raw";'X-Organization-ID'=$expected}
    try {$resp=Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:4000/api/v3/auth/me' -Headers $headers -TimeoutSec 15}
    catch {throw 'API Orgo inaccessible ou jeton refuse (HTTP / identite). Ne pas injecter.'}
    if ($resp.ok -ne $true -or $resp.data.organizationId -cne $expected) {throw 'Contexte API ne correspond pas au tenant FakePlant.'}
    $actual=@($resp.data.permissions | Sort-Object)
    if (($actual -join ',') -cne 'work:read,work:write') {throw 'Scopes API incorrects. Refus de poursuivre.'}
    Write-Host '[OK] API authentifiee : tenant FakePlant UUID confirme.'
    Write-Host '[OK] Scopes autorises : work:read, work:write (aucun droit admin).'
    Write-Host '[OK] Aucune donnee operationnelle creee par ce test GET.'
  } finally {$raw=$null}
}
if ($CheckApi) {Check-Api; return}

$bootstrap=Join-Path $orgo 'tools\fakeplant_tandem\service-token.cjs'
if (-not (Test-Path -LiteralPath $bootstrap -PathType Leaf)) {throw 'Script service-token.cjs manquant.'}
Push-Location $orgo
$id='';$remote='';$tempSecret='';$issued=$false
try {
  $services=@(& docker compose ps --services --status running 2>&1)
  if ($LASTEXITCODE -ne 0 -or $services -notcontains 'api' -or $services -notcontains 'postgres') {throw 'Docker Orgo api et postgres doivent etre actifs.'}
  $id=((& docker compose ps -q api) | Out-String).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $id) {throw 'Conteneur API introuvable.'}
  $suffix=([guid]::NewGuid().ToString('N')).Substring(0,12)
  $remote="/app/.koa-fp-token-$suffix.cjs"
  & docker cp $bootstrap "${id}:$remote" | Out-Null
  if ($LASTEXITCODE -ne 0) {throw 'Echec copie du diagnostic dans Docker.'}
  Write-Host '=== ORGO : ACCES DE SERVICE FAKEPLANT LIMITE ==='
  Write-Host "Tenant / UUID : fakeplant / $expected"
  Write-Host 'Scopes : work:read, work:write | Duree : 24 h'
  Write-Host '=== PRE-CONTROLE BASE DOCKER (READ ONLY) ==='
  & docker compose exec -T api node $remote --preview
  if ($LASTEXITCODE -ne 0) {throw 'Pre-controle refuse. Aucune creation.'}
  if (-not $Create) {Write-Host '[FIN] Apercu seulement. Aucun jeton cree.';return}
  if (Test-Path -LiteralPath $secretFile) {throw 'Un jeton local chiffre existe deja. Aucun ecrasement.'}
  New-Item -ItemType Directory -Path $secretDir -Force | Out-Null
  $bytes=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
  $raw=[Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+','-').Replace('/','_')
  $hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData([Text.Encoding]::UTF8.GetBytes($raw))).ToLowerInvariant()
  $encrypted=(ConvertTo-SecureString -String $raw -AsPlainText -Force) | ConvertFrom-SecureString
  $raw=$null
  $tempSecret="$secretFile.tmp-$suffix"
  [IO.File]::WriteAllText($tempSecret,$encrypted,[Text.UTF8Encoding]::new($false))
  Write-Host '=== CREATION : 1 JETON 24 H + 1 LIGNE JOURNAL AUDIT ==='
  & docker compose exec -T -e "KOA_FAKEPLANT_TOKEN_SHA256=$hash" api node $remote --create
  if ($LASTEXITCODE -ne 0) {throw 'Creation refusee ou echouee : verifier le journal, ne pas relancer sans diagnostic.'}
  $issued=$true
  Move-Item -LiteralPath $tempSecret -Destination $secretFile -ErrorAction Stop
  $tempSecret=''
  $hash=$null;$encrypted=$null
  Write-Host "[OK] Secret chiffre DPAPI (utilisateur Windows courant) : $secretFile"
  Write-Host '[OK] Secret jamais affiche ni transmis au conteneur en clair.'
  Write-Host '=== VERIFICATION API LOCALE ==='
  Check-Api
  Write-Host '[FIN] Acces de test uniquement. Ne pas utiliser en production.'
} finally {
  if ($id -and $remote) {
    $cleanup="const fs=require('fs');for(const p of process.argv.slice(1)){if(/^\/app\/\.koa-fp-token-[0-9a-f]{12}\.cjs$/.test(p)) fs.rmSync(p,{force:true});}"
    & docker exec -u 0 $id node -e $cleanup $remote 2>$null | Out-Null
  }
  if ($tempSecret -and (Test-Path -LiteralPath $tempSecret)) {
    if ($issued) {Write-Warning "Jeton cree mais deplacement impossible : conserver et securiser le fichier DPAPI temporaire $tempSecret"}
    else {Remove-Item -LiteralPath $tempSecret -Force -ErrorAction SilentlyContinue}
  }
  Pop-Location
}
