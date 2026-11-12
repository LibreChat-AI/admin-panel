import { describe, it, expect } from 'vitest';
import type * as t from '@/types';
import { deriveSpecControl, withDerivedSpecControls, leavesSet, isSetByLayer } from './specs';
import { createPathIndex } from './paths';

const NO_STATE: t.FieldState = {
  value: undefined,
  effective: undefined,
  source: 'default',
  isConfigured: false,
  isOverride: false,
  isEdited: false,
  isPendingReset: false,
  isHidden: false,
};

describe('deriveSpecControl', () => {
  it('turns every control on without specs, and only the menu with added endpoints with them', () => {
    expect(deriveSpecControl('modelSelect', 0, 0)).toBe(true);
    expect(deriveSpecControl('parameters', 0, 2)).toBe(true);
    expect(deriveSpecControl('modelSelect', 2, 0)).toBe(false);
    expect(deriveSpecControl('modelSelect', 2, 1)).toBe(true);
    expect(deriveSpecControl('parameters', 1, 1)).toBe(false);
    expect(deriveSpecControl('presets', 1, 0)).toBe(false);
  });
});

describe('withDerivedSpecControls', () => {
  it('derives the controls no layer sets from the specs the config serves', () => {
    const config: t.ConfigRecord = {
      interface: { parameters: false, presets: false, modelSelect: false, feedback: true },
      modelSpecs: { addedEndpoints: ['openAI'] },
    };
    const derived = withDerivedSpecControls(config, (path) => path === 'interface.presets');
    expect(derived.interface).toEqual({
      parameters: true,
      presets: false,
      modelSelect: true,
      feedback: true,
    });
    const withSpecs = withDerivedSpecControls(
      { ...config, modelSpecs: { list: [{ name: 'a' }], addedEndpoints: ['openAI'] } },
      () => false,
    );
    expect(withSpecs.interface).toMatchObject({
      parameters: false,
      presets: false,
      modelSelect: true,
    });
  });
});

describe('leavesSet', () => {
  const layers = {
    yamlPaths: createPathIndex(['interface.parameters']),
    baseOverridePaths: createPathIndex(['interface.presets']),
    baseTombstones: new Set(['interface.modelSelect']),
  };

  it('reads which layer leaves a value set, under the tombstones above it', () => {
    const none = { changedPaths: [], tombstones: [] };
    expect(leavesSet('interface.parameters', layers, none)).toBe(true);
    expect(leavesSet('interface.presets', layers, none)).toBe(true);
    expect(leavesSet('interface.modelSelect', layers, none)).toBe(false);
    const hides = { changedPaths: [], tombstones: ['interface'] };
    expect(leavesSet('interface.parameters', layers, hides)).toBe(false);
    expect(leavesSet('interface.presets', layers, hides)).toBe(false);
    const sets = { changedPaths: ['interface.modelSelect'], tombstones: ['interface'] };
    expect(leavesSet('interface.modelSelect', layers, sets)).toBe(true);
  });
});

describe('isSetByLayer', () => {
  it('tells a value a layer sets from one LibreChat derives', () => {
    expect(isSetByLayer({ ...NO_STATE, stack: [{ source: 'runtimeDefault', value: false }] })).toBe(
      false,
    );
    expect(isSetByLayer({ ...NO_STATE, stack: [{ source: 'yaml', value: true }] })).toBe(true);
    expect(
      isSetByLayer({
        ...NO_STATE,
        inherited: { value: true, source: 'yaml' },
        stack: [
          { source: 'yaml', value: true },
          { source: 'scope', value: undefined, hidden: true },
        ],
      }),
    ).toBe(false);
  });

  it('reads pending edits: a value sets it, a revert leaves what lies beneath', () => {
    expect(isSetByLayer({ ...NO_STATE, isEdited: true, value: false })).toBe(true);
    const own: t.FieldLayer = { source: 'admin', value: false };
    const reverted: t.FieldState = { ...NO_STATE, isEdited: true, isPendingReset: true };
    expect(isSetByLayer({ ...reverted, stack: [own] })).toBe(false);
    expect(isSetByLayer({ ...reverted, stack: [{ source: 'yaml', value: true }, own] })).toBe(true);
    expect(isSetByLayer({ ...NO_STATE, visibilityEdit: 'hide', isEdited: true })).toBe(false);
  });
});
