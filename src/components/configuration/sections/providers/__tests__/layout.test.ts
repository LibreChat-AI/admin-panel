import { describe, expect, it } from 'vitest';
import { configSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import {
  summaryValue,
  formatSummary,
  providerLayout,
  summarizeFields,
  flattenedObject,
  resolveProviderGroups,
} from '../layout';
import { PROVIDER_FIELD_META } from '../../../meta/providers';
import translation from '@/locales/en/translation.json';
import { extractSchemaTree } from '@/server/config';
import { createField } from '@/test/fixtures';
import { MASKED_SECRET } from '@/utils';

const localeKeys = new Set(Object.keys(translation));
const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const endpoints = tree.find((field) => field.key === 'endpoints');
const providers = (endpoints?.children ?? []).filter(
  (field) => field.key !== 'custom' && (field.children?.length ?? 0) > 0,
);

const localize: t.LocalizeFn = (key, values) =>
  values ? `${key}(${Object.values(values).join('|')})` : key;

describe('provider layouts (providerMeta coverage)', () => {
  it('covers the providers of the schema', () => {
    expect(providers.map((field) => field.key).sort()).toEqual(
      [
        'agents',
        'all',
        'anthropic',
        'assistants',
        'azureAssistants',
        'azureOpenAI',
        'bedrock',
        'google',
        'openAI',
      ].sort(),
    );
  });

  it.each(providers.map((field) => [field.key, field] as const))(
    '%s: every schema key is placed in exactly one group or in Advanced',
    (key, field) => {
      const children = field.children ?? [];
      const { groups } = resolveProviderGroups(key, children);
      const placed = groups.flatMap((group) => group.fields.map((child) => child.key));
      expect(placed.sort()).toEqual(children.map((child) => child.key).sort());
    },
  );

  it.each(providers.map((field) => [field.key, field] as const))(
    '%s: no schema key falls back to Advanced unplanned',
    (key, field) => {
      expect(resolveProviderGroups(key, field.children ?? []).fallback).toEqual([]);
    },
  );

  it('names no key that no provider has (no dead keys, unlike the old PRIORITY_ORDER)', () => {
    const known = new Set(providers.flatMap((field) => (field.children ?? []).map((c) => c.key)));
    const dead = providers
      .flatMap((field) => providerLayout(field.key))
      .flatMap((group) => group.fields)
      .filter((key) => !known.has(key));
    expect(dead).toEqual([]);
  });

  it('puts unknown provider keys into Advanced, before the unused group', () => {
    const fields = [
      createField({ key: 'baseURL', type: 'string' }),
      createField({ key: 'titleModel', type: 'string' }),
      createField({ key: 'brandNew', type: 'string' }),
    ];
    const { groups, fallback } = resolveProviderGroups('openAI', fields);
    expect(fallback).toEqual(['brandNew']);
    expect(groups.map((group) => group.def.key)).toEqual(['titles', 'advanced', 'unused']);
    expect(groups[1].fields.map((field) => field.key)).toEqual(['brandNew']);
  });

  it('always returns Advanced, empty when nothing falls into it', () => {
    const { groups } = resolveProviderGroups('openAI', [
      createField({ key: 'titleModel', type: 'string' }),
    ]);
    expect(groups.map((group) => [group.def.key, group.fields.length])).toEqual([
      ['titles', 1],
      ['advanced', 0],
    ]);
  });

  it('opens Agent features first, with the recursion limits side by side', () => {
    const [features] = providerLayout('agents');
    expect(features.key).toBe('features');
    expect(features.expanded).toBe(true);
    expect(features.fields).toContain('capabilities');
    expect(features.pairs).toContainEqual(['recursionLimit', 'maxRecursionLimit']);
    expect(providerLayout('azureOpenAI')[0].fields[0]).toBe('groups');
  });

  it('every locale key of the layouts and the provider metadata has a translation', () => {
    const keys = new Set<string>();
    for (const groups of providers.map((field) => providerLayout(field.key))) {
      for (const group of groups) {
        keys.add(group.labelKey);
        if (group.descriptionKey) keys.add(group.descriptionKey);
      }
    }
    for (const meta of Object.values(PROVIDER_FIELD_META)) {
      if (meta.labelKey) keys.add(meta.labelKey);
      if (meta.descriptionKey) keys.add(meta.descriptionKey);
      for (const key of Object.values(meta.enumLabels ?? {})) keys.add(key);
      for (const key of Object.values(meta.enumDescriptions ?? {})) keys.add(key);
    }
    expect([...keys].filter((key) => !localeKeys.has(key))).toEqual([]);
  });

  it('labels every agent capability the schema allows', () => {
    const agents = providers.find((field) => field.key === 'agents');
    const capabilities = agents?.children?.find((field) => field.key === 'capabilities');
    const members = /enum\((.+)\)/.exec(capabilities?.type ?? '')?.[1].split(' | ') ?? [];
    const labels = PROVIDER_FIELD_META['endpoints.agents.capabilities'].enumLabels ?? {};
    expect(members.length).toBeGreaterThan(0);
    expect(members.filter((member) => !labels[member])).toEqual([]);
  });
});

describe('flattenedObject', () => {
  it('flattens a group made of one plain object', () => {
    const object = createField({
      key: 'checkpointer',
      type: 'object',
      isObject: true,
      children: [createField({ key: 'ttl', type: 'number' })],
    });
    expect(flattenedObject({ def: providerLayout('agents')[0], fields: [object] })).toBe(object);
  });

  it('keeps lists, records and several fields as they are', () => {
    const def = providerLayout('agents')[0];
    const list = createField({
      key: 'environments',
      type: 'array<object>',
      isArray: true,
      children: [createField({ key: 'id', type: 'string' })],
    });
    expect(flattenedObject({ def, fields: [list] })).toBeUndefined();
    expect(
      flattenedObject({
        def,
        fields: [createField({ key: 'a' }), createField({ key: 'b' })],
      }),
    ).toBeUndefined();
  });
});

describe('summaries', () => {
  const titleModel = createField({ key: 'titleModel', type: 'string', path: 'x.titleModel' });
  const models = createField({ key: 'models', type: 'array<string>', isArray: true });

  it('summarizes only the set fields, with list previews', () => {
    const values: t.ConfigRecord = {
      'p.titleModel': 'gpt-5-mini',
      'p.models': ['a', 'b', 'c'],
    };
    const items = summarizeFields(
      [titleModel, models, createField({ key: 'unset' })],
      'p',
      {
        isSet: (path) => path in values,
        valueAt: (path) => values[path],
        shadowOf: (path) => (path === 'p.titleModel' ? 'wins' : null),
      },
      localize,
    );
    expect(items.map((item) => item.value)).toEqual([
      'com_config_providers_summary_shadowed(gpt-5-mini)',
      'com_config_providers_summary_more(a, b|1)',
    ]);
  });

  it('says a value Global leaves unset is ignored, not that Global wins', () => {
    const items = summarizeFields(
      [titleModel],
      'p',
      {
        isSet: () => true,
        valueAt: () => 'gpt-5-mini',
        shadowOf: () => 'ignored',
      },
      localize,
    );
    expect(items[0].value).toBe('com_config_providers_summary_shadowed_ignored(gpt-5-mini)');
  });

  it('masks secret values (even a pending plaintext key) but shows env references', () => {
    const apiKey = createField({ key: 'apiKey', type: 'string', path: 'x.apiKey' });
    const values: t.ConfigRecord = {
      'endpoints.assistants.apiKey': 'sk-live-plaintext-1234',
      'endpoints.azureAssistants.apiKey': '${AZURE_KEY}',
    };
    const read: t.SummaryReader = {
      isSet: (path) => path in values,
      valueAt: (path) => values[path],
    };
    const [hidden] = summarizeFields([apiKey], 'endpoints.assistants', read, localize);
    expect(hidden.value).toBe(MASKED_SECRET);
    expect(JSON.stringify(hidden)).not.toContain('sk-live');
    const [reference] = summarizeFields([apiKey], 'endpoints.azureAssistants', read, localize);
    expect(reference.value).toBe('${AZURE_KEY}');
  });

  it('counts enum selections and Azure groups', () => {
    const capabilities = createField({ key: 'capabilities', type: 'array<enum(a | b | c)>' });
    expect(summaryValue(capabilities, ['a', 'b'], localize)).toBe(
      'com_config_providers_summary_selected(2)',
    );
    const groups = createField({ key: 'groups', type: 'array<object>' });
    expect(summaryValue(groups, [{ group: 'x' }], localize)).toBe('com_config_providers_groups(1)');
  });

  it('formats records and empty lists', () => {
    expect(summaryValue(models, [], localize)).toBe('com_config_providers_summary_none');
    expect(summaryValue(createField({ key: 'h', type: 'record' }), { a: '1' }, localize)).toBe(
      'com_config_providers_summary_keys(1)',
    );
  });

  it('joins at most three items and counts the rest', () => {
    const items = ['a', 'b', 'c', 'd'].map((label) => ({ label, value: 'v' }));
    expect(formatSummary(items, localize)).toBe(
      'com_config_providers_summary_pair(a|v) · com_config_providers_summary_pair(b|v) · com_config_providers_summary_pair(c|v) · com_config_providers_summary_rest(1)',
    );
    expect(formatSummary([], localize)).toBeUndefined();
  });
});
