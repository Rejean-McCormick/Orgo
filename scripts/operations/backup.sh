#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL}"
: "${1:?Usage: backup.sh /absolute/path/orgo.dump}"
# Pass DATABASE_URL as libpq connection input so host/user/password/database are all honored.
# Keep output private; do not overwrite an existing backup.
umask 077
if [[ -e "$1" ]]; then echo 'Destination already exists' >&2; exit 1; fi
trap 'rm -f -- "$1.partial"' EXIT
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --file="$1.partial"
mv -- "$1.partial" "$1"
trap - EXIT
