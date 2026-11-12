import { useMemo, useCallback, useRef, useEffect } from 'react';
import type * as t from '@/types';
import {
  notifyInfo,
  notifyUndo,
  isRelatedPath,
  revertTargetAt,
  getEntryKey,
  isSecretPath,
  findEntryIndex,
  getKeyedCollection,
  overriddenEntryKeys,
  mergesByKey,
  mergedListPaths,
  resolveShadowedBy,
  flattenObject,
  isConfigRecord,
  getValueAtPath,
  isConfigValueEqual,
  holdErrorToasts,
  hasPathOrAncestor,
  isRestateWarning,
  findEntryKeyMoves,
  findEntryOverrides,
  findUnboundOverrides,
  restatableCredential,
  getKeyedValue,
  parseKeyedPath,
  isKeyedPath,
  isKeyedEntry,
  entryLocation,
  findHiddenEndpointUses,
  entryIdentityOf,
  hiddenAfterEdits,
  keyedEntriesOf,
  secretPathForPreviewPath,
} from '@/utils';
import {
  findEntry,
  lowerValue,
  applySaves,
  isObjectList,
  droppedOwnParts,
  summarizeChanges,
  withoutSecretPreviews,
} from '@/components/configuration/review/diff';
import {
  KEYED_COLLECTIONS,
  SECRET_PREVIEW_MASK,
  getConfigSection,
  appliesGroupHides,
} from '@/constants';
import { locate, scopeTypeLabel, buildReviewModel } from '@/components/configuration/review/group';
import { revealConfigPath } from '@/components/configuration/review/reveal';
import { toReviewIssues } from '@/components/configuration/review/issues';
import { overrideCountUnit } from '@/components/configuration/counts';
import { planRevert } from '@/components/configuration/review/revert';
import { findSchemaField } from '@/components/configuration/controls';
import { normalizeForSave } from '@/components/configuration/edits';
import { useConfigContract } from './contract';
import { useLocalize } from '../useLocalize';

const NO_ISSUES: t.ReviewIssue[] = [];

/** The review warning of a change Global overrides take precedence over, by how they win. */
const SHADOW_WARNINGS: Readonly<Record<NonNullable<t.ShadowedBy['precedence']>, t.ChangeWarning>> =
  {
    block: 'shadowedBlock',
    field: 'shadowed',
    pair: 'shadowedPair',
  };

/** Where Go to field lands: a removed entry is no longer on the page, so its list. */
function goToPath(item: t.ChangeSummaryItem): string {
  if (ENTRY_GONE_KINDS.has(item.kind) && item.entryPath === item.path && item.collectionPath) {
    return item.collectionPath;
  }
  return item.path;
}

/** Entry-level changes whose entry the list no longer shows as one of its rows. */
const ENTRY_GONE_KINDS: ReadonlySet<t.ChangeKind> = new Set(['removed', 'hidden', 'unhidden']);

/**
 * A pending hide or unhide by key (`endpoints.custom["Name"]`, or a key of
 * one of its records) as a review row: a whole entry as an entry row with
 * what the hide deletes of the target's own entry and the model specs it
 * hides too; a value inside it as a field row of that entry, at its place
 * in the list the page shows.
 */
function keyedVisibilityItem(
  path: string,
  keyed: t.KeyedPath,
  edit: t.VisibilityEdit,
  layers: t.KeyedVisibilityLayers,
): t.ChangeSummaryItem {
  const { collection } = keyed;
  const list = getValueAtPath(layers.baseline, collection.path);
  const index = Array.isArray(list) ? list.findIndex((entry) => isKeyedEntry(keyed, entry)) : -1;
  const lowerEntry = getKeyedValue(layers.lower, { ...keyed, rest: '' });
  const name = getEntryKey(lowerEntry, collection.key) ?? keyed.key;
  const kind = edit === 'hide' ? 'hidden' : 'unhidden';
  const shared = { kind, before: undefined, after: undefined, sourcePath: path } as const;
  const entry = { entryIdentity: name, collectionPath: collection.path };
  if (keyed.rest) {
    const entryPath =
      index >= 0 ? `${collection.path}.${index}` : entryLocation(collection.path, name);
    const value = getKeyedValue(layers.lower, keyed);
    /** A value the target sets there itself is what its users get now, and the change deletes it. */
    const own = layers.keyedTombstones ? getKeyedValue(layers.own, keyed) : undefined;
    return {
      ...shared,
      ...entry,
      path: `${entryPath}.${keyed.rest}`,
      entryPath,
      revertTarget:
        value === undefined ? undefined : { value, source: layers.isScope ? 'inherited' : 'yaml' },
      secret: isSecretPath(`${entryPath}.${keyed.rest}`) || undefined,
      ...(own !== undefined && { before: own, warnings: ['deletesOwnValue' as const] }),
    };
  }
  const entryPath = entryLocation(collection.path, name);
  const item: t.ChangeSummaryItem = { ...shared, ...entry, path: entryPath, entryPath };
  if (edit !== 'hide') return item;
  const uses = findHiddenEndpointUses(
    layers.baseline,
    new Set([entryIdentityOf(collection, keyed.key)]),
    hiddenAfterEdits(layers.tombstones, layers.visibility, collection),
  );
  const own = getKeyedValue(layers.own, keyed);
  const ownParts = isConfigRecord(own)
    ? Object.fromEntries(Object.entries(own).filter(([field]) => field !== collection.key))
    : undefined;
  const at = index >= 0 ? `${collection.path}.${index}` : entryPath;
  const dropped = droppedOwnParts(at, ownParts, false).map((part) => ({ ...part, ...entry }));
  return {
    ...item,
    hiddenUses: uses,
    ...(dropped.length > 0 && { dropped, warnings: ['hideDeletesOwn' as const] }),
  };
}

/**
 * Where a row's value sits inside its keyed entry, by the entry's identity
 * as LibreChat matches it (`endpoints.custom`, `ollama`, `headers.X-Team`);
 * none for a row of a whole entry or outside one.
 */
function entryValueKey(item: t.ChangeSummaryItem): string | undefined {
  const { collectionPath, entryPath, entryIdentity, path } = item;
  const collection = collectionPath ? getKeyedCollection(collectionPath) : undefined;
  if (!collection || !entryPath || entryIdentity === undefined) return undefined;
  if (!path.startsWith(`${entryPath}.`)) return undefined;
  const identity = entryIdentityOf(collection, entryIdentity);
  return `${collection.path}\u0000${identity}\u0000${path.slice(entryPath.length + 1)}`;
}

