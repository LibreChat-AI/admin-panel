import { configSchema } from 'librechat-data-provider';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { ProvidersRenderer } from '../ProvidersRenderer';
import { createServerContract } from '@/test/fixtures';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { extractSchemaTree } from '@/server/config';
import { getValueAtPath } from '@/utils';

vi.mock('@/hooks/useLocalize', () => {
  const localize = (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${JSON.stringify(vars)}` : key;
  return { default: () => localize, useLocalize: () => localize };
});

const tree = extractSchemaTree(configSchema as t.ZodSchemaLike);
const endpointFields = tree.find((field) => field.key === 'endpoints')?.children ?? [];

const CONFIG: t.ConfigRecord = {
  endpoints: {
    all: { activityModel: 'gpt-5.6-luna' },
    openAI: { titleModel: 'gpt-5-mini', activityModel: 'gpt-x' },
    agents: { recursionLimit: 50, capabilities: ['tools', 'web_search'] },
    azureOpenAI: {
      groups: [
        {
          group: 'eastus',
          apiKey: '${EASTUS_API_KEY}',
          instanceName: 'librechat-eastus',
          version: '2024-02-15-preview',
          models: { 'gpt-4.1': { deploymentName: 'gpt-41' }, 'gpt-4o': true },
          serverless: false,
          assistants: true,
        },
        { group: 'foundry', apiKey: 'sk-literal', baseURL: 'https://f/models', serverless: true },
      ],
    },
  },
};

const CONFIGURED = new Set([
  'endpoints.all.activityModel',
  'endpoints.openAI.titleModel',
  'endpoints.openAI.activityModel',
  'endpoints.agents.recursionLimit',
  'endpoints.agents.capabilities',
  'endpoints.azureOpenAI.groups',
]);

const STATUS: t.EndpointStatusMap = {
  openAI: { name: 'openAI', custom: false, userProvide: false },
  agents: { name: 'agents', custom: false, userProvide: false },
};

function renderProviders(
  overrides: Partial<t.FieldRendererProps> = {},
  titleResolution?: t.ConfigRules['titleResolution'],
  contract: t.ConfigContract = BUNDLED_CONFIG_CONTRACT,
  seed?: (client: QueryClient) => void,
) {
  const client = new QueryClient();
  client.setQueryData(['endpointStatus', 0], STATUS);
  client.setQueryData(['endpointModels', 0], { openAI: ['gpt-5-mini', 'gpt-5'] });
  seed?.(client);
  const onChange = vi.fn();
  const values: t.ConfigValuesData = { configValues: CONFIG, editedValues: {}, titleResolution };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ConfigContractContext.Provider value={contract}>
        <ConfigValuesProvider value={values}>{children}</ConfigValuesProvider>
      </ConfigContractContext.Provider>
    </QueryClientProvider>
  );
  const utils = render(
    <ProvidersRenderer
      fields={endpointFields}
      parentPath="endpoints"
      parentValue={CONFIG.endpoints}
      getValue={(path, fallback) => fallback ?? getValueAtPath(CONFIG, path)}
      onChange={onChange}
      configuredPaths={CONFIGURED}
      editedValues={{}}
      {...overrides}
    />,
    { wrapper },
  );
  return { ...utils, onChange };
}

const card = (key: string) => document.getElementById(`section-endpoints.${key}`) as HTMLElement;
const trigger = (key: string) =>
  card(key).querySelector('.settings-section-trigger') as HTMLButtonElement;

beforeEach(() => {
  localStorage.clear();
});

describe('ProvidersRenderer', () => {
  it('pins Global overrides first and Network access last, all collapsed', () => {
    renderProviders();
    const ids = [...document.querySelectorAll('section[data-settings-section]')].map((s) => s.id);
    expect(ids[0]).toBe('section-endpoints.all');
    expect(ids[ids.length - 1]).toBe('section-endpoints.allowedAddresses');
    expect(ids).not.toContain('section-endpoints.custom');
    for (const button of document.querySelectorAll('.settings-section-trigger')) {
      expect(button.getAttribute('aria-expanded')).toBe('false');
    }
  });

  it('shows Active / Not enabled from /api/endpoints in provider headers', () => {
    renderProviders();
    expect(within(card('openAI')).getByText('com_config_providers_status_active')).toBeTruthy();
    expect(within(card('google')).getByText('com_config_providers_status_disabled')).toBeTruthy();
    expect(within(card('all')).queryByText(/com_config_providers_status_/)).toBeNull();
  });

  it("reads status from the scope catalog, with why a provider is not served and its env names' status", () => {
    const contract = createServerContract({ catalogApi: true, envStatus: true });
    const { container } = renderProviders({}, undefined, contract, (client) => {
      client.setQueryData(['configCatalog', 'role', '__base__'], {
        status: { anthropic: { name: 'anthropic', custom: false, userProvide: false } },
        endpoints: {
          anthropic: { enabled: true, custom: false, envVars: ['ANTHROPIC_API_KEY'] },
          google: {
            enabled: false,
            custom: false,
            envVars: ['GOOGLE_KEY', 'GOOGLE_SERVICE_KEY_FILE'],
            reason: 'not_listed',
          },
        },
        models: { anthropic: ['claude-opus-5-5', 'claude-haiku-4-5'] },
      });
      client.setQueryData(['envStatus'], {
        GOOGLE_KEY: { set: true, userProvided: false, sources: ['endpoint'] },
        GOOGLE_SERVICE_KEY_FILE: { set: false, userProvided: false, sources: ['endpoint'] },
      });
    });
    expect(within(card('anthropic')).getByText('com_config_providers_status_active')).toBeTruthy();
    expect(within(card('openAI')).getByText('com_config_providers_status_disabled')).toBeTruthy();
    const badge = card('google').querySelector('.provider-status') as HTMLElement;
    expect(badge.getAttribute('title')).toContain('com_config_providers_reason_not_listed');
    fireEvent.click(trigger('google'));
    const row = card('google').querySelector('.provider-status-row') as HTMLElement;
    expect(within(row).getByText(/com_config_providers_reason_not_listed/)).toBeTruthy();
    expect(within(row).queryByText('com_config_providers_status_endpoints_note')).toBeNull();
    const env = [...row.querySelectorAll('[data-env-state]')].map((item) => [
      item.querySelector('code')?.textContent,
      item.getAttribute('data-env-state'),
    ]);
    expect(env).toEqual([
      ['GOOGLE_KEY', 'set'],
      ['GOOGLE_SERVICE_KEY_FILE', 'unset'],
    ]);
    expect(row.querySelector('[data-env-state="unset"]')?.textContent).toContain(
      'com_config_env_state_unset_optional',
    );
    fireEvent.click(trigger('anthropic'));
    const anthropic = card('anthropic').querySelector('.provider-status-row') as HTMLElement;
    expect(within(anthropic).getByText(/com_config_providers_status_models/)).toBeTruthy();
    expect(container.querySelectorAll('[data-env-state="unreported"]')).toHaveLength(1);
  });

  it('reads status from the end-user routes on a server whose meta leaves catalogApi out', () => {
    const contract = createServerContract({ envStatus: true });
    const { container } = renderProviders({}, undefined, contract, (client) => {
      client.setQueryData(['configCatalog', 'role', '__base__'], {
        status: { anthropic: { name: 'anthropic', custom: false, userProvide: false } },
        endpoints: {
          google: { enabled: false, custom: false, envVars: ['GOOGLE_KEY'], reason: 'not_listed' },
        },
      });
      client.setQueryData(['envStatus'], {
        GOOGLE_KEY: { set: true, userProvided: false, sources: ['endpoint'] },
      });
    });
    expect(within(card('openAI')).getByText('com_config_providers_status_active')).toBeTruthy();
    expect(
      within(card('anthropic')).getByText('com_config_providers_status_disabled'),
    ).toBeTruthy();
    fireEvent.click(trigger('google'));
    const row = card('google').querySelector('.provider-status-row') as HTMLElement;
    expect(within(row).queryByText(/com_config_providers_reason_/)).toBeNull();
    expect(within(row).getByText('com_config_providers_status_endpoints_note')).toBeTruthy();
    expect(container.querySelectorAll('[data-env-state]')).toHaveLength(0);
  });

  it('summarizes a collapsed card, flagging values Global takes precedence over', () => {
    renderProviders();
    const summary = card('openAI').querySelector('.settings-help') as HTMLElement;
    expect(summary.textContent).toContain('gpt-5-mini');
    expect(summary.textContent).toContain('com_config_providers_summary_shadowed');
  });

  it('remembers which provider was open across remounts (AP-8)', () => {
    const first = renderProviders();
    fireEvent.click(trigger('openAI'));
    expect(trigger('openAI')).toHaveAttribute('aria-expanded', 'true');
    first.unmount();
    renderProviders();
    expect(trigger('openAI')).toHaveAttribute('aria-expanded', 'true');
    expect(trigger('anthropic')).toHaveAttribute('aria-expanded', 'false');
  });

  it("explains in a provider's title group that Global settings win (D11)", () => {
    renderProviders();
    fireEvent.click(trigger('openAI'));
    const titles = document.getElementById('section-endpoints.openAI-titles') as HTMLElement;
    expect(within(titles).getByText(/com_config_providers_global_titles_banner/)).toBeTruthy();
    expect(within(titles).getByText('com_config_providers_summary_ignored')).toBeTruthy();
  });

  it('leaves title settings to each provider on a server that resolves them per field', () => {
    renderProviders({}, 'field');
    const summary = card('openAI').querySelector('.settings-help') as HTMLElement;
    expect(summary.textContent).toContain('gpt-5-mini');
    expect(summary.textContent).not.toContain('com_config_providers_summary_shadowed_ignored');
    expect(card('all').textContent).toContain('com_config_providers_global_desc_field');
    fireEvent.click(trigger('openAI'));
    const titles = document.getElementById('section-endpoints.openAI-titles') as HTMLElement;
    expect(within(titles).queryByText(/com_config_providers_global_titles_banner/)).toBeNull();
    expect(within(titles).queryByText('com_config_providers_summary_ignored')).toBeNull();
  });

  it('opens Agent features first, with capability descriptions and paired limits', () => {
    renderProviders();
    fireEvent.click(trigger('agents'));
    const features = document.getElementById('section-endpoints.agents-features') as HTMLElement;
    expect(features.querySelector('[aria-expanded="true"]')).toBeTruthy();
    expect(within(features).getByText('Web search')).toBeTruthy();
    expect(within(features).getByText('com_config_providers_cap_web_search_desc')).toBeTruthy();
    expect(features.querySelectorAll('.provider-pair')).toHaveLength(2);
    const citations = document.getElementById('section-endpoints.agents-citations') as HTMLElement;
    expect(citations.querySelector('[aria-expanded="false"]')).toBeTruthy();
  });

  it('says when the max recursion limit caps the recursion limit', () => {
    const limits = {
      ...CONFIG,
      endpoints: { agents: { recursionLimit: 75, maxRecursionLimit: 60 } },
    };
    renderProviders({ getValue: (path, fallback) => fallback ?? getValueAtPath(limits, path) });
    fireEvent.click(trigger('agents'));
    const features = document.getElementById('section-endpoints.agents-features') as HTMLElement;
    expect(
      within(features).getByText('com_config_providers_recursion_capped:{"max":60,"limit":75}'),
    ).toBeTruthy();
  });

  it('shows Azure groups read-only, with a drawer that never shows a key', () => {
    renderProviders();
    fireEvent.click(trigger('azureOpenAI'));
    const azure = card('azureOpenAI');
    expect(within(azure).getByText('com_config_providers_azure_readonly')).toBeTruthy();
    expect(within(azure).getByText('com_config_providers_groups:{"count":2}')).toBeTruthy();
    fireEvent.click(
      within(azure).getByRole('button', {
        name: 'com_config_providers_azure_details_aria:{"group":"foundry"}',
      }),
    );
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('com_config_providers_azure_masked')).toBeTruthy();
    expect(drawer.textContent).not.toContain('sk-literal');
    fireEvent.click(
      within(drawer).getByRole('button', { name: 'com_config_providers_azure_close' }),
    );
    fireEvent.click(
      within(azure).getByRole('button', {
        name: 'com_config_providers_azure_details_aria:{"group":"eastus"}',
      }),
    );
    const eastus = screen.getByRole('dialog');
    expect(within(eastus).getByText(/EASTUS_API_KEY/)).toBeTruthy();
    expect(within(eastus).getByText('gpt-4.1')).toBeTruthy();
  });

  it('validates network addresses as they are typed and saves valid ones', () => {
    const { onChange } = renderProviders();
    fireEvent.click(trigger('allowedAddresses'));
    const network = card('allowedAddresses');
    fireEvent.click(within(network).getByRole('button', { name: /com_ui_add_item/ }));
    const input = within(network).getByPlaceholderText('com_config_providers_network_placeholder');
    fireEvent.change(input, { target: { value: 'localhost' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(network).getByRole('alert').textContent).toBe(
      'com_config_providers_network_issue_port',
    );
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: 'localhost:11434' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('endpoints.allowedAddresses', ['localhost:11434']);
  });

  it('hides providers with nothing set when only set values are shown', () => {
    renderProviders({ showConfiguredOnly: true });
    expect(card('openAI')).toBeTruthy();
    expect(card('google')).toBeNull();
    expect(card('allowedAddresses')).toBeNull();
  });

  it('keeps configured Azure groups and their table when only set values are shown', () => {
    renderProviders({ showConfiguredOnly: true });
    fireEvent.click(trigger('azureOpenAI'));
    const groups = document.getElementById('section-endpoints.azureOpenAI-groups') as HTMLElement;
    expect(groups).toBeTruthy();
    expect(within(groups).getByText('com_config_providers_azure_readonly')).toBeTruthy();
    expect(
      within(groups).getByRole('button', {
        name: 'com_config_providers_azure_details_aria:{"group":"eastus"}',
      }),
    ).toBeTruthy();
    expect(document.getElementById('endpoints-azureOpenAI-groups')).toHaveClass('azure-groups');
  });

  it('calls a stored Azure groups override stale, unless the server applies it (azureGroupSecrets)', () => {
    const overrides = { dbOverridePaths: new Set(['endpoints.azureOpenAI.groups']) };
    const { unmount } = renderProviders(overrides);
    fireEvent.click(trigger('azureOpenAI'));
    expect(screen.getByText('com_config_providers_azure_stale')).toBeTruthy();
    unmount();
    renderProviders(overrides, undefined, createServerContract({ azureGroupSecrets: true }));
    fireEvent.click(trigger('azureOpenAI'));
    expect(screen.getByText('com_config_providers_azure_readonly_applied')).toBeTruthy();
    expect(screen.getByText('com_config_providers_azure_override_applied')).toBeTruthy();
    expect(screen.queryByText('com_config_providers_azure_stale')).toBeNull();
  });

  it('keeps unsaved values of unset settings reachable when only set values are shown', () => {
    const edits: t.FlatConfigMap = {
      'endpoints.openAI.streamRate': 50,
      'endpoints.openAI.titleMethod': 'structured',
      'endpoints.google.titleModel': 'gemini-x',
    };
    renderProviders({
      showConfiguredOnly: true,
      editedValues: edits,
      getValue: (path, fallback) =>
        path in edits ? edits[path] : (fallback ?? getValueAtPath(CONFIG, path)),
    });
    expect(card('google')).toBeTruthy();
    fireEvent.click(trigger('openAI'));
    const streaming = document.getElementById('section-endpoints.openAI-streaming') as HTMLElement;
    expect(streaming).toBeTruthy();
    expect(document.getElementById('section-endpoints.openAI-reasoning')).toBeNull();
    fireEvent.click(streaming.querySelector('.settings-trigger') as HTMLButtonElement);
    expect(document.getElementById('endpoints-openAI-streamRate')).toBeTruthy();
    expect(document.getElementById('endpoints-openAI-maxToolResultChars')).toBeNull();
    const titles = document.getElementById('section-endpoints.openAI-titles') as HTMLElement;
    fireEvent.click(titles.querySelector('.settings-trigger') as HTMLButtonElement);
    expect(within(titles).getByText('Structured', { exact: false })).toBeTruthy();
    expect(document.getElementById('endpoints-openAI-titleModel')).toBeTruthy();
    expect(document.getElementById('endpoints-openAI-titlePrompt')).toBeNull();
  });
});
