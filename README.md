# Orgo

Orgo est un monolithe modulaire de coordination opérationnelle : **Intake → Work (Case + Task) → Orchestration**, avec PostgreSQL, une API NestJS, un worker de la même release et une interface Next/React autonome.

Cette livraison étend le socle avec processus durables, pièces jointes, permissions par périmètre, gestion des comptes/SSO, opérations de domaine, email, vues produit et travail hors ligne. La validation finale sera exécutée localement par le propriétaire. Voir [la couverture réelle](docs/Technical-Reference/IMPLEMENTATION_STATUS.md), [les décisions](docs/Technical-Reference/COMPLETION_DECISIONS.md) et [la correspondance architecture/code](docs/Technical-Reference/ARCHITECTURE_TO_CODE.md).

## Installer cette archive

Extraire cette **archive complète dans un nouveau répertoire**. Ce n’est pas un overlay à décompresser aveuglément sur l’ancien dépôt : les anciennes sources actives ont été déplacées sous `legacy/`. Pour conserver un historique Git existant, remplacer les arbres `apps/api/src`, `apps/api/test`, `apps/web/src` et `apps/web/pages` par ceux de cette livraison, puis examiner le diff.

## Démarrer avec Docker Compose

1. Copier `.env.example` vers `.env`.
2. Renseigner `POSTGRES_PASSWORD` (une valeur aléatoire hexadécimale convient), `ORGO_ADMIN_PASSWORD` (au moins 12 caractères), `ORGO_ADMIN_EMAIL` et `ORGO_ORGANIZATION`.
3. Exécuter :

```sh
docker compose up --build -d
docker compose --profile setup run --rm seed
```

Ouvrir `http://localhost:3000`. Utiliser le slug `ORGO_ORGANIZATION`, l'adresse et le mot de passe choisis. Le seed est répétable et ne remplace pas le mot de passe d'un compte existant.

L'API écoute sur `http://localhost:4000/api/v3`. Le worker partage la base et le code métier avec elle. Les ports Compose sont liés à localhost ; une exposition externe nécessite votre terminaison TLS habituelle.

## Développement local

Prérequis : Node 22 ou supérieur, npm et PostgreSQL 16. Exporter `DATABASE_URL` et les variables de provisionnement dans le shell ; les processus Node ne chargent pas automatiquement le `.env` racine.

```sh
npm ci
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev:api
```

Dans deux autres terminaux, avec le même environnement :

```sh
npm run worker
npm run dev:web
```

`ORGO_API_URL` est lu lors du démarrage/build de Next ; sa valeur par défaut est `http://localhost:4000`. Les requêtes du navigateur passent par `/api/v3` sur la même origine. La session navigateur est conservée en mémoire : recharger la page demande une nouvelle connexion.

## Validation finale locale

La nouvelle livraison n’a pas subi de recette finale ici. Pour exécuter les contrôles et tests sur PostgreSQL natif :

```sh
export TEST_DATABASE_URL='postgresql://USER:PASSWORD@localhost:5432/orgo_test?connection_limit=5'
npm run validate:local
```

Voir [LOCAL_VALIDATION.md](docs/Technical-Reference/LOCAL_VALIDATION.md) pour la recette navigateur, les intégrations et la restauration. Les commandes individuelles restent disponibles :

```sh
npm run check:architecture
npm run typecheck
npm test
npm run test:pglite
npm run build
```

`test:pglite` crée une base éphémère PostgreSQL WASM, applique toutes les migrations et teste les vraies routes HTTP, services, transactions et worker. Un test de verrouillage interconnexion est réservé à PostgreSQL natif.

Pour PostgreSQL natif, utiliser **une base dédiée aux tests**, appliquer les migrations puis lancer `npm run test:integration`. La CI fournie le fait avec PostgreSQL 16 et plusieurs connexions. La CI n'a pas été exécutée dans cet environnement.

## Fichiers charnières

| Responsabilité | Entrée |
| --- | --- |
| Schéma et migration | `apps/api/prisma/schema.prisma`, `prisma/migrations/20260908220000_work_foundations` |
| Contexte, erreurs, invariants | `apps/api/src/orgo/platform/contracts.ts` |
| Transactions, idempotence, événements, outbox | `apps/api/src/orgo/platform/database.ts` |
| Propriétaire Cases/Tasks | `apps/api/src/orgo/modules/work/public.ts` |
| Intake persistant | `apps/api/src/orgo/modules/intake/intake.service.ts` |
| Évaluation pure | `apps/api/src/orgo/modules/orchestration/evaluator.ts` |
| Versions et application des effets | `workflow.service.ts`, `actions.ts` dans Orchestration |
| Processus longs | `apps/api/src/orgo/modules/orchestration/process-manager.service.ts` |
| Pièces jointes et historique | `apps/api/src/orgo/modules/work/evidence.service.ts` |
| Accès, scopes et SSO | `apps/api/src/orgo/modules/identity/` |
| Vues complémentaires et hors ligne | `apps/web/src/orgo/Extensions.tsx`, `offline.ts` |
| Migration complémentaire | `apps/api/prisma/migrations/20260909160000_product_completion/migration.sql` |
| Worker et reprise | `apps/api/src/orgo/platform/outbox/worker.service.ts` |
| Composition des processus | `apps/api/src/orgo/runtime.module.ts`, `src/main.ts`, `src/worker.ts` |
| Application et profils | `apps/web/src/orgo/OrgoApp.tsx`, `profiles.ts` |
| Entrée embarquable | `apps/web/src/orgo/hosted-entry.tsx` |

Les sources remplacées sont conservées sous `legacy/`. Elles ne sont ni compilées ni montées. Les tables historiques utiles restent dans le schéma ; il n'y a pas de seconde table Task/Case.

Les intégrations externes sont optionnelles. Le protocole de passerelle, ses limites et les variables de configuration sont décrits dans [INTEGRATION_BRIDGE.md](docs/Technical-Reference/INTEGRATION_BRIDGE.md). Aucun fournisseur ni Spaces n'est nécessaire pour démarrer Orgo.

Pour importer des emails : `python3 scripts/email-ingress.py --eml message.eml`, `--mbox archive.mbox` ou `--imap --watch`, avec les variables de `.env.example`. Configurer `ORGO_PUBLIC_URL` en HTTPS pour les liens d’accès et OIDC. Les gateways SMS/webhook sont optionnelles et doivent respecter le contrat décrit dans `COMPLETION_DECISIONS.md`.
