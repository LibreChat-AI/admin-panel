import { z } from 'zod';
import { queryOptions } from '@tanstack/react-query';
import { createServerFn } from '@tanstack/react-start';
import { PrincipalType } from 'librechat-data-provider';
import type * as t from '@/types';
import { toToolOptions, toEndpointStatusMap, toEndpointModelsMap } from './endpoints';
import {
  ENV_SOURCES,
  ENV_STATUS_QUERY_KEY,
  CONFIG_CATALOG_QUERY_KEY,
  CATALOG_ENDPOINT_REASON_KEYS,
} from '@/constants';
import { readApiJson } from './utils/json';
import { apiFetch } from './utils/api';
import { isConfigRecord } from '@/utils';

const ENDPOINT_REASONS: ReadonlySet<string> = new Set(Object.keys(CATALOG_ENDPOINT_REASON_KEYS));
const ENV_SOURCE_SET: ReadonlySet<string> = new Set(ENV_SOURCES);

function toNames(value: t.ConfigValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item !== '');
}

/** A reason a newer server adds reads as `unknown`, which the panel words generically. */
function toEndpointReason(value: t.ConfigValue): t.CatalogEndpointReason {
  return typeof value === 'string' && ENDPOINT_REASONS.has(value)
    ? (value as t.CatalogEndpointReason)
    : 'unknown';
}

/** One endpoint's model lists; a list the server leaves out stays absent, and names are cleaned like `/api/models`'. */
function toCatalogModels(value: t.ConfigRecord): t.CatalogModels {
  const lists = toEndpointModelsMap({
    served: value.served,
    configured: value.configured,
    defaults: value.defaults,
  });
  return {
    served: lists.served ?? [],
    ...(lists.configured && { configured: lists.configured }),
    ...(lists.defaults && { defaults: lists.defaults }),
  };
}

function readEndpoints(raw: t.ConfigRecord): Pick<t.ConfigCatalog, 'endpoints' | 'status'> {
  const endpoints: Record<string, t.CatalogEndpoint> = {};
  const served: t.ConfigRecord = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!isConfigRecord(value)) continue;
    const enabled = value.enabled === true;
    const custom = value.custom === true;
    endpoints[name] = {
      enabled,
      custom,
      envVars: toNames(value.envVars),
      ...(!enabled && { reason: toEndpointReason(value.reason) }),
    };
    if (!enabled) continue;
    const config = isConfigRecord(value.config) ? value.config : {};
    served[name] = custom ? { ...config, type: 'custom' } : config;
  }
  return { endpoints, status: toEndpointStatusMap(served) };
}

function readModels(raw: t.ConfigRecord): Pick<t.ConfigCatalog, 'models' | 'modelLists'> {
  const models: t.EndpointModelsMap = {};
  const modelLists: Record<string, t.CatalogModels> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!isConfigRecord(value)) continue;
    const lists = toCatalogModels(value);
    modelLists[name] = lists;
    models[name] = lists.served;
  }
  return { models, modelLists };
}

/**
 * `GET /api/admin/config/catalog` as the panel reads it: the served endpoints
 * and models in the shapes the end-user routes gave before, every endpoint
 * with why it is not served and the env names it reads, each endpoint's
 * configured and default models, and the agent tools. A part the server
 * leaves out (the admin cannot read its section) stays absent.
 */
export function toConfigCatalog(body: t.ConfigValue): t.ConfigCatalog {
  if (!isConfigRecord(body)) return {};
  return {
    ...(isConfigRecord(body.endpoints) && readEndpoints(body.endpoints)),
    ...(isConfigRecord(body.models) && readModels(body.models)),
    ...(Array.isArray(body.tools) && { tools: toToolOptions(body.tools) }),
  };
}

/** `GET /api/admin/config/env-status` by env name; entries it can't read are left out. */
export function toEnvStatusMap(body: t.ConfigValue): t.EnvStatusMap {
  const vars = isConfigRecord(body) ? body.vars : undefined;
  if (!isConfigRecord(vars)) return {};
  const result: Record<string, t.EnvVarStatus> = {};
  for (const [name, value] of Object.entries(vars)) {
    if (!isConfigRecord(value) || typeof value.set !== 'boolean') continue;
    result[name] = {
      set: value.set,
      userProvided: value.userProvided === true,
      sources: toNames(value.sources).filter((source): source is t.EnvSource =>
        ENV_SOURCE_SET.has(source),
      ),
    };
  }
  return result;
}

/**
 * What one scope serves (`catalogApi`): its endpoints, models and agent tools
 * resolved for the scope instead of for the signed-in admin, in one admin
 * call that needs no browser User-Agent.
 */
export const getConfigCatalogFn = createServerFn({ method: 'GET' })
  .validator(
    z.object({ principalType: z.nativeEnum(PrincipalType), principalId: z.string().min(1) }),
  )
  .handler(async ({ data }: { data: t.ConfigPrincipal }): Promise<t.ConfigCatalog> => {
    const query = new URLSearchParams({
      principalType: data.principalType,
      principalId: data.principalId,
    });
    const response = await apiFetch(`/api/admin/config/catalog?${query.toString()}`);
    return toConfigCatalog(await readApiJson(response, 'config catalog'));
  });

/** Whether each env name the deployment's config uses is set on the server (`envStatus`), never its value. */
export const getEnvStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<t.EnvStatusMap> => {
    const response = await apiFetch('/api/admin/config/env-status');
    return toEnvStatusMap(await readApiJson(response, 'env status'));
  },
);

/** A scope's catalog; the server reuses its model lists for `ttlMs`, so a sooner refetch gains nothing. */
export const configCatalogOptions = (principal: t.ConfigPrincipal, ttlMs = 60_000) =>
  queryOptions({
    queryKey: [CONFIG_CATALOG_QUERY_KEY, principal.principalType, principal.principalId] as const,
    queryFn: () => getConfigCatalogFn({ data: principal }),
    staleTime: Math.max(ttlMs, 30_000),
    retry: 1,
  });

export const envStatusOptions = queryOptions({
  queryKey: [ENV_STATUS_QUERY_KEY],
  queryFn: () => getEnvStatusFn(),
  staleTime: 60_000,
  retry: 1,
});
