import type * as t from '@/types';
import {
  secretPathForPreviewPath,
  stripSecretPreviewValues,
  deepSerializeKVPairs,
  getWriteSkipReason,
  isConfigRecord,
  flattenObject,
} from '@/utils';
import { APP_SERVICE_KEY_ALIASES } from '@/constants';

const INDEXED_ARRAY_PATH_RE = /^(.+)\.(\d+)$/;

/** The schema node for one element of an array field or one value of a record field. */
function elementField(container: t.SchemaField, segment: string): t.SchemaField {
  const base = {
    ...container,
    path: `${container.path}.${segment}`,
    key: segment,
    isArray: false,
    recordValueType: undefined,
    recordValueKVTypes: undefined,
    recordValueAllowsPrimitive: undefined,
  };
  if (container.children?.length) {
    return { ...base, type: 'object', isObject: true, children: container.children };
  }
  if (container.isArray) {
    const itemType = getArrayItemType(container.type);
    return { ...base, type: itemType, isArray: itemType.startsWith('array'), isObject: false };
  }
  const kvTypes = container.recordValueKVTypes;
  return {
    ...base,
    type: kvTypes?.length === 1 ? kvTypes[0] : 'unknown',
    isObject: false,
    children: undefined,
  };
}

function isCollectionField(field: t.SchemaField): boolean {
  return field.isArray || field.type === 'record';
}

/**
 * Finds the schema node for a dot-path, stepping into array elements and record
 * values by index or key (`endpoints.custom.3.headers` → the custom endpoint
 * `headers` record). Returns null when the path leaves the schema.
 */
export function findSchemaField(tree: t.SchemaField[], path: string): t.SchemaField | null {
  let fields: t.SchemaField[] | undefined = tree;
  let current: t.SchemaField | null = null;
  for (const segment of path.split('.')) {
    if (current && isCollectionField(current)) {
      current = elementField(current, segment);
    } else {
      current = fields?.find((f) => f.key === segment) ?? null;
    }
    if (!current) return null;
    fields = current.children;
  }
  return current;
}

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

/** Whether `paths` holds `path`, a descendant of it, or an ancestor of it. */
export function hasPathOverlap(path: string, paths: ReadonlySet<string>): boolean {
  if (paths.has(path)) return true;
  const prefix = `${path}.`;
  for (const p of paths) {
    if (p.startsWith(prefix) || path.startsWith(`${p}.`)) return true;
  }
  return false;
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

/**
 * Entries of an object value whose keys the schema does not describe (settings
 * from a newer LibreChat than the panel's bundled schema). Secret preview
 * companions of known fields are not settings and are left out.
 */
export function getUnknownConfigEntries(
  fields: t.SchemaField[],
  value: t.ConfigValue,
): Array<[string, t.ConfigValue]> {
  if (!isConfigRecord(value)) return [];
  const known = new Set(fields.map((f) => f.key));
  return Object.entries(value).filter(
    ([key, child]) =>
      child !== undefined &&
      !known.has(key) &&
      !(key.endsWith('Preview') && known.has(key.slice(0, -'Preview'.length))),
  );
}

/**
 * Value a field control shows: a pending edit first, then the merged tree
 * (`fallback`). The scope's saved leaves (`resolvedValues`) are only used when
 * nothing under the path is pending — they are the stale saved array for a
 * collection whose entries are being edited.
 */
export function resolveFieldValue(
  path: string,
  fallback: t.ConfigValue,
  editedValues: t.FlatConfigMap,
  resolvedValues: t.FlatConfigMap | null | undefined,
  schemaDefaults: t.FlatConfigMap | undefined,
): t.ConfigValue {
  if (path in editedValues) {
    if (editedValues[path] === undefined) return schemaDefaults?.[path] ?? fallback;
    return editedValues[path];
  }
  if (!resolvedValues || !(path in resolvedValues)) return fallback;
  const prefix = `${path}.`;
  for (const editPath of Object.keys(editedValues)) {
    if (editPath.startsWith(prefix)) return fallback;
  }
  return resolvedValues[path];
}

export function inferKVType(v: t.ConfigValue): t.KVValueType {
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'object' && v !== null) return 'json';
  return 'string';
}

export function toKVPair(k: string, v: t.ConfigValue): t.KeyValuePair {
  const valueType = inferKVType(v);
  if (valueType === 'json') return { key: k, value: JSON.stringify(v, null, 2), valueType };
  return { key: k, value: typeof v === 'string' ? v : String(v ?? ''), valueType };
}

