import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToolCatalogTab } from '../ToolCatalogTab';

/* 用真实 dnd-kit（importOriginal）渲染 ToolCatalogTab，复现浏览器端 /tools 路由崩溃。 */

vi.mock('@dnd-kit/core', async (importOriginal) => await importOriginal());
vi.mock('@dnd-kit/sortable', async (importOriginal) => await importOriginal());
vi.mock('@dnd-kit/utilities', async (importOriginal) => await importOriginal());

const mocks = vi.hoisted(() => ({
  state: { tools: [] as Array<Record<string, unknown>> },
}));

vi.mock('@/hooks/useLocalize', () => {
  const localize = (key: string) => key;
  return { default: () => localize, useLocalize: () => localize };
});

vi.mock('@/server', () => ({
  toolsQueryOptions: {
    queryKey: ['t', 'tools'],
    queryFn: () => Promise.resolve({ tools: mocks.state.tools, groups: [] }),
  },
  toolGroupsQueryOptions: { queryKey: ['t', 'groups'], queryFn: () => Promise.resolve([]) },
  handlersQueryOptions: { queryKey: ['t', 'handlers'], queryFn: () => Promise.resolve([]) },
  pendingUpdatesQueryOptions: {
    queryKey: ['t', 'pending'],
    queryFn: () => Promise.resolve([]),
  },
  createToolFn: vi.fn(),
  updateToolFn: vi.fn(),
  deleteToolFn: vi.fn(),
  toggleToolFn: vi.fn(),
  giteaCheckRepoFn: vi.fn(),
  giteaReposQueryOptions: () => ({
    queryKey: ['t', 'gitea'],
    queryFn: () => Promise.resolve({ base_url: '', owners: [] }),
  }),
}));

vi.mock('@/utils', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

const TOOLS = [
  {
    schema_version: 1,
    tool_id: 'demo.echo',
    version: '1.0.0',
    display_name: '回声',
    description: '',
    expose: ['ui'],
    allowed_groups: ['*'],
    enabled: true,
    dangerous: false,
    display_group: 'demo',
  },
];

describe('ToolCatalogTab with REAL dnd-kit', () => {
  it('renders the catalog table without crashing', async () => {
    mocks.state.tools = TOOLS;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToolCatalogTab />
      </QueryClientProvider>,
    );
    await screen.findByText('回声');
    expect(screen.getByText('demo.echo')).toBeInTheDocument();
  });
});
