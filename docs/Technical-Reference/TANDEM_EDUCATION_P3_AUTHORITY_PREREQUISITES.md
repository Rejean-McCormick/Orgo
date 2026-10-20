# Tandem Éducation P3 — pré-admission Orgo (hors ligne, non opérationnelle)

`tools/tandem-education/admission-prerequisites.mjs` décrit et teste le point de jonction qui devra être inséré **après** le vrai `AuthGuard`/`IdentityService` d'Orgo et **avant** toute création de Case, Task ou workflow.

1. Relire les octets exacts de l'intention Akor P2, le résultat P2 Orgo_Worlds et la demande Akor P3; recouper les SHA-256, le tenant, le World, la release et les 11 tâches.
2. Exiger un contexte utilisateur produit par `IdentityService` avec la permission dédiée `education:admit` (permission proposée pour ce flux, **non provisionnée** par P3). Ne pas accepter des claims depuis un JSON client ou des en-têtes d'identité Orgo_Worlds.
3. Vérifier les résultats d'adaptateurs **internes** pour le World actif, release courante, membership de l'acteur, autorisation enseignante fraîche (<=60 secondes, liée à l'intention et à l'acteur), ainsi que la couverture de chaque tâche par un participant SYNTHÉTIQUE du même tenant et World.
4. Même lorsque les simulateurs de ports passent, le résultat est strictement `DRY_RUN_ONLY_NO_RUNTIME_ADMISSION`, avec `runtime_admitted=false`, `teacher_authorized=false`, `permissions_verified=false`, `dispatch_allowed=false`, `db_writes=0`, `network_calls=0`.

**Limites de sécurité :** les ports en mémoire ne constituent pas une attestation cryptographique. Aucune route NestJS, aucun fournisseur d'enseignant, aucun client authentifié Orgo_Worlds, aucune vérification de session réelle, aucun enregistrement/idempotence anti-rejeu et aucune transaction DB ne sont raccordés. Ne jamais interpréter un résultat de test de ces ports comme un droit d'exécution. L'intégration ultérieure doit être vérifiée dans une transaction serveur, puis qualifiée avec une base et un environnement isolés avant toute donnée réelle.

Pas de Docker, de VPS ni de données d'élève concernés par P3.
