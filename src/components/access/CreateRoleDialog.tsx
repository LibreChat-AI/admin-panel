import { useState } from 'react';
import { Button, Dialog, Tabs } from '@clickhouse/click-ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminUserSearchResult } from '@librechat/data-schemas';
import type * as t from '@/types';
import { addRoleMemberFn, createRoleFn, updateRolePermissionsFn } from '@/server';
import { SelectedMemberList, UserSearchInline } from '@/components/shared';
import { RolePermissionsPanel } from './RolePermissionsPanel';
import { cn, notifySuccess, notifyError } from '@/utils';
import { defaultPermissions } from '@/constants';
import { useLocalize } from '@/hooks';

export function CreateRoleDialog({ open, onClose }: t.CreateRoleDialogProps) {
  const localize = useLocalize();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<t.CreateRoleTab>('details');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [permissions, setPermissions] = useState<t.RolePermissions>(defaultPermissions);
  const [selectedUsers, setSelectedUsers] = useState<AdminUserSearchResult[]>([]);
  const [error, setError] = useState('');

  const resetAndClose = () => {
    setName('');
    setDescription('');
    setPermissions(defaultPermissions());
    setSelectedUsers([]);
    setError('');
    setActiveTab('details');
    onClose();
  };

  const mutation = useMutation({
    mutationFn: async ({ name: submittedName }: { name: string }) => {
      const { role } = await createRoleFn({ data: { name: submittedName, description } });
      await updateRolePermissionsFn({ data: { id: role.id, permissions } });
      for (const user of selectedUsers) {
        await addRoleMemberFn({ data: { roleId: role.id, userId: user.id } });
      }
      return { name: submittedName };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['roleMembers'] });
      queryClient.invalidateQueries({ queryKey: ['availableScopes'] });
      queryClient.invalidateQueries({ queryKey: ['roleAssignments'] });
      notifySuccess(localize('com_toast_role_created', { name: data.name }));
      resetAndClose();
    },
    onError: (err: Error) => notifyError(err.message),
  });

  const doSubmit = () => {
    setError('');
    if (!name.trim()) {
      setError(localize('com_access_name_required'));
      setActiveTab('details');
      return;
    }
    mutation.mutate({ name });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    doSubmit();
  };

  const addUser = (user: AdminUserSearchResult) => {
    setSelectedUsers((prev) => {
      if (prev.some((u) => u.id === user.id)) return prev;
      return [...prev, user];
    });
  };

  const removeUser = (userId: string) => {
    setSelectedUsers((prev) => prev.filter((u) => u.id !== userId));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) resetAndClose();
      }}
    >
      <Dialog.Content
        title={localize('com_access_create_role')}
        showClose
        onClose={resetAndClose}
        className="modal-frost max-w-2xl!"
      >
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as t.CreateRoleTab)}
            ariaLabel={localize('com_access_create_role')}
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
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="create-role-name"
                    className="text-sm font-medium text-(--cui-color-text-default)"
                  >
                    {localize('com_access_col_name')}
                  </label>
                  <input
                    id="create-role-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={localize('com_access_role_name_placeholder')}
                    autoFocus
                    className="rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) px-3 py-2 text-sm text-(--cui-color-text-default) placeholder:text-(--cui-color-text-disabled)"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="create-role-description"
                    className="text-sm font-medium text-(--cui-color-text-default)"
                  >
                    {localize('com_config_field_description')}
                  </label>
                  <input
                    id="create-role-description"
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder={localize('com_access_role_desc_placeholder')}
                    className="rounded-lg border border-(--cui-color-stroke-default) bg-(--cui-color-background-default) px-3 py-2 text-sm text-(--cui-color-text-default) placeholder:text-(--cui-color-text-disabled)"
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
                <RolePermissionsPanel
                  permissions={permissions}
                  onChange={setPermissions}
                  disabled={mutation.isPending}
                />
              </div>
            </Tabs.Content>
            <Tabs.Content
              value="members"
              forceMount
              tabIndex={-1}
              className={cn(activeTab !== 'members' && 'hidden')}
            >
              <div className="flex flex-col gap-4 pt-5">
                <UserSearchInline
                  existingIds={selectedUsers.map((u) => u.id)}
                  onAdd={addUser}
                  listboxId="create-role-member-results"
                  disabled={mutation.isPending}
                />
                <SelectedMemberList
                  users={selectedUsers}
                  onRemove={removeUser}
                  disabled={mutation.isPending}
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
              onClick={resetAndClose}
              disabled={mutation.isPending}
            />
            <Button
              htmlType="submit"
              type="primary"
              label={localize('com_access_create_role')}
              disabled={!name.trim() || mutation.isPending}
            />
          </div>
        </form>
      </Dialog.Content>
    </Dialog>
  );
}
