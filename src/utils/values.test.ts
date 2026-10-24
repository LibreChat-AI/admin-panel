import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import {
  baseConfigFixture,
  baseLayersFixture,
  valuesDataFixture,
  scopeConfigFixture,
  scopeLayersFixture,
  FIXTURE_SCHEMA_PATHS,
} from '@/test/layers';
import { deriveFieldState, deriveFieldValue, revertTargetAt, resolveShadowedBy } from './values';
import { mergeScopeLayer, createBaseLayers } from './layers';

function data(overrides: Partial<t.ConfigValuesData> = {}): t.ConfigValuesData {
  return {
    configValues: { balance: { enabled: true, startBalance: 1000 } },
    editedValues: {},
    schemaDefaults: { 'balance.refillAmount': 10000 },
    configuredPaths: new Set(['balance.enabled', 'balance.startBalance']),
    overridePaths: new Set(['balance.startBalance']),
    pendingResets: new Set(),
    ...overrides,
  };
}

describe('deriveFieldState', () => {
  it('returns an empty default state outside a provider', () => {
    expect(deriveFieldState('balance.enabled', null)).toMatchObject({
      value: undefined,
      source: 'default',
      isConfigured: false,
      isEdited: false,
    });
  });

  it('reports admin overrides, librechat.yaml values and defaults in base mode', () => {
    expect(deriveFieldState('balance.startBalance', data())).toMatchObject({
      value: 1000,
      effective: 1000,
      source: 'admin',
      isOverride: true,
      isConfigured: true,
    });
    expect(deriveFieldState('balance.enabled', data()).source).toBe('yaml');
    expect(deriveFieldState('balance.refillAmount', data())).toMatchObject({
      value: undefined,
      effective: 10000,
      source: 'default',
    });
  });

  it('shows the pending edit and flags edits and resets', () => {
    const edited = deriveFieldState(
      'balance.startBalance',
      data({ editedValues: { 'balance.startBalance': 5 } }),
    );
    expect(edited).toMatchObject({ value: 5, effective: 1000, isEdited: true });
    const reset = deriveFieldState(
      'balance.startBalance',
      data({
        editedValues: { 'balance.startBalance': undefined },
        pendingResets: new Set(['balance.startBalance']),
      }),
    );
    expect(reset).toMatchObject({ isEdited: true, isPendingReset: true });
  });

  it('reports profile overrides as scope and everything else as inherited', () => {
    const scope = data({ isEditingScope: true });
    expect(deriveFieldState('balance.startBalance', scope).source).toBe('scope');
    expect(deriveFieldState('balance.enabled', scope).source).toBe('inherited');
  });
});

