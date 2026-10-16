import { useSyncExternalStore } from 'react';
import { ACCESS_TOKEN_KEY } from './constants';

const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('storage', listener); // other tabs logging in or out
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', listener);
  };
}

export function getAccessToken(): string | null {
  try {
    return localStorage.getItem(ACCESS_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setAccessToken(token: string) {
  localStorage.setItem(ACCESS_TOKEN_KEY, token);
  notify();
}

export function clearAccessToken() {
  try {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
  } catch {
    // Storage can be unavailable; there is nothing to clear then.
  }
  notify();
}

/** `undefined` while rendering on the server / hydrating, then the token or `null`. */
export function useAccessToken(): string | null | undefined {
  return useSyncExternalStore(subscribe, getAccessToken, () => undefined);
}

/** Reads the e-mail claim from the JWT payload (display only; the API verifies the token). */
export function getEmailFromToken(token: string): string | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const { email } = JSON.parse(atob(payload)) as { email?: unknown };
    return typeof email === 'string' ? email : null;
  } catch {
    return null;
  }
}
