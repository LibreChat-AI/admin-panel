import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as t from '@/types';

const fetchMock = vi.fn();
const updateSession = vi.fn();
const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
const requestHeaders = new Map<string, string>();
const sessionState: { data: Record<string, unknown> } = { data: {} };

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: (fn: (...args: unknown[]) => unknown) => fn,
  createServerFn: () => ({
    handler: (fn: (...args: unknown[]) => unknown) => fn,
    validator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
  }),
}));

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: (name: string) => requestHeaders.get(name.toLowerCase()),
}));

vi.mock('./session', () => ({
  getSessionConfig: () => ({
    revalidationInterval: 60_000,
    idleTimeout: 30 * 60 * 1000,
  }),
  useAppSession: vi.fn(async () => ({
    data: sessionState.data,
    update: updateSession,
  })),
}));

vi.mock('./utils/url', () => ({
  getApiBaseUrl: () => 'http://admin.test',
  getServerApiUrl: () => 'http://librechat.test',
}));

vi.mock('./utils/refresh', () => ({
  refreshAdminTokenDeduped: vi.fn(),
}));

import {
  ssoStartFn,
  adminLoginFn,
  ssoProvidersFn,
  oauthExchangeFn,
  adminVerify2FAFn,
  verifyAdminTokenFn,
} from './auth';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('adminLoginFn', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    updateSession.mockReset();
    sessionState.data = {};
    requestHeaders.clear();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('accepts a backend-approved delegated admin without requiring the ADMIN role', async () => {
    const user = { id: 'user-1', role: 'department-admin', email: 'delegate@example.com' };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-token', user }));

    const result = await adminLoginFn({
      data: { email: 'delegate@example.com', password: 'password' },
    });

    expect(result).toEqual({ error: false, user });
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/login/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'delegate@example.com', password: 'password' }),
    });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        user,
        token: 'jwt-token',
        tokenProvider: 'librechat',
      }),
    );
  });

  it("forwards the request's X-Tenant-Id so strict tenant isolation scopes the sign-in", async () => {
    requestHeaders.set('x-tenant-id', '  tenant-a  ');
    const user = { id: 'user-1', role: 'ADMIN', email: 'admin@tenant-a.example' };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-token', user }));

    await adminLoginFn({ data: { email: 'admin@tenant-a.example', password: 'password' } });

    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/login/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': 'tenant-a' },
      body: JSON.stringify({ email: 'admin@tenant-a.example', password: 'password' }),
    });
  });

  it('reads a strict-isolation refusal without a tenant apart from a missing admin capability', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(403, {
        message: 'Tenant context required in strict isolation mode',
        code: 'TENANT_CONTEXT_REQUIRED',
      }),
    );

    const result = await adminLoginFn({ data: { email: 'a@example.com', password: 'password' } });

    expect(result).toEqual({ error: true, code: 'tenant_required' });
    expect(updateSession).not.toHaveBeenCalled();
  });

  it.each([
    [403, { message: 'Forbidden', code: 'FORBIDDEN' }, 'not_admin'],
    [403, { message: 'Forbidden' }, 'not_admin'],
    [
      403,
      {
        code: 'TWO_FACTOR_FEDERATED_LOGIN_BLOCKED',
        message: 'Sign in with your identity provider to continue.',
      },
      'federated_login',
    ],
    [404, { message: 'Email does not exist.' }, 'invalid_credentials'],
    [404, { message: 'Incorrect password.' }, 'invalid_credentials'],
    [422, { message: 'Email not verified.' }, 'email_not_verified'],
    [429, { message: 'Too many login attempts' }, 'rate_limited'],
    [500, { message: 'Something went wrong' }, 'login_failed'],
  ])('returns a code the page words for a %i reply (%j)', async (status, body, code) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, body));

    const result = await adminLoginFn({ data: { email: 'a@example.com', password: 'password' } });

    expect(result).toEqual({ error: true, code });
  });

  it('reads a refusal with no JSON body by its status', async () => {
    fetchMock.mockResolvedValueOnce(new Response('Too Many Requests', { status: 429 }));

    const result = await adminLoginFn({ data: { email: 'a@example.com', password: 'password' } });

    expect(result).toEqual({ error: true, code: 'rate_limited' });
  });

  it('reports an unreachable LibreChat as such', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));

    const result = await adminLoginFn({ data: { email: 'a@example.com', password: 'password' } });

    expect(result).toEqual({ error: true, code: 'unreachable' });
    errorSpy.mockRestore();
  });
});

