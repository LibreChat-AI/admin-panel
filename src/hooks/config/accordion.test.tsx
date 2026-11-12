import { act, renderHook } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { readStoredExpanded, usePersistentExpanded } from './accordion';
import { ExpandProvider } from '@/contexts/ExpandContext';
import { useExpandRequest } from './expand';

const KEY = 'librechat-admin:open:providers';

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('usePersistentExpanded', () => {
  it('starts collapsed, and remembers that it was opened', () => {
    const first = renderHook(() =>
      usePersistentExpanded({ storageKey: 'providers', id: 'openAI' }),
    );
    expect(first.result.current.isExpanded).toBe(false);
    act(() => first.result.current.toggle());
    expect(JSON.parse(localStorage.getItem(KEY) ?? '[]')).toEqual(['openAI']);
    first.unmount();
    const second = renderHook(() =>
      usePersistentExpanded({ storageKey: 'providers', id: 'openAI' }),
    );
    expect(second.result.current.isExpanded).toBe(true);
  });

  it('remembers that a group open by default was closed', () => {
    const options = { storageKey: 'providers', id: 'agents.features', defaultExpanded: true };
    const first = renderHook(() => usePersistentExpanded(options));
    expect(first.result.current.isExpanded).toBe(true);
    act(() => first.result.current.toggle());
    first.unmount();
    expect(readStoredExpanded('providers', 'agents.features', true)).toBe(false);
    expect(readStoredExpanded('providers', 'agents.other', true)).toBe(true);
  });

  it('follows Expand all and Collapse all', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ExpandProvider resetKey="providers">{children}</ExpandProvider>
    );
    const { result } = renderHook(
      () => ({
        state: usePersistentExpanded({ storageKey: 'providers', id: 'google' }),
        request: useExpandRequest(),
      }),
      { wrapper },
    );
    act(() => result.current.request('expand'));
    expect(result.current.state.isExpanded).toBe(true);
    act(() => result.current.request('collapse'));
    expect(result.current.state.isExpanded).toBe(false);
  });

  it('works without storage (private mode)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { result } = renderHook(() => usePersistentExpanded({ storageKey: 'p', id: 'x' }));
    act(() => result.current.toggle());
    expect(result.current.isExpanded).toBe(true);
  });

  it('ignores junk in storage', () => {
    localStorage.setItem(KEY, '{"not":"a list"}');
    expect(readStoredExpanded('providers', 'openAI', false)).toBe(false);
    localStorage.setItem(KEY, 'not json');
    expect(readStoredExpanded('providers', 'openAI', true)).toBe(true);
  });
});
