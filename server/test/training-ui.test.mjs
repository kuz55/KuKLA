import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { randomUUID } from 'node:crypto';
import { TrainingApi, ReportAttempt } from '../../infrastructure/lan-test/training-ui/api.mjs';

const ok = data => ({ok:true,status:200,json:async()=>data});

test('training API retains one idempotency key and body on an ambiguous retry', async () => {
  const calls=[]; const api=new TrainingApi(async (path,options)=>{calls.push({path,options}); if(calls.length===1) throw new Error('connection lost'); return ok({id:'synthetic'});});
  api.token='test-token'; const input={applicantName:'Synthetic',applicantContact:null};
  const attempt=new ReportAttempt(input,randomUUID()); input.applicantName='changed';
  await assert.rejects(attempt.create(api)); await attempt.create(api);
  assert.equal(calls[0].options.headers['Idempotency-Key'],calls[1].options.headers['Idempotency-Key']);
  assert.equal(calls[0].options.body,calls[1].options.body);
  assert.equal(JSON.parse(calls[1].options.body).applicantName,'Synthetic');
  assert.equal(calls[1].options.credentials,'omit');
  assert.equal(calls[1].path,'/api/v1/intake/reports');
});

test('training interface logs in, retries unchanged, hands off and safely renders registrar data', async () => {
  const html=await readFile(new URL('../../infrastructure/lan-test/training-ui/index.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'https://training.invalid/'});
  const {window}=dom; globalThis.window=window; globalThis.document=window.document; globalThis.FormData=window.FormData;
  const calls=[]; let creates=0;
  globalThis.fetch=async (path,options)=>{
    calls.push({path,options});
    if(path==='/api/v1/auth/login') return ok({token:'synthetic-token',user:{name:'Test'}});
    if(path==='/api/v1/intake/reports') { creates++; if(creates===1) throw new Error('lost response'); return ok({id:'report-id'}); }
    if(path==='/api/v1/intake/reports/report-id/handoff') return ok({});
    if(path.startsWith('/api/v1/intake/queue')) return ok({items:[{id:'report-id',handed_off_at:'2026-01-01T00:00:00Z'}],nextCursor:null});
    if(path==='/api/v1/intake/reports/report-id') return ok({applicant_name:'<img src=x onerror=alert(1)>',resolved_at:null});
    if(path==='/api/v1/intake/reports/report-id/create-search') return ok({searchId:'search-id'});
    throw new Error(`Unexpected path ${path}`);
  };
  try {
    await import('../../infrastructure/lan-test/training-ui/app.mjs');
    const el=id=>window.document.getElementById(id);
    const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
    el('login').elements.login.value='synthetic@example.invalid'; el('login').elements.password.value='synthetic-password';
    el('login').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})); await tick();
    assert.equal(el('work').hidden,false); assert.equal(el('login').elements.password.value,'');
    el('report').elements.applicantName.value='Synthetic';
    el('report').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})); await tick();
    assert.match(el('message').textContent,/Нет подтверждения/);
    assert.equal(el('report').elements.applicantName.disabled,true);
    el('report').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})); await tick();
    const requests=calls.filter(x=>x.path==='/api/v1/intake/reports');
    assert.equal(requests.length,2); assert.equal(requests[0].options.body,requests[1].options.body);
    assert.equal(requests[0].options.headers['Idempotency-Key'],requests[1].options.headers['Idempotency-Key']);
    assert.equal(JSON.parse(requests[0].options.body).applicantContact,null);
    el('handoff').click(); await tick(); assert.match(el('message').textContent,/SMS не отправлено/);
    el('refresh').click(); await tick(); el('queue').querySelector('button').click(); await tick();
    assert.match(el('fields').textContent,/<img/); assert.equal(el('fields').querySelector('img'),null);
    el('resolve').elements.title.value='Synthetic search';
    el('resolve').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})); await tick();
    assert.ok(calls.some(c=>c.path==='/api/v1/intake/reports/report-id/create-search'));
  } finally { dom.window.close(); delete globalThis.window; delete globalThis.document; delete globalThis.FormData; }
});
