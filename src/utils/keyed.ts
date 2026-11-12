import type * as t from '@/types';
import { getValueAtPath, isConfigRecord, setValueAtPath, removeValueAtPath } from './format';
import { BUNDLED_CONFIG_LIMITS, KEYED_COLLECTIONS } from '@/constants';

/** Where a keyed path names its entry: `endpoints.custom["Name"]`. */
const KEY_STEP_OPEN = '["';

/** Entry names a keyed path can't name: `$…`, `__…`, `constructor` and `prototype`. */
const UNSAFE_ENTRY_KEY = /^(?:\$|__)|^(?:constructor|prototype)$/;

/**
 * Whether a path names an entry by its key (`endpoints.custom["Name"].headers`),
 * so it is read with `parseKeyedPath`, never split on its dots.
 */
export function isKeyedPath(path: string): boolean {
  return path.includes(KEY_STEP_OPEN);
}

/**
 * The keyed path LibreChat stores a tombstone of one entry of a collection
 * merged by key under (`keyedTombstones`): the collection, the entry's key
 * as a JSON string (so a name may hold dots, quotes or brackets), and a
 * dotted path inside the entry, if any.
 */
export function formatKeyedPath(collection: string, key: string, rest = ''): string {
  const entry = `${collection}[${JSON.stringify(key)}]`;
  return rest ? `${entry}.${rest}` : entry;
}

/** Index of the quote that closes the JSON string starting at `start`, or -1. */
function findStringEnd(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index++) {
    if (text[index] === '\\') index++;
    else if (text[index] === '"') return index;
  }
  return -1;
}

function readEntryKey(literal: string): string | null {
  try {
    const key: unknown = JSON.parse(literal);
    return typeof key === 'string' ? key : null;
  } catch {
    return null;
  }
}

/**
 * A keyed path (`formatKeyedPath`) of a collection merged by key, read; null
 * for any other path. A list edited entry by entry only on some servers (Azure groups)
 * has no keyed paths the panel edits: no flag says the server addresses its
 * entries by key. With `gated`, its keyed paths are read too, to name what
 * another client stored.
 */
export function parseKeyedPath(path: string, gated = false): t.KeyedPath | null {
  const open = path.indexOf(KEY_STEP_OPEN);
  if (open <= 0) return null;
  const collection = KEYED_COLLECTIONS.get(path.slice(0, open));
  if (collection?.merge !== 'byKey' || (collection.gate !== undefined && !gated)) return null;
  const close = findStringEnd(path, open + 1);
  if (close === -1 || path[close + 1] !== ']') return null;
  const key = readEntryKey(path.slice(open + 1, close + 1));
  const after = path.slice(close + 2);
  if (key === null || (after !== '' && !after.startsWith('.'))) return null;
  return { collection, key, rest: after.slice(1) };
}

/**
 * Whether a keyed path can name an entry called `key` (LibreChat refuses the
 * others): 1 to `maxLength` characters, not starting with `$` or `__`, and
 * not `constructor` or `prototype`.
 */
export function isAddressableEntryKey(
  key: string,
  maxLength = BUNDLED_CONFIG_LIMITS.maxEntryKeyLength,
): boolean {
  return key !== '' && key.length <= maxLength && !UNSAFE_ENTRY_KEY.test(key);
}

/** Whether a dotted path inside an entry can follow its key step: safe, dot-free keys only. */
export function isAddressableEntryPath(segments: readonly string[]): boolean {
  return segments.every(
    (segment) =>
      segment !== '' &&
      !segment.includes('.') &&
      !segment.includes(KEY_STEP_OPEN) &&
      !UNSAFE_ENTRY_KEY.test(segment),
  );
}

/** An entry name as LibreChat matches it in its collection (`ollama` is the `Ollama` endpoint). */
export function entryIdentityOf(collection: t.KeyedCollection, name: string): string {
  return collection.servedName ? collection.servedName(name) : name;
}

/** Whether `entry` is the one a keyed path names: its key matched as LibreChat matches it. */
export function isKeyedEntry(keyed: t.KeyedPath, entry: t.ConfigValue): boolean {
  if (!isConfigRecord(entry)) return false;
  const name = entry[keyed.collection.key];
  if (typeof name !== 'string') return false;
  return entryIdentityOf(keyed.collection, name) === entryIdentityOf(keyed.collection, keyed.key);
}

/** The value a keyed path names in `root`: its entry, or the value at the path inside it. */
export function getKeyedValue(root: t.ConfigValue, keyed: t.KeyedPath): t.ConfigValue {
  const list = getValueAtPath(root, keyed.collection.path);
  if (!Array.isArray(list)) return undefined;
  const entry = list.find((item) => isKeyedEntry(keyed, item));
  return keyed.rest ? getValueAtPath(entry, keyed.rest) : entry;
}

/** Whether an entry holds nothing but its key, which LibreChat drops from a stored override. */
function isBareEntry(entry: t.ConfigValue, key: string): boolean {
  return isConfigRecord(entry) && Object.keys(entry).every((field) => field === key);
}

/**
 * `root` without what a keyed path names, as LibreChat applies its tombstone
 * or reset: the entry itself, or the value at the path inside it. With
 * `dropBare` (a stored override), an entry left holding only its key goes too.
 */
