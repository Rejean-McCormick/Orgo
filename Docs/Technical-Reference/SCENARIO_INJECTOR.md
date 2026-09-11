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
