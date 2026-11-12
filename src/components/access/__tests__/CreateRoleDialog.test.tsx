import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { AdminUserSearchResult } from '@librechat/data-schemas';
import type * as t from '@/types';
import { DIALOG_CLOSERS, expectFocusBack, openFrom, renderWithOpener } from '@/test/focus';
import { addRoleMemberFn, createRoleFn, updateRolePermissionsFn } from '@/server';
import { CreateRoleDialog } from '../CreateRoleDialog';

const USERS: AdminUserSearchResult[] = [
  { id: 'u1', name: 'Jane', email: 'jane@example.com' },
  { id: 'u2', name: 'Raj', email: 'raj@example.com' },
];

const role = {
  id: 'r1',
  name: 'WRITERS',
  description: '',
  isSystemRole: false,
  isActive: true,
  userCount: 0,
  permissions: {},
} as t.Role;

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

vi.mock('../RolePermissionsPanel', () => ({ RolePermissionsPanel: () => null }));

vi.mock('@/server', () => ({
  availableScopesOptions: { queryKey: ['availableScopes'], queryFn: async () => [] },
  createRoleFn: vi.fn(),
  addRoleMemberFn: vi.fn(),
  updateRolePermissionsFn: vi.fn(),
}));

describe('CreateRoleDialog save', () => {
  it('refreshes the server-resolved reads when a later member addition fails', async () => {
    vi.mocked(createRoleFn).mockResolvedValue({ role });
    vi.mocked(updateRolePermissionsFn).mockResolvedValue({ role });
    vi.mocked(addRoleMemberFn)
      .mockResolvedValueOnce({ success: true })
      .mockRejectedValueOnce(new Error('boom'));
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <CreateRoleDialog open onClose={vi.fn()} />
      </QueryClientProvider>,
    );
    queryClient.setQueryData(['configPreview', 'user', 'u1'], { ok: true });
    queryClient.setQueryData(['roles', 'all'], []);
    fireEvent.change(await screen.findByLabelText('com_access_col_name'), {
      target: { value: 'WRITERS' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'add-users' }));
    fireEvent.click(screen.getByRole('button', { name: 'com_access_create_role' }));
    await waitFor(() => expect(addRoleMemberFn).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(queryClient.getQueryState(['configPreview', 'user', 'u1'])?.isInvalidated).toBe(true),
    );
    expect(queryClient.getQueryState(['roles', 'all'])?.isInvalidated).toBe(true);
  });
});

describe('CreateRoleDialog focus', () => {
  it.each(DIALOG_CLOSERS)(
    'gives focus back to the button that opened it on %s',
    async (_, close) => {
      const opener = renderWithOpener((open, onClose) => (
        <CreateRoleDialog open={open} onClose={onClose} />
      ));
      close(await openFrom(opener));
      await expectFocusBack(opener);
    },
  );
});
