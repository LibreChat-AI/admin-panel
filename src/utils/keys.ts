import type * as t from '@/types';

const UNSAFE_KEY_RE = /^\$|\./;

/** Record keys the admin API cannot store: containing `.` or starting with `$`. */
export function isUnsafeConfigKey(key: string): boolean {
  return UNSAFE_KEY_RE.test(key);
}

function isKeyValuePairList(value: t.ConfigValue[]): value is t.KeyValuePair[] {
  const first = value[0];
  return (
    first != null &&
    typeof first === 'object' &&
    !Array.isArray(first) &&
    'key' in first &&
    'value' in first
  );
}

/**
 * Every object key (or key/value-pair key) under `value` that the admin API
 * would silently drop, with the dot-path of the object that holds it.
 */
export function findUnsafeKeys(value: t.ConfigValue, basePath: string): t.UnsafeConfigKey[] {
  if (value == null || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    if (isKeyValuePairList(value)) {
      return value
        .filter((pair) => typeof pair.key === 'string' && isUnsafeConfigKey(pair.key))
        .map((pair) => ({ path: basePath, key: pair.key }));
    }
    return value.flatMap((item, index) => findUnsafeKeys(item, `${basePath}.${index}`));
  }
  const found: t.UnsafeConfigKey[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (isUnsafeConfigKey(key)) found.push({ path: basePath, key });
    found.push(...findUnsafeKeys(child, basePath ? `${basePath}.${key}` : key));
  }
  return found;
}
