import { useContext, useMemo } from 'react';
import { normalizeEndpointName } from 'librechat-data-provider';
import { QueryClient, QueryClientContext, useQuery } from '@tanstack/react-query';
import type * as t from '@/types';
import {
  toolOptionsQuery,
  baseConfigOptions,
  configCatalogOptions,
  configContractOptions,
  endpointStatusOptions,
  endpointModelsOptions,
} from '@/server';
import { BASE_PRINCIPAL, MODEL_PROVIDERS, BUILT_IN_PROVIDERS } from '@/constants';
import { getValueAtPath, isConfigRecord, foldsEndpointReferences } from '@/utils';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { ScopeActionsContext } from '@/contexts/ScopeContext';
import { useConfigContract } from './contract';
import { useLocalize } from '../useLocalize';
import { useFieldState } from './field';

const NO_OPTIONS: t.SelectOption[] = [];
const MODELS_PREFIX = 'models:';
const BUILT_IN_SET: ReadonlySet<string> = new Set(BUILT_IN_PROVIDERS);
/** Built-in endpoints that delegate to a provider (agents, Assistants) rather than run models. */
const NON_PROVIDERS: ReadonlySet<string> = new Set(
  BUILT_IN_PROVIDERS.filter((name) => !MODEL_PROVIDERS.includes(name)),
);

let inertClient: QueryClient | null = null;

/**
 * The page's query client, or an idle one where none is provided (isolated
 * component tests): queries are then disabled and nothing is fetched.
 */
export function useLiveQueryClient(): { client: QueryClient; live: boolean } {
  const provided = useContext(QueryClientContext);
  if (provided) return { client: provided, live: true };
  inertClient ??= new QueryClient();
  return { client: inertClient, live: false };
}

/** The principal the page edits: the open profile's, else (and outside the page) Base. */
export function useEditPrincipal(): t.ConfigPrincipal {
  const scope = useContext(ScopeActionsContext)?.editingScope;
  const principalType = scope?.principalType;
  const principalId = scope?.principalId;
  return useMemo(
    () => (principalType && principalId ? { principalType, principalId } : BASE_PRINCIPAL),
    [principalType, principalId],
  );
}

/**
 * The edit target's scope catalog (`catalogApi`): what the open profile (or
 * Base) serves, resolved for that scope instead of for the signed-in admin.
 * `usesCatalog` is false on an older server, whose end-user routes are read
 * instead (`readsRoutes`); the catalog is fetched only while `wanted`. Until
 * the server's contract is known neither is read, so a server with the
 * catalog never gets the end-user calls it replaces while the page loads.
 */
function useScopeCatalog(client: QueryClient, live: boolean, wanted: boolean) {
  const contract = useConfigContract();
  const principal = useEditPrincipal();
  const contractQuery = useQuery({ ...configContractOptions, enabled: false }, client);
  const known = contract.source === 'server' || contractQuery.isFetched;
  const usesCatalog = contract.features.catalogApi;
  const query = useQuery(
    {
      ...configCatalogOptions(principal, contract.limits.catalogModelsTtlMs),
      enabled: live && wanted && usesCatalog,
    },
    client,
  );
  return { usesCatalog, readsRoutes: live && known && !usesCatalog, query };
}

/** When the base configuration was last loaded: saves refetch it, and endpoint data follows. */
function useConfigVersion(client: QueryClient, live: boolean): number {
  const { dataUpdatedAt } = useQuery(
    { ...baseConfigOptions, enabled: false, notifyOnChangeProps: ['dataUpdatedAt'] },
    client,
  );
  return live ? dataUpdatedAt : 0;
}

/**
 * Enabled endpoints of the edit target: from its scope catalog (`catalogApi`),
 * else as LibreChat serves them to the signed-in admin (`/api/endpoints`).
 * Refetched after each save.
 */
