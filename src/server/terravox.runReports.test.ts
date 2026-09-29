import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Run-report server fns (usage statistics): query serialization, page fetch,
 * and the export loop's paging/truncation — `createServerFn` mocked to pass
 * handlers through, `apiFetch` serving queued pages.
 */

type QueuedPage = {
  ok?: boolean;
  status?: number;
  body: unknown;
};

let queued: QueuedPage[] = [];

const apiFetchMock = vi.fn(async () => {
  const page = queued.shift();
  if (!page) {
    throw new Error('unexpected apiFetch call');
  }
  return {
    ok: page.ok ?? true,
    status: page.status ?? 200,
    json: async () => page.body,
  };
});

vi.mock('./utils/api', () => ({
  apiFetch: (...args: unknown[]) => apiFetchMock(...args),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: (...args: unknown[]) => unknown) => fn,
    inputValidator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (opts: unknown) => opts,
}));

import {
  RUN_REPORTS_EXPORT_CAP,
  buildRunReportsQuery,
  exportRunReportsFn,
  getRunReportsFn,
} from './terravox';

function report(id: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_sub: 'user-wang',
    username: 'wangjianbo',
    tool_id: 'wangjianbo.toolsdemo',
    version: '1.0.0',
    status: 'succeeded',
    duration_ms: 8500,
    argument_keys: ['text'],
    source: 'toolbox',
    created_at: '2026-09-28T10:00:00Z',
    ...over,
  };
}

describe('buildRunReportsQuery', () => {
  it('always carries paging and drops empty filter values', () => {
    expect(
      buildRunReportsQuery(
        { tool_id: 'wangjianbo.toolsdemo', user_sub: '', since: undefined },
        50,
        100,
      ),
    ).toBe('?limit=50&offset=100&tool_id=wangjianbo.toolsdemo');
  });

  it('with no filters only paging remains', () => {
    expect(buildRunReportsQuery({}, 200, 0)).toBe('?limit=200&offset=0');
  });
});

describe('getRunReportsFn', () => {
  beforeEach(() => {
    queued = [];
    apiFetchMock.mockClear();
  });

  it('hits the proxied admin route with default paging and parses rows', async () => {
    queued.push({ body: { reports: [report('r1', { status: 'failed' })], total: 1 } });
    const result = await getRunReportsFn({ data: { tool_id: 'wangjianbo.toolsdemo' } });
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/terravox/admin/runs/reports?limit=50&offset=0&tool_id=wangjianbo.toolsdemo',
    );
    expect(result.total).toBe(1);
    expect(result.reports[0]).toMatchObject({ id: 'r1', status: 'failed', username: 'wangjianbo' });
  });

  it('applies defaults for optional/missing fields', async () => {
    queued.push({
      body: {
        reports: [{ id: 'r2', user_sub: 'u', tool_id: 't', status: 'timeout', created_at: 't0' }],
        total: 1,
      },
    });
    const result = await getRunReportsFn({ data: {} });
    expect(result.reports[0]).toMatchObject({
      username: '',
      version: null,
      duration_ms: null,
      argument_keys: [],
      source: '',
    });
  });

  it('surfaces gateway error details', async () => {
    queued.push({ ok: false, status: 500, body: { detail: 'boom' } });
    await expect(getRunReportsFn({ data: {} })).rejects.toThrow('boom');
  });
});

describe('exportRunReportsFn', () => {
  beforeEach(() => {
    queued = [];
    apiFetchMock.mockClear();
  });

  it('pages with the 200-row max until a short page, untruncated', async () => {
    const first = Array.from({ length: 200 }, (_, i) => report(`a${i}`));
    const second = Array.from({ length: 150 }, (_, i) => report(`b${i}`));
    queued.push({ body: { reports: first, total: 350 } });
    queued.push({ body: { reports: second, total: 350 } });

    const result = await exportRunReportsFn({ data: { tool_id: 'wangjianbo.toolsdemo' } });

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      1,
      '/api/terravox/admin/runs/reports?limit=200&offset=0&tool_id=wangjianbo.toolsdemo',
    );
    expect(apiFetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/terravox/admin/runs/reports?limit=200&offset=200&tool_id=wangjianbo.toolsdemo',
    );
    expect(result.reports).toHaveLength(350);
    expect(result.truncated).toBe(false);
  });

  it('stops exactly at the 10k cap and flags truncation', async () => {
    /** 50 full pages → 10 000 rows collected, 50 more exist beyond the cap. */
    for (let page = 0; page < 50; page++) {
      queued.push({
        body: {
          reports: Array.from({ length: 200 }, (_, i) => report(`p${page}-${i}`)),
          total: RUN_REPORTS_EXPORT_CAP + 50,
        },
      });
    }

    const result = await exportRunReportsFn({ data: {} });

    expect(apiFetchMock).toHaveBeenCalledTimes(50);
    expect(result.reports).toHaveLength(RUN_REPORTS_EXPORT_CAP);
    expect(result.truncated).toBe(true);
  });

  it('single short page returns immediately without a second round-trip', async () => {
    queued.push({ body: { reports: [report('only')], total: 1 } });
    const result = await exportRunReportsFn({ data: {} });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(result.reports).toHaveLength(1);
    expect(result.truncated).toBe(false);
  });
});
