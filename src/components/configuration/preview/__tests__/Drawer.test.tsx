import '@/locales/i18n';
import { PrincipalType } from 'librechat-data-provider';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type * as t from '@/types';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { createServerContract } from '@/test/fixtures';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { PreviewDrawer } from '../Drawer';

const RESOLVED_API = createServerContract({ resolvedApi: true });

class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
});

const userRole: t.ConfigScope = {
  principalType: PrincipalType.ROLE,
  principalId: 'USER',
  name: 'USER',
  priority: 10,
  isActive: true,
};
const engineering: t.ConfigScope = {
  principalType: PrincipalType.GROUP,
  principalId: 'g1',
  name: 'Engineering',
  priority: 20,
  isActive: false,
};
const jane: t.ScopeCandidate = {
  principalType: PrincipalType.USER,
  principalId: 'u1',
  name: 'Jane Doe',
  email: 'jane@test.local',
};

/** What LibreChat resolves for Jane: Base, her role and her (inactive) group's profile. */
const JANE_PREVIEW: t.ConfigPreview = {
  source: 'server',
  yaml: {
    interface: { customWelcome: 'Hi' },
    webSearch: {
      searchProvider: 'tavily',
      tavilyApiKey: '${TAVILY_API_KEY}',
      jinaApiKey: 'jina-should-not-show',
    },
    mcpServers: { acme: { apiKey: { source: 'admin', key: 'mcp-should-not-show' } } },
  },
  principals: [
    { principalType: PrincipalType.USER, principalId: 'u1' },
    { principalType: PrincipalType.ROLE, principalId: 'USER' },
    { principalType: PrincipalType.GROUP, principalId: 'g1' },
  ],
  layers: [
    {
      principalType: PrincipalType.ROLE,
      principalId: '__base__',
      priority: 0,
      isActive: true,
      overrides: { endpoints: { custom: [{ name: 'Ollama' }, { name: 'ollama' }] } },
      tombstones: [],
      ignored: [
        {
          segments: ['endpoints', 'custom', 'Ollama', 'apiKey'],
          reason: 'secret_rebinding',
          tombstone: false,
        },
      ],
    },
    {
      principalType: PrincipalType.ROLE,
      principalId: 'USER',
      priority: 10,
      isActive: true,
      overrides: { interface: { customWelcome: 'Welcome, team', bookmarks: false } },
      tombstones: ['webSearch.rerankerType'],
      ignored: [
        { segments: ['interface', 'bookmarks'], reason: 'interface_permission', tombstone: false },
        { segments: ['webSearch', 'rerankerType'], reason: 'base_only_path', tombstone: true },
      ],
    },
    {
      principalType: PrincipalType.GROUP,
      principalId: 'g1',
      priority: 20,
      isActive: false,
      overrides: { interface: { customWelcome: 'Welcome, engineers' } },
      tombstones: [],
      ignored: [],
    },
  ],
  resolved: {
    interface: { customWelcome: 'Welcome, team' },
    webSearch: {
      searchProvider: 'tavily',
      tavilyApiKey: '${TAVILY_API_KEY}',
      jinaApiKey: 'jina-should-not-show',
    },
    ocr: { apiKey: 'sk-should-not-show' },
    mcpServers: { acme: { apiKey: { source: 'admin', key: 'mcp-should-not-show' } } },
  },
};

function seededClient(): QueryClient {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(['availableScopes'], [userRole, engineering]);
  client.setQueryData(
    ['groups', 'all'],
    [
      {
        id: 'g1',
        name: 'Engineering',
        description: 'Product',
        memberCount: 1,
        topMembers: [],
        isActive: true,
      },
    ],
  );
  client.setQueryData(
    ['roles', 'all'],
    [
      { id: 'ADMIN', name: 'ADMIN', description: '' },
      { id: 'USER', name: 'USER', description: '' },
    ],
  );
  client.setQueryData(['configPreview', 'user', 'u1'], { ok: true, preview: JANE_PREVIEW });
  client.setQueryData(['configPreview', 'user', 'u2'], { ok: false, status: 403 });
  client.setQueryData(['configPreview', 'group', 'g1'], {
    ok: true,
    preview: { ...JANE_PREVIEW, principals: undefined, layers: JANE_PREVIEW.layers.slice(0, 1) },
  });
  return client;
}

