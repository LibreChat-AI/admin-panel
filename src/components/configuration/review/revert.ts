import type * as t from '@/types';
import {
  flattenObject,
  getValueAtPath,
  isConfigRecord,
  isSecretPreviewPath,
  deepSerializeKVPairs,
} from '@/utils';
import { isConfigValueEqual, normalizeForSave } from '../edits';
import { identityKeyFor } from './diff';

const INDEX_SEGMENT_RE = /^\d+$/;

function childOf(value: t.ConfigValue, segment: string): t.ConfigValue {
  if (Array.isArray(value))
    return INDEX_SEGMENT_RE.test(segment) ? value[Number(segment)] : undefined;
  return isConfigRecord(value) ? value[segment] : undefined;
}

function relativeSegments(path: string, base: string): string[] {
  return path === base ? [] : path.slice(base.length + 1).split('.');
}

/**
 * The segments of a row's path below `base` (a prefix of it). A dotted record
 * key (`us.anthropic.claude-sonnet-4-6`) stays one segment: the row carries
 * its path's `segments`, since splitting the path would break the key apart.
 */
function segmentsBelow(item: t.ChangeSummaryItem, base: string): string[] {
  if (!item.segments) return relativeSegments(item.path, base);
  let prefix = '';
  for (let i = 0; i < item.segments.length; i++) {
    prefix = i === 0 ? item.segments[i] : `${prefix}.${item.segments[i]}`;
    if (prefix === base) return item.segments.slice(i + 1);
  }
  return relativeSegments(item.path, base);
}

/**
 * `pending` with the value at `segments` put back to the one in `baseline`
 * (removed when the baseline has none). Where the pending value is shaped
 * differently from the baseline (a key/value pair list standing for a
 * record), that container is restored as a whole.
 */
export function revertAt(
  pending: t.ConfigValue,
  baseline: t.ConfigValue,
  segments: string[],
): t.ConfigValue {
  if (segments.length === 0) return baseline;
  const [head, ...rest] = segments;
  if (Array.isArray(pending) && INDEX_SEGMENT_RE.test(head)) {
    const next = [...pending];
    next[Number(head)] = revertAt(pending[Number(head)], childOf(baseline, head), rest);
    return next;
  }
  if (isConfigRecord(pending)) {
    const child = revertAt(pending[head], childOf(baseline, head), rest);
    const { [head]: _previous, ...others } = pending;
    return child === undefined ? others : { ...others, [head]: child };
  }
  return baseline;
}

function findByIdentity(
  list: t.ConfigValue[],
  key: string | undefined,
  identity: string | undefined,
): { index: number; value: t.ConfigValue } | undefined {
  if (!key || identity == null) return undefined;
  const index = list.findIndex((entry) => isConfigRecord(entry) && entry[key] === identity);
  return index === -1 ? undefined : { index, value: list[index] };
}

function indexOfEntry(entryPath: string): number {
  return Number(entryPath.slice(entryPath.lastIndexOf('.') + 1));
}

/** A list with one entry change undone: an added entry dropped, a removed one restored, a rename or field put back. */
function revertListEntry(
  pending: t.ConfigValue[],
  baseline: t.ConfigValue[],
  item: t.ChangeSummaryItem,
): t.ConfigValue[] {
  const key = identityKeyFor(item.collectionPath ?? '', [...pending, ...baseline]);
  const entryPath = item.entryPath ?? item.path;
  const position = indexOfEntry(entryPath);

  if (item.path === item.collectionPath) {
    if (!key) return baseline;
    const rank = new Map(baseline.map((entry, i) => [isConfigRecord(entry) ? entry[key] : i, i]));
    const ranked = (entry: t.ConfigValue) =>
      rank.get(isConfigRecord(entry) ? entry[key] : undefined) ?? Number.MAX_SAFE_INTEGER;
    return [...pending].sort((a, b) => ranked(a) - ranked(b));
  }

  if (item.kind === 'added' && item.path === entryPath) {
    const match = findByIdentity(pending, key, item.entryIdentity);
    const index = match?.index ?? position;
    return pending.filter((_, i) => i !== index);
  }

  if (item.kind === 'removed' && item.path === entryPath) {
    const restored = findByIdentity(baseline, key, item.entryIdentity)?.value ?? item.before;
    const next = [...pending];
    next.splice(Math.min(position, next.length), 0, restored);
    return next;
  }

  const current = findByIdentity(pending, key, item.entryIdentity);
  const index = current?.index ?? position;
  const previous =
    findByIdentity(baseline, key, item.previousIdentity ?? item.entryIdentity)?.value ??
    baseline[position];
  const next = [...pending];
  if (item.kind === 'renamed' && item.path === entryPath && key) {
    next[index] = revertAt(pending[index], previous, [key]);
    return next;
  }
  next[index] = revertAt(pending[index], previous, segmentsBelow(item, entryPath));
  return next;
}