export function removeKeyedValue(
  root: t.ConfigRecord,
  keyed: t.KeyedPath,
  dropBare = false,
): t.ConfigRecord {
  const { collection, rest } = keyed;
  const list = getValueAtPath(root, collection.path);
  if (!Array.isArray(list) || !list.some((item) => isKeyedEntry(keyed, item))) return root;
  const next = list.flatMap((item): t.ConfigValue[] => {
    if (!isKeyedEntry(keyed, item)) return [item];
    if (!rest) return [];
    const trimmed = removeValueAtPath(item as t.ConfigRecord, rest);
    return dropBare && isBareEntry(trimmed, collection.key) ? [] : [trimmed];
  });
  return setValueAtPath(root, collection.path, next);
}

/** The value at `path` in `root`, a keyed path read by its entry (`getKeyedValue`). */
export function getConfigPathValue(root: t.ConfigValue, path: string): t.ConfigValue {
  const keyed = parseKeyedPath(path);
  return keyed ? getKeyedValue(root, keyed) : getValueAtPath(root, path);
}

/** `root` without the value at `path`, a keyed path removed by its entry (`removeKeyedValue`). */
export function removeConfigPathValue(
  root: t.ConfigRecord,
  path: string,
  dropBare = false,
): t.ConfigRecord {
  const keyed = parseKeyedPath(path);
  return keyed ? removeKeyedValue(root, keyed, dropBare) : removeValueAtPath(root, path);
}

/**
 * `root` without what the keyed tombstones among `tombstones` name (an
 * entry, or a value inside one), as LibreChat applies them to the layer
 * beneath the target (`keyedTombstones`); dotted tombstones are left.
 */
export function withoutKeyedTombstones(
  root: t.ConfigRecord,
  tombstones: Iterable<string>,
): t.ConfigRecord {
  let result = root;
  for (const path of tombstones) {
    const keyed = parseKeyedPath(path);
    if (keyed) result = removeKeyedValue(result, keyed);
  }
  return result;
}

/**
 * Whether `path` is `ancestor` or below it: after a dot, or after the key
 * step of an entry of it (`endpoints.custom["Name"]` is below `endpoints.custom`).
 */
export function isPathAtOrUnder(path: string, ancestor: string): boolean {
  return (
    path === ancestor ||
    path.startsWith(`${ancestor}.`) ||
    path.startsWith(`${ancestor}${KEY_STEP_OPEN}`)
  );
}

/**
 * Whether keyed path `path` names the entry of `keyed` (as LibreChat matches
 * names), at the path `keyed` names inside it or below it.
 */
export function isKeyedAtOrUnder(path: string, keyed: t.KeyedPath): boolean {
  const other = parseKeyedPath(path);
  if (!other || other.collection.path !== keyed.collection.path) return false;
  const { collection } = keyed;
  if (entryIdentityOf(collection, other.key) !== entryIdentityOf(collection, keyed.key)) {
    return false;
  }
  return !keyed.rest || isPathAtOrUnder(other.rest, keyed.rest);
}

/**
 * The entries of `collection` whole-entry keyed tombstones hide, by the
 * identity LibreChat matches them by, each with the tombstone's path.
 */
export function hiddenEntriesOf(
  tombstones: Iterable<string>,
  collection: t.KeyedCollection,
): Map<string, string> {
  const hidden = new Map<string, string>();
  for (const path of tombstones) {
    const keyed = parseKeyedPath(path);
    if (!keyed || keyed.rest || keyed.collection.path !== collection.path) continue;
    hidden.set(entryIdentityOf(collection, keyed.key), path);
  }
  return hidden;
}

/**
 * The entries of a keyed collection the target hides or removes values of
 * by key (`endpoints.custom["Name"]…`), by name: each is an entry it
 * overrides. With `gated`, a list edited by entry only on some servers
 * (Azure groups) is read too (`parseKeyedPath`).
 */
export function keyedEntriesOf(
  tombstones: Iterable<string>,
  collection: t.KeyedCollection,
  gated = false,
): string[] {
  return [...tombstones].flatMap((path) => {
    const keyed = parseKeyedPath(path, gated);
    return keyed?.collection.path === collection.path ? [keyed.key] : [];
  });
}

/**
 * The entries of a keyed collection hidden whole once pending hides and
 * unhides (`edits`) are saved over the stored `tombstones`, by identity.
 */
export function hiddenAfterEdits(
  tombstones: Iterable<string>,
  edits: Readonly<Record<string, t.VisibilityEdit>>,
  collection: t.KeyedCollection,
): Set<string> {
  const hidden = new Set<string>();
  for (const [identity, path] of hiddenEntriesOf(tombstones, collection)) {
    if (edits[path] !== 'unhide') hidden.add(identity);
  }
  const hides = Object.keys(edits).filter((path) => edits[path] === 'hide');
  for (const identity of hiddenEntriesOf(hides, collection).keys()) hidden.add(identity);
  return hidden;
}

/**
 * The keys of the record at `record` inside entry `name` that keyed
 * tombstones remove (`endpoints.custom["Gateway"].headers.X-Team` → `X-Team`
 * of `headers`).
 */
export function hiddenRecordKeysOf(
  tombstones: Iterable<string>,
  collection: t.KeyedCollection,
  name: string,
  record: string,
): Set<string> {
  const keys = new Set<string>();
  const identity = entryIdentityOf(collection, name);
  const prefix = `${record}.`;
  for (const path of tombstones) {
    const keyed = parseKeyedPath(path);
    if (!keyed || keyed.collection.path !== collection.path) continue;
    if (entryIdentityOf(collection, keyed.key) !== identity || !keyed.rest.startsWith(prefix)) {
      continue;
    }
    const key = keyed.rest.slice(prefix.length);
    if (key !== '' && !key.includes('.')) keys.add(key);
  }
  return keys;
}
