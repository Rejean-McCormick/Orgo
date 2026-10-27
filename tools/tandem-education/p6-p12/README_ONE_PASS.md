# kOA Tandem P6–P12 — Campagne unique, répétition hors ligne

**IMPORTANT — NON DÉPLOYABLE.** Cette campagne exécute en une seule passe les contrôles accessibles sans services ni bases opérationnelles. Elle **n'implémente pas** les autorisations de production ni le runtime Orgo.

## Ce qui est réellement exécuté

1. P5 : contrôle croisé de la preuve Ed25519 Orgo ↔ Orgo_Worlds et refus de révocation / World archivé, en mémoire.
2. P6 : appel direct du nouvel adaptateur Worlds à contexte de transport mTLS **simulé**. Aucun socket, véritable certificat ou registre de pairs déployé.
3. P7 : tests négatifs d'approbation enseignante et de permissions par tâche **fictives**.
4. P8 : simulation transactionnelle **dans une Map JavaScript** : 1 Case, 11 Tasks, idempotence concurrente, injections de pannes et absence de commit partiel.
5. P9 : simulation de projection enseignant limitée à tenant/World et sans PII; **aucun code serveur Ekole n'est raccordé**.
6. P10 : tests négatifs de portée, faux droits, altération, signature et échec transactionnel.
7. P11–P12 : bilan des dépendances inter-dépôts, de compilation, d'intégration et du déploiement **explicitement en attente**.

**À ce stade** `production_ready=false`, `runtime_admitted=false`, `db_writes=0`, `network_calls=0` sont des invariants.

## Installation PowerShell

1. Installer d'abord l'overlay P6–P12 **Orgo_Worlds** dans `C:\mycode\Orgo\Orgo_Worlds`.
2. Installer ensuite l'overlay **Orgo** dans `C:\mycode\Orgo\Orgo`.
3. Exécuter `CHECK_TANDEM_P6_P12_ONE_PASS.cmd` depuis Orgo.
4. `CHECK_TANDEM_P6_P12_ONE_PASS.cmd --require-runtime` **doit échouer** : la qualification de runtime est bloquée par conception.

En cas de rollback, exécuter d'abord **Orgo**, puis **Orgo_Worlds**.

Le ZIP n'écrase aucun fichier P1–P5. Les deux installateurs vérifient les empreintes avant écriture, effectuent les tests hors ligne en staging, stockent les sauvegardes hors dépôt et fournissent ROLLBACK. L'ordre des installations est nécessaire à la vérification croisée.

## Pour terminer *réellement* P6–P12

Les vrais mécanismes nécessitent les snapshots **après P5** (Orgo, Orgo_Worlds, Akor, Ekole, Konnaxion, Konfid, interaction_kernel, Capsule Manager/Node Agent) ainsi qu'un environnement isolé **explicitement autorisé** avec certificats éphémères, un magasin de secrets, une base de tests jetable, la compilation TypeScript et des identités fictives. Le transport mTLS, les approbations persistantes et révocables, l'admission Nest transactionnelle, l'exécution Orgo et la projection Ekole ne peuvent pas être remplacés par cette répétition.

Ce document est une barrière de qualification, pas une autorisation de publication, admission ou VPS.
