import { PrincipalType } from 'librechat-data-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as t from '@/types';

const apiFetchMock = vi.fn();

vi.mock('../utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: () => ({ handler: (fn: (...args: never[]) => unknown) => fn }),
    handler: (fn: (...args: never[]) => unknown) => fn,
  }),
}));

vi.mock('@tanstack/react-query', () => ({ queryOptions: (opts: unknown) => opts }));

import { getResolvedConfigFn } from '../scopes/resolved';
import { getBaseConfigFn } from './base';

function reply(status: number, body?: object): Response {
  return new Response(body ? JSON.stringify(body) : null, { status });
}

const yaml = { balance: { startBalance: 1000 } };

/** Answers the base reads: the merged base, librechat.yaml alone, and the base document (no meta route). */
function serveBase(doc: Response) {
  apiFetchMock.mockImplementation((path: string) => {
    if (path === '/api/admin/config/meta') return reply(404);
    if (path.startsWith('/api/admin/config/base')) return reply(200, { config: yaml });
    return doc;
  });
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('the revision of the stored document (expectedRevision)', () => {
  it('reads the base document revision', async () => {
    serveBase(reply(200, { config: { overrides: {}, tombstones: [], revision: '6adb:7' } }));
    const data = await getBaseConfigFn();
    expect(data.dbRevision).toBe('6adb:7');
  });

  it('reads no base document as a null revision', async () => {
    serveBase(reply(404, { error: 'Config not found' }));
    const data = await getBaseConfigFn();
    expect(data).toMatchObject({ dbOverrides: undefined, dbRevision: null });
  });

  it('leaves the revision out where the server reports none', async () => {
    serveBase(reply(200, { config: { overrides: {}, tombstones: [] } }));
    const data = await getBaseConfigFn();
    expect(data).not.toHaveProperty('dbRevision');
  });

  it("reads a profile document's revision", async () => {
    apiFetchMock.mockResolvedValue(
      reply(200, { config: { overrides: { balance: { startBalance: 5 } }, revision: 'eng:3' } }),
    );
    const data = await getResolvedConfigFn({
      data: { principalType: PrincipalType.GROUP, principalId: 'eng' },
    });
    expect(data).toMatchObject({ revision: 'eng:3', changedPaths: ['balance.startBalance'] });
  });
});

describe('values LibreChat derives, read as written', () => {
  const raw = {
    endpoints: {
      azureOpenAI: {
        groups: [
          {
            group: 'eastus',
            apiKey: '${EASTUS_API_KEY}',
            instanceName: 'eastus',
            version: 'v1',
            models: { a: true },
          },
        ],
      },
    },
  };
  /** The served Azure block: groups resolved into `groupMap`, unset values filled in. */
  const served = {
    endpoints: {
      azureOpenAI: {
        isValid: true,
        groupMap: {
          eastus: { apiKey: '${EASTUS_API_KEY}', instanceName: 'eastus', baseURL: '', models: {} },
          west: { apiKeyPreview: '...12', instanceName: 'west', baseURL: '', models: {} },
        },
        modelNames: ['a', 'b'],
      },
    },
  };
  const doc = {
    config: {
      overrides: {
        endpoints: {
          azureOpenAI: {
            groups: [
              { group: 'west', apiKeyPreview: '...12', instanceName: 'west', models: { b: true } },
            ],
          },
        },
      },
      tombstones: [],
    },
  };

  function serve(meta: Response) {
    apiFetchMock.mockImplementation((path: string) => {
      if (path === '/api/admin/config/meta') return meta;
      if (path.startsWith('/api/admin/config/base')) {
        return reply(200, { config: { ...served, config: raw } });
      }
      return reply(200, doc);
    });
  }

  it('reads the Azure groups as written, with the base overrides merged by name, where LibreChat derives them', async () => {
    serve(
      reply(200, {
        features: { endpointRederive: true, azureGroupMergeKey: true, azureGroupSecrets: true },
        rules: {
          arrayMergeKeys: { 'endpoints.custom': 'name', 'endpoints.azureOpenAI.groups': 'group' },
        },
      }),
    );
    const data = await getBaseConfigFn();
    expect(data.yamlConfig?.endpoints).toEqual({
      azureOpenAI: { groups: raw.endpoints.azureOpenAI.groups },
    });
    expect(data.config.endpoints).toEqual({
      azureOpenAI: {
        groups: [
          raw.endpoints.azureOpenAI.groups[0],
          { group: 'west', apiKeyPreview: '...12', instanceName: 'west', models: { b: true } },
        ],
      },
    });
  });

  it('rebuilds the groups from what LibreChat serves on a server without the meta route', async () => {
    serve(reply(404));
    const data = await getBaseConfigFn();
    const groups = (data.config.endpoints as t.ConfigRecord).azureOpenAI as t.ConfigRecord;
    expect(groups.groups).toEqual([
      {
        group: 'eastus',
        apiKey: '${EASTUS_API_KEY}',
        instanceName: 'eastus',
        baseURL: '',
        models: {},
      },
      { group: 'west', apiKeyPreview: '...12', instanceName: 'west', baseURL: '', models: {} },
    ]);
  });
});