/**
 * The leaves two values differ at, relative to them ('' for the values
 * themselves), each with its value in `after` (undefined where it goes).
 */
function changedLeaves(before: t.ConfigValue, after: t.ConfigValue): Map<string, t.ConfigValue> {
  if (!isConfigRecord(before) && !isConfigRecord(after)) return new Map([['', after]]);
  const was = isConfigRecord(before) ? flattenObject(before) : {};
  const now = isConfigRecord(after) ? flattenObject(after) : {};
  const leaves = new Map<string, t.ConfigValue>();
  for (const leaf of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (!isConfigValueEqual(was[leaf], now[leaf])) leaves.set(leaf, now[leaf]);
  }
  return leaves;
}

/** `item` without a warning; its warnings left out when none remains. */
function withoutWarning(item: t.ChangeSummaryItem, warning: t.ChangeWarning): t.ChangeSummaryItem {
  const { warnings, ...rest } = item;
  const kept = warnings?.filter((other) => other !== warning) ?? [];
  return kept.length > 0 ? { ...rest, warnings: kept } : rest;
}

/**
 * The keyed key (`collection\u0000identity\u0000rest`) a changed leaf at `at`
 * falls under: the key itself, or one holding it, as an object value the
 * review splits into its leaves (`addParams.provider.order` under
 * `addParams.provider`).
 */
function keyedKeyOf(keyed: ReadonlySet<string>, at: string): string | undefined {
  const start = at.lastIndexOf('\u0000') + 1;
  for (let end = at.length; end > start; end = at.lastIndexOf('.', end - 1)) {
    const key = at.slice(0, end);
    if (keyed.has(key)) return key;
  }
  return undefined;
}

/**
 * The pending edit of the value at a keyed row's key (`rest`, inside the
 * entry), read from a value row of that entry the keyed row describes:
 * Revert of the keyed row takes the value there back to what it was.
 */
function valueEditAt(item: t.ChangeSummaryItem, rest: string): t.ChangeSummaryItem {
  return {
    path: `${item.entryPath}.${rest}`,
    kind: 'changed',
    before: undefined,
    after: undefined,
    sourcePath: item.sourcePath,
    collectionPath: item.collectionPath,
    entryPath: item.entryPath,
    entryIdentity: item.entryIdentity,
    previousIdentity: item.previousIdentity,
  };
}

/**
 * The value rows and the hides and unhides by key of the same values, as
 * one account of what Save does: a value row whose changed values keyed
 * rows all describe (at their key or under it) is left out, and each keyed
 * row it falls under carries the pending edit of its key (`valueEdit`), so
 * Revert takes the whole row back. A hide leaves the target's value there
 * out of what the save writes, and an unhide resets it (an own value the row
 * deletes). An unhide the same save writes a value under resets the removal
 * first, so the value is stored and its users get it: the unhide row reads
 * with the value the save leaves at its key (`after`, read from `saved`),
 * and deletes nothing. A value equal to the layer beneath's is not stored,
 * so the row still reads as inherited.
 */
function withKeyedValueRows(
  rows: t.ChangeSummaryItem[],
  visibility: t.ChangeSummaryItem[],
  saved: t.ConfigValue,
): { rows: t.ChangeSummaryItem[]; visibility: t.ChangeSummaryItem[] } {
  const keyed = new Set(
    visibility.flatMap((item) =>
      item.sourcePath && isKeyedPath(item.sourcePath) ? (entryValueKey(item) ?? []) : [],
    ),
  );
  if (keyed.size === 0) return { rows, visibility };
  const written = new Map<string, t.ConfigValue>();
  const edits = new Map<string, t.ChangeSummaryItem>();
  const kept = rows.filter((item) => {
    const key = entryValueKey(item);
    if (key === undefined) return true;
    const leaves = changedLeaves(item.before, item.after);
    const covered = new Map<string, t.ChangeSummaryItem>();
    let described = leaves.size > 0;
    for (const leaf of leaves.keys()) {
      const covering = keyedKeyOf(keyed, leaf ? `${key}.${leaf}` : key);
      if (covering === undefined) {
        described = false;
        continue;
      }
      const rest = covering.slice(covering.lastIndexOf('\u0000') + 1);
      const value = getValueAtPath(saved, `${item.entryPath}.${rest}`);
      if (value !== undefined) written.set(covering, value);
      if (!edits.has(covering)) covered.set(covering, valueEditAt(item, rest));
    }
    if (described) for (const [covering, edit] of covered) edits.set(covering, edit);
    return !described;
  });
  if (written.size === 0 && edits.size === 0) return { rows: kept, visibility };
  return {
    rows: kept,
    visibility: visibility.map((item) => {
      const key = entryValueKey(item);
      if (key === undefined) return item;
      const valueEdit = edits.get(key);
      const withEdit = valueEdit ? { ...item, valueEdit } : item;
      const value = item.kind === 'unhidden' ? written.get(key) : undefined;
      if (value === undefined || isConfigValueEqual(value, item.revertTarget?.value)) {
        return withEdit;
      }
      return { ...withoutWarning(withEdit, 'deletesOwnValue'), after: value };
    }),
  };
}

/** The credential of a custom endpoint, whose removal a moved destination leaves unsent. */
const ENDPOINT_CREDENTIAL = 'apiKey';

/** The plan warnings about a credential LibreChat drops once it is sent somewhere new. */
const REBINDING_WARNINGS: ReadonlySet<t.ChangeWarning> = new Set([
  'secretRebinding',
  'secretRebindingEnter',
]);

/**
 * Whether a plan warning about a moved credential (`secretRebinding`)
 * belongs to a row: the setting that moved it, or within a collection entry
 * (by identity) one of the settings it names, or the credential itself.
 */
function isRebindingRow(warning: t.ConfigWarning, item: t.ChangeSummaryItem): boolean {
  if (!REBINDING_WARNINGS.has(warning.warning)) return false;
  if (warning.entryIdentity === undefined) return isRelatedPath(warning.path, item.path);
  if (item.collectionPath !== warning.path || item.entryIdentity !== warning.entryIdentity) {
    return false;
  }
  const keys = [...(warning.keys ?? []), ENDPOINT_CREDENTIAL];
  return keys.some((key) => item.path === `${item.entryPath}.${key}`);
}

/** Whether a plan warning about a duplicate's uncopied secrets (`secretNotCopied`) is the row of that duplicate. */
function isUncopiedRow(warning: t.ConfigWarning, item: t.ChangeSummaryItem): boolean {
  return (
    warning.warning === 'secretNotCopied' &&
    item.path === item.entryPath &&
    item.collectionPath === warning.path &&
    item.entryIdentity === warning.entryIdentity
  );
}

