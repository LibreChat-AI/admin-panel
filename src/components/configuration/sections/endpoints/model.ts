/**
 * Pure helpers of the custom endpoint editor (WS10): what an endpoint's list
 * row shows (host, model count) and what keeps it from being saved or served
 * (CE-3, CE-4). LibreChat loads a custom endpoint only with a name, an API
 * key, a base URL and a model list (`loadCustomEndpointsConfig`), and its
 * schema requires at least one default model even when the list is fetched.
 */
import { normalizeEndpointName } from 'librechat-data-provider';
import type * as t from '@/types';
import { RESERVED_ENDPOINT_NAMES } from '@/constants';
import { isConfigRecord, isAddressableEntryKey } from '@/utils';

const USER_PROVIDED = 'user_provided';
const ENV_PLACEHOLDER_RE = /\$\{[A-Za-z0-9_]+\}/;

function hasText(value: t.ConfigValue): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** An endpoint's `models` object, or an empty one. */
function modelsOf(entry: t.ConfigValue): t.ConfigRecord {
  if (!isConfigRecord(entry)) return {};
  return isConfigRecord(entry.models) ? entry.models : {};
}

/** Names of the default models (a model is a name, or `{ name, description }`). */
export function modelNames(entry: t.ConfigValue): string[] {
  const list = modelsOf(entry).default;
  if (!Array.isArray(list)) return [];
  return list.map((item) => {
    if (typeof item === 'string') return item;
    if (isConfigRecord(item) && typeof item.name === 'string') return item.name;
    return '';
  });
}

/** Whether the model list is also fetched from the provider's API. */
export function fetchesModels(entry: t.ConfigValue): boolean {
  return modelsOf(entry).fetch === true;
}

/**
 * Host (and path) a list row shows for a base URL: `api.moonshot.ai/v1`, the
 * scheme and trailing slashes dropped. Environment references stay as written.
 */
export function endpointHost(baseURL: t.ConfigValue): string | null {
  if (!hasText(baseURL)) return null;
  return (
    baseURL
      .trim()
      .replace(/^https?:\/\//i, '')
      .replace(/\/+$/, '') || null
  );
}

/** Whether a base URL can be used as written: an http(s) URL, an environment reference, or `user_provided`. */
export function isUsableBaseURL(baseURL: string): boolean {
  const text = baseURL.trim();
  if (text === USER_PROVIDED || ENV_PLACEHOLDER_RE.test(text)) return true;
  try {
    const url = new URL(text);
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.host !== '';
  } catch {
    return false;
  }
}

function nameIssues(
  name: t.ConfigValue,
  otherNames: readonly string[],
  maxKeyLength?: number,
): t.EndpointIssue[] {
  if (!hasText(name)) {
    return [{ field: 'name', code: 'nameRequired', severity: 'error', unserved: true }];
  }
  const trimmed = name.trim();
  if (trimmed !== name) return [{ field: 'name', code: 'nameWhitespace', severity: 'error' }];
  if (RESERVED_ENDPOINT_NAMES.has(trimmed)) {
    return [{ field: 'name', code: 'nameReserved', severity: 'error' }];
  }
  if (maxKeyLength !== undefined && !isAddressableEntryKey(trimmed, maxKeyLength)) {
    return [
      {
        field: 'name',
        code: 'nameUnaddressable',
        severity: 'error',
        params: { max: String(maxKeyLength) },
      },
    ];
  }
  if (otherNames.includes(name)) {
    return [{ field: 'name', code: 'nameTaken', severity: 'error', params: { name } }];
  }
  const served = normalizeEndpointName(trimmed);
  const merged = otherNames.find((other) => normalizeEndpointName(other.trim()) === served);
  if (merged !== undefined) {
    return [{ field: 'name', code: 'nameMerged', severity: 'error', params: { name: merged } }];
  }
  const lower = trimmed.toLowerCase();
  const similar = otherNames.find((other) => other.trim().toLowerCase() === lower);
  if (similar !== undefined) {
    return [{ field: 'name', code: 'nameSimilar', severity: 'warning', params: { name: similar } }];
  }
  return [];
}

function modelIssues(entry: t.ConfigValue): t.EndpointIssue[] {
  const names = modelNames(entry);
  if (names.length === 0) {
    return [
      {
        field: 'models.default',
        code: 'modelsRequired',
        severity: 'error',
        unserved: !fetchesModels(entry),
      },
    ];
  }
  const issues: t.EndpointIssue[] = [];
  if (names.some((name) => name.trim() === '')) {
    issues.push({ field: 'models.default', code: 'modelBlank', severity: 'error' });
  }
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) repeated.add(name);
    seen.add(name);
  }
  if (repeated.size > 0) {
    issues.push({
      field: 'models.default',
      code: 'modelDuplicate',
      severity: 'warning',
      params: { models: [...repeated].join(', ') },
    });
  }
  return issues;
}

