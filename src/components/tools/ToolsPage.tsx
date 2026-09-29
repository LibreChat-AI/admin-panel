import { Tabs } from '@clickhouse/click-ui';
import type * as t from '@/types';
import { useLocalize } from '@/hooks';
import { ToolCatalogTab } from './ToolCatalogTab';
import { UsagePage } from '@/components/usage';
import { ToolGroupsTab } from './ToolGroupsTab';

/**
 * Tool management surface. The page title lives in the top Header
 * (ROUTE_TITLE_KEYS '/tools'); this component starts with the tab bar —
 * 工具清单 (catalog CRUD + import)、工具分组 (namespace group metadata) and
 * 使用统计 (run reports, moved here from its own sidebar route 2.16.0).
 */
export function ToolsPage({ activeTab, onTabChange }: t.ToolsPageProps) {
  const localize = useLocalize();

  return (
    <div
      role="region"
      aria-label={localize('com_tools_title')}
      className="flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2"
    >
      <Tabs value={activeTab} onValueChange={onTabChange} ariaLabel={localize('com_tools_title')}>
        <Tabs.TriggersList>
          <Tabs.Trigger value="catalog">{localize('com_tools_tab_catalog')}</Tabs.Trigger>
          <Tabs.Trigger value="groups">{localize('com_tools_tab_groups')}</Tabs.Trigger>
          <Tabs.Trigger value="usage">{localize('com_tools_tab_usage')}</Tabs.Trigger>
        </Tabs.TriggersList>
      </Tabs>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pt-4 pb-6">
        {activeTab === 'catalog' && <ToolCatalogTab />}
        {activeTab === 'groups' && <ToolGroupsTab />}
        {activeTab === 'usage' && <UsagePage />}
      </div>
    </div>
  );
}
