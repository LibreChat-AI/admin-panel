import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToolGroupsTab } from '../ToolGroupsTab';

/* 用真实 dnd-kit 渲染 ToolGroupsTab 并打开分组详情弹窗，
 * 复现浏览器端点 ☰ 后整路由崩溃的问题。 */

vi.mock('@dnd-kit/core', async (importOriginal) => await importOriginal());
vi.mock('@dnd-kit/sortable', async (importOriginal) => await importOriginal());
vi.mock('@dnd-kit/utilities', async (importOriginal) => await importOriginal());

const mocks = vi.hoisted(() => ({
  state: {
    groups: [] as Array<Record<string, unknown>>,
    tools: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/hooks/useLocalize', () => {
  const localize = (key: string, params?: Record<string, unknown>) => {
    if (!params) return key;
    return key + ' ' + Object.values(params).join(' ');
  };
  return { default: () => localize, useLocalize: () => localize };
});

vi.mock('@/server', () => ({
  toolGroupsQueryOptions: {
    queryKey: ['t', 'groups'],
    queryFn: () => Promise.resolve(mocks.state.groups),
  },
  toolsQueryOptions: {
    queryKey: ['t', 'tools'],
    queryFn: () => Promise.resolve({ tools: mocks.state.tools, groups: [] }),
  },
  createToolGroupFn: vi.fn(),
  deleteToolGroupFn: vi.fn(),
  updateToolGroupFn: vi.fn(),
  updateToolFn: vi.fn(),
}));

vi.mock('@/utils', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

const GROUPS = [
  {
    name: 'data',
    display_name: '数据处理',
    description: '',
    sort_order: 0,
    allowed_groups: ['*'],
    explicit: true,
    tool_count: 1,
  },
];

const TOOLS = [
  {
    schema_version: 1,
    tool_id: 'echo.hello',
    version: '1.0.0',
    display_name: '回声测试',
    description: '',
    expose: ['ui'],
    allowed_groups: ['*'],
    enabled: true,
    display_group: 'data',
  },
  {
    schema_version: 1,
    tool_id: 'demo.echo',
    version: '1.0.0',
    display_name: '另一个工具',
    description: '',
    expose: ['ui'],
    allowed_groups: ['*'],
    enabled: true,
  },
];

describe('ToolGroupsTab detail dialog with REAL dnd-kit', () => {
  it('opens the dual-list dialog without crashing', async () => {
    mocks.state.groups = GROUPS;
    mocks.state.tools = TOOLS;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToolGroupsTab />
      </QueryClientProvider>,
    );
    await screen.findByText('数据处理');
    // 点 ☰ 打开 GroupToolsDialog
    fireEvent.click(screen.getByRole('button', { name: 'com_tools_group_detail_manage' }));
    // 双列表挂载：左右两列标题都出现
    await screen.findByText('com_tools_group_detail_left');
    expect(screen.getByText('com_tools_group_detail_right')).toBeInTheDocument();
    // 组内工具行与候选行都在
    expect(screen.getByText('回声测试')).toBeInTheDocument();
    expect(screen.getByText('另一个工具')).toBeInTheDocument();
  });
});