describe('adminVerify2FAFn', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    updateSession.mockReset();
    sessionState.data = {};
    requestHeaders.clear();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('accepts a backend-approved delegated admin after 2FA verification', async () => {
    const user = { id: 'user-2', role: 'department-admin', email: 'delegate2@example.com' };
    const verifiedUser = { ...user, name: 'Delegated Admin' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-token-2', user }))
      .mockResolvedValueOnce(jsonResponse(200, { user: verifiedUser }));

    const result = await adminVerify2FAFn({
      data: { tempToken: 'temp-token', totpCode: '123456' },
    });

    expect(result).toEqual({ error: false, user: verifiedUser });
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/auth/2fa/verify-temp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tempToken: 'temp-token', token: '123456' }),
    });
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/verify', {
      headers: { Authorization: 'Bearer jwt-token-2' },
    });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        user: verifiedUser,
        token: 'jwt-token-2',
        tokenProvider: 'librechat',
      }),
    );
  });

  it('rejects a 2FA token that does not pass admin capability revalidation', async () => {
    const user = { id: 'user-2', role: 'regular-user', email: 'user@example.com' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'user-jwt-token', user }))
      .mockResolvedValueOnce(jsonResponse(403, {}));

    const result = await adminVerify2FAFn({
      data: { tempToken: 'temp-token', totpCode: '123456' },
    });

    expect(result).toEqual({ error: true, code: 'not_admin' });
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/verify', {
      headers: { Authorization: 'Bearer user-jwt-token' },
    });
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("forwards the request's X-Tenant-Id to the 2FA step", async () => {
    requestHeaders.set('x-tenant-id', 'tenant-a');
    const user = { id: 'user-2', role: 'ADMIN', email: 'admin@tenant-a.example' };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-token-2', user }))
      .mockResolvedValueOnce(jsonResponse(200, { user }));

    await adminVerify2FAFn({ data: { tempToken: 'temp-token', totpCode: '123456' } });

    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/auth/2fa/verify-temp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': 'tenant-a' },
      body: JSON.stringify({ tempToken: 'temp-token', token: '123456' }),
    });
  });

  it.each([
    [403, { code: 'TENANT_CONTEXT_REQUIRED' }, 'tenant_required'],
    [
      403,
      {
        code: 'TWO_FACTOR_FEDERATED_LOGIN_BLOCKED',
        message: 'Sign in with your identity provider to continue.',
      },
      'federated_login',
    ],
    [401, { message: 'Invalid or expired temporary token' }, 'totp_expired'],
    [401, { message: 'Invalid 2FA code or backup code' }, 'totp_invalid'],
    [429, { message: 'Too many attempts' }, 'rate_limited'],
    [403, { message: 'You have been temporarily banned' }, 'verification_failed'],
  ])('returns a code the page words for a %i reply (%j)', async (status, body, code) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(status, body));

    const result = await adminVerify2FAFn({
      data: { tempToken: 'temp-token', totpCode: '123456' },
    });

    expect(result).toEqual({ error: true, code });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('verifyAdminTokenFn', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    updateSession.mockReset();
    sessionState.data = {};
    vi.stubGlobal('fetch', fetchMock);
  });

  it('keeps a fresh delegated admin session without requiring the ADMIN role', async () => {
    const user = { id: 'user-3', role: 'department-admin', email: 'delegate3@example.com' };
    sessionState.data = {
      user,
      token: 'jwt-token-3',
      lastVerified: Date.now(),
      lastActivity: Date.now(),
    };

    const result = await verifyAdminTokenFn();

    expect(result).toEqual({ valid: true, user });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateSession).toHaveBeenCalledWith({ lastActivity: expect.any(Number) });
  });

  it('clears a delegated admin session when backend capability revalidation is denied', async () => {
    const user = { id: 'user-4', role: 'department-admin', email: 'delegate4@example.com' };
    sessionState.data = {
      user,
      token: 'jwt-token-4',
      lastVerified: 0,
      lastActivity: Date.now(),
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(403, {}));

    const result = await verifyAdminTokenFn();

    expect(result).toEqual({ valid: false, error: 'Admin privileges have been revoked' });
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/verify', {
      headers: { Authorization: 'Bearer jwt-token-4' },
    });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        token: undefined,
        user: undefined,
        refreshToken: undefined,
      }),
    );
  });
});

