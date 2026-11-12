import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdminGroup } from '@librechat/data-schemas';
import { DIALOG_CLOSERS, expectFocusBack, openFrom, renderWithOpener } from '@/test/focus';
import { removeGroupMemberFn, updateGroupFn } from '@/server';
import { EditGroupDialog } from '../EditGroupDialog';

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

vi.mock('@/server', () => ({
  MEMBERS_PAGE_SIZE: 20,
  groupMembersQueryOptions: (id: string, page: number) => ({
    queryKey: ['groupMembers', id, page],
    queryFn: async () => ({
      members: [{ userId: 'u1', name: 'Jane', email: 'jane@example.com' }],
      total: 1,
    }),
  }),
  availableScopesOptions: { queryKey: ['availableScopes'], queryFn: async () => [] },
  updateGroupFn: vi.fn(),
  addGroupMemberFn: vi.fn(),
  removeGroupMemberFn: vi.fn(),
}));

const group: AdminGroup = {
  id: 'g1',
  name: 'Engineering',
  description: '',
  memberCount: 1,
  topMembers: [{ name: 'Jane' }],
  isActive: true,
};

describe('EditGroupDialog save', () => {
  it('refreshes the server-resolved reads when part of the save fails after other parts landed', async () => {
    vi.mocked(updateGroupFn).mockResolvedValue({ group: { ...group, name: 'Platform' } });
    vi.mocked(removeGroupMemberFn).mockRejectedValue(new Error('boom'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <EditGroupDialog group={group} canManage onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    queryClient.setQueryData(['configPreview', 'user', 'u1'], { ok: true });
    queryClient.setQueryData(['envStatus'], {});
    fireEvent.change(await screen.findByLabelText('com_access_col_name'), {
      target: { value: 'Platform' },
    });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'com_access_tab_members' }));
    fireEvent.click(await screen.findByLabelText('com_access_remove_member Jane'));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() => expect(removeGroupMemberFn).toHaveBeenCalled());
    await waitFor(() =>
      expect(queryClient.getQueryState(['configPreview', 'user', 'u1'])?.isInvalidated).toBe(true),
    );
    expect(queryClient.getQueryState(['envStatus'])?.isInvalidated).toBe(true);
  });
});

describe('EditGroupDialog focus', () => {
  it.each(DIALOG_CLOSERS)(
    'gives focus back to the group row that opened it on %s',
    async (_, close) => {
      const opener = renderWithOpener((open, onClose) => (
        <EditGroupDialog
          key={open ? group.id : undefined}
          group={open ? group : null}
          canManage
          onClose={onClose}
        />
      ));
      close(await openFrom(opener));
      await expectFocusBack(opener);
    },
  );
});
