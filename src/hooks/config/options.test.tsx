import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  useModelSource,
  useOptionSources,
  useEndpointModels,
  buildEndpointOptions,
  useModelListDefaults,
  useCustomEndpointNames,
} from './options';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';

vi.mock('@/hooks/useLocalize', () => ({
  useLocalize: () => (key: string) =>
    key.startsWith('com_config_field_') ? key.slice('com_config_field_'.length).toUpperCase() : key,
}));

const configValues: t.ConfigRecord = {
  endpoints: { custom: [{ name: 'Moonshot' }, { name: '' }, { name: 'Ollama' }] },
  mcpServers: { github: { url: 'https://x' }, files: { command: 'npx' } },
  modelSpecs: {
    list: [
      { name: 'a', group: 'Fast' },
      { name: 'b', group: 'Fast' },
      { name: 'c', group: 'Deep' },
      { name: 'd' },
    ],
  },
};

const values: t.ConfigValuesData = { configValues, editedValues: {} };

function withValues({ children }: { children: ReactNode }) {
  return <ConfigValuesProvider value={values}>{children}</ConfigValuesProvider>;
}

function withClient(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ConfigValuesProvider value={values}>{children}</ConfigValuesProvider>
    </QueryClientProvider>
  );
}

const valuesOf = (options: t.SelectOption[]) => options.map((option) => option.value);

describe('useOptionSources without a query client', () => {
  it('derives MCP servers and spec groups from the shown configuration', () => {
    const mcp = renderHook(() => useOptionSources('mcpServers'), { wrapper: withValues });
    expect(valuesOf(mcp.result.current.options)).toEqual(['github', 'files']);
    const groups = renderHook(() => useOptionSources('specGroups'), { wrapper: withValues });
    expect(valuesOf(groups.result.current.options)).toEqual(['Fast', 'Deep']);
    expect(groups.result.current.isLoading).toBe(false);
  });

  it('lists built-in providers and named custom endpoints', () => {
    const { result } = renderHook(() => useOptionSources('endpoints'), { wrapper: withValues });
    const options = valuesOf(result.current.options);
    expect(options.slice(0, 2)).toEqual(['openAI', 'google']);
    expect(options).toContain('Moonshot');
    expect(options).toContain('ollama');
    expect(options).not.toContain('');
  });

  it('leaves agents and the Assistants endpoints out of providers', () => {
    const { result } = renderHook(() => useOptionSources('providers'), { wrapper: withValues });
    const options = valuesOf(result.current.options);
    expect(options).toEqual([
      'openAI',
      'google',
      'anthropic',
      'azureOpenAI',
      'bedrock',
      'Moonshot',
      'ollama',
    ]);
  });

  it('names each custom endpoint once', () => {
    const data: t.ConfigValuesData = {
      configValues: { endpoints: { custom: [{ name: 'A' }, { name: 'A' }, { name: ' ' }, {}] } },
      editedValues: {},
    };
    const { result } = renderHook(() => useCustomEndpointNames(), {
      wrapper: ({ children }) => (
        <ConfigValuesProvider value={data}>{children}</ConfigValuesProvider>
      ),
    });
    expect(result.current).toEqual(['A']);
  });

  it('has no models and does not fetch', () => {
    const { result } = renderHook(() => useOptionSources('models:anthropic'), {
      wrapper: withValues,
    });
    expect(result.current).toEqual({ options: [], isLoading: false });
  });

  it('returns nothing for no source', () => {
    const { result } = renderHook(() => useOptionSources(undefined), { wrapper: withValues });
    expect(result.current.options).toEqual([]);
  });
});

describe('useOptionSources with server data', () => {
  it("offers an endpoint's models from /api/models", () => {
    const client = new QueryClient();
    client.setQueryData(['endpointModels', 0], { anthropic: ['claude-opus-5-5', 'claude-haiku'] });
    const { result } = renderHook(() => useOptionSources('models:anthropic'), {
      wrapper: withClient(client),
    });
    expect(valuesOf(result.current.options)).toEqual(['claude-opus-5-5', 'claude-haiku']);
    const unknown = renderHook(() => useOptionSources('models:nope'), {
      wrapper: withClient(client),
    });
    expect(unknown.result.current.options).toEqual([]);
    client.setQueryData(['endpointModels', 0], { ollama: ['llama3'] });
    const normalized = renderHook(() => useOptionSources('models:Ollama'), {
      wrapper: withClient(client),
    });
    expect(valuesOf(normalized.result.current.options)).toEqual(['llama3']);
  });

  it('lists served endpoints first, then the configured ones it leaves out', () => {
    const client = new QueryClient();
    client.setQueryData(['endpointStatus', 0], {
      agents: { name: 'agents', custom: false, userProvide: false },
      Moonshot: { name: 'Moonshot', custom: true, userProvide: false },
    });
    const { result } = renderHook(() => useOptionSources('endpoints'), {
      wrapper: withClient(client),
    });
    const options = valuesOf(result.current.options);
    expect(options.slice(0, 3)).toEqual(['agents', 'Moonshot', 'openAI']);
    expect(options.filter((name) => name === 'Moonshot')).toHaveLength(1);
    const providers = renderHook(() => useOptionSources('providers'), {
      wrapper: withClient(client),
    });
    expect(valuesOf(providers.result.current.options).slice(0, 2)).toEqual(['Moonshot', 'openAI']);
  });

  it('exposes the models map for model list defaults', () => {
    const client = new QueryClient();
    client.setQueryData(['endpointModels', 0], { bedrock: ['a'] });
    const { result } = renderHook(() => useEndpointModels(), { wrapper: withClient(client) });
    expect(result.current.data).toEqual({ bedrock: ['a'] });
    expect(result.current.isLoading).toBe(false);
  });
});

