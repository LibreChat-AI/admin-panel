import userEvent from '@testing-library/user-event';
import { PrincipalType } from 'librechat-data-provider';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type * as t from '@/types';
import {
  createScopeFn,
  deleteScopeFn,
  searchUsersFn,
  toggleScopeActiveFn,
  allRolesQueryOptions,
  allGroupsQueryOptions,
} from '@/server';
import { expectFocusBack, openFrom, pressEscape, renderWithOpener } from '@/test/focus';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { createServerContract } from '@/test/fixtures';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { ScopeSelector } from '../ScopeSelector';

function localize(key: string, options?: Record<string, string | number>): string {
  if (!options) return key;
  const args = Object.entries(options)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  return `${key}(${args})`;
}

vi.mock('@/hooks', async () => {
  const { useDebouncedFilter } = await vi.importActual<typeof import('@/hooks/useDebouncedFilter')>(
    '@/hooks/useDebouncedFilter',
  );
  const { useConfigFeatures } =
    await vi.importActual<typeof import('@/hooks/config/contract')>('@/hooks/config/contract');
  const { useRefreshScopes } =
    await vi.importActual<typeof import('@/hooks/config/scope')>('@/hooks/config/scope');
  const { useReturnFocus } =
    await vi.importActual<typeof import('@/hooks/dialogs')>('@/hooks/dialogs');
  return {
    useLocalize: () => localize,
    useDebouncedFilter,
    useConfigFeatures,
    useRefreshScopes,
    useReturnFocus,
  };
});

const scopes: t.ConfigScope[] = [
  {
    _id: 'c-role',
    principalType: PrincipalType.ROLE,
    principalId: 'USER',
    name: 'USER',
    priority: 10,
    memberCount: 3,
    isActive: true,
    overridePaths: ['balance.startBalance'],
    tombstones: [],
  },
  {
    _id: 'c-eng',
    principalType: PrincipalType.GROUP,
    principalId: 'g-eng',
    name: 'Engineering',
    priority: 20,
    memberCount: 3,
    isActive: true,
    overridePaths: ['interface.parameters', 'interface.presets'],
    tombstones: [],
  },
  {
    _id: 'c-design',
    principalType: PrincipalType.GROUP,
    principalId: 'g-design',
    name: 'Design',
    priority: 20,
    memberCount: 1,
    isActive: false,
    overridePaths: ['interface.parameters'],
    tombstones: [],
  },
  {
    _id: 'c-bob',
    principalType: PrincipalType.USER,
    principalId: 'u-bob',
    name: 'Bob Test',
    email: 'bob@test.local',
    priority: 100,
    isActive: true,
    overridePaths: ['interface.parameters'],
    tombstones: ['balance.startBalance'],
  },
];

vi.mock('@/server', () => ({
  availableScopesOptions: {
    queryKey: ['availableScopes'],
    queryFn: () => Promise.resolve(scopes),
  },
  allRolesQueryOptions: { queryKey: ['roles', 'all'], queryFn: vi.fn() },
  allGroupsQueryOptions: { queryKey: ['groups', 'all'], queryFn: vi.fn() },
  createScopeFn: vi.fn(),
  deleteScopeFn: vi.fn(),
  searchUsersFn: vi.fn(),
  toggleScopeActiveFn: vi.fn(),
}));

const roleRows = (names: string[]): t.Role[] =>
  names.map((name) => ({
    id: name,
    name,
    description: '',
    isSystemRole: false,
    isActive: true,
    userCount: 0,
    permissions: {} as t.RolePermissions,
  }));

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(allRolesQueryOptions.queryFn!).mockResolvedValue(roleRows(['ADMIN', 'USER']));
  vi.mocked(allGroupsQueryOptions.queryFn!).mockResolvedValue([]);
});

interface RenderOptions {
  selection?: t.ScopeSelection;
  isDirty?: boolean;
  contract?: t.ConfigContract;
}

