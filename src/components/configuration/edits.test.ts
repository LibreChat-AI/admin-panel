import { describe, it, expect } from 'vitest';
import { configSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  applyConfigEdit,
  diffCollection,
  hasEffectiveEdits,
  normalizeEditValue,
  buildConfigChanges,
  trackCollectionEdit,
  captureCollectionEdit,
  mergeIndexedArrayEdits,
  pendingCollectionItems,
} from './edits';
import { getKeyedCollection, getValueAtPath, planConfigChanges } from '@/utils';
import { issueDisplayPath, formatIssue, describeIssues } from './issues';
import { extractSchemaTree, getSchemaPathSet } from '@/server/config';
import { summarizeChanges } from './summary';
import { findSchemaField } from './controls';

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const schemaPaths = getSchemaPathSet();
const custom = getKeyedCollection('endpoints.custom')!;

const models = { default: ['m1'] };
const endpoints: t.ConfigRecord[] = [
  { name: 'AdminA', apiKey: 'user_provided', baseURL: 'https://a', models },
  { name: 'Moonshot', apiKey: '${KIMI}', baseURL: 'https://api.moonshot.ai/v1', models },
  { name: 'AdminB', apiKey: 'user_provided', baseURL: 'https://b', models },
];
const root: t.ConfigRecord = { endpoints: { custom: endpoints } };

function context(
  overrides: Partial<t.ChangeContext> = {},
  hasOverride: (path: string) => boolean = () => false,
): t.ChangeContext {
  return {
    fields: tree,
    baselineAt: (path) => getValueAtPath(root, path),
    hasOverride,
    root,
    collections: {},
    ...overrides,
  };
}

const localize: t.LocalizeFn = (key, params) => {
  const texts: Record<string, string> = {
    com_config_field_provider: 'Provider',
    com_config_label_custom_provider: 'Use native Anthropic client',
    com_config_field_baseURL: 'Base URL',
    com_config_issue_invalid_literal: 'must be {{expected}}',
    com_config_issue_yaml_entry_immutable:
      '"{{name}}" is defined in librechat.yaml, so it can\'t be {{action}} here',
  };
  const text = texts[key];
  if (!text) return key;
  return text.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(params?.[name] ?? ''));
};

/** Applies a sequence of edits the way useConfigEdits does, returning values and origins. */
function edit(steps: Array<[string, t.ConfigValue]>): {
  values: t.FlatConfigMap;
  collections: t.CollectionEdits;
} {
  let values: t.FlatConfigMap = {};
  let collections: t.CollectionEdits = {};
  for (const [path, value] of steps) {
    collections = trackCollectionEdit(collections, values, path, value, root);
    values = applyConfigEdit(values, path, value, {}, new Set(), new Set());
  }
  return { values, collections };
}