describe('deriveFieldState with the layer model (base mode)', () => {
  const data = valuesDataFixture(baseLayersFixture());

  it('marks librechat.yaml values as yaml even when they equal the schema default', () => {
    expect(deriveFieldState('cache', data)).toMatchObject({
      value: true,
      effective: true,
      source: 'yaml',
      isConfigured: true,
      isOverride: false,
    });
    expect(deriveFieldState('interface.parameters', data)).toMatchObject({
      source: 'yaml',
      isConfigured: true,
    });
  });

  it('does not mark the fields of a switch librechat.yaml sets to a bare boolean as set', () => {
    const yaml: t.ConfigRecord = { interface: { schedules: true } };
    const layers = baseLayersFixture(
      baseConfigFixture({
        config: yaml,
        yamlConfig: yaml,
        yamlPaths: ['interface.schedules'],
        dbOverrides: {},
      }),
    );
    const own = valuesDataFixture(layers);
    expect(deriveFieldState('interface.schedules', own)).toMatchObject({ source: 'yaml' });
    expect(deriveFieldState('interface.schedules.maxPerUser', own)).toMatchObject({
      source: 'default',
      isConfigured: false,
    });
  });

  it('reports a base override with the librechat.yaml value it reverts to', () => {
    const state = deriveFieldState('balance.startBalance', data);
    expect(state).toMatchObject({
      value: 2500000,
      effective: 2500000,
      source: 'admin',
      isOverride: true,
      isConfigured: true,
      revertTarget: { value: 1000000, source: 'yaml' },
    });
    expect(state.stack).toEqual([
      { source: 'default', value: 20000 },
      { source: 'yaml', value: 1000000 },
      { source: 'admin', value: 2500000 },
    ]);
  });

  it('previews the revert target, not the schema default, while a reset is pending', () => {
    const pending = valuesDataFixture(baseLayersFixture(), { 'balance.startBalance': undefined });
    expect(deriveFieldState('balance.startBalance', pending)).toMatchObject({
      value: 1000000,
      isEdited: true,
      isPendingReset: true,
    });
  });

  it('falls back to the schema default when nothing lower than the override sets the field', () => {
    const layers = baseLayersFixture(
      baseConfigFixture({ dbOverrides: { balance: { autoRefillEnabled: true } } }),
    );
    const state = deriveFieldState('balance.autoRefillEnabled', valuesDataFixture(layers));
    expect(state.revertTarget).toEqual({ value: false, source: 'default' });
  });

  it('labels values LibreChat fills in at startup as runtime defaults, not configured', () => {
    expect(deriveFieldState('secureImageLinks', data)).toMatchObject({
      effective: true,
      source: 'runtimeDefault',
      isConfigured: false,
    });
    expect(deriveFieldState('endpoints.azureAssistants.version', data)).toMatchObject({
      source: 'runtimeDefault',
      isConfigured: false,
    });
    expect(deriveFieldState('endpoints.agents.maxCitations', data)).toMatchObject({
      source: 'default',
      isConfigured: false,
    });
  });

  it('shows the effective default in the control for an unset field', () => {
    expect(deriveFieldState('balance.autoRefillEnabled', data)).toMatchObject({
      value: false,
      effective: false,
      source: 'default',
      isConfigured: false,
    });
    expect(deriveFieldState('interface.presets', data)).toMatchObject({ value: true });
  });

  it('ignores `{}` left in the overrides document', () => {
    expect(deriveFieldState('webSearch.serperApiKey', data)).toMatchObject({
      isOverride: false,
      isConfigured: false,
    });
  });

  it('uses the field meta runtime default when nothing else sets the field', () => {
    const layers = { ...baseLayersFixture(), runtimeDefaultAt: () => 42 };
    expect(
      deriveFieldState('balance.refillIntervalValue', valuesDataFixture(layers)),
    ).toMatchObject({ value: 42, effective: 42, source: 'runtimeDefault' });
  });

  it('reports base tombstones as hidden with the librechat.yaml value as revert target', () => {
    const layers = baseLayersFixture(baseConfigFixture({ dbTombstones: ['balance.refillAmount'] }));
    expect(deriveFieldState('balance.refillAmount', valuesDataFixture(layers))).toMatchObject({
      isHidden: true,
      source: 'admin',
      revertTarget: { value: 1000000, source: 'yaml' },
    });
  });
});

describe('deriveFieldState for an override LibreChat ignores (D5)', () => {
  const layers = baseLayersFixture(
    baseConfigFixture({ dbOverrides: { rateLimits: { fileUploads: { ipMax: 5 } } } }),
  );
  const own = valuesDataFixture(layers);

  it('shows the librechat.yaml value, not the stored override, and flags it as ignored', () => {
    const state = deriveFieldState('rateLimits.fileUploads.ipMax', own);
    expect(state).toMatchObject({ isOverride: true, ignoredOverride: true, value: undefined });
    expect(deriveFieldValue('rateLimits.fileUploads.ipMax', 5, own)).toBeUndefined();
  });

  it('shows a pending edit over the ignored override', () => {
    const edited = valuesDataFixture(layers, { 'rateLimits.fileUploads.ipMax': undefined });
    expect(deriveFieldState('rateLimits.fileUploads.ipMax', edited)).toMatchObject({
      ignoredOverride: true,
      isEdited: true,
    });
  });
});

