import '@/locales/i18n';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PrincipalType, configSchema } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type * as t from '@/types';
import { collectFieldPaths } from '@/components/configuration/counts';
import { extractSchemaTree, parseConfigYaml } from '@/server/config';
import { ImportYamlDialog } from '../ImportYamlDialog';
import { parseImportedYaml } from '@/server';

const userScope: t.ConfigScope = {
  _id: 'cfg-user',
  principalType: PrincipalType.ROLE,
  principalId: 'USER',
  name: 'USER',
  priority: 10,
  isActive: true,
};

vi.mock('@/server', () => ({
  parseImportedYaml: vi.fn(),
  createRoleFn: vi.fn(),
  createGroupFn: vi.fn(),
  createScopeFn: vi.fn(),
  searchUsersFn: vi.fn().mockResolvedValue({ users: [] }),
  getResolvedConfigFn: vi.fn().mockResolvedValue({
    resolvedConfig: { 'balance.startBalance': 5 },
    changedPaths: ['balance.startBalance'],
    overrides: { balance: { startBalance: 5 } },
    tombstones: [],
  }),
  baseConfigOptions: {
    queryKey: ['baseConfig'],
    queryFn: () =>
      Promise.resolve({
        config: { balance: { enabled: true, startBalance: 1000000 } },
        dbOverrides: {},
        yamlConfig: { balance: { enabled: true, startBalance: 1000000 } },
        yamlPaths: ['balance.enabled', 'balance.startBalance'],
        dbTombstones: [],
        schemaDefaults: {},
      }),
  },
  availableScopesOptions: {
    queryKey: ['availableScopes'],
    queryFn: () =>
      Promise.resolve([
        {
          _id: 'cfg-user',
          principalType: 'role',
          principalId: 'USER',
          name: 'USER',
          priority: 10,
          isActive: true,
        },
      ]),
  },
  allRolesQueryOptions: {
    queryKey: ['roles', 'all'],
    queryFn: () =>
      Promise.resolve([
        { id: 'ADMIN', name: 'ADMIN' },
        { id: 'USER', name: 'USER' },
      ]),
  },
  allGroupsQueryOptions: { queryKey: ['groups', 'all'], queryFn: () => Promise.resolve([]) },
}));

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const schemaPathSet = new Set(collectFieldPaths(tree));
const mockParse = vi.mocked(parseImportedYaml);
const parsed = {
  balance: { startBalance: 777, enabled: true },
  interface: { prompts: false },
  endpoints: { bedrock: { inferenceProfiles: { 'us.anthropic.claude': 'arn:x' } } },
};

function renderDialog(currentScope?: t.ConfigScope) {
  const onImport = vi.fn<t.ImportYamlDialogProps['onImport']>().mockResolvedValue(undefined);
  const onClose = vi.fn();
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ImportYamlDialog
        open
        onClose={onClose}
        currentScope={currentScope}
        schemaTree={tree}
        schemaPathSet={schemaPathSet}
        onImport={onImport}
      />
    </QueryClientProvider>,
  );
  return { onImport, onClose };
}

