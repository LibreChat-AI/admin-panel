import { describe, it, expect, vi, beforeEach } from 'vitest';
import { READ_AUDIT_LOG_CAPABILITY } from '@/constants';

/**
 * Tests for the audit-log server functions: the page, a single entry, and
 * the streaming CSV export.
 *
 * Same harness as `capabilities.test.ts`: `createServerFn` is mocked to pass
 * handlers through as-is, so the functions are the real handlers. The
 * `apiFetch` mock is path-aware — it returns the held capability set for the
 * `requireCapability` round-trip, the admin API's JSON for the page and the
 * entry, and a CSV `Response` for the export call, so we exercise the real
 * scoping, parsing and streaming paths.
 */
let heldCaps: string[] = [];

/** An entry a newer LibreChat logs: an action, category and target type the panel doesn't mirror. */
const NEWER_ENTRY = {
  id: '0123456789abcdef01234567',
  schemaVersion: 1,
  category: 'workflow',
  action: 'workflow.started',
  outcome: 'success',
  severity: 'info',
  actor: { type: 'user', id: 'u-admin', name: 'Admin' },
  target: { type: 'workflow', id: 'w-1', name: 'Nightly' },
  integrity: { seq: 2, hash: 'hash', prevHash: 'prev' },
  timestamp: '2026-10-31T12:00:00.000Z',
};

const apiFetchMock = vi.fn(async (path: string, _init?: RequestInit) => {
  if (path.includes('/grants/effective')) {
    return { ok: true, json: async () => ({ capabilities: heldCaps }) } as unknown as Response;
  }
  if (path.includes('/audit-log/export.csv')) {
    return new Response('Timestamp,Action\n2025-01-01T00:00:00Z,grant.assigned\n', {
      status: 200,
      headers: { 'Content-Type': 'text/csv' },
    });
  }
  if (path.startsWith(`/api/admin/audit-log/${NEWER_ENTRY.id}`)) {
    return Response.json({ entry: NEWER_ENTRY });
  }
  if (path.startsWith('/api/admin/audit-log')) {
    return Response.json({ entries: [NEWER_ENTRY], total: 1, nextCursor: null });
  }
  throw new Error(`unexpected apiFetch path: ${path}`);
});

vi.mock('./utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
  extractApiError: vi.fn(async (_res: unknown, msg: string) => {
    throw new Error(msg);
  }),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: (...args: unknown[]) => unknown) => fn,
    validator: () => ({
      handler: (fn: (...args: unknown[]) => unknown) => fn,
    }),
  }),
}));

vi.mock('@tanstack/react-query', () => ({
  queryOptions: (opts: unknown) => opts,
}));

import { exportAuditLogServerFn, getAuditLogEntryFn, getAuditLogPageFn } from './capabilities';

/** The `category` filters of an admin API audit-log request. */
function categoriesOf(path: string | undefined): string[] {
  return new URL(path ?? '', 'http://librechat').searchParams.getAll('category');
}

/** The audit-log request (not the capability check) the last call made. */
function auditRequest(): string | undefined {
  return apiFetchMock.mock.calls.map(([path]) => path).find((path) => path.includes('/audit-log'));
}

describe('getAuditLogPageFn', () => {
  beforeEach(() => {
    heldCaps = [READ_AUDIT_LOG_CAPABILITY];
    apiFetchMock.mockClear();
  });

  it('asks for the grant and Insights categories, so an Insights action filter can match', async () => {
    await getAuditLogPageFn({ data: { action: ['permission.insights_assigned'] } });
    expect(categoriesOf(auditRequest())).toEqual(['grant', 'permission']);
    expect(new URL(auditRequest() ?? '', 'http://librechat').searchParams.getAll('action')).toEqual(
      ['permission.insights_assigned'],
    );
  });

  it('keeps its categories whatever the caller asks for', async () => {
    await getAuditLogPageFn({ data: { category: ['config'] } });
    expect(categoriesOf(auditRequest())).toEqual(['grant', 'permission']);
  });

  it('parses an entry whose action and category the panel does not mirror', async () => {
    const page = await getAuditLogPageFn({ data: {} });
    expect(page.entries).toHaveLength(1);
    expect(page.entries[0]).toMatchObject({ action: 'workflow.started', category: 'workflow' });
  });
});

describe('getAuditLogEntryFn', () => {
  beforeEach(() => {
    heldCaps = [READ_AUDIT_LOG_CAPABILITY];
    apiFetchMock.mockClear();
  });

  it('opens a deep-linked entry whose action and category the panel does not mirror', async () => {
    const { entry } = await getAuditLogEntryFn({ data: { id: NEWER_ENTRY.id } });
    expect(entry).toMatchObject({ action: 'workflow.started', target: { type: 'workflow' } });
  });
});

describe('exportAuditLogServerFn', () => {
  beforeEach(() => {
    heldCaps = [];
    apiFetchMock.mockClear();
  });

  it('streams a text/csv attachment, scoped like the page, when authorized', async () => {
    heldCaps = [READ_AUDIT_LOG_CAPABILITY];

    const res = await exportAuditLogServerFn({ data: {} });

    expect(res).toBeInstanceOf(Response);
    expect(res.headers.get('Content-Type')).toMatch(/text\/csv/);
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="audit-log-/);

    const exportCall = apiFetchMock.mock.calls.find((c) => String(c[0]).includes('export.csv'));
    expect(categoriesOf(exportCall?.[0])).toEqual(['grant', 'permission']);

    // Body is piped through verbatim rather than buffered/re-serialized.
    expect(await res.text()).toContain('grant.assigned');
  });

  it('rejects when READ_AUDIT_LOG is not held', async () => {
    heldCaps = [];
    await expect(exportAuditLogServerFn({ data: {} })).rejects.toThrow();
    expect(apiFetchMock.mock.calls.some((c) => String(c[0]).includes('export.csv'))).toBe(false);
  });
});