describe('buildEndpointOptions', () => {
  it('offers a custom endpoint LibreChat serves under a normalized name once, by its served key', () => {
    const status: t.EndpointStatusMap = {
      ollama: { name: 'ollama', custom: true, userProvide: false },
    };
    const root = { endpoints: { custom: [{ name: 'Ollama' }] } };
    const options = buildEndpointOptions(status, root, (key) => key);
    expect(options.filter((option) => option.value.toLowerCase() === 'ollama')).toEqual([
      { value: 'ollama', label: 'Ollama (ollama)' },
    ]);
    expect(options[0].value).toBe('ollama');
  });

  it('offers it as written on a server that folds endpoint references', () => {
    const status: t.EndpointStatusMap = {
      ollama: { name: 'ollama', custom: true, userProvide: false },
    };
    const root = { endpoints: { custom: [{ name: 'Ollama' }] } };
    const options = buildEndpointOptions(status, root, (key) => key, false, true);
    expect(options[0]).toEqual({ value: 'ollama', label: 'Ollama' });
  });

  it('keeps endpoints whose names differ only in letter case apart (LibreChat serves both)', () => {
    const status: t.EndpointStatusMap = {
      Perplexity: { name: 'Perplexity', custom: true, userProvide: false },
      perplexity: { name: 'perplexity', custom: true, userProvide: false },
    };
    const root = { endpoints: { custom: [{ name: 'Perplexity' }, { name: 'perplexity' }] } };
    const values = buildEndpointOptions(status, root, (key) => key).map((option) => option.value);
    expect(values.filter((value) => value.toLowerCase() === 'perplexity')).toEqual([
      'Perplexity',
      'perplexity',
    ]);
  });

  it('labels built-in providers with their display name and key', () => {
    const options = buildEndpointOptions(undefined, null, (key) =>
      key === 'com_config_field_openAI' ? 'OpenAI' : key,
    );
    expect(options[0]).toEqual({ value: 'openAI', label: 'OpenAI (openAI)' });
  });
});

describe('useModelSource', () => {
  const withEndpoint = (endpoint?: string) => {
    const data: t.ConfigValuesData = {
      configValues: {
        endpoints: {
          anthropic: { titleEndpoint: endpoint, activityEndpoint: 'Azure Foundry' },
        },
      },
      editedValues: {},
    };
    return ({ children }: { children: ReactNode }) => (
      <ConfigValuesProvider value={data}>{children}</ConfigValuesProvider>
    );
  };

  it("suggests the models of the endpoint a model field's sibling names", () => {
    const { result } = renderHook(
      () => useModelSource('models:anthropic', 'endpoints.anthropic.titleModel'),
      { wrapper: withEndpoint('OpenRouter') },
    );
    expect(result.current).toBe('models:OpenRouter');
  });

  it("falls back to the activity endpoint, then the field's own source", () => {
    const phase = renderHook(
      () => useModelSource('models:anthropic', 'endpoints.anthropic.activityPhaseModel'),
      { wrapper: withEndpoint() },
    );
    expect(phase.result.current).toBe('models:Azure Foundry');
    const title = renderHook(
      () => useModelSource('models:anthropic', 'endpoints.anthropic.titleModel'),
      { wrapper: withEndpoint('  ') },
    );
    expect(title.result.current).toBe('models:anthropic');
    const other = renderHook(() => useModelSource('endpoints', 'endpoints.anthropic.titleModel'), {
      wrapper: withEndpoint('X'),
    });
    expect(other.result.current).toBe('endpoints');
  });
});

describe('useModelListDefaults', () => {
  it("shows the API's models as defaults only while no list is saved", () => {
    const client = new QueryClient();
    client.setQueryData(['endpointModels', 0], { anthropic: ['a', 'b'] });
    const unset = renderHook(
      () => useModelListDefaults('endpoints.anthropic.models', 'models:anthropic'),
      { wrapper: withClient(client) },
    );
    expect(unset.result.current).toEqual({ defaults: ['a', 'b'], suggestions: ['a', 'b'] });

    const saved: t.ConfigValuesData = {
      configValues: { endpoints: { anthropic: { models: ['a'] } } },
      editedValues: {},
      overridePaths: new Set(['endpoints.anthropic.models']),
    };
    const set = renderHook(
      () => useModelListDefaults('endpoints.anthropic.models', 'models:anthropic'),
      {
        wrapper: ({ children }: { children: ReactNode }) => (
          <QueryClientProvider client={client}>
            <ConfigValuesProvider value={saved}>{children}</ConfigValuesProvider>
          </QueryClientProvider>
        ),
      },
    );
    expect(set.result.current).toEqual({ suggestions: ['a', 'b'] });
  });
});
