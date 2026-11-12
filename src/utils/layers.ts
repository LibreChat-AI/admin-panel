import type * as t from '@/types';
import {
  BASE_PRINCIPAL,
  KEYED_COLLECTIONS,
  BUNDLED_WRITE_RULES,
  DEDICATED_CONFIG_SECTIONS,
} from '@/constants';
import { deepSerializeKVPairs, getValueAtPath, isConfigRecord } from './format';
import { withDerivedSpecControls, leavesSet } from './specs';
import { collectLeafPaths, createPathIndex } from './paths';
import { parseKeyedPath, removeKeyedValue } from './keyed';
import { withoutUnservedEndpointUses } from './dependents';
import { withoutShadowedSecret } from './collections';
import { mapSecretPreviewPaths } from './secrets';

/**
 * Arrays LibreChat merges item by item on their collection's key instead of
 * replacing (`ARRAY_MERGE_KEYS`), by path. Azure groups merge by `group` only
 * on a server with `azureGroupMergeKey`; before it, the panel never writes
 * them and keeps Base's (they are librechat.yaml-managed), so merging them
 * here changes nothing.
 */
const MERGED_COLLECTIONS: ReadonlyMap<string, t.KeyedCollection> = new Map(
  [...KEYED_COLLECTIONS].filter(([, collection]) => collection.merge === 'byKey'),
);

/** Objects an override replaces whole instead of merging into (`ATOMIC_MERGE_PATHS`). */
const ATOMIC_MERGE_PATHS: ReadonlySet<string> = new Set(['interface.theme']);

const UNSAFE_SEGMENTS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

const INDEX_SEGMENT = /^\d+$/;

function mergeArrayByKey(
  target: t.ConfigValue[],
  source: t.ConfigValue[],
  collection: t.KeyedCollection,
  path: string,
): t.ConfigValue[] {
  const keyField = collection.key;
  const sourceByKey = new Map<t.ConfigValue, t.ConfigRecord>();
  for (const item of source) {
    if (isConfigRecord(item) && item[keyField] != null) sourceByKey.set(item[keyField], item);
  }
  const seen = new Set<t.ConfigValue>();
  const result = target.map((item) => {
    if (!isConfigRecord(item)) return item;
    const override = item[keyField] != null ? sourceByKey.get(item[keyField]) : undefined;
    if (!override) return item;
    seen.add(item[keyField]);
    return mergeRecords(withoutShadowedSecret(item, override, collection), override, path);
  });
  for (const [key, item] of sourceByKey) {
    if (!seen.has(key)) result.push(item);
  }
  return result;
}

function mergeRecords(
  target: t.ConfigRecord,
  source: t.ConfigRecord,
  path: string,
): t.ConfigRecord {
  const result: t.ConfigRecord = { ...target };
  for (const key of Object.keys(source)) {
    if (UNSAFE_SEGMENTS.has(key)) continue;
    const childPath = path ? `${path}.${key}` : key;
    const sourceValue = source[key];
    const targetValue = result[key];
    const merged = MERGED_COLLECTIONS.get(childPath);
    if (
      isConfigRecord(sourceValue) &&
      isConfigRecord(targetValue) &&
      !ATOMIC_MERGE_PATHS.has(childPath)
    ) {
      result[key] = mergeRecords(targetValue, sourceValue, childPath);
    } else if (Array.isArray(sourceValue) && Array.isArray(targetValue) && merged) {
      result[key] = mergeArrayByKey(targetValue, sourceValue, merged, childPath);
    } else {
      result[key] = sourceValue;
    }
  }
  return result;
}

/** A copy of `tree` without the value at `path` (objects only, like LibreChat's tombstones). */
export function removeConfigPath(tree: t.ConfigRecord, path: string): t.ConfigRecord {
  const segments = path.split('.');
  if (segments.some((s) => UNSAFE_SEGMENTS.has(s))) return tree;
  const result: t.ConfigRecord = { ...tree };
  let cursor = result;
  for (let i = 0; i < segments.length - 1; i++) {
    const next = cursor[segments[i]];
    if (!isConfigRecord(next)) return result;
    const cloned = { ...next };
    cursor[segments[i]] = cloned;
    cursor = cloned;
  }
  delete cursor[segments[segments.length - 1]];
  return result;
}

/**
 * A copy of `tree` with `value` at `path`, stepping into arrays by index and
 * creating missing objects. `undefined` removes the value.
 */
