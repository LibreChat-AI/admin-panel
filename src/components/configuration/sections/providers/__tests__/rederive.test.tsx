import '@/locales/i18n';
import { describe, expect, it, vi } from 'vitest';
import { PrincipalType } from 'librechat-data-provider';
import { fireEvent, screen, within } from '@testing-library/react';
import type * as t from '@/types';
import { BUNDLED_CONFIG_CONTRACT, SECRET_PREVIEW_MASK } from '@/constants';
import { COVERAGE_TEST_TIMEOUT_MS, typeInto } from '@/test/coverage';
import { toFieldId } from '@/components/configuration/renderer';
import { createServerContract } from '@/test/fixtures';
import { renderTab, PAGE_TREE } from '@/test/page';
import { getValueAtPath } from '@/utils';

vi.setConfig({ testTimeout: COVERAGE_TEST_TIMEOUT_MS });

vi.mock('@tanstack/react-router', async (importOriginal) =>
  (await import('@/test/router')).routerless(importOriginal),
);

const GROUPS = 'endpoints.azureOpenAI.groups';

/** librechat.yaml's Azure OpenAI block. */
const YAML: t.ConfigRecord = {
  endpoints: {
    azureOpenAI: {
      groups: [
        {
          group: 'eastus',
          apiKey: '${EASTUS_API_KEY}',
          instanceName: 'librechat-eastus',
          version: '2024-02-15-preview',
          models: { 'gpt-4o': { deploymentName: 'gpt-4o' } },
        },
      ],
    },
  },
};

/** A server that derives Azure groups from Base and the profiles again. */
const REDERIVE = createServerContract({
  endpointRederive: true,
  azureGroupMergeKey: true,
  azureGroupSecrets: true,
  changesBatch: true,
  expectedRevision: true,
  prunesEmptyParents: true,
});

const TREE = PAGE_TREE.map((section) =>
  section.key === 'endpoints'
    ? { ...section, children: section.children?.filter((child) => child.key === 'azureOpenAI') }
    : section,
);

function renderGroups(
  contract: t.ConfigContract,
  overrides: t.ConfigRecord = {},
  tombstones: string[] = [],
) {
  return renderTab({
    tab: 'providers',
    expandAll: true,
    tree: TREE,
    yaml: YAML,
    overrides,
    tombstones,
    contract,
  });
}