describe('oauthExchangeFn', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    updateSession.mockReset();
    warnSpy.mockClear();
    sessionState.data = {};
    requestHeaders.clear();
    vi.stubGlobal('fetch', fetchMock);
  });

  it('exchanges the callback code with the PKCE verifier stored in the admin session', async () => {
    sessionState.data = { codeVerifier: 'verifier-123' };
    requestHeaders.set('origin', 'http://admin.test');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        token: 'jwt-token',
        refreshToken: 'refresh-token',
        expiresAt: 123456,
        user: { id: 'user-1', role: 'ADMIN', email: 'admin@example.com' },
      }),
    );

    const result = await oauthExchangeFn({ data: { code: 'a'.repeat(64), provider: 'openid' } });

    expect(result).toEqual({
      error: false,
      user: { id: 'user-1', role: 'ADMIN', email: 'admin@example.com' },
      redirectTo: '/',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://librechat.test/api/admin/oauth/exchange', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'http://admin.test',
      },
      body: JSON.stringify({ code: 'a'.repeat(64), code_verifier: 'verifier-123' }),
    });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        token: 'jwt-token',
        refreshToken: 'refresh-token',
        tokenProvider: 'openid',
        codeVerifier: undefined,
      }),
    );
  });

  it('derives an http origin from the host when X-Forwarded-Proto is present but empty', async () => {
    sessionState.data = { codeVerifier: 'verifier-123' };
    requestHeaders.set('host', 'admin.test');
    requestHeaders.set('x-forwarded-proto', '');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: 'jwt-token', user: { id: 'user-1', role: 'ADMIN' } }),
    );

    await oauthExchangeFn({ data: { code: 'c'.repeat(64), provider: 'openid' } });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://librechat.test/api/admin/oauth/exchange',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', Origin: 'http://admin.test' },
      }),
    );
  });

  it.each([
    [
      'the first X-Forwarded-Proto a proxy chain appended',
      { host: 'admin.example.com', 'x-forwarded-proto': 'https, http' },
      'https://admin.example.com',
    ],
    [
      'X-Forwarded-Host over a Host the proxy rewrote to the upstream',
      {
        host: 'admin-panel:3000',
        'x-forwarded-host': 'admin.example.com',
        'x-forwarded-proto': 'https',
      },
      'https://admin.example.com',
    ],
    [
      'the first X-Forwarded-Host a proxy chain appended',
      {
        host: 'admin-panel:3000',
        'x-forwarded-host': ' admin.example.com , ingress.internal',
        'x-forwarded-proto': 'https',
      },
      'https://admin.example.com',
    ],
    [
      'Host when X-Forwarded-Host is blank',
      { host: 'admin.test', 'x-forwarded-host': ' ' },
      'http://admin.test',
    ],
    [
      'the Origin header ahead of any forwarding metadata',
      {
        origin: 'https://admin.example.com',
        host: 'admin-panel:3000',
        'x-forwarded-host': 'ingress.internal',
        'x-forwarded-proto': 'http',
      },
      'https://admin.example.com',
    ],
  ])('sends LibreChat an Origin from %s', async (_case, headers, origin) => {
    sessionState.data = { codeVerifier: 'verifier-123' };
    for (const [name, value] of Object.entries(headers)) requestHeaders.set(name, value);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: 'jwt-token', user: { id: 'user-1', role: 'ADMIN' } }),
    );

    await oauthExchangeFn({ data: { code: 'c'.repeat(64), provider: 'openid' } });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://librechat.test/api/admin/oauth/exchange',
      expect.objectContaining({
        headers: { 'Content-Type': 'application/json', Origin: origin },
      }),
    );
  });

  it('logs the Origin it forwarded when LibreChat refuses the code as invalid or expired', async () => {
    sessionState.data = { codeVerifier: 'verifier-123' };
    requestHeaders.set('origin', 'https://admin.example.com');
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error_code: 'INVALID_OR_EXPIRED_CODE' }));

    const result = await oauthExchangeFn({ data: { code: 'e'.repeat(64), provider: 'openid' } });

    expect(result).toEqual({ error: true, code: 'sso_code_expired' });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("binds each code to its ADMIN_PANEL_URL's origin"),
      'https://admin.example.com',
    );
  });

  it('does not log an origin hint for refusals other than an invalid or expired code', async () => {
    sessionState.data = { codeVerifier: 'verifier-123' };
    requestHeaders.set('origin', 'https://admin.example.com');
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { error_code: 'INVALID_CODE_FORMAT' }));

    await oauthExchangeFn({ data: { code: 'e'.repeat(64), provider: 'openid' } });

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('does not consume the one-time LibreChat exchange code when the PKCE verifier was lost', async () => {
    sessionState.data = {};

    const result = await oauthExchangeFn({ data: { code: 'b'.repeat(64), provider: 'openid' } });

    expect(result).toEqual({ error: true, code: 'sso_verifier_lost' });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateSession).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      '[oauthExchangeFn] Missing PKCE verifier from admin session; check SESSION_COOKIE_SECURE for HTTP deployments',
    );
  });

  it('signs a Google admin in as a Google session, for its refresh to go to Google', async () => {
    sessionState.data = { codeVerifier: 'verifier-123', ssoProvider: 'google' };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        token: 'jwt-token',
        refreshToken: 'google-refresh-token',
        expiresAt: 123456,
        user: { id: 'user-1', role: 'ADMIN', email: 'admin@example.com' },
      }),
    );

    const result = await oauthExchangeFn({ data: { code: 'e'.repeat(64), provider: 'google' } });

    expect(result).toMatchObject({ error: false });
    expect(fetchMock).toHaveBeenCalledWith(
      'http://librechat.test/api/admin/oauth/exchange',
      expect.objectContaining({
        body: JSON.stringify({ code: 'e'.repeat(64), code_verifier: 'verifier-123' }),
      }),
    );
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        refreshToken: 'google-refresh-token',
        tokenProvider: 'google',
      }),
    );
  });

  it('signs the admin in with the provider sign-in started with, whichever callback the code came back to', async () => {
    sessionState.data = { codeVerifier: 'verifier-123', ssoProvider: 'openid' };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: 'jwt-token', user: { id: 'user-1', role: 'ADMIN' } }),
    );

    const result = await oauthExchangeFn({ data: { code: 'e'.repeat(64), provider: 'google' } });

    expect(result).toMatchObject({ error: false });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({ tokenProvider: 'openid', ssoProvider: undefined }),
    );
  });

  it("takes the callback's provider for a sign-in started before the session kept one", async () => {
    sessionState.data = { codeVerifier: 'verifier-123' };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: 'jwt-token', user: { id: 'user-1', role: 'ADMIN' } }),
    );

    await oauthExchangeFn({ data: { code: 'e'.repeat(64), provider: 'google' } });

    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({ tokenProvider: 'google' }),
    );
  });

  it('returns to the path sign-in started from, and forgets it', async () => {
    sessionState.data = { codeVerifier: 'verifier-123', ssoRedirect: '/grants?tab=audit' };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: 'jwt-token', user: { id: 'user-1', role: 'ADMIN' } }),
    );

    const result = await oauthExchangeFn({ data: { code: 'f'.repeat(64), provider: 'saml' } });

    expect(result).toEqual({
      error: false,
      user: { id: 'user-1', role: 'ADMIN' },
      redirectTo: '/grants?tab=audit',
    });
    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenProvider: 'saml',
        codeVerifier: undefined,
        ssoRedirect: undefined,
      }),
    );
  });

  it('keeps the path to return to while the exchange fails, for the next attempt to overwrite', async () => {
    sessionState.data = { codeVerifier: 'verifier-123', ssoRedirect: '/grants' };
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error_code: 'INVALID_OR_EXPIRED_CODE' }));

    const result = await oauthExchangeFn({ data: { code: 'f'.repeat(64), provider: 'google' } });

    expect(result).toEqual({ error: true, code: 'sso_code_expired' });
    expect(updateSession).not.toHaveBeenCalled();
  });

  it("forwards the request's X-Tenant-Id to the code exchange", async () => {
    sessionState.data = { codeVerifier: 'verifier-123' };
    requestHeaders.set('x-tenant-id', 'tenant-a');
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: 'jwt-token', user: { id: 'user-1', role: 'ADMIN' } }),
    );

    await oauthExchangeFn({ data: { code: 'c'.repeat(64), provider: 'openid' } });

    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toEqual({
      'Content-Type': 'application/json',
      'X-Tenant-Id': 'tenant-a',
    });
  });

  it.each([
    [401, { error_code: 'INVALID_OR_EXPIRED_CODE' }, 'sso_code_expired'],
    [400, { error_code: 'INVALID_CODE_FORMAT' }, 'sso_code_invalid'],
    [400, { error_code: 'MISSING_CODE' }, 'sso_code_invalid'],
    [429, {}, 'rate_limited'],
    [500, { error_code: 'INTERNAL_ERROR' }, 'sso_exchange_failed'],
  ])('returns a code the page words for a %i reply (%j)', async (status, body, code) => {
    sessionState.data = { codeVerifier: 'verifier-123' };
    fetchMock.mockResolvedValueOnce(jsonResponse(status, body));

    const result = await oauthExchangeFn({ data: { code: 'd'.repeat(64), provider: 'openid' } });

    expect(result).toEqual({ error: true, code });
    expect(updateSession).not.toHaveBeenCalled();
  });
});