export function setConfigPath(
  tree: t.ConfigRecord,
  path: string,
  value: t.ConfigValue,
): t.ConfigRecord {
  const segments = path.split('.');
  if (segments.some((s) => UNSAFE_SEGMENTS.has(s))) return tree;
  const root: t.ConfigRecord = { ...tree };
  let cursor: t.ConfigRecord | t.ConfigValue[] = root;
  for (let i = 0; i < segments.length; i++) {
    if (Array.isArray(cursor) && !INDEX_SEGMENT.test(segments[i])) return tree;
    if (i === segments.length - 1) break;
    const segment = segments[i];
    const existing: t.ConfigValue = Array.isArray(cursor)
      ? cursor[Number(segment)]
      : cursor[segment];
    let next: t.ConfigRecord | t.ConfigValue[];
    if (Array.isArray(existing)) next = [...existing];
    else if (isConfigRecord(existing)) next = { ...existing };
    else next = {};
    if (Array.isArray(cursor)) cursor[Number(segment)] = next;
    else cursor[segment] = next;
    cursor = next;
  }
  const last = segments[segments.length - 1];
  if (Array.isArray(cursor)) {
    const index = Number(last);
    if (value === undefined) cursor.splice(index, 1);
    else cursor[index] = value;
  } else if (value === undefined) {
    delete cursor[last];
  } else {
    cursor[last] = value;
  }
  return root;
}

/**
 * `merged` with Base's value put back at each of `paths`, whatever an override
 * or tombstone did there, inside it or at an ancestor (as LibreChat keeps its
 * base-only paths).
 */
function keepBaseValues(
  base: t.ConfigRecord,
  merged: t.ConfigRecord,
  paths: ReadonlySet<string>,
): t.ConfigRecord {
  let result = merged;
  for (const path of paths) {
    const value = getValueAtPath(base, path);
    if (getValueAtPath(result, path) !== value) result = setConfigPath(result, path, value);
  }
  return result;
}

/**
 * The config a profile's members get, as far as one profile can tell: Base
 * (librechat.yaml plus base overrides) with the profile's overrides merged the
 * way LibreChat merges them (objects deep-merge, `endpoints.custom` merges by
 * name, other arrays are replaced) and its tombstoned paths removed. Sections a
 * profile cannot override (read-only by the server's write `rules`) and the
 * fields only librechat.yaml sets inside the others (`yamlManagedFields`: the
 * server's base-only and deployment-only paths) keep their Base values.
 * With `keyedTombstones`, a tombstone naming an entry by its key
 * (`endpoints.custom["Name"]`) hides that entry, or the path inside it, of
 * Base before the overrides merge, as LibreChat applies it; before that, the
 * server stored such a tombstone without effect.
 */
export function mergeScopeLayer(
  base: t.ConfigRecord,
  overrides: t.ConfigRecord,
  tombstones: Iterable<string> = [],
  rules: t.ConfigWriteRules = BUNDLED_WRITE_RULES,
  keyedTombstones = false,
): t.ConfigRecord {
  const readOnly = rules.readOnlySections;
  const applicable: t.ConfigRecord = {};
  for (const [section, value] of Object.entries(overrides)) {
    if (readOnly.has(section) || DEDICATED_CONFIG_SECTIONS.has(section)) continue;
    applicable[section] = value;
  }
  const dotted: string[] = [];
  let lower = base;
  for (const path of tombstones) {
    if (readOnly.has(path.split('.')[0])) continue;
    const keyed = parseKeyedPath(path);
    if (!keyed) dotted.push(path);
    else if (keyedTombstones) lower = removeKeyedValue(lower, keyed);
  }
  let merged = mergeRecords(lower, applicable, '');
  for (const path of dotted) merged = removeConfigPath(merged, path);
  return keepBaseValues(base, merged, rules.yamlManagedFields);
}

function isStructuralEdit(value: t.ConfigValue): boolean {
  return value === undefined || Array.isArray(value) || isConfigRecord(value);
}

/**
 * Overlays pending structural edits (whole lists, entries, records, and
 * removals of them) onto a config tree so collection counts and the table of
 * contents match what the page shows. Pending primitive values are left to the
 * field controls, which read them through `getValue`/`useFieldState`. A
 * pending reset of a list or entry shows `revertAt(path)`, its fallback value.
 */
export function overlayPendingEdits(
  tree: t.ConfigRecord,
  edits: Array<[string, t.ConfigValue]>,
  revertAt: (path: string) => t.ConfigValue,
): t.ConfigRecord {
  let result = tree;
  for (const [path, edited] of edits) {
    if (!isStructuralEdit(edited)) continue;
    if (edited === undefined) {
      const current = getValueAtPath(result, path);
      if (!Array.isArray(current) && !isConfigRecord(current)) continue;
      result = setConfigPath(result, path, revertAt(path));
      continue;
    }
    result = setConfigPath(result, path, deepSerializeKVPairs(edited));
  }
  return result;
}

/**
 * The base-mode value layers (EV-1) from the base config payload. Secret
 * preview companion paths (`apiKeyPreview`) count as their real secret path.
 */
export function createBaseLayers(
  data: t.BaseConfigData,
  schemaPaths: ReadonlySet<string>,
  runtimeDefaultAt?: (path: string) => t.ConfigValue,
  keyedTombstones = false,
): t.ValueLayers {
  const overrides = data.dbOverrides ?? {};
  const yaml = data.yamlConfig ?? null;
  return {
    schemaDefaults: data.schemaDefaults,
    runtimeDefaultAt,
    yamlEffective: data.yamlConfig ?? null,
    yamlPaths: createPathIndex(mapSecretPreviewPaths(data.yamlPaths, schemaPaths)),
    base: data.config,
    baseOverrides: overrides,
    baseOverridePaths: createPathIndex(
      mapSecretPreviewPaths(collectLeafPaths(overrides), schemaPaths),
    ),
    baseTombstones: new Set(data.dbTombstones),
    scope: null,
    ...(keyedTombstones && yaml && { beneath: withoutRemovalsInside(yaml, data.dbTombstones) }),
    effective: data.config,
  };
}

