import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdminUserSearchResult } from '@librechat/data-schemas';
import type * as t from '@/types';
import { DIALOG_CLOSERS, expectFocusBack, openFrom, renderWithOpener } from '@/test/focus';
import { addGroupMemberFn, createGroupFn } from '@/server';
import { CreateGroupDialog } from '../CreateGroupDialog';

const USERS: AdminUserSearchResult[] = [
  { id: 'u1', name: 'Jane', email: 'jane@example.com' },
  { id: 'u2', name: 'Raj', email: 'raj@example.com' },
];

vi.mock('@/hooks', async () => {
  const { useRefreshScopes } =
    await vi.importActual<typeof import('@/hooks/config/scope')>('@/hooks/config/scope');
  const { useReturnFocus } =
    await vi.importActual<typeof import('@/hooks/dialogs')>('@/hooks/dialogs');
  return {
    useLocalize: () => (key: string, options?: Record<string, string | number>) =>
      options ? `${key}(${Object.values(options).join(',')})` : key,
    useRefreshScopes,
    useReturnFocus,
  };
});

vi.mock('@/components/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/components/shared')>()),
  UserSearchInline: ({ onAdd }: t.UserSearchInlineProps) => (
    <button type="button" onClick={() => USERS.forEach(onAdd)}>
      add-users
    </button>
  ),
}));

vi.mock('@/server', () => ({
  availableScopesOptions: { queryKey: ['availableScopes'], queryFn: async () => [] },
  createGroupFn: vi.fn(),
  addGroupMemberFn: vi.fn(),
}));

describe('CreateGroupDialog save', () => {
  it('refreshes the server-resolved reads when a later member addition fails', async () => {
    vi.mocked(createGroupFn).mockResolvedValue({
      group: {
        id: 'g1',
        name: 'Platform',
        description: '',
        memberCount: 0,
        topMembers: [],
        isActive: true,
      },
    });
    vi.mocked(addGroupMemberFn)
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('boom'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CreateGroupDialog open onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    queryClient.setQueryData(['configPreview', 'user', 'u1'], { ok: true });
    queryClient.setQueryData(['groups', 'all'], []);
    fireEvent.change(await screen.findByLabelText('com_access_col_name'), {
      target: { value: 'Platform' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'add-users' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_access_create_group' }));
    await waitFor(() => expect(addGroupMemberFn).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(queryClient.getQueryState(['configPreview', 'user', 'u1'])?.isInvalidated).toBe(true),
    );
    expect(queryClient.getQueryState(['groups', 'all'])?.isInvalidated).toBe(true);
  });
});

describe('CreateGroupDialog focus', () => {
  it.each(DIALOG_CLOSERS)(
    'gives focus back to the button that opened it on %s',
    async (_, close) => {
      const opener = renderWithOpener((open, onClose) => (
        <CreateGroupDialog open={open} onClose={onClose} />
      ));
      close(await openFrom(opener));
      await expectFocusBack(opener);
    },
  );
});
