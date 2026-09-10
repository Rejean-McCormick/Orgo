# Orgo — Rapport de statut du 10 septembre 2026

## Décision : bêta

Le niveau recommandé est **bêta**, pas encore release candidate (RC). Les campagnes `deep` et `browser` ont réussi selon les résultats communiqués dans la conversation. Ces résultats permettent de poursuivre les essais fonctionnels ; ils ne démontrent pas encore la complétude du périmètre de livraison.

Ce rapport est établi à partir des résultats transmis, sans nouvelle exécution ni inspection du dépôt. Le commit testé, la branche et les tags existants restent à identifier. Aucun tag n’a été créé ou poussé dans le cadre de ce rapport.

## Éléments de validation disponibles

| Campagne | Résultat communiqué | Périmètre |
| --- | --- | --- |
| `deep` | PASS — 12 niveaux sur 12 | Intégrité du diagnostic, contexte et inventaire du dépôt, hygiène, outils, sécurité, preflight Orgo, schéma/architecture/types, tests métier, intégration PostgreSQL native, builds API/web, audit des dépendances au seuil moderate+ |
| `browser` / N15 | PASS — 7 tests réussis, 0 échec, 0 ignoré | Parcours Playwright avec la vraie API et PostgreSQL |

Référence de la campagne `deep` : `20260910T015821Z-e0b2ce01`.
Rapport local communiqué : `C:\mycode\Orgo\LevelUpDiag-Orgo\.levelupdiag\runs\20260910T015821Z-e0b2ce01\summary.json`.
La référence précise du rapport final `browser` et les SHA Git associés ne sont pas disponibles dans le contexte fourni. Le succès de N15 provient du compte rendu de lecture du rapport dans la conversation.

Les sept scénarios navigateur couvrent :

1. Le refus d’identifiants invalides.
2. La connexion, la recherche clavier et la déconnexion.
3. La création, la recherche et la réouverture d’un dossier.
4. La création, la recherche et la réouverture d’une tâche.
5. La création, la recherche et la réouverture d’un signal.
6. Les transitions d’une tâche.
7. Une recherche sans résultat.

## Incidents résolus pendant la validation

- PostgreSQL indisponible : après remise en disponibilité, les campagnes `database` puis `deep` ont passé.
- Sélecteur d’alerte Playwright ambigu avec l’annonceur Next.js : correction du test.
- Détection de disponibilité du lanceur : lecture corrigée de `data.status` dans la réponse de l’API.
- Connexion HTTP 401 : mot de passe du compte de test non concordant ; le succès final des sept scénarios confirme que le blocage de connexion est levé.

La console LevelUpDiag a reçu des paramètres navigateur et des commandes de démarrage/arrêt de la pile de test. Ces changements appartiennent à l’outil de diagnostic séparé ; leur présence dans une version d’Orgo ne doit pas être supposée.

## Conditions proposées pour une RC

- Définir le périmètre fonctionnel de la version et vérifier chaque fonctionnalité attendue par rapport à la documentation.
- Compléter la validation des permissions et de l’isolation entre organisations, des pièces jointes, des workflows et des autres parcours retenus pour la livraison.
- Établir la liste des anomalies connues et confirmer l’absence de défaut bloquant dans ce périmètre.
- Vérifier l’installation et les migrations dans un environnement représentatif de la livraison.
- Rattacher les rapports `deep` et `browser` au même état de code destiné au tag ; relancer les contrôles concernés si le code ou ses dépendances ont changé.

Ces points sont des validations restant à documenter, pas des défauts constatés.

## Préparation du tag GitHub

Utiliser un tag de préversion bêta conforme aux conventions du dépôt. **`v0.1.0-beta.1` est une proposition conditionnelle**, à retenir uniquement si la prochaine version visée est bien `0.1.0` et si ce tag n’existe pas déjà. Les mentions `api@0.1.0` et `web@0.1.0` dans les journaux ne suffisent pas à établir la version de livraison.

Avant le push : identifier le dépôt, sa branche de livraison, les versions et tags existants ; intégrer ce rapport dans `docs/status` ; vérifier les modifications locales et le commit à publier ; rattacher les preuves de tests à cet état. Créer ensuite un tag annoté sur le commit retenu et pousser uniquement ce tag. Ne pas remplacer un tag existant.

Si une GitHub Release est créée, la marquer comme préversion et reprendre les limites de couverture ci-dessus.
