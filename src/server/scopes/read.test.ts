import { PrincipalType } from 'librechat-data-provider';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type * as t from '@/types';
import { describeApiError } from '@/utils';

/** The API client's error wording, without its session layer. */
function apiErrorBodyMessage(body: t.ApiErrorBody, status: number, fallback: string): string {
  return describeApiError(body) ?? body.error ?? body.message ?? `${fallback}: ${status}`;
}

interface FakeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<object>;
}

interface FakeCall {
  url: string;
  method: string;
  body?: string;
}

type Route = [RegExp, (call: FakeCall) => [number, object]];

interface FakeGroup {
  _id: string;
  name: string;
  memberIds: string[];
}

const calls: FakeCall[] = [];
let routes: Route[] = [];

function reply(status: number, body: object): FakeResponse {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

vi.mock('../utils/api', async () => ({
  apiErrorMessage: async (response: Response, fallback: string) =>
    apiErrorBodyMessage(await response.json(), response.status, fallback),
  apiErrorBodyMessage,
  apiFetch: vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
    const call = { url, method: init?.method ?? 'GET', body: init?.body };
    calls.push(call);
    const route = routes.find(([pattern]) => pattern.test(`${call.method} ${url}`));
    if (!route) return reply(404, { error: 'not found' });
    return reply(...route[1](call));
  }),
}));

vi.mock('../capabilities', () => ({
  requireAnyCapability: vi.fn(async () => undefined),
  requireCapability: vi.fn(async () => undefined),
  requireAllSectionCapabilities: vi.fn(async () => undefined),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: () => ({
      handler: (fn: (...args: object[]) => object) => fn,
    }),
    handler: (fn: (...args: object[]) => object) => fn,
  }),
}));

import { createScopeFn, setScopePriorityFn, getAvailableScopesFn } from './read';
import { apiFetch } from '../utils/api';

const BOB = '6ac3e10890468262c2267093';
const ENG = '6ac3e10d90468262c22670b0';

const configs = [
  {
    _id: 'base',
    principalType: 'role',
    principalId: '__base__',
    priority: 0,
    isActive: true,
    overrides: { balance: { startBalance: 1 } },
  },
  {
    _id: 'c-user',
    principalType: 'user',
    principalId: BOB,
    priority: 100,
    isActive: true,
    overrides: { interface: { parameters: false }, webSearch: { tavilyApiKeyPreview: '...5555' } },
    tombstones: ['balance.startBalance'],
  },
  {
    _id: 'c-eng',
    principalType: 'group',
    principalId: ENG,
    priority: 20,
    isActive: false,
    overrides: { mcpServers: { docs: { type: 'sse', url: 'https://d' } }, actions: {} },
  },
  {
    _id: 'c-role',
    principalType: 'role',
    principalId: 'USER',
    priority: 10,
    isActive: true,
    overrides: {
      endpoints: {
        custom: [
          { name: 'Claude', modelDisplayLabel: 'Claude (USER)' },
          { name: 'Gemini', iconURL: 'https://g.example/i.png', apiKeyPreview: '...6666' },
        ],
      },
    },
  },
];

const OBJECT_ID = /^[a-f0-9]{24}$/;

/** The admin groups list (paged by limit and offset) and by-id routes over `groups`. */
function groupRoutes(groups: FakeGroup[]): Route[] {
  const byId = new Map(groups.map((group) => [group._id, group]));
  return [
    [
      /^GET \/api\/admin\/groups\?/,
      (call) => {
        const params = new URL(call.url, 'http://x').searchParams;
        const offset = Number(params.get('offset'));
        const limit = Number(params.get('limit'));
        return [200, { groups: groups.slice(offset, offset + limit), total: groups.length }];
      },
    ],
    [
      /^GET \/api\/admin\/groups\/[^/?]+$/,
      (call) => {
        const id = call.url.slice('/api/admin/groups/'.length);
        if (!OBJECT_ID.test(id)) return [400, { error: 'Invalid group ID format' }];
        const group = byId.get(id);
        return group ? [200, { group }] : [404, { error: 'Group not found' }];
      },
    ],
  ];
}

function userPage(offset: number) {
  const filler = Array.from({ length: 200 }, (_, i) => ({
    id: `filler-${offset + i}`,
    name: `Filler ${i}`,
    email: `f${i}@x`,
  }));
  return offset === 0
    ? { users: filler, total: 201 }
    : { users: [{ id: BOB, name: 'Bob Test', email: 'bob@test.local' }], total: 201 };
}

