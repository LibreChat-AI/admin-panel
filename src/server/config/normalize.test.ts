import { describe, expect, it } from 'vitest';
import type * as t from '@/types';
import { normalizeAppServiceKeys, normalizeEndpointValue, readConfiguredValues } from './normalize';
import { createServerContract } from '@/test/fixtures';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { getValueAtPath } from '@/utils';

/** An `azureOpenAI` block as LibreChat's `azureConfigSetup` returns it. */
const processedAzure = {
  errors: [],
  isValid: true,
  groupMap: {
    eastus: {
      apiKey: '${EASTUS_API_KEY}',
      instanceName: 'librechat-eastus',
      version: '2024-02-15-preview',
      models: { 'gpt-4.1': { deploymentName: 'gpt-4.1' } },
      serverless: false,
      assistants: true,
    },
    foundry: { apiKey: 'sk-literal', baseURL: 'https://x/models', serverless: true, models: {} },
  },
  modelNames: ['gpt-4.1'],
  modelGroupMap: { 'gpt-4.1': { group: 'eastus' } },
  assistantModels: ['gpt-4.1'],
  assistantGroups: ['eastus'],
  serverless: false,
  instanceName: '',
  deploymentName: '',
  streamRate: 25,
  assistants: true,
};

describe('normalizeEndpointValue', () => {
  it('drops every key Azure setup derives, assistantGroups included', () => {
    const normalized = normalizeEndpointValue(processedAzure);
    expect(Object.keys(normalized as object).sort()).toEqual([
      'assistants',
      'groups',
      'streamRate',
    ]);
  });

  it('rebuilds groups from the live groupMap, keeping dotted model names', () => {
    const normalized = normalizeEndpointValue(processedAzure) as { groups: object[] };
    expect(normalized.groups).toEqual([
      {
        group: 'eastus',
        apiKey: '${EASTUS_API_KEY}',
        instanceName: 'librechat-eastus',
        version: '2024-02-15-preview',
        models: { 'gpt-4.1': { deploymentName: 'gpt-4.1' } },
        serverless: false,
        assistants: true,
      },
      {
        group: 'foundry',
        apiKey: 'sk-literal',
        baseURL: 'https://x/models',
        serverless: true,
        models: {},
      },
    ]);
  });

  it('shows the live groups over a stored override LibreChat does not apply (D13)', () => {
    const merged = { ...processedAzure, groups: [{ group: 'stale', apiKey: 'x', models: {} }] };
    const normalized = normalizeEndpointValue(merged) as { groups: Array<{ group: string }> };
    expect(normalized.groups.map((group) => group.group)).toEqual(['eastus', 'foundry']);
  });

  it("drops the Anthropic block's derived vertexConfig and keeps vertex", () => {
    const anthropic = {
      vertex: { enabled: true, projectId: 'p' },
      vertexConfig: { modelNames: ['claude'] },
      streamRate: 30,
    };
    expect(normalizeEndpointValue(anthropic, 'anthropic')).toEqual({
      vertex: { enabled: true, projectId: 'p' },
      streamRate: 30,
    });
  });

  it('leaves other values unchanged', () => {
    const openAI = { titleModel: 'gpt-5-mini' };
    expect(normalizeEndpointValue(openAI, 'openAI')).toBe(openAI);
    expect(normalizeEndpointValue(['a'])).toEqual(['a']);
    expect(normalizeEndpointValue(null)).toBeNull();
  });
});

describe('normalizeAppServiceKeys', () => {
  it('normalizes every endpoint block by its key', () => {
    const result = normalizeAppServiceKeys({
      endpoints: {
        azureOpenAI: processedAzure,
        anthropic: { vertexConfig: {}, models: ['a'] },
      },
    });
    const endpoints = result.endpoints as Record<string, t.ConfigRecord>;
    expect(endpoints.azureOpenAI.groupMap).toBeUndefined();
    expect(endpoints.anthropic).toEqual({ models: ['a'] });
  });
});

