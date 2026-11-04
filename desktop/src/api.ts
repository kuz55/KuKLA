const API = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? '/api/v1' : 'http://localhost:18080/api/v1');

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('kukla_token');
  const response = await fetch(API + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({ message: response.statusText }));
    throw new Error(body.message ?? response.statusText);
  }

  return response.json() as Promise<T>;
}
