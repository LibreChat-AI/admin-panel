import type * as t from '@/types';
import {
  secretPathForPreviewPath,
  stripSecretPreviewValues,
  deepSerializeKVPairs,
  getWriteSkipReason,
  isConfigRecord,
} from '@/utils';
import { elementField, findSchemaField } from './controls';

const INDEXED_ARRAY_PATH_RE = /^(.+)\.(\d+)$/;

function normalizeArray(value: t.ConfigValue[], field: t.SchemaField | null): t.ConfigValue {
  if (value.every((item) => typeof item === 'string')) {
    const items = (value as string[]).filter((item) => item !== '');
    return items.length > 0 ? items : undefined;
  }
  const items: t.ConfigValue[] = [];
  for (let i = 0; i < value.length; i++) {
    const item = normalizeForSave(value[i], field ? elementField(field, String(i)) : null);
    if (item !== undefined) items.push(item);
  }
  return items.length > 0 ? items : undefined;
}

/** Primitive values of a key/value record are stored as entered; nested ones are normalized. */
function normalizeRecordValue(
  child: t.ConfigValue,
  field: t.SchemaField,
  key: string,
): t.ConfigValue {
  if (isConfigRecord(child) || Array.isArray(child)) {
    return normalizeForSave(child, elementField(field, key));
  }
  return child;
}

function normalizeRecord(value: t.ConfigRecord, field: t.SchemaField | null): t.ConfigValue {
  const isRecord = field?.type === 'record';
  const result: t.ConfigRecord = {};
  for (const [key, child] of Object.entries(value)) {
    const normalized =
      field && isRecord
        ? normalizeRecordValue(child, field, key)
        : normalizeForSave(child, field ? childOf(field, key) : null);
    if (normalized !== undefined) result[key] = normalized;
  }
  if (isRecord && Object.keys(result).length === 0) return undefined;
  return result;
}

function childOf(field: t.SchemaField, key: string): t.SchemaField | null {
  return field.children?.find((f) => f.key === key) ?? null;
}

/**
 * Reduces a pending value to what should actually be stored: empty strings and
 * empty list items are dropped (whitespace is preserved verbatim, since values
 * like stop sequences are whitespace-significant), and a list or record left with no items becomes
 * `undefined` ("no value") instead of an empty override that LibreChat would
 * read as "allow nothing" / "match everything". Plain objects are kept even
 * when empty, since `{}` can be meaningful (e.g. a feature enabled with defaults).
 */
export function normalizeForSave(value: t.ConfigValue, field: t.SchemaField | null): t.ConfigValue {
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') return value === '' ? undefined : value;
  if (Array.isArray(value)) {
    if (value.length === 0) return undefined;
    const serialized = deepSerializeKVPairs(value);
    if (!Array.isArray(serialized)) return normalizeRecord(serialized as t.ConfigRecord, field);
    return normalizeArray(value, field);
  }
  if (isConfigRecord(value)) return normalizeRecord(value, field);
  return value;
}

/** Deep equality for config values that ignores object key order. */
export function isConfigValueEqual(a: t.ConfigValue, b: t.ConfigValue): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => isConfigValueEqual(item, b[i]));
  }
  if (!isConfigRecord(a) || !isConfigRecord(b)) return false;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && isConfigValueEqual(a[key], b[key]));
}

/**
 * Builds the save payload from touched edits. Only admin-touched paths are
 * submitted, secret display companion paths are dropped, and display
 * companion strings nested inside object values are stripped — a masked
 * display value (`sk-mist...4321`) must never reach the backend as a value.
 *
 * With a `context`, each value is normalized (`normalizeForSave`) and compared
 * with the normalized saved value: unchanged edits are dropped, and an edit
 * that empties a field becomes a reset when the target has its own override.
 * Emptying a value the target does not own (one only librechat.yaml sets) is
 * reported as `yamlValue`: there is no override to remove, and LibreChat has
 * no way to store "unset". Paths the panel must not write (read-only sections,
 * permission fields) are reported in `skipped` instead of being sent.
 */
export function buildSavePayload(
  touchedPaths: ReadonlySet<string>,
  editedValues: t.FlatConfigMap,
  schemaPaths: ReadonlySet<string>,
  context?: t.SaveContext,
): t.SavePayload {
  const touched = [...touchedPaths].filter((p) => p in editedValues);
  const saves: t.SaveEntry[] = [];
  const resets: string[] = [];
  const skipped: t.SkippedChange[] = [];
  for (const path of touched) {
    const edited = editedValues[path];
    const reason = getWriteSkipReason(path, edited === undefined);
    if (reason) {
      skipped.push({ fieldPath: path, reason });
      continue;
    }
    if (edited === undefined) {
      resets.push(path);
      continue;
    }
    if (secretPathForPreviewPath(path, schemaPaths) != null) continue;
    const value = stripSecretPreviewValues(deepSerializeKVPairs(edited), path, schemaPaths);
    if (!context) {
      saves.push({ fieldPath: path, value });
      continue;
    }
    const field = findSchemaField(context.fields, path);
    const normalized = normalizeForSave(value, field);
    const baseline = normalizeForSave(
      stripSecretPreviewValues(deepSerializeKVPairs(context.baselineAt(path)), path, schemaPaths),
      field,
    );
    if (isConfigValueEqual(normalized, baseline)) continue;
    if (normalized !== undefined) {
      saves.push({ fieldPath: path, value: normalized });
    } else if (context.hasOverride(path)) {
      resets.push(path);
    } else {
      skipped.push({ fieldPath: path, reason: 'yamlValue' });
    }
  }
  return { touched, saves, resets, skipped };
}

