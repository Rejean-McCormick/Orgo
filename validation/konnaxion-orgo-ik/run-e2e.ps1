[CmdletBinding()]
param(
    [string]$OrgoRoot = 'C:\mycode\Orgo\Orgo',
    [string]$KonnaxionRoot = 'C:\mycode\Konnaxion\Konnaxion',
    [string]$OrgoHostUrl = 'http://127.0.0.1:4000',
    [int]$TimeoutSeconds = 120,
    [string]$WorldKey = $env:KX_E2E_WORLD_KEY,
    [switch]$ListWorlds,
    [switch]$PublishWorkflowOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Get-EnvValue([string]$Path, [string]$Name) {
    $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match ('^' + [regex]::Escape($Name) + '=') } | Select-Object -Last 1
    if (-not $line) { return $null }
    return $line.Substring($Name.Length + 1).Trim().Trim('"').Trim("'")
}

function Invoke-DjangoJson([string]$Code) {
    Push-Location (Join-Path $KonnaxionRoot 'backend')
    try {
        $output = @(docker compose -f docker-compose.local.yml exec -T django python manage.py shell -c $Code 2>&1)
        $djangoExit = $LASTEXITCODE
    } finally { Pop-Location }
    $line = $output | Where-Object { $_ -like 'IK_E2E_JSON=*' } | Select-Object -Last 1
    if ($djangoExit -ne 0 -or -not $line) { throw "Django command did not emit IK_E2E_JSON. Output:`n$($output -join "`n")" }
    return $line.Substring('IK_E2E_JSON='.Length) | ConvertFrom-Json
}

function Invoke-Orgo {
    param([string]$Method, [string]$Path, [string]$Token, [object]$Body = $null, [string]$Key = '')
    $headers = @{ Authorization = "Bearer $Token" }
    if (-not $PublishWorkflowOnly) { $headers["X-Orgo-World-Key"] = [string]$scope.key }
    if ($Key) { $headers['Idempotency-Key'] = $Key }
    $args = @{
        Uri = "$OrgoHostUrl/api/v3/$Path"
        Method = $Method
        Headers = $headers
        ContentType = 'application/json'
        TimeoutSec = 20
        SkipHttpErrorCheck = $true
    }
    if ($null -ne $Body) { $args.Body = ($Body | ConvertTo-Json -Depth 40 -Compress) }
    $response = Invoke-WebRequest @args
    $json = if ($response.Content) { $response.Content | ConvertFrom-Json } else { $null }
    return [pscustomobject]@{ StatusCode = [int]$response.StatusCode; Json = $json }
}

if ($PublishWorkflowOnly) {
    if ($ListWorlds) { throw 'Choose either -PublishWorkflowOnly or -ListWorlds.' }
    if ($OrgoHostUrl -cnotmatch '\Ahttp://127\.0\.0\.1:[0-9]{1,5}\z') {
        throw 'Workflow publication requires a loopback Orgo test API URL.'
    }
    $orgoEnv = Join-Path $OrgoRoot '.env'
    $kxEnv = Join-Path $KonnaxionRoot 'backend\.envs\.local\.django'
    $organization = Get-EnvValue $orgoEnv 'ORGO_ORGANIZATION'
    $email = Get-EnvValue $orgoEnv 'ORGO_ADMIN_EMAIL'
    $workflowCode = Get-EnvValue $orgoEnv 'KONNAXION_DECISION_WORKFLOW_CODE'
    $expectedOrganization = Get-EnvValue $kxEnv 'IK_ORGO_TARGET_ORGANIZATION'
    if (-not $organization) { $organization = 'orgo' }
    if (-not $email) { $email = 'admin@example.test' }
    if ($workflowCode -cnotmatch '\A[a-z0-9][a-z0-9_-]{0,99}\z' -or -not $expectedOrganization) {
        throw 'Missing configured Orgo workflow code or Konnaxion target organization.'
    }
    $workflow = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'workflow.json') -Raw | ConvertFrom-Json -AsHashtable
    $password = Get-EnvValue $orgoEnv 'ORGO_ADMIN_PASSWORD'
    if (-not $password) {
        $secure = Read-Host "Orgo test administrator password ($email)" -AsSecureString
        $password = [System.Net.NetworkCredential]::new('', $secure).Password
    }
    try {
        $body = @{ organization = $organization; email = $email; password = $password } | ConvertTo-Json -Compress
        $login = Invoke-RestMethod -Uri "$OrgoHostUrl/api/v3/auth/login" -Method Post -ContentType 'application/json' -TimeoutSec 20 -Body $body
    } catch {
        throw 'Orgo test administrator login failed. Check the local administrator credentials.'
    } finally {
        $password = $null
        $body = $null
    }
    if ([string]$login.data.context.organizationId -ne $expectedOrganization) {
        throw 'The administrator organization differs from the Konnaxion IK target organization.'
    }
    $result = Invoke-Orgo -Method Post -Path "workflows/$workflowCode/versions" -Token ([string]$login.data.token) -Body $workflow -Key ([guid]::NewGuid().ToString())
    if ($result.StatusCode -notin @(200, 201)) {
        throw "Orgo workflow publication failed (HTTP $($result.StatusCode))."
    }
    Write-Host "Orgo workflow $workflowCode version $($result.Json.data.version) published."
    return
}

# Resolve a real persisted World/Release before creating any records.
if ($WorldKey -and $WorldKey -cnotmatch '\A[a-z0-9][a-z0-9_-]{0,127}\z') {
    throw 'WorldKey must contain only lowercase letters, digits, underscores or hyphens.'
}
$worldCode = @"
import json
from konnaxion.worlds.models import World
from konnaxion.worlds.services.tasks import world_release_scope

worlds = World.objects.filter(status='active', current_release_id__isnull=False)
world_key = '$WorldKey'
if '$($ListWorlds.IsPresent)' == 'True':
    print('IK_E2E_JSON='+json.dumps(list(worlds.order_by('key').values('key','current_release_id'))))
else:
    candidates = list((worlds.filter(key=world_key) if world_key else worlds).order_by('key')[:2])
    if len(candidates) != 1:
        raise ValueError('No unique active test World with a current release. Run -ListWorlds, then specify -WorldKey. If the list is empty, provision a test World first.')
    world = candidates[0]
    with world_release_scope(world_id=world.pk, release_id=world.current_release_id):
        print('IK_E2E_JSON='+json.dumps({'id':world.pk,'release_id':world.current_release_id,'key':world.key}))
"@
$scope = Invoke-DjangoJson $worldCode
if ($ListWorlds) {
    if (-not $scope) {
        Write-Host 'No active World with a current release in this database.'
    } else {
        $scope | Format-Table key, current_release_id
    }
    return
}
Write-Host "Konnaxion test World: $($scope.key), release ID: $($scope.release_id)."

$kxEnv = Join-Path $KonnaxionRoot 'backend\.envs\.local\.django'
if (-not (Test-Path -LiteralPath $kxEnv)) { throw "Missing $kxEnv. Run prepare-local.ps1 first." }
$machineToken = Get-EnvValue $kxEnv 'IK_ORGO_TOKEN'
$organizationId = Get-EnvValue $kxEnv 'IK_ORGO_TARGET_ORGANIZATION'
if (-not $machineToken -or -not $organizationId) { throw 'IK_ORGO_TOKEN / IK_ORGO_TARGET_ORGANIZATION are not configured. Run prepare-local.ps1 first.' }

$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$title = "IK E2E $stamp"
$createCode = @"
import json
from django.conf import settings
from django.utils import timezone
from django.db import connection, transaction
from secrets import randbits
from konnaxion.worlds.services.tasks import world_release_scope
from konnaxion.ethikos.models import DecisionRecord
from konnaxion.integrations.interaction_kernel.services import publish_decision_record, enqueue_decision_execution
db = connection.settings_dict
if (db.get('HOST'), db.get('NAME')) != ('kx-e2e-postgres', 'konnaxion_e2e'):
    raise SystemExit('The test requires the dedicated Konnaxion Docker E2E database.')
# The Orgo reference includes the numeric DecisionRecord ID. Keep test IDs in
# the upper half of the JSON safe-integer range, away from local sequences.
decision_id = (1 << 52) | randbits(52)
with world_release_scope(world_id=$($scope.id), release_id=$($scope.release_id)):
    with transaction.atomic():
        r=DecisionRecord.objects.create(pk=decision_id, title='$title', description='Konnaxion-Orgo qualification', status=DecisionRecord.STATUS_CLOSED, closed_at=timezone.now(), baseline_result_json={'qualification':'ik-e2e'})
        r=publish_decision_record(decision_id=r.pk)
        e=enqueue_decision_execution(decision_id=r.pk, target_organization=settings.IK_ORGO_TARGET_ORGANIZATION, execution_scope={'qualification':'ik-e2e'})
    print('IK_E2E_JSON='+json.dumps({'decision_id':r.pk,'emission_id':e.pk,'idempotency_key':e.idempotency_key,'artifact_digest':r.artifact_digest}))
"@
$created = Invoke-DjangoJson $createCode
Write-Host "Decision $($created.decision_id), emission $($created.emission_id) queued." -ForegroundColor Cyan

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$emission = $null
$admitted = @('accepted', 'succeeded', 'delivered')
do {
    Start-Sleep -Seconds 2
    $pollCode = @"
import json
from konnaxion.ethikos.models import InteractionEmission
from konnaxion.worlds.services.tasks import world_release_scope
with world_release_scope(world_id=$($scope.id), release_id=$($scope.release_id)):
    e=InteractionEmission.objects.get(pk=$($created.emission_id))
    print('IK_E2E_JSON='+json.dumps({'status':e.status,'attempts':e.attempts,'error_code':e.last_error_code,'error_detail':e.last_error_detail,'receipt':e.receipt_json,'envelope':e.envelope_json}, default=str))
"@
    $emission = Invoke-DjangoJson $pollCode
    Write-Host "Konnaxion emission: $($emission.status) (attempts=$($emission.attempts))"
    if ($emission.status -in @('dead', 'failed')) {
        $code = [string]$emission.error_code
        $remoteCode = ''
        if ($null -ne $emission.receipt) {
            $property = $emission.receipt.PSObject.Properties['error']
            if ($null -ne $property -and $null -ne $property.Value) {
                $remoteCodeProperty = $property.Value.PSObject.Properties['code']
                if ($null -ne $remoteCodeProperty) { $remoteCode = [string]$remoteCodeProperty.Value }
            }
        }
        if ($remoteCode -cmatch '\A[A-Z][A-Z0-9_]{1,79}\z') { $code = "$code / Orgo: $remoteCode" }
        throw "Konnaxion emission $($emission.status): $code"
    }
} while ($emission.status -notin $admitted -and (Get-Date) -lt $deadline)
if ($emission.status -notin $admitted) { throw 'Timed out waiting for Konnaxion emission delivery.' }

$signalId = [string]$emission.receipt.data.signal_id
if (-not $signalId) { throw 'Orgo receipt did not include signal_id.' }
Write-Host "Orgo accepted Signal $signalId." -ForegroundColor Green

$signal = $null
do {
    Start-Sleep -Seconds 2
    $response = Invoke-Orgo -Method Get -Path "signals/$signalId" -Token $machineToken
    if ($response.StatusCode -ne 200) { throw "Signal read failed HTTP $($response.StatusCode)." }
    $signal = $response.Json.data
    Write-Host "Orgo Signal: $($signal.status)"
} while ($signal.status -ne 'PROCESSED' -and (Get-Date) -lt $deadline)
if ($signal.status -ne 'PROCESSED') { throw 'Timed out waiting for Orgo Signal processing.' }
$caseId = [string]$signal.case_id
if (-not $caseId) { throw 'Processed Signal has no case_id.' }

$workspace = $null
$operation = $null
do {
    Start-Sleep -Seconds 2
    $response = Invoke-Orgo -Method Get -Path "cases/$caseId" -Token $machineToken
    if ($response.StatusCode -ne 200) { throw "Case read failed HTTP $($response.StatusCode)." }
    $workspace = $response.Json.data
    if (@($workspace.tasks).Count -ne 1) { throw "Expected exactly 1 task, found $(@($workspace.tasks).Count)." }
    $operation = @($workspace.operations | Where-Object { $_.provider -eq 'konnaxion' }) | Select-Object -First 1
    if ($operation) {
        Write-Host "Orgo impact operation: $($operation.status)"
        if ($operation.status -eq 'FAILED') {
            throw "Orgo impact operation failed: $($operation.error)"
        }
    }
} while ((-not $operation -or $operation.status -ne 'SUCCEEDED') -and (Get-Date) -lt $deadline)
if (-not $operation) { throw 'No Konnaxion IntegrationOperation was created.' }
if ($operation.status -ne 'SUCCEEDED') { throw "Impact IntegrationOperation did not succeed; status=$($operation.status), error=$($operation.error)" }

$impactCode = @"
import json
from konnaxion.ethikos.models import OrgoImpactPublication
qs=OrgoImpactPublication.objects.filter(request_json__id='$($operation.id)')
row=qs.first()
print('IK_E2E_JSON='+json.dumps({'count':qs.count(),'id':row.pk if row else None,'external_reference':row.external_reference if row else None}, default=str))
"@
$impact = Invoke-DjangoJson $impactCode
if ([int]$impact.count -ne 1) { throw "Expected exactly 1 Konnaxion impact publication for operation $($operation.id), found $($impact.count)." }
Write-Host "Konnaxion impact publication $($impact.id) confirmed." -ForegroundColor Green

# Transport replay: same semantic request, new transient id/time, same idempotency key.
$replayEnvelope = $emission.envelope | ConvertTo-Json -Depth 40 | ConvertFrom-Json
$replayEnvelope.id = [guid]::NewGuid().ToString()
$replayEnvelope.time = (Get-Date).ToUniversalTime().ToString('o')
$replay = Invoke-Orgo -Method Post -Path 'ik/interactions' -Token $machineToken -Key ([string]$created.idempotency_key) -Body $replayEnvelope
if ($replay.StatusCode -notin @(200, 201)) { throw "Replay failed HTTP $($replay.StatusCode)." }
if ([string]$replay.Json.data.signal_id -ne $signalId) { throw 'Replay did not return the original Orgo Signal.' }

$search = Invoke-Orgo -Method Get -Path ("signals?search=" + [uri]::EscapeDataString("Governed decision $($created.decision_id)")) -Token $machineToken
if ($search.StatusCode -ne 200 -or [int]$search.Json.data.total -ne 1) { throw 'Replay created or exposed an unexpected Signal count.' }
$impactAfterReplay = Invoke-DjangoJson $impactCode
if ([int]$impactAfterReplay.count -ne 1) { throw 'Replay duplicated the Konnaxion impact publication.' }
Write-Host 'Replay idempotency confirmed: 1 Signal, 1 impact.' -ForegroundColor Green

# Divergent semantic content under the same idempotency key must conflict.
$conflictEnvelope = $emission.envelope | ConvertTo-Json -Depth 40 | ConvertFrom-Json
$conflictEnvelope.id = [guid]::NewGuid().ToString()
$conflictEnvelope.time = (Get-Date).ToUniversalTime().ToString('o')
$conflictEnvelope.data.decision_revision = '999'
$conflict = Invoke-Orgo -Method Post -Path 'ik/interactions' -Token $machineToken -Key ([string]$created.idempotency_key) -Body $conflictEnvelope
if ($conflict.StatusCode -ne 409 -or $conflict.Json.error.code -ne 'IK_IDEMPOTENCY_CONFLICT') {
    throw "Expected IK_IDEMPOTENCY_CONFLICT/409, got HTTP $($conflict.StatusCode): $($conflict.Json | ConvertTo-Json -Depth 8 -Compress)"
}
Write-Host 'Divergent replay conflict confirmed.' -ForegroundColor Green

Write-Host ''
Write-Host 'KONNAXION <-> ORGO IK E2E PASS' -ForegroundColor Green
Write-Host "DecisionRecord : $($created.decision_id)"
Write-Host "Signal         : $signalId"
Write-Host "Case           : $caseId"
Write-Host "Task           : $($workspace.tasks[0].task_id)"
Write-Host "Impact op      : $($operation.id)"
Write-Host "Impact row     : $($impact.id)"
