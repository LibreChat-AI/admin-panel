import type * as t from '@/types';

/**
 * Convert a KeyValuePair[] to a Record with typed values.
 * Returns the original value unchanged if it's not a KV pairs array.
 */
export function serializeKVPairs(value: t.ConfigValue): t.ConfigValue {
  if (!Array.isArray(value) || value.length === 0) return value;
  const first = value[0];
  if (typeof first !== 'object' || first === null || !('key' in first) || !('value' in first))
    return value;
  const pairs = value as t.KeyValuePair[];
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const record: Record<string, t.ConfigValue> = Object.create(null);
  for (const pair of pairs) {
    if (!pair.key || DANGEROUS_KEYS.has(pair.key)) continue;
    record[pair.key] = coerceKVValue(pair.value, pair.valueType ?? 'string');
  }
  return record;
}

/** Recursively serialize KV pairs within an object tree. */
export function deepSerializeKVPairs(value: t.ConfigValue): t.ConfigValue {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const serialized = serializeKVPairs(value);
    if (serialized !== value) return serialized;
    return value.map(deepSerializeKVPairs);
  }
  const obj = value as Record<string, t.ConfigValue>;
  const result: Record<string, t.ConfigValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k] = deepSerializeKVPairs(v);
  }
  return result;
}

function coerceKVValue(raw: string, type: t.KVValueType): t.ConfigValue {
  if (type === 'boolean') return raw === 'true';
  if (type === 'number') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }
  if (type === 'json') {
    try {
      return JSON.parse(raw) as t.ConfigValue;
    } catch {
      return raw;
    }
  }
  return raw;
}

export function formatJson(value: t.ConfigValue): string {
  if (value === undefined || value === null) return '';
  return JSON.stringify(value, null, 2);
}

export function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] ?? '').toUpperCase();
}

/**
 * Whether an object has a key containing `.` (a Bedrock inference profile ID,
 * a MIME type, a dotted header name). A dot-path can't name such a key, so
 * the object is a leaf of its tree: it is read and written whole.
 */
export function hasDottedKey(value: t.ConfigValue): boolean {
  return isConfigRecord(value) && Object.keys(value).some((key) => key.includes('.'));
}

/**
 * Recursively flattens a nested object into dot-separated paths.
 * Plain objects become prefixes; arrays, primitives, and null become leaf entries,
 * and so does an object with a dotted key (`hasDottedKey`), which no path can split.
 * e.g. { balance: { startBalance: 100 } } → { 'balance.startBalance': 100 }
 */
export function flattenObject(obj: Record<string, t.ConfigValue>, prefix = ''): t.FlatConfigMap {
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const result: t.FlatConfigMap = Object.create(null);
  for (const [key, value] of Object.entries(obj)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.keys(value).length > 0 &&
      !hasDottedKey(value)
    ) {
      Object.assign(result, flattenObject(value as Record<string, t.ConfigValue>, path));
    } else {
      result[path] = value;
    }
  }
  return result;
}

/**
 * Inverse of flattenObject: expands dot-separated paths back into a nested object.
 * e.g. { 'balance.startBalance': 100 } → { balance: { startBalance: 100 } }
 */
export function unflattenObject(flat: t.FlatConfigMap): Record<string, t.ConfigValue> {
  const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
  const result: Record<string, t.ConfigValue> = {};
  for (const [path, value] of Object.entries(flat)) {
    const keys = path.split('.');
    if (keys.some((k) => DANGEROUS_KEYS.has(k))) continue;
    let current = result as Record<string, t.ConfigValue>;
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      const next = current[key];
      if (next === undefined || next === null || typeof next !== 'object' || Array.isArray(next)) {
        current[key] = {};
      }
      current = current[key] as Record<string, t.ConfigValue>;
    }
    current[keys[keys.length - 1]] = value;
  }
  return result;
}

/** Whether a config value is a plain object (a section, entry or record). */
export function isConfigRecord(value: t.ConfigValue): value is t.ConfigRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The value as an object, or an empty one. */
export function asConfigRecord(value: t.ConfigValue): t.ConfigRecord {
  return isConfigRecord(value) ? value : {};
}

/** Whether a value sets something: not unset, blank, or an empty list or object. */
export function hasConfigValue(value: t.ConfigValue): boolean {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return !isConfigRecord(value) || Object.keys(value).length > 0;
}

/** The value as text, untrimmed; `''` when it isn't text. */
export function stringOf(value: t.ConfigValue): string {
  return typeof value === 'string' ? value : '';
}

