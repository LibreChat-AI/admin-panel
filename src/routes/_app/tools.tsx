import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { ToolsPage } from '@/components/tools';

type Tab = 'catalog' | 'groups';

function isValidTab(value?: string): value is Tab {
  return value === 'catalog' || value === 'groups';
}

export const Route = createFileRoute('/_app/tools')({
  validateSearch: (search: Record<string, unknown>): { tab?: string } => ({
    tab: typeof search.tab === 'string' ? search.tab : undefined,
  }),
  component: ToolsRoute,
});

function ToolsRoute() {
  const { tab } = Route.useSearch();
  const navigate = useNavigate({ from: '/tools' });
  const activeTab: Tab = isValidTab(tab) ? tab : 'catalog';

  const handleTabChange = (value: string) => {
    if (isValidTab(value)) {
      navigate({ search: (prev: Record<string, unknown>) => ({ ...prev, tab: value }) });
    }
  };

  return <ToolsPage activeTab={activeTab} onTabChange={handleTabChange} />;
}
