// @vitest-environment node
import { z } from 'zod';
import { defaults, unseal } from 'iron-webcrypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createServerEntry, getResponseHeaders } from '@tanstack/react-start/server';
import type * as t from '@/types';
import {
  LEGACY_SET_COOKIES,
  LEGACY_SESSION_DATA,
  LEGACY_SESSION_SECRET,
  LEGACY_LOGIN_SESSION_ID,
} from '@/test/sessions';
import { getSessionConfig, useAppSession } from './session';

/** What h3's session layer unseals from the cookie and assigns to its session. */
const sealedRecordSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  data: z.custom<t.SessionData>(),
});

/** Runs `work` inside a real TanStack Start request carrying `cookies`; returns the `Set-Cookie` headers it produced. */
async function inRequest(
  cookies: string[],
  work: (session: t.SessionManager) => Promise<void> | void,
): Promise<string[]> {
  let setCookies: string[] = [];
  const entry = createServerEntry({
    fetch: async () => {
      await work(await useAppSession());
      setCookies = getResponseHeaders().getSetCookie();
      return new Response('ok');
    },
  });
  const cookie = cookies.map((setCookie) => setCookie.split(';')[0]).join('; ');
  await entry.fetch(new Request('http://admin.test/_serverFn/x', { headers: { cookie } }));
  return setCookies;
}

const cookieName = (setCookie: string): string => setCookie.slice(0, setCookie.indexOf('='));
const cookieValue = (setCookie: string): string =>
  setCookie.slice(setCookie.indexOf('=') + 1).split(';')[0];
const valueLength = (setCookie: string): number => cookieValue(setCookie).length;
/** A `Set-Cookie` without its value: the name and every attribute, in order. */
const withoutValue = (setCookie: string): string =>
  `${cookieName(setCookie)}${setCookie.slice(setCookie.indexOf(';'))}`;

/** Unseals written cookies the way the previous layer reads them back. */
async function unsealWritten(setCookies: string[]): Promise<t.SessionRecord> {
  const main = cookieValue(setCookies.find((c) => cookieName(c) === 'admin-session') ?? '');
  const sealed = main.startsWith('__chunked__')
    ? setCookies
        .filter((c) => cookieName(c).startsWith('admin-session.'))
        .map(cookieValue)
        .join('')
    : main;
  return sealedRecordSchema.parse(await unseal(sealed, LEGACY_SESSION_SECRET, defaults));
}

describe('getSessionConfig', () => {
  it('revalidation interval is 60 seconds', () => {
    expect(getSessionConfig().revalidationInterval).toBe(60_000);
  });

  it('idle timeout defaults to 30 minutes', () => {
    expect(getSessionConfig().idleTimeout).toBe(30 * 60 * 1000);
  });
});

