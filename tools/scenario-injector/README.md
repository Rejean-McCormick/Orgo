# Orgo Scenario Injector

Outil local contrôlé pour transformer un scénario produit par une IA en écritures Orgo traçables via l'API v3.

## Flux

```text
brief humain
  ↓
scenario.ps1 template
  ↓
prompt IA
  ↓
JSON orgo.scenario.v1
  ↓
validate
  ↓
plan / dry-run
  ↓
inject --apply
  ↓
API Orgo + idempotency + correlation
  ↓
rapport JSON d'import
```

L'outil ne fait **aucun SQL direct** et n'accepte pas d'endpoint arbitraire.

## 1. Générer le template IA

```powershell
cd C:\mycode\Orgo\Orgo
.\tools\scenario-injector\scenario.ps1 template --out .\scenario-prompt.md
```

Avec un brief Markdown :

```powershell
.\tools\scenario-injector\scenario.ps1 template `
  --brief C:\chemin\scenario.md `
  --out .\scenario-prompt.md
```

Donner `scenario-prompt.md` à l'IA. Sa réponse doit être enregistrée en JSON, par exemple `scenario-a014.json`.

## 2. Valider

```powershell
.\tools\scenario-injector\scenario.ps1 validate .\scenario-a014.json
```

## 3. Voir le plan sans toucher Orgo

```powershell
.\tools\scenario-injector\scenario.ps1 plan .\scenario-a014.json
.\tools\scenario-injector\scenario.ps1 inject .\scenario-a014.json
```

Sans `--apply`, `inject` reste un dry-run.

## 4. Injection réelle

L'API Orgo doit être active. Le worker doit aussi être actif si le scénario utilise `workflow_ref` sur un Signal et `wait_signal`.

```powershell
$env:ORGO_SCENARIO_API_URL      = 'http://127.0.0.1:4000/api/v3'
$env:ORGO_SCENARIO_ORGANIZATION = 'orgo-e2e'
$env:ORGO_SCENARIO_EMAIL         = 'e2e@example.test'
$env:ORGO_SCENARIO_PASSWORD      = '<mot-de-passe>'

.\tools\scenario-injector\scenario.ps1 inject `
  .\tools\scenario-injector\examples\uckk-a014.scenario.json `
  --apply
```

Un token peut remplacer l'authentification email/password :

```powershell
$env:ORGO_SCENARIO_TOKEN = '<bearer-token>'
```

## Sécurité et déterminisme

- le format v1 exige `synthetic: true`;
- aucun UUID runtime n'est fourni par l'IA;
- chaque mutation reçoit une `Idempotency-Key` déterministe;
- toutes les opérations utilisent le même `correlation_id` de scénario sauf override explicite;
- les metadata/payload injectés sont marqués `synthetic` et `epistemic_status`;
- le même fichier peut être rejoué sans dupliquer les commandes si son contenu et l'identité d'exécution restent identiques;
- un `external_reference` stable est obligatoire pour chaque Signal;
- aucune route arbitraire ni SQL direct n'est autorisé.

## Opérations v1

`publish_workflow`, `simulate_workflow`, `execute_workflow`, `create_case`, `create_task`, `create_signal`, `queue_signal`, `wait_signal`, `comment_task`, `transition_task`, `transition_case`.

## Important — worker Orgo

`create_signal` avec `workflow_ref` persiste le Signal et met le traitement en file. `wait_signal` attend que le worker le marque `PROCESSED`. Si le worker n'est pas actif, le rapport indiquera `pending_worker` au lieu d'inventer un succès.

## RC utilisée comme contrat

Le template reflète le contrat du snapshot RC inspecté : `source` des Signals en minuscules, `match.source` des workflows en majuscules, labels Orgo obligatoires et `SET_METADATA` non utilisé sur un Case.
