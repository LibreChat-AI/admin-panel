import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { TUser } from 'librechat-data-provider';
import type * as t from '@/types';
import { DIALOG_CLOSERS, expectFocusBack, openFrom, renderWithOpener } from '@/test/focus';
import { UserDetailDialog } from '../UserDetailDialog';
import '@/locales/i18n';

/**
 * Jane's roles as the server holds them. A removal's refetch waits for
 * `release()`, so the test decides when the removed row leaves the list.
 */
const server = vi.hoisted(() => ({
  roles: [] as t.AssignmentRef[],
  refetched: Promise.resolve(),
  release: () => {},
}));

vi.mock('@/server', () => {
  const empty = (key: string) => ({ queryKey: [key], queryFn: () => Promise.resolve([]) });
  return {
    roleAssignmentsQueryOptions: {
      queryKey: ['roleAssignments'],
      queryFn: async () => {
        await server.refetched;
        return { 'u-jane': server.roles };
      },
    },
    groupAssignmentsQueryOptions: { queryKey: ['groupAssignments'], queryFn: () => ({}) },
    allRolesQueryOptions: empty('allRoles'),
    allGroupsQueryOptions: empty('allGroups'),
    availableScopesOptions: empty('availableScopes'),
    addGroupMemberFn: vi.fn(),
    addRoleMemberFn: vi.fn(),
    createScopeFn: vi.fn(),
    deleteScopeFn: vi.fn(),
    removeGroupMemberFn: vi.fn(),
    removeRoleMemberFn: vi.fn(async () => {
      server.roles = [];
      server.refetched = new Promise((resolve) => {
        server.release = resolve;
      });
    }),
  };
});

const USER: TUser = {
  id: 'u-jane',
  name: 'Jane Doe',
  username: 'jane',
  email: 'jane@example.com',
  avatar: '',
  role: 'USER',
  provider: 'local',
  createdAt: '2026-10-01T12:00:00.000Z',
  updatedAt: '2026-10-01T12:00:00.000Z',
};

describe('UserDetailDialog focus', () => {
  it.each(DIALOG_CLOSERS)(
    'gives focus back to the user row that opened it on %s',
    async (_, close) => {
      const opener = renderWithOpener((open, onClose) => (
        <UserDetailDialog user={open ? USER : null} onClose={onClose} />
      ));
      close(await openFrom(opener));
      await expectFocusBack(opener);
    },
  );
});

describe('UserDetailDialog removal', () => {
  it('gives focus to Add profiles once a confirmed removal takes away the row it started from', async () => {
    server.roles = [{ id: 'r-support', name: 'Support' }];
    const opener = renderWithOpener((open, onClose) => (
      <UserDetailDialog user={open ? USER : null} onClose={onClose} canManageRoles />
    ));
    const details = await openFrom(opener);
    const remove = await within(details).findByRole('button', { name: 'Remove role Support' });
    remove.focus();
    fireEvent.click(remove);
    const confirm = await screen.findByRole('dialog', { name: 'Remove from role' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(confirm).not.toBeInTheDocument());
    await waitFor(() => expect(document.body).not.toHaveFocus());

    act(() => server.release());
    await waitFor(() => expect(remove).not.toBeInTheDocument());
    expect(within(details).getByRole('button', { name: 'Add profiles' })).toHaveFocus();
  });
});
