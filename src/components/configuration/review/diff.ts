import type * as t from '@/types';
import {
  isSecretPath,
  flattenObject,
  getValueAtPath,
  isConfigRecord,
  unflattenObject,
  secretPreviewPath,
  secretKeyForPreviewKey,
  stripSecretPreviewValues,
} from '@/utils';
import { isConfigValueEqual, normalizeForSave } from '../edits';
import { TERMS_ACCEPTANCE_PATH } from '@/constants';
import { findSchemaField } from '../controls';
import { isPathUnder } from '../configMeta';

/** Identity key of known keyed lists (D1/D2: entries are matched by it, never by index). */
const IDENTITY_KEYS: Readonly<Record<string, string>> = {
  'endpoints.custom': 'name',
  'modelSpecs.list': 'name',
  'endpoints.azureOpenAI.groups': 'group',
};

/** Keys tried, in order, to identify the entries of other lists of objects. */
const IDENTITY_CANDIDATES = ['name', 'group', 'id', 'key', 'label', 'title'];

/** Lists LibreChat merges with librechat.yaml by name, unless the input says which (`mergedLists`). */
const MERGED_COLLECTIONS: ReadonlySet<string> = new Set(['endpoints.custom']);

/** List fields where an empty list allows nothing (no file types; no private addresses). */
const CLOSED_WHEN_EMPTY_KEYS: ReadonlySet<string> = new Set([
  'allowedAddresses',
  'supportedMimeTypes',
]);

/**
 * List fields where an empty list sets no limit: every endpoint is listed
 * (`addedEndpoints`), every provider allowed (`allowedProviders`), any public
 * domain reachable (`allowedDomains` of Actions and MCP).
 */
const OPEN_WHEN_EMPTY_KEYS: ReadonlySet<string> = new Set([
  'allowedDomains',
  'addedEndpoints',
  'allowedProviders',
]);

const INDEX_SEGMENT_RE = /^\d+$/;

const NO_RENAMES: Readonly<Record<string, string>> = {};

interface DiffContext {
  input: t.ChangeSummaryInput;
  sourcePath: string;
}

function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('.') + 1);
}

/** `endpoints.custom.3.name` → `endpoints.custom.name`, for lookups keyed by index-free paths. */
export function stripIndices(path: string): string {
  return path
    .split('.')
    .filter((segment) => !INDEX_SEGMENT_RE.test(segment))
    .join('.');
}

/** How the metadata registry names any key of a record. */
const RECORD_KEY = '{}';

/**
 * Whether the value at `segments` must never be shown (`isSecretPath`). A
 * segment with a dot is a record key (a header, an inference profile ID), a
 * free name rather than a field's, so it is read as any key of its record:
 * its text (`tenant.apiKey`) never makes the value a secret.
 */
function isSecretSegments(segments: readonly string[]): boolean {
  return isSecretPath(
    segments.map((segment) => (segment.includes('.') ? RECORD_KEY : segment)).join('.'),
  );
}

export function isObjectList(value: t.ConfigValue): value is t.ConfigRecord[] {
  return Array.isArray(value) && value.length > 0 && value.every(isConfigRecord);
}

function isRecordCollection(field: t.SchemaField | null): boolean {
  return field?.type === 'record' && field.recordValueType === 'complex';
}

function isEntryList(field: t.SchemaField | null): boolean {
  return field?.isArray === true && (field.children?.length ?? 0) > 0;
}

/** The key identifying the entries of a list, or undefined when entries only have positions. */
export function identityKeyFor(path: string, entries: t.ConfigValue[]): string | undefined {
  const known = IDENTITY_KEYS[stripIndices(path)];
  if (known) return known;
  const records = entries.filter(isConfigRecord);
  if (records.length === 0) return undefined;
  return IDENTITY_CANDIDATES.find((key) =>
    records.every((entry) => typeof entry[key] === 'string' && entry[key] !== ''),
  );
}

