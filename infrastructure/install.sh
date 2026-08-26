#!/usr/bin/env bash
set -euo pipefail
ROOT=/opt/kukla
sudo mkdir -p "$ROOT"
sudo chown -R "$USER":"$USER" "$ROOT"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cp -a "$SCRIPT_DIR/.."/. "$ROOT/"
cd "$ROOT/infrastructure"
if [[ ! -f .env ]]; then cp .env.example .env; fi
if grep -q 'CHANGE_ME' .env; then
  sed -i "s/CHANGE_ME/$(openssl rand -hex 32)/" .env
fi
docker compose up -d --build
echo "KuKLA installed. Health: http://127.0.0.1:8080/health"
