import '@/locales/i18n';
import { describe, it, expect, vi } from 'vitest';
import { createToast } from '@clickhouse/click-ui';
import { act, renderHook } from '@testing-library/react';
import { configSchema, PrincipalType } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { extractSchemaTree, getSchemaPathSet } from '@/server/config';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { useImportPreview, useConfigImport } from './import';
import { flattenObject, setValueAtPath } from '@/utils';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';

vi.mock('@/server', () => ({
  baseConfigOptions: { queryKey: ['baseConfig'], queryFn: vi.fn(), staleTime: Infinity },
  createRoleFn: vi.fn(),
  createScopeFn: vi.fn(),
  createGroupFn: vi.fn(),
}));

vi.mock('@clickhouse/click-ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@clickhouse/click-ui')>();
  return { ...actual, createToast: vi.fn() };
});

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const schemaPathSet = getSchemaPathSet();
const moonshot = {
  name: 'Moonshot',
  apiKey: '${KIMI}',
  baseURL: 'https://api.moonshot.ai/v1',
  models: { default: ['kimi-k2.5'], fetch: true },
  titleConvo: true,
  titleModel: 'current_model',
};
/** A librechat.yaml `{ key: useResponsesApi, default: true }` as LibreChat expands it at startup. */
const responsesApi = {
  key: 'useResponsesApi',
  label: 'com_endpoint_use_responses_api',
  labelCode: true,
  type: 'boolean',
  default: true,
  component: 'switch',
  optionType: 'custom',
  columnSpan: 2,
};
const foundry = {
  name: 'Foundry',
  apiKey: '${FOUNDRY}',
  baseURL: 'https://foundry.example.com/v1',
  models: { default: ['gpt-5'] },
  customParams: { defaultParamsEndpoint: 'azureOpenAI', paramDefinitions: [responsesApi] },
};
/** An endpoint whose literal librechat.yaml key LibreChat hides (no value, no preview). */
const local = { name: 'Local', baseURL: 'http://127.0.0.1:11434/v1', models: { default: ['m'] } };
const yamlConfig: t.ConfigRecord = {
  interface: { presets: true },
  endpoints: { custom: [moonshot, foundry, local] },
};
const dbOverrides: t.ConfigRecord = {
  endpoints: { custom: [{ name: 'Moonshot', baseURL: 'https://api.moonshot.cn/v1' }] },
};
const base: t.BaseConfigData = {
  config: {
    interface: { presets: true },
    endpoints: {
      custom: [{ ...moonshot, baseURL: 'https://api.moonshot.cn/v1' }, foundry, local],
    },
  },
  yamlConfig,
  yamlPaths: Object.keys(flattenObject(yamlConfig)),
  dbOverrides,
  dbTombstones: [],
  schemaDefaults: {},
};

/** A profile that defines its own `github` MCP server, which Base does not have. */
const engineering: t.ConfigScope = {
  principalType: PrincipalType.GROUP,
  principalId: 'eng',
  name: 'Engineering',
  priority: 20,
  isActive: true,
};
const engineeringData: t.ResolvedConfigData = {
  resolvedConfig: {},
  changedPaths: [],
  overrides: {
    mcpServers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' } },
  },
  tombstones: [],
};

function renderPreview(
  appConfig: t.ConfigRecord,
  target: t.ImportTarget = { type: 'base' },
  {
    features = {},
    baseData = base,
    scopeData = engineeringData,
  }: {
    features?: Partial<t.ConfigFeatures>;
    baseData?: t.BaseConfigData;
    scopeData?: t.ResolvedConfigData;
  } = {},
) {
  const client = new QueryClient();
  client.setQueryData(['baseConfig'], baseData);
  client.setQueryData(
    ['resolvedConfig', engineering.principalType, engineering.principalId],
    scopeData,
  );
  const contract: t.ConfigContract = {
    ...BUNDLED_CONFIG_CONTRACT,
    features: { ...BUNDLED_CONFIG_CONTRACT.features, ...features },
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ConfigContractContext.Provider value={contract}>{children}</ConfigContractContext.Provider>
    </QueryClientProvider>
  );
  return renderHook(
    () => useImportPreview({ schemaTree: tree, schemaPathSet, appConfig, target }),
    { wrapper },
  );
}

