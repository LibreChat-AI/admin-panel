import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToolCatalogTab } from '../ToolCatalogTab';

/* Mutable per-test state + fns — vi.hoisted keeps them usable inside the
 * hoisted vi.mock factories below. */
const mocks = vi.hoisted(() => ({
  checkRepo: vi.fn(),
  state: {
    tools: [] as Array<Record<string, unknown>>,
    pending: [] as Array<Record<string, unknown>>,
    failPending: false,
    hangTools: false,
  },
}));

vi.mock('@/hooks/useLocalize', () => {
  /* Interpolation params render space-joined so version transitions are
   * assertable in the panel text. */
  const localize = (key: string, params?: Record<string, unknown>) =>
    params ? Object.values(params).join(' ') : key;
  return { default: () => localize, useLocalize: () => localize };
});

vi.mock('@/server', () => ({
  toolsQueryOptions: {
    queryKey: ['t', 'tools'],
    queryFn: () =>
      mocks.state.hangTools
        ? new Promise(() => {})
        : Promise.resolve({ tools: mocks.state.tools, groups: [] }),
  },
  toolGroupsQueryOptions: { queryKey: ['t', 'groups'], queryFn: () => Promise.resolve([]) },
  handlersQueryOptions: { queryKey: ['t', 'handlers'], queryFn: () => Promise.resolve([]) },
  pendingUpdatesQueryOptions: {
    queryKey: ['t', 'pending'],
    queryFn: () =>
      mocks.state.failPending
        ? Promise.reject(new Error('pending boom'))
        : Promise.resolve(mocks.state.pending),
  },
  giteaReposQueryOptions: (baseUrl: string) => ({
    queryKey: ['t', 'gitea', baseUrl],
    queryFn: () => Promise.resolve({ base_url: '', owners: [] }),
  }),
  createToolFn: vi.fn(),
  updateToolFn: vi.fn(),
  deleteToolFn: vi.fn(),
  toggleToolFn: vi.fn(),
  giteaCheckRepoFn: mocks.checkRepo,
}));

vi.mock('@/components/tools/ToolEditDialog', () => ({
  ToolEditDialog: ({ open, tool }: { open: boolean; tool: unknown }) =>
    open ? <div data-testid="edit-dialog">{JSON.stringify(tool)}</div> : null,
}));

vi.mock('@/components/tools/ImportToolsDialog', () => ({
  ImportToolsDialog: () => null,
}));

/* Keep the real buildPrefill (the confirm flow reuses it); stub only the UI. */
vi.mock('@/components/tools/GiteaImportDialog', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  GiteaImportDialog: () => null,
}));

vi.mock('@/components/access', () => ({
  ConfirmDialog: () => null,
}));

vi.mock('@/components/shared', () => ({
  EmptyState: ({ message }: { message?: string }) => <div>{message}</div>,
  KebabMenu: () => <div />,
  LoadingState: () => <div>loading</div>,
  SearchInput: () => <input aria-label="search" />,
  StatusToggle: () => <div />,
}));

interface MockButtonProps {
  label?: string;
  disabled?: boolean;
  onClick?: () => void;
}

vi.mock('@clickhouse/click-ui', () => ({
  Icon: () => <span />,
  Button: ({ label, disabled, onClick }: MockButtonProps) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  ),
  Dialog: Object.assign(({ children }: { children: React.ReactNode }) => <div>{children}</div>, {
    Content: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }),
  Select: Object.assign(({ children }: { children: React.ReactNode }) => <div>{children}</div>, {
    Item: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  }),
}));