/**
 * The pending value of `sourcePath` with one change of it undone. Lists of
 * entries are matched by identity; everything else, record collections
 * included (their keys are the identities), is reverted by path.
 */
function revertWithin(
  pending: t.ConfigValue,
  baseline: t.ConfigValue,
  sourcePath: string,
  item: t.ChangeSummaryItem,
): t.ConfigValue {
  const { collectionPath } = item;
  const byPath = () => revertAt(pending, baseline, segmentsBelow(item, sourcePath));
  if (
    collectionPath == null ||
    (collectionPath !== sourcePath && !collectionPath.startsWith(`${sourcePath}.`))
  ) {
    return byPath();
  }
  const toCollection = relativeSegments(collectionPath, sourcePath);
  const at = (value: t.ConfigValue) =>
    toCollection.length > 0 ? getValueAtPath(value, toCollection.join('.')) : value;
  const pendingList = at(pending);
  if (!Array.isArray(pendingList)) return byPath();
  const baselineList = at(baseline);
  const reverted = revertListEntry(
    pendingList,
    Array.isArray(baselineList) ? baselineList : [],
    item,
  );
  return setAt(pending, toCollection, reverted);
}

function setAt(value: t.ConfigValue, segments: string[], next: t.ConfigValue): t.ConfigValue {
  if (segments.length === 0) return next;
  const [head, ...rest] = segments;
  if (Array.isArray(value) && INDEX_SEGMENT_RE.test(head)) {
    const copy = [...value];
    copy[Number(head)] = setAt(value[Number(head)], rest, next);
    return copy;
  }
  const record = isConfigRecord(value) ? value : {};
  return { ...record, [head]: setAt(record[head], rest, next) };
}

/** An entry edited as a whole, with only its rename put back. */
function revertRename(
  pending: t.ConfigValue,
  baseline: t.ConfigValue,
  item: t.ChangeSummaryItem,
): t.ConfigValue {
  const key = identityKeyFor(item.collectionPath ?? '', [pending, baseline]);
  return key ? revertAt(pending, baseline, [key]) : baseline;
}

function pendingUnder(editedValues: t.FlatConfigMap, path: string): string[] {
  return Object.keys(editedValues).filter((key) => key === path || key.startsWith(`${path}.`));
}

/** Whether a removed value is only what a rename never carries: stored secrets' previews. */
function isPreviewOnly(value: t.ConfigValue, path: string): boolean {
  if (!isConfigRecord(value)) return isSecretPreviewPath(path);
  return Object.keys(flattenObject(value, path)).every(isSecretPreviewPath);
}

/**
 * The writes that give an entry under its old key the changes it got under
 * its new one: a setting it dropped is removed whole (an authentication
 * method switched off goes with its stored secret), and within an object it
 * kept, each leaf that changed is written (or removed). Stored secrets'
 * previews are no change: a rename never carries them.
 */
function renamedChanges(
  before: t.ConfigRecord,
  after: t.ConfigRecord,
  previousPath: string,
): Array<{ path: string; value: t.ConfigValue }> {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap((key) => {
    const was = before[key];
    const now = after[key];
    if (isConfigValueEqual(was, now)) return [];
    if (now === undefined)
      return isPreviewOnly(was, key) ? [] : [{ path: `${previousPath}.${key}`, value: undefined }];
    if (!isConfigRecord(was) || !isConfigRecord(now))
      return [{ path: `${previousPath}.${key}`, value: now }];
    const wasLeaves = flattenObject(was, key);
    const nowLeaves = flattenObject(now, key);
    return [...new Set([...Object.keys(wasLeaves), ...Object.keys(nowLeaves)])]
      .filter((leaf) => !isConfigValueEqual(wasLeaves[leaf], nowLeaves[leaf]))
      .filter((leaf) => nowLeaves[leaf] !== undefined || !isSecretPreviewPath(leaf))
      .map((leaf) => ({ path: `${previousPath}.${leaf}`, value: nowLeaves[leaf] }));
  });
}

