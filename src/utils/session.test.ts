import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { holdSessionRedirects, sessionFetch } from './session';

const fetchMock = vi.fn<typeof fetch>();
const assign = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  assign.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('window', {
    location: { pathname: '/configuration', search: '?scope=base', hash: '', assign },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('sessionFetch', () => {
  it('notifies each draft owner and releases only the matching hold', async () => {
    const onError = vi.fn();
    const first = holdSessionRedirects(onError);
    const second = holdSessionRedirects(onError);
    first();
    first();
    fetchMock.mockResolvedValue(
      new Response('{}', { headers: { 'X-Admin-Session-Error': 'OPENID_SESSION_ENDED' } }),
    );
    try {
      await expect(sessionFetch('/background')).rejects.toThrow('OPENID_SESSION_ENDED');
      expect(onError).toHaveBeenCalledExactlyOnceWith('OPENID_SESSION_ENDED');
      expect(assign).not.toHaveBeenCalled();
    } finally {
      second();
    }
    await expect(sessionFetch('/background')).rejects.toThrow('OPENID_SESSION_ENDED');
    expect(assign).toHaveBeenCalledTimes(1);
  });

  it.each(['OPENID_SESSION_ENDED', 'AUTH_SESSION_CHECK_UNAVAILABLE'])(
    'keeps the save outcome visible during %s and restores redirects after recovery unmounts',
    async (code) => {
      fetchMock.mockResolvedValue(
        new Response('{}', { headers: { 'X-Admin-Session-Error': code } }),
      );
      const release = holdSessionRedirects();
      try {
        await expect(sessionFetch('/_serverFn/background')).rejects.toThrow(code);
        expect(assign).not.toHaveBeenCalled();
      } finally {
        release();
      }
      await expect(sessionFetch('/_serverFn/background')).rejects.toThrow(code);
      expect(assign).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ['OPENID_SESSION_ENDED', 'ended'],
    ['AUTH_SESSION_CHECK_UNAVAILABLE', 'unavailable'],
  ])('handles %s even when the server function returned a fallback', async (code, session) => {
    fetchMock.mockResolvedValue(new Response('{}', { headers: { 'X-Admin-Session-Error': code } }));
    await expect(sessionFetch('/_serverFn/test')).rejects.toThrow(code);
    expect(assign).toHaveBeenCalledWith(
      `/login?session=${session}&redirect=%2Fconfiguration%3Fscope%3Dbase`,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the base path once when returning to the page', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/admin/');
    vi.stubGlobal('window', {
      location: { pathname: '/admin/access', search: '', hash: '', assign },
    });
    fetchMock.mockResolvedValue(
      new Response('{}', {
        headers: { 'X-Admin-Session-Error': 'AUTH_SESSION_CHECK_UNAVAILABLE' },
      }),
    );
    await expect(sessionFetch('/admin/_serverFn/test')).rejects.toThrow();
    expect(assign).toHaveBeenCalledWith('/admin/login?session=unavailable&redirect=%2Faccess');
  });

  it('returns to the base root without adding the prefix twice', async () => {
    vi.stubEnv('VITE_BASE_PATH', '/admin');
    vi.stubGlobal('window', { location: { pathname: '/admin', search: '', hash: '', assign } });
    fetchMock.mockResolvedValue(
      new Response('{}', {
        headers: { 'X-Admin-Session-Error': 'AUTH_SESSION_CHECK_UNAVAILABLE' },
      }),
    );
    await expect(sessionFetch('/admin/_serverFn/test')).rejects.toThrow();
    expect(assign).toHaveBeenCalledWith('/admin/login?session=unavailable&redirect=%2F');
  });

  it('leaves ordinary errors and successful responses with their caller', async () => {
    const response = new Response('{}', { status: 403 });
    fetchMock.mockResolvedValue(response);
    expect(await sessionFetch('/_serverFn/test')).toBe(response);
    expect(assign).not.toHaveBeenCalled();
  });
});