describe('identity-keyed collection ops (SV-1)', () => {
  it('turns an indexed entry edit into an upsert keyed by the loaded name', () => {
    const { values, collections } = edit([
      ['endpoints.custom.1', { ...endpoints[1], baseURL: 'https://api.moonshot.cn/v1' }],
    ]);
    const { ops } = buildConfigChanges(
      new Set(Object.keys(values)),
      values,
      schemaPaths,
      context({ collections }),
    );
    expect(ops).toEqual([
      {
        op: 'upsertEntry',
        path: 'endpoints.custom',
        key: 'Moonshot',
        identity: 'Moonshot',
        value: { ...endpoints[1], baseURL: 'https://api.moonshot.cn/v1' },
        baseline: endpoints[1],
      },
    ]);
  });

  it('keeps identities through a delete that shifts indices, then an edit and a rename', () => {
    const afterDelete = endpoints.filter((_, i) => i !== 0);
    const { values, collections } = edit([
      ['endpoints.custom', afterDelete],
      ['endpoints.custom.1', { ...endpoints[2], name: 'AdminC' }],
    ]);
    expect(collections['endpoints.custom'].origins.map((o) => o?.identity)).toEqual([
      'Moonshot',
      'AdminB',
    ]);
    const { ops } = buildConfigChanges(
      new Set(Object.keys(values)),
      values,
      schemaPaths,
      context({ collections }),
    );
    expect(ops).toEqual([
      { op: 'removeEntry', path: 'endpoints.custom', key: 'AdminA', identity: 'AdminA' },
      expect.objectContaining({ op: 'upsertEntry', key: 'AdminC', identity: 'AdminB' }),
    ]);
  });

  it('adds new entries with a null identity and their position', () => {
    const created = { name: 'New EP', apiKey: 'user_provided', baseURL: 'https://n' };
    const { values, collections } = edit([['endpoints.custom', [...endpoints, created]]]);
    const { ops } = buildConfigChanges(
      new Set(Object.keys(values)),
      values,
      schemaPaths,
      context({ collections }),
    );
    expect(ops).toEqual([
      {
        op: 'upsertEntry',
        path: 'endpoints.custom',
        key: 'New EP',
        identity: null,
        value: created,
        index: 3,
      },
    ]);
  });

  it('gives an entry restored by Undo its loaded identity back while another entry is edited', () => {
    const moonshot = { ...endpoints[1], baseURL: 'https://api.moonshot.cn/v1' };
    const edited = [endpoints[0], moonshot, endpoints[2]];
    const { values, collections } = edit([
      ['endpoints.custom.1', moonshot],
      ['endpoints.custom', [moonshot, endpoints[2]]],
      ['endpoints.custom', edited],
    ]);
    expect(collections['endpoints.custom'].origins.map((o) => o?.identity)).toEqual([
      'AdminA',
      'Moonshot',
      'AdminB',
    ]);
    const { ops, issues } = buildConfigChanges(
      new Set(Object.keys(values)),
      values,
      schemaPaths,
      context({ collections }),
    );
    expect(issues).toEqual([]);
    expect(ops).toEqual([
      expect.objectContaining({ op: 'upsertEntry', key: 'Moonshot', identity: 'Moonshot' }),
    ]);
    expect(
      planConfigChanges(ops, { stored: {}, tombstones: [], lower: root, lowerKind: 'yaml' }).issues,
    ).toEqual([]);
  });

  it('restores a renamed entry deleted and then undone as the entry it was loaded as', () => {
    const renamed = { ...endpoints[0], name: 'AdminZ' };
    const { values, collections } = edit([
      ['endpoints.custom.0', renamed],
      ['endpoints.custom', [endpoints[1], endpoints[2]]],
      ['endpoints.custom', [renamed, endpoints[1], endpoints[2]]],
    ]);
    const { ops } = buildConfigChanges(
      new Set(Object.keys(values)),
      values,
      schemaPaths,
      context({ collections }),
    );
    expect(ops).toEqual([
      expect.objectContaining({ op: 'upsertEntry', key: 'AdminZ', identity: 'AdminA' }),
    ]);
  });

  it('matches cloned items by name when references are lost', () => {
    const clones = endpoints.map((entry) => ({ ...entry }));
    const tracked = trackCollectionEdit({}, {}, 'endpoints.custom', clones.slice(1), root);
    expect(tracked['endpoints.custom'].origins.map((o) => o?.identity)).toEqual([
      'Moonshot',
      'AdminB',
    ]);
  });

  it('reports an entry left without a name instead of sending it', () => {
    const edit0 = captureCollectionEdit(custom, root);
    const items = [{ ...endpoints[0], name: '' }, endpoints[1], endpoints[2]];
    const normalize = (value: t.ConfigValue) =>
      normalizeEditValue('endpoints.custom.0', value, tree, schemaPaths);
    const { ops, issues } = diffCollection(custom, items, edit0, normalize);
    expect(ops).toEqual([]);
    expect(issues).toMatchObject([
      { path: 'endpoints.custom.0.name', code: 'required', entryIdentity: 'AdminA' },
    ]);
  });

  it('sends a reordered spec list with every kept spec at its new index', () => {
    const specList: t.ConfigRecord[] = [
      { name: 'a', label: 'A', preset: { endpoint: 'openAI', model: 'm' } },
      { name: 'b', label: 'B', preset: { endpoint: 'openAI', model: 'm' } },
      { name: 'c', label: 'C', preset: { endpoint: 'openAI', model: 'm' } },
    ];
    const specRoot: t.ConfigRecord = { modelSpecs: { list: specList } };
    const reordered = [specList[2], specList[0], specList[1]];
    const collections = trackCollectionEdit({}, {}, 'modelSpecs.list', reordered, specRoot);
    const { ops } = buildConfigChanges(
      new Set(['modelSpecs.list']),
      { 'modelSpecs.list': reordered },
      schemaPaths,
      context({ root: specRoot, collections }),
    );
    expect(ops).toEqual([
      expect.objectContaining({ op: 'upsertEntry', identity: 'c', index: 0 }),
      expect.objectContaining({ op: 'upsertEntry', identity: 'a', index: 1 }),
      expect.objectContaining({ op: 'upsertEntry', identity: 'b', index: 2 }),
    ]);
    const plan = planConfigChanges(ops, {
      stored: {},
      tombstones: [],
      lower: specRoot,
      lowerKind: 'yaml',
    });
    expect(plan.sets.map((set) => set.fieldPath)).toEqual(['modelSpecs.list']);
    const saved = plan.sets[0].value as t.ConfigRecord[];
    expect(saved.map((spec) => spec.name)).toEqual(['c', 'a', 'b']);
  });

  it('keeps the spec order when a save both removes and adds specs', () => {
    const spec = (name: string): t.ConfigRecord => ({
      name,
      label: name.toUpperCase(),
      preset: { endpoint: 'openAI', model: 'm' },
    });
    const specList = [spec('a'), spec('b'), spec('c')];
    const specRoot: t.ConfigRecord = { modelSpecs: { list: specList } };
    const pending = [specList[1], specList[2], spec('x')];
    const collections = trackCollectionEdit({}, {}, 'modelSpecs.list', pending, specRoot);
    const { ops } = buildConfigChanges(
      new Set(['modelSpecs.list']),
      { 'modelSpecs.list': pending },
      schemaPaths,
      context({ root: specRoot, collections }),
    );
    const plan = planConfigChanges(ops, {
      stored: {},
      tombstones: [],
      lower: specRoot,
      lowerKind: 'yaml',
    });
    expect(plan.issues).toEqual([]);
    const saved = plan.sets[0].value as t.ConfigRecord[];
    expect(saved.map((entry) => entry.name)).toEqual(['b', 'c', 'x']);
  });

  it('saves two specs whose names were swapped', () => {
    const specList: t.ConfigRecord[] = [
      { name: 'a', label: 'A', preset: { endpoint: 'openAI', model: 'm' } },
      { name: 'b', label: 'B', preset: { endpoint: 'openAI', model: 'm' } },
    ];
    const specRoot: t.ConfigRecord = { modelSpecs: { list: specList } };
    const edited: t.FlatConfigMap = {
      'modelSpecs.list.0': { ...specList[0], name: 'b' },
      'modelSpecs.list.1': { ...specList[1], name: 'a' },
    };
    const collections = Object.entries(edited).reduce<t.CollectionEdits>(
      (acc, [path, value]) => trackCollectionEdit(acc, {}, path, value, specRoot),
      {},
    );
    const { ops } = buildConfigChanges(
      new Set(Object.keys(edited)),
      edited,
      schemaPaths,
      context({ root: specRoot, collections }),
    );
    const plan = planConfigChanges(ops, {
      stored: {},
      tombstones: [],
      lower: specRoot,
      lowerKind: 'yaml',
    });
    expect(plan.issues).toEqual([]);
    const saved = plan.sets[0].value as t.ConfigRecord[];
    expect(saved.map((spec) => [spec.name, spec.label])).toEqual([
      ['b', 'A'],
      ['a', 'B'],
    ]);
  });

  it('sends no positions for a reordered custom endpoint list (merged by name)', () => {
    const reordered = [endpoints[2], endpoints[0], endpoints[1]];
    const collections = trackCollectionEdit({}, {}, 'endpoints.custom', reordered, root);
    const { ops } = buildConfigChanges(
      new Set(['endpoints.custom']),
      { 'endpoints.custom': reordered },
      schemaPaths,
      context({ collections }),
    );
    expect(ops).toEqual([]);
  });

  it('turns a reset of the whole collection into a reset op (revert list to librechat.yaml)', () => {
    const values = { 'modelSpecs.list': undefined };
    const { ops } = buildConfigChanges(
      new Set(['modelSpecs.list']),
      values,
      schemaPaths,
      context(),
    );
    expect(ops).toEqual([{ op: 'reset', path: 'modelSpecs.list' }]);
  });

  it('turns pending hides and unhides into tombstone ops', () => {
    const { ops } = buildConfigChanges(
      new Set(),
      {},
      schemaPaths,
      context({ visibility: { 'mcpServers.github': 'hide', 'mcpServers.x': 'unhide' } }),
    );
    expect(ops).toEqual([
      { op: 'tombstone', path: 'mcpServers.github' },
      { op: 'untombstone', path: 'mcpServers.x' },
    ]);
  });
});

