import { z } from 'zod';
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
  if (!response.ok) return undefined;
  const parsed = refreshResponseSchema.safeParse(await response.json());
  return parsed.success ? parsed.data : undefined;
}

/** Renews a password session through LibreChat's cookie-based `POST /api/auth/refresh`. */
async function refreshPasswordSession(
  refreshToken: string,
): Promise<RefreshedTokenset | undefined> {
  const response = await fetch(`${getServerApiUrl()}/api/auth/refresh`, {
    method: 'POST',
    headers: { Cookie: `refreshToken=${refreshToken}`, ...tenantHeaders() },
  });
  if (!response.ok) return undefined;
  const parsed = refreshResponseSchema.safeParse(await response.json());
  if (!parsed.success) return undefined;
  return { token: parsed.data.token, refreshToken: extractRefreshTokenCookie(response) };
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
 * Returns `undefined` on any network or schema failure — callers decide
 * whether to clear the session.
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
    return undefined;
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
 * session and returns the bearer the caller should use. Returns `undefined`
 * when no token is available and refresh either failed or is impossible.
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
    return token;
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
 * of `expiresAt`. Returns the new bearer or `undefined` if refresh failed.
 */
export async function refreshOn401(): Promise<string | undefined> {
  const session = await useAppSession();
  const { refreshToken, tokenProvider, user } = session.data;
  if (!refreshToken) return undefined;

  const refreshed = await refreshAdminTokenDeduped(refreshToken, tokenProvider, user?.id);
  if (!refreshed) return undefined;

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
