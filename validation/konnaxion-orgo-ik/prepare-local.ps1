[CmdletBinding()]
param(
    [string]$OrgoRoot = 'C:\mycode\Orgo\Orgo',
    [string]$KonnaxionRoot = 'C:\mycode\Konnaxion\Konnaxion',
    [string]$OrgoOrganization = 'orgo',
    [string]$OrgoAdminEmail = 'admin@example.test',
    [string]$WorkflowCode = 'konnaxion_decision_v1',
    [string]$DecisionLabel = '1.11',
    [string]$OrgoHostUrl = 'http://127.0.0.1:4000',
    [string]$OrgoUrlFromKonnaxion = 'http://host.docker.internal:4000/api/v3/ik/interactions',
    [string]$KonnaxionUrlFromOrgo = 'http://host.docker.internal:8000/api/integrations/ik/konnaxion/interactions/'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-EnvValue([string]$Path, [string]$Name) {
    if (-not (Test-Path -LiteralPath $Path)) { return $null }
    $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match ('^' + [regex]::Escape($Name) + '=') } | Select-Object -Last 1
    if (-not $line) { return $null }
    return $line.Substring($Name.Length + 1).Trim().Trim('"').Trim("'")
}

function Set-EnvValue([string]$Path, [string]$Name, [string]$Value) {
    $parent = Split-Path -Parent $Path
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $lines = if (Test-Path -LiteralPath $Path) { @(Get-Content -LiteralPath $Path) } else { @() }
    $prefix = "$Name="
    $found = $false
    $updated = foreach ($line in $lines) {
        if ($line.StartsWith($prefix, [System.StringComparison]::Ordinal)) {
            $found = $true
            "$Name=$Value"
        } else { $line }
    }
    if (-not $found) { $updated += "$Name=$Value" }
    Set-Content -LiteralPath $Path -Value $updated -Encoding utf8
}

function New-Secret([int]$Bytes = 32) {
    $buffer = New-Object byte[] $Bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+','-').Replace('/','_')
}

function ConvertFrom-Secure([Security.SecureString]$Secure) {
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
    try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
}

function Wait-Http([string]$Url, [int]$Seconds = 90) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    do {
        try {
            $r = Invoke-WebRequest -Uri $Url -Method Get -TimeoutSec 5 -SkipHttpErrorCheck
            if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) { return }
        } catch {}
        Start-Sleep -Seconds 2
    } while ((Get-Date) -lt $deadline)
    throw "Timed out waiting for $Url"
}

function Invoke-OrgoJson {
    param(
        [string]$Method,
        [string]$Path,
        [object]$Body = $null,
        [string]$Token = '',
        [string]$IdempotencyKey = ''
    )
    $headers = @{}
    if ($Token) { $headers.Authorization = "Bearer $Token" }
    if ($IdempotencyKey) { $headers['Idempotency-Key'] = $IdempotencyKey }
    $args = @{
        Uri = "$OrgoHostUrl/api/v3/$Path"
        Method = $Method
        Headers = $headers
        ContentType = 'application/json'
        TimeoutSec = 20
    }
    if ($null -ne $Body) { $args.Body = ($Body | ConvertTo-Json -Depth 30 -Compress) }
    return Invoke-RestMethod @args
}

$orgoEnv = Join-Path $OrgoRoot '.env'
$kxBackend = Join-Path $KonnaxionRoot 'backend'
$kxEnv = Join-Path $kxBackend '.envs\.local\.django'
$workflowPath = Join-Path $PSScriptRoot 'workflow.json'

foreach ($path in @($OrgoRoot, $KonnaxionRoot, $workflowPath)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Missing required path: $path" }
}
if (-not (Test-Path -LiteralPath $kxEnv)) {
    throw "Konnaxion local env does not exist: $kxEnv. Complete the normal Konnaxion local setup first."
}

$postgresPassword = Get-EnvValue $orgoEnv 'POSTGRES_PASSWORD'
if (-not $postgresPassword) {
    $secure = Read-Host 'Orgo POSTGRES_PASSWORD (existing DB password if the volume already exists)' -AsSecureString
    $postgresPassword = ConvertFrom-Secure $secure
    if (-not $postgresPassword) { throw 'POSTGRES_PASSWORD is required.' }
    Set-EnvValue $orgoEnv 'POSTGRES_PASSWORD' $postgresPassword
}

$adminPassword = Get-EnvValue $orgoEnv 'ORGO_ADMIN_PASSWORD'
if (-not $adminPassword) {
    $secure = Read-Host 'Orgo admin password (minimum 12 characters)' -AsSecureString
    $adminPassword = ConvertFrom-Secure $secure
    if ($adminPassword.Length -lt 12) { throw 'ORGO_ADMIN_PASSWORD must be at least 12 characters.' }
    Set-EnvValue $orgoEnv 'ORGO_ADMIN_PASSWORD' $adminPassword
}

$impactToken = Get-EnvValue $kxEnv 'IK_ORGO_INBOUND_TOKEN'
if (-not $impactToken) { $impactToken = New-Secret }

