import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BUNDLED_CONFIG_RULES, BUNDLED_CONFIG_LIMITS, BUNDLED_CONFIG_CONTRACT } from '@/constants';

const apiFetchMock = vi.fn();

vi.mock('../utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({ handler: (fn: (...args: never[]) => unknown) => fn }),
}));

import { getAdminConfigMetaFn, readConfigContract } from './meta';

/** `GET /api/admin/config/meta` as a LibreChat server with the contract answers it (abridged). */
const META = {
  metaVersion: 1,
  versions: { librechat: 'v0.8.9-rc1', dataProvider: '0.8.528', configSchema: '1.3.18' },
  features: {
    dottedKeys: true,
    webSearchStoredKeys: true,
    roleRenameMovesProfile: true,
    resolvedApi: true,
    catalogApi: true,
    keyedTombstones: true,
    renameHints: true,
  },
  limits: {
    maxPatchEntries: 100,
    maxChangeOps: 1000,
    overrideCacheTtlMs: 60000,
    catalogModelsTtlMs: 90000,
    maxEntryKeyLength: 128,
  },
  rules: {
    arrayMergeKeys: { 'endpoints.custom': 'name', 'endpoints.azureOpenAI.groups': 'group' },
    recordSecretFields: [
      { recordPath: 'mcpServers', secretPath: 'apiKey.key', previewPath: 'apiKey.keyPreview' },
    ],
    titleResolution: 'field',
  },
};

function reply(status: number, body?: object): Response {
  return new Response(body ? JSON.stringify(body) : null, { status });
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('readConfigContract', () => {
  it("reads the server's features, limits and rules", async () => {
    apiFetchMock.mockResolvedValue(reply(200, META));
    const contract = await readConfigContract();
    expect(apiFetchMock).toHaveBeenCalledWith('/api/admin/config/meta', undefined);
    expect(contract.source).toBe('server');
    expect(contract.versions).toEqual(META.versions);
    expect(contract.features).toMatchObject({
      dottedKeys: true,
      webSearchStoredKeys: true,
      roleRenameMovesProfile: true,
      resolvedApi: true,
      catalogApi: true,
      keyedTombstones: true,
      renameHints: true,
      envStatus: false,
      changesBatch: false,
    });
    expect(contract.limits).toEqual(META.limits);
    expect(contract.rules.arrayMergeKeys).toEqual(META.rules.arrayMergeKeys);
    expect(contract.rules.recordSecretFields).toEqual(META.rules.recordSecretFields);
    expect(contract.rules.titleResolution).toBe('field');
    expect(contract.rules.processMcpFields).toEqual(BUNDLED_CONFIG_RULES.processMcpFields);
  });

  it.each([
    ['an older server without the route', 404],
    ['a caller without config read access', 403],
    ['an expired session', 401],
    ['a failing server', 500],
  ])('falls back to the bundled contract for %s', async (_case, status) => {
    apiFetchMock.mockResolvedValue(reply(status, { message: 'Endpoint not found' }));
    await expect(readConfigContract()).resolves.toBe(BUNDLED_CONFIG_CONTRACT);
  });

  it('falls back to the bundled contract when the request throws', async () => {
    apiFetchMock.mockRejectedValue(new Error('No admin session token available'));
    await expect(readConfigContract()).resolves.toBe(BUNDLED_CONFIG_CONTRACT);
  });

  it('reads a malformed part as not reported, keeping the rest', async () => {
    apiFetchMock.mockResolvedValue(
      reply(200, {
        features: { dottedKeys: 'yes', webSearchStoredKeys: true },
        limits: { maxPatchEntries: 0, overrideCacheTtlMs: 5000 },
        rules: { titleResolution: 'sometimes', arrayMergeKeys: ['endpoints.custom'] },
      }),
    );
    const contract = await readConfigContract();
    expect(contract.features.dottedKeys).toBe(false);
    expect(contract.features.webSearchStoredKeys).toBe(true);
    expect(contract.limits).toEqual({ ...BUNDLED_CONFIG_LIMITS, overrideCacheTtlMs: 5000 });
    expect(contract.rules.titleResolution).toBe('block');
    expect(contract.rules.arrayMergeKeys).toEqual(BUNDLED_CONFIG_RULES.arrayMergeKeys);
  });

  it('reads deployment-only paths, an unknown reason as an operator boundary', async () => {
    apiFetchMock.mockResolvedValue(
      reply(200, {
        features: { writeReport: true, issueParams: true },
        rules: {
          deploymentOnlyPaths: {
            rateLimits: 'operator',
            'endpoints.agents.eventDriven': 'startup',
            cache: 'unused',
            futurePath: 'scheduled',
          },
        },
      }),
    );
    const contract = await readConfigContract();
    expect(contract.features).toMatchObject({ writeReport: true, issueParams: true });
    expect(contract.rules.deploymentOnlyPaths).toEqual({
      rateLimits: 'operator',
      'endpoints.agents.eventDriven': 'startup',
      cache: 'unused',
      futurePath: 'operator',
    });
  });

  it('keeps the bundled deployment-only paths for a server that does not list them', async () => {
    apiFetchMock.mockResolvedValue(reply(200, META));
    const contract = await readConfigContract();
    expect(contract.rules.deploymentOnlyPaths).toBe(BUNDLED_CONFIG_RULES.deploymentOnlyPaths);
  });

  it('treats a reply that is not an object as no contract', async () => {
    apiFetchMock.mockResolvedValue(new Response('"ok"', { status: 200 }));
    await expect(readConfigContract()).resolves.toBe(BUNDLED_CONFIG_CONTRACT);
  });
});

describe('getAdminConfigMetaFn', () => {
  it('returns the contract readConfigContract resolves', async () => {
    apiFetchMock.mockResolvedValue(reply(404));
    await expect(getAdminConfigMetaFn()).resolves.toBe(BUNDLED_CONFIG_CONTRACT);
  });
});
