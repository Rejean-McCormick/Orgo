param([switch]$Apply)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$orgo = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $orgo '..\..')).Path
$fixture = Join-Path $repoRoot 'Konnaxion\Konnaxion_Worlds\universes\fakeplant\fixture'
$orgoMirror = Join-Path $repoRoot 'Orgo\Orgo_Worlds\fakeplant\fixture'
$importer = Join-Path $orgo 'apps\api\scripts\fakeplant-people.mjs'
$expectedUuid = '0c2d7244-a0c0-4a10-8f11-0389f275f133'

Write-Host '=== ORGO : 900 PERSONAS FAKEPLANT, TENANT ISOLE ==='
Write-Host 'Tenant attendu : fakeplant'
Write-Host "UUID attendu   : $expectedUuid"
Write-Host ('Mode           : ' + $(if ($Apply) {'IMPORT AVEC CONFIRMATIONS'} else {'CONTROLES SANS ECRITURE EN BASE'}))

if (!(Test-Path -LiteralPath $fixture -PathType Container)) {throw "Fixture absente : $fixture"}
if (!(Test-Path -LiteralPath $orgoMirror -PathType Container)) {throw "Fixture miroir absente : $orgoMirror"}
if (!(Test-Path -LiteralPath $importer -PathType Leaf)) {throw "Importeur absent : $importer"}
$manifest = Get-Content -Raw -LiteralPath (Join-Path $fixture 'MANIFEST.json') | ConvertFrom-Json
foreach ($property in $manifest.sha256.PSObject.Properties) {
    $filename = $property.Name
    if ($filename -cnotmatch '^[A-Za-z0-9_.-]+\.json$') {throw "Nom suspect dans MANIFEST : $filename"}
    $canonicalFile = Join-Path $fixture $filename
    $mirrorFile = Join-Path $orgoMirror $filename
    if (!(Test-Path -LiteralPath $canonicalFile -PathType Leaf)) {throw "Fichier source absent : $filename"}
    if (!(Test-Path -LiteralPath $mirrorFile -PathType Leaf)) {throw "Fichier miroir absent : $filename"}
    $canonicalHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $canonicalFile).Hash.ToLowerInvariant()
    $mirrorHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $mirrorFile).Hash.ToLowerInvariant()
    if ($canonicalHash -ne $property.Value.ToLowerInvariant() -or $canonicalHash -ne $mirrorHash) {
        throw "Manifest / Konnaxion / Orgo divergence : $filename"
    }
}
Write-Host '[OK] Fixture canonique et miroir : empreintes identiques.'

Push-Location $orgo
$id = ''
$remoteDir = ''
$remoteScript = ''
$oldFixture = [Environment]::GetEnvironmentVariable('FAKEPLANT_FIXTURE_ROOT', 'Process')
try {
    $env:FAKEPLANT_FIXTURE_ROOT = $fixture
    & node $importer --preview
    if ($LASTEXITCODE -ne 0) {throw 'Preview Node local echoue.'}

    $services = @(& docker compose ps --services --status running 2>&1)
    if ($LASTEXITCODE -ne 0 -or $services -notcontains 'api' -or $services -notcontains 'postgres') {
        throw 'Docker Orgo : api et postgres doivent etre en marche.'
    }
    $id = ((& docker compose ps -q api) | Out-String).Trim()
    if ($LASTEXITCODE -ne 0 -or !$id) {throw 'Conteneur api introuvable.'}
    $suffix = ([guid]::NewGuid().ToString('N')).Substring(0,12)
    $remoteDir = "/tmp/koa-fakeplant-fixture-$suffix"
    $remoteScript = "/app/.koa-fakeplant-import-$suffix.mjs"

    & docker cp $fixture "${id}:$remoteDir"
    if ($LASTEXITCODE -ne 0) {throw 'Echec de copie de la fixture dans le conteneur API.'}
    & docker cp $importer "${id}:$remoteScript"
    if ($LASTEXITCODE -ne 0) {throw 'Echec de copie de l importeur dans le conteneur API.'}
    $dockerEnv = @('-e', "FAKEPLANT_FIXTURE_ROOT=$remoteDir", '-e', "FAKEPLANT_EXPECTED_ORGO_UUID=$expectedUuid")

    Write-Host "`n=== VERIFICATION BASE ORGO DOCKER (LECTURE SEULE) ==="
    & docker compose exec -T @dockerEnv api node $remoteScript --check-db
    if ($LASTEXITCODE -ne 0) {throw 'Verification de la base/UUID refusee. Aucune importation.'}

    if (!$Apply) {
        Write-Host "`n[FIN] Aucun employe importe. Pour lancer avec confirmations : IMPORT_FAKEPLANT_900_ORGO.cmd"
        return
    }

    Write-Host "`nATTENTION : creation possible de 900 comptes DESACTIVES et 900 profils dans PostgreSQL Orgo."
    Write-Host 'Sans mot de passe, sans invitation, sans role, sans workflow.'
    $backup = Read-Host 'Confirmer une sauvegarde recente de la base : taper SAUVEGARDE OK'
    if ($backup -cne 'SAUVEGARDE OK') {Write-Host '[ANNULE] Sauvegarde non confirmee.'; return}
    $answer = Read-Host 'Confirmer les 900 identites du tenant FakePlant : taper IMPORTER 900 fakeplant'
    if ($answer -cne 'IMPORTER 900 fakeplant') {Write-Host '[ANNULE] Aucune ecriture en base.'; return}

    Write-Host "`n=== IMPORT DOCKER ATOMIQUE / ORG UUID VERIFIE ==="
    & docker compose exec -T @dockerEnv api node $remoteScript --apply --confirm-fakeplant
    if ($LASTEXITCODE -ne 0) {throw 'Import echoue. La transaction Prisma devrait etre annulee. Verifier en lecture seule.'}
    Write-Host "`n=== POST-CONTROLE BASE DOCKER (LECTURE SEULE) ==="
    & docker compose exec -T @dockerEnv api node $remoteScript --check-db
    if ($LASTEXITCODE -ne 0) {throw 'Import rapporte OK mais post-controle echoue.'}
    Write-Host '[OK] Import et post-controle termines. SSO / ACL / IK non actives.'
} finally {
    if ($id -and ($remoteDir -or $remoteScript)) {
        # Suppression des fichiers temporaires UNIQUEMENT; aucune base affectee.
        $cleanup = "const fs=require('fs'); for(const p of process.argv.slice(1)) if(p.startsWith('/tmp/koa-fakeplant-fixture-')||p.startsWith('/app/.koa-fakeplant-import-')) fs.rmSync(p,{recursive:true,force:true});"
        & docker exec -u 0 $id node -e $cleanup $remoteDir $remoteScript 2>$null | Out-Null
    }
    if ($null -eq $oldFixture) {Remove-Item Env:FAKEPLANT_FIXTURE_ROOT -ErrorAction SilentlyContinue}
    else {$env:FAKEPLANT_FIXTURE_ROOT = $oldFixture}
    Pop-Location
}
