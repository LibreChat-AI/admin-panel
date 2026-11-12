import { z } from 'zod';
import crypto from 'crypto';
import { redirect } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';
import type * as t from '@/types';
import {
  SSO_PROVIDERS,
  SSO_PROVIDER_IDS,
  EXCHANGE_CODE_PATTERN,
  TENANT_CONTEXT_REQUIRED_CODE,
  TWO_FACTOR_FEDERATED_LOGIN_BLOCKED_CODE,
} from '@/constants';
import { offeredSsoProviders, toSafeRedirect, ssoStartPath } from '@/utils';
import { getApiBaseUrl, getServerApiUrl } from './utils/url';
import { refreshAdminTokenDeduped } from './utils/refresh';
import { buildOAuthExchangePayload } from './utils/oauth';
import { useAppSession, getSessionConfig } from './session';
import { tenantHeaders } from './utils/tenant';

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

/** The first entry of a header each proxy hop may append to (`https, http`), trimmed; `undefined` when blank. */
function firstHeaderValue(name: string): string | undefined {
  return getRequestHeader(name)?.split(',')[0].trim() || undefined;
}

/**
 * The panel's browser-facing origin, which LibreChat checks against the origin
 * it bound the exchange code to. Without `Origin` or `Referer` it is rebuilt
 * from forwarding metadata, where `X-Forwarded-Host` wins over a `Host` the
 * proxy rewrote to the upstream (`admin-panel:3000`).
 */
function getRequestOrigin(): string | undefined {
  const origin = getRequestHeader('origin');
  if (origin) return origin;

  const referer = getRequestHeader('referer');
  if (referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return undefined;
    }
  }

  const host = firstHeaderValue('x-forwarded-host') ?? getRequestHeader('host');
  if (!host) return undefined;

  const proto = firstHeaderValue('x-forwarded-proto') ?? 'http';
  return `${proto}://${host}`;
}

function failure(code: t.AuthErrorCode): t.AuthFailure {
  return { error: true, code };
}

/** The reply's JSON error body; `{}` when it has none (a proxy's HTML page, an empty 429). */
async function readErrorBody(response: Response): Promise<t.AuthErrorBody> {
  const body: t.AuthErrorBody | null = await response.json().catch(() => null);
  return body && typeof body === 'object' ? body : {};
}

/** The failure each `code` of LibreChat's pre-auth 403s names. */
const FORBIDDEN_ERROR_CODES: ReadonlyMap<string, t.AuthErrorCode> = new Map([
  [TENANT_CONTEXT_REQUIRED_CODE, 'tenant_required'],
  [TWO_FACTOR_FEDERATED_LOGIN_BLOCKED_CODE, 'federated_login'],
]);

/**
 * A 403 before sign-in: strict tenant isolation refusing a request that
 * carried no tenant, or 2FA enforcement refusing a password for an account its
 * identity provider owns. Any other 403 is `fallback`, as it read before
 * LibreChat sent these codes.
 */
function forbiddenCode(body: t.AuthErrorBody, fallback: t.AuthErrorCode): t.AuthErrorCode {
  return (body.code ? FORBIDDEN_ERROR_CODES.get(body.code) : undefined) ?? fallback;
}

/**
 * Why `POST /api/admin/login/local` refused. LibreChat's `requireLocalAuth`
 * answers 404 for an unknown email and a wrong password alike, and 422 only
 * for an unverified email.
 */
function loginFailureCode(status: number, body: t.AuthErrorBody): t.AuthErrorCode {
  switch (status) {
    case 403:
      return forbiddenCode(body, 'not_admin');
    case 404:
      return 'invalid_credentials';
    case 422:
      return 'email_not_verified';
    case 429:
      return 'rate_limited';
    default:
      return 'login_failed';
  }
}

/** Why `POST /api/auth/2fa/verify-temp` refused: a 401 says whether the temp token expired or the code was wrong. */
function verifyTempFailureCode(status: number, body: t.AuthErrorBody): t.AuthErrorCode {
  if (status === 401) {
    const message = typeof body.message === 'string' ? body.message : '';
    return message.toLowerCase().includes('expired') ? 'totp_expired' : 'totp_invalid';
  }
  if (status === 403) return forbiddenCode(body, 'verification_failed');
  if (status === 429) return 'rate_limited';
  return 'verification_failed';
}

const EXCHANGE_ERROR_CODES: ReadonlyMap<string, t.AuthErrorCode> = new Map([
  ['MISSING_CODE', 'sso_code_invalid'],
  ['INVALID_CODE_FORMAT', 'sso_code_invalid'],
  ['INVALID_OR_EXPIRED_CODE', 'sso_code_expired'],
]);

