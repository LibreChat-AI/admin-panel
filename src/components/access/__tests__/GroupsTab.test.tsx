import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { apiFetch } from '@/server/utils/api';
import { GroupsTab } from '../GroupsTab';

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    handler: (fn: (...args: never[]) => unknown) => fn,
    validator: () => ({ handler: (fn: (...args: never[]) => unknown) => fn }),
  }),
}));

vi.mock('@/server/utils/api', () => ({
  apiFetch: vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          groups: [{ _id: 'g1', name: 'Engineering', memberIds: [], source: 'local' }],
          total: 1,
        }),
        { status: 200 },
      ),
  ),
  extractApiError: async () => {
    throw new Error('unexpected');
  },
}));

vi.mock('@/server', () => vi.importActual('@/server/groups'));

vi.mock('@/hooks', async () => ({
  useLocalize: () => (key: string, options?: Record<string, string | number>) =>
    options ? `${key}(${Object.values(options).join(',')})` : key,
  useCapabilities: () => ({ hasCapability: () => true }),
  useRefreshScopes: () => vi.fn(),
  useClearButtonLabel: vi.fn(),
  useReturnFocus: (await vi.importActual<typeof import('@/hooks/dialogs')>('@/hooks/dialogs'))
    .useReturnFocus,
  useAnnouncement: (
    await vi.importActual<typeof import('@/hooks/useAnnouncement')>('@/hooks/useAnnouncement')
  ).useAnnouncement,
}));

/** The `search` of every groups list request sent so far. */
function sentSearches(): string[] {
  return vi
    .mocked(apiFetch)
    .mock.calls.map(([path]) => new URL(path, 'http://admin.test').searchParams.get('search'))
    .filter((search): search is string => search != null);
}

describe('GroupsTab search', () => {
  it('clamps a pasted search to the 200 characters the backend accepts, in the field, query and request', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GroupsTab onCreateGroup={vi.fn()} />
      </QueryClientProvider>,
    );
    const field = await screen.findByPlaceholderText('com_access_search_groups');
    fireEvent.change(field, { target: { value: 'x'.repeat(250) } });
    expect(field).toHaveValue('x'.repeat(200));
    await waitFor(() => expect(sentSearches()).toEqual(['x'.repeat(200)]));
    expect(queryClient.getQueryData(['groups', 1, 'x'.repeat(200)])).toBeDefined();
    const clamped = queryClient.getQueryCache().find({ queryKey: ['groups', 1, 'x'.repeat(250)] });
    expect(clamped).toBeUndefined();
  });
});

describe('GroupsTab search announcement', () => {
  it('announces the match count once a search has loaded, and not on the first load', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <GroupsTab onCreateGroup={vi.fn()} />
      </QueryClientProvider>,
    );
    const field = await screen.findByPlaceholderText('com_access_search_groups');
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    fireEvent.change(field, { target: { value: 'eng' } });
    await waitFor(() => expect(status).toHaveTextContent('com_a11y_groups_found(1)'));
  });
});
