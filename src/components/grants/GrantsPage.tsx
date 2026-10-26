import { Tabs } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { GrantManagementTab } from './GrantManagementTab';
import { READ_AUDIT_LOG_CAPABILITY } from '@/constants';
import { useCapabilities, useLocalize } from '@/hooks';
import { AuditLogTab } from './AuditLogTab';

export function GrantsPage({ activeTab, onTabChange }: t.GrantsPageProps) {
  const localize = useLocalize();
  const { hasCapability } = useCapabilities();
  const canReadAuditLog = hasCapability(READ_AUDIT_LOG_CAPABILITY);
  /** A stale `?tab=audit-log` URL from a previous session shouldn't strand a user
   * with revoked audit access on an empty page — silently render management
   * until they pick a tab themselves. */
  const resolvedTab: t.GrantsPageProps['activeTab'] =
    activeTab === 'audit-log' && !canReadAuditLog ? 'management' : activeTab;

  return (
    <div
      role="region"
      aria-label={localize('com_grants_title')}
      className="admin-content-page flex min-h-0 flex-1 flex-col gap-5 overflow-hidden"
    >
      <Tabs
        value={resolvedTab}
        onValueChange={onTabChange}
        ariaLabel={localize('com_grants_title')}
        className="aimo-segmented"
      >
        <Tabs.TriggersList>
          <Tabs.Trigger value="management">{localize('com_grants_tab_management')}</Tabs.Trigger>
          {canReadAuditLog && (
            <Tabs.Trigger value="audit-log">{localize('com_grants_tab_audit_log')}</Tabs.Trigger>
          )}
        </Tabs.TriggersList>
        <Tabs.Content value="management" tabIndex={-1} />
        {canReadAuditLog && <Tabs.Content value="audit-log" tabIndex={-1} />}
      </Tabs>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {resolvedTab === 'management' && <GrantManagementTab />}
        {resolvedTab === 'audit-log' && canReadAuditLog && <AuditLogTab />}
      </div>
    </div>
  );
}