Set-EnvValue $orgoEnv 'ORGO_ORGANIZATION' $OrgoOrganization
Set-EnvValue $orgoEnv 'ORGO_ADMIN_EMAIL' $OrgoAdminEmail
Set-EnvValue $orgoEnv 'KONNAXION_DECISION_WORKFLOW_CODE' $WorkflowCode
Set-EnvValue $orgoEnv 'KONNAXION_DECISION_LABEL' $DecisionLabel
Set-EnvValue $orgoEnv 'KONNAXION_DECISION_TYPE' 'governance_decision'
Set-EnvValue $orgoEnv 'KONNAXION_DECISION_CATEGORY' 'request'
Set-EnvValue $orgoEnv 'KONNAXION_DECISION_SEVERITY' 'MODERATE'
Set-EnvValue $orgoEnv 'KONNAXION_IK_URL' $KonnaxionUrlFromOrgo
Set-EnvValue $orgoEnv 'KONNAXION_IK_TOKEN' $impactToken
Set-EnvValue $orgoEnv 'ORGO_ALLOW_INSECURE_LOCAL_PROVIDER_HTTP' 'true'

Set-EnvValue $kxEnv 'IK_ORGO_INTERACTIONS_URL' $OrgoUrlFromKonnaxion
Set-EnvValue $kxEnv 'IK_ORGO_INBOUND_TOKEN' $impactToken
Set-EnvValue $kxEnv 'IK_HTTP_TIMEOUT_SECONDS' '10'
Set-EnvValue $kxEnv 'IK_DELIVERY_MAX_ATTEMPTS' '8'
Set-EnvValue $kxEnv 'IK_DELIVERY_RETRY_BASE_SECONDS' '5'
Set-EnvValue $kxEnv 'IK_DELIVERY_RETRY_MAX_SECONDS' '900'

Write-Host 'Starting Orgo core services...' -ForegroundColor Cyan
Push-Location $OrgoRoot
try {
    docker compose up -d --build postgres migrate api worker
    docker compose --profile setup run --rm seed
} finally { Pop-Location }
Wait-Http "$OrgoHostUrl/health/ready" 120

$login = Invoke-OrgoJson -Method Post -Path 'auth/login' -Body @{
    organization = $OrgoOrganization
    email = $OrgoAdminEmail
    password = $adminPassword
}
$adminToken = [string]$login.data.token
$organizationId = [string]$login.data.context.organizationId
if (-not $adminToken -or -not $organizationId) { throw 'Orgo login did not return token and organizationId.' }

$workflow = Get-Content -LiteralPath $workflowPath -Raw | ConvertFrom-Json -AsHashtable
$publish = Invoke-OrgoJson -Method Post -Path "workflows/$WorkflowCode/versions" -Body $workflow -Token $adminToken -IdempotencyKey ([guid]::NewGuid().ToString())
Write-Host "Published workflow $WorkflowCode version $($publish.data.version)." -ForegroundColor Green

$tokens = Invoke-OrgoJson -Method Get -Path 'identity/tokens' -Token $adminToken
foreach ($token in @($tokens.data | Where-Object { $_.name -eq 'konnaxion-ik' })) {
    try {
        Invoke-OrgoJson -Method Delete -Path "identity/tokens/$($token.id)" -Token $adminToken -IdempotencyKey ([guid]::NewGuid().ToString()) | Out-Null
    } catch {
        Write-Warning "Could not revoke prior konnaxion-ik token $($token.id): $($_.Exception.Message)"
    }
}

$expires = (Get-Date).ToUniversalTime().AddDays(90).ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
$issued = Invoke-OrgoJson -Method Post -Path 'identity/tokens' -Token $adminToken -IdempotencyKey ([guid]::NewGuid().ToString()) -Body @{
    name = 'konnaxion-ik'
    scopes = @(
        'signals:write', 'signals:read', 'workflows:execute',
        'work:write', 'work:read', 'integrations:write', 'integrations:read'
    )
    expires_at = $expires
}
$machineToken = [string]$issued.data.token
if (-not $machineToken) { throw 'Orgo did not return the new API token secret.' }

Set-EnvValue $kxEnv 'IK_ORGO_TOKEN' $machineToken
Set-EnvValue $kxEnv 'IK_ORGO_TARGET_ORGANIZATION' $organizationId

Write-Host 'Building/migrating/recreating Konnaxion Django + Celery...' -ForegroundColor Cyan
Push-Location $kxBackend
try {
    docker compose -f docker-compose.local.yml build django celeryworker
    docker compose -f docker-compose.local.yml run --rm django python manage.py migrate --noinput
    docker compose -f docker-compose.local.yml up -d --force-recreate django celeryworker redis mailpit
} finally { Pop-Location }
Wait-Http 'http://127.0.0.1:8000/health/ready/' 120

Write-Host 'Running cross-container connectivity preflight...' -ForegroundColor Cyan
Push-Location $kxBackend
try {
    docker compose -f docker-compose.local.yml exec -T django python -c "import urllib.request; r=urllib.request.urlopen('http://host.docker.internal:4000/health/ready', timeout=5); print(r.status)" | Out-Host
} finally { Pop-Location }
Push-Location $OrgoRoot
try {
    docker compose exec -T worker node -e "fetch('http://host.docker.internal:8000/health/ready/').then(r=>{console.log(r.status);process.exit(r.ok?0:1)}).catch(e=>{console.error(e);process.exit(1)})" | Out-Host
} finally { Pop-Location }

Write-Host ''
Write-Host 'IK local runtime is prepared.' -ForegroundColor Green
Write-Host "Orgo organization UUID: $organizationId"
Write-Host "Workflow: $WorkflowCode"
Write-Host 'Secrets were written to the existing local env files and are not printed here.'
Write-Host "Next: pwsh -NoProfile -File `"$PSScriptRoot\run-e2e.ps1`"" -ForegroundColor Cyan