/** The value as trimmed text; `''` when it isn't text. */
export function trimmedText(value: t.ConfigValue): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** The value when it is text that says something (not blank), else undefined. */
export function filledText(value: t.ConfigValue): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/** Whether the value is a list of strings. */
export function isStringList(value: t.ConfigValue): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/** The strings of a list; anything else has none. */
export function stringItems(value: t.ConfigValue): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/**
 * The value at `segments[index…]` in `current`. Where a record yields nothing
 * by the segment alone, a key that holds dots (`gpt-4.1`, `us.anthropic.claude`)
 * is matched whole: a path built by joining keys with dots reads it back.
 */
function readSegments(current: t.ConfigValue, segments: string[], index: number): t.ConfigValue {
  if (index === segments.length) return current;
  const segment = segments[index];
  if (Array.isArray(current)) return readSegments(current[Number(segment)], segments, index + 1);
  if (!isConfigRecord(current)) return undefined;
  const direct = readSegments(current[segment], segments, index + 1);
  if (direct !== undefined) return direct;
  let key = segment;
  for (let end = index + 1; end < segments.length; end++) {
    key = `${key}.${segments[end]}`;
    if (!Object.hasOwn(current, key)) continue;
    const found = readSegments(current[key], segments, end + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** Value at a dot-path, stepping into arrays by index; a record key holding dots is read whole. */
export function getValueAtPath(root: t.ConfigValue, path: string): t.ConfigValue {
  return readSegments(root, path.split('.'), 0);
}

/** The last segment of the longest key at `start` of `segments` that `record` holds, else `start`. */
function heldKeyEnd(record: t.ConfigRecord, segments: string[], start: number): number {
  for (let end = segments.length - 1; end > start; end--) {
    if (Object.hasOwn(record, segments.slice(start, end + 1).join('.'))) return end;
  }
  return start;
}

/**
 * The keys a dot-path names in `root`, a record key holding dots (`gpt-4.1`)
 * kept whole where `root` holds it (the longest such key); past what `root`
 * holds, the path's own segments.
 */
export function splitPathIn(root: t.ConfigValue, path: string): string[] {
  const segments = path.split('.');
  const keys: string[] = [];
  let current = root;
  for (let start = 0; start < segments.length; start++) {
    const end = isConfigRecord(current) ? heldKeyEnd(current, segments, start) : start;
    const key = segments.slice(start, end + 1).join('.');
    keys.push(key);
    if (Array.isArray(current)) current = current[Number(key)];
    else current = isConfigRecord(current) ? current[key] : undefined;
    start = end;
  }
  return keys;
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

function setSegments(
  current: t.ConfigValue,
  segments: string[],
  index: number,
  value: t.ConfigValue,
): t.ConfigValue {
  if (index === segments.length) return value;
  const segment = segments[index];
  if (Array.isArray(current) && /^\d+$/.test(segment)) {
    const next = [...current];
    next[Number(segment)] = setSegments(next[Number(segment)], segments, index + 1, value);
    return next;
  }
  const record = isConfigRecord(current) ? current : {};
  return { ...record, [segment]: setSegments(record[segment], segments, index + 1, value) };
}

/**
 * Copy of `root` with `value` at a dot-path, creating missing objects on the
 * way and stepping into existing arrays by index (`undefined` stores
 * `undefined`; use `removeValueAtPath` to delete).
 */
export function setValueAtPath(
  root: t.ConfigRecord,
  path: string,
  value: t.ConfigValue,
): t.ConfigRecord {
  return setSegments(root, path.split('.'), 0, value) as t.ConfigRecord;
}

function removeSegments(current: t.ConfigValue, segments: string[], index: number): t.ConfigValue {
  const segment = segments[index];
  const last = index === segments.length - 1;
  if (Array.isArray(current)) {
    if (!/^\d+$/.test(segment) || Number(segment) >= current.length) return current;
    const next = [...current];
    if (last) next.splice(Number(segment), 1);
    else next[Number(segment)] = removeSegments(next[Number(segment)], segments, index + 1);
    return next;
  }
  if (!isConfigRecord(current) || !Object.hasOwn(current, segment)) return current;
  const next = { ...current };
  if (last) delete next[segment];
  else next[segment] = removeSegments(next[segment], segments, index + 1);
  return next;
}

/** Copy of `root` without the value at a dot-path (array items are spliced out). */
export function removeValueAtPath(root: t.ConfigRecord, path: string): t.ConfigRecord {
  return removeSegments(root, path.split('.'), 0) as t.ConfigRecord;
}

/** Whether `a` and `b` are the same path or one contains the other. */
export function isRelatedPath(a: string, b: string): boolean {
  return a === b || a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
}
