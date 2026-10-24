import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { configSchema } from 'librechat-data-provider';
import { act, render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  baseConfigFixture,
  baseLayersFixture,
  scopeConfigFixture,
  scopeLayersFixture,
  valuesDataFixture,
} from '@/test/layers';
import { CollectionEditsContext } from '@/contexts/CollectionEditsContext';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { createServerContract } from '@/test/fixtures';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { RowFilterContext } from '@/contexts/RowFilterContext';
import { ModelSpecsRenderer } from '../ModelSpecsRenderer';
import { extractSchemaTree } from '@/server/config';
import { previewText } from '../Settings';
import { createPathIndex } from '@/utils';
import { withDefault } from '../List';
import { slugify } from '../Fields';

vi.mock('@/hooks/useLocalize', () => ({
  default: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
  useLocalize: () => (key: string, params?: Record<string, string | number>) =>
    params ? `${key} ${JSON.stringify(params)}` : key,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const specFields = tree.find((field) => field.key === 'modelSpecs')?.children ?? [];

const SPECS: t.ConfigRecord[] = [
  {
    name: 'gpt',
    label: 'GPT',
    default: true,
    preset: { endpoint: 'openAI', model: 'gpt-4o' },
  },
  {
    name: 'claude',
    label: 'Claude',
    showInMenu: false,
    preset: { endpoint: 'anthropic', model: 'claude-sonnet-4-5' },
  },
];

function renderSpecs(
  modelSpecs: t.ConfigRecord,
  {
    onChange = vi.fn(),
    data,
    collectionEdits = {},
    showConfiguredOnly,
    contract = BUNDLED_CONFIG_CONTRACT,
  }: {
    onChange?: t.FieldRendererProps['onChange'];
    data?: t.ConfigValuesData;
    collectionEdits?: t.CollectionEdits;
    showConfiguredOnly?: boolean;
    contract?: t.ConfigContract;
  } = {},
) {
  const values = data ?? valuesDataFixture(baseLayersFixture());
  const wrap = (children: ReactNode) => (
    <ConfigContractContext.Provider value={contract}>
      <CollectionEditsContext.Provider value={collectionEdits}>
        <ConfigValuesProvider
          value={{ ...values, configValues: { ...values.configValues, modelSpecs } }}
        >
          {children}
        </ConfigValuesProvider>
      </CollectionEditsContext.Provider>
    </ConfigContractContext.Provider>
  );
  const ui = (
    <ModelSpecsRenderer
      fields={specFields}
      parentPath="modelSpecs"
      parentValue={modelSpecs}
      getValue={(path, fallback) => {
        const key = path.slice('modelSpecs.'.length);
        return key in modelSpecs ? modelSpecs[key] : fallback;
      }}
      onChange={onChange}
      onResetField={vi.fn()}
      onDiscardField={vi.fn()}
      permissions={{ canView: true, canEdit: true, canAssign: true }}
      showConfiguredOnly={showConfiguredOnly}
    />
  );
  return { onChange, ...render(wrap(ui)) };
}

describe('ModelSpecsRenderer', () => {
  it('lists each spec by label with its badges and endpoint · model', () => {
    renderSpecs({ list: SPECS });
    const cards = document.querySelectorAll('[data-entry-card]');
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText('GPT')).toBeInTheDocument();
    expect(
      within(cards[0] as HTMLElement).getByText('com_config_specs_badge_default'),
    ).toBeInTheDocument();
    expect(within(cards[0] as HTMLElement).getByText('gpt · openAI · gpt-4o')).toBeInTheDocument();
    expect(
      within(cards[1] as HTMLElement).getByText('com_config_specs_badge_hidden'),
    ).toBeInTheDocument();
  });

  it('Add spec appends an empty spec', () => {
    const { onChange } = renderSpecs({ list: SPECS });
    fireEvent.click(screen.getByRole('button', { name: 'com_config_specs_add' }));
    expect(onChange).toHaveBeenCalledWith('modelSpecs.list', [...SPECS, {}]);
  });

  it('shows the endpoint as a choice of configured endpoints and the model as text', () => {
    renderSpecs({ list: SPECS });
    const toggle = document.querySelectorAll<HTMLButtonElement>(
      '[data-entry-card] button[aria-expanded]',
    )[0];
    fireEvent.click(toggle);
    const endpoint = document.getElementById(
      'modelSpecs-list-0-preset-endpoint',
    ) as HTMLSelectElement;
    expect(endpoint.tagName).toBe('SELECT');
    expect(endpoint.value).toBe('openAI');
    const values = [...endpoint.querySelectorAll('option')].map((option) => option.value);
    expect(values).toEqual(
      expect.arrayContaining(['openAI', 'anthropic', 'agents', 'GPT', 'Claude']),
    );
    expect(values).not.toContain('custom');
    expect(
      (document.getElementById('modelSpecs-list-0-preset-model') as HTMLInputElement).value,
    ).toBe('gpt-4o');
  });

  it('a renamed saved spec stays a saved one: Basics first, and its label no longer renames it', () => {
    const renamed = { ...SPECS[1], name: 'claude-v2' };
    const { onChange } = renderSpecs(
      { list: [SPECS[0], renamed] },
      {
        collectionEdits: {
          'modelSpecs.list': {
            baseline: SPECS,
            origins: SPECS.map((spec) => ({ identity: String(spec.name), baseline: spec })),
          },
        },
      },
    );
    const card = document.querySelectorAll<HTMLElement>('[data-entry-card]')[1];
    fireEvent.click(card.querySelector<HTMLButtonElement>('button[aria-expanded]')!);
    const groups = [...card.querySelectorAll('button[aria-expanded]')]
      .map((button) => button.textContent ?? '')
      .filter((text) => /com_config_specs_group_(basics|model)$/.test(text));
    expect(groups).toEqual(['com_config_specs_group_basics', 'com_config_specs_group_model']);
    const label = document.getElementById('modelSpecs-list-1-label') as HTMLInputElement;
    fireEvent.change(label, { target: { value: 'Claude V2' } });
    fireEvent.blur(label);
    const writes = vi.mocked(onChange).mock.calls.filter(([path]) => path === 'modelSpecs.list.1');
    expect(writes.length).toBeGreaterThan(0);
    for (const [, entry] of writes) expect(entry).toMatchObject({ name: 'claude-v2' });
  });

  it("selects a new spec's derived name on focus, so typing replaces it", () => {
    renderSpecs({
      list: [{ name: 'research-assistant', label: 'Research Assistant', preset: {} }],
    });
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-entry-card] button[aria-expanded]')!,
    );
    const name = document.getElementById('modelSpecs-list-0-name') as HTMLInputElement;
    act(() => name.focus());
    expect([name.selectionStart, name.selectionEnd]).toEqual([0, 'research-assistant'.length]);
  });

  it('asks before switching endpoints strands parameters, and removes them on request', () => {
    const claude = {
      name: 'claude',
      label: 'Claude',
      preset: { endpoint: 'anthropic', model: 'claude-sonnet-4-5', topK: 5, temperature: 0.4 },
    };
    const onChange = vi.fn();
    renderSpecs({ list: [claude] }, { onChange });
    fireEvent.click(
      document.querySelector<HTMLButtonElement>('[data-entry-card] button[aria-expanded]')!,
    );
    const endpoint = document.getElementById(
      'modelSpecs-list-0-preset-endpoint',
    ) as HTMLSelectElement;
    fireEvent.change(endpoint, { target: { value: 'openAI' } });
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent('com_config_specs_switch_body');
    expect(dialog.textContent).toContain('"params":"topK"');
    expect(dialog.textContent).not.toContain('temperature');
    fireEvent.click(within(dialog).getByRole('button', { name: 'com_config_specs_switch_remove' }));
    const last = onChange.mock.calls[onChange.mock.calls.length - 1];
    expect(last[1]).toEqual(
      expect.objectContaining({
        preset: { endpoint: 'openAI', model: 'claude-sonnet-4-5', temperature: 0.4 },
      }),
    );
  });

  it('moves the default to the spec it is set on (one default per list)', () => {
    expect(
      withDefault(SPECS, 1, 'default').map((spec) => (spec as t.ConfigRecord).default),
    ).toEqual([undefined, true]);
    const soft = withDefault(
      [{ name: 'a', softDefault: true, default: true }, { name: 'b' }],
      1,
      'soft',
    );
    expect(soft).toEqual([
      { name: 'a', default: true },
      { name: 'b', softDefault: true },
    ]);
    expect(withDefault(SPECS, 0, 'none')[0]).not.toHaveProperty('default');
    const explicit = [{ name: 'a', default: false }, { name: 'b' }];
    expect(withDefault(explicit, 1, 'default')[0]).toBe(explicit[0]);
  });

  it('maps "How users pick models" onto enforce and prioritize', () => {
    const { onChange } = renderSpecs({ list: SPECS, enforce: false, prioritize: true });
    expect(screen.getByLabelText('com_config_specs_mode_prioritize')).toBeChecked();
    fireEvent.click(screen.getByLabelText('com_config_specs_mode_enforce'));
    expect(onChange).toHaveBeenCalledWith('modelSpecs.enforce', true);
    expect(onChange).not.toHaveBeenCalledWith('modelSpecs.prioritize', expect.anything());
    fireEvent.click(screen.getByLabelText('com_config_specs_mode_endpoints'));
    expect(onChange).toHaveBeenCalledWith('modelSpecs.prioritize', false);
  });

  it('adds endpoints next to the specs only from the configured ones (no blank or typed names)', () => {
    const { onChange } = renderSpecs({ list: SPECS, addedEndpoints: ['openAI', 'Gone'] });
    const picker = document.getElementById('modelSpecs-addedEndpoints-add') as HTMLSelectElement;
    const options = [...picker.querySelectorAll('option')].map((option) => option.value);
    expect(options).not.toContain('');
    expect(options).not.toContain('openAI');
    expect(options).toContain('agents');
    expect(screen.getByText('com_config_specs_not_configured {"name":"Gone"}')).toBeInTheDocument();
    fireEvent.change(picker, { target: { value: 'agents' } });
    expect(onChange).toHaveBeenCalledWith('modelSpecs.addedEndpoints', [
      'openAI',
      'Gone',
      'agents',
    ]);
    fireEvent.click(
      screen.getByRole('button', { name: /com_config_specs_chip_remove \{"name":"Gone"\}/ }),
    );
    expect(onChange).toHaveBeenCalledWith('modelSpecs.addedEndpoints', ['openAI']);
  });

  it('matches an endpoint spelled as written once the server folds endpoint names', () => {
    const values = valuesDataFixture(baseLayersFixture());
    const data: t.ConfigValuesData = {
      ...values,
      configValues: {
        ...values.configValues,
        endpoints: { custom: [{ name: 'Ollama', baseURL: 'http://127.0.0.1:11434/v1' }] },
      },
    };
    const optionsOf = () =>
      [
        ...(
          document.getElementById('modelSpecs-addedEndpoints-add') as HTMLSelectElement
        ).querySelectorAll('option'),
      ].map((option) => [option.value, option.textContent]);
    const before = renderSpecs({ list: SPECS, addedEndpoints: ['Ollama'] }, { data });
    expect(
      screen.getByText('com_config_specs_added_served_as {"name":"Ollama","served":"ollama"}'),
    ).toBeInTheDocument();
    expect(optionsOf()).toContainEqual(['ollama', 'Ollama (ollama)']);
    before.unmount();
    renderSpecs(
      { list: SPECS, addedEndpoints: ['Ollama'] },
      { data, contract: createServerContract({}, { titleResolution: 'field' }) },
    );
    expect(screen.queryByText(/com_config_specs_added_served_as/)).not.toBeInTheDocument();
    const chip = screen.getByRole('button', {
      name: 'com_config_specs_chip_remove {"name":"Ollama"}',
    }).parentElement;
    expect(chip).toHaveTextContent('Ollama');
    expect(chip).toHaveAttribute('title', 'Ollama');
    expect(optionsOf().map(([value]) => value)).not.toContain('ollama');
  });

  it('flags spec problems on the row and at the field', () => {
    renderSpecs({
      list: [...SPECS, { name: 'gpt', label: 'Copy', preset: { endpoint: 'Nope', model: 'm' } }],
    });
    const card = document.querySelectorAll<HTMLElement>('[data-entry-card]')[2];
    expect(within(card).getByText('com_config_specs_badge_errors {"count":1}')).toBeInTheDocument();
    fireEvent.click(within(card).getAllByRole('button', { expanded: false })[0]);
    expect(
      within(card).getByText(/com_config_issue_spec_duplicate_name/, {
        selector: '[role="alert"]',
      }),
    ).toBeInTheDocument();
    expect(within(card).getByText(/com_config_issue_spec_unknown_endpoint/)).toBeInTheDocument();
  });

  it('keeps a new spec\'s required fields under "Set values only"', () => {
    renderSpecs({ list: [...SPECS, {}] }, { showConfiguredOnly: true });
    const card = document.querySelectorAll<HTMLElement>('[data-entry-card]')[2];
    fireEvent.click(within(card).getAllByRole('button', { expanded: false })[0]);
    for (const id of ['label', 'name', 'preset-endpoint', 'preset-model']) {
      expect(document.getElementById(`modelSpecs-list-2-${id}`)).toBeInTheDocument();
    }
    expect(document.getElementById('modelSpecs-list-2-description')).toBeNull();
    const saved = document.querySelectorAll<HTMLElement>('[data-entry-card]')[0];
    fireEvent.click(within(saved).getAllByRole('button', { expanded: false })[0]);
    expect(document.getElementById('modelSpecs-list-0-preset-model')).toBeInTheDocument();
    expect(document.getElementById('modelSpecs-list-0-description')).toBeNull();
  });

  it('warns about renaming a spec against the name it was saved with, after an earlier save', () => {
    const spec = (name: string): t.ConfigRecord => ({
      name,
      label: 'Spec',
      preset: { endpoint: 'openAI', model: 'gpt-4o' },
    });
    const savedAs = (name: string) =>
      valuesDataFixture(
        baseLayersFixture(
          baseConfigFixture({ dbOverrides: { modelSpecs: { list: [spec(name)] } } }),
        ),
      );
    const ui = (list: t.ConfigRecord[], data: t.ConfigValuesData, edits: t.CollectionEdits) => (
      <CollectionEditsContext.Provider value={edits}>
        <ConfigValuesProvider value={data}>
          <ModelSpecsRenderer
            fields={specFields}
            parentPath="modelSpecs"
            parentValue={{ list }}
            getValue={(path, fallback) => (path === 'modelSpecs.list' ? list : fallback)}
            onChange={vi.fn()}
            onResetField={vi.fn()}
            onDiscardField={vi.fn()}
            permissions={{ canView: true, canEdit: true, canAssign: true }}
          />
        </ConfigValuesProvider>
      </CollectionEditsContext.Provider>
    );
    const expand = () => {
      const toggle = document.querySelector<HTMLButtonElement>(
        '[data-entry-card] button[aria-expanded="false"]',
      );
      if (toggle) fireEvent.click(toggle);
    };
    const renamedFrom = (identity: string): t.CollectionEdits => ({
      'modelSpecs.list': {
        baseline: [spec(identity)],
        origins: [{ identity, baseline: spec(identity) }],
      },
    });
    const { rerender } = render(ui([spec('a')], savedAs('a'), {}));
    expand();
    rerender(ui([spec('b')], savedAs('a'), renamedFrom('a')));
    expand();
    expect(screen.getByText('com_config_specs_rename_warning {"name":"a"}')).toBeInTheDocument();
    rerender(ui([spec('b')], savedAs('b'), {}));
    expand();
    expect(screen.queryByText(/com_config_specs_rename_warning/)).toBeNull();
    rerender(ui([spec('c')], savedAs('b'), renamedFrom('b')));
    expand();
    expect(screen.getByText('com_config_specs_rename_warning {"name":"b"}')).toBeInTheDocument();
  });

  it('shows the inherited list read-only in a profile until it is customized', () => {
    const base = baseConfigFixture({ dbOverrides: { modelSpecs: { list: SPECS } } });
    const data = valuesDataFixture(scopeLayersFixture(undefined, base));
    renderSpecs({ list: SPECS }, { data });
    expect(screen.queryByRole('button', { name: 'com_config_specs_add' })).not.toBeInTheDocument();
    expect(screen.queryAllByRole('button', { name: /com_config_ctl_entry_move/ })).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: /com_config_ce_override_for/ }));
    expect(screen.getByRole('button', { name: 'com_config_specs_add' })).toHaveFocus();
    expect(screen.getByText(/com_config_specs_customizing/)).toBeInTheDocument();
  });

  it('names the specs a profile hides with the endpoints they select (keyedTombstones)', () => {
    const specs = [...SPECS, { name: 'gw', label: 'Gateway spec', preset: { endpoint: 'GPT' } }];
    const base = baseConfigFixture({ dbOverrides: { modelSpecs: { list: specs } } });
    const scope = scopeConfigFixture({ tombstones: ['endpoints.custom["GPT"]'] });
    const data = valuesDataFixture(scopeLayersFixture(scope, base, true));
    const keyed = createServerContract({ keyedTombstones: true });
    const { unmount } = renderSpecs({ list: specs }, { data, contract: keyed });
    expect(
      screen.getByText(/com_config_specs_hidden_endpoint .*"specs":"Gateway spec"/),
    ).toBeInTheDocument();
    expect(document.body.textContent).toContain('com_config_specs_preview_specs {\\"count\\":1}');
    unmount();
    renderSpecs({ list: specs }, { data });
    expect(screen.queryByText(/com_config_specs_hidden_endpoint/)).toBeNull();
    expect(document.body.textContent).toContain('com_config_specs_preview_specs {\\"count\\":2}');
  });

  it('leaves the added endpoints a profile hides out of "Users will see" (keyedTombstones)', () => {
    const base = baseConfigFixture({
      dbOverrides: { modelSpecs: { list: SPECS, addedEndpoints: ['GPT'] } },
    });
    const scope = scopeConfigFixture({ tombstones: ['endpoints.custom["GPT"]'] });
    const data = valuesDataFixture(scopeLayersFixture(scope, base, true));
    const keyed = createServerContract({ keyedTombstones: true });
    const { unmount } = renderSpecs(
      { list: SPECS, addedEndpoints: ['GPT'] },
      { data, contract: keyed },
    );
    expect(document.body.textContent).toContain('com_config_specs_preview_added_none');
    unmount();
    renderSpecs({ list: SPECS, addedEndpoints: ['GPT'] }, { data });
    expect(document.body.textContent).not.toContain('com_config_specs_preview_added_none');
    expect(document.body.textContent).toContain('com_config_specs_preview_added');
  });

  it("warns that a profile hiding every spec's endpoint leaves its members nothing to pick (keyedTombstones)", () => {
    const specs = [{ name: 'gw', label: 'Gateway spec', preset: { endpoint: 'GPT' } }];
    const base = baseConfigFixture({ dbOverrides: { modelSpecs: { list: specs } } });
    const scope = scopeConfigFixture({ tombstones: ['endpoints.custom["GPT"]'] });
    const data = valuesDataFixture(scopeLayersFixture(scope, base, true));
    const keyed = createServerContract({ keyedTombstones: true });
    const { unmount } = renderSpecs({ list: specs }, { data, contract: keyed });
    expect(document.body.textContent).toContain('com_config_specs_preview_none_menu_off');
    expect(document.body.textContent).toContain('com_config_specs_empty_menu_off');
    unmount();
    renderSpecs({ list: specs }, { data });
    expect(document.body.textContent).not.toContain('com_config_specs_empty_menu_off');
  });

  it('says an inherited endpoint list cannot be emptied in a profile (D3)', () => {
    const base = baseConfigFixture({ dbOverrides: { modelSpecs: { addedEndpoints: ['openAI'] } } });
    const data = valuesDataFixture(scopeLayersFixture(undefined, base));
    const { onChange } = renderSpecs({ list: SPECS, addedEndpoints: ['openAI'] }, { data });
    fireEvent.click(screen.getByRole('button', { name: /com_config_specs_chip_remove/ }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText('com_config_ctl_clear_unavailable')).toBeInTheDocument();
  });

  it('clears the agent ID when an agents spec moves to another endpoint', () => {
    const agent: t.ConfigRecord = {
      name: 'helper',
      label: 'Helper',
      preset: { endpoint: 'agents', agent_id: 'agent_1' },
    };
    const { onChange } = renderSpecs({ list: [agent] });
    fireEvent.click(document.querySelector('[data-entry-card] button[aria-expanded="false"]')!);
    expect(document.getElementById('modelSpecs-list-0-preset-agent_id')).not.toBeNull();
    fireEvent.change(document.getElementById('modelSpecs-list-0-preset-endpoint')!, {
      target: { value: 'openAI' },
    });
    expect(onChange).toHaveBeenLastCalledWith('modelSpecs.list.0', {
      ...agent,
      preset: { endpoint: 'openAI' },
    });
  });

  it('keeps an agent ID a non-agents spec still stores visible, so it can be removed', () => {
    renderSpecs({
      list: [
        { name: 'x', label: 'X', preset: { endpoint: 'openAI', model: 'm', agent_id: 'old' } },
      ],
    });
    fireEvent.click(document.querySelector('[data-entry-card] button[aria-expanded="false"]')!);
    expect(document.getElementById('modelSpecs-list-0-preset-agent_id')).not.toBeNull();
  });

  it('keeps an expanded spec open on the spec itself when it is moved', () => {
    function Stateful() {
      const [list, setList] = useState<t.ConfigValue>(SPECS);
      return (
        <ConfigValuesProvider value={valuesDataFixture(baseLayersFixture())}>
          <ModelSpecsRenderer
            fields={specFields}
            parentPath="modelSpecs"
            parentValue={{ list }}
            getValue={(path, fallback) => (path === 'modelSpecs.list' ? list : fallback)}
            onChange={(path, value) => {
              if (path === 'modelSpecs.list') setList(value);
            }}
            onResetField={vi.fn()}
            onDiscardField={vi.fn()}
            permissions={{ canView: true, canEdit: true, canAssign: true }}
          />
        </ConfigValuesProvider>
      );
    }
    render(<Stateful />);
    const toggle = (index: number) =>
      document
        .querySelectorAll<HTMLElement>('[data-entry-card]')
        [index].querySelector<HTMLButtonElement>('button[aria-expanded]') as HTMLButtonElement;
    fireEvent.click(toggle(1));
    expect(document.getElementById('modelSpecs-list-1-preset-model')).toHaveValue(
      'claude-sonnet-4-5',
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'com_config_ctl_entry_move_up {"name":"Claude"}' }),
    );
    expect(toggle(0)).toHaveAttribute('aria-expanded', 'true');
    expect(toggle(1)).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('modelSpecs-list-0-preset-model')).toHaveValue(
      'claude-sonnet-4-5',
    );
  });

  it('clears the assistant ID when an assistants spec moves to another endpoint', () => {
    const assistant: t.ConfigRecord = {
      name: 'helper',
      label: 'Helper',
      preset: { endpoint: 'assistants', model: 'gpt-4o', assistant_id: 'asst_1' },
    };
    const { onChange } = renderSpecs({ list: [assistant] });
    fireEvent.click(document.querySelector('[data-entry-card] button[aria-expanded="false"]')!);
    expect(document.getElementById('modelSpecs-list-0-preset-assistant_id')).not.toBeNull();
    fireEvent.change(document.getElementById('modelSpecs-list-0-preset-endpoint')!, {
      target: { value: 'azureAssistants' },
    });
    expect(onChange).toHaveBeenLastCalledWith('modelSpecs.list.0', {
      ...assistant,
      preset: { endpoint: 'azureAssistants', model: 'gpt-4o', assistant_id: 'asst_1' },
    });
    fireEvent.change(document.getElementById('modelSpecs-list-0-preset-endpoint')!, {
      target: { value: 'openAI' },
    });
    expect(onChange).toHaveBeenLastCalledWith('modelSpecs.list.0', {
      ...assistant,
      preset: { endpoint: 'openAI', model: 'gpt-4o' },
    });
  });

  it('shows the assistant ID once, in the Model group, never among the parameters', () => {
    renderSpecs({
      list: [
        {
          name: 'helper',
          label: 'Helper',
          preset: { endpoint: 'assistants', model: 'gpt-4o', assistant_id: 'asst_1', topK: 3 },
        },
      ],
    });
    fireEvent.click(document.querySelector('[data-entry-card] button[aria-expanded="false"]')!);
    fireEvent.click(screen.getByRole('button', { name: /com_config_specs_group_params/ }));
    expect(document.getElementById('modelSpecs-list-0-preset-topK')).not.toBeNull();
    expect(document.querySelectorAll('#modelSpecs-list-0-preset-assistant_id')).toHaveLength(1);
  });

  it('lists only the parameters the tab filter matches', () => {
    const filtered = (paths: string[]) =>
      render(
        <RowFilterContext.Provider value={createPathIndex(paths)}>
          <ConfigValuesProvider value={valuesDataFixture(baseLayersFixture())}>
            <ModelSpecsRenderer
              fields={specFields}
              parentPath="modelSpecs"
              parentValue={{ list: SPECS }}
              getValue={(path, fallback) => (path === 'modelSpecs.list' ? SPECS : fallback)}
              onChange={vi.fn()}
              permissions={{ canView: true, canEdit: true, canAssign: true }}
            />
          </ConfigValuesProvider>
        </RowFilterContext.Provider>,
      );
    const first = filtered(['modelSpecs.list.0.preset.temperature']);
    const params = screen.getByRole('button', { name: /com_config_specs_group_params/ });
    if (params.getAttribute('aria-expanded') === 'false') fireEvent.click(params);
    expect(document.getElementById('modelSpecs-list-0-preset-temperature')).not.toBeNull();
    expect(document.getElementById('modelSpecs-list-0-preset-top_p')).toBeNull();
    expect(screen.queryByRole('button', { name: 'com_config_specs_raw' })).toBeNull();
    first.unmount();
    filtered(['modelSpecs.list.0.preset.model']);
    expect(document.getElementById('modelSpecs-list-0-preset-model')).not.toBeNull();
    expect(screen.queryByRole('button', { name: /com_config_specs_group_params/ })).toBeNull();
  });

  it('keeps settings the panel does not know visible under "Set values only"', () => {
    renderSpecs(
      {
        list: [
          {
            name: 'gpt',
            label: 'GPT',
            futureSetting: true,
            preset: { endpoint: 'openAI', model: 'gpt-4o', legacyKey: 1 },
          },
        ],
      },
      { showConfiguredOnly: true },
    );
    fireEvent.click(document.querySelector('[data-entry-card] button[aria-expanded="false"]')!);
    const advanced = screen.getByRole('button', { name: /com_config_specs_group_advanced/ });
    fireEvent.click(advanced);
    expect(screen.getByText('futureSetting')).toBeInTheDocument();
    expect(screen.getByText('legacyKey')).toBeInTheDocument();
  });

  it('shows the agents endpoint LibreChat infers for a preset naming only an agent', () => {
    renderSpecs(
      { list: [{ name: 'helper', label: 'Helper', preset: { agent_id: 'agent_1' } }] },
      { showConfiguredOnly: true },
    );
    fireEvent.click(document.querySelector('[data-entry-card] button[aria-expanded="false"]')!);
    const endpoint = document.getElementById(
      'modelSpecs-list-0-preset-endpoint',
    ) as HTMLSelectElement;
    expect(endpoint.value).toBe('agents');
    expect(endpoint.getAttribute('aria-invalid')).not.toBe('true');
  });

  it('offers an Anthropic spec only Anthropic parameters', () => {
    renderSpecs({ list: SPECS });
    const card = document.querySelectorAll<HTMLElement>('[data-entry-card]')[1];
    fireEvent.click(within(card).getAllByRole('button', { expanded: false })[0]);
    fireEvent.click(within(card).getByRole('button', { name: /com_config_specs_group_params/ }));
    expect(document.getElementById('modelSpecs-list-1-preset-topK')).not.toBeNull();
    expect(document.getElementById('modelSpecs-list-1-preset-top_p')).toBeNull();
    expect(document.getElementById('modelSpecs-list-1-preset-frequency_penalty')).toBeNull();
  });
});