async function toTargets(text = 'balance:\n  startBalance: 777\n') {
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Paste YAML' }), { key: 'Enter' });
  fireEvent.change(await screen.findByRole('textbox', { name: 'Paste YAML' }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  await screen.findByText('Where should these settings go?');
}

async function toPreview() {
  fireEvent.click(screen.getByRole('button', { name: 'Preview changes' }));
  await screen.findByText(/selected for/);
}

describe('ImportYamlDialog wizard', () => {
  beforeEach(() => {
    mockParse.mockResolvedValue({
      success: true,
      appConfig: parsed,
      unknownPaths: [],
      unknownEnumValues: [],
    });
  });

  it('previews exactly the snippet keys against Base and imports the selected ones', async () => {
    const { onImport, onClose } = renderDialog();
    await toTargets();
    expect(screen.getByRole('radio', { name: /^Base configuration/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await toPreview();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Starting credits')).toBeInTheDocument();
    expect(within(dialog).getByText('1,000,000 (librechat.yaml)')).toBeInTheDocument();
    expect(within(dialog).queryByText('Enabled')).toBeNull();
    fireEvent.click(
      within(dialog).getByRole('button', { name: /Show 1 setting that is already set/ }),
    );
    expect(within(dialog).getByText(/Already set to this value/)).toBeInTheDocument();
    expect(
      within(dialog).getByRole('checkbox', { name: 'Include Track balances' }),
    ).not.toBeChecked();
    expect(within(dialog).getByText(/2 keys won't be imported/)).toBeInTheDocument();
    expect(within(dialog).getByText(/managed with role permissions/)).toBeInTheDocument();
    expect(within(dialog).getByText(/"us.anthropic.claude"/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Import 1 setting into Base/ }));
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith({
        target: { type: 'base' },
        entries: [{ fieldPath: 'balance.startBalance', value: 777 }],
      }),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("puts focus on the target step's first control once Continue has checked the YAML", async () => {
    renderDialog();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Paste YAML' }), { key: 'Enter' });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Paste YAML' }), {
      target: { value: 'balance:\n  startBalance: 777\n' },
    });
    /**
     * A browser drops focus from Continue once it is disabled while checking
     * the YAML; jsdom keeps it there, so the click starts with focus on <body>.
     */
    const next = screen.getByRole('button', { name: 'Continue' });
    next.focus();
    next.blur();
    fireEvent.click(next);
    await screen.findByText('Where should these settings go?');
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /^Base configuration/ })).toHaveFocus(),
    );
  });

  it('preselects the open profile and compares with its own values', async () => {
    const { onImport } = renderDialog(userScope);
    await toTargets();
    expect(screen.getByRole('radio', { name: /This profile \(USER\)/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await toPreview();
    expect(await screen.findByText('5')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Import 1 setting into Role: USER/ }));
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith(
        expect.objectContaining({ target: { type: 'scope', scope: userScope, exists: true } }),
      ),
    );
  });

  it('writes to Base when Base is chosen while a profile is open', async () => {
    const { onImport } = renderDialog(userScope);
    await toTargets();
    fireEvent.click(screen.getByRole('radio', { name: /^Base configuration/ }));
    await toPreview();
    fireEvent.click(screen.getByRole('button', { name: /^Import 1 setting into Base/ }));
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith(expect.objectContaining({ target: { type: 'base' } })),
    );
  });

  it('offers every role, including ones without a profile', async () => {
    const { onImport } = renderDialog();
    await toTargets();
    fireEvent.click(screen.getByRole('radio', { name: /^A role, group or user/ }));
    const admin = await screen.findByRole('radio', { name: /ADMIN.*No profile yet/ });
    expect(screen.getByRole('radio', { name: /USER.*Has a profile/ })).toBeInTheDocument();
    fireEvent.click(admin);
    expect(
      screen.getByText(/A profile will be created for ADMIN \(priority 10\)/),
    ).toBeInTheDocument();
    await toPreview();
    fireEvent.click(screen.getByRole('button', { name: /^Import 1 setting into Role: ADMIN/ }));
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith(
        expect.objectContaining({
          target: {
            type: 'scope',
            exists: false,
            scope: expect.objectContaining({ principalId: 'ADMIN', priority: 10 }),
          },
        }),
      ),
    );
  });

  it('labels creating a role or group as a separate side effect', async () => {
    const { onImport } = renderDialog();
    await toTargets();
    fireEvent.click(screen.getByRole('radio', { name: /^Create a new role or group/ }));
    expect(screen.getByText(/Also creates the role or group itself/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'QA Team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Group' }));
    await toPreview();
    fireEvent.click(
      screen.getByRole('button', { name: /^Import 1 setting into New Group: QA Team/ }),
    );
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith(
        expect.objectContaining({
          target: { type: 'create', principalType: PrincipalType.GROUP, name: 'QA Team' },
        }),
      ),
    );
  });

  it('shows the line and column of a YAML syntax error', async () => {
    mockParse.mockResolvedValueOnce({
      success: false,
      error: 'Invalid YAML syntax (line 2, column 18)',
      mark: { line: 2, column: 18 },
      appConfig: null,
      unknownPaths: [],
      unknownEnumValues: [],
    });
    renderDialog();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Paste YAML' }), { key: 'Enter' });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Paste YAML' }), {
      target: { value: 'balance:\n  startBalance: [1\n' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText('Line 2, column 18')).toBeInTheDocument();
    expect(screen.getByRole('alert').textContent).toContain('2 |   startBalance: [1');
  });

  it('names the enum values this panel does not list, and imports them as written', async () => {
    mockParse.mockImplementationOnce(({ data }) =>
      Promise.resolve(parseConfigYaml(data.yamlContent)),
    );
    const { onImport } = renderDialog();
    await toTargets('interface:\n  retentionMode: someday\n');
    await toPreview();
    const dialog = screen.getByRole('dialog');
    const notice = within(dialog).getByRole('region', {
      name: "1 value this panel doesn't recognize",
    });
    expect(within(notice).getByText('interface.retentionMode')).toBeInTheDocument();
    expect(within(notice).getByText('"someday"')).toBeInTheDocument();
    expect(
      within(notice).getByText(/LibreChat v0\.8\.8 and later check each one/),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Import 1 setting into Base/ }));
    await waitFor(() =>
      expect(onImport).toHaveBeenCalledWith({
        target: { type: 'base' },
        entries: [{ fieldPath: 'interface.retentionMode', value: 'someday' }],
      }),
    );
  });

  it('names only the values it imports: none in a key it leaves out or a row left unchecked', async () => {
    mockParse.mockImplementationOnce(({ data }) =>
      Promise.resolve(parseConfigYaml(data.yamlContent)),
    );
    renderDialog();
    await toTargets(
      'interface:\n  retentionMode: someday\nturnstile:\n  siteKey: key\n  options:\n    size: huge\n',
    );
    await toPreview();
    const dialog = screen.getByRole('dialog');
    const name = /this panel doesn't recognize/;
    const notice = within(dialog).getByRole('region', { name });
    expect(
      within(notice)
        .getAllByRole('listitem')
        .map((item) => item.textContent),
    ).toEqual(['interface.retentionMode: "someday" · this panel lists all, temporary, ephemeral']);
    const skipped = within(dialog).getByRole('region', { name: /won't be imported/ });
    expect(skipped.textContent).toMatch(/Size: read from librechat\.yaml only/);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /^Include Retention/ }));
    expect(within(dialog).queryByRole('region', { name })).toBeNull();
  });

  it('shows no such notice for a YAML whose enum values the panel lists', async () => {
    renderDialog();
    await toTargets();
    await toPreview();
    expect(screen.queryByRole('region', { name: /this panel doesn't recognize/ })).toBeNull();
  });

  it('keeps the dialog open and shows the reason when the import is rejected', async () => {
    const { onImport, onClose } = renderDialog();
    onImport.mockRejectedValueOnce(new Error('Validation failed — balance.startBalance'));
    await toTargets();
    await toPreview();
    fireEvent.click(screen.getByRole('button', { name: /^Import 1 setting/ }));
    expect(await screen.findByText('Validation failed — balance.startBalance')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });
});
