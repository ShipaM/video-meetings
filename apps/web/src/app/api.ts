import { clearAccessToken, getAccessToken } from './auth-storage';
import { API_URL } from './constants';

/**
 * Calls the API (`path` starts with `/`) with the stored access token. Resolves to `null` when
 * there is no token or the API answers `401`: the token is then cleared, which sends the user to
 * the login page. A network error rejects, as with `fetch`.
 */
export async function authorizedFetch(
  path: string,
  init: RequestInit = {},
): Promise<Response | null> {
  const token = getAccessToken();
  if (!token) {
    clearAccessToken();
    return null;
  }
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  const response = await fetch(`${API_URL}${path}`, { ...init, headers });
  if (response.status === 401) {
    clearAccessToken();
    return null;
  }
  return response;
}

/** The API's reason for an error: a string, or the first entry of a validation list. */
export async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const { message } = (await response.json()) as { message?: unknown };
    const first: unknown = Array.isArray(message) ? message[0] : message;
    return typeof first === 'string' && first ? first : null;
  } catch {
    return null;
  }
}
