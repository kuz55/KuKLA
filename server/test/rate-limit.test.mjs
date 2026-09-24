import test from 'node:test';
import assert from 'node:assert/strict';

const base = process.env.KUKLA_TEST_URL ?? 'http://127.0.0.1:8080';

const postLogin = async (login, password) =>
  fetch(`${base}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password }),
  });

// Один детерминированный кейс вместо двух: оба прежних кейса делили один
// счётчик лимита по IP, а node:test не гарантирует порядок выполнения кейсов,
// из-за чего прогон был недетерминированным. Здесь порядок фиксирован:
// 6 запросов (5 в лимите + 1 сверх), затем проверка тела 429-ответа.
test('login rate limit: 5 attempts pass, 6th returns 429 with generic body', async () => {
  const email = `ratelimit-${Date.now()}@kukla.local`;
  const results = [];
  for (let i = 0; i < 6; i++) {
    results.push(await postLogin(email, 'wrong-pass-123456'));
  }
  const statuses = results.map((r) => r.status);

  // Первые 5 — 401 (неверный пароль), но не 429: лимит их пропускает.
  for (let i = 0; i < 5; i++) {
    assert.equal(statuses[i], 401, `attempt ${i + 1} should be 401, got ${statuses[i]}`);
  }
  // 6-я — 429: отклонена до проверки пароля, это и есть защита от подбора.
  assert.equal(statuses[5], 429, `6th attempt should be 429, got ${statuses[5]}`);

  // Заголовки лимита присутствуют и информативны.
  assert.ok(results[5].headers.get('x-ratelimit-limit'), 'x-ratelimit-limit header missing');
  assert.ok(results[5].headers.get('retry-after'), 'retry-after header missing');

  // Глобальный error handler приложения нормализует ошибку плагина до
  // { error, message }, не раскрывая существование пользователя.
  const body = await results[5].json();
  assert.equal(body.error, 'ERROR');
  assert.match(body.message, /^Rate limit exceeded/);
});