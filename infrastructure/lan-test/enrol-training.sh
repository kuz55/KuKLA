#!/usr/bin/env bash
# Synthetic-only fixture, not an operational authorization mechanism.
set -euo pipefail
cd "$(dirname "$0")"
[ "$#" = 1 ] && [[ "$1" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || { echo 'Usage: ./enrol-training.sh <training-search-UUID>' >&2; exit 2; }
[ -f .env ] && [ -f private/training-accounts.json ] || { echo 'Initialize and seed the training stack first.' >&2; exit 1; }
echo 'Training fixture only: adds the two synthetic accounts grouplead and searcher to this training search.'
read -r -p 'Type TRAINING to confirm: ' confirm
[ "$confirm" = TRAINING ] || { echo 'Cancelled.' >&2; exit 1; }
docker compose -p kukla-training -f compose.yml -f compose.training.yml exec -T \
  -e KUKLA_TRAINING_ENROL=synthetic-only -e KUKLA_TRAINING_SEARCH_ID="$1" server node --input-type=module < enrol-training.mjs
