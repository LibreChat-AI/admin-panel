import { describe, it, expect, beforeEach, vi } from 'vitest';

const sessionState: { data: Record<string, unknown> } = { data: {} };
const updateSpy = vi.fn(async (next: Record<string, unknown>) => {
  sessionState.data = { ...sessionState.data, ...next };
});

vi.mock('../session', () => ({
  useAppSession: vi.fn(async () => ({
    get data() {
      return sessionState.data;
    },
    update: updateSpy,
  })),
}));

const tenantHeader: { value: string | undefined } = { value: undefined };

vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: vi.fn((name: string) => {
    if (name.toLowerCase() === 'x-tenant-id') return tenantHeader.value;
    return undefined;
  }),
}));

vi.mock('./url', () => ({
  getServerApiUrl: () => 'http://lc.test',
  getApiBaseUrl: () => 'http://lc.test',
}));

import {
  refreshAdminToken,
  ensureFreshBearer,
  refreshOn401,
  refreshAdminTokenDeduped,
} from './refresh';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  updateSpy.mockClear();
  sessionState.data = {};
  tenantHeader.value = undefined;
  vi.stubGlobal('fetch', fetchMock);
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('refreshAdminToken — tenant header forwarding', () => {
  it('forwards X-Tenant-Id when the BFF request carried one', async () => {
    tenantHeader.value = 'tenant-a';
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: 'new-jwt', refreshToken: 'rt2', expiresAt: 999 }),
    );

    await refreshAdminToken('rt1', 'openid', 'user-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://lc.test/api/admin/oauth/refresh');
    expect((init as RequestInit).headers).toMatchObject({ 'X-Tenant-Id': 'tenant-a' });
  });

  it('omits X-Tenant-Id when the BFF request had no tenant header', async () => {
    tenantHeader.value = undefined;
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: 'new-jwt', refreshToken: 'rt2', expiresAt: 999 }),
    );

    await refreshAdminToken('rt1', 'openid', 'user-1');

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Tenant-Id']).toBeUndefined();
  });

  it('omits X-Tenant-Id when the header is whitespace only', async () => {
    tenantHeader.value = '   ';
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'new-jwt' }));

    await refreshAdminToken('rt1', 'openid', 'user-1');

    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Tenant-Id']).toBeUndefined();
  });

  it('forwards X-Tenant-Id on the cookie-based refresh of a password session', async () => {
    tenantHeader.value = 'tenant-a';
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'new-jwt' }));

    await refreshAdminToken('rt1', 'librechat', 'user-1');

    expect(fetchMock).toHaveBeenCalledWith('http://lc.test/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: 'refreshToken=rt1', 'X-Tenant-Id': 'tenant-a' },
    });
  });

  it('sends only the refresh cookie when the BFF request had no tenant header', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'new-jwt' }));

    await refreshAdminToken('rt1', 'librechat', 'user-1');

    expect(fetchMock).toHaveBeenCalledWith('http://lc.test/api/auth/refresh', {
      method: 'POST',
      headers: { Cookie: 'refreshToken=rt1' },
    });
  });
});

describe('refreshAdminToken — SSO providers', () => {
  it('renews an OpenID session through the admin OAuth refresh, naming the provider', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'new-jwt', expiresAt: 999 }));

    const result = await refreshAdminToken('rt1', 'openid', 'user-1');

    expect(result).toEqual({ token: 'new-jwt', expiresAt: 999 });
    expect(fetchMock).toHaveBeenCalledWith('http://lc.test/api/admin/oauth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: 'rt1', user_id: 'user-1', provider: 'openid' }),
    });
  });

  it('renews a Google session through the admin OAuth refresh, never the password cookie route', async () => {
    tenantHeader.value = 'tenant-a';
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: 'google-jwt', refreshToken: 'google-rt2', expiresAt: 999 }),
    );

    const result = await refreshAdminToken('google-rt1', 'google', 'user-1');

    expect(result).toEqual({ token: 'google-jwt', refreshToken: 'google-rt2', expiresAt: 999 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('http://lc.test/api/admin/oauth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': 'tenant-a' },
      body: JSON.stringify({
        refresh_token: 'google-rt1',
        user_id: 'user-1',
        provider: 'google',
      }),
    });
  });

  it('does not refresh a Google session without its user id', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(await refreshAdminToken('google-rt1', 'google', undefined)).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('sends a SAML session to no refresh route: LibreChat has none for it', async () => {
    expect(await refreshAdminToken('saml-rt', 'saml', 'user-1')).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the refresh token Google rotated in the session', async () => {
    sessionState.data = {
      token: 'cur',
      refreshToken: 'google-rt1',
      tokenProvider: 'google',
      user: { id: 'u' },
      expiresAt: Date.now() + 1_000,
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: 'google-jwt', refreshToken: 'google-rt2', expiresAt: 4242 }),
    );

    const result = await ensureFreshBearer(30_000);

    expect(result).toBe('google-jwt');
    expect(fetchMock.mock.calls[0][0]).toBe('http://lc.test/api/admin/oauth/refresh');
    expect(updateSpy.mock.calls[0][0]).toMatchObject({
      token: 'google-jwt',
      refreshToken: 'google-rt2',
      expiresAt: 4242,
    });
  });
});