/** The data path of the entry a restated credential belongs to, as the page lists it. */
function restatedEntryPath(ref: t.CredentialRef, tree: t.ConfigValue): string | undefined {
  if (ref.path === 'mcpServers') return `${ref.path}.${ref.entry}`;
  const index = findEntryIndex(getValueAtPath(tree, ref.path), 'name', ref.entry);
  return index < 0 ? undefined : `${ref.path}.${index}`;
}

/** Rows that delete the target's own value at their path (a removed entry, a removed setting). */
const REMOVAL_KINDS: ReadonlySet<t.ChangeKind> = new Set(['removed', 'reverted']);

/**
 * The target's own value a removal row deletes: an entry of a keyed list by
 * its identity (the page's positions differ from the stored list's), anything
 * else at its path.
 */
function ownValueOf(item: t.ChangeSummaryItem, own: t.ConfigValue): t.ConfigValue {
  const collection = item.collectionPath ? getKeyedCollection(item.collectionPath) : undefined;
  if (!collection || item.entryPath !== item.path || item.entryIdentity === undefined) {
    return getValueAtPath(own, item.path);
  }
  const list = getValueAtPath(own, collection.path);
  const index = findEntryIndex(list, collection.key, item.entryIdentity);
  return index < 0 || !Array.isArray(list) ? undefined : list[index];
}

/**
 * A removal row with the stored secrets it deletes along (`dropped`), so the
 * review names each one, and its value shown without their masked previews;
 * a secret's own row already says so.
 */
function withDroppedSecrets(item: t.ChangeSummaryItem, own: t.ConfigValue): t.ChangeSummaryItem {
  if (!REMOVAL_KINDS.has(item.kind) || item.secret) return item;
  const dropped = droppedOwnParts(item.path, ownValueOf(item, own), true);
  if (dropped.length === 0) return item;
  return { ...item, before: withoutSecretPreviews(item.before, item.path), dropped };
}

/** Where a removed stored secret is, as the review's rows place it (`SecretLocation`). */
function locateSecret(
  secret: t.StoredSecret,
  fields: t.SchemaField[],
  baseline: t.ConfigValue,
): t.SecretLocation {
  if (secret.entry) {
    const { collection, identity } = secret.entry;
    const key = getKeyedCollection(collection)?.key ?? 'name';
    const index = findEntryIndex(getValueAtPath(baseline, collection), key, identity);
    const entryPath = `${collection}.${index < 0 ? identity : index}`;
    return {
      entry: { collectionPath: collection, entryPath, identity },
      path: secret.path,
      display: `${entryPath}.${secret.path}`,
    };
  }
  const entry = findEntry(fields, secret.path, () => undefined);
  if (!entry?.identity || !secret.path.startsWith(`${entry.entryPath}.`)) {
    return { path: secret.path, display: secret.path };
  }
  return { entry, path: secret.path.slice(entry.entryPath.length + 1), display: secret.path };
}

/** `path` (of a row or a part of one) inside the entry a secret is in, matched by identity; undefined elsewhere. */
function pathInEntry(
  item: t.ChangeSummaryItem,
  path: string,
  location: t.SecretLocation,
): string | undefined {
  const { entry } = location;
  if (!entry || item.collectionPath !== entry.collectionPath || !item.entryPath) return undefined;
  if (item.entryIdentity !== entry.identity && item.previousIdentity !== entry.identity) {
    return undefined;
  }
  if (path === item.entryPath) return '';
  return path.startsWith(`${item.entryPath}.`) ? path.slice(item.entryPath.length + 1) : undefined;
}

/** Whether `path` (in `item`) is where a secret is, or (`above`) holds it. */
function isAtSecret(
  item: t.ChangeSummaryItem,
  path: string,
  location: t.SecretLocation,
  above = false,
): boolean {
  const inner = pathInEntry(item, path, location);
  const target = inner === undefined ? location.display : location.path;
  const at = inner ?? path;
  if (at === target) return true;
  return above && (at === '' || target.startsWith(`${at}.`));
}

/**
 * How a row names a removed stored secret: as its own secret row (`row`;
 * `added` when it reads as setting a key there), as a removed secret above
 * it, or as a part it lists (`dropped`); false when it does not.
 */
function nameOf(item: t.ChangeSummaryItem, location: t.SecretLocation): 'row' | 'added' | false {
  if (item.secret && isAtSecret(item, item.path, location)) {
    return item.kind === 'added' ? 'added' : 'row';
  }
  if (item.secret && REMOVAL_KINDS.has(item.kind) && isAtSecret(item, item.path, location, true)) {
    return 'row';
  }
  return item.dropped?.some((part) => isAtSecret(item, part.path, location)) ? 'row' : false;
}

/**
 * The rows with every stored secret the save takes away named (WS1, WS7),
 * whichever change removes it. A row that reads as setting a key where one
 * is stored reads as replacing it; a secret no row names yet is listed under
 * the row of its entry, else of its section (`dropped`).
 */
function withRemovedSecrets(
  items: t.ChangeSummaryItem[],
  locations: t.SecretLocation[],
): t.ChangeSummaryItem[] {
  let rows = items;
  for (const location of locations) {
    const named = rows.map((item) => nameOf(item, location));
    if (named.includes('row')) continue;
    if (named.includes('added')) {
      rows = rows.map((item, i) =>
        named[i] === 'added' ? { ...item, kind: 'changed', before: SECRET_PREVIEW_MASK } : item,
      );
      continue;
    }
    const section = getConfigSection(location.display);
    const holder = rows.findIndex((item) => isAtSecret(item, item.path, location, true));
    const at =
      holder >= 0 ? holder : rows.findIndex((item) => getConfigSection(item.path) === section);
    if (at < 0) continue;
    const part: t.ChangeSummaryItem = {
      path: location.display,
      kind: 'removed',
      before: undefined,
      after: undefined,
      secret: true,
      ...(location.entry && {
        entryPath: location.entry.entryPath,
        entryIdentity: location.entry.identity,
      }),
    };
    rows = rows.map((item, i) =>
      i === at ? { ...item, dropped: [...(item.dropped ?? []), part] } : item,
    );
  }
  return rows;
}

/** The lists profiles override entries of by name where no server says which it merges: the custom endpoints. */
const DEFAULT_MERGED_LISTS: ReadonlySet<string> = new Set(['endpoints.custom']);

