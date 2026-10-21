import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  pollGatewaySession,
  watchGatewaySessionEnd,
  takePostLoginRedirect,
  rememberPostLoginRedirect,
} from './session';

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

describe('pollGatewaySession', () => {
  function createPollTarget(respond: (init?: RequestInit) => Response | Promise<Response>) {
    const windowEvents = new EventTarget();
    const documentEvents = new EventTarget();
    const reload = vi.fn();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => respond(init));
    const document = {
      visibilityState: 'visible' as DocumentVisibilityState,
      addEventListener: documentEvents.addEventListener.bind(documentEvents),
      removeEventListener: documentEvents.removeEventListener.bind(documentEvents),
    };
    const target = {
      fetch: fetchMock as typeof fetch,
      location: { reload },
      document,
      addEventListener: windowEvents.addEventListener.bind(windowEvents),
      removeEventListener: windowEvents.removeEventListener.bind(windowEvents),
    };
    watchGatewaySessionEnd(target);
    const stop = pollGatewaySession(target);
    return { reload, fetchMock, document, windowEvents, documentEvents, stop };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    return () => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    };
  });

  it('checks the gateway session every thirty seconds without reloading an active page', async () => {
    const { fetchMock, reload, stop } = createPollTarget(() => new Response(null, { status: 204 }));
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock).toHaveBeenCalledWith('/_sso/session', {
      cache: 'no-store',
      signal: expect.any(AbortSignal),
    });
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it('reloads once the gateway reports the session ended', async () => {
    const { reload, stop } = createPollTarget(() =>
      jsonResponse({ code: 'AUTHENTICATION_REQUIRED' }, 401),
    );
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reload).toHaveBeenCalledTimes(1);
    stop();
  });

  it('keeps the page while the sign-in service is unavailable', async () => {
    const { reload, stop } = createPollTarget(() =>
      jsonResponse({ code: 'AUTHENTICATION_SERVICE_UNAVAILABLE' }, 503),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it('checks when the window regains focus or the tab becomes visible', async () => {
    const { fetchMock, document, windowEvents, documentEvents, stop } = createPollTarget(
      () => new Response(null, { status: 204 }),
    );
    windowEvents.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    document.visibilityState = 'hidden';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    document.visibilityState = 'visible';
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
  });

  it('shares one request between focus and visibility events', async () => {
    const { fetchMock, windowEvents, documentEvents, stop } = createPollTarget(
      () => new Response(null, { status: 204 }),
    );
    windowEvents.dispatchEvent(new Event('focus'));
    documentEvents.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('skips checks while one is still pending', async () => {
    const { fetchMock, windowEvents, stop } = createPollTarget(() => new Promise(() => undefined));
    await vi.advanceTimersByTimeAsync(9_000);
    windowEvents.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    stop();
  });

  it('gives up on a hung check so later checks still run', async () => {
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), ms);
      return controller.signal;
    });
    const { fetchMock, reload, stop } = createPollTarget(
      (init) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
        }),
    );
    await vi.advanceTimersByTimeAsync(30_000);
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(init?.signal?.aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
    stop();
  });

  it('stops polling once stopped', async () => {
    const { fetchMock, windowEvents, stop } = createPollTarget(
      () => new Response(null, { status: 204 }),
    );
    stop();
    windowEvents.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).not.toHaveBeenCalled();
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