export function useEndpointStatus(): t.QueryState<t.EndpointStatusMap> {
  const { client, live } = useLiveQueryClient();
  const version = useConfigVersion(client, live);
  const catalog = useScopeCatalog(client, live, true);
  const query = useQuery(
    {
      ...endpointStatusOptions(version),
      enabled: catalog.readsRoutes,
      placeholderData: (prev) => prev,
    },
    client,
  );
  const source = catalog.usesCatalog ? catalog.query : query;
  return {
    data: catalog.usesCatalog ? catalog.query.data?.status : query.data,
    isLoading: live && source.isLoading,
    isError: source.isError,
  };
}

/**
 * Model names per endpoint of the edit target: its scope catalog's served
 * models (`catalogApi`), else `/api/models` as the admin. Refetched after each save.
 */
export function useEndpointModels(enabled = true): t.QueryState<t.EndpointModelsMap> {
  const { client, live } = useLiveQueryClient();
  const version = useConfigVersion(client, live);
  const catalog = useScopeCatalog(client, live, enabled);
  const query = useQuery(
    {
      ...endpointModelsOptions(version),
      enabled: catalog.readsRoutes && enabled,
      placeholderData: (prev) => prev,
    },
    client,
  );
  const source = catalog.usesCatalog ? catalog.query : query;
  return {
    data: catalog.usesCatalog ? catalog.query.data?.models : query.data,
    isLoading: live && enabled && source.isLoading,
    isError: source.isError,
  };
}

/**
 * One endpoint of the edit target's scope catalog: whether it is served, why
 * not, and the env names it reads. Undefined on a server without the
 * catalog, while it loads, or for an endpoint it does not list.
 */
export function useCatalogEndpoint(name: string): t.CatalogEndpoint | undefined {
  const { client, live } = useLiveQueryClient();
  const catalog = useScopeCatalog(client, live, true);
  if (!catalog.usesCatalog) return undefined;
  return entryOf(catalog.query.data?.endpoints, name);
}

/** Distinct names of an `endpoints.custom` list. */
function customEndpointNames(list: t.ConfigValue | undefined): string[] {
  if (!Array.isArray(list)) return [];
  const names = new Set<string>();
  for (const entry of list) {
    const name = isConfigRecord(entry) ? entry.name : undefined;
    if (typeof name === 'string' && name.trim() !== '') names.add(name);
  }
  return [...names];
}

/** The configuration shown on the page (pending edits included), or the effective one. */
function useShownConfig(): t.ConfigValue {
  const values = useContext(ConfigValuesContext);
  return values?.configValues ?? values?.layers?.effective ?? null;
}

/** Custom endpoint names in the shown configuration (pending edits included). */
export function useCustomEndpointNames(): string[] {
  const root = useShownConfig();
  const list = getValueAtPath(root, 'endpoints.custom');
  return useMemo(() => customEndpointNames(list), [list]);
}

/**
 * Endpoint choices: the endpoints LibreChat serves (built-in providers named
 * "OpenAI (openAI)"), then built-in providers and custom endpoints the
 * configuration defines but LibreChat does not serve (not enabled, or not
 * saved yet), so a reference to any of them is recognized. Each value is the
 * name LibreChat serves the endpoint under, since `addedEndpoints` and
 * `allowedProviders` are matched against it exactly: a custom endpoint
 * written "Ollama" is offered as "Ollama (ollama)". A server that folds
 * references to the served name (`foldsNames`) matches either spelling, so
 * the endpoint is offered as written ("Ollama"). Names that differ only in
 * letter case are distinct endpoints and are both offered. With
 * `providersOnly`, endpoints that delegate to a provider (agents, Assistants)
 * are left out.
 */
