import { createServerOnlyFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
import type * as t from '@/types';
import { clearAdminSession, ensureFreshBearer, refreshOn401 } from './refresh';
import { getApiBaseUrl, getServerApiUrl } from './url';
import { SESSION_ERROR_HEADER, TERMS_NOT_ACCEPTED_CODE } from '@/constants';
import { describeApiError } from '@/utils';
import { useAppSession } from '../session';

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
export const apiFetch = createServerOnlyFn(
  async (path: string, init?: RequestInit): Promise<Response> => {
    try {
      return await fetchWithSession(path, init);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === 'OPENID_SESSION_ENDED' ||
          error.message === 'AUTH_SESSION_CHECK_UNAVAILABLE')
      ) {
        setResponseHeader(SESSION_ERROR_HEADER, error.message);
      }
      throw error;
    }
  },
);

async function fetchWithSession(path: string, init?: RequestInit): Promise<Response> {
  const initialToken = await ensureFreshBearer(PROACTIVE_REFRESH_SKEW_MS);
  if (!initialToken) {
    throw new Error('OPENID_SESSION_ENDED');
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
  const retried = await fetch(url, buildInit(refreshedToken));
  if (retried.status === 401) {
    await clearAdminSession(await useAppSession());
    throw new Error('OPENID_SESSION_ENDED');
  }
  return retried;
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
