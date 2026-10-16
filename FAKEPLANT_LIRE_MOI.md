# Overlay : Orgo (application principale)

Dézipper à la **racine de Orgo**. Prérequis : dépôt frère `Orgo_Worlds` avec son overlay.

1. `FAKEPLANT_TEST.cmd` : vérifie la fixture des 900 employés sans DB.
2. Optionnel, base locale uniquement : `node apps/api/scripts/fakeplant-people.mjs --apply --confirm-fakeplant` (900 profils **disabled/external_only**, n'envoie pas d'invitation).
3. Pour valider les 18 scénarios **sans import** : depuis `../Orgo_Worlds`, `node tools/world-scenario/cli.mjs validate-all fakeplant --orgo-root ../Orgo`.
4. Injection explicite d'un scénario (API Orgo démarrée, jeton et organisation configurés) : depuis `../Orgo_Worlds`, `node tools/world-scenario/cli.mjs inject fakeplant FP-S02 --apply --orgo-root ../Orgo`.

Les cas/tâches sont fictifs. **Aucun achat externe ni export complet des modifications du Kristal n'est implémenté.**