describe('deriveFieldState with the layer model (profile mode)', () => {
  const data = valuesDataFixture(scopeLayersFixture());

  it('shows inherited Base values instead of empty or OFF controls', () => {
    expect(deriveFieldState('balance.enabled', data)).toMatchObject({
      value: true,
      effective: true,
      source: 'inherited',
      inherited: { value: true, source: 'yaml' },
      isConfigured: false,
      isOverride: false,
    });
    expect(deriveFieldState('endpoints.custom', data).value).toHaveLength(2);
    expect(deriveFieldState('mcpServers.github.url', data).value).toBe('https://gh.example.com');
  });

  it("reports the profile's own override with the inherited value as revert target", () => {
    const state = deriveFieldState('balance.startBalance', data);
    expect(state).toMatchObject({
      value: 777,
      effective: 777,
      source: 'scope',
      isOverride: true,
      isConfigured: true,
      inherited: { value: 2500000, source: 'admin' },
      revertTarget: { value: 2500000, source: 'inherited' },
    });
    expect(state.stack?.map((layer) => layer.source)).toEqual([
      'default',
      'yaml',
      'admin',
      'scope',
    ]);
  });

  it('previews the inherited value while a profile reset is pending', () => {
    const pending = valuesDataFixture(scopeLayersFixture(), { 'balance.startBalance': undefined });
    expect(deriveFieldState('balance.startBalance', pending).value).toBe(2500000);
  });

  it('reports tombstoned entries as hidden', () => {
    expect(deriveFieldState('mcpServers.docs', data)).toMatchObject({
      isHidden: true,
      source: 'scope',
      isConfigured: true,
      revertTarget: { value: { url: 'https://docs' }, source: 'inherited' },
    });
    expect(deriveFieldState('mcpServers.docs.url', data).isHidden).toBe(true);
  });

  it('shows a pending Unhide or Hide on the row before Save', () => {
    const pending: t.ConfigValuesData = {
      ...data,
      visibilityEdits: { 'mcpServers.docs': 'unhide', 'balance.refillAmount': 'hide' },
    };
    expect(deriveFieldState('mcpServers.docs', pending)).toMatchObject({
      isHidden: false,
      isEdited: true,
      source: 'inherited',
      value: { url: 'https://docs' },
    });
    expect(deriveFieldState('balance.refillAmount', pending)).toMatchObject({
      isHidden: true,
      isEdited: true,
    });
  });
});

