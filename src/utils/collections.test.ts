import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import {
  diffOverride,
  applyEntryChanges,
  mergeConfigLayers,
  getKeyedCollection,
  resolveCollectionOps,
  findKeyedCollectionEntry,
  moveEntryPath,
} from './collections';

const custom = getKeyedCollection('endpoints.custom')!;
const specs = getKeyedCollection('modelSpecs.list')!;

/** AppService-expanded paramDefinitions, identical on both sides of a diff. */
const EXPANDED_PARAMS = {
  defaultParamsEndpoint: 'azureOpenAI',
  paramDefinitions: [
    {
      key: 'useResponsesApi',
      label: 'com_endpoint_use_responses_api',
      labelCode: true,
      type: 'boolean',
      default: true,
      component: 'switch',
      optionType: 'custom',
      columnSpan: 2,
    },
  ],
};

const yamlEndpoints: t.ConfigValue[] = [
  {
    name: 'Moonshot',
    apiKey: '${MOONSHOT_API_KEY}',
    baseURL: 'https://api.moonshot.ai/v1',
    models: { default: ['kimi-k2'], fetch: false },
  },
  {
    name: 'Azure AI Foundry',
    apiKey: '${SWEDEN_API_KEY}',
    baseURL: 'https://foundry.example.com/v1',
    customParams: EXPANDED_PARAMS,
    models: { default: ['gpt-5.1'], fetch: false },
  },
  { name: 'Zai 2', apiKey: 'user_provided', baseURL: 'https://zai.example.com' },
];

function upsert(
  key: string,
  identity: string | null,
  value: t.ConfigValue,
  baseline?: t.ConfigValue,
): t.EntryChange {
  return { op: 'upsertEntry', path: 'endpoints.custom', key, identity, value, baseline };
}

function resolve(
  ops: t.EntryChange[],
  stored: t.ConfigValue = undefined,
  lower: t.ConfigValue = yamlEndpoints,
  collection = custom,
) {
  return resolveCollectionOps({ collection, stored, lower, lowerKind: 'yaml', ops });
}

describe('findKeyedCollectionEntry', () => {
  it('locates entries and fields inside entries by index', () => {
    expect(findKeyedCollectionEntry('endpoints.custom.3')).toMatchObject({ index: 3, rest: '' });
    expect(findKeyedCollectionEntry('endpoints.custom.3.models.default')).toMatchObject({
      index: 3,
      rest: 'models.default',
    });
    expect(findKeyedCollectionEntry('endpoints.custom')).toBeUndefined();
    expect(findKeyedCollectionEntry('endpoints.customX.1')).toBeUndefined();
  });
});

describe('moveEntryPath', () => {
  const saved = {
    endpoints: { custom: [{ name: 'A' }, { name: 'BrandNew' }, { name: 'SecretOne' }] },
  };

  it('follows an entry to its pending position by name', () => {
    const pending = { endpoints: { custom: [{ name: 'BrandNew' }, { name: 'SecretOne' }] } };
    expect(moveEntryPath('endpoints.custom.2.baseURL', saved, pending)).toBe(
      'endpoints.custom.1.baseURL',
    );
    expect(moveEntryPath('endpoints.custom.1', saved, pending)).toBe('endpoints.custom.0');
  });

  it('names an entry the pending list no longer has by identity, so no other entry takes its place', () => {
    const pending = { endpoints: { custom: [{ name: 'A' }, { name: 'SecretOne' }] } };
    expect(moveEntryPath('endpoints.custom.1.name', saved, pending)).toBe(
      'endpoints.custom.BrandNew.name',
    );
  });

  it('leaves paths outside keyed lists as they are', () => {
    expect(moveEntryPath('balance.startBalance', saved, {})).toBe('balance.startBalance');
    expect(moveEntryPath('mcpServers.github.url', saved, {})).toBe('mcpServers.github.url');
  });
});

