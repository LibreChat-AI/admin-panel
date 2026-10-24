import { z } from 'zod';
import crypto from 'crypto';
import { redirect } from '@tanstack/react-router';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';
import type * as t from '@/types';
import { getApiBaseUrl, getServerApiUrl } from './utils/url';
import { refreshAdminTokenDeduped } from './utils/refresh';
import { buildOAuthExchangePayload } from './utils/oauth';
import { useAppSession, getSessionConfig } from './session';

/** Extract a named cookie value from `set-cookie` response headers. */
function extractCookieValue(response: Response, name: string): string | undefined {
  const setCookies = response.headers.getSetCookie();
  const re = new RegExp(`^${name}=([^;]+)`);
  for (const cookie of setCookies) {
    const match = cookie.match(re);
    if (match) return match[1];
  }
  return undefined;
}

/** Returns the origin of ADMIN_PANEL_PUBLIC_URL when configured, giving deployments behind proxies that strip Origin and forward no proto/host metadata a deterministic override. */
function getConfiguredPublicOrigin(): string | undefined {
  const publicUrl = process.env.ADMIN_PANEL_PUBLIC_URL;
  if (!publicUrl) return undefined;
  try {
    const url = new URL(publicUrl);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.origin !== 'null') {
      return url.origin;
    }
  } catch {
    /* fall through to the warning */
  }
  console.warn('[getRequestOrigin] Ignoring malformed ADMIN_PANEL_PUBLIC_URL:', publicUrl);
  return undefined;
}

const DEFAULT_SCHEME_PORTS: Record<string, string> = { 'https:': ':443', 'http:': ':80' };