export function buildEndpointOptions(
  status: t.EndpointStatusMap | undefined,
  root: t.ConfigValue,
  localize: t.LocalizeFn,
  providersOnly = false,
  foldsNames = false,
): t.SelectOption[] {
  const configured = customEndpointNames(getValueAtPath(root, 'endpoints.custom'));
  const spelling = new Map<string, string>();
  for (const name of configured) {
    const served = normalizeEndpointName(name);
    if (!spelling.has(served)) spelling.set(served, name);
  }
  const seen = new Set<string>();
  const options: t.SelectOption[] = [];
  const add = (name: string) => {
    const served = BUILT_IN_SET.has(name) ? name : normalizeEndpointName(name);
    if (seen.has(served) || (providersOnly && NON_PROVIDERS.has(served))) return;
    seen.add(served);
    const label = BUILT_IN_SET.has(served)
      ? localize(`com_config_field_${served}`)
      : (spelling.get(served) ?? served);
    const shownLabel = label === served || foldsNames ? label : `${label} (${served})`;
    options.push({ value: served, label: shownLabel });
  };
  for (const name of Object.keys(status ?? {})) add(name);
  for (const name of BUILT_IN_PROVIDERS) add(name);
  for (const name of configured) add(name);
  return options;
}

/** An endpoint's entry of a per-endpoint map, matching LibreChat's normalized names (`Ollama` is served as `ollama`). */
function entryOf<T>(map: Readonly<Record<string, T>> | undefined, endpoint: string): T | undefined {
  return map?.[endpoint] ?? map?.[normalizeEndpointName(endpoint)];
}

function recordKeys(root: t.ConfigValue, path: string): string[] {
  const value = getValueAtPath(root, path);
  return isConfigRecord(value) ? Object.keys(value) : [];
}

/** Distinct `group` names of the model specs list. */
function specGroups(root: t.ConfigValue): string[] {
  const list = getValueAtPath(root, 'modelSpecs.list');
  if (!Array.isArray(list)) return [];
  const groups = new Set<string>();
  for (const spec of list) {
    const group = isConfigRecord(spec) ? spec.group : undefined;
    if (typeof group === 'string' && group.trim() !== '') groups.add(group);
  }
  return [...groups];
}

function toOptions(values: string[]): t.SelectOption[] {
  return values.map((value) => ({ value, label: value }));
}

/**
 * Options for a reference select (WS9; consumed by WS3's RefSelectField and
 * the area editors):
 * - `endpoints`: endpoints LibreChat serves, plus every configured one;
 * - `providers`: the same without agents and the Assistants endpoints;
 * - `models:<endpoint>`: that endpoint's models from `/api/models`;
 * - `mcpServers`: MCP server names in the shown configuration;
 * - `specGroups`: group names used by the model specs list;
 * - `tools`: tools agents can use (`/api/agents/tools`).
 * Configuration-derived sources include pending edits. Server data is
 * refetched after each save; outside a query client only the configuration
 * applies.
 */
export function useOptionSources(source?: t.OptionSource): t.OptionSourceResult {
  const localize = useLocalize();
  const foldsNames = foldsEndpointReferences(useConfigContract());
  const root = useShownConfig();
  const { client, live } = useLiveQueryClient();
  const version = useConfigVersion(client, live);
  const wantsStatus = source === 'endpoints' || source === 'providers';
  const wantsModels = source?.startsWith(MODELS_PREFIX) ?? false;
  const wantsTools = source === 'tools';
  const catalog = useScopeCatalog(client, live, wantsStatus || wantsModels || wantsTools);
  const routes = catalog.readsRoutes;
  const status = useQuery(
    {
      ...endpointStatusOptions(version),
      enabled: routes && wantsStatus,
      placeholderData: (prev) => prev,
    },
    client,
  );
  const models = useQuery(
    {
      ...endpointModelsOptions(version),
      enabled: routes && wantsModels,
      placeholderData: (prev) => prev,
    },
    client,
  );
  const tools = useQuery({ ...toolOptionsQuery, enabled: routes && wantsTools }, client);
  const catalogData = catalog.usesCatalog ? catalog.query.data : undefined;
  const statusData = catalog.usesCatalog ? catalogData?.status : status.data;
  const modelsData = catalog.usesCatalog ? catalogData?.models : models.data;
  const toolsData = catalog.usesCatalog ? catalogData?.tools : tools.data;

  const options = useMemo((): t.SelectOption[] => {
    if (!source) return NO_OPTIONS;
    if (source === 'endpoints' || source === 'providers') {
      return buildEndpointOptions(statusData, root, localize, source === 'providers', foldsNames);
    }
    if (source === 'mcpServers') return toOptions(recordKeys(root, 'mcpServers'));
    if (source === 'specGroups') return toOptions(specGroups(root));
    if (source === 'tools') return toolsData ?? NO_OPTIONS;
    const endpoint = source.slice(MODELS_PREFIX.length);
    return toOptions(entryOf(modelsData, endpoint) ?? []);
  }, [source, statusData, modelsData, toolsData, root, localize, foldsNames]);

  const loading = catalog.usesCatalog
    ? catalog.query.isLoading
    : (wantsStatus && status.isLoading) ||
      (wantsModels && models.isLoading) ||
      (wantsTools && tools.isLoading);
  return { options, isLoading: live && (wantsStatus || wantsModels || wantsTools) && loading };
}

