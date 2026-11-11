import { TrainingApi, ReportAttempt, ApiError } from './api.mjs';
const api = new TrainingApi();
const $ = id => document.getElementById(id);
let attempt = null, reportId = null, selectedId = null, cursor = null, busy = false, handedOff = false;
window.addEventListener('beforeunload', event => {
  if (attempt && !handedOff) { event.preventDefault(); event.returnValue = ''; }
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
function resetSession() {
  api.token = null; attempt = null; reportId = selectedId = cursor = null; handedOff = false;
  $('work').hidden = true; $('login-section').hidden = false; $('login').reset(); $('report').reset(); $('resolve').reset();
  for (const el of $('report').elements) el.disabled = false;
  $('created').textContent = ''; $('handoff').hidden = true; $('new-report').hidden = true; $('create').textContent = 'Создать обращение'; $('detail').hidden = true; $('queue').replaceChildren(); $('more').hidden = true;
}
$('login').addEventListener('submit', e => { e.preventDefault(); const node = e.currentTarget; run(async () => {
  const form = new FormData(node); const user = await api.login(form.get('login'),form.get('password'));
  node.reset(); $('identity').textContent = `Вы вошли: ${user.name}`; $('login-section').hidden = true; $('work').hidden = false;
  message('Вход выполнен. Доступ к функциям проверяется сервером.');
}); });
$('logout').addEventListener('click', () => run(async () => {
  if (attempt && !handedOff && !window.confirm('Обращение не передано или ответ неизвестен. При выходе повторный запрос будет потерян. Выйти?')) return;
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
    const result = await attempt.create(api); reportId = result.id;
    $('created').textContent = `Обращение создано: ${result.id}`; $('handoff').hidden = false; $('create').disabled = true;
    message('Обращение создано; регистратору ещё не передано.');
  } catch (error) {
    if (error instanceof ApiError && [400,403].includes(error.status)) {
      attempt = null; for (const el of node.elements) el.disabled = false; $('create').textContent = 'Создать обращение';
    }
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