function renderDrawer(
  initialTarget: t.PreviewTarget,
  contract: t.ConfigContract = RESOLVED_API,
  client: QueryClient = seededClient(),
) {
  return render(
    <QueryClientProvider client={client}>
      <ConfigContractContext.Provider value={contract}>
        <PreviewDrawer open onClose={() => undefined} initialTarget={initialTarget} />
      </ConfigContractContext.Provider>
    </QueryClientProvider>,
  );
}

function previewText(): string {
  return document.querySelector('[data-config-preview]')?.textContent ?? '';
}

describe('PreviewDrawer on a server that resolves configs (resolvedApi)', () => {
  it("shows what a user's requests resolve to, layer by layer, and what each leaves out", () => {
    renderDrawer({ type: 'PRINCIPAL', principal: jane });
    const dialog = screen.getByRole('dialog', { name: 'Preview configuration' });
    expect(within(dialog).getByText('User: Jane Doe (jane@test.local)')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Their role and groups: Role: USER, Group: Engineering.'),
    ).toBeInTheDocument();
    const layers = within(dialog).getByRole('region', { name: 'Applied in this order' });
    expect(within(layers).getByText('librechat.yaml')).toBeInTheDocument();
    expect(within(layers).getByText('Base')).toBeInTheDocument();
    expect(within(layers).getByText('Role: USER')).toBeInTheDocument();
    expect(within(layers).getByText('Group: Engineering')).toBeInTheDocument();
    expect(within(layers).getByText('Inactive: not applied')).toBeInTheDocument();
    expect(within(layers).getByText('2 settings')).toBeInTheDocument();
    expect(
      within(layers).getByText('Priority 10 · 2 settings · 1 value hidden'),
    ).toBeInTheDocument();
    expect(within(layers).getByText('endpoints › custom › Ollama › apiKey')).toBeInTheDocument();
    expect(
      within(layers).getByText(
        'This credential was entered for another destination, so LibreChat drops it instead of sending it here.',
      ),
    ).toBeInTheDocument();
    expect(
      within(layers).getByText(
        "This interface setting is a role permission, so overrides don't set it.",
      ),
    ).toBeInTheDocument();
    expect(within(layers).getByText('webSearch › rerankerType (hidden value)')).toBeInTheDocument();
    expect(within(dialog).queryByText(/Worked out by the admin panel/)).not.toBeInTheDocument();
  });

  it('shows the result in librechat.yaml form, a section at a time, keeping references and masking keys', () => {
    renderDrawer({ type: 'PRINCIPAL', principal: jane });
    expect(screen.getByText('2 sections differ from librechat.yaml.')).toBeInTheDocument();
    expect(previewText()).toContain('customWelcome: Welcome, team');
    expect(previewText()).toContain('tavilyApiKey: ${TAVILY_API_KEY}');
    expect(previewText()).not.toMatch(/should-not-show/);
    expect(previewText()).toContain('source: admin');
    const select = screen.getByLabelText('Section');
    expect(within(select).getByRole('option', { name: 'Interface (changed)' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Web search' })).toBeInTheDocument();
    fireEvent.change(select, { target: { value: 'interface' } });
    expect(previewText()).toBe('interface:\n  customWelcome: Welcome, team');
  });

  it('shows a key each user enters as written, where LibreChat keeps it readable, and masks a stored one', () => {
    const client = seededClient();
    client.setQueryData(['configPreview', 'role', 'USER'], {
      ok: true,
      preview: {
        ...JANE_PREVIEW,
        principals: undefined,
        resolved: {
          endpoints: {
            custom: [
              { name: 'groq', apiKey: 'user_provided' },
              { name: 'shared', apiKey: 'sk-should-not-show' },
            ],
            azureOpenAI: { groups: [{ group: 'eastus', apiKey: 'user_provided' }] },
          },
          mcpServers: { acme: { apiKey: { source: 'user', key: '{{ACME_KEY}}' } } },
        },
      },
    });
    renderDrawer(
      {
        type: 'PRINCIPAL',
        principal: { principalType: PrincipalType.ROLE, principalId: 'USER', name: 'USER' },
      },
      RESOLVED_API,
      client,
    );
    expect(previewText()).toContain('- name: groq\n      apiKey: user_provided');
    expect(previewText()).toContain('- group: eastus\n        apiKey: user_provided');
    expect(previewText()).toContain("key: '{{ACME_KEY}}'");
    expect(previewText()).toContain('- name: shared\n      apiKey: ••••••••');
    expect(previewText()).not.toMatch(/should-not-show/);
  });

  it('previews any role, group or user, and marks those with a profile', () => {
    renderDrawer({ type: 'PRINCIPAL', principal: jane });
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const picker = screen.getByRole('listbox');
    expect(within(picker).getByText('ADMIN')).toBeInTheDocument();
    expect(within(picker).getByText('USER')).toBeInTheDocument();
    expect(within(picker).getAllByText('Has a profile')).toHaveLength(2);
    expect(
      within(picker).getByText('Type at least 2 characters to find a user.'),
    ).toBeInTheDocument();
    fireEvent.click(within(picker).getByText('Engineering'));
    expect(screen.getByText('Group: Engineering', { selector: 'span' })).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/Their role and groups/)).not.toBeInTheDocument();
  });

  it('puts focus in the picker search on Change, and back on Change once the picker closes', () => {
    renderDrawer({ type: 'PRINCIPAL', principal: jane });
    const change = screen.getByRole('button', { name: 'Change' });
    change.focus();
    fireEvent.click(change);
    expect(screen.getByRole('combobox')).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Change' })).toHaveFocus();
  });

  describe('Azure groups and Vertex AI before and after LibreChat derives them', () => {
    const groups = ['endpoints', 'azureOpenAI', 'groups'];
    const userLayer = (ignored: t.PreviewIgnored[]): t.PreviewLayer => ({
      principalType: PrincipalType.ROLE,
      principalId: 'USER',
      priority: 10,
      isActive: true,
      overrides: {
        endpoints: {
          azureOpenAI: { groups: [{ group: 'eastus', version: 'v2' }] },
          anthropic: { vertex: { enabled: false } },
        },
      },
      tombstones: ['endpoints.azureOpenAI.groups["sweden"].instanceName'],
      ignored,
    });
    const clientWith = (layer: t.PreviewLayer): QueryClient => {
      const client = seededClient();
      client.setQueryData(['configPreview', 'role', 'USER'], {
        ok: true,
        preview: { ...JANE_PREVIEW, principals: undefined, layers: [layer] },
      });
      return client;
    };
    const roleTarget: t.PreviewTarget = {
      type: 'PRINCIPAL',
      principal: { principalType: PrincipalType.ROLE, principalId: 'USER', name: 'USER' },
    };
    const unapplied =
      "Azure groups and Vertex AI read here as the admin overrides merge them, but LibreChat applies neither until its operator sets CONFIG_REDERIVE_ENDPOINTS: members get librechat.yaml's.";

    it('says the groups a profile stores apply once the operator sets CONFIG_REDERIVE_ENDPOINTS', () => {
      const layer = userLayer([
        { segments: groups, reason: 'endpoint_rederive_off', tombstone: false },
        {
          segments: [...groups, 'sweden', 'instanceName'],
          reason: 'endpoint_rederive_off',
          tombstone: true,
        },
      ]);
      renderDrawer(
        roleTarget,
        createServerContract({ resolvedApi: true, azureGroupMergeKey: true }),
        clientWith(layer),
      );
      const layers = screen.getByRole('region', { name: 'Applied in this order' });
      const reasons = layers.querySelectorAll('[data-ignored-reason="endpoint_rederive_off"]');
      expect(reasons).toHaveLength(2);
      expect(reasons[0]).toHaveTextContent(
        "Stored, but LibreChat doesn't apply Azure group overrides until its operator sets CONFIG_REDERIVE_ENDPOINTS: the Azure clients read librechat.yaml's groups.",
      );
      expect(screen.getByText(unapplied)).toBeInTheDocument();
    });

    it('says a hide inside a group drops that group alone, with no note once LibreChat derives them', () => {
      const layer = userLayer([
        {
          segments: [...groups, 'sweden', 'instanceName'],
          reason: 'azure_groups_unresolved',
          tombstone: true,
        },
        { segments: groups, reason: 'azure_groups_unresolved', tombstone: false },
      ]);
      renderDrawer(
        roleTarget,
        createServerContract({
          resolvedApi: true,
          azureGroupMergeKey: true,
          endpointRederive: true,
        }),
        clientWith(layer),
      );
      const reasons = screen
        .getByRole('region', { name: 'Applied in this order' })
        .querySelectorAll('[data-ignored-reason="azure_groups_unresolved"]');
      expect(reasons[0]).toHaveTextContent(
        'Hiding this leaves the Azure group without what it needs to resolve, so LibreChat serves no such group. The other groups are served.',
      );
      expect(reasons[1]).toHaveTextContent(/These Azure groups don't resolve/);
      expect(screen.queryByText(unapplied)).not.toBeInTheDocument();
    });

    it('adds no note on a server that leaves the merge key out', () => {
      renderDrawer(roleTarget, RESOLVED_API, clientWith(userLayer([])));
      expect(screen.queryByText(unapplied)).not.toBeInTheDocument();
    });
  });

  it('says why the server refused a preview', () => {
    renderDrawer({
      type: 'PRINCIPAL',
      principal: { ...jane, principalId: 'u2', name: 'Locked', email: undefined },
    });
    expect(
      screen.getByText('Previewing a user also needs permission to read users and groups.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe.each([
  ['without a meta route', BUNDLED_CONFIG_CONTRACT],
  ['whose meta leaves resolvedApi out', createServerContract({})],
])('PreviewDrawer on an older server (%s)', (_label, contract) => {
  function estimateClient(): QueryClient {
    const client = seededClient();
    const base: t.BaseConfigData = {
      config: { interface: { customWelcome: 'Base hi' } },
      yamlConfig: { interface: { customWelcome: 'YAML hi' } },
      yamlPaths: [],
      dbOverrides: { interface: { customWelcome: 'Base hi' } },
      dbTombstones: [],
      schemaDefaults: {},
    };
    client.setQueryData(['baseConfig'], base);
    client.setQueryData(['resolvedConfig', 'role', 'USER'], {
      resolvedConfig: {},
      changedPaths: [],
      overrides: { interface: { customWelcome: 'Role hi' } },
      tombstones: [],
    });
    return client;
  }

  it("estimates a profile's config from Base and its own overrides, and says what that leaves out", () => {
    renderDrawer(
      { type: 'PRINCIPAL', principal: { ...userRole, principalType: PrincipalType.ROLE } },
      contract,
      estimateClient(),
    );
    expect(screen.getByText(/Worked out by the admin panel/)).toBeInTheDocument();
    expect(previewText()).toBe('interface:\n  customWelcome: Role hi');
    const layers = screen.getByRole('region', { name: 'Applied in this order' });
    expect(within(layers).getByText('Base')).toBeInTheDocument();
    expect(within(layers).getByText('Role: USER')).toBeInTheDocument();
    expect(screen.queryByText(/not applied as written/)).not.toBeInTheDocument();
  });

  it('offers only principals with a profile, and notes a user preview leaves out their role and groups', () => {
    const client = estimateClient();
    client.setQueryData(
      ['availableScopes'],
      [userRole, { ...jane, priority: 100, isActive: true }],
    );
    client.setQueryData(['resolvedConfig', 'user', 'u1'], {
      resolvedConfig: {},
      changedPaths: [],
      overrides: {},
      tombstones: [],
    });
    renderDrawer({ type: 'BASE' }, contract, client);
    expect(previewText()).toBe('interface:\n  customWelcome: Base hi');
    fireEvent.click(screen.getByRole('button', { name: 'Change' }));
    const picker = screen.getByRole('listbox');
    expect(within(picker).queryByText('ADMIN')).not.toBeInTheDocument();
    expect(within(picker).getByText('USER')).toBeInTheDocument();
    fireEvent.click(within(picker).getByText('Jane Doe'));
    expect(
      screen.getByText(
        "Only the user's own profile is included, not the profiles of their role and groups.",
      ),
    ).toBeInTheDocument();
  });
});