/** librechat.yaml as written, as GET /base returns it in `config`. */
const RAW_YAML: t.ConfigRecord = {
  endpoints: {
    azureOpenAI: {
      groups: [
        {
          group: 'eastus',
          apiKey: '${EASTUS_API_KEY}',
          instanceName: 'librechat-eastus',
          version: '2024-02-15-preview',
          models: { 'gpt-4.1': { deploymentName: 'gpt-4.1' } },
        },
      ],
    },
    custom: [
      { name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1' },
      {
        name: 'Foundry',
        customParams: {
          defaultParamsEndpoint: 'azureOpenAI',
          paramDefinitions: [{ key: 'useResponsesApi', default: true }],
        },
      },
    ],
  },
};

/** The served custom endpoints: parameters expanded, OpenRouter's defaults added. */
const SERVED_CUSTOM = [
  {
    name: 'OpenRouter',
    baseURL: 'https://openrouter.ai/api/v1',
    customParams: {
      defaultParamsEndpoint: 'openrouter',
      paramDefinitions: [{ key: 'promptCache' }],
    },
  },
  {
    name: 'Foundry',
    customParams: {
      defaultParamsEndpoint: 'azureOpenAI',
      paramDefinitions: [{ key: 'useResponsesApi', default: true, type: 'boolean' }],
    },
  },
];

const REDERIVE = createServerContract({
  endpointRederive: true,
  azureGroupMergeKey: true,
  azureGroupSecrets: true,
  customParamsExpansion: true,
});

describe('readConfiguredValues', () => {
  it('reads nothing as written on a server that derives none of it again', () => {
    expect(readConfiguredValues(BUNDLED_CONFIG_CONTRACT, RAW_YAML)).toBeUndefined();
    expect(
      readConfiguredValues(createServerContract({ azureGroupMergeKey: true }), RAW_YAML),
    ).toBeUndefined();
  });

  it('merges the base document over librechat.yaml: groups by name, models by name', () => {
    const configured = readConfiguredValues(REDERIVE, RAW_YAML, {
      stored: {
        endpoints: {
          azureOpenAI: {
            groups: [
              { group: 'eastus', models: { 'gpt-4o-mini': { deploymentName: 'mini' } } },
              { group: 'west', apiKeyPreview: '...1234', instanceName: 'west', models: {} },
            ],
          },
        },
      },
      tombstones: [],
    });
    expect(configured).toMatchObject({ azureGroups: true, compactParams: true });
    const groups = getValueAtPath(configured?.written ?? null, 'endpoints.azureOpenAI.groups');
    expect(groups).toEqual([
      {
        group: 'eastus',
        apiKey: '${EASTUS_API_KEY}',
        instanceName: 'librechat-eastus',
        version: '2024-02-15-preview',
        models: {
          'gpt-4.1': { deploymentName: 'gpt-4.1' },
          'gpt-4o-mini': { deploymentName: 'mini' },
        },
      },
      { group: 'west', apiKeyPreview: '...1234', instanceName: 'west', models: {} },
    ]);
  });

  it("reads a key the base document stores for a librechat.yaml group as its preview, not librechat.yaml's", () => {
    const configured = readConfiguredValues(REDERIVE, RAW_YAML, {
      stored: {
        endpoints: { azureOpenAI: { groups: [{ group: 'eastus', apiKeyPreview: '...5555' }] } },
      },
      tombstones: [],
    });
    expect(
      getValueAtPath(configured?.written ?? null, 'endpoints.azureOpenAI.groups.0'),
    ).toStrictEqual({
      group: 'eastus',
      apiKeyPreview: '...5555',
      instanceName: 'librechat-eastus',
      version: '2024-02-15-preview',
      models: { 'gpt-4.1': { deploymentName: 'gpt-4.1' } },
    });
  });

  it("drops librechat.yaml's groups under the base document's tombstone of them", () => {
    const configured = readConfiguredValues(REDERIVE, RAW_YAML, {
      stored: {},
      tombstones: ['endpoints.azureOpenAI.groups'],
    });
    expect(configured?.written).toBeDefined();
    expect(
      getValueAtPath(configured?.written ?? null, 'endpoints.azureOpenAI.groups'),
    ).toBeUndefined();
  });
});

describe('normalizeAppServiceKeys, with values read as written', () => {
  it('reads the Azure groups as written instead of rebuilding them from groupMap', () => {
    const configured = readConfiguredValues(REDERIVE, RAW_YAML);
    const result = normalizeAppServiceKeys(
      { endpoints: { azureOpenAI: processedAzure } },
      configured,
    );
    const azure = (result.endpoints as Record<string, t.ConfigRecord>).azureOpenAI;
    expect(azure.groupMap).toBeUndefined();
    expect(azure.groups).toEqual(getValueAtPath(RAW_YAML, 'endpoints.azureOpenAI.groups'));
  });

  it('leaves no groups where nothing writes any', () => {
    const configured = readConfiguredValues(REDERIVE, { endpoints: {} });
    const result = normalizeAppServiceKeys(
      { endpoints: { azureOpenAI: processedAzure } },
      configured,
    );
    expect((result.endpoints as Record<string, t.ConfigRecord>).azureOpenAI).not.toHaveProperty(
      'groups',
    );
  });

  it('reads custom endpoint parameters as written: compact, without added defaults', () => {
    const configured = readConfiguredValues(REDERIVE, RAW_YAML);
    const result = normalizeAppServiceKeys({ endpoints: { custom: SERVED_CUSTOM } }, configured);
    expect((result.endpoints as t.ConfigRecord).custom).toEqual(
      getValueAtPath(RAW_YAML, 'endpoints.custom'),
    );
  });

  it('keeps served parameters on a server that does not expand overrides', () => {
    const configured = readConfiguredValues(
      createServerContract({
        endpointRederive: true,
        azureGroupMergeKey: true,
        azureGroupSecrets: true,
      }),
      RAW_YAML,
    );
    const result = normalizeAppServiceKeys({ endpoints: { custom: SERVED_CUSTOM } }, configured);
    expect((result.endpoints as t.ConfigRecord).custom).toEqual(SERVED_CUSTOM);
  });
});
