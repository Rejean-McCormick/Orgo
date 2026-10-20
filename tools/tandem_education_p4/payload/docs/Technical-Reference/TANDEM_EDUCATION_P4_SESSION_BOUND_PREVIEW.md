# Tandem Éducation P4 — précontrôle lié à une session Orgo

**Portée:** frontière interne en lecture seule, sans route HTTP, sans service déployé, sans migration, sans Case/Task créée. **Désactivé par défaut** (`enabled` absent ou `false`).

- `tools/tandem-education/p4-session-bound-preview.mjs` appelle **l'API existante** `IdentityService.authenticate(token,{organization})` d'Orgo, laquelle valide la session et recharge les rôles de l'utilisateur actif en base. Un jeton système/API est refusé; le droit explicite `education:admit` est exigé (pas un simple joker `*`).
- Le jeton doit provenir du point d'entrée authentifié côté serveur, **pas** des données Akor, ni d'en-têtes de rôle/identité arbitraires.
- Les trois lecteurs `readWorld`, `readTeacherApproval`, `readParticipantGrants` doivent provenir d'un module serveur de confiance. **Aucun lecteur de secours**, aucun JSON client utilisé comme preuve. La lecture Worlds ne doit pas utiliser le service HTTP standalone à identités transmises par en-têtes.
- Le registre de consentement/approbation lié à l'empreinte exacte de l'intention et les attributions d'élèves synthétiques ne sont **pas encore branchés**. `IdentityService.authenticate` est un point réel d'intégration, mais **aucun câblage Nest runtime ni transaction** n'a été ajouté. En l'absence de ces sources, **refus**.
- La sortie reste celle de P3 : `DRY_RUN_ONLY_NO_RUNTIME_ADMISSION`, et les indicateurs d'autorisation / publication restent faux, même lorsque des lecteurs en mémoire répondent favorablement.

## Qualification

`node --test tools/tandem-education/p4-session-bound-preview.test.mjs tools/tandem-education/admission-prerequisites.test.mjs tools/tandem-education/review-plan.test.mjs`

Le test simule une instance `IdentityService`; il **ne teste pas** une connexion authentifiée au PostgreSQL réel. Avant le câblage en production : définir un registre d'approbation enseignant vérifiable, le service interne de lecture World authentifié et les allocations individuelles, puis qualifier les lectures transactionnelles et le refus aux changements d'état concurrents. Aucune publication vers les enfants n'est autorisée à cette étape.