/**
 * Problems of one custom endpoint, by field. A literal key librechat.yaml
 * sets is redacted on read, so a key is required only of endpoints the
 * target adds. A renamed endpoint whose key is stored encrypted needs the key
 * again where LibreChat ties the stored key to the old name (CE-1), not
 * where the server moves it with the rename (`carriesKey`).
 */
export function validateEndpoint(input: t.EndpointValidationInput): t.EndpointIssue[] {
  const { entry, otherNames, fromLowerLayer, storedSecret, loadedName, carriesKey } = input;
  if (!isConfigRecord(entry)) return [];
  const renamed = loadedName !== undefined && loadedName !== entry.name;
  /** A name already saved stays addressable or not as it is; only a new or changed one is judged. */
  const maxKeyLength = loadedName === undefined || renamed ? input.maxKeyLength : undefined;
  const issues: t.EndpointIssue[] = fromLowerLayer
    ? []
    : nameIssues(entry.name, otherNames, maxKeyLength);
  if (storedSecret && renamed && !carriesKey && !hasText(entry.apiKey)) {
    issues.push({ field: 'apiKey', code: 'renameNeedsKey', severity: 'error' });
  } else if (!fromLowerLayer && !storedSecret && !hasText(entry.apiKey)) {
    issues.push({ field: 'apiKey', code: 'apiKeyRequired', severity: 'error', unserved: true });
  }
  if (!hasText(entry.baseURL)) {
    issues.push({ field: 'baseURL', code: 'baseUrlRequired', severity: 'error', unserved: true });
  } else if (!isUsableBaseURL(entry.baseURL)) {
    issues.push({ field: 'baseURL', code: 'baseUrlInvalid', severity: 'warning' });
  }
  issues.push(...modelIssues(entry));
  return issues;
}

/** Whether LibreChat would skip the endpoint at runtime (missing name, key, URL or models). */
export function isUnserved(issues: readonly t.EndpointIssue[]): boolean {
  return issues.some((issue) => issue.unserved === true);
}

/** Whether any issue blocks saving. */
export function hasBlockingIssue(issues: readonly t.EndpointIssue[]): boolean {
  return issues.some((issue) => issue.severity === 'error');
}

const OPENROUTER = 'openrouter';

function namesOpenRouter(value: t.ConfigValue): boolean {
  return typeof value === 'string' && value.toLowerCase().includes(OPENROUTER);
}

/**
 * Whether LibreChat adds OpenRouter's parameters to an endpoint
 * (`customParamsExpansion`): one named for OpenRouter or pointing at it,
 * unless its parameters take their defaults from another provider. It then
 * uses OpenRouter's parameter set, with prompt caching on unless the
 * endpoint defines it.
 */
export function addsOpenRouterDefaults(entry: t.ConfigValue): boolean {
  if (!isConfigRecord(entry)) return false;
  if (!namesOpenRouter(entry.name) && !namesOpenRouter(entry.baseURL)) return false;
  const params = isConfigRecord(entry.customParams) ? entry.customParams : {};
  const chosen = params.defaultParamsEndpoint;
  return !hasText(chosen) || chosen === 'custom' || chosen === OPENROUTER;
}
