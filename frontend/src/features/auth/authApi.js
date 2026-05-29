/**
 * Auth API client.
 *
 * All requests use `credentials: 'include'` so the httpOnly session cookie
 * the backend sets is sent back. The cookie itself is opaque and unreadable
 * from JS — no secrets ever reach the bundle.
 */

import { API_ORIGIN } from '../../config';

const BASE = `${API_ORIGIN}/api/auth`;

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return null;

  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }

  if (!res.ok) {
    const message =
      (data && (data.detail?.message || data.detail || data.message)) ||
      `Request failed (${res.status})`;
    throw new Error(typeof message === 'string' ? message : 'Request failed');
  }
  return data;
}

/** Returns the current user, or null if not authenticated. */
export async function fetchMe() {
  try {
    return await request('/me');
  } catch {
    return null;
  }
}

export function signup({ username, password, name, email, institute }) {
  return request('/signup', {
    method: 'POST',
    body: { username, password, name, email, institute: institute || null },
  });
}

export function login({ username, password }) {
  return request('/login', { method: 'POST', body: { username, password } });
}

export function logout() {
  return request('/logout', { method: 'POST' });
}