beforeEach(() => {
  calls.length = 0;
  routes = [
    [/^GET \/api\/admin\/config$/, () => [200, { configs }]],
    ...groupRoutes([{ _id: ENG, name: 'Engineering', memberIds: ['a', 'b', 'c'] }]),
    [
      /^GET \/api\/admin\/users\?/,
      (call) => [200, userPage(Number(new URL(call.url, 'http://x').searchParams.get('offset')))],
    ],
    [/^GET \/api\/admin\/roles\/USER\/members/, () => [200, { members: [], total: 7 }]],
  ];
});

describe('getAvailableScopesFn', () => {
  it('names users with their email, counts members and lists override paths, entries and stored secrets', async () => {
    const { scopes } = await getAvailableScopesFn();
    expect(scopes).toEqual([
      {
        _id: 'c-user',
        principalType: 'user',
        principalId: BOB,
        name: 'Bob Test',
        email: 'bob@test.local',
        priority: 100,
        isActive: true,
        overridePaths: ['interface.parameters'],
        overrideEntries: {},
        overrideEntryPaths: {},
        storedSecrets: [{ path: 'webSearch.tavilyApiKey' }],
        tombstones: ['balance.startBalance'],
      },
      {
        _id: 'c-eng',
        principalType: 'group',
        principalId: ENG,
        name: 'Engineering',
        memberCount: 3,
        priority: 20,
        isActive: false,
        overridePaths: ['mcpServers.docs.type', 'mcpServers.docs.url'],
        overrideEntries: {},
        overrideEntryPaths: {},
        storedSecrets: [],
        tombstones: [],
      },
      {
        _id: 'c-role',
        principalType: 'role',
        principalId: 'USER',
        name: 'USER',
        memberCount: 7,
        priority: 10,
        isActive: true,
        overridePaths: ['endpoints.custom'],
        overrideEntries: { 'endpoints.custom': ['Claude', 'Gemini'] },
        overrideEntryPaths: {
          'endpoints.custom': { Claude: ['modelDisplayLabel'], Gemini: ['iconURL'] },
        },
        storedSecrets: [
          { path: 'apiKey', entry: { collection: 'endpoints.custom', identity: 'Gemini' } },
        ],
        tombstones: [],
      },
    ]);
    const userPages = calls.filter((c) => c.url.startsWith('/api/admin/users'));
    expect(userPages.map((c) => c.url)).toEqual([
      '/api/admin/users?limit=200&offset=0',
      '/api/admin/users?limit=200&offset=200',
    ]);
  });

  it('falls back to the principal id when the directory cannot be read', async () => {
    routes = routes.map(([pattern, handler]) =>
      pattern.source.includes('users') || pattern.source.includes('groups')
        ? [pattern, () => [403, { error: 'Insufficient permissions' }]]
        : [pattern, handler],
    );
    const { scopes } = await getAvailableScopesFn();
    expect(scopes.map((s) => s.name)).toEqual([BOB, ENG, 'USER']);
    expect(scopes[0].email).toBeUndefined();
  });

  it('skips the directory entirely when there are no user or group profiles', async () => {
    routes[0] = [/^GET \/api\/admin\/config$/, () => [200, { configs: [configs[3]] }]];
    await getAvailableScopesFn();
    expect(calls.some((c) => /users|groups/.test(c.url))).toBe(false);
  });
});

/** Runs `run` with every request held for a macrotask; the most requests that were in flight at once. */
async function peakConcurrency(run: () => Promise<void>): Promise<number> {
  const fake = vi.mocked(apiFetch).getMockImplementation();
  if (!fake) throw new Error('apiFetch is not faked');
  let inFlight = 0;
  let peak = 0;
  vi.mocked(apiFetch).mockImplementation(async (url, init) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 0));
    inFlight--;
    return fake(url, init);
  });
  try {
    await run();
  } finally {
    vi.mocked(apiFetch).mockImplementation(fake);
  }
  return peak;
}