function identityOf(entry: t.ConfigValue, key: string | undefined): string | undefined {
  if (!key || !isConfigRecord(entry)) return undefined;
  const value = entry[key];
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/**
 * The outermost collection entry `path` is in (or is): a record entry such as
 * `mcpServers.github`, or a list entry such as `endpoints.custom.3`, whose
 * identity is read from the entry value `entryAt` returns.
 */
export function findEntry(
  fields: t.SchemaField[],
  path: string,
  entryAt: (entryPath: string) => t.ConfigValue,
): t.ChangeEntryRef | undefined {
  const segments = path.split('.');
  for (let i = 1; i < segments.length; i++) {
    const collectionPath = segments.slice(0, i).join('.');
    const field = findSchemaField(fields, collectionPath);
    const entryPath = `${collectionPath}.${segments[i]}`;
    if (isRecordCollection(field)) return { collectionPath, entryPath, identity: segments[i] };
    if (isEntryList(field) && INDEX_SEGMENT_RE.test(segments[i])) {
      const value = entryAt(entryPath);
      const identity = identityOf(value, identityKeyFor(collectionPath, [value]));
      return { collectionPath, entryPath, identity };
    }
  }
  return undefined;
}

function withEntry(
  item: t.ChangeSummaryItem,
  entry: t.ChangeEntryRef | undefined,
): t.ChangeSummaryItem {
  if (!entry) return item;
  return {
    ...item,
    collectionPath: entry.collectionPath,
    entryPath: entry.entryPath,
    entryIdentity: entry.identity,
  };
}

/** An empty list here lets everyone sign up. */
const REGISTRATION_DOMAINS = 'registration.allowedDomains';

/** An empty spec list: users get the endpoint menu, whatever the selection mode says. */
const SPEC_LIST = 'modelSpecs.list';

function allowlistWarning(path: string, after: t.ConfigValue): t.ChangeWarning[] {
  if (!Array.isArray(after) || after.length > 0) return [];
  if (path === REGISTRATION_DOMAINS) return ['openRegistration'];
  if (path === SPEC_LIST) return ['emptySpecs'];
  const key = lastSegment(path);
  if (CLOSED_WHEN_EMPTY_KEYS.has(key)) return ['emptyAllowlist'];
  return OPEN_WHEN_EMPTY_KEYS.has(key) ? ['openAllowlist'] : [];
}

function termsWarning(
  path: string,
  before: t.ConfigValue,
  after: t.ConfigValue,
): t.ChangeWarning[] {
  return path === TERMS_ACCEPTANCE_PATH && after === true && before !== true
    ? ['requireTerms']
    : [];
}

const isRestricting = (value: t.ConfigValue): boolean => Array.isArray(value) && value.length > 0;

/**
 * A reset of a domain restriction (or of an object holding one) to a layer
 * that sets none, or an empty list: everyone can sign up once it is saved.
 */
function resetWarning(
  path: string,
  before: t.ConfigValue,
  after: t.ConfigValue,
): t.ChangeWarning[] {
  if (path !== REGISTRATION_DOMAINS && !REGISTRATION_DOMAINS.startsWith(`${path}.`)) return [];
  const rest = REGISTRATION_DOMAINS.slice(path.length + 1);
  const at = (value: t.ConfigValue) => (rest ? getValueAtPath(value, rest) : value);
  return isRestricting(at(before)) && !isRestricting(at(after)) ? ['openRegistration'] : [];
}

/**
 * Saving a list the target does not own yet makes the whole list the
 * target's: librechat.yaml (or, for a profile, Base) no longer feeds it.
 * Lists of entries always warn; plain lists only in a profile, where the
 * saved list replaces the inherited one users currently get.
 */
function ownershipWarning(path: string, after: t.ConfigValue, ctx: DiffContext): t.ChangeWarning[] {
  const merged = ctx.input.mergedLists ?? MERGED_COLLECTIONS;
  if (!Array.isArray(after) || merged.has(stripIndices(path))) return [];
  if (ctx.input.isOwned(path)) return [];
  const lower = ctx.input.lowerAt(path)?.value;
  if (!Array.isArray(lower) || lower.length === 0) return [];
  return isObjectList(after) || isObjectList(lower) || ctx.input.isScope ? ['ownershipChange'] : [];
}

function warningsOf(...lists: t.ChangeWarning[][]): t.ChangeWarning[] | undefined {
  const merged = [...new Set(lists.flat())];
  return merged.length > 0 ? merged : undefined;
}

function leafKind(before: t.ConfigValue, after: t.ConfigValue): t.ChangeKind {
  if (before == null) return 'added';
  return after == null ? 'removed' : 'changed';
}

/**
 * BEFORE of a secret the read hides: its masked preview (`apiKey.keyPreview`),
 * all a server with `recordSecrets` returns of a stored MCP key, so entering
 * a key over it reads as replacing it rather than setting one.
 */
function hiddenSecretBefore(path: string, before: t.ConfigValue, ctx: DiffContext): t.ConfigValue {
  if (before != null || !isSecretPath(path)) return before;
  const preview = getValueAtPath(ctx.input.baseline, secretPreviewPath(path));
  return typeof preview === 'string' && preview !== '' ? preview : before;
}

/**
 * A change of one value. Outside collections, BEFORE is the target's own
 * value; when the target has none, `revertTarget` carries the value in effect
 * from the layer below (librechat.yaml or the default for Base, Base for a
 * profile) so the review can say what is currently inherited.
 */
function leafItem(
  path: string,
  shown: t.ConfigValue,
  after: t.ConfigValue,
  ctx: DiffContext,
  entry: t.ChangeEntryRef | undefined,
): t.ChangeSummaryItem {
  const before = hiddenSecretBefore(path, shown, ctx);
  const item: t.ChangeSummaryItem = {
    path,
    kind: leafKind(before, after),
    before,
    after,
    sourcePath: ctx.sourcePath,
    secret: isSecretPath(path) || undefined,
    warnings: warningsOf(
      allowlistWarning(path, after),
      ownershipWarning(path, after, ctx),
      termsWarning(path, before, after),
    ),
  };
  if (entry) return withEntry(withInherited(item, entry, ctx), entry);
  if (ctx.input.isOwned(path)) return item;
  const lower = ctx.input.lowerAt(path);
  if (before == null) return lower ? { ...item, revertTarget: lower } : item;
  return {
    ...item,
    kind: 'changed',
    before: undefined,
    revertTarget: { value: before, source: lower?.source ?? 'yaml' },
  };
}

/**
 * A field the target sets for the first time on an entry addressed by key
 * (an inherited MCP server overridden in a profile) says what it inherits.
 * Entries of lists are addressed by position, which differs between layers,
 * so their lower-layer value is not looked up.
 */
function withInherited(
  item: t.ChangeSummaryItem,
  entry: t.ChangeEntryRef,
  ctx: DiffContext,
): t.ChangeSummaryItem {
  if (item.before != null || entry.identity !== lastSegment(entry.entryPath)) return item;
  const lower = ctx.input.lowerAt(item.path);
  return lower ? { ...item, revertTarget: lower } : item;
}

function entryItem(
  kind: t.ChangeKind,
  entry: t.ChangeEntryRef,
  before: t.ConfigValue,
  after: t.ConfigValue,
  ctx: DiffContext,
): t.ChangeSummaryItem {
  const yaml = ctx.input.yamlEntries(entry.collectionPath);
  const touchesYaml = kind === 'removed' && entry.identity != null && yaml?.has(entry.identity);
  return withEntry(
    {
      path: entry.entryPath,
      kind,
      before,
      after,
      sourcePath: ctx.sourcePath,
      warnings: touchesYaml ? ['yamlEntry'] : undefined,
    },
    entry,
  );
}

function omitKey(value: t.ConfigValue, key: string): t.ConfigValue {
  if (!isConfigRecord(value)) return value;
  const { [key]: _omitted, ...rest } = value;
  return rest;
}

/** A renamed entry: one rename row, then its other field changes (matched to the old entry). */
function renameItems(
  entryRef: t.ChangeEntryRef,
  previous: string,
  before: t.ConfigValue,
  after: t.ConfigValue,
  key: string,
  ctx: DiffContext,
): t.ChangeSummaryItem[] {
  const yaml = ctx.input.yamlEntries(entryRef.collectionPath);
  const renamed: t.ChangeSummaryItem = {
    ...entryItem('renamed', entryRef, previous, entryRef.identity, ctx),
    previousIdentity: previous,
    warnings: yaml?.has(previous) ? ['yamlEntry'] : undefined,
  };
  const fieldChanges = diffValue(
    entryRef.entryPath,
    omitKey(before, key),
    omitKey(after, key),
    ctx,
    entryRef,
  );
  return [renamed, ...fieldChanges.map((item) => ({ ...item, previousIdentity: previous }))];
}

/**
 * The BEFORE entry each AFTER entry is the same entry as, by identity, each
 * BEFORE entry used once: an entry still at its position first, then the
 * first unused entry with its name. A second entry with a name already taken
 * (one renamed onto an existing name) is left unmatched, so it reads as the
 * rename or addition it is, not as an edit of the other entry.
 */
function matchEntries(
  before: t.ConfigValue[],
  after: t.ConfigValue[],
  key: string,
  beforeIndex: Map<string, number>,
): Array<number | undefined> {
  const used = new Set<number>();
  const ids = after.map((entry) => identityOf(entry, key));
  const matched = ids.map((id, j) => {
    if (id == null || identityOf(before[j], key) !== id) return undefined;
    used.add(j);
    return j;
  });
  return matched.map((found, j) => {
    const id = ids[j];
    if (found !== undefined || id == null) return found;
    const first = beforeIndex.get(id);
    const index =
      first !== undefined && !used.has(first)
        ? first
        : before.findIndex((entry, i) => !used.has(i) && identityOf(entry, key) === id);
    if (index === undefined || index < 0) return undefined;
    used.add(index);
    return index;
  });
}

/** Entries of a list matched by identity: added, removed, renamed (same position, new name) and changed. */
function diffEntryList(
  path: string,
  before: t.ConfigValue[],
  after: t.ConfigValue[],
  ctx: DiffContext,
): t.ChangeSummaryItem[] {
  const key = identityKeyFor(path, [...before, ...after]);
  if (!key) return diffPositionalList(path, before, after, ctx);
  const beforeIndex = new Map<string, number>();
  before.forEach((entry, i) => {
    const id = identityOf(entry, key);
    if (id != null && !beforeIndex.has(id)) beforeIndex.set(id, i);
  });
  const afterIds = new Set(after.map((entry) => identityOf(entry, key)));
  const renamedFrom = new Set<string>();
  const items: t.ChangeSummaryItem[] = [];
  const matched = matchEntries(before, after, key, beforeIndex);

  after.forEach((entry, j) => {
    const id = identityOf(entry, key);
    const entryRef: t.ChangeEntryRef = {
      collectionPath: path,
      entryPath: `${path}.${j}`,
      identity: id,
    };
    const from = matched[j];
    if (from !== undefined) {
      items.push(...diffValue(entryRef.entryPath, before[from], entry, ctx, entryRef));
      return;
    }
    const previous = identityOf(before[j], key);
    if (previous != null && !afterIds.has(previous)) {
      renamedFrom.add(previous);
      items.push(...renameItems(entryRef, previous, before[j], entry, key, ctx));
      return;
    }
    items.push(entryItem('added', entryRef, undefined, entry, ctx));
  });

  before.forEach((entry, i) => {
    const id = identityOf(entry, key);
    if (id == null || afterIds.has(id) || renamedFrom.has(id)) return;
    const entryRef: t.ChangeEntryRef = {
      collectionPath: path,
      entryPath: `${path}.${i}`,
      identity: id,
    };
    items.push(entryItem('removed', entryRef, entry, undefined, ctx));
  });

  const order = (list: t.ConfigValue[]) =>
    list.map((entry) => identityOf(entry, key)).filter((id) => id != null && beforeIndex.has(id));
  const beforeOrder = order(before).filter((id) => afterIds.has(id));
  const afterOrder = order(after);
  /** A name two entries share (one renamed onto another) is an error the review shows, not a reorder. */
  const hasDuplicate = new Set(afterOrder).size !== afterOrder.length;
  if (!hasDuplicate && beforeOrder.length > 1 && beforeOrder.join('\n') !== afterOrder.join('\n')) {
    items.push({
      path,
      kind: 'changed',
      before: beforeOrder as string[],
      after: afterOrder as string[],
      sourcePath: ctx.sourcePath,
      collectionPath: path,
    });
  }
  return items;
}

/** Entries without an identity key are compared position by position. */
function diffPositionalList(
  path: string,
  before: t.ConfigValue[],
  after: t.ConfigValue[],
  ctx: DiffContext,
): t.ChangeSummaryItem[] {
  const items: t.ChangeSummaryItem[] = [];
  for (let i = 0; i < Math.max(before.length, after.length); i++) {
    const entryRef: t.ChangeEntryRef = { collectionPath: path, entryPath: `${path}.${i}` };
    if (i >= before.length) items.push(entryItem('added', entryRef, undefined, after[i], ctx));
    else if (i >= after.length)
      items.push(entryItem('removed', entryRef, before[i], undefined, ctx));
    else items.push(...diffValue(entryRef.entryPath, before[i], after[i], ctx, entryRef));
  }
  return items;
}

/**
 * Items of the value under `key` of the object at `path`. A key with a dot
 * (`us.anthropic.claude-sonnet-4-6`) reads as several keys in a dot-path, so
 * these items carry their path's segments, the key kept whole, and a secret
 * read from the dot-path is checked again by them (`isSecretSegments`). Items
 * under a dotted key nested deeper already carry theirs: only the part up to
 * this key is replaced.
 */
function underKey(items: t.ChangeSummaryItem[], path: string, key: string): t.ChangeSummaryItem[] {
  if (!key.includes('.')) return items;
  const parent = path.split('.');
  const depth = parent.length + key.split('.').length;
  return items.map((item) => {
    const segments = [...parent, key, ...(item.segments ?? item.path.split('.')).slice(depth)];
    if (!item.secret) return { ...item, segments };
    return { ...item, segments, secret: isSecretSegments(segments) || undefined };
  });
}

/** Entries of a record collection (`mcpServers`) saved as a whole, matched by key. */
function diffRecordCollection(
  path: string,
  before: t.ConfigRecord,
  after: t.ConfigRecord,
  ctx: DiffContext,
): t.ChangeSummaryItem[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.flatMap((key) => {
    const entryRef: t.ChangeEntryRef = {
      collectionPath: path,
      entryPath: `${path}.${key}`,
      identity: key,
    };
    if (before[key] == null) {
      return underKey([entryItem('added', entryRef, undefined, after[key], ctx)], path, key);
    }
    if (after[key] == null) {
      return underKey([entryItem('removed', entryRef, before[key], undefined, ctx)], path, key);
    }
    return underKey(
      diffValue(entryRef.entryPath, before[key], after[key], ctx, entryRef),
      path,
      key,
    );
  });
}

/** Leaves of an object set where nothing was, each a row (`flattenObject`, dotted keys kept whole). */
function addedLeaves(
  path: string,
  after: t.ConfigRecord,
  ctx: DiffContext,
  entry: t.ChangeEntryRef | undefined,
): t.ChangeSummaryItem[] {
  return Object.entries(after).flatMap(([key, value]) => {
    const leaves = Object.entries(flattenObject({ [key]: value }, path));
    const items = leaves.map(([leafPath, leaf]) => leafItem(leafPath, undefined, leaf, ctx, entry));
    return underKey(items, path, key);
  });
}

/** Changed leaves between two values: lists of entries by identity, objects key by key. */
function diffValue(
  path: string,
  before: t.ConfigValue,
  after: t.ConfigValue,
  ctx: DiffContext,
  entry: t.ChangeEntryRef | undefined,
): t.ChangeSummaryItem[] {
  if (isConfigValueEqual(before, after)) return [];
  const field = findSchemaField(ctx.input.fields, path);
  if (isObjectList(before) || isObjectList(after)) {
    const beforeList = Array.isArray(before) ? before : [];
    const afterList = Array.isArray(after) ? after : [];
    const items = diffEntryList(path, beforeList, afterList, ctx);
    const warnings = ownershipWarning(path, after, ctx);
    if (warnings.length === 0 || items.length === 0) return items;
    return items.map((item) => ({ ...item, warnings: warningsOf(item.warnings ?? [], warnings) }));
  }
  const isEntryPath = entry?.entryPath === path;
  if (isEntryPath && entry && isConfigRecord(before) && isConfigRecord(after)) {
    const key = identityKeyFor(entry.collectionPath, [before, after]);
    const previous = identityOf(before, key);
    const next = identityOf(after, key);
    const isList = isEntryList(findSchemaField(ctx.input.fields, entry.collectionPath));
    if (key && isList && previous != null && next != null && previous !== next) {
      return renameItems({ ...entry, identity: next }, previous, before, after, key, ctx);
    }
  }
  if (
    isRecordCollection(field) &&
    isConfigRecord(after) &&
    (before == null || isConfigRecord(before))
  ) {
    return diffRecordCollection(path, before ?? {}, after, ctx);
  }
  if (isConfigRecord(after) && isConfigRecord(before)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
    return keys.flatMap((key) =>
      underKey(diffValue(`${path}.${key}`, before[key], after[key], ctx, entry), path, key),
    );
  }
  if (isConfigRecord(after) && before == null) {
    if (isEntryPath && entry) return [entryItem('added', entry, undefined, after, ctx)];
    return addedLeaves(path, after, ctx, entry);
  }
  if (after == null && isEntryPath && entry) {
    return [entryItem('removed', entry, before, undefined, ctx)];
  }
  return [leafItem(path, before, after, ctx, entry)];
}

/** The baseline value at `path`, shaped like a save value so unchanged parts compare equal. */
function baselineAt(input: t.ChangeSummaryInput, path: string): t.ConfigValue {
  const raw = getValueAtPath(input.baseline, path);
  if (raw === undefined) return undefined;
  const stripped = stripSecretPreviewValues(raw, path, input.schemaPaths);
  return normalizeForSave(stripped, findSchemaField(input.fields, path));
}

/** The collection entry a reset is in (or is), read from the baseline or the target's own value. */
function resetEntry(path: string, input: t.ChangeSummaryInput): t.ChangeEntryRef | undefined {
  return findEntry(
    input.fields,
    path,
    (entryPath) => getValueAtPath(input.baseline, entryPath) ?? input.ownAt(entryPath),
  );
}

function resetItem(path: string, input: t.ChangeSummaryInput): t.ChangeSummaryItem {
  const lower = input.lowerAt(path);
  const entry = resetEntry(path, input);
  const before = input.ownAt(path);
  const item: t.ChangeSummaryItem = {
    path,
    kind: 'reverted',
    before,
    after: undefined,
    revertTarget: lower,
    sourcePath: path,
    secret: isSecretPath(path) || undefined,
    warnings: warningsOf(resetWarning(path, before, lower?.value)),
  };
  if (!entry) return item;
  if (entry.entryPath === path && lower?.value == null) {
    return withEntry({ ...item, kind: 'removed', revertTarget: undefined }, entry);
  }
  return withEntry(item, entry);
}

/** Whether `key` of the object at `segments` is the preview of a secret the read hides. */
function isHiddenSecret(segments: readonly string[], key: string): boolean {
  const secret = secretKeyForPreviewKey(key);
  return secret !== null && isSecretSegments([...segments, secret]);
}

/**
 * The parts of the target's own value at `path` that a write of the whole
 * path drops: each part no save writes at, above or under. A stored secret
 * whose holder a save writes into stays (LibreChat keeps the secret an
 * object omits), so only the parts beside it are dropped.
 */
function droppedParts(
  path: string,
  segments: string[],
  own: t.ConfigValue,
  written: readonly string[],
  toRow: (path: string, segments: string[], before: t.ConfigValue) => t.ChangeSummaryItem,
): t.ChangeSummaryItem[] {
  if (own === undefined || written.some((save) => isPathUnder(path, save))) return [];
  if (!written.some((save) => save.startsWith(`${path}.`))) return [toRow(path, segments, own)];
  if (!isConfigRecord(own)) return [];
  return Object.entries(own).flatMap(([key, value]) =>
    isHiddenSecret(segments, key)
      ? []
      : droppedParts(`${path}.${key}`, [...segments, key], value, written, toRow),
  );
}

/**
 * The rows of a reset. One the save also writes under (an entry deleted,
 * then written again under its name, which the plan sends as one set of
 * it) lists what the target's own value there loses, each part removed or
 * back to the layer beneath, stored secrets included. Revert undoes the
 * removal.
 */
function resetItems(path: string, input: t.ChangeSummaryInput): t.ChangeSummaryItem[] {
  const written = input.saves
    .map(({ fieldPath }) => fieldPath)
    .filter((fieldPath) => isPathUnder(fieldPath, path));
  if (written.length === 0) return [resetItem(path, input)];
  const entry = resetEntry(path, input);
  const toRow = (part: string, segments: string[], before: t.ConfigValue): t.ChangeSummaryItem => {
    const lower = input.lowerAt(part);
    const reverts = lower?.value != null;
    const item: t.ChangeSummaryItem = {
      path: part,
      ...(segments.some((segment) => segment.includes('.')) && { segments }),
      kind: reverts ? 'reverted' : 'removed',
      before,
      after: undefined,
      ...(reverts && { revertTarget: lower }),
      sourcePath: path,
      secret: isSecretSegments(segments) || undefined,
    };
    return withEntry(item, entry);
  };
  return droppedParts(path, path.split('.'), input.ownAt(path), written, toRow);
}

/**
 * Leaf edits of a record entry that does not exist yet in any layer (an MCP
 * server created field by field) read as one added entry.
 */
function newRecordEntry(path: string, input: t.ChangeSummaryInput): t.ChangeEntryRef | undefined {
  const entry = findEntry(input.fields, path, () => undefined);
  if (!entry || entry.entryPath === path) return undefined;
  if (!isRecordCollection(findSchemaField(input.fields, entry.collectionPath))) return undefined;
  if (getValueAtPath(input.baseline, entry.entryPath) != null) return undefined;
  if (input.lowerAt(entry.entryPath)?.value != null) return undefined;
  return entry;
}

/**
 * Human-readable changes for what Save sends (WS7; the `ChangeSummaryItem`
 * contract WS1 produces). Every save is compared with the value the edit was
 * made against: lists of entries are matched by identity (name, group, …)
 * and report added, removed, renamed and changed entries; objects report only
 * the leaves that changed. Resets report the value the field reverts to.
 */
export function summarizeChanges(input: t.ChangeSummaryInput): t.ChangeSummaryItem[] {
  const items: t.ChangeSummaryItem[] = [];
  const newEntries = new Map<string, { entry: t.ChangeEntryRef; leaves: t.FlatConfigMap }>();
  for (const { fieldPath, value } of input.saves) {
    const created = newRecordEntry(fieldPath, input);
    if (created) {
      const group = newEntries.get(created.entryPath) ?? { entry: created, leaves: {} };
      group.leaves[fieldPath.slice(created.entryPath.length + 1)] = value;
      newEntries.set(created.entryPath, group);
      continue;
    }
    const before = baselineAt(input, fieldPath);
    const entry = findEntry(input.fields, fieldPath, (entryPath) =>
      entryPath === fieldPath ? (value ?? before) : getValueAtPath(input.baseline, entryPath),
    );
    const ctx: DiffContext = { input, sourcePath: fieldPath };
    items.push(...diffValue(fieldPath, before, value, ctx, entry));
  }
  for (const { entry, leaves } of newEntries.values()) {
    const ctx: DiffContext = { input, sourcePath: entry.entryPath };
    items.push(entryItem('added', entry, undefined, unflattenObject(leaves), ctx));
  }
  for (const path of input.resets) items.push(...resetItems(path, input));
  return pairRecordRenames(items, input.renames ?? NO_RENAMES);
}

/** An entry change of a whole entry (added or removed), not one of its fields. */
function isWholeEntry(item: t.ChangeSummaryItem, kind: t.ChangeKind): boolean {
  return item.kind === kind && item.entryPath === item.path && item.collectionPath != null;
}

/**
 * What removing the target's own value `own` at `path` deletes with it, as
 * rows: each stored part, or with `secretsOnly` each stored secret, a secret
 * read back as its masked preview named by the secret it is. Parts of a list
 * entry name it (`entryIdentity`).
 */
export function droppedOwnParts(
  path: string,
  own: t.ConfigValue,
  secretsOnly: boolean,
): t.ChangeSummaryItem[] {
  if (own == null) return [];
  if (Array.isArray(own)) {
    const key = identityKeyFor(path, own);
    return own.flatMap((entry, index) => {
      const entryIdentity = identityOf(entry, key);
      return droppedOwnParts(`${path}.${index}`, entry, secretsOnly).map((part) =>
        entryIdentity === undefined ? part : { ...part, entryIdentity },
      );
    });
  }
  const toRow = (part: string, before: t.ConfigValue): t.ChangeSummaryItem => {
    const secret = isSecretPath(part);
    return {
      path: part,
      kind: 'removed',
      before: secret ? undefined : before,
      after: undefined,
      secret: secret || undefined,
    };
  };
  if (!isConfigRecord(own)) return secretsOnly ? [] : [toRow(path, own)];
  return Object.entries(savedLeaves(own, path)).flatMap(([leaf, value]) => {
    const part = `${path}.${leaf}`;
    const isEmpty = value == null || (isConfigRecord(value) && Object.keys(value).length === 0);
    if (isEmpty || (secretsOnly && !isSecretPath(part))) return [];
    return [toRow(part, value)];
  });
}

/** `value` at `path` without the masked previews of the secrets it stores (`apiKey.keyPreview`). */
export function withoutSecretPreviews(value: t.ConfigValue, path: string): t.ConfigValue {
  if (!isConfigRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).flatMap(([key, child]): Array<[string, t.ConfigValue]> => {
      const secret = secretKeyForPreviewKey(key);
      if (secret !== null && isSecretPath(`${path}.${secret}`)) return [];
      return [[key, withoutSecretPreviews(child, `${path}.${key}`)]];
    }),
  );
}

