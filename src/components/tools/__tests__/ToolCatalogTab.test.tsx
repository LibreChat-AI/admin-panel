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
  InlineAction: ({ label, onClick }: { label: string; onClick?: () => void }) => (
    <button aria-label={label} onClick={onClick} />
  ),
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
  dangerous: true,
  parameters: { type: 'object', properties: { old: { type: 'string' } } },
  result: { renderer: 'table', config: { columns: ['a'] } },
  execution: {
    kind: 'desktop',
    distribution: {
      source: { type: 'gitea_release', owner: 'wangjianbo', repo: 'toolsdemo' },
      version: '1.0.0',
      package_sha256: 'a'.repeat(64),
      launcher: 'main.py',
      runtime: 'self-contained',
    },
  },
};

const PENDING_UPDATE: Record<string, unknown> = {
  tool_id: 'wangjianbo.toolsdemo',
  display_name: 'Tools Demo',
  owner: 'wangjianbo',
  repo: 'toolsdemo',
  current_version: '1.0.0',
  package: { version: '1.0.1', size: 753, updated_at: '2026-09-28T08:52:55Z' },
};

/* 2026-09-28：gateway 将显式版本与 tag 不一致升为硬项 error（Toolhost 安装侧
 * 同样硬校验 version == tag）—— 确认流程必须挡住，不能等安装时才失败 */
const MISMATCH_ERROR = {
  key: 'version_mismatch',
  level: 'error',
  message: 'tool.json version 1.0.0 != release tag v1.0.1',
} as const;

const CHECK_RESULT = {
  owner: 'wangjianbo',
  repo: 'toolsdemo',
  release: { tag: 'v1.0.1' },
  tool_json: {
    display_name: 'Tools Demo',
    version: '1.0.1',
    parameters: { type: 'object', properties: { query: { type: 'string' } } },
  },
  checks: [
    { key: 'launcher_missing', level: 'warn', message: 'launcher not defined in tool.json' },
  ],
  installable: true,
};

/* tool.json 只有版本号，其余全缺 —— 确认时已批准值必须保留 */
const CHECK_RESULT_SPARSE = {
  owner: 'wangjianbo',
  repo: 'toolsdemo',
  release: { tag: 'v1.0.1' },
  tool_json: { version: '1.0.1' },
  checks: [],
  installable: false,
};

const CHECK_RESULT_ERROR = {
  owner: 'wangjianbo',
  repo: 'toolsdemo',
  release: { tag: 'v1.0.1' },
  checks: [
    { key: 'zip_asset_count', level: 'error', message: 'expected exactly 1 zip asset, found 2' },
  ],
  installable: false,
};

/* tag 与 tool.json 版本不一致（用户场景 2026-09-28：tag v1.0.1 指向 tool.json
 * 仍是 1.0.0 的 commit）—— Toolhost 会拒装，确认必须在此挡住 */
const CHECK_RESULT_MISMATCH = {
  owner: 'wangjianbo',
  repo: 'toolsdemo',
  release: { tag: 'v1.0.1' },
  tool_json: { version: '1.0.0' },
  checks: [MISMATCH_ERROR],
  installable: false,
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
    expect(section.textContent).toContain('v1.0.1');
    expect(screen.getByRole('button', { name: 'com_tools_pending_confirm' })).toBeEnabled();

    first.unmount();
    mocks.state.pending = [];
    renderTab();
    await screen.findByText('Tools Demo');
    expect(screen.queryByRole('region', { name: 'com_tools_pending_title' })).toBeNull();
  });

  it('confirm merges repo fields at the pending target version and shows check warns', async () => {
    /* 2026-09-28 regression: the confirmed version is the pending target (tag,
     * the distribution identity) and repo-provided params win; soft warns stay
     * visible in the pending panel without blocking. */
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
    expect(await screen.findByText(/launcher_missing/)).toBeInTheDocument();

    const merged = JSON.parse(dialog.textContent ?? '{}') as Record<string, unknown>;
    expect(merged.version).toBe('1.0.1');
    /* repo-provided params win */
    const parameters = merged.parameters as { properties: Record<string, unknown> };
    expect(parameters.properties.query).toBeDefined();
    expect(parameters.properties.old).toBeUndefined();
    const execution = merged.execution as { distribution: { version: string } };
    expect(execution.distribution.version).toBe('1.0.1');
    /* governance fields keep the approved values */
    expect(merged.tool_id).toBe('wangjianbo.toolsdemo');
    expect(merged.allowed_groups).toEqual(['team-editor']);
    expect(merged.enabled).toBe(true);
  });

  it('confirm blocks when tool.json@tag version mismatches the release tag', async () => {
    /* Toolhost refuses to install a package whose declared version differs
     * from the tag — approving it would dead-end at install time. */
    mocks.state.tools = [EXISTING];
    mocks.state.pending = [PENDING_UPDATE];
    mocks.checkRepo.mockResolvedValue(CHECK_RESULT_MISMATCH);
    renderTab();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'com_tools_pending_confirm' }));
    });
    expect(await screen.findByText(/version_mismatch/)).toBeInTheDocument();
    expect(screen.queryByTestId('edit-dialog')).toBeNull();
  });

  it('confirm keeps approved values for everything the repo does not provide', async () => {
    mocks.state.tools = [EXISTING];
    mocks.state.pending = [PENDING_UPDATE];
    mocks.checkRepo.mockResolvedValue(CHECK_RESULT_SPARSE);
    renderTab();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'com_tools_pending_confirm' }));
    });
    const merged = JSON.parse(
      (await screen.findByTestId('edit-dialog')).textContent ?? '{}',
    ) as Record<string, unknown>;

    expect(merged.version).toBe('1.0.1');
    expect(merged.display_name).toBe('Tools Demo');
    expect(merged.description).toBe('approved description');
    expect(merged.dangerous).toBe(true);
    const parameters = merged.parameters as { properties: Record<string, unknown> };
    expect(parameters.properties.old).toBeDefined();
    expect(merged.result).toEqual({ renderer: 'table', config: { columns: ['a'] } });
    const distribution = (merged.execution as { distribution: Record<string, string> })
      .distribution;
    expect(distribution.package_sha256).toBe('a'.repeat(64));
    expect(distribution.launcher).toBe('main.py');
    expect(distribution.runtime).toBe('self-contained');
  });

  it('confirm does not open the dialog when the repo check has hard errors', async () => {
    mocks.state.tools = [EXISTING];
    mocks.state.pending = [PENDING_UPDATE];
    mocks.checkRepo.mockResolvedValue(CHECK_RESULT_ERROR);
    renderTab();

    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'com_tools_pending_confirm' }));
    });
    expect(await screen.findByText(/zip_asset_count/)).toBeInTheDocument();
    expect(screen.queryByTestId('edit-dialog')).toBeNull();
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
