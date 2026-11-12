import { describe, it, expect } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  setConfigPath,
  mergeScopeLayer,
  removeConfigPath,
  withScopeLayer,
  createBaseLayers,
  overlayPendingEdits,
  estimateConfigPreview,
} from './layers';
import { resolveWriteRules, getWriteRules, BUNDLED_CONFIG_FEATURES } from '@/constants';
import { applyConfigEdit, buildSavePayload } from '@/components/configuration/edits';
import { scopeLayersFixture, baseConfigFixture } from '@/test/layers';
import { flattenObject, getValueAtPath } from './format';
import { createServerContract } from '@/test/fixtures';

describe('mergeScopeLayer', () => {
  const base: t.ConfigRecord = {
    balance: { enabled: true, startBalance: 1000 },
    endpoints: {
      custom: [
        { name: 'GPT', baseURL: 'a', models: { default: ['x'] } },
        { name: 'Claude', baseURL: 'b' },
      ],
    },
    modelSpecs: { list: [{ name: 'one' }, { name: 'two' }] },
    interface: { theme: { name: 'base', modes: { dark: true } }, parameters: true },
    filters: { messages: { enabled: true } },
    mcpServers: { github: { url: 'gh' }, docs: { url: 'd' } },
  };

  it('deep-merges objects and keeps everything the profile does not set', () => {
    const merged = mergeScopeLayer(base, { balance: { startBalance: 5 } });
    expect(merged.balance).toEqual({ enabled: true, startBalance: 5 });
    expect(merged.mcpServers).toBe(base.mcpServers);
  });

  it('merges custom endpoints by name and appends new ones', () => {
    const merged = mergeScopeLayer(base, {
      endpoints: {
        custom: [
          { name: 'GPT', baseURL: 'role' },
          { name: 'New', baseURL: 'n' },
        ],
      },
    });
    expect(getValueAtPath(merged, 'endpoints.custom')).toEqual([
      { name: 'GPT', baseURL: 'role', models: { default: ['x'] } },
      { name: 'Claude', baseURL: 'b' },
      { name: 'New', baseURL: 'n' },
    ]);
  });

  it('replaces other arrays and atomic objects whole', () => {
    const merged = mergeScopeLayer(base, {
      modelSpecs: { list: [{ name: 'mine' }] },
      interface: { theme: { name: 'role' } },
    });
    expect(getValueAtPath(merged, 'modelSpecs.list')).toEqual([{ name: 'mine' }]);
    expect(getValueAtPath(merged, 'interface.theme')).toEqual({ name: 'role' });
    expect(getValueAtPath(merged, 'interface.parameters')).toBe(true);
  });

  it('ignores sections a profile cannot override and removes tombstoned paths', () => {
    const merged = mergeScopeLayer(base, { filters: { messages: { enabled: false } } }, [
      'mcpServers.docs',
      'filters.messages',
    ]);
    expect(getValueAtPath(merged, 'filters.messages.enabled')).toBe(true);
    expect(Object.keys(merged.mcpServers as t.ConfigRecord)).toEqual(['github']);
    expect(base.mcpServers).toHaveProperty('docs');
  });

  it("keeps Base's value at the base-only and deployment-only paths a server reports, at any depth", () => {
    const rules = resolveWriteRules(
      {
        baseOnlySections: [],
        baseOnlyPaths: ['endpoints.agents.pullRequests.provider'],
        deploymentOnlyPaths: {
          'endpoints.agents.eventDriven': 'startup',
          'mcpSettings.catalogRecovery.maxStateEntries': 'startup',
        },
        derivedPaths: [],
      },
      { ...BUNDLED_CONFIG_FEATURES, preAuthBaseOverrides: true },
    );
    const yaml: t.ConfigRecord = {
      endpoints: {
        agents: {
          pullRequests: { provider: 'github', host: 'github.com' },
          eventDriven: { enabled: true },
        },
      },
      mcpSettings: { catalogRecovery: { maxStateEntries: 100, retryMs: 5 } },
    };
    const overridden = mergeScopeLayer(
      yaml,
      {
        endpoints: { agents: { pullRequests: { provider: 'gitlab' }, eventDriven: { x: 1 } } },
        mcpSettings: { catalogRecovery: { retryMs: 9 } },
      },
      ['mcpSettings.catalogRecovery.maxStateEntries'],
      rules,
    );
    expect(overridden).toEqual({
      endpoints: {
        agents: {
          pullRequests: { provider: 'github', host: 'github.com' },
          eventDriven: { enabled: true },
        },
      },
      mcpSettings: { catalogRecovery: { maxStateEntries: 100, retryMs: 9 } },
    });
    const hidden = mergeScopeLayer(yaml, {}, ['endpoints.agents'], rules);
    expect(hidden.endpoints).toEqual({
      agents: { pullRequests: { provider: 'github' }, eventDriven: { enabled: true } },
    });
    const added = mergeScopeLayer(
      {},
      { endpoints: { agents: { eventDriven: { x: 1 } } } },
      [],
      rules,
    );
    expect(getValueAtPath(added, 'endpoints.agents.eventDriven')).toBeUndefined();
  });
});

