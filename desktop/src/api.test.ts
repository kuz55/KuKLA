// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { getSessionToken } from './sessionToken.js';

vi.mock('./sessionToken.js', () => ({ getSessionToken: vi.fn() }));

const mockGetSessionToken = vi.mocked(getSessionToken);
const mockFetch = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', mockFetch);
  mockFetch.mockResolvedValue({
    ok: true,
    statusText: 'OK',
    json: async () => ({ token: 'response-token' }),
  } as Response);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API session-token handling', () => {
  it('does not access the credential store for public authentication requests', async () => {
    await api('/auth/login', { method: 'POST', body: JSON.stringify({ login: 'test' }) });

    expect(mockGetSessionToken).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(expect.stringMatching(/\/auth\/login$/), expect.objectContaining({
      headers: { 'Content-Type': 'application/json' },
    }));
  });

  it('adds the native/browser session token to protected requests', async () => {
    mockGetSessionToken.mockResolvedValue('session-token');

    await api('/me');

    expect(mockGetSessionToken).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(expect.stringMatching(/\/me$/), expect.objectContaining({
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer session-token',
      },
    }));
  });
});