/** The catalog's lists as a model list field reads them: what the endpoint offers without a list, and every known name. */
function catalogListDefaults(lists: t.CatalogModels | undefined): t.ModelListDefaults {
  if (!lists) return { suggestions: [] };
  const suggestions = [
    ...new Set([...lists.served, ...(lists.defaults ?? []), ...(lists.configured ?? [])]),
  ];
  return lists.defaults ? { defaults: lists.defaults, suggestions } : { suggestions };
}

/**
 * Defaults and suggestions for a model list field (AP-2). From the edit
 * target's scope catalog (`catalogApi`): the models the endpoint offers
 * without a configured list, which the catalog reports whether or not one is
 * saved. Else the models `/api/models` lists for the source's endpoint, which
 * are the provider's defaults only while the saved configuration sets no list
 * (the API returns the configured list otherwise), so `defaults` is left out then.
 */
export function useModelListDefaults(
  path: string,
  source: t.OptionSource | undefined,
): t.ModelListDefaults {
  const endpoint = source?.startsWith(MODELS_PREFIX) ? source.slice(MODELS_PREFIX.length) : null;
  const { client, live } = useLiveQueryClient();
  const catalog = useScopeCatalog(client, live, endpoint != null);
  const models = useEndpointModels(endpoint != null && !catalog.usesCatalog);
  const state = useFieldState(path);
  const catalogLists = catalog.usesCatalog ? catalog.query.data?.modelLists : undefined;
  return useMemo(() => {
    if (!endpoint) return { suggestions: [] };
    if (catalog.usesCatalog) return catalogListDefaults(entryOf(catalogLists, endpoint));
    const list = entryOf(models.data, endpoint);
    if (!list) return { suggestions: [] };
    const savedList = state.isOverride || Array.isArray(state.effective);
    return savedList ? { suggestions: list } : { defaults: list, suggestions: list };
  }, [endpoint, catalog.usesCatalog, catalogLists, models.data, state.isOverride, state.effective]);
}

/** Siblings that name the endpoint a model field's model runs on, nearest first. */
const MODEL_ENDPOINT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  titleModel: ['titleEndpoint'],
  activityModel: ['activityEndpoint'],
  activityPhaseModel: ['activityPhaseEndpoint', 'activityEndpoint'],
  reasoningLabelModel: ['reasoningLabelEndpoint', 'activityEndpoint'],
};

/**
 * The option source of a model field (AP-9): the models of the endpoint its
 * sibling names (`titleModel` → `titleEndpoint`), pending edits included, else
 * `source` (the field's own provider). Other sources pass through.
 */
export function useModelSource(
  source: t.OptionSource | undefined,
  path: string | undefined,
): t.OptionSource | undefined {
  const root = useShownConfig();
  if (!path || !source?.startsWith(MODELS_PREFIX)) return source;
  const dot = path.lastIndexOf('.');
  const siblings = MODEL_ENDPOINT_FIELDS[path.slice(dot + 1)] ?? [];
  for (const sibling of siblings) {
    const endpoint = getValueAtPath(root, `${path.slice(0, dot)}.${sibling}`);
    if (typeof endpoint === 'string' && endpoint.trim() !== '') return `models:${endpoint}`;
  }
  return source;
}
