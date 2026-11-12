import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';

const apiFetchMock = vi.fn();

vi.mock('./utils/api', () => ({
  apiFetch: (path: string) => apiFetchMock(path),
  extractApiError: async () => {
    throw new Error('unexpected');
  },
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: (...args: never[]) => unknown) => fn,
    validator: () => ({ handler: (fn: (...args: never[]) => unknown) => fn }),
  }),
}));

import { allGroupsQueryOptions, getGroupsFn, MAX_SEARCH_LENGTH } from './groups';
import { allRolesQueryOptions } from './roles';

const TOTAL = 250;

/** A list endpoint holding `TOTAL` items that serves `limit`/`offset` pages of them. */
function servePages(key: 'roles' | 'groups') {
  apiFetchMock.mockImplementation(async (path: string) => {
    const params = new URL(path, 'http://admin.test').searchParams;
    const limit = Number(params.get('limit'));
    const offset = Number(params.get('offset') ?? 0);
    const count = Math.max(0, Math.min(limit, TOTAL - offset));
    const items = Array.from({ length: count }, (_, i) => ({
      _id: `id${offset + i}`,
      name: `${key}-${offset + i}`,
      source: 'local',
    }));
    return new Response(JSON.stringify({ [key]: items, total: TOTAL }), { status: 200 });
  });
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('all-principals queries', () => {
  it('reads every page of roles, past the per-request cap', async () => {
    servePages('roles');
    const roles = await new QueryClient().query(allRolesQueryOptions);
    expect(roles).toHaveLength(TOTAL);
    expect(roles.at(-1)?.name).toBe(`roles-${TOTAL - 1}`);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it('reads every page of groups, past the per-request cap', async () => {
    servePages('groups');
    const groups = await new QueryClient().query(allGroupsQueryOptions);
    expect(groups).toHaveLength(TOTAL);
    expect(groups.at(-1)?.id).toBe(`id${TOTAL - 1}`);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('getGroupsFn', () => {
  it('sends at most the 200 search characters the backend accepts', async () => {
    servePages('groups');
    await getGroupsFn({ data: { search: 'x'.repeat(250), limit: 50, offset: 0 } });
    const [path] = apiFetchMock.mock.calls[0] as [string];
    const search = new URL(path, 'http://admin.test').searchParams.get('search');
    expect(MAX_SEARCH_LENGTH).toBe(200);
    expect(search).toBe('x'.repeat(200));
  });
});