/** Whether profiles override the entries of `collection` by name: MCP servers, and each list LibreChat merges entry by entry. */
function isNamedEntryCollection(collection: string, ctx: t.OverrideNoteContext): boolean {
  return collection === 'mcpServers' || (ctx.mergedLists ?? DEFAULT_MERGED_LISTS).has(collection);
}

const NO_PROFILES: readonly t.ConfigScope[] = [];

/** No removals by key: a server without keyed tombstones stores them without effect. */
const NO_TOMBSTONES: ReadonlySet<string> = new Set();

/** "mcpServers\u0000acme": an entry by collection and name, as one key. */
function entryKey(collection: string, identity: string): string {
  return `${collection}\u0000${identity}`;
}

/** Whether `tree` holds an entry of `collection` named `name` (an MCP server by key, a list entry by its key). */
function hasEntry(tree: t.ConfigValue, collection: string, name: string): boolean {
  const value = getValueAtPath(tree, collection);
  if (!Array.isArray(value)) return isConfigRecord(value) && Object.hasOwn(value, name);
  return findEntryIndex(value, getKeyedCollection(collection)?.key ?? 'name', name) >= 0;
}

/** A note on the profiles a change to an entry of `collection` affects, when it affects any. */
function noteOf(
  change: t.EntryOverrideChange,
  overrides: t.EntryOverride[],
  collection: string,
): t.EntryOverrideNote[] {
  return overrides.length > 0 ? [{ change, overrides, collection }] : [];
}

/**
 * What an entry row's change does to the profiles that override entries by
 * name: a rename or removal leaves their overrides under the old name (a
 * rename's old name is `taken` when another row writes an entry under it, a
 * swap or a chain), and a rename or new entry onto a name they override
 * takes their overrides there.
 */
function entryRowNotes(
  item: t.ChangeSummaryItem,
  ctx: t.OverrideNoteContext,
): t.EntryOverrideNote[] {
  const { collectionPath: collection, entryIdentity: identity, previousIdentity } = item;
  if (!collection || !isNamedEntryCollection(collection, ctx) || item.entryPath !== item.path) {
    return [];
  }
  const lookup = (name: string) =>
    findEntryOverrides(ctx.profiles, collection, name, ctx.keyedTombstones);
  /** A name Base already used before the save is no leftover: its overrides were made for it. */
  const took = (name: string) =>
    hasEntry(ctx.before, collection, name)
      ? []
      : noteOf({ kind: 'took', name, sendsKeys: ctx.sendsKeys }, lookup(name), collection);
  if (item.kind === 'renamed' && previousIdentity !== undefined && identity !== undefined) {
    const taken = ctx.written.has(entryKey(collection, previousIdentity));
    return [
      ...noteOf(
        { kind: 'renamed', name: previousIdentity, next: identity, taken },
        lookup(previousIdentity),
        collection,
      ),
      ...took(identity),
    ];
  }
  if (identity === undefined) return [];
  if (item.kind === 'added') return took(identity);
  if (item.kind !== 'removed') return [];
  /** A hide of a removed entry hides nothing once it is gone. */
  const left = lookup(identity).filter((override) => override.overrides);
  return noteOf({ kind: 'removed', name: identity }, left, collection);
}

/**
 * Where a row's setting is inside the entry `move` names (`url`), or
 * undefined when the row is not one of its settings. A row of a record
 * entry listed by path alone ("Reset base config") is matched by its path.
 */
function settingIn(item: t.ChangeSummaryItem, move: t.EntryKeyMove): string | undefined {
  if (item.entryIdentity === undefined && !getKeyedCollection(move.collection)) {
    const prefix = `${move.collection}.${move.identity}.`;
    return item.path.startsWith(prefix) ? item.path.slice(prefix.length) : undefined;
  }
  const { entryPath } = item;
  if (item.collectionPath !== move.collection || item.entryIdentity !== move.identity) {
    return undefined;
  }
  if (entryPath === undefined || item.path === entryPath) return undefined;
  return item.path.slice(entryPath.length + 1);
}

/** The row a moved destination's note goes on: its entry's first row at a moved setting, else its first setting row. */
function keyMoveRow(rows: readonly t.ChangeSummaryItem[], move: t.EntryKeyMove): number {
  const fields = new Set(Object.values(move.moves).flat());
  const settings = rows.map((item) => settingIn(item, move));
  const atMoved = settings.findIndex((setting) => setting !== undefined && fields.has(setting));
  return atMoved >= 0 ? atMoved : settings.findIndex((setting) => setting !== undefined);
}

/**
 * Base's rows with the profiles that override its entries by name, on each
 * row whose change affects them (`overrideNotes`): a rename or removal
 * leaves their overrides, stored keys and hides under the old name; a
 * rename or new entry onto a name they override takes them; and an entry
 * whose destination the save moves (`keyMoves`) no longer gets the keys of
 * their own they store there (`findUnboundOverrides`), on the row of the
 * moved setting.
 */
function withOverrideNotes(
  rows: t.ChangeSummaryItem[],
  options: t.OverrideNoteOptions,
): t.ChangeSummaryItem[] {
  const { profiles, keyMoves } = options;
  if (profiles.length === 0) return rows;
  const written = new Set(
    rows.flatMap((item) =>
      item.collectionPath && item.entryIdentity !== undefined && !REMOVAL_KINDS.has(item.kind)
        ? [entryKey(item.collectionPath, item.entryIdentity)]
        : [],
    ),
  );
  const ctx: t.OverrideNoteContext = { ...options, written };
  const notes = rows.map((item) => entryRowNotes(item, ctx));
  for (const move of keyMoves) {
    const found = findEntryOverrides(
      profiles,
      move.collection,
      move.identity,
      options.keyedTombstones,
    );
    const unbound = findUnboundOverrides(move.moves, found);
    const at = unbound.length > 0 ? keyMoveRow(rows, move) : -1;
    if (at < 0) continue;
    notes[at] = [
      ...notes[at],
      ...noteOf({ kind: 'moved', name: move.identity }, unbound, move.collection),
    ];
  }
  return rows.map((item, i) => (notes[i].length > 0 ? { ...item, overrideNotes: notes[i] } : item));
}

function namesOf(list: t.ConfigValue): Set<string> {
  const names = new Set<string>();
  if (!Array.isArray(list)) return names;
  for (const entry of list) {
    if (isConfigRecord(entry) && typeof entry.name === 'string') names.add(entry.name);
  }
  return names;
}