/** Why `POST /api/admin/oauth/exchange` refused (its `error_code`, else the status). */
function exchangeFailureCode(status: number, body: t.AuthErrorBody): t.AuthErrorCode {
  const known = body.error_code ? EXCHANGE_ERROR_CODES.get(body.error_code) : undefined;
  if (known) return known;
  if (status === 429) return 'rate_limited';
  if (status === 403) return forbiddenCode(body, 'not_admin');
  return 'sso_exchange_failed';
}

export const adminLoginFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      email: z.string().email('Valid email address is required'),
      password: z.string().min(1, 'Password is required'),
    }),
  )
  .handler(async ({ data }): Promise<t.AdminLoginResult> => {
    try {
      const response = await fetch(`${getServerApiUrl()}/api/admin/login/local`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tenantHeaders() },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        return failure(loginFailureCode(response.status, await readErrorBody(response)));
      }

      const loginData = (await response.json()) as t.AdminLoginResponse;

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
      return failure('unreachable');
    }
  });

export const adminVerify2FAFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      tempToken: z.string().min(1, 'Temporary token is required'),
      totpCode: z.string().regex(/^\d{6}$/, 'Code must be 6 digits'),
    }),
  )
  .handler(async ({ data }): Promise<t.AuthResult> => {
    try {
      const response = await fetch(`${getServerApiUrl()}/api/auth/2fa/verify-temp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...tenantHeaders() },
        body: JSON.stringify({ tempToken: data.tempToken, token: data.totpCode }),
      });

      if (!response.ok) {
        return failure(verifyTempFailureCode(response.status, await readErrorBody(response)));
      }

      const verifyData = (await response.json()) as t.TwoFAVerifyResponse;
      const adminVerifyResponse = await fetch(`${getServerApiUrl()}/api/admin/verify`, {
        headers: { Authorization: `Bearer ${verifyData.token}` },
      });

      if (!adminVerifyResponse.ok) {
        if (adminVerifyResponse.status === 403) return failure('not_admin');
        if (adminVerifyResponse.status === 401) return failure('session_invalid');
        return failure('verification_failed');
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
      return failure('verification_failed');
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
  .validator(z.object({ location: z.string() }))
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

/** LibreChat's `GET /api/config`, read with the request's tenant; `undefined` when it cannot be read. */
async function fetchSsoStartupConfig(): Promise<t.SsoStartupConfig | undefined> {
  const configUrl = `${getServerApiUrl()}/api/config`;
  try {
    const response = await fetch(configUrl, { headers: tenantHeaders() });
    if (!response.ok) {
      console.warn('[ssoProvidersFn] Startup config request failed:', response.status, configUrl);
      return undefined;
    }
    const config: t.SsoStartupConfig | null = await response.json().catch(() => null);
    return config && typeof config === 'object' ? config : undefined;
  } catch (error) {
    console.warn('[ssoProvidersFn] Startup config request failed:', configUrl, error);
    return undefined;
  }
}

/**
 * Whether the provider's `/check` route answers: LibreChat's OpenID route
 * does only once its client initialised, which `GET /api/config` cannot tell.
 */
async function checkSsoProvider(id: t.SsoProviderId): Promise<boolean> {
  const checkUrl = `${getServerApiUrl()}${ssoStartPath(id)}/check`;
  try {
    const response = await fetch(checkUrl, { headers: tenantHeaders() });
    if (!response.ok) {
      console.warn(`[ssoProvidersFn] ${id} check failed:`, response.status, checkUrl);
    }
    return response.ok;
  } catch (error) {
    console.warn(`[ssoProvidersFn] ${id} check request failed:`, checkUrl, error);
    return false;
  }
}

const CHECKED_SSO_PROVIDERS = SSO_PROVIDER_IDS.filter(
  (id) => SSO_PROVIDERS[id].availability === 'check',
);

/** The providers whose `/check` route answered. */
async function checkSsoProviders(): Promise<Set<t.SsoProviderId>> {
  const answered = await Promise.all(CHECKED_SSO_PROVIDERS.map(checkSsoProvider));
  return new Set(CHECKED_SSO_PROVIDERS.filter((_id, index) => answered[index]));
}

/**
 * The SSO providers LibreChat offers this request's tenant, and whether the
 * sign-in page is SSO-only. `ADMIN_SSO_ENABLED=false` offers none and asks
 * LibreChat nothing; `ADMIN_SSO_ONLY` holds only while one is offered, so a
 * deployment none resolves for keeps its password form.
 */
export const ssoProvidersFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<t.SsoProviders> => {
    if (process.env.ADMIN_SSO_ENABLED === 'false') {
      return { providers: [], ssoOnly: false };
    }
    const [config, checked] = await Promise.all([fetchSsoStartupConfig(), checkSsoProviders()]);
    const providers = offeredSsoProviders(config, checked);
    return { providers, ssoOnly: providers.length > 0 && process.env.ADMIN_SSO_ONLY === 'true' };
  },
);

/** The longest in-app path an SSO sign-in carries through the admin session; a longer one returns to `/`. */
const MAX_SSO_REDIRECT_LENGTH = 2048;

/** The in-app path to return to after SSO: a safe one within the length limit, else `/`. */
function ssoRedirectOf(redirectTo: string | undefined): string {
  return redirectTo && redirectTo.length <= MAX_SSO_REDIRECT_LENGTH
    ? toSafeRedirect(redirectTo)
    : '/';
}

/**
 * Starts an SSO sign-in: the PKCE verifier and the in-app path to return to
 * stay in the admin session, and the browser goes to LibreChat's route of the
 * provider with only the challenge (LibreChat strips any `redirectTo`).
 */
export const ssoStartFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      provider: z.enum(SSO_PROVIDER_IDS),
      redirectTo: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<t.SsoStartResult> => {
    try {
      const authUrl = new URL(`${getApiBaseUrl()}${ssoStartPath(data.provider)}`);

      const codeVerifier = crypto.randomBytes(32).toString('hex');
      const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('hex');
      authUrl.searchParams.set('code_challenge', codeChallenge);

      const session = await useAppSession();
      await session.update({
        codeVerifier,
        ssoProvider: data.provider,
        ssoRedirect: ssoRedirectOf(data.redirectTo),
      });

      return { error: false, authUrl: authUrl.toString() };
    } catch (error) {
      console.error(`[ssoStartFn] ${data.provider} sign-in initiation error:`, error);
      return failure('sso_start_failed');
    }
  });

/**
 * Exchanges LibreChat's one-time code for an admin session. The session is the
 * provider's that sign-in started with: the callback's `provider` stands in only
 * for a sign-in started before the panel kept it.
 */
export const oauthExchangeFn = createServerFn({ method: 'POST' })
  .validator(
    z.object({
      code: z.string().regex(EXCHANGE_CODE_PATTERN, 'Invalid exchange code format'),
      provider: z.enum(SSO_PROVIDER_IDS),
    }),
  )
  .handler(async ({ data }): Promise<t.SsoExchangeResult> => {
    try {
      const requestOrigin = getRequestOrigin();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...(requestOrigin ? { Origin: requestOrigin } : {}),
        ...tenantHeaders(),
      };

      const session = await useAppSession();
      const exchangeBody = buildOAuthExchangePayload(data.code, session.data.codeVerifier);
      if (!exchangeBody) {
        console.warn(
          '[oauthExchangeFn] Missing PKCE verifier from admin session; check SESSION_COOKIE_SECURE for HTTP deployments',
        );
        return failure('sso_verifier_lost');
      }

      const response = await fetch(`${getServerApiUrl()}/api/admin/oauth/exchange`, {
        method: 'POST',
        headers,
        body: exchangeBody,
      });

      if (!response.ok) {
        const code = exchangeFailureCode(response.status, await readErrorBody(response));
        if (code === 'sso_code_expired') {
          console.warn(
            "[oauthExchangeFn] LibreChat refused the exchange code as invalid or expired. It binds each code to its ADMIN_PANEL_URL's origin: if that differs from the Origin forwarded here, align ADMIN_PANEL_URL or the proxy's forwarded headers; if it matches, the code expired, was already used, failed its PKCE check, or was issued by a replica whose cache this one does not share. Forwarded Origin:",
            requestOrigin ?? '(none)',
          );
        }
        return failure(code);
      }

      const exchangeData = (await response.json()) as t.OAuthExchangeResponse;
      const redirectTo = toSafeRedirect(session.data.ssoRedirect);
      const now = Date.now();
      await session.update({
        user: exchangeData.user,
        token: exchangeData.token,
        refreshToken: exchangeData.refreshToken ?? extractCookieValue(response, 'refreshToken'),
        tokenProvider: session.data.ssoProvider ?? data.provider,
        expiresAt: exchangeData.expiresAt,
        lastVerified: now,
        lastActivity: now,
        codeVerifier: undefined,
        ssoProvider: undefined,
        ssoRedirect: undefined,
      });

      return { error: false, user: exchangeData.user, redirectTo };
    } catch (error) {
      console.error('OAuth exchange error:', error);
      return failure('sso_exchange_failed');
    }
  });
