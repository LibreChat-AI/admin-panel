import { PrincipalType } from 'librechat-data-provider';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { useConfigBaseline } from './baseline';

const server = vi.hoisted(() => ({
  getBaseConfigFn: vi.fn(),
  getResolvedConfigFn: vi.fn(),
}));

vi.mock('@/server', () => ({
  baseConfigOptions: {
    queryKey: ['baseConfig'],
    queryFn: () => server.getBaseConfigFn(),
    retry: false,
  },
  getResolvedConfigFn: server.getResolvedConfigFn,
  getLangfuseConnectionFn: vi.fn(),
  LANGFUSE_CONNECTION_QUERY_KEY: ['langfuse'],
}));

const BASE: t.ScopeSelection = { type: 'BASE' };
const USER: t.ScopeSelection = {
  type: 'SCOPE',
  scope: {
    principalType: PrincipalType.ROLE,
    principalId: 'USER',
    name: 'USER',
    priority: 10,
    isActive: true,
  },
};

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe('useConfigBaseline', () => {
  beforeEach(() => {
    server.getBaseConfigFn.mockReset();
    server.getResolvedConfigFn.mockReset();
  });

  it('is pending until the base config arrives, then ready', async () => {
    let resolve: (value: { config: t.ConfigRecord }) => void = () => undefined;
    server.getBaseConfigFn.mockReturnValue(new Promise((r) => (resolve = r)));
    const { result } = renderHook(() => useConfigBaseline(BASE), { wrapper: wrapper() });
    expect(result.current.status).toBe('pending');
    act(() => resolve({ config: {} }));
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('reports a failed base config and retries it', async () => {
    server.getBaseConfigFn.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useConfigBaseline(BASE), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.message).toBe('boom');
    server.getBaseConfigFn.mockResolvedValueOnce({ config: {} });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });

  it('in a profile, also waits for and reports the profile overrides', async () => {
    server.getBaseConfigFn.mockResolvedValue({ config: {} });
    server.getResolvedConfigFn.mockRejectedValueOnce(new Error('scope down'));
    const { result } = renderHook(() => useConfigBaseline(USER), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.message).toBe('scope down');
    server.getResolvedConfigFn.mockResolvedValueOnce({ resolvedConfig: {}, changedPaths: [] });
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
  });
});