/**
 * The change review (WS7): what Save writes, as human-readable rows grouped
 * tab › section › entry, with BEFORE values from the target being saved
 * (the open profile's own values, or Base), pre-flight problems that block
 * Save, per-row Revert and Go to field, and Discard with Undo.
 */
export function useChangeReview({
  schemaTree,
  editingScope,
  layers,
  edits,
  save,
  onTabChange,
  profiles = NO_PROFILES,
}: t.ChangeReviewOptions): t.ChangeReviewState {
  const localize = useLocalize();
  const { rules, features } = useConfigContract();
  const { titleResolution } = rules;
  const isScope = editingScope !== undefined;
  /** Hides of Azure groups by name another client stored, which LibreChat applies: unhiding one reads by group. */
  const groupHides = appliesGroupHides(features);
  const {
    savePlan,
    fieldErrors,
    changes,
    warnings,
    removedSecrets,
    keyMoves,
    confirmSaveOpen: open,
  } = save;
  const {
    configValues,
    dbOverrides,
    yamlConfig,
    yamlMcpServers,
    schemaDefaults,
    schemaPathSet,
    overridePaths,
    valueLayers,
    baseActiveConfigValues: baseline,
  } = layers;
  /** The target's own values: the base admin overrides, or the open profile's (WS4). */
  const ownValues = isScope ? valueLayers?.scope?.overrides : dbOverrides;

  const yamlEntryKeys = useMemo(() => {
    const endpoints = isConfigRecord(yamlConfig?.endpoints) ? yamlConfig.endpoints : undefined;
    return new Map<string, Set<string>>([
      ['endpoints.custom', namesOf(endpoints?.custom)],
      ['mcpServers', new Set(Object.keys(yamlMcpServers ?? {}))],
    ]);
  }, [yamlConfig, yamlMcpServers]);

  /** What a path reverts to or inherits: WS4's layers, else librechat.yaml or Base directly. */
  const lowerAt = useCallback(
    (path: string) =>
      valueLayers
        ? revertTargetAt(path, valueLayers)
        : lowerValue(path, { isScope, configValues, yamlConfig, schemaDefaults }),
    [valueLayers, isScope, configValues, yamlConfig, schemaDefaults],
  );

  const input = useMemo<t.ChangeSummaryInput>(
    () => ({
      saves: savePlan.saves,
      resets: savePlan.resets,
      baseline,
      ownAt: (path) => getValueAtPath(ownValues, path),
      isOwned: (path) => hasPathOrAncestor(overridePaths, path),
      lowerAt,
      yamlEntries: (collectionPath) => (isScope ? undefined : yamlEntryKeys.get(collectionPath)),
      isScope,
      fields: schemaTree,
      schemaPaths: schemaPathSet,
      renames: edits.renameEdits,
      mergedLists: mergedListPaths(features),
    }),
    [
      features,
      savePlan,
      baseline,
      isScope,
      ownValues,
      overridePaths,
      lowerAt,
      yamlEntryKeys,
      schemaTree,
      schemaPathSet,
      edits.renameEdits,
    ],
  );

  /**
   * Pending hides and unhides of inherited values: Save writes them as
   * tombstone ops (WS1), except those it leaves out (listed as skipped). A
   * hide deletes what the target sets itself at and under the path, so each
   * such part is listed under the row (`dropped`).
   */
  const visibilityItems = useMemo(() => {
    const notSent = new Set(savePlan.skipped.map((skip) => skip.fieldPath));
    const keyedLayers: t.KeyedVisibilityLayers = {
      lower: isScope ? configValues : yamlConfig,
      own: ownValues,
      baseline,
      isScope,
      tombstones: (isScope ? valueLayers?.scope?.tombstones : valueLayers?.baseTombstones) ?? [],
      visibility: edits.visibilityEdits,
      keyedTombstones: features.keyedTombstones,
    };
    return Object.entries(edits.visibilityEdits).flatMap(([path, edit]): t.ChangeSummaryItem[] => {
      if (notSent.has(path)) return [];
      const keyed = parseKeyedPath(path, groupHides);
      if (keyed) return [keyedVisibilityItem(path, keyed, edit, keyedLayers)];
      const item: t.ChangeSummaryItem = {
        path,
        kind: edit === 'hide' ? 'hidden' : 'unhidden',
        before: undefined,
        after: undefined,
        revertTarget: lowerAt(path),
        sourcePath: path,
        secret: isSecretPath(path) || undefined,
      };
      if (edit !== 'hide') return [item];
      const dropped = droppedOwnParts(path, getValueAtPath(ownValues, path), false);
      if (dropped.length === 0) return [item];
      return [{ ...item, dropped, warnings: ['hideDeletesOwn'] }];
    });
  }, [
    edits.visibilityEdits,
    savePlan.skipped,
    lowerAt,
    ownValues,
    isScope,
    configValues,
    yamlConfig,
    baseline,
    valueLayers,
    features.keyedTombstones,
    groupHides,
  ]);

  /**
   * Inherited credentials the save restates, where the plan applies the
   * restate (`secretRestated`): the target's override now holds each, so
   * LibreChat sends it to the new destination too. Revert takes it back.
   */
  const restateItems = useMemo(() => {
    const lower = (isScope ? configValues : yamlConfig) ?? {};
    return Object.values(edits.restateEdits).flatMap((ref): t.ChangeSummaryItem[] => {
      const entryPath = restatedEntryPath(ref, baseline);
      const value = restatableCredential(lower, ref);
      const applied = warnings.some((warning) => isRestateWarning(warning, ref));
      if (entryPath === undefined || value === undefined || !applied) return [];
      return [
        {
          path: `${entryPath}.${ref.secret}`,
          entryIdentity: ref.entry,
          collectionPath: ref.path,
          entryPath,
          kind: 'added',
          before: undefined,
          after: value,
          secret: true,
          restate: ref,
          warnings: ['secretRestated'],
        },
      ];
    });
  }, [edits.restateEdits, isScope, configValues, yamlConfig, baseline, warnings]);

  /** The config once the save is applied, at the positions the page lists entries at. */
  const saved = useMemo(() => applySaves(baseline, savePlan.saves), [baseline, savePlan.saves]);

  /**
   * Rows from the pending edits, flagged where the saved value changed since
   * the edit (WS1, SV-8), and where Global (`endpoints.all`) takes precedence
   * over the value being set, so the change has no effect (D11).
   */
  const items = useMemo(() => {
    const drift = new Map(
      changes.filter((change) => change.drift).map((change) => [change.path, change.drift]),
    );
    const locations = removedSecrets.map((secret) => locateSecret(secret, schemaTree, baseline));
    const keyed = withKeyedValueRows(summarizeChanges(input), visibilityItems, saved);
    const summarized = withRemovedSecrets(
      [
        ...keyed.rows.map((item) => withDroppedSecrets(item, ownValues)),
        ...keyed.visibility,
        ...restateItems,
      ],
      locations,
    );
    const rows = isScope
      ? summarized
      : withOverrideNotes(summarized, {
          profiles,
          keyMoves,
          sendsKeys: !features.secretRebinding,
          before: baseline,
          keyedTombstones: features.keyedTombstones,
          mergedLists: mergedListPaths(features),
        });
    return rows.map((item) => {
      const found = drift.get(item.path);
      const shadowedBy =
        item.after !== undefined
          ? resolveShadowedBy(item.path, baseline, edits.editedValues, titleResolution)
          : undefined;
      const planned = warnings.filter(
        (warning) => isRebindingRow(warning, item) || isUncopiedRow(warning, item),
      );
      if (!found && !shadowedBy && planned.length === 0) return item;
      const added: t.ChangeWarning[] = [
        ...(shadowedBy ? [SHADOW_WARNINGS[shadowedBy.precedence ?? 'field']] : []),
        ...new Set(planned.map((warning) => warning.warning)),
      ];
      return {
        ...item,
        ...(found && { drift: found }),
        ...(added.length > 0 && { warnings: [...(item.warnings ?? []), ...added] }),
      };
    });
  }, [
    input,
    changes,
    warnings,
    visibilityItems,
    saved,
    restateItems,
    ownValues,
    removedSecrets,
    schemaTree,
    baseline,
    edits.editedValues,
    titleResolution,
    isScope,
    profiles,
    keyMoves,
    features.secretRebinding,
    features.keyedTombstones,
  ]);

  const labelContext = useMemo<t.ReviewLabelContext>(
    () => ({ localize, fields: schemaTree, tree: saved }),
    [localize, schemaTree, saved],
  );

  /**
   * Blocking problems from the save pipeline (WS1): every client and server
   * issue, at the path the page shows it (entry fields by their position in
   * the pending list), labelled "Tab › Section › Entry › Field".
   */
  const issues = useMemo(
    () =>
      Object.entries(fieldErrors).flatMap(([path, message]) =>
        toReviewIssues(message, true, labelContext, path),
      ),
    [fieldErrors, labelContext],
  );

  /** A failed save that left no issue of its own (e.g. a network error), shown as is. */
  const saveIssues = useMemo(
    () =>
      edits.saveError && issues.length === 0
        ? toReviewIssues(edits.saveError, false, labelContext)
        : NO_ISSUES,
    [edits.saveError, issues.length, labelContext],
  );

  const model = useMemo(
    () => buildReviewModel(items, labelContext, [...issues, ...saveIssues], savePlan.skipped),
    [items, labelContext, issues, saveIssues, savePlan.skipped],
  );

  useEffect(() => (open ? holdErrorToasts() : undefined), [open]);

  const title = useMemo(() => {
    const { count } = model;
    if (count === 0) return localize('com_config_review_title_empty');
    if (!editingScope) return localize('com_config_review_title_base', { count });
    return localize('com_config_review_title_scope', {
      count,
      type: scopeTypeLabel(editingScope, localize),
      name: editingScope.name,
    });
  }, [model, editingScope, localize]);

  const latest = useRef({ edits, save, baseline });
  latest.current = { edits, save, baseline };

  const revertRow = useCallback((row: t.ReviewRow) => {
    const { edits: current, baseline: tree } = latest.current;
    const revertEdit = (item: t.ChangeSummaryItem) => {
      const action = planRevert(item, current.editedValues, tree);
      if (action.op === 'set') {
        current.handleFieldChange(action.path, action.value);
        return;
      }
      if (action.op === 'unrename') {
        for (const path of action.discard) current.handleDiscardField(path);
        for (const { path, value } of action.writes) current.handleFieldChange(path, value);
        current.handleRenameEntry(action.entryPath, null);
        return;
      }
      for (const path of action.paths) current.handleDiscardField(path);
    };
    const { item } = row;
    if (item.restate) {
      current.handleRestateCredential(item.restate, false);
      return;
    }
    if (item.kind !== 'hidden' && item.kind !== 'unhidden') {
      revertEdit(item);
      return;
    }
    const source = item.sourcePath ?? item.path;
    if (item.kind === 'hidden') current.handleUnhideField(source);
    else current.handleHideField(source);
    if (item.valueEdit) revertEdit(item.valueEdit);
  }, []);

  const { cancelReview } = save;
  const goToRow = useCallback(
    (target: Pick<t.ReviewRow, 'item'> | t.ReviewIssue) => {
      const path = 'item' in target ? goToPath(target.item) : target.path;
      if (!path) return;
      cancelReview();
      onTabChange(locate(path, localize).tabId);
      const item = 'item' in target ? target.item : undefined;
      revealConfigPath(
        path,
        item?.entryPath ? { entryPath: item.entryPath, identity: item.entryIdentity } : undefined,
      );
    },
    [cancelReview, onTabChange, localize],
  );

  /**
   * Discards every pending edit; Undo puts them all back, renamed and
   * duplicated entries included, against the revision they were made against.
   * After Reload (`reloaded`, settled once the target is read again) Undo
   * rebases them instead: it waits for that read, so they are restored over
   * the target as the page then loads it, never over the version loaded
   * before, which the next Save would meet as a conflict again. The edits
   * belong to the edit session Discard starts: once another starts (a profile
   * opened, a save), Undo restores nothing and says why, so edits and typed
   * secrets never land in another target.
   */
  const discard = useCallback(
    (reloaded?: Promise<void>) => {
      const { edits: current, save: saved } = latest.current;
      const { snapshot, editSessionId } = current;
      const { values, visibility, restates } = snapshot.pending;
      const count = Math.max(model.count, 1);
      const revision = saved.editRevision;
      const target = editingScope
        ? `${scopeTypeLabel(editingScope, localize)}: ${editingScope.name}`
        : localize('com_scope_base_config');
      current.handleDiscard();
      if ([values, visibility, restates].every((edits) => Object.keys(edits).length === 0)) return;
      const restore = (rebase: boolean) => {
        const now = latest.current;
        if (now.edits.editSessionId !== editSessionId + 1) {
          notifyInfo(localize('com_config_review_undo_expired', { target }));
          return;
        }
        if (!rebase) now.save.holdRevision(revision);
        now.edits.handleRestoreEdits(snapshot);
      };
      notifyUndo(
        localize('com_config_review_discarded', { count }),
        localize('com_config_review_undo'),
        () => {
          if (reloaded) void reloaded.then(() => restore(true));
          else restore(false);
        },
      );
    },
    [model.count, editingScope, localize],
  );
  const discardAll = useCallback(() => discard(), [discard]);

  const { reloadLatest: reloadTarget, cancelReview: closeAfterReload } = save;
  const reloadLatest = useCallback(() => {
    discard(reloadTarget().catch(() => undefined));
    closeAfterReload();
  }, [discard, closeAfterReload, reloadTarget]);

  /** A review that lists no change saves nothing, so nothing in it can block that. */
  const blocked = model.count > 0 && issues.some((issue) => issue.blocking);

  /** Save as the review reads: with no change listed, nothing is sent and the edits are dropped. */
  const { handleConfirmSave, finishWithoutWrites } = save;
  const confirm = useCallback(async () => {
    if (model.count > 0) return handleConfirmSave();
    finishWithoutWrites();
  }, [model.count, handleConfirmSave, finishWithoutWrites]);

  return {
    model,
    open,
    saving: save.saving,
    sessionExpired: save.sessionExpired,
    termsUrl: save.termsUrl,
    conflict: save.conflict,
    reloadLatest,
    mergeLatest: save.saveOverLatest,
    saveIssues,
    title,
    scope: editingScope,
    blocked,
    isDirty: edits.isDirty,
    openReview: save.openReview,
    closeReview: save.cancelReview,
    confirm,
    revertRow,
    goToRow,
    discardAll,
  };
}

