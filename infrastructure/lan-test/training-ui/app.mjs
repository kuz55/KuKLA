import { TrainingApi, ReportAttempt, ApiError } from './api.mjs';
import { setupGroups } from './groups.mjs';
import { setupReview } from './review.mjs';
const api = new TrainingApi();
const $ = id => document.getElementById(id);
let attempt = null, reportId = null, selectedId = null, cursor = null, leadCursor = null, busy = false, handedOff = false, reportUncertain = false;
let groups, review;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function uuid(value) {
  const id = String(value ?? '').trim();
  if (!uuidPattern.test(id)) throw new ApiError(400);
  return id;
}
window.addEventListener('beforeunload', event => {
  if ((attempt && !handedOff) || groups?.pending() || review?.pending()) { event.preventDefault(); event.returnValue = ''; }
});
const keys = ['applicantName','applicantContact','missingPersonName','lastSeenTime','lastSeenPlace','situation'];
const labels = { applicant_name:'Имя заявителя', applicant_contact:'Контакт заявителя', missing_person_name:'Имя пропавшего', last_seen_time:'Когда видели', last_seen_place:'Где видели', situation:'Описание', search_id:'Связанный поиск', resolution_reason:'Причина закрытия' };
function message(text) { $('message').textContent = text; }
function explain(error) {
  if (!(error instanceof ApiError)) return 'Нет подтверждения сервера. Проверьте связь; действие могло выполниться. Не создавайте дубликат.';
  if (error.status === 401) return 'Сессия недействительна или истекла. Войдите снова.';
  if (error.status === 403) return 'Недостаточно прав для этого действия.';
  if (error.status === 404) return 'Запись недоступна или не найдена.';
  if (error.status === 409) return 'Действие конфликтует с текущим состоянием. Обновите карточку.';
  if (error.status === 400) return 'Проверьте введённые данные.';
  return 'Сервер не подтвердил действие. Оно могло выполниться; проверьте состояние перед повтором.';
}
async function run(action) {
  if (busy) return; busy = true;
  try { await action(); } catch (error) { message(explain(error)); }
  finally { busy = false; }
}
groups=setupGroups({api,run,uuid,message});
review=setupReview({api,run,uuid,message});
function resetSession() {
  groups.reset(); review.reset();
  api.token = null; attempt = null; reportId = selectedId = cursor = leadCursor = null; handedOff = false; reportUncertain = false;
  $('claim-form').reset(); $('propose-form').reset(); $('propose-button').disabled = false; $('new-proposal').hidden = true;
  $('claim-result').textContent = ''; $('proposal-result').textContent = ''; $('lead-result').textContent = ''; $('lead-list').replaceChildren(); $('lead-more').hidden = true; $('user-id').textContent = '';
  $('work').hidden = true; $('login-section').hidden = false; $('login').reset(); $('report').reset(); $('resolve').reset();
  for (const el of $('report').elements) el.disabled = false;
  $('created').textContent = ''; $('handoff').hidden = true; $('new-report').hidden = true; $('create').textContent = 'Создать обращение'; $('detail').hidden = true; $('queue').replaceChildren(); $('more').hidden = true;
}
$('login').addEventListener('submit', e => { e.preventDefault(); const node = e.currentTarget; run(async () => {
  const form = new FormData(node); const user = await api.login(form.get('login'),form.get('password'));
  node.reset(); $('identity').textContent = `Вы вошли: ${user.name}`; $('user-id').textContent = `Ваш учебный ID: ${user.id}`; $('login-section').hidden = true; $('work').hidden = false;
  message('Вход выполнен. Доступ к функциям проверяется сервером.');
}); });
$('logout').addEventListener('click', () => run(async () => {
  if (((attempt && !handedOff) || groups.pending() || review.pending()) && !window.confirm('Есть запрос с неподтверждённым ответом или непереданное обращение. При выходе ключ повтора будет потерян. Выйти?')) return;
  try { await api.logout(); resetSession(); message('Выход подтверждён сервером.'); }
  catch { resetSession(); message('Локальный выход выполнен; отзыв сессии сервером не подтверждён.'); }
}));
$('report').addEventListener('submit', e => { e.preventDefault(); const node = e.currentTarget; run(async () => {
  if (reportId) { message('Обращение уже создано. Передайте его регистратору.'); return; }
  if (!attempt) {
    const form = new FormData(node); const data = Object.fromEntries(keys.map(key => [key, String(form.get(key) ?? '').trim() || null]));
    attempt = new ReportAttempt(data,crypto.randomUUID());
    for (const el of node.elements) if (el.name) el.disabled = true;
    $('create').textContent = 'Повторить создание';
  }
  try {
    const result = await attempt.create(api); reportId = result.id; reportUncertain = false;
    $('created').textContent = `Обращение создано: ${result.id}`; $('handoff').hidden = false; $('create').disabled = true;
    message('Обращение создано; регистратору ещё не передано.');
  } catch (error) {
    if (!reportUncertain && error instanceof ApiError && [400,403].includes(error.status)) {
      attempt = null; for (const el of node.elements) el.disabled = false; $('create').textContent = 'Создать обращение';
    } else if (!(error instanceof ApiError) || error.status >= 500 || error.status === 429) reportUncertain = true;
    throw error;
  }
}); });
$('handoff').addEventListener('click', () => run(async () => {
  await api.call(`/api/v1/intake/reports/${reportId}/handoff`, {method:'POST'});
  handedOff = true; $('handoff').hidden = true; $('new-report').hidden = false; message('Передача регистратору подтверждена. SMS не отправлено.');
}));
$('new-report').addEventListener('click', () => {
  if (busy || !handedOff) return;
  attempt = null; reportId = null; handedOff = false; $('report').reset();
  for (const el of $('report').elements) el.disabled = false;
  $('create').textContent = 'Создать обращение'; $('created').textContent = ''; $('new-report').hidden = true;
  message('Можно записать новое учебное обращение.');
});
async function queue(after) {
  const result = await api.call(`/api/v1/intake/queue?limit=50${after ? `&after=${encodeURIComponent(after)}` : ''}`);
  if (!after) $('queue').replaceChildren();
  for (const item of result.items) {
    const li = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.textContent = `Открыть ${item.id} — ${new Date(item.handed_off_at).toLocaleString('ru-RU')}`;
    button.addEventListener('click', () => run(() => detail(item.id))); li.append(button); $('queue').append(li);
  }
  cursor = result.nextCursor; $('more').hidden = !cursor; message('Очередь обновлена.');
}
async function detail(id) {
  const item = await api.call(`/api/v1/intake/reports/${id}`); selectedId = id;
  $('fields').replaceChildren();
  for (const [key,label] of Object.entries(labels)) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = item[key] ?? 'Неизвестно'; $('fields').append(dt,dd);
  }
  $('detail').hidden = false; $('resolve').hidden = Boolean(item.resolved_at);
  message(item.resolved_at ? 'Обращение уже обработано.' : 'Обращение открыто.');
}
$('refresh').addEventListener('click', () => run(() => queue(null)));
$('more').addEventListener('click', () => run(() => queue(cursor)));
$('resolve').addEventListener('submit', e => { e.preventDefault(); run(async () => {
  const id = selectedId, title = String(new FormData(e.currentTarget).get('title')).trim();
  try {
    const result = await api.call(`/api/v1/intake/reports/${id}/create-search`, {method:'POST', body:{title}});
    await detail(id); message(`Поиск создан: ${result.searchId}. Дальнейшие экраны ещё не реализованы.`);
  } catch (error) {
    // This operation has no retry receipt. Never silently retry it after an
    // ambiguous response: the registrar must check the report's state first.
    $('resolve').hidden = true;
    message(`${explain(error)} Откройте карточку заново и проверьте, создан ли поиск.`);
  }
}); });

