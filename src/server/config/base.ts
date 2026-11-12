import { queryOptions } from '@tanstack/react-query';
import { configSchema } from 'librechat-data-provider';
import { createServerFn } from '@tanstack/react-start';
import type * as t from '@/types';
import { normalizeAppServiceKeys, readConfiguredValues } from './normalize';
import { collectLeafPaths, flattenObject, isConfigRecord } from '@/utils';
import { BASE_CONFIG_PRINCIPAL_ID } from '../constants';
import { extractSchemaDefaults } from './schema';
import { readConfigContract } from './meta';
import { apiFetch } from '../utils/api';

/**
 * AppConfig keys that are runtime state, not settings: server filesystem
 * paths, the tool registry, and the nested raw librechat.yaml (read here and
 * reduced to `yamlPaths`). They never reach the browser (EV-7).
 */
const APP_SERVICE_INTERNAL_KEYS: ReadonlySet<string> = new Set([
  'paths',
  'config',
  'availableTools',
]);

interface AppConfigPayload {
  config: t.ConfigRecord;
}

/** A normalized AppConfig without its runtime internals, derived values read as `configured` says. */
function toConfigLayer(appConfig: t.ConfigRecord, configured?: t.ConfiguredValues): t.ConfigRecord {
  const settings: t.ConfigRecord = {};
  for (const [key, value] of Object.entries(appConfig)) {
    if (!APP_SERVICE_INTERNAL_KEYS.has(key)) settings[key] = value;
  }
  return normalizeAppServiceKeys(settings, configured);
}

function readSchemaDefaults(): t.FlatConfigMap {
  try {
    const defaults = extractSchemaDefaults(configSchema as t.ZodSchemaLike);
    return flattenObject(defaults as t.ConfigRecord);
  } catch (e) {
    console.warn('[getBaseConfigFn] Failed to compute schema defaults:', e);
    return {};
  }
}

/**
 * The base admin override document. Its revision is `null` when there is
 * none (a server that reports revisions answers 404 for no document too),
 * and left out when the server reports none.
 */
async function readOverrideDoc(
  response: Response,
): Promise<Pick<t.BaseConfigData, 'dbOverrides' | 'dbTombstones' | 'dbRevision'>> {
  if (response.status === 404)
    return { dbOverrides: undefined, dbTombstones: [], dbRevision: null };
  if (!response.ok) return { dbOverrides: undefined, dbTombstones: [] };
  const { config } = (await response.json()) as t.AdminConfigDocResponse;
  return {
    dbOverrides: (config.overrides ?? {}) as t.ConfigRecord,
    dbTombstones: config.tombstones ?? [],
    ...(typeof config.revision === 'string' && { dbRevision: config.revision }),
  };
}

/**
 * The layers of the base configuration (EV-1):
 * - `config`: effective base (librechat.yaml + base overrides);
 * - `yamlConfig`: librechat.yaml as LibreChat processes it (`?baseOnly=true`),
 *   which is what a base field reverts to;
 * - `yamlPaths`: what the raw librechat.yaml itself sets. Values LibreChat
 *   synthesizes at startup appear in both trees above but not here, so they
 *   are not counted as configured (EV-2);
 * - `dbOverrides`/`dbTombstones`/`dbRevision`: the base admin override document;
 * - `schemaDefaults`: flattened schema defaults.
 *
 * On a server that derives Azure groups or custom endpoint parameters from
 * the profiles again, both trees hold those as written (`readConfiguredValues`):
 * librechat.yaml's, and in the effective one with the base overrides merged over them.
 */
export const getBaseConfigFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<t.BaseConfigData> => {
    const [baseResponse, baseOnlyResponse, dbBaseResponse, contract] = await Promise.all([
      apiFetch('/api/admin/config/base'),
      apiFetch('/api/admin/config/base?baseOnly=true'),
      apiFetch(`/api/admin/config/role/${BASE_CONFIG_PRINCIPAL_ID}`),
      readConfigContract(),
    ]);

    if (!baseResponse.ok) {
      throw new Error(`Failed to fetch base config: ${baseResponse.status}`);
    }

    const { config: appConfig } = (await baseResponse.json()) as AppConfigPayload;
    const rawYaml = appConfig.config;
    const yamlPaths = isConfigRecord(rawYaml) ? collectLeafPaths(rawYaml) : [];
    const doc = await readOverrideDoc(dbBaseResponse);

    let yamlConfig: t.ConfigRecord | undefined;
    let yamlMcpKeys: string[] | undefined;
    let yamlMcpServers: Record<string, t.ConfigValue> | undefined;
    if (baseOnlyResponse.ok) {
      const { config: baseOnlyConfig } = (await baseOnlyResponse.json()) as AppConfigPayload;
      yamlConfig = toConfigLayer(
        baseOnlyConfig,
        readConfiguredValues(contract, baseOnlyConfig.config),
      );
      const mcp = yamlConfig.mcpServers;
      if (isConfigRecord(mcp)) {
        yamlMcpServers = mcp;
        yamlMcpKeys = Object.keys(mcp);
      }
    }

    const configured = readConfiguredValues(contract, rawYaml, {
      stored: doc.dbOverrides ?? {},
      tombstones: doc.dbTombstones,
    });
    return {
      config: toConfigLayer(appConfig, configured),
      yamlConfig,
      yamlPaths,
      ...doc,
      schemaDefaults: readSchemaDefaults(),
      yamlMcpKeys,
      yamlMcpServers,
    };
  },
);

export const baseConfigOptions = queryOptions({
  queryKey: ['baseConfig'],
  queryFn: () => getBaseConfigFn(),
  staleTime: 30_000,
});