/**
 * What an override list reads as once reverted. A list LibreChat merges by
 * key (`endpoints.custom`) stores only the entries and fields the admin
 * changed (WS1), so each stored entry goes back to its librechat.yaml entry's
 * values for the same fields, and entries librechat.yaml lacks are removed.
 * Other lists go back to the librechat.yaml list whole.
 */
function revertedList(
  path: string,
  stored: t.ConfigRecord[],
  lower: t.ConfigValue[],
): t.ConfigValue[] {
  const collection = getKeyedCollection(path);
  if (collection?.merge !== 'byKey') return lower;
  return stored.flatMap((entry) => {
    const key = getEntryKey(entry, collection.key);
    const yaml = lower.find((item) => getEntryKey(item, collection.key) === key);
    if (!isConfigRecord(yaml)) return [];
    return [sameKeys(yaml, withStoredSecretKey(entry, collection))];
  });
}

/** A stored entry's encrypted secret reads back only as its preview: count it as the key it overrides. */
function withStoredSecretKey(entry: t.ConfigRecord, collection: t.KeyedCollection): t.ConfigRecord {
  const secret = collection.secret;
  if (!secret || secret.key in entry || typeof entry[secret.preview] !== 'string') return entry;
  return { ...entry, [secret.key]: entry[secret.preview] };
}

