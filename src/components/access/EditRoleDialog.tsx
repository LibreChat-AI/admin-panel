import { PrincipalType } from 'librechat-data-provider';
import { useState, useEffect, useCallback } from 'react';
import { Button, Dialog, Tabs } from '@clickhouse/click-ui';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { AdminMember, AdminUserSearchResult } from '@librechat/data-schemas';
import type * as t from '@/types';
import {
  addRoleMemberFn,
  removeRoleMemberFn,
  roleQueryOptions,
  roleMembersQueryOptions,
  availableScopesOptions,
  updateRoleFn,
  updateRolePermissionsFn,
  MEMBERS_PAGE_SIZE,
} from '@/server';
import {
  LoadingState,
  DecorativeIcon,
  SelectedMemberList,
  UserSearchInline,
} from '@/components/shared';
import { useLocalize, useReturnFocus, useRefreshScopes, useConfigFeatures } from '@/hooks';
import { RolePermissionsPanel } from './RolePermissionsPanel';
import { cn, notifySuccess, notifyError } from '@/utils';
import { MemberList } from './MemberList';

type EditRoleTab = 'details' | 'permissions' | 'members';

export function EditRoleDialog({ role, canManage, onClose }: t.EditRoleDialogProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const refreshScopes = useRefreshScopes();
  const returnFocus = useReturnFocus(!!role);
  const [activeTab, setActiveTab] = useState<EditRoleTab>('details');
  const [name, setName] = useState(role?.name ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [permissions, setPermissions] = useState<t.RolePermissions | null>(null);
  const [error, setError] = useState('');

  const [page, setPage] = useState(1);
  const [pendingAdditions, setPendingAdditions] = useState<AdminUserSearchResult[]>([]);
  const [pendingRemovals, setPendingRemovals] = useState<AdminMember[]>([]);

  const roleDetail = useQuery({
    ...roleQueryOptions(role?.id ?? ''),
    enabled: !!role,
  });

  const { roleRenameMovesProfile } = useConfigFeatures();
  const { data: scopes } = useQuery({ ...availableScopesOptions, enabled: !!role });
  const hasProfile =
    role != null &&
    (scopes ?? []).some(
      (scope) => scope.principalType === PrincipalType.ROLE && scope.principalId === role.name,
    );
  const isRenaming = role != null && name.trim() !== '' && name.trim() !== role.name;

  useEffect(() => {
    if (roleDetail.data && permissions === null) {
      setPermissions(roleDetail.data.permissions);
    }
  }, [roleDetail.data, permissions]);

  const membersQuery = useQuery({
    ...roleMembersQueryOptions(role?.id ?? '', page),
    placeholderData: keepPreviousData,
    enabled: !!role,
  });

  const members = membersQuery.data?.members ?? [];
  const total = membersQuery.data?.total ?? 0;
  const totalPages = Math.ceil(total / MEMBERS_PAGE_SIZE);
  const removalIds = new Set(pendingRemovals.map((m) => m.userId));
  const existingIds = [...members.map((m) => m.userId), ...pendingAdditions.map((u) => u.id)];

  const detailsDirty = name !== role?.name || description !== role?.description;
  const permissionsDirty =
    permissions !== null &&
    JSON.stringify(permissions) !== JSON.stringify(roleDetail.data?.permissions);
  const membersDirty = pendingAdditions.length > 0 || pendingRemovals.length > 0;

  const addUser = (user: AdminUserSearchResult) => {
    setPendingAdditions((prev) => {
      if (prev.some((u) => u.id === user.id)) return prev;
      return [...prev, user];
    });
  };

  const removePendingUser = (userId: string) => {
    setPendingAdditions((prev) => prev.filter((u) => u.id !== userId));
  };

  const stageRemoval = useCallback((member: AdminMember) => {
    setPendingRemovals((prev) => {
      if (prev.some((m) => m.userId === member.userId)) return prev;
      return [...prev, member];
    });
  }, []);

  const unstageRemoval = (userId: string) => {
    setPendingRemovals((prev) => prev.filter((m) => m.userId !== userId));
  };

  const updateMutation = useMutation({
    mutationFn: async ({
      name: submittedName,
    }: {
      name: string;
    }): Promise<{ roleId: string; name: string }> => {
      if (!role) throw new Error(localize('com_access_role_unavailable'));
      let roleId = role.id;
      if (detailsDirty) {
        const result = await updateRoleFn({
          data: { id: role.id, name: submittedName, description },
        });
        roleId = result.role.id;
      }
      if (permissionsDirty && permissions) {
        try {
          await updateRolePermissionsFn({ data: { id: roleId, permissions } });
        } catch (err) {
          if (detailsDirty) {
            throw new Error(
              localize('com_access_details_saved_permissions_failed', {
                error: (err as Error).message,
              }),
            );
          }
          throw err;
        }
      }
      const memberResults = await Promise.allSettled([
        ...pendingAdditions.map((user) => addRoleMemberFn({ data: { roleId, userId: user.id } })),
        ...pendingRemovals.map((member) =>
          removeRoleMemberFn({ data: { roleId, userId: member.userId } }),
        ),
      ]);
      const failures = memberResults.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      if (failures.length > 0) {
        const parts: string[] = [];
        if (detailsDirty) parts.push(localize('com_access_details_saved'));
        if (permissionsDirty) parts.push(localize('com_access_permissions_saved'));
        parts.push(localize('com_access_member_ops_failed', { count: failures.length }));
        throw new Error(parts.join(', '));
      }
      return { roleId, name: submittedName };
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['role'] });
      queryClient.invalidateQueries({ queryKey: ['roleAssignments'] });
      queryClient.invalidateQueries({ queryKey: ['roleMembers'] });
      void refreshScopes();
    },
    onSuccess: (data) => {
      notifySuccess(localize('com_toast_role_updated', { name: data.name }));
      onClose();
    },
    onError: (err: Error) => notifyError(err.message),
  });

  const doSubmit = () => {
    setError('');
    if (!role) return;
    if (!name.trim()) {
      setError(localize('com_access_name_required'));
      setActiveTab('details');
      return;
    }
    updateMutation.mutate({ name });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSubmit();
  };

  return (
    <Dialog
      open={!!role}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <Dialog.Content
        title={localize('com_access_edit_role')}
        showClose
        onClose={onClose}
        onCloseAutoFocus={returnFocus}
        className="modal-frost max-w-2xl!"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as EditRoleTab)}
            ariaLabel={localize('com_access_edit_role')}
          >
            <Tabs.TriggersList>
              <Tabs.Trigger value="details">{localize('com_access_tab_details')}</Tabs.Trigger>
              <Tabs.Trigger value="permissions">
                {localize('com_access_tab_permissions')}
              </Tabs.Trigger>
              <Tabs.Trigger value="members">{localize('com_access_tab_members')}</Tabs.Trigger>
            </Tabs.TriggersList>
            <Tabs.Content
              value="details"
              forceMount
              tabIndex={-1}
              className={cn(activeTab !== 'details' && 'hidden')}
            >
              <div className="flex flex-col gap-5 pt-5">
                {role?.isSystemRole && (
                  <span className="inline-flex w-fit items-center rounded-md bg-(--cui-color-background-muted) px-2 py-1 text-xs font-medium text-(--cui-color-text-muted)">
                    {localize('com_access_system_role')}
                  </span>
                )}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="edit-role-name"
                    className="text-sm font-medium text-(--cui-color-text-default)"
                  >
                    {localize('com_access_col_name')}
                  </label>
                  <input
                    id="edit-role-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={localize('com_access_role_name_placeholder')}
                    disabled={role?.isSystemRole || !canManage}
                    readOnly={!canManage}
                    autoFocus
                    aria-describedby={
                      isRenaming && hasProfile ? 'edit-role-rename-note' : undefined
                    }
                    className="rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) px-3 py-2 text-sm text-(--cui-color-text-default) placeholder:text-(--cui-color-text-muted) disabled:cursor-not-allowed disabled:opacity-50"
                  />
                  {isRenaming && hasProfile && (
                    <RenameProfileNote
                      id="edit-role-rename-note"
                      name={role.name}
                      moves={roleRenameMovesProfile}
                    />
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="edit-role-description"
                    className="text-sm font-medium text-(--cui-color-text-default)"
                  >
                    {localize('com_config_field_description')}
                  </label>
                  <input
                    id="edit-role-description"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={localize('com_access_role_desc_placeholder')}
                    disabled={!canManage}
                    readOnly={!canManage}
                    className="rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) px-3 py-2 text-sm text-(--cui-color-text-default) placeholder:text-(--cui-color-text-muted) disabled:cursor-not-allowed disabled:opacity-50"
                  />
                </div>
              </div>
            </Tabs.Content>
            <Tabs.Content
              value="permissions"
              forceMount
              tabIndex={-1}
              className={cn(activeTab !== 'permissions' && 'hidden')}
            >
              <div className="pt-5">
                {(() => {
                  if (roleDetail.isLoading) {
                    return <LoadingState className="flex items-center justify-center py-8" />;
                  }
                  if (roleDetail.isError || !permissions) {
                    return (
                      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center text-sm text-(--cui-color-text-muted)">
                        <p>{localize('com_access_permissions_load_error')}</p>
                        {roleDetail.isError && (
                          <Button
                            htmlType="button"
                            type="secondary"
                            label={localize('com_ui_retry')}
                            onClick={() => roleDetail.refetch()}
                          />
                        )}
                      </div>
                    );
                  }
                  return (
                    <RolePermissionsPanel
                      permissions={permissions}
                      onChange={setPermissions}
                      disabled={!canManage || updateMutation.isPending}
                    />
                  );
                })()}
              </div>
            </Tabs.Content>
            <Tabs.Content
              value="members"
              forceMount
              tabIndex={-1}
              className={cn(activeTab !== 'members' && 'hidden')}
            >
              <div className="flex flex-col gap-4 pt-5">
                {canManage && (
                  <UserSearchInline
                    existingIds={existingIds}
                    onAdd={addUser}
                    listboxId="edit-role-member-search"
                    disabled={updateMutation.isPending}
                  />
                )}
                {pendingAdditions.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-(--cui-color-text-muted)">
                      {localize('com_access_pending_additions', { count: pendingAdditions.length })}
                    </span>
                    <SelectedMemberList
                      users={pendingAdditions}
                      onRemove={removePendingUser}
                      disabled={updateMutation.isPending}
                    />
                  </div>
                )}
                {pendingRemovals.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs font-medium text-(--cui-color-text-muted)">
                      {localize('com_access_pending_removals', { count: pendingRemovals.length })}
                    </span>
                    <SelectedMemberList
                      users={pendingRemovals.map((m) => ({
                        id: m.userId,
                        name: m.name,
                        email: m.email,
                        avatarUrl: m.avatarUrl,
                      }))}
                      onRemove={unstageRemoval}
                      disabled={updateMutation.isPending}
                    />
                  </div>
                )}
                <MemberList
                  members={members}
                  loading={membersQuery.isLoading}
                  error={membersQuery.isError}
                  fetching={membersQuery.isFetching}
                  removalIds={removalIds}
                  onRemove={stageRemoval}
                  onUndoRemove={unstageRemoval}
                  canManage={canManage}
                  total={total}
                  currentPage={page}
                  totalPages={totalPages}
                  onPageChange={setPage}
                />
              </div>
            </Tabs.Content>
          </Tabs>

          {error && (
            <p role="alert" className="text-sm text-(--cui-color-text-danger)">
              {error}
            </p>
          )}
          <div className="flex items-center justify-end gap-2">
            <Button
              htmlType="button"
              type="secondary"
              label={localize('com_ui_cancel')}
              onClick={onClose}
              disabled={updateMutation.isPending}
            />
            <Button
              htmlType="submit"
              type="primary"
              label={localize('com_ui_save')}
              disabled={
                !canManage ||
                !name.trim() ||
                (permissionsDirty && permissions === null) ||
                (!detailsDirty && !permissionsDirty && !membersDirty) ||
                updateMutation.isPending
              }
            />
          </div>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}

/**
 * What renaming a role does to its configuration profile: LibreChat keeps a
 * role's profile under the role's name, so before it moved profiles on rename
 * (`roleRenameMovesProfile`) the profile stays behind and stops applying.
 */
function RenameProfileNote({ id, name, moves }: t.RenameProfileNoteProps) {
  const localize = useLocalize();
  return (
    <p
      id={id}
      className={cn(
        'm-0 flex items-start gap-1.5 text-xs',
        moves ? 'text-(--cui-color-text-muted)' : 'text-(--settings-warn-fg)',
      )}
    >
      <span className="mt-px flex shrink-0">
        <DecorativeIcon name={moves ? 'info-in-circle' : 'warning'} size="xs" />
      </span>
      <span>
        {moves
          ? localize('com_access_rename_profile_moves')
          : localize('com_access_rename_profile_warning', { name })}
      </span>
    </p>
  );
}
