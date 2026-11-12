# Coordination scolaire Ékole × Orgo — 2026-11-11

**Contrat de responsabilité, pas une activation de production.** Les scénarios `kontexte.mission/1` proviennent de Kontexte. Orgo possède exclusivement Case, Task, Signal, changements de statut et idempotence. Le rôle narratif (`fermier`, `sorciere`...) ne confère ni droit IAM, ni permission de World, ni identité d'élève. L'enseignant doit approuver les attributions. Une Task `COMPLETED` n'est pas un événement de maîtrise Ékole.

Le générateur Kontexte `scenario_fixture()` est une **fixture synthétique d'amorçage à une seule Task de révision**. L'injecteur existant `tools/scenario-injector/` sait valider `orgo.scenario.v1` mais ne doit jamais importer directement `kontexte.mission/1`; `--apply` est un acte explicite indépendant. Aucun correctif de ce lot ne crée une route d'admission scolaire.

**Validation du lot** : le vérificateur local `Ekole/ekole/tools/verifier_ecosysteme_tandem.py` contrôle 17 fixtures Orgo de préparation sans envoyer de requête. Les préconditions de WorldRelease, enseignant, classe et acteur restent à qualifier côté serveur avant toute exécution réelle.