describe('resolveShadowedBy (endpoints.all precedence)', () => {
  const root = baseLayersFixture().effective;

  it('shadows every per-endpoint title setting while an `all` block exists', () => {
    expect(resolveShadowedBy('endpoints.openAI.titleModel', root)).toEqual({
      path: 'endpoints.all.titleModel',
      value: undefined,
      precedence: 'block',
    });
    expect(resolveShadowedBy('endpoints.custom.0.titleModel', root)?.precedence).toBe('block');
  });

  it('shadows activity settings only where `all` sets the same field', () => {
    expect(resolveShadowedBy('endpoints.anthropic.activityModel', root)).toEqual({
      path: 'endpoints.all.activityModel',
      value: 'gpt-5.6-luna',
      precedence: 'field',
    });
    expect(resolveShadowedBy('endpoints.anthropic.reasoningLabelModel', root)).toBeUndefined();
  });

  it('never shadows the `all` block itself or unrelated fields, and follows pending edits', () => {
    expect(resolveShadowedBy('endpoints.all.activityModel', root)).toBeUndefined();
    expect(resolveShadowedBy('endpoints.openAI.models', root)).toBeUndefined();
    expect(resolveShadowedBy('balance.startBalance', root)).toBeUndefined();
    expect(
      resolveShadowedBy('endpoints.anthropic.activityModel', root, {
        'endpoints.all.activityModel': undefined,
      }),
    ).toBeUndefined();
    expect(resolveShadowedBy('endpoints.openAI.titleModel', { endpoints: {} })).toBeUndefined();
  });

  it('is reported on the field state', () => {
    const data = valuesDataFixture(baseLayersFixture());
    expect(deriveFieldState('endpoints.anthropic.activityModel', data).shadowedBy?.value).toBe(
      'gpt-5.6-luna',
    );
  });

  describe("on a server that resolves titles per field (titleResolution: 'field')", () => {
    const withTitles = (all: t.ConfigRecord): t.ConfigRecord => ({
      endpoints: { all, openAI: { titleModel: 'gpt-5-mini', titleMethod: 'structured' } },
    });

    it('shadows a title setting only where `all` sets it', () => {
      const tree = withTitles({ activityLabel: true, titleMethod: 'completion' });
      expect(resolveShadowedBy('endpoints.openAI.titleModel', tree, {}, 'field')).toBeUndefined();
      expect(resolveShadowedBy('endpoints.openAI.titleMethod', tree, {}, 'field')).toEqual({
        path: 'endpoints.all.titleMethod',
        value: 'completion',
        precedence: 'field',
      });
      expect(resolveShadowedBy('endpoints.openAI.titleMethod', tree)?.precedence).toBe('block');
    });

    it('treats the title endpoint and model as one choice, pointing to the half `all` sets', () => {
      const tree = withTitles({ titleEndpoint: 'anthropic' });
      expect(resolveShadowedBy('endpoints.openAI.titleModel', tree, {}, 'field')).toEqual({
        path: 'endpoints.all.titleEndpoint',
        value: undefined,
        precedence: 'pair',
      });
      expect(
        resolveShadowedBy(
          'endpoints.custom.0.titleEndpoint',
          withTitles({ titleModel: 'm' }),
          {},
          'field',
        ),
      ).toEqual({ path: 'endpoints.all.titleModel', value: undefined, precedence: 'pair' });
      expect(
        resolveShadowedBy(
          'endpoints.openAI.titleModel',
          withTitles({}),
          {
            'endpoints.all.titleEndpoint': 'anthropic',
          },
          'field',
        )?.path,
      ).toBe('endpoints.all.titleEndpoint');
      expect(
        resolveShadowedBy(
          'endpoints.openAI.titleModel',
          tree,
          { 'endpoints.all.titleEndpoint': undefined },
          'field',
        ),
      ).toBeUndefined();
    });

    it('is reported on the field state with the contract of the values', () => {
      const data = valuesDataFixture(baseLayersFixture());
      const state = (titleResolution?: t.ConfigRules['titleResolution']) =>
        deriveFieldState('endpoints.openAI.titleModel', { ...data, titleResolution }).shadowedBy;
      expect(state()?.precedence).toBe('block');
      expect(state('field')).toBeUndefined();
    });
  });
});

describe('deriveFieldValue', () => {
  it("falls back to the caller's value only when the state has none", () => {
    const data = valuesDataFixture(baseLayersFixture());
    expect(deriveFieldValue('mcpServers', {}, data)).toEqual(
      baseLayersFixture().effective?.mcpServers,
    );
    expect(deriveFieldValue('nothing.here', 'fallback', data)).toBe('fallback');
  });

  it('keeps an unset revert target for a pending reset instead of the fallback', () => {
    const layers = baseLayersFixture(
      baseConfigFixture({ dbOverrides: { speech: { tts: { url: 'x' } } } }),
    );
    const data = valuesDataFixture(layers, { 'speech.tts.url': undefined });
    expect(deriveFieldValue('speech.tts.url', 'x', data)).toBeUndefined();
  });
});

describe('deriveFieldState for model specs (a list replaced whole)', () => {
  const base = baseConfigFixture({
    dbOverrides: {
      modelSpecs: {
        list: [
          { name: 'spec-b', label: 'Spec B' },
          { name: 'spec-a', label: 'Spec A (admin)' },
        ],
      },
    },
  });
  const data = valuesDataFixture(baseLayersFixture(base));

  it("reads each spec's lower value from the same spec, not from its index", () => {
    expect(deriveFieldState('modelSpecs.list.0.label', data)).toMatchObject({
      value: 'Spec B',
      source: 'admin',
      revertTarget: { value: undefined, source: 'default' },
    });
    expect(deriveFieldState('modelSpecs.list.1.label', data)).toMatchObject({
      value: 'Spec A (admin)',
      source: 'admin',
      revertTarget: { value: 'Spec A', source: 'yaml' },
    });
  });
});

