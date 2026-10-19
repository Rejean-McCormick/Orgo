# Tandem 1.0 — Tournée Orgo 2/8 (2026-10-18)

**Portée** : durcissement ciblé sur le snapshot Orgo fourni; aucune migration, clé, base, donnée FakePlant ou opération réseau.

## Autorités maintenues

- `Organization.id` est la frontière d’isolation Orgo. Les permissions globales et les WorkGrants demeurent locales à Orgo.
- OIDC fournit `issuer + subject`, sans autocréation ni liaison par courriel. Les 900 personas `disabled / external_only` sont synthétiques, non interactifs.
- Les workflows, Signals, Cases, Tasks et reçus d’intégration demeurent sous leurs propriétaires Orgo.
- Interaction Kernel maintient `ik/1.1`, les profils connus et la sémantique de l'outbox; aucun workflow FakePlant n'est rejoué par ce correctif.

## Modifications prouvées par code

1. `auth/local-auto-login` échoue systématiquement en `NODE_ENV=production`, même si `ORGO_LOCAL_AUTO_LOGIN=true` et l’origine publique indique localhost. Hors production, il faut une origine HTTP loopback explicite et un *peer TCP* loopback. Les en-têtes Host/X-Forwarded-For ne font pas foi. En Docker Compose (NODE_ENV=production), utiliser la connexion locale avec mot de passe ou le SSO configuré.
2. La finalisation OIDC revalide l’utilisateur lié avant création d'une session; un ancien lien vers `external_only`, un compte inactif ou un tenant suspendu est refusé.
3. Aucun changement d’ACL, de rôle, de travail, d’IK ou de politique `KOA_TANDEM_SSO_MODE`; `off` reste le défaut et `enforce` n'est pas activé.

## Contrôles restant à réaliser sur l'environnement réel

- Login OIDC partagé avec Konnaxion, sessions séparées, mauvais `issuer+subject`, révocation, secours et tenant opposé.
- RBAC (global + WorkGrants), isolation multi-World/tenant et tests sur PostgreSQL réel.
- Workflow v2 FakePlant, outbox, acceptation reçue, réception de résultat final et réconciliation des opérations à état incertain (éviter de réémettre aveuglément).
- `ORGO_ALLOW_INSECURE_LOCAL_PROVIDER_HTTP` peut permettre HTTP sur `host.docker.internal` même avec `NODE_ENV=production`. Pour la démo locale, vérifier la portée réseau; **interdire l’utilisation de cette exception sur un VPS public** et imposer HTTPS/mTLS ou une liaison interne maîtrisée avant GO LIVE.
- Rejouer les campagnes indépendantes LevelUpDiag-Orgo; intégrer leurs preuves dans le ReleaseSet.

## Preuves

Les tests autonomes et de contrat du pack vérifient les deux contrôles ci-dessus. Sans dépendances npm ni PostgreSQL de test, la suite TypeScript/Prisma complète n'est pas déclarée exécutée. Aucun GO LIVE implicite.