/** `lower` cut down to the keys `stored` sets (objects key by key), so a revert lists only what the override changed. */
function sameKeys(lower: t.ConfigValue, stored: t.ConfigValue): t.ConfigValue {
  if (!isConfigRecord(lower) || !isConfigRecord(stored)) return lower;
  return Object.fromEntries(
    Object.keys(stored).map((key) => [key, sameKeys(lower[key], stored[key])]),
  );
}

/**
 * A field of a stored entry read as the override it removes: what it goes
 * back to is the librechat.yaml entry's value there (merged records whole), so
 * it reads like the top-level reverts instead of as a change or a removal.
 */
function asEntryRevert(item: t.ChangeSummaryItem, lower: t.ConfigValue[]): t.ChangeSummaryItem {
  /** `added`: a stored secret, which the redacted read leaves out of the override. */
  if (item.kind !== 'changed' && item.kind !== 'removed' && item.kind !== 'added') return item;
  if (!item.entryPath || item.path === item.entryPath || !item.collectionPath) return item;
  const collection = getKeyedCollection(item.collectionPath);
  const yaml = collection
    ? lower.find((entry) => getEntryKey(entry, collection.key) === item.entryIdentity)
    : undefined;
  const value = getValueAtPath(yaml, item.path.slice(item.entryPath.length + 1));
  return {
    ...item,
    kind: 'reverted',
    after: undefined,
    revertTarget: value === undefined ? undefined : { value, source: 'yaml' },
  };
}

/** The entry of a record collection (an MCP server) `path` is in, when librechat.yaml lacks it: reverting removes it whole. */
function panelOnlyRecordEntry(
  fields: t.SchemaField[],
  path: string,
  yamlConfig: t.ConfigRecord | undefined,
): t.ChangeEntryRef | undefined {
  const entry = findEntry(fields, path, () => undefined);
  if (!entry || entry.identity !== entry.entryPath.slice(entry.collectionPath.length + 1)) {
    return undefined;
  }
  if (findSchemaField(fields, entry.collectionPath)?.type !== 'record') return undefined;
  return getValueAtPath(yamlConfig ?? null, entry.entryPath) === undefined ? entry : undefined;
}

/**
 * Base's tombstones "Revert all" takes back, as rows of a value or entry
 * shown again with what it gets back: each hidden path, and each removal by
 * key LibreChat applies (`keyedTombstones`; Azure groups' with `gated`,
 * `appliesGroupHides`), in the group of its entry when other rows list that
 * entry. A tombstone Base sets its own value at is left out: the row of
 * that value already says what the setting goes back to.
 */
function baseRemovalItems(
  items: t.ChangeSummaryItem[],
  layers: t.KeyedVisibilityLayers,
  gated: boolean,
  targetAt: (path: string) => t.RevertTarget | undefined,
  schemaPaths: ReadonlySet<string>,
): t.ChangeSummaryItem[] {
  const stored = new Set(layers.tombstones);
  /** LibreChat stores a secret's preview beside its tombstone (`tavilyApiKeyPreview`); the secret's row covers it. */
  const isPreviewCompanion = (path: string): boolean => {
    const secret = secretPathForPreviewPath(path, schemaPaths);
    return secret !== null && stored.has(secret);
  };
  const entryPaths = new Map(
    items.flatMap((item) =>
      item.collectionPath && item.entryPath && item.entryIdentity !== undefined
        ? [[`${item.collectionPath}\u0000${item.entryIdentity}`, item.entryPath]]
        : [],
    ),
  );
  return [...stored].flatMap((path): t.ChangeSummaryItem[] => {
    if (!isKeyedPath(path)) {
      if (getValueAtPath(layers.own, path) !== undefined || isPreviewCompanion(path)) return [];
      return [
        {
          path,
          kind: 'unhidden',
          before: undefined,
          after: undefined,
          revertTarget: targetAt(path),
          sourcePath: path,
          secret: isSecretPath(path) || undefined,
        },
      ];
    }
    const keyed = layers.keyedTombstones ? parseKeyedPath(path, gated) : null;
    if (!keyed || getKeyedValue(layers.own, keyed) !== undefined) return [];
    const item = keyedVisibilityItem(path, keyed, 'unhide', layers);
    const at = entryPaths.get(`${item.collectionPath}\u0000${item.entryIdentity}`);
    if (at === undefined || !item.entryPath) return [item];
    return [{ ...item, path: `${at}${item.path.slice(item.entryPath.length)}`, entryPath: at }];
  });
}

