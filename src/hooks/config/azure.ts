import { useContext, useMemo } from 'react';
import type * as t from '@/types';
import {
  getEntryKey,
  entriesByKey,
  modelsByGroup,
  isConfigRecord,
  getValueAtPath,
  parseKeyedPath,
  isConfigValueEqual,
  getKeyedCollection,
  overriddenEntryKeys,
  validateResolvableGroup,
} from '@/utils';
import { toAzureGroups } from '@/components/configuration/sections/providers/azure';
import { CollectionEditsContext } from '@/contexts/CollectionEditsContext';
import { ConfigValuesContext } from '@/contexts/ConfigValuesContext';
import { AZURE_GROUPS_PATH, appliesGroupHides } from '@/constants';
import { useConfigFeatures } from './contract';
import { useListKeys } from './keys';

const GROUP_KEY = 'group';

function groupOf(item: t.ConfigValue): string | null {
  return getEntryKey(item, GROUP_KEY) ?? null;
}

function asRecord(value: t.ConfigValue | undefined): t.ConfigRecord | undefined {
  return isConfigRecord(value) ? value : undefined;
}

/**
 * The Azure groups of the open target as the groups editor lists them: per
 * group where it comes from (librechat.yaml, the admin panel, Base or the
 * profile), whether the target overrides it, whether it is new or edited,
 * and why a saved group the target stores doesn't resolve; plus the saved
 * groups a pending edit removes. Renames and removals are read from the
 * page's pending collection edits, as the custom endpoints editor reads them.
 */
export function useAzureGroupRows(items: t.ConfigValue[]): t.AzureGroupRows {
  const layers = useContext(ConfigValuesContext)?.layers ?? null;
  const edit = useContext(CollectionEditsContext)[AZURE_GROUPS_PATH];
  const keys = useListKeys({ items, identity: groupOf, prefix: 'azure-group' });

  const context = useMemo(() => {
    const collection = getKeyedCollection(AZURE_GROUPS_PATH);
    const lowerRoot = layers?.scope ? layers.base : (layers?.yamlEffective ?? null);
    const storedRoot = layers?.scope ? layers.scope.overrides : (layers?.baseOverrides ?? null);
    const lowerList = getValueAtPath(lowerRoot, AZURE_GROUPS_PATH);
    const storedList = getValueAtPath(storedRoot, AZURE_GROUPS_PATH);
    const savedList = getValueAtPath(layers?.effective ?? null, AZURE_GROUPS_PATH);
    return {
      lower: entriesByKey(lowerList, GROUP_KEY),
      saved: entriesByKey(savedList, GROUP_KEY),
      stored: new Set(entriesByKey(storedList, GROUP_KEY).keys()),
      servedBy: modelsByGroup(savedList),
      overridden: collection
        ? overriddenEntryKeys(collection, storedList, lowerList)
        : new Set<string>(),
      isScope: layers?.scope != null,
    };
  }, [layers]);

  return useMemo((): t.AzureGroupRows => {
    const { lower, saved, stored, servedBy, overridden, isScope } = context;
    const shown = new Map(toAzureGroups(items).map((row) => [row.index, row]));
    const rows = items.flatMap((item, index): t.AzureGroupEntry[] => {
      const row = shown.get(index);
      if (!row || !isConfigRecord(item)) return [];
      const origin = edit ? edit.origins[index] : undefined;
      const isNew = edit != null && origin === null;
      const loadedName = isNew ? undefined : (origin?.identity ?? row.group);
      const fromLower = loadedName !== undefined && lower.has(loadedName);
      const savedEntry = loadedName === undefined ? undefined : saved.get(loadedName);
      let entryOrigin: t.EndpointOrigin = isScope ? 'scope' : 'admin';
      if (fromLower) entryOrigin = isScope ? 'inherited' : 'yaml';
      const edited = !isNew && savedEntry !== undefined && !isConfigValueEqual(savedEntry, item);
      /** LibreChat checks the groups the target stores, as saved; pending edits the save checks. */
      const checked = !edited && loadedName !== undefined && stored.has(loadedName);
      return [
        {
          key: keys[index],
          row,
          value: item,
          loadedName,
          origin: entryOrigin,
          overridden: fromLower && loadedName !== undefined && overridden.has(loadedName),
          isNew,
          edited,
          saved: asRecord(savedEntry),
          lower: loadedName === undefined ? undefined : asRecord(lower.get(loadedName)),
          unresolved: checked
            ? validateResolvableGroup(savedEntry, index, loadedName, servedBy)
            : [],
        },
      ];
    });
    const baselineIndex = new Map(
      (edit?.baseline ?? []).map((entry, index) => [getEntryKey(entry, GROUP_KEY), index]),
    );
    const pendingOrigins = items.map((_, index) => {
      const identity = edit?.origins[index]?.identity;
      return identity === undefined ? Infinity : (baselineIndex.get(identity) ?? Infinity);
    });
    const removals = (edit?.detached ?? []).map((detached): t.AzureGroupRemoval => {
      const index = baselineIndex.get(detached.origin.identity) ?? items.length;
      const before = pendingOrigins.findIndex((at) => at > index);
      return {
        key: `removed-${detached.origin.identity}`,
        name: detached.origin.identity,
        value: detached.value,
        restoreIndex: before === -1 ? items.length : before,
      };
    });
    return { rows, removals };
  }, [context, items, edit, keys]);
}

/**
 * The hides of Azure groups by name the open target stores
 * (`endpoints.azureOpenAI.groups["east"]`, or a path inside one), which
 * another client wrote (`appliesGroupHides`): LibreChat applies them, while
 * the groups editor neither applies nor writes them.
 */
export function useStoredGroupHides(): t.KeyedPath[] {
  const applies = appliesGroupHides(useConfigFeatures());
  const layers = useContext(ConfigValuesContext)?.layers ?? null;
  return useMemo(() => {
    if (!applies || !layers) return [];
    const tombstones = layers.scope ? layers.scope.tombstones : layers.baseTombstones;
    return [...tombstones].flatMap((path) => {
      const keyed = parseKeyedPath(path, true);
      return keyed?.collection.path === AZURE_GROUPS_PATH ? [keyed] : [];
    });
  }, [applies, layers]);
}
