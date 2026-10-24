import { useContext, useMemo } from 'react';
import type * as t from '@/types';
import {
  getEntryKey,
  isConfigRecord,
  parseKeyedPath,
  getValueAtPath,
  hiddenEntriesOf,
  entryIdentityOf,
  hasHiddenSecret,
  isConfigValueEqual,
  getKeyedCollection,
  getSecretCarry,
  overriddenEntryKeys,
  formatKeyedPath,
  asConfigRecord,
  isAddressableEntryKey,
  isAddressableEntryPath,
} from '@/utils';
import {
  endpointHost,
  fetchesModels,
  modelNames,
  validateEndpoint,
} from '@/components/configuration/sections/endpoints/model';
import { EntryKeyRemovalContext } from '@/contexts/EntryKeyRemovalContext';
import { CollectionEditsContext } from '@/contexts/CollectionEditsContext';
import { getEntryTitle } from '@/components/configuration/fields/entries';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { useConfigContract, useConfigFeatures } from './contract';
import { INHERITED_KEY_RECORDS } from '@/constants';
import { useLocalize } from '../useLocalize';
import { useListKeys } from './keys';

const NAME_KEY = 'name';

function nameOf(item: t.ConfigValue): string | null {
  return getEntryKey(item, NAME_KEY) ?? null;
}

function byName(list: t.ConfigValue): Map<string, t.ConfigRecord> {
  const map = new Map<string, t.ConfigRecord>();
  if (!Array.isArray(list)) return map;
  for (const entry of list) {
    const name = getEntryKey(entry, NAME_KEY);
    if (name !== undefined && isConfigRecord(entry)) map.set(name, entry);
  }
  return map;
}

/**
 * The custom endpoint list of the open target as the endpoint editor shows
 * it (WS10): per row where the endpoint comes from (librechat.yaml, the admin
 * panel, Base or the profile), whether the target overrides it, whether it is
 * new or edited, and what keeps it from being saved or served; plus the
 * saved endpoints a pending edit removes. Renames and removals are read from
 * the page's pending collection edits, so they survive Discard → Undo.
 */
export function useEndpointRows({ path, items }: t.EndpointRowsOptions): t.EndpointRows {
  const localize = useLocalize();
  const features = useConfigFeatures();
  const { endpointRename } = getSecretCarry(features);
  const { keyedTombstones } = features;
  const { limits } = useConfigContract();
  const maxKeyLength = keyedTombstones ? limits.maxEntryKeyLength : undefined;
  const layers = useContext(ConfigValuesContext)?.layers ?? null;
  const edit = useContext(CollectionEditsContext)[path];
  const keys = useListKeys({ items, identity: nameOf, prefix: 'endpoint' });

  const context = useMemo(() => {
    const collection = getKeyedCollection(path);
    const lowerRoot = layers?.scope ? layers.base : (layers?.yamlEffective ?? null);
    const storedRoot = layers?.scope ? layers.scope.overrides : (layers?.baseOverrides ?? null);
    const lowerList = getValueAtPath(lowerRoot, path);
    const storedList = getValueAtPath(storedRoot, path);
    const tombstones = layers?.scope ? layers.scope.tombstones : layers?.baseTombstones;
    const trimmed = new Set<string>();
    for (const tombstone of keyedTombstones && collection ? (tombstones ?? []) : []) {
      const keyed = parseKeyedPath(tombstone);
      if (keyed?.rest && keyed.collection.path === path) trimmed.add(keyed.key);
    }
    const overridden = collection
      ? overriddenEntryKeys(collection, storedList, lowerList)
      : new Set<string>();
    return {
      collection,
      lower: byName(lowerList),
      stored: byName(storedList),
      saved: byName(getValueAtPath(layers?.effective ?? null, path)),
      /** An entry is overridden by what the target stores for it, or removes from it by key. */
      overridden: new Set([...overridden, ...trimmed]),
      isScope: layers?.scope != null,
    };
  }, [layers, path, keyedTombstones]);

  return useMemo((): t.EndpointRows => {
    const { collection, lower, stored, saved, overridden, isScope } = context;
    const names = items.map((item) => getEntryKey(item, NAME_KEY) ?? '');
    const rows = items.map((item, index): t.EndpointRow => {
      const value = isConfigRecord(item) ? item : {};
      const identity = getEntryKey(item, NAME_KEY);
      const origin = edit ? edit.origins[index] : undefined;
      const isNew = edit != null && origin === null;
      const loadedName = isNew ? undefined : (origin?.identity ?? identity);
      const fromLower = loadedName !== undefined && lower.has(loadedName);
      const storedEntry = loadedName === undefined ? undefined : stored.get(loadedName);
      const storedSecret = collection
        ? hasHiddenSecret(storedEntry, collection) || hasHiddenSecret(value, collection)
        : false;
      const savedEntry = loadedName === undefined ? undefined : saved.get(loadedName);
      let entryOrigin: t.EndpointOrigin = isScope ? 'scope' : 'admin';
      if (fromLower) entryOrigin = isScope ? 'inherited' : 'yaml';
      return {
        key: keys[index],
        index,
        value,
        title: getEntryTitle(item, index, localize),
        identity,
        loadedName,
        origin: entryOrigin,
        overridden: fromLower && loadedName !== undefined && overridden.has(loadedName),
        isNew,
        edited: !isNew && savedEntry !== undefined && !isConfigValueEqual(savedEntry, item),
        saved: savedEntry,
        own: storedEntry,
        host: endpointHost(value.baseURL),
        modelCount: modelNames(value).length,
        fetchesModels: fetchesModels(value),
        storedSecret,
        issues: validateEndpoint({
          entry: value,
          otherNames: names.filter((_, i) => i !== index),
          fromLowerLayer: fromLower,
          storedSecret,
          loadedName,
          carriesKey: endpointRename,
          maxKeyLength,
        }),
      };
    });
    const baselineIndex = new Map(
      (edit?.baseline ?? []).map((entry, index) => [getEntryKey(entry, NAME_KEY), index]),
    );
    const pendingOrigins = items.map((_, index) => {
      const identity = edit?.origins[index]?.identity;
      return identity === undefined ? Infinity : (baselineIndex.get(identity) ?? Infinity);
    });
    const removals = (edit?.detached ?? []).map((detached): t.EndpointRemoval => {
      const at = baselineIndex.get(detached.origin.identity);
      const index = at ?? items.length;
      const before = pendingOrigins.findIndex((origin) => origin > index);
      return {
        key: `removed-${detached.origin.identity}`,
        title: getEntryTitle(detached.value, at ?? 0, localize),
        value: detached.value,
        index,
        restoreIndex: before === -1 ? items.length : before,
      };
    });
    return {
      rows,
      removals,
      lowerEntry: (name) => lower.get(name),
    };
  }, [context, items, edit, keys, endpointRename, maxKeyLength, localize]);
}

