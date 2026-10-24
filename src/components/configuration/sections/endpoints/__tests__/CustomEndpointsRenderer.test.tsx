import { useState } from 'react';
import { configSchema } from 'librechat-data-provider';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, within, act } from '@testing-library/react';
import type * as t from '@/types';
import {
  valuesDataFixture,
  baseConfigFixture,
  baseLayersFixture,
  scopeConfigFixture,
  scopeLayersFixture,
} from '@/test/layers';
import { CollectionEditsContext } from '@/contexts/CollectionEditsContext';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { CustomEndpointsRenderer } from '../CustomEndpointsRenderer';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { RestatesContext } from '@/contexts/RestatesContext';
import { createServerContract } from '@/test/fixtures';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { extractSchemaTree } from '@/server/config';
import { isConfigRecord, deepSerializeKVPairs } from '@/utils';

vi.mock('@/hooks/useLocalize', () => {
  const localize = (key: string, params?: Record<string, string | number>) =>
    params?.name ? `${key}:${params.name}` : key;
  return { default: () => localize, useLocalize: () => localize };
});

/** jsdom has no ResizeObserver; Radix checkboxes inside a form measure themselves with one. */
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  vi.stubGlobal('ResizeObserver', NoopResizeObserver);
});

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const fields = tree.find((field) => field.key === 'endpoints')?.children ?? [];

const ADMIN_ENTRY: t.ConfigRecord = {
  name: 'Mine',
  apiKey: 'user_provided',
  baseURL: 'https://mine.example.com/v1',
  models: { default: ['m-1'] },
};

/** Base: librechat.yaml's GPT and Claude, GPT's base URL overridden, and `Mine` added in the panel. */
function baseLayers(): t.ValueLayers {
  return baseLayersFixture(
    baseConfigFixture({
      dbOverrides: {
        endpoints: {
          custom: [{ name: 'GPT', baseURL: 'https://override.example.com' }, ADMIN_ENTRY],
        },
      },
    }),
  );
}

function savedList(layers: t.ValueLayers): t.ConfigValue[] {
  const endpoints = layers.effective?.endpoints;
  const list =
    endpoints && typeof endpoints === 'object' && !Array.isArray(endpoints)
      ? endpoints.custom
      : undefined;
  return Array.isArray(list) ? list : [];
}

function Harness({
  layers,
  initial,
  onChange,
  collectionEdits = {},
  showConfiguredOnly,
  contract = BUNDLED_CONFIG_CONTRACT,
  visibilityEdits,
  onHideField,
  onUnhideField,
}: {
  layers: t.ValueLayers;
  initial?: t.ConfigValue[];
  onChange?: (path: string, value: t.ConfigValue) => void;
  collectionEdits?: t.CollectionEdits;
  showConfiguredOnly?: boolean;
  contract?: t.ConfigContract;
  visibilityEdits?: Record<string, t.VisibilityEdit>;
  onHideField?: (path: string) => void;
  onUnhideField?: (path: string) => void;
}) {
  const [items, setItems] = useState<t.ConfigValue[]>(initial ?? savedList(layers));
  const handleChange = (path: string, value: t.ConfigValue) => {
    onChange?.(path, value);
    if (path === 'endpoints.custom' && Array.isArray(value)) setItems(value);
    const match = /^endpoints\.custom\.(\d+)$/.exec(path);
    if (match) setItems((prev) => prev.map((item, i) => (i === Number(match[1]) ? value : item)));
  };
  return (
    <ConfigContractContext.Provider value={contract}>
      <ConfigValuesProvider value={{ ...valuesDataFixture(layers), visibilityEdits }}>
        <CollectionEditsContext.Provider value={collectionEdits}>
          <CustomEndpointsRenderer
            fields={fields}
            parentPath="endpoints"
            parentValue={{ custom: items }}
            getValue={(path, fallback) => (path === 'endpoints.custom' ? items : fallback)}
            onChange={handleChange}
            showConfiguredOnly={showConfiguredOnly}
            onHideField={onHideField}
            onUnhideField={onUnhideField}
          />
        </CollectionEditsContext.Provider>
      </ConfigValuesProvider>
    </ConfigContractContext.Provider>
  );
}

