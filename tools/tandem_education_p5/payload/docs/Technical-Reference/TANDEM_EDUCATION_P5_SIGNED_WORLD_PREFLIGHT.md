# Tandem Éducation P5 — précontrôle de preuve Worlds signée (non exécutable)

Orgo vérifie une preuve Ed25519 de portée du service Orgo_Worlds **à l'aide d'une liste locale de clés publiques approuvées par l'administrateur**. Le client Akor ne peut ni fournir la clé publique ni fixer le défi `challenge` : un nouveau défi cryptographique est créé à chaque appel. La signature couvre la session (acteur identifié par le serveur), le tenant, le World, la release courante et SHA-256 du scénario exact.

Le module `p5-signed-world-preview.mjs` réemploie l'authentification Orgo P4 et la validation d'admission P3. L'intégration utilise trois ports distincts : preuve signée Worlds, approbation enseignante lue côté serveur, et permissions de participants lues côté serveur. Aucun de ces ports n'est branché à un contrôleur Nest ni à une base réelle dans P5. La clef publique, le transport authentifié et les deux lecteurs autorisés doivent être injectés côté serveur; ils ne sont pas dérivés du payload Akor.

## Démonstration hors ligne

1. Installer P5 Orgo_Worlds avant P5 Orgo.
2. Exécuter `CHECK_TANDEM_EDU_P5_CHAIN.cmd` à la racine d'Orgo. Le test importe **les vrais modules P5 des deux dépôts**, compare les octets des fixtures 11 tâches, et génère une paire Ed25519 en mémoire.
3. Les sessions, World store, approbations et grants sont **simulés**. Les tests négatifs incluent approbation révoquée, World archivé, signature invalidée, mauvaise clé, nonce réutilisé, tenant/release/empreinte divergents et champ de données personnelles ajouté.

Toutes les sorties restent `runtime_admitted:false`, `teacher_authorized:false`, `permissions_verified:false`, `world_release_verified:false`, `dispatch_allowed:false`, `may_publish_to_child:false`, `db_writes:0`, `network_calls:0`. La preuve signée atteste un **état de test**, pas une permission d'exécution. Aucune voie de création Case/Task n'est ajoutée.

## Blocages P6
Un registre réel d'approbation enseignante liée au SHA256 n'est pas présent dans le dépôt Orgo fourni. La signature ne doit pas contourner ce manque. Avant tout runtime : approbations persistées avec révocation et unicité, transport Orgo ↔ Worlds authentifié/clé épinglée, clé privée hors dépôt, contrôles des sessions et grants en base, décision atomique avec une clé d'idempotence et contrôle de changement concurrent des membres/releases, qualification TypeScript/Nest + DB isolée. Aucun enfant réel ni publication avant cela.