const NO_VISIBILITY: Readonly<Record<string, t.VisibilityEdit>> = {};

/**
 * The entries of a keyed collection (`endpoints.custom`) the open profile
 * hides whole by key (`keyedTombstones`), by identity: saved hides, unless a
 * pending unhide shows them again (`unhiding`), and pending hides. None in
 * Base or before the server applies keyed tombstones.
 */
export function useHiddenEntries(path: string): t.HiddenEntries {
  const { keyedTombstones } = useConfigFeatures();
  const data = useContext(ConfigValuesContext);
  const layers = data?.layers ?? null;
  const visibility = data?.visibilityEdits ?? NO_VISIBILITY;
  return useMemo((): t.HiddenEntries => {
    const hidden = new Map<string, t.HiddenEntry>();
    const unhiding = new Map<string, t.HiddenEntry>();
    const collection = getKeyedCollection(path);
    const scope = layers?.scope;
    if (!keyedTombstones || !scope || collection?.merge !== 'byKey') return { hidden, unhiding };
    const lowerNames = new Map<string, string>();
    const lower = getValueAtPath(layers?.base ?? null, path);
    for (const entry of Array.isArray(lower) ? lower : []) {
      const name = getEntryKey(entry, collection.key);
      if (name !== undefined) lowerNames.set(entryIdentityOf(collection, name), name);
    }
    for (const [identity, tombstone] of hiddenEntriesOf(scope.tombstones, collection)) {
      const key = parseKeyedPath(tombstone)?.key ?? identity;
      const entry = { name: lowerNames.get(identity) ?? key, path: tombstone, pending: false };
      if (visibility[tombstone] === 'unhide') unhiding.set(identity, entry);
      else hidden.set(identity, entry);
    }
    for (const [editPath, edit] of Object.entries(visibility)) {
      const keyed = edit === 'hide' ? parseKeyedPath(editPath) : null;
      if (!keyed || keyed.rest || keyed.collection.path !== path) continue;
      const identity = entryIdentityOf(collection, keyed.key);
      hidden.set(identity, {
        name: lowerNames.get(identity) ?? keyed.key,
        path: editPath,
        pending: true,
      });
    }
    return { hidden, unhiding };
  }, [keyedTombstones, layers, path, visibility]);
}

