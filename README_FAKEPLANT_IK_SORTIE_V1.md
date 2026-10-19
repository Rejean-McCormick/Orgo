# Tandem FakePlant — IK sortant + workflow (V1)

Dépôt cible : `C:\mycode\Orgo\Orgo` (extraire le ZIP à la racine).
Topologie : Konnaxion local Windows/uv/Neon ; Orgo API + Worker sous Docker.
Tenant fixe : `fakeplant`, UUID `0c2d7244-a0c0-4a10-8f11-0389f275f133`.

## Commandes PowerShell 7

```powershell
cd C:\mycode\Orgo\Orgo
.\PREVIEW_FAKEPLANT_IK_SORTIE.cmd
# Seulement si l'aperçu réussit, et après une sauvegarde Orgo récente :
.\INSTALL_FAKEPLANT_IK_SORTIE.cmd
```

Les deux lanceurs n'exigent **aucune confirmation à retaper**. Exécuter `INSTALL` constitue le choix explicite d'autoriser des modifications.

### Aperçu

Vérifie en lecture seule PostgreSQL : UUID, 900 personas désactivés, 900 profils, nom et état du workflow, absence des deux jetons réservés, et configuration locale du fichier `Konnaxion\backend\.env`. Il copie uniquement deux scripts temporaires dans le conteneur API puis les nettoie. Aucune requête d'événement IK n'est envoyée.

### Installation — modifications effectuées

1. Si aucun workflow n'existe pour le code **déjà configuré dans l'API Orgo**, crée un jeton de publication temporaire (`workflows:write`, 15 minutes), publie le contrat JSON inclus par **l'API HTTP Orgo**, puis révoque ce jeton.
2. Si le workflow identique est déjà présent, ne crée pas de nouvelle version.
3. Émet un jeton IK **distinct du jeton FP-S01**, borné au tenant et aux scopes `signals:write` et `workflows:execute`, valable 24 heures.
4. Vérifie l'identité du nouveau jeton auprès de `/api/v3/auth/me`, puis écrit `IK_ORGO_TOKEN` dans `C:\mycode\Konnaxion\Konnaxion\backend\.env` sans écraser d'autre valeur.

La valeur secrète n'est jamais imprimée. Orgo reçoit son empreinte SHA-256 et conserve la vérification du jeton. **Django exige cependant le jeton en clair dans son fichier `.env` local** : protéger ce fichier et ne jamais l'ajouter à Git. Le script ne publie pas de secret dans les rapports.

Le workflow est dérivé du contrat déjà inclus dans `Orgo\validation\konnaxion-orgo-ik\workflow.json`. Il définit trois actions **qui ne s'exécutent pas pendant la publication** : `CREATE_CASE`, `CREATE_TASK` et `REQUEST_INTEGRATION` vers Konnaxion pour la publication d'impact. Le futur **test d'une décision publiée** pourra donc créer des objets et envoyer un événement : ce test E2E doit rester distinct de cette préparation.

### Arrêt et sécurité

Le script refuse un UUID différent, un tenant incomplet, un workflow conflictuel, un jeton homonyme existant, une configuration Konnaxion sortante déjà occupée, ou une modification du JSON contractuel. En cas d'erreur avant le placement dans Django, il tente de supprimer les jetons nouvellement émis. Les fichiers `.env` Orgo, les variables Worker, le jeton IK de retour, les 900 personas, les clones et les autres tenants sont intacts.

**L'installation n'est pas un déploiement et ne qualifie pas l'IK E2E.** Elle ne modifie pas le SSO, les ACL humaines, ni la mise en production. Pas de migrations, pas de `docker compose up`, pas de seeding.

### Après l'installation

Dans la fenêtre Uvicorn Konnaxion : `Ctrl+C` puis :

```powershell
cd C:\mycode\Konnaxion\Konnaxion\backend
uv run --no-sync python -m uvicorn config.asgi:application --host 0.0.0.0 --port 8000
```

Puis dans une autre fenêtre :

```powershell
cd C:\mycode\Konnaxion\Konnaxion_Capsule_Manager
.\START_TANDEM_IK_FAKEPLANT_DIAG.cmd
```

Attendu : sortie IK configurée, workflow publié et jeton IK à scopes requis. Le prochain test sera un E2E limité FakePlant sur une décision de démonstration, à préparer séparément. Le jeton expire 24 h après la création.
