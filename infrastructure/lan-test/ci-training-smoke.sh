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
NODE_EXTRA_CA_CERTS="$PWD/private/test-ca.crt" TRAINING_URL="https://$ip:18443" TRAINING_PROJECT="$project" node --input-type=module <<'NODE'
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
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
const login=async name=>{const a=accounts.find(x=>x.name===name); return (await (await req('/api/v1/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({login:a.email,password:a.password})})).json());};
const operator=(await login('operator')).token, registrar=(await login('registrar')).token;
const coordinator=(await login('coordinator')).token, lead=await login('fieldlead');
const headers=token=>({authorization:`Bearer ${token}`,'content-type':'application/json'});
const report=await (await req('/api/v1/intake/reports',{method:'POST',headers:{...headers(operator),'idempotency-key':crypto.randomUUID()},body:JSON.stringify({applicantName:'Synthetic',applicantContact:null,missingPersonName:null,lastSeenTime:null,lastSeenPlace:null,situation:null})})).json();
await req(`/api/v1/intake/reports/${report.id}/handoff`,{method:'POST',headers:{authorization:`Bearer ${operator}`}});
const queue=await (await req('/api/v1/intake/queue',{headers:headers(registrar)})).json();
if(!queue.items.some(x=>x.id===report.id)) throw Error('Report absent from registrar queue');
const created=await (await req(`/api/v1/intake/reports/${report.id}/create-search`,{method:'POST',headers:headers(registrar),body:JSON.stringify({title:'Synthetic search'})})).json();
const claim=`/api/v1/coordination/searches/${created.searchId}/claim`;
const denied=await fetch(base+claim,{method:'POST',headers:{authorization:`Bearer ${operator}`}});
if (denied.status!==403) throw Error('Unauthorized claim must be forbidden');
await req(claim,{method:'POST',headers:{authorization:`Bearer ${coordinator}`}});
const proposals=`/api/v1/field-lead/searches/${created.searchId}/proposals`;
const proposed=await (await req(proposals,{method:'POST',headers:headers(registrar),body:JSON.stringify({candidateId:lead.user.id})})).json();
const inbox=await (await req('/api/v1/field-lead/notifications',{headers:{authorization:`Bearer ${lead.token}`}})).json();
if (!inbox.items.some(x=>x.proposal_id===proposed.proposalId && x.kind==='PROPOSED')) throw Error('Lead invitation missing');
await req(`${proposals}/accept`,{method:'POST',headers:headers(lead.token),body:JSON.stringify({proposalId:proposed.proposalId})});
const enrol=()=>execFileSync('docker',['compose','-p',process.env.TRAINING_PROJECT,'-f','compose.yml','-f','compose.training.yml','exec','-T',
  '-e','KUKLA_TRAINING_ENROL=synthetic-only','-e',`KUKLA_TRAINING_SEARCH_ID=${created.searchId}`,'server','node','--input-type=module'],
  {input:fs.readFileSync('enrol-training.mjs'),encoding:'utf8'});
if (!enrol().includes('2 account(s) added') || !enrol().includes('0 account(s) added')) throw Error('Training enrolment retry failed');
let productionBlocked=false;
try {
  execFileSync('docker',['compose','-p',process.env.TRAINING_PROJECT,'-f','compose.yml','-f','compose.training.yml','exec','-T',
    '-e','NODE_ENV=production','-e','KUKLA_TRAINING_ENROL=synthetic-only','-e',`KUKLA_TRAINING_SEARCH_ID=${created.searchId}`,
    'server','node','--input-type=module'],{input:fs.readFileSync('enrol-training.mjs'),stdio:'pipe'});
} catch { productionBlocked=true; }
if (!productionBlocked) throw Error('Production enrolment must be blocked');
const groupLead=await login('grouplead'), groupBase=`/api/v1/field-groups/searches/${created.searchId}`;
const group=await (await req(`${groupBase}/groups`,{method:'POST',headers:headers(lead.token),body:JSON.stringify({requestId:crypto.randomUUID(),title:'Synthetic group',candidateId:groupLead.user.id})})).json();
await req(`${groupBase}/groups/${group.groupId}/lead-response`,{method:'POST',headers:headers(groupLead.token),body:JSON.stringify({proposalId:group.proposalId,accept:true})});
const taskBase=`/api/v1/field-tasks/searches/${created.searchId}`;
const task=await (await req(`${taskBase}/groups/${group.groupId}/tasks`,{method:'POST',headers:headers(lead.token),body:JSON.stringify({requestId:crypto.randomUUID(),description:'Synthetic task',dueAt:'2030-01-01T00:00:00Z',priority:'URGENT'})})).json();
const tasks=await (await req(`${taskBase}/groups/${group.groupId}/tasks`,{headers:{authorization:`Bearer ${groupLead.token}`}})).json();
if (!tasks.items.some(x=>x.id===task.taskId && x.priority==='URGENT')) throw Error('Group task missing');
await req(`${taskBase}/tasks/${task.taskId}/accept`,{method:'POST',headers:headers(groupLead.token),body:JSON.stringify({requestId:crypto.randomUUID()})});
console.log('Training stack: HTTPS, intake, coordinator, field lead, group and task path passed.');
NODE
