#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
: "${1:?Usage: backup.sh /absolute/path/orgo.dump}"
# pg_dump reads credentials from PG* variables or a restricted .pgpass when available.
# Keep output private; do not overwrite an existing backup.
umask 077
if [[ -e "$1" ]]; then echo 'Destination already exists' >&2; exit 1; fi
trap 'rm -f -- "$1.partial"' EXIT
PGDATABASE="$DATABASE_URL" pg_dump --format=custom --no-owner --file="$1.partial"
mv -- "$1.partial" "$1"
trap - EXIT
