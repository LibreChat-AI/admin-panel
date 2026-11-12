import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { PrincipalType } from 'librechat-data-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type * as t from '@/types';
import {
  useOptionSources,
  useEndpointStatus,
  useEndpointModels,
  useEditPrincipal,
  useCatalogEndpoint,
  useModelListDefaults,
} from './options';
import { ConfigValuesProvider } from '@/contexts/ConfigValuesContext';
import { ConfigContractContext } from '@/contexts/ContractContext';
import { ScopeActionsContext } from '@/contexts/ScopeContext';
import { createServerContract } from '@/test/fixtures';
import { BUNDLED_CONFIG_CONTRACT } from '@/constants';
import { getScopeIndex } from '@/utils';

vi.mock('@/hooks/useLocalize', () => ({
  useLocalize: () => (key: string) => key,
}));

const CATALOG_ON = createServerContract({ catalogApi: true });

const USER_ROLE: t.ConfigScope = {
  principalType: PrincipalType.ROLE,
  principalId: 'USER',
  name: 'USER',
  priority: 10,
  isActive: true,
};

/** What Base serves, as `toConfigCatalog` reads it. */
const BASE_CATALOG: t.ConfigCatalog = {
  status: {
    openAI: { name: 'openAI', custom: false, userProvide: false },
    ollama: { name: 'ollama', custom: true, userProvide: false },
  },
  endpoints: {
    openAI: { enabled: true, custom: false, envVars: ['OPENAI_API_KEY'] },
    assistants: {
      enabled: false,
      custom: false,
      envVars: ['ASSISTANTS_API_KEY'],
      reason: 'missing_credentials',
    },
    ollama: { enabled: true, custom: true, envVars: [] },
  },
  models: { openAI: ['gpt-5', 'gpt-4.1'], ollama: ['llama3'] },
  modelLists: {
    openAI: { served: ['gpt-5'], configured: ['gpt-5'], defaults: ['gpt-5', 'gpt-4.1'] },
    ollama: { served: ['llama3'], configured: ['llama3'] },
  },
  tools: [{ value: 'google', label: 'Google' }],
};

/** What the USER role serves: its profile hides openAI. */
const USER_CATALOG: t.ConfigCatalog = {
  status: { anthropic: { name: 'anthropic', custom: false, userProvide: true } },
  endpoints: { openAI: { enabled: false, custom: false, envVars: [], reason: 'not_listed' } },
  models: { anthropic: ['claude-opus-5-5'] },
  modelLists: { anthropic: { served: ['claude-opus-5-5'] } },
  tools: [],
};

const values: t.ConfigValuesData = {
  configValues: { endpoints: { anthropic: { models: ['claude-opus-5-5'] } } },
  editedValues: {},
  overridePaths: new Set(['endpoints.openAI.models']),
};

function seededClient(): QueryClient {
  const client = new QueryClient();
  client.setQueryData(['configCatalog', 'role', '__base__'], BASE_CATALOG);
  client.setQueryData(['configCatalog', 'role', 'USER'], USER_CATALOG);
  return client;
}

function wrapper(
  client: QueryClient,
  contract: t.ConfigContract = CATALOG_ON,
  editingScope?: t.ConfigScope,
) {
  const scopeContext: t.ScopeContextValue = {
    selectScope: () => undefined,
    editingScope,
    index: getScopeIndex(editingScope ? [editingScope] : []),
  };
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ConfigContractContext.Provider value={contract}>
        <ScopeActionsContext.Provider value={scopeContext}>
          <ConfigValuesProvider value={values}>{children}</ConfigValuesProvider>
        </ScopeActionsContext.Provider>
      </ConfigContractContext.Provider>
    </QueryClientProvider>
  );
}

/** Whether a query of the end-user routes ever ran (it stays idle and empty while the catalog serves). */
function routeQueryRan(client: QueryClient, key: string): boolean {
  return client
    .getQueryCache()
    .findAll({ queryKey: [key] })
    .some((query) => query.state.dataUpdateCount > 0 || query.state.fetchStatus !== 'idle');
}

describe('useEditPrincipal', () => {
  it('is Base outside a profile and the open profile inside one', () => {
    const base = renderHook(() => useEditPrincipal(), { wrapper: wrapper(seededClient()) });
    expect(base.result.current).toEqual({ principalType: 'role', principalId: '__base__' });
    const profile = renderHook(() => useEditPrincipal(), {
      wrapper: wrapper(seededClient(), CATALOG_ON, USER_ROLE),
    });
    expect(profile.result.current).toEqual({ principalType: 'role', principalId: 'USER' });
  });
});

