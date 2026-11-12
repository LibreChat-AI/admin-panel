import type * as t from '@/types';
import {
  getEntryKey,
  isSecretPath,
  isConfigRecord,
  isRelatedPath,
  isConfigValueEqual,
  getKeyedCollection,
} from '@/utils';

function warningsFor(plan: t.WritePlan, path: string, identity?: string): t.ChangeWarning[] {
  const warnings = plan.warnings
    .filter(
      (w) =>
        isRelatedPath(w.path, path) &&
        (w.entryIdentity === undefined || w.entryIdentity === identity),
    )
    .map((w) => w.warning);
  return [...new Set(warnings)];
}

function withWarnings(item: t.ChangeSummaryItem, warnings: t.ChangeWarning[]): t.ChangeSummaryItem {
  return warnings.length > 0 ? { ...item, warnings } : item;
}

function driftOf(path: string, layers: t.SummaryLayers): t.ChangeSummaryItem['drift'] | undefined {
  if (!(path in layers.editBaselines)) return undefined;
  const current = layers.baselineAt(path);
  return isConfigValueEqual(layers.editBaselines[path], current) ? undefined : { current };
}

/**
 * Whether the plan sends a reset of `path` (itself or a widened ancestor,
 * SV-7), removes it with a rename that moves the entry to its new name, or
 * replaces it with one set of the same path (a removal folded into writes
 * under it: an entry deleted, then written again under its name).
 */
export function isResetSent(plan: t.WritePlan, path: string): boolean {
  return (
    plan.resets.some((reset) => path === reset || path.startsWith(`${reset}.`)) ||
    plan.renames.some((rename) => path === `${rename.path}.${rename.from}`) ||
    plan.sets.some(({ fieldPath }) => fieldPath === path)
  );
}

function plainItems(
  changeSet: t.ConfigChangeSet,
  plan: t.WritePlan,
  layers: t.SummaryLayers,
): t.ChangeSummaryItem[] {
  const saves = changeSet.payload.saves.map(({ fieldPath, value }) => {
    const before = layers.baselineAt(fieldPath);
    const item: t.ChangeSummaryItem = {
      path: fieldPath,
      kind: before === undefined ? 'added' : 'changed',
      before,
      after: value,
      secret: isSecretPath(fieldPath),
      drift: driftOf(fieldPath, layers),
    };
    return withWarnings(item, warningsFor(plan, fieldPath));
  });
  const resets = changeSet.payload.resets
    .filter((path) => isResetSent(plan, path))
    .map((path): t.ChangeSummaryItem => {
      const revertTarget = layers.revertAt(path);
      return {
        path,
        kind: 'reverted',
        before: layers.ownAt(path),
        after: revertTarget.value,
        revertTarget,
        secret: isSecretPath(path),
        drift: driftOf(path, layers),
      };
    });
  return [...saves, ...resets];
}

function fieldChangeKind(before: t.ConfigValue, after: t.ConfigValue): t.ChangeKind {
  if (after === undefined) return 'removed';
  return before === undefined ? 'added' : 'changed';
}

/** A stored secret the read redacted shows only as its preview companion: treat it as set. */
function hiddenSecretBefore(
  collection: t.KeyedCollection,
  key: string,
  loaded: t.ConfigValue,
): t.ConfigValue {
  const secret = collection.secret;
  if (!secret || key !== secret.key || !isConfigRecord(loaded)) return undefined;
  const preview = loaded[secret.preview];
  return typeof preview === 'string' && preview !== '' ? preview : undefined;
}

function entryFieldItems(
  collection: t.KeyedCollection,
  index: number,
  identity: string,
  op: { baseline?: t.ConfigValue; value: t.ConfigValue },
  loaded: t.ConfigValue,
): t.ChangeSummaryItem[] {
  const beforeRecord = isConfigRecord(op.baseline) ? op.baseline : {};
  const afterRecord = isConfigRecord(op.value) ? op.value : {};
  const keys = new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)]);
  keys.delete(collection.key);
  return [...keys]
    .filter((key) => !isConfigValueEqual(beforeRecord[key], afterRecord[key]))
    .map((key) => {
      const before = beforeRecord[key] ?? hiddenSecretBefore(collection, key, loaded);
      const path = `${collection.path}.${index}.${key}`;
      return {
        path,
        entryIdentity: identity,
        kind: fieldChangeKind(before, afterRecord[key]),
        before,
        after: afterRecord[key],
        secret: isSecretPath(path),
      };
    });
}