describe('mergeScopeLayer — keyed tombstones', () => {
  const base: t.ConfigRecord = {
    endpoints: {
      custom: [
        { name: 'Ollama', baseURL: 'http://ollama' },
        { name: 'Gateway', baseURL: 'https://gw', headers: { 'X-Team': 'blue', 'X-Org': 'acme' } },
      ],
    },
  };
  const tombstones = [
    'endpoints.custom["ollama"]',
    'endpoints.custom["Gateway"].headers.X-Team',
    'endpoints.custom["Gateway"].headers.X-Org',
  ];
  const overrides: t.ConfigRecord = {
    endpoints: { custom: [{ name: 'Gateway', headers: { 'X-Org': 'own' } }] },
  };

  it('hides an entry, or a key inside it, of Base before the overrides merge (keyedTombstones)', () => {
    const merged = mergeScopeLayer(base, overrides, tombstones, undefined, true);
    expect(getValueAtPath(merged, 'endpoints.custom')).toEqual([
      { name: 'Gateway', baseURL: 'https://gw', headers: { 'X-Org': 'own' } },
    ]);
  });

  it('leaves them alone on a server that stores them without effect', () => {
    const merged = mergeScopeLayer(base, overrides, tombstones);
    expect(getValueAtPath(merged, 'endpoints.custom')).toEqual([
      { name: 'Ollama', baseURL: 'http://ollama' },
      { name: 'Gateway', baseURL: 'https://gw', headers: { 'X-Team': 'blue', 'X-Org': 'own' } },
    ]);
  });
});

describe('removeConfigPath / setConfigPath', () => {
  it('removes a nested key without touching the original', () => {
    const tree = { a: { b: 1, c: 2 } };
    expect(removeConfigPath(tree, 'a.b')).toEqual({ a: { c: 2 } });
    expect(tree).toEqual({ a: { b: 1, c: 2 } });
    expect(removeConfigPath(tree, 'a.b.c')).toEqual(tree);
  });

  it('sets values through objects and array indices, creating missing objects', () => {
    const tree: t.ConfigRecord = { list: [{ name: 'a' }, { name: 'b' }] };
    expect(setConfigPath(tree, 'list.1.name', 'z')).toEqual({
      list: [{ name: 'a' }, { name: 'z' }],
    });
    expect(setConfigPath(tree, 'x.y', 1)).toEqual({ ...tree, x: { y: 1 } });
    expect(setConfigPath(tree, 'list.0', undefined)).toEqual({ list: [{ name: 'b' }] });
    expect(setConfigPath(tree, 'list.name', 'bad')).toBe(tree);
    expect(setConfigPath(tree, '__proto__.x', 1)).toBe(tree);
  });
});

