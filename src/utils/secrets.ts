import type * as t from '@/types';
import { AZURE_GROUPS_PATH, SECRET_CONFIG_KEYS } from '@/constants';
import { getValueAtPath } from './format';

const PREVIEW_KEY_RE = /^(.+)Preview$/;
const SECRET_LIKE_KEY_RE = /(api_?key|secret_?key|secret)$/i;

/** Whether a key names a secret: a known one (`apiKey`, `client_secret`) or one that reads like it (`tavilyApiKey`). */
export function isSecretKey(key: string): boolean {
  return SECRET_CONFIG_KEYS.has(key) || SECRET_LIKE_KEY_RE.test(key);
}

/** Whether `key` (inside `parent`) is a secret: a secret key (`apiKey`), or the `key` of one (`apiKey.key`). */
export function isStoredSecretKey(parent: string | undefined, key: string): boolean {
  return isSecretKey(key) || (key === 'key' && parent !== undefined && isSecretKey(parent));
}

/**
 * Whether the value at `path` is a secret, never shown and read back only as
 * its masked preview: a secret key (`webSearch.tavilyApiKey`,
 * `mcpServers.a.oauth.client_secret`) or the `key` of one
 * (`mcpServers.a.apiKey.key`). The one rule the review, the save payload,
 * the planner and the check of what a write stored all use.
 */
export function isSecretPath(path: string): boolean {
  const segments = path.split('.');
  return isStoredSecretKey(segments.at(-2), segments.at(-1) ?? '');
}

/** Whether `key` (inside `parent`) is the masked preview of a secret beside it (`apiKeyPreview`, `keyPreview` in `apiKey`). */
export function isSecretPreviewKey(parent: string | undefined, key: string): boolean {
  const secret = secretKeyForPreviewKey(key);
  return secret !== null && isStoredSecretKey(parent, secret);
}

/** Whether `path` is the masked preview of a secret beside it (`oauth.client_secretPreview`, `apiKey.keyPreview`). */
export function isSecretPreviewPath(path: string): boolean {
  const segments = path.split('.');
  return isSecretPreviewKey(segments.at(-2), segments.at(-1) ?? '');
}

/** Where the masked preview of the secret at `path` is kept (`a.apiKey.key` → `a.apiKey.keyPreview`). */
export function secretPreviewPath(path: string): string {
  const dot = path.lastIndexOf('.');
  return `${path.slice(0, dot + 1)}${toSecretPreviewKey(path.slice(dot + 1))}`;
}

/**
 * Whether a secret is stored at `path` in `root`: a value there, or the
 * masked preview a redacted read keeps beside it (all a server with
 * `recordSecrets` returns of an MCP key).
 */
export function holdsSecretAt(root: t.ConfigValue, path: string): boolean {
  return [path, secretPreviewPath(path)].some((location) => {
    const value = getValueAtPath(root, location);
    return typeof value === 'string' && value !== '';
  });
}
const ARRAY_INDEX_SEGMENT_RE = /\.\d+(?=\.|$)/g;

/** The secret key a masked-preview companion key shows (`apiKeyPreview` → `apiKey`), else null. */
export function secretKeyForPreviewKey(key: string): string | null {
  const match = PREVIEW_KEY_RE.exec(key);
  if (!match) return null;
  return match[1];
}

/**
 * Strips numeric array-index segments (`endpoints.custom.0.apiKey` →
 * `endpoints.custom.apiKey`) so an edited array entry's path matches the
 * schema's index-free field paths.
 */
function stripArrayIndices(path: string): string {
  return path.replace(ARRAY_INDEX_SEGMENT_RE, '');
}

/** Masked-preview companion key for a secret field key (`apiKey` → `apiKeyPreview`). */
export function toSecretPreviewKey(key: string): string {
  return `${key}Preview`;
}

/**
 * Masked preview value (e.g. `sk-mist...4321`) for a redacted secret field,
 * read from the sibling preview companion the backend returns when a secret
 * is set. Returns undefined when the field has no set-and-hidden secret.
 */