describe('refreshAdminTokenDeduped', () => {
  it('coalesces concurrent calls sharing the same refresh token into a single request', async () => {
    let resolveFn: ((value: Response) => void) | undefined;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          resolveFn = resolve;
        }),
    );

    const a = refreshAdminTokenDeduped('rt-shared', 'openid', 'user-1');
    const b = refreshAdminTokenDeduped('rt-shared', 'openid', 'user-1');

    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFn?.(jsonResponse(200, { token: 'new-jwt', refreshToken: 'rt2' }));

    const [resA, resB] = await Promise.all([a, b]);
    expect(resA).toEqual(resB);
    expect(resA?.token).toBe('new-jwt');
  });

  it('does not coalesce when userId differs even with the same refresh token', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-user-1' }))
      .mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-user-2' }));

    const a = refreshAdminTokenDeduped('rt-shared', 'openid', 'user-1');
    const b = refreshAdminTokenDeduped('rt-shared', 'openid', 'user-2');

    const [resA, resB] = await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resA?.token).toBe('jwt-user-1');
    expect(resB?.token).toBe('jwt-user-2');
  });

  it('does not coalesce when tokenProvider differs', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-openid' }))
      .mockResolvedValueOnce(jsonResponse(200, { token: 'jwt-librechat' }));

    const a = refreshAdminTokenDeduped('rt-shared', 'openid', 'user-1');
    const b = refreshAdminTokenDeduped('rt-shared', 'librechat', 'user-1');

    const [resA, resB] = await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resA?.token).toBe('jwt-openid');
    expect(resB?.token).toBe('jwt-librechat');
  });

  it('does not coalesce when tenant header differs between concurrent calls', async () => {
    fetchMock
      .mockImplementationOnce(async () => jsonResponse(200, { token: 'jwt-tenant-a' }))
      .mockImplementationOnce(async () => jsonResponse(200, { token: 'jwt-tenant-b' }));

    tenantHeader.value = 'tenant-a';
    const a = refreshAdminTokenDeduped('rt-shared', 'openid', 'user-1');
    tenantHeader.value = 'tenant-b';
    const b = refreshAdminTokenDeduped('rt-shared', 'openid', 'user-1');

    const [resA, resB] = await Promise.all([a, b]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(resA?.token).toBe('jwt-tenant-a');
    expect(resB?.token).toBe('jwt-tenant-b');
  });
});

describe('ensureFreshBearer', () => {
  it('returns the existing token when expiresAt is far in the future', async () => {
    sessionState.data = {
      token: 'cur',
      refreshToken: 'rt',
      tokenProvider: 'openid',
      user: { id: 'u' },
      expiresAt: Date.now() + 60 * 60_000,
    };

    const result = await ensureFreshBearer(30_000);

    expect(result).toBe('cur');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('refreshes proactively when expiresAt falls inside the skew window', async () => {
    sessionState.data = {
      token: 'cur',
      refreshToken: 'rt-old',
      tokenProvider: 'openid',
      user: { id: 'u' },
      expiresAt: Date.now() + 1_000,
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: 'cur-fresh', refreshToken: 'rt-rotated', expiresAt: 12345 }),
    );

    const result = await ensureFreshBearer(30_000);

    expect(result).toBe('cur-fresh');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0]).toMatchObject({
      token: 'cur-fresh',
      refreshToken: 'rt-rotated',
      expiresAt: 12345,
    });
  });

  it('persists the inbound refresh token when the IdP does not rotate', async () => {
    sessionState.data = {
      token: 'cur',
      refreshToken: 'rt-stable',
      tokenProvider: 'openid',
      user: { id: 'u' },
      expiresAt: Date.now() + 1_000,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: 'cur-fresh' }));

    await ensureFreshBearer(30_000);

    expect(updateSpy.mock.calls[0][0]).toMatchObject({ refreshToken: 'rt-stable' });
  });

  it('returns the stale token when refresh fails', async () => {
    sessionState.data = {
      token: 'cur',
      refreshToken: 'rt',
      tokenProvider: 'openid',
      user: { id: 'u' },
      expiresAt: Date.now() + 1_000,
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: 'nope' }));

    const result = await ensureFreshBearer(30_000);

    expect(result).toBe('cur');
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it('returns undefined when no token and no refreshToken are present', async () => {
    sessionState.data = {};
    const result = await ensureFreshBearer(30_000);
    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('refreshOn401', () => {
  it('forces a refresh attempt and persists the new tokenset', async () => {
    sessionState.data = {
      token: 'cur',
      refreshToken: 'rt-old',
      tokenProvider: 'openid',
      user: { id: 'u' },
      expiresAt: Date.now() + 5 * 60_000,
    };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { token: 'cur-fresh', refreshToken: 'rt-rotated', expiresAt: 99 }),
    );

    const result = await refreshOn401();

    expect(result).toBe('cur-fresh');
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy.mock.calls[0][0]).toMatchObject({
      token: 'cur-fresh',
      refreshToken: 'rt-rotated',
      expiresAt: 99,
    });
  });

  it('returns undefined when there is no refresh token', async () => {
    sessionState.data = { token: 'cur' };
    const result = await refreshOn401();
    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
