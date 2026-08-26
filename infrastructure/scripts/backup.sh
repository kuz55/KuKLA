#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
STAMP=$(date +%Y%m%d-%H%M%S)
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-kukla}" -d "${POSTGRES_DB:-kukla}" --format=custom > "backups/kukla-${STAMP}.dump"
find backups -type f -name '*.dump' -mtime +14 -delete
echo "Backup created: backups/kukla-${STAMP}.dump"