/**
 * Leaves of a saved entry with each masked preview under the secret it shows
 * (`apiKey.keyPreview` → `apiKey.key`), so a stored secret compares with the
 * one the renamed entry enters, or lacks.
 */
function savedLeaves(entry: t.ConfigRecord, entryPath: string): t.FlatConfigMap {
  const leaves: t.FlatConfigMap = {};
  for (const [leaf, value] of Object.entries(flattenObject(entry))) {
    const dot = leaf.lastIndexOf('.');
    const key = secretKeyForPreviewKey(leaf.slice(dot + 1));
    const secret = key === null ? null : `${leaf.slice(0, dot + 1)}${key}`;
    const isPreview = secret !== null && isSecretPath(`${entryPath}.${secret}`);
    leaves[isPreview ? secret : leaf] = value;
  }
  return leaves;
}

/**
 * The fields a renamed entry changes as well, as rows under its new name. A
 * stored secret it enters again reads as replaced; one it doesn't is no row:
 * the save carries it (`getSecretCarry`), or the card asks for it again.
 */
function renamedFieldChanges(
  renamed: t.ChangeSummaryItem,
  before: t.ConfigRecord,
  after: t.ConfigRecord,
): t.ChangeSummaryItem[] {
  const beforeLeaves = savedLeaves(before, renamed.path);
  const afterLeaves = flattenObject(after);
  const leaves = [...new Set([...Object.keys(beforeLeaves), ...Object.keys(afterLeaves)])];
  const leftBehind = (leaf: string) =>
    afterLeaves[leaf] === undefined && isSecretPath(`${renamed.path}.${leaf}`);
  return leaves
    .filter((leaf) => !isConfigValueEqual(beforeLeaves[leaf], afterLeaves[leaf]))
    .filter((leaf) => !leftBehind(leaf))
    .map((leaf) => {
      const path = `${renamed.path}.${leaf}`;
      return {
        path,
        kind: leafKind(beforeLeaves[leaf], afterLeaves[leaf]),
        before: beforeLeaves[leaf],
        after: afterLeaves[leaf],
        sourcePath: renamed.sourcePath,
        secret: isSecretPath(path) || undefined,
        collectionPath: renamed.collectionPath,
        entryPath: renamed.entryPath,
        entryIdentity: renamed.entryIdentity,
        previousIdentity: renamed.previousIdentity,
      };
    });
}

