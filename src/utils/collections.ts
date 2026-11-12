import type * as t from '@/types';
import { isConfigRecord, getValueAtPath, isConfigValueEqual } from './format';
import { KEYED_COLLECTIONS, BUNDLED_CONFIG_RULES } from '@/constants';

type UpsertEntryOp = Extract<t.EntryChange, { op: 'upsertEntry' }>;
type RemoveEntryOp = Extract<t.EntryChange, { op: 'removeEntry' }>;

/** Object paths LibreChat replaces whole instead of merging (its `ATOMIC_MERGE_PATHS`, in YAML keys). */
const ATOMIC_MERGE_PATHS: ReadonlySet<string> = new Set(BUNDLED_CONFIG_RULES.atomicMergePaths);

/** The keyed collection stored at exactly `path`. */
export function getKeyedCollection(path: string): t.KeyedCollection | undefined {
  return KEYED_COLLECTIONS.get(path);
}

/**
 * Whether the server merges a collection entry by entry, so each entry a
 * target stores is one override: a `byKey` list, a gated one (Azure groups)
 * only where the panel edits it entry by entry (`gate`).
 */
export function mergesByKey(collection: t.KeyedCollection, features: t.ConfigFeatures): boolean {
  if (collection.merge !== 'byKey') return false;
  return collection.gate?.(features) ?? true;
}

/** The lists the server merges entry by entry, by path (`mergesByKey`): saving one never takes over the whole list. */
export function mergedListPaths(features: t.ConfigFeatures): ReadonlySet<string> {
  return new Set(
    [...KEYED_COLLECTIONS.values()]
      .filter((collection) => mergesByKey(collection, features))
      .map((collection) => collection.path),
  );
}

/**
 * The location of a named entry (`mcpServers.github`, `endpoints.custom.Moonshot`),
 * by the name LibreChat serves a keyed collection's entry under, so two
 * spellings of one entry are one location (`endpoints.custom.ollama` for `Ollama`).
 */
export function entryLocation(path: string, name: string): string {
  const servedName = KEYED_COLLECTIONS.get(path)?.servedName;
  return `${path}.${servedName ? servedName(name) : name}`;
}

/**
 * The keyed collection `path` is an entry of, or a field inside an entry of
 * (`endpoints.custom.3.baseURL` → `endpoints.custom`, index 3, rest `baseURL`).
 */
export function findKeyedCollectionEntry(
  path: string,
): { collection: t.KeyedCollection; index: number; rest: string } | undefined {
  for (const collection of KEYED_COLLECTIONS.values()) {
    const prefix = `${collection.path}.`;
    if (!path.startsWith(prefix)) continue;
    const tail = path.slice(prefix.length);
    const dot = tail.indexOf('.');
    const segment = dot === -1 ? tail : tail.slice(0, dot);
    if (!/^\d+$/.test(segment)) return undefined;
    return { collection, index: Number(segment), rest: dot === -1 ? '' : tail.slice(dot + 1) };
  }
  return undefined;
}

/**
 * `path` inside an entry of a keyed collection in `from` (`endpoints.custom.25.name`),
 * pointed at the same entry, by identity, in `to` (`endpoints.custom.24.name` once an
 * earlier entry is removed). An entry `to` no longer has is named by its identity
 * (`endpoints.custom.BrandNew.name`), which no position matches. Paths outside keyed
 * collections, and entries without an identity, are returned as they are.
 */
export function moveEntryPath(path: string, from: t.ConfigValue, to: t.ConfigValue): string {
  const located = findKeyedCollectionEntry(path);
  if (!located) return path;
  const { collection, index, rest } = located;
  const fromList = getValueAtPath(from, collection.path);
  const identity = Array.isArray(fromList)
    ? getEntryKey(fromList[index], collection.key)
    : undefined;
  if (identity === undefined) return path;
  const toList = getValueAtPath(to, collection.path);
  const at = Array.isArray(toList) ? indexOfKey(toList, collection.key, identity) : -1;
  const moved = `${collection.path}.${at < 0 ? identity : at}`;
  return rest ? `${moved}.${rest}` : moved;
}

/**
 * Identities of the entries of a keyed list that the stored override adds or
 * changes (compared with the lower layer's entry of the same identity). The
 * list is stored as one value (`endpoints.custom`), so its override paths
 * name no entry; this is how many entries an admin has overridden.
 */
