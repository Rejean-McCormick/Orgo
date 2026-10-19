param(
    [ValidateSet('Preview','Apply')]
    [string]$Mode = 'Preview'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# FP-S01 is a synthetic Case + Task only; never run broader world packs here.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$orgoWorlds = Join-Path (Split-Path -Parent $root) 'Orgo_Worlds'
$scenario = Join-Path $orgoWorlds 'world-packs\fakeplant\scenarios\FP-S01.scenario.json'
$injector = Join-Path $root 'tools\scenario-injector\cli.mjs'
$secretPath = 'C:\mycode\Konnaxion\Tandem_Local\fakeplant-orgo-work-token.DPAPI.txt'
$reportDir = 'C:\mycode\Konnaxion\Tandem_Local'
$report = Join-Path $reportDir 'fakeplant-FP-S01.import-report.LOCAL.json'
$expectedOrg = '0c2d7244-a0c0-4a10-8f11-0389f275f133'
$expectedHash = 'a7f9c731c25d3fd7c04697525fec82024feefd6005910f78d8611ff3043fe9f6'

function Require([bool]$condition, [string]$message) {
    if (-not $condition) { throw "[REFUS] $message" }
}

function Read-DatabaseState {
    $dbscript = @'
const { PrismaClient } = require('@prisma/client');
const expected = '0c2d7244-a0c0-4a10-8f11-0389f275f133';
(async () => {
  const db = new PrismaClient();
  try {
    const value = await db.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      const org = await tx.organization.findUnique({where:{slug:'fakeplant'},select:{id:true,status:true}});
      if (!org || org.id !== expected || org.status !== 'active') throw Error('Tenant FakePlant absent, UUID incorrect ou inactif');
      const [users,disabled,profiles,cases,tasks] = await Promise.all([
        tx.userAccount.count({where:{organization_id:expected}}),
        tx.userAccount.count({where:{organization_id:expected,status:'disabled'}}),
        tx.personProfile.count({where:{organization_id:expected}}),
        tx.case.count({where:{organization_id:expected}}),
        tx.task.count({where:{organization_id:expected}})
      ]);
      return {ok:true,organization_id:expected,users,disabled,profiles,cases,tasks};
    });
    console.log(JSON.stringify(value));
  } catch(error) {
    console.error('[REFUS] Lecture base Orgo impossible: ' + String(error.message).slice(0,240));
    process.exitCode = 1;
  } finally { await db.$disconnect(); }
})();
'@
    $output = @($dbscript | & docker compose exec -T api node - 2>&1)
    if ($LASTEXITCODE -ne 0) { throw '[REFUS] Echec du diagnostic Docker en lecture seule. Aucun scenario injecte.' }
    try { return (($output -join "`n") | ConvertFrom-Json -ErrorAction Stop) }
    catch { throw '[REFUS] Format inattendu de reponse Docker. Aucun scenario injecte.' }
}

function Verify-Token {
    Require (Test-Path -LiteralPath $secretPath -PathType Leaf) 'Fichier du jeton DPAPI introuvable.'
    $secure = Get-Content -LiteralPath $secretPath -Raw | ConvertTo-SecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try { $raw = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }
    try {
        $headers = @{ Authorization = "Bearer $raw" }
        try {
            $me = Invoke-RestMethod -Method Get -Uri 'http://127.0.0.1:4000/api/v3/auth/me' -Headers $headers -TimeoutSec 15
        } catch { throw '[REFUS] API Orgo inaccessible ou jeton invalide/expire. Aucun scenario injecte.' }
        Require ($me.ok -eq $true) 'Reponse /auth/me invalide.'
        Require ($me.data.organizationId -ceq $expectedOrg) 'Identite API hors du tenant FakePlant.'
        $permissions = @($me.data.permissions | Sort-Object)
        Require (($permissions -join ',') -ceq 'work:read,work:write') 'Permissions API ne sont pas strictement work:read,work:write.'
        Write-Host '[OK] Jeton valide sans X-Organization-ID, tenant FakePlant uniquement.'
        Write-Host '[OK] Permissions strictes : work:read, work:write.'
        if ($Mode -eq 'Apply') {
            # Child Node receives the token through its temporary process environment only.
            $env:ORGO_SCENARIO_TOKEN = $raw
        }
    } finally {
        $raw = $null
        $secure.Dispose()
    }
}

