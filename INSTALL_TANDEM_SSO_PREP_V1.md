# kOA — SSO commun Konnaxion + Orgo, préparation V1

Statut : raccordement Orgo/Orgo_Worlds préparé. **SSO partagé non activé**, fournisseur d'identité réel non confirmé. Aucun changement Konnaxion inclus et aucune migration SQL nécessaire.

## Installations — ZIP racine

1. `OVERLAY_Orgo_TANDEM_SSO_OIDC_PREP_V1_DROP_ROOT.zip` → `C:\mycode\Orgo\Orgo`
2. `OVERLAY_Orgo_Worlds_TANDEM_IDENTITIES_V1_DROP_ROOT.zip` → `C:\mycode\Orgo\Orgo_Worlds`

Faire une sauvegarde ou commit préalable des fichiers locaux modifiés (notamment `docker-compose.yml`, `.env.example`, les contrôleurs API et `apps/web/src/orgo/OrgoApp.tsx`). Ne pas écraser `.env` : **l'overlay ne contient pas `.env`**.

## Diagnostic sans modification

Double-cliquer :

`C:\mycode\Orgo\Orgo\DIAG_TANDEM_SSO.cmd`

Puis vérifier les fixtures depuis `C:\mycode\Orgo\Orgo_Worlds` avec `FAKEPLANT_TEST.cmd` (ou `node tools/fakeplant/validate.mjs`).

Le diagnostic vérifie le mode SSO déclaré, la concordance de l'issuer attendu et les empreintes des 900 personas si les sources sont accessibles. Il ne lit pas de mots de passe, n'interroge pas les bases et ne charge aucun seed.

## Comportement Orgo

`KOA_TANDEM_SSO_MODE=off` est le défaut et conserve le login existant.

Une fois **l'issuer réel de Konnaxion** connu, configurer les variables `OIDC_ISSUER`, `KOA_SHARED_OIDC_ISSUER`, `OIDC_CLIENT_ID` (client propre à Orgo), `ORGO_PUBLIC_URL` et `KOA_TANDEM_ORGANIZATION`. Le mode `ready` permet de refuser une configuration incohérente tout en conservant le login local. Ne jamais passer à `enforce` avant un vrai test OIDC des deux applications, la vérification du compte administratif de secours et une sauvegarde.

Une fois les variables éditées, reconstruire les images Orgo en Docker pour appliquer le nouveau code. **Cela n'est pas requis pour le diagnostic en lecture seule**. Se référer à `Orgo/docs/Technical-Reference/TANDEM_KONNAXION_ORGO_OIDC_V1.md`.

La création du tenant `fakeplant` dans la base Orgo reste une étape **séparée** : ce correctif ne le crée pas et ne lie aucun `issuer + subject` automatiquement.

## Tests réalisés hors ligne

- Validation de la fixture (SHA-256, 900 personnes fictives non connectables) : OK.
- Validation officielle des 18 scénarios Orgo : OK.
- 4 tests unitaires de la politique tandem : OK.
- Transpilation des 6 fichiers TS/TSX modifiés : OK.
- Vérification syntaxique Node et YAML Compose : OK.

Limites : compilation npm complète, test Docker réel, fournisseur OIDC, sessions SSO inter-applications et Capsule Manager **non validés** sur les environnements Windows / production.
