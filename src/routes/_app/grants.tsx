import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { GrantsPage } from '@/components/grants';

type Tab = 'management' | 'audit-log';

interface GrantsSearch {
  tab?: string;
  entryId?: string;
}

function isValidTab(value?: string): value is Tab {
  return value === 'management' || value === 'audit-log';
}

export const Route = createFileRoute('/_app/grants')({
  head: () => ({ meta: [{ title: 'AIMO · Chat Admin Panel · System grants' }] }),
  validateSearch: (search: Record<string, unknown>): GrantsSearch => ({
    tab: typeof search.tab === 'string' ? search.tab : undefined,
    entryId: typeof search.entryId === 'string' ? search.entryId : undefined,
  }),
  component: GrantsRoute,
});

function GrantsRoute() {
  const { tab, entryId } = Route.useSearch();
  const navigate = useNavigate({ from: '/grants' });
  /**
   * Permalinks land here without `tab` set (e.g. `/grants?entryId=abc`), so
   * default to the audit-log tab when an `entryId` is present so the drawer
   * actually opens on cold load. `GrantsPage` still falls back to management
   * for users without `READ_AUDIT_LOG`, so this does not strand anyone on a
   * tab they cannot read.
   */
  const fallbackTab: Tab = entryId ? 'audit-log' : 'management';
  const activeTab: Tab = isValidTab(tab) ? tab : fallbackTab;

  const handleTabChange = (value: string) => {
    if (isValidTab(value)) {
      navigate({
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          tab: value,
          /** Drop the audit-entry deep link when leaving the audit-log tab so it
           * doesn't silently reopen on return or linger in Management URLs. */
          entryId: value === 'audit-log' ? (prev.entryId as string | undefined) : undefined,
        }),
      });
    }
  };

  return <GrantsPage activeTab={activeTab} onTabChange={handleTabChange} />;
}