export function isMcpEntryPath(path: string): boolean {
  if (!path.startsWith('mcpServers.')) return false;
  const key = path.slice('mcpServers.'.length);
  return key.length > 0 && !key.includes('.');
}

export function partitionScopeResetPaths(
  paths: string[],
  inheritedMcpKeys: Set<string>,
): {
  resetPaths: string[];
  tombstonePaths: string[];
} {
  const resetPaths: string[] = [];
  const tombstonePaths: string[] = [];
  for (const path of paths) {
    const key = path.startsWith('mcpServers.') ? path.slice('mcpServers.'.length) : '';
    if (isMcpEntryPath(path) && inheritedMcpKeys.has(key)) {
      tombstonePaths.push(path);
    } else {
      resetPaths.push(path);
    }
  }
  return { resetPaths, tombstonePaths };
}

export function applyConfigEdit(
  prev: t.FlatConfigMap,
  path: string,
  value: t.ConfigValue,
  baseline: t.FlatConfigMap,
  baselineIntermediates: Set<string>,
  baselineContainerPaths: Set<string>,
): t.FlatConfigMap {
  const indexMatch = INDEXED_ARRAY_PATH_RE.exec(path);
  if (indexMatch) {
    const [, arrayPath, indexStr] = indexMatch;
    const pendingArray = prev[arrayPath];
    if (Array.isArray(pendingArray)) {
      const next = { ...prev };
      const arr = [...pendingArray];
      arr[Number(indexStr)] = value;
      next[arrayPath] = arr;
      for (const existing of Object.keys(next)) {
        if (existing.startsWith(`${arrayPath}.`)) delete next[existing];
      }
      return next;
    }
  }

  const baselineValue = baseline[path];
  const match =
    value === baselineValue ||
    (typeof value === 'object' &&
      typeof baselineValue === 'object' &&
      JSON.stringify(value) === JSON.stringify(baselineValue));
  const isContainerDelete =
    value === undefined && (baselineIntermediates.has(path) || baselineContainerPaths.has(path));
  const hasPendingAncestorDelete = (() => {
    let lastDot = path.lastIndexOf('.');
    while (lastDot > 0) {
      const ancestor = path.slice(0, lastDot);
      if (ancestor in prev && prev[ancestor] === undefined) return true;
      lastDot = ancestor.lastIndexOf('.');
    }
    return false;
  })();
  if (match && !isContainerDelete && !hasPendingAncestorDelete) {
    const next = { ...prev };
    delete next[path];
    return next;
  }
  const next = { ...prev, [path]: value };
  if (Array.isArray(value)) {
    const prefix = `${path}.`;
    for (const k of Object.keys(next)) {
      if (k.startsWith(prefix) && INDEXED_ARRAY_PATH_RE.test(k)) delete next[k];
    }
  }
  if (indexMatch) delete next[indexMatch[1]];
  for (const existing of Object.keys(next)) {
    if (existing === path) continue;
    const newIsDescendant = path.startsWith(`${existing}.`);
    const newIsAncestor = existing.startsWith(`${path}.`);
    if (newIsDescendant && next[existing] === undefined) continue;
    if (newIsDescendant || newIsAncestor) {
      delete next[existing];
    }
  }
  return next;
}

/**
 * Merge indexed-array edits (entries whose flat path ends in `.<digit>`) into
 * a config tree. Each indexed edit's value replaces the array element at that
 * index; the array's parent path is auto-created if absent so newly-introduced
 * sections (e.g. `modelSpecs` not present in `librechat.yaml`) merge in at the
 * correct nesting level rather than getting written to the wrong parent.
 *
 * Skips an edit when an intermediate path holds a primitive or array value,
 * since overwriting those with a fresh object would silently destroy live
 * baseline data. Caller is responsible for filtering `editedValues` down to
 * indexed entries before passing.
 */
export function mergeIndexedArrayEdits(
  baseline: Record<string, t.ConfigValue>,
  indexedEdits: Array<[string, t.ConfigValue]>,
): Record<string, t.ConfigValue> {
  const merged = { ...baseline };
  for (const [path, value] of indexedEdits) {
    const segments = path.split('.');
    const index = Number(segments.pop()!);
    const arrayPath = segments;
    let parent: Record<string, t.ConfigValue> = merged;
    let bailed = false;
    for (let i = 0; i < arrayPath.length - 1; i++) {
      const seg = arrayPath[i];
      const existing = parent[seg];
      if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
        parent[seg] = { ...(existing as Record<string, t.ConfigValue>) };
      } else if (existing == null) {
        parent[seg] = {};
      } else {
        bailed = true;
        break;
      }
      parent = parent[seg] as Record<string, t.ConfigValue>;
    }
    if (bailed) continue;
    const lastSeg = arrayPath[arrayPath.length - 1];
    const arr = Array.isArray(parent[lastSeg]) ? [...(parent[lastSeg] as t.ConfigValue[])] : [];
    arr[index] = value;
    parent[lastSeg] = arr;
  }
  return merged;
}
