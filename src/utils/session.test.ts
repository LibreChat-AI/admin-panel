import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rememberPostLoginRedirect, takePostLoginRedirect, watchGatewaySessionEnd } from './session';

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function createTarget(respond: () => Response) {
  const reload = vi.fn();
  const fetchMock = vi.fn(async () => respond());
  const target = { fetch: fetchMock as typeof fetch, location: { reload } };
  watchGatewaySessionEnd(target);
  return { target, reload, fetchMock };
}

describe('watchGatewaySessionEnd', () => {
  it('reloads once when concurrent requests find the gateway session ended', async () => {
    const { target, reload } = createTarget(() =>
      jsonResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401),
    );
    const responses = await Promise.all([
      target.fetch('/_serverFn/verify'),
      target.fetch('/_serverFn/users'),
      target.fetch('/_serverFn/groups'),
    ]);
    expect(responses.map(({ status }) => status)).toEqual([401, 401, 401]);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('leaves the response body readable for the caller', async () => {
    const { target } = createTarget(() => jsonResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401));
    const response = await target.fetch('/_serverFn/verify');
    await expect(response.json()).resolves.toEqual({ code: 'AUTHENTICATION_REQUIRED' });
  });

  it.each([
    ['a LibreChat 401 without the gateway code', () => jsonResponse({ message: 'Unauthorized' }, 401)],
    ['a non-JSON 401', () => new Response('Unauthorized', { status: 401 })],
    ['access denied', () => jsonResponse({ code: 'ACCESS_DENIED' }, 403)],
    ['an unavailable sign-in service', () => jsonResponse({ code: 'AUTHENTICATION_SERVICE_UNAVAILABLE' }, 503)],
    ['a successful response', () => jsonResponse({ ok: true }, 200)],
  ])('does not reload for %s', async (_, respond) => {
    const { target, reload } = createTarget(respond);
    await target.fetch('/_serverFn/verify');
    expect(reload).not.toHaveBeenCalled();
  });

  it('wraps fetch only once per window', async () => {
    const { target, fetchMock } = createTarget(() => jsonResponse({ ok: true }, 200));
    watchGatewaySessionEnd(target);
    await target.fetch('/_serverFn/verify');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('post-login redirect', () => {
  beforeEach(() => sessionStorage.clear());

  it('returns the remembered page once', () => {
    rememberPostLoginRedirect('/users?search=ada');
    expect(takePostLoginRedirect()).toBe('/users?search=ada');
    expect(takePostLoginRedirect()).toBe('/');
  });

  it.each([['//evil.example'], ['/\\evil.example'], ['https://evil.example'], ['users']])(
    'ignores the unsafe path %s',
    (path) => {
      rememberPostLoginRedirect(path);
      expect(takePostLoginRedirect()).toBe('/');
    },
  );

  it('ignores a tampered stored path', () => {
    sessionStorage.setItem('admin-panel:post-login-redirect', '//evil.example');
    expect(takePostLoginRedirect()).toBe('/');
  });
});
