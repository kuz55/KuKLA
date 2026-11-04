#!/usr/bin/env bash
set -euo pipefail

ROOT=/opt/kukla
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

command -v openssl >/dev/null || { echo "openssl is required to generate deployment secrets" >&2; exit 1; }
command -v docker >/dev/null || { echo "docker is required" >&2; exit 1; }

sudo mkdir -p "$ROOT"
sudo chown -R "$USER":"$USER" "$ROOT"
cp -a "$SCRIPT_DIR/.."/. "$ROOT/"
cd "$ROOT/infrastructure"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

ensure_secret() {
  local key="$1" current
  current="$(sed -n "s/^${key}=//p" .env | head -n 1)"
  if [[ -z "$current" || "$current" =~ (replace|change|example|placeholder|your|password|secret|todo) ]]; then
    set_env "$key" "$(openssl rand -hex 32)"
    echo "Generated a new ${key}."
  fi
}

ensure_secret POSTGRES_PASSWORD
ensure_secret JWT_SECRET
chmod 600 .env

docker compose up -d --build

api_port="$(sed -n 's/^SERVER_PORT=//p' .env | head -n 1)"
api_port="${api_port:-18080}"
ready=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${api_port}/ready" >/dev/null; then
    ready=1
    break
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "KuKLA did not become ready. Inspect: docker compose logs server" >&2
  exit 1
fi

echo "KuKLA installed. Health: http://127.0.0.1:${api_port}/health"
if [[ -t 0 ]]; then
  read -r -p "Create the first SYSTEM_OWNER account now? [Y/n] " answer
  if [[ ! "$answer" =~ ^[Nn]$ ]]; then
    ./scripts/bootstrap-owner.sh
  fi
else
  echo "Before first login, create the initial account with:"
  echo "  cd $ROOT/infrastructure && ./scripts/bootstrap-owner.sh"
fi
