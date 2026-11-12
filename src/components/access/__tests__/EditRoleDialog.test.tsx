import { PrincipalType } from 'librechat-data-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type * as t from '@/types';
import { DIALOG_CLOSERS, expectFocusBack, openFrom, renderWithOpener } from '@/test/focus';
import { removeRoleMemberFn, updateRoleFn } from '@/server';
import { BUNDLED_CONFIG_FEATURES } from '@/constants';
import { EditRoleDialog } from '../EditRoleDialog';

const state = vi.hoisted(() => ({
  features: {} as Record<string, boolean>,
  scopes: [] as Array<Pick<t.ConfigScope, 'principalType' | 'principalId'>>,
  members: [] as Array<{ userId: string; name: string; email: string }>,
}));

vi.mock('@/hooks', async () => {
  const { useRefreshScopes } =
    await vi.importActual<typeof import('@/hooks/config/scope')>('@/hooks/config/scope');
  const { useReturnFocus } =
    await vi.importActual<typeof import('@/hooks/dialogs')>('@/hooks/dialogs');
  return {
    useLocalize: () => (key: string, options?: Record<string, string | number>) =>
      options ? `${key}(${Object.values(options).join(',')})` : key,
    useConfigFeatures: () => state.features,
    useRefreshScopes,
    useReturnFocus,
  };
});

vi.mock('@/server', () => ({
  MEMBERS_PAGE_SIZE: 20,
  roleQueryOptions: (name: string) => ({
    queryKey: ['role', name],
    queryFn: async () => ({ ...role, permissions: {} }),
  }),
  roleMembersQueryOptions: (id: string, page: number) => ({
    queryKey: ['roleMembers', id, page],
    queryFn: async () => ({ members: state.members, total: state.members.length }),
  }),
  availableScopesOptions: {
    queryKey: ['availableScopes'],
    queryFn: async () => state.scopes,
  },
  updateRoleFn: vi.fn(),
  addRoleMemberFn: vi.fn(),
  removeRoleMemberFn: vi.fn(),
  updateRolePermissionsFn: vi.fn(),
}));

vi.mock('../RolePermissionsPanel', () => ({ RolePermissionsPanel: () => null }));

const role: t.Role = {
  id: 'r1',
  name: 'EDITORS',
  description: '',
  isSystemRole: false,
  isActive: true,
  userCount: 0,
  permissions: {},
} as t.Role;

function renderDialog(): QueryClient {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <EditRoleDialog role={role} canManage onClose={vi.fn()} />
    </QueryClientProvider>,
  );
  return queryClient;
}

async function rename(name: string) {
  const input = await screen.findByLabelText('com_access_col_name');
  fireEvent.change(input, { target: { value: name } });
}

beforeEach(() => {
  state.features = { ...BUNDLED_CONFIG_FEATURES };
  state.scopes = [{ principalType: PrincipalType.ROLE, principalId: 'EDITORS' }];
  state.members = [];
});

describe('EditRoleDialog rename note', () => {
  it('warns that the profile stays under the old name on a server that does not move it', async () => {
    renderDialog();
    await rename('WRITERS');
    expect(
      await screen.findByText('com_access_rename_profile_warning(EDITORS)'),
    ).toBeInTheDocument();
  });

  it('says the profile moves with the role when the server moves it', async () => {
    state.features = { ...BUNDLED_CONFIG_FEATURES, roleRenameMovesProfile: true };
    renderDialog();
    await rename('WRITERS');
    expect(await screen.findByText('com_access_rename_profile_moves')).toBeInTheDocument();
    expect(screen.queryByText(/com_access_rename_profile_warning/)).not.toBeInTheDocument();
  });

  it('says nothing once the name is back to the current one', async () => {
    renderDialog();
    await rename('WRITERS');
    expect(await screen.findByText(/com_access_rename_profile_warning/)).toBeInTheDocument();
    await rename('EDITORS');
    expect(screen.queryByText(/com_access_rename_profile/)).not.toBeInTheDocument();
  });

  it('says nothing for a role without a profile', async () => {
    state.scopes = [{ principalType: PrincipalType.GROUP, principalId: 'EDITORS' }];
    renderDialog();
    await rename('WRITERS');
    await act(async () => {});
    expect(screen.queryByText(/com_access_rename_profile/)).not.toBeInTheDocument();
  });
});

describe('EditRoleDialog save', () => {
  it("refreshes the profiles and every server-resolved read, since a user's role resolves their config", async () => {
    vi.mocked(updateRoleFn).mockResolvedValue({ role: { ...role, name: 'WRITERS' } });
    const queryClient = renderDialog();
    queryClient.setQueryData(['configPreview', 'user', 'u1'], { ok: true });
    queryClient.setQueryData(['configCatalog', 'role', 'EDITORS'], {});
    queryClient.setQueryData(['envStatus'], {});
    await rename('WRITERS');
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() =>
      expect(queryClient.getQueryState(['configPreview', 'user', 'u1'])?.isInvalidated).toBe(true),
    );
    expect(queryClient.getQueryState(['configCatalog', 'role', 'EDITORS'])?.isInvalidated).toBe(
      true,
    );
    expect(queryClient.getQueryState(['envStatus'])?.isInvalidated).toBe(true);
  });

  it('refreshes the server-resolved reads when part of the save fails after other parts landed', async () => {
    state.members = [{ userId: 'u1', name: 'Jane', email: 'jane@example.com' }];
    vi.mocked(updateRoleFn).mockResolvedValue({ role });
    vi.mocked(removeRoleMemberFn).mockRejectedValue(new Error('boom'));
    const queryClient = renderDialog();
    queryClient.setQueryData(['configPreview', 'user', 'u1'], { ok: true });
    queryClient.setQueryData(['envStatus'], {});
    fireEvent.mouseDown(await screen.findByRole('tab', { name: 'com_access_tab_members' }));
    fireEvent.click(await screen.findByLabelText('com_access_remove_member Jane'));
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() => expect(removeRoleMemberFn).toHaveBeenCalled());
    await waitFor(() =>
      expect(queryClient.getQueryState(['configPreview', 'user', 'u1'])?.isInvalidated).toBe(true),
    );
    expect(queryClient.getQueryState(['envStatus'])?.isInvalidated).toBe(true);
  });
});

describe('EditRoleDialog focus', () => {
  it.each(DIALOG_CLOSERS)(
    'gives focus back to the role row that opened it on %s',
    async (_, close) => {
      const opener = renderWithOpener((open, onClose) => (
        <EditRoleDialog
          key={open ? role.id : undefined}
          role={open ? role : null}
          canManage
          onClose={onClose}
        />
      ));
      close(await openFrom(opener));
      await expectFocusBack(opener);
    },
  );
});