function row(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`li[data-endpoint-row="${name}"]`);
  if (!element) throw new Error(`no row for ${name}`);
  return element;
}

function openRow(name: string): HTMLElement {
  fireEvent.click(within(row(name)).getByRole('button', { name }));
  return screen.getByRole('dialog');
}

async function typeInto(selector: string, text: string) {
  const input = document.querySelector<HTMLInputElement>(selector);
  if (!input) throw new Error(`no ${selector}`);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
  await act(async () => {
    vi.runOnlyPendingTimers();
  });
}

describe('CustomEndpointsRenderer', () => {
  it('lists each endpoint with where it comes from and its host', () => {
    render(<Harness layers={baseLayers()} />);
    expect(within(row('GPT')).getByText('com_config_ce_source_yaml_overrides')).toBeInTheDocument();
    expect(within(row('Claude')).getByText('com_config_ce_source_yaml')).toBeInTheDocument();
    expect(within(row('Mine')).getByText('com_config_ce_source_admin')).toBeInTheDocument();
    expect(within(row('GPT')).getByText(/override\.example\.com/)).toBeInTheDocument();
    expect(within(row('Mine')).queryByText('com_config_ce_status_unserved')).toBeNull();
  });

  it('marks an endpoint LibreChat would not serve (CE-3)', () => {
    render(<Harness layers={baseLayers()} initial={[{ name: 'OnlyName' }]} />);
    expect(within(row('OnlyName')).getByText('com_config_ce_status_unserved')).toBeInTheDocument();
  });

  it('marks a saved endpoint the scope catalog says is not served, with why (catalogApi)', () => {
    const client = new QueryClient();
    client.setQueryData(['configCatalog', 'role', '__base__'], {
      endpoints: {
        Mine: { enabled: false, custom: true, envVars: [], reason: 'missing_api_key' },
        Claude: { enabled: true, custom: true, envVars: ['CH_API_KEY'] },
      },
    });
    const contract = createServerContract({ catalogApi: true });
    const { unmount } = render(
      <QueryClientProvider client={client}>
        <Harness layers={baseLayers()} contract={contract} />
      </QueryClientProvider>,
    );
    const chip = within(row('Mine')).getByText('com_config_ce_status_not_served');
    expect(chip).toHaveAttribute('title', 'com_config_providers_reason_missing_api_key');
    expect(within(row('Claude')).queryByText('com_config_ce_status_not_served')).toBeNull();
    expect(within(row('GPT')).queryByText('com_config_ce_status_not_served')).toBeNull();
    const edited = savedList(baseLayers()).map((entry) =>
      isConfigRecord(entry) && entry.name === 'Mine' ? { ...entry, apiKey: 'sk-new' } : entry,
    );
    unmount();
    render(
      <QueryClientProvider client={client}>
        <Harness layers={baseLayers()} contract={contract} initial={edited} />
      </QueryClientProvider>,
    );
    expect(within(row('Mine')).queryByText('com_config_ce_status_not_served')).toBeNull();
  });

  it('marks nothing not served on a server whose meta leaves catalogApi out', () => {
    const client = new QueryClient();
    client.setQueryData(['configCatalog', 'role', '__base__'], {
      endpoints: { Mine: { enabled: false, custom: true, envVars: [], reason: 'missing_api_key' } },
    });
    render(
      <QueryClientProvider client={client}>
        <Harness layers={baseLayers()} contract={createServerContract({})} />
      </QueryClientProvider>,
    );
    expect(within(row('Mine')).queryByText('com_config_ce_status_not_served')).toBeNull();
  });

  it('keeps the name of a librechat.yaml endpoint read-only and offers no delete (D1)', () => {
    render(<Harness layers={baseLayers()} />);
    const drawer = openRow('Claude');
    const name = drawer.querySelector('#endpoints-custom-1-name');
    expect(name?.tagName).not.toBe('INPUT');
    expect(name).toHaveTextContent('Claude');
    expect(
      within(drawer).queryByRole('button', { name: 'com_config_ce_action_delete' }),
    ).toBeNull();
  });

  it('reads a hidden librechat.yaml key as set where the server sends the mask (yamlSecretPreview)', () => {
    const { unmount } = render(<Harness layers={baseLayers()} />);
    openRow('Claude');
    expect(screen.getByText('com_config_ce_key_hidden')).toBeInTheDocument();
    unmount();
    const masked = (list: t.ConfigValue): t.ConfigValue =>
      Array.isArray(list)
        ? list.map((entry) =>
            isConfigRecord(entry) && entry.name === 'Claude'
              ? { ...entry, apiKeyPreview: '********' }
              : entry,
          )
        : list;
    const data = baseConfigFixture();
    const withMask = (root: t.ConfigRecord | undefined): t.ConfigRecord => {
      const endpoints = isConfigRecord(root?.endpoints) ? root.endpoints : {};
      return { ...root, endpoints: { ...endpoints, custom: masked(endpoints.custom) } };
    };
    const layers = baseLayersFixture({
      ...data,
      config: withMask(data.config),
      yamlConfig: withMask(data.yamlConfig),
    });
    render(
      <Harness layers={layers} contract={createServerContract({ yamlSecretPreview: true })} />,
    );
    openRow('Claude');
    expect(screen.queryByText('com_config_ce_key_hidden')).toBeNull();
    expect(screen.getByDisplayValue('com_config_secret_hidden_yaml')).toBeInTheDocument();
  });

  it('offers to send an inherited ${VAR} key to the base URL an edit moves it to (secretRebinding)', () => {
    const withGpt = (root: t.ConfigRecord, gpt: t.ConfigRecord): t.ConfigRecord => {
      const endpoints = isConfigRecord(root.endpoints) ? root.endpoints : {};
      const list = Array.isArray(endpoints.custom) ? endpoints.custom : [];
      const custom = list.map((entry) =>
        isConfigRecord(entry) && entry.name === 'GPT' ? { ...entry, ...gpt } : entry,
      );
      return { ...root, endpoints: { ...endpoints, custom } };
    };
    const yamlConfig = withGpt(baseConfigFixture().yamlConfig ?? {}, { apiKey: '${GPT_KEY}' });
    const contract = createServerContract({ secretRebinding: true });
    const ref = { path: 'endpoints.custom', entry: 'GPT', secret: 'apiKey' };
    const onRestate = vi.fn();
    const layers = baseLayersFixture(baseConfigFixture({ yamlConfig, config: yamlConfig }));
    const moved = savedList(layers).map((entry) =>
      isConfigRecord(entry) && entry.name === 'GPT'
        ? { ...entry, baseURL: 'https://proxy.example.com' }
        : entry,
    );
    const { unmount } = render(
      <RestatesContext.Provider value={{ restates: {}, onRestate }}>
        <Harness layers={layers} initial={moved} contract={contract} />
      </RestatesContext.Provider>,
    );
    const drawer = openRow('GPT');
    expect(within(drawer).getByText('com_config_secret_not_sent_restatable')).toBeInTheDocument();
    fireEvent.click(within(drawer).getByRole('button', { name: 'com_config_secret_restate' }));
    expect(onRestate).toHaveBeenCalledWith(ref, true);
    unmount();

    const own = { name: 'GPT', baseURL: 'https://proxy.example.com', apiKey: '${GPT_KEY}' };
    const restated = baseLayersFixture(
      baseConfigFixture({
        yamlConfig,
        dbOverrides: { endpoints: { custom: [own] } },
        config: withGpt(yamlConfig, own),
      }),
    );
    render(
      <RestatesContext.Provider value={{ restates: {}, onRestate }}>
        <Harness layers={restated} contract={contract} />
      </RestatesContext.Provider>,
    );
    const saved = openRow('GPT');
    expect(within(saved).queryByText('com_config_secret_not_sent_restatable')).toBeNull();
    expect(within(saved).queryByRole('button', { name: 'com_config_secret_restate' })).toBeNull();
  });

  it.each([
    ['as is (no yamlSecretPreview)', { apiKey: 'sk-yaml-literal-0123456789' }, {}],
    ['as the fixed mask', { apiKeyPreview: '********' }, { yamlSecretPreview: true }],
  ])(
    'asks for a key instead of offering to send an inherited literal one read back %s',
    (_label, key, flags) => {
      const yaml = baseConfigFixture().yamlConfig ?? {};
      const endpoints = isConfigRecord(yaml.endpoints) ? yaml.endpoints : {};
      const list = Array.isArray(endpoints.custom) ? endpoints.custom : [];
      const custom = list.map((entry) =>
        isConfigRecord(entry) && entry.name === 'GPT' ? { ...entry, ...key } : entry,
      );
      const yamlConfig = { ...yaml, endpoints: { ...endpoints, custom } };
      const contract = createServerContract({ secretRebinding: true, ...flags });
      const onRestate = vi.fn();
      const layers = baseLayersFixture(baseConfigFixture({ yamlConfig, config: yamlConfig }));
      const moved = savedList(layers).map((entry) =>
        isConfigRecord(entry) && entry.name === 'GPT'
          ? { ...entry, baseURL: 'https://proxy.example.com' }
          : entry,
      );
      render(
        <RestatesContext.Provider value={{ restates: {}, onRestate }}>
          <Harness layers={layers} initial={moved} contract={contract} />
        </RestatesContext.Provider>,
      );
      const drawer = openRow('GPT');
      expect(within(drawer).getByText('com_config_secret_not_sent')).toBeInTheDocument();
      expect(within(drawer).queryByText('com_config_secret_not_sent_restatable')).toBeNull();
      expect(
        within(drawer).queryByRole('button', { name: 'com_config_secret_restate' }),
      ).toBeNull();
      expect(onRestate).not.toHaveBeenCalled();
    },
  );

  it('lets an endpoint added in the panel be renamed and deleted', () => {
    const onChange = vi.fn();
    render(<Harness layers={baseLayers()} onChange={onChange} />);
    const drawer = openRow('Mine');
    expect(drawer.querySelector('input#endpoints-custom-2-name')).not.toBeDisabled();
    fireEvent.click(within(drawer).getByRole('button', { name: 'com_config_ce_action_delete' }));
    expect(onChange).toHaveBeenLastCalledWith('endpoints.custom', [
      expect.objectContaining({ name: 'GPT' }),
      expect.objectContaining({ name: 'Claude' }),
    ]);
  });

  it('leaves a cleared name editable when the layer beneath defines no endpoints', () => {
    const layers = baseLayersFixture(
      baseConfigFixture({ yamlConfig: {}, config: {}, yamlPaths: [], dbOverrides: {} }),
    );
    render(
      <Harness layers={layers} initial={[{ name: '', baseURL: 'https://x/v1', apiKey: 'k' }]} />,
    );
    fireEvent.click(document.querySelector('li[data-endpoint-row] button') as HTMLElement);
    expect(document.querySelector('input#endpoints-custom-0-name')).not.toBeDisabled();
  });

  it('lists a pending deletion from the edit state, with Undo (D9)', () => {
    const onChange = vi.fn();
    const layers = baseLayers();
    const saved = savedList(layers);
    const remaining = saved.slice(0, 2);
    const edits: t.CollectionEdits = {
      'endpoints.custom': {
        baseline: saved,
        origins: remaining.map((entry, i) => ({
          identity: ['GPT', 'Claude'][i],
          baseline: entry,
        })),
        detached: [{ value: saved[2], origin: { identity: 'Mine', baseline: saved[2] } }],
      },
    };
    render(
      <Harness layers={layers} initial={remaining} onChange={onChange} collectionEdits={edits} />,
    );
    expect(screen.getByText('com_config_ctl_entry_pending_delete')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'com_config_ctl_entry_undo_a11y:Mine' }));
    expect(onChange).toHaveBeenLastCalledWith('endpoints.custom', [...remaining, saved[2]]);
  });

  it('keeps a pending deletion the list filter matches listed, with Undo', () => {
    const layers = baseLayers();
    const saved = savedList(layers);
    const extra = ['E1', 'E2', 'E3', 'E4'].map((name) => ({ ...ADMIN_ENTRY, name }));
    const remaining = [...saved.slice(0, 2), ...extra];
    const edits: t.CollectionEdits = {
      'endpoints.custom': {
        baseline: saved,
        origins: remaining.map((entry, i) =>
          i < 2 ? { identity: ['GPT', 'Claude'][i], baseline: entry } : null,
        ),
        detached: [{ value: saved[2], origin: { identity: 'Mine', baseline: saved[2] } }],
      },
    };
    render(<Harness layers={layers} initial={remaining} collectionEdits={edits} />);
    fireEvent.change(screen.getByLabelText('com_config_ce_filter_a11y'), {
      target: { value: 'mine' },
    });
    expect(
      screen.getByRole('button', { name: 'com_config_ctl_entry_undo_a11y:Mine' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('com_config_ce_filter_a11y'), {
      target: { value: 'E1' },
    });
    expect(
      screen.queryByRole('button', { name: 'com_config_ctl_entry_undo_a11y:Mine' }),
    ).not.toBeInTheDocument();
  });

  it('restores an undone deletion relative to the surviving endpoints', () => {
    const onChange = vi.fn();
    const entry = (name: string): t.ConfigRecord => ({ ...ADMIN_ENTRY, name });
    const saved = [entry('A'), entry('B'), entry('C')];
    const layers = baseLayersFixture(
      baseConfigFixture({
        yamlConfig: {},
        config: {},
        yamlPaths: [],
        dbOverrides: { endpoints: { custom: saved } },
      }),
    );
    const remaining = [saved[2]];
    const edits: t.CollectionEdits = {
      'endpoints.custom': {
        baseline: saved,
        origins: [{ identity: 'C', baseline: saved[2] }],
        detached: [
          { value: saved[0], origin: { identity: 'A', baseline: saved[0] } },
          { value: saved[1], origin: { identity: 'B', baseline: saved[1] } },
        ],
      },
    };
    render(
      <Harness layers={layers} initial={remaining} onChange={onChange} collectionEdits={edits} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'com_config_ctl_entry_undo_a11y:B' }));
    expect(onChange).toHaveBeenLastCalledWith('endpoints.custom', [saved[1], saved[2]]);
    fireEvent.click(screen.getByRole('button', { name: 'com_config_ctl_entry_undo_a11y:A' }));
    expect(onChange).toHaveBeenLastCalledWith('endpoints.custom', saved);
  });

  it('opens an inherited endpoint read-only until it is overridden for the profile (CE-8)', () => {
    render(<Harness layers={scopeLayersFixture()} />);
    const drawer = openRow('Claude');
    const baseURL = () => drawer.querySelector('#endpoints-custom-1-baseURL');
    expect(baseURL()?.tagName).not.toBe('INPUT');
    fireEvent.click(within(drawer).getByRole('button', { name: 'com_config_ce_override_for' }));
    expect(baseURL()?.tagName).toBe('INPUT');
  });

  it('keeps a pending override of an inherited endpoint listed under "set values only"', () => {
    const layers = scopeLayersFixture();
    const saved = savedList(layers);
    const { rerender } = render(<Harness layers={layers} showConfiguredOnly />);
    expect(document.querySelector('li[data-endpoint-row="Claude"]')).toBeNull();
    const edited = saved.map((entry) =>
      isConfigRecord(entry) && entry.name === 'Claude'
        ? { ...entry, baseURL: 'https://edited.example.com' }
        : entry,
    );
    rerender(<Harness layers={layers} initial={edited} showConfiguredOnly key="edited" />);
    expect(row('Claude')).toBeInTheDocument();
  });

  it('keeps Create disabled until the endpoint can be served, then adds it', async () => {
    vi.useFakeTimers();
    try {
      const onChange = vi.fn();
      render(<Harness layers={baseLayers()} onChange={onChange} />);
      fireEvent.click(screen.getByRole('button', { name: 'com_config_create_endpoint' }));
      fireEvent.click(screen.getByRole('button', { name: /com_config_ce_template_blank_name/ }));
      const create = screen.getByRole('button', { name: 'com_config_ce_create' });
      expect(create).toBeDisabled();

      await typeInto('#endpoints-custom-9999-name', 'openAI');
      expect(screen.getByText('com_config_ce_issue_name_reserved')).toBeInTheDocument();
      await typeInto('#endpoints-custom-9999-name', 'New One');
      await typeInto('#endpoints-custom-9999-baseURL', 'https://new.example.com/v1');
      await typeInto('#endpoints-custom-9999-apiKey', '${NEW_KEY}');
      const models = document.querySelector<HTMLInputElement>(
        '#endpoints-custom-9999-models-default input:not([type="hidden"])',
      );
      if (!models) throw new Error('no model input');
      fireEvent.change(models, { target: { value: 'new-model' } });
      fireEvent.keyDown(models, { key: 'Enter' });
      await act(async () => {
        vi.runOnlyPendingTimers();
      });
      expect(create).not.toBeDisabled();
      fireEvent.click(create);
      expect(onChange).toHaveBeenLastCalledWith(
        'endpoints.custom',
        expect.arrayContaining([
          {
            name: 'New One',
            baseURL: 'https://new.example.com/v1',
            apiKey: '${NEW_KEY}',
            models: { default: ['new-model'] },
          },
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('CustomEndpointsRenderer — hiding inherited endpoints by key (keyedTombstones)', () => {
  const keyed = createServerContract({ keyedTombstones: true });
  const withSpec = baseConfigFixture({
    dbOverrides: {
      modelSpecs: {
        list: [{ name: 'gpt-spec', label: 'GPT spec', preset: { endpoint: 'GPT', model: 'm' } }],
      },
    },
  });

  function openMenu(name: string) {
    const trigger = within(row(name)).getByRole('button', {
      name: `com_config_ce_actions_a11y:${name}`,
    });
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
  }

  it('offers Hide for an endpoint the profile inherits, by its key', () => {
    const onHideField = vi.fn();
    render(
      <Harness
        layers={scopeLayersFixture()}
        contract={keyed}
        onHideField={onHideField}
        onUnhideField={vi.fn()}
      />,
    );
    openMenu('Claude');
    fireEvent.click(screen.getByRole('menuitem', { name: /com_config_ce_action_hide/ }));
    expect(onHideField).toHaveBeenCalledWith('endpoints.custom["Claude"]');
  });

  it('offers no Hide on a server that stores such a hide without effect, nor in Base', () => {
    const { unmount } = render(
      <Harness layers={scopeLayersFixture()} onHideField={vi.fn()} onUnhideField={vi.fn()} />,
    );
    openMenu('Claude');
    expect(screen.queryByRole('menuitem', { name: /com_config_ce_action_hide/ })).toBeNull();
    unmount();
    render(
      <Harness
        layers={baseLayers()}
        contract={keyed}
        onHideField={vi.fn()}
        onUnhideField={vi.fn()}
      />,
    );
    openMenu('GPT');
    expect(screen.queryByRole('menuitem', { name: /com_config_ce_action_hide/ })).toBeNull();
  });

  it('lists a hidden endpoint apart, with the model specs hidden with it, and unhides it', () => {
    const onUnhideField = vi.fn();
    const layers = scopeLayersFixture(
      scopeConfigFixture({ tombstones: ['endpoints.custom["GPT"]'] }),
      withSpec,
      true,
    );
    render(
      <Harness
        layers={layers}
        contract={keyed}
        onHideField={vi.fn()}
        onUnhideField={onUnhideField}
      />,
    );
    expect(document.querySelector('li[data-endpoint-row="GPT"]')).toBeNull();
    const hidden = document.querySelector<HTMLElement>('[data-endpoint-hidden="GPT"]');
    expect(hidden?.textContent).toContain('com_config_ce_hidden');
    expect(hidden?.textContent).toContain('com_config_ce_hidden_specs');
    fireEvent.click(
      within(hidden as HTMLElement).getByRole('button', { name: 'com_config_ce_unhide_a11y:GPT' }),
    );
    expect(onUnhideField).toHaveBeenCalledWith('endpoints.custom["GPT"]');
  });

  it('keeps the name of an endpoint shown again on save from a new endpoint', async () => {
    vi.useFakeTimers();
    try {
      const layers = scopeLayersFixture(
        scopeConfigFixture({ tombstones: ['endpoints.custom["GPT"]'] }),
        withSpec,
        true,
      );
      render(
        <Harness
          layers={layers}
          contract={keyed}
          visibilityEdits={{ 'endpoints.custom["GPT"]': 'unhide' }}
          onHideField={vi.fn()}
          onUnhideField={vi.fn()}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: 'com_config_create_endpoint' }));
      fireEvent.click(screen.getByRole('button', { name: /com_config_ce_template_blank_name/ }));
      await typeInto('#endpoints-custom-9999-name', 'GPT');
      expect(screen.getByText(/com_config_ce_issue_name_taken/)).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says nothing matches when the filter matches no row, removal or hidden endpoint', () => {
    const layers = scopeLayersFixture(
      scopeConfigFixture({ tombstones: ['endpoints.custom["GPT"]'] }),
      withSpec,
      true,
    );
    const extra = ['E1', 'E2', 'E3', 'E4', 'E5'].map((name) => ({ ...ADMIN_ENTRY, name }));
    render(
      <Harness
        layers={layers}
        initial={[...savedList(layers), ...extra]}
        contract={keyed}
        onHideField={vi.fn()}
        onUnhideField={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('com_config_ce_filter_a11y'), {
      target: { value: 'no such endpoint' },
    });
    expect(screen.getByRole('status').textContent).toContain('com_config_ce_filter_empty');
  });

  it('says when an allow-list names only the endpoints the profile hides, so it allows none', () => {
    const base = baseConfigFixture({
      dbOverrides: {
        modelSpecs: { addedEndpoints: ['agents', 'GPT'] },
        endpoints: { agents: { allowedProviders: ['GPT', 'Claude'] } },
      },
    });
    const layers = scopeLayersFixture(
      scopeConfigFixture({ tombstones: ['endpoints.custom["GPT"]'] }),
      base,
      true,
    );
    render(
      <Harness
        layers={layers}
        contract={keyed}
        visibilityEdits={{ 'endpoints.custom["Claude"]': 'hide' }}
        onHideField={vi.fn()}
        onUnhideField={vi.fn()}
      />,
    );
    const notesOf = (name: string) =>
      [...document.querySelectorAll(`[data-endpoint-hidden="${name}"] span`)].map(
        (span) => span.textContent,
      );
    for (const name of ['GPT', 'Claude']) {
      expect(notesOf(name)).toContain('com_config_ce_hidden_allowed_providers_only');
      expect(notesOf(name)).not.toContain('com_config_ce_hidden_allowed_providers');
    }
    expect(notesOf('GPT')).toContain('com_config_ce_hidden_added_endpoints');
    expect(notesOf('GPT')).not.toContain('com_config_ce_hidden_added_endpoints_only');
    expect(notesOf('Claude')).not.toContain('com_config_ce_hidden_added_endpoints');
  });

  it('moves an endpoint a pending hide hides out of the list, with Undo', () => {
    const onUnhideField = vi.fn();
    render(
      <Harness
        layers={scopeLayersFixture(scopeConfigFixture(), withSpec, true)}
        contract={keyed}
        visibilityEdits={{ 'endpoints.custom["GPT"]': 'hide' }}
        onHideField={vi.fn()}
        onUnhideField={onUnhideField}
      />,
    );
    expect(document.querySelector('li[data-endpoint-row="GPT"]')).toBeNull();
    const hidden = document.querySelector<HTMLElement>('[data-endpoint-hidden="GPT"]');
    expect(hidden?.textContent).toContain('com_config_ce_hidden_pending');
    fireEvent.click(
      within(hidden as HTMLElement).getByRole('button', {
        name: 'com_config_ce_hide_undo_a11y:GPT',
      }),
    );
    expect(onUnhideField).toHaveBeenCalledWith('endpoints.custom["GPT"]');
  });

  it('offers to remove an inherited header by key, and lists a saved removal with Restore', () => {
    const onHideField = vi.fn();
    const onUnhideField = vi.fn();
    const base = baseConfigFixture({
      dbOverrides: {
        endpoints: { custom: [{ name: 'Claude', headers: { 'X-Team': 'blue', 'X-Org': 'acme' } }] },
      },
    });
    const layers = scopeLayersFixture(
      scopeConfigFixture({ tombstones: ['endpoints.custom["Claude"].headers.X-Org'] }),
      base,
      true,
    );
    render(
      <Harness
        layers={layers}
        contract={keyed}
        onHideField={onHideField}
        onUnhideField={onUnhideField}
      />,
    );
    const drawer = openRow('Claude');
    const removed = drawer.querySelector<HTMLElement>('[data-kv-removed="X-Org"]');
    expect(removed?.textContent).toContain('com_config_ctl_kv_removed');
    fireEvent.click(
      within(removed as HTMLElement).getByRole('button', {
        name: 'com_config_ctl_kv_restore_a11y',
      }),
    );
    expect(onUnhideField).toHaveBeenCalledWith('endpoints.custom["Claude"].headers.X-Org');
    fireEvent.click(
      within(drawer).getByRole('button', { name: 'com_config_ctl_kv_remove_inherited' }),
    );
    expect(onHideField).toHaveBeenCalledWith('endpoints.custom["Claude"].headers.X-Team');
  });

  describe('a removed header the profile sets again itself', () => {
    const base = baseConfigFixture({
      dbOverrides: {
        endpoints: { custom: [{ name: 'Claude', headers: { 'X-Team': 'blue', 'X-Org': 'acme' } }] },
      },
    });
    const removal = 'endpoints.custom["Claude"].headers.X-Org';
    const profileWith = (headers: t.ConfigRecord) =>
      scopeLayersFixture(
        scopeConfigFixture({
          overrides: { endpoints: { custom: [{ name: 'Claude', headers }] } },
          changedPaths: ['endpoints.custom'],
          tombstones: [removal],
        }),
        base,
        true,
      );
    const claudeOf = (onChange: ReturnType<typeof vi.fn>): t.ConfigRecord => {
      const calls = onChange.mock.calls.filter((call) => call[0] === 'endpoints.custom.1');
      return deepSerializeKVPairs(calls[calls.length - 1]?.[1] ?? {}) as t.ConfigRecord;
    };

    it('is its own value: Delete removes it, and the saved removal applies again', () => {
      const onChange = vi.fn();
      const onHideField = vi.fn();
      const onUnhideField = vi.fn();
      render(
        <Harness
          layers={profileWith({ 'X-Org': 'mine' })}
          contract={keyed}
          onChange={onChange}
          onHideField={onHideField}
          onUnhideField={onUnhideField}
        />,
      );
      const drawer = openRow('Claude');
      expect(drawer.querySelector('[data-kv-removed="X-Org"]')).toBeNull();
      expect(
        within(drawer).getAllByRole('button', { name: 'com_config_ctl_kv_remove_inherited' }),
      ).toHaveLength(1);
      fireEvent.click(within(drawer).getByRole('button', { name: 'com_ui_delete X-Org' }));
      expect(onUnhideField).not.toHaveBeenCalled();
      expect(onHideField).not.toHaveBeenCalled();
      expect(claudeOf(onChange).headers).toEqual({ 'X-Team': 'blue' });
      const removed = drawer.querySelector<HTMLElement>('[data-kv-removed="X-Org"]');
      expect(removed?.textContent).toContain('com_config_ctl_kv_removed');
    });

    it('stays removed when the profile reverts its Headers', () => {
      const onChange = vi.fn();
      render(
        <Harness
          layers={profileWith({ 'X-Own': 'o' })}
          contract={keyed}
          onChange={onChange}
          onHideField={vi.fn()}
          onUnhideField={vi.fn()}
        />,
      );
      const drawer = openRow('Claude');
      const reverts = within(drawer).getAllByRole('button', {
        name: /com_config_values_revert_inherited_aria/,
      });
      expect(reverts).toHaveLength(1);
      fireEvent.click(reverts[0]);
      expect(claudeOf(onChange).headers).toEqual({ 'X-Team': 'blue' });
      const removed = drawer.querySelector<HTMLElement>('[data-kv-removed="X-Org"]');
      expect(removed?.textContent).toContain('com_config_ctl_kv_removed');
    });
  });

  it('keeps inherited headers locked on a server without keyed tombstones', () => {
    const base = baseConfigFixture({
      dbOverrides: { endpoints: { custom: [{ name: 'Claude', headers: { 'X-Team': 'blue' } }] } },
    });
    render(
      <Harness
        layers={scopeLayersFixture(scopeConfigFixture(), base)}
        onHideField={vi.fn()}
        onUnhideField={vi.fn()}
      />,
    );
    const drawer = openRow('Claude');
    fireEvent.click(within(drawer).getByRole('button', { name: 'com_config_ce_override_for' }));
    expect(drawer.querySelector('input[data-kv-part="key"]')).toHaveProperty('value', 'X-Team');
    expect(
      within(drawer).queryByRole('button', { name: 'com_config_ctl_kv_remove_inherited' }),
    ).toBeNull();
  });
});