function renderSelector({
  selection = { type: 'BASE' },
  isDirty = false,
  contract = BUNDLED_CONFIG_CONTRACT,
}: RenderOptions = {}) {
  const onSelect = vi.fn();
  const onOpenChange = vi.fn();
  const onError = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  seedResolvedReads(queryClient);
  const tree = (open: boolean) => (
    <QueryClientProvider client={queryClient}>
      <ConfigContractContext.Provider value={contract}>
        <ScopeSelector
          open={open}
          onOpenChange={onOpenChange}
          currentSelection={selection}
          onSelect={onSelect}
          permissions={{ canView: true, canEdit: true, canAssign: true }}
          onError={onError}
          isDirty={isDirty}
        />
      </ConfigContractContext.Provider>
    </QueryClientProvider>
  );
  const { rerender } = render(tree(true));
  const setOpen = (open: boolean) => rerender(tree(open));
  return { onSelect, onOpenChange, onError, queryClient, setOpen };
}

/** Server-resolved reads cached before a profile change: Jane's preview, a scope catalog and the env status. */
const RESOLVED_READS: ReadonlyArray<readonly string[]> = [
  ['configPreview', 'user', 'u-jane'],
  ['configCatalog', 'group', 'g-eng'],
  ['envStatus'],
];

function seedResolvedReads(queryClient: QueryClient) {
  for (const queryKey of RESOLVED_READS) queryClient.setQueryData(queryKey, {});
}

/** Whether a profile change left every cached server-resolved read stale, so Preview reads the server again. */
function resolvedReadsStale(queryClient: QueryClient): boolean {
  return RESOLVED_READS.every(
    (queryKey) => queryClient.getQueryState(queryKey)?.isInvalidated === true,
  );
}

const row = (name: RegExp) => screen.findByRole('option', { name });

describe('ScopeSelector list', () => {
  it('shows each profile with its priority, members and override count', async () => {
    renderSelector();
    const eng = await row(/^Engineering/);
    expect(eng).toHaveTextContent('com_scope_priority(priority=20)');
    expect(eng).toHaveTextContent('com_scope_member_count(count=3)');
    expect(eng).toHaveTextContent('com_scope_override_count(count=2)');
    expect(await row(/^Bob Test/)).toHaveTextContent('bob@test.local');
    expect(screen.getByText('com_scope_base_applies')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('com_scope_search_profiles')).toBeInTheDocument();
  });

  it('marks inactive profiles and only warns about ties that change the same setting', async () => {
    renderSelector();
    expect(within(await row(/^Design/)).getByText('com_scope_inactive')).toBeInTheDocument();
    expect(within(await row(/^Engineering/)).queryByText(/com_scope_tie_short/)).toBeNull();
  });

  it('warns when active profiles with the same priority change the same setting', async () => {
    scopes[2].isActive = true;
    try {
      renderSelector();
      const eng = await row(/^Engineering/);
      expect(within(eng).getByText('com_scope_tie_short(names=Design)')).toBeInTheDocument();
    } finally {
      scopes[2].isActive = false;
    }
  });

  it('describes the fixed order instead of warning when LibreChat orders ties', async () => {
    scopes[2].isActive = true;
    try {
      renderSelector({ contract: createServerContract({ deterministicPrecedence: true }) });
      const eng = await row(/^Engineering/);
      expect(within(eng).queryByText('com_scope_tie_short(names=Design)')).toBeNull();
      expect(screen.getAllByText('com_scope_precedence_ordered').length).toBeGreaterThan(0);
      expect(screen.queryByText('com_scope_precedence')).toBeNull();
    } finally {
      scopes[2].isActive = false;
    }
  });

  it('finds a user profile by name or email', async () => {
    renderSelector();
    await row(/^Bob Test/);
    const input = screen.getByPlaceholderText('com_scope_search_profiles');
    fireEvent.change(input, { target: { value: 'bob' } });
    await waitFor(() => expect(screen.queryByRole('option', { name: /^Engineering/ })).toBeNull());
    expect(screen.getByRole('option', { name: /^Bob Test/ })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: 'bob@test' } });
    expect(await row(/^Bob Test/)).toBeInTheDocument();
  });

  it('re-selecting the open profile only closes the selector', async () => {
    const eng = scopes[1];
    const { onSelect, onOpenChange } = renderSelector({ selection: { type: 'SCOPE', scope: eng } });
    fireEvent.click(await row(/^Engineering/));
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('selecting another profile opens it', async () => {
    const { onSelect } = renderSelector();
    fireEvent.click(await row(/^Engineering/));
    expect(onSelect).toHaveBeenCalledWith({ type: 'SCOPE', scope: scopes[1] });
  });

  it('toggles a profile active without selecting it', async () => {
    vi.mocked(toggleScopeActiveFn).mockResolvedValue({ success: true });
    const { onSelect, queryClient } = renderSelector();
    await row(/^Engineering/);
    expect(resolvedReadsStale(queryClient)).toBe(false);
    const active = screen.getByRole('option', {
      name: 'com_scope_active_option(name=Engineering)',
    });
    expect(active).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(active);
    await waitFor(() =>
      expect(toggleScopeActiveFn).toHaveBeenCalledWith({
        data: { principalType: PrincipalType.GROUP, principalId: 'g-eng', isActive: false },
      }),
    );
    expect(onSelect).not.toHaveBeenCalled();
    await waitFor(() => expect(resolvedReadsStale(queryClient)).toBe(true));
  });
});

