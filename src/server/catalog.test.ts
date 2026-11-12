import { PrincipalType } from 'librechat-data-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();

vi.mock('./utils/api', () => ({
  apiFetch: (path: string, init?: RequestInit) => apiFetchMock(path, init),
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: () => ({ handler: (fn: (...args: never[]) => unknown) => fn }),
    handler: (fn: (...args: never[]) => unknown) => fn,
  }),
}));

import { getEnvStatusFn, toEnvStatusMap, toConfigCatalog, getConfigCatalogFn } from './catalog';

const json = (body: object, status = 200) => new Response(JSON.stringify(body), { status });

/** `GET /api/admin/config/catalog` for the USER role, abridged from a live server. */
const CATALOG = {
  principalType: 'role',
  principalId: 'USER',
  endpoints: {
    openAI: {
      enabled: true,
      custom: false,
      envVars: ['OPENAI_API_KEY', 'OPENAI_REVERSE_PROXY'],
      config: { userProvide: false, order: 0 },
    },
    assistants: {
      enabled: false,
      custom: false,
      envVars: ['ASSISTANTS_API_KEY'],
      reason: 'missing_credentials',
    },
    Moonshot: {
      enabled: true,
      custom: true,
      envVars: ['KIMI_API_KEY'],
      config: { type: 'custom', userProvide: false, modelDisplayLabel: 'Kimi (USER)' },
    },
    ollama: { enabled: false, custom: true, envVars: [], reason: 'missing_api_key' },
    future: { enabled: false, custom: true, envVars: [], reason: 'quota_exceeded' },
    broken: 'nope',
  },
  models: {
    openAI: { served: ['gpt-5', 'gpt-5', ''], defaults: ['gpt-5', 'gpt-4.1'] },
    Moonshot: { served: ['kimi-k2'], configured: ['kimi-k2'] },
  },
  tools: [
    { pluginKey: 'google', name: 'Google', description: 'Search' },
    { pluginKey: 'google', name: 'Duplicate' },
    { name: 'No key' },
  ],
  mcpServers: [{ name: 'github', transport: 'streamable-http', source: 'yaml' }],
};

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('toConfigCatalog', () => {
  it('reads every endpoint with why it is not served, and the served ones as /api/endpoints did', () => {
    const catalog = toConfigCatalog(CATALOG);
    expect(catalog.endpoints).toEqual({
      openAI: { enabled: true, custom: false, envVars: ['OPENAI_API_KEY', 'OPENAI_REVERSE_PROXY'] },
      assistants: {
        enabled: false,
        custom: false,
        envVars: ['ASSISTANTS_API_KEY'],
        reason: 'missing_credentials',
      },
      Moonshot: { enabled: true, custom: true, envVars: ['KIMI_API_KEY'] },
      ollama: { enabled: false, custom: true, envVars: [], reason: 'missing_api_key' },
      future: { enabled: false, custom: true, envVars: [], reason: 'unknown' },
    });
    expect(catalog.status).toEqual({
      openAI: { name: 'openAI', custom: false, userProvide: false },
      Moonshot: { name: 'Moonshot', custom: true, userProvide: false, label: 'Kimi (USER)' },
    });
  });

  it("reads each endpoint's served, configured and default models, cleaned like /api/models", () => {
    const catalog = toConfigCatalog(CATALOG);
    expect(catalog.models).toEqual({ openAI: ['gpt-5'], Moonshot: ['kimi-k2'] });
    expect(catalog.modelLists).toEqual({
      openAI: { served: ['gpt-5'], defaults: ['gpt-5', 'gpt-4.1'] },
      Moonshot: { served: ['kimi-k2'], configured: ['kimi-k2'] },
    });
  });

  it('reads the agent tools as options, each plugin key once', () => {
    expect(toConfigCatalog(CATALOG).tools).toEqual([
      { value: 'google', label: 'Google', description: 'Search' },
    ]);
  });

  it('leaves out a part the server leaves out (a section the admin cannot read)', () => {
    expect(toConfigCatalog({ principalType: 'role', principalId: 'USER', mcpServers: [] })).toEqual(
      {},
    );
    expect(toConfigCatalog(null)).toEqual({});
  });

  it('marks an enabled custom endpoint without a config entry as custom', () => {
    const catalog = toConfigCatalog({
      endpoints: { Groq: { enabled: true, custom: true, envVars: [] } },
    });
    expect(catalog.status).toEqual({
      Groq: { name: 'Groq', custom: true, userProvide: false },
    });
  });
});

describe('toEnvStatusMap', () => {
  it('reads whether each name is set, user-provided, and where it is used', () => {
    expect(
      toEnvStatusMap({
        vars: {
          CH_API_KEY: { set: true, sources: ['yaml'] },
          SERPER_API_KEY: { set: false, sources: ['default', 'later'] },
          GROQ_API_KEY: { set: true, userProvided: true, sources: ['yaml', 'override'] },
          NO_FLAG: { sources: ['yaml'] },
          BROKEN: 'x',
        },
      }),
    ).toEqual({
      CH_API_KEY: { set: true, userProvided: false, sources: ['yaml'] },
      SERPER_API_KEY: { set: false, userProvided: false, sources: ['default'] },
      GROQ_API_KEY: { set: true, userProvided: true, sources: ['yaml', 'override'] },
    });
  });

  it('reads an unexpected reply as no names', () => {
    expect(toEnvStatusMap(null)).toEqual({});
    expect(toEnvStatusMap({ vars: [] })).toEqual({});
  });
});

describe('getConfigCatalogFn', () => {
  it('reads the catalog of the scope it is given, through the admin API', async () => {
    apiFetchMock.mockResolvedValue(json(CATALOG));
    const catalog = await getConfigCatalogFn({
      data: { principalType: PrincipalType.ROLE, principalId: 'USER' },
    });
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/config/catalog?principalType=role&principalId=USER',
      undefined,
    );
    expect(catalog.status?.Moonshot?.label).toBe('Kimi (USER)');
  });

  it('encodes a group id and a user id as query values', async () => {
    apiFetchMock.mockResolvedValue(json({}));
    await getConfigCatalogFn({
      data: { principalType: PrincipalType.GROUP, principalId: 'a b&c' },
    });
    expect(apiFetchMock).toHaveBeenCalledWith(
      '/api/admin/config/catalog?principalType=group&principalId=a+b%26c',
      undefined,
    );
  });

  it('fails on a refused read, so the page shows the status as unknown', async () => {
    apiFetchMock.mockResolvedValue(json({ error: 'Insufficient permissions' }, 403));
    await expect(
      getConfigCatalogFn({ data: { principalType: PrincipalType.ROLE, principalId: 'USER' } }),
    ).rejects.toThrow('Failed to load config catalog: 403');
  });
});

describe('getEnvStatusFn', () => {
  it('reads the env status route', async () => {
    apiFetchMock.mockResolvedValue(
      json({ vars: { CH_API_KEY: { set: true, sources: ['yaml'] } } }),
    );
    await expect(getEnvStatusFn()).resolves.toEqual({
      CH_API_KEY: { set: true, userProvided: false, sources: ['yaml'] },
    });
    expect(apiFetchMock).toHaveBeenCalledWith('/api/admin/config/env-status', undefined);
  });

  it('fails on a refused read', async () => {
    apiFetchMock.mockResolvedValue(json({ error: 'Insufficient permissions' }, 403));
    await expect(getEnvStatusFn()).rejects.toThrow('Failed to load env status: 403');
  });
});