/** Returns the referer's origin only when its host matches the serving host, so a foreign referer (e.g. an IdP such as Azure EntraID's login.microsoftonline.com) can never be forwarded as the panel's own origin. `URL` strips the scheme's default port from the referer host, so an explicit default port on the serving authority (`example.com:443`) is stripped before comparing. */
function getSameHostRefererOrigin(host: string): string | undefined {
  const referer = getRequestHeader('referer');
  if (!referer) return undefined;
  try {
    const url = new URL(referer);
    const defaultPort = DEFAULT_SCHEME_PORTS[url.protocol] ?? '';
    const servingHost = host.toLowerCase();
    const normalizedHost =
      defaultPort && servingHost.endsWith(defaultPort)
        ? servingHost.slice(0, -defaultPort.length)
        : servingHost;
    return url.host.toLowerCase() === normalizedHost ? url.origin : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolves the admin panel's browser-visible origin for LibreChat's exchange-code
 * origin binding.
 *
 * Order: the configured `ADMIN_PANEL_PUBLIC_URL` origin, then the `origin` header,
 * then the first `x-forwarded-host` value (Host-rewriting proxies replace `host` with
 * the internal upstream authority) combined with the first `x-forwarded-proto` value.
 * When no forwarded proto is available, a same-host referer recovers the scheme for
 * HTTPS deployments whose proxy strips `Origin` without setting `x-forwarded-proto`.
 * A foreign referer is never used: it identifies whatever page or IdP initiated the
 * request, and forwarding it makes LibreChat reject the exchange code as expired even
 * though authentication succeeded.
 */
function getRequestOrigin(): string | undefined {
  const configuredOrigin = getConfiguredPublicOrigin();
  if (configuredOrigin) return configuredOrigin;

  const origin = getRequestHeader('origin');
  if (origin) return origin;

  const forwardedHost = getRequestHeader('x-forwarded-host');
  const host = forwardedHost?.split(',')[0]?.trim() || getRequestHeader('host');
  if (!host) return undefined;

  const forwardedProto = getRequestHeader('x-forwarded-proto');
  const proto = forwardedProto?.split(',')[0]?.trim();
  if (proto) return `${proto}://${host}`;

  return getSameHostRefererOrigin(host) ?? `http://${host}`;
}

export const adminLoginFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      email: z.string().email('Valid email address is required'),
      password: z.string().min(1, 'Password is required'),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const response = await fetch(`${getServerApiUrl()}/api/admin/login/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const responseData = await response.json();

      if (!response.ok) {
        switch (response.status) {
          case 403:
            return { error: true, message: 'You do not have admin privileges' };
          case 404:
            return { error: true, message: 'User not found' };
          case 422:
            return { error: true, message: responseData.message || 'Invalid credentials' };
          case 429:
            return { error: true, message: 'Too many login attempts. Please try again later' };
          default:
            return { error: true, message: responseData.message || 'Login failed' };
        }
      }

      const loginData = responseData as t.AdminLoginResponse;

      if (loginData.twoFAPending) {
        return {
          error: false,
          requires2FA: true,
          tempToken: loginData.tempToken,
        };
      }

      const now = Date.now();
      const session = await useAppSession();
      await session.update({
        user: loginData.user,
        token: loginData.token,
        refreshToken: extractCookieValue(response, 'refreshToken'),
        tokenProvider: 'librechat',
        lastVerified: now,
        lastActivity: now,
      });

      return { error: false, user: loginData.user };
    } catch (error) {
      console.error('Admin login error:', error);
      return { error: true, message: 'Login failed. Please check your connection and try again.' };
    }
  });

export const adminVerify2FAFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({
      tempToken: z.string().min(1, 'Temporary token is required'),
      totpCode: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
    }),
  )
  .handler(async ({ data }) => {
    try {
      const response = await fetch(`${getServerApiUrl()}/api/auth/2fa/verify-temp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tempToken: data.tempToken, token: data.totpCode }),
      });

      const responseData = await response.json();

      if (!response.ok) {
        if (response.status === 401) {
          const msg = typeof responseData.message === 'string' ? responseData.message : '';
          const isExpired = msg.toLowerCase().includes('expired');
          return {
            error: true,
            expired: isExpired,
            message: isExpired
              ? 'Session expired. Please log in again.'
              : 'Invalid verification code',
          };
        }
        return { error: true, message: responseData.message || '2FA verification failed' };
      }

      const verifyData = responseData as t.TwoFAVerifyResponse;
      const adminVerifyResponse = await fetch(`${getServerApiUrl()}/api/admin/verify`, {
        headers: { Authorization: `Bearer ${verifyData.token}` },
      });

      if (!adminVerifyResponse.ok) {
        if (adminVerifyResponse.status === 403) {
          return { error: true, message: 'You do not have admin privileges' };
        }
        if (adminVerifyResponse.status === 401) {
          return { error: true, message: 'Session is no longer valid' };
        }
        return { error: true, message: '2FA verification failed' };
      }

      const adminVerifyData = (await adminVerifyResponse.json()) as t.AdminVerifyResponse;

      const now = Date.now();
      const session = await useAppSession();
      await session.update({
        user: adminVerifyData.user,
        token: verifyData.token,
        refreshToken: extractCookieValue(response, 'refreshToken'),
        tokenProvider: 'librechat',
        lastVerified: now,
        lastActivity: now,
      });

      return { error: false, user: adminVerifyData.user };
    } catch (error) {
      console.error('2FA verification error:', error);
      return { error: true, message: 'Verification failed. Please try again.' };
    }
  });

const clearSession = async (session: Awaited<ReturnType<typeof useAppSession>>) => {
  await session.update({
    token: undefined,
    user: undefined,
    refreshToken: undefined,
    tokenProvider: undefined,
    expiresAt: undefined,
    lastVerified: undefined,
    lastActivity: undefined,
  });
};

