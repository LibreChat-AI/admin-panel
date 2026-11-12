import type * as t from '@/types';

const UNSAFE_KEY_RE = /^\$|\./;

/** Keys a server that keeps dotted keys (`dottedKeys`) refuses: `$`-prefixed and prototype names. */
const RESERVED_KEY_RE = /^\$|^(?:__proto__|constructor|prototype)$/;

/**
 * Record keys the admin API cannot store. An older server silently drops a
 * key containing `.` or starting with `$`; one that keeps dotted keys
 * (`allowDots`, its `dottedKeys` feature) refuses only `$`-prefixed keys and
 * the prototype names.
 */
export function isUnsafeConfigKey(key: string, allowDots = false): boolean {
  return (allowDots ? RESERVED_KEY_RE : UNSAFE_KEY_RE).test(key);
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
 * would drop or refuse (see `isUnsafeConfigKey`), with the dot-path of the
 * object that holds it.
 */
export function findUnsafeKeys(
  value: t.ConfigValue,
  basePath: string,
  allowDots = false,
): t.UnsafeConfigKey[] {
  if (value == null || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    if (isKeyValuePairList(value)) {
      return value
        .filter((pair) => typeof pair.key === 'string' && isUnsafeConfigKey(pair.key, allowDots))
        .map((pair) => ({ path: basePath, key: pair.key }));
    }
    return value.flatMap((item, index) => findUnsafeKeys(item, `${basePath}.${index}`, allowDots));
  }
  const found: t.UnsafeConfigKey[] = [];
  for (const [key, child] of Object.entries(value)) {
    if (isUnsafeConfigKey(key, allowDots)) found.push({ path: basePath, key });
    found.push(...findUnsafeKeys(child, basePath ? `${basePath}.${key}` : key, allowDots));
  }
  return found;
}

/** Text with nothing but whitespace (or nothing at all): not a value LibreChat can use. */
export function isBlankText(value: string): boolean {
  return value.trim() === '';
}

/** Whether typed text is a value: not blank, or (`keepsWhitespace`, a stop sequence) not empty. */
export function isFilledText(value: string, keepsWhitespace = false): boolean {
  return keepsWhitespace ? value !== '' : !isBlankText(value);
}

/** Keys whose text keeps its whitespace as the value: stop sequences (`"\n"`, `"\n\n"`). */
const WHITESPACE_SIGNIFICANT_KEYS: ReadonlySet<string> = new Set(['stop']);

/** Whether text at `path` is whitespace-significant: a `stop` value, or an item of a `stop` list. */
export function isWhitespaceSignificantPath(path: string): boolean {
  const segments = path.split('.');
  let last = segments.length - 1;
  while (last > 0 && /^\d+$/.test(segments[last])) last--;
  return WHITESPACE_SIGNIFICANT_KEYS.has(segments[last]);
}

function blankPairs(pairs: t.KeyValuePair[], basePath: string): t.BlankConfigText[] {
  return pairs.flatMap((pair): t.BlankConfigText[] => {
    if (typeof pair.key === 'string' && isBlankText(pair.key)) {
      return [{ path: basePath, key: pair.key }];
    }
    const valuePath = `${basePath}.${pair.key}`;
    if (typeof pair.value !== 'string' || !isBlankText(pair.value)) return [];
    return isWhitespaceSignificantPath(valuePath) && pair.value !== '' ? [] : [{ path: valuePath }];
  });
}

/**
 * Whitespace-only strings and object keys under `value`: LibreChat would
 * store them and read them as values (a Base URL of `"   "`, a header named
 * `"  "`). A blank key reports the path of the object holding it; a blank
 * string, its own path. Stop sequences keep their whitespace and pass. An
 * empty string under an object (a header row with a key but no value) is
 * blank as well: saved, LibreChat would send it as an empty header.
 */
export function findBlankText(value: t.ConfigValue, basePath: string): t.BlankConfigText[] {
  return blankTextIn(value, basePath, false);
}

function blankTextIn(
  value: t.ConfigValue,
  basePath: string,
  isEntry: boolean,
): t.BlankConfigText[] {
  if (typeof value === 'string') {
    if (value === '') return isEntry ? [{ path: basePath }] : [];
    if (!isBlankText(value) || isWhitespaceSignificantPath(basePath)) return [];
    return [{ path: basePath }];
  }
  if (value == null || typeof value !== 'object') return [];
  if (Array.isArray(value)) {
    if (isKeyValuePairList(value)) return blankPairs(value, basePath);
    return value.flatMap((item, index) => blankTextIn(item, `${basePath}.${index}`, false));
  }
  return Object.entries(value).flatMap(([key, child]) => {
    if (isBlankText(key)) return [{ path: basePath, key }];
    return blankTextIn(child, basePath ? `${basePath}.${key}` : key, true);
  });
}
