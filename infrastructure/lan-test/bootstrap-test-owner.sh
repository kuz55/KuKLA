#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo 'Missing .env; run init-test.sh first.' >&2; exit 1; }
read -r -p 'Test owner name: ' name
read -r -p 'Test owner email: ' email
read -r -s -p 'Test owner password (at least 12 characters): ' password; echo
read -r -s -p 'Repeat password: ' confirm; echo
[ "$password" = "$confirm" ] && [ "${#password}" -ge 12 ] || { echo 'Passwords differ or are too short.' >&2; exit 1; }
quote() { local v="$1"; v="${v//\'/\'\'}"; printf "'%s'" "$v"; }
statement="SELECT kukla_bootstrap_system_owner($(quote "$name"), $(quote "$email"), $(quote "$password"));"
unset password confirm
printf '%s\n' "$statement" | docker compose -f compose.yml exec -T postgres sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
echo 'Test owner created.'