describe('mergeConfigLayers', () => {
  it('merges objects key by key and custom endpoints by name, replacing other arrays', () => {
    const merged = mergeConfigLayers(
      { endpoints: { custom: yamlEndpoints }, list: [1, 2] },
      {
        endpoints: { custom: [{ name: 'Moonshot', baseURL: 'https://x' }, { name: 'New' }] },
        list: [3],
      },
    ) as t.ConfigRecord;
    const endpoints = (merged.endpoints as t.ConfigRecord).custom as t.ConfigRecord[];
    expect(endpoints.map((e) => e.name)).toEqual(['Moonshot', 'Azure AI Foundry', 'Zai 2', 'New']);
    expect(endpoints[0]).toMatchObject({ baseURL: 'https://x', apiKey: '${MOONSHOT_API_KEY}' });
    expect(merged.list).toEqual([3]);
  });

  it("drops the lower entry's key where the upper one holds its own, as the two travel together", () => {
    const merged = mergeConfigLayers(
      yamlEndpoints,
      [{ name: 'Moonshot', apiKeyPreview: '...1234' }],
      'endpoints.custom',
    ) as t.ConfigRecord[];
    const { apiKey: _yamlKey, ...rest } = yamlEndpoints[0] as t.ConfigRecord;
    expect(merged[0]).toStrictEqual({ ...rest, apiKeyPreview: '...1234' });
  });
});

describe('diffOverride', () => {
  it('keeps only what differs, diffing nested objects key by key', () => {
    const lower = yamlEndpoints[0] as t.ConfigRecord;
    const desired = { ...lower, baseURL: 'https://api.moonshot.cn/v1' };
    expect(diffOverride(lower, desired)).toEqual({
      value: { baseURL: 'https://api.moonshot.cn/v1' },
      unremovable: [],
    });
    const nested = { ...lower, models: { default: ['kimi-k2'], fetch: true } };
    expect(diffOverride(lower, nested).value).toEqual({ models: { fetch: true } });
  });

  it('cancels identical AppService expansion noise on both sides', () => {
    const lower = yamlEndpoints[1] as t.ConfigRecord;
    const desired = { ...structuredClone(lower), titleModel: 'gpt-4.1' };
    expect(diffOverride(lower, desired).value).toEqual({ titleModel: 'gpt-4.1' });
  });

  it('reports keys the merge cannot remove', () => {
    const lower = { headers: { a: '1', b: '2' }, x: 1 };
    expect(diffOverride(lower, { headers: { a: '1' } }).unremovable).toEqual(['headers.b', 'x']);
  });
});

describe('applyEntryChanges (three-way)', () => {
  it('applies only the edited keys over the freshly stored entry', () => {
    const baseline = { name: 'A', baseURL: 'https://old', titleModel: 'm1' };
    const value = { ...baseline, baseURL: 'https://new' };
    const fresh = { name: 'A', baseURL: 'https://old', titleModel: 'changed-by-someone-else' };
    expect(applyEntryChanges(fresh, baseline, value)).toEqual({
      name: 'A',
      baseURL: 'https://new',
      titleModel: 'changed-by-someone-else',
    });
  });

  it('deletes keys the edit removed and recurses into objects', () => {
    const baseline = { headers: { a: '1', b: '2' }, iconURL: 'x' };
    const value = { headers: { a: '1', b: '3' } };
    const fresh = { headers: { a: '1', b: '2', c: '9' }, iconURL: 'x' };
    expect(applyEntryChanges(fresh, baseline, value)).toEqual({
      headers: { a: '1', b: '3', c: '9' },
    });
  });
});

