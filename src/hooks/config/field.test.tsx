import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { useOptionSources } from './options';
import { useFieldState } from './field';

const values: t.ConfigValuesData = {
  configValues: { interface: { parameters: true } },
  editedValues: { 'interface.parameters': false },
  configuredPaths: new Set(['interface.parameters']),
  overridePaths: new Set(),
  pendingResets: new Set(),
};

describe('useFieldState', () => {
  it('derives the field state from the nearest provider', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ConfigValuesProvider value={values}>{children}</ConfigValuesProvider>
    );
    const { result } = renderHook(() => useFieldState('interface.parameters'), { wrapper });
    expect(result.current).toMatchObject({
      value: false,
      effective: true,
      source: 'yaml',
      isConfigured: true,
      isEdited: true,
    });
  });

  it('returns the empty default state without a provider', () => {
    const { result } = renderHook(() => useFieldState('interface.parameters'));
    expect(result.current).toMatchObject({ value: undefined, source: 'default', isEdited: false });
  });
});

describe('useOptionSources', () => {
  it('returns no options until WS9 implements the sources', () => {
    const { result } = renderHook(() => useOptionSources('endpoints'));
    expect(result.current).toEqual({ options: [], isLoading: false });
  });
});
