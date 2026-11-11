#!/usr/bin/env bash
# Creates synthetic accounts once on an empty dedicated training DB.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] && [ -d private ] || { echo 'Run init-test.sh first.' >&2; exit 1; }
file=private/training-accounts.json
umask 077
(set -o noclobber; : > "$file") 2>/dev/null || { echo 'Credentials file already exists; refusing to overwrite.' >&2; exit 1; }
if ! docker compose -p kukla-training -f compose.yml -f compose.training.yml exec -T -e KUKLA_TRAINING_SEED=synthetic-only server node --input-type=module < seed-training.mjs > "$file"; then
  rm -f -- "$file"
  echo 'Seed failed; credentials file removed. Do not rerun if database state is uncertain; investigate first.' >&2
  exit 1
fi
echo "Synthetic credentials saved to $file (owner read/write only). Do not share publicly."