vi.mock('@/utils', () => ({
  cn: (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(' '),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
}));

const EXISTING: Record<string, unknown> = {
  schema_version: 1,
  tool_id: 'wangjianbo.toolsdemo',
  version: '1.0.0',
  enabled: true,
  display_name: 'Tools Demo',
  description: 'approved description',
  expose: ['ui'],
  allowed_groups: ['team-editor'],
  parameters: { type: 'object', properties: { old: { type: 'string' } } },
  execution: {
    kind: 'desktop',
    distribution: {
      source: { type: 'gitea_release', owner: 'wangjianbo', repo: 'toolsdemo' },
      version: '1.0.0',
    },
  },
};

const PENDING_UPDATE: Record<string, unknown> = {
  tool_id: 'wangjianbo.toolsdemo',
  display_name: 'Tools Demo',
  owner: 'wangjianbo',
  repo: 'toolsdemo',
  current_version: '1.0.0',
  package: { version: '1.1.0', size: 753, updated_at: '2026-09-27T10:00:00Z' },
};

const CHECK_RESULT = {
  owner: 'wangjianbo',
  repo: 'toolsdemo',
  release: { tag: 'v1.1.0' },
  tool_json: {
    display_name: 'Tools Demo',
    version: '1.1.0',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
  },
  checks: [],
  installable: true,
};

const renderTab = () => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToolCatalogTab />
    </QueryClientProvider>,
  );
};

describe('ToolCatalogTab pending updates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.state.tools = [];
    mocks.state.pending = [];
    mocks.state.failPending = false;
    mocks.state.hangTools = false;
  });

  it('shows the pending section with the version transition; hidden with nothing to confirm', async () => {
    mocks.state.tools = [EXISTING];
    mocks.state.pending = [PENDING_UPDATE];
    const first = renderTab();

    const section = await screen.findByRole('region', { name: 'com_tools_pending_title' });
    expect(section.textContent).toContain('v1.0.0');
    expect(section.textContent).toContain('v1.1.0');
    expect(screen.getByRole('button', { name: 'com_tools_pending_confirm' })).toBeEnabled();

    first.unmount();
    mocks.state.pending = [];
    renderTab();
    await screen.findByText('Tools Demo');
    expect(screen.queryByRole('region', { name: 'com_tools_pending_title' })).toBeNull();
  });

  it('confirm prefills the edit dialog with repo fields; governance stays as approved', async () => {
    mocks.state.tools = [EXISTING];
    mocks.state.pending = [PENDING_UPDATE];
    mocks.checkRepo.mockResolvedValue(CHECK_RESULT);
    renderTab();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'com_tools_pending_confirm' }));
    });
    const dialog = await screen.findByTestId('edit-dialog');
    expect(mocks.checkRepo).toHaveBeenCalledWith({
      data: { owner: 'wangjianbo', repo: 'toolsdemo' },
    });

    const merged = JSON.parse(dialog.textContent ?? '{}') as Record<string, unknown>;
    /* repo content wins */
    expect(merged.version).toBe('1.1.0');
    const parameters = merged.parameters as { properties: Record<string, unknown> };
    expect(parameters.properties.query).toBeDefined();
    expect(parameters.properties.old).toBeUndefined();
    const execution = merged.execution as { distribution: { version: string } };
    expect(execution.distribution.version).toBe('1.1.0');
    /* governance fields keep the approved values */
    expect(merged.tool_id).toBe('wangjianbo.toolsdemo');
    expect(merged.allowed_groups).toEqual(['team-editor']);
    expect(merged.enabled).toBe(true);
  });

  it('surfaces a failed repo check as an alert', async () => {
    mocks.state.tools = [EXISTING];
    mocks.state.pending = [PENDING_UPDATE];
    mocks.checkRepo.mockRejectedValue(new Error('Gitea unreachable'));
    renderTab();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'com_tools_pending_confirm' }));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Gitea unreachable');
  });

  it('shows the error inside the panel when the pending query fails', async () => {
    mocks.state.tools = [EXISTING];
    mocks.state.failPending = true;
    renderTab();

    const section = await screen.findByRole('region', { name: 'com_tools_pending_title' });
    expect(section.querySelector('[role="alert"]')).toHaveTextContent('pending boom');
  });

  it('renders a loading state while the catalog loads', () => {
    mocks.state.hangTools = true;
    renderTab();
    expect(screen.getByText('loading')).toBeInTheDocument();
  });
});