export function overriddenEntryKeys(
  collection: t.KeyedCollection,
  stored: t.ConfigValue,
  lower: t.ConfigValue,
): Set<string> {
  const keys = new Set<string>();
  if (!Array.isArray(stored)) return keys;
  const lowerList = Array.isArray(lower) ? lower : [];
  for (const entry of stored) {
    const identity = getEntryKey(entry, collection.key);
    if (identity === undefined) continue;
    const lowerEntry = lowerList[indexOfKey(lowerList, collection.key, identity)];
    if (
      lowerEntry === undefined ||
      !isConfigValueEqual(mergeConfigLayers(lowerEntry, entry), lowerEntry)
    ) {
      keys.add(identity);
    }
  }
  return keys;
}

/** An entry's identity: its key field when that is a non-empty string. */
export function getEntryKey(entry: t.ConfigValue, key: string): string | undefined {
  if (!isConfigRecord(entry)) return undefined;
  const value = entry[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** A list's entries by identity (their `key` field); entries without one are left out. */
export function entriesByKey(list: t.ConfigValue, key: string): Map<string, t.ConfigValue> {
  return new Map(
    (Array.isArray(list) ? list : []).flatMap((entry) => {
      const identity = getEntryKey(entry, key);
      return identity === undefined ? [] : [[identity, entry] as const];
    }),
  );
}

/** Position of the entry with identity `identity` in a list (-1 when absent or not a list). */
export function findEntryIndex(list: t.ConfigValue, key: string, identity: string): number {
  return Array.isArray(list) ? indexOfKey(list, key, identity) : -1;
}

function toEntries(value: t.ConfigValue): t.ConfigValue[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function indexOfKey(entries: t.ConfigValue[], key: string, value: string): number {
  return entries.findIndex((entry) => getEntryKey(entry, key) === value);
}

/**
 * `lower` without its secret where `upper` holds one of its own: a key, or
 * the preview a stored key reads back as. A key and its preview travel
 * together, and LibreChat sends the upper entry's key, so the lower entry's
 * (a librechat.yaml `${VAR}`) never shows beside it.
 */
export function withoutShadowedSecret(
  lower: t.ConfigRecord,
  upper: t.ConfigRecord,
  collection: t.KeyedCollection,
): t.ConfigRecord {
  const secret = collection.secret;
  if (!secret || !(secret.key in lower || secret.preview in lower)) return lower;
  if (!suppliesSecret(upper, collection) && !hasHiddenSecret(upper, collection)) return lower;
  const { [secret.key]: _key, [secret.preview]: _preview, ...rest } = lower;
  return rest;
}

function mergeEntriesByKey(
  lower: t.ConfigValue[],
  upper: t.ConfigValue[],
  collection: t.KeyedCollection,
  path: string,
): t.ConfigValue[] {
  const { key } = collection;
  const upperByKey = new Map<string, t.ConfigValue>();
  for (const item of upper) {
    const id = getEntryKey(item, key);
    if (id !== undefined) upperByKey.set(id, item);
  }
  const seen = new Set<string>();
  const result = lower.map((item) => {
    const id = getEntryKey(item, key);
    const override = id === undefined ? undefined : upperByKey.get(id);
    if (id === undefined || override === undefined) return item;
    seen.add(id);
    const below =
      isConfigRecord(item) && isConfigRecord(override)
        ? withoutShadowedSecret(item, override, collection)
        : item;
    return mergeConfigLayers(below, override, path);
  });
  for (const [id, item] of upperByKey) {
    if (!seen.has(id)) result.push(mergeConfigLayers({}, item, path));
  }
  return result;
}

/**
 * `upper` layered over `lower` the way LibreChat merges overrides: objects
 * merge key by key, keyed `byKey` collections merge entry by entry, and any
 * other value (arrays included) replaces the one beneath it.
 */
export function mergeConfigLayers(
  lower: t.ConfigValue,
  upper: t.ConfigValue,
  path = '',
): t.ConfigValue {
  if (upper === undefined) return lower;
  if (isConfigRecord(lower) && isConfigRecord(upper) && !ATOMIC_MERGE_PATHS.has(path)) {
    const result: t.ConfigRecord = { ...lower };
    for (const [key, value] of Object.entries(upper)) {
      result[key] = mergeConfigLayers(lower[key], value, path ? `${path}.${key}` : key);
    }
    return result;
  }
  const collection = KEYED_COLLECTIONS.get(path);
  if (collection?.merge === 'byKey' && Array.isArray(lower) && Array.isArray(upper)) {
    return mergeEntriesByKey(lower, upper, collection, path);
  }
  return upper;
}

/**
 * The smallest override that, merged over `lower`, yields `desired`: keys
 * equal to the lower value are left out and nested objects are diffed key by
 * key (arrays and scalars are whole values). `unremovable` lists the keys
 * (dot-paths) `desired` drops but `lower` has: a merge cannot remove them.
 */
export function diffOverride(
  lower: t.ConfigValue,
  desired: t.ConfigValue,
  path = '',
): { value: t.ConfigValue; unremovable: string[] } {
  if (isConfigValueEqual(lower, desired)) return { value: undefined, unremovable: [] };
  if (!isConfigRecord(lower) || !isConfigRecord(desired) || ATOMIC_MERGE_PATHS.has(path)) {
    return { value: desired, unremovable: [] };
  }
  const value: t.ConfigRecord = {};
  const unremovable: string[] = [];
  for (const [key, child] of Object.entries(desired)) {
    if (child === undefined) continue;
    const childPath = path ? `${path}.${key}` : key;
    const diff = diffOverride(lower[key], child, childPath);
    if (diff.value !== undefined) value[key] = diff.value;
    unremovable.push(...diff.unremovable);
  }
  for (const key of Object.keys(lower)) {
    if (lower[key] !== undefined && desired[key] === undefined) {
      unremovable.push(path ? `${path}.${key}` : key);
    }
  }
  return { value: Object.keys(value).length > 0 ? value : undefined, unremovable };
}

/**
 * Three-way merge of an entry: what changed from `baseline` to `value` (the
 * editor's view before and after the edit) is applied to `fresh` (the entry
 * as stored now), so values someone else saved meanwhile are kept.
 */
export function applyEntryChanges(
  fresh: t.ConfigValue,
  baseline: t.ConfigValue,
  value: t.ConfigValue,
): t.ConfigValue {
  if (isConfigValueEqual(baseline, value)) return fresh;
  if (!isConfigRecord(fresh) || !isConfigRecord(baseline) || !isConfigRecord(value)) {
    return value;
  }
  const result: t.ConfigRecord = { ...fresh };
  for (const key of new Set([...Object.keys(baseline), ...Object.keys(value)])) {
    if (isConfigValueEqual(baseline[key], value[key])) continue;
    if (value[key] === undefined) delete result[key];
    else result[key] = applyEntryChanges(fresh[key], baseline[key], value[key]);
  }
  return result;
}

interface ResolveState {
  input: t.CollectionOpsInput;
  entries: t.ConfigValue[];
  issues: t.ConfigIssue[];
  warnings: t.ConfigWarning[];
  effective: number;
  /** Identities a later op of the batch renames. */
  pendingRenames: Set<string>;
  /** The temporary key of each entry moved aside until its own rename (`moveAside`). */
  aside: Map<string, string>;
  /** Renames whose stored secret the server carries (`carriesSecrets`). */
  renames: t.EntryRename[];
}

const ASIDE_KEY_PREFIX = '\u0000aside:';

/** Where the entry loaded as `identity` is now (under its temporary key while moved aside). */
function locate(state: ResolveState, identity: string): number {
  const name = state.aside.get(identity) ?? identity;
  return indexOfKey(state.entries, state.input.collection.key, name);
}

/**
 * Frees `name` for a rename or an add when the entry holding it is renamed by
 * a later op of the batch (a swap, `A → B` with `B → A`, or a chain): that
 * entry waits under a temporary key until its own rename runs, so the batch
 * is resolved as a whole and only names the final list repeats collide. An
 * entry the lower layer also defines keeps its name (it can't be renamed).
 */
function moveAside(state: ResolveState, name: string, lowerEntries: t.ConfigValue[]): void {
  if (!state.pendingRenames.has(name) || state.aside.has(name)) return;
  const { key } = state.input.collection;
  const index = indexOfKey(state.entries, key, name);
  if (index < 0 || indexOfKey(lowerEntries, key, name) >= 0) return;
  const temporary = `${ASIDE_KEY_PREFIX}${name}`;
  state.entries = state.entries.map((entry, i) =>
    i === index ? withKey(entry, key, temporary) : entry,
  );
  state.aside.set(name, temporary);
}

/** Gives entries still moved aside (their rename was refused) their names back. */
function restoreAside(state: ResolveState): void {
  if (state.aside.size === 0) return;
  const { key } = state.input.collection;
  const identities = new Map([...state.aside].map(([identity, name]) => [name, identity]));
  state.entries = state.entries.map((entry) => {
    const identity = identities.get(getEntryKey(entry, key) ?? '');
    return identity === undefined ? entry : withKey(entry, key, identity);
  });
  state.aside.clear();
}

function entryIssue(
  collection: t.KeyedCollection,
  code: string,
  identity: string,
  message: string,
  params: Record<string, string> = {},
): t.ConfigIssue {
  return {
    path: collection.path,
    code,
    message,
    entryIdentity: identity,
    entryPath: '',
    params: { name: identity, ...params },
  };
}

/** A rename onto a name another entry has: shown on the entry's name field. */
function renameTakenIssue(
  collection: t.KeyedCollection,
  identity: string,
  name: string,
): t.ConfigIssue {
  return {
    ...entryIssue(collection, 'DUPLICATE_ENTRY', identity, `"${name}" already exists`, { name }),
    entryPath: collection.key,
  };
}

function immutableIssue(
  input: t.CollectionOpsInput,
  identity: string,
  rename: boolean,
): t.ConfigIssue {
  const code = input.lowerKind === 'yaml' ? 'YAML_ENTRY_IMMUTABLE' : 'INHERITED_ENTRY_IMMUTABLE';
  const where = input.lowerKind === 'yaml' ? 'librechat.yaml' : 'the base configuration';
  const action = rename ? 'renamed' : 'removed';
  return entryIssue(
    input.collection,
    code,
    identity,
    `"${identity}" is defined in ${where} and can't be ${action} here`,
    { action },
  );
}

function withoutPreview(value: t.ConfigValue, collection: t.KeyedCollection): t.ConfigValue {
  const preview = collection.secret?.preview;
  if (!preview || !isConfigRecord(value) || !(preview in value)) return value;
  const { [preview]: _omit, ...rest } = value;
  return rest;
}

/** A stored entry whose secret is encrypted: the redacted read keeps only the preview companion. */
export function hasHiddenSecret(entry: t.ConfigValue, collection: t.KeyedCollection): boolean {
  const secret = collection.secret;
  if (!secret || !isConfigRecord(entry) || secret.key in entry) return false;
  const preview = entry[secret.preview];
  return typeof preview === 'string' && preview !== '';
}

function suppliesSecret(value: t.ConfigValue, collection: t.KeyedCollection): boolean {
  const secret = collection.secret;
  if (!secret || !isConfigRecord(value)) return false;
  const supplied = value[secret.key];
  return typeof supplied === 'string' && supplied.trim() !== '';
}

function withKey(value: t.ConfigValue, key: string, identity: string): t.ConfigValue {
  return isConfigRecord(value) ? { ...value, [key]: identity } : { [key]: identity };
}

/**
 * The entry an upsert asks for: with a baseline, only what the edit changed is
 * applied to the current entry; without one (an import), the given keys are
 * merged into it, so keys the value does not mention are kept (D4).
 */
function desiredEntry(op: UpsertEntryOp, fresh: t.ConfigValue, state: ResolveState): t.ConfigValue {
  const { collection } = state.input;
  const value = withoutPreview(op.value, collection);
  if (op.baseline !== undefined) {
    return applyEntryChanges(fresh, withoutPreview(op.baseline, collection), value);
  }
  return fresh === undefined ? value : mergeConfigLayers(fresh, value);
}

/**
 * Why `name` can't be given to an entry although no entry has it exactly: a
 * name with a leading or trailing space (Create trims it; LibreChat would
 * serve it as typed), a name LibreChat reserves, or one it serves as the same entry as another
 * (`ollama` next to `Ollama`), which would replace that entry at runtime.
 * `self` is the entry being renamed, which doesn't collide with itself.
 */
function nameConflict(
  state: ResolveState,
  lowerEntries: t.ConfigValue[],
  name: string,
  self?: string,
): t.ConfigIssue | undefined {
  const { collection } = state.input;
  const identity = self ?? name;
  if (collection.servedName && name.trim() !== name) {
    return {
      ...entryIssue(
        collection,
        'ENTRY_NAME_WHITESPACE',
        identity,
        `"${name}" starts or ends with a space`,
        { name },
      ),
      entryPath: collection.key,
    };
  }
  if (collection.reservedNames?.has(name)) {
    return {
      ...entryIssue(collection, 'RESERVED_ENTRY_NAME', identity, `"${name}" is reserved`, {
        name,
      }),
      entryPath: collection.key,
    };
  }
  const served = collection.servedName;
  if (!served) return undefined;
  const target = served(name);
  const other = [...state.entries, ...lowerEntries]
    .map((entry) => getEntryKey(entry, collection.key))
    .find((key) => key !== undefined && key !== name && key !== self && served(key) === target);
  if (other === undefined) return undefined;
  return {
    ...entryIssue(
      collection,
      'MERGED_ENTRY_NAME',
      identity,
      `"${name}" and "${other}" are the same entry to LibreChat`,
      { name, other },
    ),
    entryPath: collection.key,
  };
}

function hasKey(state: ResolveState, lowerEntries: t.ConfigValue[], name: string): boolean {
  const { key } = state.input.collection;
  return indexOfKey(state.entries, key, name) >= 0 || indexOfKey(lowerEntries, key, name) >= 0;
}

/**
 * Whether the server can move the stored secret of entry `identity` to its
 * new name `name` (`carriesSecrets`): a plain rename, not one that swaps or
 * chains names with another entry of the batch, which a `rename` change
 * applied in order can't express.
 */
function carriesSecret(state: ResolveState, identity: string, name: string): boolean {
  return (
    state.input.carriesSecrets === true && !state.aside.has(identity) && !state.aside.has(name)
  );
}

function upsertByKey(
  op: UpsertEntryOp,
  state: ResolveState,
  lowerEntries: t.ConfigValue[],
  hiddenSecrets: ReadonlySet<string>,
): void {
  const { collection } = state.input;
  const { key } = collection;
  if (op.identity === null) {
    moveAside(state, op.key, lowerEntries);
    if (hasKey(state, lowerEntries, op.key)) {
      state.issues.push(
        entryIssue(collection, 'DUPLICATE_ENTRY', op.key, `"${op.key}" already exists`),
      );
      return;
    }
    const conflict = nameConflict(state, lowerEntries, op.key);
    if (conflict) {
      state.issues.push(conflict);
      return;
    }
    state.entries = [...state.entries, withKey(withoutPreview(op.value, collection), key, op.key)];
    state.effective++;
    return;
  }
  const identity = op.identity;
  const lowerEntry = lowerEntries.find((entry) => getEntryKey(entry, key) === identity);
  const index = locate(state, identity);
  if (op.key !== identity) {
    if (lowerEntry !== undefined) {
      state.issues.push(immutableIssue(state.input, identity, true));
      return;
    }
    if (index < 0) {
      state.issues.push(notFoundIssue(collection, identity));
      return;
    }
    moveAside(state, op.key, lowerEntries);
    if (hasKey(state, lowerEntries, op.key)) {
      state.issues.push(renameTakenIssue(collection, identity, op.key));
      return;
    }
    const conflict = nameConflict(state, lowerEntries, op.key, identity);
    if (conflict) {
      state.issues.push(conflict);
      return;
    }
    if (hiddenSecrets.has(identity) && !suppliesSecret(op.value, collection)) {
      if (!carriesSecret(state, identity, op.key)) {
        state.issues.push(
          entryIssue(
            collection,
            'SECRET_REQUIRED_FOR_RENAME',
            identity,
            `Re-enter the API key to rename "${identity}": its stored key can't be carried over to a new name`,
          ),
        );
        return;
      }
      state.renames.push({ path: state.input.collection.path, from: identity, to: op.key });
    }
    const renamed = withKey(desiredEntry(op, state.entries[index], state), key, op.key);
    state.entries = state.entries.map((entry, i) => (i === index ? renamed : entry));
    state.aside.delete(identity);
    state.effective++;
    return;
  }
  if (lowerEntry === undefined && index < 0) {
    state.issues.push(notFoundIssue(collection, identity));
    return;
  }
  const stored = index >= 0 ? state.entries[index] : undefined;
  const fresh = mergeConfigLayers(lowerEntry, stored);
  const desired = withKey(desiredEntry(op, fresh, state), key, identity);
  const override =
    lowerEntry === undefined
      ? desired
      : withStoredSecret(overrideFor(lowerEntry, desired, stored, state), op, desired, state, {
          hidden: hiddenSecrets.has(identity),
          identity,
        });
  const before = state.entries;
  if (override === undefined) {
    state.entries = before.filter((_, i) => i !== index);
  } else if (index >= 0) {
    state.entries = before.map((entry, i) => (i === index ? override : entry));
  } else {
    state.entries = [...before, override];
  }
  if (!isConfigValueEqual(before, state.entries)) state.effective++;
}

/**
 * An entry's override around a secret it stores encrypted (absent from the
 * redacted read, so LibreChat keeps it for an entry written without the key).
 * Untouched, the entry stays (`{ name }`) so the secret does. Given a key (a
 * new one, or the lower layer's to remove the stored one), the key is written
 * explicitly, since LibreChat would otherwise keep the old secret; an entry
 * left equal to the lower one is dropped, which removes the secret with it.
 */
function withStoredSecret(
  override: t.ConfigValue,
  op: UpsertEntryOp,
  desired: t.ConfigValue,
  state: ResolveState,
  { hidden, identity }: { hidden: boolean; identity: string },
): t.ConfigValue {
  const { collection } = state.input;
  const secretKey = collection.secret?.key;
  if (!hidden || !secretKey || !isConfigRecord(desired)) return override;
  if (!suppliesSecret(op.value, collection)) {
    if (override !== undefined || desired[secretKey] === undefined) return override;
    return { [collection.key]: identity };
  }
  if (!isConfigRecord(override) || secretKey in override) return override;
  return { ...override, [secretKey]: desired[secretKey] };
}

/**
 * The override that makes the lower entry read as `desired`. Keys `desired`
 * drops but the lower entry has come back with a merge (`yamlOnly`), unless
 * the target's own override held them: dropping those removes the override,
 * which is what was asked.
 */
function overrideFor(
  lowerEntry: t.ConfigValue,
  desired: t.ConfigValue,
  stored: t.ConfigValue,
  state: ResolveState,
): t.ConfigValue {
  const { collection } = state.input;
  const identity = getEntryKey(desired, collection.key) ?? '';
  const { value, unremovable } = diffOverride(lowerEntry, desired);
  const ignored = new Set([collection.key, collection.secret?.key]);
  const lost = unremovable.filter(
    (path) => !ignored.has(path) && getValueAtPath(stored, path) === undefined,
  );
  if (lost.length > 0) {
    state.warnings.push({
      path: collection.path,
      warning: 'yamlOnly',
      entryIdentity: identity,
      keys: lost,
    });
  }
  if (!isConfigRecord(value) || Object.keys(value).every((k) => k === collection.key)) {
    return undefined;
  }
  return { ...value, [collection.key]: identity };
}

function notFoundIssue(collection: t.KeyedCollection, identity: string): t.ConfigIssue {
  return entryIssue(
    collection,
    'ENTRY_NOT_FOUND',
    identity,
    `"${identity}" no longer exists; it was removed or renamed since you loaded the page`,
  );
}

function removeEntry(op: RemoveEntryOp, state: ResolveState, lowerEntries: t.ConfigValue[]): void {
  const { collection } = state.input;
  const { key } = collection;
  if (collection.merge === 'byKey' && indexOfKey(lowerEntries, key, op.identity) >= 0) {
    state.issues.push(immutableIssue(state.input, op.identity, false));
    return;
  }
  const index = locate(state, op.identity);
  if (index < 0) {
    state.issues.push(notFoundIssue(collection, op.identity));
    return;
  }
  state.entries = state.entries.filter((_, i) => i !== index);
  state.effective++;
}

function upsertInList(op: UpsertEntryOp, state: ResolveState): void {
  const { collection } = state.input;
  const { key } = collection;
  const taken = (name: string) => {
    moveAside(state, name, []);
    return indexOfKey(state.entries, key, name) >= 0;
  };
  if (op.identity === null) {
    if (taken(op.key)) {
      state.issues.push(
        entryIssue(collection, 'DUPLICATE_ENTRY', op.key, `"${op.key}" already exists`),
      );
      return;
    }
    const at = Math.min(Math.max(op.index ?? state.entries.length, 0), state.entries.length);
    const entry = withKey(withoutPreview(op.value, collection), key, op.key);
    state.entries = [...state.entries.slice(0, at), entry, ...state.entries.slice(at)];
    state.effective++;
    return;
  }
  const index = locate(state, op.identity);
  if (index < 0) {
    state.issues.push(notFoundIssue(collection, op.identity));
    return;
  }
  if (op.key !== op.identity && taken(op.key)) {
    state.issues.push(renameTakenIssue(collection, op.identity, op.key));
    return;
  }
  state.aside.delete(op.identity);
  const updated = withKey(desiredEntry(op, state.entries[index], state), key, op.key);
  const changed = !isConfigValueEqual(updated, state.entries[index]);
  const others = state.entries.filter((_, i) => i !== index);
  const at = op.index === undefined ? index : Math.min(Math.max(op.index, 0), others.length);
  if (!changed && at === index) return;
  state.entries = [...others.slice(0, at), updated, ...others.slice(at)];
  state.effective++;
}

/**
 * Applies one collection's entry ops by identity to the target's stored
 * override, never by array position.
 *
 * `byKey` (custom endpoints): the result starts from the stored override
 * array, never from the merged config; an edit of an entry the lower layer
 * defines stores only the keys that differ from it, and an entry left equal
 * to it is dropped from the override. Lower-layer entries cannot be removed
 * or renamed (a merge would bring them back), and a stored entry with an
 * encrypted secret cannot be renamed without a new secret, unless the server
 * moves it (`carriesSecrets`: the rename is then listed in `renames`).
 *
 * `replace` (model specs): the result is the whole list, starting from the
 * target's own list or, without one, the list it inherits; taking over an
 * inherited list is reported as an `ownershipChange` warning, and a list
 * equal to the inherited one is no override at all. An upsert with an `index`
 * also moves its entry there (applied in order, they rebuild a reordering).
 *
 * An identity missing from the current layers is a conflict (`ENTRY_NOT_FOUND`).
 */
export function resolveCollectionOps(input: t.CollectionOpsInput): t.CollectionResolution {
  const { collection } = input;
  const own = toEntries(input.stored);
  const lowerEntries = toEntries(input.lower) ?? [];
  const byKey = collection.merge === 'byKey';
  const hiddenSecrets = new Set(
    (own ?? [])
      .filter((entry) => hasHiddenSecret(entry, collection))
      .map((entry) => getEntryKey(entry, collection.key) ?? ''),
  );
  const start = byKey ? (own ?? []) : (own ?? lowerEntries);
  const state: ResolveState = {
    input,
    entries: start.map((entry) => withoutPreview(entry, collection)),
    issues: [],
    warnings: [],
    effective: 0,
    pendingRenames: new Set(
      input.ops.flatMap((op) =>
        op.op === 'upsertEntry' && op.identity !== null && op.key !== op.identity
          ? [op.identity]
          : [],
      ),
    ),
    aside: new Map(),
    renames: [],
  };
  for (const op of input.ops) {
    if (op.op === 'upsertEntry' && op.identity !== null) state.pendingRenames.delete(op.identity);
    if (op.op === 'removeEntry') removeEntry(op, state, lowerEntries);
    else if (byKey) upsertByKey(op, state, lowerEntries, hiddenSecrets);
    else upsertInList(op, state);
  }
  restoreAside(state);
  const next = resolveNext(state.entries, own, lowerEntries, byKey);
  if (!byKey && own === undefined && next !== undefined) {
    state.warnings.push({ path: collection.path, warning: 'ownershipChange' });
  }
  const ownStripped = own?.map((entry) => withoutPreview(entry, collection));
  return {
    next,
    changed: !isConfigValueEqual(next, ownStripped),
    issues: state.issues,
    warnings: state.warnings,
    effective: state.effective,
    renames: state.renames,
  };
}

function resolveNext(
  entries: t.ConfigValue[],
  own: t.ConfigValue[] | undefined,
  lowerEntries: t.ConfigValue[],
  byKey: boolean,
): t.ConfigValue[] | undefined {
  if (byKey) return entries.length > 0 ? entries : undefined;
  if (isConfigValueEqual(entries, lowerEntries)) return undefined;
  if (own === undefined && entries.length === 0 && lowerEntries.length === 0) return undefined;
  return entries;
}
