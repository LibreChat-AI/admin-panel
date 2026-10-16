import { queryOptions } from '@tanstack/react-query';
import { configSchema } from 'librechat-data-provider';
import { createServerFn } from '@tanstack/react-start';
import type { AdminConfigResponse } from '@librechat/data-schemas';
import type * as t from '@/types';
import { BASE_CONFIG_PRINCIPAL_ID } from '../constants';
import { normalizeAppServiceKeys } from './normalize';
import { extractSchemaDefaults } from './schema';
import { apiFetch } from '../utils/api';
import { flattenObject } from '@/utils';

function computeConfiguredPaths(
  config: Record<string, t.ConfigValue>,
  defaults: Record<string, unknown>,
): string[] {
  const flatConfig = flattenObject(config);
  const flatDefaults = flattenObject(defaults as Record<string, t.ConfigValue>);
  const configured: string[] = [];
  for (const [path, value] of Object.entries(flatConfig)) {
    if (value === '' || value === null || value === undefined) continue;
    if (!(path in flatDefaults)) {
      configured.push(path);
      continue;
    }
    const defaultVal = flatDefaults[path];
    if (value === defaultVal) continue;
    if (JSON.stringify(value) === JSON.stringify(defaultVal)) continue;
    configured.push(path);
  }
  return configured;
}

export const getBaseConfigFn = createServerFn({ method: 'GET' }).handler(async () => {
  const [baseResponse, baseOnlyResponse, dbBaseResponse] = await Promise.all([
    apiFetch('/api/admin/config/base'),
    apiFetch('/api/admin/config/base?baseOnly=true'),
    apiFetch(`/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}`),
  ]);

  if (!baseResponse.ok) {
    throw new Error(`Failed to fetch base config: ${baseResponse.status}`);
  }

  const { config: rawConfig } = (await baseResponse.json()) as {
    config: Record<string, t.ConfigValue>;
  };
  const config = normalizeAppServiceKeys(rawConfig);

  let configuredFromBase: string[] = [];
  let flatDefaults: Record<string, t.ConfigValue> = {};
  try {
    const schemaDefaults = extractSchemaDefaults(configSchema as t.ZodSchemaLike);
    flatDefaults = flattenObject(schemaDefaults as Record<string, t.ConfigValue>);
    configuredFromBase = computeConfiguredPaths(config, schemaDefaults);
  } catch (e) {
    console.warn('[getBaseConfigFn] Failed to compute schema defaults:', e);
  }

  let dbOverrides: Record<string, t.ConfigValue> | undefined;

  if (dbBaseResponse.ok) {
    const { config: dbConfig } = (await dbBaseResponse.json()) as AdminConfigResponse;
    dbOverrides = dbConfig.overrides as Record<string, t.ConfigValue>;
  }

  let yamlMcpKeys: string[] | undefined;
  let yamlMcpServers: Record<string, t.ConfigValue> | undefined;
  /** librechat.yaml alone (no admin overrides): what a base field reverts to when its override is reset. */
  let yamlConfig: t.ConfigRecord | undefined;
  if (baseOnlyResponse.ok) {
    const { config: baseOnlyRaw } = (await baseOnlyResponse.json()) as {
      config: Record<string, t.ConfigValue>;
    };
    const baseOnly = normalizeAppServiceKeys(baseOnlyRaw);
    yamlConfig = baseOnly;
    const mcp = baseOnly.mcpServers;
    if (mcp && typeof mcp === 'object' && !Array.isArray(mcp)) {
      /** Trust the baseOnly response when it has a valid mcpServers shape. The previous byte-equality fallback against `config.mcpServers` was a defensive heuristic for hypothetical legacy backends that ignore `?baseOnly`, but it false-negatived whenever an admin override happened to be a no-op (e.g. an admin set `title` to a value that already matched YAML), causing the YAML lock affordances to disappear for entries that should stay locked. The deployed LibreChat supports `?baseOnly` directly, so the heuristic is no longer earning its keep. */
      yamlMcpServers = mcp as Record<string, t.ConfigValue>;
      yamlMcpKeys = Object.keys(yamlMcpServers);
    }
  }

  return {
    config,
    dbOverrides,
    configuredFromBase,
    schemaDefaults: flatDefaults,
    yamlMcpKeys,
    yamlMcpServers,
    yamlConfig,
  };
});

export const baseConfigOptions = queryOptions({
  queryKey: ['baseConfig'],
  queryFn: () => getBaseConfigFn(),
  staleTime: 30_000,
});