describe('pendingCollectionItems', () => {
  it('overlays entry and entry-field edits on the loaded collection', () => {
    const items = pendingCollectionItems(custom, endpoints, {
      'endpoints.custom.1': { ...endpoints[1], titleModel: 'kimi' },
      'endpoints.custom.2.baseURL': 'https://b2',
    });
    expect(items[1]).toMatchObject({ titleModel: 'kimi' });
    expect(items[2]).toMatchObject({ baseURL: 'https://b2', name: 'AdminB' });
  });
});

describe('applyConfigEdit with the structured baseline (SV-6)', () => {
  const structured: t.EditBaseline = {
    root: {
      ...root,
      mcpServers: { '2024': { url: 'https://x' }, other: { url: 'https://y' } },
      headersHolder: { headers: { a: '1' } },
    },
    isArrayPath: (path) => findSchemaField(tree, path)?.isArray === true,
    normalize: (path, value) => normalizeEditValue(path, value, tree, schemaPaths),
  };

  it('records removing a stored secret the API returns only as its preview', () => {
    const secretRoot: t.ConfigRecord = { webSearch: { tavilyApiKeyPreview: 'tvly-S...c123' } };
    const secretBaseline: t.EditBaseline = { ...structured, root: secretRoot };
    const removed = applyConfigEdit(
      {},
      'webSearch.tavilyApiKey',
      undefined,
      {},
      new Set(),
      new Set(),
      secretBaseline,
    );
    expect(removed).toEqual({ 'webSearch.tavilyApiKey': undefined });
    expect(hasEffectiveEdits(removed, secretBaseline)).toBe(true);
  });

  it('clears the edit when an entry is edited back to its saved text', () => {
    const edited = applyConfigEdit(
      {},
      'endpoints.custom.1',
      { ...endpoints[1], baseURL: 'https://changed' },
      {},
      new Set(),
      new Set(),
      structured,
    );
    expect(Object.keys(edited)).toEqual(['endpoints.custom.1']);
    const reverted = applyConfigEdit(
      edited,
      'endpoints.custom.1',
      { ...endpoints[1] },
      {},
      new Set(),
      new Set(),
      structured,
    );
    expect(reverted).toEqual({});
  });

  it('keeps a blank draft row pending but does not count it as a change', () => {
    const pairs = [
      { key: 'a', value: '1', valueType: 'string' },
      { key: '', value: '', valueType: 'string' },
    ];
    const pending = applyConfigEdit(
      {},
      'headersHolder.headers',
      pairs,
      {},
      new Set(),
      new Set(),
      structured,
    );
    expect(pending).toEqual({ 'headersHolder.headers': pairs });
    expect(hasEffectiveEdits(pending, structured)).toBe(false);
    const changed = { 'headersHolder.headers': [{ key: 'a', value: '2', valueType: 'string' }] };
    expect(hasEffectiveEdits(changed, structured)).toBe(true);
    expect(hasEffectiveEdits({ 'headersHolder.headers': undefined }, structured)).toBe(true);
  });

  it('treats a numeric MCP server name as a record key, not an index', () => {
    const next = applyConfigEdit(
      {},
      'mcpServers.2024',
      undefined,
      {},
      new Set(['mcpServers.2024']),
      new Set(),
      structured,
    );
    expect(next).toEqual({ 'mcpServers.2024': undefined });
    expect(structured.isArrayPath('mcpServers')).toBe(false);
    expect(structured.isArrayPath('endpoints.custom')).toBe(true);
  });
});