describe('overlayPendingEdits', () => {
  const tree: t.ConfigRecord = {
    endpoints: { custom: [{ name: 'A' }, { name: 'B' }] },
    mcpServers: { yaml: { url: 'override' }, db: { url: 'db' } },
    balance: { startBalance: 1 },
  };
  const revertAt = (path: string): t.ConfigValue =>
    path === 'mcpServers.yaml' ? { url: 'yaml' } : undefined;

  it('applies whole-list edits and new entries, leaving primitive edits to the fields', () => {
    const result = overlayPendingEdits(
      tree,
      [
        ['endpoints.custom', [{ name: 'B' }]],
        ['mcpServers.added', { url: 'new' }],
        ['balance.startBalance', 5],
      ],
      revertAt,
    );
    expect(getValueAtPath(result, 'endpoints.custom')).toEqual([{ name: 'B' }]);
    expect(getValueAtPath(result, 'mcpServers.added')).toEqual({ url: 'new' });
    expect(getValueAtPath(result, 'balance.startBalance')).toBe(1);
  });

  it('shows a pending entry reset as its fallback, or removes the entry', () => {
    const result = overlayPendingEdits(
      tree,
      [
        ['mcpServers.yaml', undefined],
        ['mcpServers.db', undefined],
        ['balance.startBalance', undefined],
      ],
      revertAt,
    );
    expect(result.mcpServers).toEqual({ yaml: { url: 'yaml' } });
    expect(getValueAtPath(result, 'balance.startBalance')).toBe(1);
  });

  it('serializes key/value pair edits into records', () => {
    const result = overlayPendingEdits(
      tree,
      [['mcpServers.db.headers', [{ key: 'X-Id', value: '1', valueType: 'string' }]]],
      revertAt,
    );
    expect(getValueAtPath(result, 'mcpServers.db.headers')).toEqual({ 'X-Id': '1' });
  });
});

describe('createBaseLayers', () => {
  it('ignores `{}` overrides and maps secret preview paths to their secret', () => {
    const layers = createBaseLayers(
      baseConfigFixture({
        dbOverrides: { balance: {}, webSearch: { serperApiKeyPreview: 'sk-…1234' } },
        yamlPaths: ['cache'],
      }),
      new Set(['webSearch.serperApiKey']),
    );
    expect([...layers.baseOverridePaths.paths]).toEqual(['webSearch.serperApiKey']);
    expect(layers.baseOverridePaths.ancestors.has('webSearch')).toBe(true);
  });
});

describe('profile edits are diffed against the effective (inherited) value', () => {
  const layers = scopeLayersFixture();
  const baseline = flattenObject(layers.effective ?? {});

  it('drops an edit that sets an inherited value to what it already is', () => {
    const toggledOff = applyConfigEdit(
      {},
      'balance.enabled',
      false,
      baseline,
      new Set(),
      new Set(),
    );
    expect(toggledOff).toEqual({ 'balance.enabled': false });
    const toggledBack = applyConfigEdit(
      toggledOff,
      'balance.enabled',
      true,
      baseline,
      new Set(),
      new Set(),
    );
    expect(toggledBack).toEqual({});
  });

  it('does not save an edit equal to the inherited value', () => {
    const plan = buildSavePayload(
      new Set(['balance.enabled']),
      { 'balance.enabled': true },
      new Set(['balance.enabled']),
      {
        fields: [],
        baselineAt: (path) => getValueAtPath(layers.effective, path),
        hasOverride: () => false,
      },
    );
    expect(plan.saves).toEqual([]);
    expect(plan.resets).toEqual([]);
  });
});