describe('deriveFieldState for a spec the owned list leaves a field out of', () => {
  const yaml: t.ConfigRecord = {
    modelSpecs: { list: [{ name: 'spec-a', label: 'Spec A', description: 'From YAML' }] },
  };
  const owned: t.ConfigRecord = {
    modelSpecs: { list: [{ name: 'spec-a', label: 'Spec A (admin)' }] },
  };

  it('does not present librechat.yaml’s field as what Base users get (Base owns the list)', () => {
    const layers = baseLayersFixture(
      baseConfigFixture({
        yamlConfig: yaml,
        yamlPaths: ['modelSpecs.list'],
        dbOverrides: owned,
        config: mergeScopeLayer(yaml, owned),
      }),
    );
    expect(
      deriveFieldState('modelSpecs.list.0.description', valuesDataFixture(layers)),
    ).toMatchObject({
      value: undefined,
      effective: undefined,
      source: 'default',
      isConfigured: false,
      isOverride: false,
    });
    expect(deriveFieldState('modelSpecs.list.0.label', valuesDataFixture(layers))).toMatchObject({
      value: 'Spec A (admin)',
      source: 'admin',
      revertTarget: { value: 'Spec A', source: 'yaml' },
    });
  });

  it('does not present Base’s field as what a profile gets (the profile owns the list)', () => {
    const base = baseConfigFixture({
      yamlConfig: yaml,
      yamlPaths: ['modelSpecs.list'],
      dbOverrides: {},
      config: yaml,
    });
    const layers = scopeLayersFixture(
      scopeConfigFixture({
        resolvedConfig: {},
        changedPaths: ['modelSpecs.list'],
        overrides: owned,
        tombstones: [],
      }),
      base,
    );
    expect(
      deriveFieldState('modelSpecs.list.0.description', valuesDataFixture(layers)),
    ).toMatchObject({
      value: undefined,
      effective: undefined,
      source: 'default',
      inherited: { value: 'From YAML' },
    });
  });
});

describe('deriveFieldState for custom endpoints (merged by name)', () => {
  const base = baseConfigFixture({
    dbOverrides: {
      endpoints: {
        custom: [
          { name: 'Claude', baseURL: 'https://override.example.com' },
          { name: 'Added', baseURL: 'https://added.example.com' },
        ],
      },
    },
  });
  const data = valuesDataFixture(baseLayersFixture(base));

  it('tells librechat.yaml entries, overridden fields and panel-added entries apart', () => {
    expect(deriveFieldState('endpoints.custom.0.baseURL', data)).toMatchObject({
      value: 'https://gpt.example.com',
      source: 'yaml',
      isOverride: false,
    });
    expect(deriveFieldState('endpoints.custom.1.baseURL', data)).toMatchObject({
      value: 'https://override.example.com',
      source: 'admin',
      isOverride: true,
      revertTarget: { value: 'https://claude.example.com', source: 'yaml' },
    });
    expect(deriveFieldState('endpoints.custom.1.name', data)).toMatchObject({
      source: 'admin',
      revertTarget: { value: 'Claude', source: 'yaml' },
    });
    expect(deriveFieldState('endpoints.custom.2', data)).toMatchObject({
      source: 'admin',
      isOverride: true,
      revertTarget: { value: undefined, source: 'default' },
    });
  });

  it('counts a redacted secret override (its preview companion) as an override', () => {
    const redacted = baseConfigFixture({
      dbOverrides: { endpoints: { custom: [{ name: 'GPT', apiKeyPreview: 'sk-…1234' }] } },
    });
    const state = deriveFieldState(
      'endpoints.custom.0.apiKey',
      valuesDataFixture(baseLayersFixture(redacted)),
    );
    expect(state).toMatchObject({ isOverride: true, source: 'admin' });
  });

  it("matches a profile's entries by name, not by index", () => {
    const scope = scopeConfigFixture({
      overrides: { endpoints: { custom: [{ name: 'GPT', baseURL: 'https://role.example.com' }] } },
      changedPaths: ['endpoints.custom'],
      tombstones: [],
    });
    const scoped = valuesDataFixture(scopeLayersFixture(scope, base));
    expect(deriveFieldState('endpoints.custom.0.baseURL', scoped)).toMatchObject({
      value: 'https://role.example.com',
      source: 'scope',
      revertTarget: { value: 'https://gpt.example.com', source: 'inherited' },
    });
    expect(deriveFieldState('endpoints.custom.1.baseURL', scoped)).toMatchObject({
      value: 'https://override.example.com',
      source: 'inherited',
      inherited: { value: 'https://override.example.com', source: 'admin' },
    });
  });
});

