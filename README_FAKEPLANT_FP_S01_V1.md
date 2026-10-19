# Premier test Orgo FakePlant — FP-S01

Installer ce ZIP à la racine de `C:\mycode\Orgo\Orgo`.

## 1. Aperçu (aucune écriture PostgreSQL)

```powershell
cd C:\mycode\Orgo\Orgo
.\PREVIEW_FAKEPLANT_FP_S01.cmd
```

Le contrôle refuse de poursuivre si : le JSON FP-S01 a changé depuis le snapshot audité, le scénario comporte plus de deux opérations, le tenant UUID diverge, les 900 personas ne sont pas désactivés, l'API/jeton est refusé ou les permissions dépassent `work:read,work:write`.

**L'aperçu authentifie réellement le jeton en GET**, sans l'afficher ni l'enregistrer en clair. Il ne crée rien.

## 2. Premier test persistant — seulement après aperçu réussi

Vérifier qu'une sauvegarde récente de la base Orgo existe. Exécuter volontairement le lanceur distinct, **sans confirmation à retaper** :

```powershell
cd C:\mycode\Orgo\Orgo
.\TEST_FAKEPLANT_FP_S01.cmd
```

Ce second lanceur refait les garde-fous, puis utilise le jeton DPAPI existant pour créer un dossier + une tâche synthétiques via l'API Orgo `/api/v3`, uniquement dans le contexte Bearer FakePlant. Le jeton n'est jamais affiché ni écrit dans le rapport; il est transmis temporairement à Node par variable d'environnement de processus.

Il **refuse si le tenant possède déjà des dossiers ou des tâches**. Si la seconde opération échoue après la première, la première peut subsister; aucune annulation magique n'est prétendue. Dans ce cas, **ne pas relancer automatiquement** : diagnostiquer les données. L'injecteur utilise des clés d'idempotence.

Rapport local : `C:\mycode\Konnaxion\Tandem_Local\fakeplant-FP-S01.import-report.LOCAL.json`.

Ce test ne valide ni les connexions SSO humaines, ni l'Interaction Kernel entre applications, ni le déploiement tandem. Le jeton existant expire après 24 h (heure indiquée lors de sa création).