describe('useAppSession', () => {
  beforeEach(() => {
    vi.stubEnv('SESSION_SECRET', LEGACY_SESSION_SECRET);
    vi.stubEnv('SESSION_COOKIE_SECURE', 'false');
    vi.stubEnv('VITE_BASE_PATH', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('reads a cookie the TanStack Start 1.168 session layer issued', async () => {
    let data: t.SessionData = {};
    await inRequest(LEGACY_SET_COOKIES.login, (session) => {
      data = { ...session.data };
    });
    expect(data).toEqual(LEGACY_SESSION_DATA.login);
  });

  it('reads a chunked cookie the TanStack Start 1.168 session layer issued', async () => {
    let data: t.SessionData = {};
    await inRequest(LEGACY_SET_COOKIES.chunked, (session) => {
      data = { ...session.data };
    });
    expect(data).toEqual(LEGACY_SESSION_DATA.chunked);
  });

  it('reissues the cookie with the same attributes and an envelope the previous layer reads', async () => {
    const setCookies = await inRequest(LEGACY_SET_COOKIES.login, (session) =>
      session.update({ lastActivity: 1761350460000 }),
    );

    expect(setCookies.map(withoutValue)).toEqual(LEGACY_SET_COOKIES.login.map(withoutValue));
    const written = await unsealWritten(setCookies);
    const previous = await unsealWritten(LEGACY_SET_COOKIES.login);
    expect(written).toEqual({
      id: LEGACY_LOGIN_SESSION_ID,
      createdAt: previous.createdAt,
      data: { ...LEGACY_SESSION_DATA.login, lastActivity: 1761350460000 },
    });
  });

  it('marks the cookie Secure and scopes it to the base path as before', async () => {
    vi.stubEnv('SESSION_COOKIE_SECURE', 'true');
    vi.stubEnv('VITE_BASE_PATH', '/admin');
    const setCookies = await inRequest([], (session) => session.update(LEGACY_SESSION_DATA.login));
    expect(setCookies.map(withoutValue)).toEqual(LEGACY_SET_COOKIES.securePath.map(withoutValue));
  });

  it('issues a new empty session to a request without one, as before', async () => {
    const setCookies = await inRequest([], () => undefined);
    expect(setCookies.map(withoutValue)).toEqual(LEGACY_SET_COOKIES.anonymous.map(withoutValue));
    const written = await unsealWritten(setCookies);
    expect(written.data).toEqual({});
    expect(written.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('chunks a long session into the same cookies as before', async () => {
    const setCookies = await inRequest([], (session) =>
      session.update(LEGACY_SESSION_DATA.chunked),
    );
    expect(setCookies.map(withoutValue)).toEqual(LEGACY_SET_COOKIES.chunked.map(withoutValue));
    expect(cookieValue(setCookies[0])).toBe('__chunked__2');
    expect(setCookies.map(valueLength)).toEqual(LEGACY_SET_COOKIES.chunked.map(valueLength));
    expect((await unsealWritten(setCookies)).data).toEqual(LEGACY_SESSION_DATA.chunked);
  });

  it('expires the chunks of a session that shrinks back to one cookie, as before', async () => {
    const setCookies = await inRequest(LEGACY_SET_COOKIES.chunked, (session) =>
      session.update({
        token: 'short',
        refreshToken: undefined,
        tokenProvider: 'librechat',
        expiresAt: undefined,
      }),
    );
    expect(setCookies.map(withoutValue)).toEqual(LEGACY_SET_COOKIES.shrunk.map(withoutValue));
    expect(setCookies.slice(0, 2).map(cookieValue)).toEqual(['', '']);
    expect((await unsealWritten(setCookies)).data).toEqual({
      user: LEGACY_SESSION_DATA.chunked.user,
      token: 'short',
      tokenProvider: 'librechat',
      lastVerified: LEGACY_SESSION_DATA.chunked.lastVerified,
      lastActivity: LEGACY_SESSION_DATA.chunked.lastActivity,
    });
  });

  it('starts a new session when the cookie was sealed with another secret', async () => {
    vi.stubEnv('SESSION_SECRET', 'another-admin-session-secret-0123456789');
    let data: t.SessionData = { token: 'unset' };
    const setCookies = await inRequest(LEGACY_SET_COOKIES.login, (session) => {
      data = { ...session.data };
    });
    expect(data).toEqual({});
    expect(setCookies).toHaveLength(1);
  });

  it('starts a new session when the cookie was tampered with', async () => {
    const tampered = LEGACY_SET_COOKIES.login.map((c) => c.replace('Fe26.2**', 'Fe26.2**0'));
    let data: t.SessionData = { token: 'unset' };
    await inRequest(tampered, (session) => {
      data = { ...session.data };
    });
    expect(data).toEqual({});
  });

  it('shares one session between every reader and writer of a request', async () => {
    let seen: t.SessionData = {};
    const setCookies = await inRequest(LEGACY_SET_COOKIES.login, async (session) => {
      await session.update({ token: 'rotated' });
      seen = { ...(await useAppSession()).data };
    });
    expect(seen.token).toBe('rotated');
    expect(setCookies).toHaveLength(1);
    expect((await unsealWritten(setCookies)).data.token).toBe('rotated');
  });
});