describe('useImportPreview', () => {
  it('on a server that keeps dotted keys, merges an imported dotted record into the stored one', () => {
    const profiles = { 'us.anthropic.a': 'arn:a' };
    const bedrock = { inferenceProfiles: profiles };
    const baseData: t.BaseConfigData = {
      ...base,
      config: setValueAtPath(base.config, 'endpoints.bedrock', bedrock),
      dbOverrides: setValueAtPath(dbOverrides, 'endpoints.bedrock', bedrock),
    };
    const { result } = renderPreview(
      { endpoints: { bedrock: { inferenceProfiles: { 'us.anthropic.b': 'arn:b' } } } },
      { type: 'base' },
      { features: { dottedKeys: true }, baseData },
    );
    const rows = result.current.groups.flatMap((group) => group.rows.flatMap((row) => row.rows));
    expect(rows.map((row) => row.item.kind)).toEqual(['added']);
    expect(result.current.entriesFor(new Set(['endpoints.bedrock.inferenceProfiles']))).toEqual([
      {
        fieldPath: 'endpoints.bedrock.inferenceProfiles',
        value: { 'us.anthropic.a': 'arn:a', 'us.anthropic.b': 'arn:b' },
      },
    ]);
  });

  it('on a server that keeps dotted keys, never lists librechat.yaml record keys as removed', () => {
    const bedrock = { inferenceProfiles: { 'us.anthropic.a': 'arn:a' } };
    const baseData: t.BaseConfigData = {
      ...base,
      config: setValueAtPath(base.config, 'endpoints.bedrock', bedrock),
      yamlConfig: setValueAtPath(yamlConfig, 'endpoints.bedrock', bedrock),
    };
    const { result } = renderPreview(
      { endpoints: { bedrock: { inferenceProfiles: { 'us.anthropic.b': 'arn:b' } } } },
      { type: 'base' },
      { features: { dottedKeys: true }, baseData },
    );
    const rows = result.current.groups.flatMap((group) => group.rows.flatMap((row) => row.rows));
    expect(rows.map((row) => [row.item.kind, row.item.path])).toEqual([
      ['added', 'endpoints.bedrock.inferenceProfiles.us.anthropic.b'],
    ]);
    expect(result.current.entriesFor(new Set(['endpoints.bedrock.inferenceProfiles']))).toEqual([
      { fieldPath: 'endpoints.bedrock.inferenceProfiles', value: { 'us.anthropic.b': 'arn:b' } },
    ]);
  });

  it('on a server that keeps dotted keys, imports MCP servers field by field and leaves a dotted name out', () => {
    const cloudflare = { type: 'streamable-http', url: 'https://mcp.cloudflare.com/mcp' };
    const everything = { type: 'streamable-http', url: 'https://everything.example.com/mcp' };
    const stored = { timeout: 45000, initTimeout: 20000 };
    const yaml = setValueAtPath(yamlConfig, 'mcpServers', { cloudflare, everything });
    const baseData: t.BaseConfigData = {
      ...base,
      config: setValueAtPath(base.config, 'mcpServers', {
        cloudflare: { ...cloudflare, ...stored },
        everything,
      }),
      yamlConfig: yaml,
      yamlPaths: Object.keys(flattenObject(yaml)),
      dbOverrides: setValueAtPath(dbOverrides, 'mcpServers', { cloudflare: stored }),
    };
    const { result } = renderPreview(
      {
        mcpServers: {
          'my.server': { type: 'streamable-http', url: 'https://example.com/mcp' },
          cloudflare: { ...cloudflare, serverInstructions: 'Use carefully' },
          everything: { serverInstructions: 'Sparse' },
        },
      },
      { type: 'base' },
      { features: { dottedKeys: true }, baseData },
    );
    const paths = new Set(result.current.plan?.entries.map((entry) => entry.fieldPath));
    expect(paths.has('mcpServers')).toBe(false);
    const rows = result.current.groups.flatMap((group) => group.rows.flatMap((row) => row.rows));
    expect(rows.map((row) => [row.item.kind, row.item.path])).toEqual([
      ['added', 'mcpServers.cloudflare.serverInstructions'],
      ['added', 'mcpServers.everything.serverInstructions'],
    ]);
    expect(result.current.skipped).toEqual([
      expect.objectContaining({
        path: 'mcpServers',
        label: expect.stringContaining('"my.server"'),
        reason: expect.stringContaining('name with a dot'),
      }),
    ]);
    expect(result.current.entriesFor(paths)).toEqual(
      expect.arrayContaining([
        { fieldPath: 'mcpServers.cloudflare.serverInstructions', value: 'Use carefully' },
        { fieldPath: 'mcpServers.everything.serverInstructions', value: 'Sparse' },
      ]),
    );
    expect(result.current.issuesFor(paths)).toEqual([]);
  });

  it('on an older server, leaves out a record holding a dotted key', () => {
    const { result } = renderPreview({
      endpoints: { bedrock: { inferenceProfiles: { 'us.anthropic.b': 'arn:b' } } },
    });
    expect(result.current.groups).toEqual([]);
    expect(result.current.skipped.map((row) => row.path)).toEqual([
      'endpoints.bedrock.inferenceProfiles',
    ]);
  });

  it('lists only the keys a partial custom endpoint sets, merged by name (D4)', () => {
    const { result } = renderPreview({
      endpoints: { custom: [{ name: 'Moonshot', modelDisplayLabel: 'Kimi Import' }] },
    });
    const [group] = result.current.groups;
    expect(group.rows).toHaveLength(1);
    const changes = group.rows[0].rows;
    expect(changes.map((row) => row.item.path)).toEqual(['endpoints.custom.0.modelDisplayLabel']);
    expect(changes[0].item).toMatchObject({ kind: 'added', after: 'Kimi Import' });
  });

  it('writes an imported parameter definition over the expanded one, keeping its control', () => {
    const { result } = renderPreview({
      endpoints: {
        custom: [
          {
            name: 'Foundry',
            customParams: {
              defaultParamsEndpoint: 'azureOpenAI',
              paramDefinitions: [{ key: 'useResponsesApi', default: false }],
            },
          },
        ],
      },
    });
    const changes = result.current.groups[0].rows[0].rows;
    expect(changes.map((row) => [row.item.kind, row.item.before, row.item.after])).toEqual([
      ['changed', true, false],
    ]);
    const [entry] = result.current.entriesFor(new Set(['endpoints.custom']));
    const written = (entry.value as t.ConfigRecord[]).find((e) => e.name === 'Foundry');
    expect(written?.customParams).toEqual({
      defaultParamsEndpoint: 'azureOpenAI',
      paramDefinitions: [{ ...responsesApi, default: false }],
    });
  });

  it('writes imported parameter definitions as written where LibreChat expands them (customParamsExpansion)', () => {
    /** On such a server, librechat.yaml's definitions are read back as written: compact. */
    const compactFoundry = {
      ...foundry,
      customParams: {
        defaultParamsEndpoint: 'azureOpenAI',
        paramDefinitions: [{ key: 'useResponsesApi', default: true }],
      },
    };
    const compactBase: t.BaseConfigData = {
      ...base,
      config: { ...base.config, endpoints: { custom: [moonshot, compactFoundry, local] } },
      yamlConfig: { ...yamlConfig, endpoints: { custom: [moonshot, compactFoundry, local] } },
    };
    const { result } = renderPreview(
      {
        endpoints: {
          custom: [
            {
              name: 'Foundry',
              customParams: { paramDefinitions: [{ key: 'useResponsesApi', default: false }] },
            },
          ],
        },
      },
      { type: 'base' },
      { features: { customParamsExpansion: true }, baseData: compactBase },
    );
    const [entry] = result.current.entriesFor(new Set(['endpoints.custom']));
    const written = (entry.value as t.ConfigRecord[]).find((e) => e.name === 'Foundry');
    expect(written?.customParams).toEqual({
      paramDefinitions: [{ key: 'useResponsesApi', default: false }],
    });
  });

  it('lists a snippet identical to librechat.yaml as unchanged and writes nothing for it', () => {
    const { result } = renderPreview({
      endpoints: {
        custom: [
          {
            name: 'Foundry',
            customParams: {
              defaultParamsEndpoint: 'azureOpenAI',
              paramDefinitions: [{ key: 'useResponsesApi', default: true }],
            },
          },
        ],
      },
    });
    const [row] = result.current.groups[0].rows;
    expect(row.rows).toEqual([]);
    expect(row.unchanged).toBe(true);
    expect(result.current.entriesFor(new Set(['endpoints.custom']))).toEqual([]);
  });

  it('leaves out a key librechat.yaml hides, saying why, instead of storing it again', () => {
    const { result } = renderPreview({ endpoints: { custom: [{ ...local, apiKey: 'ollama' }] } });
    expect(result.current.groups[0].rows[0].unchanged).toBe(true);
    expect(result.current.entriesFor(new Set(['endpoints.custom']))).toEqual([]);
    expect(result.current.skipped.map((row) => row.path)).toEqual(['endpoints.custom.0.apiKey']);
  });

  it('never writes back a key LibreChat reads back as the mask (yamlSecretPreview), naming each', () => {
    const vault = {
      type: 'streamable-http',
      url: 'https://mcp.vault.dev/mcp',
      apiKey: { source: 'admin', authorization_type: 'bearer', keyPreview: '********' },
    };
    const masked: t.ConfigRecord = {
      ocr: { baseURL: 'https://ocr.example.com', apiKeyPreview: '********' },
      mcpServers: { vault },
      endpoints: { custom: [moonshot, foundry, { ...local, apiKeyPreview: '********' }] },
    };
    const baseData: t.BaseConfigData = { ...base, config: masked, yamlConfig: masked };
    const { result } = renderPreview(
      {
        ocr: { apiKey: 'sk-ocr-literal' },
        mcpServers: { vault: { apiKey: { key: 'sk-vault-literal' } } },
        endpoints: { custom: [{ ...local, apiKey: 'ollama' }] },
      },
      { type: 'base' },
      { features: { yamlSecretPreview: true }, baseData },
    );
    const all = new Set(['ocr.apiKey', 'mcpServers.vault.apiKey.key', 'endpoints.custom']);
    expect(result.current.entriesFor(all)).toEqual([]);
    expect(result.current.skipped.map((row) => [row.path, row.reason])).toEqual([
      [
        'ocr.apiKey',
        'LibreChat hides the librechat.yaml key here, so the import cannot tell whether this one differs; replace it on the page instead',
      ],
      [
        'mcpServers.vault.apiKey.key',
        'LibreChat hides the librechat.yaml key here, so the import cannot tell whether this one differs; replace it on the page instead',
      ],
      [
        'endpoints.custom.0.apiKey',
        'LibreChat hides the librechat.yaml key here, so the import cannot tell whether this one differs; replace it on the page instead',
      ],
    ]);
    expect(
      result.current.groups.flatMap((group) => group.rows.map((row) => row.fieldPath)),
    ).toEqual(['endpoints.custom']);
  });

  it('never writes the mask itself as a key, and imports a real one over a stored key', () => {
    const stored: t.ConfigRecord = {
      ...base.config,
      ocr: { baseURL: 'https://ocr.example.com', apiKeyPreview: '...1234' },
    };
    const baseData: t.BaseConfigData = { ...base, config: stored };
    const masked = renderPreview({ ocr: { apiKey: '********' } }, { type: 'base' }, { baseData });
    expect(masked.result.current.entriesFor(new Set(['ocr.apiKey']))).toEqual([]);
    expect(masked.result.current.skipped.map((row) => row.reason)).toEqual([
      'is the mask LibreChat shows for a hidden key, not a key; enter the key itself on the page',
    ]);
    const real = renderPreview({ ocr: { apiKey: 'sk-ocr-new' } }, { type: 'base' }, { baseData });
    expect(real.result.current.entriesFor(new Set(['ocr.apiKey']))).toEqual([
      { fieldPath: 'ocr.apiKey', value: 'sk-ocr-new' },
    ]);
  });

  it('imports a ${VAR} reference over a key librechat.yaml hides: it is never that key', () => {
    const masked: t.ConfigRecord = {
      ...base.config,
      ocr: { baseURL: 'https://ocr.example.com', apiKeyPreview: '********' },
    };
    const baseData: t.BaseConfigData = { ...base, config: masked };
    const { result } = renderPreview(
      { ocr: { apiKey: '${OCR_KEY}' } },
      { type: 'base' },
      { features: { yamlSecretPreview: true }, baseData },
    );
    expect(result.current.entriesFor(new Set(['ocr.apiKey']))).toEqual([
      { fieldPath: 'ocr.apiKey', value: '${OCR_KEY}' },
    ]);
    expect(result.current.skipped).toEqual([]);
  });

  it('labels a value librechat.yaml sets by librechat.yaml, not as a default', () => {
    const { result } = renderPreview({ interface: { presets: false } });
    const [row] = result.current.groups[0].rows;
    expect(row.rows[0].item.revertTarget).toEqual({ value: true, source: 'yaml' });
  });

  it("validates a sparse MCP server override against the chosen target's server", () => {
    const sparse = { mcpServers: { github: { timeout: 120000 } } };
    const all = new Set(['mcpServers.github.timeout']);
    const onProfile = renderPreview(sparse, { type: 'scope', scope: engineering, exists: true });
    expect(onProfile.result.current.issuesFor(all)).toEqual([]);
    const onBase = renderPreview(sparse);
    expect(onBase.result.current.issuesFor(all)).toEqual(['Server URL is required']);
  });
});