/** Keyed tombstones and pending hides inside one entry's record, by key: the tombstone's path and whether it is pending. */
function recordRemovals(
  tombstones: Iterable<string>,
  visibility: Readonly<Record<string, t.VisibilityEdit>>,
  collection: t.KeyedCollection,
  identity: string,
  record: string,
): Map<string, t.RecordRemovalRef> {
  const found = new Map<string, t.RecordRemovalRef>();
  const read = (path: string, pending: boolean) => {
    const keyed = parseKeyedPath(path);
    if (!keyed || keyed.collection.path !== collection.path) return;
    if (entryIdentityOf(collection, keyed.key) !== identity) return;
    if (!keyed.rest.startsWith(`${record}.`)) return;
    const key = keyed.rest.slice(record.length + 1);
    if (key !== '' && !key.includes('.')) found.set(key, { path, pending });
  };
  for (const path of tombstones) read(path, false);
  for (const [path, edit] of Object.entries(visibility)) if (edit === 'hide') read(path, true);
  return found;
}

/** A removed key's state: removed by a pending hide, or saved, and then maybe shown again by a pending unhide. */
function removalState(
  pending: boolean,
  edit: t.VisibilityEdit | undefined,
): t.RemovedRecordKey['state'] {
  if (pending) return 'pending';
  return edit === 'unhide' ? 'restoring' : 'saved';
}

/**
 * "Remove inherited key" for the records of one custom endpoint the layer
 * beneath defines (`keyedTombstones`, `INHERITED_KEY_RECORDS`): each key it
 * removes by key (`endpoints.custom["Name"].headers.X-Team`), saved or
 * pending, and the toggle that removes a key or takes a removal back. Null
 * before the flag, for an entry the target adds, and for a name LibreChat
 * can't name by key.
 */
export function useEntryKeyRemoval({
  collectionPath,
  entryPath,
  name,
  lowerEntry,
  onHide,
  onUnhide,
}: t.EntryKeyRemovalOptions): t.EntryKeyRemoval | null {
  const { keyedTombstones } = useConfigFeatures();
  const { limits } = useConfigContract();
  const data = useContext(ConfigValuesContext);
  const layers = data?.layers ?? null;
  const visibility = data?.visibilityEdits ?? NO_VISIBILITY;
  return useMemo((): t.EntryKeyRemoval | null => {
    const collection = getKeyedCollection(collectionPath);
    if (!keyedTombstones || !collection || name === undefined || !lowerEntry) return null;
    if (!isAddressableEntryKey(name, limits.maxEntryKeyLength)) return null;
    const tombstones = layers?.scope ? layers.scope.tombstones : (layers?.baseTombstones ?? []);
    const identity = entryIdentityOf(collection, name);
    const forRecord = (record: string): t.RecordKeyRemoval => {
      const inherited = asConfigRecord(lowerEntry[record]);
      const removals = recordRemovals(tombstones, visibility, collection, identity, record);
      const removed = new Map<string, t.RemovedRecordKey>();
      for (const [key, { path, pending }] of removals) {
        removed.set(key, { state: removalState(pending, visibility[path]), value: inherited[key] });
      }
      const pathOf = (key: string) =>
        removals.get(key)?.path ?? formatKeyedPath(collectionPath, name, `${record}.${key}`);
      return {
        removed,
        canRemove: (key) => Object.hasOwn(inherited, key) && isAddressableEntryPath([record, key]),
        onToggle:
          onHide && onUnhide
            ? (key) => {
                const state = removed.get(key)?.state;
                if (state === undefined || state === 'restoring') onHide(pathOf(key));
                else onUnhide(pathOf(key));
              }
            : undefined,
      };
    };
    return { entryPath, records: INHERITED_KEY_RECORDS, forRecord };
  }, [
    keyedTombstones,
    collectionPath,
    name,
    lowerEntry,
    limits.maxEntryKeyLength,
    layers,
    visibility,
    entryPath,
    onHide,
    onUnhide,
  ]);
}

/** The open entry's record key removals (`useEntryKeyRemoval`), for a record field at `dataPath`. */
export function useRecordKeyRemoval(dataPath: string): t.RecordKeyRemoval | undefined {
  const entry = useContext(EntryKeyRemovalContext);
  return useMemo(() => {
    if (!entry || !dataPath.startsWith(`${entry.entryPath}.`)) return undefined;
    const record = dataPath.slice(entry.entryPath.length + 1);
    return entry.records.has(record) ? entry.forRecord(record) : undefined;
  }, [entry, dataPath]);
}