describe('resolveCollectionOps — merge-by-key (endpoints.custom)', () => {
  it('stores one partial entry when one YAML endpoint field changes', () => {
    const baseline = yamlEndpoints[0];
    const value = { ...(baseline as t.ConfigRecord), baseURL: 'https://api.moonshot.cn/v1' };
    const result = resolve([upsert('Moonshot', 'Moonshot', value, baseline)]);
    expect(result.issues).toEqual([]);
    expect(result.next).toEqual([{ name: 'Moonshot', baseURL: 'https://api.moonshot.cn/v1' }]);
  });

  it('builds on the stored override array, never on the merged list', () => {
    const stored = [{ name: 'AdminEP', baseURL: 'https://admin', apiKey: 'user_provided' }];
    const baseline = yamlEndpoints[1];
    const value = { ...(baseline as t.ConfigRecord), titleModel: 'gpt-4.1' };
    const result = resolve(
      [upsert('Azure AI Foundry', 'Azure AI Foundry', value, baseline)],
      stored,
    );
    expect(result.next).toEqual([...stored, { name: 'Azure AI Foundry', titleModel: 'gpt-4.1' }]);
  });

  it('drops the stored entry when an edit reverts it to the YAML values', () => {
    const stored = [{ name: 'Moonshot', baseURL: 'https://api.moonshot.cn/v1' }];
    const baseline = {
      ...(yamlEndpoints[0] as t.ConfigRecord),
      baseURL: 'https://api.moonshot.cn/v1',
    };
    const value = yamlEndpoints[0];
    const result = resolve([upsert('Moonshot', 'Moonshot', value, baseline)], stored);
    expect(result.changed).toBe(true);
    expect(result.next).toBeUndefined();
  });

  it('refuses to remove or rename a YAML entry', () => {
    const remove: t.EntryChange = {
      op: 'removeEntry',
      path: 'endpoints.custom',
      key: 'Zai 2',
      identity: 'Zai 2',
    };
    expect(resolve([remove]).issues.map((i) => i.code)).toEqual(['YAML_ENTRY_IMMUTABLE']);
    const rename = upsert('Zai', 'Zai 2', { ...(yamlEndpoints[2] as t.ConfigRecord), name: 'Zai' });
    const result = resolve([rename]);
    expect(result.issues).toMatchObject([
      { code: 'YAML_ENTRY_IMMUTABLE', entryIdentity: 'Zai 2', params: { action: 'renamed' } },
    ]);
    expect(result.changed).toBe(false);
  });

  it('uses INHERITED_ENTRY_IMMUTABLE for entries a profile inherits', () => {
    const remove: t.EntryChange = {
      op: 'removeEntry',
      path: 'endpoints.custom',
      key: 'Moonshot',
      identity: 'Moonshot',
    };
    const result = resolveCollectionOps({
      collection: custom,
      stored: undefined,
      lower: yamlEndpoints,
      lowerKind: 'inherited',
      ops: [remove],
    });
    expect(result.issues[0].code).toBe('INHERITED_ENTRY_IMMUTABLE');
  });

  it('removes and renames DB-only entries', () => {
    const stored = [
      { name: 'AdminA', baseURL: 'https://a', apiKey: 'user_provided' },
      { name: 'AdminB', baseURL: 'https://b', apiKey: 'user_provided' },
    ];
    const removed = resolve(
      [{ op: 'removeEntry', path: 'endpoints.custom', key: 'AdminA', identity: 'AdminA' }],
      stored,
    );
    expect(removed.next).toEqual([stored[1]]);
    const renamed = resolve(
      [upsert('AdminC', 'AdminA', { ...stored[0], name: 'AdminC' }, stored[0])],
      stored,
    );
    expect(renamed.issues).toEqual([]);
    expect(renamed.next).toEqual([{ ...stored[0], name: 'AdminC' }, stored[1]]);
  });

  it('never writes to another entry when the edited one disappeared (concurrent delete)', () => {
    const storedNow = [{ name: 'AdminB', baseURL: 'https://b', apiKey: 'user_provided' }];
    const baseline = { name: 'AdminA', baseURL: 'https://a', apiKey: 'user_provided' };
    const result = resolve(
      [upsert('AdminA', 'AdminA', { ...baseline, baseURL: 'https://a2' }, baseline)],
      storedNow,
    );
    expect(result.issues.map((i) => i.code)).toEqual(['ENTRY_NOT_FOUND']);
    expect(result.changed).toBe(false);
  });

  it('rejects duplicate names on create and rename', () => {
    const created = resolve([
      upsert('Moonshot', null, { name: 'Moonshot', baseURL: 'https://dup' }),
    ]);
    expect(created.issues.map((i) => i.code)).toEqual(['DUPLICATE_ENTRY']);
  });

  it('rejects a name LibreChat serves as an existing entry (ollama / Ollama), on create and rename', () => {
    const lower = [...yamlEndpoints, { name: 'Ollama', baseURL: 'http://ollama:11434/v1' }];
    const created = resolve(
      [upsert('ollama', null, { name: 'ollama', baseURL: 'https://shadow' })],
      undefined,
      lower,
    );
    expect(created.issues).toEqual([
      expect.objectContaining({
        code: 'MERGED_ENTRY_NAME',
        entryPath: 'name',
        params: { name: 'ollama', other: 'Ollama' },
      }),
    ]);
    expect(created.changed).toBe(false);

    const shadow = { name: 'Shadow', apiKey: 'user_provided', baseURL: 'https://shadow' };
    const renamed = resolve(
      [upsert('OLLAMA', 'Shadow', { ...shadow, name: 'OLLAMA' }, shadow)],
      [shadow],
      lower,
    );
    expect(renamed.issues.map((i) => [i.code, i.entryIdentity])).toEqual([
      ['MERGED_ENTRY_NAME', 'Shadow'],
    ]);
    expect(renamed.changed).toBe(false);
  });

  it('rejects a name with a leading or trailing space (an import of "Trail ")', () => {
    const created = resolve([upsert('Trail ', null, { name: 'Trail ', baseURL: 'https://x' })]);
    expect(created.issues.map((i) => [i.code, i.entryIdentity])).toEqual([
      ['ENTRY_NAME_WHITESPACE', 'Trail '],
    ]);
  });

  it('rejects the name of a built-in endpoint', () => {
    const created = resolve([upsert('openAI', null, { name: 'openAI', baseURL: 'https://x' })]);
    expect(created.issues.map((i) => i.code)).toEqual(['RESERVED_ENTRY_NAME']);
  });

  it('lets an entry keep or edit a name only it has', () => {
    const shadow = { name: 'Shadow', apiKey: 'user_provided', baseURL: 'https://shadow' };
    const result = resolve(
      [upsert('Shadow 2', 'Shadow', { ...shadow, name: 'Shadow 2' }, shadow)],
      [shadow],
    );
    expect(result.issues).toEqual([]);
  });

  it('merges an upsert without a baseline (an import) into the current entry', () => {
    const stored = [
      { name: 'AdminA', apiKey: 'user_provided', baseURL: 'https://a', iconURL: 'i' },
    ];
    const result = resolve(
      [upsert('AdminA', 'AdminA', { name: 'AdminA', baseURL: 'https://a2' })],
      stored,
    );
    expect(result.next).toEqual([{ ...stored[0], baseURL: 'https://a2' }]);
  });

  it('appends new entries whole', () => {
    const entry = { name: 'OpenRouter Direct', apiKey: 'user_provided', baseURL: 'https://or' };
    expect(resolve([upsert('OpenRouter Direct', null, entry)]).next).toEqual([entry]);
  });

  it('resolves swapped and chained renames of DB-only entries as a whole', () => {
    const stored = [
      { name: 'AdminA', baseURL: 'https://a', apiKey: 'user_provided' },
      { name: 'AdminB', baseURL: 'https://b', apiKey: 'user_provided' },
    ];
    const swapped = resolve(
      [
        upsert('AdminB', 'AdminA', { ...stored[0], name: 'AdminB' }, stored[0]),
        upsert('AdminA', 'AdminB', { ...stored[1], name: 'AdminA' }, stored[1]),
      ],
      stored,
    );
    expect(swapped.issues).toEqual([]);
    expect(swapped.next).toEqual([
      { ...stored[0], name: 'AdminB' },
      { ...stored[1], name: 'AdminA' },
    ]);
    const chained = resolve(
      [
        upsert('AdminB', 'AdminA', { ...stored[0], name: 'AdminB' }, stored[0]),
        upsert('AdminC', 'AdminB', { ...stored[1], name: 'AdminC' }, stored[1]),
        upsert('AdminA', null, { name: 'AdminA', baseURL: 'https://new' }),
      ],
      stored,
    );
    expect(chained.issues).toEqual([]);
    expect(chained.next).toEqual([
      { ...stored[0], name: 'AdminB' },
      { ...stored[1], name: 'AdminC' },
      { name: 'AdminA', baseURL: 'https://new' },
    ]);
  });

  it('still rejects a rename onto a name the final list repeats, without temporary names', () => {
    const stored = [
      { name: 'AdminA', baseURL: 'https://a', apiKey: 'user_provided' },
      { name: 'Secret EP', baseURL: 'https://s', apiKeyPreview: 'sk-abc...1234' },
    ];
    const result = resolve(
      [
        upsert('Secret EP', 'AdminA', { ...stored[0], name: 'Secret EP' }, stored[0]),
        upsert('AdminA', 'Secret EP', { name: 'AdminA', baseURL: 'https://s' }, stored[1]),
      ],
      stored,
    );
    expect(result.issues.map((issue) => issue.code)).toEqual(['SECRET_REQUIRED_FOR_RENAME']);
    const names = (result.next ?? []).map((entry) => (entry as t.ConfigRecord).name);
    expect(names).toEqual(['Secret EP', 'Secret EP']);
    const onYaml = resolve(
      [upsert('Moonshot', 'AdminA', { ...stored[0], name: 'Moonshot' }, stored[0])],
      stored,
    );
    expect(onYaml.issues.map((issue) => issue.code)).toEqual(['DUPLICATE_ENTRY']);
  });

  it('requires a new API key to rename an entry whose stored key is encrypted (SV-10)', () => {
    const stored = [{ name: 'Secret EP', baseURL: 'https://s', apiKeyPreview: 'sk-abc...1234' }];
    const value = { name: 'Renamed EP', baseURL: 'https://s' };
    const blocked = resolve([upsert('Renamed EP', 'Secret EP', value, stored[0])], stored);
    expect(blocked.issues.map((i) => i.code)).toEqual(['SECRET_REQUIRED_FOR_RENAME']);
    const withKey = resolve(
      [upsert('Renamed EP', 'Secret EP', { ...value, apiKey: 'sk-new' }, stored[0])],
      stored,
    );
    expect(withKey.issues).toEqual([]);
    expect(withKey.next).toEqual([{ name: 'Renamed EP', baseURL: 'https://s', apiKey: 'sk-new' }]);
  });

  it('renames an entry with an encrypted key without a new one where the server carries it', () => {
    const stored = [{ name: 'Secret EP', baseURL: 'https://s', apiKeyPreview: 'sk-abc...1234' }];
    const value = { name: 'Renamed EP', baseURL: 'https://s' };
    const carried = resolveCollectionOps({
      collection: custom,
      stored,
      lower: yamlEndpoints,
      lowerKind: 'yaml',
      ops: [upsert('Renamed EP', 'Secret EP', value, stored[0])],
      carriesSecrets: true,
    });
    expect(carried.issues).toEqual([]);
    expect(carried.renames).toEqual([
      { path: 'endpoints.custom', from: 'Secret EP', to: 'Renamed EP' },
    ]);
    expect(carried.next).toEqual([{ name: 'Renamed EP', baseURL: 'https://s' }]);
    const withKey = resolveCollectionOps({
      collection: custom,
      stored,
      lower: yamlEndpoints,
      lowerKind: 'yaml',
      ops: [upsert('Renamed EP', 'Secret EP', { ...value, apiKey: 'sk-new' }, stored[0])],
      carriesSecrets: true,
    });
    expect(withKey.renames).toEqual([]);
  });

  it('still asks for the key of an entry whose rename swaps names with another', () => {
    const stored = [
      { name: 'A', baseURL: 'https://a', apiKeyPreview: 'sk-a...1111' },
      { name: 'B', baseURL: 'https://b', apiKeyPreview: 'sk-b...2222' },
    ];
    const result = resolveCollectionOps({
      collection: custom,
      stored,
      lower: yamlEndpoints,
      lowerKind: 'yaml',
      ops: [
        upsert('B', 'A', { name: 'B', baseURL: 'https://a' }, stored[0]),
        upsert('A', 'B', { name: 'A', baseURL: 'https://b' }, stored[1]),
      ],
      carriesSecrets: true,
    });
    expect(result.issues.map((issue) => issue.code)).toContain('SECRET_REQUIRED_FOR_RENAME');
    expect(result.renames).toEqual([]);
  });

  it('strips preview companions so stored secrets are kept by name', () => {
    const stored = [{ name: 'Secret EP', baseURL: 'https://s', apiKeyPreview: 'sk-abc...1234' }];
    const baseline = { name: 'Secret EP', baseURL: 'https://s', apiKeyPreview: 'sk-abc...1234' };
    const result = resolve(
      [upsert('Secret EP', 'Secret EP', { ...baseline, baseURL: 'https://s2' }, baseline)],
      stored,
    );
    expect(result.next).toEqual([{ name: 'Secret EP', baseURL: 'https://s2' }]);
  });

  it('keeps a librechat.yaml entry whose stored key is encrypted when the rest goes back', () => {
    const lower = yamlEndpoints[0] as t.ConfigRecord;
    const stored = [{ name: 'Moonshot', baseURL: 'https://cn', apiKeyPreview: 'sk-abc...1234' }];
    const baseline: t.ConfigRecord = {
      ...lower,
      baseURL: 'https://cn',
      apiKeyPreview: 'sk-abc...1234',
    };
    delete baseline.apiKey;
    const reverted = resolve(
      [upsert('Moonshot', 'Moonshot', { ...baseline, baseURL: lower.baseURL }, baseline)],
      stored,
    );
    expect(reverted.next).toEqual([{ name: 'Moonshot' }]);
  });

  it('removes a stored key by writing the librechat.yaml one, keeping other overrides', () => {
    const lower = yamlEndpoints[0] as t.ConfigRecord;
    const stored = [{ name: 'Moonshot', baseURL: 'https://cn', apiKeyPreview: 'sk-abc...1234' }];
    const baseline: t.ConfigRecord = {
      ...lower,
      baseURL: 'https://cn',
      apiKeyPreview: 'sk-abc...1234',
    };
    delete baseline.apiKey;
    const value = { ...baseline, apiKey: lower.apiKey };
    const result = resolve([upsert('Moonshot', 'Moonshot', value, baseline)], stored);
    expect(result.next).toEqual([
      { name: 'Moonshot', baseURL: 'https://cn', apiKey: '${MOONSHOT_API_KEY}' },
    ]);
    const only = resolve(
      [upsert('Moonshot', 'Moonshot', { ...value, baseURL: lower.baseURL }, baseline)],
      stored,
    );
    expect(only.next).toBeUndefined();
  });

  it('warns when an edit drops keys the YAML entry defines', () => {
    const lower = [{ name: 'CF', baseURL: 'https://cf', headers: { 'x-a': '1', 'x-b': '2' } }];
    const baseline = lower[0];
    const value = { ...baseline, headers: { 'x-a': '1' } };
    const result = resolve([upsert('CF', 'CF', value, baseline)], undefined, lower);
    expect(result.warnings).toEqual([
      { path: 'endpoints.custom', warning: 'yamlOnly', entryIdentity: 'CF', keys: ['headers.x-b'] },
    ]);
  });
});

