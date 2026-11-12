import type * as t from '@/types';
import { ensureFreshBearer, refreshOn401 } from './refresh';
import { getApiBaseUrl, getServerApiUrl } from './url';
import { TERMS_NOT_ACCEPTED_CODE } from '@/constants';
import { describeApiError } from '@/utils';

/** Skew window: refresh proactively when the bearer is within this of expiry. */
const PROACTIVE_REFRESH_SKEW_MS = 30_000;

/**
 * Make an authenticated request to the LibreChat API.
 *
 * Centralises bearer freshness: refreshes proactively when `expiresAt` is
 * within {@link PROACTIVE_REFRESH_SKEW_MS} of now, persists any rotated
 * refresh token to the session, and retries the original request once on a
 * 401 (so a token that expired between the freshness check and the request
 * landing still recovers without bubbling the failure up to the caller).
 *
 * @throws {Error} If no session bearer is available even after a refresh
 *   attempt.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const initialToken = await ensureFreshBearer(PROACTIVE_REFRESH_SKEW_MS);
  if (!initialToken) {
    throw new Error('No admin session token available');
  }

  const url = `${getServerApiUrl()}${path}`;
  const buildInit = (token: string): RequestInit => ({
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
      Authorization: `Bearer ${token}`,
    },
  });

  const response = await fetch(url, buildInit(initialToken));
  if (response.status !== 401) {
    return response;
  }

  const refreshedToken = await refreshOn401();
  if (!refreshedToken) {
    return response;
  }
  return fetch(url, buildInit(refreshedToken));
}

/**
 * The message of a failed API response: the panel's wording of its stable
 * `code` (`describeApiError`: a missing principal, a version conflict, a
 * section the admin may not manage, …), else its `{ error }` or
 * `{ message }`, else `fallback` with the status. LibreChat's refusal until
 * the admin accepts its terms of service becomes `terms_not_accepted
 * <LibreChat URL>`, which the panel explains (with where to accept them)
 * instead of a bare 403.
 */
export async function apiErrorMessage(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as t.ApiErrorBody;
  return apiErrorBodyMessage(body, response.status, fallback);
}

/** `apiErrorMessage` for a reply whose body was already read. */
export function apiErrorBodyMessage(
  body: t.ApiErrorBody,
  status: number,
  fallback: string,
): string {
  if (body.code === TERMS_NOT_ACCEPTED_CODE) return `${TERMS_NOT_ACCEPTED_CODE} ${getApiBaseUrl()}`;
  return describeApiError(body) ?? body.error ?? body.message ?? `${fallback}: ${status}`;
}

/** Throws the message of a failed API response (see `apiErrorMessage`). */
export async function extractApiError(response: Response, fallback: string): Promise<never> {
  throw new Error(await apiErrorMessage(response, fallback));
}
