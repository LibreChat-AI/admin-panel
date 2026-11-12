import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { getRequestHeader } from '@tanstack/react-start/server';
import type * as t from '@/types';
import { readApiJson } from './utils/json';
import { apiFetch } from './utils/api';
import { isConfigRecord } from '@/utils';

/**
 * Enabled endpoints from `GET /api/endpoints` (as LibreChat serves them to the
 * signed-in admin). Endpoints the server leaves out are not enabled: missing
 * credentials, or not listed in `ENDPOINTS`.
 */
export function toEndpointStatusMap(payload: t.ConfigValue): t.EndpointStatusMap {
  const result: t.EndpointStatusMap = {};
  if (!isConfigRecord(payload)) return result;
  for (const [name, raw] of Object.entries(payload)) {
    if (!isConfigRecord(raw)) continue;
    const entry = raw as t.RawEndpointConfig;
    result[name] = {
      name,
      custom: entry.type === 'custom',
      userProvide: entry.userProvide === true || entry.userProvideURL === true,
      ...(typeof entry.modelDisplayLabel === 'string' && { label: entry.modelDisplayLabel }),
    };
  }
  return result;
}

/** Model names per endpoint from `GET /api/models`: blank and duplicate names dropped. */
export function toEndpointModelsMap(payload: t.ConfigValue): t.EndpointModelsMap {
  const result: t.EndpointModelsMap = {};
  if (!isConfigRecord(payload)) return result;
  for (const [endpoint, models] of Object.entries(payload)) {
    if (!Array.isArray(models)) continue;
    const names = new Set<string>();
    for (const model of models) {
      if (typeof model === 'string' && model.trim() !== '') names.add(model);
    }
    result[endpoint] = [...names];
  }
  return result;
}

/** Tool options from `GET /api/agents/tools`, labelled by name and valued by plugin key. */
export function toToolOptions(payload: t.ConfigValue): t.ToolOption[] {
  if (!Array.isArray(payload)) return [];
  const options: t.ToolOption[] = [];
  const seen = new Set<string>();
  for (const item of payload) {
    if (!isConfigRecord(item)) continue;
    const raw = item as t.RawTool;
    const value = raw.pluginKey;
    if (typeof value !== 'string' || value === '' || seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      label: typeof raw.name === 'string' && raw.name ? raw.name : value,
      ...(typeof raw.description === 'string' && { description: raw.description }),
    });
  }
  return options;
}

/** Which endpoints LibreChat serves (AP-5 status badges, `endpoints` option source). */
export const getEndpointStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<t.EndpointStatusMap> => {
    const response = await apiFetch('/api/endpoints');
    return toEndpointStatusMap(await readApiJson(response, 'endpoints'));
  },
);

/** The models each endpoint offers (model list defaults, `models:<endpoint>` option source). */
export const getModelsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<t.EndpointModelsMap> => {
    const response = await apiFetch('/api/models');
    return toEndpointModelsMap(await readApiJson(response, 'models'));
  },
);

/**
 * The tools agents can use (`tools` option source). LibreChat's agent routes
 * reject requests without a browser user agent, so the admin's is forwarded.
 */
export const getToolsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<t.ToolOption[]> => {
    const userAgent = getRequestHeader('user-agent');
    const response = await apiFetch(
      '/api/agents/tools',
      userAgent ? { headers: { 'User-Agent': userAgent } } : undefined,
    );
    return toToolOptions(await readApiJson(response, 'tools'));
  },
);

/** Refetched after saves: the key carries the base config's version (see `useOptionSources`). */
export const endpointStatusOptions = (version = 0) =>
  queryOptions({
    queryKey: ['endpointStatus', version],
    queryFn: () => getEndpointStatusFn(),
    staleTime: 60_000,
    retry: 1,
  });

export const endpointModelsOptions = (version = 0) =>
  queryOptions({
    queryKey: ['endpointModels', version],
    queryFn: () => getModelsFn(),
    staleTime: 60_000,
    retry: 1,
  });

export const toolOptionsQuery = queryOptions({
  queryKey: ['agentTools'],
  queryFn: () => getToolsFn(),
  staleTime: 5 * 60_000,
  retry: 1,
});