describe('resolveCollectionOps — replace (modelSpecs.list)', () => {
  const yamlSpecs = [
    { name: 'gpt', label: 'GPT', preset: { endpoint: 'openAI' } },
    { name: 'claude', label: 'Claude', preset: { endpoint: 'anthropic' } },
  ];
  const specOp = (
    key: string,
    identity: string | null,
    value: t.ConfigValue,
    baseline?: t.ConfigValue,
  ): t.EntryChange => ({
    op: 'upsertEntry',
    path: 'modelSpecs.list',
    key,
    identity,
    value,
    baseline,
  });

  it('writes the whole list and flags the ownership change on the first edit', () => {
    const value = { ...yamlSpecs[0], label: 'GPT 5' };
    const result = resolve(
      [specOp('gpt', 'gpt', value, yamlSpecs[0])],
      undefined,
      yamlSpecs,
      specs,
    );
    expect(result.next).toEqual([value, yamlSpecs[1]]);
    expect(result.warnings).toEqual([{ path: 'modelSpecs.list', warning: 'ownershipChange' }]);
  });

  it('removes by identity, inserts new specs at their index, and resets when equal to YAML', () => {
    const removed = resolve(
      [{ op: 'removeEntry', path: 'modelSpecs.list', key: 'gpt', identity: 'gpt' }],
      undefined,
      yamlSpecs,
      specs,
    );
    expect(removed.next).toEqual([yamlSpecs[1]]);
    const added = resolve(
      [{ ...specOp('new', null, { name: 'new', label: 'New' }), index: 0 } as t.EntryChange],
      undefined,
      yamlSpecs,
      specs,
    );
    expect(added.next?.map((s) => (s as t.ConfigRecord).name)).toEqual(['new', 'gpt', 'claude']);
    const own = [{ ...yamlSpecs[0], label: 'GPT 5' }, yamlSpecs[1]];
    const reverted = resolve([specOp('gpt', 'gpt', yamlSpecs[0], own[0])], own, yamlSpecs, specs);
    expect(reverted).toMatchObject({ next: undefined, changed: true });
  });

  it('moves existing specs to their index, so a reorder alone is saved', () => {
    const moves = [
      { ...specOp('claude', 'claude', yamlSpecs[1], yamlSpecs[1]), index: 0 },
      { ...specOp('gpt', 'gpt', yamlSpecs[0], yamlSpecs[0]), index: 1 },
    ] as t.EntryChange[];
    const result = resolve(moves, undefined, yamlSpecs, specs);
    expect(result.changed).toBe(true);
    expect(result.next?.map((s) => (s as t.ConfigRecord).name)).toEqual(['claude', 'gpt']);
    const back = resolve(
      [
        { ...specOp('gpt', 'gpt', yamlSpecs[0], yamlSpecs[0]), index: 0 },
        { ...specOp('claude', 'claude', yamlSpecs[1], yamlSpecs[1]), index: 1 },
      ] as t.EntryChange[],
      [yamlSpecs[1], yamlSpecs[0]],
      yamlSpecs,
      specs,
    );
    expect(back).toMatchObject({ next: undefined, changed: true });
  });

  it('swaps the names of two specs in one batch', () => {
    const swap = [
      specOp('claude', 'gpt', { ...yamlSpecs[0], name: 'claude' }, yamlSpecs[0]),
      specOp('gpt', 'claude', { ...yamlSpecs[1], name: 'gpt' }, yamlSpecs[1]),
    ];
    const result = resolve(swap, yamlSpecs, yamlSpecs, specs);
    expect(result.issues).toEqual([]);
    expect(result.next).toEqual([
      { ...yamlSpecs[0], name: 'claude' },
      { ...yamlSpecs[1], name: 'gpt' },
    ]);
    const clash = resolve(
      [specOp('claude', 'gpt', { ...yamlSpecs[0], name: 'claude' }, yamlSpecs[0])],
      yamlSpecs,
      yamlSpecs,
      specs,
    );
    expect(clash.issues.map((issue) => issue.code)).toEqual(['DUPLICATE_ENTRY']);
  });

  it('rebuilds a reorder with an added and a removed spec in one batch', () => {
    const third = { name: 'mini', label: 'Mini', preset: { endpoint: 'openAI' } };
    const ops = [
      { ...specOp('new', null, { name: 'new', label: 'New' }), index: 0 },
      { ...specOp('claude', 'claude', yamlSpecs[1], yamlSpecs[1]), index: 1 },
      { ...specOp('mini', 'mini', third, third), index: 2 },
      { op: 'removeEntry', path: 'modelSpecs.list', key: 'gpt', identity: 'gpt' },
    ] as t.EntryChange[];
    const result = resolve(ops, undefined, [...yamlSpecs, third], specs);
    expect(result.issues).toEqual([]);
    expect(result.next?.map((s) => (s as t.ConfigRecord).name)).toEqual(['new', 'claude', 'mini']);
  });
});
