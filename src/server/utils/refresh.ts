import { z } from 'zod';
import { TWO_FACTOR_ENROLLMENT_REQUIRED_CODE } from 'librechat-data-provider';
import type * as t from '@/types';
import { readTenantHeader, tenantHeaders } from './tenant';
import { SSO_PROVIDERS } from '@/constants';
import { useAppSession } from '../session';
import { getServerApiUrl } from './url';

const refreshResponseSchema = z.object({
  token: z.string(),
  refreshToken: z.string().optional(),
  expiresAt: z.number().optional(),
});

export interface RefreshedTokenset {
  token: string;
  refreshToken?: string;
  expiresAt?: number;
}

function extractRefreshTokenCookie(response: Response): string | undefined {
  const setCookies = response.headers.getSetCookie();
  for (const cookie of setCookies) {
    const match = cookie.match(/^refreshToken=([^;]+)/);
    if (match) return match[1];
  }
  return undefined;
}

/** A refused renewal ends the session; an unavailable check leaves it ready for Retry. */
async function readRefreshResponse(response: Response): Promise<RefreshedTokenset | undefined> {
  const body = await response.json().catch(() => undefined);
  if (!response.ok) {
    const errorBody = body as t.AuthErrorBody | undefined;
    if (
      ![400, 401, 403].includes(response.status) ||
      errorBody?.code === 'AUTH_SESSION_CHECK_UNAVAILABLE' ||
      errorBody?.error_code === 'AUTH_SESSION_CHECK_UNAVAILABLE'
    ) {
      throw new Error('AUTH_SESSION_CHECK_UNAVAILABLE');
    }
    return undefined;
  }
  if ((body as t.AuthErrorBody | undefined)?.code === TWO_FACTOR_ENROLLMENT_REQUIRED_CODE) {
    return undefined;
  }
  const parsed = refreshResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error('AUTH_SESSION_CHECK_UNAVAILABLE');
  return parsed.data;
}

export async function clearAdminSession(session: t.SessionManager): Promise<void> {
  await session.update({
    token: undefined,
    user: undefined,
    refreshToken: undefined,
    tokenProvider: undefined,
    expiresAt: undefined,
    lastVerified: undefined,
    lastActivity: undefined,
    codeVerifier: undefined,
    ssoProvider: undefined,
    ssoRedirect: undefined,
  });
}

/**
 * Renews an SSO session through LibreChat's body-based
 * `POST /api/admin/oauth/refresh`, which returns the rotated refresh token
 * (Google rotates them) for the caller to keep.
 */