/**
 * The base admin overrides "Revert all to librechat.yaml" removes (WS7), as
 * review rows that say what each setting goes back to, with the removals by
 * key it takes back (`keyedTombstones`). Empty objects left behind by
 * earlier resets are not overrides and are not counted.
 */
export function useBaseOverrides({
  schemaTree,
  layers,
  profiles = NO_PROFILES,
}: Pick<t.ChangeReviewOptions, 'schemaTree' | 'layers' | 'profiles'>): t.BaseOverridesState {
  const localize = useLocalize();
  const { features } = useConfigContract();
  const { dbOverrides, yamlConfig, configValues, schemaDefaults, schemaPathSet, valueLayers } =
    layers;
  /** Base mode's layers name the layer a value reverts to (librechat.yaml even when it repeats a default). */
  const baseLayers = valueLayers?.scope ? null : valueLayers;
  return useMemo(() => {
    const overrides = dbOverrides ?? {};
    const paths = new Set<string>();
    const addedEntries = new Map<string, t.ChangeEntryRef>();
    for (const [path, value] of Object.entries(flattenObject(overrides))) {
      if (isConfigRecord(value) && Object.keys(value).length === 0) continue;
      const entry = panelOnlyRecordEntry(schemaTree, path, yamlConfig);
      if (entry) addedEntries.set(entry.entryPath, entry);
      paths.add(entry?.entryPath ?? secretPathForPreviewPath(path, schemaPathSet) ?? path);
    }
    const lower: t.LowerLayers = { isScope: false, configValues, yamlConfig, schemaDefaults };
    const targetAt = (path: string) =>
      baseLayers ? revertTargetAt(path, baseLayers) : lowerValue(path, lower);
    const items = [...paths].flatMap((path): t.ChangeSummaryItem[] => {
      const before = getValueAtPath(overrides, path);
      const added = addedEntries.get(path);
      if (added) {
        return [
          {
            path,
            kind: 'removed',
            before,
            after: undefined,
            collectionPath: added.collectionPath,
            entryPath: added.entryPath,
            entryIdentity: added.identity,
          },
        ];
      }
      const target = targetAt(path);
      const reverted: t.ChangeSummaryItem = {
        path,
        kind: 'reverted',
        before,
        after: undefined,
        revertTarget: target,
        secret: isSecretPath(path) || undefined,
      };
      const lowerList = target?.value;
      if (!isObjectList(before) || !Array.isArray(lowerList)) return [reverted];
      const reverts = revertedList(path, before, lowerList);
      const entries = summarizeChanges({
        saves: [
          {
            fieldPath: path,
            value: normalizeForSave(reverts, findSchemaField(schemaTree, path)),
          },
        ],
        resets: [],
        baseline: overrides,
        ownAt: () => undefined,
        isOwned: () => true,
        lowerAt: () => undefined,
        yamlEntries: () => undefined,
        isScope: false,
        fields: schemaTree,
        schemaPaths: schemaPathSet,
      });
      if (entries.length === 0) return [reverted];
      return entries.map((item) => asEntryRevert(item, lowerList));
    });
    const tombstones = baseLayers?.baseTombstones ?? NO_TOMBSTONES;
    const groupHides = appliesGroupHides(features);
    const removals = baseRemovalItems(
      items,
      {
        lower: yamlConfig ?? null,
        own: overrides,
        baseline: configValues,
        isScope: false,
        tombstones,
        visibility: {},
        keyedTombstones: features.keyedTombstones,
      },
      groupHides,
      targetAt,
      schemaPathSet,
    );
    const keyMoves = findEntryKeyMoves(
      { lower: yamlConfig ?? {}, stored: overrides, storedAfter: {} },
      features,
    );
    const model = buildReviewModel(
      withOverrideNotes(
        [...items.map((item) => withDroppedSecrets(item, overrides)), ...removals],
        {
          profiles,
          keyMoves,
          sendsKeys: !features.secretRebinding,
          before: configValues,
          keyedTombstones: features.keyedTombstones,
          mergedLists: mergedListPaths(features),
        },
      ),
      { localize, fields: schemaTree, tree: overrides },
    );
    /**
     * Counted the way the tab badges count: a keyed list is one stored value
     * but counts per overridden entry, an MCP server once however many of its
     * fields are set. Each removal listed counts too: by key with the entry it
     * is in, a hidden path as a setting of its own (which the badges leave out).
     */
    const units = new Set<string>();
    let entryCount = 0;
    /** A list the server doesn't merge by entry here (Azure groups before it derives them) is one value. */
    const countsByEntry = (collection: t.KeyedCollection) =>
      collection.merge !== 'byKey' || mergesByKey(collection, features);
    for (const path of paths) {
      const collection = getKeyedCollection(path);
      if (!collection || !countsByEntry(collection)) units.add(overrideCountUnit(path));
    }
    const removed = removals.flatMap((item) => item.sourcePath ?? []);
    for (const path of removed) {
      const keyed = parseKeyedPath(path, groupHides);
      if (!keyed || !countsByEntry(keyed.collection)) units.add(overrideCountUnit(path));
    }
    for (const collection of KEYED_COLLECTIONS.values()) {
      if (!countsByEntry(collection)) continue;
      const keys = overriddenEntryKeys(
        collection,
        getValueAtPath(overrides, collection.path),
        getValueAtPath(yamlConfig ?? null, collection.path),
      );
      for (const name of keyedEntriesOf(removed, collection, groupHides)) keys.add(name);
      entryCount += keys.size;
    }
    return { count: units.size + entryCount, model };
  }, [
    dbOverrides,
    yamlConfig,
    configValues,
    schemaDefaults,
    schemaPathSet,
    schemaTree,
    baseLayers,
    localize,
    profiles,
    features,
  ]);
}
