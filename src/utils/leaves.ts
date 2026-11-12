import { configSchema } from 'librechat-data-provider';
import type * as t from '@/types';
import { schemaType, isUnionSchema, resolveSubSchema, unwrapSchema } from './schema';
import { APP_SERVICE_KEY_ALIASES, BUNDLED_CONFIG_FEATURES } from '@/constants';
import { hasDottedKey, isConfigRecord } from './format';
import { isUnsafeConfigKey } from './keys';

/** Top-level YAML keys that describe the file itself rather than a setting. */
const IMPORT_METADATA_KEYS = new Set(['version']);
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Schema nodes whose keys are free names (where LibreChat keeps dotted keys), not setting names. */
const FREE_KEY_TYPES: ReadonlySet<string> = new Set(['record', 'any', 'unknown']);

/** Schema nodes whose value is a group of settings (an MCP server, a file config endpoint). */
const GROUP_TYPES: ReadonlySet<string> = new Set(['object', 'record', 'intersection']);

/** Type names of a schema node, one per union option (wrappers stripped, nested unions flattened). */
function typeNamesOf(schema: t.ZodSchemaLike): string[] {
  const node = unwrapSchema(schema);
  if (!isUnionSchema(node)) return [schemaType(node) ?? ''];
  return (node._zod?.def.options ?? []).flatMap(typeNamesOf);
}

/**
 * Whether the object at `path` names its keys freely (a record of headers,
 * inference profiles, MIME types): the bundled schema says so (for a union,
 * one of its options), or does not describe the path (a newer LibreChat's
 * setting, which LibreChat judges). Top-level sections and fixed-shape
 * objects name settings instead.
 */
function holdsFreeKeys(path: string): boolean {
  if (!path) return false;
  const schema = resolveSubSchema(configSchema as t.ZodSchemaLike, path.split('.'));
  if (!schema) return true;
  return typeNamesOf(schema).some((name) => FREE_KEY_TYPES.has(name));
}

/**
 * Whether the free-key record `value` at `path` names groups of settings
 * (MCP servers, file config endpoints) rather than plain values: the schema
 * says its entries are objects, or one of them is. Such an entry is imported
 * field by field, merged into the stored one, so a whole-record write (which
 * replaces each entry) can't stand in for it.
 */
function holdsGroups(path: string, value: t.ConfigRecord): boolean {
  if (Object.values(value).some(isConfigRecord)) return true;
  const entry = resolveSubSchema(configSchema as t.ZodSchemaLike, [...path.split('.'), '*']);
  if (!entry) return false;
  const names = typeNamesOf(entry);
  return names.length > 0 && names.every((name) => GROUP_TYPES.has(name));
}

/**
 * Whether `key` of the object at `prefix` can be imported. A key the admin
 * API can't store (`isUnsafeConfigKey`) is reported in `unsafe`; a prototype
 * name it would store is dropped.
 */
function isImportableKey(
  key: string,
  prefix: string,
  out: t.ImportLeaves,
  allowDots: boolean,
): boolean {
  if (isUnsafeConfigKey(key, allowDots)) {
    out.unsafe.push({ path: prefix, key });
    return false;
  }
  return !DANGEROUS_KEYS.has(key);
}

/**
 * Leaves of `value` by dot-path, like `flattenObject`, except that a key the
 * admin API can't store (`isUnsafeConfigKey`) is never split into a nested
 * path: it is reported in `unsafe` and its value is left out. With
 * `allowDots` (the server's `dottedKeys`), a record of plain values that
 * holds a dotted key is one leaf at its own path (a dot-path can't address
 * the key), without its reserved keys (reported in `unsafe`, so the rest
 * is still imported); a dotted name in a record of setting groups is
 * reported in `dottedNames` (its fields are written one by one, by path),
 * and a dotted key where the schema expects a setting name in `dotted`.
 */
function collectLeaves(
  value: t.ConfigRecord,
  prefix: string,
  out: t.ImportLeaves,
  allowDots: boolean,
): void {
  const freeKeys = allowDots && hasDottedKey(value) && holdsFreeKeys(prefix);
  if (freeKeys && !holdsGroups(prefix, value)) {
    out.leaves[prefix] = Object.fromEntries(
      Object.entries(value).filter(([key]) => isImportableKey(key, prefix, out, allowDots)),
    );
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (!isImportableKey(key, prefix, out, allowDots)) continue;
    if (key.includes('.')) {
      (freeKeys ? out.dottedNames : out.dotted).push({ path: prefix, key });
      continue;
    }
    const path = prefix ? `${prefix}.${key}` : key;
    if (isConfigRecord(child) && Object.keys(child).length > 0) {
      collectLeaves(child, path, out, allowDots);
    } else {
      out.leaves[path] = child;
    }
  }
}

/**
 * Leaves of an imported YAML keyed by canonical dot-path. AppService alias
 * sections (`interfaceConfig`) are merged with their canonical section
 * (`interface`) leaf by leaf, the canonical spelling winning on conflicts.
 */
export function flattenImport(
  appConfig: t.ConfigRecord,
  features: t.ConfigFeatures = BUNDLED_CONFIG_FEATURES,
): t.ImportLeaves {
  const aliased: t.ConfigRecord = {};
  const canonical: t.ConfigRecord = {};
  for (const [key, value] of Object.entries(appConfig)) {
    if (IMPORT_METADATA_KEYS.has(key)) continue;
    const alias = APP_SERVICE_KEY_ALIASES[key];
    if (alias) aliased[alias] = value;
    else canonical[key] = value;
  }
  const fromAlias: t.ImportLeaves = { leaves: {}, unsafe: [], dotted: [], dottedNames: [] };
  const fromCanonical: t.ImportLeaves = { leaves: {}, unsafe: [], dotted: [], dottedNames: [] };
  collectLeaves(aliased, '', fromAlias, features.dottedKeys);
  collectLeaves(canonical, '', fromCanonical, features.dottedKeys);
  return {
    leaves: { ...fromAlias.leaves, ...fromCanonical.leaves },
    unsafe: [...fromAlias.unsafe, ...fromCanonical.unsafe],
    dotted: [...fromAlias.dotted, ...fromCanonical.dotted],
    dottedNames: [...fromAlias.dottedNames, ...fromCanonical.dottedNames],
  };
}

/** Leaf paths of an imported YAML the bundled config schema does not describe (aliases resolved). */
export function findUnknownImportPaths(
  appConfig: t.ConfigRecord,
  features: t.ConfigFeatures = BUNDLED_CONFIG_FEATURES,
): string[] {
  return Object.keys(flattenImport(appConfig, features).leaves).filter(
    (path) => resolveSubSchema(configSchema as t.ZodSchemaLike, path.split('.')) == null,
  );
}