describe('estimateConfigPreview', () => {
  const base: t.BaseConfigData = {
    config: { interface: { customWelcome: 'Base hi', bookmarks: true }, version: '1.3.3' },
    yamlConfig: { interface: { customWelcome: 'YAML hi', bookmarks: true }, version: '1.3.3' },
    yamlPaths: [],
    dbOverrides: { interface: { customWelcome: 'Base hi' } },
    dbTombstones: [],
    schemaDefaults: {},
  };
  const profile: t.ConfigScope = {
    principalType: PrincipalType.ROLE,
    principalId: 'USER',
    name: 'USER',
    priority: 10,
    isActive: true,
  };
  const own: t.ResolvedConfigData = {
    resolvedConfig: {},
    changedPaths: [],
    overrides: { interface: { customWelcome: 'Role hi' } },
    tombstones: ['interface.bookmarks'],
  };

  it('is Base alone, with its document, for everyone or a principal without a profile', () => {
    const preview = estimateConfigPreview({ base });
    expect(preview.source).toBe('panel');
    expect(preview.yaml).toBe(base.yamlConfig);
    expect(preview.resolved).toBe(base.config);
    expect(preview.layers).toEqual([
      {
        principalType: 'role',
        principalId: '__base__',
        priority: 0,
        isActive: true,
        overrides: base.dbOverrides,
        tombstones: [],
        ignored: [],
      },
    ]);
  });

  it('merges the principal profile over Base, its tombstones removing what they hide', () => {
    const preview = estimateConfigPreview({ base, scope: profile, own });
    expect(preview.resolved).toEqual({
      interface: { customWelcome: 'Role hi' },
      version: '1.3.3',
    });
    expect(preview.layers.map((layer) => layer.principalId)).toEqual(['__base__', 'USER']);
    expect(preview.layers[1]).toMatchObject({ priority: 10, isActive: true, ignored: [] });
  });

  it('lists an inactive profile without merging it, as LibreChat skips it', () => {
    const preview = estimateConfigPreview({
      base,
      scope: { ...profile, isActive: false },
      own,
    });
    expect(preview.resolved).toBe(base.config);
    expect(preview.layers[1].isActive).toBe(false);
  });

  it('leaves out the specs of an endpoint the profile hides, where the server applies keyed tombstones', () => {
    const foundry = { name: 'Azure Foundry', baseURL: 'https://foundry' };
    const spec = { name: 'gpt', preset: { endpoint: 'Azure Foundry', model: 'gpt-5' } };
    const withSpec: t.BaseConfigData = {
      ...base,
      config: { ...base.config, endpoints: { custom: [foundry] }, modelSpecs: { list: [spec] } },
      yamlConfig: { endpoints: { custom: [foundry] }, modelSpecs: { list: [spec] } },
    };
    const hides: t.ResolvedConfigData = {
      ...own,
      overrides: {},
      tombstones: ['endpoints.custom["Azure Foundry"]'],
    };
    const input = { base: withSpec, scope: profile, own: hides };
    const keyed = estimateConfigPreview({ ...input, keyedTombstones: true });
    expect(getValueAtPath(keyed.resolved, 'endpoints.custom')).toEqual([]);
    expect(keyed.resolved.modelSpecs).toBeUndefined();
    const older = estimateConfigPreview(input);
    expect(getValueAtPath(older.resolved, 'modelSpecs.list')).toEqual([spec]);
  });

  it('lists no Base document when there is none', () => {
    const preview = estimateConfigPreview({
      base: { ...base, dbOverrides: undefined, yamlConfig: undefined },
    });
    expect(preview.layers).toEqual([]);
    expect(preview.yaml).toEqual({});
  });
});

