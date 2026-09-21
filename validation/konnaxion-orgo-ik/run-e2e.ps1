[CmdletBinding()]
param(
    [string]$OrgoRoot = 'C:\mycode\Orgo\Orgo',
    [string]$KonnaxionRoot = 'C:\mycode\Konnaxion\Konnaxion',
    [string]$OrgoHostUrl = 'http://127.0.0.1:4000',
    [int]$TimeoutSeconds = 120
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
    } finally { Pop-Location }
    $line = $output | Where-Object { $_ -like 'IK_E2E_JSON=*' } | Select-Object -Last 1
    if (-not $line) { throw "Django command did not emit IK_E2E_JSON. Output:`n$($output -join "`n")" }
    return $line.Substring('IK_E2E_JSON='.Length) | ConvertFrom-Json
}

function Invoke-Orgo {
    param([string]$Method, [string]$Path, [string]$Token, [object]$Body = $null, [string]$Key = '')
    $headers = @{ Authorization = "Bearer $Token" }
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
from konnaxion.ethikos.models import DecisionRecord
from konnaxion.integrations.interaction_kernel.services import publish_decision_record, enqueue_decision_execution
r=DecisionRecord.objects.create(title='$title', description='Konnaxion-Orgo qualification', status=DecisionRecord.STATUS_CLOSED, closed_at=timezone.now(), baseline_result_json={'qualification':'ik-e2e'})
r=publish_decision_record(decision_id=r.pk)
e=enqueue_decision_execution(decision_id=r.pk, target_organization=settings.IK_ORGO_TARGET_ORGANIZATION, execution_scope={'qualification':'ik-e2e'})
print('IK_E2E_JSON='+json.dumps({'decision_id':r.pk,'emission_id':e.pk,'idempotency_key':e.idempotency_key,'artifact_digest':r.artifact_digest}))
"@
$created = Invoke-DjangoJson $createCode
Write-Host "Decision $($created.decision_id), emission $($created.emission_id) queued." -ForegroundColor Cyan

$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$emission = $null
do {
    Start-Sleep -Seconds 2
    $pollCode = @"
import json
from konnaxion.ethikos.models import InteractionEmission
e=InteractionEmission.objects.get(pk=$($created.emission_id))
print('IK_E2E_JSON='+json.dumps({'status':e.status,'attempts':e.attempts,'error_code':e.last_error_code,'error_detail':e.last_error_detail,'receipt':e.receipt_json,'envelope':e.envelope_json}, default=str))
"@
    $emission = Invoke-DjangoJson $pollCode
    Write-Host "Konnaxion emission: $($emission.status) (attempts=$($emission.attempts))"
    if ($emission.status -eq 'dead') { throw "Konnaxion emission DEAD: $($emission.error_code) $($emission.error_detail)" }
} while ($emission.status -ne 'delivered' -and (Get-Date) -lt $deadline)
if ($emission.status -ne 'delivered') { throw 'Timed out waiting for Konnaxion emission delivery.' }

$signalId = [string]$emission.receipt.data.signal_id
if (-not $signalId) { throw 'Orgo receipt did not include signal_id.' }
Write-Host "Orgo accepted Signal $signalId." -ForegroundColor Green

$signal = $null
do {
    Start-Sleep -Seconds 2
    $response = Invoke-Orgo -Method Get -Path "signals/$signalId" -Token $machineToken
    if ($response.StatusCode -ne 200) { throw "Signal read failed HTTP $($response.StatusCode): $($response.Json | ConvertTo-Json -Depth 8 -Compress)" }
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
    if ($operation) { Write-Host "Orgo impact operation: $($operation.status)" }
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
if ($replay.StatusCode -ne 201) { throw "Replay failed HTTP $($replay.StatusCode): $($replay.Json | ConvertTo-Json -Depth 8 -Compress)" }

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