async function refreshSsoSession(
  refreshToken: string,
  provider: t.SsoProviderId,
  userId: string | undefined,
): Promise<RefreshedTokenset | undefined> {
  if (!userId) {
    console.warn(`[refreshAdminToken] ${provider} refresh requires user id; aborting`);
    return undefined;
  }
  const response = await fetch(`${getServerApiUrl()}/api/admin/oauth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...tenantHeaders() },
    body: JSON.stringify({ refresh_token: refreshToken, user_id: userId, provider }),
  });
  return readRefreshResponse(response);
}

/** Renews a password session through LibreChat's cookie-based `POST /api/auth/refresh`. */
async function refreshPasswordSession(
  refreshToken: string,
): Promise<RefreshedTokenset | undefined> {
  const url = `${getServerApiUrl()}/api/auth/refresh`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Cookie: `refreshToken=${refreshToken}`, ...tenantHeaders() },
    redirect: 'manual',
  });
  const location = response.headers.get('location');
  if (response.status === 302 && location) {
    const target = new URL(location, url);
    const rootLogin = new URL('/login', url);
    const baseLogin = new URL(`${getServerApiUrl().replace(/\/$/, '')}/login`);
    if (target.href === rootLogin.href || target.href === baseLogin.href) return undefined;
  }
  const refreshed = await readRefreshResponse(response);
  if (!refreshed) return undefined;
  return { token: refreshed.token, refreshToken: extractRefreshTokenCookie(response) };
}

/**
 * Calls the LibreChat refresh endpoint matching the session's token provider.
 *
 * - SSO providers LibreChat renews (`SSO_PROVIDERS[id].refreshable`: OpenID,
 *   Google) hit `/api/admin/oauth/refresh` (body-based, with `provider`).
 * - Other SSO providers (SAML) have no refresh path: the session ends with
 *   its bearer, never on the password route.
 * - `librechat` sessions hit the cookie-based `/api/auth/refresh`.
 *
 * Both forward the deployment's `X-Tenant-Id` header (`tenantHeaders`) so the
 * backend's `preAuthTenantMiddleware` scopes the user lookup correctly.
 *
 * Returns `undefined` when renewal is refused or unavailable for this provider.
 * Throws on temporary failures so callers keep the credentials for Retry.
 */
export async function refreshAdminToken(
  refreshToken: string,
  tokenProvider: t.SessionData['tokenProvider'],
  userId: string | undefined,
): Promise<RefreshedTokenset | undefined> {
  try {
    if (!tokenProvider || tokenProvider === 'librechat') {
      return await refreshPasswordSession(refreshToken);
    }
    if (!SSO_PROVIDERS[tokenProvider].refreshable) return undefined;
    return await refreshSsoSession(refreshToken, tokenProvider, userId);
  } catch (error) {
    console.warn('[refreshAdminToken] Token refresh request failed:', error);
    throw new Error('AUTH_SESSION_CHECK_UNAVAILABLE');
  }
}

const inFlight = new Map<string, Promise<RefreshedTokenset | undefined>>();

/**
 * Build the dedupe key from every discriminator that the upstream refresh
 * actually depends on: token provider, user identity, tenant header, and the
 * refresh token itself. Keying on `refreshToken` alone would conflate two
 * concurrent calls that happen to share a token string but differ by user or
 * tenant — the second caller would receive the first caller's bearer and
 * persist it into the wrong session.
 */
function buildDedupeKey(
  refreshToken: string,
  tokenProvider: t.SessionData['tokenProvider'],
  userId: string | undefined,
  tenantId: string | undefined,
): string {
  return [tokenProvider ?? '', userId ?? '', tenantId ?? '', refreshToken].join('\u0000');
}

/**
 * Module-scoped dedupe so two concurrent React Query subscribers in a single
 * BFF process don't both consume a rotating refresh token (which would
 * invalidate one of them).
 */
export function refreshAdminTokenDeduped(
  refreshToken: string,
  tokenProvider: t.SessionData['tokenProvider'],
  userId: string | undefined,
): Promise<RefreshedTokenset | undefined> {
  const key = buildDedupeKey(refreshToken, tokenProvider, userId, readTenantHeader());
  const existing = inFlight.get(key);
  if (existing) return existing;
  const pending = refreshAdminToken(refreshToken, tokenProvider, userId).finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, pending);
  return pending;
}

/**
 * Refresh the bearer if the session is missing one or its `expiresAt` falls
 * within `skewMs` of now. Persists the rotated refresh token (if any) to the
 * session and returns the bearer the caller should use. A refused renewal
 * clears the session; a temporary failure keeps its credentials and throws.
 */
export async function ensureFreshBearer(skewMs: number): Promise<string | undefined> {
  const session = await useAppSession();
  const { token, expiresAt, refreshToken, tokenProvider, user } = session.data;

  if (!refreshToken) {
    return token;
  }

  const now = Date.now();
  const needsRefresh = !token || (typeof expiresAt === 'number' && expiresAt - now <= skewMs);
  if (!needsRefresh) {
    return token;
  }

  const refreshed = await refreshAdminTokenDeduped(refreshToken, tokenProvider, user?.id);
  if (!refreshed) {
    await clearAdminSession(session);
    throw new Error('OPENID_SESSION_ENDED');
  }

  await session.update({
    token: refreshed.token,
    refreshToken: refreshed.refreshToken ?? refreshToken,
    expiresAt: refreshed.expiresAt,
    lastVerified: now,
    lastActivity: now,
  });
  return refreshed.token;
}

/**
 * After a 401 from a downstream admin call, force a refresh attempt regardless
 * of `expiresAt`. A refused or impossible renewal clears the session.
 * A temporary failure keeps its credentials and throws.
 */
export async function refreshOn401(): Promise<string> {
  const session = await useAppSession();
  const { refreshToken, tokenProvider, user } = session.data;
  const refreshed = refreshToken
    ? await refreshAdminTokenDeduped(refreshToken, tokenProvider, user?.id)
    : undefined;
  if (!refreshed) {
    await clearAdminSession(session);
    throw new Error('OPENID_SESSION_ENDED');
  }

  const now = Date.now();
  await session.update({
    token: refreshed.token,
    refreshToken: refreshed.refreshToken ?? refreshToken,
    expiresAt: refreshed.expiresAt,
    lastVerified: now,
    lastActivity: now,
  });
  return refreshed.token;
}
