import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as t from '@/types';
import { createFakeAdminApi } from '@/test/admin';

const context = vi.hoisted(() => ({
  headers: new Headers(),
  data: {} as t.SessionData,
}));

vi.mock('@tanstack/react-start', () => ({
  createServerOnlyFn: <T>(fn: T) => fn,
  createServerFn: () => ({
    validator: () => ({ handler: <T>(fn: T) => fn }),
    handler: <T>(fn: T) => fn,
  }),
}));
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeader: () => undefined,
  getResponseHeader: (name: string) => context.headers.get(name),
  setResponseHeader: (name: string, value: string) => context.headers.set(name, value),
  removeResponseHeader: (name: string) => context.headers.delete(name),
}));
vi.mock('../session', () => ({
  useAppSession: async () => ({
    data: context.data,
    update: async (data: Partial<t.SessionData>) => Object.assign(context.data, data),
  }),
}));

import { applyConfigChangesFn } from './save';
import { sessionFetch } from '@/utils';

const started = 1_800_000_000_000;
let now = started;
let expireAfterWrite = true;
let refreshStatus = 503;
let refreshCalls = 0;
let api: ReturnType<typeof createFakeAdminApi>;

beforeEach(() => {
  now = started;
  expireAfterWrite = true;
  refreshStatus = 503;
  refreshCalls = 0;
  context.headers = new Headers();
  context.data = {
    token: 'saved-bearer',
    refreshToken: 'saved-refresh',
    tokenProvider: 'openid',
    expiresAt: started + 60_000,
    user: { id: 'admin', email: 'admin@example.test', name: 'Admin', role: 'ADMIN' },
  };
  api = createFakeAdminApi({
    balance: { enabled: true, startBalance: 1, refillAmount: 2 },
    memory: { tokenLimit: 10 },
  });
  api.reportMeta({
    features: { changesBatch: true, expectedRevision: true, awaitedInvalidation: true },
    limits: { maxChangeOps: 1000 },
  });
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.pathname === '/api/admin/oauth/refresh') {
        refreshCalls++;
        return Response.json(
          {
            error_code:
              refreshStatus === 401 ? 'OPENID_SESSION_ENDED' : 'AUTH_SESSION_CHECK_UNAVAILABLE',
          },
          { status: refreshStatus },
        );
      }
      const response = await api.fetch(`${url.pathname}${url.search}`, init);
      if (expireAfterWrite && init?.method && init.method !== 'GET' && response.ok) {
        now += 60_000;
      }
      return response;
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const save = (ops: t.ConfigChange[]) =>
  applyConfigChangesFn({ data: { target: { type: 'base' }, ops } });

describe('save results after session failures', () => {
  it.each([503, 401])(
    'keeps the completed save after a %s renewal during readback',
    async (status) => {
      refreshStatus = status;
      const result = await save([{ op: 'set', path: 'balance.startBalance', value: 5 }]);

      expect(result).toMatchObject({
        applied: 1,
        failed: [],
        issues: [],
        sessionError: status === 401 ? 'OPENID_SESSION_ENDED' : 'AUTH_SESSION_CHECK_UNAVAILABLE',
      });
      expect(api.stored()).toEqual({ balance: { startBalance: 5 } });
      expect(refreshCalls).toBe(1);
      expect(context.headers.has('X-Admin-Session-Error')).toBe(false);
      expect(context.data.refreshToken).toBe(status === 401 ? undefined : 'saved-refresh');

      const response = Response.json(result, { headers: context.headers });
      vi.mocked(fetch).mockResolvedValueOnce(response);
      const delivered = await sessionFetch('/_serverFn/save');
      expect(await delivered.json()).toEqual(result);
    },
  );

  it('keeps the partial outcome when renewal fails before the next batch', async () => {
    api.reportMeta({
      features: { changesBatch: true, expectedRevision: true, awaitedInvalidation: true },
      limits: { maxChangeOps: 1 },
    });
    const result = await save([
      { op: 'set', path: 'balance.startBalance', value: 5 },
      { op: 'set', path: 'memory.tokenLimit', value: 6 },
    ]);

    expect(result).toMatchObject({
      partiallyWritten: true,
      applied: 0,
      sessionError: 'AUTH_SESSION_CHECK_UNAVAILABLE',
      failed: [{ code: 'WRITE_FAILED', message: 'AUTH_SESSION_CHECK_UNAVAILABLE' }],
    });
    expect(api.stored()).toEqual({ balance: { startBalance: 5 } });
    expect(api.writes()).toHaveLength(1);
    expect(context.headers.has('X-Admin-Session-Error')).toBe(false);
  });

  it('keeps the incomplete rollback result from legacy field writes', async () => {
    api.reportMeta({ limits: { maxPatchEntries: 1 } });
    const result = await save([
      { op: 'set', path: 'balance.startBalance', value: 5 },
      { op: 'set', path: 'memory.tokenLimit', value: 6 },
    ]);

    expect(result).toMatchObject({
      compensated: false,
      applied: 0,
      sessionError: 'AUTH_SESSION_CHECK_UNAVAILABLE',
      failed: [{ code: 'WRITE_FAILED', message: 'AUTH_SESSION_CHECK_UNAVAILABLE' }],
    });
    expect(api.stored()).toEqual({ balance: { startBalance: 5 } });
    expect(api.writes()).toHaveLength(1);
    expect(refreshCalls).toBe(2);
    expect(context.headers.has('X-Admin-Session-Error')).toBe(false);
  });

  it('leaves failures without an operation result for the global interceptor', async () => {
    context.data.expiresAt = started;

    await expect(save([{ op: 'set', path: 'balance.startBalance', value: 5 }])).rejects.toThrow(
      'AUTH_SESSION_CHECK_UNAVAILABLE',
    );
    expect(context.headers.get('X-Admin-Session-Error')).toBe('AUTH_SESSION_CHECK_UNAVAILABLE');
    expect(api.writes()).toHaveLength(0);
  });

  it('does not add session recovery to an ordinary completed save', async () => {
    expireAfterWrite = false;
    const result = await save([{ op: 'set', path: 'balance.startBalance', value: 5 }]);

    expect(result).toMatchObject({ applied: 1, failed: [], issues: [] });
    expect(result.sessionError).toBeUndefined();
    expect(refreshCalls).toBe(0);
  });
});
