// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { clearSessionToken, getSessionToken, setSessionToken } from './sessionToken.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);
const mockIsTauri = vi.mocked(isTauri);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mockIsTauri.mockReturnValue(false);
});

describe('session token storage', () => {
  it('uses local storage only in browser mode', async () => {
    expect(await getSessionToken()).toBeNull();
    await setSessionToken('browser-token');
    expect(await getSessionToken()).toBe('browser-token');
    await clearSessionToken();
    expect(localStorage.getItem('kukla_token')).toBeNull();
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('reads and writes Tauri tokens through the native credential store', async () => {
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockResolvedValueOnce('native-token');

    expect(await getSessionToken()).toBe('native-token');
    await setSessionToken('replacement-token');
    await clearSessionToken();

    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'get_session_token');
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'set_session_token', { token: 'replacement-token' });
    expect(mockInvoke).toHaveBeenNthCalledWith(3, 'clear_session_token');
    expect(localStorage.getItem('kukla_token')).toBeNull();
  });

  it('moves a legacy WebView token to the native store and removes the plaintext copy', async () => {
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockResolvedValueOnce(null).mockResolvedValueOnce(undefined);
    localStorage.setItem('kukla_token', 'legacy-token');

    expect(await getSessionToken()).toBe('legacy-token');
    expect(mockInvoke).toHaveBeenNthCalledWith(1, 'get_session_token');
    expect(mockInvoke).toHaveBeenNthCalledWith(2, 'set_session_token', { token: 'legacy-token' });
    expect(localStorage.getItem('kukla_token')).toBeNull();
  });

  it('discards a legacy plaintext token if the native store is unavailable', async () => {
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockRejectedValue(new Error('secure store unavailable'));
    localStorage.setItem('kukla_token', 'legacy-token');

    await expect(getSessionToken()).rejects.toThrow('secure store unavailable');
    expect(localStorage.getItem('kukla_token')).toBeNull();
  });

  it('never falls back to local storage when a native credential write fails', async () => {
    mockIsTauri.mockReturnValue(true);
    mockInvoke.mockRejectedValue(new Error('secure store unavailable'));

    await expect(setSessionToken('new-token')).rejects.toThrow('secure store unavailable');
    expect(localStorage.getItem('kukla_token')).toBeNull();
  });
});
