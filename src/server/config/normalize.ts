import type * as t from '@/types';
import {
  isConfigRecord,
  getValueAtPath,
  mergeScopeLayer,
  stripInterfacePermissionFields,
} from '@/utils';
import {
  getWriteRules,
  editsAzureGroups,
  AZURE_GROUPS_PATH,
  APP_SERVICE_KEY_ALIASES,
} from '@/constants';

/** Keys LibreChat's `azureConfigSetup` derives from `groups`; they are not settings. */
const AZURE_OPENAI_DERIVED_KEYS = new Set([
  'assistantGroups',
  'errors',
  'isValid',
  'groupMap',
  'modelNames',
  'modelGroupMap',
  'assistantModels',
  'serverless',
  'instanceName',
  'deploymentName',
]);

/** Keys LibreChat's endpoint setup adds to the Anthropic block (`vertexConfig` from `vertex`). */
const ANTHROPIC_DERIVED_KEYS = new Set(['vertexConfig']);

function withoutKeys(value: t.ConfigRecord, keys: ReadonlySet<string>): t.ConfigRecord {
  const cleaned: t.ConfigRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (!keys.has(key)) cleaned[key] = child;
  }
  return cleaned;
}

/**
 * The Azure OpenAI block as configured: derived keys dropped and `groups`
 * rebuilt from `groupMap`, which is what LibreChat serves. Before LibreChat
 * derives a profile's groups again (`editsAzureGroups`), a stored `groups`
 * override is not re-processed (it only runs `azureConfigSetup` on
 * librechat.yaml), so the live `groupMap` wins over it (D13): the table shows
 * what users get, and the stale override is flagged separately. Once it does,
 * the groups are read as written (`written`), merged by `group`, since
 * `groupMap` fills in defaults and leaves out groups that don't resolve.
 */
function normalizeAzureOpenAI(value: t.ConfigRecord, written?: t.ConfigValue): t.ConfigRecord {
  const cleaned = withoutKeys(value, AZURE_OPENAI_DERIVED_KEYS);
  if (written !== undefined) {
    if (Array.isArray(written)) cleaned.groups = written;
    return cleaned;
  }
  const { groupMap } = value;
  if (!isConfigRecord(groupMap)) return cleaned;
  cleaned.groups = Object.entries(groupMap).map(([group, config]) => ({
    group,
    ...(isConfigRecord(config) ? config : {}),
  }));
  return cleaned;
}

/**
 * Custom endpoints with their `customParams` as written (`compactParams`):
 * LibreChat serves them expanded (each definition completed from its
 * parameter set, OpenRouter's defaults added), and expands an override's
 * the same way, so the editor shows and writes the compact form.
 */
function withWrittenParams(value: t.ConfigValue[], written: t.ConfigValue): t.ConfigValue[] {
  const byName = new Map(
    (Array.isArray(written) ? written : []).flatMap((entry) =>
      isConfigRecord(entry) && typeof entry.name === 'string' ? [[entry.name, entry] as const] : [],
    ),
  );
  return value.map((entry) => {
    if (!isConfigRecord(entry) || typeof entry.name !== 'string') return entry;
    const source = byName.get(entry.name);
    if (!source) return entry;
    const { customParams: _served, ...rest } = entry;
    return source.customParams === undefined
      ? rest
      : { ...rest, customParams: source.customParams };
  });
}

/**
 * One endpoint block of LibreChat's processed AppConfig, mapped back to the
 * configuration it came from: the processed Azure OpenAI block (`groupMap`
 * and `isValid` present), the Anthropic block's `vertexConfig`, and with
 * `configured`, values LibreChat derives read as written (`ConfiguredValues`).
 */
export function normalizeEndpointValue(
  value: t.ConfigValue,
  key?: string,
  configured?: t.ConfiguredValues,
): t.ConfigValue {
  if (key === 'custom' && Array.isArray(value) && configured?.compactParams) {
    return withWrittenParams(value, getValueAtPath(configured.written, 'endpoints.custom'));
  }
  if (!isConfigRecord(value)) return value;
  if ('groupMap' in value && 'isValid' in value) {
    const written = configured?.azureGroups
      ? (getValueAtPath(configured.written, AZURE_GROUPS_PATH) ?? null)
      : undefined;
    return normalizeAzureOpenAI(value, written);
  }
  if (key === 'anthropic' && 'vertexConfig' in value) {
    return withoutKeys(value, ANTHROPIC_DERIVED_KEYS);
  }
  return value;
}

/**
 * Maps AppService output back to canonical config keys and drops derived
 * endpoint state; with `configured`, the values LibreChat derives from
 * librechat.yaml and the profiles are read as written.
 */
export function normalizeAppServiceKeys(
  raw: Record<string, t.ConfigValue>,
  configured?: t.ConfiguredValues,
): Record<string, t.ConfigValue> {
  const result: Record<string, t.ConfigValue> = {};
  for (const [key, value] of Object.entries(raw)) {
    result[APP_SERVICE_KEY_ALIASES[key] ?? key] = value;
  }
  if (isConfigRecord(result.interface)) {
    result.interface = stripInterfacePermissionFields(
      result.interface as Record<string, unknown>,
    ) as t.ConfigValue;
  }
  if (isConfigRecord(result.endpoints)) {
    const endpoints = { ...result.endpoints };
    result.endpoints = endpoints;
    for (const [epKey, epValue] of Object.entries(endpoints)) {
      endpoints[epKey] = normalizeEndpointValue(epValue, epKey, configured);
    }
  }
  return result;
}

/** Whether the server derives values the panel reads as written instead (`ConfiguredValues`). */
export function readsAsWritten(features: t.ConfigFeatures): boolean {
  return editsAzureGroups(features) || features.customParamsExpansion;
}

/**
 * What the panel reads as written on the contract's server (`ConfiguredValues`):
 * librechat.yaml as written (`raw`, the `config` GET `/base` returns), with
 * the Base document merged over it the way LibreChat merges it (`base`, for
 * the effective base config; none for librechat.yaml alone). Undefined where
 * the server derives nothing the panel edits as written.
 */
export function readConfiguredValues(
  contract: t.ConfigContract,
  raw: t.ConfigValue,
  base?: Pick<t.WriteSnapshot, 'stored' | 'tombstones'>,
): t.ConfiguredValues | undefined {
  if (!readsAsWritten(contract.features)) return undefined;
  const yaml = isConfigRecord(raw) ? raw : {};
  const written = base
    ? mergeScopeLayer(
        yaml,
        base.stored,
        base.tombstones,
        getWriteRules(contract),
        contract.features.keyedTombstones,
      )
    : yaml;
  return {
    written,
    azureGroups: editsAzureGroups(contract.features),
    compactParams: contract.features.customParamsExpansion,
  };
}
