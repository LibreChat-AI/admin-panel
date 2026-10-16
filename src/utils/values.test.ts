import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import { deriveFieldState } from './values';

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