Push-Location $root
try {
    Write-Host "=== ORGO / FAKEPLANT FP-S01 : $Mode ==="
    Write-Host "Tenant : fakeplant / $expectedOrg"
    Require (Test-Path -LiteralPath $scenario -PathType Leaf) 'Scenario FP-S01 introuvable dans Orgo_Worlds.'
    Require (Test-Path -LiteralPath $injector -PathType Leaf) 'Injecteur Orgo introuvable.'
    Require ((Get-FileHash -LiteralPath $scenario -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $expectedHash) 'Scenario FP-S01 different de la version auditee : revalidation requise.'
    $doc = Get-Content -LiteralPath $scenario -Raw -Encoding utf8 | ConvertFrom-Json
    Require ($doc.schema_version -ceq 'orgo.scenario.v1' -and $doc.scenario.id -ceq 'fakeplant-fp-s01-seed-v1' -and $doc.scenario.synthetic -eq $true) 'Contrat scenario inattendu.'
    Require (@($doc.operations).Count -eq 2) 'FP-S01 doit avoir exactement deux operations.'
    Require ($doc.operations[0].op -ceq 'create_case' -and $doc.operations[1].op -ceq 'create_task') 'Operations FP-S01 inattendues.'
    foreach ($operation in $doc.operations) {
        Require ($operation.input.metadata.fixture_only -eq $true -and $operation.input.metadata.authority -ceq 'manual_approval_required') 'Scenario non limite a la simulation.'
    }
    Write-Host '[OK] Version FP-S01 verrouillee : create_case + create_task (synthetiques uniquement).'

    & node $injector validate $scenario | Out-Null
    Require ($LASTEXITCODE -eq 0) 'Validation scenario Orgo refusee.'
    & node $injector plan $scenario
    Require ($LASTEXITCODE -eq 0) 'Plan scenario Orgo refuse.'
    Write-Host '[OK] Scenario valide. Aucun workflow ni operation externe.'

    $services = @(& docker compose ps --services --status running 2>&1)
    Require ($LASTEXITCODE -eq 0 -and $services -contains 'api' -and $services -contains 'postgres') 'Orgo Docker api/postgres indisponibles.'
    $state = Read-DatabaseState
    Require ($state.ok -eq $true -and $state.organization_id -ceq $expectedOrg) 'Cible PostgreSQL inattendue.'
    Require ($state.users -eq 900 -and $state.disabled -eq 900 -and $state.profiles -eq 900) 'Identites FakePlant inattendues.'
    Write-Host "[OK] Base Docker : $($state.users) personas disabled, $($state.profiles) profils."
    Write-Host "[OK] Etat avant test : $($state.cases) dossier(s), $($state.tasks) tache(s)."
    Verify-Token

    if ($Mode -eq 'Preview') {
        Write-Host '[FIN] PREVIEW uniquement : aucune ecriture en base et aucun jeton affiche.'
        return
    }
    Require ($state.cases -eq 0 -and $state.tasks -eq 0) 'FP-S01 applique uniquement sur un tenant vide en dossiers/taches.'
    Require (-not (Test-Path -LiteralPath $report)) 'Rapport FP-S01 existe deja : refus de refaire le test sans diagnostic.'
    New-Item -ItemType Directory -Path $reportDir -Force | Out-Null
    Write-Host '=== TEST API : ECRITURE DE 1 DOSSIER + 1 TACHE ==='
    Write-Host 'Aucun utilisateur ni workflow cree. Aucun achat ni connexion externe.'
    $env:ORGO_SCENARIO_API_URL = 'http://127.0.0.1:4000/api/v3'
    & node $injector inject $scenario --apply --report $report
    if ($LASTEXITCODE -ne 0) {
        throw '[ECHEC] Injection API partielle ou refusee. NE PAS RELANCER; controler le tenant et le rapport.'
    }
    Require (Test-Path -LiteralPath $report -PathType Leaf) 'Rapport absent apres appel API : diagnostic requis.'
    $result = Get-Content -LiteralPath $report -Raw | ConvertFrom-Json
    Require ($result.scenario_id -ceq 'fakeplant-fp-s01-seed-v1' -and @($result.results).Count -eq 2) 'Rapport scenario inattendu.'
    $post = Read-DatabaseState
    Require ($post.cases -eq 1 -and $post.tasks -eq 1) 'Compteurs post-test inattendus : examen requis; ne pas relancer automatiquement.'
    Require ($post.users -eq 900 -and $post.disabled -eq 900 -and $post.profiles -eq 900) 'Identites modifiees de facon inattendue : examen requis.'
    Write-Host "[OK] POST-CONTROLE : $($post.cases) dossier + $($post.tasks) tache ; 900 personas conserves desactives."
    Write-Host "[OK] Rapport local : $report"
    Write-Host '[FIN] Test FP-S01 termine. Cela ne valide PAS encore Interaction Kernel, ACL humains ou SSO.'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
} finally {
    Remove-Item Env:\ORGO_SCENARIO_TOKEN -ErrorAction SilentlyContinue
    Remove-Item Env:\ORGO_SCENARIO_API_URL -ErrorAction SilentlyContinue
    Pop-Location
}
