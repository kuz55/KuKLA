import { invoke, isTauri } from '@tauri-apps/api/core';

const TOKEN_KEY = 'kukla_token';

export async function getSessionToken(): Promise<string | null> {
  if (!isTauri()) return localStorage.getItem(TOKEN_KEY);

  const legacyToken = localStorage.getItem(TOKEN_KEY);
  try {
    const token = await invoke<string | null>('get_session_token');
    if (token) {
      localStorage.removeItem(TOKEN_KEY);
      return token;
    }

    if (!legacyToken) {
      localStorage.removeItem(TOKEN_KEY);
      return null;
    }

    try {
      await invoke('set_session_token', { token: legacyToken });
      return legacyToken;
    } finally {
      // Never leave the pre-keyring token in the WebView's persistent storage.
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch (error) {
    localStorage.removeItem(TOKEN_KEY);
    throw error;
  }
}

export async function setSessionToken(token: string): Promise<void> {
  if (!isTauri()) {
    localStorage.setItem(TOKEN_KEY, token);
    return;
  }

  try {
    await invoke('set_session_token', { token });
  } finally {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export async function clearSessionToken(): Promise<void> {
  if (!isTauri()) {
    localStorage.removeItem(TOKEN_KEY);
    return;
  }

  try {
    await invoke('clear_session_token');
  } finally {
    localStorage.removeItem(TOKEN_KEY);
  }
}