export const verifyAdminTokenFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const session = await useAppSession();
    const { token, user, lastVerified, lastActivity, refreshToken, tokenProvider } = session.data;

    if (!token || !user) {
      return { valid: false, error: 'No session found' };
    }

    const now = Date.now();
    const sessionConfig = getSessionConfig();

    if (lastActivity && now - lastActivity > sessionConfig.idleTimeout) {
      await clearSession(session);
      return { valid: false, error: 'Session expired due to inactivity' };
    }

    const needsRevalidation =
      !lastVerified || now - lastVerified > sessionConfig.revalidationInterval;

    if (needsRevalidation) {
      try {
        const response = await fetch(`${getServerApiUrl()}/api/admin/verify`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          if (response.status === 403) {
            await clearSession(session);
            return { valid: false, error: 'Admin privileges have been revoked' };
          }
          if (response.status === 401) {
            if (refreshToken) {
              const refreshed = await refreshAdminTokenDeduped(
                refreshToken,
                tokenProvider,
                user.id,
              );
              if (refreshed) {
                const refreshedSession = {
                  token: refreshed.token,
                  refreshToken: refreshed.refreshToken ?? refreshToken,
                  expiresAt: refreshed.expiresAt,
                  lastVerified: now,
                  lastActivity: now,
                };
                try {
                  const reVerify = await fetch(`${getServerApiUrl()}/api/admin/verify`, {
                    headers: { Authorization: `Bearer ${refreshed.token}` },
                  });
                  if (reVerify.ok) {
                    await session.update(refreshedSession);
                    return { valid: true, user };
                  }
                } catch {
                  await session.update(refreshedSession);
                  return { valid: true, user };
                }
              }
            }
            console.warn(
              '[verifyAdminTokenFn] Token refresh failed or unavailable, clearing session',
            );
            await clearSession(session);
            return { valid: false, error: 'Session is no longer valid' };
          }
          console.warn(
            '[verifyAdminTokenFn] Re-validation returned non-auth error, allowing cached session:',
            response.status,
          );
        }

        await session.update({ lastVerified: now, lastActivity: now });
      } catch (error) {
        console.warn(
          '[verifyAdminTokenFn] Re-validation call failed, allowing cached session:',
          error,
        );
        await session.update({ lastVerified: now, lastActivity: now });
      }
    } else {
      await session.update({ lastActivity: now });
    }

    return { valid: true, user };
  } catch (error) {
    console.error('Token verification error:', error);
    return { valid: false, error: 'Verification failed' };
  }
});

export const requireAuthFn = createServerFn({ method: 'GET' })
  .inputValidator(z.object({ location: z.string() }))
  .handler(async ({ data }) => {
    const verifyResult = await verifyAdminTokenFn();

    if (!verifyResult.valid) {
      throw redirect({
        to: '/login',
        search: { redirect: data.location },
      });
    }

    return {
      isAuthenticated: true,
      user: verifyResult.user ?? null,
    };
  });

const logoutResponseSchema = z.object({ redirect: z.string().optional() });