/**
 * A record entry removed and one added in the same save (an MCP server
 * renamed: the old key's leaves are removed, the new key's written) read as
 * one rename: the entry the panel recorded as renamed from the removed one
 * (`renames`), whose other changes are listed under it, else an added entry
 * with the same value as a removed one. A shared URL or command alone is no
 * proof: a server deleted and an unrelated one added for the same endpoint
 * stay a removal and an addition.
 */
function pairRecordRenames(
  items: t.ChangeSummaryItem[],
  renames: Readonly<Record<string, string>>,
): t.ChangeSummaryItem[] {
  const removed = items.filter((item) => isWholeEntry(item, 'removed'));
  if (removed.length === 0) return items;
  const paired = new Set<t.ChangeSummaryItem>();
  const findMatch = (
    item: t.ChangeSummaryItem,
    matches: (candidate: t.ChangeSummaryItem) => boolean,
  ) =>
    removed.find(
      (candidate) =>
        !paired.has(candidate) &&
        candidate.collectionPath === item.collectionPath &&
        matches(candidate),
    );
  const result = items.flatMap((item): t.ChangeSummaryItem[] => {
    if (!isWholeEntry(item, 'added') || !isConfigRecord(item.after)) return [item];
    const renamedFrom = item.entryPath ? renames[item.entryPath] : undefined;
    const match =
      findMatch(item, (candidate) => candidate.entryPath === renamedFrom) ??
      findMatch(item, (candidate) => isConfigValueEqual(candidate.before, item.after));
    if (!match) return [item];
    paired.add(match);
    const renamed: t.ChangeSummaryItem = {
      ...item,
      kind: 'renamed',
      before: match.before,
      previousIdentity: match.entryIdentity,
    };
    if (isConfigValueEqual(match.before, item.after) || !isConfigRecord(match.before)) {
      return [renamed];
    }
    return [renamed, ...renamedFieldChanges(renamed, match.before, item.after)];
  });
  return result.filter((item) => !paired.has(item));
}