describe('deriveFieldState inside an entry the target removes values of by key', () => {
  const removal = 'endpoints.custom["GPT"].headers.X-Team';
  const yaml: t.ConfigRecord = {
    endpoints: {
      custom: [
        {
          name: 'GPT',
          baseURL: 'https://gpt.example.com',
          headers: { 'X-Team': 'yaml', 'X-Keep': 'kept' },
        },
      ],
    },
  };
  const own: t.ConfigRecord = {
    endpoints: { custom: [{ name: 'GPT', headers: { 'X-Own': 'own' } }] },
  };
  const merged = { name: 'GPT', baseURL: 'https://gpt.example.com' };

  describe('in a profile', () => {
    const base = baseConfigFixture({ yamlConfig: yaml, config: yaml, dbOverrides: {} });
    const scope = scopeConfigFixture({
      overrides: own,
      changedPaths: ['endpoints.custom'],
      tombstones: [removal],
    });

    it('reverts a record to Base without the keys the profile removes (keyedTombstones)', () => {
      const layers = scopeLayersFixture(scope, base, true);
      const state = deriveFieldState('endpoints.custom.0.headers', valuesDataFixture(layers));
      expect(state.value).toEqual({ 'X-Keep': 'kept', 'X-Own': 'own' });
      expect(state.revertTarget).toEqual({ value: { 'X-Keep': 'kept' }, source: 'inherited' });
      expect(revertTargetAt('endpoints.custom.0.headers', layers)?.value).toEqual({
        'X-Keep': 'kept',
      });
    });

    it('keeps the removed key in the entry itself, which Remove overrides sets back whole', () => {
      const layers = scopeLayersFixture(scope, base, true);
      expect(revertTargetAt('endpoints.custom.0', layers)?.value).toEqual({
        ...merged,
        headers: { 'X-Team': 'yaml', 'X-Keep': 'kept' },
      });
    });

    it('reverts to Base as it is before the server applies keyed tombstones', () => {
      const layers = scopeLayersFixture(scope, base, false);
      const state = deriveFieldState('endpoints.custom.0.headers', valuesDataFixture(layers));
      expect(state.revertTarget?.value).toEqual({ 'X-Team': 'yaml', 'X-Keep': 'kept' });
    });
  });

  describe('in Base', () => {
    const data = baseConfigFixture({
      yamlConfig: yaml,
      config: {
        endpoints: {
          custom: [{ ...merged, headers: { 'X-Keep': 'kept', 'X-Own': 'own' } }],
        },
      },
      dbOverrides: own,
      dbTombstones: [removal],
    });

    it('reverts a record to librechat.yaml without the keys Base removes (keyedTombstones)', () => {
      const layers = createBaseLayers(data, FIXTURE_SCHEMA_PATHS, undefined, true);
      const state = deriveFieldState('endpoints.custom.0.headers', valuesDataFixture(layers));
      expect(state.revertTarget).toEqual({ value: { 'X-Keep': 'kept' }, source: 'yaml' });
    });

    it('reverts to librechat.yaml as it is without the flag', () => {
      const layers = createBaseLayers(data, FIXTURE_SCHEMA_PATHS);
      const state = deriveFieldState('endpoints.custom.0.headers', valuesDataFixture(layers));
      expect(state.revertTarget?.value).toEqual({ 'X-Team': 'yaml', 'X-Keep': 'kept' });
    });
  });
});
