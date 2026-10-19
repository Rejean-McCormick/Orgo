# Orgo FakePlant — accès API de test limité (24 heures)

**Destination** : extraire ce ZIP à la racine `C:\mycode\Orgo\Orgo`.

## Précautions

- Cet accès est **uniquement pour les tests locaux FP-S01**; il n'active ni SSO, ni droits humains, ni Interaction Kernel et ne publie aucun scénario.
- Aucun jeton n'est créé en extrayant le ZIP ou en lançant le mode aperçu.
- Le bootstrap direct Prisma est volontairement limité à une organisation et un UUID fixes, après vérification **900/900 comptes disabled**, **900 profils**, **0 jeton déjà présent**. Il ne sert PAS à créer des accès généraux.
- La création écrit **une ligne `ApiToken` et une ligne `ActivityLog`**, dans Orgo PostgreSQL via le conteneur API Docker actif. Elle ne crée aucun rôle, compte ou workflow.
- Jeton de **24 h**, scopes **`work:read`, `work:write`**; jamais `*`, `identity:manage` ou droits inter-tenant. L'API Orgo restreint les requêtes au tenant UUID porté par le jeton.
- Le secret du jeton est généré sous **Windows**, enregistré chiffré pour l'utilisateur Windows courant avec **DPAPI** à `C:\mycode\Konnaxion\Tandem_Local\fakeplant-orgo-work-token.DPAPI.txt`. Il n'est ni imprimé ni copié en clair dans Docker : seule son empreinte SHA-256 est transmise. **Ne partagez pas le fichier et ne le commitez pas**.
- Le lanceur lance aussi un **GET** API `http://127.0.0.1:4000/api/v3/auth/me` pour prouver le contexte et les deux seules permissions. Aucun POST de scénario à cette étape.
- Le bootstrap d'une identité de service via la base est provisoire pour un test local; en exploitation, utiliser le circuit audité de délivrance et révocation des jetons par un administrateur autorisé.

## Exécution (aucune phrase à retaper)

Depuis PowerShell 7 :

```powershell
cd C:\mycode\Orgo\Orgo
.\PREVIEW_FAKEPLANT_SCOPED_ACCESS.cmd
```

Après réussite et si vous souhaitez autoriser la création du jeton provisoire :

```powershell
cd C:\mycode\Orgo\Orgo
.\CREATE_FAKEPLANT_SCOPED_ACCESS.cmd
```

À tout moment avant expiration :

```powershell
cd C:\mycode\Orgo\Orgo
.\CHECK_FAKEPLANT_SCOPED_ACCESS.cmd
```

**Aucune demande de confirmation à retaper**; le choix du lanceur constitue l'action. En cas d'erreur de garde-fou, aucun jeton n'est émis.

## Ce que cet ensemble ne prouve pas

L'accès API après bootstrap sera adapté au futur test isolé du scénario `FP-S01`. Il ne prouve ni les droits des utilisateurs humains, ni le SSO OIDC partagé, ni le fonctionnement des adaptateurs Interaction Kernel, ni le déploiement tandem. Le test de création de dossier/tâche demeure une étape ultérieure et distincte.