describe('ScopeSelector delete', () => {
  it('cannot delete the open profile while there are unsaved edits', async () => {
    renderSelector({ selection: { type: 'SCOPE', scope: scopes[1] }, isDirty: true });
    await row(/^Engineering/);
    const trash = screen.getByRole('option', { name: 'com_scope_delete_named(name=Engineering)' });
    expect(trash).toHaveAttribute('aria-disabled', 'true');
    expect(trash).toHaveAttribute('title', 'com_scope_delete_dirty');
    fireEvent.click(trash);
    expect(screen.queryByText(/com_scope_delete_confirm/)).toBeNull();
    expect(deleteScopeFn).not.toHaveBeenCalled();
  });

  it('deleting the open profile returns to Base', async () => {
    vi.mocked(deleteScopeFn).mockResolvedValue({ success: true });
    const { onSelect, queryClient } = renderSelector({
      selection: { type: 'SCOPE', scope: scopes[1] },
    });
    await row(/^Engineering/);
    fireEvent.click(
      screen.getByRole('option', { name: 'com_scope_delete_named(name=Engineering)' }),
    );
    expect(screen.getByText('com_scope_delete_impact(count=2)')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_scope_delete' }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ type: 'BASE' }));
    expect(deleteScopeFn).toHaveBeenCalledWith({
      data: { principalType: PrincipalType.GROUP, principalId: 'g-eng' },
    });
    expect(resolvedReadsStale(queryClient)).toBe(true);
  });

  it('offers delete for user profiles too', async () => {
    renderSelector();
    await row(/^Bob Test/);
    expect(
      screen.getByRole('option', {
        name: 'com_scope_delete_named(name=Bob Test (bob@test.local))',
      }),
    ).toBeInTheDocument();
  });
});

describe('ScopeSelector create picker', () => {
  async function openCreate() {
    fireEvent.click(await screen.findByRole('button', { name: 'com_scope_create' }));
    return screen.findByPlaceholderText('com_scope_create_search');
  }

  it('styles groups as cmdk groups and explains each empty state', async () => {
    renderSelector();
    await openCreate();
    expect(await screen.findByText('com_scope_no_groups')).toBeInTheDocument();
    expect(screen.getByText('com_scope_user_search_hint(count=2)')).toBeInTheDocument();
    const heading = screen.getByText('com_scope_groups');
    expect(heading).toHaveAttribute('cmdk-group-heading');
    expect(await screen.findByRole('option', { name: /^ADMIN/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /^USER/ })).toBeNull();
  });

  it('says when every role already has a profile', async () => {
    vi.mocked(allRolesQueryOptions.queryFn!).mockResolvedValue(roleRows(['USER']));
    renderSelector();
    await openCreate();
    expect(await screen.findByText('com_scope_all_roles_used')).toBeInTheDocument();
  });

  it('creates a role profile at the default priority and opens it', async () => {
    const created: t.ConfigScope = {
      ...scopes[0],
      _id: 'c-admin',
      principalId: 'ADMIN',
      name: 'ADMIN',
    };
    vi.mocked(createScopeFn).mockResolvedValue({ scope: created });
    const { onSelect, queryClient } = renderSelector();
    await openCreate();
    fireEvent.click(await screen.findByRole('option', { name: /^ADMIN/ }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ type: 'SCOPE', scope: created }));
    expect(createScopeFn).toHaveBeenCalledWith({
      data: { principalType: PrincipalType.ROLE, principalId: 'ADMIN', name: 'ADMIN' },
    });
    expect(resolvedReadsStale(queryClient)).toBe(true);
  });

  it('finds users by search and creates a user profile', async () => {
    vi.mocked(searchUsersFn).mockResolvedValue({
      users: [
        { id: 'u-bob', name: 'Bob Test', email: 'bob@test.local' },
        { id: 'u-alice', name: 'Alice Smith', email: 'alice@test.local' },
      ],
    });
    const created: t.ConfigScope = { ...scopes[3], _id: 'c-alice', principalId: 'u-alice' };
    vi.mocked(createScopeFn).mockResolvedValue({ scope: created });
    const { onSelect } = renderSelector();
    const input = await openCreate();
    fireEvent.change(input, { target: { value: 'ali' } });
    await waitFor(() => expect(searchUsersFn).toHaveBeenCalledWith({ data: { query: 'ali' } }));
    const alice = await screen.findByRole('option', { name: /^Alice Smith/ });
    expect(screen.queryByRole('option', { name: /^Bob Test/ })).toBeNull();
    fireEvent.click(alice);
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ type: 'SCOPE', scope: created }));
    expect(createScopeFn).toHaveBeenCalledWith({
      data: {
        principalType: PrincipalType.USER,
        principalId: 'u-alice',
        name: 'Alice Smith',
        email: 'alice@test.local',
      },
    });
  });
});

