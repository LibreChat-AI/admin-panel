import { PrincipalType } from 'librechat-data-provider';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { availableScopesOptions, toggleScopeActiveFn } from '@/server';
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
  return { useLocalize: () => localize, useScopeActions, useExpandSignal: () => undefined };
});

vi.mock('@/server', () => ({
  availableScopesOptions: { queryKey: ['availableScopes'], queryFn: vi.fn() },
  toggleScopeActiveFn: vi.fn(),
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

function wrap(children: ReactNode) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}>{children}</QueryClientProvider>);
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
    wrap(<ScopeBar scope={inactive} onBackToBase={vi.fn()} />);
    expect(screen.getByText('com_scope_inactive_hint')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_scope_activate' }));
    await waitFor(() =>
      expect(toggleScopeActiveFn).toHaveBeenCalledWith({
        data: { principalType: PrincipalType.GROUP, principalId: 'g-eng', isActive: true },
      }),
    );
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