export function getSecretPreviewValue(parentValue: t.ConfigValue, key: string): string | undefined {
  if (!parentValue || typeof parentValue !== 'object' || Array.isArray(parentValue)) {
    return undefined;
  }
  const sibling = (parentValue as Record<string, t.ConfigValue>)[toSecretPreviewKey(key)];
  return typeof sibling === 'string' && sibling !== '' ? sibling : undefined;
}

/**
 * The value at `path`, else the masked preview of a secret the admin API
 * redacts there (`webSearch.tavilyApiKey` → `tavilyApiKeyPreview`), so a
 * stored secret reads as set: removing it is a real change.
 */
export function valueOrSecretPreview(root: t.ConfigValue, path: string): t.ConfigValue {
  const value = getValueAtPath(root, path);
  if (value !== undefined) return value;
  const dot = path.lastIndexOf('.');
  const parent = dot === -1 ? root : getValueAtPath(root, path.slice(0, dot));
  return getSecretPreviewValue(parent, path.slice(dot + 1));
}

/**
 * Real secret path for a preview companion path (`ocr.apiKeyPreview` →
 * `ocr.apiKey`). Anchored to known schema leaf paths so dynamic record keys
 * that merely look preview-shaped never match.
 */
export function secretPathForPreviewPath(
  path: string,
  schemaPaths: ReadonlySet<string>,
): string | null {
  const lastDot = path.lastIndexOf('.');
  const realKey = secretKeyForPreviewKey(lastDot === -1 ? path : path.slice(lastDot + 1));
  if (!realKey) return null;
  const realPath = lastDot === -1 ? realKey : `${path.slice(0, lastDot + 1)}${realKey}`;
  return schemaPaths.has(stripArrayIndices(realPath)) ? realPath : null;
}

/**
 * Replaces preview companion paths with their real secret paths so a redacted
 * secret still counts as configured/overridden for indicator and reset logic.
 */
export function mapSecretPreviewPaths(
  paths: Iterable<string>,
  schemaPaths: ReadonlySet<string>,
): Set<string> {
  const result = new Set<string>();
  for (const path of paths) {
    result.add(secretPathForPreviewPath(path, schemaPaths) ?? path);
  }
  return result;
}

/**
 * Deep-removes preview companion strings from a value before submission. The
 * backend rejects writes to preview paths, and a masked preview value must
 * never round-trip as if it were a real secret.
 */
export function stripSecretPreviewValues(
  value: t.ConfigValue,
  basePath: string,
  schemaPaths: ReadonlySet<string>,
): t.ConfigValue {
  if (Array.isArray(value)) {
    return value.map((entry) => stripSecretPreviewValues(entry, basePath, schemaPaths));
  }
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, t.ConfigValue> = {};
  for (const [key, child] of Object.entries(value as Record<string, t.ConfigValue>)) {
    const childPath = basePath ? `${basePath}.${key}` : key;
    if (typeof child === 'string' && secretPathForPreviewPath(childPath, schemaPaths) != null) {
      continue;
    }
    result[key] = stripSecretPreviewValues(child, childPath, schemaPaths);
  }
  return result;
}

/**
 * Drops schema fields that are preview companions of a sibling secret field
 * (`apiKeyPreview` next to `apiKey`) so they never render as editable inputs.
 * Operates on a single field level; extraction applies it per level.
 */
export function filterSecretPreviewFields(fields: t.SchemaField[]): t.SchemaField[] {
  const keys = new Set(fields.map((f) => f.key));
  return fields.filter((field) => {
    if (field.type !== 'string') return true;
    const realKey = secretKeyForPreviewKey(field.key);
    return realKey == null || !keys.has(realKey);
  });
}

/** Shown instead of a secret value in read-only views, so it never reaches the DOM. */
export const MASKED_SECRET = '••••••••';

const ENV_REFERENCE_RE = /^\$\{[A-Za-z0-9_]+\}$/;

/** A whole `{{VAR}}` template. */
const USER_TEMPLATE_RE = /^\{\{[^{}]+\}\}$/;

const USER_PROVIDED = 'user_provided';

/** Stands for any one segment of a location: an entry of a list or record. */
const ANY_SEGMENT = '*';

