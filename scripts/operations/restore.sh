#!/usr/bin/env bash
set -euo pipefail
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL to a dedicated empty restore database}"
if [[ "${1:-}" != '--restore-to-empty-database' || ! -f "${2:-}" ]]; then echo 'Usage: restore.sh --restore-to-empty-database backup.dump' >&2; exit 1; fi
# Deliberately no --clean: fails instead of replacing existing application tables.
# Pass RESTORE_DATABASE_URL as libpq connection input so the dedicated target is explicit.
pg_restore --dbname="$RESTORE_DATABASE_URL" --single-transaction --exit-on-error --no-owner "$2"