describe('getAvailableScopesFn group names', () => {
  const DIRECTORY_SIZE = 2_105;
  const groupId = (index: number) => index.toString(16).padStart(24, '0');
  const directory: FakeGroup[] = Array.from({ length: DIRECTORY_SIZE }, (_, index) => ({
    _id: groupId(index),
    name: `Group ${index}`,
    memberIds: ['m1', 'm2'],
  }));
  const groupProfile = (principalId: string) => ({
    _id: `c-${principalId}`,
    principalType: 'group',
    principalId,
    priority: 20,
    isActive: true,
    overrides: {},
  });

  function serveProfiles(principalIds: string[], groups: FakeGroup[] = directory) {
    routes = [
      [/^GET \/api\/admin\/config$/, () => [200, { configs: principalIds.map(groupProfile) }]],
      ...groupRoutes(groups),
    ];
  }

  const groupCalls = () =>
    calls.filter((c) => c.url.startsWith('/api/admin/groups')).map((c) => c.url);
  const listPages = (count: number) =>
    Array.from({ length: count }, (_, page) => `/api/admin/groups?limit=200&offset=${page * 200}`);

  it('names a group that sits past the first 2,000 of the directory', async () => {
    const id = groupId(2_050);
    serveProfiles([id]);
    const { scopes } = await getAvailableScopesFn();
    expect(scopes[0]).toMatchObject({ principalId: id, name: 'Group 2050', memberCount: 2 });
    expect(groupCalls()).toEqual([`/api/admin/groups/${id}`]);
  });

  it('walks the directory for many group profiles and reads by id only those past its page cap', async () => {
    const inWalk = Array.from({ length: 11 }, (_, i) => groupId(i * 180));
    const pastCap = groupId(DIRECTORY_SIZE - 1);
    serveProfiles([...inWalk, pastCap]);
    const { scopes } = await getAvailableScopesFn();
    expect(scopes.map((s) => s.name)).toEqual([
      ...inWalk.map((_, i) => `Group ${i * 180}`),
      `Group ${DIRECTORY_SIZE - 1}`,
    ]);
    expect(groupCalls()).toEqual([...listPages(10), `/api/admin/groups/${pastCap}`]);
  });

  it('reads at most ten groups by id at a time', async () => {
    const pastCap = Array.from({ length: 25 }, (_, i) => groupId(2_000 + i));
    serveProfiles(pastCap);
    const peak = await peakConcurrency(async () => {
      const { scopes } = await getAvailableScopesFn();
      expect(scopes.map((s) => s.name)).toEqual(pastCap.map((_, i) => `Group ${2_000 + i}`));
    });
    expect(peak).toBe(10);
    expect(groupCalls().filter((url) => !url.includes('?'))).toHaveLength(25);
  });

  it('falls back to the id of a deleted group without walking the directory', async () => {
    const deleted = 'ffffffffffffffffffffffff';
    serveProfiles([deleted]);
    const { scopes } = await getAvailableScopesFn();
    expect(scopes[0].name).toBe(deleted);
    expect(scopes[0].memberCount).toBeUndefined();
    expect(groupCalls()).toEqual([`/api/admin/groups/${deleted}`]);
  });

  it('reads nothing by id that a fully walked directory lacks', async () => {
    const deleted = 'ffffffffffffffffffffffff';
    const listed = Array.from({ length: 11 }, (_, i) => groupId(i * 25));
    serveProfiles([...listed, deleted], directory.slice(0, 300));
    const { scopes } = await getAvailableScopesFn();
    expect(scopes.at(-1)?.name).toBe(deleted);
    expect(scopes[10].name).toBe('Group 250');
    expect(groupCalls()).toEqual(listPages(2));
  });

  it('makes no group request for a legacy id that is not an ObjectId', async () => {
    serveProfiles(['grp_legacy_team']);
    const { scopes } = await getAvailableScopesFn();
    expect(scopes[0].name).toBe('grp_legacy_team');
    expect(groupCalls()).toEqual([]);
  });
});