describe('useImportPreview into a profile with hides and removals by key (keyedTombstones)', () => {
  const onProfile: t.ImportTarget = { type: 'scope', scope: engineering, exists: true };
  const all = new Set(['endpoints.custom']);
  const hidesMoonshot: t.ResolvedConfigData = {
    ...engineeringData,
    overrides: {},
    tombstones: ['endpoints.custom["Moonshot"]'],
  };
  const rowsOf = (groups: t.ImportPreviewGroup[]) =>
    groups.flatMap((group) => group.rows.flatMap((row) => row.rows.map((change) => change.item)));

  it('leaves an endpoint the profile hides out, saying why, since writing it would show it again', () => {
    const { result } = renderPreview(
      { endpoints: { custom: [{ name: 'Moonshot', titleModel: 'kimi-k2.6' }] } },
      onProfile,
      { features: { keyedTombstones: true }, scopeData: hidesMoonshot },
    );
    expect(result.current.groups).toEqual([]);
    expect(result.current.entriesFor(all)).toEqual([]);
    expect(result.current.issuesFor(all)).toEqual([]);
    expect(result.current.skipped).toEqual([
      expect.objectContaining({
        path: 'endpoints.custom.0',
        label: expect.stringContaining('Moonshot'),
        reason: expect.stringContaining('hidden for Group: Engineering'),
      }),
    ]);
  });

  it('leaves out only the endpoints the profile hides, and imports the others', () => {
    const { result } = renderPreview(
      {
        endpoints: {
          custom: [
            { name: 'Moonshot', titleModel: 'kimi-k2.6' },
            { name: 'Foundry', titleModel: 'gpt-5' },
          ],
        },
      },
      onProfile,
      { features: { keyedTombstones: true }, scopeData: hidesMoonshot },
    );
    expect(rowsOf(result.current.groups).map((item) => [item.path, item.after])).toEqual([
      ['endpoints.custom.0.titleModel', 'gpt-5'],
    ]);
    expect(result.current.entriesFor(all)).toEqual([
      { fieldPath: 'endpoints.custom', value: [{ name: 'Foundry', titleModel: 'gpt-5' }] },
    ]);
    expect(result.current.skipped.map((row) => row.path)).toEqual(['endpoints.custom.0']);
  });

  it('imports a hidden endpoint as before where the server stores keyed tombstones without effect', () => {
    const { result } = renderPreview(
      { endpoints: { custom: [{ name: 'Moonshot', titleModel: 'kimi-k2.6' }] } },
      onProfile,
      { scopeData: hidesMoonshot },
    );
    expect(rowsOf(result.current.groups).map((item) => [item.kind, item.after])).toEqual([
      ['changed', 'kimi-k2.6'],
    ]);
    expect(result.current.skipped).toEqual([]);
    expect(result.current.entriesFor(all)).toHaveLength(1);
  });

  describe('a value that selects or names an endpoint the profile hides', () => {
    const notesOf = (groups: t.ImportPreviewGroup[]) =>
      groups.flatMap((group) => group.rows.map((row) => [row.fieldPath, row.hiddenNotes]));
    const specs = {
      modelSpecs: {
        list: [
          { name: 'team-spec', label: 'Team spec', preset: { endpoint: 'Moonshot', model: 'm' } },
          { name: 'other', label: 'Other', preset: { endpoint: 'Foundry', model: 'gpt-5' } },
        ],
      },
    };

    it('says which imported specs its members never get', () => {
      const { result } = renderPreview(specs, onProfile, {
        features: { keyedTombstones: true },
        scopeData: hidesMoonshot,
      });
      expect(notesOf(result.current.groups)).toEqual([
        [
          'modelSpecs.list',
          [
            "Group: Engineering hides the endpoints these specs use, so its members don't get them: Team spec",
          ],
        ],
      ]);
      expect(result.current.entriesFor(new Set(['modelSpecs.list']))).toHaveLength(1);
    });

    it('names the imported specs as issues where LibreChat refuses them (specInterfaceRederive)', () => {
      const { result } = renderPreview(specs, onProfile, {
        features: { keyedTombstones: true, specInterfaceRederive: true },
        scopeData: hidesMoonshot,
      });
      expect(notesOf(result.current.groups)).toEqual([['modelSpecs.list', []]]);
      expect(result.current.issuesFor(new Set(['modelSpecs.list']))).toEqual([
        expect.stringContaining(
          "is Moonshot, which this profile hides: LibreChat refuses a spec for it until it's shown again",
        ),
      ]);
    });

    it('names the hidden endpoints an imported allow-list loses, or says it then allows none', () => {
      const { result } = renderPreview(
        {
          modelSpecs: { addedEndpoints: ['Moonshot'] },
          endpoints: { agents: { allowedProviders: ['Moonshot', 'Foundry'] } },
        },
        onProfile,
        { features: { keyedTombstones: true }, scopeData: hidesMoonshot },
      );
      expect(Object.fromEntries(notesOf(result.current.groups))).toEqual({
        'modelSpecs.addedEndpoints': [
          "Group: Engineering hides every endpoint this list names, so the model specs add none to its members' endpoint menu.",
        ],
        'endpoints.agents.allowedProviders': [
          "Group: Engineering hides Moonshot, so LibreChat leaves hidden endpoints out of the providers its members' agents may use.",
        ],
      });
    });

    it('notes nothing where the server stores keyed tombstones without effect', () => {
      const { result } = renderPreview(specs, onProfile, { scopeData: hidesMoonshot });
      expect(notesOf(result.current.groups)).toEqual([['modelSpecs.list', []]]);
    });
  });

  it('compares a header with what members get: one the profile removes reads as added', () => {
    const team = { ...foundry, headers: { 'X-Team': 'blue' } };
    const baseData: t.BaseConfigData = {
      ...base,
      config: { ...base.config, endpoints: { custom: [moonshot, team, local] } },
    };
    const removesHeader: t.ResolvedConfigData = {
      ...engineeringData,
      overrides: {},
      tombstones: ['endpoints.custom["Foundry"].headers.X-Team'],
    };
    const imported = {
      endpoints: { custom: [{ name: 'Foundry', headers: { 'X-Team': 'blue' } }] },
    };
    const keyed = renderPreview(imported, onProfile, {
      features: { keyedTombstones: true },
      baseData,
      scopeData: removesHeader,
    });
    expect(rowsOf(keyed.result.current.groups)).toEqual([
      expect.objectContaining({
        kind: 'added',
        path: 'endpoints.custom.0.headers.X-Team',
        after: 'blue',
      }),
    ]);
    expect(keyed.result.current.entriesFor(all)).toEqual([
      {
        fieldPath: 'endpoints.custom',
        value: [{ name: 'Foundry', headers: { 'X-Team': 'blue' } }],
      },
    ]);
    const older = renderPreview(imported, onProfile, { baseData, scopeData: removesHeader });
    expect(older.result.current.groups[0].rows[0].unchanged).toBe(true);
    expect(older.result.current.entriesFor(all)).toEqual([]);
  });

  it('leaves the hidden endpoint out where LibreChat derives groups and parameters, writing the rest as written', () => {
    const groupsPath = 'endpoints.azureOpenAI.groups';
    const eastus = {
      group: 'eastus',
      apiKey: '${EASTUS_KEY}',
      instanceName: 'east',
      version: '2024-10-21',
      models: { 'gpt-4o': { deploymentName: 'gpt-4o' } },
    };
    const withGroups = (config: t.ConfigRecord = {}): t.ConfigRecord =>
      setValueAtPath(config, groupsPath, [eastus]);
    const baseData: t.BaseConfigData = {
      ...base,
      config: withGroups(base.config ?? {}),
      yamlConfig: withGroups(yamlConfig),
    };
    const { result } = renderPreview(
      {
        endpoints: {
          custom: [
            { name: 'Moonshot', titleModel: 'kimi-k2.6' },
            {
              name: 'Foundry',
              customParams: { paramDefinitions: [{ key: 'useResponsesApi', default: false }] },
            },
          ],
          azureOpenAI: { groups: [{ group: 'eastus', version: '2025-01-01' }] },
        },
      },
      onProfile,
      {
        features: {
          keyedTombstones: true,
          customParamsExpansion: true,
          endpointRederive: true,
          azureGroupMergeKey: true,
          azureGroupSecrets: true,
        },
        baseData,
        scopeData: hidesMoonshot,
      },
    );
    expect(result.current.skipped.map((row) => row.path)).toEqual(['endpoints.custom.0']);
    expect(result.current.entriesFor(new Set(['endpoints.custom', groupsPath]))).toEqual([
      {
        fieldPath: 'endpoints.custom',
        value: [
          {
            name: 'Foundry',
            customParams: { paramDefinitions: [{ key: 'useResponsesApi', default: false }] },
          },
        ],
      },
      { fieldPath: groupsPath, value: [{ group: 'eastus', version: '2025-01-01' }] },
    ]);
  });
});

