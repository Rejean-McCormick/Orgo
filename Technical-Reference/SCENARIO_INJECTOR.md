# Scenario Injector — note d'architecture

## But

Fournir une frontière explicite entre une IA qui **propose une simulation** et Orgo qui **persiste des faits synthétiques**.

L'IA n'obtient pas un accès direct à Orgo. Elle produit un document `orgo.scenario.v1` limité à une liste d'opérations autorisées. L'injecteur valide ce document, résout les références locales en UUID runtime, puis utilise uniquement l'API publique Orgo v3.

## Invariants

1. Aucun SQL cross-boundary.
2. Aucun UUID runtime généré par l'IA.
3. Aucune route HTTP arbitraire.
4. Dry-run par défaut; `--apply` est obligatoire pour écrire.
5. Idempotency-Key déterministe par opération.
6. Correlation ID commun au scénario.
7. Les fixtures v1 sont toujours marquées synthétiques.
8. Les Signals possèdent un `external_reference` stable.
9. Une attente de worker ne transforme jamais un timeout en faux succès.
10. Le rapport d'import conserve les UUID réellement créés/résolus.

## Frontière IA

Le template généré par `scenario.ps1 template` est le contrat à fournir à l'IA avec le brief du scénario. La réponse attendue est uniquement du JSON.

## Frontière Orgo

L'injecteur utilise les routes existantes : workflows, cases, tasks, signals et transitions. Il n'ajoute aucun endpoint au serveur Orgo et ne modifie pas le schéma Prisma.

## Évolution

Le schéma est versionné (`orgo.scenario.v1`). Toute extension future (personnes, rôles, domaines spécialisés, pièces jointes) doit ajouter des opérations explicites et des validateurs dédiés plutôt qu'un mécanisme d'appel HTTP générique.

## Reprise depuis Orgo_Worlds

`Orgo_Worlds` peut être utilisé comme dépôt autonome de Worlds/scénarios à côté d'Orgo. La frontière d'écriture reste toutefois ce Scenario Injector : Orgo_Worlds ne reçoit aucun accès SQL et ne fait pas d'appel métier direct à Orgo.

```text
Orgo_Worlds/world-packs/<world>/...
        ↓
orgo.scenario.v1
        ↓
validate / plan
        ↓
Orgo Scenario Injector
        ↓
API publique Orgo v3
```

Les opérations de reprise suivantes sont explicitement autorisées :

- `find_case` et `find_task` : résolution contrôlée d'objets existants sans UUID dans le scénario source;
- `assert_case_absent` : assertion fail-closed pour les états où un Case ne doit pas exister;
- `request_integration` : création d'une IntegrationOperation à partir d'un `case_ref`/`task_ref`;
- `wait_integration` : observation d'une opération d'intégration par référence locale.

Les résolveurs exigent un résultat unique. Ils ne constituent pas une route HTTP générique et ne donnent pas à l'auteur du scénario la possibilité de choisir un endpoint arbitraire.
