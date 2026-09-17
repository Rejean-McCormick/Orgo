# Orgo overlay — PostgreSQL URL backup/restore fix

This overlay fixes the production backup/restore scripts discovered by LevelUpDiag N14.

- `backup.sh` now passes `DATABASE_URL` to `pg_dump` with `--dbname=...`.
- `restore.sh` now passes `RESTORE_DATABASE_URL` to `pg_restore` with `--dbname=...`.
- This preserves the full PostgreSQL URI (host, port, user, password, database, query options) instead of treating it as a plain `PGDATABASE` value.

Validation performed:
- `bash -n` on both scripts.
- Stubbed `pg_dump`/`pg_restore` contract test confirms the exact PostgreSQL URLs are passed via `--dbname` and the backup atomic `.partial` -> final rename still works.

After applying, rerun LevelUpDiag `acceptance` directly. Do not start the normal Orgo test runtime first.
