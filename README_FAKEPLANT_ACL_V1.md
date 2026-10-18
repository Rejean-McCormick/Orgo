# Orgo FakePlant — Diagnostic ACL (lecture seule)

**Installer :** extraire l'archive dans `C:\mycode\Orgo\Orgo`.

**Démarrer :** double-cliquer `DIAG_FAKEPLANT_ACL.cmd` ou utiliser PowerShell 7 :

```powershell
cd C:\mycode\Orgo\Orgo
.\DIAG_FAKEPLANT_ACL.cmd
```

**Dépendances :** Docker Desktop démarré et service `api` Orgo en état running. La commande lit la base de données du conteneur API; elle n'emploie pas le `DATABASE_URL` de Windows.

Le diagnostic impose une transaction PostgreSQL **READ ONLY** et vérifie l'UUID de l'organisation `fakeplant` avant d'interroger ses comptes et permissions. Il affiche des agrégats uniquement; aucun secret, courriel, mot de passe ni jeton.

**Aucun texte de confirmation à saisir.** Il ne crée aucun rôle, jeton, identité, dossier, tâche, workflow ou liaison active, et n'active pas le SSO/IK.

Les résultats représentent l'état constaté dans la base Orgo. Ils ne prouvent **pas** à eux seuls que les ACL de l'API, l'injecteur Orgo, l'Interaction Kernel ou le SSO sont fonctionnels. Un test API authentifié et isolé sera ensuite nécessaire.
