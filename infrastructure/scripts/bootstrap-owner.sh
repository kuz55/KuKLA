#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
  echo "Missing infrastructure/.env. Run install.sh or copy .env.example first." >&2
  exit 1
fi

read -r -p "Owner full name: " owner_name
read -r -p "Owner email: " owner_email
read -r -s -p "Owner password (at least 12 characters): " owner_password
echo
read -r -s -p "Repeat password: " owner_password_confirm
echo

if [[ "$owner_password" != "$owner_password_confirm" ]]; then
  echo "Passwords do not match." >&2
  exit 1
fi
if [[ ${#owner_password} -lt 12 ]]; then
  echo "Password must contain at least 12 characters." >&2
  exit 1
fi

sql_literal() {
  local value="$1"
  value="${value//\'/\'\'}"
  printf "'%s'" "$value"
}

statement="SELECT kukla_bootstrap_system_owner($(sql_literal "$owner_name"), $(sql_literal "$owner_email"), $(sql_literal "$owner_password"));"
unset owner_password owner_password_confirm

printf '%s\n' "$statement" | docker compose exec -T postgres sh -c \
  'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'

echo "SYSTEM_OWNER created. Sign in through the KuKLA client."
