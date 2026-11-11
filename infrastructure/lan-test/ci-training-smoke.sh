#!/usr/bin/env bash
# Disposable CI only. Deletes only its uniquely named project and test secrets.
set -euo pipefail
[ "${KUKLA_DISPOSABLE_CI:-}" = 1 ] || { echo 'Disposable CI only' >&2; exit 1; }
cd "$(dirname "$0")"
[ ! -e .env ] && [ ! -e private ] || { echo 'Refusing existing credentials' >&2; exit 1; }
project="kukla_training_ci_${GITHUB_RUN_ID:-local}_${GITHUB_RUN_ATTEMPT:-1}"
owned=0
stage='initialization'
trap 'echo "::error title=Training smoke::Failure during $stage"' ERR
cleanup() {
  if [ "$owned" = 1 ]; then
    docker compose -p "$project" -f compose.yml -f compose.training.yml down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf private .env
  fi
}
trap cleanup EXIT
ip="$(python3 - <<'PY'
import socket
s=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); s.connect(('1.1.1.1',53)); print(s.getsockname()[0]); s.close()
PY
)"
./init-test.sh "$ip" >/dev/null
owned=1
stage='build and start containers'
docker compose -p "$project" -f compose.yml -f compose.training.yml up -d --build
stage='HTTPS readiness'
ready=0
for _ in $(seq 1 90); do
  if curl --noproxy '*' --silent --fail --connect-timeout 2 --max-time 3 --cacert private/test-ca.crt "https://$ip:18443/ready" >/dev/null; then ready=1; break; fi
  sleep 1
done
[ "$ready" = 1 ] || { echo '::error title=Training smoke::HTTPS readiness failed' >&2; exit 1; }
stage='seed synthetic users'
docker compose -p "$project" -f compose.yml -f compose.training.yml exec -T -e KUKLA_TRAINING_SEED=synthetic-only server node --input-type=module < seed-training.mjs > private/ci-accounts.json
stage='HTTPS UI and intake scenario'
NODE_EXTRA_CA_CERTS="$PWD/private/test-ca.crt" TRAINING_URL="https://$ip:18443" node --input-type=module <<'NODE'
import fs from 'node:fs';
process.on('uncaughtException', error => {
  // Only synthetic data is used here; never print credentials or response bodies.
  const message=String(error.message).replace(/[\r\n%]/g,' ');
  console.error(`::error title=Training smoke HTTPS::${message}`);
  process.exitCode=1;
});
const base=process.env.TRAINING_URL, accounts=JSON.parse(fs.readFileSync('private/ci-accounts.json','utf8'));
const req=async(path,options={})=>{const r=await fetch(base+path,options);if(!r.ok)throw Error(`${path}: ${r.status}`);return r;};
const page=await req('/'); if(!(await page.text()).includes('ТОЛЬКО ВЫМЫШЛЕННЫЕ ДАННЫЕ')) throw Error('Training banner missing');
const script=await req('/app.mjs'); if(!script.headers.get('content-type')?.includes('javascript')) throw Error('Module MIME mismatch');
const login=async name=>{const a=accounts.find(x=>x.name===name); return (await (await req('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:a.email,password:a.password})})).json()).token;};
const operator=await login('operator'), registrar=await login('registrar');
const headers=token=>({authorization:`Bearer ${token}`,'content-type':'application/json'});
const report=await (await req('/api/v1/intake/reports',{method:'POST',headers:{...headers(operator),'idempotency-key':crypto.randomUUID()},body:JSON.stringify({applicantName:'Synthetic',applicantContact:null,missingPersonName:null,lastSeenTime:null,lastSeenPlace:null,situation:null})})).json();
await req(`/api/v1/intake/reports/${report.id}/handoff`,{method:'POST',headers:headers(operator)});
const queue=await (await req('/api/v1/intake/queue',{headers:headers(registrar)})).json();
if(!queue.items.some(x=>x.id===report.id)) throw Error('Report absent from registrar queue');
await req(`/api/v1/intake/reports/${report.id}/create-search`,{method:'POST',headers:headers(registrar),body:JSON.stringify({title:'Synthetic search'})});
console.log('Training stack: HTTPS, UI, login, intake and registrar path passed.');
NODE