$('claim-form').addEventListener('submit', event => {
  event.preventDefault(); const node=event.currentTarget;
  run(async () => {
    const id=uuid(new FormData(node).get('searchId'));
    $('claim-result').textContent='';
    try {
      const result=await api.call(`/api/v1/coordination/searches/${id}/claim`,{method:'POST'});
      $('claim-result').textContent=`Вы приняты основным координатором: ${result.primaryId}.`;
      message('Координатор подтверждён сервером. Повторный запрос не создаёт новое назначение.');
    } catch (error) {
      if (error instanceof ApiError && error.status===409 && uuidPattern.test(error.body?.primaryId ?? '')) {
        $('claim-result').textContent=`Поиск уже принял другой координатор: ${error.body.primaryId}.`;
        message('Поиск уже занят; вы не назначены координатором.');
      } else throw error;
    }
  });
});
$('propose-form').addEventListener('submit', event => {
  event.preventDefault(); const node=event.currentTarget;
  run(async () => {
    const form=new FormData(node), search=uuid(form.get('searchId')), candidate=uuid(form.get('candidateId'));
    $('proposal-result').textContent='';
    // Proposal creation has no retry receipt. On an uncertain outcome do not
    // issue a second proposal until a person checks with the candidate.
    $('propose-button').disabled=true;
    try {
      const result=await api.call(`/api/v1/field-lead/searches/${search}/proposals`,{method:'POST',body:{candidateId:candidate}});
      $('proposal-result').textContent=`Предложение создано: ${result.proposalId}. Ожидается ответ кандидата.`;
      $('new-proposal').hidden=false;
      message('Назначение ещё не принято. Кандидат должен открыть приглашение.');
    } catch(error) {
      if (error instanceof ApiError && [400,401,403,404].includes(error.status)) $('propose-button').disabled=false;
      else $('proposal-result').textContent='Не повторяйте назначение вслепую: проверьте у кандидата список приглашений и состояние поиска.';
      throw error;
    }
  });
});
$('new-proposal').addEventListener('click',()=>{
  if (busy || $('new-proposal').hidden) return;
  $('propose-form').reset(); $('propose-button').disabled=false; $('new-proposal').hidden=true; $('proposal-result').textContent='';
});
async function leadNotifications(after) {
  const result=await api.call(`/api/v1/field-lead/notifications?limit=50${after ? `&after=${encodeURIComponent(after)}` : ''}`);
  if (!after) $('lead-list').replaceChildren();
  for (const item of result.items.filter(item=>item.kind==='PROPOSED')) {
    const search=uuid(item.search_id), proposal=uuid(item.proposal_id);
    const li=document.createElement('li'), text=document.createElement('span'), open=document.createElement('button');
    text.textContent=`Поиск ${search}; приглашение ${proposal}. `;
    open.type='button'; open.textContent='Проверить и ответить';
    open.addEventListener('click',()=>run(async()=>{
      const pending=await api.call(`/api/v1/field-lead/searches/${search}/proposals/mine`);
      if (pending.id!==proposal) { $('lead-result').textContent='Это приглашение устарело; обновите список.'; return; }
      $('lead-result').textContent='Приглашение ожидает решения.';
      const accept=document.createElement('button'); accept.type='button'; accept.textContent='Принять назначение';
      accept.addEventListener('click',()=>run(async()=>{
        await api.call(`/api/v1/field-lead/searches/${search}/proposals/accept`,{method:'POST',body:{proposalId:proposal}});
        accept.disabled=true;
        $('lead-result').textContent='Принятие подтверждено сервером. Повтор является исторической квитанцией, а не проверкой текущего назначения.';
      }));
      li.append(accept); open.disabled=true;
    }));
    li.append(text,open); $('lead-list').append(li);
  }
  leadCursor=result.nextCursor; $('lead-more').hidden=!leadCursor;
  message('Список приглашений обновлён. Старые уведомления могут быть неактуальны.');
}
$('lead-notifications').addEventListener('click',()=>run(()=>leadNotifications(null)));
$('lead-more').addEventListener('click',()=>run(()=>leadNotifications(leadCursor)));