describe('useConfigImport', () => {
  function renderImport(skipped: t.SkippedChange[], reported: t.SkippedChange[] = []) {
    const client = new QueryClient();
    const writeChanges = vi.fn<t.WriteChangesFn>().mockResolvedValue({ skipped, reported });
    const describeSkipped = (items: t.SkippedChange[]) =>
      items.map((item) => item.fieldPath).join(', ');
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(() => useConfigImport({ writeChanges, describeSkipped }), {
      wrapper,
    });
    return { result, writeChanges };
  }
  const entries: t.SaveEntry[] = [
    { fieldPath: 'mcpServers.github.headers', value: { 'x-team.id': 'eng' } },
    { fieldPath: 'balance.startBalance', value: 5 },
  ];

  it('reports keys LibreChat merges back as the merge asked for, not as left out', async () => {
    const toast = vi.mocked(createToast);
    toast.mockClear();
    const { result, writeChanges } = renderImport([
      { fieldPath: 'mcpServers.github.headers.Authorization', reason: 'yamlMerged' },
    ]);
    await act(() => result.current.handleImport({ target: { type: 'base' }, entries }));
    expect(writeChanges).toHaveBeenCalledWith({ type: 'base' }, entries, []);
    expect(toast).toHaveBeenCalledWith({
      type: 'success',
      title: 'Imported 2 values into the base configuration',
    });
  });

  it('still reports a value that was not stored', async () => {
    const toast = vi.mocked(createToast);
    toast.mockClear();
    const { result } = renderImport([
      { fieldPath: 'mcpServers.github.headers.Authorization', reason: 'yamlMerged' },
      { fieldPath: 'balance.startBalance', reason: 'notStored' },
    ]);
    await act(() => result.current.handleImport({ target: { type: 'base' }, entries }));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        title: 'Imported 1 value into the base configuration',
        description: 'balance.startBalance',
      }),
    );
  });

  it('counts an entry whose credential the server left out as imported, noting the credential', async () => {
    const toast = vi.mocked(createToast);
    toast.mockClear();
    const credential = {
      fieldPath: 'mcpServers.github.headers.Authorization',
      reason: 'secretRebinding',
    } as const;
    const { result } = renderImport([], [credential]);
    await act(() => result.current.handleImport({ target: { type: 'base' }, entries }));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        title: 'Imported 2 values into the base configuration',
        description: 'mcpServers.github.headers.Authorization',
      }),
    );
  });

  it('counts a change reported twice once', async () => {
    const toast = vi.mocked(createToast);
    toast.mockClear();
    const notStored = { fieldPath: 'balance.startBalance', reason: 'notStored' } as const;
    const { result } = renderImport([notStored, notStored]);
    await act(() => result.current.handleImport({ target: { type: 'base' }, entries }));
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'warning',
        title: 'Imported 1 value into the base configuration',
        description: 'balance.startBalance',
      }),
    );
  });
});
