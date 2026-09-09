# Validation locale — à exécuter par le propriétaire

Les nouveaux tests sont livrés sans exécution finale dans cet environnement, conformément à la demande. Les résultats de l'archive précédente restent historiques. Cette livraison fait l'objet de contrôles statiques, pas d'une certification fonctionnelle ou de déploiement.

## Base de validation neuve

Utiliser Node 22+, npm et PostgreSQL 16. Extraire l'archive dans un répertoire neuf. Créer une base isolée `orgo_test`, jamais une base de production.

```bash
npm ci
export TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/orgo_test?connection_limit=5'
npm run validate:local
```

Le script génère Prisma, applique les migrations, contrôle les frontières et les types, puis exécute les tests unitaires/d'intégration et les builds. Il s'arrête au premier échec et écrit les résultats dans `validation/local-<date>/`. Les identifiants de connexion réels restent dans votre environnement. Sous Windows, utiliser WSL pour les scripts shell et ce lanceur.

Le test natif `FOR UPDATE SKIP LOCKED` doit être exécuté sur PostgreSQL, pas seulement PGlite. Les nouveaux scénarios couvrent fichiers/tenants, étapes humaines/révisions, réception asynchrone, périmètres Work, chevauchements de calendrier et pièces jointes email. Le test de template est purement local.

## Démarrage et navigateur

Configurer `.env` depuis `.env.example`, puis suivre le README pour Compose, migration et création du compte initial. Vérifier les parcours avec au moins deux organisations et un utilisateur limité à un périmètre.

- Connexion/déconnexion ; rôles et droits révoqués pris en compte à la requête suivante.
- Création et édition de Case/Task ; transitions et conflits de révision ; rattachement à un Case ; visibilité restreinte et périmètres cohérents.
- Upload/téléchargement/retrait d'une pièce jointe ; historique paginé et relations ; aucun accès depuis un autre tenant.
- Signal manuel et email, version de workflow épinglée, redémarrage API/worker entre acceptation et traitement.
- Processus en attente humaine, minuterie et reçu externe ; refus/predicate négatif/timeout ; reprise et adoption ; compensation uniquement lorsqu'elle est déclarée et applicable.
- Gestion utilisateurs/rôles/jetons, invitation et mot de passe oublié via un SMTP de test. Vérifier qu'un secret de jeton n'est pas réaffiché lors d'un rejeu.
- OIDC sur une origine HTTPS et un fournisseur de test : subject explicitement inscrit, state/nonce invalide, mauvais issuer/audience/signature, compte désactivé, code réutilisé.
- Maintenance : réservation concurrente du même équipement ; RH : participants/revue/confidentialité ; éducation : ajout/retrait d'un membre et tâche de soutien.
- Notifications, templates, lecture, SMTP et gateways choisies.
- File hors ligne : commande créée sans réseau, reconnexion, rejeu, conflit de révision et correction explicite ; changer de compte ne doit pas exposer la file d'un autre compte.
- CSV (y compris un titre commençant par `=`), pagination, navigation clavier et petits écrans.
- Mode standalone sans Spaces ; mode hébergé avec les vrais contrats Koali lorsqu'ils seront disponibles.

## Reprise de données existantes

Les anciennes migrations du snapshot sont conservées. Certaines migrations historiques remplacent d'anciennes tables : ne pas les rejouer aveuglément sur une base déjà peuplée. Faire une sauvegarde et vérifier l'historique Prisma avant migration.

```bash
export DATABASE_URL='postgresql://.../orgo_existing'
npm run migration:preflight
bash scripts/operations/backup.sh /chemin/prive/orgo-before.dump
```

Le précontrôle ne modifie rien et signale les liens de tenant incohérents, intervalles invalides et comptes nécessitant une réinscription de leurs credentials. Il expose uniquement des identifiants échantillonnés, pas les mots de passe. Réconcilier les données et l'historique avant `prisma migrate deploy`. Les contraintes nouvelles sur des tables historiques marquées `NOT VALID` contrôlent les nouvelles écritures mais nécessitent `VALIDATE CONSTRAINT` après réconciliation des anciennes lignes.

Restaurer dans une base dédiée vide et vérifier fonctionnellement la restauration :

```bash
export RESTORE_DATABASE_URL='postgresql://.../orgo_restore_test'
bash scripts/operations/restore.sh --restore-to-empty-database /chemin/prive/orgo-before.dump
```

## Exploitation et contrats externes

Tester une panne SMTP/fournisseur, des callbacks tardifs/dupliqués/contradictoires, la mort d'un worker après envoi mais avant acquittement, et le redémarrage avec backlog. L'idempotence côté fournisseur reste nécessaire pour des effets externes effectivement uniques.

`GET /api/v3/system/overview` donne l'état des files/processus/workers. `GET /api/v3/system/metrics` fournit des gauges Prometheus avec authentification et permissions d'exploitation. Les logs HTTP sont des spans JSON sur stdout. Collecteur, alertes, sauvegardes planifiées et politique de rétention sont à configurer dans l'environnement de déploiement.

Les contrats natifs Kristal/Konnaxion/Architect/kOA et Koali/Capsule sont à fournir et à vérifier séparément. Les bridges et le contrat public Orgo livrés sont explicites ; ils ne déclarent pas une compatibilité native non démontrée.