export function getControlType(field: t.SchemaField): t.ControlType {
  if (field.type === 'boolean') return 'toggle';
  if (field.type.startsWith('enum')) return 'select';
  if (field.type === 'number') return 'number';
  if (field.type === 'string' || field.type === 'any' || field.type.startsWith('literal(')) {
    return 'text';
  }
  if (field.type.startsWith('array') && field.children && field.children.length > 0)
    return 'array-object';
  if (field.type.startsWith('array')) return 'array';
  if (field.type === 'object' || field.isObject) return 'object';
  if (field.type === 'record' && field.recordValueType === 'complex') return 'record-object';
  if (field.type === 'record') return 'record';

  if (field.type.startsWith('union(')) {
    const types = splitUnionTypes(field.type);

    if (
      types.length === 2 &&
      types.includes('boolean') &&
      types.includes('object') &&
      field.children?.length
    ) {
      return 'switch-object';
    }
    if (types.length === 2 && types.includes('string') && types.includes('record')) {
      return 'text-record';
    }
    if (
      types.length === 2 &&
      types.includes('string') &&
      types.some((u) => u.startsWith('array'))
    ) {
      return 'text-record';
    }
    if (
      types.length === 2 &&
      types.some((u) => u.startsWith('array')) &&
      (types.includes('record') || types.every((u) => u.startsWith('array')))
    ) {
      return 'list-record';
    }

    if (types.every((u) => u.startsWith('literal('))) return 'select';
    if (types.some((u) => u.startsWith('enum(')) && !types.includes('string')) return 'select';
    if (types.includes('record') || types.some((u) => u.startsWith('array'))) return 'record';
    if (types.includes('string')) return 'text';
    if (types.includes('number')) return 'number';
    if (types.includes('boolean')) return 'toggle';
  }

  return 'record';
}