/** An environment reference such as `${OPENAI_API_KEY}` is not a secret and may be shown. */
export function isEnvReference(value: t.ConfigValue): boolean {
  return typeof value === 'string' && ENV_REFERENCE_RE.test(value);
}

/** `user_provided`: each user enters their own value. */
export function isUserProvided(value: string): boolean {
  return value.trim() === USER_PROVIDED;
}

/** A whole `{{VAR}}` template, which each user fills in for themselves. */
export function isUserTemplate(value: string): boolean {
  return USER_TEMPLATE_RE.test(value.trim());
}

/**
 * Where LibreChat's reads keep a credential readable that names where it
 * comes from besides a `${VAR}`, by location (`*` any entry): `user_provided`
 * as a custom endpoint's or Azure group's key, and a whole `{{VAR}}` template
 * as an MCP server's key or client secret. Neither is a credential.
 */
const READABLE_REFERENCES: ReadonlyArray<readonly [string[], (value: string) => boolean]> = [
  [['endpoints', 'custom', ANY_SEGMENT, 'apiKey'], isUserProvided],
  [[...AZURE_GROUPS_PATH.split('.'), ANY_SEGMENT, 'apiKey'], isUserProvided],
  [['mcpServers', ANY_SEGMENT, 'apiKey', 'key'], isUserTemplate],
  [['mcpServers', ANY_SEGMENT, 'oauth', 'client_secret'], isUserTemplate],
];

function matchesLocation(location: readonly string[], pattern: readonly string[]): boolean {
  return (
    location.length === pattern.length &&
    pattern.every((segment, index) => segment === ANY_SEGMENT || segment === location[index])
  );
}

/** Whether a secret's `value` at `location` is a reference LibreChat shows as written: a `${VAR}`, or one of `READABLE_REFERENCES`. */
function isReadableReference(location: readonly string[], value: string): boolean {
  if (isEnvReference(value)) return true;
  return READABLE_REFERENCES.some(
    ([pattern, readable]) => matchesLocation(location, pattern) && readable(value),
  );
}

/**
 * Copy of `value` with every non-empty string stored under a secret key
 * (`apiKey`, …) replaced by `MASKED_SECRET`. `key` is the key `value` itself
 * is stored under, so a secret leaf passed on its own is masked too.
 */
export function maskSecretValues(value: t.ConfigValue, key?: string): t.ConfigValue {
  if (typeof value === 'string') {
    return key != null && value !== '' && SECRET_CONFIG_KEYS.has(key) ? MASKED_SECRET : value;
  }
  if (Array.isArray(value)) return value.map((item) => maskSecretValues(item));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, t.ConfigValue> = {};
  for (const [childKey, child] of Object.entries(value)) {
    result[childKey] = maskSecretValues(child, childKey);
  }
  return result;
}

/**
 * Copy of a config tree with every non-empty string the panel's secret rule
 * names (`isStoredSecretKey`: `apiKey`, `tavilyApiKey`, `client_secret`, an
 * MCP server's `apiKey.key`) replaced by `MASKED_SECRET`, while a reference
 * LibreChat's reads keep readable stays as written: a `${VAR}`, a custom
 * endpoint's or Azure group's `user_provided` key, an MCP server's `{{VAR}}`
 * credential. `location` is where `value` is stored, from the root (`*` for
 * a list item). For a tree the server already redacted (a preview), so a
 * value it left under a secret key is still never shown.
 */
export function maskStoredSecrets(
  value: t.ConfigValue,
  location: readonly string[] = [],
): t.ConfigValue {
  if (typeof value === 'string') {
    const key = location.at(-1);
    const secret = key != null && value !== '' && isStoredSecretKey(location.at(-2), key);
    return secret && !isReadableReference(location, value) ? MASKED_SECRET : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => maskStoredSecrets(item, [...location, ANY_SEGMENT]));
  }
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, t.ConfigValue> = {};
  for (const [childKey, child] of Object.entries(value)) {
    result[childKey] = maskStoredSecrets(child, [...location, childKey]);
  }
  return result;
}