describe('Azure groups editor (endpointRederive)', () => {
  it('saves only what an edit of a librechat.yaml group changes, merged into it by name', () => {
    const view = renderGroups(REDERIVE);
    expect(screen.getByText(/LibreChat merges the groups set here/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group eastus' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/Defined in librechat.yaml\. What you change/)).toBeTruthy();
    typeInto(`${GROUPS}.0.version`, '2025-01-01-preview');
    expect(view.plan().sets).toEqual([
      { fieldPath: GROUPS, value: [{ group: 'eastus', version: '2025-01-01-preview' }] },
    ]);
  });

  it('adds a group, with its key, and checks it resolves before saving', () => {
    const view = renderGroups(REDERIVE);
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the new Azure group' }), {
      target: { value: 'west' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByRole('heading', { name: 'west' })).toBeTruthy();
    typeInto(`${GROUPS}.1.apiKey`, 'sk-west');
    expect(view.plan().issues.map((issue) => `${issue.entryPath}:${issue.code}`)).toEqual([
      'models:required',
      'instanceName:azure_instance_required',
    ]);
    typeInto(`${GROUPS}.1.instanceName`, 'west-instance');
    typeInto(`${GROUPS}.1.version`, 'v1');
    typeInto(`${GROUPS}.1.deploymentName`, 'west-deployment');
    expect(view.plan().issues.map((issue) => issue.code)).toEqual(['required']);
  });

  it("can't add a group under a name another group has", () => {
    renderGroups(REDERIVE);
    fireEvent.click(screen.getByRole('button', { name: 'Add group' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Name of the new Azure group' }), {
      target: { value: 'eastus' },
    });
    expect(screen.getByRole('alert').textContent).toBe('A group named "eastus" already exists');
    expect((screen.getByRole('button', { name: 'Add' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('deletes a group Base adds, and reverts an override of a librechat.yaml group', () => {
    const overrides = {
      endpoints: {
        azureOpenAI: {
          groups: [
            { group: 'eastus', version: 'v2' },
            {
              group: 'west',
              apiKeyPreview: '...1234',
              instanceName: 'west',
              version: 'v1',
              models: {},
            },
          ],
        },
      },
    };
    const view = renderGroups(REDERIVE, overrides);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group west' }));
    let drawer = screen.getByRole('dialog');
    expect(within(drawer).queryByRole('button', { name: /Revert to librechat\.yaml/ })).toBeNull();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete group' }));
    expect(screen.getByText('Removed when you save.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group eastus' }));
    drawer = screen.getByRole('dialog');
    expect(within(drawer).queryByRole('button', { name: 'Delete group' })).toBeNull();
    fireEvent.click(within(drawer).getByRole('button', { name: 'Revert to librechat.yaml' }));
    expect(view.plan().resets).toEqual([GROUPS]);
  });

  it("shows a key Base stores for a librechat.yaml group as its preview, and reverts it to librechat.yaml's", () => {
    const view = renderGroups(REDERIVE, {
      endpoints: { azureOpenAI: { groups: [{ group: 'eastus', apiKeyPreview: '...5555' }] } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group eastus' }));
    const drawer = screen.getByRole('dialog');
    const key = document.getElementById(toFieldId(`${GROUPS}.0.apiKey`)) as HTMLInputElement;
    expect(key.value).toBe('...5555');
    expect(within(drawer).queryByDisplayValue('${EASTUS_API_KEY}')).toBeNull();
    fireEvent.click(
      within(drawer).getByRole('button', { name: /^Revert API key to its librechat\.yaml value/ }),
    );
    expect(view.plan().issues).toEqual([]);
    expect(view.plan().resets).toEqual([GROUPS]);
  });

  it('saves an edit of a librechat.yaml group whose literal key the server hides', () => {
    const yaml = structuredClone(YAML);
    const group = getValueAtPath(yaml, `${GROUPS}.0`) as t.ConfigRecord;
    delete group.apiKey;
    group.apiKeyPreview = SECRET_PREVIEW_MASK;
    const view = renderTab({
      tab: 'providers',
      expandAll: true,
      tree: TREE,
      yaml,
      contract: REDERIVE,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group eastus' }));
    expect(
      within(screen.getByRole('dialog')).getByDisplayValue(/Set in librechat\.yaml/),
    ).toBeTruthy();
    typeInto(`${GROUPS}.0.version`, '2025-01-01-preview');
    const plan = view.plan();
    expect(plan.issues).toEqual([]);
    expect(plan.sets).toEqual([
      { fieldPath: GROUPS, value: [{ group: 'eastus', version: '2025-01-01-preview' }] },
    ]);
  });

  it("offers no revert of a key Base stores over a literal librechat.yaml key, which the panel can't restate", () => {
    const yaml = structuredClone(YAML);
    const group = getValueAtPath(yaml, `${GROUPS}.0`) as t.ConfigRecord;
    delete group.apiKey;
    group.apiKeyPreview = SECRET_PREVIEW_MASK;
    const view = renderTab({
      tab: 'providers',
      expandAll: true,
      tree: TREE,
      yaml,
      overrides: {
        endpoints: { azureOpenAI: { groups: [{ group: 'eastus', apiKeyPreview: '...5555' }] } },
      },
      contract: REDERIVE,
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group eastus' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByDisplayValue('...5555')).toBeTruthy();
    expect(within(drawer).queryByRole('button', { name: /^Revert API key/ })).toBeNull();
    expect(within(drawer).queryByRole('button', { name: 'Remove API key' })).toBeNull();
    expect(within(drawer).getByRole('button', { name: 'Replace API key' })).toBeTruthy();
    expect(view.plan().sets).toEqual([]);
  });

  it('keeps a dotted model name whole: its saved settings show their override and revert, not an unsaved change', () => {
    const yaml = structuredClone(YAML);
    const group = getValueAtPath(yaml, `${GROUPS}.0`) as t.ConfigRecord;
    group.models = {
      'gpt-4.1': { deploymentName: 'gpt-41' },
      'gpt-4': { deploymentName: 'gpt-4' },
    };
    const view = renderTab({
      tab: 'providers',
      expandAll: true,
      tree: TREE,
      yaml,
      overrides: {
        endpoints: {
          azureOpenAI: {
            groups: [{ group: 'eastus', models: { 'gpt-4.1': { deploymentName: 'mine' } } }],
          },
        },
      },
      contract: createServerContract({ ...REDERIVE.features, dottedKeys: true }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group eastus' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).queryByText(/Unsaved change/)).toBeNull();
    fireEvent.click(
      within(drawer).getByRole('button', {
        name: 'Revert Deployment name to its librechat.yaml value, gpt-41',
      }),
    );
    expect(view.plan().issues).toEqual([]);
    expect(view.plan().resets).toEqual([GROUPS]);
  });

  it("offers no revert of a group key Base stores as librechat.yaml's reference, which a save that leaves it out keeps", () => {
    renderGroups(REDERIVE, {
      endpoints: {
        azureOpenAI: {
          groups: [{ group: 'eastus', version: 'v2', apiKey: '${EASTUS_API_KEY}' }],
        },
      },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group eastus' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).queryByRole('button', { name: /^Revert API key/ })).toBeNull();
    expect(within(drawer).getByRole('button', { name: /^Revert Version/ })).toBeTruthy();
    expect(within(drawer).getByRole('button', { name: 'Revert to librechat.yaml' })).toBeTruthy();
  });

  it("names the profile whose override Base's rename or removal of a group leaves as a group of its own", () => {
    const west = {
      group: 'rv-west',
      apiKeyPreview: '...4321',
      instanceName: 'rv-west',
      version: 'v1',
      models: { m: { deploymentName: 'm' } },
    };
    const user: t.ConfigScope = {
      principalType: PrincipalType.ROLE,
      principalId: 'USER',
      name: 'USER',
      priority: 10,
      isActive: true,
      overridePaths: [GROUPS],
      overrideEntries: { [GROUPS]: ['rv-west'] },
      overrideEntryPaths: { [GROUPS]: { 'rv-west': ['version'] } },
    };
    renderTab({
      tab: 'providers',
      expandAll: true,
      tree: TREE,
      yaml: YAML,
      overrides: { endpoints: { azureOpenAI: { groups: [west] } } },
      contract: REDERIVE,
      profiles: [user],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group rv-west' }));
    typeInto(`${GROUPS}.1.group`, 'rv-north');
    expect(
      within(screen.getByRole('dialog')).getByText(
        /Role: USER overrides "rv-west"\. The override stays under that name, as a group of its own/,
      ),
    ).toBeTruthy();
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Delete group' }),
    );
    expect(
      screen.getByText(
        'Role: USER overrides "rv-west". The override stays, as a group of its own without an instance or base URL, so LibreChat ignores every Azure group override Role: USER stores until it is removed there.',
      ),
    ).toBeTruthy();
  });

  it("marks a saved group that doesn't resolve, which makes LibreChat ignore every group set here", () => {
    renderGroups(REDERIVE, {
      endpoints: { azureOpenAI: { groups: [{ group: 'gone', version: 'v2' }] } },
    });
    const row = (name: string) =>
      screen.getByRole('button', { name: `Edit Azure group ${name}` }).closest('tr') as HTMLElement;
    expect(within(row('gone')).getByText('Needs a fix')).toBeTruthy();
    expect(within(row('eastus')).queryByText('Needs a fix')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group gone' }));
    expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toMatch(
      /^This group doesn't resolve as saved, so LibreChat ignores every Azure group set here until it is fixed: Instance name is required unless the group is serverless\.$/,
    );
  });

  it('shows the groups read-only, with their stored override as not yet applied, before LibreChat derives them', () => {
    const overrides = {
      endpoints: { azureOpenAI: { groups: [{ group: 'eastus', version: 'v2' }] } },
    };
    renderGroups(
      createServerContract({ azureGroupMergeKey: true, azureGroupSecrets: true }),
      overrides,
    );
    expect(
      screen.getByText(/applies none until its operator sets CONFIG_REDERIVE_ENDPOINTS/),
    ).toBeTruthy();
    expect(
      screen.getByText(/once its operator sets CONFIG_REDERIVE_ENDPOINTS, it merges/),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Add group' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Details of Azure group eastus' })).toBeTruthy();
  });

  it('keeps the read-only table on an older server', () => {
    renderGroups(BUNDLED_CONFIG_CONTRACT);
    expect(screen.queryByRole('button', { name: 'Edit Azure group eastus' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Details of Azure group eastus' })).toBeTruthy();
  });
});

const ANTHROPIC_TREE = PAGE_TREE.map((section) =>
  section.key === 'endpoints'
    ? { ...section, children: section.children?.filter((child) => child.key === 'anthropic') }
    : section,
);

describe('Vertex AI (endpointRederive)', () => {
  const vertex = { projectId: 'p-1', region: 'us-east5', models: ['claude-sonnet-4-6'] };
  const rules = {
    baseOnlyPaths: [
      'endpoints.anthropic.vertex.serviceKeyFile',
      'endpoints.anthropic.vertex.region',
    ],
  };

  it('edits the settings librechat.yaml configures, keeping its region and key file', () => {
    const view = renderTab({
      tab: 'providers',
      expandAll: true,
      tree: ANTHROPIC_TREE,
      yaml: { endpoints: { anthropic: { vertex } } },
      contract: createServerContract({ endpointRederive: true }, rules),
    });
    expect(screen.getByText(/LibreChat runs Vertex AI on librechat.yaml's region/)).toBeTruthy();
    expect(screen.getByText(/Only librechat.yaml sets the 2 settings below/)).toBeTruthy();
    typeInto('endpoints.anthropic.vertex.projectId', 'p-2');
    expect(view.plan().sets).toEqual([
      { fieldPath: 'endpoints.anthropic.vertex.projectId', value: 'p-2' },
    ]);
  });

  it('offers no Vertex AI settings where librechat.yaml configures none', () => {
    renderTab({
      tab: 'providers',
      expandAll: true,
      tree: ANTHROPIC_TREE,
      yaml: { endpoints: { anthropic: { titleModel: 'claude' } } },
      contract: createServerContract({ endpointRederive: true }, rules),
    });
    expect(screen.getByText(/Vertex AI isn't configured in librechat.yaml/)).toBeTruthy();
    expect(document.getElementById('endpoints-anthropic-vertex-projectId')).toBeNull();
  });

  it('shows them read-only on a server that does not derive Vertex AI again', () => {
    const view = renderTab({
      tab: 'providers',
      expandAll: true,
      tree: ANTHROPIC_TREE,
      yaml: { endpoints: { anthropic: { vertex } } },
      contract: BUNDLED_CONFIG_CONTRACT,
    });
    expect(
      screen.getAllByText(/Managed in librechat.yaml until LibreChat applies/).length,
    ).toBeGreaterThan(0);
    expect(
      document.querySelector(
        '#endpoints-anthropic-vertex-projectId input, input#endpoints-anthropic-vertex-projectId',
      ),
    ).toBeNull();
    expect(view.plan().sets).toEqual([]);
  });
});

describe('Azure group hides by name another client stored (keyedTombstones)', () => {
  const KEYED = createServerContract({ ...REDERIVE.features, keyedTombstones: true });

  it('names each stored hide, whole group or field, above the groups and in the group', () => {
    renderGroups(KEYED, {}, [`${GROUPS}["eastus"].instanceName`, `${GROUPS}["westus"]`]);
    const notice = screen.getByText(/Base hides Azure groups, or parts of them, by name/);
    expect(notice.textContent).toContain('eastus › Instance name, westus');
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group eastus' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText(/Base hides Azure groups/).textContent).toContain(
      ': eastus › Instance name.',
    );
  });

  /** The row of a group in the groups table. */
  const groupRow = (name: string): HTMLElement => {
    const row = screen.getByRole('button', { name: `Edit Azure group ${name}` }).closest('tr');
    if (!row) throw new Error(`no row for ${name}`);
    return row;
  };

  it('marks a group with a setting hidden in the table and its drawer, naming the setting', () => {
    renderGroups(KEYED, {}, [`${GROUPS}["eastus"].instanceName`]);
    const badge = within(groupRow('eastus')).getByText(/^Partly hidden/);
    expect(badge.getAttribute('title')).toBe(
      'Base hides Instance name of this group by name: LibreChat serves the group without it, or not at all if it no longer resolves',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group eastus' }));
    expect(within(screen.getByRole('dialog')).getByText(/^Partly hidden/)).toBeTruthy();
  });

  it('marks a group hidden whole as hidden', () => {
    renderGroups(KEYED, {}, [`${GROUPS}["eastus"]`]);
    const badge = within(groupRow('eastus')).getByText(/^Hidden/);
    expect(badge.getAttribute('title')).toBe(
      "Base hides this group by name, so LibreChat doesn't serve it",
    );
  });

  it('marks a renamed group by the hides of the name it will be saved under', () => {
    const west = {
      group: 'rv-west',
      apiKeyPreview: '...4321',
      instanceName: 'rv-west',
      version: 'v1',
      models: { m: { deploymentName: 'm' } },
    };
    renderGroups(KEYED, { endpoints: { azureOpenAI: { groups: [west] } } }, [
      `${GROUPS}["rv-west"]`,
    ]);
    expect(within(groupRow('rv-west')).getByText(/^Hidden/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group rv-west' }));
    typeInto(`${GROUPS}.1.group`, 'rv-north');
    expect(within(screen.getByRole('dialog')).queryByText(/^Hidden/)).toBeNull();
  });

  it('marks a group renamed onto a name a stored hide names', () => {
    const west = {
      group: 'rv-west',
      apiKeyPreview: '...4321',
      instanceName: 'rv-west',
      version: 'v1',
      models: { m: { deploymentName: 'm' } },
    };
    renderGroups(KEYED, { endpoints: { azureOpenAI: { groups: [west] } } }, [
      `${GROUPS}["rv-north"]`,
    ]);
    expect(within(groupRow('rv-west')).queryByText(/^Hidden/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit Azure group rv-west' }));
    typeInto(`${GROUPS}.1.group`, 'rv-north');
    expect(within(screen.getByRole('dialog')).getByText(/^Hidden/)).toBeTruthy();
  });

  it('says nothing on a server without keyed tombstones', () => {
    renderGroups(REDERIVE, {}, [`${GROUPS}["eastus"].instanceName`]);
    expect(screen.queryByText(/hides Azure groups, or parts of them/)).toBeNull();
    expect(within(groupRow('eastus')).queryByText(/hidden/i)).toBeNull();
  });
});
