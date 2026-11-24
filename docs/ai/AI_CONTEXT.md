<!-- kOA Doc Server · Docs IA · lot 02 · rédaction dérivée d’une capture, à valider par le propriétaire -->
# Navigation IA — Orgo

**Rôle observé :** Workflows opérationnels multi-tenant, Signals, Cases, Tasks et résultats corrélés.

**Autorité :** Orgo seul détient la logique métier, les règles tenant, la boîte d'envoi et l'exécution des tâches.

**Provenance :** `SmartDump_20261120_221507.zip` → `Orgo_Code_snapshot.zip` (20 novembre 2026). Cette capture ne prouve ni la présence actuelle du dossier Windows, ni un déploiement, ni une qualification.

## Objet et état de cette fiche

La description ci-dessous est rattachée au `README.md` du snapshot; vérifier le code actif sur le poste. Cette fiche est un **guide de navigation**, non une spécification normative ni une validation de maturité.

## Processus conseillé

1. **Identifier la source et le profil.** Lire contrats et architecture-to-code, tester l'idempotence, l'autorisation et les retours terminaux.
2. **Contrôler l’autorité.** Orgo seul détient la logique métier, les règles tenant, la boîte d'envoi et l'exécution des tâches.
3. **Préparer un environnement de test.** Utiliser les fichiers réels de la révision étudiée et des données fictives ou autorisées.
4. **Vérifier sans promouvoir.** Documenter commandes, périmètre, résultat, chemins et empreintes; ne jamais transformer une observation locale en preuve historique validée.
5. **Revue propriétaire.** Une publication, activation, import ou effet externe nécessite l’accord du propriétaire et les gates correspondants.

## Garde-fous particuliers

- Ne pas exécuter de tâche réelle depuis une simulation ou une vue hébergée.
- N’inclure aucun secret, donnée personnelle, sauvegarde privée ou sortie de diagnostic non autorisée dans les exports Doc Server.
- Préserver l’intégrité des sources et des états historiques; éviter toute réécriture automatique des références.

## Sources d’orientation vérifiables dans le snapshot

1. [`README.md`](../../README.md) — source propriétaire présente dans le snapshot.
2. [`docs/Integration-Verification-2026-10-27.md`](../../docs/Integration-Verification-2026-10-27.md) — source propriétaire présente dans le snapshot.
3. [`docs/README.md`](../../docs/README.md) — source propriétaire présente dans le snapshot.
4. [`docs/Technical-Reference/ARCHITECTURE_TO_CODE.md`](../../docs/Technical-Reference/ARCHITECTURE_TO_CODE.md) — source propriétaire présente dans le snapshot.
5. [`docs/Technical-Reference/Architecture upgrade(to do)/OPS-001_AI_Resilience_Strategy.md`](<../../docs/Technical-Reference/Architecture upgrade(to do)/OPS-001_AI_Resilience_Strategy.md>) — source propriétaire présente dans le snapshot.
6. [`docs/Technical-Reference/Architecture upgrade(to do)/REF-001_Configuration_Manifest.md`](<../../docs/Technical-Reference/Architecture upgrade(to do)/REF-001_Configuration_Manifest.md>) — source propriétaire présente dans le snapshot.
7. [`docs/Technical-Reference/Architecture upgrade(to do)/RFC-001_Nervous_System_Upgrade.md`](<../../docs/Technical-Reference/Architecture upgrade(to do)/RFC-001_Nervous_System_Upgrade.md>) — source propriétaire présente dans le snapshot.
8. [`docs/Technical-Reference/Architecture upgrade(to do)/SPEC-001_Input_SenTient_ACL.md`](<../../docs/Technical-Reference/Architecture upgrade(to do)/SPEC-001_Input_SenTient_ACL.md>) — source propriétaire présente dans le snapshot.

## Compatibilité Framework

S’il y a une dépendance Kristal, lire la révision du Framework et le profil **effectivement adoptés** par ce dépôt. Les nouvelles conventions v11 (identités sémantiques, dictionnaires séparés, provenance) servent de référence lorsque compatibles; **ne pas bloquer** la navigation IA ni imposer la migration de données historiques pour cette seule raison.
