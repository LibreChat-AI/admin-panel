import { PrincipalType } from 'librechat-data-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { setScopePriorityFn, toggleScopeActiveFn, availableScopesOptions } from '@/server';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { createServerContract } from '@/test/fixtures';
import { ScopeActionsProvider } from '@/contexts/ScopeContext';
import { ScopeGate } from '../ScopeGate';
import { ScopeBar } from '../ScopeBar';

function localize(key: string, options?: Record<string, string | number>): string {
  if (!options) return key;
  const args = Object.entries(options)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${key}(${args})`;
}

vi.mock('@/hooks', async () => {
  const { useScopeActions } =
    await vi.importActual<typeof import('@/hooks/config/scope')>('@/hooks/config/scope');
  const { useReturnFocus } =
    await vi.importActual<typeof import('@/hooks/dialogs')>('@/hooks/dialogs');
  const { useConfigFeatures } =
    await vi.importActual<typeof import('@/hooks/config/contract')>('@/hooks/config/contract');
  const { useRefreshScopes } =
    await vi.importActual<typeof import('@/hooks/config/scope')>('@/hooks/config/scope');
  return {
    useLocalize: () => localize,
    useScopeActions,
    useRefreshScopes,
    useReturnFocus,
    useConfigFeatures,
    useExpandSignal: () => undefined,
  };
});

vi.mock('@/server', () => ({
  availableScopesOptions: { queryKey: ['availableScopes'], queryFn: vi.fn() },
  toggleScopeActiveFn: vi.fn(),
  setScopePriorityFn: vi.fn(),
}));

const engineering: t.ConfigScope = {
  _id: 'c-eng',
  principalType: PrincipalType.GROUP,
  principalId: 'g-eng',
  name: 'Engineering',
  priority: 20,
  memberCount: 3,
  isActive: true,
  overridePaths: ['interface.parameters', 'mcpServers.docs.url', 'mcpServers.docs.type'],
  tombstones: ['balance.startBalance'],
};
const design: t.ConfigScope = {
  ...engineering,
  _id: 'c-design',
  principalId: 'g-design',
  name: 'Design',
  memberCount: 1,
  overridePaths: ['interface'],
  tombstones: [],
};

/** A preview and a scope catalog cached before a profile change. */
const PREVIEW_KEY = ['configPreview', 'group', 'g-eng'];
const CATALOG_KEY = ['configCatalog', 'group', 'g-eng'];

function wrap(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  queryClient.setQueryData(PREVIEW_KEY, { ok: true });
  queryClient.setQueryData(CATALOG_KEY, {});
  const rendered = render(
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
  );
  return { ...rendered, queryClient };
}

/** Whether the cached preview and catalog are stale, so the next read asks the server again. */
function resolvedReadsStale(queryClient: QueryClient): boolean {
  return [PREVIEW_KEY, CATALOG_KEY].every(
    (queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated === true,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ScopeBar', () => {
  it('names the profile and shows priority, members and override count', async () => {
    vi.mocked(availableScopesOptions.queryFn!).mockResolvedValue([engineering]);
    wrap(<ScopeBar scope={engineering} onBackToBase={vi.fn()} />);
    const bar = screen.getByRole('region', { name: 'com_scope_bar_label' });
    expect(bar).toHaveTextContent(
      'com_scope_bar_editing com_scope_bar_name(type=com_scope_type_group,name=Engineering)',
    );
    expect(bar).toHaveTextContent('com_scope_priority(priority=20)');
    expect(bar).toHaveTextContent('com_scope_member_count(count=3)');
    expect(bar).toHaveTextContent('com_scope_override_count(count=3)');
  });

  it('warns about a same-priority profile that changes the same setting', async () => {
    vi.mocked(availableScopesOptions.queryFn!).mockResolvedValue([engineering, design]);
    wrap(<ScopeBar scope={engineering} onBackToBase={vi.fn()} />);
    expect(
      await screen.findByText(
        'com_scope_tie_conflict(names=Design (com_scope_type_group),count=1)',
      ),
    ).toBeInTheDocument();
  });

  it('shows an inactive profile with a way to activate it', async () => {
    const inactive = { ...engineering, isActive: false };
    vi.mocked(availableScopesOptions.queryFn!).mockResolvedValue([inactive]);
    vi.mocked(toggleScopeActiveFn).mockResolvedValue({ success: true });
    const { queryClient } = wrap(<ScopeBar scope={inactive} onBackToBase={vi.fn()} />);
    expect(screen.getByText('com_scope_inactive_hint')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_scope_activate' }));
    await waitFor(() =>
      expect(toggleScopeActiveFn).toHaveBeenCalledWith({
        data: { principalType: PrincipalType.GROUP, principalId: 'g-eng', isActive: true },
      }),
    );
    await waitFor(() => expect(resolvedReadsStale(queryClient)).toBe(true));
  });

  it('says when the open profile was deleted and still offers the way back', async () => {
    vi.mocked(availableScopesOptions.queryFn!).mockResolvedValue([design]);
    const onBackToBase = vi.fn();
    wrap(<ScopeBar scope={engineering} onBackToBase={onBackToBase} />);
    expect(await screen.findByText('com_scope_deleted')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_scope_back_to_base' }));
    expect(onBackToBase).toHaveBeenCalled();
  });
});

describe('ScopeBar on a server with deterministic precedence and a priority route', () => {
  const contract = createServerContract({ deterministicPrecedence: true, priorityRoute: true });
  const ordered = (children: ReactNode) =>
    wrap(
      <ConfigContractContext.Provider value={contract}>{children}</ConfigContractContext.Provider>,
    );
  const older = { ...engineering, _id: '6a00' };
  const newer = { ...design, _id: '6a01' };

  it('says which of two same-priority profiles wins instead of warning', async () => {
    vi.mocked(availableScopesOptions.queryFn!).mockResolvedValue([older, newer]);
    ordered(<ScopeBar scope={older} onBackToBase={vi.fn()} />);
    expect(
      await screen.findByText(
        'com_scope_tie_order_loses(names=Design (com_scope_type_group),count=1)',
      ),
    ).toHaveAttribute('title', 'com_scope_tie_order_rule');
    expect(screen.queryByText(/com_scope_tie_conflict/)).not.toBeInTheDocument();
  });

  it('says this profile wins over one that applies before it', async () => {
    vi.mocked(availableScopesOptions.queryFn!).mockResolvedValue([older, newer]);
    ordered(<ScopeBar scope={newer} onBackToBase={vi.fn()} />);
    expect(
      await screen.findByText(
        'com_scope_tie_order_wins(names=Engineering (com_scope_type_group),count=1)',
      ),
    ).toBeInTheDocument();
  });

  it('offers Change only to an admin who may set priorities', async () => {
    vi.mocked(availableScopesOptions.queryFn!).mockResolvedValue([engineering]);
    const { unmount } = ordered(<ScopeBar scope={engineering} onBackToBase={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'com_scope_priority_change_label' })).toBeNull();
    unmount();
    wrap(<ScopeBar scope={engineering} onBackToBase={vi.fn()} canEditPriority />);
    expect(screen.queryByRole('button', { name: 'com_scope_priority_change_label' })).toBeNull();
  });

  it('changes the priority, refusing one that is not a whole number of 0 or more', async () => {
    vi.mocked(availableScopesOptions.queryFn!).mockResolvedValue([engineering]);
    vi.mocked(setScopePriorityFn).mockResolvedValue({ priority: 5 });
    const { queryClient } = ordered(
      <ScopeBar scope={engineering} onBackToBase={vi.fn()} canEditPriority />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_scope_priority_change_label' }));
    const input = screen.getByRole('spinbutton');
    expect(input).toHaveValue(20);
    fireEvent.change(input, { target: { value: '2.5' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByRole('alert')).toHaveTextContent('com_scope_priority_invalid');
    expect(setScopePriorityFn).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'com_ui_save' }));
    await waitFor(() =>
      expect(setScopePriorityFn).toHaveBeenCalledWith({
        data: { principalType: PrincipalType.GROUP, principalId: 'g-eng', priority: 5 },
      }),
    );
    await waitFor(() => expect(screen.queryByRole('spinbutton')).toBeNull());
    expect(resolvedReadsStale(queryClient)).toBe(true);
  });

  it('reports a refused change and keeps the field open', async () => {
    vi.mocked(availableScopesOptions.queryFn!).mockResolvedValue([engineering]);
    vi.mocked(setScopePriorityFn).mockRejectedValue(new Error('Config not found'));
    const onError = vi.fn();
    ordered(
      <ScopeBar scope={engineering} onBackToBase={vi.fn()} onError={onError} canEditPriority />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_scope_priority_change_label' }));
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '30' } });
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' });
    await waitFor(() => expect(onError).toHaveBeenCalledWith('Config not found'));
    expect(screen.getByRole('spinbutton')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Escape' });
    expect(screen.queryByRole('spinbutton')).toBeNull();
  });
});

describe('ScopeGate', () => {
  it('explains why the section is not per profile and switches to Base', () => {
    vi.mocked(availableScopesOptions.queryFn!).mockResolvedValue([engineering]);
    const selectScope = vi.fn();
    wrap(
      <ScopeActionsProvider value={{ selectScope, editingScope: engineering }}>
        <ScopeGate reason="preAuth" title="Registration" section="registration" />
      </ScopeActionsProvider>,
    );
    expect(screen.getByRole('note')).toHaveTextContent(
      'com_scope_gate_title(section=Registration)com_scope_gate_pre_auth',
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_config_shell_edit_in_base' }));
    expect(selectScope).toHaveBeenCalledWith({ type: 'BASE' });
  });

  it('points out values the profile still stores in the gated section', async () => {
    const stale = { ...engineering, overridePaths: ['registration.socialLogins'] };
    vi.mocked(availableScopesOptions.queryFn!).mockResolvedValue([stale]);
    wrap(
      <ScopeActionsProvider value={{ selectScope: vi.fn(), editingScope: engineering }}>
        <ScopeGate reason="preAuth" title="Registration" section="registration" />
      </ScopeActionsProvider>,
    );
    expect(await screen.findByText('com_scope_gate_ignored(count=1)')).toBeInTheDocument();
  });
});
