import { useState } from 'react';
import { Tabs } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { CreateGroupDialog } from './CreateGroupDialog';
import { CreateRoleDialog } from './CreateRoleDialog';
import { GroupsTab } from './GroupsTab';
import { useLocalize } from '@/hooks';
import { RolesTab } from './RolesTab';

export function AccessPage({
  activeTab,
  onTabChange,
  canReadRoles,
  canReadGroups,
}: t.AccessPageProps) {
  const localize = useLocalize();
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createRoleOpen, setCreateRoleOpen] = useState(false);

  return (
    <div
      role="region"
      aria-label={localize('com_nav_access')}
      className="admin-content-page flex min-h-0 flex-1 flex-col gap-5 overflow-hidden"
    >
      {canReadRoles && canReadGroups && (
        <Tabs
          value={activeTab}
          onValueChange={onTabChange}
          ariaLabel={localize('com_nav_access')}
          className="aimo-segmented"
        >
          <Tabs.TriggersList>
            <Tabs.Trigger value="roles">{localize('com_access_tab_roles')}</Tabs.Trigger>
            <Tabs.Trigger value="groups">{localize('com_access_tab_groups')}</Tabs.Trigger>
          </Tabs.TriggersList>
          <Tabs.Content value="roles" tabIndex={-1} />
          <Tabs.Content value="groups" tabIndex={-1} />
        </Tabs>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === 'groups' && canReadGroups && (
          <GroupsTab onCreateGroup={() => setCreateGroupOpen(true)} />
        )}

        {activeTab === 'roles' && canReadRoles && (
          <RolesTab onCreateRole={() => setCreateRoleOpen(true)} />
        )}
      </div>

      <CreateGroupDialog open={createGroupOpen} onClose={() => setCreateGroupOpen(false)} />
      <CreateRoleDialog open={createRoleOpen} onClose={() => setCreateRoleOpen(false)} />
    </div>
  );
}
