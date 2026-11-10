#!/usr/bin/env bash
# Disposable CI only: this script deletes its dedicated test Docker volume.
set -euo pipefail
[ "${KUKLA_DISPOSABLE_CI:-}" = 1 ] || { echo 'Disposable CI only' >&2; exit 1; }
cd "$(dirname "$0")"
[ ! -e .env ] && [ ! -e private ] || { echo 'Refusing to use existing credentials' >&2; exit 1; }
export COMPOSE_PROJECT_NAME="kukla_ci_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-1}"
owned=0
cleanup() {
  if [ "$owned" = 1 ]; then
    docker compose -f compose.yml down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf private .env
  fi
}
trap cleanup EXIT
ip="$(python3 - <<'PY'
import socket
s=socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.connect(('1.1.1.1', 53))
print(s.getsockname()[0])
s.close()
PY
)"
./init-test.sh "$ip" >/dev/null
owned=1
docker compose -f compose.yml up -d --build
ready=0
for _ in $(seq 1 90); do
  if curl --noproxy '*' --silent --fail --connect-timeout 2 --max-time 3 --cacert private/test-ca.crt "https://$ip:18443/ready" >/dev/null; then ready=1; break; fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  diagnostic="$(docker compose -f compose.yml ps --format json 2>/dev/null | python3 -c 'import json,sys; print("; ".join(str((x.get("Service"),x.get("State"),x.get("Health"))) for l in sys.stdin if (x:=json.loads(l))))' || true)"
  echo "::error title=LAN smoke readiness::${diagnostic:-No container status}"
  curl_error="$(curl --noproxy '*' --silent --show-error --fail --connect-timeout 2 --max-time 3 --cacert private/test-ca.crt "https://$ip:18443/ready" 2>&1 >/dev/null || true)"
  echo "::error title=LAN smoke curl::${curl_error:-No curl diagnostic}"
  set -a; . ./.env; set +a
  diagnostic_logs="$(docker compose -f compose.yml logs --tail=15 server proxy 2>&1 | python3 -c 'import os,sys; t=sys.stdin.read(); [None for k in ("JWT_SECRET", "POSTGRES_PASSWORD") if not (v:=os.environ.get(k)) or not (t:=t.replace(v,"[redacted]"))]; print(t.replace("%","%25").replace("\r","%0D").replace("\n","%0A"))')"
  echo "::error title=LAN smoke logs::$diagnostic_logs"
  echo 'Test service is not ready' >&2; exit 1
fi
printf '%s\n' "SELECT kukla_bootstrap_system_owner('Test owner','test-owner@example.invalid','test-only-password-2026');" | \
  docker compose -f compose.yml exec -T postgres sh -c 'exec psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null
curl --noproxy '*' --silent --show-error --fail --max-time 5 --cacert private/test-ca.crt \
  -H 'Content-Type: application/json' --data '{"login":"test-owner@example.invalid","password":"test-only-password-2026"}' \
  "https://$ip:18443/api/v1/auth/login" | node -e 'let s="";process.stdin.on("data",v=>s+=v);process.stdin.on("end",()=>{const x=JSON.parse(s);if(!x.token||x.user.role!=="SYSTEM_OWNER")process.exit(1)})'
echo 'Disposable LAN stack HTTPS readiness and server login passed.'
