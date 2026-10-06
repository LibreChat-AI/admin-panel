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
 * Bucketed relative-time formatter for the balance-request "Requested Xh ago"
 * badge. Falls back to a locale date string beyond ~7 days — no date-library
 * dependency needed for this.
 */
export function formatRelativeTime(date: string | Date): string {
  const target = typeof date === 'string' ? new Date(date) : date;
  const diffMs = Date.now() - target.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 60) return 'just now';

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return target.toLocaleDateString();
}

/**
 * Recursively flattens a nested object into dot-separated paths.
 * Plain objects become prefixes; arrays, primitives, and null become leaf entries.
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
      Object.keys(value).length > 0
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

/** Value at a dot-path, stepping into arrays by index. */
export function getValueAtPath(root: t.ConfigValue, path: string): t.ConfigValue {
  let current: t.ConfigValue = root;
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) {
      current = current[Number(segment)];
    } else if (isConfigRecord(current)) {
      current = current[segment];
    } else {
      return undefined;
    }
  }
  return current;
}
