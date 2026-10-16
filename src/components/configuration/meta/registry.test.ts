import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import { buildFieldMetaRegistry, resolveFieldMeta } from './registry';
import { getFieldMeta, labelForPath } from '.';

const localize: t.LocalizeFn = (key) =>
  ({ com_config_field_startBalance: 'Start balance', com_config_field_custom: 'Custom' })[key] ??
  key;

describe('resolveFieldMeta', () => {
  const root = buildFieldMetaRegistry([
    {
      'balance.startBalance': { unit: 'credits' },
      'endpoints.custom[].models.default': { labelKey: 'default_models' },
      'mcpServers.{}.startup': { runtimeDefault: true },
      'mcpServers.github.startup': { runtimeDefault: false },
      'endpoints.custom.[].name': { width: 'M' },
    },
    { 'balance.startBalance': { labelKey: 'start' } },
  ]);

  it('resolves exact paths and merges later registries over earlier ones', () => {
    expect(resolveFieldMeta(root, 'balance.startBalance')).toEqual({
      unit: 'credits',
      labelKey: 'start',
    });
  });

  it('matches array indices against [] in either spelling', () => {
    expect(resolveFieldMeta(root, 'endpoints.custom.3.models.default')?.labelKey).toBe(
      'default_models',
    );
    expect(resolveFieldMeta(root, 'endpoints.custom.0.name')?.width).toBe('M');
  });

  it('matches record keys against {} and prefers literal segments', () => {
    expect(resolveFieldMeta(root, 'mcpServers.cloudflare.startup')?.runtimeDefault).toBe(true);
    expect(resolveFieldMeta(root, 'mcpServers.github.startup')?.runtimeDefault).toBe(false);
  });

  it('accepts schema paths with [] markers but keeps [] and {} distinct', () => {
    expect(resolveFieldMeta(root, 'endpoints.custom.[].name')?.width).toBe('M');
    expect(resolveFieldMeta(root, 'endpoints.custom.{}.name')).toBeUndefined();
  });

  it('returns undefined for unknown or partial paths', () => {
    expect(resolveFieldMeta(root, 'balance')).toBeUndefined();
    expect(resolveFieldMeta(root, 'balance.startBalance.extra')).toBeUndefined();
  });
});

describe('getFieldMeta / labelForPath', () => {
  it('has no generic metadata yet', () => {
    expect(getFieldMeta('balance.startBalance')).toBeUndefined();
  });

  it('labels a path by its last named segment', () => {
    expect(labelForPath('balance.startBalance', localize)).toBe('Start balance');
    expect(labelForPath('endpoints.custom.3', localize)).toBe('Custom');
  });

  it('falls back to the key when there is no translation', () => {
    expect(labelForPath('mcpServers.cloudflare', localize)).toBe('cloudflare');
  });
});
