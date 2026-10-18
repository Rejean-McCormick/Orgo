$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$jsFile = Join-Path $PSScriptRoot 'diag-fakeplant-acl.cjs'

try {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
        throw 'Docker indisponible : demarrer Docker Desktop.'
    }
    if (-not (Test-Path -LiteralPath (Join-Path $root 'docker-compose.yml'))) {
        throw "docker-compose.yml introuvable dans $root"
    }
    Push-Location -LiteralPath $root
    try {
        $running = @(& docker compose ps --services --status running 2>&1)
        if ($LASTEXITCODE -ne 0) { throw 'docker compose ps a echoue.' }
        if ('api' -notin $running) { throw 'Le service API Orgo doit etre demarre.' }

        Write-Host '[LECTURE SEULE] Base PostgreSQL utilisee par le conteneur API Orgo.'
        Write-Host '[CIBLE] Slug fakeplant, UUID fixe verifie avant toute requete de compte.'
        Get-Content -LiteralPath $jsFile -Raw -Encoding UTF8 | & docker compose exec -T api node -
        if ($LASTEXITCODE -ne 0) { throw 'Requete Prisma/Orgo refusee ou indisponible.' }
    } finally {
        Pop-Location
    }
} catch {
    Write-Host ('[ECHEC] ' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
