#!/usr/bin/env bash
set -euo pipefail
if [[ $# -ne 1 ]]; then echo "Usage: $0 backups/kukla-YYYYMMDD-HHMMSS.dump"; exit 1; fi
cd "$(dirname "$0")/.."
docker compose exec -T postgres pg_restore -U "${POSTGRES_USER:-kukla}" -d "${POSTGRES_DB:-kukla}" --clean --if-exists < "$1"
