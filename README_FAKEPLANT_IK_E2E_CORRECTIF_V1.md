# FakePlant — correctif avant E2E IK (V1)

**Cible :** `C:\mycode\Orgo\Orgo` — ZIP à extraire à sa racine.

Après le préflight du 18 octobre 2026, l'inspection du code réel a révélé **deux blocages indépendants**, non détectés par les contrôles de disponibilité :

1. Le jeton `koa.fakeplant.ik-outbound-v1` a `signals:write` et `workflows:execute`. Orgo `IntakeService.queue/get`, `WorkService` et `OperationsService` exigent aussi `signals:read`, `work:read`, `work:write`, `integrations:write` pour exécuter le workflow publié. Les permissions ne sont pas implicites.
2. La requête `REQUEST_INTEGRATION → konnaxion:publish_impact` du workflow V1 manque `data.external_reference` et `data.summary`, exigés par `validate_impact_publish_envelope` de Django.

## Étapes (PowerShell 7)

```powershell
cd C:\mycode\Orgo\Orgo
.\PREVIEW_FAKEPLANT_IK_E2E_FIX.cmd
```

**Aperçu :** Prisma dans Orgo Docker vérifie, en transaction en lecture seule : tenant UUID fixe, 900 comptes désactivés, version actuelle du workflow, empreinte du vrai jeton Django, scopes exacts, expiration et absence de jeton de publication provisoire. Copie uniquement de petits scripts temporaires dans le conteneur; aucun secret affiché et aucune écriture PostgreSQL.

**Après validation du rapport et sauvegarde Orgo récente :**

```powershell
cd C:\mycode\Orgo\Orgo
.\FIX_FAKEPLANT_IK_E2E.cmd
```

Ce lancement est l'autorisation des modifications **sans phrase de confirmation** :

- Publie par API Orgo la **version 2** du workflow `konnaxion_decision_v1`, en conservant ses trois actions. Ajoute `external_reference: "$signal.id"` (UUID unique par Signal) et `summary: {"kind":"operational_effect", "status":"recorded"}` à la requête d'impact.
- Utilise et révoque immédiatement un jeton de publication temporaire limité à `workflows:write` (15 min).
- Étend les droits du **même jeton IK existant**, limité au **même tenant**, exactement à `signals:write`, `workflows:execute`, `signals:read`, `work:read`, `work:write`, `integrations:write` ; **sans privilège `*`, sans nouveau secret, sans prolonger l'expiration**. Journal d'audit pour le changement.
- Accepte les états `V1 + scopes initiaux`, `V2 + scopes initiaux` (reprise après publication) ou `V2 + scopes E2E` (relance sans changement), mais refuse un workflow différent, plusieurs jetons, des scopes inattendus, un jeton expirant dans moins de 5 minutes ou un autre tenant.

Il ne crée **aucune décision, aucun Signal, Case, Task ou impact**. Pas de migration ni de modification des 900 comptes, des fichiers Django, du Worker ou du SSO. Le prochain test E2E sera séparé.

**Limites :** la validation réelle de PostgreSQL/Docker et la publication API doivent être effectuées sur ta machine; les simulations locales ne prouvent pas l'exécution E2E. Le jeton garde son expiration initiale (24 h après sa création). Une fois expiré, il faudra le renouveler avec le même contrôle de tenant; le correctif refuse de contourner cette limite.
