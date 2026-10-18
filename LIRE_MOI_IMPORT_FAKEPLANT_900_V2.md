# Orgo / FakePlant — import 900 personas désactivés V2

## Installation

Extraire ce ZIP **à la racine de** `C:\mycode\Orgo\Orgo`.

- **`PREVIEW_FAKEPLANT_900.cmd`** : vérifie les 2 fixtures SHA-256 puis lit le tenant et les compteurs réels **dans le conteneur API Orgo**. Aucune écriture PostgreSQL. Transfert et suppression de fichiers temporaires dans le conteneur.
- **`IMPORT_FAKEPLANT_900_ORGO.cmd`** : mêmes vérifications, puis demande `SAUVEGARDE OK` et `IMPORTER 900 fakeplant` avant écriture.

Requiert PowerShell 7, Node 22, Docker Compose, les services `api` + `postgres` en marche, une sauvegarde confirmée, et la fixture canonique dans `Konnaxion_Worlds/universes/fakeplant/fixture` avec miroir identique dans `Orgo_Worlds/fakeplant/fixture`.

L'importeur doit trouver l'organisation existante **fakeplant** d'UUID `0c2d7244-a0c0-4a10-8f11-0389f275f133` et `active`, ou il refuse. Il ne peut pas créer d'organisation. Il importe les 900 `UserAccount` sous `status=disabled`, `auth_provider=external_only`, `password_hash=null`, et 900 `PersonProfile` avec `external_reference` de la fixture. Il refuse de réutiliser un compte qui n'est pas un compte synthétique désactivé; il vérifie les collisions de références. La transaction Prisma est atomique. L'import peut être relancé de façon idempotente.

Les 900 profils importés ne sont **pas** un SSO commun ni des comptes actifs dans Konnaxion. Aucun scénario ni ACL ni Interaction Kernel n'est activé.

### Limites de validation

Syntaxe JS, validation de la fixture et refus des paramètres dangereux testés localement. **Exécution Docker Windows, transaction PostgreSQL réelle et temps d'import non vérifiés ici.** Arrêter et rapporter les erreurs si une vérification échoue.
