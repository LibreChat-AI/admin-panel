import type * as t from '@/types';
import { buildFieldMetaRegistry, resolveFieldMeta } from './registry';
import { PROVIDER_FIELD_META } from './providers';
import { ENDPOINT_FIELD_META } from './endpoints';
import { SECRET_CONFIG_KEYS } from '@/constants';
import { FEATURES_FIELD_META } from './features';
import { GENERIC_FIELD_META } from './generic';
import { SYSTEM_FIELD_META } from './system';
import { FILES_FIELD_META } from './files';
import { SPEC_FIELD_META } from './specs';
import { MCP_FIELD_META } from './mcp';

/** Registries merged in order; area files are appended here (WS2 owns, WS9–13 contribute). */
const META_SOURCES: t.FieldMetaRegistry[] = [
  GENERIC_FIELD_META,
  PROVIDER_FIELD_META,
  ENDPOINT_FIELD_META,
  SPEC_FIELD_META,
  MCP_FIELD_META,
  FEATURES_FIELD_META,
  FILES_FIELD_META,
  SYSTEM_FIELD_META,
];

const REGISTRY = buildFieldMetaRegistry(META_SOURCES);

const NON_LABEL_SEGMENT = /^(\d+|\[\]|\{\})$/;

/**
 * Metadata implied by a field's key when the registry sets none (units,
 * prompts, secrets). A rate such as `requestsPerFiveMinutes` counts
 * requests, so it has no unit.
 */
const KEY_RULES: Array<[RegExp, t.FieldMeta]> = [
  [/Ms$/, { unit: 'ms' }],
  [/Seconds$/, { unit: 's' }],
  [/(?<!Per\w*)Minutes$/, { unit: 'minutes' }],
  [/Bytes$/, { unit: 'bytes' }],
  [
    /(Prompt|PromptTemplate)$|^(prompt|updatePrompt|instructions|customWelcome)$/,
    { multiline: true },
  ],
  [/ApiKey$/, { secret: true }],
];

const metaCache = new Map<string, t.FieldMeta | undefined>();

function keyMeta(path: string): t.FieldMeta | undefined {
  const key = lastNamedSegment(path);
  const rules = KEY_RULES.filter(([pattern]) => pattern.test(key)).map(([, meta]) => meta);
  if (SECRET_CONFIG_KEYS.has(key)) rules.push({ secret: true });
  if (rules.length === 0) return undefined;
  return rules.reduce<t.FieldMeta>((merged, meta) => ({ ...merged, ...meta }), {});
}

/**
 * Field metadata for a data or schema path, resolving `[]`/`{}` wildcards
 * (WS2). Key-name rules fill in what the registry leaves unset: `…Ms`,
 * `…Seconds`, `…Minutes` and `…Bytes` units, multiline prompts, and secret
 * API keys.
 */
export function getFieldMeta(path: string): t.FieldMeta | undefined {
  if (metaCache.has(path)) return metaCache.get(path);
  const meta = resolveFieldMeta(REGISTRY, path);
  const implied = keyMeta(path);
  const resolved = implied ? { ...implied, ...meta } : meta;
  metaCache.set(path, resolved);
  return resolved;
}

/**
 * Display label for a config path (WS2; used by WS5 search and WS7 review):
 * the meta `labelKey`, else the `com_config_field_<key>` label of the last
 * named segment, else that key itself when it has no translation.
 */
export function labelForPath(path: string, localize: t.LocalizeFn): string {
  const labelKey = getFieldMeta(path)?.labelKey;
  if (labelKey) return localize(labelKey);
  const key = lastNamedSegment(path);
  const fieldKey = `com_config_field_${key}`;
  const label = localize(fieldKey);
  return label === fieldKey ? key : label;
}

/**
 * Locale key of a field's description: the meta `descriptionKey`, else
 * `com_config_desc_<path>` with the path's `[]`/`{}` markers and indices
 * dropped and dots as underscores (`mcpServers.{}.startup` →
 * `com_config_desc_mcpServers_startup`). Pass schema paths for record entries.
 */
export function descriptionKeyForPath(path: string): string {
  const metaKey = getFieldMeta(path)?.descriptionKey;
  if (metaKey) return metaKey;
  const segments = path.split('.').filter((segment) => !NON_LABEL_SEGMENT.test(segment));
  return `com_config_desc_${segments.join('_')}`;
}

/** Help text for a field: its schema `description`, else its translated description key. */
export function describeField(
  field: Pick<t.SchemaField, 'path' | 'description'>,
  localize: t.LocalizeFn,
): string | undefined {
  if (field.description) return field.description;
  const key = descriptionKeyForPath(field.path);
  const text = localize(key);
  return text === key ? undefined : text;
}

/** Last path segment that names a field (skips array indices and `[]`/`{}` markers). */
function lastNamedSegment(path: string): string {
  const segments = path.split('.');
  for (let i = segments.length - 1; i >= 0; i--) {
    if (!NON_LABEL_SEGMENT.test(segments[i])) return segments[i];
  }
  return segments[segments.length - 1];
}

export { buildFieldMetaRegistry, resolveFieldMeta };
export { PROVIDER_LAYOUTS, DEFAULT_PROVIDER_LAYOUT } from './providers';
