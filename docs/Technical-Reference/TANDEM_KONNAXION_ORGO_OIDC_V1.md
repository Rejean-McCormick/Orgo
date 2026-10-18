# Tandem Konnaxion + Orgo — identité partagée (v1)

**Statut** : raccordement de configuration et garde-fous livrés; SSO inter-applications **non activé** sans fournisseur commun et tests E2E.

## Autorités
- Un fournisseur OIDC unique émet `iss` + `sub` pour la même **personne humaine**, avec un client OIDC par application (ne jamais réutiliser le secret du client Konnaxion dans Orgo).
- Konnaxion reste propriétaire des Universes / Worlds; Orgo reste propriétaire de son `Organization.id`, RBAC, tâches, opérations et base.
- `fakeplant` dans Konnaxion et le slug `fakeplant` dans Orgo ne sont que des clés; vérifier l'UUID réel de `Organization`.
- Une identité OIDC Orgo est liée **explicitement** par `POST /api/v3/identity/sso` (droit `identity:manage`). Aucun rapprochement automatique par courriel.
- Les 900 employés fictifs sont des personas `disabled`, `external_only`, sans mot de passe. Ils ne deviennent jamais des identités SSO humaines. L'import n'active pas leurs accès.
- Interaction Kernel est une liaison machine-à-machine; ne pas utiliser un jeton de session navigateur comme jeton IK.

## Modes à déployer progressivement

`KOA_TANDEM_SSO_MODE=off` (par défaut) : comportement existant, connexion locale autorisée.

`KOA_TANDEM_SSO_MODE=ready` : refuse de démarrer si le fournisseur et le client OIDC ne sont pas configurés et cohérents avec la valeur attendue pour Konnaxion; **ne désactive pas** le login local.

`KOA_TANDEM_SSO_MODE=enforce` : pour `KOA_TANDEM_ORGANIZATION` seulement, impose l'OIDC pour les connexions humaines, sauf `KOA_SSO_BREAKGLASS_EMAIL`, compte local de secours **préexistant, actif et vérifié**. Désactive aussi l'auto-login local du tenant. Aucune migration ou création de compte implicite.

Ajouter dans `.env` Orgo (ne jamais publier les secrets) :

```dotenv
KOA_TANDEM_SSO_MODE=off
KOA_TANDEM_UNIVERSE=fakeplant
KOA_TANDEM_ORGANIZATION=fakeplant
KOA_SHARED_OIDC_ISSUER=https://identity.example.org/realm
OIDC_ISSUER=https://identity.example.org/realm
OIDC_CLIENT_ID=orgo-client
OIDC_CLIENT_SECRET=<configured privately>
ORGO_PUBLIC_URL=https://fakeplant.orgo.konnaxion.com
KOA_SSO_BREAKGLASS_EMAIL=<existing-active-admin@example.org>
```

Les valeurs `.example.org` **ne sont que des exemples**, jamais utilisables telles quelles. Valider l'issuer réel de Konnaxion, les URLs de redirection `/sso`, le DNS et TLS. Avec Docker `NODE_ENV=production`, l'IdP et l'origine publique exigent **HTTPS**, même en développement de conteneur.

## Procédure

1. Exécuter `DIAG_TANDEM_SSO.cmd` (lecture seule), puis vérifier sur Konnaxion l'issuer réel et le tenant Orgo actif.
2. Configurer un fournisseur OIDC accessible depuis **les deux** applications, avec deux clients. Vérifier les callbacks et PKCE.
3. Passer Orgo en mode `ready`, reconstruire/redémarrer son API et confirmer la page SSO. Laisser le mode `enforce` inactif.
4. Dans Orgo, créer la liaison `issuer + subject` d'un **vrai compte actif** via `identity/sso`. Tester le même humain sur les deux produits, puis ses permissions distinctes.
5. Contrôler une session expirée, l'indisponibilité IdP, la déconnexion et le compte de secours avant de choisir `enforce`.
6. Conserver un plan de restauration `.env` et une sauvegarde des bases. Un test de lancement réel sous Windows/Docker reste requis.

## Personnes synthétiques

Le script `apps/api/scripts/fakeplant-people.mjs` vérifie les empreintes de la fixture canonique avant de créer (sur confirmation explicite) les 900 profils non connectables. Il accepte `FAKEPLANT_FIXTURE_ROOT` pour une fixture montée dans Docker ou pointe d'abord vers `Konnaxion_Worlds/universes/fakeplant/fixture` si ce dossier existe. Il n'exécute ni OIDC link, ni import automatique au démarrage.

## Frontière du périmètre

Ce correctif prépare Orgo et Orgo_Worlds, mais ne configure pas l'IdP de Konnaxion, ne fournit pas de domaine en service et ne réalise pas le déploiement jumelé Capsule Manager. **Aucun GO LIVE implicite.**

Le diagnostic confronte les empreintes des fixtures `Konnaxion_Worlds` et `Orgo_Worlds` si les deux dépôts sont présents; l'import refuse une divergence.

## Ports de développement

Konnaxion et Orgo démarrés ensemble ne peuvent pas utiliser tous les deux `localhost:3000`. Orgo accepte `ORGO_WEB_HOST_PORT=3001` dans son `.env` local (sans modifier le défaut des installations Orgo seules); l’API demeure normalement sur `4000`. Ne pas utiliser `localhost:3001` comme URI OIDC de production avec Docker `NODE_ENV=production` : configurer une origine HTTPS et une redirection `/sso` valide pour tester réellement le fournisseur.