const OPENID_CHECK_URL = 'http://librechat.test/api/admin/oauth/openid/check';
const STARTUP_CONFIG_URL = 'http://librechat.test/api/config';

/** LibreChat as the provider list reads it: the OpenID check's status and the startup config. */
function serveSsoBackend(openIdStatus: number, config: t.SsoStartupConfig | null) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url === OPENID_CHECK_URL) return jsonResponse(openIdStatus, {});
    if (url === STARTUP_CONFIG_URL && config) return jsonResponse(200, config);
    return jsonResponse(503, {});
  });
}

const GOOGLE_CONFIG: t.SsoStartupConfig = {
  socialLoginEnabled: true,
  socialLogins: ['openid', 'google'],
  googleLoginEnabled: true,
  samlLoginEnabled: false,
  openidLabel: 'Continue with OpenID',
};

describe('ssoProvidersFn', () => {
  const originalSsoEnabled = process.env.ADMIN_SSO_ENABLED;
  const originalSsoOnly = process.env.ADMIN_SSO_ONLY;

  beforeEach(() => {
    fetchMock.mockReset();
    warnSpy.mockClear();
    requestHeaders.clear();
    vi.stubGlobal('fetch', fetchMock);
    delete process.env.ADMIN_SSO_ENABLED;
    delete process.env.ADMIN_SSO_ONLY;
  });

  afterEach(() => {
    if (originalSsoEnabled === undefined) delete process.env.ADMIN_SSO_ENABLED;
    else process.env.ADMIN_SSO_ENABLED = originalSsoEnabled;
    if (originalSsoOnly === undefined) delete process.env.ADMIN_SSO_ONLY;
    else process.env.ADMIN_SSO_ONLY = originalSsoOnly;
  });

  it('offers Google next to OpenID when LibreChat has both, with auto-redirect off by default', async () => {
    serveSsoBackend(200, GOOGLE_CONFIG);

    const result = await ssoProvidersFn();

    expect(result).toEqual({
      providers: [{ id: 'openid', label: 'Continue with OpenID' }, { id: 'google' }],
      ssoOnly: false,
    });
    expect(fetchMock).toHaveBeenCalledWith(OPENID_CHECK_URL, { headers: {} });
    expect(fetchMock).toHaveBeenCalledWith(STARTUP_CONFIG_URL, { headers: {} });
  });

  it('offers Google without OpenID, whose client did not initialise', async () => {
    serveSsoBackend(404, GOOGLE_CONFIG);

    const result = await ssoProvidersFn();

    expect(result).toEqual({ providers: [{ id: 'google' }], ssoOnly: false });
  });

  it('offers SAML when LibreChat reports it', async () => {
    serveSsoBackend(404, { socialLoginEnabled: true, samlLoginEnabled: true, samlLabel: 'Okta' });

    const result = await ssoProvidersFn();

    expect(result).toEqual({ providers: [{ id: 'saml', label: 'Okta' }], ssoOnly: false });
  });

  it('keeps offering OpenID on its check when the startup config cannot be read', async () => {
    serveSsoBackend(200, null);

    const result = await ssoProvidersFn();

    expect(result).toEqual({ providers: [{ id: 'openid' }], ssoOnly: false });
  });

  it("forwards the request's X-Tenant-Id to the OpenID check and the startup config", async () => {
    requestHeaders.set('x-tenant-id', 'tenant-a');
    serveSsoBackend(200, GOOGLE_CONFIG);

    await ssoProvidersFn();

    expect(fetchMock).toHaveBeenCalledWith(OPENID_CHECK_URL, {
      headers: { 'X-Tenant-Id': 'tenant-a' },
    });
    expect(fetchMock).toHaveBeenCalledWith(STARTUP_CONFIG_URL, {
      headers: { 'X-Tenant-Id': 'tenant-a' },
    });
  });

  it('marks the page SSO-only when ADMIN_SSO_ONLY=true', async () => {
    process.env.ADMIN_SSO_ONLY = 'true';
    serveSsoBackend(200, GOOGLE_CONFIG);

    const result = await ssoProvidersFn();

    expect(result.ssoOnly).toBe(true);
  });

  it('keeps the password form of an SSO-only page no provider resolves for', async () => {
    process.env.ADMIN_SSO_ONLY = 'true';
    serveSsoBackend(404, { ...GOOGLE_CONFIG, socialLoginEnabled: false });

    const result = await ssoProvidersFn();

    expect(result).toEqual({ providers: [], ssoOnly: false });
  });

  it('offers no provider without calling the backend when ADMIN_SSO_ENABLED=false', async () => {
    process.env.ADMIN_SSO_ENABLED = 'false';

    const result = await ssoProvidersFn();

    expect(result).toEqual({ providers: [], ssoOnly: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lets ADMIN_SSO_ENABLED=false take precedence over ADMIN_SSO_ONLY=true', async () => {
    process.env.ADMIN_SSO_ENABLED = 'false';
    process.env.ADMIN_SSO_ONLY = 'true';

    const result = await ssoProvidersFn();

    expect(result).toEqual({ providers: [], ssoOnly: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('offers nothing when LibreChat cannot be reached', async () => {
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const result = await ssoProvidersFn();

    expect(result).toEqual({ providers: [], ssoOnly: false });
  });
});

describe('ssoStartFn', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    updateSession.mockReset();
    sessionState.data = {};
    vi.stubGlobal('fetch', fetchMock);
  });

  function startedSession(): { codeVerifier: string; ssoProvider: string; ssoRedirect: string } {
    expect(updateSession).toHaveBeenCalledTimes(1);
    return updateSession.mock.calls[0][0];
  }

  it.each([
    ['openid', 'http://admin.test/api/admin/oauth/openid'],
    ['google', 'http://admin.test/api/admin/oauth/google'],
    ['saml', 'http://admin.test/api/admin/oauth/saml'],
  ] as const)(
    'sends %s sign-in to its LibreChat route with the challenge of the stored verifier',
    async (provider, route) => {
      const result = await ssoStartFn({ data: { provider, redirectTo: '/grants' } });

      expect(result.error).toBe(false);
      const authUrl = new URL(result.error ? '' : result.authUrl);
      const { codeVerifier } = startedSession();
      expect(`${authUrl.origin}${authUrl.pathname}`).toBe(route);
      expect(authUrl.searchParams.get('code_challenge')).toBe(
        crypto.createHash('sha256').update(codeVerifier).digest('hex'),
      );
      expect([...authUrl.searchParams.keys()]).toEqual(['code_challenge']);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('keeps the provider and the in-app path to return to in the admin session', async () => {
    await ssoStartFn({
      data: { provider: 'google', redirectTo: '/configuration?scope=role:USER' },
    });

    expect(startedSession()).toEqual({
      codeVerifier: expect.stringMatching(/^[a-f0-9]{64}$/),
      ssoProvider: 'google',
      ssoRedirect: '/configuration?scope=role:USER',
    });
  });

  it.each([
    ['//evil.example/grants'],
    ['/\\evil.example'],
    ['https://evil.example/'],
    ['javascript:alert(1)'],
    [undefined],
  ])('returns to / instead of %s, which could leave the panel', async (redirectTo) => {
    await ssoStartFn({ data: { provider: 'openid', redirectTo } });

    expect(startedSession().ssoRedirect).toBe('/');
  });

  it('still starts a sign-in from a deep link too long to carry, returning to /', async () => {
    const result = await ssoStartFn({
      data: { provider: 'google', redirectTo: `/grants?q=${'a'.repeat(2100)}` },
    });

    expect(result.error).toBe(false);
    expect(startedSession().ssoRedirect).toBe('/');
  });

  it('words a sign-in that could not start', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    updateSession.mockRejectedValueOnce(
      new Error('SESSION_SECRET environment variable must be set'),
    );

    const result = await ssoStartFn({ data: { provider: 'google', redirectTo: '/' } });

    expect(result).toEqual({ error: true, code: 'sso_start_failed' });
    errorSpy.mockRestore();
  });
});