describe('the scope catalog (catalogApi)', () => {
  it("reads Base's served endpoints and models from its catalog, not the end-user routes", () => {
    const client = seededClient();
    const status = renderHook(() => useEndpointStatus(), { wrapper: wrapper(client) });
    expect(status.result.current).toEqual({
      data: BASE_CATALOG.status,
      isLoading: false,
      isError: false,
    });
    const models = renderHook(() => useEndpointModels(), { wrapper: wrapper(client) });
    expect(models.result.current.data).toEqual(BASE_CATALOG.models);
    expect(routeQueryRan(client, 'endpointStatus')).toBe(false);
    expect(routeQueryRan(client, 'endpointModels')).toBe(false);
  });

  it('reads the open profile scope, so a profile sees what its users are served', () => {
    const client = seededClient();
    const options = renderHook(() => useOptionSources('models:anthropic'), {
      wrapper: wrapper(client, CATALOG_ON, USER_ROLE),
    });
    expect(options.result.current.options.map((option) => option.value)).toEqual([
      'claude-opus-5-5',
    ]);
    const status = renderHook(() => useEndpointStatus(), {
      wrapper: wrapper(client, CATALOG_ON, USER_ROLE),
    });
    expect(Object.keys(status.result.current.data ?? {})).toEqual(['anthropic']);
  });

  it('offers the catalog tools without the agents route, and models by served name', () => {
    const client = seededClient();
    const tools = renderHook(() => useOptionSources('tools'), { wrapper: wrapper(client) });
    expect(tools.result.current).toEqual({
      options: [{ value: 'google', label: 'Google' }],
      isLoading: false,
    });
    const ollama = renderHook(() => useOptionSources('models:Ollama'), {
      wrapper: wrapper(client),
    });
    expect(ollama.result.current.options.map((option) => option.value)).toEqual(['llama3']);
    expect(routeQueryRan(client, 'agentTools')).toBe(false);
  });

  it("gives a model list the endpoint's defaults even while a list is saved", () => {
    const client = seededClient();
    const saved = renderHook(
      () => useModelListDefaults('endpoints.openAI.models', 'models:openAI'),
      { wrapper: wrapper(client) },
    );
    expect(saved.result.current).toEqual({
      defaults: ['gpt-5', 'gpt-4.1'],
      suggestions: ['gpt-5', 'gpt-4.1'],
    });
    const none = renderHook(
      () => useModelListDefaults('endpoints.custom.0.models', 'models:ollama'),
      {
        wrapper: wrapper(client),
      },
    );
    expect(none.result.current).toEqual({ suggestions: ['llama3'] });
    expect(routeQueryRan(client, 'endpointModels')).toBe(false);
  });

  it('says why an endpoint is not served, matched by served name', () => {
    const client = seededClient();
    const assistants = renderHook(() => useCatalogEndpoint('assistants'), {
      wrapper: wrapper(client),
    });
    expect(assistants.result.current?.reason).toBe('missing_credentials');
    const ollama = renderHook(() => useCatalogEndpoint('Ollama'), { wrapper: wrapper(client) });
    expect(ollama.result.current?.enabled).toBe(true);
    const inProfile = renderHook(() => useCatalogEndpoint('openAI'), {
      wrapper: wrapper(client, CATALOG_ON, USER_ROLE),
    });
    expect(inProfile.result.current?.reason).toBe('not_listed');
  });
});

/** Whether a query of `key` is read: some mounted hook has it enabled. */
function queryRead(client: QueryClient, key: string): boolean {
  return client
    .getQueryCache()
    .findAll({ queryKey: [key] })
    .some((query) => query.isActive());
}

describe('a server without the catalog', () => {
  const GOOGLE_STATUS: t.EndpointStatusMap = {
    google: { name: 'google', custom: false, userProvide: false },
  };

  function routeClient(): QueryClient {
    const client = seededClient();
    client.setQueryData(['endpointStatus', 0], GOOGLE_STATUS);
    client.setQueryData(['endpointModels', 0], { openAI: ['gpt-5'] });
    return client;
  }

  it.each([
    ['has no meta route, once that is known', BUNDLED_CONFIG_CONTRACT, true],
    ['reports meta without catalogApi', createServerContract({}), false],
  ])('that %s reads the end-user routes and never the catalog', (_label, contract, metaMissing) => {
    const client = routeClient();
    if (metaMissing) client.setQueryData(['configContract'], BUNDLED_CONFIG_CONTRACT);
    const status = renderHook(() => useEndpointStatus(), {
      wrapper: wrapper(client, contract, USER_ROLE),
    });
    expect(status.result.current.data).toEqual(GOOGLE_STATUS);
    expect(queryRead(client, 'endpointStatus')).toBe(true);
    expect(queryRead(client, 'configCatalog')).toBe(false);
    const entry = renderHook(() => useCatalogEndpoint('assistants'), {
      wrapper: wrapper(client, contract),
    });
    expect(entry.result.current).toBeUndefined();
    const models = renderHook(
      () => useModelListDefaults('endpoints.openAI.models', 'models:openAI'),
      { wrapper: wrapper(client, contract) },
    );
    expect(models.result.current).toEqual({ suggestions: ['gpt-5'] });
    expect(queryRead(client, 'endpointModels')).toBe(true);
    expect(queryRead(client, 'configCatalog')).toBe(false);
  });

  it('reads neither the routes nor the catalog while the contract is still loading', () => {
    const client = routeClient();
    renderHook(() => useEndpointStatus(), {
      wrapper: wrapper(client, BUNDLED_CONFIG_CONTRACT, USER_ROLE),
    });
    renderHook(() => useOptionSources('tools'), {
      wrapper: wrapper(client, BUNDLED_CONFIG_CONTRACT),
    });
    expect(queryRead(client, 'endpointStatus')).toBe(false);
    expect(queryRead(client, 'agentTools')).toBe(false);
    expect(queryRead(client, 'configCatalog')).toBe(false);
  });
});
