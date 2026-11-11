// Training UI only. Tokens and retry state are held in memory, never in storage.
export class ApiError extends Error {
  constructor(status) { super('Request failed'); this.status = status; }
}
export class TrainingApi {
  constructor(fetcher = globalThis.fetch) { this.fetcher = fetcher; this.token = null; }
  async call(path, { method = 'GET', body, headers = {} } = {}) {
    const response = await this.fetcher(path, {
      method, cache: 'no-store', credentials: 'omit',
      headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new ApiError(response.status);
    return response.json();
  }
  async login(login, password) {
    const result = await this.call('/api/v1/auth/login', { method: 'POST', body: { login, password } });
    this.token = result.token; return result.user;
  }
  async logout() {
    try { await this.call('/api/v1/auth/logout', { method: 'POST' }); }
    finally { this.token = null; }
  }
}
export class ReportAttempt {
  constructor(data, key) { this.data = Object.freeze({ ...data }); this.key = key; }
  create(api) { return api.call('/api/v1/intake/reports', { method: 'POST', body: this.data, headers: { 'Idempotency-Key': this.key } }); }
}
