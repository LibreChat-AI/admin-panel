import { PermissionTypes, PrincipalType, SystemRoles } from 'librechat-data-provider';
import { ClickUIProvider } from '@clickhouse/click-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  addRoleMemberFn,
  createRoleFn,
  createGroupFn,
  createUserFn,
  grantCapabilityFn,
  updateRoleFn,
  updateGroupFn,
  updateRolePermissionsFn,
  verifyAdminTokenFn,
  getEffectiveCapabilitiesFn,
} from '@/server';
import { defaultPermissions, SESSION_ERROR_HEADER, SystemCapabilities } from '@/constants';
import { EditCapabilitiesDialog } from '@/components/grants/EditCapabilitiesDialog';
import { CreateGroupDialog } from '@/components/access/CreateGroupDialog';
import { CreateRoleDialog } from '@/components/access/CreateRoleDialog';
import { CreateUserDialog } from '@/components/users/CreateUserDialog';
import { EditGroupDialog } from '@/components/access/EditGroupDialog';
import { EditRoleDialog } from '@/components/access/EditRoleDialog';
import { hasSessionRedirectHold, sessionFetch } from '@/utils';
import i18n from '@/locales/i18n';

const admin = {
  id: 'admin',
  email: 'admin@example.com',
  name: 'Admin',
  role: SystemRoles.ADMIN,
};
const role: t.Role = {
  id: 'r1',
  name: 'WRITERS',
  description: '',
  isSystemRole: false,
  isActive: true,
  userCount: 0,
  permissions: defaultPermissions(),
};
const group = {
  id: 'g1',
  name: 'Platform',
  description: '',
  memberCount: 0,
  topMembers: [],
  isActive: true,
};
const allCapabilities = [
  SystemCapabilities.ACCESS_ADMIN,
  SystemCapabilities.MANAGE_ROLES,
  SystemCapabilities.MANAGE_GROUPS,
  SystemCapabilities.MANAGE_USERS,
];

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  getRouteApi: () => ({
    useRouteContext: () => ({ user: admin, tenantId: 'tenant-a' }),
  }),
  useRouter: () => ({ navigate: vi.fn() }),
}));

vi.mock('@/server', () => ({
  MEMBERS_PAGE_SIZE: 20,
  availableScopesOptions: { queryKey: ['availableScopes'], queryFn: async () => [] },
  roleQueryOptions: (id: string) => ({
    queryKey: ['role', id],
    queryFn: async () => role,
  }),
  roleMembersQueryOptions: (id: string, page: number) => ({
    queryKey: ['roleMembers', id, page],
    queryFn: async () => ({ members: [], total: 0 }),
  }),
  groupMembersQueryOptions: (id: string, page: number) => ({
    queryKey: ['groupMembers', id, page],
    queryFn: async () => ({ members: [], total: 0 }),
  }),
  principalGrantsQueryOptions: (type: PrincipalType, id: string) => ({
    queryKey: ['systemGrants', type, id],
    queryFn: async () => [],
  }),
  searchUsersFn: vi.fn(async () => ({
    users: [{ id: 'new-member', name: 'Jane', email: 'jane@example.com' }],
  })),
  createRoleFn: vi.fn(),
  updateRoleFn: vi.fn(),
  updateRolePermissionsFn: vi.fn(),
  addRoleMemberFn: vi.fn(),
  removeRoleMemberFn: vi.fn(),
  createGroupFn: vi.fn(),
  updateGroupFn: vi.fn(),
  addGroupMemberFn: vi.fn(),
  removeGroupMemberFn: vi.fn(),
  createUserFn: vi.fn(),
  grantCapabilityFn: vi.fn(),
  revokeCapabilityFn: vi.fn(),
  verifyAdminTokenFn: vi.fn(),
  getEffectiveCapabilitiesFn: vi.fn(),
  adminLogoutFn: vi.fn(),
}));

function renderDialog(node: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
  return queryClient;
}