describe('ScopeSelector keyboard', () => {
  const searchInput = () => screen.getByPlaceholderText('com_scope_search_profiles');
  const createSearch = () => screen.getByPlaceholderText('com_scope_create_search');
  const highlighted = () => screen.getByRole('option', { selected: true });
  const openEngineering: t.ScopeSelection = { type: 'SCOPE', scope: scopes[1] };

  async function press(keys: string, element?: HTMLElement) {
    element?.focus();
    await userEvent.setup().keyboard(keys);
  }

  async function openCreate() {
    fireEvent.click(await screen.findByRole('button', { name: 'com_scope_create' }));
    await screen.findByRole('option', { name: /^ADMIN/ });
  }

  it('highlights the open profile, so Enter in the untouched search keeps it', async () => {
    const { onSelect, onOpenChange } = renderSelector({ selection: openEngineering });
    await row(/^Engineering/);
    await waitFor(() => expect(highlighted()).toHaveAccessibleName(/^Engineering/));
    expect(searchInput()).toHaveFocus();
    await press('{Enter}');
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('highlights the open profile again when reopened', async () => {
    const { onSelect, onOpenChange, setOpen } = renderSelector({ selection: openEngineering });
    await row(/^Engineering/);
    await waitFor(() => expect(highlighted()).toHaveAccessibleName(/^Engineering/));
    await press('{Home}', searchInput());
    expect(highlighted()).toHaveTextContent('com_scope_base_config');
    await press('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    setOpen(false);
    setOpen(true);
    await row(/^Engineering/);
    await waitFor(() => expect(highlighted()).toHaveAccessibleName(/^Engineering/));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('still selects a profile reached with the arrow keys', async () => {
    const { onSelect } = renderSelector();
    await row(/^USER/);
    await waitFor(() => expect(highlighted()).toHaveTextContent('com_scope_base_config'));
    await press('{ArrowDown}', searchInput());
    expect(highlighted()).toHaveAccessibleName(/^USER/);
    await press('{Enter}');
    expect(onSelect).toHaveBeenCalledExactlyOnceWith({ type: 'SCOPE', scope: scopes[0] });
  });

  it('opens the create view with Enter on Create, without changing the open profile', async () => {
    const { onSelect, onOpenChange } = renderSelector({ selection: openEngineering });
    await row(/^Engineering/);
    await press('{Enter}', screen.getByRole('button', { name: 'com_scope_create' }));
    expect(await screen.findByPlaceholderText('com_scope_create_search')).toHaveFocus();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('goes back with Enter on Back without creating a profile', async () => {
    const { onSelect, onOpenChange } = renderSelector({ selection: openEngineering });
    await openCreate();
    await press('{Enter}', screen.getByRole('button', { name: 'com_scope_create_back' }));
    expect(await row(/^Engineering/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText('com_scope_create_search')).toBeNull();
    expect(searchInput()).toHaveFocus();
    expect(createScopeFn).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('highlights the open profile again after going back from a create search', async () => {
    const { onSelect } = renderSelector({ selection: openEngineering });
    await openCreate();
    await userEvent.setup().type(createSearch(), 'adm');
    fireEvent.click(screen.getByRole('button', { name: 'com_scope_create_back' }));
    await row(/^Engineering/);
    await waitFor(() => expect(highlighted()).toHaveAccessibleName(/^Engineering/));
    await press('{Enter}', searchInput());
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('still creates the highlighted candidate with Enter in the create search', async () => {
    const created: t.ConfigScope = {
      ...scopes[0],
      _id: 'c-admin',
      principalId: 'ADMIN',
      name: 'ADMIN',
    };
    vi.mocked(createScopeFn).mockResolvedValue({ scope: created });
    const { onSelect } = renderSelector({ selection: openEngineering });
    await openCreate();
    await waitFor(() => expect(highlighted()).toHaveAccessibleName(/^ADMIN/));
    await press('{Enter}', createSearch());
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith({ type: 'SCOPE', scope: created }));
    expect(createScopeFn).toHaveBeenCalledTimes(1);
  });

  it('deletes exactly once with Enter on Delete', async () => {
    vi.mocked(deleteScopeFn).mockResolvedValue({ success: true });
    const { onSelect } = renderSelector();
    await row(/^Engineering/);
    fireEvent.click(
      screen.getByRole('option', { name: 'com_scope_delete_named(name=Engineering)' }),
    );
    await press('{Enter}', await screen.findByRole('button', { name: 'com_scope_delete' }));
    await waitFor(() => expect(screen.queryAllByText(/com_scope_delete_confirm/)).toHaveLength(0));
    expect(deleteScopeFn).toHaveBeenCalledExactlyOnceWith({
      data: { principalType: PrincipalType.GROUP, principalId: 'g-eng' },
    });
    expect(onSelect).not.toHaveBeenCalled();
    await waitFor(() => expect(highlighted()).toHaveTextContent('com_scope_base_config'));
  });

  it('cancels a delete reached with the keyboard and returns to its option', async () => {
    const { onSelect, onOpenChange } = renderSelector({ selection: openEngineering });
    await row(/^Engineering/);
    await waitFor(() => expect(highlighted()).toHaveAccessibleName(/^Engineering/));
    await press('{ArrowDown}{ArrowDown}', searchInput());
    expect(highlighted()).toHaveAccessibleName('com_scope_delete_named(name=Engineering)');
    await press('{Enter}');
    const cancel = await screen.findByRole('button', { name: 'com_ui_cancel' });
    expect(cancel).toHaveFocus();
    await press('{Enter}');
    expect(await row(/^Engineering/)).toBeInTheDocument();
    expect(screen.queryAllByText(/com_scope_delete_confirm/)).toHaveLength(0);
    expect(highlighted()).toHaveAccessibleName('com_scope_delete_named(name=Engineering)');
    expect(searchInput()).toHaveFocus();
    expect(deleteScopeFn).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('ScopeSelector focus', () => {
  /** The selector beside the page button that opens it, as the configuration header has it. */
  function renderFromOpener() {
    const onSelect = vi.fn();
    const opener = renderWithOpener(
      (open, close) => (
        <ScopeSelector
          open={open}
          onOpenChange={(next) => {
            if (!next) close();
          }}
          currentSelection={{ type: 'BASE' }}
          onSelect={onSelect}
          permissions={{ canView: true, canEdit: true, canAssign: true }}
        />
      ),
      (node) => (
        <ConfigContractContext.Provider value={BUNDLED_CONFIG_CONTRACT}>
          {node}
        </ConfigContractContext.Provider>
      ),
    );
    return { opener, onSelect };
  }

  it('gives focus back to the button that opened it on Escape', async () => {
    const { opener } = renderFromOpener();
    pressEscape(await openFrom(opener));
    await expectFocusBack(opener);
  });

  it('gives focus back to that button once a profile is picked', async () => {
    const { opener, onSelect } = renderFromOpener();
    await openFrom(opener);
    fireEvent.click(await row(/^Engineering/));
    expect(onSelect).toHaveBeenCalledWith({ type: 'SCOPE', scope: scopes[1] });
    await expectFocusBack(opener);
  });

  it('keeps one dialog, and the opener to return to, across the create view', async () => {
    const { opener } = renderFromOpener();
    const dialog = await openFrom(opener);
    fireEvent.click(within(dialog).getByRole('button', { name: 'com_scope_create' }));
    expect(await screen.findByPlaceholderText('com_scope_create_search')).toBeInTheDocument();
    pressEscape(screen.getByRole('dialog'));
    await expectFocusBack(opener);
  });
});
