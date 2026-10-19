# Orgo — Tournée P1 (2/8) — Installation V1

Cible **exacte** : `C:\mycode\Orgo\Orgo` (ne pas confondre avec son dossier parent).

1. Extraire ce ZIP à la racine du dépôt Orgo.
2. Lancer `PREVIEW_ORGO_TOUR_P1.cmd`, puis `INSTALL_ORGO_TOUR_P1.cmd`, puis `VERIFY_ORGO_TOUR_P1.cmd`.
3. Sauvegarde créée sous `C:\mycode\Orgo\Tandem_Local\orgo_tour_p1\backups`.
4. `ROLLBACK_ORGO_TOUR_P1.cmd` restaure uniquement ce que ce pack a modifié, s'il détecte les bonnes empreintes.

Le correctif ne contacte aucun serveur, n'ouvre aucune DB, ne change ni `.env` réel, ni Docker, ni les données FakePlant, ni les permissions ou les workflows Orgo. `.env.example` est documentaire.

**Effet fonctionnel :** le endpoint `POST /auth/local-auto-login` retourne 404 sous `NODE_ENV=production`, y compris dans Docker Compose, même avec `ORGO_LOCAL_AUTO_LOGIN=true`. L'authentification normale et OIDC fonctionnent selon les configurations existantes. Ceci n'est PAS une activation SSO.

Les tests autonomes du pack exécutent 12 tests Node (dont politique de connexion sur helper TypeScript réel, contrats de SSO/RBAC/IK/outbox). La suite complète TypeScript/Prisma avec PostgreSQL doit être relancée ultérieurement; sa réussite n'est pas affirmée.

Le code durci doit être reconstruit et déployé explicitement pour modifier un runtime en cours. La démo E2E déjà validée ne doit pas être rejouée par cet installateur.

Voir `docs/Technical-Reference/TANDEM_TOUR_ORGO_2026-10-18.md` après installation pour la matrice des contrôles et les écarts restants.