function collectionItems(
  pending: t.PendingCollection,
  changeSet: t.ConfigChangeSet,
  plan: t.WritePlan,
  layers: t.SummaryLayers,
): t.ChangeSummaryItem[] {
  const { collection, items, edit } = pending;
  const indexOf = (key: string) =>
    items.findIndex((item) => getEntryKey(item, collection.key) === key);
  const current = layers.baselineAt(collection.path);
  const currentList = Array.isArray(current) ? current : [];
  const rows = changeSet.ops
    .filter((op) => op.path === collection.path)
    .flatMap((op): t.ChangeSummaryItem[] => {
      if (op.op === 'removeEntry') {
        const loaded = edit.baseline.find((e) => getEntryKey(e, collection.key) === op.identity);
        return [
          {
            path: collection.path,
            entryIdentity: op.identity,
            kind: 'removed',
            before: loaded,
            after: undefined,
          },
        ];
      }
      if (op.op !== 'upsertEntry') return [];
      const index = indexOf(op.key);
      if (op.identity === null) {
        return [
          {
            path: `${collection.path}.${index}`,
            entryIdentity: op.key,
            kind: 'added',
            before: undefined,
            after: op.value,
          },
        ];
      }
      const renamed: t.ChangeSummaryItem[] =
        op.key === op.identity
          ? []
          : [
              {
                path: `${collection.path}.${index}.${collection.key}`,
                entryIdentity: op.identity,
                kind: 'renamed',
                before: op.identity,
                after: op.key,
              },
            ];
      const loaded = edit.origins.find((origin) => origin?.identity === op.identity)?.baseline;
      const live = currentList.find((e) => getEntryKey(e, collection.key) === op.identity);
      const drift =
        live !== undefined && loaded !== undefined && !isConfigValueEqual(live, loaded)
          ? { current: live }
          : undefined;
      const fields = entryFieldItems(collection, index, op.identity, op, loaded).map((item) =>
        drift ? { ...item, drift } : item,
      );
      return [...renamed, ...fields];
    })
    .map((item) => withWarnings(item, warningsFor(plan, collection.path, item.entryIdentity)));
  return items.length === 0 ? withEmptyListWarning(collection.path, rows) : rows;
}

/** An emptied spec list: users get the endpoint menu whatever the selection mode says. */
const EMPTY_LIST_WARNINGS: Readonly<Record<string, t.ChangeWarning>> = {
  'modelSpecs.list': 'emptySpecs',
};

/** The list's own warning on its last row, once the save leaves it with no entries. */
function withEmptyListWarning(path: string, rows: t.ChangeSummaryItem[]): t.ChangeSummaryItem[] {
  const warning = EMPTY_LIST_WARNINGS[path];
  if (!warning || rows.length === 0) return rows;
  const last = rows[rows.length - 1];
  const warnings = [...new Set([...(last.warnings ?? []), warning])];
  return [...rows.slice(0, -1), { ...last, warnings }];
}

/**
 * The review's rows (WS7 renders them): one per changed setting, and for
 * keyed collections one per added, removed or renamed entry and per changed
 * entry field, by entry identity. Resets that send nothing (no override to
 * remove) produce no row. Each row carries its plan warnings (ownership
 * change, librechat.yaml keys a merge brings back) and, when the saved value
 * changed since the edit, the value now saved (`drift`).
 */
export function summarizeChanges(
  changeSet: t.ConfigChangeSet,
  plan: t.WritePlan,
  layers: t.SummaryLayers,
): t.ChangeSummaryItem[] {
  const collectionResets = changeSet.ops
    .filter((op) => op.op === 'reset' && getKeyedCollection(op.path) && isResetSent(plan, op.path))
    .map((op): t.ChangeSummaryItem => {
      const revertTarget = layers.revertAt(op.path);
      return {
        path: op.path,
        kind: 'reverted',
        before: layers.ownAt(op.path),
        after: revertTarget.value,
        revertTarget,
      };
    });
  const visibility = changeSet.ops
    .filter((op) => op.op === 'tombstone' || op.op === 'untombstone')
    .map((op): t.ChangeSummaryItem => ({
      path: op.path,
      kind: op.op === 'tombstone' ? 'hidden' : 'reverted',
      before: layers.baselineAt(op.path),
      after: undefined,
    }));
  return [
    ...plainItems(changeSet, plan, layers),
    ...changeSet.collections.flatMap((pending) =>
      collectionItems(pending, changeSet, plan, layers),
    ),
    ...collectionResets,
    ...visibility,
  ];
}