describe('Azure groups and re-derived values in a profile', () => {
  const base: t.ConfigRecord = {
    endpoints: {
      azureOpenAI: {
        groups: [
          { group: 'eastus', instanceName: 'east', models: { 'gpt-4o': { deploymentName: 'a' } } },
        ],
      },
    },
  };
  const overrides: t.ConfigRecord = {
    endpoints: {
      azureOpenAI: {
        groups: [
          { group: 'eastus', models: { mini: { deploymentName: 'm' } } },
          { group: 'west', instanceName: 'west', models: {} },
        ],
      },
    },
  };

  it("merges a profile's groups by name where LibreChat derives them again, else keeps Base's", () => {
    const rederive = getWriteRules(
      createServerContract({
        endpointRederive: true,
        azureGroupMergeKey: true,
        azureGroupSecrets: true,
      }),
    );
    expect(
      getValueAtPath(
        mergeScopeLayer(base, overrides, [], rederive),
        'endpoints.azureOpenAI.groups',
      ),
    ).toEqual([
      {
        group: 'eastus',
        instanceName: 'east',
        models: { 'gpt-4o': { deploymentName: 'a' }, mini: { deploymentName: 'm' } },
      },
      { group: 'west', instanceName: 'west', models: {} },
    ]);
    expect(mergeScopeLayer(base, overrides)).toEqual(base);
  });

  it("reads a key a layer stores for an entry as that key's preview, never beside the lower key", () => {
    const rederive = getWriteRules(
      createServerContract({
        endpointRederive: true,
        azureGroupMergeKey: true,
        azureGroupSecrets: true,
      }),
    );
    const yaml: t.ConfigRecord = {
      endpoints: {
        azureOpenAI: {
          groups: [
            { group: 'eastus', apiKey: '${EASTUS_API_KEY}', instanceName: 'east' },
            { group: 'west', apiKeyPreview: '...1234', instanceName: 'west' },
            { group: 'north', apiKey: '${NORTH_API_KEY}', instanceName: 'north' },
          ],
        },
        custom: [{ name: 'Moonshot', apiKey: '${MOONSHOT_API_KEY}', baseURL: 'https://m' }],
      },
    };
    const stored: t.ConfigRecord = {
      endpoints: {
        azureOpenAI: {
          groups: [
            { group: 'eastus', apiKeyPreview: '...5555' },
            { group: 'west', apiKey: 'sk-typed' },
            { group: 'north', version: 'v2' },
          ],
        },
        custom: [{ name: 'Moonshot', apiKeyPreview: '...9999' }],
      },
    };
    const merged = mergeScopeLayer(yaml, stored, [], rederive);
    expect(getValueAtPath(merged, 'endpoints.azureOpenAI.groups')).toEqual([
      { group: 'eastus', apiKeyPreview: '...5555', instanceName: 'east' },
      { group: 'west', apiKey: 'sk-typed', instanceName: 'west' },
      { group: 'north', apiKey: '${NORTH_API_KEY}', instanceName: 'north', version: 'v2' },
    ]);
    expect(getValueAtPath(merged, 'endpoints.custom')).toEqual([
      { name: 'Moonshot', apiKeyPreview: '...9999', baseURL: 'https://m' },
    ]);
  });

  it('derives the spec controls no layer sets from the specs the profile gets (specInterfaceRederive)', () => {
    const layers = createBaseLayers(baseConfigFixture(), new Set());
    const scope = { principalType: PrincipalType.ROLE, name: 'USER' };
    const hidesSpecs: t.ResolvedConfigData = {
      resolvedConfig: {},
      changedPaths: [],
      overrides: {},
      tombstones: ['modelSpecs'],
    };
    const derived = withScopeLayer(layers, scope, hidesSpecs, new Set(), undefined, false, true);
    expect(derived.effective?.interface).toEqual({
      parameters: true,
      presets: true,
      modelSelect: true,
    });
    const keeps = withScopeLayer(
      layers,
      scope,
      { ...hidesSpecs, tombstones: [] },
      new Set(),
      undefined,
      false,
      true,
    );
    expect(keeps.effective?.interface).toEqual({
      parameters: true,
      presets: false,
      modelSelect: false,
    });
    const before = withScopeLayer(layers, scope, hidesSpecs, new Set());
    expect(before.effective?.interface).toEqual({ parameters: true });
  });

  it('derives the spec controls from the specs left once the profile hides their endpoint', () => {
    const yaml = baseConfigFixture().yamlConfig ?? {};
    const claudeSpec = { name: 'spec-c', preset: { endpoint: 'Claude' } };
    const withSpecs = (specs: t.ConfigRecord): t.BaseConfigData => ({
      ...baseConfigFixture(),
      config: { ...yaml, modelSpecs: specs },
      yamlConfig: { ...yaml, modelSpecs: specs },
    });
    const scope = { principalType: PrincipalType.ROLE, name: 'USER' };
    const hidesClaude: t.ResolvedConfigData = {
      resolvedConfig: {},
      changedPaths: [],
      overrides: {},
      tombstones: ['endpoints.custom["Claude"]'],
    };
    const layersOf = (specs: t.ConfigRecord) => createBaseLayers(withSpecs(specs), new Set());
    const derive = (
      layers: t.ValueLayers,
      data: t.ResolvedConfigData,
      keyedTombstones = true,
    ): t.ConfigValue =>
      withScopeLayer(layers, scope, data, new Set(), undefined, keyedTombstones, true).effective
        ?.interface;
    const allOn = { parameters: true, presets: true, modelSelect: true };
    const specsOff = { parameters: true, presets: false, modelSelect: false };

    const onlyClaude = layersOf({ list: [claudeSpec] });
    expect(derive(onlyClaude, hidesClaude)).toEqual(allOn);
    expect(derive(onlyClaude, { ...hidesClaude, tombstones: [] })).toEqual(specsOff);
    expect(derive(onlyClaude, hidesClaude, false)).toEqual(specsOff);

    const both = layersOf({ list: [claudeSpec, { name: 'spec-g', preset: { endpoint: 'GPT' } }] });
    expect(derive(both, hidesClaude)).toEqual(specsOff);

    const ownList: t.ResolvedConfigData = {
      ...hidesClaude,
      changedPaths: ['modelSpecs.list'],
      overrides: { modelSpecs: { list: [claudeSpec] } },
    };
    expect(derive(layersOf({ list: [{ name: 'spec-a' }] }), ownList)).toEqual(allOn);

    const added = layersOf({ list: [claudeSpec], addedEndpoints: ['GPT', 'Claude'] });
    expect(derive(added, hidesClaude)).toEqual(allOn);
  });
});