/**
 * Undoes a record entry's rename (an MCP server is its new key's writes plus
 * the old key's removal) and keeps the entry's other changes, which the
 * review lists as rows of their own: they are written under the old key again.
 */
function revertRecordRename(
  item: t.ChangeSummaryItem,
  editedValues: t.FlatConfigMap,
  entryPath: string,
  previousPath: string,
): t.ReviewRevertAction {
  const discard = [
    ...pendingUnder(editedValues, entryPath),
    ...pendingUnder(editedValues, previousPath),
  ];
  if (!isConfigRecord(item.before) || !isConfigRecord(item.after)) {
    return { op: 'discard', paths: discard };
  }
  const writes = renamedChanges(item.before, item.after, previousPath);
  return { op: 'unrename', entryPath, discard, writes };
}

/**
 * The pending edit a row comes from. A keyed collection is reviewed as its
 * whole pending list, but its entries are edited at their own positions
 * (`endpoints.custom.3`): the row belongs to the deepest such edit that holds it.
 */
function pendingSourceOf(item: t.ChangeSummaryItem, editedValues: t.FlatConfigMap): string {
  const source = item.sourcePath ?? item.path;
  if (source in editedValues) return source;
  let deepest: string | undefined;
  for (const key of Object.keys(editedValues)) {
    if (!key.startsWith(`${source}.`)) continue;
    if (item.path !== key && !item.path.startsWith(`${key}.`)) continue;
    if (deepest === undefined || key.length > deepest.length) deepest = key;
  }
  return deepest ?? source;
}

/**
 * How Revert undoes one review row (WS7). A row that is a whole pending edit
 * (a field, a reset, an entry edited as a whole, or an entry created field by
 * field) drops those edits. A row that is one part of a larger edit (one
 * entry of a list saved as a whole, one field of an entry) rewrites that edit
 * with just this part put back; when nothing else is left, the edit is dropped.
 */
export function planRevert(
  item: t.ChangeSummaryItem,
  editedValues: t.FlatConfigMap,
  baselineTree: t.ConfigValue,
): t.ReviewRevertAction {
  const source = pendingSourceOf(item, editedValues);
  const isPending = source in editedValues;
  const isPart = isPending && item.path.startsWith(`${source}.`);
  const isOrder = isPending && item.path === source && item.collectionPath === source;
  const isRename = isPending && item.path === source && item.kind === 'renamed';
  if (!isPending && item.kind === 'renamed' && item.previousIdentity && item.collectionPath) {
    const previousPath = `${item.collectionPath}.${item.previousIdentity}`;
    return revertRecordRename(item, editedValues, source, previousPath);
  }
  /** A field a renamed record entry also changed: the new key goes back to the old key's value. */
  const isRenamedField =
    item.kind !== 'renamed' &&
    item.previousIdentity != null &&
    item.entryPath != null &&
    !INDEX_SEGMENT_RE.test(item.entryPath.slice(item.entryPath.lastIndexOf('.') + 1));
  /** A secret entered for it goes again: its `before` is the masked preview, never a value to write. */
  if (isRenamedField && item.path in editedValues) {
    return item.before === undefined || item.secret
      ? { op: 'discard', paths: [item.path] }
      : { op: 'set', path: item.path, value: item.before };
  }
  if (!isPart && !isOrder && !isRename) {
    const paths = pendingUnder(editedValues, source);
    return {
      op: 'discard',
      paths: paths.length > 0 ? paths : pendingUnder(editedValues, item.path),
    };
  }
  const baseline = getValueAtPath(baselineTree, source);
  const pending = deepSerializeKVPairs(editedValues[source]);
  const value = isRename
    ? revertRename(pending, baseline, item)
    : revertWithin(pending, baseline, source, item);
  if (isConfigValueEqual(normalizeForSave(value, null), normalizeForSave(baseline, null))) {
    return { op: 'discard', paths: [source] };
  }
  return { op: 'set', path: source, value };
}