/**
 * `root` without the values keyed tombstones remove inside entries
 * (`endpoints.custom["Name"].headers.X-Team`), as LibreChat applies them
 * before the target's own values merge; hides of whole entries are left.
 */
function withoutRemovalsInside(root: t.ConfigRecord, tombstones: Iterable<string>): t.ConfigRecord {
  let result = root;
  for (const path of tombstones) {
    const keyed = parseKeyedPath(path);
    if (keyed?.rest) result = removeKeyedValue(result, keyed);
  }
  return result;
}

/**
 * `config` as LibreChat serves it once its merge removed custom endpoints one
 * of the `defined` layers (librechat.yaml and each merged layer's own
 * overrides) defines (`withoutUnservedEndpointUses`).
 */
function servedOf(config: t.ConfigRecord, defined: readonly t.ConfigValue[]): t.ConfigRecord {
  return withoutUnservedEndpointUses(
    config,
    defined.map((layer) => getValueAtPath(layer, 'endpoints.custom')),
  );
}

/**
 * `layers` with the open profile on top: its overrides merged over Base,
 * minus its tombstones (EV-5). With `specInterfaceRederive`, the interface
 * controls model specs decide that no layer leaves set follow the specs the
 * profile's members get, as LibreChat derives them after the merge: with
 * `keyedTombstones`, without the specs that select an endpoint the profile
 * hides.
 */
export function withScopeLayer(
  layers: t.ValueLayers,
  scope: Pick<t.ScopeLayer, 'principalType' | 'name'>,
  data: t.ResolvedConfigData,
  schemaPaths: ReadonlySet<string>,
  rules?: t.ConfigWriteRules,
  keyedTombstones = false,
  specInterfaceRederive = false,
): t.ValueLayers {
  const merged = mergeScopeLayer(
    layers.base ?? {},
    data.overrides,
    data.tombstones,
    rules,
    keyedTombstones,
  );
  return {
    ...layers,
    scope: {
      principalType: scope.principalType,
      name: scope.name,
      overrides: data.overrides,
      overridePaths: createPathIndex(mapSecretPreviewPaths(data.changedPaths, schemaPaths)),
      tombstones: new Set(data.tombstones),
    },
    beneath: keyedTombstones
      ? withoutRemovalsInside(layers.base ?? {}, data.tombstones)
      : undefined,
    effective: specInterfaceRederive
      ? withDerivedSpecControls(
          merged,
          (path) => leavesSet(path, layers, data),
          keyedTombstones
            ? servedOf(merged, [layers.yamlEffective, layers.baseOverrides, data.overrides])
            : merged,
        )
      : merged,
  };
}

/**
 * The config a principal gets as the panel can estimate it, for a server that
 * does not resolve configs itself (no `resolvedApi`): Base (librechat.yaml
 * with the base overrides, as LibreChat serves it) with the principal's own
 * profile merged over it (`mergeScopeLayer`), unless the profile is inactive.
 * With `keyedTombstones`, it leaves out what selects or names a custom
 * endpoint the merge removed, as LibreChat does (`withoutUnservedEndpointUses`).
 * The profiles of a user's role and groups are not part of it, and nothing
 * says what LibreChat leaves out of a document.
 */
export function estimateConfigPreview({
  base,
  scope,
  own,
  rules,
  keyedTombstones,
}: t.PreviewEstimateInput): t.ConfigPreview {
  const layers: t.PreviewLayer[] =
    base.dbOverrides !== undefined || base.dbTombstones.length > 0
      ? [
          {
            ...BASE_PRINCIPAL,
            priority: 0,
            isActive: true,
            overrides: base.dbOverrides ?? {},
            tombstones: base.dbTombstones,
            ignored: [],
          },
        ]
      : [];
  const yaml = base.yamlConfig ?? {};
  const defined = [
    yaml,
    base.dbOverrides ?? {},
    ...(own && scope?.isActive ? [own.overrides] : []),
  ];
  const served = (config: t.ConfigRecord): t.ConfigRecord =>
    keyedTombstones ? servedOf(config, defined) : config;
  if (!scope || !own) return { source: 'panel', yaml, layers, resolved: served(base.config) };
  const layer: t.PreviewLayer = {
    principalType: scope.principalType,
    principalId: scope.principalId,
    priority: scope.priority,
    isActive: scope.isActive,
    overrides: own.overrides,
    tombstones: own.tombstones,
    ignored: [],
  };
  return {
    source: 'panel',
    yaml,
    layers: [...layers, layer],
    resolved: served(
      scope.isActive
        ? mergeScopeLayer(base.config, own.overrides, own.tombstones, rules, keyedTombstones)
        : base.config,
    ),
  };
}