describe('createScopeFn', () => {
  it.each([
    [PrincipalType.ROLE, 'USER', 10],
    [PrincipalType.GROUP, ENG, 20],
    [PrincipalType.USER, BOB, 100],
  ])('creates a %s profile at the documented default priority', async (type, id, priority) => {
    routes.push([/^GET \/api\/admin\/roles\//, () => [200, { role: { name: id } }]]);
    routes.push([
      /^PUT \/api\/admin\/config\//,
      (call) => [
        201,
        {
          config: {
            _id: 'new',
            principalType: type,
            principalId: id,
            priority: JSON.parse(call.body ?? '{}').priority,
            isActive: true,
            overrides: {},
          },
        },
      ],
    ]);
    const { scope } = await createScopeFn({
      data: { principalType: type, principalId: id, name: 'Name' },
    });
    const put = calls.find((c) => c.method === 'PUT');
    expect(JSON.parse(put?.body ?? '{}')).toEqual({ overrides: {}, priority });
    expect(scope).toMatchObject({ _id: 'new', name: 'Name', priority, principalId: id });
  });

  it('refuses a profile for a role that does not exist', async () => {
    await expect(
      createScopeFn({
        data: { principalType: PrincipalType.ROLE, principalId: 'NO_SUCH_ROLE', name: 'X' },
      }),
    ).rejects.toThrow('There is no role named "NO_SUCH_ROLE"');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('returns an existing profile instead of replacing its overrides', async () => {
    routes.push([/^GET \/api\/admin\/config\/group\//, () => [200, { config: configs[2] }]]);
    const { scope } = await createScopeFn({
      data: { principalType: PrincipalType.GROUP, principalId: ENG, name: 'Engineering' },
    });
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(scope).toMatchObject({ _id: 'c-eng', priority: 20, isActive: false });
  });
});

describe('createScopeFn with expectedRevision', () => {
  const created = (call: FakeCall): [number, object] => [
    201,
    {
      config: {
        _id: 'new',
        principalType: 'role',
        principalId: 'EDITORS',
        priority: JSON.parse(call.body ?? '{}').priority,
        isActive: true,
        overrides: {},
      },
    },
  ];
  const meta = (features: Record<string, boolean>) =>
    routes.push([/^GET \/api\/admin\/config\/meta$/, () => [200, { features }]]);

  it('creates the profile with one create-only PUT, without reading it or the role first', async () => {
    meta({ expectedRevision: true, principalCheck: true });
    routes.push([/^PUT \/api\/admin\/config\/role\/EDITORS$/, created]);
    const { scope } = await createScopeFn({
      data: { principalType: PrincipalType.ROLE, principalId: 'EDITORS', name: 'EDITORS' },
    });
    expect(scope).toMatchObject({ _id: 'new', priority: 10 });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /api/admin/config/meta',
      'PUT /api/admin/config/role/EDITORS',
    ]);
    expect(JSON.parse(calls[1].body ?? '{}')).toEqual({
      overrides: {},
      priority: 10,
      expectedRevision: 'absent',
    });
  });

  it('opens the profile someone created meanwhile instead of replacing it (409)', async () => {
    meta({ expectedRevision: true, principalCheck: true });
    routes.push([
      /^PUT /,
      () => [409, { code: 'CONFIG_VERSION_CONFLICT', currentRevision: 'c-eng:3' }],
    ]);
    routes.push([/^GET \/api\/admin\/config\/group\//, () => [200, { config: configs[2] }]]);
    const { scope } = await createScopeFn({
      data: { principalType: PrincipalType.GROUP, principalId: ENG, name: 'Engineering' },
    });
    expect(scope).toMatchObject({ _id: 'c-eng', priority: 20 });
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(1);
  });

  it('says the role does not exist when the server refuses the principal', async () => {
    meta({ expectedRevision: true, principalCheck: true });
    routes.push([
      /^PUT /,
      () => [404, { error: 'Principal not found', code: 'PRINCIPAL_NOT_FOUND' }],
    ]);
    await expect(
      createScopeFn({
        data: { principalType: PrincipalType.ROLE, principalId: 'GONE', name: 'GONE' },
      }),
    ).rejects.toThrow('There is no role named "GONE"');
    await expect(
      createScopeFn({ data: { principalType: PrincipalType.GROUP, principalId: ENG, name: 'E' } }),
    ).rejects.toThrow(/doesn't exist/);
  });

  it('still looks the role up first on a server without the principal check', async () => {
    meta({ expectedRevision: true });
    await expect(
      createScopeFn({
        data: { principalType: PrincipalType.ROLE, principalId: 'NO_SUCH_ROLE', name: 'X' },
      }),
    ).rejects.toThrow('There is no role named "NO_SUCH_ROLE"');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });
});

describe('setScopePriorityFn', () => {
  it('sets only the priority through the priority route', async () => {
    routes.push([
      /^PATCH \/api\/admin\/config\/group\/[^/]+\/priority$/,
      (call) => [
        200,
        { config: { ...configs[2], priority: JSON.parse(call.body ?? '{}').priority } },
      ],
    ]);
    await expect(
      setScopePriorityFn({
        data: { principalType: PrincipalType.GROUP, principalId: ENG, priority: 15 },
      }),
    ).resolves.toEqual({ priority: 15 });
    expect(calls).toEqual([
      {
        url: `/api/admin/config/group/${ENG}/priority`,
        method: 'PATCH',
        body: JSON.stringify({ priority: 15 }),
      },
    ]);
  });

  it("words the server's refusal", async () => {
    routes.push([
      /^PATCH /,
      () => [400, { error: 'priority must be a non-negative number', code: 'INVALID_PRIORITY' }],
    ]);
    await expect(
      setScopePriorityFn({
        data: { principalType: PrincipalType.GROUP, principalId: ENG, priority: 15 },
      }),
    ).rejects.toThrow('The priority must be a number of 0 or more.');
  });
});