describe('spec helpers', () => {
  it('derives a unique name from a label', () => {
    expect(slugify('GPT 5 mini!', new Set())).toBe('gpt-5-mini');
    expect(slugify('GPT', new Set(['gpt', 'gpt-2']))).toBe('gpt-3');
    expect(slugify('  ', new Set())).toBe('spec');
  });

  it('says what users will see', () => {
    const localize: t.LocalizeFn = (key, params) => `${key}${params ? JSON.stringify(params) : ''}`;
    const items = [{ name: 'a' }, { name: 'b', showInMenu: false }];
    expect(
      previewText(localize, { items, mode: 'prioritize', menuOn: true, added: ['OpenAI'] }),
    ).toBe(
      'com_config_specs_preview_added{"specs":"com_config_specs_preview_specs{\\"count\\":1}","endpoints":"OpenAI"} com_config_specs_preview_hidden{"count":1}',
    );
    expect(previewText(localize, { items: [], mode: 'enforce', menuOn: true, added: [] })).toBe(
      'com_config_specs_preview_none',
    );
    expect(previewText(localize, { items: [], mode: 'enforce', menuOn: false, added: [] })).toBe(
      'com_config_specs_preview_none_menu_off',
    );
    expect(previewText(localize, { items, mode: 'enforce', menuOn: true, added: [] })).toMatch(
      /^com_config_specs_preview_enforce/,
    );
  });
});