export const adminLogoutFn = createServerFn({ method: 'POST' }).handler(async () => {
  try {
    const session = await useAppSession();
    const token = session.data.token;

    let redirect: string | undefined;
    if (token) {
      try {
        const response = await fetch(`${getServerApiUrl()}/api/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const parsed = logoutResponseSchema.safeParse(await response.json().catch(() => ({})));
        if (parsed.success) {
          redirect = parsed.data.redirect;
        }
      } catch {
        // Ignore remote logout errors
      }
    }

    await clearSession(session);

    return { error: false, redirect };
  } catch (error) {
    console.error('Admin logout error:', error);
    return { error: true, message: 'Logout failed' };
  }
});

export const getCurrentUserFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const session = await useAppSession();
    return {
      user: session.data.user ?? null,
      isAuthenticated: !!session.data.token,
    };
  } catch (error) {
    console.error('[getCurrentUserFn] Failed to read session, treating as logged out:', error);
    return { user: null, isAuthenticated: false };
  }
});

/** Shared queryOptions so consumers deduplicate the OpenID availability check. */
export const openIdCheckOptions = queryOptions({
  queryKey: ['openIdCheck'],
  queryFn: () => checkOpenIdFn(),
  staleTime: 60_000,
});

export const checkOpenIdFn = createServerFn({ method: 'GET' }).handler(async () => {
  if (process.env.ADMIN_SSO_ENABLED === 'false') {
    return { available: false, ssoOnly: false };
  }
  const checkUrl = `${getServerApiUrl()}/api/admin/oauth/openid/check`;
  try {
    const response = await fetch(checkUrl);
    if (!response.ok) {
      console.warn('[checkOpenIdFn] OpenID check failed:', response.status, checkUrl);
      return { available: false, ssoOnly: false };
    }
    const ssoOnly = process.env.ADMIN_SSO_ONLY === 'true';
    return { available: true, ssoOnly };
  } catch (error) {
    console.warn('[checkOpenIdFn] OpenID check request failed:', checkUrl, error);
    return { available: false, ssoOnly: false };
  }
});

export const openidLoginFn = createServerFn({ method: 'GET' }).handler(async () => {
  try {
    const baseUrl = getApiBaseUrl();
    const authUrl = new URL(`${baseUrl}/api/admin/oauth/openid`);

    const codeVerifier = crypto.randomBytes(32).toString('hex');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('hex');
    authUrl.searchParams.set('code_challenge', codeChallenge);

    const session = await useAppSession();
    await session.update({ codeVerifier });

    return { error: false, authUrl: authUrl.toString() };
  } catch (error) {
    console.error('OpenID login initiation error:', error);
    return { error: true, message: 'Failed to initiate SSO login' };
  }
});

export const oauthExchangeFn = createServerFn({ method: 'POST' })
  .inputValidator(
    z.object({ code: z.string().regex(/^[a-f0-9]{64}$/, 'Invalid exchange code format') }),
  )
  .handler(async ({ data }) => {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      const requestOrigin = getRequestOrigin();
      if (requestOrigin) headers['Origin'] = requestOrigin;

      const session = await useAppSession();
      const { codeVerifier } = session.data;
      const exchangePayload = buildOAuthExchangePayload(data.code, codeVerifier);
      if (!exchangePayload.ok) {
        console.warn(
          '[oauthExchangeFn] Missing PKCE verifier from admin session; check SESSION_COOKIE_SECURE for HTTP deployments',
        );
        return { error: true, message: exchangePayload.message };
      }

      const response = await fetch(`${getServerApiUrl()}/api/admin/oauth/exchange`, {
        method: 'POST',
        headers,
        body: exchangePayload.body,
      });

      const responseData = await response.json();

      if (!response.ok) {
        const errorCode = responseData.error_code;
        switch (errorCode) {
          case 'MISSING_CODE':
            return { error: true, message: 'Authorization code is required' };
          case 'INVALID_CODE_FORMAT':
            return { error: true, message: 'Invalid authorization code format' };
          case 'INVALID_OR_EXPIRED_CODE':
            return { error: true, message: 'Authorization code has expired. Please try again.' };
          default:
            if (response.status === 429)
              return { error: true, message: 'Too many requests. Please wait and try again.' };
            if (response.status === 403)
              return { error: true, message: 'You do not have admin privileges' };
            return { error: true, message: responseData.message || 'OAuth exchange failed' };
        }
      }

      const exchangeData = responseData as t.OAuthExchangeResponse;
      const now = Date.now();
      await session.update({
        user: exchangeData.user,
        token: exchangeData.token,
        refreshToken: exchangeData.refreshToken ?? extractCookieValue(response, 'refreshToken'),
        tokenProvider: 'openid',
        expiresAt: exchangeData.expiresAt,
        lastVerified: now,
        lastActivity: now,
        codeVerifier: undefined,
      });

      return { error: false, user: exchangeData.user };
    } catch (error) {
      console.error('OAuth exchange error:', error);
      return { error: true, message: 'Failed to complete authentication. Please try again.' };
    }
  });