function setPath(tree: t.ConfigValue, segments: string[], value: t.ConfigValue): t.ConfigValue {
  if (segments.length === 0) return value;
  const [head, ...rest] = segments;
  if (Array.isArray(tree) && INDEX_SEGMENT_RE.test(head)) {
    const copy = [...tree];
    copy[Number(head)] = setPath(tree[Number(head)], rest, value);
    return copy;
  }
  const record = isConfigRecord(tree) ? tree : {};
  return { ...record, [head]: setPath(record[head], rest, value) };
}

/** The baseline with pending saves applied: what entry titles and issue labels are read from. */
export function applySaves(baseline: t.ConfigRecord | null, saves: t.SaveEntry[]): t.ConfigRecord {
  const tree = saves.reduce<t.ConfigValue>(
    (current, { fieldPath, value }) => setPath(current, fieldPath.split('.'), value),
    baseline ?? {},
  );
  return isConfigRecord(tree) ? tree : {};
}

/**
 * The value a path falls back to without the target's own override: for a
 * profile, Base; for Base, librechat.yaml ("default" when it only repeats the
 * schema default), else the schema default.
 */
export function lowerValue(path: string, layers: t.LowerLayers): t.RevertTarget | undefined {
  const fallback = layers.schemaDefaults[path];
  const lower = getValueAtPath(layers.isScope ? layers.configValues : layers.yamlConfig, path);
  if (lower !== undefined) {
    if (layers.isScope) return { value: lower, source: 'inherited' };
    return { value: lower, source: isConfigValueEqual(lower, fallback) ? 'default' : 'yaml' };
  }
  return fallback === undefined ? undefined : { value: fallback, source: 'default' };
}