async function interruptSession(code: t.SessionErrorCode = 'AUTH_SESSION_CHECK_UNAVAILABLE') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(null, { headers: { [SESSION_ERROR_HEADER]: code } })),
  );
  await act(async () => {
    await expect(sessionFetch('/protected-read')).rejects.toThrow(code);
  });
  expect(screen.getByRole('button', { name: i18n.t('com_ui_retry') })).toBeVisible();
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
  vi.resetAllMocks();
  vi.mocked(verifyAdminTokenFn).mockResolvedValue({
    valid: true,
    user: admin,
    tenantId: 'tenant-a',
  });
  vi.mocked(getEffectiveCapabilitiesFn).mockResolvedValue({ capabilities: allCapabilities });
  vi.mocked(createRoleFn).mockResolvedValue({ role });
  vi.mocked(updateRoleFn).mockResolvedValue({ role });
  vi.mocked(createGroupFn).mockResolvedValue({ group });
  vi.mocked(updateGroupFn).mockResolvedValue({ group });
  vi.mocked(updateRolePermissionsFn).mockResolvedValue({ role });
  vi.mocked(addRoleMemberFn).mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('unsaved administration forms', () => {
  it('stops the next step of a role save when a background check interrupts it', async () => {
    let finishCreate: (result: { role: t.Role }) => void = () => undefined;
    vi.mocked(createRoleFn).mockImplementation(
      () =>
        new Promise((resolve) => {
          finishCreate = resolve;
        }),
    );
    const queryClient = renderDialog(
      <ClickUIProvider theme="light">
        <CreateRoleDialog open onClose={vi.fn()} />
      </ClickUIProvider>,
    );
    fireEvent.change(screen.getByLabelText(i18n.t('com_access_col_name')), {
      target: { value: 'Pending role' },
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('com_access_create_role') }));
    await waitFor(() => expect(createRoleFn).toHaveBeenCalledTimes(1));
    await interruptSession();
    await act(async () => finishCreate({ role }));
    await waitFor(() => expect(queryClient.isMutating()).toBe(0));
    expect(
      await screen.findByText(i18n.t('com_auth_session_unavailable'), { selector: 'li div' }),
    ).toBeVisible();
    expect(screen.queryByText('AUTH_SESSION_CHECK_UNAVAILABLE')).not.toBeInTheDocument();
    expect(updateRolePermissionsFn).not.toHaveBeenCalled();
    expect(addRoleMemberFn).not.toHaveBeenCalled();
    expect(screen.getByLabelText(i18n.t('com_access_col_name'))).toHaveValue('Pending role');
  });

  it('keeps pending role permissions and members through recovery', async () => {
    renderDialog(<CreateRoleDialog open onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(i18n.t('com_access_col_name')), {
      target: { value: 'Pending role' },
    });
    fireEvent.mouseDown(screen.getByRole('tab', { name: i18n.t('com_access_tab_permissions') }));
    const permissions = screen.getByRole('switch', {
      name: `${i18n.t(`com_perm_type_${PermissionTypes.PROMPTS}`)}: ${i18n.t('com_ui_select_all')}`,
    });
    const wasChecked = permissions.getAttribute('aria-checked') === 'true';
    fireEvent.click(permissions);
    expect(permissions).toHaveAttribute('aria-checked', String(!wasChecked));
    fireEvent.mouseDown(screen.getByRole('tab', { name: i18n.t('com_access_tab_members') }));
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'jane' } });
    fireEvent.click(await screen.findByRole('option', { name: /Jane/ }));
    expect(screen.getByText('jane@example.com')).toBeVisible();

    await interruptSession();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('com_ui_retry') }));
    expect(await screen.findByText('jane@example.com')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('jane@example.com')).toBeVisible());
    fireEvent.mouseDown(screen.getByRole('tab', { name: i18n.t('com_access_tab_permissions') }));
    expect(permissions).toHaveAttribute('aria-checked', String(!wasChecked));
    fireEvent.click(screen.getByRole('button', { name: i18n.t('com_access_create_role') }));
    await waitFor(() => expect(addRoleMemberFn).toHaveBeenCalledTimes(1));
    expect(addRoleMemberFn).toHaveBeenCalledWith({ data: { roleId: 'r1', userId: 'new-member' } });
    expect(updateRolePermissionsFn).toHaveBeenCalledWith({
      data: {
        id: 'r1',
        permissions: expect.objectContaining({ [PermissionTypes.PROMPTS]: expect.any(Object) }),
      },
    });
  });

  it.each([
    [
      'create role',
      <CreateRoleDialog open onClose={vi.fn()} />,
      'com_access_create_role',
      createRoleFn,
    ],
    [
      'create group',
      <CreateGroupDialog open onClose={vi.fn()} />,
      'com_access_create_group',
      createGroupFn,
    ],
    [
      'edit role',
      <EditRoleDialog role={role} canManage onClose={vi.fn()} />,
      'com_ui_save',
      updateRoleFn,
    ],
    [
      'edit group',
      <EditGroupDialog group={group} canManage onClose={vi.fn()} />,
      'com_ui_save',
      updateGroupFn,
    ],
    ['create user', <CreateUserDialog open onClose={vi.fn()} />, 'com_users_add', createUserFn],
  ] as const)(
    'keeps the %s draft through a temporary session failure and Retry',
    async (_name, node, submitKey, write) => {
      renderDialog(node);
      const input = await screen.findByLabelText(i18n.t('com_access_col_name'));
      fireEvent.change(input, { target: { value: 'Pending name' } });
      const email = screen.queryByLabelText(i18n.t('com_auth_email_label'));
      if (email) fireEvent.change(email, { target: { value: 'new@example.com' } });
      await waitFor(() => expect(hasSessionRedirectHold()).toBe(true));

      await interruptSession();
      expect(input).toHaveValue('Pending name');
      expect(input).not.toBeVisible();
      fireEvent.submit(input.closest('form')!);
      expect(write).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: i18n.t('com_ui_retry') }));
      await waitFor(() => expect(input).toBeVisible());
      expect(input).toHaveValue('Pending name');
      expect(write).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: i18n.t(submitKey) }));
      await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
      expect(write).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: 'Pending name' }) }),
      );
      expect(addRoleMemberFn).not.toHaveBeenCalled();
    },
  );

  it.each(['account', 'organization', 'permission'] as const)(
    'keeps a recovered user draft blocked after its %s changes',
    async (change) => {
      renderDialog(<CreateUserDialog open onClose={vi.fn()} />);
      const input = screen.getByLabelText(i18n.t('com_access_col_name'));
      fireEvent.change(input, { target: { value: 'Pending user' } });
      fireEvent.change(screen.getByLabelText(i18n.t('com_auth_email_label')), {
        target: { value: 'new@example.com' },
      });
      await interruptSession('OPENID_SESSION_ENDED');
      if (change === 'permission') {
        vi.mocked(getEffectiveCapabilitiesFn).mockResolvedValue({
          capabilities: [SystemCapabilities.ACCESS_ADMIN],
        });
      } else {
        vi.mocked(verifyAdminTokenFn).mockResolvedValue({
          valid: true,
          user: change === 'account' ? { ...admin, id: 'other' } : admin,
          tenantId: change === 'organization' ? 'tenant-b' : 'tenant-a',
        });
      }
      fireEvent.click(screen.getByRole('button', { name: i18n.t('com_ui_retry') }));
      expect(
        await screen.findByText(
          i18n.t(
            change === 'permission'
              ? 'com_config_session_permission_lost'
              : 'com_config_session_identity_changed',
          ),
        ),
      ).toBeVisible();
      expect(input).toHaveValue('Pending user');
      expect(input).not.toBeVisible();
      fireEvent.submit(input.closest('form')!);
      expect(createUserFn).not.toHaveBeenCalled();
    },
  );

  it('reports a refused Retry without discarding input or replaying a write', async () => {
    renderDialog(<CreateUserDialog open onClose={vi.fn()} />);
    const input = screen.getByLabelText(i18n.t('com_access_col_name'));
    fireEvent.change(input, { target: { value: 'Pending user' } });
    await interruptSession('OPENID_SESSION_ENDED');
    vi.mocked(verifyAdminTokenFn).mockResolvedValue({
      valid: false,
      error: 'OPENID_SESSION_ENDED',
    });
    fireEvent.click(screen.getByRole('button', { name: i18n.t('com_ui_retry') }));
    expect(await screen.findByText(i18n.t('com_config_session_still_ended'))).toBeVisible();
    expect(input).toHaveValue('Pending user');
    expect(input).not.toBeVisible();
    expect(createUserFn).not.toHaveBeenCalled();
  });

  it('keeps pending capability switches through a refetch, session failure, and Retry', async () => {
    const queryClient = renderDialog(
      <EditCapabilitiesDialog
        principalType={PrincipalType.ROLE}
        principalId="r1"
        principalName="WRITERS"
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(await screen.findByRole('button', { name: i18n.t('com_cap_cat_system') }));
    const control = screen.getByRole('switch', {
      name: `${i18n.t('com_cap_cat_system')}: ${i18n.t('com_cap_access_admin')}`,
    });
    fireEvent.click(control);
    expect(control).toBeChecked();
    await act(async () => {
      queryClient.setQueryData(['systemGrants', PrincipalType.ROLE, 'r1'], []);
    });
    expect(control).toBeChecked();
    await interruptSession();
    expect(control).toBeChecked();
    expect(control).not.toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('com_ui_retry') }));
    await waitFor(() => expect(control).toBeVisible());
    expect(control).toBeChecked();
    expect(grantCapabilityFn).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: i18n.t('com_ui_save') }));
    await waitFor(() => expect(grantCapabilityFn).toHaveBeenCalledTimes(1));
    expect(grantCapabilityFn).toHaveBeenCalledWith({
      data: {
        principalType: PrincipalType.ROLE,
        principalId: 'r1',
        capability: SystemCapabilities.ACCESS_ADMIN,
      },
    });
  });
});
