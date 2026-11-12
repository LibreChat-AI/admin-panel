import type * as t from '@/types';
import {
  setLeaf,
  resetLeaf,
  deepClone,
  isPlainObject,
  resolveEntryKey,
  keepStoredPreviews,
} from './validation';
import { hasDottedKey } from '@/utils';

/**
 * Every leaf of an object as `[segments, value]`; arrays and scalars are
 * leaves, and so is an object with a dotted key (`hasDottedKey`: a header
 * named `x.api.version`), which a dot-path built from the segments would
 * split, so it is written whole.
 */
export function leafEntries(
  value: t.ConfigRecord,
  prefix: string[] = [],
): Array<[string[], t.ConfigValue]> {
  return Object.entries(value).flatMap(([key, child]): Array<[string[], t.ConfigValue]> => {
    const segments = [...prefix, key];
    if (isPlainObject(child) && Object.keys(child).length > 0 && !hasDottedKey(child)) {
      return leafEntries(child, segments);
    }
    return [[segments, child]];
  });
}

/** The pending edits of each server, in the order they were made (paths under `${path}.`). */
function editsByServer(
  editedValues: t.FlatConfigMap,
  path: string,
  knownKeys: string[],
): Map<string, t.McpEntryEdit[]> {
  const prefix = `${path}.`;
  const byServer = new Map<string, t.McpEntryEdit[]>();
  for (const [editPath, value] of Object.entries(editedValues)) {
    if (!editPath.startsWith(prefix)) continue;
    const parsed = resolveEntryKey(editPath.slice(prefix.length), knownKeys);
    if (!parsed) continue;
    const list = byServer.get(parsed.entryKey) ?? [];
    list.push({ segments: parsed.segments, value });
    byServer.set(parsed.entryKey, list);
  }
  return byServer;
}

/**
 * One server with its edits applied. The latest whole-server write is the
 * seed: a reset reads as what the layer beneath defines (nothing, for a
 * server the target added). Field edits after it apply on top; a reset of a
 * field shows the value beneath again. A stored secret whose holder the
 * edits still write keeps its preview, as LibreChat keeps the secret.
 */
function resolveServer(
  saved: t.ConfigValue,
  lower: t.ConfigValue,
  edits: t.McpEntryEdit[],
): t.McpResolvedServer {
  let seed: t.ConfigValue = saved;
  let reset = false;
  let start = 0;
  edits.forEach((edit, index) => {
    if (edit.segments.length > 0) return;
    reset = edit.value === undefined;
    seed = reset ? lower : edit.value;
    start = index + 1;
  });
  const reverted = reset && lower !== undefined;
  const leaves = edits.slice(start).filter((edit) => edit.segments.length > 0);
  if (leaves.length === 0) {
    return { value: reset ? seed : keepStoredPreviews(saved, seed), reset: reverted };
  }
  const next = isPlainObject(seed) ? deepClone(seed) : {};
  const removed = new Set<string>();
  for (const { segments, value } of leaves) {
    if (value !== undefined) {
      setLeaf(next, segments, value);
      continue;
    }
    resetLeaf(next, segments, lower);
    removed.add(segments.join('.'));
  }
  return { value: keepStoredPreviews(saved, next, removed), reset: reverted };
}

/**
 * The servers the page shows (saved ones with pending edits applied, new
 * ones last in the order they were created), the saved servers a pending
 * Delete removes, and the ones a pending revert returns to the layer beneath.
 * Derived from the edits alone, so a deletion survives Discard → Undo (D9).
 */
export function buildServerList({
  saved,
  lower,
  editedValues,
  path,
}: t.McpServerListInput): t.McpServerList {
  const savedKeys = Object.keys(saved);
  const edits = editsByServer(editedValues, path, savedKeys);
  if (edits.size === 0) return { record: saved, deleted: [], reverted: new Set() };
  const record: t.ConfigRecord = {};
  const deleted: t.McpPendingDeletion[] = [];
  const reverted = new Set<string>();
  savedKeys.forEach((key, index) => {
    const serverEdits = edits.get(key);
    if (!serverEdits) {
      record[key] = saved[key];
      return;
    }
    const { value, reset } = resolveServer(saved[key], lower[key], serverEdits);
    if (value === undefined) {
      deleted.push({ key, index, value: saved[key] });
      return;
    }
    if (reset) reverted.add(key);
    record[key] = value;
  });
  for (const [key, serverEdits] of edits) {
    if (Object.hasOwn(saved, key)) continue;
    const { value } = resolveServer(undefined, lower[key], serverEdits);
    if (value !== undefined) record[key] = value;
  }
  return { record, deleted, reverted };
}