describe('mergeIndexedArrayEdits', () => {
  it('keeps a record a record when a numeric key is edited', () => {
    const merged = mergeIndexedArrayEdits(
      { mcpServers: { '2024': { url: 'https://x' }, github: { url: 'https://g' } } },
      [['mcpServers.2024', undefined]],
    );
    expect(merged).toEqual({ mcpServers: { github: { url: 'https://g' } } });
  });
});

describe('issue display and summary', () => {
  it("shows a plain list item's first problem on the list row", () => {
    const issues: t.ConfigIssue[] = [
      { path: 'mcpSettings.allowedAddresses.0', code: 'custom', message: 'must include a port' },
      { path: 'mcpSettings.allowedAddresses.0', code: 'custom', message: 'is not private' },
    ];
    const { fieldErrors } = describeIssues(issues, [], (key, params) =>
      key === 'com_config_issue_list_item' ? `Item ${params?.n}: ${params?.message}` : key,
    );
    expect(fieldErrors['mcpSettings.allowedAddresses']).toBe('Item 1: must include a port');
  });

  const edit0 = captureCollectionEdit(custom, root);
  const collections: t.PendingCollection[] = [
    { collection: custom, items: [endpoints[1], endpoints[0], endpoints[2]], edit: edit0 },
  ];

  it('maps an issue on the sent array to the entry where the page shows it', () => {
    const issue: t.ConfigIssue = {
      path: 'endpoints.custom.0.provider',
      code: 'invalid_literal',
      message: 'must be "anthropic"',
      params: { expected: '"anthropic"' },
      entryIdentity: 'Moonshot',
      entryPath: 'provider',
    };
    const path = issueDisplayPath(issue, collections);
    expect(path).toBe('endpoints.custom.0.provider');
    expect(formatIssue(issue, path, localize)).toEqual({
      inline: 'Use native Anthropic client must be "anthropic"',
      summary: 'Moonshot › Use native Anthropic client must be "anthropic"',
    });
  });

  it('words an issue the admin API reported without parameters without placeholders', () => {
    const issue: t.ConfigIssue = {
      path: 'balance.startBalance',
      code: 'too_small',
      message: 'is too small',
    };
    const text = formatIssue(issue, issue.path, localize).inline;
    expect(text).toMatch(/is too small$/);
    expect(text).not.toContain('{{');
  });

  it('names an entry without a name as such, not with an empty identity', () => {
    const issue: t.ConfigIssue = {
      path: 'endpoints.custom',
      code: 'BLANK_VALUE',
      message: 'is blank',
      entryIdentity: '   ',
      entryPath: 'name',
    };
    expect(formatIssue(issue, 'endpoints.custom', localize).summary).toMatch(
      /^com_config_issue_unnamed_entry › /,
    );
  });

  it('names the field of an entry the page does not list (an imported one)', () => {
    const issue: t.ConfigIssue = {
      path: 'endpoints.custom',
      code: 'MERGED_ENTRY_NAME',
      message: 'fallback',
      params: { name: 'ollama', other: 'Ollama' },
      entryIdentity: 'ollama',
      entryPath: 'name',
    };
    expect(formatIssue(issue, 'endpoints.custom', localize).summary).toMatch(/^ollama › name: /i);
  });

  it('shows entry-level problems as sentences', () => {
    const issue: t.ConfigIssue = {
      path: 'endpoints.custom',
      code: 'YAML_ENTRY_IMMUTABLE',
      message: 'fallback',
      params: { name: 'Zai 2', action: 'removed' },
      entryIdentity: 'Zai 2',
      entryPath: '',
    };
    expect(formatIssue(issue, 'endpoints.custom', localize).summary).toBe(
      '"Zai 2" is defined in librechat.yaml, so it can\'t be removed here',
    );
  });

  it('warns on the last removed spec when the save empties the spec list', () => {
    const specsRoot: t.ConfigRecord = {
      modelSpecs: {
        list: [
          { name: 'a', label: 'A' },
          { name: 'b', label: 'B' },
        ],
      },
    };
    const collections = trackCollectionEdit({}, {}, 'modelSpecs.list', [], specsRoot);
    const values = applyConfigEdit({}, 'modelSpecs.list', [], {}, new Set(), new Set());
    const ctx: t.ChangeContext = {
      fields: tree,
      baselineAt: (path) => getValueAtPath(specsRoot, path),
      hasOverride: () => true,
      root: specsRoot,
      collections,
    };
    const changeSet = buildConfigChanges(new Set(Object.keys(values)), values, schemaPaths, ctx);
    const plan = planConfigChanges(changeSet.ops, {
      stored: specsRoot,
      tombstones: [],
      lower: {},
      lowerKind: 'yaml',
    });
    const items = summarizeChanges(changeSet, plan, {
      baselineAt: ctx.baselineAt,
      ownAt: () => undefined,
      revertAt: () => ({ value: undefined, source: 'default' }),
      editBaselines: {},
    });
    expect(items.map((item) => [item.kind, item.entryIdentity, item.warnings])).toEqual([
      ['removed', 'a', undefined],
      ['removed', 'b', ['emptySpecs']],
    ]);
  });

  it('summarizes entry edits per field and leaves out resets that send nothing', () => {
    const { values, collections: tracked } = edit([
      ['endpoints.custom.1', { ...endpoints[1], baseURL: 'https://api.moonshot.cn/v1' }],
    ]);
    const ctx = context({ collections: tracked });
    const changeSet = buildConfigChanges(
      new Set([...Object.keys(values), 'balance.refillAmount']),
      { ...values, 'balance.refillAmount': undefined },
      schemaPaths,
      ctx,
    );
    const plan = planConfigChanges(changeSet.ops, {
      stored: {},
      tombstones: [],
      lower: { ...root, balance: { refillAmount: 1000000 } },
      lowerKind: 'yaml',
    });
    const items = summarizeChanges(changeSet, plan, {
      baselineAt: ctx.baselineAt,
      ownAt: () => undefined,
      revertAt: () => ({ value: undefined, source: 'default' }),
      editBaselines: {},
    });
    expect(items).toEqual([
      {
        path: 'endpoints.custom.1.baseURL',
        entryIdentity: 'Moonshot',
        kind: 'changed',
        before: 'https://api.moonshot.ai/v1',
        after: 'https://api.moonshot.cn/v1',
        secret: false,
      },
    ]);
    expect(plan.skipped).toEqual([{ fieldPath: 'balance.refillAmount', reason: 'yamlValue' }]);
  });

  it('blames Base, not librechat.yaml, for an inherited value a profile empties', () => {
    const inherited = { ...root, filteredTools: ['github'] };
    const changeSet = buildConfigChanges(
      new Set(['filteredTools']),
      { filteredTools: [] },
      schemaPaths,
      context({
        isScope: true,
        root: inherited,
        baselineAt: (path) => getValueAtPath(inherited, path),
      }),
    );
    expect(changeSet.payload.skipped).toEqual([
      { fieldPath: 'filteredTools', reason: 'inheritedValue' },
    ]);
  });

  it('saves an emptied capability list as "none" instead of dropping it', () => {
    const withCaps = {
      ...root,
      endpoints: { custom: endpoints, agents: { capabilities: ['tools'] } },
    };
    const changeSet = buildConfigChanges(
      new Set(['endpoints.agents.capabilities']),
      { 'endpoints.agents.capabilities': [] },
      schemaPaths,
      context({ root: withCaps, baselineAt: (path) => getValueAtPath(withCaps, path) }),
    );
    expect(changeSet.payload.skipped).toEqual([]);
    expect(changeSet.payload.saves).toEqual([
      { fieldPath: 'endpoints.agents.capabilities', value: [] },
    ]);
  });
});