export function getEnumOptions(typeString: string): t.SelectOption[] {
  const enumMatch = typeString.match(/^enum\((.+)\)$/);
  if (enumMatch) {
    return enumMatch[1]
      .split('|')
      .map((v) => v.trim())
      .filter((v) => v.length > 0)
      .map((entry) => {
        const eqIdx = entry.indexOf('=');
        if (eqIdx !== -1) {
          const label = entry.slice(0, eqIdx);
          const value = entry.slice(eqIdx + 1);
          return {
            label: label.charAt(0).toUpperCase() + label.slice(1).toLowerCase().replace(/_/g, ' '),
            value,
          };
        }
        return {
          label: entry.charAt(0).toUpperCase() + entry.slice(1).replace(/_/g, ' '),
          value: entry,
        };
      });
  }

  if (typeString.startsWith('union(')) {
    const types = splitUnionTypes(typeString);

    for (const u of types) {
      if (u.startsWith('enum(')) {
        const opts = getEnumOptions(u);
        if (opts.length > 0) return opts;
      }
    }

    const literalValues = types
      .map((u) => u.match(/^literal\((.+)\)$/)?.[1])
      .filter((v): v is string => v != null)
      .map((v) => v.replace(/^["']|["']$/g, ''));
    if (literalValues.length > 0) {
      return literalValues.map((value) => ({
        label: value.charAt(0).toUpperCase() + value.slice(1).replace(/_/g, ' '),
        value,
      }));
    }
  }

  return [];
}

/** Coerces a select value to its runtime type. Numeric enum values arrive as
 *  strings from the HTML select element but the Zod schema expects numbers. */
export function coerceEnumValue(value: string): string | number {
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

export function getArrayItemType(typeString: string): string {
  const match = typeString.match(/array<(.+)>/);
  return match ? match[1] : 'string';
}

export function isStringLikeItemType(itemType: string): boolean {
  if (itemType === 'string' || itemType === 'any' || itemType === 'unknown') return true;
  if (itemType.startsWith('enum(')) return true;
  if (itemType.startsWith('union(')) {
    const types = splitUnionTypes(itemType);
    return types.includes('string') || types.some((u) => u.startsWith('enum('));
  }
  return false;
}

const CONTROL_ORDER: Record<string, number> = {
  toggle: 0,
  'switch-object': 0,
  select: 1,
  number: 2,
  text: 3,
  'text-record': 3,
  array: 4,
  'list-record': 4,
  'array-object': 5,
  record: 5,
  'record-object': 5,
  nested: 6,
  unknown: 7,
};

export function controlSortKey(field: t.SchemaField): number {
  const control = getControlType(field);
  if (
    field.children &&
    field.children.length > 0 &&
    !field.isArray &&
    field.type !== 'record' &&
    control !== 'switch-object'
  ) {
    return CONTROL_ORDER.nested;
  }
  return CONTROL_ORDER[control] ?? CONTROL_ORDER.unknown;
}

/** Splits a `union(A | B | C)` type string into its variants. Expects the
 *  ` | ` (space-pipe-space) delimiter produced by `getZodTypeName`. Handles
 *  nested parens (e.g. `union(enum(a|b) | string)`) via depth tracking. */
export function splitUnionTypes(typeString: string): string[] {
  const inner = typeString.match(/^union\((.+)\)$/)?.[1];
  if (!inner) return [];

  const parts: string[] = [];
  let depth = 0;
  let start = 0;

  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '(') depth++;
    else if (inner[i] === ')') depth--;
    else if (depth === 0 && inner[i] === '|' && inner[i - 1] === ' ' && inner[i + 1] === ' ') {
      parts.push(inner.slice(start, i - 1).trim());
      start = i + 2;
    }
  }
  parts.push(inner.slice(start).trim());
  return parts;
}

/** Count configured vs total leaf fields in a field tree. */
export function countConfigured(
  fields: t.SchemaField[],
  parentPath: string,
  configuredPaths?: Set<string>,
): { total: number; configured: number } {
  let total = 0;
  let configured = 0;
  for (const f of fields) {
    const p = `${parentPath}.${f.key}`;
    if (f.children?.length && !f.isArray && f.type !== 'record') {
      const sub = countConfigured(f.children, p, configuredPaths);
      total += sub.total;
      configured += sub.configured;
    } else {
      total++;
      if (configuredPaths?.has(p) || hasDescendant(p, configuredPaths)) configured++;
    }
  }
  return { total, configured };
}

/** Returns true if `paths` contains any key that is a descendant of `path`. */
export function hasDescendant(path: string, paths?: Set<string>): boolean {
  if (!paths) return false;
  const prefix = `${path}.`;
  for (const p of paths) {
    if (p.startsWith(prefix)) return true;
  }
  return false;
}

/** Include the dedicated Langfuse connection in generic configured-state UI. */
export function withLangfuseConfiguredPath(
  configuredPaths: Set<string>,
  configured: boolean,
): Set<string> {
  const paths = new Set(configuredPaths);
  if (configured) paths.add('langfuse.enabled');
  return paths;
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

/** Top-level YAML keys that describe the file itself rather than a setting. */
const IMPORT_METADATA_KEYS = new Set(['version']);

/**
 * Leaves of an imported YAML keyed by canonical dot-path. AppService alias
 * sections (`interfaceConfig`) are merged with their canonical section
 * (`interface`) leaf by leaf, the canonical spelling winning on conflicts.
 */
function flattenImport(appConfig: t.ConfigRecord): t.FlatConfigMap {
  const aliased: t.ConfigRecord = {};
  const canonical: t.ConfigRecord = {};
  for (const [key, value] of Object.entries(appConfig)) {
    if (IMPORT_METADATA_KEYS.has(key)) continue;
    const alias = APP_SERVICE_KEY_ALIASES[key];
    if (alias) aliased[alias] = value;
    else canonical[key] = value;
  }
  return { ...flattenObject(aliased), ...flattenObject(canonical) };
}

/**
 * One save entry per leaf of the imported YAML, minus metadata, empty objects
 * and redacted secret companions. Each value is normalized like a pending
 * edit (`normalizeForSave`), so blank list items are dropped; a leaf left with
 * no value (`allowedDomains: [""]`, `titleModel: ""`) is reported as skipped
 * instead of being stored as an empty override that LibreChat would read as
 * "allow nothing". Fields the panel must not write (role permissions,
 * librechat.yaml-only sections) are kept here so the save pre-flight reports
 * them as skipped instead of dropping them silently.
 */
export function collectImportEntries(
  appConfig: t.ConfigRecord,
  fields: t.SchemaField[],
  schemaPathSet: ReadonlySet<string>,
): t.ImportEntries {
  const entries: t.SaveEntry[] = [];
  const skipped: t.SkippedChange[] = [];
  for (const [fieldPath, raw] of Object.entries(flattenImport(appConfig))) {
    if (isConfigRecord(raw) && Object.keys(raw).length === 0) continue;
    if (secretPathForPreviewPath(fieldPath, schemaPathSet) != null) continue;
    const value = normalizeForSave(
      stripSecretPreviewValues(raw, fieldPath, schemaPathSet),
      findSchemaField(fields, fieldPath),
    );
    if (value == null) skipped.push({ fieldPath, reason: 'empty' });
    else entries.push({ fieldPath, value });
  }
  return { entries, skipped };
}
