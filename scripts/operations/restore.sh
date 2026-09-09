#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to a dedicated empty restore database}"
if [[ "${1:-}" != '--restore-to-empty-database' || ! -f "${2:-}" ]]; then echo 'Usage: restore.sh --restore-to-empty-database backup.dump' >&2; exit 1; fi
# Deliberately no --clean: fails instead of replacing existing application tables.
PGDATABASE="$RESTORE_DATABASE_URL" pg_restore --single-transaction --exit-on-error --no-owner "$2"
